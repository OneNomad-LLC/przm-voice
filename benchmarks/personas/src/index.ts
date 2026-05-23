import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SignalType } from '@onenomad/przm-voice/dist/types.js';

export type PersonaName = 'alex' | 'morgan' | 'jordan' | 'sam';
export const PERSONA_NAMES: PersonaName[] = ['alex', 'morgan', 'jordan', 'sam'];

export interface PersonaSpec {
  name: PersonaName;
  displayName: string;
  tagline: string;
  styleVector: {
    formality: number;
    energy: number;
    verbosity: number;
    humor: number;
    specificity: number;
  };
  bigFive: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  stylePreferences: {
    verbosity: number;
    opinionStrength: number;
    prefersBulletPoints: boolean;
    prefersCodeFirst: boolean;
    prefersDirectAnswers: boolean;
    codeToExplanation: number;
    avoidPatterns?: string[];
    preferredPatterns?: string[];
  };
  positiveTriggers: string[];
  negativeTriggers: string[];
  shortResponseThreshold: number;
  longResponseThreshold: number;
  tldrRequiredAboveChars?: number;
  preambleRegex?: string;
  trailingSummaryRegex?: string;
  requiresAudienceFramingAboveChars?: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = join(HERE, '..');

const cache = new Map<PersonaName, PersonaSpec>();

export function loadPersona(name: PersonaName): PersonaSpec {
  const cached = cache.get(name);
  if (cached) return cached;
  const raw = readFileSync(join(PERSONAS_DIR, `${name}.json`), 'utf8');
  const spec = JSON.parse(raw) as PersonaSpec;
  cache.set(name, spec);
  return spec;
}

export function loadAllPersonas(): PersonaSpec[] {
  return PERSONA_NAMES.map(loadPersona);
}

/** Compile a positive/negative trigger regex once and cache. */
function compileTriggers(persona: PersonaSpec): { pos: RegExp[]; neg: RegExp[] } {
  return {
    pos: persona.positiveTriggers.map(p => new RegExp(p, 'iu')),
    neg: persona.negativeTriggers.map(p => new RegExp(p, 'iu')),
  };
}

const triggerCache = new Map<PersonaName, { pos: RegExp[]; neg: RegExp[] }>();

function getTriggers(persona: PersonaSpec): { pos: RegExp[]; neg: RegExp[] } {
  let t = triggerCache.get(persona.name);
  if (!t) {
    t = compileTriggers(persona);
    triggerCache.set(persona.name, t);
  }
  return t;
}

/**
 * Reaction features extracted from a candidate response. Exposed so
 * benches can record richer ground-truth diagnostics in receipts.
 */
export interface ReactionFeatures {
  posHits: number;
  negHits: number;
  length: number;
  hasCode: boolean;
  hasEmoji: boolean;
  hasPreamble: boolean;
  hasTrailingSummary: boolean;
  hasTldr: boolean;
  hasAudienceFraming: boolean;
}

export function extractFeatures(response: string, persona: PersonaSpec): ReactionFeatures {
  const t = getTriggers(persona);
  let posHits = 0;
  let negHits = 0;
  for (const r of t.pos) if (r.test(response)) posHits++;
  for (const r of t.neg) if (r.test(response)) negHits++;
  const emojiRe = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
  const codeRe = /```|^\s{4}|\b[A-Za-z_][A-Za-z0-9_]*\(/m;
  const preambleRe = persona.preambleRegex ? new RegExp(persona.preambleRegex, 'iu') : null;
  const trailingRe = persona.trailingSummaryRegex ? new RegExp(persona.trailingSummaryRegex, 'iu') : null;
  const tldrRe = /\btl[;]?dr\b|^bottom line/im;
  const audienceRe = /\b(your audience|the audience|target audience|reader|user|tone|voice|brand|narrative)\b/i;
  return {
    posHits,
    negHits,
    length: response.length,
    hasCode: codeRe.test(response),
    hasEmoji: emojiRe.test(response),
    hasPreamble: preambleRe ? preambleRe.test(response) : false,
    hasTrailingSummary: trailingRe ? trailingRe.test(response) : false,
    hasTldr: tldrRe.test(response),
    hasAudienceFraming: audienceRe.test(response),
  };
}

/**
 * Deterministic ground-truth reaction. Returns the set of signal
 * types the persona would emit in response to `candidate`. Empty
 * array means "no observable reaction" — neutral.
 *
 * Rules per persona:
 *
 *   Alex (generalist):
 *     - too short (< shortThreshold) -> elaboration
 *     - too long (> longThreshold) -> simplification
 *     - positive trigger -> approval
 *     - negative trigger -> correction
 *
 *   Morgan (exec):
 *     - long without TL;DR -> simplification + style_correction
 *     - any negative-trigger jargon hit -> correction (+ frustration if 2+)
 *     - bullet structure + ROI/revenue/risk phrasing -> approval
 *
 *   Jordan (IC):
 *     - emoji or preamble or trailing summary -> style_correction
 *     - "great question" / "happy to" -> correction (+ frustration)
 *     - too long for the question -> simplification
 *     - code present + terse -> code_accepted / approval
 *
 *   Sam (marketing):
 *     - pure code block, no prose -> correction
 *     - long-ish without audience framing -> elaboration (asks for "who's it for")
 *     - voice / brand / narrative present -> praise
 *     - clinical-only phrasing -> style_correction
 */
export function reactFor(persona: PersonaSpec, candidate: string): SignalType[] {
  const features = extractFeatures(candidate, persona);
  const out: SignalType[] = [];

  switch (persona.name) {
    case 'alex': {
      if (features.length < persona.shortResponseThreshold) out.push('elaboration');
      if (features.length > persona.longResponseThreshold) out.push('simplification');
      if (features.posHits >= 1) out.push('approval');
      if (features.negHits >= 1) out.push('correction');
      break;
    }
    case 'morgan': {
      const tldrRequired = persona.tldrRequiredAboveChars ?? 400;
      if (features.length > tldrRequired && !features.hasTldr) {
        out.push('simplification');
        out.push('style_correction');
      }
      if (features.length > persona.longResponseThreshold) out.push('simplification');
      if (features.negHits >= 1) out.push('correction');
      if (features.negHits >= 2) out.push('frustration');
      if (features.posHits >= 2) out.push('approval');
      break;
    }
    case 'jordan': {
      if (features.hasEmoji) out.push('style_correction');
      if (features.hasPreamble) out.push('style_correction');
      if (features.hasTrailingSummary) out.push('style_correction');
      if (/great question|i'?d be happy|certainly[,!]/i.test(candidate)) {
        out.push('correction');
        if (features.hasPreamble && features.hasTrailingSummary) out.push('frustration');
      }
      if (features.length > persona.longResponseThreshold && !features.hasCode) {
        out.push('simplification');
      }
      if (features.hasCode && features.length < 600 && features.negHits === 0) {
        out.push('code_accepted');
      }
      if (features.posHits >= 1 && features.negHits === 0 && out.length === 0) {
        out.push('approval');
      }
      break;
    }
    case 'sam': {
      const trimmed = candidate.trim();
      const isPureCode = /^```[\s\S]+```$/.test(trimmed);
      if (isPureCode) out.push('correction');
      const audienceThreshold = persona.requiresAudienceFramingAboveChars ?? 200;
      if (features.length > audienceThreshold && !features.hasAudienceFraming) {
        out.push('elaboration');
      }
      if (features.posHits >= 1) out.push('praise');
      if (features.negHits >= 1 && features.posHits === 0) out.push('style_correction');
      break;
    }
  }

  // Dedupe while preserving order.
  return Array.from(new Set(out));
}

/**
 * Score a single candidate from 0..1 representing how well it matches
 * the persona's preferences. Higher is better. Used by pair-preference
 * tasks to pick "the better response" deterministically.
 */
export { PROMPT_PAIRS, LABELED_MESSAGES, type PromptPair, type LabeledMessage } from './corpus.js';

export function preferenceScore(persona: PersonaSpec, candidate: string): number {
  const features = extractFeatures(candidate, persona);
  let score = 0.5;
  score += features.posHits * 0.15;
  score -= features.negHits * 0.20;

  switch (persona.name) {
    case 'alex':
      if (features.length < persona.shortResponseThreshold) score -= 0.15;
      if (features.length > persona.longResponseThreshold) score -= 0.10;
      break;
    case 'morgan':
      if (features.length > (persona.tldrRequiredAboveChars ?? 400) && !features.hasTldr) score -= 0.25;
      if (features.length > persona.longResponseThreshold) score -= 0.15;
      break;
    case 'jordan':
      if (features.hasPreamble) score -= 0.15;
      if (features.hasTrailingSummary) score -= 0.15;
      if (features.hasEmoji) score -= 0.20;
      if (features.hasCode) score += 0.15;
      if (features.length > persona.longResponseThreshold && !features.hasCode) score -= 0.10;
      break;
    case 'sam':
      if (features.hasAudienceFraming) score += 0.15;
      if (/^```[\s\S]+```$/.test(candidate.trim())) score -= 0.30;
      break;
  }

  return Math.max(0, Math.min(1, score));
}
