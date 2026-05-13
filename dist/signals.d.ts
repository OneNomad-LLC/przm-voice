import type { BehavioralSignal, SignalType, PersonaConfig } from './types.js';
/**
 * Behavioral signal recording and storage.
 *
 * Signals are observations about user behavior -- corrections, approvals,
 * frustration, style preferences, etc. They're the raw input that drives
 * profile building and evolution proposals.
 *
 * Storage: routed through the StorageAdapter — file mode preserves the
 * historical dataDir/signals.json layout exactly.
 */
export declare function loadSignals(_config: PersonaConfig): BehavioralSignal[];
/**
 * Record a new behavioral signal.
 */
export declare function recordSignal(config: PersonaConfig, type: SignalType, content: string, context?: string, category?: string): BehavioralSignal;
/**
 * Get signal counts by type.
 */
export declare function getSignalCounts(signals: BehavioralSignal[]): Record<SignalType, number>;
/**
 * Get recent signals within a time window.
 */
export declare function getRecentSignals(signals: BehavioralSignal[], daysBack?: number): BehavioralSignal[];
/**
 * Topic-overlap score between two strings: ratio of shared significant
 * words (length > 3, lowercased) over the smaller word set. Returns
 * 0 when either input has no significant tokens.
 */
export declare function calculateTopicOverlap(a: string, b: string): number;
export interface DetectedSignal {
    type: SignalType;
    confidence: number;
    context?: Record<string, unknown>;
}
/**
 * Detect zero or more signals from a raw user message. Pure pattern
 * matching — runs locally with no API cost. Multiple signal types may
 * fire on the same message (e.g. correction + frustration). The
 * conversation `previousMessages` window is used for re-ask detection.
 */
export declare function detectSignals(userMessage: string, previousMessages?: string[]): DetectedSignal[];
/**
 * Detect whether the current message is a re-ask of something the
 * user said earlier in the conversation. Compares against the recent
 * user-message window. Returns a single re_ask signal or null.
 *
 * Conservative: requires the current message to be at least 20 chars
 * and shared-topic overlap above 0.6 against any prior message.
 */
export declare function detectReAsk(currentMessage: string, previousUserMessages: string[]): DetectedSignal | null;
