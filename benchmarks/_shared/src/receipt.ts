/**
 * Receipt writer. One JSON file per (bench, persona) run plus an
 * aggregate, all under benchmarks/receipts/<YYYY-MM-DD>/.
 *
 * Shape matches Pyre's receipts exactly so any tooling that reads
 * Pyre receipts also reads Persona receipts. The only difference is
 * the bench-id convention: Persona uses `<bench>-<persona>` so a
 * single bench produces N receipts (one per persona) without
 * filename collision.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HardwareInfo } from './hardware.js';

export interface Receipt<T = unknown> {
  /** Stable bench identifier. `<bench>` for aggregates, `<bench>-<persona>` per-persona. */
  benchId: string;
  timestamp: string;
  gitSha: string | null;
  gitDirty: boolean;
  hardware: HardwareInfo;
  config: Record<string, unknown>;
  data: T;
}

function execAsync(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export async function gitSha(repoRoot: string): Promise<{ sha: string | null; dirty: boolean }> {
  try {
    const sha = await execAsync('git', ['rev-parse', '--short=12', 'HEAD'], repoRoot);
    let dirty = false;
    try {
      const status = await execAsync('git', ['status', '--porcelain'], repoRoot);
      dirty = status.length > 0;
    } catch {
      // ignore
    }
    return { sha, dirty };
  } catch {
    return { sha: null, dirty: false };
  }
}

function resolveRepoRoot(): string {
  // _shared/src/receipt.ts → src → _shared → benchmarks → persona
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..');
}

export function repoRoot(): string {
  return resolveRepoRoot();
}

export function writeReceipt<T>(receipt: Receipt<T>): string {
  const root = resolveRepoRoot();
  const date = receipt.timestamp.slice(0, 10);
  const dir = join(root, 'benchmarks', 'receipts', date);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sha = receipt.gitSha ?? 'nogit';
  const dirty = receipt.gitDirty ? '-dirty' : '';
  const path = join(dir, `${receipt.benchId}-${date}-${sha}${dirty}.json`);
  writeFileSync(path, JSON.stringify(receipt, null, 2), 'utf8');
  return path;
}
