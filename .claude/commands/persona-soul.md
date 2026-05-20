View or edit soul files. $ARGUMENTS

Files: `personality`, `style`, `skill`

If no arguments: call `voice_read` for each file (personality, style, skill). Present them clearly with headers.

If a file name is given: call `voice_read` for that file.

If a file name + "edit" is given:
1. Call `voice_read` to show current content
2. Ask what they want to change
3. Help draft the new content
4. Call `voice_edit` with the updated content
5. Confirm the change

If the user isn't sure what to write, offer to run `/persona-analyze` first to detect their style, then suggest content based on that.
