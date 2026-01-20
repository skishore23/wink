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

- **src/hooks/** - Claude Code hook implementations
- **src/core/** - Storage, session tracking, loop detection
- **src/commands/** - Slash command implementations
- **.claude/** - Commands, skills, agents definitions
- **.wink/** - Runtime data (config, database, learnings)

## Hook Flow

1. **UserPromptSubmit** - Injects session context at prompt start
2. **PreToolUse** - Checks evidence before edits
3. **PostToolUse** - Logs events, runs verification after edits
4. **Stop** - Blocks stopping if unverified edits exist

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
