Reset personality or load a preset. $ARGUMENTS

If no arguments: reset to defaults.
1. Warn that this resets all three soul files to blank-slate defaults
2. Signals and profile are NOT deleted, only soul files
3. If confirmed, call `voice_init` to regenerate defaults

If a preset name is given, apply the preset by calling `voice_soul_preset_apply`:

**Bundled presets:**
- `default` - Balanced, thoughtful baseline. Good starting point.
- `coach` - Motivating, goal-oriented, action-focused. Encourages progress.
- `mentor` - Patient, thorough, educational. Explains reasoning. Asks questions to check understanding.
- `devils-advocate` - Challenges assumptions, surfaces blind spots, stress-tests ideas.
- `reflective-listener` - Empathetic, non-directive, mirrors and validates before advising.
- `creative-partner` - Casual, exploratory, idea-generating. Riffs on concepts. Encourages wild ideas.
- `dungeon-master` - Narrative-focused, world-building, collaborative storytelling.
- `personal-assistant` - Practical, efficient, task-oriented. Gets things done.
- `study-buddy` - Curious, collaborative learning. Breaks concepts down, checks understanding.
