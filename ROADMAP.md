# Roadmap

Ordered work derived from the May 2026 cross-cutting audit
(`/tmp/research/przm-voice/REPORT.md` and the four section reports
under the same directory). Each item is sized so it can become a
single PR. The "Why" line is the load-bearing rationale; the "Revisit
if" line is when this item should be deferred or skipped.

This file is forward-looking. The architecture-debt ledger that
will track items deliberately deferred lives in
`ARCHITECTURE_DEBT.md` (to be created — see R-024); items closed out
here graduate to that ledger as resolved entries.

---

## P0 — ship this week

Three bugs and one credibility fix. Without these, every subsequent
piece of work is built on undermined trust in the product.

### V-001 — Fix the Postgres table-name mismatch (Postgres mode is dead on arrival)

**Where:**
- `migrations/postgres/001_init.sql:7` creates `persona_state`
- `migrations/postgres/001_init.sql:16` creates `persona_signals`
- `src/storage/postgres-adapter.ts:210` reads from `voice_state`
- `src/storage/postgres-adapter.ts:231` reads from `voice_signals`
- `src/storage/postgres-adapter.ts:308,380,387` write to `voice_state` / `voice_signals`

**Why:** Running `STORAGE_BACKEND=postgres` against a freshly migrated
database causes `loadState()` and `loadSignals()` to throw "relation
does not exist" on init. The other four tables (`persona_sessions`,
`persona_soul`, `persona_journal`, `persona_roles`) are consistent
between migration and adapter — only state and signals are wrong, and
they're wrong in opposite directions.

**Approach:** Canonicalize on `voice_*` to match the package name.
Add `migrations/postgres/002_rename.sql`:
```sql
ALTER TABLE IF EXISTS persona_state RENAME TO voice_state;
ALTER TABLE IF EXISTS persona_signals RENAME TO voice_signals;
```
Update `001_init.sql` to create the right names for new installs.

**Effort:** S.

**Revisit if:** never — Postgres mode is non-functional today.

---

### V-002 — Fix the persona → voice naming drift across docs and skills

**Where (LLM-facing surface):**
- `README.md:415-457` (Tools table) — 11 tools under wrong names
- `skills/persona-soul/SKILL.md` — `persona_read`, `persona_edit`
- `skills/persona-analyze/SKILL.md` — `persona_analyze`,
  `persona_synthesize`
- `skills/persona-tune/SKILL.md` — `persona_signal`, `persona_adapt`
  (gone — folded into `voice_context`), `persona_edit`
- `skills/persona-reset/SKILL.md` — `persona_init`, `persona_edit`
- `skills/persona-evolve/SKILL.md` — `persona_proposals`,
  `persona_apply`, `persona_reject`, `persona_evolve`
- `skills/persona-profile/SKILL.md` — `persona_profile`,
  `persona_stats`
- `.claude/commands/persona-tune.md:11` — `voice_adapt` (deleted tool)
- `src/server.ts:223` — `voice_state` description says
  `memory_ingest` / `memory_search` (should be hyphens)
- README:377 — claims "25 tools across ten groups"; actual is 28
- README:469 — `/persona-reset` skill defines its own inline preset
  names that don't match the 9 actually-bundled presets

**Where (non-LLM-facing but still wrong):**
- `.claude-plugin/plugin.json` — `name: "persona"`,
  `homepage: github.com/OneNomad-LLC/persona-mcp`
- `server.json` — registry name `io.github.onenomad-llc/persona-mcp`,
  env `PERSONA_DATA_DIR` with default `~/.claude/persona` (code uses
  `PRZM_VOICE_DATA_DIR` with default `~/.claude/przm-voice`)
- `.mcp.json` — server key `persona`, env `PERSONA_SERVER`
- README.md:253 Configuration table
- `src/cli.ts:55` HELP text
- `src/cli.ts:243` — `package_name: 'persona'` posted to cloud auth

**Why:** Worse than the sibling project's `engram → memory` drift —
13 tool names in the README and skills don't exist at runtime. A
fresh LLM following the docs calls a tool surface that isn't there.
The matching `.claude/commands/persona-*.md` files installed by
`install-commands.sh` mostly use the correct `voice_*` names, but
one references a tool (`voice_adapt`) that was deleted.

**Approach:** Delete `skills/persona-*/` entirely (six dirs) — single
source of truth becomes `.claude/commands/`. Fix
`.claude/commands/persona-tune.md:11`. Rewrite README §Tools using
registered names. Update README:469 `/persona-reset` skill to use
the actual bundled preset names and call `voice_soul_preset_apply`
instead of `voice_edit`. Fix the cross-project bleed in
`src/server.ts:223` (`memory_ingest` / `memory_search` →
`memory-ingest` / `memory-search`). Update README:377 count. Update
all the non-LLM-facing files in the second list — they're cosmetic
but visible.

**Effort:** M (mechanical but touches a lot of files).

**Revisit if:** there's a concrete client that discovers skills from
the filesystem and we need `skills/` to remain. The README claims
this exists but names no client — verify, then choose.

---

### V-003 — Resolve the soul/journal write boundary in code, not in prose

**Where:**
- `src/synthesis.ts:358-398` (`updateSoulFromSynthesis`) — calls
  `writeSoulFile(config, 'personality', ...)` at lines 376, 384, 392
- `src/soul-presets.ts` — `voice_soul_preset_apply` calls
  `writeSoulFile(config, 'personality', ...)`
- `src/journal.ts:38` — `appendJournal` already exists for this
  purpose
- `src/evolution.ts:167-173` — the proposal apply path correctly
  routes through `appendJournal`
- `hooks/voice_stop_hook.sh:41` — instructs the LLM to run
  `voice_synthesize` every 10 turns
- `README.md:35` — "The system never auto-writes here" (referring
  to soul)

**Why:** The product's central trust narrative is that the user owns
soul / role files and the system owns the journal. The architecture
exists to enforce this — `appendJournal` is the right destination
for system-generated content. But `voice_synthesize` and
`voice_soul_preset_apply` write to soul directly, and the stop hook
calls synthesize on a cadence. A user who reads the README,
hand-edits PERSONALITY.md, and lets a session run finds their edits
silently overwritten. This is a launch-blocker for the journal
namespace's reason for existing.

**Approach:** Route `updateSoulFromSynthesis` writes through
`appendJournal` instead of `writeSoulFile`. `voice_soul_preset_apply`
gets the same treatment — write into the journal layer with a
clear marker, not into soul. `voice_consolidate` (or a new
`voice_promote`) can promote stable journal entries into soul on
the consolidation path with explicit user approval — that's exactly
what evolution proposals were designed for. Leave `voice_edit` and
`voice_init` as the two explicit user-driven write paths to soul.

**Effort:** M.

**Revisit if:** the team decides the trust narrative isn't
load-bearing and the README §How It Works can be rewritten to
document synthesis + preset-apply as the two system write paths to
soul. That's a marketing decision more than a technical one.

---

### V-004 — Cap `pinnedFeedback` to prevent silent prompt bloat

**Where:** `src/types.ts:114` (no length cap on `pinnedFeedback`);
`src/adaptations.ts:182-185` (injects full list into every
`voice_context` call).

**Why:** A user who pins 200 feedback items injects 200+ lines into
every request. No token budget guard. Bloats context for heavy
users.

**Approach:** Soft cap of 50 in `types.ts`. Add a `maxPinnedFeedback`
config option. `voice_stats` warns if pinned > 30.

**Effort:** S.

**Revisit if:** never.

---

### V-005 — Drop CSV-in-string schemas on `voice_synthesize` and `voice_analyze`

**Where:** `src/server.ts:1009` (`voice_synthesize.messages` typed
`z.string()` with `JSON.parse(messages)` at :1013);
`src/server.ts:1049-1098` (`voice_analyze.messages` same).

**Why:** Same anti-pattern as the sibling project's
`memory-handoff-write.fileRefs`. The schema lies about the contract;
LLM has to JSON-stringify inside JSON. Removes a class of malformed-
input failures.

**Approach:** Change to `z.array(z.string()).min(1)`. Drop the
`JSON.parse`. Update the tool descriptions to drop the
"JSON array of strings" hint and explain the per-message context.

**Effort:** XS.

**Revisit if:** never.

---

### V-006 — Default Postgres SSL

**Where:** `src/storage/postgres-adapter.ts:161`.

**Why:** Cloud Postgres (Supabase, Neon, Heroku, RDS) typically
requires `sslmode=require`. The current `new Pool({ connectionString })`
with no SSL config silently fails or connects in plaintext depending
on the provider.

**Approach:**
```ts
this.pool = opts.pool ?? new Pool({
  connectionString: opts.databaseUrl,
  ssl: opts.databaseUrl.includes('localhost')
    ? false
    : { rejectUnauthorized: true },
});
```
Document an opt-out env var. Add §Configuration row.

**Effort:** XS.

---

### V-007 — Wrap Postgres FIFO trim in a transaction; fix the O(n×m) DELETE

**Where:** `src/storage/postgres-adapter.ts:379-397` (signals
INSERT + DELETE); `:421-436` (sessions, same pattern).

**Why:** Two autocommit statements — a crash between them leaves the
table over the cap permanently (until the next signal insert
triggers another trim). The DELETE uses `NOT IN (subquery)` which is
O(n × m) on `tenant_id`.

**Approach:** Wrap in `BEGIN` / `COMMIT`. Switch to offset-based
trim:
```sql
DELETE FROM voice_signals
 WHERE tenant_id = $1 AND id <= (
   SELECT id FROM voice_signals
    WHERE tenant_id = $1
    ORDER BY id DESC
    LIMIT 1 OFFSET ($2 - 1)
 )
```
Add a `(tenant_id, id DESC)` index in the same migration as V-001's
rename (the current migration only has `(tenant_id, created_at DESC)`).

**Effort:** M.

---

### V-008 — Surface write-behind queue errors

**Where:** `src/storage/postgres-adapter.ts:292-298`;
`src/storage/cloud-adapter.ts:344-349`.

**Why:** Both adapters use `.catch(err => console.error(...))` after
the write. After swallowing, the queue continues. Callers who
`await flush()` at shutdown see a resolved promise even if writes
failed. From the user's perspective, their signal was recorded — it
wasn't.

**Approach:** Track `lastWriteError` on the adapter. Expose via
`flush()` return type or a `healthCheck()` method. Tool responses
include a `storageWarning` field when a recent write failed.

**Effort:** M.

---

## P1 — ship this quarter

Items that are not load-bearing bugs but are gating either credibility,
the cloud experience, or the methodology moat.

### V-009 — Add fetch timeout + retry to the cloud adapter

**Where:** `src/storage/cloud-adapter.ts:217-228`.

A hung upstream stalls the write queue indefinitely (linear promise
chain). Wrap each fetch in an AbortController (10s default). Add 1-2
exponential-backoff attempts for 5xx. Log non-auth failures during
`init()` (`:253-339`) instead of silently swallowing them.

**Effort:** S.

---

### V-010 — Dedup proposals against `applied` + prune old entries

**Where:** `src/evolution.ts:46-47, 144-148`.

`pendingTargets` only dedupes against `pending`. Applied proposals
don't prevent re-generation of the same content; the journal collects
duplicate guidance over time. Expand dedup to filter
`p.status !== 'rejected'`. Prune applied/rejected proposals older than
90 days during consolidation.

**Effort:** S.

---

### V-011 — Unify the sycophancy threshold

**Where:** `src/consolidation.ts:137` (fires at 80%);
`src/adaptations.ts:199` (fires at 85%).

Approval rates between 80-85% silently get a consolidation warning
but no in-prompt self-check. Single `SYCOPHANCY_APPROVAL_THRESHOLD`
constant in `src/types.ts` used by both. Decide on one number; the
methodology audit notes 85% is unmotivated either way.

**Effort:** XS.

---

### V-012 — Move `voice_detect_sycophancy` from LLM tool to stop hook

**Where:** `src/server.ts:256-277` (current tool);
`hooks/voice_stop_hook.sh` (target); `src/sycophancy.ts` (rules
engine to extract).

**Why:** Self-evaluation by the agent being evaluated is contaminated
— the tool description honestly admits this. No automation calls it
today; it's pure dead weight on the LLM tool list.

**Approach:** Add `przm-voice-mcp detect-sycophancy --transcript
<path>` CLI subcommand that runs the existing rules. Call it from
`voice_stop_hook.sh`. On firing, POST a `style_correction` signal
through the existing CLI signal path. Drop the LLM tool. Removes a
documented conflict of interest and one tool slot.

**Effort:** M.

---

### V-013 — Collapse `voice_role_*` family from 5 tools to 3

**Where:** `src/server.ts:876-957`.

**Why:** `voice_role_set` description says "Pass null to clear" but
schema rejects null (`z.string()`). Unrunnable as written.
`voice_role_list` and `voice_role_read({name})` collapse cleanly to
one tool with optional name. `voice_role_clear` collapses into a
nullable `voice_role_set`.

**Approach:**
- `voice_role_get({ name?: string })` — list when no name, read when
  named
- `voice_role_set({ name: string | null })` — set when string, clear
  when null (fix the schema)
- `voice_role_edit({ name, content })` unchanged (different blast
  radius)

**Effort:** S.

---

### V-014 — Fix emotional-association eviction policy

**Where:** `src/emotions.ts:316-319`.

**Why:** Current policy evicts by `exposureCount DESC` at capacity 50.
Contradicts the amygdala one-shot learning model the README cites —
a single strong negative event for a new topic gets evicted over a
low-importance topic seen many times.

**Approach:**
```ts
const score = exposureCount * 0.4
            + Math.abs(valence) * 0.4
            + recencyDays * 0.2;
```
Keep the 50 highest-scored.

**Effort:** S.

---

### V-015 — Add counterbalancing decay to asymmetric emotional learning

**Where:** `src/emotions.ts:298-313`.

**Why:** Asymmetric 0.8 / 0.2 + 7-day decay floor traps the system
in negative associations for weeks. Once a topic encodes valence
-0.64 from a single event, overcoming with positive evidence
requires ~5-10 exposures at lr=0.2 OR ~30 days of inactivity decay.
If the topic keeps coming up (so doesn't decay), the system stays
cautious indefinitely even after the user's reaction is now
positive.

**Approach:** 3+ consecutive positive exposures on a previously-
negative topic accelerates the positive learning rate (or resets to
neutral). Add a per-topic positive-streak counter.

**Effort:** S.

---

### V-016 — Replace the bench suite with non-circular evals

**Where:** new files under `benchmarks/`.

**Why:** The three existing benchmarks (signal-classification,
sycophancy-detection, style-recall) are self-consistency checks, not
behavioral evaluations. The product's central claim is that
adaptive personality changes agent behavior in user-relevant ways.
That claim has zero supporting evidence in the repo today.

**Approach:**
1. **Independent-labeled signal-classification corpus.** 200
   messages labeled by 3+ annotators blind to the regex catalog.
   Cohen's κ on inter-rater agreement, then precision/recall/F1
   against majority-vote labels. The current 0.96 microF1 will drop
   substantially — that's the point; the honest number is the
   useful one.
2. **Held-out fifth persona.** Develop a `reactionFn` without
   consulting the adaptation code. Run style-recall against it
   before the existing four.
3. **Behavioral A/B.** Same model, condition A = no Voice
   adaptations injected, condition B = Voice adaptations injected.
   Same task set. Blinded preference judgments by independent
   raters. ≥50 users × ≥10 prompts × 2 conditions. Effect size with
   95% CI.

**Effort:** L. Annotation is the bottleneck for (1); paneling for (3).

**Why it's not P0:** the product technically works without it; the
moat doesn't exist without it.

---

### V-017 — Token-budget ablation on `voice_context`

**Where:** `src/adaptations.ts`, bench harness.

Strip lines from the adaptation block one at a time, measure
response-quality delta. If a 30-line adaptation block can be reduced
to 3 lines without quality loss, the rest is decorative — and the
prompt budget can be returned to the user. Pairs naturally with
V-016's behavioral A/B.

**Effort:** M.

---

### V-018 — Sensitivity analysis on every hardcoded threshold

Targets: 85% approval rate (V-011), 15-interaction Big Five
reliability, 0.3 dyad threshold, 0.7 / 0.3 chameleon ratio, 5-flow
char / 15-overload char cognitive-load thresholds.

Vary each across ±50% and measure downstream effect on adaptation
output. Drop thresholds that don't change anything; document and
parameterize the ones that do via config. Kills the "magic constant"
critique.

**Effort:** M.

---

### V-019 — Trim hook over-blocking and cross-project bleed

**Where:** `hooks/voice_precompact_hook.sh`,
`hooks/voice_stop_hook.sh`.

`voice_precompact_hook.sh` always blocks AND mentions
`memory-ingest` / `memory-diary-write`. Cross-project bleed.
PreCompact is high-traffic; combined with `przm-memory`'s
PreCompact hook the agent sees two big walls of text sequentially.
Make this conditional on signal-worthy content since last
consolidation; approve silently otherwise.

`voice_stop_hook.sh:41` text "Record any user reactions from the
last few exchanges" actively encourages batching, violating the
per-reaction CLAUDE.md rule. Reword to "Did you miss recording any
reactions from the last 10 turns? Walk through them one at a time.
Use a SEPARATE voice_signal call for each."

**Effort:** S.

---

### V-020 — Add `voice_journal_remove({ file, fragment })`

**Where:** `src/server.ts` (new tool); `src/journal.ts:61` already
exports `removeJournalFragment`.

Today the LLM can wipe-the-whole-file or leave-everything. Useful
when one applied proposal turns out wrong. Surfaces the existing
helper.

**Effort:** S.

---

## P2 — ship this year

Strategic items mostly gated on the P0/P1 work landing first.

### V-021 — Publish a sycophancy benchmark and methodology doc

The product is the only adaptive-personality system in the field
that names sycophancy as a feature. Anthropic's July 2025 persona-
vectors paper (arXiv 2507.21509) validates the research problem.
Replika is the canonical cautionary tale (2026 FTC complaint, 2026
Tandfonline paper on sycophancy-driven engagement). Numeric report
card from `voice_consolidate` + a public methodology doc that
quantifies the approach. Cite Replika by name. **Don't ship this
until V-016 lands — the underlying eval needs to be honest first.**

**Effort:** M (the data is collected; the report and methodology
page are the work).

---

### V-022 — Ship `voice_explain` / inline signal attribution

ChatGPT shipped Memory Sources in May 2026 — showing which memory
shaped each response. przm-voice has the data (signals + evidence
per proposal) but doesn't surface it inline. One new tool: given a
recent assistant response, return which signals + topics + traits
shaped the adaptation block that was active. Best feasibility-to-
impact in the strategic bucket.

**Effort:** S.

---

### V-023 — Run Big Five against IPIP-NEO short form on a small panel

Validates the psychometric claim before it gets published as a
moat. ClueoMCP can't answer this challenge; if przm-voice does, the
"open psychometric grounding" position becomes defensible.
~20-30 users × IPIP-NEO 60-item + the existing chat-inferred Big
Five from their session history. Report correlation. Soften the
README claim if the correlation is weak.

**Effort:** M (paneling is the work).

---

### V-024 — Create `ARCHITECTURE_DEBT.md`

Mirror the sibling project's debt ledger. The architecture audit
identified five intentional design shortcuts that should be tracked:
1. Sync adapter interface over async backends — adapter caches +
   write-behind queues bridge the impedance mismatch
2. Soul/journal boundary (resolved by V-003)
3. No atomic multi-step write across signal + profile + trait
   state — crash recovery is correct but undocumented
4. Flat `tenant_id` isolation without RLS — acceptable today,
   incurs debt before SaaS launch
5. In-memory session state — by design but creates the "consolidate
   before shutdown" operational requirement

**Effort:** S.

---

### V-025 — Multi-tenancy + RLS in Postgres

`migrations/postgres/001_init.sql` has no RLS policies. For current
single-tenant deployments this is fine; for hosted multi-tenant
it's required. Bundle with the `przm-memory` RLS work — same
pattern (Postgres `SET LOCAL app.tenant_id` + `CREATE POLICY`).

**Effort:** M.

---

### V-026 — Persona marketplace

Upload / discover / install soul + role bundles. Addresses the
README's own "shareable presets" use case. Defends against
Character.AI's content business and ClueoMCP's preset story. Needs
registry infra; rides przm.sh hosted. Network effect; turns the
personality file into a content artifact.

**Effort:** L (product + infra).

---

### V-027 — Shared persona blocks

N agents reading one soul. Letta's killer feature. Required for
team / enterprise positioning. Postgres schema already keys by
`tenant_id`; needs a "team soul" abstraction layered on. Pairs with
V-025 (multi-tenancy).

**Effort:** M-L.

---

### V-028 — Personality regression eval

`voice_eval` runs a persona through N standardized scenarios and
scores drift, surfaces diffs vs prior eval. No competitor has this;
pairs naturally with the eval-tooling space (Promptfoo, Humanloop).
Useful for hosted multi-tenant deploys to detect personality drift
across versions.

**Effort:** M-L.

---

## Backlog (low-priority cleanups)

These are real and tracked but not load-bearing.

- `voice_synthesize` description missing the 5-message threshold
  trigger
- `voice_evolve` description missing the auto-cadence (every 12
  signals)
- `voice_consolidate` description missing the session-state reset
  side-effect and 24h auto-startup behavior
- `voice_init` description self-contradicts ("Reset to defaults.
  Won't overwrite existing.")
- `voice_apply` returns a raw string — change to JSON
  `{ applied, proposalId, target, journalBytes }`
- `voice_feedback_pin` uses substring matching — tighten to exact-
  or-`startsWith`
- `voice_signal.intensity` silently ignored for non-Big-Five types
  — either reject or document
- `voice_signal.type` enum has 30 values, only 10 mentioned in
  description / skills / README
- Stale `instructions` block in `voice_context`
  (`src/server.ts:156-166`) — captures soulContext once at module
  init
- Prompt-injection sandbox marker on user-authored soul content
  concatenated into `instructions`
- Document the trait-state throttle loss window
  (`src/server.ts:53-76`); add SIGTERM `forceSaveTraitState`
- Document the "consolidate before shutdown" operational
  requirement; optionally add a session checkpoint to disk
- `any` usage in `src/server.ts:79` and `:607` — strict-mode
  cleanup
- `voice_export` tool for backup
- Cap `avoidPatterns` extraction to filter principle-related
  strings (prompt-injection surface in `src/profile.ts:161-167`)
- `cognitive-load` flow vs disengagement — require ≥5 consecutive
  flow signals before triggering verbosity reduction
- Bipolar Plutchik filtering at the lexicon scoring step in
  `src/emotions.ts` (or soften the README claim)
- File-adapter atomic write via `rename()` for concurrent-agent
  safety (currently single-writer assumption documented as such)
- `voice_state` description's `memory_ingest` / `memory_search`
  underscores → hyphens (folded into V-002 if naming pass touches it)

---

## Don't build

These were considered and deliberately rejected.

- **Mood detection over voice / face / multimodal.** Pi tried and
  Inflection didn't survive. Warmth alone isn't a moat. Stay
  text-only.
- **Roleplay character marketplace.** Character.AI owns this.
  Different ICP.
- **Training-time persona vectors.** Anthropic and the model labs
  own activation-level interventions. przm-voice operates at the
  prompt-build layer; stay there.
- **Full reinforcement learning loop.** OpenPipe ART territory.
  Requires GPU, training infra, model weights. Stay at the prompt-
  build layer.
- **Procedural bridge extensions** before the
  `procedural-bridge.json` contract is documented as a shared
  interface (three writers today; surface area unclear; coordinate
  with `przm-memory`).
