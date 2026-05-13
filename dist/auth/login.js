import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { writeCredentials, getCredentialsPath } from './credentials.js';
/**
 * Device-code login against a Pyre server.
 *
 * The server URL is never hardcoded. It must come from one of:
 *   1. positional arg:   persona-mcp login https://my-pyre.example.com
 *   2. flag:             persona-mcp login --server <url>
 *   3. env var:          PYRE_API_URL=... persona-mcp login
 *
 * The poll's `approved` response returns `api_url` separately from the
 * server URL the user typed. That returned URL is the runtime storage
 * URL — we write THAT into credentials.json, not the login URL.
 */
const APPROVE_POLL_BASE = '/api/auth/device-code/poll';
const DEVICE_CODE_BASE = '/api/auth/device-code';
function defaultSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Poll the device-code endpoint until we hit a terminal state.
 *
 * Returns one of:
 *   - approved (with the credentials payload)
 *   - denied
 *   - expired (server returned HTTP 410)
 *   - timeout (we hit expiresInMs without a terminal server response)
 *   - network_error (3 retries exhausted on transport / 5xx)
 *
 * Network failures within a single poll retry with exponential backoff
 * up to 3 attempts before surfacing.
 */
export async function pollUntilTerminal(opts) {
    const sleep = opts.sleep ?? defaultSleep;
    const now = opts.now ?? Date.now;
    const deadline = now() + opts.expiresInMs;
    const url = `${opts.serverUrl.replace(/\/+$/, '')}${APPROVE_POLL_BASE}`;
    while (now() < deadline) {
        const single = await pollOnceWithRetry(url, opts.deviceCode, opts.fetch, sleep);
        if (single.kind === 'pending') {
            await sleep(opts.intervalMs);
            continue;
        }
        return single.result;
    }
    return { kind: 'timeout' };
}
async function pollOnceWithRetry(url, deviceCode, fetchImpl, sleep) {
    let lastErrMessage = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_code: deviceCode }),
            });
            if (res.status === 410) {
                return { kind: 'terminal', result: { kind: 'expired' } };
            }
            if (res.status >= 500) {
                lastErrMessage = `HTTP ${res.status}`;
                await sleep(200 * Math.pow(2, attempt));
                continue;
            }
            if (!res.ok) {
                // 4xx other than 410 → surface the body; this is a real error.
                const text = await res.text().catch(() => '');
                return {
                    kind: 'terminal',
                    result: {
                        kind: 'network_error',
                        message: `HTTP ${res.status} ${text.slice(0, 200)}`,
                    },
                };
            }
            const data = (await res.json());
            if (data.status === 'pending')
                return { kind: 'pending' };
            if (data.status === 'denied') {
                return { kind: 'terminal', result: { kind: 'denied' } };
            }
            if (data.status === 'expired') {
                return { kind: 'terminal', result: { kind: 'expired' } };
            }
            if (data.status === 'approved') {
                if (typeof data.api_url !== 'string' ||
                    typeof data.api_key !== 'string' ||
                    data.api_url.length === 0 ||
                    data.api_key.length === 0) {
                    return {
                        kind: 'terminal',
                        result: {
                            kind: 'network_error',
                            message: 'approved response missing api_url or api_key',
                        },
                    };
                }
                return {
                    kind: 'terminal',
                    result: {
                        kind: 'approved',
                        api_url: data.api_url,
                        api_key: data.api_key,
                        label: data.label ?? null,
                        scopes: Array.isArray(data.scopes) ? data.scopes : [],
                    },
                };
            }
            // Unknown status — surface as network_error.
            return {
                kind: 'terminal',
                result: {
                    kind: 'network_error',
                    message: `unknown status: ${String(data.status)}`,
                },
            };
        }
        catch (err) {
            lastErrMessage = err.message || String(err);
            await sleep(200 * Math.pow(2, attempt));
        }
    }
    return {
        kind: 'terminal',
        result: { kind: 'network_error', message: lastErrMessage || 'unknown network error' },
    };
}
function tryOpenBrowser(url) {
    try {
        if (process.platform === 'darwin') {
            spawn('open', [url], { stdio: 'ignore', detached: true }).on('error', () => { });
        }
        else if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, shell: false }).on('error', () => { });
        }
        else {
            spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => { });
        }
    }
    catch {
        // Best-effort. The printed URL is the fallback.
    }
}
export function resolveServerUrl(args) {
    if (args.serverUrl && args.serverUrl.length > 0)
        return args.serverUrl;
    if (args.serverFlag && args.serverFlag.length > 0)
        return args.serverFlag;
    const env = process.env.PYRE_API_URL;
    if (env && env.length > 0)
        return env;
    return null;
}
export async function runLogin(argv) {
    let positional;
    let serverFlag;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--server') {
            serverFlag = argv[i + 1];
            i++;
            continue;
        }
        if (a.startsWith('--server=')) {
            serverFlag = a.slice('--server='.length);
            continue;
        }
        if (!a.startsWith('-') && !positional) {
            positional = a;
            continue;
        }
    }
    const serverUrl = resolveServerUrl({ serverUrl: positional, serverFlag });
    if (!serverUrl) {
        process.stderr.write('Server URL required. Pass it as an argument, --server <url>, or set PYRE_API_URL.\n');
        process.exit(1);
    }
    const normalizedServer = serverUrl.replace(/\/+$/, '');
    let initRes;
    try {
        initRes = await fetch(`${normalizedServer}${DEVICE_CODE_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_name: hostname(), package_name: 'persona' }),
        });
    }
    catch (err) {
        process.stderr.write(`Network error talking to ${normalizedServer}: ${err.message}\n`);
        process.exit(1);
    }
    if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        process.stderr.write(`Network error talking to ${normalizedServer}: HTTP ${initRes.status} ${text.slice(0, 200)}\n`);
        process.exit(1);
    }
    const code = (await initRes.json());
    process.stdout.write(`Visit ${code.verification_url} to authorize.\nCode: ${code.user_code}\n`);
    tryOpenBrowser(code.verification_url);
    const result = await pollUntilTerminal({
        serverUrl: normalizedServer,
        deviceCode: code.device_code,
        intervalMs: code.interval * 1000,
        expiresInMs: code.expires_in * 1000,
        fetch,
    });
    if (result.kind === 'approved') {
        await writeCredentials({
            api_url: result.api_url,
            api_key: result.api_key,
            label: result.label,
            scopes: result.scopes,
            issued_at: new Date().toISOString(),
        });
        process.stdout.write(`Logged in. Credentials saved to ${getCredentialsPath()}.\n`);
        process.exit(0);
    }
    if (result.kind === 'denied') {
        process.stderr.write('Authorization denied.\n');
        process.exit(1);
    }
    if (result.kind === 'expired') {
        process.stderr.write('Pairing code expired. Run `persona-mcp login` again.\n');
        process.exit(1);
    }
    if (result.kind === 'timeout') {
        process.stderr.write(`Login timed out after ${code.expires_in}s without approval.\n`);
        process.exit(1);
    }
    // network_error
    process.stderr.write(`Network error talking to ${normalizedServer}: ${result.message}\n`);
    process.exit(1);
}
//# sourceMappingURL=login.js.map