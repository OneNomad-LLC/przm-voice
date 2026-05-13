import type { BehavioralProfile, PersonaConfig, SessionState, TraitState } from './types.js';
import { DEFAULT_SESSION_STATE, DEFAULT_TRAIT_STATE } from './types.js';
import { loadProfile } from './profile.js';
import { loadTraitState } from './emotions.js';
import { computeTargetStyle } from './traits.js';
import { getVerbosityMultiplier } from './cognitive-load.js';

/**
 * Real-time adaptations -- dynamic adjustments generated from the
 * behavioral profile, session state, and trait state.
 *
 * Unlike soul files (which change slowly via proposals), adaptations
 * are recalculated on every request. They're the "learned behavior" layer.
 *
 * Now integrates:
 * - Behavioral profile (signals-based)
 * - Emotional tone (Plutchik-based, per-session)
 * - Big Five traits (OCEAN, cross-session)
 * - Style mirroring vector (chameleon effect)
 * - Cognitive load awareness (flow/overload)
 * - Emotional associations (amygdala-inspired)
 * - Sycophancy resistance checks
 */

// Session state is held in memory by the server, passed in here
let currentSession: SessionState = { ...DEFAULT_SESSION_STATE };

export function setSessionState(session: SessionState): void {
  currentSession = session;
}

export function getSessionState(): SessionState {
  return currentSession;
}

export function getAdaptations(config: PersonaConfig, category?: string): string {
  const profile = loadProfile(config);
  const traitState = loadTraitState(config);
  const lines: string[] = [];

  const prefs = profile.stylePreferences;

  // ── Style Mirroring ──────────────────────────────────────────
  // Prefer the fast-decay currentStyleVector (alpha=0.3 per turn,
  // ~3-turn responsiveness) when it's been populated; fall back to
  // session.styleVector for backward compatibility.
  const userStyle = currentSession.currentStyleVector ?? currentSession.styleVector;
  const targetStyle = computeTargetStyle(userStyle, traitState.baselineStyleVector);

  if (targetStyle.formality < 0.35) {
    lines.push('Match the user\'s casual tone. No corporate speak.');
  } else if (targetStyle.formality > 0.65) {
    lines.push('Maintain a professional, polished register.');
  }

  if (targetStyle.energy > 0.6) {
    lines.push('User energy is high. Match their enthusiasm.');
  } else if (targetStyle.energy < 0.25) {
    lines.push('User energy is low. Keep it calm and measured.');
  }

  if (targetStyle.humor > 0.3) {
    lines.push('Humor is welcome. Keep it natural.');
  }

  if (targetStyle.specificity > 0.7) {
    lines.push('User is concrete and specific. Give examples, not frameworks.');
  } else if (targetStyle.specificity < 0.3) {
    lines.push('User thinks abstractly. Offer frameworks and concepts.');
  }

  // ── Cognitive Load ───────────────────────────────────────────
  const verbosityMult = getVerbosityMultiplier(currentSession.cognitiveLoad);
  if (currentSession.cognitiveLoad.inFlow) {
    lines.push('User is in flow. Be concise. Match their pace. Don\'t interrupt with unsolicited explanations.');
  } else if (currentSession.cognitiveLoad.overloaded) {
    lines.push('User appears cognitively overloaded. Break things into small chunks. Use numbered steps. Ask before continuing.');
  }

  // ── Verbosity ────────────────────────────────────────────────
  if (prefs.verbosity > 0.3) {
    lines.push('User prefers detailed, thorough responses. Include context and reasoning.');
  } else if (prefs.verbosity < -0.3 || verbosityMult < 0.6) {
    lines.push('User prefers terse, minimal responses. Lead with the answer, skip preamble.');
  }

  // ── Code style ───────────────────────────────────────────────
  if (prefs.prefersCodeFirst) {
    lines.push('User prefers seeing code first, explanation after.');
  }
  if (prefs.codeToExplanation > 0.7) {
    lines.push('User prefers code-heavy responses with minimal prose.');
  } else if (prefs.codeToExplanation < 0.3) {
    lines.push('User prefers explanation-heavy responses with code as support.');
  }

  // ── Communication style ──────────────────────────────────────
  if (prefs.prefersBulletPoints) {
    lines.push('User prefers bullet points and lists over paragraphs.');
  }
  if (prefs.prefersDirectAnswers) {
    lines.push('User values direct answers. Get to the point immediately.');
  }
  if (prefs.opinionStrength > 0.3) {
    lines.push('User appreciates opinionated responses. Share your recommendation clearly.');
  } else if (prefs.opinionStrength < -0.3) {
    lines.push('User prefers neutral, factual responses. Avoid strong opinions.');
  }

  // ── Big Five insights (only when reliable) ───────────────────
  if (traitState.bigFive.reliable) {
    const bf = traitState.bigFive;
    const domainNote = traitState.domainTechnicalRatio > 0.5
      ? ' (domain-adjusted for technical communication)'
      : '';
    if (bf.openness > 0.7) {
      lines.push(`User scores high on openness${domainNote}. Offer creative alternatives and hypotheticals.`);
    }
    if (bf.conscientiousness > 0.7) {
      lines.push(`User is highly conscientious${domainNote}. Be structured and precise.`);
    }
    if (bf.neuroticism > 0.6) {
      lines.push(`User may be stress-sensitive${domainNote}. Be reassuring without being patronizing.`);
    }
    if (bf.agreeableness < 0.3) {
      lines.push(`User is direct and blunt${domainNote}. Match that directness. Don't soften or hedge.`);
    }
  }

  // ── Emotional context ────────────────────────────────────────
  const tone = currentSession.emotionalTone;
  if (tone.anger > 0.4 || tone.disgust > 0.3) {
    lines.push('IMPORTANT: User frustration detected. Acknowledge it before problem-solving. Don\'t apologize repeatedly (that\'s sycophantic). Reflect, then act.');
  }
  if (tone.sadness > 0.4) {
    lines.push('User seems down. Be genuine and thoughtful. Don\'t dismiss or over-validate.');
  }
  if (tone.joy > 0.5 && tone.anticipation > 0.3) {
    lines.push('User is excited and engaged. Build on their energy.');
  }

  // ── Emotional associations (topic-specific caution) ──────────
  if (category) {
    const negAssoc = traitState.emotionalAssociations.find(
      a => category.toLowerCase().includes(a.topic.toLowerCase()) && a.valence < -0.3
    );
    if (negAssoc) {
      lines.push(`Caution: "${negAssoc.topic}" has negative emotional associations (${negAssoc.exposureCount} exposure(s)). Approach carefully.`);
    }
  }

  // ── Avoid patterns ───────────────────────────────────────────
  if (prefs.avoidPatterns.length > 0) {
    lines.push(`AVOID: ${prefs.avoidPatterns.join('; ')}`);
  }

  // ── Preferred patterns ───────────────────────────────────────
  if (prefs.preferredPatterns.length > 0) {
    lines.push(`User responds well to: ${prefs.preferredPatterns.join('; ')}`);
  }

  // ── Category-specific ────────────────────────────────────────
  if (category) {
    if (prefs.deepDiveTopics.includes(category)) {
      lines.push(`For ${category}, user wants extra detail and thorough coverage.`);
    }
    if (prefs.quickAnswerTopics.includes(category)) {
      lines.push(`For ${category}, user wants quick, concise answers.`);
    }

    const topicPref = profile.topicPreferences[category];
    if (topicPref && topicPref.satisfaction < 0.3 && topicPref.signalCount >= 5) {
      lines.push(`Warning: user satisfaction for ${category} is low. Review approach.`);
    }
  }

  // ── Explicit feedback (recent + pinned) ──────────────────────
  // Pinned entries are user-curated and always relevant; recent
  // entries are the last 10 (FIFO). Pinned leads so the model sees
  // the durable preferences first.
  const pinned = profile.pinnedFeedback ?? [];
  const recent = (profile.recentFeedback ?? []).slice(-3);
  if (pinned.length > 0) {
    lines.push(`Pinned user feedback: ${pinned.map(f => `"${f}"`).join(', ')}`);
  }
  if (recent.length > 0) {
    lines.push(`Recent user feedback: ${recent.map(f => `"${f}"`).join(', ')}`);
  }

  // ── Warning flags ────────────────────────────────────────────
  if (profile.stats.frustrationRate > 0.15) {
    lines.push('IMPORTANT: User frustration rate is elevated. Be extra careful with tone and accuracy.');
  }
  if (profile.stats.correctionRate > 0.2) {
    lines.push('User frequently corrects responses. Double-check accuracy before responding.');
  }

  // ── Sycophancy resistance ────────────────────────────────────
  if (profile.stats.approvalRate > 0.85 && profile.stats.totalSignals > 30) {
    lines.push('SELF-CHECK: Approval rate is very high. Make sure you\'re being honest, not just agreeable. Challenge assumptions when warranted.');
  }

  if (lines.length === 0) return '';
  return `--- LEARNED ADAPTATIONS ---\n${lines.join('\n')}`;
}

/**
 * Get a summary of the current profile for display.
 */
export function getProfileSummary(config: PersonaConfig): string {
  const profile = loadProfile(config);
  const traitState = loadTraitState(config);
  const lines: string[] = [];

  lines.push(`Signals recorded: ${profile.stats.totalSignals}`);
  lines.push(`Satisfaction: ${(profile.stats.avgSatisfaction * 100).toFixed(0)}%`);
  lines.push(`Correction rate: ${(profile.stats.correctionRate * 100).toFixed(0)}%`);
  lines.push(`Approval rate: ${(profile.stats.approvalRate * 100).toFixed(0)}%`);

  const prefs = profile.stylePreferences;
  if (prefs.verbosity !== 0) {
    lines.push(`Verbosity: ${prefs.verbosity > 0 ? 'detailed' : 'terse'} (${prefs.verbosity.toFixed(2)})`);
  }
  if (prefs.prefersCodeFirst) lines.push('Prefers: code first');
  if (prefs.prefersBulletPoints) lines.push('Prefers: bullet points');
  if (prefs.avoidPatterns.length > 0) lines.push(`Avoids: ${prefs.avoidPatterns.join(', ')}`);
  if (prefs.preferredPatterns.length > 0) lines.push(`Likes: ${prefs.preferredPatterns.join(', ')}`);

  // Big Five summary
  if (traitState.bigFive.reliable) {
    const bf = traitState.bigFive;
    const domainLabel = traitState.domainTechnicalRatio > 0.5 ? 'technical' : traitState.domainTechnicalRatio > 0.2 ? 'mixed' : 'casual';
    lines.push('');
    lines.push(`Big Five (${bf.sampleCount} samples, ${domainLabel} domain):`);
    lines.push(`  Openness: ${traitLabel(bf.openness)} (${bf.openness.toFixed(2)})`);
    lines.push(`  Conscientiousness: ${traitLabel(bf.conscientiousness)} (${bf.conscientiousness.toFixed(2)})`);
    lines.push(`  Extraversion: ${traitLabel(bf.extraversion)} (${bf.extraversion.toFixed(2)})`);
    lines.push(`  Agreeableness: ${traitLabel(bf.agreeableness)} (${bf.agreeableness.toFixed(2)})`);
    lines.push(`  Neuroticism: ${traitLabel(bf.neuroticism)} (${bf.neuroticism.toFixed(2)})`);
  } else if (traitState.bigFive.sampleCount > 0) {
    lines.push(`\nBig Five: building (${traitState.bigFive.sampleCount}/${15} samples needed)`);
  }

  // Emotional associations
  const negAssoc = traitState.emotionalAssociations.filter(a => a.valence < -0.3);
  if (negAssoc.length > 0) {
    lines.push(`\nSensitive topics: ${negAssoc.map(a => a.topic).join(', ')}`);
  }

  // Style baseline
  const sv = traitState.baselineStyleVector;
  lines.push('');
  lines.push('Style baseline:');
  lines.push(`  Formality: ${sv.formality < 0.4 ? 'casual' : sv.formality > 0.6 ? 'formal' : 'neutral'}`);
  lines.push(`  Energy: ${sv.energy < 0.3 ? 'low' : sv.energy > 0.6 ? 'high' : 'moderate'}`);
  lines.push(`  Humor: ${sv.humor < 0.15 ? 'rare' : sv.humor > 0.3 ? 'frequent' : 'occasional'}`);

  const topics = Object.entries(profile.topicPreferences)
    .filter(([, v]) => v.signalCount >= 3)
    .sort((a, b) => b[1].signalCount - a[1].signalCount)
    .slice(0, 5);

  if (topics.length > 0) {
    lines.push('\nTopic preferences:');
    for (const [topic, pref] of topics) {
      const vLabel = pref.verbosity > 0.2 ? 'detailed' : pref.verbosity < -0.2 ? 'brief' : 'normal';
      lines.push(`  ${topic}: ${vLabel}, satisfaction ${(pref.satisfaction * 100).toFixed(0)}%`);
    }
  }

  return lines.join('\n');
}

function traitLabel(score: number): string {
  if (score > 0.7) return 'high';
  if (score > 0.55) return 'moderate-high';
  if (score > 0.45) return 'moderate';
  if (score > 0.3) return 'moderate-low';
  return 'low';
}
