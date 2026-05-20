# przm Voice Auto-Signal Hooks

Claude Code hooks that mechanically enforce behavioral signal recording. Without these, Claude forgets to call `voice_signal` when focused on tasks.

## What they do

### `voice_stop_hook.sh` (Stop event)
Fires after every assistant turn. Every 10 user messages, **blocks** Claude from continuing until it records:
- User behavioral signals via `voice_signal`
- Runs `voice_synthesize` if enough signals accumulated

### `voice_precompact_hook.sh` (PreCompact event)
Fires before context window compression. **Always blocks.** Forces Claude to capture all observed behavioral signals before context is lost.

## Installation

Add to your Claude Code settings (global `~/.claude/settings.json` or per-project `.claude/settings.local.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "bash /path/to/przm-voice/hooks/voice_stop_hook.sh"
      }
    ],
    "PreCompact": [
      {
        "command": "bash /path/to/przm-voice/hooks/voice_precompact_hook.sh"
      }
    ]
  }
}
```

Replace `/path/to/przm-voice/hooks/` with the absolute path to wherever you cloned this repo, or with the `node_modules/@onenomad/przm-voice/hooks/` path if you installed via npm.

## Renamed from persona

These hooks shipped as `persona_*.sh` under the prior `persona` / `persona-mcp` branding. If your `settings.json` still points at `persona_precompact_hook.sh` / `persona_stop_hook.sh`, update the paths or symlink to keep them working.
