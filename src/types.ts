// ── Soul Files ───────────────────────────────────────────────────────

export interface SoulFiles {
  personality: string;
  style: string;
  skill: string;
}

export const SOUL_FILE_NAMES: (keyof SoulFiles)[] = ['personality', 'style', 'skill'];

// ── Roles ────────────────────────────────────────────────────────────
// Roles are domain overlays layered on top of the soul. Soul = WHO I am
// (voice, tone). Role = WHAT I'm doing (developer, designer, pm…).
// Roles are user-territory like soul files — przm Voice never auto-writes them.

export interface RoleFile {
  name: string;
  content: string;
}

// Bundled roles ship as on-disk files in persona/presets/roles/<name>/ROLE.md
// rather than inline strings so the library can be edited and grown without
// rebuilding the package. role.ts resolves the presets directory relative to
// the compiled file location at runtime.

// ── Journal ──────────────────────────────────────────────────────────
// przm Voice's auto-derived notes. Live in dataDir/journal/, separate from
// soul/ so user edits to soul are sacred. applyProposal writes here.

export interface JournalFiles {
  personality: string;
  style: string;
  skill: string;
}

// ── Behavioral Signals ──────────────────────────────────────────────

export type SignalType =
  | 'correction'       // User corrected a response
  | 'approval'         // User approved / accepted / thanked
  | 'satisfaction'     // User confirmed a task landed / outcome was good
  | 'frustration'      // User expressed frustration
  | 'elaboration'      // User asked for more detail
  | 'simplification'   // User asked to simplify
  | 'confusion'        // User signaled they don't understand
  | 'curiosity'        // User asked an exploratory follow-up
  | 'preference'       // User declared a stable preference going forward
  | 'code_accepted'    // User used generated code
  | 'code_rejected'    // User rejected generated code
  | 'task_complete'    // User confirmed a non-code task was completed
  | 'task_abandoned'   // User gave up on or dropped a task
  | 'regen_request'    // Asked to regenerate / try again
  | 'explicit_feedback' // Direct feedback about behavior
  | 'style_correction' // User corrected tone / format / style
  | 'praise'           // User praised a specific approach
  | 'abandonment'      // User abruptly changed topic
  | 'topic_shift'      // User changed subject entirely
  | 're_ask'           // User asked something they asked before
  // ── Big Five movement signals ─────────────────────────────────────
  // Direct "this user is showing themselves as X / wants me to be more
  // X on Y axis." Distinct from the inferred-from-text Big Five pipeline;
  // these are explicit nudges that callers (benchmarks, advanced
  // integrations) can use to move traits directly.
  | 'extraversion_positive'
  | 'extraversion_negative'
  | 'openness_positive'
  | 'openness_negative'
  | 'conscientiousness_positive'
  | 'conscientiousness_negative'
  | 'agreeableness_positive'
  | 'agreeableness_negative'
  | 'neuroticism_positive'
  | 'neuroticism_negative';

export interface BehavioralSignal {
  id: string;
  type: SignalType;
  content: string;      // What triggered the signal
  context?: string;     // Optional surrounding context
  category?: string;    // Topic category (code, writing, research, etc.)
  timestamp: string;
}

// ── Behavioral Profile ──────────────────────────────────────────────

export interface StylePreferences {
  verbosity: number;            // -1 (terse) to 1 (verbose)
  opinionStrength: number;      // -1 (neutral) to 1 (opinionated)
  codeToExplanation: number;    // 0 (all explanation) to 1 (all code)
  prefersCodeFirst: boolean;
  prefersBulletPoints: boolean;
  prefersDirectAnswers: boolean;
  deepDiveTopics: string[];     // Topics where user wants MORE detail
  quickAnswerTopics: string[];  // Topics where user wants LESS detail
  avoidPatterns: string[];      // Things user dislikes ("don't summarize", "no emojis")
  preferredPatterns: string[];  // Things user likes ("show code first", "be direct")
}

/** Soft cap on pinnedFeedback length. voice_feedback_pin enforces this;
 *  voice_stats warns when pinned count exceeds MAX_PINNED_FEEDBACK_WARN. */
export const MAX_PINNED_FEEDBACK = 50;
export const MAX_PINNED_FEEDBACK_WARN = 30;

export interface BehavioralProfile {
  stats: {
    totalSignals: number;
    correctionRate: number;     // 0-1
    approvalRate: number;       // 0-1
    frustrationRate: number;    // 0-1
    avgSatisfaction: number;    // 0-1
  };
  stylePreferences: StylePreferences;
  topicPreferences: Record<string, {
    verbosity: number;
    satisfaction: number;
    signalCount: number;
  }>;
  recentFeedback: string[];     // Last 10 explicit feedback items (FIFO)
  pinnedFeedback: string[];     // User-tagged entries; capped at MAX_PINNED_FEEDBACK
  lastUpdated: string;
}

export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
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

export const DEFAULT_PROFILE: BehavioralProfile = {
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

// ── Evolution Proposals ─────────────────────────────────────────────

export type ProposalType = 'personality_edit' | 'style_edit' | 'skill_edit' | 'new_pattern';

export interface EvolutionProposal {
  id: string;
  type: ProposalType;
  target: keyof SoulFiles;
  action: 'add' | 'remove' | 'replace';
  content: string;           // What to add/change
  oldContent?: string;       // What to replace (for replace action)
  rationale: string;         // Why, backed by evidence
  evidence: Array<{
    signalType: SignalType;
    count: number;
  }>;
  confidence: number;        // 0-1
  status: 'pending' | 'applied' | 'rejected';
  createdAt: string;
}

// ── Emotional Tone (Plutchik-based) ────────────────────────────────

export interface EmotionalTone {
  joy: number;           // 0-1
  trust: number;
  fear: number;
  surprise: number;
  sadness: number;
  disgust: number;
  anger: number;
  anticipation: number;
}

export const NEUTRAL_TONE: EmotionalTone = {
  joy: 0, trust: 0, fear: 0, surprise: 0,
  sadness: 0, disgust: 0, anger: 0, anticipation: 0,
};

// ── Big Five / OCEAN Traits ────────────────────────────────────────

export interface BigFiveTraits {
  openness: number;          // 0-1
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  sampleCount: number;       // interactions analyzed
  reliable: boolean;         // true after 15+ samples
}

export const DEFAULT_BIG_FIVE: BigFiveTraits = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
  agreeableness: 0.5, neuroticism: 0.5,
  sampleCount: 0, reliable: false,
};

// ── Style Mirroring Vector ─────────────────────────────────────────

export interface StyleVector {
  formality: number;     // 0 (casual) to 1 (formal)
  energy: number;        // 0 (subdued) to 1 (high energy)
  verbosity: number;     // 0 (terse) to 1 (verbose)
  humor: number;         // 0 (serious) to 1 (playful)
  specificity: number;   // 0 (abstract) to 1 (concrete)
}

export const DEFAULT_STYLE_VECTOR: StyleVector = {
  formality: 0.5, energy: 0.5, verbosity: 0.5, humor: 0, specificity: 0.5,
};

// ── Cognitive Load ─────────────────────────────────────────────────

export interface CognitiveLoadState {
  load: number;          // 0 (flow) to 1 (overloaded)
  inFlow: boolean;
  overloaded: boolean;
  messageLengthTrend: number[];  // rolling window
  questionRepeatCount: number;
}

export const DEFAULT_COGNITIVE_LOAD: CognitiveLoadState = {
  load: 0.3, inFlow: false, overloaded: false,
  messageLengthTrend: [], questionRepeatCount: 0,
};

// ── Two-Timescale State ────────────────────────────────────────────

export interface SessionState {
  emotionalTone: EmotionalTone;
  styleVector: StyleVector;
  // Fast-decay per-session style mirror. Distinct from the long-running
  // traitState.baselineStyleVector — this is "what does the user sound
  // like RIGHT NOW," EMA-blended at alpha=0.3 for ~3-turn responsiveness.
  // Null until the first observation; resets between sessions.
  currentStyleVector: StyleVector | null;
  cognitiveLoad: CognitiveLoadState;
  messageCount: number;
  startedAt: string;
  recentMessages: string[];  // rolling window of last 5 messages for micro-expression detection
}

export interface TraitState {
  bigFive: BigFiveTraits;
  baselineStyleVector: StyleVector;
  emotionalAssociations: EmotionalAssociation[];
  sessionsAnalyzed: number;
  lastConsolidation: string;
  domainTechnicalRatio: number;  // 0 (casual) to 1 (fully technical), EMA-tracked
}

export interface EmotionalAssociation {
  topic: string;
  valence: number;       // -1 (negative) to 1 (positive)
  arousal: number;       // 0 to 1
  exposureCount: number;
  lastSeen: string;
}

export const DEFAULT_SESSION_STATE: SessionState = {
  emotionalTone: { ...NEUTRAL_TONE },
  styleVector: { ...DEFAULT_STYLE_VECTOR },
  currentStyleVector: null,
  cognitiveLoad: { ...DEFAULT_COGNITIVE_LOAD },
  messageCount: 0,
  startedAt: new Date().toISOString(),
  recentMessages: [],
};

export const DEFAULT_TRAIT_STATE: TraitState = {
  bigFive: { ...DEFAULT_BIG_FIVE },
  baselineStyleVector: { ...DEFAULT_STYLE_VECTOR },
  emotionalAssociations: [],
  sessionsAnalyzed: 0,
  lastConsolidation: new Date().toISOString(),
  domainTechnicalRatio: 0,
};

// ── Config ──────────────────────────────────────────────────────────

export interface PersonaConfig {
  dataDir: string;
  maxSignals: number;
  proposalThreshold: number;  // Signals before generating proposals
}

export const DEFAULT_CONFIG: PersonaConfig = {
  dataDir: '',
  maxSignals: 500,
  proposalThreshold: 12,
};
