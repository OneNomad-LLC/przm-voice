import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CONFIG } from './types.js';
export function loadConfig(overrides) {
    return {
        ...DEFAULT_CONFIG,
        // PRZM_VOICE_DATA_DIR is canonical; PERSONA_DATA_DIR is legacy fallback.
        dataDir: process.env.PRZM_VOICE_DATA_DIR ??
            process.env.PERSONA_DATA_DIR ??
            join(homedir(), '.claude', 'przm-voice'),
        ...overrides,
    };
}
//# sourceMappingURL=config.js.map