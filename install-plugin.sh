#!/bin/bash

# Wink Plugin Installation Script

set -e

PLUGIN_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_PLUGINS_DIR="$HOME/.claude/plugins"
PLUGIN_NAME="wink"
TARGET_DIR="$CLAUDE_PLUGINS_DIR/$PLUGIN_NAME"
MARKETPLACES_FILE="$CLAUDE_PLUGINS_DIR/known_marketplaces.json"

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Bun is required. Install: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Install and build
cd "$PLUGIN_DIR"
bun install
bun run build

# Create symlink
mkdir -p "$CLAUDE_PLUGINS_DIR"
[ -e "$TARGET_DIR" ] && rm -rf "$TARGET_DIR"
ln -s "$PLUGIN_DIR" "$TARGET_DIR"

echo "Installed: $TARGET_DIR"
echo ""
echo "Note: Local plugins work via hooks but don't show in /plugin Installed tab."
echo "      That tab is for marketplace plugins only."
echo ""
echo "To verify wink is active:"
echo "  1. Restart Claude Code"
echo "  2. Look for 'wink · verified' in prompt responses"
echo ""
echo "Restart Claude Code to activate."