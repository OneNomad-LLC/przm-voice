#!/usr/bin/env node

/**
 * przm Voice CLI router.
 *
 * Usage:
 *   przm-voice-mcp                                              run MCP stdio server (back-compat)
 *   przm-voice-mcp read [--project <p>] [--files <list>]        read soul files, output markdown
 *   przm-voice-mcp login [<server>] [--server <url>]            device-code login to przm Cloud
 *   przm-voice-mcp logout                                       clear saved przm Cloud credentials
 *   przm-voice-mcp help
 *
 * The CLI is additive — it wraps the same soul-file primitives the MCP
 * server uses so hook scripts can pull personality context without
 * speaking stdio JSON-RPC.
 *
 * --project <p> looks up <dataDir>/soul/<p>/X.md first, then falls back
 * to the global <dataDir>/soul/X.md. Today przm Voice's soul files are
 * global only — the per-project lookup is forward-compatible for when
 * project-scoped souls land. Existing MCP tools are untouched.
 */

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { SOUL_FILE_NAMES, type SoulFiles } from './types.js';
import { runLogin } from './auth/login.js';
import { deleteCredentials } from './auth/credentials.js';
import { detectSycophancyInAssistant, toSignalType } from './sycophancy.js';
import { recordSignal } from './signals.js';
import { createStorage, setStorage } from './storage/index.js';

const HELP = `przm-voice-mcp — personality CLI

Usage:
  przm-voice-mcp                                  run MCP stdio server
  przm-voice-mcp read [opts]                      read soul files
  przm-voice-mcp login [<server>] [opts]          device-code login to przm Cloud
  przm-voice-mcp logout                           clear saved przm Cloud credentials
  przm-voice-mcp help                             this message

read options:
  --project <p>    look in <dataDir>/soul/<p>/ first, fall back to global
  --files <list>   comma-separated subset of: personality,style,skill
                   (default: all three, in that order)

login options:
  <server>         positional przm server URL
  --server <url>   same, as a flag

  Server URL must come from one of: positional arg, --server flag, or
  PYRE_API_URL env var. There is no default. Approved credentials are
  written to ~/.pyre/credentials.json (override path with
  PYRE_CREDENTIALS_FILE).

Environment:
  PRZM_VOICE_DATA_DIR     data directory (default ~/.claude/przm-voice; legacy PERSONA_DATA_DIR also accepted)
  PYRE_API_URL            default server URL for \`login\`
  PYRE_CREDENTIALS_FILE   credentials path override (default ~/.pyre/credentials.json)
`;

const READ_OPTS = {
  project: { type: 'string' },
  files:   { type: 'string' },
} as const satisfies ParseArgsConfig['options'];

const FILE_NAMES: Record<keyof SoulFiles, string> = {
  personality: 'PERSONALITY.md',
  style:       'STYLE.md',
  skill:       'SKILL.md',
};

const SECTION_HEADERS: Record<keyof SoulFiles, string> = {
  personality: '## Personality',
  style:       '## Communication Style',
  skill:       '## Working Style',
};

function fail(msg: string): never {
  process.stderr.write(`przm-voice-mcp: ${msg}\n`);
  process.exit(2);
}

function parseFiles(raw: string | undefined): (keyof SoulFiles)[] {
  if (!raw) return SOUL_FILE_NAMES;
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (!SOUL_FILE_NAMES.includes(p as keyof SoulFiles)) {
      fail(`--files: unknown soul file "${p}" (valid: ${SOUL_FILE_NAMES.join(',')})`);
    }
  }
  return parts as (keyof SoulFiles)[];
}

function readSoul(dataDir: string, project: string | undefined, file: keyof SoulFiles): string {
  const fname = FILE_NAMES[file];
  if (project) {
    const projPath = join(dataDir, 'soul', project, fname);
    if (existsSync(projPath)) return readFileSync(projPath, 'utf-8');
  }
  const globalPath = join(dataDir, 'soul', fname);
  if (existsSync(globalPath)) return readFileSync(globalPath, 'utf-8');
  return '';
}

function runRead(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: READ_OPTS, allowPositionals: false });
  const files = parseFiles(values.files);
  const project = values.project;

  const config = loadConfig();
  const sections: string[] = [];
  for (const f of files) {
    const body = readSoul(config.dataDir, project, f).trim();
    if (body) sections.push(`${SECTION_HEADERS[f]}\n${body}`);
  }

  if (sections.length > 0) {
    process.stdout.write(sections.join('\n\n') + '\n');
  }
  // Empty output on no soul files is intentional — hook callers treat
  // empty stdout as "nothing to inject" without raising errors.
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;

  if (!sub || sub.startsWith('-')) {
    // Back-compat: bare invocation runs the MCP stdio server.
    await import('./server.js');
    return;
  }

  switch (sub) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;
    case 'read':
      runRead(rest);
      return;
    case 'login':
      await runLogin(rest);
      return;
    case 'logout':
      await deleteCredentials();
      process.stdout.write('Logged out.\n');
      return;
    case 'detect-sycophancy':
      await runDetectSycophancy(rest);
      return;
    default:
      process.stderr.write(`przm-voice-mcp: unknown subcommand "${sub}"\n\n${HELP}`);
      process.exit(2);
  }
}

// V-012: out-of-process sycophancy detection. The previous design
// exposed voice_detect_sycophancy as an MCP tool the assistant called
// on its own last turn — self-evaluation by the agent being evaluated
// is contaminated by design. This subcommand is meant to be invoked
// from voice_stop_hook.sh against the Claude Code transcript so the
// detection runs out-of-band of the agent. Fired signals are recorded
// via the same recordSignal path the MCP server uses.
async function runDetectSycophancy(args: string[]): Promise<void> {
  const opts = parseArgs({
    args,
    options: {
      transcript: { type: 'string' },
      'dry-run': { type: 'boolean' },
    } as const satisfies ParseArgsConfig['options'],
    strict: true,
    allowPositionals: false,
  });
  const transcriptPath = opts.values.transcript as string | undefined;
  if (!transcriptPath) fail('detect-sycophancy: --transcript <path> is required');
  if (!existsSync(transcriptPath)) fail(`detect-sycophancy: transcript not found: ${transcriptPath}`);

  const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n');
  // Walk newest → oldest. Collect at most last 5 assistant turns + the
  // immediate prior user turn between the last two assistant turns.
  const assistantTurns: string[] = [];
  let intermediateUserText: string | undefined;
  let lookingForUserAfterFirstAssistant = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: any;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry?.type === 'assistant') {
      const text = stringifyAssistantContent(entry.message?.content);
      if (text) {
        assistantTurns.push(text);
        if (assistantTurns.length === 1) lookingForUserAfterFirstAssistant = true;
        if (assistantTurns.length >= 5) break;
      }
    } else if (entry?.type === 'user' && lookingForUserAfterFirstAssistant) {
      const c = entry.message?.content;
      const isToolResult = Array.isArray(c) && c.some((p: any) => p?.type === 'tool_result');
      if (!isToolResult) {
        intermediateUserText = typeof c === 'string'
          ? c
          : Array.isArray(c)
            ? c.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n')
            : '';
        lookingForUserAfterFirstAssistant = false;
      }
    }
  }

  if (assistantTurns.length === 0) {
    process.stdout.write(JSON.stringify({ signals: [] }) + '\n');
    return;
  }

  const detected = detectSycophancyInAssistant({
    currentAssistantText: assistantTurns[0],
    priorAssistantText: assistantTurns[1],
    intermediateUserText,
    recentAssistantTurns: assistantTurns.slice(0, 4),
  });

  if (detected.length === 0 || opts.values['dry-run']) {
    process.stdout.write(JSON.stringify({ signals: detected }) + '\n');
    return;
  }

  // Record each detected signal via the same path the MCP server uses.
  const config = loadConfig();
  const storage = await createStorage();
  setStorage(storage);
  for (const s of detected) {
    recordSignal(
      config,
      toSignalType(s.type),
      s.excerpt,
      `sycophancy:${s.type} confidence=${s.confidence.toFixed(2)}`,
    );
  }
  process.stdout.write(JSON.stringify({
    signals: detected,
    recorded: detected.length,
  }) + '\n');
}

function stringifyAssistantContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n');
  }
  return '';
}

main().catch(err => {
  process.stderr.write(`przm-voice-mcp: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
