import type { JournalFiles, PersonaConfig, SoulFiles } from './types.js';
export declare function readJournalFile(_config: PersonaConfig, file: keyof JournalFiles): string;
export declare function readAllJournalFiles(config: PersonaConfig): JournalFiles;
export declare function appendJournal(_config: PersonaConfig, target: keyof SoulFiles, content: string): void;
export declare function replaceJournalFragment(_config: PersonaConfig, target: keyof SoulFiles, oldContent: string, newContent: string): void;
export declare function removeJournalFragment(_config: PersonaConfig, target: keyof SoulFiles, fragment: string): void;
export declare function clearJournal(_config: PersonaConfig, file?: keyof JournalFiles): number;
