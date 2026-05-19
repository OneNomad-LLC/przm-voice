import type { SoulFiles, PersonaConfig } from './types.js';
/**
 * Soul file management -- read, write, and initialize personality files.
 *
 * Soul files are markdown documents stored in dataDir/soul/:
 *   PERSONALITY.md -- Who you are (tone, humor, confidence)
 *   STYLE.md       -- How you communicate (formatting, verbosity, patterns)
 *   SKILL.md       -- How you work (workflow, decision-making, priorities)
 *
 * Storage: routed through the StorageAdapter. File mode preserves the
 * dataDir/soul/*.md layout exactly.
 */
export declare function readSoulFile(_config: PersonaConfig, file: keyof SoulFiles): string;
export declare function readAllSoulFiles(config: PersonaConfig): SoulFiles;
export declare function writeSoulFile(_config: PersonaConfig, file: keyof SoulFiles, content: string): void;
export declare function initSoulFiles(config: PersonaConfig): SoulFiles;
/**
 * Sizing for the assembled context. Lets callers trade detail for
 * token budget — przm's Context Budget Engine asks for `minimal`
 * when the personality slot has tight budget, `standard` for routine
 * chat, `full` for deep-context turns where the agent needs
 * przm Voice's accumulated journal notes too.
 *
 *   minimal  ~400 tokens — personality + role only. Drops style,
 *                          working-style, and journal layers. Just
 *                          the immutable Core Principles + the
 *                          active role's domain expertise.
 *   standard ~1-2K tokens — all soul files (personality + style +
 *                          working-style + role) but skips the
 *                          journal merge. The default.
 *   full     ~3-16K tokens — soul files PLUS the journal-derived
 *                          notes layered under each section
 *                          ("learned" blocks). Use when the agent
 *                          needs to reason about how it has
 *                          adapted over time.
 */
export type ContextSize = 'minimal' | 'standard' | 'full';
export declare function buildSoulContext(files: SoulFiles, layers?: {
    journal?: SoulFiles;
    role?: string;
    size?: ContextSize;
}): string;
