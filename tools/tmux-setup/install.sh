#!/bin/bash
# install.sh — Deploy the full Magus tmux environment.
# Usage:
#   ./install.sh              # Interactive (prompts before overwriting)
#   ./install.sh --yes        # Non-interactive (auto-confirm)
#   ./install.sh --guard-only # Just tmux-guard
#   ./install.sh --hooks-only # Just Claude Code hooks
#   ./install.sh --conf-only  # Just tmux.conf
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTO_YES=false
GUARD_ONLY=false
HOOKS_ONLY=false
CONF_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --yes)        AUTO_YES=true ;;
        --guard-only) GUARD_ONLY=true ;;
        --hooks-only) HOOKS_ONLY=true ;;
        --conf-only)  CONF_ONLY=true ;;
        --help|-h)
            echo "Usage: ./install.sh [--yes] [--guard-only|--hooks-only|--conf-only]"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 1
            ;;
    esac
done

confirm() {
    if [[ "$AUTO_YES" == "true" ]]; then return 0; fi
    read -p "  $1 [y/N] " response
    [[ "$response" =~ ^[Yy]$ ]]
}

ok()   { echo "  [ok] $1"; }
skip() { echo "  [skip] $1"; }
info() { echo ""; echo "==> $1"; }

# Determine which components to install
ALL=false
if [[ "$GUARD_ONLY" == "false" && "$HOOKS_ONLY" == "false" && "$CONF_ONLY" == "false" ]]; then
    ALL=true
fi

# ============================================================
# 1. tmux.conf
# ============================================================
if [[ "$ALL" == "true" || "$CONF_ONLY" == "true" ]]; then
    info "tmux.conf"
    if [[ -f ~/.tmux.conf ]]; then
        if confirm "Back up ~/.tmux.conf to ~/.tmux.conf.backup and replace?"; then
            cp ~/.tmux.conf ~/.tmux.conf.backup
            cp "$SCRIPT_DIR/conf/tmux.conf" ~/.tmux.conf
            ok "Deployed tmux.conf (backup at ~/.tmux.conf.backup)"
        else
            skip "tmux.conf (kept existing)"
        fi
    else
        cp "$SCRIPT_DIR/conf/tmux.conf" ~/.tmux.conf
        ok "Deployed tmux.conf"
    fi
fi

# ============================================================
# 2. TPM (Tmux Plugin Manager)
# ============================================================
if [[ "$ALL" == "true" || "$CONF_ONLY" == "true" ]]; then
    info "TPM (plugin manager)"
    if [[ -d ~/.tmux/plugins/tpm ]]; then
        ok "TPM already installed"
    else
        git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
        ok "Installed TPM"
    fi
fi

# ============================================================
# 3. tmux-guard (kill-server protection)
# ============================================================
if [[ "$ALL" == "true" || "$GUARD_ONLY" == "true" ]]; then
    info "tmux-guard (kill-server protection)"
    mkdir -p ~/bin
    if [[ -e ~/bin/tmux && ! -L ~/bin/tmux ]]; then
        if confirm "~/bin/tmux exists (not a symlink). Replace it?"; then
            mv ~/bin/tmux ~/bin/tmux.old
            ln -sf "$SCRIPT_DIR/bin/tmux-guard" ~/bin/tmux
            ok "Installed tmux-guard (old file saved as ~/bin/tmux.old)"
        else
            skip "tmux-guard (kept existing ~/bin/tmux)"
        fi
    else
        ln -sf "$SCRIPT_DIR/bin/tmux-guard" ~/bin/tmux
        ok "Installed tmux-guard at ~/bin/tmux"
    fi

    # Verify ~/bin is in PATH before the real tmux
    tmux_path=$(which tmux 2>/dev/null || true)
    if [[ "$tmux_path" == "$HOME/bin/tmux" ]]; then
        ok "~/bin/tmux is first in PATH"
    else
        echo "  [warn] ~/bin is not before $(dirname "$(which tmux 2>/dev/null)") in PATH"
        echo "         Add 'export PATH=\"\$HOME/bin:\$PATH\"' to your shell profile"
    fi
fi

# ============================================================
# 4. host-status.sh (status bar script)
# ============================================================
if [[ "$ALL" == "true" || "$CONF_ONLY" == "true" ]]; then
    info "host-status.sh (status bar)"
    mkdir -p ~/.tmux/scripts
    cp "$SCRIPT_DIR/scripts/host-status.sh" ~/.tmux/scripts/host-status.sh
    cp "$SCRIPT_DIR/scripts/tmux-update-status.sh" ~/.tmux/scripts/tmux-update-status.sh
    chmod +x ~/.tmux/scripts/host-status.sh ~/.tmux/scripts/tmux-update-status.sh
    ok "Deployed host-status.sh and tmux-update-status.sh"
fi

# ============================================================
# 5. Claude Code hooks for tmux-claude-continuity
# ============================================================
if [[ "$ALL" == "true" || "$HOOKS_ONLY" == "true" ]]; then
    info "Claude Code hooks (tmux-claude-continuity)"

    SETTINGS_FILE="$HOME/.claude/settings.json"
    CONTINUITY_DIR="$HOME/.tmux/plugins/tmux-claude-continuity/scripts"

    if [[ ! -d "$CONTINUITY_DIR" ]]; then
        echo "  [warn] tmux-claude-continuity not installed yet."
        echo "         Run 'prefix + I' in tmux after setup to install TPM plugins."
        skip "Claude Code hooks (plugin not yet available)"
    elif ! command -v jq >/dev/null 2>&1; then
        echo "  [warn] jq not found. Install with: brew install jq"
        skip "Claude Code hooks (jq required)"
    else
        mkdir -p "$(dirname "$SETTINGS_FILE")"

        if [[ -f "$SETTINGS_FILE" ]]; then
            # Check if hooks already configured
            if jq -e '.hooks.SessionStart' "$SETTINGS_FILE" >/dev/null 2>&1; then
                ok "Claude Code hooks already configured"
            else
                if confirm "Add tmux-claude-continuity hooks to $SETTINGS_FILE?"; then
                    # Merge hooks into existing settings
                    HOOKS_JSON=$(cat <<'HOOKEOF'
{
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ~/.tmux/plugins/tmux-claude-continuity/scripts/on_session_start.sh"
        }
      ]
    }
  ],
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ~/.tmux/plugins/tmux-claude-continuity/scripts/on_stop.sh"
        }
      ]
    }
  ]
}
HOOKEOF
)
                    jq --argjson hooks "$HOOKS_JSON" '.hooks = ($hooks + (.hooks // {}))' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
                    mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
                    ok "Added tmux-claude-continuity hooks"
                else
                    skip "Claude Code hooks"
                fi
            fi
        else
            # Create settings with hooks
            cat > "$SETTINGS_FILE" <<'SETTINGSEOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.tmux/plugins/tmux-claude-continuity/scripts/on_session_start.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.tmux/plugins/tmux-claude-continuity/scripts/on_stop.sh"
          }
        ]
      }
    ]
  }
}
SETTINGSEOF
            ok "Created $SETTINGS_FILE with hooks"
        fi
    fi
fi

# ============================================================
# 6. rpaster (clipboard image pasting over SSH)
# ============================================================
if [[ "$ALL" == "true" ]]; then
    info "rpaster (clipboard image over SSH)"
    if command -v rpaster >/dev/null 2>&1; then
        ok "rpaster already installed ($(rpaster --version 2>&1 || echo 'unknown version'))"
    elif command -v brew >/dev/null 2>&1; then
        if confirm "Install rpaster via Homebrew?"; then
            brew tap MadAppGang/tap 2>/dev/null || true
            brew install rpaster
            brew services start rpaster
            ok "Installed and started rpaster"
        else
            skip "rpaster"
        fi
    else
        echo "  [info] rpaster requires Homebrew on macOS."
        echo "         See: https://github.com/MadAppGang/tmux-copy-image"
        skip "rpaster (no Homebrew)"
    fi
fi

# ============================================================
# 7. Pin tmux in Homebrew (prevent accidental upgrades)
# ============================================================
if [[ "$ALL" == "true" || "$GUARD_ONLY" == "true" ]]; then
    info "Homebrew tmux pin (prevent upgrade from restarting server)"
    if command -v brew >/dev/null 2>&1; then
        if brew list --pinned 2>/dev/null | grep -q '^tmux$'; then
            ok "tmux already pinned"
        else
            brew pin tmux 2>/dev/null && ok "Pinned tmux (brew upgrade will skip it)" \
                || skip "tmux not installed via Homebrew"
        fi
    else
        skip "Homebrew not available"
    fi
fi

# ============================================================
# 8. Install TPM plugins
# ============================================================
if [[ "$ALL" == "true" || "$CONF_ONLY" == "true" ]]; then
    info "TPM plugin install"
    if [[ -x ~/.tmux/plugins/tpm/bin/install_plugins ]]; then
        if confirm "Run TPM install to fetch all plugins?"; then
            ~/.tmux/plugins/tpm/bin/install_plugins
            ok "TPM plugins installed"
        else
            skip "TPM install (run 'prefix + I' in tmux later)"
        fi
    else
        echo "  [info] Start tmux and press 'prefix + I' to install plugins"
    fi
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "============================================"
echo "  Magus tmux setup complete"
echo "============================================"
echo ""
echo "  Next steps:"
echo "  1. Start tmux (or 'tmux source ~/.tmux.conf' if already running)"
echo "  2. Press 'prefix + I' to install TPM plugins"
echo "  3. Verify: tmux kill-server should be blocked"
echo ""
