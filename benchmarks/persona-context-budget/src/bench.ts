#!/usr/bin/env tsx
/**
 * persona-context-budget — measure preference-prediction accuracy as
 * a function of the persona_context token budget.
 *
 * Backs the claim: "persona_context compresses state without losing
 * preference signal."
 *
 * Procedure (per persona):
 *   1. Identical training phase to style-recall — N signal events
 *      drive evolution.
 *   2. For K in {256, 512, 1024, 2048, 4096} tokens, build the
 *      budgeted context:
 *        - K <= 400  → use Persona's `minimal` size mode, then char-truncate
 *        - K <= 2000 → use `standard` size mode, then char-truncate
 *        - K > 2000  → use `full` size mode, then char-truncate
 *   3. Run the pair-preference task using ONLY the budgeted context
 *      (not the full state). Score the prediction against the
 *      persona's deterministic preferenceScore.
 *   4. Identify the "knee point" — the smallest K where accuracy is
 *      within 0.05 of the K=4096 ceiling.
 */

import {
  parseArgs, probeHardware, gitSha, writeReceipt, repoRoot,
  createPersonaDriver, type Receipt,
} from '@onenomad/persona-bench-shared';
import {
  PERSONA_NAMES, loadPersona, reactFor, preferenceScore,
  PROMPT_PAIRS, type PersonaName,
} from '@onenomad/persona-bench-personas';
import type { SignalType } from '@onenomad/persona-mcp/dist/types.js';
import { buildSoulContext, readAllSoulFiles } from '@onenomad/persona-mcp/dist/soul.js';
import { readAllJournalFiles } from '@onenomad/persona-mcp/dist/journal.js';
import { predictPreference } from '@onenomad/persona-bench-style-recall';

const BUDGETS = [256, 512, 1024, 2048, 4096] as const;
type Budget = typeof BUDGETS[number];

const VARIANT_KEYS = ['terseCode', 'verbosePreamble', 'bulletedTldr', 'narrativeBrand'] as const;
type VariantKey = typeof VARIANT_KEYS[number];

interface BudgetResult {
  budgetTokens: Budget;
  sizeMode: 'minimal' | 'standard' | 'full';
  contextTokensEstimated: number;
  contextChars: number;
  pairsEvaluated: number;
  correct: number;
  accuracy: number;
}

interface PerPersonaResult {
  persona: PersonaName;
  signalsRecorded: number;
  signalTypeCounts: Partial<Record<SignalType, number>>;
  budgets: BudgetResult[];
  kneePointTokens: number | null;
  ceilingAccuracy: number;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.6);
}

/** Truncate text to roughly N tokens by char-budget (~3.6 chars/token). */
function truncateToTokens(s: string, tokens: number): string {
  const charBudget = tokens * 3.6;
  if (s.length <= charBudget) return s;
  return s.slice(0, Math.floor(charBudget));
}

function pickSizeFor(budget: Budget): 'minimal' | 'standard' | 'full' {
  if (budget <= 400) return 'minimal';
  if (budget <= 2000) return 'standard';
  return 'full';
}

async function runPersona(name: PersonaName, trainingSignals: number): Promise<PerPersonaResult> {
  const persona = loadPersona(name);
  const driver = createPersonaDriver({ proposalThreshold: 5 });

  try {
    // ─── Training: feed signals (same loop as style-recall) ───
    const signalTypeCounts: Partial<Record<SignalType, number>> = {};
    let nRecorded = 0;
    const userMessageBuffer: string[] = [];

    const allVariants: Array<{ pair: typeof PROMPT_PAIRS[number]; key: VariantKey }> = [];
    for (const pair of PROMPT_PAIRS) {
      for (const key of VARIANT_KEYS) allVariants.push({ pair, key });
    }

    let i = 0;
    while (nRecorded < trainingSignals) {
      const v = allVariants[i % allVariants.length];
      const text = v.pair.candidates[v.key];
      const reactions = reactFor(persona, text);
      for (const r of reactions) {
        driver.recordSignal(r, text, v.pair.category);
        signalTypeCounts[r] = (signalTypeCounts[r] ?? 0) + 1;
        nRecorded++;
      }
      userMessageBuffer.push(text);
      if (userMessageBuffer.length > 30) userMessageBuffer.shift();
      if (i > 0 && i % 8 === 0) driver.rebuildProfile();
      i++;
      if (i > trainingSignals * 4) break;
    }
    driver.rebuildProfile();
    driver.synthesize(userMessageBuffer);

    // ─── Eval: sweep budgets ───
    const budgetResults: BudgetResult[] = [];

    for (const budget of BUDGETS) {
      const sizeMode = pickSizeFor(budget);
      const soul = readAllSoulFiles(driver.config);
      const journal = sizeMode === 'full' ? readAllJournalFiles(driver.config) : undefined;
      const soulCtx = buildSoulContext(soul, { journal, size: sizeMode });
      const adaptations = driver.adaptationsOnly();
      const fullCtx = `${soulCtx}\n\n${adaptations}`.trim();
      const budgeted = truncateToTokens(fullCtx, budget);

      let correct = 0;
      let total = 0;
      for (const pair of PROMPT_PAIRS) {
        for (let a = 0; a < VARIANT_KEYS.length; a++) {
          for (let b = a + 1; b < VARIANT_KEYS.length; b++) {
            const A = pair.candidates[VARIANT_KEYS[a]];
            const B = pair.candidates[VARIANT_KEYS[b]];
            const sATrue = preferenceScore(persona, A);
            const sBTrue = preferenceScore(persona, B);
            if (Math.abs(sATrue - sBTrue) < 0.001) continue;
            const truthWinner: 'A' | 'B' = sATrue > sBTrue ? 'A' : 'B';
            const pred = predictPreference(budgeted, A, B, persona);
            total++;
            if (pred.winner === truthWinner) correct++;
          }
        }
      }

      budgetResults.push({
        budgetTokens: budget,
        sizeMode,
        contextTokensEstimated: estimateTokens(budgeted),
        contextChars: budgeted.length,
        pairsEvaluated: total,
        correct,
        accuracy: total === 0 ? 0 : correct / total,
      });
    }

    // ─── Knee point ───
    const ceilingAccuracy = budgetResults[budgetResults.length - 1].accuracy;
    let kneePointTokens: number | null = null;
    for (const r of budgetResults) {
      if (r.accuracy >= ceilingAccuracy - 0.05) {
        kneePointTokens = r.budgetTokens;
        break;
      }
    }

    return {
      persona: name,
      signalsRecorded: nRecorded,
      signalTypeCounts,
      budgets: budgetResults,
      kneePointTokens,
      ceilingAccuracy,
    };
  } finally {
    driver.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const trainingSignals = args.quick ? 20 : 60;

  const personas: PersonaName[] = args.persona
    ? [args.persona as PersonaName]
    : PERSONA_NAMES;

  const hardware = await probeHardware({ gpu: args.gpu, vramGb: args.vramGb });
  const { sha, dirty } = await gitSha(repoRoot());
  const timestamp = new Date().toISOString();

  const results: PerPersonaResult[] = [];
  for (const name of personas) {
    process.stderr.write(`persona-context-budget: running persona=${name}…\n`);
    const r = await runPersona(name, trainingSignals);
    results.push(r);

    if (!args.noReceipt) {
      const receipt: Receipt<PerPersonaResult> = {
        benchId: `persona-context-budget-${name}`,
        timestamp, gitSha: sha, gitDirty: dirty, hardware,
        config: {
          trainingSignals,
          budgetsTokens: [...BUDGETS],
          tokenizer: 'chars-over-3.6 estimate',
          backsClaim: 'persona_context compresses state without losing preference signal',
        },
        data: r,
      };
      const path = writeReceipt(receipt);
      process.stderr.write(`  receipt: ${path}\n`);
    }

    const accStr = r.budgets.map(b => `K=${b.budgetTokens}:${(b.accuracy * 100).toFixed(0)}%`).join(' ');
    process.stderr.write(`  ${accStr}  knee=${r.kneePointTokens ?? '-'} ceiling=${(r.ceilingAccuracy * 100).toFixed(0)}%\n`);
  }

  if (!args.noReceipt && results.length > 1) {
    const aggregate = {
      personas: results.map(r => ({
        persona: r.persona,
        kneePointTokens: r.kneePointTokens,
        ceilingAccuracy: r.ceilingAccuracy,
        accuracies: r.budgets.map(b => ({ K: b.budgetTokens, acc: b.accuracy })),
      })),
      meanCeilingAccuracy: results.reduce((s, r) => s + r.ceilingAccuracy, 0) / results.length,
      worstKneeTokens: results.reduce((m, r) => Math.max(m, r.kneePointTokens ?? 0), 0),
    };
    const receipt: Receipt<typeof aggregate> = {
      benchId: 'persona-context-budget-aggregate',
      timestamp, gitSha: sha, gitDirty: dirty, hardware,
      config: { trainingSignals, budgetsTokens: [...BUDGETS] },
      data: aggregate,
    };
    const path = writeReceipt(receipt);
    process.stderr.write(`persona-context-budget aggregate: ${path}\n`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2));
  }
}

main().catch(err => {
  process.stderr.write(`persona-context-budget: FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(1);
});
