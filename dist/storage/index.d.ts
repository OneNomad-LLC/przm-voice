import type { StorageAdapter } from './adapter.js';
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
 *   2. ~/.pyre/credentials.json present and parses cleanly →
 *      CloudStorageAdapter using its api_url / api_key. Individual env
 *      vars override per-field: PERSONA_API_URL beats file's api_url,
 *      PERSONA_API_KEY beats file's api_key. This is the "CI bots can
 *      override one piece" path.
 *
 *   3. Fallback → FileStorageAdapter (historical default, unchanged for
 *      any user with no credentials file and no env vars).
 */
export declare function createStorage(): Promise<StorageAdapter>;
export declare function setStorage(adapter: StorageAdapter): void;
export declare function getStorage(): StorageAdapter;
