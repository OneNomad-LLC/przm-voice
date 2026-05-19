import { detectFlattery, detectWalkBack, detectPositionFlip, detectAgreementCascade, detectSycophancyInAssistant, } from '../sycophancy.js';
/**
 * Smoke test for sycophancy detection. Standalone node script that
 * exits nonzero on the first failure. Mirrors src/tests/smoke.ts.
 *
 * Coverage:
 *   - Each detector fires on a clear positive
 *   - Each detector skips a clear negative
 *   - Evidence markers gate walk-back / position-flip correctly
 *   - Composite detector returns confidence-sorted results
 */
function assert(cond, msg) {
    if (!cond) {
        console.error(`ASSERT FAIL: ${msg}`);
        process.exit(1);
    }
}
let pass = 0;
function ok(name) {
    pass++;
    console.error(`  PASS ${name}`);
}
// ── Flattery ─────────────────────────────────────────────────────────
assert(detectFlattery('Great question! Here is the answer.')?.type === 'sycophancy_flattery', 'flattery: classic opener should fire');
ok('flattery: classic opener');
assert(detectFlattery("You're absolutely right — let me revise.")?.type === 'sycophancy_flattery', 'flattery: youre-absolutely-right should fire');
ok('flattery: youre-absolutely-right');
assert(detectFlattery('The function returns null on empty input.') === null, 'flattery: neutral technical opener should not fire');
ok('flattery: neutral opener does not fire');
// Flattery in the middle of a long answer should NOT fire — head-only check
const longText = 'The migration runs in three phases. ' + 'X. '.repeat(80) + 'Great question, btw.';
assert(detectFlattery(longText) === null, 'flattery: mid-text flattery beyond head window should not fire');
ok('flattery: head-only window respected');
// ── Walk-back ────────────────────────────────────────────────────────
assert(detectWalkBack("You're absolutely right, I was wrong about that.")?.type === 'sycophancy_walk_back', 'walk-back: clear retraction with no evidence should fire');
ok('walk-back: clear retraction');
assert(detectWalkBack("You're absolutely right, I was wrong about that — per the spec at https://example.com/rfc.") === null, 'walk-back: retraction WITH evidence in same turn should NOT fire');
ok('walk-back: evidence in current turn gates');
assert(detectWalkBack("You're absolutely right, I was wrong.", 'Prior claim was X.', 'Look at line 42 of foo.ts — the error is right there.') === null, 'walk-back: user-supplied evidence should suppress walk-back signal');
ok('walk-back: user evidence gates');
assert(detectWalkBack('The answer is 42.') === null, 'walk-back: non-retraction text should not fire');
ok('walk-back: clean answer does not fire');
// ── Position flip ────────────────────────────────────────────────────
const flipFire = detectPositionFlip("You're right, that approach isn't correct — the pattern doesn't work here.", 'That approach is correct, and the pattern works for this use case.', 'No I think you are wrong');
assert(flipFire?.type === 'sycophancy_position_flip', 'position-flip: clear flip without evidence should fire');
ok('position-flip: clear flip');
const flipSuppressedByEvidence = detectPositionFlip("You're right, the pattern doesn't work here.", 'The pattern works for this use case.', 'Actually, see line 88 of pattern.ts — the import is broken so it fails at runtime.');
assert(flipSuppressedByEvidence === null, 'position-flip: user-supplied evidence should suppress flip signal');
ok('position-flip: user evidence gates');
const noSharedAnchor = detectPositionFlip('Cats are graceful animals.', 'Diesel engines produce more torque.', 'No I disagree');
assert(noSharedAnchor === null, 'position-flip: no shared anchor → no signal');
ok('position-flip: no shared topic anchor');
// ── Agreement cascade ────────────────────────────────────────────────
const cascadeFire = detectAgreementCascade([
    'OK that makes sense.',
    "You're right about the database choice.",
    'Agreed, we should ship it.',
    'Yes, that approach works.',
], 4);
assert(cascadeFire?.type === 'sycophancy_agreement_cascade', 'cascade: 4 agreeable turns should fire');
ok('cascade: 4 agreeable turns');
const cascadeBrokenByDisagreement = detectAgreementCascade([
    'OK that makes sense.',
    "I disagree — the database choice is wrong because of write amplification.",
    'Agreed, we should ship it.',
    'Yes, that approach works.',
], 4);
assert(cascadeBrokenByDisagreement === null, 'cascade: disagreement marker breaks the cascade');
ok('cascade: disagreement breaks cascade');
const cascadeTooShort = detectAgreementCascade(['Yes.', 'Sure.'], 4);
assert(cascadeTooShort === null, 'cascade: below threshold → no signal');
ok('cascade: below threshold');
// ── Composite ────────────────────────────────────────────────────────
const composite = detectSycophancyInAssistant({
    currentAssistantText: "You're absolutely right, I was wrong about that. Sorry for the confusion.",
    priorAssistantText: 'That approach is correct and the pattern works.',
    intermediateUserText: 'No it does not',
    recentAssistantTurns: [
        'OK.',
        'Agreed.',
        'You make a good point.',
        "You're absolutely right, I was wrong about that. Sorry for the confusion.",
    ],
});
assert(composite.length >= 2, 'composite: should detect multiple signal types on a heavily sycophantic turn');
ok(`composite: detected ${composite.length} signals`);
assert(composite.every((s, i, arr) => i === 0 || arr[i - 1].confidence >= s.confidence), 'composite: should be sorted by confidence descending');
ok('composite: sorted by confidence');
const cleanTurn = detectSycophancyInAssistant({
    currentAssistantText: 'The migration runs in three phases. Each phase commits a transaction. Total estimated time is 4 minutes.',
});
assert(cleanTurn.length === 0, 'composite: a clean technical answer should produce no signals');
ok('composite: clean turn produces zero signals');
console.error(`\nsycophancy smoke OK (${pass} assertions)`);
//# sourceMappingURL=sycophancy.js.map