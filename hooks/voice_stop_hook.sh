#!/usr/bin/env bash
# przm Voice auto-signal hook — runs on every Stop event.
#
# Two responsibilities:
# 1. (V-012) Run out-of-band sycophancy detection against the latest
#    assistant turn. Self-evaluation by the agent being evaluated is
#    contaminated by construction; running detection here keeps the
#    agent out of the loop. Detected signals are recorded directly
#    into the storage backend (same recordSignal path the MCP server
#    uses) via the `przm-voice-mcp detect-sycophancy` subcommand.
# 2. Every 10 user messages, block to remind the agent about
#    per-reaction signal recording (one voice_signal call per
#    reaction, never batched).

# Claude Code passes { session_id, transcript_path, stop_hook_active }
# on stdin. Buffer the payload once so we can both inspect it and
# forward it.
PAYLOAD=$(cat)

TRANSCRIPT_PATH=$(echo "$PAYLOAD" | node -e "
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => data += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(data).transcript_path || ''); }
    catch { console.log(''); }
  });
" 2>/dev/null)

# Out-of-band sycophancy detection. Fires-and-forgets; we don't block
# on its exit code. Any detected signals are recorded directly to
# storage by the subcommand.
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  przm-voice-mcp detect-sycophancy --transcript "$TRANSCRIPT_PATH" >/dev/null 2>&1 &
fi

# Count real user messages in the transcript (filtering tool-result
# turns out).
USER_MSG_COUNT=$(echo "$PAYLOAD" | node -e "
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => data += c);
  process.stdin.on('end', () => {
    try {
      const { transcript_path } = JSON.parse(data);
      if (!transcript_path) return console.log(0);
      const fs = require('fs');
      if (!fs.existsSync(transcript_path)) return console.log(0);
      const lines = fs.readFileSync(transcript_path, 'utf8').trim().split('\n');
      let n = 0;
      for (const l of lines) {
        try {
          const o = JSON.parse(l);
          if (o.type !== 'user') continue;
          const c = o.message && o.message.content;
          const isToolResult =
            Array.isArray(c) && c.some(p => p && p.type === 'tool_result');
          if (!isToolResult) n++;
        } catch {}
      }
      console.log(n);
    } catch { console.log(0); }
  });
" 2>/dev/null)

USER_MSG_COUNT=${USER_MSG_COUNT:-0}

if [ "$USER_MSG_COUNT" -gt 0 ] && [ $((USER_MSG_COUNT % 10)) -eq 0 ]; then
  echo '{"decision":"block","reason":"🎭 przm Voice checkpoint (every 10 messages). Did you miss recording any user reactions from the last 10 turns? Walk through them one at a time and call voice_signal SEPARATELY for each one — never batch reactions in a single call. The per-reaction granularity is what the signal pipeline depends on. After signals are recorded, if you have 5+ this session, run voice_synthesize."}'
else
  echo '{"decision":"approve"}'
fi
