/**
 * Cognitive load and flow state detection.
 *
 * Based on flow state research (Csikszentmihalyi) and cognitive load theory.
 *
 * Flow indicators: consistent message pacing, domain vocabulary, building on
 * previous responses, short confirmatory messages ("got it", "next?").
 * When in flow: respond concisely, match pace, never inject unsolicited teaching.
 *
 * Overload indicators: rephrased questions, lexical simplification, partial
 * questions, "wait" or "hold on". When overloaded: break into chunks,
 * numbered steps, ask before continuing.
 *
 * Response verbosity should be gated inversely to cognitive load.
 */
const WINDOW_SIZE = 10;
// ── Flow Detection ─────────────────────────────────────────────────
const FLOW_CONFIRMATIONS = /^(got it|ok|okay|next|yes|yep|yeah|right|go|continue|makes sense|cool|nice|perfect|done|good)\b/i;
function isFlowMessage(message) {
    const trimmed = message.trim();
    if (trimmed.length < 30 && FLOW_CONFIRMATIONS.test(trimmed))
        return true;
    if (trimmed.length < 15 && !trimmed.includes('?'))
        return true;
    return false;
}
// ── Overload Detection ─────────────────────────────────────────────
const OVERLOAD_SIGNALS = /\b(wait|hold on|let me think|I'm confused|I don't understand|what do you mean|can you explain|say that again|repeat that|slow down|too much)\b/i;
function hasOverloadSignals(message) {
    return OVERLOAD_SIGNALS.test(message);
}
/**
 * Detect if a message is a rephrased version of the previous one.
 * Simple heuristic: if >50% of significant words overlap with a previous
 * question but the message is different, it's likely a rephrase.
 */
function isRephrased(current, previous) {
    if (!previous)
        return false;
    if (!current.includes('?') && !previous.includes('?'))
        return false;
    const currentWords = new Set(current.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const prevWords = new Set(previous.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (currentWords.size < 3 || prevWords.size < 3)
        return false;
    let overlap = 0;
    for (const word of currentWords) {
        if (prevWords.has(word))
            overlap++;
    }
    const similarity = overlap / Math.min(currentWords.size, prevWords.size);
    return similarity > 0.5 && current !== previous;
}
// ── Main Update Function ───────────────────────────────────────────
/**
 * Update cognitive load state from a new message.
 * Returns updated state with flow/overload detection.
 */
export function updateCognitiveLoad(state, message, previousMessage) {
    const updated = { ...state };
    const msgLength = message.length;
    // Update rolling message length window
    updated.messageLengthTrend = [...state.messageLengthTrend, msgLength].slice(-WINDOW_SIZE);
    // Check for question repetition
    if (isRephrased(message, previousMessage)) {
        updated.questionRepeatCount = state.questionRepeatCount + 1;
    }
    else {
        updated.questionRepeatCount = Math.max(0, state.questionRepeatCount - 0.5);
    }
    // Calculate load score
    let load = 0.3; // baseline
    // Flow signals decrease load
    if (isFlowMessage(message)) {
        load -= 0.2;
    }
    // Consistent pacing decreases load (low variance in message lengths)
    if (updated.messageLengthTrend.length >= 3) {
        const avg = updated.messageLengthTrend.reduce((a, b) => a + b, 0) / updated.messageLengthTrend.length;
        const variance = updated.messageLengthTrend.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / updated.messageLengthTrend.length;
        const cv = Math.sqrt(variance) / (avg || 1);
        if (cv < 0.5)
            load -= 0.1; // consistent pacing
    }
    // Overload signals increase load
    if (hasOverloadSignals(message)) {
        load += 0.3;
    }
    // Question repetition increases load
    load += updated.questionRepeatCount * 0.15;
    // Sudden message length drop = something went wrong
    if (updated.messageLengthTrend.length >= 3) {
        const recent = updated.messageLengthTrend.slice(-3);
        const older = updated.messageLengthTrend.slice(0, -3);
        if (older.length > 0) {
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
            if (olderAvg > 0 && recentAvg / olderAvg < 0.3) {
                load += 0.15; // 70%+ drop in message length
            }
        }
    }
    updated.load = clamp(load, 0, 1);
    updated.inFlow = updated.load < 0.2;
    updated.overloaded = updated.load > 0.6;
    return updated;
}
/**
 * Returns a short prompt fragment summarizing the current cognitive state
 * for injection into the system prompt. Returns '' for the neutral band
 * so we don't waste tokens. Designed to slot into the soul-assembler
 * near the voice block.
 */
export function describeLoadForPrompt(state) {
    if (state.overloaded) {
        return 'User cognitive load: HIGH. Break responses into numbered chunks. Confirm before continuing. Avoid unsolicited teaching.';
    }
    if (state.inFlow) {
        return 'User in flow. Match pace. Keep responses tight. No unsolicited teaching.';
    }
    return '';
}
/**
 * Get verbosity recommendation based on cognitive load.
 * Returns a multiplier: <1 means be more concise, >1 means can be verbose.
 */
export function getVerbosityMultiplier(state) {
    if (state.inFlow)
        return 0.5; // be concise in flow
    if (state.overloaded)
        return 0.3; // be very concise when overloaded
    return 1.0 - state.load * 0.5; // scale linearly
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
//# sourceMappingURL=cognitive-load.js.map