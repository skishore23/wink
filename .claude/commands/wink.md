---
name: wink
description: Analyze session and suggest specialized agents
argument-hint: "[optional context]"
---

# Wink - Auto-Generate Agents from Context

Analyzes your session data and suggests specialized agents based on:
- Hot folders (most edited areas)
- Common error patterns
- Frequently read files
- Project type

## Usage

```
/wink                    # Analyze and suggest agents
/wink "focus on tests"   # Add context to generated agents
```

## What It Does

1. **Analyzes** session data from the database
2. **Identifies** patterns (folders, errors, loops)
3. **Suggests** specialized agents
4. **Previews** agent content before generation

## Apply Agents

After reviewing the preview, run with `--apply` to generate:

```bash
bun dist/commands/wink.js --apply
```

This creates agent files in `.claude/agents/` that Claude Code can use.

Run: bun ${PWD}/dist/commands/wink.js $ARGUMENTS
