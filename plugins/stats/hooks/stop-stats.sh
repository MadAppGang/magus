#!/usr/bin/env bash
# stop-stats.sh
# Stop hook wrapper for the stats plugin.
# Reads session metadata from stdin, invokes the TypeScript aggregator.
# Has a 30-second budget from hooks.json.

set -euo pipefail

# Verify plugin root is set
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  exit 0
fi

# Pass stdin to the TypeScript aggregator
bun "${CLAUDE_PLUGIN_ROOT}/hooks/stop-stats.ts" 2>/dev/null || true

exit 0
