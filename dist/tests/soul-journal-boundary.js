import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter, setStorage } from '../storage/index.js';
import { loadConfig } from '../config.js';
import { writeSoulFile, readSoulFile } from '../soul.js';
import { readJournalFile } from '../journal.js';
import { updateSoulFromSynthesis } from '../synthesis.js';
import { applySoulPreset } from '../soul-presets.js';
/**
 * Regression test: soul/journal write boundary.
 *
 * V-003 fix: voice_synthesize and voice_soul_preset_apply must NOT write
 * to soul files. Synthesized content and preset content go to the journal
 * layer instead. Soul files are user territory — only voice_edit and
 * voice_init are the explicit user-driven write paths.
 *
 * Asserts:
 *   1. Soul file is unchanged after updateSoulFromSynthesis fires.
 *   2. Journal received synthesized content after updateSoulFromSynthesis.
 *   3. Soul file is unchanged after applySoulPreset.
 *   4. Journal received preset content after applySoulPreset.
 */
function assert(cond, msg) {
    if (!cond) {
        console.error(`ASSERT FAIL: ${msg}`);
        process.exit(1);
    }
}
// A varied set of messages that gives the synthesis engine enough signal
// to produce non-empty personality, style, and skill output (thresholds:
// personality ≥ 5 messages, style ≥ 3, skill ≥ 5).
const SAMPLE_MESSAGES = [
    "Fix the bug in the auth middleware — it's rejecting valid JWTs",
    'The migration ran fine but rollback is broken',
    "Just give me the SQL, I'll handle the explanation",
    'This is wrong. The index needs to be composite, not single-column',
    'Show me the query plan before we go further',
    'Ok that works. Ship it.',
    "Don't add abstractions I didn't ask for",
    'How does the retry logic interact with the connection pool?',
    'Looks good — PR is up',
    'The approach is backwards. Start from the schema, not the ORM',
];
async function run() {
    const dir = mkdtempSync(join(tmpdir(), 'persona-boundary-'));
    process.env.PERSONA_DATA_DIR = dir;
    console.error(`soul-journal-boundary: PERSONA_DATA_DIR=${dir}`);
    try {
        const adapter = new FileStorageAdapter({ dataDir: dir });
        setStorage(adapter);
        const config = loadConfig();
        // Plant a known sentinel in the soul file. If synthesis writes to soul,
        // this sentinel will be overwritten — the test will catch that.
        const SOUL_SENTINEL = '# Personality\n\n## sentinel — hand-edited content\nDo not overwrite me.\n';
        writeSoulFile(config, 'personality', SOUL_SENTINEL);
        // ── Test 1: updateSoulFromSynthesis must not touch soul ────────────
        const result = updateSoulFromSynthesis(config, SAMPLE_MESSAGES);
        const personalityAfterSynth = readSoulFile(config, 'personality');
        assert(personalityAfterSynth === SOUL_SENTINEL, `soul/personality was modified by updateSoulFromSynthesis!\n` +
            `  expected sentinel, got: ${JSON.stringify(personalityAfterSynth.slice(0, 200))}`);
        console.error('  [PASS] soul/personality unchanged after synthesis');
        const styleAfterSynth = readSoulFile(config, 'style');
        // Style soul file starts empty (we didn't write to it). If synthesis
        // wrote to soul, it would be non-empty.
        assert(styleAfterSynth === '' || !styleAfterSynth.includes('Communication Style\n\n## Length'), `soul/style was written by synthesis — boundary violated!\n` +
            `  got: ${JSON.stringify(styleAfterSynth.slice(0, 200))}`);
        console.error('  [PASS] soul/style unchanged after synthesis');
        // ── Test 2: journal must contain synthesized content ──────────────
        // Only check journal if synthesis actually produced changes; if messages
        // are below threshold the journal will be empty.
        if (result.updated) {
            const journalPersonality = readJournalFile(config, 'personality');
            assert(journalPersonality.length > 0, 'journal/personality is empty but synthesis reported updates');
            assert(journalPersonality.includes('<!-- synthesis:'), `journal/personality missing synthesis marker:\n  got: ${JSON.stringify(journalPersonality.slice(0, 200))}`);
            console.error(`  [PASS] journal/personality received synthesis content (${journalPersonality.length} chars)`);
            if (result.changes.some(c => c.includes('style'))) {
                const journalStyle = readJournalFile(config, 'style');
                assert(journalStyle.length > 0, 'journal/style is empty but synthesis reported style changes');
                assert(journalStyle.includes('<!-- synthesis:'), `journal/style missing synthesis marker:\n  got: ${JSON.stringify(journalStyle.slice(0, 200))}`);
                console.error(`  [PASS] journal/style received synthesis content (${journalStyle.length} chars)`);
            }
        }
        else {
            console.error('  [SKIP] synthesis returned updated=false — journal checks skipped');
        }
        // ── Test 3 & 4: applySoulPreset must not touch soul ───────────────
        // Reset soul sentinel to ensure a clean slate for preset test.
        writeSoulFile(config, 'personality', SOUL_SENTINEL);
        const presetResult = applySoulPreset(config, 'default');
        if (!presetResult.applied) {
            console.error('  [SKIP] "default" preset not found — skipping preset boundary test');
        }
        else {
            const personalityAfterPreset = readSoulFile(config, 'personality');
            assert(personalityAfterPreset === SOUL_SENTINEL, `soul/personality was modified by applySoulPreset!\n` +
                `  expected sentinel, got: ${JSON.stringify(personalityAfterPreset.slice(0, 200))}`);
            console.error('  [PASS] soul/personality unchanged after applySoulPreset');
            const journalAfterPreset = readJournalFile(config, 'personality');
            assert(journalAfterPreset.includes('<!-- preset:default:'), `journal/personality missing preset marker after applySoulPreset:\n` +
                `  got: ${JSON.stringify(journalAfterPreset.slice(0, 300))}`);
            console.error('  [PASS] journal/personality received preset content');
        }
        console.error('soul-journal-boundary OK');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
run().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=soul-journal-boundary.js.map