---
name: reset
description: Reset winkclaude session and evidence data
---

# Reset Winkclaude Session

Clear all session data and start fresh:

1. Delete the session database: rm -f .winkclaude/session.db
2. Clear debug logs: rm -f .winkclaude/debug.log .winkclaude/hook-debug.log
3. Confirm reset complete

This will clear all evidence tracking and event history. The database will be recreated on next Claude operation.