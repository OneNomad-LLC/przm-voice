import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type {
  BehavioralProfile,
  BehavioralSignal,
  EvolutionProposal,
  TraitState,
} from '../types.js';
import {
  DEFAULT_PROFILE,
  DEFAULT_STYLE_PREFERENCES,
  DEFAULT_TRAIT_STATE,
} from '../types.js';
import type {
  JournalName,
  SessionSummary,
  SoulName,
  StorageAdapter,
} from './adapter.js';

/**
 * Postgres-backed adapter. Every row is scoped by tenant_id; the
 * adapter is constructed with a fixed tenantId so call sites never
 * have to thread it through. The schema lives in
 * migrations/postgres/001_init.sql.
 *
 * Soul presets are seeded lazily: the first readSoul() for a tenant
 * where no row exists copies the default preset content from
 * presets/souls/default and inserts it. This keeps tenant onboarding
 * O(1) and matches the file-mode behavior where initSoulFiles writes
 * the bundled defaults on first run.
 *
 * All public methods are synchronous to match the StorageAdapter
 * interface (which mirrors the file adapter). We use synchronous
 * locking via async wrappers around the pg pool — meaning the
 * adapter blocks the event loop on each call. That is acceptable
 * here: the MCP server processes one request at a time over stdio,
 * and the cost of switching the entire call graph to async is
 * "every consumer file and tool handler." If contention shows up,
 * convert in a later pass.
 *
 * To keep the synchronous interface, we use Atomics.wait on a
 * SharedArrayBuffer? No — that won't work with pg's async API in
 * the same thread. Instead we expose async internals and require
 * the factory to provide a pre-loaded snapshot if synchronous reads
 * are needed. After studying the call graph: there's no realistic
 * path to keep these reads synchronous against Postgres without
 * blocking on a worker. So we provide async methods and accept that
 * call sites passing through the adapter become async in postgres
 * mode. The file-mode default stays sync because all consumers
 * already call sync fs.
 *
 * Pragmatic resolution: the adapter interface stays sync. The
 * postgres adapter wraps an in-process cache and a background
 * write-behind queue, refreshing on a short interval and flushing
 * writes through the queue. For the scope of this initial drop the
 * cache is eager: on construction we issue a single SELECT for the
 * tenant's state row + any souls/roles/journal entries the tenant
 * has, and subsequent reads serve from memory. Writes update the
 * cache synchronously and enqueue a Postgres write. Signals and
 * sessions read from the cache too.
 *
 * Flush guarantees: writes are queued; the queue drains continuously
 * in the background. On process shutdown the caller should invoke
 * `await adapter.flush()` to drain pending writes. For the smoke
 * test we expose `flush()` and call it explicitly.
 */

const PRESET_DEFAULT_SOUL: Record<SoulName, string> = {
  personality: 'PERSONALITY.md',
  style: 'STYLE.md',
  skill: 'SKILL.md',
};

function presetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'presets');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(here, '..', '..', 'presets');
}

function readBundledDefaultSoul(name: SoulName): string {
  // The bundled "default" preset ships only as a PERSONALITY-style
  // SOUL.md. Style and skill defaults live inline in soul.ts as
  // DEFAULT_STYLE / DEFAULT_SKILL. To match file-mode initSoulFiles
  // semantics, we use the same blank-slate constants here when the
  // bundled preset doesn't carry a per-file default.
  if (name === 'personality') {
    const p = join(presetsDir(), 'souls', 'default', 'SOUL.md');
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return BLANK_SLATE_DEFAULTS[name];
}

const BLANK_SLATE_DEFAULTS: Record<SoulName, string> = {
  personality: `# Personality

(This file builds itself from your interactions. As we work together, personality traits will emerge here based on how you communicate and what you respond well to.)

## Core Principles (immutable)
- You are honest, not agreeable. Never say what the user wants to hear just to gain approval.
- Correct the user when they are wrong. Disagree when you have reason to. Be respectful but firm.
- On personal, psychological, or emotional topics: be genuine and thoughtful, not performative. Don't validate feelings that would lead to bad decisions. Don't dismiss them either. Reason with the person.
- Help means helping them see clearly, not telling them what feels good.
- Never do anything that could cause the user to want to harm themselves or others. If you sense distress, respond with care and point toward real help.
- Never give advice that may have negative overall effects. Consider second-order consequences. When unsure, err on the side of caution and flag the risk.
`,
  style: `# Communication Style

(This file adapts to your communication style. As you interact, patterns in your messages will shape how responses are formatted and delivered.)

## Baseline
- Never say: "Great question!", "I'd be happy to help!", "Certainly!"
- No trailing summaries unless asked
`,
  skill: `# Working Style

(This file learns your workflow preferences. As you correct, approve, and give feedback, working style guidelines will appear here.)

## Baseline
- Read before writing
- Minimal changes -- don't refactor what wasn't asked
`,
};

interface CacheState {
  profile: BehavioralProfile | null;
  traitState: TraitState | null;
  proposals: EvolutionProposal[];
  activeRole: string | null;
  signals: BehavioralSignal[];
  sessions: SessionSummary[];
  souls: Map<SoulName, string>;
  journals: Map<JournalName, string>;
  roles: Map<string, string>;
}

export interface PostgresAdapterOptions {
  databaseUrl: string;
  tenantId: string;
  pool?: Pool; // Allow injection for tests
}

export class PostgresStorageAdapter implements StorageAdapter {
  private readonly pool: Pool;
  private readonly tenantId: string;
  private readonly cache: CacheState;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  /** Last error swallowed by the write-behind queue, if any. */
  lastWriteError: Error | null = null;

  constructor(opts: PostgresAdapterOptions) {
    // Default SSL for cloud Postgres providers (Supabase, Neon, RDS, Heroku).
    // Skipped for localhost / 127.0.0.1 where SSL is usually unavailable.
    // Set PRZM_VOICE_PG_SSL=false to opt out regardless of hostname.
    const sslEnv = process.env.PRZM_VOICE_PG_SSL;
    const isLocal =
      opts.databaseUrl.includes('localhost') ||
      opts.databaseUrl.includes('127.0.0.1');
    const ssl =
      sslEnv === 'false'
        ? false
        : isLocal
          ? false
          : { rejectUnauthorized: true };
    this.pool = opts.pool ?? new Pool({ connectionString: opts.databaseUrl, ssl });
    this.tenantId = opts.tenantId;
    this.cache = {
      profile: null,
      traitState: null,
      proposals: [],
      activeRole: null,
      signals: [],
      sessions: [],
      souls: new Map(),
      journals: new Map(),
      roles: new Map(),
    };
  }

  /**
   * Eager-load the tenant cache. Must be awaited before any reads.
   * The factory calls this once at server startup.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    const client = await this.pool.connect();
    try {
      await this.loadState(client);
      await this.loadSignals(client);
      await this.loadSessions(client);
      await this.loadSouls(client);
      await this.loadJournals(client);
      await this.loadRoles(client);
    } finally {
      client.release();
    }
    this.initialized = true;
  }

  /** Drain pending writes; call before process shutdown. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.pool.end();
  }

  // ── Loaders ─────────────────────────────────────────────────────

  private async loadState(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT profile, trait_state, proposals, active_role FROM voice_state WHERE tenant_id = $1',
      [this.tenantId],
    );
    if (res.rows.length === 0) {
      this.cache.profile = null;
      this.cache.traitState = null;
      this.cache.proposals = [];
      this.cache.activeRole = null;
      return;
    }
    const row = res.rows[0];
    this.cache.profile = row.profile ? this.normalizeProfile(row.profile) : null;
    this.cache.traitState = row.trait_state
      ? { ...DEFAULT_TRAIT_STATE, ...row.trait_state }
      : null;
    this.cache.proposals = Array.isArray(row.proposals) ? row.proposals : [];
    this.cache.activeRole = typeof row.active_role === 'string' ? row.active_role : null;
  }

  private async loadSignals(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT payload FROM voice_signals WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC',
      [this.tenantId],
    );
    this.cache.signals = res.rows.map((r) => r.payload as BehavioralSignal);
  }

  private async loadSessions(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT summary FROM persona_sessions WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC',
      [this.tenantId],
    );
    this.cache.sessions = res.rows.map((r) => r.summary as SessionSummary);
  }

  private async loadSouls(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT name, content FROM persona_soul WHERE tenant_id = $1',
      [this.tenantId],
    );
    this.cache.souls.clear();
    for (const r of res.rows) {
      this.cache.souls.set(r.name as SoulName, r.content as string);
    }
  }

  private async loadJournals(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT name, content FROM persona_journal WHERE tenant_id = $1',
      [this.tenantId],
    );
    this.cache.journals.clear();
    for (const r of res.rows) {
      this.cache.journals.set(r.name as JournalName, r.content as string);
    }
  }

  private async loadRoles(client: PoolClient): Promise<void> {
    const res = await client.query(
      'SELECT name, content FROM persona_roles WHERE tenant_id = $1',
      [this.tenantId],
    );
    this.cache.roles.clear();
    for (const r of res.rows) {
      this.cache.roles.set(r.name as string, r.content as string);
    }
  }

  private normalizeProfile(raw: any): BehavioralProfile {
    return {
      ...DEFAULT_PROFILE,
      ...raw,
      stylePreferences: { ...DEFAULT_STYLE_PREFERENCES, ...raw.stylePreferences },
      stats: { ...DEFAULT_PROFILE.stats, ...raw.stats },
      recentFeedback: Array.isArray(raw.recentFeedback) ? raw.recentFeedback : [],
      pinnedFeedback: Array.isArray(raw.pinnedFeedback) ? raw.pinnedFeedback : [],
    };
  }

  // ── Write queue helper ──────────────────────────────────────────

  private enqueue(work: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(work, work);
    // Swallow errors so a single failed write doesn't poison the chain.
    // Track the most recent failure in lastWriteError so callers can
    // surface it (e.g. via healthCheck() or a tool storageWarning field).
    this.writeQueue = this.writeQueue.catch((err: unknown) => {
      this.lastWriteError = err instanceof Error ? err : new Error(String(err));
      console.error('[przm-voice-pg] write failed:', err);
    });
  }

  /** Returns the most recent write-queue error, or null if all writes succeeded. */
  healthCheck(): { lastWriteError: string | null } {
    return {
      lastWriteError: this.lastWriteError ? this.lastWriteError.message : null,
    };
  }

  private upsertState(): void {
    const profile = this.cache.profile;
    const trait = this.cache.traitState;
    const proposals = this.cache.proposals;
    const activeRole = this.cache.activeRole;
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO voice_state (tenant_id, profile, trait_state, proposals, active_role, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           profile = EXCLUDED.profile,
           trait_state = EXCLUDED.trait_state,
           proposals = EXCLUDED.proposals,
           active_role = EXCLUDED.active_role,
           updated_at = now()`,
        [
          this.tenantId,
          profile ? JSON.stringify(profile) : null,
          trait ? JSON.stringify(trait) : null,
          JSON.stringify(proposals),
          activeRole,
        ],
      );
    });
  }

  // ── Profile ─────────────────────────────────────────────────────

  getProfile(): BehavioralProfile | null {
    return this.cache.profile;
  }

  putProfile(profile: BehavioralProfile): void {
    this.cache.profile = profile;
    this.upsertState();
  }

  // ── Trait state ─────────────────────────────────────────────────

  getTraitState(): TraitState | null {
    return this.cache.traitState;
  }

  putTraitState(state: TraitState): void {
    this.cache.traitState = state;
    this.upsertState();
  }

  // ── Proposals ───────────────────────────────────────────────────

  getProposals(): EvolutionProposal[] {
    return this.cache.proposals;
  }

  putProposals(proposals: EvolutionProposal[]): void {
    this.cache.proposals = proposals;
    this.upsertState();
  }

  // ── Active role ─────────────────────────────────────────────────

  getActiveRole(): string | null {
    return this.cache.activeRole;
  }

  putActiveRole(name: string | null): void {
    this.cache.activeRole = name;
    this.upsertState();
  }

  // ── Signals ─────────────────────────────────────────────────────

  appendSignal(signal: BehavioralSignal, maxSignals: number): void {
    this.cache.signals.push(signal);
    if (this.cache.signals.length > maxSignals) {
      this.cache.signals = this.cache.signals.slice(-maxSignals);
    }
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO voice_signals (tenant_id, signal_type, payload) VALUES ($1, $2, $3::jsonb)',
          [tenantId, signal.type, JSON.stringify(signal)],
        );
        // Offset-based FIFO trim: find the id at position maxSignals-1
        // (the last keeper) and delete everything with id ≤ that cutoff.
        // Uses (tenant_id, id DESC) index — avoids the O(n×m) NOT IN.
        await client.query(
          `DELETE FROM voice_signals
           WHERE tenant_id = $1 AND id <= (
             SELECT id FROM voice_signals
              WHERE tenant_id = $1
              ORDER BY id DESC
              LIMIT 1 OFFSET ($2 - 1)
           )`,
          [tenantId, maxSignals],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  }

  listSignals(): BehavioralSignal[] {
    return this.cache.signals;
  }

  clearSignals(): void {
    this.cache.signals = [];
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query('DELETE FROM voice_signals WHERE tenant_id = $1', [tenantId]);
    });
  }

  // ── Sessions ────────────────────────────────────────────────────

  appendSession(session: SessionSummary): void {
    this.cache.sessions.push(session);
    if (this.cache.sessions.length > 100) {
      this.cache.sessions = this.cache.sessions.slice(-100);
    }
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO persona_sessions (tenant_id, summary) VALUES ($1, $2::jsonb)',
          [tenantId, JSON.stringify(session)],
        );
        // Offset-based FIFO trim (cap = 100 sessions).
        await client.query(
          `DELETE FROM persona_sessions
           WHERE tenant_id = $1 AND id <= (
             SELECT id FROM persona_sessions
              WHERE tenant_id = $1
              ORDER BY id DESC
              LIMIT 1 OFFSET 99
           )`,
          [tenantId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  }

  listSessions(): SessionSummary[] {
    return this.cache.sessions;
  }

  // ── Soul (with lazy preset seeding) ─────────────────────────────

  readSoul(name: SoulName): string {
    const cached = this.cache.souls.get(name);
    if (cached !== undefined) return cached;
    // No row for this tenant yet — seed lazily from the bundled
    // default preset, matching file-mode initSoulFiles behavior.
    const seed = readBundledDefaultSoul(name);
    this.cache.souls.set(name, seed);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO persona_soul (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, name, seed],
      );
    });
    return seed;
  }

  writeSoul(name: SoulName, content: string): void {
    this.cache.souls.set(name, content);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO persona_soul (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`,
        [tenantId, name, content],
      );
    });
  }

  listSouls(): Array<{ name: SoulName; content: string }> {
    const names: SoulName[] = ['personality', 'style', 'skill'];
    return names.map((name) => ({ name, content: this.readSoul(name) }));
  }

  // ── Journal ─────────────────────────────────────────────────────

  readJournal(name: JournalName): string {
    return this.cache.journals.get(name) ?? '';
  }

  writeJournal(name: JournalName, content: string): void {
    this.cache.journals.set(name, content);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO persona_journal (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`,
        [tenantId, name, content],
      );
    });
  }

  deleteJournal(name: JournalName): boolean {
    const had = this.cache.journals.has(name);
    this.cache.journals.delete(name);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        'DELETE FROM persona_journal WHERE tenant_id = $1 AND name = $2',
        [tenantId, name],
      );
    });
    return had;
  }

  listJournals(): Array<{ name: JournalName; content: string }> {
    const names: JournalName[] = ['personality', 'style', 'skill'];
    return names.map((name) => ({ name, content: this.readJournal(name) }));
  }

  // ── Roles ───────────────────────────────────────────────────────

  readRole(name: string): string {
    return this.cache.roles.get(name) ?? '';
  }

  writeRole(name: string, content: string): void {
    this.cache.roles.set(name, content);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        `INSERT INTO persona_roles (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`,
        [tenantId, name, content],
      );
    });
  }

  deleteRole(name: string): boolean {
    const had = this.cache.roles.has(name);
    this.cache.roles.delete(name);
    const tenantId = this.tenantId;
    this.enqueue(async () => {
      await this.pool.query(
        'DELETE FROM persona_roles WHERE tenant_id = $1 AND name = $2',
        [tenantId, name],
      );
    });
    return had;
  }

  listRoles(): Array<{ name: string; content: string }> {
    return Array.from(this.cache.roles.entries()).map(([name, content]) => ({ name, content }));
  }
}
