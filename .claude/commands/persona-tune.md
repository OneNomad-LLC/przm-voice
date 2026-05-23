Quick personality adjustment: $ARGUMENTS

1. Parse the instruction for what to change
2. Record appropriate signals via `voice_signal`:
   - "be more direct" / "get to the point" -> signal type `simplification`
   - "more detail" / "explain more" -> signal type `elaboration`
   - "be more opinionated" / "tell me what you think" -> signal type `explicit_feedback`
   - "less formal" / "keep it casual" -> signal type `style_correction`
   - "stop doing X" / "don't X" -> signal type `correction`
   - "I like when you X" / "keep doing X" -> signal type `praise`
3. Apply the change immediately by calling `voice_context` (with `adaptationsOnly: true`) to get updated adaptations
4. If the instruction is clear enough, offer to write it into the appropriate soul file via `voice_edit` for permanent effect
5. Confirm what changed

This is the quick-feedback path. For bigger changes, point to `/persona-soul edit` or `/persona-evolve`.
