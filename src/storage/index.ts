import { loadConfig } from '../config.js';
import { readCredentials } from '../auth/credentials.js';
import type { StorageAdapter } from './adapter.js';
import { CloudStorageAdapter } from './cloud-adapter.js';
import { FileStorageAdapter } from './file-adapter.js';
import { PostgresStorageAdapter } from './postgres-adapter.js';

export type { StorageAdapter, SessionSummary, SoulName, JournalName } from './adapter.js';
export { CloudStorageAdapter } from './cloud-adapter.js';
export { FileStorageAdapter } from './file-adapter.js';
export { PostgresStorageAdapter } from './postgres-adapter.js';

/**
 * Construct the storage adapter for the running server.
 *
 * Precedence (top wins):
 *
 *   1. Explicit STORAGE_BACKEND env var.
 *      - file     → FileStorageAdapter
 *      - postgres → requires DATABASE_URL + TENANT_ID
 *      - cloud    → requires PERSONA_API_URL + PERSONA_API_KEY
 *
 *   2. ~/.pyre/credentials.json present, PERSONA_NO_AUTO_CLOUD unset,
 *      and the file parses cleanly → CloudStorageAdapter using its
 *      api_url / api_key. Individual env vars override per-field:
 *      PERSONA_API_URL beats file's api_url, PERSONA_API_KEY beats
 *      file's api_key. This is the "CI bots can override one piece"
 *      path. The startup log line names this routing decision so it's
 *      never silent — previously this was the source of "why is my
 *      benchmark hitting the wire" surprises.
 *
 *   3. Fallback → FileStorageAdapter (historical default, unchanged for
 *      any user with no credentials file and no env vars).
 *
 * Opt-out: set PERSONA_NO_AUTO_CLOUD=1 to skip step 2 entirely. Useful
 * for benchmarks, CI, local development against a real credentials
 * file you don't want consulted, and anywhere "explicit > implicit"
 * matters.
 */

/**
 * Best-effort startup log to stderr. Stdout is reserved for the MCP
 * stdio protocol — writing routing decisions there would corrupt the
 * frame. Failures swallowed silently because the process should always
 * boot even if stderr is closed (e.g. some hosted environments).
 */
function logRouting(message: string): void {
  try {
    process.stderr.write(`przm-voice: ${message}\n`);
  } catch {
    // ignore
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function createStorage(): Promise<StorageAdapter> {
  const backend = process.env.STORAGE_BACKEND;

  if (backend === 'file') {
    const config = loadConfig();
    logRouting(`storage=file (STORAGE_BACKEND=file) · dataDir=${config.dataDir}`);
    return new FileStorageAdapter({ dataDir: config.dataDir });
  }

  if (backend === 'postgres') {
    if (!process.env.DATABASE_URL) {
      throw new Error('STORAGE_BACKEND=postgres requires DATABASE_URL');
    }
    if (!process.env.TENANT_ID) {
      throw new Error('STORAGE_BACKEND=postgres requires TENANT_ID');
    }
    const adapter = new PostgresStorageAdapter({
      databaseUrl: process.env.DATABASE_URL,
      tenantId: process.env.TENANT_ID,
    });
    await adapter.init();
    logRouting(`storage=postgres (STORAGE_BACKEND=postgres) · tenantId=${process.env.TENANT_ID}`);
    return adapter;
  }

  if (backend === 'cloud') {
    if (!process.env.PERSONA_API_URL || !process.env.PERSONA_API_KEY) {
      throw new Error(
        'STORAGE_BACKEND=cloud requires PERSONA_API_URL and PERSONA_API_KEY',
      );
    }
    const adapter = new CloudStorageAdapter({
      apiUrl: process.env.PERSONA_API_URL,
      apiKey: process.env.PERSONA_API_KEY,
    });
    await adapter.init();
    logRouting(`storage=cloud (STORAGE_BACKEND=cloud) · apiUrl=${process.env.PERSONA_API_URL}`);
    return adapter;
  }

  if (backend !== undefined && backend !== '') {
    throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
  }

  // No explicit backend. Check for a credentials file UNLESS the user
  // has opted out via PERSONA_NO_AUTO_CLOUD. The opt-out is documented
  // and exists specifically so benchmark adapters and local dev runs
  // can guarantee they won't touch the wire just because a real
  // credentials file happens to be on disk.
  if (!isTruthyEnv(process.env.PERSONA_NO_AUTO_CLOUD)) {
    const creds = readCredentials();
    if (creds) {
      const apiUrl = process.env.PERSONA_API_URL ?? creds.api_url;
      const apiKey = process.env.PERSONA_API_KEY ?? creds.api_key;
      const adapter = new CloudStorageAdapter({ apiUrl, apiKey });
      await adapter.init();
      logRouting(
        `storage=cloud (auto-routed via ~/.pyre/credentials.json) · apiUrl=${apiUrl} · set PERSONA_NO_AUTO_CLOUD=1 to disable`,
      );
      return adapter;
    }
  }

  const config = loadConfig();
  logRouting(`storage=file (default) · dataDir=${config.dataDir}`);
  return new FileStorageAdapter({ dataDir: config.dataDir });
}

// ── Module-level singleton ──────────────────────────────────────────
//
// The consumer modules (signals.ts, profile.ts, etc.) need a synchronous
// handle to the adapter so we don't have to thread it through every
// function. The server constructs once at startup via createStorage(),
// then calls setStorage() so the rest of the module graph can resolve
// via getStorage(). This keeps the existing public function signatures
// in those modules intact — they pull from getStorage() instead of
// receiving an adapter argument.

let _adapter: StorageAdapter | null = null;

export function setStorage(adapter: StorageAdapter): void {
  _adapter = adapter;
}

export function getStorage(): StorageAdapter {
  if (!_adapter) {
    // Fallback for legacy code paths and the CLI: if nothing has been
    // set, eagerly construct a file adapter from current env. This
    // preserves the historical "import and use immediately" pattern.
    const config = loadConfig();
    _adapter = new FileStorageAdapter({ dataDir: config.dataDir });
  }
  return _adapter;
}
