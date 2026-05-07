import type { JournalFiles, PersonaConfig, SoulFiles } from './types.js';
export declare function readJournalFile(config: PersonaConfig, file: keyof JournalFiles): string;
export declare function readAllJournalFiles(config: PersonaConfig): JournalFiles;
export declare function appendJournal(config: PersonaConfig, target: keyof SoulFiles, content: string): void;
export declare function replaceJournalFragment(config: PersonaConfig, target: keyof SoulFiles, oldContent: string, newContent: string): void;
export declare function removeJournalFragment(config: PersonaConfig, target: keyof SoulFiles, fragment: string): void;
export declare function clearJournal(config: PersonaConfig, file?: keyof JournalFiles): number;
