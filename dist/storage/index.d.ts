import type { StorageAdapter } from './adapter.js';
export type { StorageAdapter, SessionSummary, SoulName, JournalName } from './adapter.js';
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
export declare function createStorage(): Promise<StorageAdapter>;
export declare function setStorage(adapter: StorageAdapter): void;
export declare function getStorage(): StorageAdapter;
