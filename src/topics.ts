/**
 * Topic extraction — lightweight content-word grabber.
 *
 * Used by the emotional-association store to tag turns with candidate
 * topics. No LLM, no NER — a stopword-filtered token list. Convergence
 * comes from the association store itself (EMA + frequency cap), not
 * from precision here.
 *
 * Ported from przm's evolution-manager. Not a substitute for proper
 * NER; matches a content-word grab pattern and relies on the EMA +
 * frequency cap downstream to shake out noise.
 */

const TOPIC_STOPWORDS = new Set([
  'about', 'after', 'again', 'before', 'being', 'between', 'could', 'doing',
  'during', 'every', 'first', 'going', 'have', 'having', 'here', 'into',
  'just', 'like', 'might', 'most', 'much', 'never', 'often', 'other',
  'over', 'really', 'right', 'should', 'some', 'still', 'such', 'than',
  'that', 'them', 'then', 'there', 'these', 'they', 'thing', 'this',
  'those', 'through', 'under', 'until', 'very', 'was', 'were', 'what',
  'when', 'where', 'which', 'while', 'with', 'would', 'your', 'yourself',
  'maybe', 'okay', 'well',
]);

/**
 * Extract up to 5 candidate topic words from a message. Filters out
 * short words (≤4 chars) and a stopword set. Order is first-seen,
 * deduped.
 */
export function extractTopics(message: string, max: number = 5): string[] {
  const tokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !TOPIC_STOPWORDS.has(w));

  const seen = new Set<string>();
  const topics: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      topics.push(t);
      if (topics.length >= max) break;
    }
  }
  return topics;
}
