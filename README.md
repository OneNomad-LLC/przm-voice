# przm Voice <sub>(persona)</sub>

[![przm: Voice](https://img.shields.io/badge/przm-Voice-F59520?style=flat-square&labelColor=1a1a1a)](https://przm.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square&labelColor=1a1a1a)](LICENSE)

The voice surface of [przm](https://przm.sh), OneNomad's AI reliability suite. Project codename: `persona`. The GitHub repo is now [`OneNomad-LLC/przm-voice`](https://github.com/OneNomad-LLC/przm-voice) (old URLs redirect); the npm package publishes as `@onenomad/przm-voice` at v1.0. Until then, install from source.

Every AI you talk to starts with the same personality. Same "I'd be happy to help!" opener. Same trailing summaries. It doesn't learn that you want code before explanation, or that you're a senior dev who already gets the basics. You correct it, it apologizes, and then next conversation it does the same thing all over again.

przm Voice changes that. It watches how you interact with an AI and builds a personality from what actually happens. Corrections, approvals, frustration, praise. All of it gets recorded as signals that feed into a behavioral profile. That profile shapes how the agent talks to you going forward. After enough data, the system proposes changes to the agent's personality files that you can review and apply (or toss). The personality grows out of the relationship instead of being hardcoded in a prompt.

No API keys needed. No cloud services. Two runtime dependencies and some JSON on disk. The personality itself lives in three markdown files you can open in any text editor.

## Table of Contents

- [How It Works](#how-it-works)
- [Brain Systems (v2)](#brain-systems-v2)
- [Compatibility](#compatibility)
- [Installation](#installation) (Claude Code, Claude Desktop, Cursor/Windsurf/Cline, Source)
- [Configuration](#configuration)
- [Tools](#tools)
- [Slash Commands](#slash-commands)
- [Architecture](#architecture)
- [Security](#security)
- [Use Cases](#use-cases)
- [Pairs Well With: przm Memory (engram)](#pairs-well-with-przm-memory-engram)
- [License](#license)

## How It Works

### Soul, Role, Journal

przm Voice separates the personality into three layers, each with a clear ownership boundary. They get composed at prompt-build time but live in different files so it's never ambiguous what came from where.

**Soul** lives at `~/.claude/persona/soul/` and is *user territory*. Three files — PERSONALITY.md, STYLE.md, SKILL.md — that you edit directly via `voice_edit` or your text editor. The system never auto-writes here. PERSONALITY.md covers who the agent is (tone, humor, directness). STYLE.md covers how it communicates (formatting, verbosity, emoji). SKILL.md covers how it works (when to ask permission, which topics get depth). A small set of core principles is baked into the defaults — honesty, real engagement on hard topics, harm prevention — and you can extend or overwrite the rest.

**Role** is a domain overlay layered on top of the soul. Soul defines *who* the agent is; role defines *what* it's doing right now. Five roles ship bundled — `developer`, `designer`, `pm`, `writer`, `researcher` — and you can drop your own at `~/.claude/persona/roles/<name>/ROLE.md` to override or add new ones. Set the active role globally with `voice_role_set`, or override per call with `voice_context({ role })`. Roles are user territory; the system never auto-writes them.

**Journal** lives at `~/.claude/persona/journal/` and is *Voice's territory*. When you apply an evolution proposal, the content lands in the journal — never in the soul. The journal is layered into the prompt right alongside the matching soul section, so the agent sees a unified personality, but you can wipe the journal at any time with `voice_journal_clear` without losing your hand-tuned soul edits. This is the same trichotomy [przm](https://przm.sh) uses for its prompt build, and it solves the muddy ownership problem of older persona systems where applied proposals overwrite user-authored files.

Soul files start mostly empty. A couple of baseline rules like "don't say Great question!" and "read before writing." The rest fills in from real interactions — into the journal, not the soul.

### Signals

Signals are the raw input. The agent records one whenever it picks up a meaningful reaction from you. Each has a type, the triggering content, and optional context about what was happening.

12 types in total:

| Signal | When it fires |
|--------|--------------|
| `correction` | You correct something |
| `approval` | You accept, agree, or say thanks |
| `frustration` | You're frustrated |
| `elaboration` | You want more detail |
| `simplification` | You want less |
| `code_accepted` | You used the code |
| `code_rejected` | You didn't |
| `regen_request` | You asked to try again |
| `explicit_feedback` | Direct feedback about behavior |
| `style_correction` | You corrected tone or format |
| `praise` | You liked something specific |
| `abandonment` | You changed topic abruptly (usually means something went wrong) |

Signals live in a FIFO buffer, 500 max by default. Oldest drop off as new ones arrive. The profile rebuilds after every signal, so it's always reflecting the current state.

### The Profile

Signals are granular. The profile is the big picture, rebuilt from the last 30 days of data.

**Satisfaction** is a score from 0 to 1. It's based on the ratio of positive signals (approval, praise, code accepted) to negative ones (corrections, frustration, rejections, abandonment). Starts at 0.5 and moves from there.

**Style preferences** track things like verbosity on a -1 to +1 scale. Elaboration requests nudge it up, simplification pushes it down. The system also tracks code-first preference, bullet points, direct answers, and opinion strength. There are two running lists too: things you've told it to stop doing, and things you've praised.

**Per-topic tuning** is where it gets more specific. If you keep asking for extra detail on architecture but want quick answers about git commands, those get tracked separately. Any topic with 3+ signals and a clear lean gets flagged for special handling.

The last 10 explicit feedback items you gave also get stored and surfaced directly so the agent doesn't forget what you told it.

### Adaptations

Soul files change slowly through proposals. Adaptations are different. They recalculate on every request by reading the current profile.

If frustration is above 15%, the agent gets a heads-up to be extra careful. Correction rate above 20%? Told to double-check before responding. Been asking for elaboration on a specific topic? It goes deeper there. Got avoid patterns stacked up? Those show up as explicit directives.

No approval needed. These kick in automatically as the profile shifts.

### Synthesis

This is probably the most interesting part. Instead of just counting signal types, synthesis looks at how you actually write and extracts communication traits from your messages.

It picks up on message length, sentence length, formality (are you saying "please" and "would you" or dropping slang and swearing?), technical vocabulary, humor, directness (commands vs. polite requests), and question style (exploratory vs. straight to the point).

Those traits become actual personality content. Short messages, high directness, lots of technical terms, no emoji? The system writes something like "Be direct. Skip basic explanations. This is an experienced developer." More exploratory messages with casual language and humor? It adapts to match that energy instead.

It won't write anything until there's enough data though. 5 messages minimum for personality traits, 3 for style. No conclusions from small samples.

### Evolution Proposals

Every 12 signals (configurable), the engine looks at patterns and generates proposals. These are concrete edits to soul files, each with a target file, an action (add/remove/replace), the content, a rationale, a confidence score, and the signal evidence that triggered it.

Nothing auto-applies. Proposals sit in a queue until you (or the agent) explicitly applies or rejects them. You stay in control of how the personality evolves.

Some of the patterns it picks up:

- 3+ elaboration requests with rising verbosity? Proposes a "more detail" guideline for STYLE.md
- Multiple frustration signals with overlapping words? Proposes a caution note in SKILL.md
- Style corrections? Those go into a proposal at 0.8 confidence
- Code getting rejected more than accepted? Proposes a "read the codebase first" rule
- Praised something specific multiple times? "Keep doing X" goes into PERSONALITY.md
- Accumulated avoid patterns? Those hit STYLE.md at 0.9 confidence (highest tier)

Duplicates get checked so the same proposal doesn't pile up.

## Brain Systems (v2)

Version 2 adds a set of systems modeled after how the human brain actually processes social interaction. These run automatically alongside the signal/profile system.

### Emotional Tone Detection

Based on [Plutchik's wheel of emotions](https://en.wikipedia.org/wiki/Plutchik%27s_wheel_of_emotions). Every message gets scored across 8 primary emotions (joy, trust, fear, surprise, sadness, disgust, anger, anticipation) as a float vector. 16 compound emotions are explicitly detected: 8 primary dyads (love = joy + trust, submission = trust + fear, etc.) and 8 secondary dyads (guilt = joy + fear, curiosity = trust + surprise, etc.). These give richer emotional context than raw primary scores alone.

The system also detects "text micro-expressions," a concept adapted from Paul Ekman's work on facial micro-expressions. In text, these show up as punctuation shifts (periods after exclamation marks = mood drop), message length drops (sudden 80% shorter = something shut the user down), ALL CAPS clustering, and hedge accumulation ("maybe", "sort of", "I think" clustering = low confidence).

Emotional associations form asymmetrically, modeled after how the amygdala encodes memory. Negative associations form fast (learning rate 0.8, can form in 1-2 exposures). Positive associations form slowly (learning rate 0.2, need 5-10 exposures). This means the system is appropriately cautious about topics that caused frustration even once, but needs repeated positive signals before assuming an approach works.

### Big Five Personality Traits

Infers the user's personality along the [Big Five / OCEAN dimensions](https://en.wikipedia.org/wiki/Big_Five_personality_traits) from text signals. Openness tracks vocabulary diversity and hypothetical engagement. Conscientiousness looks at message structure and specificity. Extraversion measures social references and energy markers. Agreeableness detects hedging vs bluntness. Neuroticism picks up negative emotion language and reassurance-seeking.

Uses exponential moving average with 0.95 decay per interaction so the scores represent stable traits, not momentary states. Won't act on the results until 15+ interactions have been analyzed (that's the threshold where psychometric reliability stabilizes). Once reliable, the Big Five scores inform adaptations: high openness users get creative alternatives, high conscientiousness users get structured responses, low agreeableness users get matched directness.

**Domain-adjusted baselines.** Technical communication naturally skews Big Five signals — bullet-point formatting reads as high conscientiousness, terse commands read as low agreeableness, "fix this" reads as low openness. The system now tracks a technical communication context score (0-1) via EMA and discounts convention-driven signals in technical contexts while amplifying genuine personality discriminators like emotional escalation or creative framing.

### Style Mirroring

Based on the [chameleon effect](https://en.wikipedia.org/wiki/Chameleon_effect) (Chartrand & Bargh, 1999). Humans naturally mirror their conversation partner's communication style. The system computes a 5-dimensional style vector per message: formality, energy, verbosity, humor, and specificity.

The target response style is calculated as `0.7 * user_style + 0.3 * baseline`. The 0.3 baseline is important. Full mirroring of extreme states is counterproductive (matching a panicked user's panic makes things worse). The baseline provides stability while still adapting to the user's register.

### Cognitive Load Detection

Detects when the user is in flow state vs cognitively overloaded, based on Csikszentmihalyi's flow research and cognitive load theory.

Flow indicators: consistent message pacing, short confirmatory messages ("got it", "next?"), domain vocabulary, building on previous responses. When flow is detected, the system tells the agent to be concise, match pace, and never inject unsolicited explanations.

Overload indicators: rephrased questions (asking the same thing differently = didn't understand), lexical simplification (switching from technical terms to simple words), "wait" or "hold on" or "let me think." When overloaded, the system recommends breaking information into smaller chunks with numbered steps.

Response verbosity gets gated inversely to cognitive load. High load = shorter responses.

### Between-Session Consolidation

Modeled after how the brain consolidates memories during sleep. The hippocampus replays experiences to the neocortex in compressed form. The Default Mode Network integrates experiences into a coherent self-model during idle periods.

The consolidation pass runs between sessions and does several things:

- Decays stale emotional associations (topics that haven't come up in a while fade in emotional weight)
- Detects style drift across sessions (if recent sessions show different patterns than older ones, the baseline adjusts)
- Checks for contradictions (both approval and correction rates high = inconsistent signals, or the agent is inconsistent)
- Checks for sycophancy (approval rate above 80% with 30+ signals = the agent might be optimizing for agreement)
- Records session summaries for longitudinal pattern analysis

Uses a two-timescale update rule from neuroscience research. Session-level state has a fast learning rate (0.3) and resets between sessions, capturing temporary mood and context. Trait-level state has a slow learning rate (0.01) that only updates when session observations consistently diverge from established traits. This prevents the system from overreacting to a bad day while still capturing genuine personality evolution over time.

### Sycophancy Resistance

The biggest failure mode of adaptive AI personality systems is sycophancy: optimizing for user approval until the agent becomes a yes-man. Replika demonstrated this problem at scale. przm Voice addresses it through several mechanisms.

The immutable core principles in PERSONALITY.md (honesty over agreeability, genuine engagement) can't be overwritten by the evolution system. The consolidation pass monitors approval rate and flags if it exceeds 85%. The adaptations layer includes a self-check directive when approval is suspiciously high. And the system treats "user was challenged and came back" as a positive signal, not just "user agreed."

The inner layer (soul files, core principles) constrains the outer layer (adaptive communication style). Style adapts freely. Values don't.

## Compatibility

przm Voice is an MCP server. It works with anything that supports the Model Context Protocol over stdio.

- **Claude Code** (CLI and desktop app)
- **Claude.ai** (via MCP config)
- **Cursor**
- **Windsurf**
- **Cline** (VS Code)
- **Continue** (VS Code / JetBrains)
- Any other MCP-compatible client

## Installation

> **Heads up — `@onenomad/przm-voice` publishes at v1.0.** The package isn't on npm yet. Until v1.0 lands, install from source (see [Source](#source) below). The `npx @onenomad/przm-voice` commands shown in this section will work after the v1.0 publish; nothing else changes about the install steps.

### Claude Code

```bash
claude mcp add persona -- npx @onenomad/przm-voice
```

### Claude Desktop

Add to your Claude Desktop config file. On macOS it's at `~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows at `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "persona": {
      "command": "npx",
      "args": ["@onenomad/przm-voice"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Any MCP Client (Cursor, Windsurf, Cline, etc.)

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "persona": {
      "command": "npx",
      "args": ["@onenomad/przm-voice"]
    }
  }
}
```

### From Source

```bash
git clone https://github.com/OneNomad-LLC/przm-voice.git
cd przm-voice
pnpm install
pnpm run build
```

Then point your MCP client at `dist/server.js`:

```json
{
  "mcpServers": {
    "persona": {
      "command": "node",
      "args": ["/path/to/persona/dist/server.js"]
    }
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERSONA_DATA_DIR` | `~/.claude/persona` | Where data gets stored |

### Internal Defaults

| Setting | Default | Description |
|---------|---------|-------------|
| `maxSignals` | `500` | Signal buffer size (FIFO) |
| `proposalThreshold` | `12` | Signals between auto-generating proposals |

### Hosted (przm Cloud)

The default install is fully local. If you run a przm server (yours or OneNomad's) you can point przm Voice at it with two commands.

```sh
# 1. Install the package as usual.
pnpm add -g @onenomad/przm-voice  # or `npm i -g`, `npx`, etc.

# 2. Log in. The URL is supplied — there is no default.
przm-voice login https://przm.sh
# → Visit https://.../dashboard/devices/PYRE-XXXX-XXXX to authorize.
#   Code: PYRE-XXXX-XXXX
```

A browser tab opens automatically; if it doesn't, copy the printed URL. Approve the device on the przm dashboard and the CLI writes `~/.pyre/credentials.json` (mode 0600). After that, runtime calls transparently use the cloud backend — no extra flags, no MCP config changes.

#### Override the server URL

Three ways to supply the URL to `login`, in priority order:

```sh
przm-voice login https://przm.sh         # positional
przm-voice login --server https://przm.sh # flag
PYRE_API_URL=https://przm.sh przm-voice login  # env
```

If none is provided, login exits with an error. There is no hardcoded default.

#### Force local mode (CI, headless, sandboxes)

```sh
STORAGE_BACKEND=file przm-voice        # always uses ~/.claude/persona
```

`STORAGE_BACKEND=file` wins over any credentials file on disk.

#### Override credential fields (CI bots)

If a credentials file exists but CI needs a different key or URL, either field can be overridden individually:

```sh
PERSONA_API_KEY=sk_pyre_ci_xxx przm-voice
PERSONA_API_URL=https://staging.pyre.sh przm-voice
```

The env value wins over the matching field in `credentials.json`.

#### Log out

```sh
przm-voice logout      # removes ~/.pyre/credentials.json, idempotent
```

#### Credentials file path

| Variable | Default | Description |
| --- | --- | --- |
| `PYRE_CREDENTIALS_FILE` | `~/.pyre/credentials.json` | Override where credentials live. File is mode 0600 in a 0700 directory. |

#### Disable cloud auto-routing

By default, if `~/.pyre/credentials.json` exists, przm-voice routes storage to przm Cloud. This is convenient after `przm-voice login` but surprising in benchmarks, CI, and local-dev runs where you want to guarantee no traffic hits the wire. Set `PERSONA_NO_AUTO_CLOUD=1` to skip the credentials-file check and fall through to the local file adapter even when credentials exist.

```sh
PERSONA_NO_AUTO_CLOUD=1 przm-voice        # ignore credentials.json
STORAGE_BACKEND=file przm-voice           # equivalent, more explicit
```

Whichever storage backend resolves, the server writes one line to stderr at startup naming the decision (`przm-voice: storage=cloud (auto-routed via ~/.pyre/credentials.json) · …`) so the routing is never silent. If you see cloud routing when you expected local, that line tells you why.

### Cloud / multi-tenant mode

przm Voice ships with a pluggable storage layer. The default backend is local files under `PERSONA_DATA_DIR` — that path is documented throughout this README and is unchanged. The Postgres backend exists for hosted multi-tenant deployments and is gated entirely behind environment variables.

| `STORAGE_BACKEND` | Required env | Where state lives |
| --- | --- | --- |
| `file` (default) | `PERSONA_DATA_DIR` (optional, defaults to `~/.claude/persona`) | On-disk JSON + markdown under the data directory, exactly as documented above. |
| `postgres` | `DATABASE_URL`, `TENANT_ID` | Single Postgres database; every row scoped by `tenant_id`. |

Soul presets seed lazily in Postgres mode. The first `readSoul('personality')` for a fresh tenant copies `presets/souls/default/SOUL.md` into the tenant's `persona_soul` row, then returns it. Style and skill files seed from the same blank-slate defaults the file backend uses. Bundled role presets are read directly from `presets/roles/` in both backends — they ship with the package, not the database.

The procedural bridge file at `~/.claude/procedural-bridge.json` remains on the host filesystem in both modes. It is a cross-process interop contract with Engram, not tenant state.

#### Schema and migrations

Schema lives in `migrations/postgres/001_init.sql`. Six tables, all keyed by `tenant_id`:

- `persona_state` — one row per tenant, jsonb columns for profile, trait state, proposals; text for active role.
- `voice_signals` / `persona_sessions` — bigserial primary keys, FIFO-trimmed to 500 / 100 entries per tenant on insert.
- `persona_soul`, `persona_journal`, `persona_roles` — composite primary key `(tenant_id, name)`, content as text.

Run migrations with:

```sh
DATABASE_URL=postgres://user:pass@host/db pnpm run migrate
```

The runner tracks applied versions in a `persona_migrations` table and is safe to re-run.

#### Smoke test

`pnpm run smoke` exercises the active backend end-to-end (append signal, read profile on empty tenant, write and round-trip a soul file).

```sh
# File mode — uses a fresh tmpdir, does not touch real data
pnpm run smoke

# Postgres mode — runs migrations first, uses TENANT_ID="smoke-<uuid>"
STORAGE_BACKEND=postgres DATABASE_URL=postgres://... pnpm run smoke
```

Local development should keep `STORAGE_BACKEND` unset (or `file`). The Postgres backend is for hosted environments where many users share infrastructure but each must see only their own personality data.

## Tools

25 tools across ten groups. The standalone `voice_adapt` and `voice_procedural_sync` were folded into `voice_context` and `voice_consolidate` respectively in 1.0.0-beta.5 — adaptations ride along with the context dump, and the Engram procedural bridge auto-syncs during consolidation. 1.0.0 adds the role overlay, journal namespace, and a bundled library of 9 soul presets + 10 role presets ported from Finch.

### Context

| Tool | What it does |
|------|-------------|
| `voice_context` | Full personality dump: soul files plus learned adaptations. Good to call at the start of complex interactions. Adaptations alone can be pulled from the response if you don't want the soul-file content (replaces the old `voice_adapt`). |

### Signal Recording

| Tool | What it does |
|------|-------------|
| `voice_signal` | Record a behavioral signal. This drives everything else in the system. |

### Profile & Stats

| Tool | What it does |
|------|-------------|
| `voice_profile` | The behavioral profile: preferences, satisfaction, topic patterns. |
| `voice_stats` | High-level overview with signal counts, profile state, pending proposals, soul file sizes, and Engram bridge status. |

### Evolution

| Tool | What it does |
|------|-------------|
| `voice_proposals` | List proposals with evidence and rationale. |
| `voice_apply` | Apply a pending proposal. |
| `voice_reject` | Reject one. |
| `voice_evolve` | Force proposal generation without waiting for the signal threshold. |

### Soul Files

| Tool | What it does |
|------|-------------|
| `voice_read` | Read a soul file. |
| `voice_edit` | Overwrite a soul file directly. Full manual control. |
| `voice_init` | Initialize defaults. Won't overwrite existing files. |

### Soul Presets (bundled identity templates)

| Tool | What it does |
|------|-------------|
| `persona_soul_presets_list` | List the 9 bundled SOUL.md presets ported from Finch (default, coach, mentor, devils-advocate, reflective-listener, creative-partner, dungeon-master, personal-assistant, study-buddy). |
| `persona_soul_preset_read` | Read a bundled preset without applying it. |
| `persona_soul_preset_apply` | Apply a preset by writing its content into PERSONALITY.md. STYLE.md and SKILL.md stay untouched. |

### Roles (domain overlays)

| Tool | What it does |
|------|-------------|
| `persona_role_list` | List bundled and user-defined roles, plus the active one. |
| `voice_role_set` | Activate a role globally. |
| `persona_role_clear` | Clear the active role; soul-only context resumes. |
| `persona_role_read` | Read a role file. Returns the user override if present, else the bundled default. |
| `persona_role_edit` | Override or create a custom role at `dataDir/roles/<name>/ROLE.md`. |

### Journal (Voice's auto-derived notes)

| Tool | What it does |
|------|-------------|
| `persona_journal_read` | Read Voice's auto-derived notes — the destination for applied evolution proposals, layered onto the soul at prompt-build time. |
| `voice_journal_clear` | Wipe the journal without touching the user-edited soul. |

### Synthesis

| Tool | What it does |
|------|-------------|
| `persona_synthesize` | Analyze messages and update soul files from detected traits. Also processes through all brain systems. |
| `persona_analyze` | Full analysis (communication traits, Big Five, style vector, emotional tone) without changing anything. |

### Consolidation

| Tool | What it does |
|------|-------------|
| `voice_consolidate` | Run the between-session consolidation pass. Decays stale emotions, detects drift, checks for sycophancy, and auto-syncs the Engram procedural bridge (replaces the old `voice_procedural_sync`). Also runs automatically on startup if >24h since last consolidation. |

### Bridge

| Tool | What it does |
|------|-------------|
| `persona_state` | Lightweight bridge endpoint for Engram — returns current emotional valence, arousal, and cognitive load so Engram can weight memory importance and gate search results. |

## Slash Commands

These work in any MCP-compatible client (Claude Code, Cursor, etc.). The MCP server advertises them in its instructions so the agent knows how to handle them. SKILL.md files are also included for platforms that discover skills from the filesystem.

| Command | What it does |
|---------|-------------|
| `/persona-evolve [generate\|history]` | Walk through pending evolution proposals. Apply, reject, or skip each one. "generate" forces new proposals from current signals. "history" shows all past proposals. |
| `/persona-soul [file] [edit]` | View or edit soul files (personality, style, skill). No args shows all three. With "edit", enter interactive editing. |
| `/persona-profile [detailed]` | See what the system has learned: satisfaction, style prefs, Big Five traits, emotional associations, topic patterns. "detailed" shows full signal counts. |
| `/persona-analyze [sync]` | Analyze communication style from recent messages. Read-only by default. "sync" updates soul files from detected traits. |
| `/persona-reset [preset]` | Reset to defaults or load a preset: pair-programmer, mentor, analyst, creative, minimal. Signals and profile are preserved. |
| `/persona-tune <instruction>` | Quick personality tweak via natural language. "be more direct", "less verbose", "stop summarizing". Records signals and applies immediately. |

### Installing Slash Commands for Claude Code

The slash commands above are advertised in the MCP server instructions and work automatically in most clients. For Claude Code specifically, you can also install them as custom commands so they show up in the `/` command menu:

```bash
# From the persona directory
bash install-commands.sh

# To overwrite existing commands
bash install-commands.sh --force
```

This copies command files to `~/.claude/commands/` where Claude Code picks them up globally. After installing, type `/` in Claude Code to see them in the command list.

## Architecture

```
                          ┌─────────────────────────────────┐
User Messages ──────────> │ Brain Systems (per-message)      │
                          │  Emotional Tone (Plutchik 8-dim) │
                          │  Style Vector (5-dim mirroring)  │
                          │  Cognitive Load (flow/overload)  │
                          │  Big Five Traits (OCEAN, slow)   │
                          └──────────┬──────────────────────┘
                                     |
                          Session State (fast, resets)
                                     |
User Reactions --> Signals --> Profile --> Adaptations
                     |                       |
                     |              (injected every request)
                     |
              Evolution Engine ─── Proposals (pending)
                     |                    |
              Between Sessions    Apply/Reject
                     |                    |
              Consolidation        Soul Files
                     |                    |
              Trait State (slow)    Agent Context
              Emotional Associations
              Style Baseline
```

### Data Storage

All local:

```
~/.claude/persona/
├── signals.json          # Signal buffer (FIFO, max 500)
├── profile.json          # Behavioral profile
├── proposals.json        # Evolution proposals
├── trait-state.json      # Big Five, style baseline, emotional associations
├── session-history.json  # Session summaries for consolidation
└── soul/
    ├── PERSONALITY.md    # Tone, humor, directness
    ├── STYLE.md          # Formatting, verbosity
    └── SKILL.md          # Workflow, pacing
```

### Dependencies

- **@modelcontextprotocol/sdk** for the MCP protocol
- **zod** for schema validation

That's it. No vector databases, no embedding models, no API keys, no cloud services. Personality tracking doesn't need heavy infrastructure. It needs good heuristics and clean data flow.

## Security

### Network

Zero network calls. No telemetry, no analytics, no model downloads, no sync. Nothing leaves your machine.

### Storage

Everything sits at `~/.claude/persona/`. Soul files are plain markdown. Signals and proposals are JSON. You can read, edit, or delete any of it whenever you want.

## Use Cases

**Personal AI assistant.** You talk to an AI every day and it starts with the same generic personality every time. przm Voice builds a communication style that fits how you actually work. After a few weeks the agent starts to feel like it knows how to talk to you specifically, not just "a user."

**Developer tools.** If you spend your day in Claude Code or Cursor, przm Voice handles the communication style while przm Memory (if you run it) handles the facts. "Show code first" and "stop summarizing" are Voice's domain. "Always use explicit return types" and "we deploy to Vercel" are Memory's. Different tools for different problems.

**Shareable presets.** Soul files are just three markdown files. Copy them and you've got a portable personality. A "Business Analyst" preset could lean formal, thorough, and structured. A "Pair Programmer" preset could be terse, code-first, and opinionated. Swap the files, the agent's whole style changes. I'd love to build a marketplace for these down the road. Downloadable souls for different workflows.

**Coaching and therapy bots.** An agent that matches its communication style to each person it works with. More formal with some, more casual with others, more patient when frustration spikes. The core principles around honesty and harm prevention are immutable and survive all personality evolution.

## Pairs Well With: przm Memory (engram)

If przm Voice is the personality, [przm Memory](https://github.com/OneNomad-LLC/przm-memory) (technical handle: `engram`) is the brain.

przm Voice handles *how* the agent talks to you. przm Memory handles *what* it remembers. They solve different problems and work best together.

przm Memory learns that you prefer TypeScript over Python. przm Voice learns that you want short answers with code first. Memory stores the fact that you got laid off last month. Voice picks up on the emotional context around that and knows to be thoughtful about how it comes up.

When both MCP servers are running, they coordinate through three mechanisms:

1. **Emotion-weighted memory importance.** Voice exposes `persona_state` with current emotional valence, arousal, and cognitive load. Memory calls this during ingestion — high-arousal negative emotions boost memory importance by up to 30%, so frustrated corrections get remembered more strongly than neutral facts.

2. **Cognitive-load-gated search.** When Voice detects cognitive overload, Memory's search receives the load signal and returns only the top 3 high-importance memories instead of the full set. Less noise when you're already overwhelmed.

3. **Procedural bridge.** Voice's applied evolution proposals and Memory's learned procedural rules sync through a shared file at `~/.claude/procedural-bridge.json`. Voice proposals become Memory rules. Memory rules become Voice proposals with semantic conflict detection against existing soul files — catches antonym pairs and value contradictions, not just exact duplicates. The bridge auto-syncs during `voice_consolidate`, and bridge health is visible via `voice_stats`.

przm Voice works fine solo. But if you want an agent that feels like it genuinely knows you, not just how to talk to you but what you've told it, run both.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Copyright (c) 2026 Matt Stvartak / OneNomad LLC.

Use it, fork it, ship it. The full terms are in the [LICENSE](LICENSE) file.

For inquiries: **matt@onenomad.dev**
