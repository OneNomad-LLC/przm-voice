import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PersonaConfig, RoleFile } from './types.js';

/**
 * Role layer — domain overlays applied on top of the soul.
 *
 * Soul defines WHO Claude is (voice, tone, working principles).
 * Role defines WHAT Claude is doing right now (developer, designer, pm, …).
 *
 * Roles are user-territory: Persona never auto-writes them. Bundled defaults
 * ship as on-disk files in persona/presets/roles/<name>/ROLE.md; user
 * overrides or new roles live at dataDir/roles/<name>/ROLE.md and shadow
 * the bundled set.
 *
 * Active role state lives in dataDir/active-role.json. Per-conversation
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

function userRolesDir(config: PersonaConfig): string {
  return join(config.dataDir, 'roles');
}

function userRolePath(config: PersonaConfig, name: string): string {
  return join(userRolesDir(config), name, 'ROLE.md');
}

function activeRolePath(config: PersonaConfig): string {
  return join(config.dataDir, 'active-role.json');
}

// ── Read ────────────────────────────────────────────────────────────

export function readRole(config: PersonaConfig, name: string): string {
  // User override takes precedence over bundled default
  const userPath = userRolePath(config, name);
  if (existsSync(userPath)) return readFileSync(userPath, 'utf-8');
  const bundledPath = bundledRolePath(name);
  if (existsSync(bundledPath)) return readFileSync(bundledPath, 'utf-8');
  return '';
}

export function listRoles(config: PersonaConfig): RoleFile[] {
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
  const dir = userRolesDir(config);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const subPath = join(dir, entry);
      try {
        if (!statSync(subPath).isDirectory()) continue;
      } catch { continue; }
      const file = join(subPath, 'ROLE.md');
      if (existsSync(file)) {
        seen.set(entry, readFileSync(file, 'utf-8'));
      }
    }
  }

  return Array.from(seen.entries()).map(([name, content]) => ({ name, content }));
}

// ── Write (user-edited custom roles) ────────────────────────────────

export function writeRole(config: PersonaConfig, name: string, content: string): void {
  const dir = join(userRolesDir(config), name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ROLE.md'), content, 'utf-8');
}

// ── Active role ─────────────────────────────────────────────────────

export function getActiveRole(config: PersonaConfig): string | null {
  const path = activeRolePath(config);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof data.name === 'string' && data.name.length > 0 ? data.name : null;
  } catch {
    return null;
  }
}

export function setActiveRole(config: PersonaConfig, name: string | null): void {
  const path = activeRolePath(config);
  if (name === null) {
    if (existsSync(path)) writeFileSync(path, JSON.stringify({ name: null }), 'utf-8');
    return;
  }
  const dir = config.dataDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ name }), 'utf-8');
}

// ── Build prompt context for a role ─────────────────────────────────

export function buildRoleContext(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  return `## Active Role\n${trimmed}`;
}
