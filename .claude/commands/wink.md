---
name: wink
description: Analyze session and suggest specialized agents
argument-hint: "[--apply] [optional context]"
---

# Wink - Auto-Generate Agents from Context

Analyzes session data and suggests specialized agents based on editing patterns.

## Usage

```
/wink                    # Show metrics and suggestions
/wink --apply            # Generate agents with rich content (uses LSP)
/wink "focus on tests"   # Add context to agents
```

## How It Works

1. Run the metrics script to get hot files and patterns
2. If `--apply` is passed, YOU (Claude) generate the agent content using LSP to extract real symbols

Run: bun ${PWD}/dist/commands/wink.js $ARGUMENTS

## When --apply is used

After running the script above, if `--apply` was passed, you MUST generate rich agent content:

For each suggested agent, do the following:

1. **Read the hot files** in that folder using your Read tool
2. **Use LSP** (go-to-definition, find-references) to understand the code structure  
3. **Extract key information**:
   - Exported functions/classes/types with their signatures
   - Key patterns and conventions used
   - Dependencies and relationships between files
4. **Write the agent file** to `.claude/agents/{name}.md` with this structure:

```markdown
---
name: {folder}-expert
description: Expert on {folder}/ - knows exports, patterns, conventions
tools: Read, Grep, Edit, Write
---

# {Folder} Expert Agent

## Key Files Summary (Generated: {date})

### {file1}.{ext}
- Exports: {list of exports with signatures}
- Key patterns: {patterns observed}
- Depends on: {imports}

### {file2}.{ext}
...

## Conventions in {folder}/

- {convention 1}
- {convention 2}

## Common Operations

- To add a new {X}: {steps}
- To modify {Y}: {steps}
```

This makes the agent actually useful - it carries real knowledge, not just metadata.
