import type { EvolutionProposal, BehavioralSignal, PersonaConfig } from './types.js';
/**
 * Evolution engine -- proposes and applies personality changes
 * based on accumulated behavioral evidence.
 *
 * Proposals are generated heuristically from signal patterns.
 * Each proposal targets a specific soul file with a concrete edit
 * and a rationale backed by signal evidence.
 *
 * Storage: routed through the StorageAdapter. File mode preserves
 * dataDir/proposals.json exactly.
 */
export declare function loadProposals(_config: PersonaConfig): EvolutionProposal[];
/**
 * Generate evolution proposals from accumulated signals.
 * Uses heuristic pattern detection -- no LLM needed.
 */
export declare function generateProposals(config: PersonaConfig, signals: BehavioralSignal[]): EvolutionProposal[];
export declare function applyProposal(config: PersonaConfig, proposalId: string): {
    success: boolean;
    message: string;
};
export declare function rejectProposal(config: PersonaConfig, proposalId: string): {
    success: boolean;
    message: string;
};
