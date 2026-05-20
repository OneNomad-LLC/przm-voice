#!/usr/bin/env tsx
/**
 * sycophancy-detection — measure precision / recall / F1 of the
 * sycophancy detection module (src/sycophancy.ts) against a
 * hand-labeled fixture set.
 *
 * Procedure:
 *   1. Load FIXTURES from ./fixtures.ts (~30 hand-built cases:
 *      positives, negatives, adversarials).
 *   2. Run each fixture through detectSycophancyInAssistant.
 *   3. Score per-class tp/fp/fn against the fixture's expected
 *      labels; compute micro/macro F1.
 *   4. Run a calibration triangle alongside:
 *        - "perfect" — oracle that returns expected labels (sanity)
 *        - "naive"   — only matches "great question" (caught-by-trivial)
 *        - "rules"   — the actual detector under test
 *   5. Write a JSON receipt under benchmarks/receipts/<date>/.
 *
 * Calibration triangle is the same methodology used by bench v0 for
 * the AI-memory benchmark: prove the fixture is non-trivial (naive
 * scores low) and non-rigged (perfect scores 100%).
 *
 * No persona axis: detection is stateless / rule-based and does not
 * depend on persona configuration.
 */

import {
  probeHardware,
  gitSha,
  writeReceipt,
  repoRoot,
  type Receipt,
} from '@onenomad/voice-bench-shared';
import {
  detectSycophancyInAssistant,
  type SycophancySignalType,
  type DetectedSycophancySignal,
} from '@onenomad/persona-mcp/dist/sycophancy.js';
import { FIXTURES, ALL_SYCOPHANCY_TYPES, FIXTURE_COUNT_BY_CATEGORY, type SycophancyFixture } from './fixtures.js';

// ── Scoring ──────────────────────────────────────────────────────────

interface PerClassStats {
  type: SycophancySignalType;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

interface DetectorResult {
  name: string;
  totalFixtures: number;
  microPrecision: number;
  microRecall: number;
  microF1: number;
  macroF1: number;
  accuracy: number;
  perClass: PerClassStats[];
  failures: Array<{
    fixtureId: string;
    category: SycophancyFixture['category'];
    expected: SycophancySignalType[];
    got: SycophancySignalType[];
  }>;
}

function f1(p: number, r: number): number {
  if (p + r === 0) return 0;
  return (2 * p * r) / (p + r);
}

type Detector = (fixture: SycophancyFixture) => SycophancySignalType[];

function evaluate(name: string, detector: Detector): DetectorResult {
  const tally: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const t of ALL_SYCOPHANCY_TYPES) tally[t] = { tp: 0, fp: 0, fn: 0 };

  const failures: DetectorResult['failures'] = [];
  let exactMatches = 0;

  for (const fixture of FIXTURES) {
    const got = detector(fixture);
    const gotSet = new Set(got);
    const expSet = new Set(fixture.expected);

    for (const t of ALL_SYCOPHANCY_TYPES) {
      if (gotSet.has(t) && expSet.has(t)) tally[t]!.tp++;
      else if (gotSet.has(t) && !expSet.has(t)) tally[t]!.fp++;
      else if (!gotSet.has(t) && expSet.has(t)) tally[t]!.fn++;
    }

    const sameSet =
      expSet.size === gotSet.size &&
      Array.from(expSet).every((s) => gotSet.has(s));
    if (sameSet) exactMatches++;
    else failures.push({
      fixtureId: fixture.id,
      category: fixture.category,
      expected: fixture.expected,
      got,
    });
  }

  const perClass: PerClassStats[] = ALL_SYCOPHANCY_TYPES.map((t) => {
    const { tp, fp, fn } = tally[t]!;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    return { type: t, tp, fp, fn, precision, recall, f1: f1(precision, recall) };
  });

  // Micro = aggregate all (tp,fp,fn) across classes.
  const microTp = perClass.reduce((s, c) => s + c.tp, 0);
  const microFp = perClass.reduce((s, c) => s + c.fp, 0);
  const microFn = perClass.reduce((s, c) => s + c.fn, 0);
  const microPrecision = microTp + microFp === 0 ? 0 : microTp / (microTp + microFp);
  const microRecall = microTp + microFn === 0 ? 0 : microTp / (microTp + microFn);
  const microF1 = f1(microPrecision, microRecall);

  // Macro = unweighted mean of per-class F1.
  const macroF1 =
    perClass.reduce((s, c) => s + c.f1, 0) / Math.max(1, perClass.length);

  return {
    name,
    totalFixtures: FIXTURES.length,
    microPrecision,
    microRecall,
    microF1,
    macroF1,
    accuracy: exactMatches / FIXTURES.length,
    perClass,
    failures,
  };
}

// ── Detectors (calibration triangle) ─────────────────────────────────

const perfectDetector: Detector = (fixture) => fixture.expected;

const naiveDetector: Detector = (fixture) => {
  // The dumbest plausible baseline: "if assistant text starts with
  // 'great question', flag flattery." Catches the trivial 10% and
  // nothing else.
  const t = fixture.input.currentAssistantText.slice(0, 100).toLowerCase();
  if (t.startsWith('great question') || t.startsWith('great question!')) {
    return ['sycophancy_flattery'];
  }
  return [];
};

const rulesDetector: Detector = (fixture) => {
  const signals: DetectedSycophancySignal[] = detectSycophancyInAssistant(fixture.input);
  return signals.map((s) => s.type);
};

// ── Run ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = repoRoot();
  const hardware = await probeHardware();
  const { sha, dirty } = await gitSha(root);

  console.error('Fixture distribution:', FIXTURE_COUNT_BY_CATEGORY);
  console.error(`Total: ${FIXTURES.length}\n`);

  const detectors: Array<[string, Detector]> = [
    ['perfect', perfectDetector],
    ['naive', naiveDetector],
    ['rules', rulesDetector],
  ];

  const results: DetectorResult[] = [];
  for (const [name, fn] of detectors) {
    const result = evaluate(name, fn);
    results.push(result);
    console.error(
      `[${name.padEnd(8)}] acc=${(result.accuracy * 100).toFixed(1)}%  ` +
        `microF1=${result.microF1.toFixed(3)}  ` +
        `macroF1=${result.macroF1.toFixed(3)}  ` +
        `failures=${result.failures.length}`,
    );
  }

  // Per-class breakdown for the rules detector — the one we care about.
  const rules = results.find((r) => r.name === 'rules')!;
  console.error('\nPer-class (rules detector):');
  for (const c of rules.perClass) {
    console.error(
      `  ${c.type.padEnd(36)} tp=${c.tp} fp=${c.fp} fn=${c.fn}  ` +
        `p=${c.precision.toFixed(2)} r=${c.recall.toFixed(2)} f1=${c.f1.toFixed(2)}`,
    );
  }

  if (rules.failures.length > 0) {
    console.error('\nRules-detector failures:');
    for (const f of rules.failures) {
      console.error(
        `  [${f.category}] ${f.fixtureId}: expected=${JSON.stringify(f.expected)} got=${JSON.stringify(f.got)}`,
      );
    }
  }

  const receipt: Receipt<{
    fixtureDistribution: typeof FIXTURE_COUNT_BY_CATEGORY;
    detectors: DetectorResult[];
  }> = {
    benchId: 'sycophancy-detection',
    timestamp: new Date().toISOString(),
    gitSha: sha,
    gitDirty: dirty,
    hardware,
    config: {
      fixtureCount: FIXTURES.length,
      classes: ALL_SYCOPHANCY_TYPES,
      detectors: detectors.map(([n]) => n),
    },
    data: {
      fixtureDistribution: FIXTURE_COUNT_BY_CATEGORY,
      detectors: results,
    },
  };

  const path = writeReceipt(receipt);
  console.error(`\nReceipt written to: ${path}`);

  // Sanity exit: perfect must be 100% accurate (else fixtures are
  // broken); naive must score nontrivially below perfect (else the
  // fixture set is gameable by a one-line baseline).
  const perfect = results.find((r) => r.name === 'perfect')!;
  const naive = results.find((r) => r.name === 'naive')!;
  if (perfect.accuracy < 1.0) {
    console.error('\nFAIL: perfect detector should score 100% by construction. Fixtures are broken.');
    process.exit(1);
  }
  if (naive.microF1 >= rules.microF1 - 0.05) {
    console.error(
      `\nWARN: naive baseline (microF1=${naive.microF1.toFixed(3)}) is too close to rules ` +
        `(microF1=${rules.microF1.toFixed(3)}). The fixture set may be gameable by a trivial baseline.`,
    );
  }
}

main().catch((err) => {
  console.error('Bench failed:', err);
  process.exit(1);
});
