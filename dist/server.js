#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createStorage, setStorage } from './storage/index.js';
import { readSoulFile, readAllSoulFiles, writeSoulFile, initSoulFiles, buildSoulContext } from './soul.js';
import { readAllJournalFiles, clearJournal } from './journal.js';
import { listRoles, readRole, writeRole, getActiveRole, setActiveRole } from './role.js';
import { listSoulPresets, readSoulPreset, applySoulPreset } from './soul-presets.js';
import { recordSignal, loadSignals, getSignalCounts, detectSignals } from './signals.js';
import { loadProfile, rebuildProfile, saveProfileExternal } from './profile.js';
import { getAdaptations, getProfileSummary, setSessionState, getSessionState } from './adaptations.js';
import { generateProposals, loadProposals, applyProposal, rejectProposal } from './evolution.js';
import { analyzeUserMessages, updateSoulFromSynthesis } from './synthesis.js';
import { detectEmotionalTone, emotionalValence, detectDyads, loadTraitState, saveTraitState, updateEmotionalAssociation } from './emotions.js';
import { updateBigFive, computeStyleVector, updateBaselineStyle, detectTechnicalDomain, blendStyleVectors } from './traits.js';
import { updateCognitiveLoad } from './cognitive-load.js';
import { runConsolidation, recordSessionSummary } from './consolidation.js';
import { detectSycophancyInAssistant } from './sycophancy.js';
import { SOUL_FILE_NAMES, DEFAULT_SESSION_STATE } from './types.js';
const config = loadConfig();
// Storage adapter must be wired before any of the module-level
// evaluations below touch soul/signals/etc. Top-level await keeps
// the file-mode default path synchronous (createStorage resolves
// immediately for file backend) while still allowing postgres mode
// to perform its initial SELECT before any tool registration runs.
setStorage(await createStorage());
// Initialize soul files with defaults on first run
const soulFiles = initSoulFiles(config);
// Initialize session state
let session = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
setSessionState(session);
let lastUserMessage;
// ── Throttled trait-state persistence ─────────────────────────────
// Trait state (Big Five EMA, domain ratio, emotional associations)
// changes by tiny amounts per message. Writing every call burns disk
// I/O for inference deltas that won't materially affect adaptations
// until they accumulate. Hold it in memory and save every N messages.
//
// Tests / synthesis / consolidation can force an immediate flush via
// forceSaveTraitState(). Set PERSONA_TRAIT_SAVE_INTERVAL=1 to disable
// throttling entirely.
const TRAIT_SAVE_INTERVAL = parseInt(process.env.PERSONA_TRAIT_SAVE_INTERVAL ?? '10', 10);
let traitSaveCounter = 0;
let traitStateCache = null;
function getTraitState() {
    if (!traitStateCache)
        traitStateCache = loadTraitState(config);
    return traitStateCache;
}
function maybeSaveTraitState(traitState) {
    traitStateCache = traitState;
    traitSaveCounter += 1;
    if (traitSaveCounter >= TRAIT_SAVE_INTERVAL) {
        traitSaveCounter = 0;
        saveTraitState(config, traitState);
    }
}
function forceSaveTraitState(traitState) {
    traitSaveCounter = 0;
    const state = traitState ?? traitStateCache ?? loadTraitState(config);
    traitStateCache = state;
    saveTraitState(config, state);
}
function text(t) { return { content: [{ type: 'text', text: t }] }; }
function json(data) { return text(JSON.stringify(data, null, 2)); }
function processUserMessage(message, opts = {}) {
    const tone = detectEmotionalTone(message, session.recentMessages);
    for (const key of Object.keys(tone)) {
        session.emotionalTone[key] = session.emotionalTone[key] * 0.7 + tone[key] * 0.3;
    }
    const msgStyle = computeStyleVector(message);
    for (const key of Object.keys(msgStyle)) {
        session.styleVector[key] = session.styleVector[key] * 0.7 + msgStyle[key] * 0.3;
    }
    // Fast-decay session-style mirror. Distinct from session.styleVector
    // (which lingers at alpha=0.3 on top of the prior value too, but is
    // also persisted across server restarts via DEFAULT_STYLE_VECTOR
    // initialization): currentStyleVector is null at session start and
    // clones the first observation, then EMA-blends at alpha=0.3 for
    // ~3-turn responsiveness to a tone shift.
    session.currentStyleVector = session.currentStyleVector
        ? blendStyleVectors(session.currentStyleVector, msgStyle, 0.3)
        : { ...msgStyle };
    session.cognitiveLoad = updateCognitiveLoad(session.cognitiveLoad, message, lastUserMessage);
    const traitState = getTraitState();
    const techRatio = detectTechnicalDomain(message);
    traitState.domainTechnicalRatio = traitState.domainTechnicalRatio * 0.95 + techRatio * 0.05;
    if (!opts.skipBigFiveInference) {
        traitState.bigFive = updateBigFive(traitState.bigFive, message, traitState.domainTechnicalRatio);
    }
    else {
        // Still bump sample count + reliability so explicit-signal turns
        // count toward "this profile has seen N interactions" the same as
        // inferred ones.
        traitState.bigFive.sampleCount = (traitState.bigFive.sampleCount ?? 0) + 1;
        if (traitState.bigFive.sampleCount >= 15)
            traitState.bigFive.reliable = true;
    }
    traitState.baselineStyleVector = updateBaselineStyle(traitState.baselineStyleVector, msgStyle);
    maybeSaveTraitState(traitState);
    session.messageCount++;
    session.recentMessages = [...session.recentMessages, message].slice(-5);
    lastUserMessage = message;
    setSessionState(session);
}
// ── MCP Server ────────────────────────────────────────────────────
function buildLayeredContext(roleNameOverride, size = 'standard') {
    const files = readAllSoulFiles(config);
    // Skip the journal disk read entirely for non-full sizes —
    // buildSoulContext won't include it, no point paying the IO.
    const journal = size === 'full' ? readAllJournalFiles(config) : undefined;
    const activeRole = roleNameOverride ?? getActiveRole(config);
    const roleContent = activeRole ? readRole(config, activeRole) : '';
    return buildSoulContext(files, { journal, role: roleContent, size });
}
const soulContext = buildLayeredContext();
const server = new McpServer({ name: 'przm-voice', version: '1.0.0' }, {
    instructions: [
        '# przm Voice',
        'Adaptive personality. Honest, not agreeable. Style emerges from interactions.',
        soulContext ? '' : '(Personality not yet formed.)',
        soulContext || '',
        '',
        'Record user reactions immediately with voice_signal: correction, approval, frustration, elaboration, simplification, praise, explicit_feedback, code_accepted, code_rejected, style_correction.',
        'After 5+ signals: run voice_synthesize.',
        'If engram available: memory = WHAT, persona = HOW.',
    ].filter(Boolean).join('\n'),
});
// ─────────────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_context', {
    title: 'Get Context',
    description: 'Full personality context: soul files + adaptations + brain state. Pass adaptationsOnly=true for just the adaptive directives. Pass size to control verbosity — \'minimal\' (~400 tokens, just core principles + role) for tight context budgets, \'standard\' (default, ~1-2K tokens) for routine chat, \'full\' (~3-16K tokens) when you need accumulated journal notes too.',
    inputSchema: z.object({
        category: z.string().optional().describe('Topic for category-specific adaptations.'),
        userMessage: z.string().optional().describe('Process through brain systems first.'),
        adaptationsOnly: z.boolean().optional().describe('If true, return only adaptations (not soul files).'),
        role: z.string().optional().describe('Per-call role override (e.g. "developer"). Falls back to active role then no role.'),
        size: z.enum(['minimal', 'standard', 'full']).optional().describe('Context verbosity. minimal=~400 tokens (personality + role only); standard=~1-2K tokens (all soul files, no journal) [default]; full=~3-16K tokens (soul + journal-derived "learned" notes). przm\'s Context Budget Engine sets this based on the personality slot\'s allocated budget.'),
    }),
}, async ({ category, userMessage, adaptationsOnly, role, size }) => {
    if (userMessage)
        processUserMessage(userMessage);
    const resolvedSize = size ?? 'standard';
    const adaptations = getAdaptations(config, category);
    // Adaptations-only mode (replaces old persona_adapt tool)
    if (adaptationsOnly) {
        return text(adaptations || 'No adaptations yet. Record signals to build a profile.');
    }
    const soul = buildLayeredContext(role, resolvedSize);
    // Brain state and adaptations are dropped on minimal — the sizing
    // contract is "essentials only," and brain state + adaptive
    // directives are both elastic content. Standard and full include
    // them as before.
    const parts = [soul];
    if (resolvedSize !== 'minimal') {
        if (adaptations)
            parts.push(adaptations);
        const brainState = getBrainStateSummary();
        if (brainState)
            parts.push(brainState);
    }
    return text(parts.filter(Boolean).join('\n\n') || 'No personality configured.');
});
server.registerTool('voice_state', {
    title: 'Emotional State',
    description: 'Lightweight valence/arousal/cognitive-load snapshot. Pass values to memory_ingest and memory_search.',
    inputSchema: z.object({}),
}, async () => {
    const session = getSessionState();
    const traitState = getTraitState();
    const tone = session.emotionalTone;
    const positiveSum = tone.joy + tone.trust + tone.anticipation;
    const negativeSum = tone.anger + tone.fear + tone.sadness + tone.disgust;
    const valence = (positiveSum - negativeSum) / Math.max(1, positiveSum + negativeSum);
    const arousal = Math.min(1, (tone.surprise + tone.anger + tone.fear + tone.joy) / 2);
    const cogLoad = session.cognitiveLoad;
    const cognitiveLoadLevel = cogLoad.overloaded ? 'high' : cogLoad.inFlow ? 'low' : 'normal';
    let sentiment = 'neutral';
    if (tone.anger > 0.4 || tone.disgust > 0.3)
        sentiment = 'frustrated';
    else if (tone.joy > 0.4)
        sentiment = 'excited';
    else if (tone.trust > 0.4)
        sentiment = 'satisfied';
    else if (tone.surprise > 0.4)
        sentiment = 'curious';
    else if (tone.fear > 0.3 || tone.sadness > 0.3)
        sentiment = 'confused';
    return json({
        emotionalValence: Math.round(valence * 100) / 100,
        emotionalArousal: Math.round(arousal * 100) / 100,
        sentiment,
        cognitiveLoad: cognitiveLoadLevel,
        domainContext: traitState.domainTechnicalRatio > 0.5 ? 'technical' : traitState.domainTechnicalRatio > 0.2 ? 'mixed' : 'casual',
    });
});
server.registerTool('voice_detect_sycophancy', {
    title: 'Detect Sycophancy in Assistant Output',
    description: 'Scan assistant text for known sycophantic patterns: flattery openers ("great question," "absolutely"), walk-backs without new evidence, position flips (pre-pushback X → post-pushback ¬X), and agreement cascades (N consecutive turns lacking disagreement). Rules-based detection — no LLM in the loop (a model evaluating its own sycophancy is contaminated by the same failure mode). Returns all firing signals sorted by confidence descending; one turn may fire multiple signals (e.g. flattery + walk-back).',
    inputSchema: z.object({
        currentAssistantText: z.string().describe('The just-produced assistant turn. Required.'),
        priorAssistantText: z.string().optional().describe('The prior assistant turn. Required for walk-back and position-flip detection.'),
        intermediateUserText: z.string().optional().describe('The user message between prior and current assistant turns. Used to gate walk-backs (presence of user-supplied evidence suppresses flattery and walk-back signals as grounded acknowledgment).'),
        recentAssistantTurns: z.array(z.string()).optional().describe('Full assistant-turn history (oldest → newest, including current) for cascade detection.'),
        cascadeThreshold: z.number().optional().describe('Number of consecutive agreement-without-disagreement turns required to fire the cascade signal. Default: 4.'),
    }),
}, async (args) => {
    const signals = detectSycophancyInAssistant(args);
    return json({
        signals,
        count: signals.length,
        hasSycophancy: signals.length > 0,
    });
});
// ─────────────────────────────────────────────────────────────────────
// SIGNAL RECORDING
// ─────────────────────────────────────────────────────────────────────
const VALID_SIGNALS = [
    'correction', 'approval', 'satisfaction', 'frustration', 'elaboration',
    'simplification', 'confusion', 'curiosity', 'preference',
    'code_accepted', 'code_rejected', 'task_complete', 'task_abandoned',
    'regen_request', 'explicit_feedback', 'style_correction', 'praise',
    'abandonment', 'topic_shift', 're_ask',
    'extraversion_positive', 'extraversion_negative',
    'openness_positive', 'openness_negative',
    'conscientiousness_positive', 'conscientiousness_negative',
    'agreeableness_positive', 'agreeableness_negative',
    'neuroticism_positive', 'neuroticism_negative',
];
// Big Five signal types that directly nudge trait state. Outside this
// set, voice_signal records the signal but only the text-based
// inferTraitSignals path moves Big Five.
const BIG_FIVE_SIGNAL_AXIS = {
    extraversion_positive: { axis: 'extraversion', direction: 1 },
    extraversion_negative: { axis: 'extraversion', direction: -1 },
    openness_positive: { axis: 'openness', direction: 1 },
    openness_negative: { axis: 'openness', direction: -1 },
    conscientiousness_positive: { axis: 'conscientiousness', direction: 1 },
    conscientiousness_negative: { axis: 'conscientiousness', direction: -1 },
    agreeableness_positive: { axis: 'agreeableness', direction: 1 },
    agreeableness_negative: { axis: 'agreeableness', direction: -1 },
    neuroticism_positive: { axis: 'neuroticism', direction: 1 },
    neuroticism_negative: { axis: 'neuroticism', direction: -1 },
};
/**
 * Apply a direct Big Five trait nudge from an explicit signal.
 * Treats each call as one EMA observation toward the target value:
 * positive direction observes 0.5 + 0.4 * intensity (so intensity=1
 * targets 0.9), negative observes the mirror. Uses the same EMA decay
 * as the inferred-from-text path so the two routes compose cleanly.
 */
function applyBigFiveSignalNudge(state, type, intensity) {
    const mapping = BIG_FIVE_SIGNAL_AXIS[type];
    if (!mapping)
        return false;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const offset = 0.4 * clampedIntensity * mapping.direction;
    const observation = 0.5 + offset;
    const EMA_DECAY = 0.95;
    const current = state.bigFive[mapping.axis];
    state.bigFive[mapping.axis] = current * EMA_DECAY + observation * (1 - EMA_DECAY);
    // sampleCount + reliable are bumped by the no-inference branch in
    // processUserMessage so we don't double-count.
    return true;
}
// Recent user-message buffer for re_ask detection inside voice_signal.
const recentUserMessages = [];
server.registerTool('voice_signal', {
    title: 'Record Signal',
    description: 'Record a user reaction. Two modes: (1) explicit — pass `type` and `content`; (2) auto-detect — pass `userMessage` and the regex catalog classifies zero or more signals. When both are supplied, `type` wins and detection is skipped.',
    inputSchema: z.object({
        type: z.enum(VALID_SIGNALS).optional().describe('Explicit signal type. Takes precedence over userMessage detection.'),
        content: z.string().optional().describe('What triggered the signal. Required with explicit type.'),
        userMessage: z.string().optional().describe('Raw user message to auto-classify. Runs the local regex catalog; may yield 0+ signals.'),
        context: z.string().optional().describe('Surrounding context.'),
        category: z.string().optional().describe('Topic (code, writing, research, etc.).'),
        intensity: z.number().min(0).max(1).optional().describe('Strength of the signal in [0,1]. Only used by Big Five movement types (extraversion_positive, openness_negative, etc.) to nudge trait state directly. Default 0.5.'),
    }),
}, async ({ type, content, userMessage, context, category, intensity }) => {
    // Resolve which path: explicit type wins. Detection requires userMessage.
    const recorded = [];
    let primaryContent;
    // Track Big Five movement signals that need a direct trait nudge.
    const bigFiveNudges = [];
    if (type) {
        const c = content ?? userMessage;
        if (!c) {
            return json({ error: 'missing_content', message: 'Provide `content` (or `userMessage`) with explicit `type`.' });
        }
        const signal = recordSignal(config, type, c, context, category);
        recorded.push({ id: signal.id, type: signal.type });
        if (BIG_FIVE_SIGNAL_AXIS[type]) {
            bigFiveNudges.push({ type: type, intensity: intensity ?? 0.5 });
        }
        primaryContent = c;
    }
    else if (userMessage) {
        const detected = detectSignals(userMessage, recentUserMessages);
        for (const d of detected) {
            const signal = recordSignal(config, d.type, userMessage, context, category);
            recorded.push({ id: signal.id, type: signal.type, confidence: d.confidence });
            if (BIG_FIVE_SIGNAL_AXIS[d.type]) {
                // Auto-detected Big Five signals use confidence as intensity proxy.
                bigFiveNudges.push({ type: d.type, intensity: d.confidence });
            }
        }
        primaryContent = userMessage;
    }
    else {
        return json({ error: 'missing_input', message: 'Provide either `type`+`content` (explicit) or `userMessage` (auto-detect).' });
    }
    // Apply Big Five direct nudges. The text-inference Big Five step in
    // processUserMessage is skipped on these turns so the explicit
    // signal isn't immediately diluted by EMA-ing in the (often
    // benchmark-filler) text observation.
    const skipBigFiveInference = bigFiveNudges.length > 0;
    if (skipBigFiveInference) {
        const state = getTraitState();
        let nudged = false;
        for (const n of bigFiveNudges) {
            if (applyBigFiveSignalNudge(state, n.type, n.intensity))
                nudged = true;
        }
        if (nudged)
            maybeSaveTraitState(state);
    }
    // Push into the re_ask buffer for subsequent detections.
    if (primaryContent) {
        recentUserMessages.push(primaryContent);
        if (recentUserMessages.length > 50)
            recentUserMessages.splice(0, recentUserMessages.length - 50);
    }
    processUserMessage(primaryContent, { skipBigFiveInference });
    if (category && recorded.length > 0) {
        const traitState = getTraitState();
        // Map the primary signal to an emotional valence in [-1, 1]. The
        // ordering inside detectSignals already puts the strongest signal
        // first, so recorded[0] is the right anchor here. Magnitudes are
        // calibrated against pre-existing values for backwards compat:
        // approval / praise / code_accepted stay at +0.5; frustration
        // stays at -0.8; correction / code_rejected stay at -0.4.
        const effectiveType = recorded[0].type;
        const valenceTable = {
            approval: 0.5,
            praise: 0.6,
            satisfaction: 0.6,
            code_accepted: 0.5,
            task_complete: 0.4,
            curiosity: 0.2,
            preference: 0.1,
            correction: -0.4,
            style_correction: -0.3,
            code_rejected: -0.4,
            confusion: -0.3,
            regen_request: -0.3,
            abandonment: -0.5,
            task_abandoned: -0.5,
            frustration: -0.8,
        };
        const valence = valenceTable[effectiveType] ?? 0;
        if (valence !== 0) {
            updateEmotionalAssociation(traitState, category, valence, Math.abs(valence));
            maybeSaveTraitState(traitState);
        }
    }
    const signals = loadSignals(config);
    rebuildProfile(config, signals);
    const profile = loadProfile(config);
    const pending = loadProposals(config).filter(p => p.status === 'pending');
    if (profile.stats.totalSignals > 0 &&
        profile.stats.totalSignals % config.proposalThreshold === 0 &&
        pending.length < 5) {
        const newProposals = generateProposals(config, signals);
        if (newProposals.length > 0) {
            return json({
                signals: recorded,
                brainState: {
                    emotionalValence: emotionalValence(session.emotionalTone).toFixed(2),
                    cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
                    inFlow: session.cognitiveLoad.inFlow,
                },
                newProposals: newProposals.map(p => ({
                    id: p.id, type: p.type, target: p.target,
                    content: p.content.slice(0, 100),
                    confidence: p.confidence,
                })),
                message: `${recorded.length} signal(s) recorded. ${newProposals.length} new evolution proposal(s) generated.`,
            });
        }
    }
    return json({
        signals: recorded,
        brainState: {
            emotionalValence: emotionalValence(session.emotionalTone).toFixed(2),
            cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
            inFlow: session.cognitiveLoad.inFlow,
        },
        message: recorded.length === 0 ? 'No signals detected.' : `${recorded.length} signal(s) recorded.`,
    });
});
// ─────────────────────────────────────────────────────────────────────
// PROFILE & STATS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_profile', {
    title: 'View Profile',
    description: 'Behavioral profile: style preferences, satisfaction, topic patterns, Big Five traits, and explicit feedback (recent + pinned).',
    inputSchema: z.object({
        format: z.enum(['text', 'json']).optional().describe('Output format. text (default) returns a human-readable summary; json returns structured profile data.'),
    }),
}, async ({ format }) => {
    const profile = loadProfile(config);
    if (format === 'json') {
        return json({
            stats: profile.stats,
            stylePreferences: profile.stylePreferences,
            topicPreferences: profile.topicPreferences,
            feedback: {
                recent: profile.recentFeedback ?? [],
                pinned: profile.pinnedFeedback ?? [],
            },
            lastUpdated: profile.lastUpdated,
        });
    }
    const summary = getProfileSummary(config);
    const feedbackLines = [];
    const pinned = profile.pinnedFeedback ?? [];
    const recent = profile.recentFeedback ?? [];
    if (pinned.length > 0) {
        feedbackLines.push('', `Pinned feedback (${pinned.length}):`);
        for (let i = 0; i < pinned.length; i++)
            feedbackLines.push(`  [${i}] ${pinned[i]}`);
    }
    if (recent.length > 0) {
        feedbackLines.push('', `Recent feedback (${recent.length}):`);
        for (const f of recent.slice(-5))
            feedbackLines.push(`  - ${f}`);
    }
    const body = (summary || 'No profile yet. Record signals to build one.') + feedbackLines.join('\n');
    return text(body);
});
// ─────────────────────────────────────────────────────────────────────
// FEEDBACK PIN / UNPIN
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_feedback_pin', {
    title: 'Pin Feedback',
    description: 'Pin a piece of explicit feedback so it persists beyond the 10-entry recentFeedback cap. If feedbackContent matches an entry in recentFeedback, it moves; otherwise the content is appended as a fresh pinned entry.',
    inputSchema: z.object({
        feedbackContent: z.string().describe('Feedback text to pin. Exact or substring match against recentFeedback; otherwise stored verbatim.'),
    }),
}, async ({ feedbackContent }) => {
    const profile = loadProfile(config);
    const recent = profile.recentFeedback ?? [];
    const pinned = profile.pinnedFeedback ?? [];
    // Try to locate an existing recentFeedback entry to move.
    const idx = recent.findIndex(f => f === feedbackContent || f.includes(feedbackContent) || feedbackContent.includes(f));
    let movedFromRecent = false;
    let entry = feedbackContent;
    if (idx >= 0) {
        entry = recent[idx];
        recent.splice(idx, 1);
        movedFromRecent = true;
    }
    if (!pinned.includes(entry))
        pinned.push(entry);
    profile.recentFeedback = recent;
    profile.pinnedFeedback = pinned;
    saveProfileExternal(config, profile);
    return json({
        pinned: entry,
        movedFromRecent,
        counts: { recent: recent.length, pinned: pinned.length },
    });
});
server.registerTool('voice_feedback_unpin', {
    title: 'Unpin Feedback',
    description: 'Remove an entry from pinnedFeedback by index. Use voice_profile with format=json to see indices.',
    inputSchema: z.object({
        index: z.number().int().nonnegative().describe('Index into pinnedFeedback.'),
    }),
}, async ({ index }) => {
    const profile = loadProfile(config);
    const pinned = profile.pinnedFeedback ?? [];
    if (index >= pinned.length) {
        return json({ error: 'index_out_of_range', length: pinned.length });
    }
    const [removed] = pinned.splice(index, 1);
    profile.pinnedFeedback = pinned;
    saveProfileExternal(config, profile);
    return json({ unpinned: removed, counts: { pinned: pinned.length } });
});
server.registerTool('voice_stats', {
    title: 'Stats',
    description: 'System overview: signals, profile, proposals, soul files, brain state, bridge status.',
    inputSchema: z.object({}),
}, async () => {
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    const profile = loadProfile(config);
    const proposals = loadProposals(config);
    const files = readAllSoulFiles(config);
    const traitState = getTraitState();
    // Bridge status (new observability)
    let bridge = { status: 'no bridge file' };
    try {
        const { readFileSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const bridgePath = join(homedir(), '.claude', 'procedural-bridge.json');
        if (existsSync(bridgePath)) {
            const bridgeFile = JSON.parse(readFileSync(bridgePath, 'utf-8'));
            bridge = {
                lastUpdated: bridgeFile.lastUpdated,
                totalRules: bridgeFile.rules.length,
                engramRules: bridgeFile.rules.filter((r) => r.source === 'engram').length,
                personaRules: bridgeFile.rules.filter((r) => r.source === 'persona').length,
            };
        }
    }
    catch { /* no bridge file */ }
    return json({
        signals: { total: signals.length, byCounts: counts },
        profile: {
            satisfaction: profile.stats.avgSatisfaction,
            correctionRate: profile.stats.correctionRate,
            approvalRate: profile.stats.approvalRate,
            verbosity: profile.stylePreferences.verbosity,
            topicCount: Object.keys(profile.topicPreferences).length,
        },
        brainState: {
            bigFive: {
                reliable: traitState.bigFive.reliable,
                sampleCount: traitState.bigFive.sampleCount,
                traits: traitState.bigFive.reliable ? {
                    openness: traitState.bigFive.openness.toFixed(2),
                    conscientiousness: traitState.bigFive.conscientiousness.toFixed(2),
                    extraversion: traitState.bigFive.extraversion.toFixed(2),
                    agreeableness: traitState.bigFive.agreeableness.toFixed(2),
                    neuroticism: traitState.bigFive.neuroticism.toFixed(2),
                } : 'building...',
            },
            domainContext: traitState.domainTechnicalRatio > 0.5 ? 'technical' : traitState.domainTechnicalRatio > 0.2 ? 'mixed' : 'casual',
            domainTechnicalRatio: traitState.domainTechnicalRatio.toFixed(2),
            emotionalAssociations: traitState.emotionalAssociations.length,
            sessionsAnalyzed: traitState.sessionsAnalyzed,
            lastConsolidation: traitState.lastConsolidation,
            sessionState: {
                messageCount: session.messageCount,
                cognitiveLoad: session.cognitiveLoad.load.toFixed(2),
                inFlow: session.cognitiveLoad.inFlow,
                overloaded: session.cognitiveLoad.overloaded,
                dominantEmotion: getDominantEmotion(),
                compoundEmotions: detectDyads(session.emotionalTone).slice(0, 3).map(d => d.name),
            },
        },
        proposals: {
            total: proposals.length,
            pending: proposals.filter(p => p.status === 'pending').length,
            applied: proposals.filter(p => p.status === 'applied').length,
            rejected: proposals.filter(p => p.status === 'rejected').length,
        },
        soulFiles: {
            personality: files.personality ? `${files.personality.length} chars` : 'not set',
            style: files.style ? `${files.style.length} chars` : 'not set',
            skill: files.skill ? `${files.skill.length} chars` : 'not set',
        },
        journal: (() => {
            const j = readAllJournalFiles(config);
            return {
                personality: j.personality ? `${j.personality.length} chars` : 'empty',
                style: j.style ? `${j.style.length} chars` : 'empty',
                skill: j.skill ? `${j.skill.length} chars` : 'empty',
            };
        })(),
        role: {
            active: getActiveRole(config),
            available: listRoles(config).map(r => r.name),
        },
        bridge,
        dataDir: config.dataDir,
    });
});
// ─────────────────────────────────────────────────────────────────────
// EVOLUTION PROPOSALS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_proposals', {
    title: 'List Proposals',
    description: 'Evolution proposals: suggested personality changes from behavioral evidence.',
    inputSchema: z.object({
        status: z.enum(['pending', 'applied', 'rejected', 'all']).optional().describe('Filter (default: pending).'),
    }),
}, async ({ status }) => {
    const proposals = loadProposals(config);
    const filtered = status === 'all' ? proposals : proposals.filter(p => p.status === (status ?? 'pending'));
    return json(filtered.map(p => ({
        id: p.id, type: p.type, target: p.target, action: p.action,
        content: p.content, rationale: p.rationale, confidence: p.confidence,
        status: p.status, createdAt: p.createdAt,
    })));
});
server.registerTool('voice_apply', {
    title: 'Apply Proposal',
    description: 'Apply a pending evolution proposal.',
    inputSchema: z.object({
        proposalId: z.string().describe('Proposal ID.'),
    }),
}, async ({ proposalId }) => {
    const result = applyProposal(config, proposalId);
    return text(result.message);
});
server.registerTool('voice_reject', {
    title: 'Reject Proposal',
    description: 'Reject a pending evolution proposal.',
    inputSchema: z.object({
        proposalId: z.string().describe('Proposal ID.'),
    }),
}, async ({ proposalId }) => {
    const result = rejectProposal(config, proposalId);
    return text(result.message);
});
server.registerTool('voice_evolve', {
    title: 'Generate Proposals',
    description: 'Manually trigger evolution proposal generation from accumulated signals.',
    inputSchema: z.object({}),
}, async () => {
    const signals = loadSignals(config);
    const proposals = generateProposals(config, signals);
    if (proposals.length === 0) {
        return text('No new proposals. Need more signals or existing proposals cover current patterns.');
    }
    return json({
        generated: proposals.length,
        proposals: proposals.map(p => ({
            id: p.id, type: p.type, target: p.target,
            content: p.content, rationale: p.rationale, confidence: p.confidence,
        })),
    });
});
// ─────────────────────────────────────────────────────────────────────
// SOUL FILE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_read', {
    title: 'Read Soul File',
    description: 'Read a soul file (personality, style, or skill).',
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).describe('Which file.'),
    }),
}, async ({ file }) => {
    const content = readSoulFile(config, file);
    return text(content || `${file} soul file is empty.`);
});
server.registerTool('voice_edit', {
    title: 'Edit Soul File',
    description: 'Overwrite a soul file directly.',
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).describe('Which file.'),
        content: z.string().describe('New content (replaces entire file).'),
    }),
}, async ({ file, content }) => {
    writeSoulFile(config, file, content);
    return text(`Updated ${file} soul file (${content.length} chars).`);
});
server.registerTool('voice_init', {
    title: 'Initialize',
    description: 'Reset soul files to defaults. Won\'t overwrite existing.',
    inputSchema: z.object({}),
}, async () => {
    const files = initSoulFiles(config);
    return json({
        personality: `${files.personality.length} chars`,
        style: `${files.style.length} chars`,
        skill: `${files.skill.length} chars`,
        dataDir: config.dataDir,
    });
});
// ─────────────────────────────────────────────────────────────────────
// SOUL PRESETS (bundled identity templates ported from Finch)
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_soul_presets_list', {
    title: 'List Soul Presets',
    description: 'List bundled SOUL.md presets (default, coach, mentor, devils-advocate, reflective-listener, creative-partner, dungeon-master, personal-assistant, study-buddy). Apply one to write its content into PERSONALITY.md.',
    inputSchema: z.object({}),
}, async () => {
    const presets = listSoulPresets();
    return json({
        presets: presets.map(p => ({
            name: p.name,
            bytes: p.content.length,
            preview: p.content.split('\n').slice(0, 3).join(' ').slice(0, 160),
        })),
    });
});
server.registerTool('voice_soul_preset_read', {
    title: 'Read Soul Preset',
    description: 'Read a bundled SOUL.md preset without applying it.',
    inputSchema: z.object({
        name: z.string().describe('Preset name (e.g. "coach", "default", "mentor").'),
    }),
}, async ({ name }) => {
    const content = readSoulPreset(name);
    return text(content || `Preset "${name}" not found.`);
});
server.registerTool('voice_soul_preset_apply', {
    title: 'Apply Soul Preset',
    description: "Write a bundled SOUL.md preset into the user's PERSONALITY.md. Replaces existing personality content. STYLE.md and SKILL.md are not touched.",
    inputSchema: z.object({
        name: z.string().describe('Preset name to apply.'),
    }),
}, async ({ name }) => {
    const result = applySoulPreset(config, name);
    if (!result.applied)
        return json({ error: 'unknown_preset', name });
    return json({ applied: name, target: 'personality.md', bytes: result.bytes });
});
// ─────────────────────────────────────────────────────────────────────
// ROLE LAYER (domain overlays — developer, designer, pm, writer, researcher)
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_role_list', {
    title: 'List Roles',
    description: 'List bundled and user-defined roles. Roles are domain overlays (developer, designer, pm…) layered on top of the soul at prompt-build time.',
    inputSchema: z.object({}),
}, async () => {
    const roles = listRoles(config);
    const active = getActiveRole(config);
    return json({
        active,
        roles: roles.map(r => ({
            name: r.name,
            active: r.name === active,
            bytes: r.content.length,
            preview: r.content.split('\n').slice(0, 2).join(' ').slice(0, 120),
        })),
    });
});
server.registerTool('voice_role_set', {
    title: 'Set Active Role',
    description: 'Activate a role globally. Per-call overrides via voice_context({ role }) bypass this. Pass null to clear.',
    inputSchema: z.object({
        name: z.string().describe('Role name (e.g. "developer"). Must exist in bundled roles or dataDir/roles/<name>/ROLE.md.'),
    }),
}, async ({ name }) => {
    const content = readRole(config, name);
    if (!content)
        return json({ error: 'unknown_role', name });
    setActiveRole(config, name);
    return json({ active: name, bytes: content.length });
});
server.registerTool('voice_role_clear', {
    title: 'Clear Active Role',
    description: 'Clear the active role. Subsequent voice_context calls with no role override will return soul-only context.',
    inputSchema: z.object({}),
}, async () => {
    setActiveRole(config, null);
    return text('Active role cleared.');
});
server.registerTool('voice_role_read', {
    title: 'Read Role',
    description: 'Read a role file. Returns the user override if present in dataDir/roles/<name>/ROLE.md, else the bundled default.',
    inputSchema: z.object({
        name: z.string().describe('Role name.'),
    }),
}, async ({ name }) => {
    const content = readRole(config, name);
    return text(content || `Role "${name}" not found.`);
});
server.registerTool('voice_role_edit', {
    title: 'Edit Role',
    description: 'Override or create a custom role at dataDir/roles/<name>/ROLE.md. User overrides shadow bundled defaults.',
    inputSchema: z.object({
        name: z.string().describe('Role name.'),
        content: z.string().describe('Markdown content (replaces entire file).'),
    }),
}, async ({ name, content }) => {
    writeRole(config, name, content);
    return text(`Wrote role "${name}" (${content.length} chars).`);
});
// ─────────────────────────────────────────────────────────────────────
// JOURNAL (przm Voice's auto-derived notes — separate from user-edited soul)
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_journal_read', {
    title: 'Read Journal',
    description: "Read przm Voice's auto-derived notes (from applied evolution proposals). These layer onto the soul at prompt-build time but live in dataDir/journal/, never overwriting user-edited soul files.",
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).optional().describe('Specific file. Omit to read all three.'),
    }),
}, async ({ file }) => {
    const all = readAllJournalFiles(config);
    if (file)
        return text(all[file] || `Journal ${file} is empty.`);
    return json({
        personality: all.personality.length > 0 ? `${all.personality.length} chars` : 'empty',
        style: all.style.length > 0 ? `${all.style.length} chars` : 'empty',
        skill: all.skill.length > 0 ? `${all.skill.length} chars` : 'empty',
        content: all,
    });
});
server.registerTool('voice_journal_clear', {
    title: 'Clear Journal',
    description: "Wipe przm Voice's auto-derived notes without touching the user-edited soul. Use when the journal has accumulated learnings that no longer reflect the current relationship.",
    inputSchema: z.object({
        file: z.enum(['personality', 'style', 'skill']).optional().describe('Specific file to clear. Omit to clear all three.'),
    }),
}, async ({ file }) => {
    const cleared = clearJournal(config, file);
    return text(`Cleared ${cleared} journal file(s).`);
});
// ─────────────────────────────────────────────────────────────────────
// PERSONALITY SYNTHESIS
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_synthesize', {
    title: 'Synthesize',
    description: 'Analyze user messages, extract communication traits, update soul files, and process through brain systems.',
    inputSchema: z.object({
        messages: z.string().describe('JSON array of user message strings.'),
    }),
}, async ({ messages }) => {
    const parsed = JSON.parse(messages);
    for (const msg of parsed) {
        processUserMessage(msg);
    }
    // Synthesis is an explicit, infrequent operation — flush trait
    // inferences immediately rather than waiting for the throttle.
    forceSaveTraitState();
    const result = updateSoulFromSynthesis(config, parsed);
    const traitState = getTraitState();
    return json({
        traits: {
            messageLength: result.traits.prefersTerse ? 'terse' : result.traits.avgMessageLength > 300 ? 'verbose' : 'moderate',
            formality: result.traits.formalityLevel > 0.6 ? 'formal' : result.traits.formalityLevel < 0.4 ? 'casual' : 'neutral',
            technicalDepth: result.traits.technicalDepth > 0.6 ? 'deep' : result.traits.technicalDepth < 0.3 ? 'non-technical' : 'moderate',
            humor: result.traits.humorFrequency > 0.2 ? 'frequent' : result.traits.humorFrequency > 0.05 ? 'occasional' : 'rare',
            directness: result.traits.directness > 0.6 ? 'direct' : result.traits.directness < 0.4 ? 'exploratory' : 'balanced',
            emoji: result.traits.usesEmoji,
            sampleSize: result.traits.sampleSize,
        },
        bigFive: traitState.bigFive.reliable ? {
            openness: traitState.bigFive.openness.toFixed(2),
            conscientiousness: traitState.bigFive.conscientiousness.toFixed(2),
            extraversion: traitState.bigFive.extraversion.toFixed(2),
            agreeableness: traitState.bigFive.agreeableness.toFixed(2),
            neuroticism: traitState.bigFive.neuroticism.toFixed(2),
        } : `building (${traitState.bigFive.sampleCount}/15)`,
        updated: result.updated,
        changes: result.changes,
    });
});
server.registerTool('voice_analyze', {
    title: 'Analyze Style',
    description: 'Analyze communication style without updating soul files. Emotional tone, Big Five, style vector.',
    inputSchema: z.object({
        messages: z.string().describe('JSON array of user message strings.'),
    }),
}, async ({ messages }) => {
    const parsed = JSON.parse(messages);
    const traits = analyzeUserMessages(parsed);
    const traitState = getTraitState();
    let tempBigFive = { ...traitState.bigFive };
    for (const msg of parsed) {
        const techRatio = detectTechnicalDomain(msg);
        tempBigFive = updateBigFive(tempBigFive, msg, techRatio);
    }
    const styleVectors = parsed.map(computeStyleVector);
    const avgStyle = {
        formality: avg(styleVectors.map(s => s.formality)),
        energy: avg(styleVectors.map(s => s.energy)),
        verbosity: avg(styleVectors.map(s => s.verbosity)),
        humor: avg(styleVectors.map(s => s.humor)),
        specificity: avg(styleVectors.map(s => s.specificity)),
    };
    const tones = parsed.map(msg => detectEmotionalTone(msg));
    const avgTone = {};
    for (const key of Object.keys(tones[0] || {})) {
        avgTone[key] = avg(tones.map(t => t[key]));
    }
    return json({
        communicationTraits: traits,
        bigFiveSnapshot: {
            openness: tempBigFive.openness.toFixed(2),
            conscientiousness: tempBigFive.conscientiousness.toFixed(2),
            extraversion: tempBigFive.extraversion.toFixed(2),
            agreeableness: tempBigFive.agreeableness.toFixed(2),
            neuroticism: tempBigFive.neuroticism.toFixed(2),
            note: 'Snapshot from provided messages only.',
        },
        styleVector: avgStyle,
        emotionalTone: avgTone,
    });
});
// ─────────────────────────────────────────────────────────────────────
// CONSOLIDATION
// ─────────────────────────────────────────────────────────────────────
server.registerTool('voice_consolidate', {
    title: 'Consolidate',
    description: 'Between-session consolidation: decay emotions, detect drift, check contradictions, promote patterns, sync Engram bridge.',
    inputSchema: z.object({}),
}, async () => {
    const signals = loadSignals(config);
    const counts = getSignalCounts(signals);
    recordSessionSummary(config, session, counts);
    // Flush any throttled in-memory state to disk before consolidation
    // reads it. Consolidation mutates trait state on disk via its own
    // load/save cycle, so we then invalidate the cache so subsequent
    // reads pick up the consolidated values.
    forceSaveTraitState();
    traitStateCache = null;
    const result = runConsolidation(config);
    // Auto-sync procedural bridge
    let bridgeSync = { exported: 0, imported: 0, skipped: 0, conflicts: [] };
    try {
        const { syncBridge } = await import('./procedural-bridge.js');
        bridgeSync = syncBridge(config);
    }
    catch {
        // Bridge sync is best-effort
    }
    session = { ...DEFAULT_SESSION_STATE, startedAt: new Date().toISOString() };
    setSessionState(session);
    lastUserMessage = undefined;
    return json({
        result,
        bridge: bridgeSync,
        message: result.contradictions.length > 0
            ? `Consolidation complete. ${result.contradictions.length} contradiction(s) detected.`
            : 'Consolidation complete. Patterns integrated.',
    });
});
// ── Helpers ─────────────────────────────────────────────────────────
function getBrainStateSummary() {
    const lines = [];
    lines.push('--- BRAIN STATE ---');
    const dominant = getDominantEmotion();
    const valence = emotionalValence(session.emotionalTone);
    if (dominant !== 'neutral') {
        lines.push(`Emotional context: ${dominant} (valence: ${valence > 0 ? '+' : ''}${valence.toFixed(2)})`);
    }
    const dyads = detectDyads(session.emotionalTone);
    if (dyads.length > 0) {
        const dyadStr = dyads.slice(0, 3).map(d => `${d.name} (${d.intensity.toFixed(2)})`).join(', ');
        lines.push(`Compound emotions: ${dyadStr}`);
    }
    if (session.cognitiveLoad.inFlow) {
        lines.push('Cognitive state: IN FLOW (be concise, match pace)');
    }
    else if (session.cognitiveLoad.overloaded) {
        lines.push('Cognitive state: OVERLOADED (use chunks, numbered steps)');
    }
    if (session.messageCount > 0) {
        lines.push(`Session: ${session.messageCount} messages processed`);
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
function getDominantEmotion() {
    const tone = session.emotionalTone;
    const entries = Object.entries(tone);
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    if (!top || top[1] < 0.15)
        return 'neutral';
    return top[0];
}
function avg(nums) {
    if (nums.length === 0)
        return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}
// ── Auto-Consolidation ────────────────────────────────────────────
const AUTO_CONSOLIDATION_HOURS = 24;
function checkAutoConsolidate() {
    try {
        const traitState = loadTraitState(config);
        const lastConsolidation = new Date(traitState.lastConsolidation).getTime();
        const hoursSince = (Date.now() - lastConsolidation) / 3_600_000;
        if (hoursSince >= AUTO_CONSOLIDATION_HOURS) {
            console.error(`Auto-consolidation: ${hoursSince.toFixed(1)}h since last consolidation, running now...`);
            const result = runConsolidation(config);
            console.error(`Auto-consolidation complete: ${result.emotionalDecay} associations decayed, ${result.traitUpdates.length} trait updates`);
            if (result.contradictions.length > 0) {
                console.error(`Auto-consolidation warnings: ${result.contradictions.join('; ')}`);
            }
        }
    }
    catch (err) {
        console.error('Auto-consolidation check failed:', err);
    }
}
// ── Start Server ───────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('przm Voice MCP server v1.0.0 running on stdio');
    console.error(`Data dir: ${config.dataDir}`);
    console.error(`Soul files: ${SOUL_FILE_NAMES.map(f => readSoulFile(config, f) ? f : `${f} (empty)`).join(', ')}`);
    const signals = loadSignals(config);
    const traitState = loadTraitState(config);
    if (signals.length > 0) {
        console.error(`Signals: ${signals.length}, Profile satisfaction: ${(loadProfile(config).stats.avgSatisfaction * 100).toFixed(0)}%`);
    }
    if (traitState.bigFive.sampleCount > 0) {
        console.error(`Big Five: ${traitState.bigFive.sampleCount} samples${traitState.bigFive.reliable ? ' (reliable)' : ' (building)'}`);
    }
    console.error(`Emotional associations: ${traitState.emotionalAssociations.length}`);
    console.error(`Sessions analyzed: ${traitState.sessionsAnalyzed}`);
    checkAutoConsolidate();
}
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map