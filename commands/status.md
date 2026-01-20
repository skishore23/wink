---
name: status
description: Show current winkclaude session state
argument-hint: ""
---

Show the current session status including:
- Mode (off/warn/block)
- Evidence collected (files read, searched)
- Recent events

Run: bun ${CLAUDE_PLUGIN_ROOT}/dist/commands/status.js