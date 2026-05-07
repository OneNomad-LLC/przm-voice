import type { PersonaConfig } from './types.js';
export interface SoulPreset {
    name: string;
    content: string;
}
export declare function listSoulPresets(): SoulPreset[];
export declare function readSoulPreset(name: string): string;
export declare function applySoulPreset(config: PersonaConfig, name: string): {
    applied: boolean;
    bytes?: number;
};
