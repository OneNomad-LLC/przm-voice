import { loadConfig } from '../config.js';
import { readCredentials } from '../auth/credentials.js';
import { CloudStorageAdapter } from './cloud-adapter.js';
import { FileStorageAdapter } from './file-adapter.js';
import { PostgresStorageAdapter } from './postgres-adapter.js';
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
 *   2. ~/.pyre/credentials.json present and parses cleanly →
 *      CloudStorageAdapter using its api_url / api_key. Individual env
 *      vars override per-field: PERSONA_API_URL beats file's api_url,
 *      PERSONA_API_KEY beats file's api_key. This is the "CI bots can
 *      override one piece" path.
 *
 *   3. Fallback → FileStorageAdapter (historical default, unchanged for
 *      any user with no credentials file and no env vars).
 */
export async function createStorage() {
    const backend = process.env.STORAGE_BACKEND;
    if (backend === 'file') {
        const config = loadConfig();
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
        return adapter;
    }
    if (backend === 'cloud') {
        if (!process.env.PERSONA_API_URL || !process.env.PERSONA_API_KEY) {
            throw new Error('STORAGE_BACKEND=cloud requires PERSONA_API_URL and PERSONA_API_KEY');
        }
        const adapter = new CloudStorageAdapter({
            apiUrl: process.env.PERSONA_API_URL,
            apiKey: process.env.PERSONA_API_KEY,
        });
        await adapter.init();
        return adapter;
    }
    if (backend !== undefined && backend !== '') {
        throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
    }
    // No explicit backend. Check for a credentials file.
    const creds = readCredentials();
    if (creds) {
        const apiUrl = process.env.PERSONA_API_URL ?? creds.api_url;
        const apiKey = process.env.PERSONA_API_KEY ?? creds.api_key;
        const adapter = new CloudStorageAdapter({ apiUrl, apiKey });
        await adapter.init();
        return adapter;
    }
    const config = loadConfig();
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
let _adapter = null;
export function setStorage(adapter) {
    _adapter = adapter;
}
export function getStorage() {
    if (!_adapter) {
        // Fallback for legacy code paths and the CLI: if nothing has been
        // set, eagerly construct a file adapter from current env. This
        // preserves the historical "import and use immediately" pattern.
        const config = loadConfig();
        _adapter = new FileStorageAdapter({ dataDir: config.dataDir });
    }
    return _adapter;
}
//# sourceMappingURL=index.js.map