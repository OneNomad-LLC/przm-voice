import type { PersonaConfig, RoleFile } from './types.js';
export declare function readRole(config: PersonaConfig, name: string): string;
export declare function listRoles(config: PersonaConfig): RoleFile[];
export declare function writeRole(config: PersonaConfig, name: string, content: string): void;
export declare function getActiveRole(config: PersonaConfig): string | null;
export declare function setActiveRole(config: PersonaConfig, name: string | null): void;
export declare function buildRoleContext(content: string): string;
