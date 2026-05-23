export interface SoulFiles {
    personality: string;
    style: string;
    skill: string;
}
export declare const SOUL_FILE_NAMES: (keyof SoulFiles)[];
export interface RoleFile {
    name: string;
    content: string;
}
export interface JournalFiles {
    personality: string;
    style: string;
    skill: string;
}
export type SignalType = 'correction' | 'approval' | 'satisfaction' | 'frustration' | 'elaboration' | 'simplification' | 'confusion' | 'curiosity' | 'preference' | 'code_accepted' | 'code_rejected' | 'task_complete' | 'task_abandoned' | 'regen_request' | 'explicit_feedback' | 'style_correction' | 'praise' | 'abandonment' | 'topic_shift' | 're_ask' | 'extraversion_positive' | 'extraversion_negative' | 'openness_positive' | 'openness_negative' | 'conscientiousness_positive' | 'conscientiousness_negative' | 'agreeableness_positive' | 'agreeableness_negative' | 'neuroticism_positive' | 'neuroticism_negative';
export interface BehavioralSignal {
    id: string;
    type: SignalType;
    content: string;
    context?: string;
    category?: string;
    timestamp: string;
}
export interface StylePreferences {
    verbosity: number;
    opinionStrength: number;
    codeToExplanation: number;
    prefersCodeFirst: boolean;
    prefersBulletPoints: boolean;
    prefersDirectAnswers: boolean;
    deepDiveTopics: string[];
    quickAnswerTopics: string[];
    avoidPatterns: string[];
    preferredPatterns: string[];
}
/** Soft cap on pinnedFeedback length. voice_feedback_pin enforces this;
 *  voice_stats warns when pinned count exceeds MAX_PINNED_FEEDBACK_WARN. */
export declare const MAX_PINNED_FEEDBACK = 50;
export declare const MAX_PINNED_FEEDBACK_WARN = 30;
export interface BehavioralProfile {
    stats: {
        totalSignals: number;
        correctionRate: number;
        approvalRate: number;
        frustrationRate: number;
        avgSatisfaction: number;
    };
    stylePreferences: StylePreferences;
    topicPreferences: Record<string, {
        verbosity: number;
        satisfaction: number;
        signalCount: number;
    }>;
    recentFeedback: string[];
    pinnedFeedback: string[];
    lastUpdated: string;
}
export declare const DEFAULT_STYLE_PREFERENCES: StylePreferences;
export declare const DEFAULT_PROFILE: BehavioralProfile;
export type ProposalType = 'personality_edit' | 'style_edit' | 'skill_edit' | 'new_pattern';
export interface EvolutionProposal {
    id: string;
    type: ProposalType;
    target: keyof SoulFiles;
    action: 'add' | 'remove' | 'replace';
    content: string;
    oldContent?: string;
    rationale: string;
    evidence: Array<{
        signalType: SignalType;
        count: number;
    }>;
    confidence: number;
    status: 'pending' | 'applied' | 'rejected';
    createdAt: string;
}
export interface EmotionalTone {
    joy: number;
    trust: number;
    fear: number;
    surprise: number;
    sadness: number;
    disgust: number;
    anger: number;
    anticipation: number;
}
export declare const NEUTRAL_TONE: EmotionalTone;
export interface BigFiveTraits {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
    sampleCount: number;
    reliable: boolean;
}
export declare const DEFAULT_BIG_FIVE: BigFiveTraits;
export interface StyleVector {
    formality: number;
    energy: number;
    verbosity: number;
    humor: number;
    specificity: number;
}
export declare const DEFAULT_STYLE_VECTOR: StyleVector;
export interface CognitiveLoadState {
    load: number;
    inFlow: boolean;
    overloaded: boolean;
    messageLengthTrend: number[];
    questionRepeatCount: number;
}
export declare const DEFAULT_COGNITIVE_LOAD: CognitiveLoadState;
export interface SessionState {
    emotionalTone: EmotionalTone;
    styleVector: StyleVector;
    currentStyleVector: StyleVector | null;
    cognitiveLoad: CognitiveLoadState;
    messageCount: number;
    startedAt: string;
    recentMessages: string[];
}
export interface TraitState {
    bigFive: BigFiveTraits;
    baselineStyleVector: StyleVector;
    emotionalAssociations: EmotionalAssociation[];
    sessionsAnalyzed: number;
    lastConsolidation: string;
    domainTechnicalRatio: number;
}
export interface EmotionalAssociation {
    topic: string;
    valence: number;
    arousal: number;
    exposureCount: number;
    lastSeen: string;
}
export declare const DEFAULT_SESSION_STATE: SessionState;
export declare const DEFAULT_TRAIT_STATE: TraitState;
export interface PersonaConfig {
    dataDir: string;
    maxSignals: number;
    proposalThreshold: number;
}
export declare const DEFAULT_CONFIG: PersonaConfig;
