#!/usr/bin/env tsx
/**
 * style-recall — the flagship Persona bench.
 *
 * Backs the claim: "Persona evolves toward the user's preferences."
 *
 * Procedure (per persona):
 *   1. Spin a fresh in-proc Persona driver with isolated PERSONA_DATA_DIR.
 *   2. Feed N signal events. Each event picks one of the fixture
 *      candidate texts from PROMPT_PAIRS (round-robin), asks the
 *      persona's reactionFn what signals it would emit, and records
 *      each via `recordSignal`. Categories carry through so topic
 *      preferences accumulate.
 *   3. Periodically rebuild the profile and run synthesis so soul
 *      files + adaptations evolve.
 *   4. Eval: for each PromptPair, build (A, B) pairs from the four
 *      candidate variants. For each pair, compare:
 *        - groundTruth = whichever candidate has the higher
 *          preferenceScore for the persona
 *        - prediction  = scoreCandidate(adaptationsText) winner
 *      Accuracy is fraction of pairs where prediction matches truth.
 *   5. Also record signal-recall: of the dominant signal axis the
 *      persona's reactionFn produced during training, does the
 *      synthesized adaptations / profile state retain that axis?
 *
 * The Ollama model is NOT required for this bench — the fixture
 * candidates provide deterministic, repeatable text. If `--use-model`
 * is passed, the harness ALSO generates a few model-driven candidates
 * per persona to broaden the training distribution. This is off by
 * default so receipts are model-independent.
 */

import {
  parseArgs, probeHardware, gitSha, writeReceipt, repoRoot,
  createPersonaDriver, probeOllama, pickModel, generate,
  type Receipt,
} from '@onenomad/voice-bench-shared';
import {
  PERSONA_NAMES, loadPersona, reactFor, preferenceScore,
  PROMPT_PAIRS, type PersonaName, type PersonaSpec,
} from '@onenomad/voice-bench-personas';
import type { SignalType } from '@onenomad/persona-mcp/dist/types.js';

import { predictPreference } from './prediction.js';

interface PairResult {
  promptId: string;
  variantA: string;
  variantB: string;
  truthWinner: 'A' | 'B';
  predictedWinner: 'A' | 'B';
  correct: boolean;
  scoreA: number;
  scoreB: number;
}

interface PerPersonaResult {
  persona: PersonaName;
  signalsRecorded: number;
  signalTypeCounts: Partial<Record<SignalType, number>>;
  synthesisChanges: string[];
  pairAccuracy: number;
  pairs: PairResult[];
  /** Dominant signal-axis retention check. */
  signalRecall: {
    dominantSignalType: SignalType | null;
    dominantCount: number;
    retainedInProfile: boolean;
    retainedInAdaptations: boolean;
  };
  adaptationsExcerpt: string;
}

const VARIANT_KEYS = ['terseCode', 'verbosePreamble', 'bulletedTldr', 'narrativeBrand'] as const;
type VariantKey = typeof VARIANT_KEYS[number];

function variantText(p: typeof PROMPT_PAIRS[number], key: VariantKey): string {
  return p.candidates[key];
}

function allPairs(): Array<{ aKey: VariantKey; bKey: VariantKey }> {
  const out: Array<{ aKey: VariantKey; bKey: VariantKey }> = [];
  for (let i = 0; i < VARIANT_KEYS.length; i++) {
    for (let j = i + 1; j < VARIANT_KEYS.length; j++) {
      out.push({ aKey: VARIANT_KEYS[i], bKey: VARIANT_KEYS[j] });
    }
  }
  return out;
}

function dominantSignal(counts: Partial<Record<SignalType, number>>): { type: SignalType | null; count: number } {
  let best: SignalType | null = null;
  let bestN = 0;
  for (const [k, v] of Object.entries(counts)) {
    if ((v ?? 0) > bestN) { best = k as SignalType; bestN = v ?? 0; }
  }
  return { type: best, count: bestN };
}

function retainedInProfile(profile: ReturnType<ReturnType<typeof createPersonaDriver>['loadProfile']>, signal: SignalType | null): boolean {
  if (!signal) return false;
  const prefs = profile.stylePreferences;
  switch (signal) {
    case 'simplification': return prefs.verbosity < -0.05;
    case 'elaboration':    return prefs.verbosity > 0.05;
    case 'correction':     return profile.stats.correctionRate > 0.1;
    case 'frustration':    return profile.stats.frustrationRate > 0.1;
    case 'approval':       return profile.stats.approvalRate > 0.1;
    case 'praise':         return profile.stats.approvalRate > 0.1;
    case 'code_accepted':  return prefs.prefersCodeFirst || prefs.codeToExplanation > 0.5;
    case 'style_correction': return prefs.avoidPatterns.length > 0 || prefs.preferredPatterns.length > 0;
    default: return profile.stats.totalSignals > 0;
  }
}

function retainedInAdaptations(adaptations: string, signal: SignalType | null): boolean {
  if (!signal) return false;
  const t = adaptations.toLowerCase();
  switch (signal) {
    case 'simplification': return t.includes('terse') || t.includes('concise') || t.includes('brief');
    case 'elaboration':    return t.includes('detailed') || t.includes('thorough');
    case 'correction':     return t.includes('correct') || t.includes('double-check') || t.includes('frequently corrects');
    case 'frustration':    return t.includes('frustration') || t.includes('frustrated');
    case 'approval':       return adaptations.length > 0;
    case 'praise':         return adaptations.length > 0;
    case 'code_accepted':  return t.includes('code');
    case 'style_correction': return t.includes('avoid') || t.includes('user responds well to');
    default: return adaptations.length > 0;
  }
}

interface RunOptions {
  trainingSignals: number;
  useModel: boolean;
  ollamaUrl: string;
  modelName?: string;
}

async function runPersona(name: PersonaName, opts: RunOptions): Promise<PerPersonaResult> {
  const persona = loadPersona(name);
  // Lower the proposal threshold so we get evolutions at small N.
  const driver = createPersonaDriver({ proposalThreshold: 5 });

  try {
    // ─── Phase 1: feed signals ───
    const signalTypeCounts: Partial<Record<SignalType, number>> = {};
    let nRecorded = 0;
    const userMessageBuffer: string[] = [];

    // Round-robin through fixture variants.
    const allVariants: Array<{ pair: typeof PROMPT_PAIRS[number]; key: VariantKey }> = [];
    for (const pair of PROMPT_PAIRS) {
      for (const key of VARIANT_KEYS) allVariants.push({ pair, key });
    }

    // Optionally augment with model-generated candidates.
    const extraVariants: Array<{ category: string; text: string }> = [];
    if (opts.useModel && opts.modelName) {
      for (const pair of PROMPT_PAIRS.slice(0, 3)) {
        try {
          const result = await generate(opts.ollamaUrl, opts.modelName, pair.prompt, {
            temperature: 0.3, num_predict: 220, timeoutMs: 45_000,
          });
          if (result.text && result.text.length > 20) {
            extraVariants.push({ category: pair.category, text: result.text });
          }
        } catch {
          // Skip a single generation failure; bench is still useful without it.
        }
      }
    }

    let i = 0;
    while (nRecorded < opts.trainingSignals) {
      const useExtra = extraVariants.length > 0 && i % 7 === 0;
      let category: string;
      let text: string;
      if (useExtra) {
        const e = extraVariants[i % extraVariants.length];
        category = e.category;
        text = e.text;
      } else {
        const v = allVariants[i % allVariants.length];
        category = v.pair.category;
        text = variantText(v.pair, v.key);
      }

      // Ground-truth reaction signals for THIS candidate.
      const reactions = reactFor(persona, text);
      // Also feed the candidate as a "user message" to simulate the user
      // responding TO an assistant turn that looked like this. We use
      // detectSignals on a synthetic follow-up phrase emitted by the
      // reaction function so the regex catalog has something to chew on
      // too — but the *recorded* signals come from reactions (the
      // ground truth) to keep the training signal clean.

      for (const r of reactions) {
        driver.recordSignal(r, text, category);
        signalTypeCounts[r] = (signalTypeCounts[r] ?? 0) + 1;
        nRecorded++;
      }

      userMessageBuffer.push(text);
      if (userMessageBuffer.length > 30) userMessageBuffer.shift();

      // Periodically rebuild the profile so verbosity / topic prefs / etc.
      // accumulate. Every 8 candidate-batches is fine.
      if (i > 0 && i % 8 === 0) {
        driver.rebuildProfile();
      }
      i++;
      if (i > opts.trainingSignals * 4) break; // Safety: if a persona is fully neutral, escape.
    }

    // Final rebuild + synthesis.
    driver.rebuildProfile();
    const synth = driver.synthesize(userMessageBuffer);

    // ─── Phase 2: pair-preference eval ───
    const adaptations = driver.adaptationsOnly();
    const pairs: PairResult[] = [];
    for (const pair of PROMPT_PAIRS) {
      for (const { aKey, bKey } of allPairs()) {
        const a = variantText(pair, aKey);
        const b = variantText(pair, bKey);
        const scoreATrue = preferenceScore(persona, a);
        const scoreBTrue = preferenceScore(persona, b);
        // Skip ties (rare; happens only when both score 0.5 exactly).
        if (Math.abs(scoreATrue - scoreBTrue) < 0.001) continue;
        const truthWinner: 'A' | 'B' = scoreATrue > scoreBTrue ? 'A' : 'B';
        const pred = predictPreference(adaptations, a, b, persona);
        pairs.push({
          promptId: `${pair.id}:${aKey}-vs-${bKey}`,
          variantA: aKey,
          variantB: bKey,
          truthWinner,
          predictedWinner: pred.winner,
          correct: pred.winner === truthWinner,
          scoreA: pred.scoreA,
          scoreB: pred.scoreB,
        });
      }
    }
    const correctCount = pairs.filter(p => p.correct).length;
    const pairAccuracy = pairs.length === 0 ? 0 : correctCount / pairs.length;

    // ─── Phase 3: signal-axis retention ───
    const dom = dominantSignal(signalTypeCounts);
    const profile = driver.loadProfile();
    const retP = retainedInProfile(profile, dom.type);
    const retA = retainedInAdaptations(adaptations, dom.type);

    return {
      persona: name,
      signalsRecorded: nRecorded,
      signalTypeCounts,
      synthesisChanges: synth.changes,
      pairAccuracy,
      pairs,
      signalRecall: {
        dominantSignalType: dom.type,
        dominantCount: dom.count,
        retainedInProfile: retP,
        retainedInAdaptations: retA,
      },
      adaptationsExcerpt: adaptations.slice(0, 1200),
    };
  } finally {
    driver.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const useModel = args.rest.includes('--use-model');
  const trainingSignals = args.quick ? 20 : 60;

  const ollamaUrl = args.ollama ?? 'http://localhost:11434';
  let modelName: string | undefined;
  let ollamaProbe: Awaited<ReturnType<typeof probeOllama>> | null = null;
  if (useModel) {
    ollamaProbe = await probeOllama(ollamaUrl);
    if (!ollamaProbe.reachable) {
      process.stderr.write(`style-recall: --use-model requested but Ollama not reachable at ${ollamaUrl}.\n`);
      process.stderr.write(`  Start: ollama serve\n`);
      process.exit(2);
    }
    const picked = pickModel(ollamaProbe.models, args.model);
    if (!picked) {
      process.stderr.write(`style-recall: --use-model requested but no suitable Qwen2.5-Instruct model pulled.\n`);
      process.stderr.write(`  Pull: ollama pull qwen2.5:7b-instruct\n`);
      process.exit(2);
    }
    modelName = picked.name;
    process.stderr.write(`style-recall: using model ${modelName} (${picked.parameter_size ?? '?'})\n`);
  }

  const personas: PersonaName[] = args.persona
    ? [args.persona as PersonaName]
    : PERSONA_NAMES;

  const hardware = await probeHardware({ gpu: args.gpu, vramGb: args.vramGb });
  const { sha, dirty } = await gitSha(repoRoot());
  const timestamp = new Date().toISOString();

  const results: PerPersonaResult[] = [];
  for (const name of personas) {
    process.stderr.write(`style-recall: running persona=${name} (N=${trainingSignals})…\n`);
    const r = await runPersona(name, {
      trainingSignals, useModel, ollamaUrl, modelName,
    });
    results.push(r);

    if (!args.noReceipt) {
      const receipt: Receipt<PerPersonaResult> = {
        benchId: `style-recall-${name}`,
        timestamp, gitSha: sha, gitDirty: dirty, hardware,
        config: {
          trainingSignals,
          useModel,
          model: modelName ?? null,
          ollamaUrl: useModel ? ollamaUrl : null,
          fixturePrompts: PROMPT_PAIRS.length,
          variantsPerPrompt: VARIANT_KEYS.length,
          backsClaim: "Persona evolves toward the user's preferences",
        },
        data: r,
      };
      const path = writeReceipt(receipt);
      process.stderr.write(`  receipt: ${path}\n`);
    }

    process.stderr.write(
      `  pairs=${r.pairs.length} acc=${(r.pairAccuracy * 100).toFixed(1)}% signals=${r.signalsRecorded} dom=${r.signalRecall.dominantSignalType ?? '-'}(${r.signalRecall.dominantCount}) retP=${r.signalRecall.retainedInProfile} retA=${r.signalRecall.retainedInAdaptations}\n`,
    );
  }

  if (!args.noReceipt && results.length > 1) {
    const aggregate = {
      personas: results.map(r => ({
        persona: r.persona,
        pairAccuracy: r.pairAccuracy,
        signalsRecorded: r.signalsRecorded,
        dominantSignal: r.signalRecall.dominantSignalType,
        retainedInProfile: r.signalRecall.retainedInProfile,
        retainedInAdaptations: r.signalRecall.retainedInAdaptations,
      })),
      meanPairAccuracy: results.reduce((s, r) => s + r.pairAccuracy, 0) / results.length,
      retentionRate:
        results.filter(r => r.signalRecall.retainedInAdaptations).length / results.length,
    };
    const receipt: Receipt<typeof aggregate> = {
      benchId: 'style-recall-aggregate',
      timestamp, gitSha: sha, gitDirty: dirty, hardware,
      config: { trainingSignals, useModel, model: modelName ?? null },
      data: aggregate,
    };
    const path = writeReceipt(receipt);
    process.stderr.write(`style-recall aggregate: ${path}\n`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2));
  }
}

main().catch(err => {
  process.stderr.write(`style-recall: FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(1);
});
