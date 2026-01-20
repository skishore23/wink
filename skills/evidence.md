---
name: evidence
description: Show current evidence state for file editing
---

# Winkclaude Evidence Tracker

Show what files have evidence for editing:

Run these queries to see current state:

```bash
# All evidence entries
sqlite3 .winkclaude/session.db "SELECT file_path, evidence_type, json_extract(detail_json, '$.success') as success FROM evidence ORDER BY timestamp DESC LIMIT 20;"

# Files with successful reads (can be edited)
sqlite3 .winkclaude/session.db "SELECT file_path FROM evidence WHERE evidence_type='file_read' AND json_extract(detail_json, '$.success')=1;"

# Failed navigation attempts
sqlite3 .winkclaude/session.db "SELECT file_path, json_extract(detail_json, '$.error') as error FROM evidence WHERE json_extract(detail_json, '$.success')=0;"
```

Evidence expires after 30 minutes. A file needs evidence before editing in block mode.