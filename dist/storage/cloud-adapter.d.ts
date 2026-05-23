import type { BehavioralProfile, BehavioralSignal, EvolutionProposal, TraitState } from '../types.js';
import type { JournalName, SessionSummary, SoulName, StorageAdapter } from './adapter.js';
export interface CloudAdapterOptions {
    apiUrl: string;
    apiKey: string;
    fetch?: typeof fetch;
}
export declare class CloudStorageAdapter implements StorageAdapter {
    private readonly apiUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly cache;
    private writeQueue;
    private initialized;
    /** Most recent write-queue error, if any. */
    lastWriteError: Error | null;
    constructor(opts: CloudAdapterOptions);
    init(): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
    private url;
    private headers;
    private request;
    private loadState;
    private enqueue;
    /** Returns the most recent write-queue error, or null if all writes succeeded. */
    healthCheck(): {
        lastWriteError: string | null;
    };
    private upsertState;
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
