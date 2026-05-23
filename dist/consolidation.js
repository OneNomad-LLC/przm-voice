import { SYCOPHANCY_APPROVAL_THRESHOLD } from './types.js';
import { loadTraitState, saveTraitState } from './emotions.js';
import { loadSignals, getRecentSignals, getSignalCounts } from './signals.js';
import { loadProfile } from './profile.js';
import { getStorage } from './storage/index.js';
import { pruneOldProposals } from './evolution.js';
/**
 * Between-session consolidation, modeled after sleep consolidation
 * and the Default Mode Network.
 *
 * The brain consolidates during sleep via hippocampal replay:
 * compressed re-processing of experiences, biased toward emotional
 * and novel events. The DMN integrates experiences into a coherent
 * self-model during idle periods.
 *
 * This module runs between sessions to:
 * 1. Cluster recent interaction patterns by theme
 * 2. Generalize principles from specific interactions
 * 3. Identify contradictions with established personality
 * 4. Promote consistent session-level observations to trait-level
 * 5. Decay stale emotional associations
 * 6. Update the baseline style vector
 *
 * Uses a two-timescale update rule:
 * - Session state: learning rate 0.3, captures temporary shifts
 * - Trait state: learning rate 0.01, only updates when session observations
 *   consistently diverge from trait predictions across multiple sessions
 */
const TRAIT_LEARNING_RATE = 0.01;
const TRANSITION_LEARNING_RATE = 0.05; // used when high variance detected
const EMOTION_DECAY_RATE = 0.95; // per consolidation cycle
function loadSessionHistory(_config) {
    return getStorage().listSessions();
}
function appendSessionHistory(_config, summary) {
    // Adapter handles the FIFO trim at 100 internally.
    getStorage().appendSession(summary);
}
/**
 * Run the full consolidation pass.
 * Call this between sessions or periodically.
 */
export function runConsolidation(config) {
    const traitState = loadTraitState(config);
    const history = loadSessionHistory(config);
    const signals = loadSignals(config);
    const profile = loadProfile(config);
    const result = {
        sessionsAnalyzed: history.length,
        traitUpdates: [],
        emotionalDecay: 0,
        contradictions: [],
        styleShift: false,
    };
    // ── 1. Decay emotional associations ──────────────────────
    for (const assoc of traitState.emotionalAssociations) {
        const daysSinceSeen = (Date.now() - new Date(assoc.lastSeen).getTime()) / 86_400_000;
        if (daysSinceSeen > 7) {
            const oldValence = assoc.valence;
            assoc.valence *= Math.pow(EMOTION_DECAY_RATE, daysSinceSeen / 7);
            if (Math.abs(oldValence) > 0.1 && Math.abs(assoc.valence) <= 0.1) {
                result.emotionalDecay++;
            }
        }
    }
    // Prune dead associations
    const before = traitState.emotionalAssociations.length;
    traitState.emotionalAssociations = traitState.emotionalAssociations.filter(a => Math.abs(a.valence) > 0.05 || a.exposureCount > 5);
    result.emotionalDecay += before - traitState.emotionalAssociations.length;
    // ── 2. Detect style drift across sessions ─────────────────
    if (history.length >= 5) {
        const recent5 = history.slice(-5);
        const older5 = history.slice(-10, -5);
        if (older5.length >= 3) {
            const recentAvg = averageStyle(recent5.map(s => s.styleSnapshot));
            const olderAvg = averageStyle(older5.map(s => s.styleSnapshot));
            // Check if any dimension shifted significantly
            const dims = ['formality', 'energy', 'verbosity', 'humor', 'specificity'];
            for (const dim of dims) {
                const delta = Math.abs(recentAvg[dim] - olderAvg[dim]);
                if (delta > 0.15) {
                    result.traitUpdates.push(`Style ${dim} shifted ${delta > 0 ? 'up' : 'down'} by ${(delta * 100).toFixed(0)}%`);
                    result.styleShift = true;
                    // Update baseline toward recent observation
                    const lr = delta > 0.25 ? TRANSITION_LEARNING_RATE : TRAIT_LEARNING_RATE;
                    traitState.baselineStyleVector[dim] =
                        traitState.baselineStyleVector[dim] * (1 - lr) + recentAvg[dim] * lr;
                }
            }
        }
    }
    // ── 3. Check for contradictions ───────────────────────────
    const recentSignals = getRecentSignals(signals, 7);
    const counts = getSignalCounts(recentSignals);
    // High approval + high correction = contradictory signals
    if ((counts.approval ?? 0) > 5 && (counts.correction ?? 0) > 5) {
        const ratio = (counts.approval ?? 0) / ((counts.correction ?? 0) || 1);
        if (ratio > 0.5 && ratio < 2) {
            result.contradictions.push('Mixed signals: approval and correction rates are both high. ' +
                'User may be in a transition period or the agent is inconsistent.');
        }
    }
    // Sycophancy check: if approval rate is suspiciously high
    if (profile.stats.approvalRate > SYCOPHANCY_APPROVAL_THRESHOLD && profile.stats.totalSignals > 30) {
        result.contradictions.push(`Warning: approval rate is above ${Math.round(SYCOPHANCY_APPROVAL_THRESHOLD * 100)}%. Check for sycophancy drift. ` +
            'The agent may be optimizing for agreement over honesty.');
    }
    // ── 4. Update session count and save ──────────────────────
    traitState.sessionsAnalyzed = history.length;
    traitState.lastConsolidation = new Date().toISOString();
    saveTraitState(config, traitState);
    // ── 5. Prune old applied/rejected proposals (V-010) ───────
    pruneOldProposals(config, 90);
    return result;
}
/**
 * Record a session summary for future consolidation.
 */
export function recordSessionSummary(config, session, signalCounts) {
    // Find dominant emotion
    const tone = session.emotionalTone;
    const emotions = Object.entries(tone);
    emotions.sort((a, b) => b[1] - a[1]);
    const dominant = emotions[0]?.[0] ?? 'neutral';
    // Calculate average valence/arousal
    const positive = tone.joy + tone.trust + tone.anticipation;
    const negative = tone.anger + tone.sadness + tone.disgust + tone.fear;
    const total = positive + negative || 1;
    appendSessionHistory(config, {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        messageCount: session.messageCount,
        avgValence: (positive - negative) / total,
        avgArousal: (tone.anger + tone.joy + tone.surprise + tone.anticipation + tone.fear) / 5,
        dominantEmotion: dominant,
        styleSnapshot: { ...session.styleVector },
        signalCounts,
    });
}
// ── Helpers ────────────────────────────────────────────────────────
function averageStyle(snapshots) {
    const n = snapshots.length || 1;
    const sum = { formality: 0, energy: 0, verbosity: 0, humor: 0, specificity: 0 };
    for (const s of snapshots) {
        sum.formality += s.formality;
        sum.energy += s.energy;
        sum.verbosity += s.verbosity;
        sum.humor += s.humor;
        sum.specificity += s.specificity;
    }
    return {
        formality: sum.formality / n,
        energy: sum.energy / n,
        verbosity: sum.verbosity / n,
        humor: sum.humor / n,
        specificity: sum.specificity / n,
    };
}
//# sourceMappingURL=consolidation.js.map