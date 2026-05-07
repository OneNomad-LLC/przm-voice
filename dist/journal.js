import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 */
const JOURNAL_FILES = {
    personality: 'personality.md',
    style: 'style.md',
    skill: 'skill.md',
};
function journalDir(config) {
    return join(config.dataDir, 'journal');
}
function journalPath(config, file) {
    return join(journalDir(config), JOURNAL_FILES[file]);
}
// ── Read ────────────────────────────────────────────────────────────
export function readJournalFile(config, file) {
    const path = journalPath(config, file);
    if (!existsSync(path))
        return '';
    return readFileSync(path, 'utf-8');
}
export function readAllJournalFiles(config) {
    return {
        personality: readJournalFile(config, 'personality'),
        style: readJournalFile(config, 'style'),
        skill: readJournalFile(config, 'skill'),
    };
}
// ── Write ───────────────────────────────────────────────────────────
export function appendJournal(config, target, content) {
    const path = journalPath(config, target);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    const next = existing.trimEnd() + (existing ? '\n\n' : '') + content + '\n';
    writeFileSync(path, next, 'utf-8');
}
export function replaceJournalFragment(config, target, oldContent, newContent) {
    const path = journalPath(config, target);
    if (!existsSync(path))
        return;
    const current = readFileSync(path, 'utf-8');
    writeFileSync(path, current.replace(oldContent, newContent), 'utf-8');
}
export function removeJournalFragment(config, target, fragment) {
    const path = journalPath(config, target);
    if (!existsSync(path))
        return;
    const current = readFileSync(path, 'utf-8');
    writeFileSync(path, current.replace(fragment, '').replace(/\n{3,}/g, '\n\n'), 'utf-8');
}
export function clearJournal(config, file) {
    let cleared = 0;
    const targets = file ? [file] : Object.keys(JOURNAL_FILES);
    for (const f of targets) {
        const path = journalPath(config, f);
        if (existsSync(path)) {
            unlinkSync(path);
            cleared++;
        }
    }
    return cleared;
}
//# sourceMappingURL=journal.js.map