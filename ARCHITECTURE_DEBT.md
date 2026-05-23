# Architecture Debt

Living ledger of known shortcuts in przm-voice's architecture. Each
entry captures the choice, why we made it, what hurts today (or what
*will* hurt), and the trigger that should make us revisit. The point
is not to fix everything — it's to make the choices visible so we
don't rediscover them under pressure.

Add new entries at the bottom. When closing one out, leave the entry
in place with a `## Resolved (YYYY-MM-DD)` heading and a one-line note
on what shipped — the historical record is more useful than a clean
slate.

The forward-looking work-queue lives in `ROADMAP.md`; that's where
items not-yet-shipped are tracked. This file is the backward-looking
record of choices already made and intentional debt carried.

---

## Resolved (2026-05-22) — V-001: Postgres mode dead on arrival

**Was:** `migrations/postgres/001_init.sql` created `persona_state`
and `persona_signals`. The adapter (`src/storage/postgres-adapter.ts`)
queried `voice_state` and `voice_signals`. Running
`STORAGE_BACKEND=postgres` against a freshly migrated DB threw
"relation does not exist" on init.

**Resolved by:** `001_init.sql` now creates the canonical `voice_*`
names. `migrations/postgres/002_rename.sql` ALTER-renames any
existing `persona_state` / `persona_signals` tables (plus the
`persona_signals_tenant_created_idx` index) so deployed installations
upgrade cleanly. The four already-aligned tables (`persona_sessions`,
`persona_soul`, `persona_journal`, `persona_roles`) are left at their
existing names; renaming them is out of scope for this fix.

---

## Resolved (2026-05-22) — V-002: persona → voice naming drift

**Was:** `src/server.ts` registered tools as `voice_*` but README,
all six `skills/persona-*/SKILL.md` files, `.claude-plugin/plugin.json`,
`server.json`, `.mcp.json`, `src/cli.ts`, `src/auth/login.ts`
(`package_name: 'persona'` in cloud auth), and the `voice_state` tool
description (which incorrectly named `memory_ingest`/`memory_search`
with underscores instead of hyphens) all used stale `persona_*` names
or referred to deleted tools (`voice_adapt` was folded into
`voice_context`). A fresh LLM following the docs called a tool surface
that didn't exist.

**Resolved by:** Alias table in `src/server.ts:1163+` registers every
tool under both `voice_*` (canonical) and `persona_*` (deprecation
runway) — same shape as the alias landing in `przm-memory`. README
§Tools rewritten to canonical names with a "legacy aliases kept for
backward compatibility" note. `.claude-plugin/plugin.json`,
`server.json`, `.mcp.json`, `src/cli.ts`, and `src/auth/login.ts`
updated. All six `skills/persona-*/` directories deleted (no concrete
client uses them; `.claude/commands/` is the single source of truth).
The benchmark workspace package names and internal references also
canonicalized to `voice-*` in the same pass. Aliases will be removed
in v2.

---

## Resolved (2026-05-22) — V-003: Soul/journal write-boundary violation

**Was:** README §How It Works promised the system never auto-writes
to soul. In reality, `src/synthesis.ts:358-398`
(`updateSoulFromSynthesis`) called `writeSoulFile()` for personality,
style, and skill on every `voice_synthesize` call.
`src/soul-presets.ts` did the same for `voice_soul_preset_apply`. The
stop hook called `voice_synthesize` every 10 turns. A user hand-
editing PERSONALITY.md lost their edits silently.

**Resolved by:** Synthesis output and preset-apply output now route
through `appendJournal` (`src/journal.ts:38`) instead of
`writeSoulFile`. Soul files remain user territory; the journal layer
holds system-generated content with clear markers. `voice_edit` and
`voice_init` remain the two explicit user-driven write paths to
soul. IMMUTABLE_PRINCIPLES re-prepending behavior preserved.

---

## Resolved (2026-05-22) — V-004 + V-005: pinnedFeedback cap + array schemas

**Was:**
- `src/types.ts:114` had no length cap on `pinnedFeedback`;
  `src/adaptations.ts:182-185` injected the full list into every
  `voice_context` call. A user pinning 200 items added 200+ lines to
  every request.
- `voice_synthesize.messages` and `voice_analyze.messages` were
  schemed as `z.string()` documented as "JSON array of user message
  strings," with `JSON.parse(messages)` in the handler. CSV-in-string
  anti-pattern.

**Resolved by:** `pinnedFeedback` capped at 50 with oldest-drop
behavior. `voice_stats` warns when pinned > 30. Both
`messages` parameters now `z.array(z.string()).min(1)` — handler
takes arrays directly, no JSON.parse.

---

## Resolved (2026-05-22) — V-006 + V-007 + V-008: Postgres + cloud adapter hardening

**Was:**
- `src/storage/postgres-adapter.ts:161` initialized the Pool without
  any `ssl` option. Cloud Postgres (Supabase, Neon, Heroku, RDS)
  typically requires `sslmode=require`.
- `src/storage/postgres-adapter.ts:379-397` (signals) and `:421-436`
  (sessions) did INSERT + DELETE as two autocommit statements. The
  DELETE used `NOT IN (subquery)` (O(n×m)). A crash between the two
  left the table over the cap permanently.
- `src/storage/postgres-adapter.ts:292-298` and
  `src/storage/cloud-adapter.ts:344-349` swallowed write-behind queue
  errors with `.catch(err => console.error(...))`. `await flush()`
  resolved successfully even if writes failed.

**Resolved by:**
- Pool now defaults `ssl: { rejectUnauthorized: true }` unless the
  connection string contains localhost / 127.0.0.1 or
  `PRZM_VOICE_PG_SSL=off` is set. Documented in README.
- FIFO trim wrapped in `BEGIN` / `COMMIT` with ROLLBACK on error.
  Switched to offset-based trim with a new `(tenant_id, id DESC)`
  index added by `002_rename.sql`.
- Both adapters track `lastWriteError`; the field is exposed on the
  `StorageAdapter` interface so the MCP server can surface a
  `storageWarning` on tool responses when a recent write failed.

---

## How to add an entry

Pick the next `DEBT-NNN` number. Stick to this skeleton:

```
## DEBT-NNN — One-line title

**Where:** file path / module.
**Choice:** what we did.
**Why:** what trade-off we accepted.
**What hurts:** what this costs us today / what it will cost.
**Revisit when:** the trigger that should make us revisit.
**Pattern reference:** (optional) link to architecture pattern note.
```

Resist the urge to write "we should fix this later" as a closing
line. Every entry that survives in the ledger is one we explicitly
chose not to fix today; that's the whole point of the file.

---

## Seed entries (intentional shortcuts to track going forward)

The architecture audit on 2026-05-22 surfaced several intentional
design shortcuts that should be visible here even though they aren't
scheduled fixes. Items below are forward-looking carries, not bugs.

### DEBT-V-001 — Sync `StorageAdapter` interface over async backends

**Where:** `src/storage/adapter.ts`, `postgres-adapter.ts`,
`cloud-adapter.ts`.

**Choice:** The `StorageAdapter` interface is synchronous. Postgres
and Cloud adapters bridge the impedance mismatch with in-memory
caching plus a write-behind queue (`enqueue()` chain).

**Why:** The synchronous interface keeps every consumer (signals,
profile rebuild, evolution, soul/role lookups) simple. Making them
all `async` would have multiplied the surface change and slowed the
file path needlessly.

**What hurts:** Adapter callers can't distinguish "cache hit" from
"in-flight write." `await flush()` is the only consistency primitive
exposed, and consumers must remember to call it. The "consolidate
before shutdown" operational requirement traces back to this choice.

**Revisit when:** Adding a transactional multi-write API (signal +
profile rebuild + trait state as one atomic step) becomes a
requirement — likely tied to the hosted multi-tenant tier.

---

### DEBT-V-002 — No atomic multi-step write across signal + profile + brain-systems

**Where:** `src/server.ts:356-481` (`voice_signal` handler).

**Choice:** Each `voice_signal` call performs `appendSignal` →
`processUserMessage` (emotions / cognitive load) → `rebuildProfile` →
`maybe-generateProposals`. None of the four are atomic at the
persistence layer; a crash between `appendSignal` and
`rebuildProfile` leaves the profile stale relative to signals.

**Why:** Recovery is automatic — `rebuildProfile()` on the next call
or on startup load reads current signals and reconstructs. Acceptable
for the local-first single-user shape today.

**What hurts:** Hosted multi-tenant deployments need stronger
guarantees. A failed write in the cloud adapter is silently dropped
(see V-008's `lastWriteError` surfacing — that's a workaround, not a
fix). Real fix needs a Postgres transaction spanning the four steps
in Postgres mode, plus a write-ahead journal in file mode.

**Revisit when:** Hosted tier ships, OR a single bad multi-step
ingest surfaces in production support.

---

### DEBT-V-003 — `tenant_id` isolation without Postgres RLS

**Where:** `migrations/postgres/001_init.sql`,
`src/storage/postgres-adapter.ts` (every query scopes by
`tenant_id = $1`).

**Choice:** Application-level tenant isolation via bound parameters
on every query. No `CREATE POLICY` / RLS.

**Why:** Defense-in-depth isn't needed at the current single-tenant-
per-process deployment shape. RLS adds connection-level state and a
per-tenant role pattern that's nontrivial.

**What hurts:** For hosted multi-tenant where multiple tenants share
a single Postgres instance and connection pool, one buggy code path
that omits the tenant filter would expose data across tenants with no
database-level backstop.

**Revisit when:** Hosted multi-tenant tier ships. Pattern-share with
the equivalent work in `przm-memory` (DEBT-001 in that repo's
ledger).

---

### DEBT-V-004 — In-memory session state; no checkpoint

**Where:** `src/server.ts:39` (`session: SessionState` module-level).

**Choice:** Session-level brain state (emotional tone, style vector,
cognitive load, message count) lives only in memory. It rolls into
trait state on `voice_consolidate`, then resets.

**Why:** By design per the two-timescale architecture — sessions
reset, traits persist. Simple.

**What hurts:** Server kill before consolidation = session's brain-
state contributions are lost. The "consolidate before shutdown"
operational requirement isn't documented anywhere a user is likely
to read.

**Revisit when:** A user-visible incident traces back to lost
session state, OR the hosted tier needs survivability across restart.

---

### DEBT-V-005 — Theoretical claims oversold relative to evidence

**Where:** README "Brain Systems (v2)" section, `src/emotions.ts`,
`src/traits.ts`, `src/consolidation.ts`.

**Choice:** README cites Plutchik, Big Five OCEAN, Csikszentmihalyi
flow, Chartrand-Bargh chameleon effect, and two-timescale neuro-
science by name. The implementations are competent but the
mappings are heuristic — Plutchik is implemented as 8 independent
dimensions rather than bipolar pairs; "CLS-like" is two EMAs at
different rates with no replay or pattern separation; cognitive load
detection on terse messages is indistinguishable from disengagement-
by-terseness.

**Why:** The framing is the marketing moat — no competitor in the
adaptive-personality space cites real psychometrics. Softening the
claims pre-eval would weaken the positioning before the underlying
work is done.

**What hurts:** Methodologically rigorous reviewers will flag the
gap. The three in-repo benchmarks (signal-classification, sycophancy-
detection, style-recall) are circular self-consistency checks; the
product's central claim — that adaptive personality changes agent
behavior in user-relevant ways — has zero supporting evidence.

**Revisit when:** Items V-016 (replace benches with non-circular
evals), V-017 (token-budget ablation), V-018 (threshold sensitivity
analysis), and V-023 (IPIP-NEO validation panel) ship from
ROADMAP.md. At that point the claims can be calibrated to the
evidence — or relaxed where they shouldn't have been made.
