---
name: setup
description: Initialize Wink for this project
---

# Wink Setup

Initialize Wink in the current project:
- Creates `.winkclaude/` directory
- Initializes SQLite database
- Starts fresh session
- Detects project type and configures verifiers
- Creates config file

Run: bun ${PWD}/dist/commands/setup.js
