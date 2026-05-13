import { loadConfig } from '../config.js';
import { FileStorageAdapter } from './file-adapter.js';
import { PostgresStorageAdapter } from './postgres-adapter.js';
export { FileStorageAdapter } from './file-adapter.js';
export { PostgresStorageAdapter } from './postgres-adapter.js';
/**
 * Construct the storage adapter for the running server.
 *
 * STORAGE_BACKEND=file     (default) — on-disk under PERSONA_DATA_DIR
 * STORAGE_BACKEND=postgres          — requires DATABASE_URL and TENANT_ID
 *
 * The factory is intentionally cheap to call once at startup; the
 * postgres adapter performs its initial SELECT inside the returned
 * promise.
 */
export async function createStorage() {
    const backend = process.env.STORAGE_BACKEND ?? 'file';
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
    throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
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