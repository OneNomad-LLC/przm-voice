Analyze communication style. $ARGUMENTS

If arguments include "sync":
1. Gather the user's recent messages from the current conversation (at least 5)
2. Call `voice_synthesize` to analyze AND update soul files
3. Show what changed

Otherwise (default, read-only):
1. Gather the user's recent messages (at least 5)
2. Call `voice_analyze` with the messages as a JSON array
3. Present detected traits: message style, formality, technical depth, humor, directness, question style, emoji usage
4. Frame as "here's how your messages read to me" and invite corrections

If fewer than 3 messages are available, ask for more data first.
