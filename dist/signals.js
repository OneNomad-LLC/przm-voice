import { randomUUID } from 'node:crypto';
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
export function loadSignals(_config) {
    return getStorage().listSignals();
}
/**
 * Record a new behavioral signal.
 */
export function recordSignal(config, type, content, context, category) {
    const signal = {
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
export function getSignalCounts(signals) {
    const counts = {};
    for (const s of signals) {
        counts[s.type] = (counts[s.type] ?? 0) + 1;
    }
    return counts;
}
/**
 * Get recent signals within a time window.
 */
export function getRecentSignals(signals, daysBack = 7) {
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
// Ported from Pyre's evolution package. The Pyre-only types
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
    /I\s+already\s+(said|told|asked)/i,
    /how\s+many\s+times/i,
    /^(no+)$/i,
    /^(why|what)\?{2,}/i,
    /can\s+you\s+just/i,
    /^forget\s+it/i,
    /this\s+is\s+(frustrating|annoying|useless)/i,
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
    /from\s+now\s+on/i,
    /always\s+(do|use|prefer)/i,
    /never\s+(do|use|say)/i,
    /I\s+(prefer|like|want)\s+.*(when|for|in)/i,
    /stop\s+(always|constantly)/i,
    /don'?t\s+.+\s+anymore/i,
];
const STYLE_CORRECTION_PATTERNS = [
    /(too\s+(formal|casual|verbose|terse|long|short|technical))/i,
    /(more|less)\s+(formal|casual|verbose|terse|technical|detailed)/i,
    /stop\s+(using|saying)\s+(emojis?|exclamation\s+points?|bullet\s+points?)/i,
    /(use|prefer)\s+(plain|simple|formal)\s+(language|english|text)/i,
];
const REGEN_PATTERNS = [
    /try\s+(again|once\s+more)/i,
    /^(regenerate|redo|redo\s+that|again)/i,
    /give\s+me\s+(another|a\s+different)/i,
    /can\s+you\s+(try|do)\s+(again|that\s+again|it\s+differently)/i,
];
function matchesAny(text, patterns) {
    return patterns.some((p) => p.test(text));
}
function countMatches(text, patterns) {
    let n = 0;
    for (const p of patterns)
        if (p.test(text))
            n++;
    return n;
}
function patternConfidence(text, patterns) {
    const matches = countMatches(text, patterns);
    return Math.min(0.95, 0.6 + matches * 0.1);
}
/**
 * Topic-overlap score between two strings: ratio of shared significant
 * words (length > 3, lowercased) over the smaller word set. Returns
 * 0 when either input has no significant tokens.
 */
export function calculateTopicOverlap(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0)
        return 0;
    let overlap = 0;
    for (const word of wordsA) {
        if (wordsB.has(word))
            overlap++;
    }
    return overlap / Math.min(wordsA.size, wordsB.size);
}
/**
 * Detect zero or more signals from a raw user message. Pure pattern
 * matching — runs locally with no API cost. Multiple signal types may
 * fire on the same message (e.g. correction + frustration). The
 * conversation `previousMessages` window is used for re-ask detection.
 */
export function detectSignals(userMessage, previousMessages = []) {
    const msg = userMessage;
    const signals = [];
    if (matchesAny(msg, CORRECTION_PATTERNS)) {
        signals.push({ type: 'correction', confidence: patternConfidence(msg, CORRECTION_PATTERNS) });
    }
    if (matchesAny(msg, APPROVAL_PATTERNS)) {
        signals.push({ type: 'approval', confidence: patternConfidence(msg, APPROVAL_PATTERNS) });
    }
    if (matchesAny(msg, PRAISE_PATTERNS)) {
        signals.push({ type: 'praise', confidence: patternConfidence(msg, PRAISE_PATTERNS) });
    }
    if (matchesAny(msg, FRUSTRATION_PATTERNS)) {
        signals.push({ type: 'frustration', confidence: patternConfidence(msg, FRUSTRATION_PATTERNS) });
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
    if (matchesAny(msg, FEEDBACK_PATTERNS)) {
        signals.push({ type: 'explicit_feedback', confidence: 0.9, context: { feedback: msg } });
    }
    if (matchesAny(msg, STYLE_CORRECTION_PATTERNS)) {
        signals.push({ type: 'style_correction', confidence: 0.85 });
    }
    if (matchesAny(msg, REGEN_PATTERNS)) {
        signals.push({ type: 'regen_request', confidence: 0.85 });
    }
    const reAsk = detectReAsk(msg, previousMessages);
    if (reAsk)
        signals.push(reAsk);
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
export function detectReAsk(currentMessage, previousUserMessages) {
    const current = currentMessage.toLowerCase().trim();
    if (current.length < 20)
        return null;
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
//# sourceMappingURL=signals.js.map