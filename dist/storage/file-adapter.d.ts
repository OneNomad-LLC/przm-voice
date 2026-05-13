import type { BehavioralProfile, BehavioralSignal, EvolutionProposal, TraitState } from '../types.js';
import type { JournalName, SessionSummary, SoulName, StorageAdapter } from './adapter.js';
export interface FileAdapterOptions {
    dataDir: string;
}
export declare class FileStorageAdapter implements StorageAdapter {
    private readonly dataDir;
    constructor(opts: FileAdapterOptions);
    private profilePath;
    private traitStatePath;
    private proposalsPath;
    private activeRolePath;
    private signalsPath;
    private sessionHistoryPath;
    private soulPath;
    private journalPath;
    private rolePath;
    private rolesDir;
    getProfile(): BehavioralProfile | null;
    putProfile(profile: BehavioralProfile): void;
    getTraitState(): TraitState | null;
    putTraitState(state: TraitState): void;
    getProposals(): EvolutionProposal[];
    putProposals(proposals: EvolutionProposal[]): void;
    getActiveRole(): string | null;
    putActiveRole(name: string | null): void;
    appendSignal(signal: BehavioralSignal, maxSignals: number): void;
    listSignals(): BehavioralSignal[];
    clearSignals(): void;
    appendSession(session: SessionSummary): void;
    listSessions(): SessionSummary[];
    readSoul(name: SoulName): string;
    writeSoul(name: SoulName, content: string): void;
    listSouls(): Array<{
        name: SoulName;
        content: string;
    }>;
    readJournal(name: JournalName): string;
    writeJournal(name: JournalName, content: string): void;
    deleteJournal(name: JournalName): boolean;
    listJournals(): Array<{
        name: JournalName;
        content: string;
    }>;
    readRole(name: string): string;
    writeRole(name: string, content: string): void;
    deleteRole(name: string): boolean;
    listRoles(): Array<{
        name: string;
        content: string;
    }>;
}
