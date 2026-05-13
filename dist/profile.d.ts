import type { BehavioralProfile, BehavioralSignal, PersonaConfig } from './types.js';
/**
 * Behavioral profile -- aggregated view of user preferences built from signals.
 *
 * The profile tracks style preferences (verbosity, code-first, etc.),
 * per-topic adjustments, satisfaction rates, and explicit feedback.
 * It's rebuilt incrementally as new signals arrive.
 *
 * Storage: routed through the StorageAdapter. File mode preserves
 * dataDir/profile.json exactly.
 */
export declare function loadProfile(_config: PersonaConfig): BehavioralProfile;
/**
 * Persist a profile directly. Used by feedback pin/unpin which mutates
 * profile fields outside the signal-rebuild path.
 */
export declare function saveProfileExternal(config: PersonaConfig, profile: BehavioralProfile): void;
/**
 * Rebuild profile from current signal history.
 */
export declare function rebuildProfile(config: PersonaConfig, signals: BehavioralSignal[]): BehavioralProfile;
