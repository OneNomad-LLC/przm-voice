#!/usr/bin/env bash
# przm Voice pre-compact hook — runs BEFORE context window compression.
# ALWAYS blocks to ensure behavioral signals are recorded before context is lost.

echo '{"decision":"block","reason":"⚠️ CONTEXT COMPACTION IMMINENT — behavioral signals will be lost.\n\nBefore compaction, you MUST:\n1. voice_signal: Record ALL observed user reactions from this session (corrections, approvals, frustrations, style preferences)\n2. voice_synthesize: Run synthesis if 3+ signals were recorded to update the personality profile\n3. Also save memories to przm Memory (memory-ingest, memory-diary-write) if not done recently\n\nThis is NOT optional. Capture all behavioral data now."}'
