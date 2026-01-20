# Wink

**A Claude Code plugin that enforces discipline and auto-generates specialized agents from Claude's usage patterns.**

---

## Why Wink?

### Auto-Generate Agents from Usage

The `/wink` command analyzes your session data and suggests specialized agents based on how claude *actually* uses the codebase:

- **Hot folder experts** - Heavily edited directories get dedicated agents
- **Error fixers** - Recurring error patterns generate fix-focused agents
- **Context keepers** - Files read 5+ times get cached to prevent context loss
- **Language specialists** - Project-type-specific agents with build/test/lint commands

Run `/wink --apply` to create these agents automatically.

### Self-Learning System

Wink is a truly self-learning system that improves over time:

- **Agent Effectiveness Tracking** - Measures before/after metrics when agents are used
- **Error Pattern Learning** - Automatically clusters and learns from error messages
- **Adaptive Thresholds** - Adjusts suggestion thresholds based on measured effectiveness
- **Context-Based Prediction** - Predicts helpful agents based on similar past contexts
- **Continuous Improvement** - Runs a learning cycle on every `/wink` command

Data is stored in `.wink/session.db` (SQLite) with tables for agent usage, error patterns, and thresholds.

### Stop Discipline

Claude cannot stop until verification passes. No more "looks good to me" without evidence.

### Evidence-Based Editing

Files must be read before editing. Prevents blind modifications.

---

## What It Does

- **Enforces verification before stopping** - Claude cannot stop until tests/lint/build pass
- **Auto-generates agents** - Suggests specialized agents from session metrics
- **Detects context loss** - Alerts when the same file is read repeatedly (5+ times)
- **Tracks evidence** - Ensures files are read before being edited
- **Learns and adapts** - Thresholds improve based on what works
- **Logs quality failures** - Captures failing checks to drive quality-focused agents

---

## Installation

### Option 1: Claude Code Plugin (Recommended)

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
│  • Marks file as "seen" (evidence)   │
│  • Detects read loops (3+ times)     │
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
wink · session analysis

node · 45 edits · 120 reads · 32min

hot folders
  ████████████ src/core (28)
  ████████ src/hooks (18)

context loss (files read 5+ times)
  12x storage.ts
  8x config.ts

agents

  available
    ✓ core-expert (28 edits in core/)

  suggested
    + hooks-expert
      18 edits in hooks/, 25 re-reads (storage.ts, utils.ts)

learnings
  ✓ effective: core-expert
  • core-expert agent reduced context loss
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

Wink suggests four types of agents based on session metrics:

| Agent Type | Trigger | Purpose |
|------------|---------|---------|
| **folder-expert** | 20+ edits in a folder | Deep knowledge of folder patterns and conventions |
| **error-fixer** | 3+ of same error | Quick fixes for recurring error patterns |
| **context-keeper** | 4+ reads of same file | Cache frequently accessed file contents |
| **lang-specialist** | Project type detected | Language-specific commands and best practices |
| **quality-guard** | Any failing verification check | Focus on failing checks and quality hotspots |
| **regression-fixer** | Regression detected in checks | Restore checks that used to pass |

Agents are written to `.claude/agents/` and can be invoked by Claude Code.

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
  ✗ ineffective: error-fixer

  threshold adjustments
    folder-expert: 20 → 18

  error patterns: 8 learned
    top: typescript-type (12x)

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
! wink · read 'file.ts' 5x - consider making edits
```

You're reading the same file repeatedly. Make the edit or use `/wink` to generate a context-keeper agent.

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
