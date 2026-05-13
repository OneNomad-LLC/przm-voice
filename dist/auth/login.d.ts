export type PollResult = {
    kind: 'approved';
    api_url: string;
    api_key: string;
    label: string | null;
    scopes: string[];
} | {
    kind: 'denied';
} | {
    kind: 'expired';
} | {
    kind: 'timeout';
} | {
    kind: 'network_error';
    message: string;
};
export interface PollUntilTerminalOpts {
    serverUrl: string;
    deviceCode: string;
    intervalMs: number;
    expiresInMs: number;
    fetch: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
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
export declare function pollUntilTerminal(opts: PollUntilTerminalOpts): Promise<PollResult>;
interface LoginArgs {
    serverUrl?: string;
    serverFlag?: string;
}
export declare function resolveServerUrl(args: LoginArgs): string | null;
export declare function runLogin(argv: string[]): Promise<void>;
export {};
