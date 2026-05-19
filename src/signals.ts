import { randomUUID } from 'node:crypto';
import type { BehavioralSignal, SignalType, PersonaConfig } from './types.js';
import { getStorage } from './storage/index.js';

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

export function loadSignals(_config: PersonaConfig): BehavioralSignal[] {
  return getStorage().listSignals();
}

/**
 * Record a new behavioral signal.
 */
export function recordSignal(
  config: PersonaConfig,
  type: SignalType,
  content: string,
  context?: string,
  category?: string
): BehavioralSignal {
  const signal: BehavioralSignal = {
    id: randomUUID(),
    type,
    content: content.slice(0, 500),
    context: context?.slice(0, 300),
    category,
    timestamp: new Date().toISOString(),
  };

  getStorage().appendSignal(signal, config.maxSignals);

  return signal;
}

/**
 * Get signal counts by type.
 */
export function getSignalCounts(signals: BehavioralSignal[]): Record<SignalType, number> {
  const counts: Record<string, number> = {};
  for (const s of signals) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
  }
  return counts as Record<SignalType, number>;
}

/**
 * Get recent signals within a time window.
 */
export function getRecentSignals(signals: BehavioralSignal[], daysBack: number = 7): BehavioralSignal[] {
  const cutoff = Date.now() - daysBack * 86_400_000;
  return signals.filter(s => new Date(s.timestamp).getTime() > cutoff);
}

// ── Signal Detection ─────────────────────────────────────────────────
//
// Pattern catalog for auto-classifying signals from raw user text.
// Local-only regex matching — no LLM, no API calls. Callers may either
// pass an explicit `type` to recordSignal() (current behavior) or run
// detectSignals() to classify a user message into zero or more signals.
//
// Ported from przm's evolution package. The przm-only types
// (model_override, long_engagement, quick_done) are deliberately
// dropped — they're routing/engine concerns, not personality signals.

const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,
  /that'?s\s+(not|wrong|incorrect)/i,
  /^actually[,.]?\s/i,
  /I\s+meant/i,
  /not\s+what\s+I\s+(asked|wanted|meant)/i,
  /try\s+again/i,
  /^wrong/i,
  /please\s+(fix|correct|change)/i,
  /you\s+(misunderstood|missed|got\s+it\s+wrong)/i,
  /don'?t\s+do\s+that/i,
  /stop\s+doing/i,
  /I\s+said/i,
  /that\s+doesn'?t\s+(work|help|make\s+sense)/i,
];

const APPROVAL_PATTERNS = [
  /^(perfect|great|awesome|excellent|nice|good|thanks|thank\s+you|cheers|cool|love\s+it)/i,
  /^(yes|yep|yeah|yup|exactly|correct|right)/i,
  /that('?s|\s+is)\s+(exactly|perfect|what\s+I\s+(wanted|needed|meant))/i,
  /^(👍|✅|🎉|💯|🙏)/,
  /this\s+(works|looks\s+good|is\s+great)/i,
  /^lgtm/i,
];

const PRAISE_PATTERNS = [
  /^(amazing|brilliant|fantastic|wonderful|outstanding|incredible|impressive)/i,
  /you'?re\s+(amazing|brilliant|great|the\s+best|crushing\s+it)/i,
  /great\s+(work|job|response|answer)/i,
  /that'?s\s+(brilliant|genius|amazing|impressive)/i,
];

const FRUSTRATION_PATTERNS = [
  /^\.{2,}$/,
  /^(ugh|sigh|ffs|omg|bruh|dude|come\s+on)/i,
  /I\s+(already|literally|just)\s+(said|told|asked)/i,
  /how\s+many\s+times/i,
  /^(no+)$/i,
  /^(why|what)\?{2,}/i,
  /can\s+you\s+just/i,
  /\bforget\s+it\b/i,
  /this\s+is\s+(frustrating|annoying|useless|ridiculous|exhausting)/i,
  // Repetition / re-ask frustration
  /\b(third|fourth|fifth|second|\d+(st|nd|rd|th)?)\s+time\s+I('?ve|\s+have)\s+(asked|told|said)/i,
  /\bread\s+what\s+I\s+(wrote|said|asked|typed)/i,
  // Imperatives with negation — frustration sticks to process verbs
  // ("stop doing", "stop trying"). Output-specific verbs ("stop
  // saying X", "stop using emojis") live in STYLE_CORRECTION_PATTERNS.
  /^stop\s+(doing|trying|asking)\b/i,
  /\bI\s+told\s+you\s+not\s+to\b/i,
  // Pointed rhetorical "still / why are you still"
  /\b(still\s+(hedging|doing|saying|adding|trying|ignoring))/i,
  /\bjust\s+answer\s+(the\s+)?(question|me)/i,
  // Allcaps NOT / NEVER inside a sentence — a recognizable emphasis marker
  /\bsaid\s+NOT\s+to/i,
  /\b(NOT|NEVER|STOP)\s+(do|doing|to|with)/i,
  // "going in circles" idiom
  /\bgoing\s+in\s+circles\b/i,
  // Frustrated single-word rejections
  /^(seriously|really)\?+$/i,
];

const ABANDONMENT_PATTERNS = [
  /^(never\s*mind|nvm|forget\s+(it|that)|moving\s+on)/i,
  /let'?s\s+(do|try)\s+something\s+else/i,
  /^(skip|next|drop\s+it)/i,
];

const ELABORATION_PATTERNS = [
  /can\s+you\s+(explain|elaborate|go\s+into\s+more\s+detail)/i,
  /what\s+do\s+you\s+mean/i,
  /I\s+don'?t\s+(understand|get\s+it|follow)/i,
  /more\s+detail/i,
  /^(explain|elaborate|expand)/i,
  /tell\s+me\s+more/i,
  /^why\??$/i,
  /^how\??$/i,
];

const SIMPLIFICATION_PATTERNS = [
  /^(tldr|tl;?dr|too\s+long)/i,
  /can\s+you\s+(simplify|summarize|shorten)/i,
  /^(shorter|simpler|briefly)/i,
  /in\s+(simple|plain)\s+(terms|english|words)/i,
  /too\s+(much|verbose|complex|complicated)/i,
  /just\s+(the\s+)?answer/i,
  /^eli5/i,
];

const CODE_ACCEPTED_PATTERNS = [
  /(that|this)\s+(code|snippet|function|solution)\s+(works|is\s+working|did\s+it|fixed\s+it)/i,
  /^(works|working|fixed|done|shipped|merged)/i,
  /I\s+(used|shipped|merged|committed)\s+(your|the|that)\s+(code|fix|change)/i,
];

const CODE_REJECTED_PATTERNS = [
  /(that|this)\s+(code|snippet|function)\s+(doesn'?t|does\s+not)\s+(work|compile|run)/i,
  /(error|exception|crash|throws|fails)\s+(when|on|at)/i,
  /^(broken|doesn'?t\s+work|won'?t\s+compile)/i,
];

const FEEDBACK_PATTERNS = [
  /^(remember|note|keep\s+in\s+mind)/i,
  /\bfrom\s+now\s+on\b/i,
  // Word-boundary on the trailing scope-token so "in" doesn't match
  // INSIDE words like "explanations" or "interesting".
  /\bI\s+(prefer|like|want)\s+.*\b(when|for|in)\b/i,
  /\bstop\s+(always|constantly)\b/i,
  /\bdon'?t\s+.+\s+anymore\b/i,
];

const STYLE_CORRECTION_PATTERNS = [
  /(too\s+(formal|casual|verbose|terse|long|short|technical))/i,
  /(more|less)\s+(formal|casual|verbose|terse|technical|detailed)/i,
  /stop\s+(using|saying)\s+(['"][^'"]+['"]|emojis?|exclamation\s+points?|bullet\s+points?|preambles?|summaries|hedge\s+words?)/i,
  /(use|prefer)\s+(plain|simple|formal)\s+(language|english|text)/i,
  // Cut/lose/drop the X — formatting commands
  /\b(cut|drop|lose|kill|skip|remove)\s+(the\s+)?(preamble|intro|summary|summaries|caveats?|emojis?|hedging|formalit(y|ies))/i,
  /\bget\s+to\s+(the\s+)?(answer|point)/i,
  // Length adjustments without "too long" wording
  /\b(half\s+(the\s+)?length|shorter\.\s*half|twice\s+as\s+short|cut\s+(it\s+)?in\s+half)\b/i,
  /^shorter[.,]\s/i,
  // "Don't end every message with X" / "Don't start every X with Y"
  /\bdon'?t\s+(end|start|begin|finish)\s+every\s+(message|response|answer|reply)/i,
  // "Stop saying 'literal phrase'"
  /\bstop\s+saying\s+['"]/i,
  // Negative format rules: "don't (include|add|use|emit) X (unless|when|if)"
  /\bdon'?t\s+(include|add|use|emit|insert|put|leave|write|generate)\s+\w+/i,
];

const REGEN_PATTERNS = [
  /try\s+(again|once\s+more)/i,
  /^(regenerate|redo|redo\s+that|again)/i,
  /give\s+me\s+(another|a\s+different)/i,
  /can\s+you\s+(try|do)\s+(again|that\s+again|it\s+differently)/i,
];

// Satisfaction: a task or answer landed. Stronger / more durable than
// `approval` (which can be a passing "yeah ok"). Satisfaction implies
// the user is acting on the output — shipping, using, going with it.
const SATISFACTION_PATTERNS = [
  /\b(ship\s+it|shipping\s+it|going\s+with\s+(this|that|it))\b/i,
  /\b(worked|works)\s+(on\s+the\s+first\s+try|first\s+time|perfectly)\b/i,
  /^(good|great|nice)\.\s+(ship|going|use|using|works|merged|done)/i,
  /\b(that('?s|\s+is)\s+the\s+fix|exactly\s+what\s+I\s+needed)\b/i,
  /\bcleaner\s+than\s+what\s+I\s+had\b/i,
  /^(that|this)\s+worked[.,!]/i,
  /^yeah\s+that('?s|\s+is)\s+(the\s+fix|it|right|what)/i,
  // "Worked, thanks" / "That worked, thanks"
  /\b(that\s+)?worked,?\s+thanks?\b/i,
];

// Confusion: signals "I do not understand." Distinct from elaboration
// (which is "go deeper on a thing I already get") and curiosity
// (which is exploring a new thread).
const CONFUSION_PATTERNS = [
  /\b(I'?m\s+(lost|confused)|I\s+don'?t\s+(get|follow|understand))\b/i,
  /\b(doesn'?t|does\s+not)\s+make\s+sense\b/i,
  /\bwait,?\s+what\b/i,
  /\b(huh|what)\??\s*$/i,
  /\bcan\s+you\s+(start\s+over|back\s+up|re-?explain)\b/i,
  /\bI'?m\s+not\s+(following|tracking|with\s+you)\b/i,
  /\bwhat\s+do\s+you\s+mean\s+by\b/i,
  /\bthis\s+is\s+(over\s+my\s+head|confusing|unclear)\b/i,
];

// Curiosity: exploratory follow-ups. Asks "what if", "how about",
// "interesting — tell me about Y". Distinct from elaboration in that
// it pivots into adjacent territory rather than drilling deeper.
const CURIOSITY_PATTERNS = [
  /^(interesting|huh,?\s+interesting|oh\s+interesting)\b/i,
  /\bwhat\s+(if|about|happens\s+(if|when))\b/i,
  /\bhow\s+would\s+(this|that|it)\s+(scale|work|handle|behave|compare)\b/i,
  /\b(tell\s+me\s+(more|about)|curious\s+(about|why))\b/i,
  /\bwhy\s+does\s+\w+\s+(prefer|use|do|choose|pick|select)\b/i,
  /\bwhat\s+if\s+we\s+tried\b/i,
  /\bhow\s+come\s+\w+/i,
  // "Could you compare X vs Y"
  /\b(compare|vs\.?|versus)\s+\w+/i,
];

// Preference: stable statement of "this is how I want it going
// forward." Distinct from style_correction (which is a momentary
// "drop the emojis") in that preference is the long-term version of
// the same idea. Distinct from explicit_feedback only in framing —
// preference is positive ("I prefer X"), explicit_feedback is more
// general ("remember that I X").
const PREFERENCE_PATTERNS = [
  /\bI\s+prefer\s+\w+\s+(over|to|instead\s+of)\s+\w+/i,
  /\balways\s+use\s+(typescript|markdown|tabs|spaces|four-?space|two-?space|the\s+\w+|\w+)/i,
  /\bnever\s+use\s+\w+/i,
  /\bI\s+want\s+\w+\s+(before|after|instead\s+of)\s+\w+/i,
  /\buse\s+(four|two|three|tabs?|spaces?)\s*-?\s*(space|tab|wide|indents?)/i,
  /\b(prefer|preferred)\s+style\b/i,
  /\bI\s+prefer\s+\w+/i,
  /\bI\s+(like|want)\s+\w+\s+\b(when|for|over|to|instead\s+of)\b/i,
  // "Always|Never <verb>" without specific object (general preference)
  /^(always|never)\s+(do|use|say|skip|include|add|emit)\b/i,
];

// Task completion (non-code). "Done", "shipped", "finalized". Code
// has its own type — this is for when the user signals a writing,
// planning, or analysis task is finished.
const TASK_COMPLETE_PATTERNS = [
  /^(done|finished|complete|finalized|wrapped)\b/i,
  /\b(that('?s|\s+is)\s+(done|finished|enough)|we'?re\s+done\s+here)\b/i,
  /\bok\s+(that\s+)?works,?\s+(moving\s+on|next)/i,
];

// Task abandonment — explicit "give up" on the current task.
// Distinct from abandonment (which is generic topic change). This is
// "I am dropping THIS task." Different downstream effect: persona
// should de-prioritize the dropped task's context, not just shift.
const TASK_ABANDONED_PATTERNS = [
  /\b(give\s+up|giving\s+up|I\s+quit)\s+(on\s+(this|that))?/i,
  /\b(not\s+worth\s+(it|the\s+effort)|forget\s+this\s+task)\b/i,
  /\bdrop\s+this\s+(task|approach|whole\s+thing)\b/i,
];

// Topic shift: explicit pivot to a different subject. Different from
// abandonment in tone (abandonment is "ugh, never mind"; topic_shift
// is "ok let's talk about X").
const TOPIC_SHIFT_PATTERNS = [
  /^(ok|alright|right|so),?\s+(now|next|moving\s+on|let'?s)\s+(talk\s+about|switch\s+to|do|try)/i,
  /\bdifferent\s+(question|topic|thing)\s*[:—-]/i,
  /\bchanging\s+(the\s+)?(subject|topic)\b/i,
  /\bunrelated\s+(question|but)/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n++;
  return n;
}

function patternConfidence(text: string, patterns: RegExp[]): number {
  const matches = countMatches(text, patterns);
  return Math.min(0.95, 0.6 + matches * 0.1);
}

/**
 * Topic-overlap score between two strings: ratio of shared significant
 * words (length > 3, lowercased) over the smaller word set. Returns
 * 0 when either input has no significant tokens.
 */
export function calculateTopicOverlap(a: string, b: string): number {
  const wordsA = new Set(
    a.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );
  const wordsB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

export interface DetectedSignal {
  type: SignalType;
  confidence: number;
  context?: Record<string, unknown>;
}

/**
 * Detect zero or more signals from a raw user message. Pure pattern
 * matching — runs locally with no API cost. Multiple signal types may
 * fire on the same message (e.g. correction + frustration); results
 * are sorted by confidence so callers that read only the top item
 * (EvoBench, MCP clients showing "primary classification") see the
 * strongest signal first. Pure-affect catalogs (frustration,
 * confusion, satisfaction) are given a slight scoring boost over
 * action catalogs (correction, regen) when both match the same
 * message — affect almost always carries the more useful signal for
 * personality adaptation downstream.
 *
 * The conversation `previousMessages` window is used for re-ask
 * detection.
 */
export function detectSignals(
  userMessage: string,
  previousMessages: string[] = [],
): DetectedSignal[] {
  const msg = userMessage;
  const signals: DetectedSignal[] = [];

  // ── Affect-heavy catalogs (boost +0.15) ────────────────────────────
  // These represent the user's emotional/mental state. They're
  // intentionally pushed ahead of action catalogs in the tiebreak
  // because "stop doing that" carries useful frustration info even if
  // it also reads as a correction. 0.15 is large enough to win
  // against an action catalog's typical 0.80 confidence cleanly.
  const AFFECT_BOOST = 0.15;

  if (matchesAny(msg, FRUSTRATION_PATTERNS)) {
    signals.push({
      type: 'frustration',
      confidence: patternConfidence(msg, FRUSTRATION_PATTERNS) + AFFECT_BOOST,
    });
  }
  if (matchesAny(msg, CONFUSION_PATTERNS)) {
    signals.push({
      type: 'confusion',
      confidence: patternConfidence(msg, CONFUSION_PATTERNS) + AFFECT_BOOST,
    });
  }
  if (matchesAny(msg, SATISFACTION_PATTERNS)) {
    signals.push({
      type: 'satisfaction',
      confidence: patternConfidence(msg, SATISFACTION_PATTERNS) + AFFECT_BOOST,
    });
  }
  if (matchesAny(msg, CURIOSITY_PATTERNS)) {
    signals.push({
      type: 'curiosity',
      confidence: patternConfidence(msg, CURIOSITY_PATTERNS) + AFFECT_BOOST,
    });
  }

  // ── Stable-intent catalogs (no boost, neutral confidence) ──────────
  // Preferences and explicit feedback are durable instructions about
  // future behavior — high signal value but not affect.
  if (matchesAny(msg, PREFERENCE_PATTERNS)) {
    signals.push({
      type: 'preference',
      confidence: patternConfidence(msg, PREFERENCE_PATTERNS),
      context: { preference: msg },
    });
  }
  if (matchesAny(msg, FEEDBACK_PATTERNS)) {
    signals.push({ type: 'explicit_feedback', confidence: 0.9, context: { feedback: msg } });
  }

  // ── Style + format ─────────────────────────────────────────────────
  if (matchesAny(msg, STYLE_CORRECTION_PATTERNS)) {
    signals.push({ type: 'style_correction', confidence: 0.85 });
  }

  // ── Action catalogs (no boost) ─────────────────────────────────────
  // Lower-priority because most also fire as affect or stable-intent;
  // when nothing else matches, these still capture user intent.
  if (matchesAny(msg, CORRECTION_PATTERNS)) {
    signals.push({ type: 'correction', confidence: patternConfidence(msg, CORRECTION_PATTERNS) });
  }
  if (matchesAny(msg, APPROVAL_PATTERNS)) {
    signals.push({ type: 'approval', confidence: patternConfidence(msg, APPROVAL_PATTERNS) });
  }
  if (matchesAny(msg, PRAISE_PATTERNS)) {
    signals.push({ type: 'praise', confidence: patternConfidence(msg, PRAISE_PATTERNS) });
  }
  if (matchesAny(msg, ABANDONMENT_PATTERNS)) {
    signals.push({ type: 'abandonment', confidence: 0.75 });
  }
  if (matchesAny(msg, ELABORATION_PATTERNS)) {
    signals.push({ type: 'elaboration', confidence: 0.8 });
  }
  if (matchesAny(msg, SIMPLIFICATION_PATTERNS)) {
    signals.push({ type: 'simplification', confidence: 0.8 });
  }
  if (matchesAny(msg, CODE_ACCEPTED_PATTERNS)) {
    signals.push({ type: 'code_accepted', confidence: 0.85 });
  }
  if (matchesAny(msg, CODE_REJECTED_PATTERNS)) {
    signals.push({ type: 'code_rejected', confidence: 0.85 });
  }
  if (matchesAny(msg, TASK_COMPLETE_PATTERNS)) {
    signals.push({ type: 'task_complete', confidence: 0.8 });
  }
  if (matchesAny(msg, TASK_ABANDONED_PATTERNS)) {
    signals.push({ type: 'task_abandoned', confidence: 0.8 });
  }
  if (matchesAny(msg, TOPIC_SHIFT_PATTERNS)) {
    signals.push({ type: 'topic_shift', confidence: 0.75 });
  }
  if (matchesAny(msg, REGEN_PATTERNS)) {
    signals.push({ type: 'regen_request', confidence: 0.85 });
  }

  const reAsk = detectReAsk(msg, previousMessages);
  if (reAsk) signals.push(reAsk);

  // Sort by confidence descending so callers reading only the top entry
  // ("primary signal") see the strongest classification.
  signals.sort((a, b) => b.confidence - a.confidence);

  return signals;
}

/**
 * Detect whether the current message is a re-ask of something the
 * user said earlier in the conversation. Compares against the recent
 * user-message window. Returns a single re_ask signal or null.
 *
 * Conservative: requires the current message to be at least 20 chars
 * and shared-topic overlap above 0.6 against any prior message.
 */
export function detectReAsk(
  currentMessage: string,
  previousUserMessages: string[],
): DetectedSignal | null {
  const current = currentMessage.toLowerCase().trim();
  if (current.length < 20) return null;

  for (const prev of previousUserMessages) {
    const overlap = calculateTopicOverlap(current, prev);
    if (overlap > 0.6) {
      return {
        type: 're_ask',
        confidence: overlap,
        context: { originalQuestion: prev.slice(0, 200) },
      };
    }
  }
  return null;
}
