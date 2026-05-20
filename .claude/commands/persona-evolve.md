Review personality evolution proposals. $ARGUMENTS

If arguments include "generate": call `voice_evolve` to force proposal generation from current signals. Show the new proposals.

If arguments include "history": call `voice_proposals` with status "all". Show applied and rejected proposals grouped by status.

Otherwise (default): review pending proposals.
1. Call `voice_proposals` with status "pending"
2. If no pending proposals, suggest running `/persona-evolve generate`
3. If proposals exist, present each one:
   - What it wants to change (which soul file, what content)
   - Why (rationale and evidence)
   - Confidence score
4. For each proposal, ask: apply, reject, or skip?
5. Apply with `voice_apply`, reject with `voice_reject`
6. After all proposals, summarize what changed

This is a collaborative process. Present proposals as suggestions, not demands. The user has full control.
