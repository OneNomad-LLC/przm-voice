import type { PersonaConfig, RoleFile } from './types.js';
export declare function readRole(_config: PersonaConfig, name: string): string;
export declare function listRoles(_config: PersonaConfig): RoleFile[];
export declare function writeRole(_config: PersonaConfig, name: string, content: string): void;
export declare function getActiveRole(_config: PersonaConfig): string | null;
export declare function setActiveRole(_config: PersonaConfig, name: string | null): void;
export declare function buildRoleContext(content: string): string;
