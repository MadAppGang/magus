#!/bin/sh
# Output hostname with color based on SSH session.
# Colors read from @magus_* tmux options (set in tmux.conf).
# Fallbacks: Purple = local, Red = SSH.

FG=$(tmux show-option -gqv @magus_fg 2>/dev/null)
LOCAL_BG=$(tmux show-option -gqv @magus_host_local_bg 2>/dev/null)
SSH_BG=$(tmux show-option -gqv @magus_host_ssh_bg 2>/dev/null)

FG="${FG:-#1e1e2e}"
LOCAL_BG="${LOCAL_BG:-#cba6f7}"
SSH_BG="${SSH_BG:-#e64553}"

if tmux show-environment SSH_CONNECTION 2>/dev/null | grep -q '^SSH'; then
  BG="$SSH_BG"
else
  BG="$LOCAL_BG"
fi
echo "#[fg=${FG},bg=${BG}] 󰒋 #H #[default]"
