---
name: wink
description: Analyze session and suggest specialized agents
argument-hint: "[--apply] [optional context]"
---

# Wink - Session Analysis & Agent Generation

Analyzes session data and suggests specialized agents based on editing patterns.

## Usage

```
/wink                    # Show metrics and suggestions
/wink --apply            # Generate agent files (Claude-assisted)
/wink --apply "focus on tests"   # Add context to generated agents
```

Run: bun ${CLAUDE_PLUGIN_ROOT}/dist/commands/wink.js $ARGUMENTS

## When --apply is used

After running the script above, if `--apply` was passed and agents are suggested, generate them:

For each suggested agent:

1. **Read the hot files** listed in the output using your Read tool
2. **Analyze the code** to understand:
   - What functions/classes are exported
   - What patterns are used
   - How files relate to each other
   - What conventions the project follows
3. **Write the agent file** to the destination shown (e.g., `.claude/agents/{name}.md`)

### Agent File Format

```markdown
---
name: {folder}-expert
description: Expert on {folder}/ - knows patterns and conventions
tools: Read, Grep, Edit, Write
---

# {Folder} Expert Agent

Expert on `{folder}/` - [brief description of what this folder contains].

## Architecture Overview

[ASCII diagram or description of how files relate]

## Key Files

### {file1}
- **Exports**: [list main exports with signatures]
- **Purpose**: [what this file does]

### {file2}
...

## Conventions

1. [Convention observed in the code]
2. [Another convention]

## Common Operations

- **To add a new X**: [steps based on existing patterns]
- **To modify Y**: [steps]
```

The agent carries real knowledge extracted from the codebase, making it useful for future work in that folder.
