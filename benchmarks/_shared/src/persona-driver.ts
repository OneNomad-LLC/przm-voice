/**
 * In-process Persona driver for benchmarks.
 *
 * Bypasses the MCP server (no stdio, no JSON-RPC) and drives the
 * public Persona module surface directly. Every driver instance gets
 * its own isolated PERSONA_DATA_DIR so concurrent or sequential
 * benches never see each other's state.
 *
 * Wiring order is load-bearing: we set the storage adapter to a
 * FileStorageAdapter pointed at the tmpdir BEFORE any Persona
 * function touches getStorage(). That requires constructing the
 * driver via the async factory below — top-level static imports of
 * Persona modules are fine because they don't call getStorage()
 * until invoked.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PersonaConfig, BehavioralSignal, SignalType } from '@onenomad/przm-voice/dist/types.js';
import { DEFAULT_CONFIG } from '@onenomad/przm-voice/dist/types.js';
import { FileStorageAdapter } from '@onenomad/przm-voice/dist/storage/file-adapter.js';
import { setStorage } from '@onenomad/przm-voice/dist/storage/index.js';
import { initSoulFiles, readAllSoulFiles } from '@onenomad/przm-voice/dist/soul.js';
import { recordSignal, loadSignals, detectSignals } from '@onenomad/przm-voice/dist/signals.js';
import { rebuildProfile, loadProfile } from '@onenomad/przm-voice/dist/profile.js';
import { updateSoulFromSynthesis, analyzeUserMessages } from '@onenomad/przm-voice/dist/synthesis.js';
import { getAdaptations, setSessionState } from '@onenomad/przm-voice/dist/adaptations.js';
import { generateProposals, loadProposals } from '@onenomad/przm-voice/dist/evolution.js';
import { DEFAULT_SESSION_STATE } from '@onenomad/przm-voice/dist/types.js';

export interface PersonaDriver {
  /** Tmpdir backing the driver. Deleted by close(). */
  readonly dataDir: string;
  readonly config: PersonaConfig;
  recordSignal(type: SignalType, content: string, category?: string): BehavioralSignal;
  detectSignals(userMessage: string, previousMessages?: string[]): Array<{ type: SignalType; confidence: number }>;
  listSignals(): BehavioralSignal[];
  rebuildProfile(): ReturnType<typeof loadProfile>;
  loadProfile(): ReturnType<typeof loadProfile>;
  synthesize(messages: string[]): ReturnType<typeof updateSoulFromSynthesis>;
  generateProposals(): ReturnType<typeof generateProposals>;
  listProposals(): ReturnType<typeof loadProposals>;
  /** Get the soul + adaptations layered prompt context. */
  context(category?: string): string;
  /** Read just the adaptations block (no soul files). */
  adaptationsOnly(category?: string): string;
  /** Read the three soul-file contents. */
  soul(): ReturnType<typeof readAllSoulFiles>;
  /** Compute an estimated token count of the persona_context output at a given size. */
  contextSizeTokens(category?: string): number;
  /** Tear down — delete the tmpdir. */
  close(): void;
}

export interface CreateDriverOptions {
  /** Optional fixed dataDir (skip tmpdir creation). Caller manages cleanup. */
  dataDir?: string;
  /** Lower the proposal threshold so benches see proposals at small N. */
  proposalThreshold?: number;
  /** Max signals to retain. */
  maxSignals?: number;
}

/**
 * Token estimate matching the rough "chars / 3.6" heuristic used
 * elsewhere in the OneNomad benchmarks for English prose. Good enough
 * for relative comparisons across budget sizes.
 */
function estimateTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / 3.6);
}

export function createPersonaDriver(opts: CreateDriverOptions = {}): PersonaDriver {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'persona-bench-'));
  const config: PersonaConfig = {
    ...DEFAULT_CONFIG,
    dataDir,
    proposalThreshold: opts.proposalThreshold ?? DEFAULT_CONFIG.proposalThreshold,
    maxSignals: opts.maxSignals ?? DEFAULT_CONFIG.maxSignals,
  };
  setStorage(new FileStorageAdapter({ dataDir }));
  // Seed default soul files so synthesis has a baseline to overwrite.
  initSoulFiles(config);
  // Default session state so adaptations don't blow up on a missing handle.
  setSessionState({ ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() });

  return {
    dataDir,
    config,
    recordSignal(type, content, category) {
      const signal = recordSignal(config, type, content, undefined, category);
      // Don't auto-rebuild on every signal — callers batch via rebuildProfile().
      return signal;
    },
    detectSignals(userMessage, previousMessages = []) {
      return detectSignals(userMessage, previousMessages).map(d => ({
        type: d.type,
        confidence: d.confidence,
      }));
    },
    listSignals() {
      return loadSignals(config);
    },
    rebuildProfile() {
      return rebuildProfile(config, loadSignals(config));
    },
    loadProfile() {
      return loadProfile(config);
    },
    synthesize(messages) {
      return updateSoulFromSynthesis(config, messages);
    },
    generateProposals() {
      return generateProposals(config, loadSignals(config));
    },
    listProposals() {
      return loadProposals(config);
    },
    context(category) {
      const soul = readAllSoulFiles(config);
      const adaptations = getAdaptations(config, category);
      const parts: string[] = [];
      if (soul.personality) parts.push(soul.personality);
      if (soul.style) parts.push(soul.style);
      if (soul.skill) parts.push(soul.skill);
      if (adaptations) parts.push(adaptations);
      return parts.join('\n\n');
    },
    adaptationsOnly(category) {
      return getAdaptations(config, category);
    },
    soul() {
      return readAllSoulFiles(config);
    },
    contextSizeTokens(category) {
      return estimateTokens(this.context(category));
    },
    close() {
      if (!opts.dataDir) {
        try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  };
}

export { analyzeUserMessages };
