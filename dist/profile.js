import { DEFAULT_PROFILE } from './types.js';
import { getSignalCounts, getRecentSignals } from './signals.js';
import { getStorage } from './storage/index.js';
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
export function loadProfile(_config) {
    return getStorage().getProfile() ?? { ...DEFAULT_PROFILE };
}
/**
 * Persist a profile directly. Used by feedback pin/unpin which mutates
 * profile fields outside the signal-rebuild path.
 */
export function saveProfileExternal(config, profile) {
    saveProfile(config, profile);
}
function saveProfile(_config, profile) {
    profile.lastUpdated = new Date().toISOString();
    getStorage().putProfile(profile);
}
/**
 * Rebuild profile from current signal history.
 */
export function rebuildProfile(config, signals) {
    const profile = loadProfile(config);
    const recent = getRecentSignals(signals, 30);
    const counts = getSignalCounts(recent);
    const total = recent.length || 1;
    // ── Stats ─────────────────────────────────────────────────────
    profile.stats.totalSignals = signals.length;
    profile.stats.correctionRate = (counts.correction ?? 0) / total;
    profile.stats.approvalRate = ((counts.approval ?? 0) + (counts.praise ?? 0)) / total;
    profile.stats.frustrationRate = ((counts.frustration ?? 0) + (counts.abandonment ?? 0)) / total;
    // Satisfaction: approvals and praise increase, corrections and frustration decrease
    const positives = (counts.approval ?? 0) + (counts.praise ?? 0) + (counts.code_accepted ?? 0);
    const negatives = (counts.correction ?? 0) + (counts.frustration ?? 0) + (counts.code_rejected ?? 0) + (counts.abandonment ?? 0);
    profile.stats.avgSatisfaction = total > 0 ? Math.max(0, Math.min(1, 0.5 + (positives - negatives) / (total * 2))) : 0.5;
    // ── Style Preferences ─────────────────────────────────────────
    const prefs = profile.stylePreferences;
    // Verbosity: elaboration requests push positive, simplification pushes negative
    const elabCount = counts.elaboration ?? 0;
    const simpCount = counts.simplification ?? 0;
    if (elabCount + simpCount > 0) {
        const delta = (elabCount - simpCount) / (elabCount + simpCount);
        prefs.verbosity = clamp(prefs.verbosity * 0.7 + delta * 0.3, -1, 1);
    }
    // Extract patterns from signal content
    for (const signal of recent) {
        if (signal.type === 'style_correction' || signal.type === 'correction') {
            extractStylePatterns(signal, prefs);
        }
        if (signal.type === 'explicit_feedback') {
            // Skip if already captured (either in the rolling recent window
            // or curated into pinnedFeedback). Pinned is the canonical home;
            // we don't want recent to shadow it.
            const inRecent = profile.recentFeedback.includes(signal.content);
            const inPinned = (profile.pinnedFeedback ?? []).includes(signal.content);
            if (!inRecent && !inPinned) {
                profile.recentFeedback.push(signal.content);
                if (profile.recentFeedback.length > 10) {
                    profile.recentFeedback = profile.recentFeedback.slice(-10);
                }
            }
        }
        if (signal.type === 'praise') {
            extractPreferredPatterns(signal, prefs);
        }
    }
    // ── Topic Preferences ─────────────────────────────────────────
    for (const signal of recent) {
        if (!signal.category)
            continue;
        const cat = signal.category;
        if (!profile.topicPreferences[cat]) {
            profile.topicPreferences[cat] = { verbosity: 0, satisfaction: 0.5, signalCount: 0 };
        }
        const tp = profile.topicPreferences[cat];
        tp.signalCount++;
        if (signal.type === 'elaboration')
            tp.verbosity = clamp(tp.verbosity + 0.1, -1, 1);
        if (signal.type === 'simplification')
            tp.verbosity = clamp(tp.verbosity - 0.1, -1, 1);
        if (signal.type === 'approval' || signal.type === 'praise')
            tp.satisfaction = clamp(tp.satisfaction + 0.05, 0, 1);
        if (signal.type === 'correction' || signal.type === 'frustration')
            tp.satisfaction = clamp(tp.satisfaction - 0.05, 0, 1);
    }
    // Update deep-dive / quick-answer lists from topic preferences
    prefs.deepDiveTopics = Object.entries(profile.topicPreferences)
        .filter(([, v]) => v.verbosity > 0.3 && v.signalCount >= 3)
        .map(([k]) => k);
    prefs.quickAnswerTopics = Object.entries(profile.topicPreferences)
        .filter(([, v]) => v.verbosity < -0.3 && v.signalCount >= 3)
        .map(([k]) => k);
    saveProfile(config, profile);
    return profile;
}
// ── Pattern extraction from signal content ──────────────────────────
function extractStylePatterns(signal, prefs) {
    const lower = signal.content.toLowerCase();
    // Code-first detection
    if (lower.includes('show code') || lower.includes('code first')) {
        prefs.prefersCodeFirst = true;
    }
    if (lower.includes('explain first') || lower.includes('explain before')) {
        prefs.prefersCodeFirst = false;
    }
    // Bullet preference
    if (lower.includes('bullet') || lower.includes('list')) {
        prefs.prefersBulletPoints = true;
    }
    // Direct answers
    if (lower.includes('just answer') || lower.includes('straight answer') || lower.includes('get to the point')) {
        prefs.prefersDirectAnswers = true;
        prefs.verbosity = clamp(prefs.verbosity - 0.2, -1, 1);
    }
    // Avoid patterns
    const avoidMatches = lower.match(/(?:don't|do not|stop|never|no more)\s+(.{5,60})/);
    if (avoidMatches) {
        const pattern = avoidMatches[1].trim();
        if (!prefs.avoidPatterns.includes(pattern)) {
            prefs.avoidPatterns.push(pattern);
            if (prefs.avoidPatterns.length > 20)
                prefs.avoidPatterns = prefs.avoidPatterns.slice(-20);
        }
    }
    // Opinion strength
    if (lower.includes('your opinion') || lower.includes('what do you think')) {
        prefs.opinionStrength = clamp(prefs.opinionStrength + 0.1, -1, 1);
    }
    if (lower.includes('just the facts') || lower.includes('no opinion')) {
        prefs.opinionStrength = clamp(prefs.opinionStrength - 0.2, -1, 1);
    }
}
function extractPreferredPatterns(signal, prefs) {
    const lower = signal.content.toLowerCase();
    // Look for positive pattern signals
    const likeMatches = lower.match(/(?:like|love|prefer|keep|perfect|exactly)\s+(?:the |this |that |how you )?(.{5,60})/);
    if (likeMatches) {
        const pattern = likeMatches[1].trim();
        if (!prefs.preferredPatterns.includes(pattern)) {
            prefs.preferredPatterns.push(pattern);
            if (prefs.preferredPatterns.length > 20)
                prefs.preferredPatterns = prefs.preferredPatterns.slice(-20);
        }
    }
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
//# sourceMappingURL=profile.js.map