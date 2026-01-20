---
name: verify
description: Run all configured verification checks
argument-hint: ""
---

# Winkclaude Verification

Run all configured verification checks including:
- TypeScript compilation (if configured)
- Linting (if configured)  
- Tests (if configured)

This command will auto-detect verifiers from package.json if not already configured.

Run: bun ${CLAUDE_PLUGIN_ROOT}/dist/commands/verify.js