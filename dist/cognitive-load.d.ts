import type { CognitiveLoadState } from './types.js';
/**
 * Update cognitive load state from a new message.
 * Returns updated state with flow/overload detection.
 */
export declare function updateCognitiveLoad(state: CognitiveLoadState, message: string, previousMessage?: string): CognitiveLoadState;
/**
 * Returns a short prompt fragment summarizing the current cognitive state
 * for injection into the system prompt. Returns '' for the neutral band
 * so we don't waste tokens. Designed to slot into the soul-assembler
 * near the voice block.
 */
export declare function describeLoadForPrompt(state: CognitiveLoadState): string;
/**
 * Get verbosity recommendation based on cognitive load.
 * Returns a multiplier: <1 means be more concise, >1 means can be verbose.
 */
export declare function getVerbosityMultiplier(state: CognitiveLoadState): number;
