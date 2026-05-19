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
  PERSONA_DATA_DIR        data directory (default ~/.claude/persona)
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
    default:
      process.stderr.write(`przm-voice-mcp: unknown subcommand "${sub}"\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch(err => {
  process.stderr.write(`przm-voice-mcp: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
