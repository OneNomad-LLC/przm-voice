import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE, DEFAULT_STYLE_PREFERENCES, DEFAULT_TRAIT_STATE, } from '../types.js';
/**
 * Cloud-backed adapter. Speaks the pyre-web HTTP contract.
 *
 * Single-tenant from the client's perspective: the api_key carries the
 * tenant binding on the server, so the adapter never plumbs a tenantId.
 *
 * pyre-web has shipped (as of 2026-05-12):
 *   POST   /api/auth/device-code           — login flow start
 *   POST   /api/auth/device-code/poll      — login flow poll
 *   POST   /api/persona/signals            — append signal
 *   GET    /api/persona/profile            — read profile/trait/proposals/role
 *   PUT    /api/persona/profile            — upsert profile/trait/proposals/role
 *
 * NOT yet shipped — adapter methods that touch these throw a clear
 * "endpoint not yet available" error so callers fail loud:
 *   GET    /api/persona/signals            — listSignals
 *   DELETE /api/persona/signals            — clearSignals
 *   GET    /api/persona/sessions           — listSessions
 *   POST   /api/persona/sessions           — appendSession
 *   GET    /api/persona/souls              — listSouls
 *   GET    /api/persona/souls/:name        — readSoul (server-customized)
 *   PUT    /api/persona/souls/:name        — writeSoul
 *   GET    /api/persona/journals           — listJournals
 *   GET    /api/persona/journals/:name     — readJournal
 *   PUT    /api/persona/journals/:name     — writeJournal
 *   DELETE /api/persona/journals/:name     — deleteJournal
 *   GET    /api/persona/roles              — listRoles
 *   GET    /api/persona/roles/:name        — readRole
 *   PUT    /api/persona/roles/:name        — writeRole
 *   DELETE /api/persona/roles/:name        — deleteRole
 *
 * Mirrors the postgres adapter's lazy-soul-seeding pattern: if the
 * server returns 404 for a default soul preset, fall back to the
 * bundled `presets/souls/default/SOUL.md` (or BLANK_SLATE_DEFAULTS for
 * style/skill) before failing.
 *
 * Caching model: same as postgres-adapter. The StorageAdapter interface
 * is synchronous, but HTTP is async — so the adapter holds an in-memory
 * cache that init() warms from the server, all reads serve from cache,
 * and writes update the cache synchronously while enqueuing a fetch.
 * flush() awaits the queue.
 */
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
    if (name === 'personality') {
        const p = join(presetsDir(), 'souls', 'default', 'SOUL.md');
        if (existsSync(p))
            return readFileSync(p, 'utf-8');
    }
    return BLANK_SLATE_DEFAULTS[name];
}
function normalizeProfile(raw) {
    return {
        ...DEFAULT_PROFILE,
        ...raw,
        stylePreferences: { ...DEFAULT_STYLE_PREFERENCES, ...(raw.stylePreferences ?? {}) },
        stats: { ...DEFAULT_PROFILE.stats, ...(raw.stats ?? {}) },
        recentFeedback: Array.isArray(raw.recentFeedback) ? raw.recentFeedback : [],
        pinnedFeedback: Array.isArray(raw.pinnedFeedback) ? raw.pinnedFeedback : [],
    };
}
function notImplemented(name, method, path) {
    throw new Error(`CloudStorageAdapter: pyre-web runtime endpoint for ${name} not yet available ` +
        `(needs ${method} ${path}). Run with STORAGE_BACKEND=file or wait for pyre-web to ship it.`);
}
export class CloudStorageAdapter {
    apiUrl;
    apiKey;
    fetchImpl;
    cache;
    writeQueue = Promise.resolve();
    initialized = false;
    constructor(opts) {
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
    async init() {
        if (this.initialized)
            return;
        await this.loadState();
        this.initialized = true;
    }
    async flush() {
        await this.writeQueue;
    }
    async close() {
        await this.flush();
    }
    // ── HTTP helpers ────────────────────────────────────────────────
    url(path) {
        return `${this.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }
    headers() {
        return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
    }
    async request(method, path, body) {
        const init = {
            method,
            headers: this.headers(),
        };
        if (body !== undefined)
            init.body = JSON.stringify(body);
        return await this.fetchImpl(this.url(path), init);
    }
    // ── Loaders ─────────────────────────────────────────────────────
    async loadState() {
        const res = await this.request('GET', '/api/persona/profile');
        if (!res.ok) {
            // 401/403 are configuration problems (bad key / missing scope) and
            // should fail loud; anything else we treat as transient and leave
            // the cache empty, matching the postgres adapter's behavior when
            // a tenant has no row yet.
            if (res.status === 401 || res.status === 403) {
                const text = await res.text().catch(() => '');
                throw new Error(`CloudStorageAdapter: ${res.status} from /api/persona/profile — ` +
                    `check PYRE credentials. Body: ${text.slice(0, 200)}`);
            }
            this.cache.profile = null;
            this.cache.traitState = null;
            this.cache.proposals = [];
            this.cache.activeRole = null;
            return;
        }
        const data = (await res.json());
        this.cache.profile =
            data.profile && typeof data.profile === 'object' && Object.keys(data.profile).length > 0
                ? normalizeProfile(data.profile)
                : null;
        this.cache.traitState =
            data.trait_state &&
                typeof data.trait_state === 'object' &&
                Object.keys(data.trait_state).length > 0
                ? { ...DEFAULT_TRAIT_STATE, ...data.trait_state }
                : null;
        this.cache.proposals = Array.isArray(data.proposals)
            ? data.proposals
            : [];
        this.cache.activeRole =
            typeof data.active_role === 'string' && data.active_role.length > 0
                ? data.active_role
                : null;
    }
    // ── Write queue helper ──────────────────────────────────────────
    enqueue(work) {
        this.writeQueue = this.writeQueue.then(work, work);
        this.writeQueue = this.writeQueue.catch((err) => {
            console.error('[persona-cloud] write failed:', err);
        });
    }
    upsertState() {
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
                throw new Error(`PUT /api/persona/profile returned ${res.status}: ${text.slice(0, 200)}`);
            }
        });
    }
    // ── Profile / Trait / Proposals / Role (all PUT /api/persona/profile) ──
    getProfile() {
        return this.cache.profile;
    }
    putProfile(profile) {
        this.cache.profile = profile;
        this.upsertState();
    }
    getTraitState() {
        return this.cache.traitState;
    }
    putTraitState(state) {
        this.cache.traitState = state;
        this.upsertState();
    }
    getProposals() {
        return this.cache.proposals;
    }
    putProposals(proposals) {
        this.cache.proposals = proposals;
        this.upsertState();
    }
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
        this.enqueue(async () => {
            const res = await this.request('POST', '/api/persona/signals', {
                signal_type: signal.type,
                payload: signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`POST /api/persona/signals returned ${res.status}: ${text.slice(0, 200)}`);
            }
        });
    }
    listSignals() {
        // Server has no list endpoint yet. The cache reflects everything
        // we've appended since init(); it's empty on a fresh process because
        // there's no way to pull history back from pyre-web. Callers in
        // signal-pattern analysis will see fewer signals than disk-mode
        // until the GET endpoint lands.
        return this.cache.signals;
    }
    clearSignals() {
        notImplemented('clearSignals', 'DELETE', '/api/persona/signals');
    }
    // ── Sessions ────────────────────────────────────────────────────
    appendSession(_session) {
        notImplemented('appendSession', 'POST', '/api/persona/sessions');
    }
    listSessions() {
        // Same shape as listSignals: serve the cache. Empty on cold start
        // until pyre-web ships GET /api/persona/sessions.
        return this.cache.sessions;
    }
    // ── Soul ────────────────────────────────────────────────────────
    readSoul(name) {
        const cached = this.cache.souls.get(name);
        if (cached !== undefined)
            return cached;
        // No row available. Until pyre-web ships GET /api/persona/souls/:name
        // we cannot ask the server for the tenant's customized version, so
        // we fall through to the bundled preset. The cache picks it up so
        // subsequent reads are stable within the process.
        const seed = readBundledDefaultSoul(name);
        this.cache.souls.set(name, seed);
        return seed;
    }
    writeSoul(_name, _content) {
        notImplemented('writeSoul', 'PUT', '/api/persona/souls/:name');
    }
    listSouls() {
        const names = ['personality', 'style', 'skill'];
        return names.map((name) => ({ name, content: this.readSoul(name) }));
    }
    // ── Journal ─────────────────────────────────────────────────────
    readJournal(name) {
        return this.cache.journals.get(name) ?? '';
    }
    writeJournal(_name, _content) {
        notImplemented('writeJournal', 'PUT', '/api/persona/journals/:name');
    }
    deleteJournal(_name) {
        notImplemented('deleteJournal', 'DELETE', '/api/persona/journals/:name');
    }
    listJournals() {
        const names = ['personality', 'style', 'skill'];
        return names.map((name) => ({ name, content: this.readJournal(name) }));
    }
    // ── Roles ───────────────────────────────────────────────────────
    readRole(name) {
        return this.cache.roles.get(name) ?? '';
    }
    writeRole(_name, _content) {
        notImplemented('writeRole', 'PUT', '/api/persona/roles/:name');
    }
    deleteRole(_name) {
        notImplemented('deleteRole', 'DELETE', '/api/persona/roles/:name');
    }
    listRoles() {
        return Array.from(this.cache.roles.entries()).map(([name, content]) => ({ name, content }));
    }
}
//# sourceMappingURL=cloud-adapter.js.map