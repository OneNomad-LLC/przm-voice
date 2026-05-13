import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
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
 * File-backed adapter. Preserves the historical layout under dataDir
 * exactly: same filenames, same JSON shapes, same markdown content.
 * Behavior must be byte-identical to the pre-refactor server in this
 * mode so existing user data continues to work unmodified.
 */

const SOUL_FILE_NAMES: Record<SoulName, string> = {
  personality: 'PERSONALITY.md',
  style: 'STYLE.md',
  skill: 'SKILL.md',
};

const JOURNAL_FILE_NAMES: Record<JournalName, string> = {
  personality: 'personality.md',
  style: 'style.md',
  skill: 'skill.md',
};

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export interface FileAdapterOptions {
  dataDir: string;
}

export class FileStorageAdapter implements StorageAdapter {
  private readonly dataDir: string;

  constructor(opts: FileAdapterOptions) {
    this.dataDir = opts.dataDir;
  }

  // ── Path helpers ────────────────────────────────────────────────

  private profilePath(): string {
    return join(this.dataDir, 'profile.json');
  }
  private traitStatePath(): string {
    return join(this.dataDir, 'trait-state.json');
  }
  private proposalsPath(): string {
    return join(this.dataDir, 'proposals.json');
  }
  private activeRolePath(): string {
    return join(this.dataDir, 'active-role.json');
  }
  private signalsPath(): string {
    return join(this.dataDir, 'signals.json');
  }
  private sessionHistoryPath(): string {
    return join(this.dataDir, 'session-history.json');
  }
  private soulPath(name: SoulName): string {
    return join(this.dataDir, 'soul', SOUL_FILE_NAMES[name]);
  }
  private journalPath(name: JournalName): string {
    return join(this.dataDir, 'journal', JOURNAL_FILE_NAMES[name]);
  }
  private rolePath(name: string): string {
    return join(this.dataDir, 'roles', name, 'ROLE.md');
  }
  private rolesDir(): string {
    return join(this.dataDir, 'roles');
  }

  // ── Profile ─────────────────────────────────────────────────────

  getProfile(): BehavioralProfile | null {
    const raw = readJson<any>(this.profilePath());
    if (!raw) return null;
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

  putProfile(profile: BehavioralProfile): void {
    writeJson(this.profilePath(), profile);
  }

  // ── Trait state ─────────────────────────────────────────────────

  getTraitState(): TraitState | null {
    const raw = readJson<any>(this.traitStatePath());
    if (!raw) return null;
    return { ...DEFAULT_TRAIT_STATE, ...raw };
  }

  putTraitState(state: TraitState): void {
    writeJson(this.traitStatePath(), state);
  }

  // ── Proposals ───────────────────────────────────────────────────

  getProposals(): EvolutionProposal[] {
    return readJson<EvolutionProposal[]>(this.proposalsPath()) ?? [];
  }

  putProposals(proposals: EvolutionProposal[]): void {
    writeJson(this.proposalsPath(), proposals);
  }

  // ── Active role ─────────────────────────────────────────────────

  getActiveRole(): string | null {
    const raw = readJson<{ name?: string | null }>(this.activeRolePath());
    if (!raw) return null;
    return typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null;
  }

  putActiveRole(name: string | null): void {
    // Match the historical behavior: writing a null only writes the
    // file if it already exists; an absent file means "no role" and we
    // don't touch the dataDir tree just to record absence.
    const path = this.activeRolePath();
    if (name === null) {
      if (existsSync(path)) writeFileSync(path, JSON.stringify({ name: null }), 'utf-8');
      return;
    }
    ensureDir(this.dataDir);
    writeFileSync(path, JSON.stringify({ name }), 'utf-8');
  }

  // ── Signals ─────────────────────────────────────────────────────

  appendSignal(signal: BehavioralSignal, maxSignals: number): void {
    const current = this.listSignals();
    current.push(signal);
    const bounded = current.slice(-maxSignals);
    writeJson(this.signalsPath(), bounded);
  }

  listSignals(): BehavioralSignal[] {
    return readJson<BehavioralSignal[]>(this.signalsPath()) ?? [];
  }

  clearSignals(): void {
    if (existsSync(this.signalsPath())) writeJson(this.signalsPath(), []);
  }

  // ── Sessions ────────────────────────────────────────────────────

  appendSession(session: SessionSummary): void {
    const current = this.listSessions();
    current.push(session);
    const bounded = current.slice(-100);
    writeJson(this.sessionHistoryPath(), bounded);
  }

  listSessions(): SessionSummary[] {
    return readJson<SessionSummary[]>(this.sessionHistoryPath()) ?? [];
  }

  // ── Soul ────────────────────────────────────────────────────────

  readSoul(name: SoulName): string {
    const path = this.soulPath(name);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  }

  writeSoul(name: SoulName, content: string): void {
    const path = this.soulPath(name);
    ensureDir(dirname(path));
    writeFileSync(path, content, 'utf-8');
  }

  listSouls(): Array<{ name: SoulName; content: string }> {
    return (Object.keys(SOUL_FILE_NAMES) as SoulName[]).map((name) => ({
      name,
      content: this.readSoul(name),
    }));
  }

  // ── Journal ─────────────────────────────────────────────────────

  readJournal(name: JournalName): string {
    const path = this.journalPath(name);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  }

  writeJournal(name: JournalName, content: string): void {
    const path = this.journalPath(name);
    ensureDir(dirname(path));
    writeFileSync(path, content, 'utf-8');
  }

  deleteJournal(name: JournalName): boolean {
    const path = this.journalPath(name);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  listJournals(): Array<{ name: JournalName; content: string }> {
    return (Object.keys(JOURNAL_FILE_NAMES) as JournalName[]).map((name) => ({
      name,
      content: this.readJournal(name),
    }));
  }

  // ── Roles ───────────────────────────────────────────────────────
  //
  // Only the per-tenant overrides live here. Bundled presets ship with
  // the package and are read directly from the presets/ directory by
  // the role module — that's a code-shipped resource, not state.

  readRole(name: string): string {
    const path = this.rolePath(name);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf-8');
  }

  writeRole(name: string, content: string): void {
    const dir = join(this.rolesDir(), name);
    ensureDir(dir);
    writeFileSync(join(dir, 'ROLE.md'), content, 'utf-8');
  }

  deleteRole(name: string): boolean {
    const dir = join(this.rolesDir(), name);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  listRoles(): Array<{ name: string; content: string }> {
    const dir = this.rolesDir();
    if (!existsSync(dir)) return [];
    const out: Array<{ name: string; content: string }> = [];
    for (const entry of readdirSync(dir)) {
      const subPath = join(dir, entry);
      try {
        if (!statSync(subPath).isDirectory()) continue;
      } catch {
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
