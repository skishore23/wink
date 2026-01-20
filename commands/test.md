---
name: test
description: Run project tests
---

# Run Tests

Run the configured test command for this project.

Configurable in `.winkclaude/config.json`:
```json
{
  "verifiers": {
    "test": "go test ./..."
  }
}
```

Run: bun ${CLAUDE_PLUGIN_ROOT}/dist/commands/test.js
