/**
 * Common CLI argument parser for Persona benchmarks. Mirrors the
 * shape used by Pyre's `_shared/cli.ts` so the receipts story is
 * uniform — but the meaningful knobs here are different (Ollama URL,
 * model override, persona filter) since Persona benches don't talk to
 * a llama.cpp sidecar.
 */

export interface CommonArgs {
  /** Ollama base URL (default http://localhost:11434). */
  ollama?: string;
  /** Force a specific Ollama model. Otherwise the harness picks. */
  model?: string;
  /** Restrict the run to one persona name (alex, morgan, jordan, sam). */
  persona?: string;
  /** Machine-readable output mode. */
  json?: boolean;
  /** GPU label override for the receipt. */
  gpu?: string;
  /** VRAM override (GB). */
  vramGb?: number;
  /** Skip writing the JSON receipt file. */
  noReceipt?: boolean;
  /** Smoke-test mode — small N. */
  quick?: boolean;
  /** Anything unrecognized — bench-specific consumers can use this. */
  rest: string[];
}

export function parseArgs(argv: string[]): CommonArgs {
  const out: CommonArgs = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ollama') out.ollama = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--persona') out.persona = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--gpu') out.gpu = argv[++i];
    else if (a === '--vram-gb') {
      const n = parseFloat(argv[++i] ?? '');
      if (Number.isFinite(n) && n > 0) out.vramGb = n;
    }
    else if (a === '--no-receipt') out.noReceipt = true;
    else if (a === '--quick') out.quick = true;
    else out.rest.push(a);
  }
  return out;
}
