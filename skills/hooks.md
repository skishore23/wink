---
name: hooks
description: Show winkclaude hook system architecture
---

# Winkclaude Hooks Architecture

Display information about the hook system:

## Hook Types
- **UserPromptSubmit**: Injects context at start of prompts
- **PreToolUse**: Runs before tools (evidence gate for edits)
- **PostToolUse**: Runs after tools (logs events, tracks evidence)
- **Stop/SubagentStop**: Gates stopping until verification passes

## Key Files
- hooks/hooks.json - Hook definitions
- src/hooks/preToolUse.ts - Evidence gate
- src/hooks/postToolUse.ts - Event logging
- src/hooks/stopGate.ts - Stop discipline
- src/core/storage.ts - SQLite database

## Debugging
1. Check hook config: cat hooks/hooks.json
2. Test a hook manually: echo '{"tool_name":"Read","tool_input":{"file_path":"test.txt"},"tool_response":"content"}' | bun dist/hooks/postToolUse.js
3. View recent events: sqlite3 .winkclaude/session.db "SELECT tool, success FROM events ORDER BY timestamp DESC LIMIT 10;"