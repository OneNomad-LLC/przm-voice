# Persona Benchmark Suite — Plan

**Status:** v1 design, 2026-05-12
**Scope:** three benchmarks driven by four synthetic personas, evaluated against a local Ollama-served model. Receipts emitted in the same shape as Pyre's `benchmarks/` suite so the receipts story stays consistent across OneNomad repos (Pyre / Engram / Persona).

## Why this exists

Persona ships claims that are testable but currently un-tested in-repo:

| Claim | Bench that backs it |
|---|---|
| "Persona evolves toward the user's preferences" | `style-recall` |
| "Auto-detection (commit `21af22d`) correctly tags user reactions" | `signal-classification` |
| "`persona_context` compresses state without losing preference signal" | `persona-context-budget` |

Each bench runs four times — once per synthetic persona — so a single CI invocation produces one receipt per (bench, persona) plus an aggregate.

## Receipts

Receipts live under `benchmarks/receipts/<YYYY-MM-DD>/` and follow the Pyre shape exactly:

```
{
  "benchId": "<bench>-<persona>",
  "timestamp": "...",
  "gitSha": "...",
  "gitDirty": false,
  "hardware": { ... },        // probed via _shared/hardware.ts
  "config": { ... },          // bench-specific knobs (model, ctx, K, etc.)
  "data": { ... }             // bench-specific results
}
```

Aggregates land alongside per-persona receipts as `<bench>-aggregate-<date>-<sha>.json`.

## Personas

Defined in `benchmarks/personas/` — see `personas.md` for the prose profiles. Trait axes match Persona's actual `StyleVector` + `BigFiveTraits` types from `src/types.ts`.

| Persona | One-line axis |
|---|---|
| Alex (curious generalist) | balanced openness, mid verbosity, light warmth |
| Morgan (non-technical exec) | low jargon tolerance, low verbosity preference (TL;DR), high agreeableness, ROI-framed |
| Jordan (senior IC) | terse, low agreeableness (blunt), zero humor/emoji, high conscientiousness |
| Sam (marketing/brand) | high openness, high humor, audience-aware, emoji-tolerant |

Each persona ships a deterministic `reactionFn(candidateResponse) -> SignalType[]` that produces the ground-truth labels.

## Model

Ollama at `http://localhost:11434`. The harness probes `ollama list` (via `GET /api/tags`) and picks the largest Qwen2.5-Instruct under 32B that's already pulled. If nothing suitable is pulled, the harness exits with the recommended `ollama pull` command — it does **not** auto-pull.

The model is used for:
1. **Generation** — produce candidate responses to canned prompts.
2. **Judging** — fallback only, when no deterministic ground-truth is available. Bench prefers the persona's reaction function whenever possible.

## Guardrails

- **Temp dirs.** Every bench run sets `PERSONA_DATA_DIR` to a fresh tmpdir so user data isn't polluted.
- **File mode only.** `STORAGE_BACKEND=file` is the only path exercised; postgres mode is out of scope here.
- **Direct imports.** Benches import compiled `dist/` from the persona package (`@onenomad/persona-mcp` workspace dep), not the MCP server. Avoids spawning a child server and lets the bench drive `recordSignal` / `rebuildProfile` / `updateSoulFromSynthesis` / `getAdaptations` directly.
- **No emojis** in code or receipts.

## Layout

```
benchmarks/
├── PLAN.md                              # this file
├── _shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── cli.ts                       # ported from pyre
│       ├── hardware.ts                  # ported from pyre
│       ├── receipt.ts                   # ported from pyre, paths adjusted
│       ├── ollama.ts                    # NEW: /api/tags probe, /api/generate driver
│       ├── persona-driver.ts            # NEW: direct, in-proc Persona harness
│       └── format.ts
├── personas/
│   ├── personas.md                      # human-readable profiles
│   ├── alex.json
│   ├── morgan.json
│   ├── jordan.json
│   ├── sam.json
│   └── reactions.ts                     # deterministic reaction functions
├── style-recall/
├── signal-classification/
├── persona-context-budget/
└── receipts/
    └── <YYYY-MM-DD>/
        └── <bench>-<persona>-<date>-<sha>.json
```
