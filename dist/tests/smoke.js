import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileStorageAdapter, PostgresStorageAdapter, setStorage } from '../storage/index.js';
import { loadProfile } from '../profile.js';
import { recordSignal, loadSignals } from '../signals.js';
import { readSoulFile, writeSoulFile } from '../soul.js';
import { loadConfig } from '../config.js';
import { runMigrations } from '../migrations/run.js';
/**
 * Storage adapter smoke test.
 *
 * Runs the same set of operations against either the file or postgres
 * backend and asserts round-trip behavior. Selected via STORAGE_BACKEND.
 *
 * File mode: uses a fresh tmpdir for PERSONA_DATA_DIR.
 * Postgres mode: requires DATABASE_URL; uses TENANT_ID="smoke-<uuid>"
 *                and runs migrations before the test.
 */
function assert(cond, msg) {
    if (!cond) {
        console.error(`ASSERT FAIL: ${msg}`);
        process.exit(1);
    }
}
async function runSmoke(adapter) {
    setStorage(adapter);
    const config = loadConfig();
    // 1. Append a signal.
    const signal = recordSignal(config, 'approval', 'smoke test ok', 'smoke', 'test');
    console.error(`recorded signal ${signal.id}`);
    const signals = loadSignals(config);
    assert(signals.length > 0, 'signals should contain at least 1 entry after append');
    assert(signals.some((s) => s.id === signal.id), 'newly recorded signal must appear in listSignals');
    // 2. Read profile on a fresh tenant — must not throw.
    const profile = loadProfile(config);
    assert(profile !== null && typeof profile === 'object', 'profile should be an object');
    // 3. Write a soul file and read it back.
    const marker = `# Personality\n\nsmoke-${randomUUID()}\n`;
    writeSoulFile(config, 'personality', marker);
    const roundtrip = readSoulFile(config, 'personality');
    assert(roundtrip === marker, `personality round-trip mismatch:\n  wrote: ${JSON.stringify(marker)}\n  read:  ${JSON.stringify(roundtrip)}`);
    console.error('smoke OK');
}
async function main() {
    const backend = process.env.STORAGE_BACKEND ?? 'file';
    if (backend === 'file') {
        const dir = mkdtempSync(join(tmpdir(), 'persona-smoke-'));
        process.env.PERSONA_DATA_DIR = dir;
        console.error(`file smoke: PERSONA_DATA_DIR=${dir}`);
        try {
            const adapter = new FileStorageAdapter({ dataDir: dir });
            await runSmoke(adapter);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
        return;
    }
    if (backend === 'postgres') {
        if (!process.env.DATABASE_URL) {
            console.error('postgres smoke skipped: DATABASE_URL not set');
            return;
        }
        const tenantId = process.env.TENANT_ID ?? `smoke-${randomUUID()}`;
        process.env.TENANT_ID = tenantId;
        console.error(`postgres smoke: tenant=${tenantId}`);
        await runMigrations(process.env.DATABASE_URL);
        const adapter = new PostgresStorageAdapter({
            databaseUrl: process.env.DATABASE_URL,
            tenantId,
        });
        await adapter.init();
        try {
            await runSmoke(adapter);
            await adapter.flush();
        }
        finally {
            await adapter.close();
        }
        return;
    }
    console.error(`Unknown STORAGE_BACKEND: ${backend}`);
    process.exit(2);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=smoke.js.map