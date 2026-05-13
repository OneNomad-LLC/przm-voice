import { getStorage } from './storage/index.js';
/**
 * Journal — Persona's auto-derived notes, kept separate from user-edited soul.
 *
 * When evolution.applyProposal runs, it appends here instead of touching the
 * soul/ directory. That preserves a clean ownership boundary:
 *   soul/  → user territory (persona_edit and direct file writes only)
 *   journal/ → Persona territory (auto-learned, freely rewritten/cleared)
 *
 * Both layers are surfaced together in buildSoulContext so the prompt sees
 * a unified view, but the user can clear the journal at any time without
 * losing their hand-tuned soul.
 *
 * Storage: routed through the StorageAdapter. File mode preserves
 * dataDir/journal/*.md exactly.
 */
const JOURNAL_KEYS = ['personality', 'style', 'skill'];
// ── Read ────────────────────────────────────────────────────────────
export function readJournalFile(_config, file) {
    return getStorage().readJournal(file);
}
export function readAllJournalFiles(config) {
    return {
        personality: readJournalFile(config, 'personality'),
        style: readJournalFile(config, 'style'),
        skill: readJournalFile(config, 'skill'),
    };
}
// ── Write ───────────────────────────────────────────────────────────
export function appendJournal(_config, target, content) {
    const storage = getStorage();
    const existing = storage.readJournal(target);
    const next = existing.trimEnd() + (existing ? '\n\n' : '') + content + '\n';
    storage.writeJournal(target, next);
}
export function replaceJournalFragment(_config, target, oldContent, newContent) {
    const storage = getStorage();
    const current = storage.readJournal(target);
    if (!current)
        return;
    storage.writeJournal(target, current.replace(oldContent, newContent));
}
export function removeJournalFragment(_config, target, fragment) {
    const storage = getStorage();
    const current = storage.readJournal(target);
    if (!current)
        return;
    storage.writeJournal(target, current.replace(fragment, '').replace(/\n{3,}/g, '\n\n'));
}
export function clearJournal(_config, file) {
    const storage = getStorage();
    const targets = file ? [file] : JOURNAL_KEYS;
    let cleared = 0;
    for (const f of targets) {
        if (storage.deleteJournal(f))
            cleared++;
    }
    return cleared;
}
//# sourceMappingURL=journal.js.map