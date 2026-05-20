#!/usr/bin/env bash
# przm Voice auto-signal hook — runs on every Stop event.
# Blocks every 10 human messages to force behavioral signal recording.
# Ensures behavioral data is captured for personality evolution.

# Claude Code passes { session_id, transcript_path, stop_hook_active }.
# The transcript is a JSONL file at transcript_path — not inline — so we
# read and parse the file. Tool-result turns are also stored as
# type:'user' with role:'user'; we filter them out to count real user
# prompts only.
USER_MSG_COUNT=$(node -e "
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
  echo '{"decision":"block","reason":"🎭 przm Voice checkpoint (every 10 messages). Before continuing:\n1. voice_signal: Record any user reactions from the last few exchanges (correction, approval, frustration, elaboration, simplification, praise, explicit_feedback, code_accepted, code_rejected, style_correction)\n2. If 5+ signals recorded this session, run voice_synthesize to update the profile\n\nDo this NOW, then continue."}'
else
  echo '{"decision":"approve"}'
fi
