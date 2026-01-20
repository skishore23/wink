<div align="center">

<h1>(• ◡ -)  Wink</h1>

**Discipline + Learning for Claude Code**

*Auto-generate agents • Enforce verification • Adapt over time*

</div>

---

## Why Wink?

### Auto-Generate Agents from Usage

The `/wink` command analyzes session data and suggests specialized agents based on how Claude *actually* uses the codebase:

- **Hot folder experts** - Heavily edited directories get dedicated agents  
- **Context keepers** - Files read 5+ times get summarized to prevent re-reads
- **Language specialists** - Project-type-specific agents with build/test/lint commands

Run `/wink --apply` to generate agents with rich, cached content.

### Self-Learning System

Wink is a truly self-learning system that improves over time:

- **Agent Effectiveness Tracking** - Measures before/after metrics when agents are used
- **Error Pattern Learning** - Automatically clusters and learns from error messages
- **Adaptive Thresholds** - Adjusts suggestion thresholds based on measured effectiveness
- **Context-Based Prediction** - Predicts helpful agents based on similar past contexts
- **Continuous Improvement** - Runs a learning cycle on every `/wink` command

Data is stored in `.wink/session.db` (SQLite) with tables for agent usage, error patterns, and thresholds.

### Stop Discipline

Claude cannot stop until checks pass. No more "looks good to me" - show your work.

### Read Before Edit

Files must be read before editing. Prevents blind modifications.

---

## What It Does

- **Enforces verification before stopping** - Claude cannot stop until tests/lint/build pass
- **Auto-generates agents** - Suggests specialized agents from session metrics
- **Detects context loss** - Alerts when the same file is read repeatedly (5+ times)
- **Read-before-edit** - Ensures files are read before being edited
- **Learns and adapts** - Thresholds improve based on what works
- **Logs quality failures** - Captures failing checks to drive quality-focused agents

---

## Installation

### Option 1: Claude Code Plugin

Inside Claude Code:
```
/plugin marketplace add skishore23/wink
/plugin install wink@wink
```

### Option 2: Manual Installation

```bash
# Clone the repo
git clone https://github.com/skishore23/wink.git
cd wink

# Install dependencies (builds automatically via postinstall)
npm install
# Or with bun:
bun install && bun run build
```

Then add to your Claude Code settings (`~/.claude/settings.local.json`):

```json
{
  "hooks": "/path/to/wink/hooks/hooks.json"
}
```

Update `hooks/hooks.json` to use your absolute path, then **restart Claude Code**.

> **Note**: To verify wink is active, look for `○ wink · ✓ verified` in prompt responses.

---

## Hook Flow

All tool usage and quality events are logged to `.wink/session.db` (SQLite). This data powers `/wink` agent suggestions and the self-learning system.

```
User types prompt
       ↓
┌──────────────────────────────────────┐
│  UserPromptSubmit Hook               │
│  Shows: ○ wink · ✓ verified          │
└──────────────────────────────────────┘
       ↓
Claude reads a file
       ↓
┌──────────────────────────────────────┐
│  PostToolUse Hook (Read)             │
│  • Logs to database (enables /wink)  │
│  • Marks file as "seen"              │
│  • Warns on read loops (3+ reads)    │
└──────────────────────────────────────┘
       ↓
Claude edits a file
       ↓
┌──────────────────────────────────────┐
│  PreToolUse Hook (Edit)              │
│  Checks: Was this file read first?   │
│  • If no: Warn or block              │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│  PostToolUse Hook (Edit)             │
│  • Logs to database (enables /wink)  │
│  • Tracks as "unverified"            │
└──────────────────────────────────────┘
       ↓
Claude tries to stop
       ↓
┌──────────────────────────────────────┐
│  Stop Hook                           │
│  Checks: Has verification passed?    │
│  If blocked: Run /verify             │
└──────────────────────────────────────┘
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/wink` | **Analyze session and suggest agents** - Shows hot folders, context loss, and generates agent recommendations |
| `/wink --apply` | Create suggested agents in `.claude/agents/` |
| `/verify` | Run all verification checks (typecheck, lint, test) |
| `/status` | Current session state |
| `/metrics` | Detailed metrics dashboard |
| `/setup` | Generate configuration file |
| `/test` | Run project tests |

### /wink Output

```
  ✦ wink · session analysis

node · 45 edits · 120 reads · 32min

hot folders
  ████████████ core (28)
  ████████ hooks (18)

context loss (files read 5+ times)
  12x storage.ts
  8x config.ts

agents

  available
    ✓ core-expert (28 edits in core/)

  suggested
    + hooks-expert
      18 edits in hooks/, 25 re-reads (storage.ts, utils.ts)

learning

  agents used: 15 (avg effectiveness: 72%)
  ✓ effective: folder-expert, context-keeper

  threshold adjustments
    folder-expert: 20 → 18

  insights
    • Effective agents reduced context loss
```

---

## Configuration

Create `.wink/config.json` (or run `/setup`):

```json
{
  "enabled": true,
  "mode": "warn",
  "stopDiscipline": {
    "enabled": true,
    "requireVerify": true
  },
  "verifiers": {
    "typecheck": "bun run typecheck",
    "lint": "bun run lint",
    "test": "bun test"
  }
}
```

### Modes

| Mode | Behavior |
|------|----------|
| `warn` | Shows warnings but allows operations |
| `block` | Prevents edits without reading first |
| `off` | Disables all checks |

---

## Agent Generation

Wink uses a **hybrid approach** that works across any codebase (Go, Python, Node, Rust, etc.):

### How It Works

1. **Hooks collect metrics** (runs in JS context)
   - Tracks edits, reads, errors per file/folder
   - Language-agnostic counting

2. **Claude generates agents** (runs in Claude's context with LSP)
   - When you run `/wink --apply`, Claude reads hot files
   - Uses LSP to extract exports, types, function signatures
   - Generates agents with actual cached knowledge

### Agent Types

| Agent Type | Trigger | Purpose |
|------------|---------|---------|
| **folder-expert** | 20+ edits in a folder | Cached exports, patterns, conventions for that folder |
| **error-fixer** | 3+ of same error | Specific fix patterns for recurring errors |
| **context-keeper** | 5+ reads of same file | Summarized content to prevent re-reads |
| **lang-specialist** | Project type detected | Language-specific commands and best practices |
| **quality-guard** | Failing verification check | Focus on failing checks and quality hotspots |
| **regression-fixer** | Regression detected | Restore checks that used to pass |

### Rich Agent Content

Unlike simple metadata agents, wink-generated agents contain **actual knowledge**:

```markdown
# Core Expert Agent

## Key Files Summary (Generated: 2024-01-19)

### storage.ts
- Exports: getDb(), logEvent(), getCurrentSessionId(), logAgentSpawn()...
- Pattern: SQLite with WAL mode, singleton database connection
- Depends on: bun:sqlite, path, fs

### config.ts
- Exports: loadConfig(), getVerifiers()
- Pattern: JSON config with defaults fallback

## Conventions in core/

- All DB access through getDb() singleton
- Events logged via logEvent() for consistency
- Thresholds are adaptive, not hardcoded
```

This makes agents useful as **knowledge containers**, not just activity reports.

### Cross-Language Support

Works for any language because:
- Metric collection is language-agnostic (just file paths and counts)
- Claude uses LSP for language-specific symbol extraction
- Project type auto-detected (Go, Python, Node, Rust)

---

## Self-Learning Architecture

Wink's learning system operates across five phases:

### 1. Agent Usage Tracking
When you spawn an agent (Task tool), Wink captures:
- Baseline metrics (read count, error count) before the agent runs
- Outcome metrics after the agent completes
- Effectiveness score (0-1) based on improvement

### 2. Error Pattern Learning
Failed tool outputs are automatically:
- Normalized (paths, line numbers, variable names removed)
- Clustered into patterns by keyword similarity
- Categorized (typescript-type, import-module, syntax, test-failure, lint, build, runtime)

### 3. Adaptive Thresholds
Suggestion thresholds adjust based on agent effectiveness:
- High effectiveness (>60%) → Lower threshold (suggest more)
- Low effectiveness (<30%) → Higher threshold (suggest less)
- Minimum 5 samples required before adjusting

### 4. Context-Based Prediction
Wink predicts helpful agents by:
- Extracting context features (folder activity, file types, error rate, loop rate)
- Finding similar historical contexts where agents were effective
- Voting by similarity-weighted effectiveness

### 5. Learning Report
Every `/wink` run displays:
```
learning

  agents used: 15 (avg effectiveness: 72%)
  ✓ effective: folder-expert, context-keeper

  threshold adjustments
    folder-expert: 20 → 18

  error patterns: 8 learned
    top: typescript-type (12x)

  💡 predicted: core-expert (70%)

  insights
    • Effective agents: folder-expert, context-keeper
    • Threshold folder-expert: 20 → 18 (high effectiveness)
```

---

## Troubleshooting

### Stop keeps getting blocked

Run `/verify` to verify changes, fix any failing checks, then stop.

### Loop warnings

```
! wink · file.ts read 5x - context loss detected
```

You're reading the same file repeatedly. Make the edit or run `/wink --apply` to generate a context-keeper agent that caches the file summary.

---

## Development

```bash
bun run build     # Build TypeScript
bun run watch     # Watch mode
bun test          # Run tests
bun run lint      # Lint code
```

### Debug Mode

```bash
export WINK_DEBUG=true
```

Logs to `.wink/debug.log`.

---

## License

MIT
