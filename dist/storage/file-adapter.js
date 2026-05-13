import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEFAULT_PROFILE, DEFAULT_STYLE_PREFERENCES, DEFAULT_TRAIT_STATE, } from '../types.js';
/**
 * File-backed adapter. Preserves the historical layout under dataDir
 * exactly: same filenames, same JSON shapes, same markdown content.
 * Behavior must be byte-identical to the pre-refactor server in this
 * mode so existing user data continues to work unmodified.
 */
const SOUL_FILE_NAMES = {
    personality: 'PERSONALITY.md',
    style: 'STYLE.md',
    skill: 'SKILL.md',
};
const JOURNAL_FILE_NAMES = {
    personality: 'personality.md',
    style: 'style.md',
    skill: 'skill.md',
};
function ensureDir(path) {
    if (!existsSync(path))
        mkdirSync(path, { recursive: true });
}
function readJson(path) {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeJson(path, data) {
    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}
export class FileStorageAdapter {
    dataDir;
    constructor(opts) {
        this.dataDir = opts.dataDir;
    }
    // ── Path helpers ────────────────────────────────────────────────
    profilePath() {
        return join(this.dataDir, 'profile.json');
    }
    traitStatePath() {
        return join(this.dataDir, 'trait-state.json');
    }
    proposalsPath() {
        return join(this.dataDir, 'proposals.json');
    }
    activeRolePath() {
        return join(this.dataDir, 'active-role.json');
    }
    signalsPath() {
        return join(this.dataDir, 'signals.json');
    }
    sessionHistoryPath() {
        return join(this.dataDir, 'session-history.json');
    }
    soulPath(name) {
        return join(this.dataDir, 'soul', SOUL_FILE_NAMES[name]);
    }
    journalPath(name) {
        return join(this.dataDir, 'journal', JOURNAL_FILE_NAMES[name]);
    }
    rolePath(name) {
        return join(this.dataDir, 'roles', name, 'ROLE.md');
    }
    rolesDir() {
        return join(this.dataDir, 'roles');
    }
    // ── Profile ─────────────────────────────────────────────────────
    getProfile() {
        const raw = readJson(this.profilePath());
        if (!raw)
            return null;
        // Normalize the same way loadProfile() did historically so callers
        // that round-trip through this method don't see undefined fields.
        return {
            ...DEFAULT_PROFILE,
            ...raw,
            stylePreferences: { ...DEFAULT_STYLE_PREFERENCES, ...raw.stylePreferences },
            stats: { ...DEFAULT_PROFILE.stats, ...raw.stats },
            recentFeedback: Array.isArray(raw.recentFeedback) ? raw.recentFeedback : [],
            pinnedFeedback: Array.isArray(raw.pinnedFeedback) ? raw.pinnedFeedback : [],
        };
    }
    putProfile(profile) {
        writeJson(this.profilePath(), profile);
    }
    // ── Trait state ─────────────────────────────────────────────────
    getTraitState() {
        const raw = readJson(this.traitStatePath());
        if (!raw)
            return null;
        return { ...DEFAULT_TRAIT_STATE, ...raw };
    }
    putTraitState(state) {
        writeJson(this.traitStatePath(), state);
    }
    // ── Proposals ───────────────────────────────────────────────────
    getProposals() {
        return readJson(this.proposalsPath()) ?? [];
    }
    putProposals(proposals) {
        writeJson(this.proposalsPath(), proposals);
    }
    // ── Active role ─────────────────────────────────────────────────
    getActiveRole() {
        const raw = readJson(this.activeRolePath());
        if (!raw)
            return null;
        return typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null;
    }
    putActiveRole(name) {
        // Match the historical behavior: writing a null only writes the
        // file if it already exists; an absent file means "no role" and we
        // don't touch the dataDir tree just to record absence.
        const path = this.activeRolePath();
        if (name === null) {
            if (existsSync(path))
                writeFileSync(path, JSON.stringify({ name: null }), 'utf-8');
            return;
        }
        ensureDir(this.dataDir);
        writeFileSync(path, JSON.stringify({ name }), 'utf-8');
    }
    // ── Signals ─────────────────────────────────────────────────────
    appendSignal(signal, maxSignals) {
        const current = this.listSignals();
        current.push(signal);
        const bounded = current.slice(-maxSignals);
        writeJson(this.signalsPath(), bounded);
    }
    listSignals() {
        return readJson(this.signalsPath()) ?? [];
    }
    clearSignals() {
        if (existsSync(this.signalsPath()))
            writeJson(this.signalsPath(), []);
    }
    // ── Sessions ────────────────────────────────────────────────────
    appendSession(session) {
        const current = this.listSessions();
        current.push(session);
        const bounded = current.slice(-100);
        writeJson(this.sessionHistoryPath(), bounded);
    }
    listSessions() {
        return readJson(this.sessionHistoryPath()) ?? [];
    }
    // ── Soul ────────────────────────────────────────────────────────
    readSoul(name) {
        const path = this.soulPath(name);
        if (!existsSync(path))
            return '';
        return readFileSync(path, 'utf-8');
    }
    writeSoul(name, content) {
        const path = this.soulPath(name);
        ensureDir(dirname(path));
        writeFileSync(path, content, 'utf-8');
    }
    listSouls() {
        return Object.keys(SOUL_FILE_NAMES).map((name) => ({
            name,
            content: this.readSoul(name),
        }));
    }
    // ── Journal ─────────────────────────────────────────────────────
    readJournal(name) {
        const path = this.journalPath(name);
        if (!existsSync(path))
            return '';
        return readFileSync(path, 'utf-8');
    }
    writeJournal(name, content) {
        const path = this.journalPath(name);
        ensureDir(dirname(path));
        writeFileSync(path, content, 'utf-8');
    }
    deleteJournal(name) {
        const path = this.journalPath(name);
        if (!existsSync(path))
            return false;
        unlinkSync(path);
        return true;
    }
    listJournals() {
        return Object.keys(JOURNAL_FILE_NAMES).map((name) => ({
            name,
            content: this.readJournal(name),
        }));
    }
    // ── Roles ───────────────────────────────────────────────────────
    //
    // Only the per-tenant overrides live here. Bundled presets ship with
    // the package and are read directly from the presets/ directory by
    // the role module — that's a code-shipped resource, not state.
    readRole(name) {
        const path = this.rolePath(name);
        if (!existsSync(path))
            return '';
        return readFileSync(path, 'utf-8');
    }
    writeRole(name, content) {
        const dir = join(this.rolesDir(), name);
        ensureDir(dir);
        writeFileSync(join(dir, 'ROLE.md'), content, 'utf-8');
    }
    deleteRole(name) {
        const dir = join(this.rolesDir(), name);
        if (!existsSync(dir))
            return false;
        rmSync(dir, { recursive: true, force: true });
        return true;
    }
    listRoles() {
        const dir = this.rolesDir();
        if (!existsSync(dir))
            return [];
        const out = [];
        for (const entry of readdirSync(dir)) {
            const subPath = join(dir, entry);
            try {
                if (!statSync(subPath).isDirectory())
                    continue;
            }
            catch {
                continue;
            }
            const file = join(subPath, 'ROLE.md');
            if (existsSync(file)) {
                out.push({ name: entry, content: readFileSync(file, 'utf-8') });
            }
        }
        return out;
    }
}
//# sourceMappingURL=file-adapter.js.map