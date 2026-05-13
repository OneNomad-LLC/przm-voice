/**
 * Ollama driver — minimal HTTP client for the local Ollama daemon.
 *
 * The harness uses two endpoints only:
 *   GET  /api/tags        — list pulled models
 *   POST /api/generate    — single-turn completion
 *
 * No streaming. No tool calls. The bench wants deterministic-ish
 * candidate text from a small local model; that's all.
 *
 * If Ollama isn't reachable, throws `OllamaUnavailableError` with a
 * human-readable next-step ("start ollama serve" / "pull a model").
 * Benches catch this at startup and exit cleanly without writing a
 * receipt.
 */

export interface OllamaModel {
  name: string;            // e.g. "qwen2.5:7b-instruct"
  size: number;            // bytes
  family?: string;         // e.g. "qwen2"
  parameter_size?: string; // e.g. "7B"
  quantization_level?: string;
}

export interface GenerateOptions {
  /** Temperature; default 0.2 for stable judging. */
  temperature?: number;
  /** Max new tokens. */
  num_predict?: number;
  /** Top-p. */
  top_p?: number;
  /** System prompt. */
  system?: string;
  /** Stop sequences. */
  stop?: string[];
  /** Per-request timeout (ms). Default 60s. */
  timeoutMs?: number;
  /** Optional JSON-mode flag (ollama format=json). */
  jsonMode?: boolean;
}

export class OllamaUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OllamaUnavailableError';
  }
}

const DEFAULT_BASE = 'http://localhost:11434';

interface TagsResponse {
  models: Array<{
    name: string;
    size: number;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

export interface OllamaProbe {
  baseUrl: string;
  reachable: boolean;
  models: OllamaModel[];
  error?: string;
}

export async function probeOllama(baseUrl = DEFAULT_BASE): Promise<OllamaProbe> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { baseUrl, reachable: false, models: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as TagsResponse;
    const models: OllamaModel[] = (body.models ?? []).map(m => ({
      name: m.name,
      size: m.size,
      family: m.details?.family,
      parameter_size: m.details?.parameter_size,
      quantization_level: m.details?.quantization_level,
    }));
    return { baseUrl, reachable: true, models };
  } catch (err) {
    return {
      baseUrl,
      reachable: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse "7B"/"14B"/etc. into a numeric param count.
 * Returns NaN if unparseable.
 */
function paramSizeToNumber(s: string | undefined): number {
  if (!s) return NaN;
  const m = /^(\d+(?:\.\d+)?)\s*([BM])$/i.exec(s.trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  return unit === 'B' ? n : n / 1000;
}

/**
 * Pick the best available model for the benches. Preference order:
 *   1. User-supplied override
 *   2. Largest Qwen2.5-Instruct under 32B
 *   3. Largest Qwen2.5 of any flavor under 32B
 *   4. Largest any-Qwen under 32B
 *   5. Largest any-instruct under 32B
 * Returns null if nothing suitable is pulled. Caller prints the
 * recommended `ollama pull` command in that case.
 */
export function pickModel(models: OllamaModel[], override?: string): OllamaModel | null {
  if (override) {
    const exact = models.find(m => m.name === override);
    if (exact) return exact;
    const prefix = models.find(m => m.name.startsWith(override + ':') || m.name === override);
    return prefix ?? null;
  }

  const under32 = (m: OllamaModel): boolean => {
    const n = paramSizeToNumber(m.parameter_size);
    if (!Number.isFinite(n)) {
      // Fall back to size in bytes — anything under ~20GB is likely fine.
      return m.size < 22 * 1024 * 1024 * 1024;
    }
    return n <= 32;
  };

  const byParamDesc = (a: OllamaModel, b: OllamaModel): number => {
    const an = paramSizeToNumber(a.parameter_size);
    const bn = paramSizeToNumber(b.parameter_size);
    if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an;
    return b.size - a.size;
  };

  const tiers: Array<(m: OllamaModel) => boolean> = [
    m => under32(m) && /qwen2?\.5/i.test(m.name) && /instruct/i.test(m.name),
    m => under32(m) && /qwen2?\.5/i.test(m.name),
    m => under32(m) && /qwen/i.test(m.name),
    m => under32(m) && /instruct|chat/i.test(m.name),
  ];

  for (const tier of tiers) {
    const matches = models.filter(tier).sort(byParamDesc);
    if (matches.length > 0) return matches[0];
  }
  return null;
}

interface GenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export interface GenerateResult {
  text: string;
  promptTokens: number;
  outputTokens: number;
  totalMs: number;
}

export async function generate(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.2,
      top_p: opts.top_p ?? 0.9,
      num_predict: opts.num_predict ?? 256,
    },
  };
  if (opts.system) body.system = opts.system;
  if (opts.stop && opts.stop.length) (body.options as Record<string, unknown>).stop = opts.stop;
  if (opts.jsonMode) body.format = 'json';

  const ctrl = new AbortController();
  const timeout = opts.timeoutMs ?? 60_000;
  const t = setTimeout(() => ctrl.abort(), timeout);
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama /api/generate HTTP ${res.status}: ${await res.text()}`);
    }
    const parsed = (await res.json()) as GenerateResponse;
    return {
      text: parsed.response ?? '',
      promptTokens: parsed.prompt_eval_count ?? 0,
      outputTokens: parsed.eval_count ?? 0,
      totalMs: Date.now() - start,
    };
  } finally {
    clearTimeout(t);
  }
}
