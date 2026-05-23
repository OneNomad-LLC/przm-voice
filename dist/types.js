// ── Soul Files ───────────────────────────────────────────────────────
export const SOUL_FILE_NAMES = ['personality', 'style', 'skill'];
/** Soft cap on pinnedFeedback length. voice_feedback_pin enforces this;
 *  voice_stats warns when pinned count exceeds MAX_PINNED_FEEDBACK_WARN. */
export const MAX_PINNED_FEEDBACK = 50;
export const MAX_PINNED_FEEDBACK_WARN = 30;
export const DEFAULT_STYLE_PREFERENCES = {
    verbosity: 0,
    opinionStrength: 0,
    codeToExplanation: 0.5,
    prefersCodeFirst: false,
    prefersBulletPoints: false,
    prefersDirectAnswers: true,
    deepDiveTopics: [],
    quickAnswerTopics: [],
    avoidPatterns: [],
    preferredPatterns: [],
};
export const DEFAULT_PROFILE = {
    stats: {
        totalSignals: 0,
        correctionRate: 0,
        approvalRate: 0,
        frustrationRate: 0,
        avgSatisfaction: 0.5,
    },
    stylePreferences: { ...DEFAULT_STYLE_PREFERENCES },
    topicPreferences: {},
    recentFeedback: [],
    pinnedFeedback: [],
    lastUpdated: new Date().toISOString(),
};
export const NEUTRAL_TONE = {
    joy: 0, trust: 0, fear: 0, surprise: 0,
    sadness: 0, disgust: 0, anger: 0, anticipation: 0,
};
export const DEFAULT_BIG_FIVE = {
    openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
    agreeableness: 0.5, neuroticism: 0.5,
    sampleCount: 0, reliable: false,
};
export const DEFAULT_STYLE_VECTOR = {
    formality: 0.5, energy: 0.5, verbosity: 0.5, humor: 0, specificity: 0.5,
};
export const DEFAULT_COGNITIVE_LOAD = {
    load: 0.3, inFlow: false, overloaded: false,
    messageLengthTrend: [], questionRepeatCount: 0,
};
export const DEFAULT_SESSION_STATE = {
    emotionalTone: { ...NEUTRAL_TONE },
    styleVector: { ...DEFAULT_STYLE_VECTOR },
    currentStyleVector: null,
    cognitiveLoad: { ...DEFAULT_COGNITIVE_LOAD },
    messageCount: 0,
    startedAt: new Date().toISOString(),
    recentMessages: [],
};
export const DEFAULT_TRAIT_STATE = {
    bigFive: { ...DEFAULT_BIG_FIVE },
    baselineStyleVector: { ...DEFAULT_STYLE_VECTOR },
    emotionalAssociations: [],
    sessionsAnalyzed: 0,
    lastConsolidation: new Date().toISOString(),
    domainTechnicalRatio: 0,
};
// ── Sycophancy threshold ────────────────────────────────────────────
// Single canonical threshold used by both adaptations.ts (in-prompt
// self-check) and consolidation.ts (warning on consolidation report).
// Keeping one constant prevents the 80%/85% split that silently lets
// 80-85% approval rates get a consolidation warning but no live check.
export const SYCOPHANCY_APPROVAL_THRESHOLD = 0.85;
export const DEFAULT_CONFIG = {
    dataDir: '',
    maxSignals: 500,
    proposalThreshold: 12,
};
//# sourceMappingURL=types.js.map