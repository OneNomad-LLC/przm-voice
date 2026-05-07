import type { SoulFiles, PersonaConfig } from './types.js';
export declare function readSoulFile(config: PersonaConfig, file: keyof SoulFiles): string;
export declare function readAllSoulFiles(config: PersonaConfig): SoulFiles;
export declare function writeSoulFile(config: PersonaConfig, file: keyof SoulFiles, content: string): void;
export declare function initSoulFiles(config: PersonaConfig): SoulFiles;
export declare function buildSoulContext(files: SoulFiles, layers?: {
    journal?: SoulFiles;
    role?: string;
}): string;
