import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SoulFiles, PersonaConfig } from './types.js';
import { SOUL_FILE_NAMES } from './types.js';

/**
 * Soul file management -- read, write, and initialize personality files.
 *
 * Soul files are markdown documents stored in dataDir/soul/:
 *   PERSONALITY.md -- Who you are (tone, humor, confidence)
 *   STYLE.md       -- How you communicate (formatting, verbosity, patterns)
 *   SKILL.md       -- How you work (workflow, decision-making, priorities)
 */

function soulDir(config: PersonaConfig): string {
  return join(config.dataDir, 'soul');
}

function soulPath(config: PersonaConfig, file: keyof SoulFiles): string {
  const names: Record<keyof SoulFiles, string> = {
    personality: 'PERSONALITY.md',
    style: 'STYLE.md',
    skill: 'SKILL.md',
  };
  return join(soulDir(config), names[file]);
}

// ── Read ────────────────────────────────────────────────────────────

export function readSoulFile(config: PersonaConfig, file: keyof SoulFiles): string {
  const path = soulPath(config, file);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function readAllSoulFiles(config: PersonaConfig): SoulFiles {
  return {
    personality: readSoulFile(config, 'personality'),
    style: readSoulFile(config, 'style'),
    skill: readSoulFile(config, 'skill'),
  };
}

// ── Write ───────────────────────────────────────────────────────────

export function writeSoulFile(config: PersonaConfig, file: keyof SoulFiles, content: string): void {
  const path = soulPath(config, file);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// ── Initialize with defaults ────────────────────────────────────────

export function initSoulFiles(config: PersonaConfig): SoulFiles {
  const dir = soulDir(config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const files = readAllSoulFiles(config);

  if (!files.personality) {
    files.personality = DEFAULT_PERSONALITY;
    writeSoulFile(config, 'personality', files.personality);
  }
  if (!files.style) {
    files.style = DEFAULT_STYLE;
    writeSoulFile(config, 'style', files.style);
  }
  if (!files.skill) {
    files.skill = DEFAULT_SKILL;
    writeSoulFile(config, 'skill', files.skill);
  }

  return files;
}

// ── Build prompt context from soul files ────────────────────────────

export function buildSoulContext(
  files: SoulFiles,
  layers?: { journal?: SoulFiles; role?: string },
): string {
  const sections: string[] = [];

  // Soul + journal layered per-section. Journal is Persona's auto-derived
  // notes (from applied evolution proposals); soul is user-territory.
  // Showing them together keeps the prompt coherent without commingling
  // ownership in the underlying files.
  const merge = (base: string, journal: string | undefined, header: string): string => {
    const baseT = base.trim();
    const jT = (journal ?? '').trim();
    if (!baseT && !jT) return '';
    const body = jT ? `${baseT}${baseT ? '\n\n' : ''}<!-- learned -->\n${jT}` : baseT;
    return `## ${header}\n${body}`;
  };

  const personality = merge(files.personality, layers?.journal?.personality, 'Personality');
  const style = merge(files.style, layers?.journal?.style, 'Communication Style');
  const skill = merge(files.skill, layers?.journal?.skill, 'Working Style');

  if (personality) sections.push(personality);
  if (style) sections.push(style);
  if (skill) sections.push(skill);

  if (layers?.role) {
    const roleT = layers.role.trim();
    if (roleT) sections.push(`## Active Role\n${roleT}`);
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n');
}

// ── Default Soul Files ──────────────────────────────────────────────
// These are starting points -- the evolution system will refine them
// based on how the user actually interacts.

// ── Blank Slate Defaults ────────────────────────────────────────────
// Start with almost nothing. Personality emerges from interactions.
// Only include universal baseline behavior.

const DEFAULT_PERSONALITY = `# Personality

(This file builds itself from your interactions. As we work together, personality traits will emerge here based on how you communicate and what you respond well to.)

## Core Principles (immutable)
- You are honest, not agreeable. Never say what the user wants to hear just to gain approval.
- Correct the user when they are wrong. Disagree when you have reason to. Be respectful but firm.
- On personal, psychological, or emotional topics: be genuine and thoughtful, not performative. Don't validate feelings that would lead to bad decisions. Don't dismiss them either. Reason with the person.
- Help means helping them see clearly, not telling them what feels good.
- Never do anything that could cause the user to want to harm themselves or others. If you sense distress, respond with care and point toward real help.
- Never give advice that may have negative overall effects. Consider second-order consequences. When unsure, err on the side of caution and flag the risk.
`;

const DEFAULT_STYLE = `# Communication Style

(This file adapts to your communication style. As you interact, patterns in your messages will shape how responses are formatted and delivered.)

## Baseline
- Never say: "Great question!", "I'd be happy to help!", "Certainly!"
- No trailing summaries unless asked
`;

const DEFAULT_SKILL = `# Working Style

(This file learns your workflow preferences. As you correct, approve, and give feedback, working style guidelines will appear here.)

## Baseline
- Read before writing
- Minimal changes -- don't refactor what wasn't asked
`;
