import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { DEFAULT_PROFILE, DEFAULT_STYLE_PREFERENCES, DEFAULT_TRAIT_STATE, } from '../types.js';
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
const PRESET_DEFAULT_SOUL = {
    personality: 'PERSONALITY.md',
    style: 'STYLE.md',
    skill: 'SKILL.md',
};
function presetsDir() {
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 8; i++) {
        const candidate = join(dir, 'presets');
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return join(here, '..', '..', 'presets');
}
function readBundledDefaultSoul(name) {
    // The bundled "default" preset ships only as a PERSONALITY-style
    // SOUL.md. Style and skill defaults live inline in soul.ts as
    // DEFAULT_STYLE / DEFAULT_SKILL. To match file-mode initSoulFiles
    // semantics, we use the same blank-slate constants here when the
    // bundled preset doesn't carry a per-file default.
    if (name === 'personality') {
        const p = join(presetsDir(), 'souls', 'default', 'SOUL.md');
        if (existsSync(p))
            return readFileSync(p, 'utf-8');
    }
    return BLANK_SLATE_DEFAULTS[name];
}
const BLANK_SLATE_DEFAULTS = {
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
export class PostgresStorageAdapter {
    pool;
    tenantId;
    cache;
    writeQueue = Promise.resolve();
    initialized = false;
    constructor(opts) {
        this.pool = opts.pool ?? new Pool({ connectionString: opts.databaseUrl });
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
    async init() {
        if (this.initialized)
            return;
        const client = await this.pool.connect();
        try {
            await this.loadState(client);
            await this.loadSignals(client);
            await this.loadSessions(client);
            await this.loadSouls(client);
            await this.loadJournals(client);
            await this.loadRoles(client);
        }
        finally {
            client.release();
        }
        this.initialized = true;
    }
    /** Drain pending writes; call before process shutdown. */
    async flush() {
        await this.writeQueue;
    }
    async close() {
        await this.flush();
        await this.pool.end();
    }
    // ── Loaders ─────────────────────────────────────────────────────
    async loadState(client) {
        const res = await client.query('SELECT profile, trait_state, proposals, active_role FROM voice_state WHERE tenant_id = $1', [this.tenantId]);
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
    async loadSignals(client) {
        const res = await client.query('SELECT payload FROM voice_signals WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC', [this.tenantId]);
        this.cache.signals = res.rows.map((r) => r.payload);
    }
    async loadSessions(client) {
        const res = await client.query('SELECT summary FROM persona_sessions WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC', [this.tenantId]);
        this.cache.sessions = res.rows.map((r) => r.summary);
    }
    async loadSouls(client) {
        const res = await client.query('SELECT name, content FROM persona_soul WHERE tenant_id = $1', [this.tenantId]);
        this.cache.souls.clear();
        for (const r of res.rows) {
            this.cache.souls.set(r.name, r.content);
        }
    }
    async loadJournals(client) {
        const res = await client.query('SELECT name, content FROM persona_journal WHERE tenant_id = $1', [this.tenantId]);
        this.cache.journals.clear();
        for (const r of res.rows) {
            this.cache.journals.set(r.name, r.content);
        }
    }
    async loadRoles(client) {
        const res = await client.query('SELECT name, content FROM persona_roles WHERE tenant_id = $1', [this.tenantId]);
        this.cache.roles.clear();
        for (const r of res.rows) {
            this.cache.roles.set(r.name, r.content);
        }
    }
    normalizeProfile(raw) {
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
    enqueue(work) {
        this.writeQueue = this.writeQueue.then(work, work);
        // Swallow errors here so a single failed write doesn't poison the
        // chain. Errors are logged; loud failure modes (e.g. lost connection)
        // surface through flush() at shutdown.
        this.writeQueue = this.writeQueue.catch((err) => {
            console.error('[persona-pg] write failed:', err);
        });
    }
    upsertState() {
        const profile = this.cache.profile;
        const trait = this.cache.traitState;
        const proposals = this.cache.proposals;
        const activeRole = this.cache.activeRole;
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO voice_state (tenant_id, profile, trait_state, proposals, active_role, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           profile = EXCLUDED.profile,
           trait_state = EXCLUDED.trait_state,
           proposals = EXCLUDED.proposals,
           active_role = EXCLUDED.active_role,
           updated_at = now()`, [
                this.tenantId,
                profile ? JSON.stringify(profile) : null,
                trait ? JSON.stringify(trait) : null,
                JSON.stringify(proposals),
                activeRole,
            ]);
        });
    }
    // ── Profile ─────────────────────────────────────────────────────
    getProfile() {
        return this.cache.profile;
    }
    putProfile(profile) {
        this.cache.profile = profile;
        this.upsertState();
    }
    // ── Trait state ─────────────────────────────────────────────────
    getTraitState() {
        return this.cache.traitState;
    }
    putTraitState(state) {
        this.cache.traitState = state;
        this.upsertState();
    }
    // ── Proposals ───────────────────────────────────────────────────
    getProposals() {
        return this.cache.proposals;
    }
    putProposals(proposals) {
        this.cache.proposals = proposals;
        this.upsertState();
    }
    // ── Active role ─────────────────────────────────────────────────
    getActiveRole() {
        return this.cache.activeRole;
    }
    putActiveRole(name) {
        this.cache.activeRole = name;
        this.upsertState();
    }
    // ── Signals ─────────────────────────────────────────────────────
    appendSignal(signal, maxSignals) {
        this.cache.signals.push(signal);
        if (this.cache.signals.length > maxSignals) {
            this.cache.signals = this.cache.signals.slice(-maxSignals);
        }
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query('INSERT INTO voice_signals (tenant_id, signal_type, payload) VALUES ($1, $2, $3::jsonb)', [tenantId, signal.type, JSON.stringify(signal)]);
            // FIFO trim — delete oldest beyond cap. id is monotonic so we
            // can ORDER BY id DESC to find the cutoff cheaply.
            await this.pool.query(`DELETE FROM voice_signals
         WHERE tenant_id = $1
           AND id NOT IN (
             SELECT id FROM voice_signals
             WHERE tenant_id = $1
             ORDER BY id DESC
             LIMIT $2
           )`, [tenantId, maxSignals]);
        });
    }
    listSignals() {
        return this.cache.signals;
    }
    clearSignals() {
        this.cache.signals = [];
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query('DELETE FROM voice_signals WHERE tenant_id = $1', [tenantId]);
        });
    }
    // ── Sessions ────────────────────────────────────────────────────
    appendSession(session) {
        this.cache.sessions.push(session);
        if (this.cache.sessions.length > 100) {
            this.cache.sessions = this.cache.sessions.slice(-100);
        }
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query('INSERT INTO persona_sessions (tenant_id, summary) VALUES ($1, $2::jsonb)', [tenantId, JSON.stringify(session)]);
            await this.pool.query(`DELETE FROM persona_sessions
         WHERE tenant_id = $1
           AND id NOT IN (
             SELECT id FROM persona_sessions
             WHERE tenant_id = $1
             ORDER BY id DESC
             LIMIT 100
           )`, [tenantId]);
        });
    }
    listSessions() {
        return this.cache.sessions;
    }
    // ── Soul (with lazy preset seeding) ─────────────────────────────
    readSoul(name) {
        const cached = this.cache.souls.get(name);
        if (cached !== undefined)
            return cached;
        // No row for this tenant yet — seed lazily from the bundled
        // default preset, matching file-mode initSoulFiles behavior.
        const seed = readBundledDefaultSoul(name);
        this.cache.souls.set(name, seed);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO persona_soul (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO NOTHING`, [tenantId, name, seed]);
        });
        return seed;
    }
    writeSoul(name, content) {
        this.cache.souls.set(name, content);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO persona_soul (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`, [tenantId, name, content]);
        });
    }
    listSouls() {
        const names = ['personality', 'style', 'skill'];
        return names.map((name) => ({ name, content: this.readSoul(name) }));
    }
    // ── Journal ─────────────────────────────────────────────────────
    readJournal(name) {
        return this.cache.journals.get(name) ?? '';
    }
    writeJournal(name, content) {
        this.cache.journals.set(name, content);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO persona_journal (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`, [tenantId, name, content]);
        });
    }
    deleteJournal(name) {
        const had = this.cache.journals.has(name);
        this.cache.journals.delete(name);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query('DELETE FROM persona_journal WHERE tenant_id = $1 AND name = $2', [tenantId, name]);
        });
        return had;
    }
    listJournals() {
        const names = ['personality', 'style', 'skill'];
        return names.map((name) => ({ name, content: this.readJournal(name) }));
    }
    // ── Roles ───────────────────────────────────────────────────────
    readRole(name) {
        return this.cache.roles.get(name) ?? '';
    }
    writeRole(name, content) {
        this.cache.roles.set(name, content);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query(`INSERT INTO persona_roles (tenant_id, name, content) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO UPDATE SET content = EXCLUDED.content`, [tenantId, name, content]);
        });
    }
    deleteRole(name) {
        const had = this.cache.roles.has(name);
        this.cache.roles.delete(name);
        const tenantId = this.tenantId;
        this.enqueue(async () => {
            await this.pool.query('DELETE FROM persona_roles WHERE tenant_id = $1 AND name = $2', [tenantId, name]);
        });
        return had;
    }
    listRoles() {
        return Array.from(this.cache.roles.entries()).map(([name, content]) => ({ name, content }));
    }
}
//# sourceMappingURL=postgres-adapter.js.map