/**
 * Topic extraction — lightweight content-word grabber.
 *
 * Used by the emotional-association store to tag turns with candidate
 * topics. No LLM, no NER — a stopword-filtered token list. Convergence
 * comes from the association store itself (EMA + frequency cap), not
 * from precision here.
 *
 * Ported from Pyre's evolution-manager. Not a substitute for proper
 * NER; matches a content-word grab pattern and relies on the EMA +
 * frequency cap downstream to shake out noise.
 */
/**
 * Extract up to 5 candidate topic words from a message. Filters out
 * short words (≤4 chars) and a stopword set. Order is first-seen,
 * deduped.
 */
export declare function extractTopics(message: string, max?: number): string[];
