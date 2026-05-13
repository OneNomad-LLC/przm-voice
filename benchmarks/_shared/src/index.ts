export { parseArgs, type CommonArgs } from './cli.js';
export { probeHardware, type HardwareInfo } from './hardware.js';
export { writeReceipt, gitSha, repoRoot, type Receipt } from './receipt.js';
export {
  probeOllama,
  pickModel,
  generate,
  type OllamaModel,
  type GenerateOptions,
  OllamaUnavailableError,
} from './ollama.js';
export {
  createPersonaDriver,
  type PersonaDriver,
} from './persona-driver.js';
export { hr, pad } from './format.js';
