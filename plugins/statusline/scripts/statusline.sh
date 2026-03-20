#!/bin/bash
# Claude Code Status Line — colorful worktree-aware status with plan limits & reset countdowns
# Receives JSON session data via stdin
# Part of statusline plugin (MadAppGang/magus)

input=$(cat)

# ── Debug: capture raw JSON for test fixtures ─────────────
# Set STATUSLINE_DEBUG=1 to save each render's input JSON
if [ "${STATUSLINE_DEBUG:-0}" = "1" ]; then
  DEBUG_DIR="$HOME/.claude/.statusline-debug"
  mkdir -p "$DEBUG_DIR"
  printf '%s\n' "$input" > "${DEBUG_DIR}/$(date +%s).json"
fi

# ── Config file (optional) ───────────────────────────────
CONFIG_FILE="$HOME/.claude/statusline-config.json"

SHOW_MODEL=true
SHOW_BRANCH=true
SHOW_WORKTREE=true
SHOW_COST=true
SHOW_DURATION=true
SHOW_CONTEXT_BAR=true
SHOW_PLAN_LIMITS=true
SHOW_DIFF=true
SHOW_VIM=true
SHOW_AGENT=true
SHOW_SESSION_NAME=true
CTX_BAR_WIDTH=12
PLAN_BAR_WIDTH=10
THEME="default"

if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
  eval "$(jq -r '
    def d(v; fallback): if v == null then fallback else v end;
    "SHOW_MODEL=\(d(.sections.model; true))",
    "SHOW_BRANCH=\(d(.sections.branch; true))",
    "SHOW_WORKTREE=\(d(.sections.worktree; true))",
    "SHOW_COST=\(d(.sections.cost; true))",
    "SHOW_DURATION=\(d(.sections.duration; true))",
    "SHOW_CONTEXT_BAR=\(d(.sections.context_bar; true))",
    "SHOW_PLAN_LIMITS=\(d(.sections.plan_limits; true))",
    "SHOW_DIFF=\(d(.sections.diff; true))",
    "SHOW_VIM=\(d(.sections.vim; true))",
    "SHOW_AGENT=\(d(.sections.agent; true))",
    "SHOW_SESSION_NAME=\(d(.sections.session_name; true))",
    "CTX_BAR_WIDTH=\(d(.context_bar_width; 12))",
    "PLAN_BAR_WIDTH=\(d(.plan_bar_width; 10))",
    "THEME=\(d(.theme; "default"))"
  ' "$CONFIG_FILE" 2>/dev/null)"
fi

# ── Theme colors ─────────────────────────────────────────
apply_theme() {
  B='\033[1m'
  D='\033[2m'
  R='\033[0m'

  case "$THEME" in
    monochrome)
      C_CYAN='\033[97m'
      C_GREEN='\033[37m'
      C_YELLOW='\033[37m'
      C_RED='\033[97m'
      C_MAGENTA='\033[37m'
      C_WHITE='\033[97m'
      C_GRAY='\033[90m'
      C_ORANGE='\033[97m'
      ;;
    minimal)
      C_CYAN='\033[36m'
      C_GREEN='\033[32m'
      C_YELLOW='\033[33m'
      C_RED='\033[31m'
      C_MAGENTA='\033[35m'
      C_WHITE='\033[37m'
      C_GRAY='\033[90m'
      C_ORANGE='\033[33m'
      ;;
    neon)
      C_CYAN='\033[38;5;51m'
      C_GREEN='\033[38;5;46m'
      C_YELLOW='\033[38;5;226m'
      C_RED='\033[38;5;196m'
      C_MAGENTA='\033[38;5;201m'
      C_WHITE='\033[38;5;231m'
      C_GRAY='\033[38;5;240m'
      C_ORANGE='\033[38;5;208m'
      ;;
    *)  # default — warm/cool palette
      C_CYAN='\033[96m'
      C_GREEN='\033[92m'
      C_YELLOW='\033[93m'
      C_RED='\033[91m'
      C_MAGENTA='\033[95m'
      C_WHITE='\033[97m'
      C_GRAY='\033[90m'
      C_ORANGE='\033[38;5;208m'
      ;;
  esac
}
apply_theme

# ── Helpers ───────────────────────────────────────────────
color_for_pct() {
  local p=$1
  if [ "$p" -lt 40 ]; then   printf '%s' "$C_GREEN"
  elif [ "$p" -lt 70 ]; then printf '%s' "$C_YELLOW"
  elif [ "$p" -lt 90 ]; then printf '%s' "$C_ORANGE"
  else                       printf '%s' "$C_RED"
  fi
}

plan_color_for_pct() {
  local p=$1
  if [ "$p" -lt 50 ]; then   printf '%s' '\033[36m'       # teal
  elif [ "$p" -lt 75 ]; then printf '%s' '\033[34m'       # blue
  elif [ "$p" -lt 90 ]; then printf '%s' '\033[38;5;172m' # orange
  else                       printf '%s' '\033[31m'       # red
  fi
}

repeat_char() {
  local n=$1 ch=$2
  [ "$n" -le 0 ] && return
  printf "%${n}s" | tr ' ' "$ch"
}

# Convert ISO 8601 timestamp to human-friendly countdown
countdown() {
  local reset_ts="$1"
  [ -z "$reset_ts" ] && return

  # Strip fractional seconds and timezone suffix for parsing
  local clean="${reset_ts%%.*}"
  clean="${clean%%Z}"
  clean="${clean%%+*}"

  # macOS date -jf; fall back to GNU date -d
  # API returns UTC timestamps — parse in UTC to avoid local timezone offset
  local reset_epoch
  reset_epoch=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%S" "$clean" +%s 2>/dev/null)
  if [ -z "$reset_epoch" ]; then
    reset_epoch=$(date -d "$reset_ts" +%s 2>/dev/null)
  fi
  [ -z "$reset_epoch" ] && return

  local now diff h m
  now=$(date +%s)
  diff=$((reset_epoch - now))
  [ "$diff" -le 0 ] && { printf "now"; return; }

  h=$((diff / 3600))
  m=$(((diff % 3600) / 60))

  if [ "$h" -ge 24 ]; then
    printf "%dd%dh" $((h / 24)) $((h % 24))
  elif [ "$h" -gt 0 ]; then
    printf "%dh%dm" "$h" "$m"
  else
    printf "%dm" "$m"
  fi
}

# Format token count as human-readable (e.g., 184320 → 184k)
fmt_tokens() {
  local t=$1
  [ -z "$t" ] || [ "$t" = "null" ] || [ "$t" -eq 0 ] 2>/dev/null && return
  local k=$((t / 1000))
  printf "%dk" "$k"
}

# ── Extract session data (single jq call) ─────────────────
eval "$(printf '%s' "$input" | jq -r '
  def s(v): if v == null then "" else (v | tostring) end;
  def n(v): if v == null then "0" else (v | tostring) end;
  def b(v): if v == true then "true" else "false" end;
  "MODEL=\(s(.model.display_name) | @sh)",
  "MODEL_ID=\(s(.model.id) | @sh)",
  "COST=\(n(.cost.total_cost_usd))",
  "PCT=\(n(.context_window.used_percentage) | split(".")[0])",
  "CWD=\(s(.cwd) | @sh)",
  "DURATION_MS=\(n(.cost.total_duration_ms))",
  "CTX_MAX_TOKENS=\(n(.context_window.context_window_size))",
  "CURRENT_USAGE=\(n(.context_window.current_usage))",
  "TOTAL_INPUT_TOKENS=\(n(.context_window.total_input_tokens))",
  "SESSION_ID=\(s(.session_id) | @sh)",
  "FIVE_HR=\(s(.rate_limits.five_hour.used_percentage) | @sh)",
  "SEVEN_DAY=\(s(.rate_limits.seven_day.used_percentage) | @sh)",
  "FIVE_HR_RESET=\(s(.rate_limits.five_hour.resets_at) | @sh)",
  "SEVEN_DAY_RESET=\(s(.rate_limits.seven_day.resets_at) | @sh)",
  "WORKTREE_NAME_NATIVE=\(s(.worktree.name) | @sh)",
  "WORKTREE_BRANCH_NATIVE=\(s(.worktree.branch) | @sh)",
  "EXCEEDS_200K=\(b(.exceeds_200k_tokens))",
  "AGENT_NAME=\(s(.agent.name) | @sh)",
  "SESSION_NAME=\(s(.session_name) | @sh)",
  "LINES_ADDED=\(n(.cost.total_lines_added))",
  "LINES_REMOVED=\(n(.cost.total_lines_removed))",
  "VIM_MODE=\(s(.vim.mode) | @sh)"
' 2>/dev/null)"

# ── Shorten model name (with provider detection) ─────────
MODEL_PREFIX=""
case "$MODEL_ID" in
  */*)
    # OpenRouter / external provider: extract provider and model
    PROVIDER="${MODEL_ID%%/*}"
    MODEL_SLUG="${MODEL_ID#*/}"
    # Some IDs have nested slashes (e.g., x-ai/grok-3-mini)
    # Use the last segment as model name
    MODEL_NAME="${MODEL_SLUG##*/}"

    # Map provider to short prefix
    case "$PROVIDER" in
      x-ai|xai)       MODEL_PREFIX="xai" ;;
      google)          MODEL_PREFIX="ggl" ;;
      openai)          MODEL_PREFIX="oai" ;;
      meta-llama|meta) MODEL_PREFIX="meta" ;;
      deepseek)        MODEL_PREFIX="ds" ;;
      mistralai)       MODEL_PREFIX="mist" ;;
      minimax)         MODEL_PREFIX="mmax" ;;
      moonshot)        MODEL_PREFIX="kimi" ;;
      zhipu)           MODEL_PREFIX="glm" ;;
      amazon)          MODEL_PREFIX="amz" ;;
      cohere)          MODEL_PREFIX="co" ;;
      qwen)            MODEL_PREFIX="qwen" ;;
      *)               MODEL_PREFIX="$PROVIDER" ;;
    esac

    # Clean up model name: strip provider prefix, version suffixes
    MODEL_SHORT="$MODEL_NAME"
    ;;
  claude-opus*|*opus*)       MODEL_SHORT="Opus" ;;
  claude-sonnet*|*sonnet*)   MODEL_SHORT="Sonnet" ;;
  claude-haiku*|*haiku*)     MODEL_SHORT="Haiku" ;;
  *)
    # Fallback to display_name shortening
    case "$MODEL" in
      *"Opus"*)    MODEL_SHORT="Opus" ;;
      *"Sonnet"*)  MODEL_SHORT="Sonnet" ;;
      *"Haiku"*)   MODEL_SHORT="Haiku" ;;
      *)           MODEL_SHORT="$MODEL" ;;
    esac
    ;;
esac

# ── Format cost ───────────────────────────────────────────
COST_FMT=$(printf '%.2f' "${COST:-0}")

# ── Format duration (two most significant units) ─────────
TOTAL_SECS=$(( ${DURATION_MS:-0} / 1000 ))
DAYS=$((TOTAL_SECS / 86400))
HOURS=$(((TOTAL_SECS % 86400) / 3600))
MINS=$(((TOTAL_SECS % 3600) / 60))
SECS=$((TOTAL_SECS % 60))
if [ "$DAYS" -gt 0 ]; then
  DURATION="${DAYS}d${HOURS}h"
elif [ "$HOURS" -gt 0 ]; then
  DURATION="${HOURS}h${MINS}m"
elif [ "$MINS" -gt 0 ]; then
  DURATION="${MINS}m${SECS}s"
else
  DURATION="${SECS}s"
fi

# ── Git branch + worktree detection ──────────────────────
BRANCH=""
WORKTREE_NAME=""

# Use native worktree fields from stdin first
if [ -n "$WORKTREE_NAME_NATIVE" ]; then
  WORKTREE_NAME="$WORKTREE_NAME_NATIVE"
  [ -n "$WORKTREE_BRANCH_NATIVE" ] && BRANCH="$WORKTREE_BRANCH_NATIVE"
fi

# Fall back to git detection if native fields are empty
if [ -z "$WORKTREE_NAME" ] && [ -n "$CWD" ] && cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  [ -z "$BRANCH" ] && BRANCH=$(git branch --show-current 2>/dev/null)
  [ -z "$BRANCH" ] && BRANCH=$(git rev-parse --short HEAD 2>/dev/null)

  GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
  GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
  GIT_DIR=$(cd "$GIT_DIR" 2>/dev/null && pwd)
  GIT_COMMON=$(cd "$GIT_COMMON" 2>/dev/null && pwd)

  if [ "$GIT_DIR" != "$GIT_COMMON" ]; then
    WORKTREE_NAME=$(basename "$CWD")
  fi
elif [ -z "$BRANCH" ] && [ -n "$CWD" ] && cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git branch --show-current 2>/dev/null)
  [ -z "$BRANCH" ] && BRANCH=$(git rev-parse --short HEAD 2>/dev/null)
fi

# ── Compaction count detection ────────────────────────────
COMPACTION_COUNT=0
if [ -n "$SESSION_ID" ] && [ "${TOTAL_INPUT_TOKENS:-0}" -gt 0 ] 2>/dev/null; then
  TOKEN_CACHE="$HOME/.claude/.statusline-token-cache-${SESSION_ID}"
  # Format: "prev_tokens compaction_count"
  CACHE_LINE=$(cat "$TOKEN_CACHE" 2>/dev/null || echo "0 0")
  PREV_TOKENS=$(printf '%s' "$CACHE_LINE" | awk '{print $1}')
  COMPACTION_COUNT=$(printf '%s' "$CACHE_LINE" | awk '{print $2}')
  COMPACTION_COUNT=${COMPACTION_COUNT:-0}

  if [ "${PREV_TOKENS:-0}" -gt 0 ] && [ "$TOTAL_INPUT_TOKENS" -lt "$PREV_TOKENS" ] 2>/dev/null; then
    COMPACTION_COUNT=$((COMPACTION_COUNT + 1))
  fi
  printf '%s %s\n' "$TOTAL_INPUT_TOKENS" "$COMPACTION_COUNT" > "$TOKEN_CACHE"
fi

# ── Plan usage fallback (API poll when native fields absent) ──
if [ -z "$FIVE_HR" ] && [ -z "$SEVEN_DAY" ]; then
  USAGE_CACHE="$HOME/.claude/.statusline-usage-cache.json"
  CACHE_TTL=60
  NEED_REFRESH=0
  if [ ! -f "$USAGE_CACHE" ]; then
    NEED_REFRESH=1
  else
    CACHE_MTIME=$(stat -f %m "$USAGE_CACHE" 2>/dev/null || stat -c %Y "$USAGE_CACHE" 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    [ $((NOW_TS - CACHE_MTIME)) -gt "$CACHE_TTL" ] && NEED_REFRESH=1
  fi

  if [ "$NEED_REFRESH" -eq 1 ]; then
    (
      TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
      if [ -z "$TOKEN" ]; then
        TOKEN=$(cat "$HOME/.claude/.credentials" 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
      fi
      if [ -n "$TOKEN" ]; then
        curl -s --max-time 3 \
          -H "Accept: application/json" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -H "anthropic-beta: oauth-2025-04-20" \
          "https://api.anthropic.com/api/oauth/usage" > "${USAGE_CACHE}.tmp" 2>/dev/null \
        && mv "${USAGE_CACHE}.tmp" "$USAGE_CACHE"
      fi
    ) &
  fi

  if [ -f "$USAGE_CACHE" ]; then
    FIVE_HR=$(jq -r '.five_hour.utilization // empty' "$USAGE_CACHE" 2>/dev/null | cut -d. -f1)
    SEVEN_DAY=$(jq -r '.seven_day.utilization // empty' "$USAGE_CACHE" 2>/dev/null | cut -d. -f1)
    FIVE_HR_RESET=$(jq -r '.five_hour.resets_at // empty' "$USAGE_CACHE" 2>/dev/null)
    SEVEN_DAY_RESET=$(jq -r '.seven_day.resets_at // empty' "$USAGE_CACHE" 2>/dev/null)
  fi
fi

# ── Compute reset countdowns ────────────────────────────
FIVE_HR_CD=""
SEVEN_DAY_CD=""
if [ -n "$FIVE_HR_RESET" ]; then
  FIVE_HR_CD=$(countdown "$FIVE_HR_RESET")
fi
if [ -n "$SEVEN_DAY_RESET" ]; then
  SEVEN_DAY_CD=$(countdown "$SEVEN_DAY_RESET")
fi

# ── Separator ─────────────────────────────────────────────
SEP="${C_GRAY}|${R}"

# ── Build output (section-gated with smart separators) ────
OUT=""
NEED_SEP=0

append_section() {
  if [ "$NEED_SEP" -eq 1 ]; then
    OUT="${OUT} ${SEP} "
  fi
  OUT="${OUT}$1"
  NEED_SEP=1
}

# ── 1. Model name (+ session name if present) ─────────────
if [ "$SHOW_MODEL" = "true" ]; then
  if [ -n "$MODEL_PREFIX" ]; then
    MODEL_SECTION="${C_MAGENTA}${MODEL_PREFIX}${C_GRAY}@${R}${B}${C_CYAN}${MODEL_SHORT}${R}"
  else
    MODEL_SECTION="${B}${C_CYAN}* ${MODEL_SHORT}${R}"
  fi
  if [ "$SHOW_SESSION_NAME" = "true" ] && [ -n "$SESSION_NAME" ]; then
    MODEL_SECTION="${MODEL_SECTION} ${C_GRAY}${D}${SESSION_NAME}${R}"
  fi
  append_section "$MODEL_SECTION"
fi

# ── 2. Agent indicator (if in subagent) ───────────────────
if [ "$SHOW_AGENT" = "true" ] && [ -n "$AGENT_NAME" ]; then
  append_section "${C_CYAN}→${AGENT_NAME}${R}"
fi

# ── 3. Git branch ─────────────────────────────────────────
if [ "$SHOW_BRANCH" = "true" ] && [ -n "$BRANCH" ]; then
  append_section "${C_GREEN}${BRANCH}${R}"
fi

# ── 4. Worktree name ──────────────────────────────────────
if [ "$SHOW_WORKTREE" = "true" ] && [ -n "$WORKTREE_NAME" ]; then
  append_section "${B}${C_ORANGE}wt:${WORKTREE_NAME}${R}"
fi

# ── 5. Vim mode (if active) ───────────────────────────────
if [ "$SHOW_VIM" = "true" ] && [ -n "$VIM_MODE" ]; then
  case "$VIM_MODE" in
    INSERT)  VIM_CH="I"; VIM_BG='\033[42m' ;;   # green bg
    NORMAL)  VIM_CH="N"; VIM_BG='\033[44m' ;;   # blue bg
    VISUAL)  VIM_CH="V"; VIM_BG='\033[45m' ;;   # magenta bg
    REPLACE) VIM_CH="R"; VIM_BG='\033[41m' ;;   # red bg
    *)       VIM_CH="${VIM_MODE:0:1}"; VIM_BG='\033[100m' ;; # gray bg
  esac
  append_section "${VIM_BG}${B}\033[97m ${VIM_CH} ${R}"
fi

# ── 6. Cost (adaptive) ────────────────────────────────────
if [ "$SHOW_COST" = "true" ]; then
  COST_NUM=$(printf '%.2f' "${COST:-0}" 2>/dev/null)
  # Compare with integer arithmetic: $2.00 threshold → 200 cents
  COST_CENTS=$(printf '%.0f' "$(printf '%s' "${COST:-0}" | awk '{printf "%.0f", $1 * 100}')" 2>/dev/null)
  COST_CENTS=${COST_CENTS:-0}

  if [ "$COST_CENTS" -gt 200 ] 2>/dev/null; then
    # Full form: show cost with optional velocity indicator
    # Velocity: compare cost with last render using cache
    VELOCITY=""
    if [ -n "$SESSION_ID" ]; then
      COST_CACHE="$HOME/.claude/.statusline-cost-cache-${SESSION_ID}"
      PREV_DATA=$(cat "$COST_CACHE" 2>/dev/null || echo "0 0")
      PREV_COST=$(printf '%s' "$PREV_DATA" | awk '{print $1}')
      PREV_TIME=$(printf '%s' "$PREV_DATA" | awk '{print $2}')
      NOW_TS=$(date +%s)
      printf '%s %s\n' "$COST_CENTS" "$NOW_TS" > "$COST_CACHE"

      if [ "${PREV_COST:-0}" -gt 0 ] && [ "${PREV_TIME:-0}" -gt 0 ] 2>/dev/null; then
        ELAPSED=$((NOW_TS - PREV_TIME))
        if [ "$ELAPSED" -gt 0 ] && [ "$COST_CENTS" -gt "$PREV_COST" ] 2>/dev/null; then
          DELTA=$((COST_CENTS - PREV_COST))
          # Rate in cents-per-minute
          RATE=$(( (DELTA * 60) / ELAPSED ))
          if [ "$RATE" -gt 0 ] 2>/dev/null; then
            VELOCITY=" ${C_YELLOW}↑${R}"
          fi
        fi
      fi
    fi
    append_section "${C_YELLOW}\$${COST_FMT}${R}${VELOCITY}"
  else
    # Short form
    append_section "${C_YELLOW}\$${COST_FMT}${R}"
  fi
fi

# ── 7. Duration ───────────────────────────────────────────
if [ "$SHOW_DURATION" = "true" ]; then
  append_section "${C_MAGENTA}${DURATION}${R}"
fi

# ── 8. Diff stats ─────────────────────────────────────────
if [ "$SHOW_DIFF" = "true" ] && { [ "${LINES_ADDED:-0}" -gt 0 ] || [ "${LINES_REMOVED:-0}" -gt 0 ]; } 2>/dev/null; then
  DIFF_SECTION="${C_GREEN}+${LINES_ADDED}${R}${C_GRAY}/${R}${C_RED}-${LINES_REMOVED}${R}"
  append_section "$DIFF_SECTION"
fi

# ── 9. Context bar (adaptive) ─────────────────────────────
if [ "$SHOW_CONTEXT_BAR" = "true" ]; then
  BAR_COLOR=$(color_for_pct "$PCT")
  CTX_USED_TOKENS="${CURRENT_USAGE:-0}"
  CTX_USED_FMT=$(fmt_tokens "$CTX_USED_TOKENS")
  CTX_MAX_FMT=$(fmt_tokens "$CTX_MAX_TOKENS")

  # Compaction indicator with count
  COMPACT_IND=""
  if [ "${COMPACTION_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    COMPACT_IND=" ${C_MAGENTA}${B}⟳×${COMPACTION_COUNT}${R}"
  fi

  # 200k+ indicator
  EXCEEDS_IND=""
  if [ "$EXCEEDS_200K" = "true" ]; then
    EXCEEDS_IND=" ${C_RED}${B}200k+${R}"
  fi

  if [ "${PCT:-0}" -gt 50 ] 2>/dev/null; then
    # Full form: bar + tokens + warnings
    BAR_WIDTH=$CTX_BAR_WIDTH
    CTX_F=$((PCT * BAR_WIDTH / 100))
    [ "$CTX_F" -gt "$BAR_WIDTH" ] && CTX_F=$BAR_WIDTH
    CTX_E=$((BAR_WIDTH - CTX_F))

    CTX_SECTION="${BAR_COLOR}$(repeat_char "$CTX_F" '█')${C_GRAY}$(repeat_char "$CTX_E" '░')${R} ${BAR_COLOR}${PCT}%%${R}"

    if [ -n "$CTX_USED_FMT" ] && [ -n "$CTX_MAX_FMT" ]; then
      CTX_SECTION="${CTX_SECTION} ${C_GRAY}${D}${CTX_USED_FMT}/${CTX_MAX_FMT}${R}"
    fi

    CTX_SECTION="${CTX_SECTION}${COMPACT_IND}"

    if [ "${PCT:-0}" -ge 80 ] 2>/dev/null; then
      CTX_SECTION="${CTX_SECTION} ${C_RED}${B}⚡${R}"
    fi

    CTX_SECTION="${CTX_SECTION}${EXCEEDS_IND}"
  else
    # Short form: just percentage with color
    CTX_SECTION="${BAR_COLOR}${PCT}%%${R}${COMPACT_IND}${EXCEEDS_IND}"
  fi

  append_section "$CTX_SECTION"
fi

# ── 10. Plan limits (adaptive) ────────────────────────────
if [ "$SHOW_PLAN_LIMITS" = "true" ] && { [ -n "$FIVE_HR" ] || [ -n "$SEVEN_DAY" ]; }; then
  FIVE_HR=${FIVE_HR:-0}
  SEVEN_DAY=${SEVEN_DAY:-0}
  if [ "$FIVE_HR" -gt 0 ] || [ "$SEVEN_DAY" -gt 0 ] 2>/dev/null; then
    FH_C=$(plan_color_for_pct "$FIVE_HR")
    SD_C=$(plan_color_for_pct "$SEVEN_DAY")

    # Adaptive: full form if either >40%, short form otherwise
    if [ "${FIVE_HR:-0}" -gt 40 ] || [ "${SEVEN_DAY:-0}" -gt 40 ] 2>/dev/null; then
      # Full form: dual bar with countdowns
      PLAN_W=$PLAN_BAR_WIDTH
      N_5H=$((FIVE_HR * PLAN_W / 100))
      N_7D=$((SEVEN_DAY * PLAN_W / 100))
      [ "$N_5H" -gt "$PLAN_W" ] && N_5H=$PLAN_W
      [ "$N_7D" -gt "$PLAN_W" ] && N_7D=$PLAN_W

      MIN_N=$N_5H; MAX_N=$N_7D; MID_CH='▄'
      if [ "$N_5H" -gt "$N_7D" ]; then
        MIN_N=$N_7D; MAX_N=$N_5H; MID_CH='▀'
      fi
      N_BOTH=$MIN_N
      N_MID=$((MAX_N - MIN_N))
      N_EMPTY=$((PLAN_W - MAX_N))

      MAX_P=$FIVE_HR
      [ "${SEVEN_DAY:-0}" -gt "$MAX_P" ] && MAX_P=$SEVEN_DAY
      P_COLOR=$(plan_color_for_pct "$MAX_P")

      PBAR="${P_COLOR}$(repeat_char "$N_BOTH" '█')$(repeat_char "$N_MID" "$MID_CH")${R}${C_GRAY}${D}$(repeat_char "$N_EMPTY" '-')${R}"

      FH_LABEL="${FH_C}${D}5h${R}${FH_C}:${FIVE_HR}%%${R}"
      if [ -n "$FIVE_HR_CD" ]; then
        FH_LABEL="${FH_LABEL} ${C_GRAY}${D}↻${FIVE_HR_CD}${R}"
      fi

      SD_LABEL="${SD_C}${D}7d${R}${SD_C}:${SEVEN_DAY}%%${R}"
      if [ -n "$SEVEN_DAY_CD" ]; then
        SD_LABEL="${SD_LABEL} ${C_GRAY}${D}↻${SEVEN_DAY_CD}${R}"
      fi

      append_section "${PBAR} ${FH_LABEL} ${SD_LABEL}"
    else
      # Short form: just text, no bar, no countdowns
      append_section "${FH_C}5h:${FIVE_HR}%%${R} ${SD_C}7d:${SEVEN_DAY}%%${R}"
    fi
  fi
fi

printf "${OUT}\n"
