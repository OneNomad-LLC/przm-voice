# sycophancy-detection

Measures precision/recall/F1 of `src/sycophancy.ts` against a hand-labeled fixture set.

## What this measures

The sycophancy detection module observes **assistant** text (not user input) for four
named sycophantic patterns:

- `sycophancy_flattery` — opener uses flattery phrasing ("great question," etc.)
- `sycophancy_walk_back` — assistant retracts a prior claim without new evidence
- `sycophancy_position_flip` — assistant said X, user pushed back without evidence, assistant now says ¬X
- `sycophancy_agreement_cascade` — N consecutive assistant turns with no disagreement markers

Detection is rules-based (regex + structural checks). No LLM in the detection loop, because
the model evaluating its own sycophancy is contaminated by the same failure mode (Sharma et
al. 2023). Rules-based is the floor; second-agent review is the ceiling and is out of scope
for v0.

## Methodology

Each fixture is scored against three detectors (the **calibration triangle**):

| Detector | What it does | Purpose |
|---|---|---|
| `perfect` | Returns the fixture's expected labels verbatim | Sanity check — fixture set must score 100% |
| `naive` | Only matches "great question" as flattery | Floor — proves the fixture isn't trivially gameable |
| `rules` | The actual detector under test | The one we care about |

If `perfect` ≠ 100%, the fixtures are broken. If `naive` is within 5pp of `rules`, the
fixture set is too easy. The bench warns or fails accordingly.

## Running

From repo root (the bench uses `dist/sycophancy.js`, so persona must be built first):

```bash
npm run build
pnpm --filter @onenomad/persona-bench-sycophancy-detection bench
```

Or wired through the root `bench:sycophancy-detection` script.

A JSON receipt lands under `benchmarks/receipts/<YYYY-MM-DD>/` keyed by date + git SHA.

## Known gaps in v0 (documented, not hidden)

- **No detection of sycophantic praise about the user mid-text** — flattery detector only scans
  the first 200 chars. `adv-003` is a known false negative.
- **Cascade detector does not gate on per-turn evidence** — a sequence of grounded agreements
  still trips the cascade signal. `adv-004` and `adv-005` are known false positives. The
  signal is a flag, not a verdict; callers must adjudicate.
- **Walk-back without prior-turn context** fires at lower confidence but still fires —
  retraction-without-evidence is a meaningful per-turn signal even without conversation
  history.

These are intentional v0 trade-offs. v0.1 candidate work:
- Mid-text praise detection (broader scan window + named-entity check on "you")
- Per-turn evidence gating for cascade detection
- Better polarity inference for position-flip beyond shallow positive/negative tokens

## Fixture composition

30 fixtures across three categories:

- **positive** — assistant text exhibits at least one sycophancy type (~12)
- **negative** — clean technical / grounded answers (~10)
- **adversarial** — deliberately tricky edge cases that pressure-test false-pos / false-neg classes (~8)

Each fixture lists its `expected` signal types explicitly. Detector output is set-equal-compared.
