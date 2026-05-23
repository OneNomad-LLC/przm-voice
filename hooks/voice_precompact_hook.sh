#!/usr/bin/env bash
# przm Voice pre-compact hook — runs BEFORE context window compression.
# Blocks ONLY when signal-worthy content has accumulated since the last
# consolidation. Otherwise approves silently so PreCompact stays light.

# Claude Code passes { session_id, transcript_path } on stdin.
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

# Threshold: fewer than 5 real user messages since session start — nothing
# behaviorally meaningful to compact. Approve silently. Above 5, block
# so the agent has a chance to record signals + run synthesize.
if [ "$USER_MSG_COUNT" -lt 5 ]; then
  echo '{"decision":"approve"}'
else
  echo '{"decision":"block","reason":"⚠️ Context compaction imminent — behavioral signals will be lost. Walk through this session and call voice_signal SEPARATELY for each observed user reaction (one call per reaction, not batched). If 3+ signals are recorded, run voice_synthesize. Then continue with /compact."}'
fi
