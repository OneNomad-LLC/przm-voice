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
    constructor(opts: CloudAdapterOptions);
    init(): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
    private url;
    private headers;
    private request;
    private loadState;
    private enqueue;
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
    appendSession(_session: SessionSummary): void;
    listSessions(): SessionSummary[];
    readSoul(name: SoulName): string;
    writeSoul(_name: SoulName, _content: string): void;
    listSouls(): Array<{
        name: SoulName;
        content: string;
    }>;
    readJournal(name: JournalName): string;
    writeJournal(_name: JournalName, _content: string): void;
    deleteJournal(_name: JournalName): boolean;
    listJournals(): Array<{
        name: JournalName;
        content: string;
    }>;
    readRole(name: string): string;
    writeRole(_name: string, _content: string): void;
    deleteRole(_name: string): boolean;
    listRoles(): Array<{
        name: string;
        content: string;
    }>;
}
