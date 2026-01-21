<div align="center">

<h1>(• ◡ -)  Wink</h1>

**Self-Improving Discipline for Claude Code**

*Learns from your sessions • Auto-generates agents • Enforces quality • Adapts over time*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

</div>

---

## What is Wink?

Wink is a **self-learning plugin** for Claude Code that:

1. **Observes** Claude's behavior - tracking every edit, read, error, and pattern
2. **Learns** what works - measuring agent effectiveness and clustering errors
3. **Adapts** automatically - adjusting thresholds and generating specialized agents
4. **Enforces** quality - requiring verification before Claude stops

Unlike static tools, Wink **gets smarter over time** by learning from actual coding sessions.

---

## Key Features

| Feature | What It Does |
|---------|--------------|
| **Auto-Generate Agents** | Analyzes hot folders and creates specialized expert agents |
| **Self-Learning** | Tracks what works and adjusts thresholds automatically |
| **Context Hygiene** | Monitors wasted reads, dead files, and session efficiency |
| **Stop Discipline** | Blocks stopping until verification passes |
| **Error Learning** | Clusters errors and suggests fixes based on patterns |
| **Agent Prediction** | Predicts helpful agents based on similar past contexts |

---

## Quick Start

### 1. Install

**Option A: Claude Code Plugin** (Recommended)
```
/plugin marketplace add skishore23/wink
/plugin install wink@wink
```

**Option B: Manual**
```bash
git clone https://github.com/skishore23/wink.git
cd wink && bun install && bun run build
```

Add to `~/.claude/settings.local.json`:
```json
{
  "hooks": "/path/to/wink/hooks/hooks.json"
}
```

### 2. Run Setup

```
/setup
```

This will:
- Create `.wink/` directory and database
- **Auto-detect your project type** (Node, Go, Rust, Python)
- **Auto-detect verification commands** from `package.json` scripts
- Show what was configured

Example output:
```
🔧 Wink Setup

✅ Created .wink/ directory
✅ Created session.db database
✅ Started new session: abc123...

📦 Detected project type: node

🔍 Verifiers:
  Typecheck: bun run typecheck
  Lint: bun run lint
  Test: bun test

✅ Setup complete!
```

### 3. Test Verification

```
/verify
```

This runs your configured checks. Lint is auto-scoped to edited files. For tests, Claude will intelligently decide whether to run the full suite or target specific tests based on what you changed.

If verifiers weren't auto-detected, edit `.wink/config.json`:
```json
{
  "verifiers": {
    "typecheck": "npm run typecheck",
    "lint": "npm run lint",
    "test": "npm test"
  }
}
```

### 4. Add to .gitignore

Add to your project's `.gitignore`:
```
.wink/
```

The `.wink/` directory contains local session data that shouldn't be committed.

### 5. Confirm It's Working

Look for this in your prompt responses:
```
○ wink · ✓ verified
```

Now Wink is tracking your session and enforcing verification!

---

## The /wink Command

Run `/wink` to see session analysis and agent suggestions:

```
  ✦ wink · session analysis

node · 45 edits · 120 reads · 32min

hot folders
  ████████████ core (28)
  ████████ hooks (18)

context loss (files read 5+ times)
  12x storage.ts
  8x config.ts

context hygiene
  ███████████████ efficiency: 73/100
  focus: 0.38 (120 read → 45 edited)
  • 3 files read 3+ times
  • 8 files read but never edited
  search → edit: 4/5 (80%)

agents
  available
    ✓ core-expert (28 edits in core/)

  suggested
    + hooks-expert
      18 edits in hooks/, 25 re-reads

learning
  agents used: 15 (avg effectiveness: 72%)
  ✓ effective: folder-expert, context-keeper

  threshold adjustments
    folder-expert: 20 → 18

  insights
    • Effective agents reduced context loss
```

Run `/wink --apply` to generate the suggested agents.

---

## How It Works

### The Self-Improvement Loop

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Session Activity                                          │
│        ↓                                                    │
│   Context Hygiene Analysis  →  Efficiency Score (0-100)     │
│        ↓                              ↓                     │
│   Agent Suggestions    ←────   Threshold Adjustment         │
│        ↓                              ↓                     │
│   Agents Created       ←────   Learning Cycle               │
│        ↓                                                    │
│   [Next Session - Wink is smarter]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### What Wink Tracks

| Metric | Purpose |
|--------|---------|
| **Hot Folders** | Directories with 20+ edits become agent candidates |
| **Read Loops** | Files read 3+ times trigger context-keeper suggestions |
| **Error Patterns** | Recurring errors get clustered and tracked |
| **Agent Effectiveness** | Before/after metrics measure if agents help |
| **Context Hygiene** | Wasted reads, dead files, search efficiency |

### Automatic Adaptations

- **High agent effectiveness (>60%)** → Lower thresholds, suggest more agents
- **Low agent effectiveness (<30%)** → Raise thresholds, suggest fewer
- **Poor session efficiency (<40)** → Auto-lower thresholds by 20%
- **Error patterns detected** → Suggest error-fixer agents

---

## Agent Types

Wink generates six types of specialized agents:

| Agent | Trigger | What It Knows |
|-------|---------|---------------|
| **folder-expert** | 20+ edits in folder | Exports, patterns, conventions for that folder |
| **context-keeper** | 5+ reads of file | Cached file summary to prevent re-reads |
| **error-fixer** | 3+ same error | Fix patterns for recurring errors |
| **lang-specialist** | Project detected | Build/test/lint commands for your stack |
| **quality-guard** | Failing checks | Focus on quality hotspots |
| **regression-fixer** | Regressions | Restore checks that used to pass |

### Rich Agent Content

Unlike simple agents, Wink agents contain **actual knowledge**:

```markdown
# Core Expert Agent

## Key Files Summary

### storage.ts
- Exports: getDb(), logEvent(), getCurrentSessionId()
- Pattern: SQLite with WAL mode, singleton connection
- Depends on: bun:sqlite, path, fs

### config.ts
- Exports: loadConfig(), getVerifiers()
- Pattern: JSON config with defaults fallback

## Conventions
- All DB access through getDb() singleton
- Events logged via logEvent() for consistency
```

---

## Context Hygiene

Wink monitors context quality to reduce waste:

| Metric | What It Measures |
|--------|-----------------|
| **Efficiency Score** | 0-100 composite of focus, loops, search effectiveness |
| **Wasted Reads** | Files read but never edited |
| **Dead Files** | Files created but never imported |
| **Search Funnels** | % of searches that led to edits |
| **Focus Ratio** | Files edited / files read |

When efficiency drops below 40, Wink automatically:
- Lowers agent suggestion thresholds
- Shows hygiene warnings in prompts
- Suggests context-keeper agents more aggressively

---

## Stop Discipline

Wink enforces verification before stopping:

```
Claude tries to stop
       ↓
┌──────────────────────────────┐
│  Were any edits made?        │
│  • No → Allow stop           │
│  • Yes → Check verification  │
└──────────────────────────────┘
       ↓
┌──────────────────────────────┐
│  Has /verify passed?         │
│  • No → Block with message   │
│  • Yes → Allow stop          │
└──────────────────────────────┘
```

**Key behaviors:**
- Pure analysis sessions (no edits) can stop freely
- Edits require verification before stopping
- Unverified edits show which files need checking

---

## Commands

| Command | Description |
|---------|-------------|
| `/wink` | Session analysis and agent suggestions |
| `/wink --apply` | Generate suggested agents |
| `/verify` | Run all verification checks |
| `/status` | Current session state |
| `/metrics` | Detailed metrics dashboard |
| `/setup` | Generate configuration file |
| `/test` | Run project tests |

---

## Configuration

Create `.wink/config.json` or run `/setup`:

```json
{
  "enabled": true,
  "mode": "warn",

  "stopDiscipline": {
    "enabled": true,
    "requireVerify": true,
    "onlyAfterEdits": true
  },

  "verifiers": {
    "typecheck": "bun run typecheck",
    "lint": "bun run lint",
    "test": "bun test"
  },

  "contextHygiene": {
    "enabled": true,
    "warnOnWastedReads": 5,
    "warnOnLowEfficiency": 40,
    "autoAdjustThresholds": true
  },

  "agentThresholds": {
    "folderExpert": 20,
    "errorFixer": 3,
    "contextKeeper": 5
  }
}
```

### Key Options

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `warn` | `warn`, `block`, or `off` |
| `stopDiscipline.onlyAfterEdits` | `true` | Skip verification for analysis-only sessions |
| `features.fileSpecificChecks` | `true` | Scope lint to edited files only |
| `contextHygiene.autoAdjustThresholds` | `true` | Auto-tune thresholds based on efficiency |
| `agentThresholds.folderExpert` | `20` | Edits needed to suggest folder expert |

---

## Cross-Language Support

Wink works with any language:

- **Go** - Detects `go.mod`, uses `go build`, `go test`
- **Node/TypeScript** - Detects `package.json`, uses npm/bun scripts
- **Rust** - Detects `Cargo.toml`, uses `cargo build`, `cargo test`
- **Python** - Detects `requirements.txt`/`pyproject.toml`, uses `pytest`

Metric collection is language-agnostic (file paths and counts). Configure verifiers in `.wink/config.json` for any stack.

---

## Troubleshooting

### Stop keeps getting blocked

Run `/verify` to check your changes, fix any failing checks, then stop.

### Loop warnings appearing

```
! wink · file.ts read 5x - context loss detected
```

You're reading the same file repeatedly. Either:
1. Make the edit you need
2. Run `/wink --apply` to generate a context-keeper agent

### Want to stop during analysis

Set `stopDiscipline.onlyAfterEdits: true` (default) to allow stopping when no edits were made.

---

## Development

```bash
bun run build     # Build TypeScript
bun run watch     # Watch mode
bun test          # Run tests (95 tests)
bun run lint      # Lint code
```

### Debug Mode

```bash
export WINK_DEBUG=true
```

Logs to `.wink/debug.log`.

---

## Data Storage

All data is stored locally in `.wink/session.db` (SQLite):

- Session events (reads, edits, errors)
- Agent usage and effectiveness
- Error patterns and clusters
- Threshold configurations
- Learning history

---

## License

MIT
