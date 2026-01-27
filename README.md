<div align="center">

<h1>(• ◡ -)  Wink</h1>

**Discipline & Insights for Claude Code**

*Enforces quality • Tracks context • Suggests improvements*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

</div>

---

## What is Wink?

Wink is a **discipline plugin** for Claude Code that:

1. **Enforces** verification - blocks stopping until checks pass
2. **Tracks** context - monitors reads, edits, and patterns
3. **Reports** insights - shows session metrics for you to analyze
4. **Suggests** agents - based on hot folders and error patterns

Wink collects data and Claude reasons about it. You approve changes.

---

## Key Features

| Feature | What It Does |
|---------|--------------|
| **Intent Guardian** | Silently captures task intent, verifies completion before stopping |
| **Smart Verification** | Skips irrelevant checks (e.g., no tests for docs-only changes) |
| **Stop Discipline** | Blocks stopping until verification passes |
| **Baseline Awareness** | Distinguishes pre-existing failures from regressions |
| **Context Hygiene** | Monitors wasted reads, loops, and session efficiency |
| **Agent Suggestions** | Suggests specialized agents based on metrics |

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

### 3. Test Verification

```
/verify
```

This runs your configured checks. If verifiers weren't auto-detected, edit `.wink/config.json`:
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

```
.wink/
```

### 5. Confirm It's Working

Look for this in your prompt responses:
```
○ wink · ✓ verified
```

---

## The /wink Command

Run `/wink` to see session analysis:

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

agents
  suggested
    + core-expert
      28 edits in core/, 15 re-reads

current thresholds
  folder-expert: 20
  error-fixer: 3
  context-keeper: 5

Based on this data, what improvements would you suggest?
```

Run `/wink --apply` to have Claude generate the suggested agents. Claude reads your actual code and creates comprehensive documentation - no hardcoded templates.

---

## How It Works

### Discipline-First Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Hooks collect data (reads, edits, errors)                 │
│        ↓                                                    │
│   /wink shows raw metrics                                   │
│        ↓                                                    │
│   Claude analyzes and suggests improvements                 │
│        ↓                                                    │
│   User approves, Claude applies                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### What Wink Tracks

| Metric | Purpose |
|--------|---------|
| **Hot Folders** | Directories with 20+ edits → agent candidates |
| **Read Loops** | Files read 3+ times → context-keeper suggestions |
| **Error Patterns** | Logged by category for analysis |
| **Context Hygiene** | Wasted reads, dead files, search efficiency |
| **Verification** | Pass/fail history |

---

## Agent Types

Wink suggests six types of specialized agents:

| Agent | Trigger | Purpose |
|-------|---------|---------|
| **folder-expert** | 20+ edits | Expert on specific folder patterns |
| **context-keeper** | 5+ reads | Cache file summaries to prevent re-reads |
| **error-fixer** | 3+ errors | Focus on recurring error patterns |
| **lang-specialist** | Project detected | Language expert (commands from config) |
| **quality-guard** | Failing checks | Fix quality hotspots |
| **regression-fixer** | Regressions | Restore checks that used to pass |

### How Agents Are Generated

When you run `/wink --apply`, Claude automatically generates agents:

```
/wink --apply
    ↓
┌──────────────────────────────────────┐
│  1. Wink analyzes session metrics    │
│     - Hot folders (most edited)      │
│     - Context loss (re-read files)   │
│     - Quality hotspots (failures)    │
│     - Error patterns                 │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│  2. Suggests agents based on         │
│     configurable thresholds          │
│     (20 edits, 5 reads, 3 errors)    │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│  3. Claude reads the actual files    │
│     in hot folders                   │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│  4. Claude generates rich content:   │
│     - Function signatures            │
│     - Code patterns                  │
│     - Conventions discovered         │
│     - Common operations              │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│  5. Writes to .claude/agents/        │
│     e.g., core-expert.md             │
└──────────────────────────────────────┘
```

**No hardcoded templates** - Claude reads your actual code and generates documentation specific to your project. Each agent carries real knowledge about your codebase.

---

## Intent Guardian

Wink silently captures your task intent and verifies Claude completes it:

```
User: "Refactor auth to use JWT, add rate limiting, update docs"
       ↓
[Intent captured silently - user sees nothing]
       ↓
Claude works...
       ↓
Claude tries to stop
       ↓
[Stop hook injects intent check]
       ↓
Claude: "Checking against your request:
  ✓ JWT refactor - auth.ts modified
  ✓ Rate limiting - rateLimit.ts created
  ✗ Documentation - no docs/ touched

  Should I continue with docs?"
```

**Zero friction. Fully automatic. Claude self-verifies.**

---

## Smart Verification

Wink skips irrelevant checks based on what changed:

| Changed Files | Checks Run |
|--------------|------------|
| Only `.md` files | All checks skipped |
| Only config files | Lint only |
| Code files | All checks run |

Verification also tracks **baseline** state:
- First `/verify` captures which checks pass/fail
- Subsequent runs distinguish **regressions** from **pre-existing failures**
- Stop is only blocked for regressions, not pre-existing issues

```
✅ typecheck (1.0s)
❌ test (0.5s) [pre-existing]     ← Was failing before you started
⏭️  build skipped (only docs changed)

⚠️  Pre-existing failures (not blocking)
```

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
│  • Regressions → Block       │
│  • Pre-existing fails → Warn │
│  • All passing → Allow       │
└──────────────────────────────┘
       ↓
┌──────────────────────────────┐
│  Intent Guardian check       │
│  • Task incomplete → Block   │
│  • Task complete → Allow     │
└──────────────────────────────┘
```

---

## Context Hygiene

Wink monitors context quality:

| Metric | What It Measures |
|--------|-----------------|
| **Efficiency Score** | 0-100 composite of focus, loops, search effectiveness |
| **Wasted Reads** | Files read but never edited |
| **Dead Files** | Files created but never imported |
| **Search Funnels** | % of searches that led to edits |
| **Focus Ratio** | Files edited / files read |

---

## Commands

| Command | Description |
|---------|-------------|
| `/wink` | Session analysis and agent suggestions |
| `/wink --apply` | Generate suggested agents |
| `/verify` | Run all verification checks |
| `/status` | Current session state |
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

  "intentGuardian": {
    "enabled": true
  },

  "verifiers": {
    "typecheck": "bun run typecheck",
    "lint": "bun run lint",
    "test": "bun test"
  },

  "loopBlocking": {
    "enabled": true,
    "readThreshold": 3,
    "searchThreshold": 2
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
| `intentGuardian.enabled` | `true` | Verify task completion before stopping |
| `stopDiscipline.onlyAfterEdits` | `true` | Skip verification for analysis-only sessions |
| `loopBlocking.readThreshold` | `3` | Block after N reads of same file |
| `agentThresholds.folderExpert` | `20` | Edits needed to suggest folder expert |

---

## Cross-Language Support

Wink works with any language:

- **Go** - Detects `go.mod`, uses `go build`, `go test`
- **Node/TypeScript** - Detects `package.json`, uses npm/bun scripts
- **Rust** - Detects `Cargo.toml`, uses `cargo build`, `cargo test`
- **Python** - Detects `requirements.txt`/`pyproject.toml`, uses `pytest`

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
bun test          # Run tests
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

- Session events (reads, edits, searches)
- Verification results and baselines
- Intent tracking
- Error instances
- Daily metrics

Schema migrations run automatically on upgrade.

---

## License

MIT
