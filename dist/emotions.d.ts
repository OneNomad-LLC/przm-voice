import type { EmotionalTone, EmotionalAssociation, PersonaConfig, TraitState } from './types.js';
/**
 * Detect emotional tone from a single message.
 * Returns an 8-dimensional vector with scores 0-1 per emotion.
 */
export declare function detectEmotionalTone(message: string, recentMessages?: string[]): EmotionalTone;
interface MicroSignals {
    energyDrop: boolean;
    shouting: boolean;
    hedging: boolean;
    lexicalRegression: boolean;
    pronounShift: boolean;
}
export declare function detectMicroExpressions(message: string, recentMessages?: string[]): MicroSignals;
/**
 * Detect compound emotions (dyads) from the 8-dimensional tone vector.
 * Primary dyads are adjacent emotions on Plutchik's wheel.
 * Secondary dyads are two petals apart. Tertiary are three apart.
 *
 * Returns detected dyads with their intensity.
 */
export interface DetectedDyad {
    name: string;
    intensity: number;
    components: [keyof EmotionalTone, keyof EmotionalTone];
}
export declare function detectDyads(tone: EmotionalTone): DetectedDyad[];
/**
 * Collapse the 8-dim vector to a single valence score (-1 to 1).
 * Positive emotions push toward 1, negative toward -1.
 */
export declare function emotionalValence(tone: EmotionalTone): number;
/**
 * Collapse to arousal (0 to 1). High-activation emotions push up.
 */
export declare function emotionalArousal(tone: EmotionalTone): number;
export declare function loadTraitState(_config: PersonaConfig): TraitState;
export declare function saveTraitState(_config: PersonaConfig, state: TraitState): void;
/**
 * Update emotional associations for a topic.
 * Negative associations form fast (amygdala one-shot learning),
 * positive associations form slowly (needs repeated exposure).
 */
export declare function updateEmotionalAssociation(state: TraitState, topic: string, valence: number, arousal: number): void;
/**
 * Check if a topic has a negative emotional association.
 * Returns the association if found and negative, null otherwise.
 */
export declare function getEmotionalFlag(state: TraitState, topic: string): EmotionalAssociation | null;
export {};
