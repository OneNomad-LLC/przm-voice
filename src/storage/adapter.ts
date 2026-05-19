import type {
  BehavioralProfile,
  BehavioralSignal,
  EvolutionProposal,
  SoulFiles,
  TraitState,
} from '../types.js';

/**
 * Storage adapter — pluggable backend for all persistent przm Voice state.
 *
 * File mode keeps the historical on-disk layout under PERSONA_DATA_DIR.
 * Postgres mode scopes every read and write by tenantId so a single
 * database can serve many users.
 *
 * The bundled presets directory (`presets/souls`, `presets/roles`) is
 * shipped with the package and read directly off the filesystem in both
 * modes. Only mutable tenant state goes through this interface.
 *
 * The procedural bridge file at `~/.claude/procedural-bridge.json` is
 * deliberately out of scope: it is a host-local interop contract with
 * przm Memory and is not multi-tenant data.
 */

export interface SessionSummary {
  id: string;
  timestamp: string;
  messageCount: number;
  avgValence: number;
  avgArousal: number;
  dominantEmotion: string;
  styleSnapshot: {
    formality: number;
    energy: number;
    verbosity: number;
    humor: number;
    specificity: number;
  };
  signalCounts: Record<string, number>;
}

export type SoulName = keyof SoulFiles;
export type JournalName = SoulName;

export interface StorageAdapter {
  // ── Profile ─────────────────────────────────────────────────────
  getProfile(): BehavioralProfile | null;
  putProfile(profile: BehavioralProfile): void;

  // ── Trait state ─────────────────────────────────────────────────
  getTraitState(): TraitState | null;
  putTraitState(state: TraitState): void;

  // ── Proposals ───────────────────────────────────────────────────
  getProposals(): EvolutionProposal[];
  putProposals(proposals: EvolutionProposal[]): void;

  // ── Active role ─────────────────────────────────────────────────
  getActiveRole(): string | null;
  putActiveRole(name: string | null): void;

  // ── Signals (FIFO bounded) ──────────────────────────────────────
  appendSignal(signal: BehavioralSignal, maxSignals: number): void;
  listSignals(): BehavioralSignal[];
  clearSignals(): void;

  // ── Sessions (FIFO bounded to 100) ──────────────────────────────
  appendSession(session: SessionSummary): void;
  listSessions(): SessionSummary[];

  // ── Soul (user-edited markdown) ─────────────────────────────────
  readSoul(name: SoulName): string;
  writeSoul(name: SoulName, content: string): void;
  listSouls(): Array<{ name: SoulName; content: string }>;

  // ── Journal (przm Voice-derived markdown) ───────────────────────
  readJournal(name: JournalName): string;
  writeJournal(name: JournalName, content: string): void;
  deleteJournal(name: JournalName): boolean;
  listJournals(): Array<{ name: JournalName; content: string }>;

  // ── Roles (custom user-defined; bundled presets read from disk
  // directly in both backends so package upgrades flow through) ──
  readRole(name: string): string;
  writeRole(name: string, content: string): void;
  listRoles(): Array<{ name: string; content: string }>;
  deleteRole(name: string): boolean;
}
