#!/usr/bin/env bash
# session-start-stats.sh
# SessionStart hook wrapper for the stats plugin.
# Reads session metadata from stdin, queries last 5 sessions,
# and outputs brief summary as JSON { "context": "..." }.

set -euo pipefail

# Verify plugin root is set
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  exit 0
fi

# Pass stdin to the TypeScript handler
bun "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-stats.ts" 2>/dev/null || true

exit 0
