/**
 * Pair-preference prediction.
 *
 * Given Persona's current adaptations text (the prose directives
 * emitted by `getAdaptations`) and two candidate responses, predict
 * which one Persona "prefers" — meaning, which one Persona's evolved
 * state would steer a model toward producing.
 *
 * Implementation is intentionally simple and feature-driven: we extract
 * binary cues from the adaptations text (e.g. "prefers terse", "no
 * emoji", "code first", "bullet points") and score each candidate
 * against those cues. The winner is the higher-scoring candidate.
 *
 * The bench compares this prediction against the persona's deterministic
 * `preferenceScore` (in personas/src/index.ts). Accuracy is the bench's
 * primary metric.
 */

import { extractFeatures, type PersonaSpec } from '@onenomad/voice-bench-personas';

export interface AdaptationCues {
  prefersTerse: boolean;
  prefersVerbose: boolean;
  noEmoji: boolean;
  codeFirst: boolean;
  bulletPoints: boolean;
  directAnswers: boolean;
  matchCasual: boolean;
  matchFormal: boolean;
  hasAvoidPatterns: string[];
}

export function parseCues(adaptationsText: string): AdaptationCues {
  const t = adaptationsText.toLowerCase();
  const avoidMatch = adaptationsText.match(/AVOID:\s*([^\n]+)/);
  const avoid: string[] = avoidMatch
    ? avoidMatch[1].split(';').map(s => s.trim()).filter(Boolean)
    : [];
  return {
    prefersTerse: t.includes('terse') || t.includes('concise') || t.includes('brief') || t.includes('lead with the answer'),
    prefersVerbose: t.includes('detailed') || t.includes('thorough') || (t.includes('verbose') && !t.includes('not verbose')),
    noEmoji: t.includes('no emoji'),
    codeFirst: t.includes('code first') || t.includes('show code first'),
    bulletPoints: t.includes('bullet'),
    directAnswers: t.includes('direct answer') || t.includes('get to the point'),
    matchCasual: t.includes('casual') && !t.includes('not casual'),
    matchFormal: t.includes('professional') || t.includes('formal'),
    hasAvoidPatterns: avoid,
  };
}

export interface CandidateScore {
  score: number;
  reasons: string[];
}

export function scoreCandidate(
  candidate: string,
  cues: AdaptationCues,
  persona: PersonaSpec,
): CandidateScore {
  const features = extractFeatures(candidate, persona);
  let score = 0.5;
  const reasons: string[] = [];

  if (cues.prefersTerse) {
    if (features.length < 250) { score += 0.15; reasons.push('terse-match'); }
    if (features.length > 600) { score -= 0.20; reasons.push('terse-mismatch'); }
  }
  if (cues.prefersVerbose) {
    if (features.length > 250) { score += 0.10; reasons.push('verbose-match'); }
    if (features.length < 80) { score -= 0.10; reasons.push('verbose-mismatch'); }
  }
  if (cues.noEmoji && features.hasEmoji) { score -= 0.20; reasons.push('emoji-violation'); }
  if (cues.codeFirst && features.hasCode) { score += 0.15; reasons.push('code-first-match'); }
  if (cues.codeFirst && !features.hasCode) { score -= 0.10; reasons.push('code-first-miss'); }
  if (cues.bulletPoints) {
    if (/^- |^\d+\./m.test(candidate)) { score += 0.10; reasons.push('bullets-present'); }
    else { score -= 0.05; reasons.push('bullets-missing'); }
  }
  if (cues.directAnswers && features.hasPreamble) { score -= 0.10; reasons.push('preamble-penalty'); }
  if (features.hasTldr && cues.prefersTerse) { score += 0.10; reasons.push('tldr-bonus'); }

  // Avoid-pattern penalties (substring match in the candidate).
  for (const pat of cues.hasAvoidPatterns) {
    if (pat.length >= 3 && candidate.toLowerCase().includes(pat.toLowerCase())) {
      score -= 0.10;
      reasons.push(`avoid:${pat.slice(0, 30)}`);
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/**
 * Return 'A' or 'B' indicating which candidate Persona's current
 * adaptations prefer. Ties break toward A.
 */
export function predictPreference(
  adaptationsText: string,
  candidateA: string,
  candidateB: string,
  persona: PersonaSpec,
): { winner: 'A' | 'B'; scoreA: number; scoreB: number; reasons: { A: string[]; B: string[] } } {
  const cues = parseCues(adaptationsText);
  const a = scoreCandidate(candidateA, cues, persona);
  const b = scoreCandidate(candidateB, cues, persona);
  return {
    winner: a.score >= b.score ? 'A' : 'B',
    scoreA: a.score,
    scoreB: b.score,
    reasons: { A: a.reasons, B: b.reasons },
  };
}
