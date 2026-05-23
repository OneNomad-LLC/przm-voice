import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
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
 * Cloud-backed adapter. Speaks the pyre-web HTTP contract.
 *
 * Single-tenant from the client's perspective: the api_key carries the
 * tenant binding on the server, so the adapter never plumbs a tenantId.
 *
 * pyre-web endpoints we consume (all shipped as of 2026-05-13):
 *   POST   /api/auth/device-code              — login flow start
 *   POST   /api/auth/device-code/poll         — login flow poll
 *   GET    /api/auth/whoami                   — identity probe
 *   POST   /api/persona/signals               — append signal
 *   GET    /api/persona/signals               — list recent signals
 *   DELETE /api/persona/signals               — clear buffer
 *   POST   /api/persona/sessions              — append session
 *   GET    /api/persona/sessions              — list recent sessions
 *   GET    /api/persona/profile               — read profile/trait/proposals/role
 *   PUT    /api/persona/profile               — upsert profile/trait/proposals/role
 *   GET    /api/persona/souls                 — list all souls for tenant
 *   GET    /api/persona/souls/:name           — read one soul (server-customized)
 *   PUT    /api/persona/souls/:name           — upsert one soul
 *   GET    /api/persona/journals              — list all journals
 *   PUT    /api/persona/journals              — bulk upsert journals
 *   DELETE /api/persona/journals              — clear all journals
 *   GET    /api/persona/journals/:name        — read one journal
 *   PUT    /api/persona/journals/:name        — upsert one journal
 *   DELETE /api/persona/journals/:name        — drop one journal
 *   GET    /api/persona/roles                 — list role overlays
 *   PUT    /api/persona/roles                 — bulk upsert role overlays
 *   DELETE /api/persona/roles                 — clear all roles
 *   GET    /api/persona/roles/:name           — read one role overlay
 *   PUT    /api/persona/roles/:name           — upsert one role overlay
 *   DELETE /api/persona/roles/:name           — drop one role overlay
 *
 * Caching model: same as postgres-adapter. The StorageAdapter interface
 * is synchronous, but HTTP is async — so the adapter holds an in-memory
 * cache that init() warms from the server, all reads serve from cache,
 * and writes update the cache synchronously while enqueuing a fetch.
 * flush() awaits the queue.
 *
 * Error envelope: pyre-web emits `{ "error": { "code", "message" } }` on
 * non-2xx. We parse it when available; otherwise fall back to the raw
 * response text.
 */

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
  if (name === 'personality') {
    const p = join(presetsDir(), 'souls', 'default', 'SOUL.md');
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return BLANK_SLATE_DEFAULTS[name];
}

function normalizeProfile(raw: any): BehavioralProfile {
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    stylePreferences: { ...DEFAULT_STYLE_PREFERENCES, ...(raw.stylePreferences ?? {}) },
    stats: { ...DEFAULT_PROFILE.stats, ...(raw.stats ?? {}) },
    recentFeedback: Array.isArray(raw.recentFeedback) ? raw.recentFeedback : [],
    pinnedFeedback: Array.isArray(raw.pinnedFeedback) ? raw.pinnedFeedback : [],
  };
}

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

export interface CloudAdapterOptions {
  apiUrl: string;
  apiKey: string;
  // Allow injection for tests.
  fetch?: typeof fetch;
}

async function errorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `${res.status} ${res.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.message) {
      return parsed.error.code
        ? `${parsed.error.code}: ${parsed.error.message}`
        : parsed.error.message;
    }
  } catch {
    /* fall through to raw text */
  }
  return text.slice(0, 200);
}

export class CloudStorageAdapter implements StorageAdapter {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: CacheState;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  /** Most recent write-queue error, if any. */
  lastWriteError: Error | null = null;

  constructor(opts: CloudAdapterOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
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

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadState();
    this.initialized = true;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
  }

  // ── HTTP helpers ────────────────────────────────────────────────

  private url(path: string): string {
    return `${this.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    // V-009: AbortController-backed timeout + bounded retry on 5xx.
    // A hung upstream used to stall the linear write-queue chain
    // indefinitely; a 10s budget plus a single retry keeps the chain
    // moving.
    const timeoutMs = Number(process.env.PRZM_VOICE_CLOUD_TIMEOUT_MS ?? 10_000);
    const maxAttempts = 2;

    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const init: RequestInit = {
        method,
        headers: this.headers(),
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      try {
        const res = await this.fetchImpl(this.url(path), init);
        clearTimeout(timer);
        // Retry once on 5xx; everything else (including 4xx) is returned
        // to the caller for normal handling.
        if (res.status >= 500 && res.status < 600 && attempt === 0) {
          await sleep(150 * (attempt + 1));
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt === 0) {
          await sleep(150);
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // ── Loaders ─────────────────────────────────────────────────────

  private async loadState(): Promise<void> {
    // Pull every collection in parallel. 401/403 from any of them is a
    // credentials problem and should fail loud; other failures leave the
    // cache empty for that collection.
    const [profileRes, signalsRes, sessionsRes, soulsRes, journalsRes, rolesRes] =
      await Promise.all([
        this.request('GET', '/api/persona/profile'),
        this.request('GET', '/api/persona/signals?limit=500'),
        this.request('GET', '/api/persona/sessions?limit=100'),
        this.request('GET', '/api/persona/souls'),
        this.request('GET', '/api/persona/journals'),
        this.request('GET', '/api/persona/roles'),
      ]);

    for (const res of [profileRes, signalsRes, sessionsRes, soulsRes, journalsRes, rolesRes]) {
      if (res.status === 401 || res.status === 403) {
        const msg = await errorBody(res);
        throw new Error(`CloudStorageAdapter: ${res.status} — check PYRE credentials. ${msg}`);
      }
    }

    // Profile (single row).
    if (profileRes.ok) {
      const data = (await profileRes.json()) as {
        profile?: unknown;
        trait_state?: unknown;
        proposals?: unknown;
        active_role?: unknown;
      };
      this.cache.profile =
        data.profile && typeof data.profile === 'object' && Object.keys(data.profile).length > 0
          ? normalizeProfile(data.profile)
          : null;
      this.cache.traitState =
        data.trait_state &&
        typeof data.trait_state === 'object' &&
        Object.keys(data.trait_state as object).length > 0
          ? { ...DEFAULT_TRAIT_STATE, ...(data.trait_state as object) }
          : null;
      this.cache.proposals = Array.isArray(data.proposals)
        ? (data.proposals as EvolutionProposal[])
        : [];
      this.cache.activeRole =
        typeof data.active_role === 'string' && data.active_role.length > 0
          ? data.active_role
          : null;
    } else {
      this.cache.profile = null;
      this.cache.traitState = null;
      this.cache.proposals = [];
      this.cache.activeRole = null;
    }

    // Signals.
    if (signalsRes.ok) {
      const data = (await signalsRes.json()) as { signals?: Array<{ payload?: unknown }> };
      // Server stores `payload` as the original signal object; unwrap it.
      this.cache.signals = Array.isArray(data.signals)
        ? data.signals
            .map((r) => r.payload)
            .filter((p): p is BehavioralSignal => !!p && typeof p === 'object')
            .reverse() // server returns newest-first; cache is chronological
        : [];
    }

    // Sessions.
    if (sessionsRes.ok) {
      const data = (await sessionsRes.json()) as { sessions?: Array<{ summary?: unknown }> };
      this.cache.sessions = Array.isArray(data.sessions)
        ? data.sessions
            .map((r) => r.summary)
            .filter((s): s is SessionSummary => !!s && typeof s === 'object')
            .reverse()
        : [];
    }

    // Souls (collection endpoint returns { items: [{ name, content }] }).
    if (soulsRes.ok) {
      const data = (await soulsRes.json()) as { items?: Array<{ name?: string; content?: string }> };
      this.cache.souls.clear();
      for (const entry of data.items ?? []) {
        if (entry.name && typeof entry.content === 'string') {
          this.cache.souls.set(entry.name as SoulName, entry.content);
        }
      }
    }

    // Journals.
    if (journalsRes.ok) {
      const data = (await journalsRes.json()) as { items?: Array<{ name?: string; content?: string }> };
      this.cache.journals.clear();
      for (const entry of data.items ?? []) {
        if (entry.name && typeof entry.content === 'string') {
          this.cache.journals.set(entry.name as JournalName, entry.content);
        }
      }
    }

    // Roles.
    if (rolesRes.ok) {
      const data = (await rolesRes.json()) as { items?: Array<{ name?: string; content?: string }> };
      this.cache.roles.clear();
      for (const entry of data.items ?? []) {
        if (entry.name && typeof entry.content === 'string') {
          this.cache.roles.set(entry.name, entry.content);
        }
      }
    }
  }

  // ── Write queue helper ──────────────────────────────────────────

  private enqueue(work: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(work, work);
    this.writeQueue = this.writeQueue.catch((err: unknown) => {
      this.lastWriteError = err instanceof Error ? err : new Error(String(err));
      console.error('[przm-voice-cloud] write failed:', err);
    });
  }

  /** Returns the most recent write-queue error, or null if all writes succeeded. */
  healthCheck(): { lastWriteError: string | null } {
    return {
      lastWriteError: this.lastWriteError ? this.lastWriteError.message : null,
    };
  }

  private upsertState(): void {
    const body = {
      profile: this.cache.profile,
      trait_state: this.cache.traitState,
      proposals: this.cache.proposals,
      active_role: this.cache.activeRole,
    };
    this.enqueue(async () => {
      const res = await this.request('PUT', '/api/persona/profile', body);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `PUT /api/persona/profile returned ${res.status}: ${text.slice(0, 200)}`,
        );
      }
    });
  }

  // ── Profile / Trait / Proposals / Role (all PUT /api/persona/profile) ──

  getProfile(): BehavioralProfile | null {
    return this.cache.profile;
  }

  putProfile(profile: BehavioralProfile): void {
    this.cache.profile = profile;
    this.upsertState();
  }

  getTraitState(): TraitState | null {
    return this.cache.traitState;
  }

  putTraitState(state: TraitState): void {
    this.cache.traitState = state;
    this.upsertState();
  }

  getProposals(): EvolutionProposal[] {
    return this.cache.proposals;
  }

  putProposals(proposals: EvolutionProposal[]): void {
    this.cache.proposals = proposals;
    this.upsertState();
  }

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
    this.enqueue(async () => {
      const res = await this.request('POST', '/api/persona/signals', {
        signal_type: signal.type,
        payload: signal,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`POST /api/persona/signals returned ${res.status}: ${msg}`);
      }
    });
  }

  listSignals(): BehavioralSignal[] {
    return this.cache.signals;
  }

  clearSignals(): void {
    this.cache.signals = [];
    this.enqueue(async () => {
      const res = await this.request('DELETE', '/api/persona/signals');
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`DELETE /api/persona/signals returned ${res.status}: ${msg}`);
      }
    });
  }

  // ── Sessions ────────────────────────────────────────────────────

  appendSession(session: SessionSummary): void {
    this.cache.sessions.push(session);
    // Match server-side FIFO trim at 100.
    if (this.cache.sessions.length > 100) {
      this.cache.sessions = this.cache.sessions.slice(-100);
    }
    this.enqueue(async () => {
      const res = await this.request('POST', '/api/persona/sessions', {
        summary: session,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`POST /api/persona/sessions returned ${res.status}: ${msg}`);
      }
    });
  }

  listSessions(): SessionSummary[] {
    return this.cache.sessions;
  }

  // ── Soul ────────────────────────────────────────────────────────

  readSoul(name: SoulName): string {
    const cached = this.cache.souls.get(name);
    if (cached !== undefined) return cached;
    // No row available on the server (this tenant never customized this
    // soul). Seed the cache from the bundled preset so subsequent reads
    // are stable, and write the seed to the server so file-mode parity
    // holds (file mode creates default files on first init).
    const seed = readBundledDefaultSoul(name);
    this.cache.souls.set(name, seed);
    this.enqueue(async () => {
      const res = await this.request('PUT', `/api/persona/souls/${encodeURIComponent(name)}`, {
        content: seed,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`PUT /api/persona/souls/${name} (seed) returned ${res.status}: ${msg}`);
      }
    });
    return seed;
  }

  writeSoul(name: SoulName, content: string): void {
    this.cache.souls.set(name, content);
    this.enqueue(async () => {
      const res = await this.request('PUT', `/api/persona/souls/${encodeURIComponent(name)}`, {
        content,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`PUT /api/persona/souls/${name} returned ${res.status}: ${msg}`);
      }
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
    this.enqueue(async () => {
      const res = await this.request('PUT', `/api/persona/journals/${encodeURIComponent(name)}`, {
        content,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`PUT /api/persona/journals/${name} returned ${res.status}: ${msg}`);
      }
    });
  }

  deleteJournal(name: JournalName): boolean {
    const existed = this.cache.journals.has(name);
    this.cache.journals.delete(name);
    this.enqueue(async () => {
      const res = await this.request('DELETE', `/api/persona/journals/${encodeURIComponent(name)}`);
      // 404 is fine — we already removed it locally.
      if (!res.ok && res.status !== 404) {
        const msg = await errorBody(res);
        throw new Error(`DELETE /api/persona/journals/${name} returned ${res.status}: ${msg}`);
      }
    });
    return existed;
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
    this.enqueue(async () => {
      const res = await this.request('PUT', `/api/persona/roles/${encodeURIComponent(name)}`, {
        content,
      });
      if (!res.ok) {
        const msg = await errorBody(res);
        throw new Error(`PUT /api/persona/roles/${name} returned ${res.status}: ${msg}`);
      }
    });
  }

  deleteRole(name: string): boolean {
    const existed = this.cache.roles.has(name);
    this.cache.roles.delete(name);
    this.enqueue(async () => {
      const res = await this.request('DELETE', `/api/persona/roles/${encodeURIComponent(name)}`);
      if (!res.ok && res.status !== 404) {
        const msg = await errorBody(res);
        throw new Error(`DELETE /api/persona/roles/${name} returned ${res.status}: ${msg}`);
      }
    });
    return existed;
  }

  listRoles(): Array<{ name: string; content: string }> {
    return Array.from(this.cache.roles.entries()).map(([name, content]) => ({ name, content }));
  }
}
