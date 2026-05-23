#!/usr/bin/env tsx
/**
 * signal-classification — measure precision / recall / F1 of Persona's
 * auto-detect pipeline (commit 21af22d).
 *
 * Procedure:
 *   1. Load LABELED_MESSAGES from the personas package (~50 hand-built
 *      messages with ground-truth signal labels).
 *   2. For each persona, prime a fresh Persona driver and run every
 *      labeled message through `detectSignals`.
 *   3. Compute per-class precision/recall/F1 + a confusion matrix.
 *
 * The same labeled corpus is fed to every persona. The persona axes
 * don't affect detectSignals (which is a pure regex pipeline). The
 * reason we still run it four times is so the receipt schema is
 * uniform across the three benches: every bench produces one receipt
 * per (bench, persona) plus an aggregate. If the per-persona numbers
 * differ here at all, that's a bug.
 */

import { parseArgs, probeHardware, gitSha, writeReceipt, repoRoot, createPersonaDriver, type Receipt } from '@onenomad/voice-bench-shared';
import { PERSONA_NAMES, loadPersona, LABELED_MESSAGES, type PersonaName } from '@onenomad/voice-bench-personas';
import type { SignalType } from '@onenomad/przm-voice/dist/types.js';

const ALL_SIGNALS: SignalType[] = [
  'correction', 'approval', 'frustration', 'elaboration', 'simplification',
  'code_accepted', 'code_rejected', 'regen_request', 'explicit_feedback',
  'style_correction', 'praise', 'abandonment', 're_ask',
];

interface PerClassStats {
  signal: SignalType;
  tp: number; fp: number; fn: number;
  precision: number;
  recall: number;
  f1: number;
}

interface PerPersonaResult {
  persona: PersonaName;
  total: number;
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroF1: number;
  perClass: PerClassStats[];
  confusion: Record<string, Record<string, number>>;
  failures: Array<{ id: string; message: string; expected: SignalType[]; got: SignalType[] }>;
}

function f1(p: number, r: number): number {
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

function evaluatePersona(name: PersonaName): PerPersonaResult {
  const driver = createPersonaDriver();
  try {
    // Per-class tallies.
    const tally: Record<string, { tp: number; fp: number; fn: number }> = {};
    for (const s of ALL_SIGNALS) tally[s] = { tp: 0, fp: 0, fn: 0 };

    // Confusion: rows = expected, cols = predicted; '_none_' for no-signal.
    const labelKeys = [...ALL_SIGNALS, '_none_'];
    const confusion: Record<string, Record<string, number>> = {};
    for (const r of labelKeys) {
      confusion[r] = {};
      for (const c of labelKeys) confusion[r][c] = 0;
    }

    const failures: PerPersonaResult['failures'] = [];

    for (const item of LABELED_MESSAGES) {
      const detected = driver.detectSignals(item.userMessage, []);
      const gotSet = new Set(detected.map(d => d.type));
      const expSet = new Set(item.expected);

      // Per-class tp/fp/fn.
      for (const s of ALL_SIGNALS) {
        if (gotSet.has(s) && expSet.has(s)) tally[s].tp++;
        else if (gotSet.has(s) && !expSet.has(s)) tally[s].fp++;
        else if (!gotSet.has(s) && expSet.has(s)) tally[s].fn++;
      }

      // Confusion matrix: count each (expected, predicted) pair.
      const expectedLabels: string[] = expSet.size === 0 ? ['_none_'] : Array.from(expSet);
      const predictedLabels: string[] = gotSet.size === 0 ? ['_none_'] : Array.from(gotSet);
      for (const e of expectedLabels) {
        for (const p of predictedLabels) {
          if (e in confusion && p in confusion[e]) confusion[e][p]++;
        }
      }

      // Mismatch tracking.
      const sameSet = expSet.size === gotSet.size && [...expSet].every(s => gotSet.has(s));
      if (!sameSet) {
        failures.push({
          id: item.id,
          message: item.userMessage,
          expected: item.expected,
          got: Array.from(gotSet) as SignalType[],
        });
      }
    }

    // Per-class P/R/F1.
    const perClass: PerClassStats[] = ALL_SIGNALS.map(signal => {
      const { tp, fp, fn } = tally[signal];
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      return { signal, tp, fp, fn, precision, recall, f1: f1(precision, recall) };
    });

    // Micro = pool tp/fp/fn across classes.
    const microTp = perClass.reduce((s, c) => s + c.tp, 0);
    const microFp = perClass.reduce((s, c) => s + c.fp, 0);
    const microFn = perClass.reduce((s, c) => s + c.fn, 0);
    const microPrecision = microTp + microFp > 0 ? microTp / (microTp + microFp) : 0;
    const microRecall = microTp + microFn > 0 ? microTp / (microTp + microFn) : 0;
    const microF1 = f1(microPrecision, microRecall);

    // Macro = mean over classes with at least one true label.
    const macroSamples = perClass.filter(c => c.tp + c.fn > 0);
    const macroF1 = macroSamples.length === 0
      ? 0
      : macroSamples.reduce((s, c) => s + c.f1, 0) / macroSamples.length;

    // Use persona for completeness even though regex pipeline is persona-blind.
    void loadPersona(name);

    return {
      persona: name,
      total: LABELED_MESSAGES.length,
      microPrecision,
      microRecall,
      microF1,
      macroF1,
      perClass,
      confusion,
      failures,
    };
  } finally {
    driver.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const personas: PersonaName[] = args.persona
    ? [args.persona as PersonaName]
    : PERSONA_NAMES;

  const hardware = await probeHardware({ gpu: args.gpu, vramGb: args.vramGb });
  const { sha, dirty } = await gitSha(repoRoot());
  const timestamp = new Date().toISOString();

  const results: PerPersonaResult[] = [];
  for (const name of personas) {
    process.stderr.write(`signal-classification: running persona=${name}…\n`);
    const r = evaluatePersona(name);
    results.push(r);

    if (!args.noReceipt) {
      const receipt: Receipt<PerPersonaResult> = {
        benchId: `signal-classification-${name}`,
        timestamp, gitSha: sha, gitDirty: dirty, hardware,
        config: {
          corpusSize: LABELED_MESSAGES.length,
          mode: 'regex-auto-detect',
          backsClaim: 'Auto-detection correctly tags user reactions',
        },
        data: r,
      };
      const path = writeReceipt(receipt);
      process.stderr.write(`  receipt: ${path}\n`);
    }

    process.stderr.write(
      `  microF1=${r.microF1.toFixed(3)} microP=${r.microPrecision.toFixed(3)} microR=${r.microRecall.toFixed(3)} macroF1=${r.macroF1.toFixed(3)} failures=${r.failures.length}/${r.total}\n`,
    );
  }

  // Aggregate receipt.
  if (!args.noReceipt && results.length > 1) {
    const aggregate = {
      personas: results.map(r => ({
        persona: r.persona,
        microF1: r.microF1,
        microPrecision: r.microPrecision,
        microRecall: r.microRecall,
        macroF1: r.macroF1,
        failures: r.failures.length,
      })),
      meanMicroF1: results.reduce((s, r) => s + r.microF1, 0) / results.length,
      meanMacroF1: results.reduce((s, r) => s + r.macroF1, 0) / results.length,
    };
    const receipt: Receipt<typeof aggregate> = {
      benchId: 'signal-classification-aggregate',
      timestamp, gitSha: sha, gitDirty: dirty, hardware,
      config: { corpusSize: LABELED_MESSAGES.length, mode: 'regex-auto-detect' },
      data: aggregate,
    };
    const path = writeReceipt(receipt);
    process.stderr.write(`signal-classification aggregate: ${path}\n`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2));
  }
}

main().catch(err => {
  process.stderr.write(`signal-classification: FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
