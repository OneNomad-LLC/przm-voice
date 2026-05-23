import type {
  EmotionalTone,
  EmotionalAssociation,
  PersonaConfig,
  TraitState,
} from './types.js';
import { NEUTRAL_TONE, DEFAULT_TRAIT_STATE } from './types.js';
import { getStorage } from './storage/index.js';

/**
 * Emotional tone detection based on Plutchik's wheel of emotions.
 *
 * 8 primary emotions as basis vectors. Compound emotions emerge naturally
 * from the vector (contempt = anger + disgust, awe = surprise + fear, etc.)
 *
 * Also detects "text micro-expressions" -- involuntary leakage through
 * punctuation shifts, message length changes, lexical regression, and
 * pronoun shifts. Based on Ekman's micro-expression research adapted for text.
 *
 * Emotional associations form asymmetrically: negative associations in 1-2
 * exposures (learning rate 0.8), positive need 5-10 (learning rate 0.2).
 * Modeled after amygdala emotional memory encoding.
 */

// ── Lexicons ───────────────────────────────────────────────────────

const EMOTION_LEXICON: Record<keyof EmotionalTone, RegExp[]> = {
  joy: [
    /\b(happy|glad|great|awesome|love|perfect|excellent|amazing|wonderful|fantastic|nice|cool|sweet|yay|yep|yes)\b/i,
    /\b(haha|lol|lmao|rofl|😊|😄|🎉|❤️)\b/i,
    /(!{2,})/,
  ],
  trust: [
    /\b(trust|reliable|solid|consistent|dependable|sure|definitely|absolutely|agree|exactly|right)\b/i,
    /\b(thanks|thank you|appreciate|grateful)\b/i,
  ],
  fear: [
    /\b(afraid|scared|worried|nervous|anxious|panic|terrified|dread|risky|dangerous)\b/i,
    /\b(careful|watch out|be careful|warning|uh oh)\b/i,
  ],
  surprise: [
    /\b(wow|whoa|really|seriously|no way|wait what|holy|damn|unexpected|shocking)\b/i,
    /\b(didn't expect|surprised|huh|wtf|omg)\b/i,
    /(\?{2,})/,
  ],
  sadness: [
    /\b(sad|disappointed|unfortunately|sucks|miss|lost|gone|depressing|bummer|damn)\b/i,
    /\b(too bad|wish|if only|regret)\b/i,
    /\.{3,}/,  // trailing ellipses
  ],
  disgust: [
    /\b(gross|disgusting|awful|terrible|horrible|worst|hate|despise|ugh|ew|yuck)\b/i,
    /\b(garbage|trash|crap|crapshoot|dumpster)\b/i,
  ],
  anger: [
    /\b(angry|furious|pissed|frustrated|annoyed|mad|rage|stupid|ridiculous|insane)\b/i,
    /\b(wtf|bs|bullshit|fuck|shit|dammit|damn)\b/i,
    /[A-Z]{3,}/,  // SHOUTING
  ],
  anticipation: [
    /\b(hope|expect|looking forward|can't wait|excited|soon|plan|going to|gonna|want to|need to)\b/i,
    /\b(next|upcoming|tomorrow|later|ready)\b/i,
  ],
};

// ── Core Detection ─────────────────────────────────────────────────

/**
 * Detect emotional tone from a single message.
 * Returns an 8-dimensional vector with scores 0-1 per emotion.
 */
export function detectEmotionalTone(message: string, recentMessages?: string[]): EmotionalTone {
  const tone: EmotionalTone = { ...NEUTRAL_TONE };
  const lower = message.toLowerCase();
  const wordCount = message.split(/\s+/).length || 1;

  for (const [emotion, patterns] of Object.entries(EMOTION_LEXICON) as [keyof EmotionalTone, RegExp[]][]) {
    let hits = 0;
    for (const pattern of patterns) {
      const matches = message.match(pattern);
      if (matches) hits += matches.length;
    }
    // Normalize by message length, cap at 1
    tone[emotion] = Math.min(1, hits / Math.max(3, wordCount * 0.3));
  }

  // Boost from micro-expression signals (now with message history)
  const microSignals = detectMicroExpressions(message, recentMessages);
  if (microSignals.energyDrop) {
    tone.sadness = Math.min(1, tone.sadness + 0.2);
    tone.anger = Math.min(1, tone.anger + 0.1);
  }
  if (microSignals.shouting) {
    tone.anger = Math.min(1, tone.anger + 0.3);
  }
  if (microSignals.hedging) {
    tone.fear = Math.min(1, tone.fear + 0.15);
  }
  if (microSignals.lexicalRegression) {
    tone.sadness = Math.min(1, tone.sadness + 0.15);
    tone.fear = Math.min(1, tone.fear + 0.1);
  }
  if (microSignals.pronounShift) {
    tone.anger = Math.min(1, tone.anger + 0.15);
    tone.disgust = Math.min(1, tone.disgust + 0.1);
  }

  return tone;
}

// ── Micro-Expression Detection ─────────────────────────────────────

interface MicroSignals {
  energyDrop: boolean;     // sudden message shortening
  shouting: boolean;       // ALL CAPS words
  hedging: boolean;        // uncertainty language clustering
  lexicalRegression: boolean;  // domain terms to simple words
  pronounShift: boolean;   // "we" to "you" (distancing)
}

export function detectMicroExpressions(message: string, recentMessages?: string[]): MicroSignals {
  const words = message.split(/\s+/);
  const history = recentMessages ?? [];

  return {
    energyDrop: detectEnergyDrop(message, history),
    shouting: (message.match(/\b[A-Z]{3,}\b/g) || []).length >= 2,
    hedging: countHedges(message) >= 3,
    lexicalRegression: detectLexicalRegression(message, history),
    pronounShift: detectPronounShift(message, history),
  };
}

/**
 * Detect energy drop: current message is significantly shorter than recent average.
 */
function detectEnergyDrop(message: string, history: string[]): boolean {
  if (history.length < 2) return false;
  const recentLengths = history.slice(-3).map(m => m.length);
  const avg = recentLengths.reduce((a, b) => a + b, 0) / recentLengths.length;
  return avg > 50 && message.length < avg * 0.3;
}

/**
 * Detect lexical regression: vocabulary complexity dropping from technical to simple.
 * Uses type-token ratio (unique words / total words) as a proxy for vocabulary complexity.
 */
function detectLexicalRegression(message: string, history: string[]): boolean {
  if (history.length < 2) return false;

  const complexity = (text: string): number => {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length < 3) return 0;
    const unique = new Set(words);
    const longWords = words.filter(w => w.length > 7).length;
    return (unique.size / words.length) * 0.5 + (longWords / words.length) * 0.5;
  };

  const historyComplexity = history.slice(-3).map(complexity);
  const avgComplexity = historyComplexity.reduce((a, b) => a + b, 0) / historyComplexity.length;
  const currentComplexity = complexity(message);

  // Significant drop in vocabulary complexity
  return avgComplexity > 0.3 && currentComplexity < avgComplexity * 0.5;
}

/**
 * Detect pronoun shift: "we/us/our" shifting to "you/your" indicates distancing.
 */
function detectPronounShift(message: string, history: string[]): boolean {
  if (history.length < 2) return false;

  const inclusivePronouns = /\b(we|us|our|ours|ourselves|let's)\b/gi;
  const distancingPronouns = /\b(you|your|yours|yourself)\b/gi;

  const recentTexts = history.slice(-3);
  const histInclusive = recentTexts.reduce((sum, t) => sum + (t.match(inclusivePronouns) || []).length, 0);
  const histDistancing = recentTexts.reduce((sum, t) => sum + (t.match(distancingPronouns) || []).length, 0);

  const curInclusive = (message.match(inclusivePronouns) || []).length;
  const curDistancing = (message.match(distancingPronouns) || []).length;

  // Shift: history was mostly inclusive, now mostly distancing
  return histInclusive > histDistancing && curDistancing > curInclusive && curDistancing >= 2;
}

function countHedges(message: string): number {
  const hedges = /\b(maybe|perhaps|possibly|sort of|kind of|I think|I guess|not sure|might|probably|seems like)\b/gi;
  return (message.match(hedges) || []).length;
}

// ── Plutchik Dyad Detection ───────────────────────────────────────

/**
 * Detect compound emotions (dyads) from the 8-dimensional tone vector.
 * Primary dyads are adjacent emotions on Plutchik's wheel.
 * Secondary dyads are two petals apart. Tertiary are three apart.
 *
 * Returns detected dyads with their intensity.
 */
export interface DetectedDyad {
  name: string;
  intensity: number;  // average of the two component emotions
  components: [keyof EmotionalTone, keyof EmotionalTone];
}

const PRIMARY_DYADS: Array<{ name: string; a: keyof EmotionalTone; b: keyof EmotionalTone }> = [
  { name: 'love',           a: 'joy',          b: 'trust' },
  { name: 'submission',     a: 'trust',        b: 'fear' },
  { name: 'awe',            a: 'fear',         b: 'surprise' },
  { name: 'disapproval',    a: 'surprise',     b: 'sadness' },
  { name: 'remorse',        a: 'sadness',      b: 'disgust' },
  { name: 'contempt',       a: 'disgust',      b: 'anger' },
  { name: 'aggressiveness', a: 'anger',        b: 'anticipation' },
  { name: 'optimism',       a: 'anticipation', b: 'joy' },
];

const SECONDARY_DYADS: Array<{ name: string; a: keyof EmotionalTone; b: keyof EmotionalTone }> = [
  { name: 'guilt',      a: 'joy',          b: 'fear' },
  { name: 'curiosity',  a: 'trust',        b: 'surprise' },
  { name: 'despair',    a: 'fear',         b: 'sadness' },
  { name: 'envy',       a: 'sadness',      b: 'anger' },
  { name: 'cynicism',   a: 'disgust',      b: 'anticipation' },
  { name: 'pride',      a: 'anger',        b: 'joy' },
  { name: 'hope',       a: 'anticipation', b: 'trust' },
  { name: 'shock',      a: 'surprise',     b: 'disgust' },
];

const DYAD_THRESHOLD = 0.25;  // both components must be above this

export function detectDyads(tone: EmotionalTone): DetectedDyad[] {
  const dyads: DetectedDyad[] = [];

  for (const { name, a, b } of PRIMARY_DYADS) {
    if (tone[a] >= DYAD_THRESHOLD && tone[b] >= DYAD_THRESHOLD) {
      dyads.push({ name, intensity: (tone[a] + tone[b]) / 2, components: [a, b] });
    }
  }

  for (const { name, a, b } of SECONDARY_DYADS) {
    if (tone[a] >= DYAD_THRESHOLD && tone[b] >= DYAD_THRESHOLD) {
      dyads.push({ name, intensity: (tone[a] + tone[b]) / 2 * 0.8, components: [a, b] });
    }
  }

  // Sort by intensity, strongest first
  dyads.sort((a, b) => b.intensity - a.intensity);
  return dyads;
}

// ── Emotional Valence (collapsed to single value) ──────────────────

/**
 * Collapse the 8-dim vector to a single valence score (-1 to 1).
 * Positive emotions push toward 1, negative toward -1.
 */
export function emotionalValence(tone: EmotionalTone): number {
  const positive = tone.joy + tone.trust + tone.anticipation + tone.surprise * 0.3;
  const negative = tone.anger + tone.sadness + tone.disgust + tone.fear;
  const total = positive + negative || 1;
  return (positive - negative) / total;
}

/**
 * Collapse to arousal (0 to 1). High-activation emotions push up.
 */
export function emotionalArousal(tone: EmotionalTone): number {
  const highArousal = tone.anger + tone.joy + tone.surprise + tone.anticipation + tone.fear;
  const lowArousal = tone.sadness + tone.trust;
  const total = highArousal + lowArousal || 1;
  return highArousal / total;
}

// ── Emotional Associations (amygdala-inspired) ─────────────────────

export function loadTraitState(_config: PersonaConfig): TraitState {
  return getStorage().getTraitState() ?? { ...DEFAULT_TRAIT_STATE };
}

export function saveTraitState(_config: PersonaConfig, state: TraitState): void {
  getStorage().putTraitState(state);
}

/**
 * Update emotional associations for a topic.
 * Negative associations form fast (amygdala one-shot learning),
 * positive associations form slowly (needs repeated exposure).
 *
 * V-015: positiveStreak counter prevents indefinite trapping in a
 * negative association — three consecutive positive exposures on a
 * previously-negative topic accelerate the positive learning rate.
 */
export function updateEmotionalAssociation(
  state: TraitState,
  topic: string,
  valence: number,
  arousal: number
): void {
  const existing = state.emotionalAssociations.find(a => a.topic === topic);

  // Asymmetric learning rates: negative fast (0.8), positive slow (0.2)
  let lr = valence < 0 ? 0.8 : 0.2;

  if (existing) {
    // V-015: track consecutive positive exposures on a previously-negative
    // association. Three in a row accelerates positive learning to 0.6,
    // letting the topic actually escape the negative trap.
    if (valence > 0 && existing.valence < 0) {
      existing.positiveStreak = (existing.positiveStreak ?? 0) + 1;
      if (existing.positiveStreak >= 3) {
        lr = 0.6;
      }
    } else {
      existing.positiveStreak = 0;
    }

    existing.valence = existing.valence * (1 - lr) + valence * lr;
    existing.arousal = existing.arousal * (1 - lr) + arousal * lr;
    existing.exposureCount++;
    existing.lastSeen = new Date().toISOString();
  } else {
    state.emotionalAssociations.push({
      topic,
      valence: valence < 0 ? valence : valence * 0.5,  // cautious on first positive
      arousal,
      exposureCount: 1,
      lastSeen: new Date().toISOString(),
      positiveStreak: 0,
    });
  }

  // V-014: cap at 50 associations. Score each by exposure × strength × recency
  // so a single strong negative event survives over many low-importance pings.
  if (state.emotionalAssociations.length > 50) {
    const now = Date.now();
    state.emotionalAssociations.sort((a, b) => scoreAssoc(b, now) - scoreAssoc(a, now));
    state.emotionalAssociations = state.emotionalAssociations.slice(0, 50);
  }
}

/**
 * V-014: composite eviction score blending exposure count, absolute valence,
 * and recency. Recency normalized to a 30-day half-life.
 */
function scoreAssoc(a: EmotionalAssociation, now: number): number {
  const ageDays = Math.max(0, (now - Date.parse(a.lastSeen)) / 86_400_000);
  const recencyWeight = Math.max(0, 1 - ageDays / 30);
  return a.exposureCount * 0.4 + Math.abs(a.valence) * 0.4 + recencyWeight * 0.2;
}

/**
 * Check if a topic has a negative emotional association.
 * Returns the association if found and negative, null otherwise.
 */
export function getEmotionalFlag(state: TraitState, topic: string): EmotionalAssociation | null {
  const assoc = state.emotionalAssociations.find(
    a => topic.toLowerCase().includes(a.topic.toLowerCase()) && a.valence < -0.3
  );
  return assoc ?? null;
}
