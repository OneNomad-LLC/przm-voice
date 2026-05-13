import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PersonaConfig, RoleFile } from './types.js';
import { getStorage } from './storage/index.js';

/**
 * Role layer — domain overlays applied on top of the soul.
 *
 * Soul defines WHO Claude is (voice, tone, working principles).
 * Role defines WHAT Claude is doing right now (developer, designer, pm, …).
 *
 * Roles are user-territory: Persona never auto-writes them. Bundled defaults
 * ship as on-disk files in persona/presets/roles/<name>/ROLE.md (read
 * directly off the package directory in any backend). User overrides
 * or new roles flow through the StorageAdapter — file mode keeps them
 * at dataDir/roles/<name>/ROLE.md, postgres mode keeps them per-tenant.
 *
 * Active role state lives in adapter.getActiveRole(); per-conversation
 * override is the caller's responsibility (pass roleName into persona_context).
 */

// Resolve the bundled presets dir relative to the compiled module. Walks up
// from dist/ (or src/) until it finds presets/. Cached after the first lookup.
let _presetsDir: string | null = null;
function presetsDir(): string {
  if (_presetsDir) return _presetsDir;
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'presets');
    if (existsSync(candidate)) {
      _presetsDir = candidate;
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _presetsDir = join(here, '..', 'presets');
  return _presetsDir;
}

function bundledRolePath(name: string): string {
  return join(presetsDir(), 'roles', name, 'ROLE.md');
}

// ── Read ────────────────────────────────────────────────────────────

export function readRole(_config: PersonaConfig, name: string): string {
  // User override takes precedence over bundled default
  const override = getStorage().readRole(name);
  if (override) return override;
  const bundledPath = bundledRolePath(name);
  if (existsSync(bundledPath)) return readFileSync(bundledPath, 'utf-8');
  return '';
}

export function listRoles(_config: PersonaConfig): RoleFile[] {
  const seen = new Map<string, string>();

  // Bundled presets first
  const presetsRoles = join(presetsDir(), 'roles');
  if (existsSync(presetsRoles)) {
    for (const entry of readdirSync(presetsRoles)) {
      const subPath = join(presetsRoles, entry);
      try {
        if (!statSync(subPath).isDirectory()) continue;
      } catch { continue; }
      const file = join(subPath, 'ROLE.md');
      if (existsSync(file)) {
        seen.set(entry, readFileSync(file, 'utf-8'));
      }
    }
  }

  // User overrides + custom roles (last write wins)
  for (const role of getStorage().listRoles()) {
    if (role.content) seen.set(role.name, role.content);
  }

  return Array.from(seen.entries()).map(([name, content]) => ({ name, content }));
}

// ── Write (user-edited custom roles) ────────────────────────────────

export function writeRole(_config: PersonaConfig, name: string, content: string): void {
  getStorage().writeRole(name, content);
}

// ── Active role ─────────────────────────────────────────────────────

export function getActiveRole(_config: PersonaConfig): string | null {
  return getStorage().getActiveRole();
}

export function setActiveRole(_config: PersonaConfig, name: string | null): void {
  getStorage().putActiveRole(name);
}

// ── Build prompt context for a role ─────────────────────────────────

export function buildRoleContext(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  return `## Active Role\n${trimmed}`;
}
