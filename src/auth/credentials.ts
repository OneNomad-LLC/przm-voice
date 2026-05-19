import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Credentials file — the resting place for przm Cloud login tokens.
 *
 * Owned exclusively by the `login` / `logout` subcommands and the cloud
 * storage adapter. Everything else in przm Voice is local-first and must
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

export const DEFAULT_CREDENTIALS_DIR = join(homedir(), '.pyre');
export const DEFAULT_CREDENTIALS_FILE = join(DEFAULT_CREDENTIALS_DIR, 'credentials.json');

export function getCredentialsPath(): string {
  const override = process.env.PYRE_CREDENTIALS_FILE;
  if (override && override.length > 0) return override;
  return DEFAULT_CREDENTIALS_FILE;
}

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.api_url !== 'string' || v.api_url.length === 0) return false;
  if (typeof v.api_key !== 'string' || v.api_key.length === 0) return false;
  if (v.label !== null && typeof v.label !== 'string') return false;
  if (!Array.isArray(v.scopes) || !v.scopes.every((s) => typeof s === 'string')) return false;
  if (typeof v.issued_at !== 'string') return false;
  return true;
}

export function readCredentials(): Credentials | null {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `przm-voice: failed to read credentials at ${path}: ${(err as Error).message}\n`,
    );
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `przm-voice: credentials at ${path} are not valid JSON: ${(err as Error).message}\n`,
    );
    return null;
  }
  if (!isCredentials(parsed)) {
    process.stderr.write(
      `przm-voice: credentials at ${path} are missing required fields; ignoring\n`,
    );
    return null;
  }
  return parsed;
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const path = getCredentialsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try {
      const st = statSync(dir);
      // Only tighten if dir is more permissive than 0700. Skip on Windows
      // where mode bits are mostly meaningless — chmod is still a no-op-ish
      // call there so we just attempt and swallow.
      if ((st.mode & 0o077) !== 0) {
        try {
          chmodSync(dir, 0o700);
        } catch {
          // Best-effort. If chmod fails we still proceed with the file write.
        }
      }
    } catch {
      // Stat failed; continue and let writeFileSync surface a real error.
    }
  }
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600, encoding: 'utf-8' });
  // writeFileSync's `mode` only applies to newly created files. If the
  // file already existed with looser perms, chmod it now to make sure.
  try {
    const st = statSync(path);
    if ((st.mode & 0o077) !== 0) {
      chmodSync(path, 0o600);
    }
  } catch {
    // ignore
  }
}

export async function deleteCredentials(): Promise<void> {
  const path = getCredentialsPath();
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}
