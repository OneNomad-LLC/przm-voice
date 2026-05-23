#!/usr/bin/env bash
# przm Voice auto-signal hook — runs on every Stop event.
# Blocks every 10 human messages to remind about one-signal-per-reaction
# recording. The per-reaction discipline matters: signals batched at
# end-of-turn lose the precision the system depends on.

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
  echo '{"decision":"block","reason":"🎭 przm Voice checkpoint (every 10 messages). Did you miss recording any user reactions from the last 10 turns? Walk through them one at a time and call voice_signal SEPARATELY for each one — never batch reactions in a single call. The per-reaction granularity is what the signal pipeline depends on. After signals are recorded, if you have 5+ this session, run voice_synthesize."}'
else
  echo '{"decision":"approve"}'
fi
