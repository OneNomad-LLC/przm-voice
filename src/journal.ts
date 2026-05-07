import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { JournalFiles, PersonaConfig, SoulFiles } from './types.js';

/**
 * Journal — Persona's auto-derived notes, kept separate from user-edited soul.
 *
 * When evolution.applyProposal runs, it appends here instead of touching the
 * soul/ directory. That preserves a clean ownership boundary:
 *   soul/  → user territory (persona_edit and direct file writes only)
 *   journal/ → Persona territory (auto-learned, freely rewritten/cleared)
 *
 * Both layers are surfaced together in buildSoulContext so the prompt sees
 * a unified view, but the user can clear the journal at any time without
 * losing their hand-tuned soul.
 */

const JOURNAL_FILES: Record<keyof JournalFiles, string> = {
  personality: 'personality.md',
  style: 'style.md',
  skill: 'skill.md',
};

function journalDir(config: PersonaConfig): string {
  return join(config.dataDir, 'journal');
}

function journalPath(config: PersonaConfig, file: keyof JournalFiles): string {
  return join(journalDir(config), JOURNAL_FILES[file]);
}

// ── Read ────────────────────────────────────────────────────────────

export function readJournalFile(config: PersonaConfig, file: keyof JournalFiles): string {
  const path = journalPath(config, file);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function readAllJournalFiles(config: PersonaConfig): JournalFiles {
  return {
    personality: readJournalFile(config, 'personality'),
    style: readJournalFile(config, 'style'),
    skill: readJournalFile(config, 'skill'),
  };
}

// ── Write ───────────────────────────────────────────────────────────

export function appendJournal(
  config: PersonaConfig,
  target: keyof SoulFiles,
  content: string,
): void {
  const path = journalPath(config, target);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const next = existing.trimEnd() + (existing ? '\n\n' : '') + content + '\n';
  writeFileSync(path, next, 'utf-8');
}

export function replaceJournalFragment(
  config: PersonaConfig,
  target: keyof SoulFiles,
  oldContent: string,
  newContent: string,
): void {
  const path = journalPath(config, target);
  if (!existsSync(path)) return;
  const current = readFileSync(path, 'utf-8');
  writeFileSync(path, current.replace(oldContent, newContent), 'utf-8');
}

export function removeJournalFragment(
  config: PersonaConfig,
  target: keyof SoulFiles,
  fragment: string,
): void {
  const path = journalPath(config, target);
  if (!existsSync(path)) return;
  const current = readFileSync(path, 'utf-8');
  writeFileSync(path, current.replace(fragment, '').replace(/\n{3,}/g, '\n\n'), 'utf-8');
}

export function clearJournal(config: PersonaConfig, file?: keyof JournalFiles): number {
  let cleared = 0;
  const targets = file ? [file] : (Object.keys(JOURNAL_FILES) as (keyof JournalFiles)[]);
  for (const f of targets) {
    const path = journalPath(config, f);
    if (existsSync(path)) {
      unlinkSync(path);
      cleared++;
    }
  }
  return cleared;
}
