#!/bin/bash
# Tmux status bar segment: shows warning when a tmux update is available.
# Caches the result for 1 hour to avoid slow brew calls on every status refresh.
# Colors read from @magus_* tmux options. Empty output when up-to-date.

CACHE_FILE="${TMPDIR:-/tmp}/tmux-update-check.cache"
CACHE_MAX_AGE=3600  # 1 hour

# Read theme colors (with Catppuccin Mocha fallbacks)
FG=$(tmux show-option -gqv @magus_fg 2>/dev/null)
WARN_BG=$(tmux show-option -gqv @magus_warn_bg 2>/dev/null)
FG="${FG:-#1e1e2e}"
WARN_BG="${WARN_BG:-#f9e2af}"

# Check if cache is fresh
if [[ -f "$CACHE_FILE" ]]; then
    cache_age=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
    if (( cache_age < CACHE_MAX_AGE )); then
        cat "$CACHE_FILE"
        exit 0
    fi
fi

# Refresh cache in background (don't block status bar rendering)
(
    if ! command -v brew >/dev/null 2>&1; then echo -n > "$CACHE_FILE"; exit 0; fi

    installed=$(brew list --versions tmux 2>/dev/null | awk '{print $2}')
    latest=$(brew info tmux --json=v2 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['formulae'][0]['versions']['stable'])" 2>/dev/null || true)

    if [[ -n "$installed" && -n "$latest" && "$installed" != "$latest" ]]; then
        echo -n "#[fg=${FG},bg=${WARN_BG}]  tmux $latest #[default]" > "$CACHE_FILE"
    else
        echo -n > "$CACHE_FILE"
    fi
) &>/dev/null &

# On first run (no cache yet), show nothing
if [[ -f "$CACHE_FILE" ]]; then
    cat "$CACHE_FILE"
fi
