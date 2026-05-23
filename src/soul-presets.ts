import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PersonaConfig } from './types.js';
import { appendJournal } from './journal.js';

/**
 * Soul presets — bundled SOUL.md templates the user can load into their
 * personality.md. Ported from the Finch soul library so the same identities
 * work across both projects.
 *
 * Each preset is a single SOUL.md file describing voice/identity. Applying
 * a preset writes its content into the user's PERSONALITY.md (the closest
 * przm Voice analog to Finch's SOUL.md). STYLE.md and SKILL.md stay untouched —
 * those layers are independent.
 */

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

function soulPresetPath(name: string): string {
  return join(presetsDir(), 'souls', name, 'SOUL.md');
}

export interface SoulPreset {
  name: string;
  content: string;
}

export function listSoulPresets(): SoulPreset[] {
  const dir = join(presetsDir(), 'souls');
  if (!existsSync(dir)) return [];
  const out: SoulPreset[] = [];
  for (const entry of readdirSync(dir)) {
    const subPath = join(dir, entry);
    try {
      if (!statSync(subPath).isDirectory()) continue;
    } catch { continue; }
    const file = join(subPath, 'SOUL.md');
    if (existsSync(file)) {
      out.push({ name: entry, content: readFileSync(file, 'utf-8') });
    }
  }
  return out;
}

export function readSoulPreset(name: string): string {
  const path = soulPresetPath(name);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function applySoulPreset(config: PersonaConfig, name: string): { applied: boolean; bytes?: number } {
  const content = readSoulPreset(name);
  if (!content) return { applied: false };
  // Write to the journal, not directly to soul. Soul is user territory;
  // the journal is przm-voice territory. The preset appears in the prompt
  // via buildSoulContext(full). The user can promote it to soul explicitly
  // via voice_edit if they want it permanent.
  const ts = new Date().toISOString();
  appendJournal(config, 'personality', `<!-- preset:${name}:${ts} -->\n${content}`);
  return { applied: true, bytes: content.length };
}
