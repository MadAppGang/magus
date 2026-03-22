#!/bin/bash
# Check if a newer tmux version is available in Homebrew.
# Designed to run from tmux status bar or as a periodic check.
# Output: empty if up-to-date, warning string if update available.
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then exit 0; fi

installed=$(brew list --versions tmux 2>/dev/null | awk '{print $2}')
latest=$(brew info tmux --json=v2 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['formulae'][0]['versions']['stable'])" 2>/dev/null || true)

if [[ -z "$installed" || -z "$latest" ]]; then exit 0; fi

if [[ "$installed" != "$latest" ]]; then
    echo "tmux $latest available (pinned at $installed)"
fi
