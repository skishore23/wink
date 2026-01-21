# CLAUDE.md

Project instructions for Claude Code.

## Quick Reference

```bash
bun run build     # Build TypeScript
bun run watch     # Watch mode
bun test          # Run tests
bun run lint      # Lint code
```

## Key Commands

- `/wink` - Session analysis and agent suggestions (all sessions)
- `/verify` - Run all verification checks
- `/status` - Current session state
- `/metrics` - Detailed metrics dashboard
- `/setup` - Generate configuration file
- `/test` - Run project tests

## Architecture

- **src/hooks/** - Claude Code hook implementations (postEdit, postRead, preToolUse, stopGate, etc.)
- **src/core/** - Storage, session tracking, context hygiene, threshold management
- **src/commands/** - Slash command implementations (verify, wink, status, metrics, setup, test)
- **src/skills/** - Skill definitions for /wink, /verify, etc.
- **hooks/hooks.json** - Hook configuration and matchers
- **.claude-plugin/** - Plugin metadata (plugin.json, marketplace.json)
- **.wink/** - Runtime data (config.json, session.db, learnings)

## Hook Flow

1. **SessionStart** - Initializes session tracking in database
2. **UserPromptSubmit** - Shows verification status (✓ verified / ✗ failing)
3. **PreToolUse** - Loop detection, evidence checks, security validation
4. **PostToolUse** - Logs events for metrics (reads, edits, searches)
5. **Stop** - Blocks stopping if unverified edits exist, shows session summary

## When Stop is Blocked

If you see "Stop hook prevented continuation", ALWAYS explain to the user:
1. **Why:** "I was blocked because there are unverified edits"
2. **What:** List the files that need verification
3. **Action:** "Running /verify to check the code"

Then run verification and report results. Never leave the user confused about why stopping was blocked.

## Debug Mode

```bash
export WINK_DEBUG=true
```

Logs to `.wink/debug.log`.

## Full Documentation

See README.md for complete documentation including all hooks, commands, skills, agents, and the learning system.
