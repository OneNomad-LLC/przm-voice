import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadProfile } from './profile.js';
import { getSignalCounts, getRecentSignals } from './signals.js';
import { appendJournal, replaceJournalFragment, removeJournalFragment } from './journal.js';
/**
 * Evolution engine -- proposes and applies personality changes
 * based on accumulated behavioral evidence.
 *
 * Proposals are generated heuristically from signal patterns.
 * Each proposal targets a specific soul file with a concrete edit
 * and a rationale backed by signal evidence.
 *
 * Storage: dataDir/proposals.json
 */
function proposalsPath(config) {
    return join(config.dataDir, 'proposals.json');
}
export function loadProposals(config) {
    const path = proposalsPath(config);
    if (!existsSync(path))
        return [];
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return [];
    }
}
function saveProposals(config, proposals) {
    const dir = dirname(proposalsPath(config));
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(proposalsPath(config), JSON.stringify(proposals, null, 2), 'utf-8');
}
// ── Proposal Generation ─────────────────────────────────────────────
/**
 * Generate evolution proposals from accumulated signals.
 * Uses heuristic pattern detection -- no LLM needed.
 */
export function generateProposals(config, signals) {
    const profile = loadProfile(config);
    const recent = getRecentSignals(signals, 14);
    const counts = getSignalCounts(recent);
    const existing = loadProposals(config);
    const pendingTargets = new Set(existing.filter(p => p.status === 'pending').map(p => p.content));
    const proposals = [];
    // ── Verbosity adjustments ─────────────────────────────────────
    if ((counts.elaboration ?? 0) >= 3 && profile.stylePreferences.verbosity > 0.3) {
        const content = 'When in doubt, provide more detail rather than less. The user frequently asks for elaboration.';
        if (!pendingTargets.has(content)) {
            proposals.push(makeProposal('style_edit', 'style', 'add', content, 'User asked for elaboration 3+ times recently', [{ signalType: 'elaboration', count: counts.elaboration ?? 0 }], 0.7));
        }
    }
    if ((counts.simplification ?? 0) >= 3 && profile.stylePreferences.verbosity < -0.3) {
        const content = 'Keep responses concise. The user prefers brevity and gets frustrated with long explanations.';
        if (!pendingTargets.has(content)) {
            proposals.push(makeProposal('style_edit', 'style', 'add', content, 'User asked to simplify 3+ times recently', [{ signalType: 'simplification', count: counts.simplification ?? 0 }], 0.7));
        }
    }
    // ── Frustration response ──────────────────────────────────────
    if ((counts.frustration ?? 0) >= 3) {
        const frustrationSignals = recent.filter(s => s.type === 'frustration');
        const commonWords = findCommonPatterns(frustrationSignals.map(s => s.content));
        if (commonWords.length > 0) {
            const content = `Be careful with: ${commonWords.join(', ')}. These topics/patterns have frustrated the user.`;
            if (!pendingTargets.has(content)) {
                proposals.push(makeProposal('skill_edit', 'skill', 'add', content, `User frustrated ${counts.frustration} times, common patterns: ${commonWords.join(', ')}`, [{ signalType: 'frustration', count: counts.frustration ?? 0 }], 0.6));
            }
        }
    }
    // ── Style corrections ─────────────────────────────────────────
    if ((counts.style_correction ?? 0) >= 2) {
        const corrections = recent.filter(s => s.type === 'style_correction');
        for (const correction of corrections.slice(-3)) {
            const content = correction.content.slice(0, 200);
            if (!pendingTargets.has(content)) {
                proposals.push(makeProposal('style_edit', 'style', 'add', content, `User corrected style: "${correction.content.slice(0, 100)}"`, [{ signalType: 'style_correction', count: counts.style_correction ?? 0 }], 0.8));
            }
        }
    }
    // ── Code preference ───────────────────────────────────────────
    const codeAccepted = counts.code_accepted ?? 0;
    const codeRejected = counts.code_rejected ?? 0;
    if (codeAccepted + codeRejected >= 5 && codeRejected > codeAccepted) {
        const content = 'Code suggestions are frequently rejected. Focus more on understanding the existing codebase before suggesting changes.';
        if (!pendingTargets.has(content)) {
            proposals.push(makeProposal('skill_edit', 'skill', 'add', content, `Code rejected ${codeRejected} times vs accepted ${codeAccepted}`, [
                { signalType: 'code_accepted', count: codeAccepted },
                { signalType: 'code_rejected', count: codeRejected },
            ], 0.6));
        }
    }
    // ── Praise patterns (what's working) ──────────────────────────
    if ((counts.praise ?? 0) >= 3) {
        const praiseSignals = recent.filter(s => s.type === 'praise');
        const patterns = findCommonPatterns(praiseSignals.map(s => s.content));
        if (patterns.length > 0) {
            const content = `Keep doing: ${patterns.join(', ')}. The user responds well to this.`;
            if (!pendingTargets.has(content)) {
                proposals.push(makeProposal('personality_edit', 'personality', 'add', content, `User praised ${counts.praise} times, patterns: ${patterns.join(', ')}`, [{ signalType: 'praise', count: counts.praise ?? 0 }], 0.7));
            }
        }
    }
    // ── Avoid patterns from explicit feedback ─────────────────────
    if (profile.stylePreferences.avoidPatterns.length > 0) {
        const avoids = profile.stylePreferences.avoidPatterns.slice(-5);
        const content = `Never: ${avoids.join('; ')}`;
        if (!pendingTargets.has(content)) {
            proposals.push(makeProposal('style_edit', 'style', 'add', content, 'Accumulated user corrections about what to avoid', [{ signalType: 'correction', count: counts.correction ?? 0 }], 0.9));
        }
    }
    // Save new proposals
    if (proposals.length > 0) {
        const all = [...existing, ...proposals];
        saveProposals(config, all);
    }
    return proposals;
}
// ── Proposal Application ────────────────────────────────────────────
export function applyProposal(config, proposalId) {
    const proposals = loadProposals(config);
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1)
        return { success: false, message: 'Proposal not found.' };
    const proposal = proposals[idx];
    if (proposal.status !== 'pending')
        return { success: false, message: `Proposal is already ${proposal.status}.` };
    // Apply to the journal namespace, never to the user-edited soul. Soul/
    // is user territory — Persona only writes here. buildSoulContext layers
    // both at prompt-build time, so behavior is unchanged from the caller's
    // perspective. The user can clear the journal without losing soul edits.
    if (proposal.action === 'add') {
        appendJournal(config, proposal.target, proposal.content);
    }
    else if (proposal.action === 'replace' && proposal.oldContent) {
        replaceJournalFragment(config, proposal.target, proposal.oldContent, proposal.content);
    }
    else if (proposal.action === 'remove' && proposal.oldContent) {
        removeJournalFragment(config, proposal.target, proposal.oldContent);
    }
    proposals[idx].status = 'applied';
    saveProposals(config, proposals);
    return { success: true, message: `Applied ${proposal.type} to journal/${proposal.target}: "${proposal.content.slice(0, 80)}"` };
}
export function rejectProposal(config, proposalId) {
    const proposals = loadProposals(config);
    const idx = proposals.findIndex(p => p.id === proposalId);
    if (idx === -1)
        return { success: false, message: 'Proposal not found.' };
    proposals[idx].status = 'rejected';
    saveProposals(config, proposals);
    return { success: true, message: 'Proposal rejected.' };
}
// ── Helpers ─────────────────────────────────────────────────────────
function makeProposal(type, target, action, content, rationale, evidence, confidence) {
    return {
        id: randomUUID(),
        type, target, action, content, rationale, evidence, confidence,
        status: 'pending',
        createdAt: new Date().toISOString(),
    };
}
/**
 * Find common words/phrases across multiple signal contents.
 * Returns the most frequently occurring meaningful terms.
 */
function findCommonPatterns(texts) {
    if (texts.length < 2)
        return texts.map(t => t.slice(0, 50));
    const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'that', 'this',
        'and', 'but', 'or', 'not', 'no', 'so', 'too', 'very', 'just', 'also',
        'for', 'from', 'with', 'about', 'into', 'if', 'then']);
    const wordCounts = new Map();
    for (const text of texts) {
        const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
        for (const word of words) {
            wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        }
    }
    return Array.from(wordCounts.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);
}
//# sourceMappingURL=evolution.js.map