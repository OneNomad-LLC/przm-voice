import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { readCredentials, writeCredentials, deleteCredentials, } from '../auth/credentials.js';
import { createStorage } from '../storage/index.js';
import { FileStorageAdapter, CloudStorageAdapter } from '../storage/index.js';
import { pollUntilTerminal } from '../auth/login.js';
/**
 * Cloud-auth smoke test. Pure local — no real server hit.
 *
 * Covers:
 *   1. credentials read-empty / write / read-back, perms verified
 *   2. logout (delete) is idempotent
 *   3. storage resolver: cloud when creds present, file when not,
 *      env override wins both ways
 *   4. login flow's pollUntilTerminal against a tiny mock fetch
 */
function assert(cond, msg) {
    if (!cond) {
        console.error(`ASSERT FAIL: ${msg}`);
        process.exit(1);
    }
}
function withTempCredsDir(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'persona-auth-smoke-'));
    const file = join(dir, 'credentials.json');
    const prev = process.env.PYRE_CREDENTIALS_FILE;
    process.env.PYRE_CREDENTIALS_FILE = file;
    return Promise.resolve(fn(file)).finally(() => {
        if (prev === undefined)
            delete process.env.PYRE_CREDENTIALS_FILE;
        else
            process.env.PYRE_CREDENTIALS_FILE = prev;
        rmSync(dir, { recursive: true, force: true });
    });
}
function clearStorageEnv() {
    const keys = ['STORAGE_BACKEND', 'PERSONA_API_URL', 'PERSONA_API_KEY', 'PERSONA_DATA_DIR'];
    const snap = {};
    for (const k of keys)
        snap[k] = process.env[k];
    for (const k of keys)
        delete process.env[k];
    return {
        restore: () => {
            for (const k of keys) {
                if (snap[k] === undefined)
                    delete process.env[k];
                else
                    process.env[k] = snap[k];
            }
        },
    };
}
async function testCredentialsRoundTrip() {
    await withTempCredsDir(async (path) => {
        assert(readCredentials() === null, 'empty file → readCredentials returns null');
        const creds = {
            api_url: 'https://pyre-web-dev.example.com',
            api_key: 'sk_pyre_abc_xyz',
            label: 'smoke test',
            scopes: ['persona:read', 'persona:write'],
            issued_at: new Date().toISOString(),
        };
        await writeCredentials(creds);
        assert(existsSync(path), 'credentials file should exist after write');
        if (platform() !== 'win32') {
            const mode = statSync(path).mode & 0o777;
            assert(mode === 0o600, `credentials file should be 0600, got ${mode.toString(8)}`);
        }
        const back = readCredentials();
        assert(back !== null, 'readCredentials returns the written record');
        assert(back.api_url === creds.api_url, 'api_url round-trips');
        assert(back.api_key === creds.api_key, 'api_key round-trips');
        assert(back.scopes.length === 2, 'scopes round-trip');
        await deleteCredentials();
        assert(!existsSync(path), 'deleteCredentials unlinks the file');
        // Idempotent: a second delete must not throw.
        await deleteCredentials();
    });
    console.error('  credentials round-trip OK');
}
async function testRejectsMalformed() {
    await withTempCredsDir(async (path) => {
        const fs = await import('node:fs');
        fs.writeFileSync(path, '{ not valid json', 'utf-8');
        assert(readCredentials() === null, 'invalid JSON → null');
        fs.writeFileSync(path, JSON.stringify({ api_url: 'x' }), 'utf-8');
        assert(readCredentials() === null, 'missing required fields → null');
    });
    console.error('  malformed credentials rejected OK');
}
async function testResolverPicksFile() {
    const env = clearStorageEnv();
    const dataDir = mkdtempSync(join(tmpdir(), 'persona-auth-data-'));
    process.env.PERSONA_DATA_DIR = dataDir;
    try {
        await withTempCredsDir(async () => {
            const adapter = await createStorage();
            assert(adapter instanceof FileStorageAdapter, 'no creds + no env → FileStorageAdapter');
        });
    }
    finally {
        env.restore();
        rmSync(dataDir, { recursive: true, force: true });
    }
    console.error('  resolver picks file by default OK');
}
async function testResolverPicksCloudFromCreds() {
    const env = clearStorageEnv();
    try {
        await withTempCredsDir(async () => {
            await writeCredentials({
                api_url: 'https://pyre.example.com',
                api_key: 'sk_pyre_test_abc',
                label: null,
                scopes: [],
                issued_at: new Date().toISOString(),
            });
            // Stub fetch on globalThis so init() does not actually hit the network.
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));
            try {
                const adapter = await createStorage();
                assert(adapter instanceof CloudStorageAdapter, 'creds present → CloudStorageAdapter');
            }
            finally {
                globalThis.fetch = originalFetch;
            }
        });
    }
    finally {
        env.restore();
    }
    console.error('  resolver picks cloud from creds OK');
}
async function testEnvOverridesCredsFields() {
    const env = clearStorageEnv();
    try {
        await withTempCredsDir(async () => {
            await writeCredentials({
                api_url: 'https://from-creds.example.com',
                api_key: 'sk_from_creds',
                label: null,
                scopes: [],
                issued_at: new Date().toISOString(),
            });
            process.env.PERSONA_API_URL = 'https://from-env.example.com';
            let seenUrl = '';
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async (input) => {
                const u = typeof input === 'string' ? input : input.toString();
                if (u.includes('/api/persona/profile'))
                    seenUrl = u;
                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            });
            try {
                const adapter = await createStorage();
                assert(adapter instanceof CloudStorageAdapter, 'creds + env URL → cloud adapter');
                assert(seenUrl.startsWith('https://from-env.example.com'), `PERSONA_API_URL should override creds (saw ${seenUrl})`);
            }
            finally {
                globalThis.fetch = originalFetch;
            }
            delete process.env.PERSONA_API_URL;
        });
    }
    finally {
        env.restore();
    }
    console.error('  env overrides creds field OK');
}
async function testStorageBackendForceFile() {
    const env = clearStorageEnv();
    const dataDir = mkdtempSync(join(tmpdir(), 'persona-auth-data-'));
    process.env.PERSONA_DATA_DIR = dataDir;
    process.env.STORAGE_BACKEND = 'file';
    try {
        await withTempCredsDir(async () => {
            await writeCredentials({
                api_url: 'https://from-creds.example.com',
                api_key: 'sk_x',
                label: null,
                scopes: [],
                issued_at: new Date().toISOString(),
            });
            const adapter = await createStorage();
            assert(adapter instanceof FileStorageAdapter, 'STORAGE_BACKEND=file forces file even with creds present');
        });
    }
    finally {
        env.restore();
        rmSync(dataDir, { recursive: true, force: true });
    }
    console.error('  STORAGE_BACKEND=file overrides creds OK');
}
async function testPollHappyPath() {
    let calls = 0;
    const mockFetch = (async () => {
        calls++;
        if (calls === 1) {
            return new Response(JSON.stringify({ status: 'pending' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({
            status: 'approved',
            api_url: 'https://pyre-runtime.example.com',
            api_key: 'sk_pyre_test',
            label: 'test',
            scopes: ['persona:read', 'persona:write'],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await pollUntilTerminal({
        serverUrl: 'https://login.example.com',
        deviceCode: 'dc_x',
        intervalMs: 0,
        expiresInMs: 10_000,
        fetch: mockFetch,
        sleep: () => Promise.resolve(),
    });
    assert(result.kind === 'approved', `expected approved, got ${result.kind}`);
    if (result.kind === 'approved') {
        assert(result.api_url === 'https://pyre-runtime.example.com', 'approved api_url passes through');
        assert(result.api_key === 'sk_pyre_test', 'approved api_key passes through');
    }
    console.error('  pollUntilTerminal approved OK');
}
async function testPollDenied() {
    const mockFetch = (async () => new Response(JSON.stringify({ status: 'denied' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }));
    const result = await pollUntilTerminal({
        serverUrl: 'https://x.example.com',
        deviceCode: 'dc_y',
        intervalMs: 0,
        expiresInMs: 1000,
        fetch: mockFetch,
        sleep: () => Promise.resolve(),
    });
    assert(result.kind === 'denied', `expected denied, got ${result.kind}`);
    console.error('  pollUntilTerminal denied OK');
}
async function testPollExpiredViaHttp410() {
    const mockFetch = (async () => new Response(JSON.stringify({ status: 'expired' }), {
        status: 410,
        headers: { 'content-type': 'application/json' },
    }));
    const result = await pollUntilTerminal({
        serverUrl: 'https://x.example.com',
        deviceCode: 'dc_z',
        intervalMs: 0,
        expiresInMs: 1000,
        fetch: mockFetch,
        sleep: () => Promise.resolve(),
    });
    assert(result.kind === 'expired', `expected expired, got ${result.kind}`);
    console.error('  pollUntilTerminal expired (410) OK');
}
async function testPollTimeout() {
    const mockFetch = (async () => new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }));
    // Mock time-keeper that advances past the deadline after one tick so
    // the loop exits on the second check without real waiting.
    let virtualNow = 0;
    const result = await pollUntilTerminal({
        serverUrl: 'https://x.example.com',
        deviceCode: 'dc_t',
        intervalMs: 10,
        expiresInMs: 5,
        fetch: mockFetch,
        sleep: async () => {
            virtualNow += 100;
        },
        now: () => virtualNow,
    });
    assert(result.kind === 'timeout', `expected timeout, got ${result.kind}`);
    console.error('  pollUntilTerminal timeout OK');
}
async function testPollNetworkRetryThenSurface() {
    let calls = 0;
    const mockFetch = (async () => {
        calls++;
        throw new Error('ECONNRESET');
    });
    const result = await pollUntilTerminal({
        serverUrl: 'https://x.example.com',
        deviceCode: 'dc_n',
        intervalMs: 0,
        expiresInMs: 10_000,
        fetch: mockFetch,
        sleep: () => Promise.resolve(),
    });
    assert(result.kind === 'network_error', `expected network_error, got ${result.kind}`);
    assert(calls === 3, `expected 3 retries, saw ${calls}`);
    console.error('  pollUntilTerminal network retries OK');
}
async function main() {
    console.error('auth smoke:');
    await testCredentialsRoundTrip();
    await testRejectsMalformed();
    await testResolverPicksFile();
    await testResolverPicksCloudFromCreds();
    await testEnvOverridesCredsFields();
    await testStorageBackendForceFile();
    await testPollHappyPath();
    await testPollDenied();
    await testPollExpiredViaHttp410();
    await testPollTimeout();
    await testPollNetworkRetryThenSurface();
    console.error('auth smoke OK');
    // Touch readFileSync to silence unused-import linters in case TS is fussy.
    void readFileSync;
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=smoke-auth.js.map