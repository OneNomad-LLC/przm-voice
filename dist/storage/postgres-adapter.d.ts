import { Pool } from 'pg';
import type { BehavioralProfile, BehavioralSignal, EvolutionProposal, TraitState } from '../types.js';
import type { JournalName, SessionSummary, SoulName, StorageAdapter } from './adapter.js';
export interface PostgresAdapterOptions {
    databaseUrl: string;
    tenantId: string;
    pool?: Pool;
}
export declare class PostgresStorageAdapter implements StorageAdapter {
    private readonly pool;
    private readonly tenantId;
    private readonly cache;
    private writeQueue;
    private initialized;
    /** Last error swallowed by the write-behind queue, if any. */
    lastWriteError: Error | null;
    constructor(opts: PostgresAdapterOptions);
    /**
     * Eager-load the tenant cache. Must be awaited before any reads.
     * The factory calls this once at server startup.
     */
    init(): Promise<void>;
    /** Drain pending writes; call before process shutdown. */
    flush(): Promise<void>;
    close(): Promise<void>;
    private loadState;
    private loadSignals;
    private loadSessions;
    private loadSouls;
    private loadJournals;
    private loadRoles;
    private normalizeProfile;
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
