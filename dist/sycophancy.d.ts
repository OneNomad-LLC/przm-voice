import type { SignalType } from './types.js';
/**
 * Sycophancy detection on ASSISTANT text.
 *
 * Distinct from signals.ts, which classifies USER input. This module
 * observes assistant output for known sycophantic patterns:
 *
 *   1. Flattery openers          — "great question," "absolutely," etc.
 *   2. Walk-backs                — retracting a claim without new evidence
 *   3. Position flips            — pre-pushback X, post-pushback ¬X
 *   4. Agreement cascades        — N consecutive turns lacking disagreement
 *
 * Detection is rules-based: regex + structural checks. No LLM in the
 * loop — the model evaluating its own sycophancy is contaminated by
 * the same failure mode (Sharma et al. 2023, see
 * memory:ai_sycophancy_research). Rules-based is deliberately the
 * floor; second-agent review (out of scope for v0) is the ceiling.
 *
 * Caveat documented in v0: rules-based detection has known false
 * positive and false negative classes. The benchmark
 * (benchmarks/sycophancy-detection) measures precision/recall against
 * a hand-labeled fixture set so users can decide whether the floor
 * is good enough for their loop.
 */
export type SycophancySignalType = 'sycophancy_flattery' | 'sycophancy_walk_back' | 'sycophancy_position_flip' | 'sycophancy_agreement_cascade';
export interface DetectedSycophancySignal {
    type: SycophancySignalType;
    confidence: number;
    /** Snippet of the offending assistant text. */
    excerpt: string;
    context?: Record<string, unknown>;
}
/**
 * Detect flattery-opener sycophancy in an assistant message.
 *
 * Scans only the first FLATTERY_HEAD_CHARS chars — mid-paragraph
 * "great question" inside a quoted user statement is benign and
 * shouldn't fire.
 *
 * Evidence-gated: if the same turn cites evidence (URL, file
 * reference, "per the spec," etc.), the opener is treated as
 * grounded agreement rather than sycophancy. Matt's preference is
 * the lenient view — "You're right because [evidence]" is the
 * desired behavior, not sycophancy. The bare-praise opener is what
 * we're flagging.
 */
export declare function detectFlattery(assistantText: string): DetectedSycophancySignal | null;
/**
 * Detect a sycophantic walk-back in the current assistant turn.
 *
 * A walk-back is sycophantic when:
 *   - the current turn contains a retraction phrase
 *   - the prior assistant turn (if supplied) made the now-retracted claim
 *   - AND the current turn does NOT cite new evidence
 *   - AND the user's intermediate pushback (if supplied) did NOT
 *     supply new evidence either
 *
 * If evidence appears on either side, the walk-back is grounded,
 * not sycophantic — and this returns null.
 *
 * Without prior-turn context, this falls back to "retraction phrase
 * + no evidence markers in current turn" with lower confidence; it
 * still emits a signal because retraction-without-evidence in a
 * single turn is a useful flag on its own.
 */
export declare function detectWalkBack(currentAssistantText: string, priorAssistantText?: string, intermediateUserText?: string): DetectedSycophancySignal | null;
/**
 * Detect an assistant position flip across two turns separated by a
 * user pushback that lacks evidence.
 *
 * Heuristic (deliberately shallow in v0):
 *   - prior assistant turn contains a positive assertion on a
 *     keyword anchor
 *   - current assistant turn contains a negative assertion on the
 *     same anchor (or vice versa)
 *   - user's intermediate message lacks evidence markers
 *
 * Returns null when:
 *   - no shared significant noun-phrase anchor between the two
 *     assistant turns
 *   - user supplied evidence (the flip is then warranted)
 *   - the current turn cites new evidence
 */
export declare function detectPositionFlip(currentAssistantText: string, priorAssistantText: string, intermediateUserText: string): DetectedSycophancySignal | null;
/**
 * Detect an agreement cascade: N consecutive assistant turns with no
 * disagreement markers. Catches the "yields to everything"
 * conversational pattern that the per-turn detectors can miss when
 * each individual turn is innocuous.
 *
 * Default threshold N=4. Tunable per caller (przm may want N=6 for
 * long discussions; a benchmark fixture set may want N=3 for
 * sensitivity).
 *
 * Returns a single signal keyed on the cascade as a whole, with the
 * turn count in context.
 */
export declare function detectAgreementCascade(recentAssistantTurns: string[], threshold?: number): DetectedSycophancySignal | null;
/**
 * Composite detection across all sycophancy types.
 *
 * Inputs:
 *   currentAssistantText — required, the just-produced assistant turn
 *   priorAssistantText   — optional, used for walk-back + position-flip
 *   intermediateUserText — optional, the user message between prior
 *                          and current assistant turns
 *   recentAssistantTurns — optional, full assistant-turn history
 *                          (oldest → newest, including current) for
 *                          cascade detection
 *
 * Returns all firing signals, sorted by confidence descending. A turn
 * may fire multiple signals (e.g. flattery + walk-back).
 */
export declare function detectSycophancyInAssistant(input: {
    currentAssistantText: string;
    priorAssistantText?: string;
    intermediateUserText?: string;
    recentAssistantTurns?: string[];
    cascadeThreshold?: number;
}): DetectedSycophancySignal[];
/**
 * Mapping helper for callers that want SignalType-keyed counts.
 * Returns the union-of-strings name expected by signals.ts /
 * BehavioralProfile rate computation.
 */
export declare function toSignalType(t: SycophancySignalType): SignalType;
