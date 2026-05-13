/**
 * Credentials file — the resting place for Pyre Cloud login tokens.
 *
 * Owned exclusively by the `login` / `logout` subcommands and the cloud
 * storage adapter. Everything else in Persona is local-first and must
 * not touch this file. The file is mode 0600 in a 0700 directory so a
 * shared-host attacker can't read it; permissions are re-asserted on
 * every write because a pre-existing file may have looser perms from a
 * prior bug or manual edit.
 */
export interface Credentials {
    api_url: string;
    api_key: string;
    label: string | null;
    scopes: string[];
    issued_at: string;
}
export declare const DEFAULT_CREDENTIALS_DIR: string;
export declare const DEFAULT_CREDENTIALS_FILE: string;
export declare function getCredentialsPath(): string;
export declare function readCredentials(): Credentials | null;
export declare function writeCredentials(creds: Credentials): Promise<void>;
export declare function deleteCredentials(): Promise<void>;
