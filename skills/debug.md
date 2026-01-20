---
name: debug
description: Show debug info and recent hook activity
---

# Winkclaude Debug Info

Show debug information for troubleshooting:

1. Check if debug logs exist:
   - ls -la .winkclaude/*.log 2>/dev/null || echo "No debug logs"

2. Show recent debug output:
   - tail -30 .winkclaude/debug.log 2>/dev/null || echo "Debug log empty"

3. Show database stats:
   - sqlite3 .winkclaude/session.db "SELECT COUNT(*) as events FROM events; SELECT COUNT(*) as evidence FROM evidence;"

4. Check hooks configuration:
   - cat hooks/hooks.json | head -50

To enable verbose debug logging, set: export WINKCLAUDE_DEBUG=true