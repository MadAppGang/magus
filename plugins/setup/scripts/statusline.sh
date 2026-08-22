#!/bin/bash
# Claude Code Status Line — colorful worktree-aware status with plan limits, reset countdowns & process RAM usage
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
SHOW_CLAUDISH_PLAN=true
SHOW_DIFF=true
SHOW_VIM=true
SHOW_AGENT=true
SHOW_SESSION_NAME=true
# Config key `.sections.memory` toggles the segment labelled `RAM` in the output.
# The key keeps its original `memory` name for back-compat — renaming it would
# break every existing ~/.claude/statusline-config.json.
SHOW_MEMORY=true
CTX_BAR_WIDTH=12
PLAN_BAR_WIDTH=10
THEME="default"
# `appearance` picks the light-on-dark or dark-on-light variant of $THEME.
# "auto" resolves it from the terminal at render time — see resolve_appearance().
APPEARANCE="auto"
# Wrap onto extra lines when the rendered width exceeds the terminal. Claude Code
# prints every line the command emits, so this costs nothing but vertical space.
# `wrap: "off"` restores the old single-line behaviour; `max_lines` caps the row
# count, and 0 means no cap.
WRAP="auto"
MAX_LINES=0
# Fewest lines and aligned columns are in genuine tension: giving each bar its own
# labelled row lines their left edges up, and usually costs a row that packing them
# together would not. `layout` picks which one wins.
#   auto    — fewest lines; use the gutter only when it costs nothing (default)
#   aligned — always use the gutter once wrapping starts, even at the cost of a row
#   compact — never use the gutter
LAYOUT="auto"
# ── Icons ────────────────────────────────────────────────
# `icons.nerd_font` is OPT-IN and defaults to false. Nerd Font glyphs live in the
# Unicode private use areas, so an unpatched font renders them as tofu (□) or, worse,
# as blank space — a segment that silently vanishes. Coverage is also PARTIAL and
# varies by font: on a machine with 0xProto Nerd Font installed, U+F035B (nf-md-memory)
# renders while U+F2DB (nf-fa-microchip) and U+F4BC (nf-oct-cpu) come out blank. So
# "the user has a Nerd Font" is NOT sufficient to enable this — /statusline:install
# renders the actual glyph and asks the user to confirm they can see it.
ICONS_NERD_FONT=false

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
    "SHOW_CLAUDISH_PLAN=\(d(.sections.claudish_plan; true))",
    "SHOW_DIFF=\(d(.sections.diff; true))",
    "SHOW_VIM=\(d(.sections.vim; true))",
    "SHOW_AGENT=\(d(.sections.agent; true))",
    "SHOW_SESSION_NAME=\(d(.sections.session_name; true))",
    "SHOW_MEMORY=\(d(.sections.memory; true))",
    "ICONS_NERD_FONT=\(d(.icons.nerd_font; false))",
    "CTX_BAR_WIDTH=\(d(.context_bar_width; 12))",
    "PLAN_BAR_WIDTH=\(d(.plan_bar_width; 10))",
    "THEME=\(d(.theme; "default"))",
    "APPEARANCE=\(d(.appearance; "auto"))",
    "WRAP=\(d(.wrap; "auto"))",
    "MAX_LINES=\(d(.max_lines; 0))",
    "LAYOUT=\(d(.layout; "auto"))"
  ' "$CONFIG_FILE" 2>/dev/null)"
fi

# ── Appearance detection (light vs dark terminal) ─────────
# The statusline child has NO controlling terminal: stdin, stdout and stderr are
# all pipes and /dev/tty is "Device not configured". So an OSC 11 background-colour
# query is impossible — there is nowhere to send it and nothing to read back from.
# Everything below is therefore an out-of-band signal, cheapest and most trustworthy
# first.
#
# $COLORFGBG is deliberately NOT consulted from the environment. Claude Code inherits
# it once at launch and freezes it; on this machine it sat at "15;0" (dark) through an
# entire light session. tmux's session-scope copy is refreshed by `update-environment`
# on every client attach, so that one is asked instead.
APPEARANCE_CACHE="$HOME/.claude/.statusline-appearance"

resolve_appearance() {
  case "$APPEARANCE" in
    light|dark) printf '%s' "$APPEARANCE"; return ;;
  esac

  # Env override — lets a single pane differ without touching the config file.
  case "${STATUSLINE_APPEARANCE:-}" in
    light|dark) printf '%s' "$STATUSLINE_APPEARANCE"; return ;;
  esac

  # An explicit user pin. Free to read, and it outranks every guess below because
  # it is the only signal that records an actual decision rather than an inference.
  if [ -r "$HOME/.config/tmux/theme" ]; then
    case "$(cat "$HOME/.config/tmux/theme" 2>/dev/null)" in
      light) printf 'light'; return ;;
      dark)  printf 'dark';  return ;;
    esac
  fi

  # The remaining probes each fork, so their verdict is cached. 30s is short enough
  # that flipping the terminal profile shows up almost immediately and long enough
  # that a burst of renders costs one fork, not one per render.
  if [ -r "$APPEARANCE_CACHE" ]; then
    local cache_age now_s
    now_s=$(date +%s)
    cache_age=$((now_s - $(stat -f %m "$APPEARANCE_CACHE" 2>/dev/null || stat -c %Y "$APPEARANCE_CACHE" 2>/dev/null || echo 0)))
    if [ "$cache_age" -lt 30 ] 2>/dev/null; then
      case "$(cat "$APPEARANCE_CACHE" 2>/dev/null)" in
        light) printf 'light'; return ;;
        dark)  printf 'dark';  return ;;
      esac
    fi
  fi

  local result=""

  # tmux session-scope COLORFGBG. Format is "<fg>;<bg>"; the trailing field is the
  # background slot, low numbers dark and high numbers light.
  if [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
    local cfb bg
    cfb=$(tmux show-environment COLORFGBG 2>/dev/null | cut -d= -f2-)
    bg="${cfb##*;}"
    case "$bg" in
      7|15) result="light" ;;
      0|1|2|3|4|5|6|8|9|10|11|12|13|14) result="dark" ;;
    esac
  fi

  # macOS system appearance, last because it describes the OS chrome and not the
  # terminal profile — a light profile inside a Dark-mode desktop reports "Dark".
  if [ -z "$result" ] && command -v defaults >/dev/null 2>&1; then
    if defaults read -g AppleInterfaceStyle >/dev/null 2>&1; then
      result="dark"
    else
      result="light"
    fi
  fi

  [ -n "$result" ] || result="dark"
  printf '%s\n' "$result" > "$APPEARANCE_CACHE" 2>/dev/null
  printf '%s' "$result"
}

APPEARANCE_RESOLVED=$(resolve_appearance)

# ── Theme colors ─────────────────────────────────────────
# EVERY colour below is a 256-cube index (16-255) via 38;5;N / 48;5;N, and NEVER a
# base-16 code (30-37, 40-47, 90-97, 100-107). That distinction is the whole reason
# the chips used to be unreadable:
#
#   * base-16 codes are PALETTE SLOTS. The terminal profile decides what RGB each
#     one means. iTerm2's "Light" profile here maps `Ansi 15` — which `\033[97m`
#     selects — to #3C3835, a near-black. So "bold bright white" rendered as BLACK.
#   * cube indices 16-231 are FIXED RGB. `48;5;130` is #AF5F00 on every profile.
#
# The chips paired the two: a fixed brown background with a foreground the light
# profile had quietly turned near-black, giving #3C3835 on #AF5F00 — a contrast
# ratio of 2.1:1. The branch chip was worse: #3C3835 on #005F00 is 1.04:1, which is
# invisible, not merely hard to read. Both now clear WCAG AA (4.5:1) in both
# appearances, because both halves of every pair are fixed.
fg() { printf '\\033[38;5;%sm' "$1"; }
bg() { printf '\\033[48;5;%sm' "$1"; }

apply_theme() {
  B='\033[1m'
  R='\033[0m'
  # The dim attribute is rendered by blending toward the background, so on a light
  # ground it erases text rather than de-emphasising it. De-emphasis on light comes
  # from C_GRAY alone.
  if [ "$APPEARANCE_RESOLVED" = "light" ]; then D=''; else D='\033[2m'; fi

  if [ "$APPEARANCE_RESOLVED" = "light" ]; then
    # Muted mid-darks, not near-blacks. The first pass here used 22/23/94/124/90 and
    # read as harsh: those clear 6-13:1 on #FBF1C7 cream, which is far more contrast
    # than a status line needs and makes every segment shout. These sit at roughly
    # 3.5-4.8:1 — legible without the glare. The two signal colours (cost, critical
    # red) stay at the top of that band because they carry the numbers that matter.
    case "$THEME" in
      monochrome) C_CYAN=$(fg 238); C_GREEN=$(fg 245); C_YELLOW=$(fg 245)
                  C_RED=$(fg 238);  C_MAGENTA=$(fg 245); C_WHITE=$(fg 236)
                  C_GRAY=$(fg 248); C_ORANGE=$(fg 238) ;;
      minimal)    C_CYAN=$(fg 66);  C_GREEN=$(fg 65);  C_YELLOW=$(fg 137)
                  C_RED=$(fg 131);  C_MAGENTA=$(fg 96); C_WHITE=$(fg 240)
                  C_GRAY=$(fg 248); C_ORANGE=$(fg 173) ;;
      neon)       C_CYAN=$(fg 37);  C_GREEN=$(fg 35);  C_YELLOW=$(fg 172)
                  C_RED=$(fg 196);  C_MAGENTA=$(fg 163); C_WHITE=$(fg 236)
                  C_GRAY=$(fg 245); C_ORANGE=$(fg 202) ;;
      *)          C_CYAN=$(fg 30);  C_GREEN=$(fg 65);  C_YELLOW=$(fg 130)
                  C_RED=$(fg 160);  C_MAGENTA=$(fg 96); C_WHITE=$(fg 238)
                  C_GRAY=$(fg 245); C_ORANGE=$(fg 166) ;;
    esac
    # Chips invert on light: a pale tint carries dark text, rather than a saturated
    # block carrying white.
    BADGE_FG=$(fg 238)
    BG_BRANCH=$(bg 151)   # #afd7af pale green
    BG_ALERT=$(bg 217)    # #ffafaf pale red
    # Worktree chips are tinted per name — see pick_wt_bg. Pale enough that #444444
    # text clears 7:1 on every one of them.
    WT_PALETTE=(223 194 189 224 230 195 225 187 152 218 151 222 158 183 217 229 153 216)
    BG_VIM_INSERT=$(bg 151); BG_VIM_NORMAL=$(bg 153)
    BG_VIM_VISUAL=$(bg 183); BG_VIM_REPLACE=$(bg 217); BG_VIM_OTHER=$(bg 252)
  else
    case "$THEME" in
      monochrome) C_CYAN=$(fg 231); C_GREEN=$(fg 250); C_YELLOW=$(fg 250)
                  C_RED=$(fg 231);  C_MAGENTA=$(fg 250); C_WHITE=$(fg 231)
                  C_GRAY=$(fg 244); C_ORANGE=$(fg 231) ;;
      minimal)    C_CYAN=$(fg 73);  C_GREEN=$(fg 71);  C_YELLOW=$(fg 179)
                  C_RED=$(fg 167);  C_MAGENTA=$(fg 139); C_WHITE=$(fg 252)
                  C_GRAY=$(fg 244); C_ORANGE=$(fg 173) ;;
      neon)       C_CYAN=$(fg 51);  C_GREEN=$(fg 46);  C_YELLOW=$(fg 226)
                  C_RED=$(fg 196);  C_MAGENTA=$(fg 201); C_WHITE=$(fg 231)
                  C_GRAY=$(fg 240); C_ORANGE=$(fg 208) ;;
      *)          C_CYAN=$(fg 80);  C_GREEN=$(fg 77);  C_YELLOW=$(fg 221)
                  C_RED=$(fg 203);  C_MAGENTA=$(fg 176); C_WHITE=$(fg 231)
                  C_GRAY=$(fg 244); C_ORANGE=$(fg 208) ;;
    esac
    BADGE_FG=$(fg 231)    # #ffffff fixed white, NOT \033[97m
    BG_BRANCH=$(bg 22)    # #005f00 — 12.4:1
    BG_ALERT=$(bg 160)    # #d70000 —  5.4:1
    # Saturated enough that #ffffff clears 4.5:1 on every one of them.
    WT_PALETTE=(130 22 24 53 88 58 23 90 94 25 55 28 61 89 29 95 54 18)
    BG_VIM_INSERT=$(bg 28);  BG_VIM_NORMAL=$(bg 25)
    BG_VIM_VISUAL=$(bg 90);  BG_VIM_REPLACE=$(bg 124); BG_VIM_OTHER=$(bg 240)
  fi
}
apply_theme

# ── Per-worktree chip colour ──────────────────────────────
# The chip used to be a single fixed brown for every session. With ~20 worktrees open
# at once that made the one field naming the session the least distinguishable thing
# on screen. Tinting it by name gives each worktree a stable colour that is the same
# in every pane and across restarts, so the chip becomes recognisable at a glance
# rather than something you have to read.
#
# Pure-bash so it costs no fork: statusline renders on every turn.
pick_wt_bg() {
  local s="$1" i h=0 ord
  for (( i = 0; i < ${#s}; i++ )); do
    printf -v ord '%d' "'${s:$i:1}"
    h=$(( (h * 31 + ord) % 1000003 ))
  done
  bg "${WT_PALETTE[$(( h % ${#WT_PALETTE[@]} ))]}"
}

# ── Icon table ────────────────────────────────────────────
# One entry per segment that has BOTH a Nerd Font glyph and a plain-text fallback.
# Add new pairs here and call `icon_or "$ICON_X" "TEXT"` at the render site — do not
# branch on $ICONS_NERD_FONT inline.
#
# Only Material Design (`nf-md-*`) glyphs are used: they are the best-covered set
# across patched fonts. Font Awesome (`nf-fa-*`) and Octicons (`nf-oct-*`) codepoints
# were measured rendering as BLANK on 0xProto Nerd Font, which is indistinguishable
# from a broken segment.
#
# Glyphs that are plain Unicode or emoji (⎇ U+2387, ↻ U+21BB, 🤖 U+1F916, ⟳ U+27F3, ⚡)
# are NOT in this table: they render in any modern font and are always on.
ICON_RAM='󰍛'  # U+F035B nf-md-memory

# Return the Nerd Font glyph when the user has opted in, else the plain-text label.
# Callers always follow the result with exactly one space, so `󰍛 1.1G` and `RAM 1.1G`
# are spaced identically.
icon_or() {
  if [ "$ICONS_NERD_FONT" = "true" ]; then
    printf '%s' "$1"
  else
    printf '%s' "$2"
  fi
}

# ── Helpers ───────────────────────────────────────────────
color_for_pct() {
  local p=$1
  if [ "$p" -lt 40 ]; then   printf '%s' "$C_GREEN"
  elif [ "$p" -lt 70 ]; then printf '%s' "$C_YELLOW"
  elif [ "$p" -lt 90 ]; then printf '%s' "$C_ORANGE"
  else                       printf '%s' "$C_RED"
  fi
}

# Bar FILLS get the vivid ramp; labels keep the muted one above. A `█` run is a solid
# block several columns wide, so saturation reads there without the glare it causes on
# thin text strokes — which is the whole reason the two are separate functions. On a
# light ground these sit around 2.4-3.4:1, deliberately below the text threshold: they
# are a magnitude you scan, not a value you read, and the number beside them is what
# carries the precision.
bar_color_for_pct() {
  local p=$1
  if [ "$APPEARANCE_RESOLVED" = "light" ]; then
    if [ "$p" -lt 40 ]; then   fg 34    # vivid green
    elif [ "$p" -lt 70 ]; then fg 172   # vivid amber
    elif [ "$p" -lt 90 ]; then fg 202   # vivid orange
    else                       fg 196   # vivid red
    fi
  else
    if [ "$p" -lt 40 ]; then   fg 46
    elif [ "$p" -lt 70 ]; then fg 226
    elif [ "$p" -lt 90 ]; then fg 208
    else                       fg 196
    fi
  fi
}

# Plan bars keep a cool hue family so they stay distinguishable from the context bar
# at a glance, rather than both ramping through the same green-to-red.
plan_bar_color_for_pct() {
  local p=$1
  if [ "$APPEARANCE_RESOLVED" = "light" ]; then
    if [ "$p" -lt 50 ]; then   fg 37    # vivid teal
    elif [ "$p" -lt 75 ]; then fg 32    # vivid blue
    elif [ "$p" -lt 90 ]; then fg 202   # vivid orange
    else                       fg 196   # vivid red
    fi
  else
    if [ "$p" -lt 50 ]; then   fg 51
    elif [ "$p" -lt 75 ]; then fg 33
    elif [ "$p" -lt 90 ]; then fg 208
    else                       fg 196
    fi
  fi
}

plan_color_for_pct() {
  local p=$1
  if [ "$APPEARANCE_RESOLVED" = "light" ]; then
    if [ "$p" -lt 50 ]; then   fg 66    # muted teal
    elif [ "$p" -lt 75 ]; then fg 61    # muted indigo
    elif [ "$p" -lt 90 ]; then fg 166   # orange
    else                       fg 160   # red
    fi
  else
    if [ "$p" -lt 50 ]; then   fg 73    # teal
    elif [ "$p" -lt 75 ]; then fg 68    # blue
    elif [ "$p" -lt 90 ]; then fg 172   # orange
    else                       fg 203   # red
    fi
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

  local reset_epoch

  # Claude Code sends resets_at as a Unix epoch integer; the plan-limits API sends an
  # ISO 8601 string. Both reach here, so accept both. An all-digits value is already
  # an epoch and needs no date(1) at all — parsing it as ISO silently returned nothing,
  # which is why the ↻ countdowns stopped appearing.
  case "$reset_ts" in
    ''|*[!0-9]*)
      # Strip fractional seconds and timezone suffix for parsing
      local clean="${reset_ts%%.*}"
      clean="${clean%%Z}"
      clean="${clean%%+*}"

      # macOS date -jf; fall back to GNU date -d
      # API returns UTC timestamps — parse in UTC to avoid local timezone offset
      reset_epoch=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%S" "$clean" +%s 2>/dev/null)
      if [ -z "$reset_epoch" ]; then
        reset_epoch=$(date -d "$reset_ts" +%s 2>/dev/null)
      fi
      ;;
    *) reset_epoch="$reset_ts" ;;
  esac
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

# Format token count as human-readable (e.g., 184320 → 184k, 1000000 → 1M)
fmt_tokens() {
  local t=$1
  [ -z "$t" ] || [ "$t" = "null" ] || [ "$t" -eq 0 ] 2>/dev/null && return
  if [ "$t" -ge 1000000 ] 2>/dev/null; then
    local m=$((t / 1000000))
    local remainder=$(( (t % 1000000) / 100000 ))
    if [ "$remainder" -gt 0 ]; then
      printf "%d.%dM" "$m" "$remainder"
    else
      printf "%dM" "$m"
    fi
  else
    local k=$((t / 1000))
    printf "%dk" "$k"
  fi
}

# Format memory in KB as human-readable (e.g., 1048576 → 1.0G, 850000 → 830M)
fmt_mem() {
  local kb=$1
  if [ "$kb" -ge 1048576 ] 2>/dev/null; then
    # GB range. The tenths digit is (remainder * 10 / 1GB) — NOT remainder/104857,
    # which rounds up to 10 in the top ~6 KB of every gigabyte and prints "1.10G".
    local gb=$((kb / 1048576))
    local tenths=$(( (kb % 1048576) * 10 / 1048576 ))
    printf "%d.%dG" "$gb" "$tenths"
  elif [ "$kb" -ge 1024 ] 2>/dev/null; then
    # MB range
    local mb=$((kb / 1024))
    printf "%dM" "$mb"
  else
    printf "%dk" "$kb"
  fi
}

# Is this command line a Claude Code ENTRYPOINT process?
#
# A substring test for "claude" is not good enough: the statusline itself runs as
# `bash ~/.claude/statusline-command.sh` (and under a shell snapshot in
# `~/.claude/shell-snapshots/`), so "claude" appears in the path of the very first
# process we look at. The old matcher therefore always matched at depth 0 and
# measured the statusline script's own shell — a few megabytes — never Claude Code.
#
# Match on argv[0] instead, which is the executable actually being run:
#   claude / /usr/local/bin/claude / .../ClaudeCode.app/Contents/MacOS/claude   → basename "claude"
#   /Users/x/.local/share/claude/versions/2.1.220 --session-id ...              → native versioned launcher
#   node .../@anthropic-ai/claude-code/cli.js                                   → npm install; argv[0] is the interpreter
# and reject anything where "claude" only shows up inside a path:
#   /bin/zsh -c source ~/.claude/shell-snapshots/snapshot-zsh-....sh            → basename "zsh"
#   bash ~/.claude/statusline-command.sh                                        → basename "bash"
#   op run --environment ... -- claude --dangerously-skip-permissions           → basename "op" (a launcher, not Claude)
is_claude_entrypoint() {
  local cmd=$1
  [ -n "$cmd" ] || return 1

  # argv[0] is the first whitespace-delimited token; its basename is the executable.
  local argv0=${cmd%% *}
  case "${argv0##*/}" in
    claude) return 0 ;;
  esac

  # npm/bun install: the interpreter runs the package's entry script.
  case "$cmd" in
    *@anthropic-ai/claude-code*) return 0 ;;
  esac

  # Native installer: argv[0] is a bare version directory under .../share/claude/versions/.
  case "$argv0" in
    */claude/versions/*) return 0 ;;
  esac

  return 1
}

# Find the Claude Code process PID by walking up the process tree from this script.
# Returns nothing (exit 1) when no Claude Code entrypoint is an ancestor — the caller
# then omits the memory segment rather than reporting some unrelated process.
find_claude_pid() {
  local pid=$$
  local max_depth=10
  local depth=0
  while [ "$pid" -gt 1 ] 2>/dev/null && [ "$depth" -lt "$max_depth" ]; do
    if is_claude_entrypoint "$(ps -o command= -p "$pid" 2>/dev/null)"; then
      printf '%s' "$pid"
      return 0
    fi
    # Walk to parent; stop if it is missing or self-referential.
    # Declare-and-assign in one statement: a bare `local ppid` re-declared on the
    # second iteration makes zsh echo "ppid=<value>" onto stdout, which would end up
    # concatenated into this function's result.
    local ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -z "$ppid" ] || [ "$ppid" = "$pid" ]; then
      break
    fi
    pid=$ppid
    depth=$((depth + 1))
  done
  return 1
}

# Sum resident set size (KB) across a PID and every descendant of it.
#
# Claude Code is not one process. The entrypoint forks helpers — on a real session
# here: main 680M plus two children at 249M and 252M, so ~1180M actual against a
# 680M single-process reading. Reporting only the entrypoint understates what the
# tool costs by roughly half, which is the opposite of what this segment is for.
#
# Takes ONE `ps -eo pid,ppid,rss` snapshot and walks the tree inside awk. Spawning
# a `ps` per process would cost a fork per descendant on every statusline render,
# which runs on every prompt.
#
# CAVEAT: summing RSS double-counts memory shared between the processes — mapped
# shared libraries most of all — so the figure is a slight OVERESTIMATE, not a
# precise proportional-set-size measurement. That is the accepted trade-off: this
# segment answers "what is Claude Code costing me in RAM", where the whole tree is
# the honest answer, rather than "how big is one process", where it is not. Getting
# a true PSS needs per-process page-table introspection that macOS does not expose
# cheaply to a shell script running on every prompt.
#
# Prints nothing when the root PID is not in the snapshot; the caller falls back.
tree_rss_kb() {
  local root=$1
  [ -n "$root" ] || return 1
  ps -eo pid,ppid,rss 2>/dev/null | awk -v root="$root" '
    # Skip the header and any malformed row.
    $1 !~ /^[0-9]+$/ { next }
    {
      rss[$1] = $3
      kids[$2] = kids[$2] " " $1
    }
    END {
      if (!(root in rss)) exit 0   # unknown PID → print nothing, caller falls back
      # Breadth-first walk from root. seen[] is the cycle/visited guard: a PID is
      # counted at most once even if ps reports a parent loop (or a PID reparents
      # mid-snapshot), so the sum can never runaway or double-count a process.
      total = rss[root] + 0
      seen[root] = 1
      queue[0] = root
      n = 1
      for (i = 0; i < n; i++) {
        k = split(kids[queue[i]], c, " ")
        for (j = 1; j <= k; j++) {
          if (c[j] != "" && !(c[j] in seen)) {
            seen[c[j]] = 1
            total += rss[c[j]] + 0
            queue[n++] = c[j]
          }
        }
      }
      print total
    }
  '
}

# ── Extract session data (single jq call) ─────────────────
eval "$(printf '%s' "$input" | jq -r '
  def s(v): if v == null then "" else (v | tostring) end;
  def n(v): if v == null then "0" else (v | tostring) end;
  def b(v): if v == true then "true" else "false" end;
  # Everything downstream compares with `[ -ge ]` and `$(( ))`, which are integer-only.
  # Claude Code sends percentages as floats — `56.99999999999999` — and every one of
  # those tests then fails with "integer expression expected", taking the whole plan
  # section down silently. Round at the boundary so the rest of the script keeps its
  # integer assumption.
  def i(v): if v == null then "" else (v | tonumber | round | tostring) end;
  # `context_window.current_usage` used to be a number and is now an object of token
  # buckets. `tostring` on it produced `{input_tokens:2,...}`, which reached arithmetic
  # and errored. Context occupancy is the three INPUT buckets; output_tokens is not
  # resident in the window.
  def usage(v):
    if v == null then "0"
    elif (v | type) == "object" then
      ([v.input_tokens, v.cache_creation_input_tokens, v.cache_read_input_tokens]
       | map(numbers) | add // 0 | tostring)
    else (v | tostring) end;
  "MODEL=\(s(.model.display_name) | @sh)",
  "MODEL_ID=\(s(.model.id) | @sh)",
  "COST=\(n(.cost.total_cost_usd))",
  "PCT=\(n(.context_window.used_percentage) | split(".")[0])",
  "CWD=\(s(.cwd) | @sh)",
  "DURATION_MS=\(n(.cost.total_duration_ms))",
  "CTX_MAX_TOKENS=\(n(.context_window.context_window_size))",
  "CURRENT_USAGE=\(usage(.context_window.current_usage))",
  "TOTAL_INPUT_TOKENS=\(n(.context_window.total_input_tokens))",
  "SESSION_ID=\(s(.session_id) | @sh)",
  "FIVE_HR=\(i(.rate_limits.five_hour.used_percentage) | @sh)",
  "SEVEN_DAY=\(i(.rate_limits.seven_day.used_percentage) | @sh)",
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

# ── claudish routing detection ────────────────────────────
# claudish proxies Claude Code to a non-Anthropic provider (Qwen/GLM/Kimi/...).
# It exports CLAUDISH_ACTIVE_MODEL_NAME (always) and CLAUDISH_TOKEN_FILE
# (claudish >= 7.29); either alone is sufficient proof. When routed, the
# session spends the PROVIDER's subscription, so every Anthropic plan number
# below describes an account this session is not touching.
CLAUDISH_ROUTED=0
if [ -n "${CLAUDISH_ACTIVE_MODEL_NAME:-}" ] || [ -n "${CLAUDISH_TOKEN_FILE:-}" ]; then
  CLAUDISH_ROUTED=1
  # Drop Claude Code's native rate_limits. Blanking here (rather than gating the
  # renderer) also means the reset countdowns below cost nothing, and section 11's
  # own emptiness check keeps the separator logic honest — no dangling "|".
  # The API poll is gated separately: blanking alone would TRIGGER it.
  FIVE_HR=""
  SEVEN_DAY=""
  FIVE_HR_RESET=""
  SEVEN_DAY_RESET=""
fi

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

# ── Plan usage fallback (API poll when native fields absent OR resets missing) ──
# Claude Code's native rate_limits input provides used_percentage but omits resets_at,
# so fetch from OAuth API whenever percentages or reset timestamps are missing.
#
# Skipped entirely under claudish: the poll asks api.anthropic.com about the
# Anthropic account, which this session is not spending, and it WRITES
# .statusline-usage-cache.json — so letting it run would also leave a stale cache
# for the user's real Anthropic sessions to read.
if [ "$CLAUDISH_ROUTED" -eq 0 ] && { { [ -z "$FIVE_HR" ] && [ -z "$SEVEN_DAY" ]; } || { [ -z "$FIVE_HR_RESET" ] && [ -z "$SEVEN_DAY_RESET" ]; }; }; then
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
          "https://api.anthropic.com/api/oauth/usage" > "${USAGE_CACHE}.tmp" 2>/dev/null
        # Only overwrite cache if response contains valid usage data (not an error)
        if jq -e '.five_hour.utilization // .seven_day.utilization' "${USAGE_CACHE}.tmp" >/dev/null 2>&1; then
          mv "${USAGE_CACHE}.tmp" "$USAGE_CACHE"
        else
          rm -f "${USAGE_CACHE}.tmp"
        fi
      fi
    ) &
  fi

  # Only fill missing fields — don't clobber fresh native values with stale cache data
  if [ -f "$USAGE_CACHE" ]; then
    [ -z "$FIVE_HR" ]         && FIVE_HR=$(jq -r '.five_hour.utilization // empty' "$USAGE_CACHE" 2>/dev/null | cut -d. -f1)
    [ -z "$SEVEN_DAY" ]       && SEVEN_DAY=$(jq -r '.seven_day.utilization // empty' "$USAGE_CACHE" 2>/dev/null | cut -d. -f1)
    [ -z "$FIVE_HR_RESET" ]   && FIVE_HR_RESET=$(jq -r '.five_hour.resets_at // empty' "$USAGE_CACHE" 2>/dev/null)
    [ -z "$SEVEN_DAY_RESET" ] && SEVEN_DAY_RESET=$(jq -r '.seven_day.resets_at // empty' "$USAGE_CACHE" 2>/dev/null)
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
# Sections are collected rather than concatenated, because the wrapper at the bottom
# has to split on section boundaries. Splitting a pre-joined string would cut through
# the middle of an escape sequence and leak `[38;5;80m` into the visible output.
#
# SECTION_LABELS runs parallel to SECTIONS. A non-empty label marks a section that
# gets its OWN line with a padded gutter when the statusline wraps, so that every
# labelled section's content starts at the same column. Only the bars carry one:
# they are the wide, visually heavy rows, and lining their left edges up is what
# turns a ragged wrap into something scannable. An empty label means "pack me".
SECTIONS=()
SECTION_LABELS=()

append_section() {
  SECTIONS+=("$1")
  SECTION_LABELS+=("")
}

append_labeled_section() {
  SECTION_LABELS+=("$1")
  SECTIONS+=("$2")
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

# ── 3+4. Git branch / worktree name — exactly ONE chip ───
# In a linked worktree the two chips said the same thing twice, because a worktree
# directory is conventionally named after its branch:
#   * Opus | worktree-mcp-failed-auth | wt:mcp-failed-auth | …
# So: linked worktree → worktree chip only; main worktree → branch chip only
# (WORKTREE_NAME is empty there, so no worktree chip has ever rendered).
#
# The branch chip is suppressed by whether the worktree chip is ACTUALLY RENDERED,
# not merely by WORKTREE_NAME being set. With `sections.worktree: false` the worktree
# chip is off, so the branch chip must come back — gating on WORKTREE_NAME alone would
# leave that user with no git context at all.
#
# Trade-off, deliberate: when a worktree's directory name differs from its branch
# (worktree `mcp-failed-auth` checked out on `feature/xyz`), only the directory name is
# shown and the branch is hidden.
WORKTREE_CHIP=0
if [ "$SHOW_WORKTREE" = "true" ] && [ -n "$WORKTREE_NAME" ]; then
  WORKTREE_CHIP=1
fi

if [ "$SHOW_BRANCH" = "true" ] && [ -n "$BRANCH" ] && [ "$WORKTREE_CHIP" -eq 0 ]; then
  append_section "${BG_BRANCH}${BADGE_FG} ${BRANCH} ${R}"
fi

if [ "$WORKTREE_CHIP" -eq 1 ]; then
  append_section "$(pick_wt_bg "$WORKTREE_NAME")${B}${BADGE_FG} wt:${WORKTREE_NAME} ${R}"
fi

# ── 5. Vim mode (if active) ───────────────────────────────
if [ "$SHOW_VIM" = "true" ] && [ -n "$VIM_MODE" ]; then
  case "$VIM_MODE" in
    INSERT)  VIM_CH="I"; VIM_BG="$BG_VIM_INSERT" ;;
    NORMAL)  VIM_CH="N"; VIM_BG="$BG_VIM_NORMAL" ;;
    VISUAL)  VIM_CH="V"; VIM_BG="$BG_VIM_VISUAL" ;;
    REPLACE) VIM_CH="R"; VIM_BG="$BG_VIM_REPLACE" ;;
    *)       VIM_CH="${VIM_MODE:0:1}"; VIM_BG="$BG_VIM_OTHER" ;;
  esac
  append_section "${VIM_BG}${B}${BADGE_FG} ${VIM_CH} ${R}"
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

# ── 8. RAM usage (Claude Code process tree, resident set) ──────
# Rendered as `RAM 1.1G`, or `󰍛 1.1G` when `icons.nerd_font` is on. The text label
# is deliberately "RAM", not "MEM": in this product's context "memory" reads as
# LLM/agentic memory (MEMORY.md, mnemex) rather than process RAM. The config key
# stays `memory` / SHOW_MEMORY for back-compat with existing
# ~/.claude/statusline-config.json files.
#
# The figure covers the entrypoint AND all its descendants (see tree_rss_kb) —
# Claude Code runs several processes, and the entrypoint alone is about half the
# real total. Falls back to the single-process RSS if the tree walk comes back
# empty, and renders nothing if that is empty too.
if [ "$SHOW_MEMORY" = "true" ]; then
  CLAUDE_PID=""
  if [ -n "$SESSION_ID" ]; then
    PID_CACHE="$HOME/.claude/.statusline-pid-cache-${SESSION_ID}"
    CLAUDE_PID=$(cat "$PID_CACHE" 2>/dev/null)
    # Re-validate the cached PID: it must still be alive AND still be a Claude Code
    # entrypoint. Liveness alone is not enough — caches written by older versions of
    # this script hold the statusline's own shell PID, and PIDs get recycled.
    if [ -n "$CLAUDE_PID" ] && ! is_claude_entrypoint "$(ps -o command= -p "$CLAUDE_PID" 2>/dev/null)"; then
      CLAUDE_PID=""
      rm -f "$PID_CACHE"
    fi
  fi
  if [ -z "$CLAUDE_PID" ]; then
    CLAUDE_PID=$(find_claude_pid)
    if [ -n "$CLAUDE_PID" ] && [ -n "$SESSION_ID" ]; then
      printf '%s\n' "$CLAUDE_PID" > "$PID_CACHE"
    fi
  fi
  if [ -n "$CLAUDE_PID" ]; then
    MEM_KB=$(tree_rss_kb "$CLAUDE_PID" | tr -d ' ')
    # Fail soft: an empty or zero tree walk falls back to the entrypoint alone.
    if [ -z "$MEM_KB" ] || ! [ "$MEM_KB" -gt 0 ] 2>/dev/null; then
      MEM_KB=$(ps -o rss= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
    fi
    if [ -n "$MEM_KB" ] && [ "$MEM_KB" -gt 0 ] 2>/dev/null; then
      MEM_FMT=$(fmt_mem "$MEM_KB")
      RAM_LABEL=$(icon_or "$ICON_RAM" "RAM")
      append_section "${C_CYAN}${D}${RAM_LABEL} ${MEM_FMT}${R}"
    fi
  fi
fi

# ── 9. Diff stats ─────────────────────────────────────────
# Two independent signals, rendered as icon-prefixed chips:
#   🤖 +N/-M  — lines Claude edited/wrote in this conversation (.cost.total_lines_*)
#   ⎇ +N/-M  — uncommitted tracked changes in the worktree (git diff --shortstat)
# The two glyphs pair semantically: 🤖 (U+1F916) = lines the AI wrote, ⎇ = uncommitted
# git changes. The previous ✨ was decorative and carried no meaning; the robot says
# "this came from the agent". 🤖 is double-width, exactly as ✨ was, so the chip's
# column alignment is unchanged.
# The git chip uses U+2387 (BRANCHING), plain Unicode — deliberately NOT a Powerline
# branch glyph (U+E0A0), which lives in the private use area and needs a Nerd Font.
# Each chip appears only when its counts are non-zero.
# The git chip is also omitted when cwd is not in a git repository.
if [ "$SHOW_DIFF" = "true" ]; then
  # Git-side stats: read uncommitted tracked changes from `git diff --shortstat`.
  # Silently yields zeros when cwd is not a git repo OR git is not on PATH.
  GIT_LINES_ADDED=0
  GIT_LINES_REMOVED=0
  if [ -n "$CWD" ] && cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
    GIT_SHORTSTAT=$(git diff --shortstat 2>/dev/null)
    # Format: " N files changed, A insertions(+), D deletions(-)"
    # Either insertions or deletions may be absent.
    GIT_LINES_ADDED=$(printf '%s' "$GIT_SHORTSTAT" | sed -n 's/.*[^0-9]\([0-9][0-9]*\) insertion.*/\1/p')
    GIT_LINES_REMOVED=$(printf '%s' "$GIT_SHORTSTAT" | sed -n 's/.*[^0-9]\([0-9][0-9]*\) deletion.*/\1/p')
    GIT_LINES_ADDED=${GIT_LINES_ADDED:-0}
    GIT_LINES_REMOVED=${GIT_LINES_REMOVED:-0}
  fi

  DIFF_SECTION=""

  # Session chip (AI edits so far this conversation)
  if [ "${LINES_ADDED:-0}" -gt 0 ] 2>/dev/null || [ "${LINES_REMOVED:-0}" -gt 0 ] 2>/dev/null; then
    DIFF_SECTION="${C_CYAN}🤖${R} ${C_GREEN}+${LINES_ADDED:-0}${R}${C_GRAY}/${R}${C_RED}-${LINES_REMOVED:-0}${R}"
  fi

  # Git chip (uncommitted worktree diff)
  if [ "$GIT_LINES_ADDED" -gt 0 ] 2>/dev/null || [ "$GIT_LINES_REMOVED" -gt 0 ] 2>/dev/null; then
    GIT_CHIP="${C_YELLOW}⎇${R} ${C_GREEN}+${GIT_LINES_ADDED}${R}${C_GRAY}/${R}${C_RED}-${GIT_LINES_REMOVED}${R}"
    if [ -n "$DIFF_SECTION" ]; then
      DIFF_SECTION="${DIFF_SECTION}  ${GIT_CHIP}"
    else
      DIFF_SECTION="$GIT_CHIP"
    fi
  fi

  [ -n "$DIFF_SECTION" ] && append_section "$DIFF_SECTION"
fi

# ── 10. Context bar (always visible, adaptive width) ──────
if [ "$SHOW_CONTEXT_BAR" = "true" ]; then
  BAR_COLOR=$(color_for_pct "$PCT")       # the % label — muted, meant to be read
  BAR_FILL=$(bar_color_for_pct "$PCT")    # the █ run — vivid, meant to be scanned
  CTX_USED_TOKENS="${CURRENT_USAGE:-0}"
  CTX_USED_FMT=$(fmt_tokens "$CTX_USED_TOKENS")
  CTX_MAX_FMT=$(fmt_tokens "$CTX_MAX_TOKENS")

  # Compaction indicator with count
  COMPACT_IND=""
  if [ "${COMPACTION_COUNT:-0}" -gt 1 ] 2>/dev/null; then
    COMPACT_IND=" ${C_MAGENTA}${B}⟳×${COMPACTION_COUNT}${R}"
  fi

  # Context window size indicator (shows when exceeding nominal size)
  EXCEEDS_IND=""
  if [ "$EXCEEDS_200K" = "true" ]; then
    ctx_label=$(fmt_tokens "$CTX_MAX_TOKENS")
    EXCEEDS_IND=" ${C_RED}${B}${ctx_label:-200k}+${R}"
  fi

  # Adaptive bar width: short bar when low, full bar when high
  if [ "${PCT:-0}" -gt 50 ] 2>/dev/null; then
    CUR_BAR_W=$CTX_BAR_WIDTH      # full width (default 12)
  else
    CUR_BAR_W=6                    # compact width
  fi

  CTX_F=$((PCT * CUR_BAR_W / 100))
  [ "$CTX_F" -gt "$CUR_BAR_W" ] && CTX_F=$CUR_BAR_W
  CTX_E=$((CUR_BAR_W - CTX_F))

  # Percentage label — background highlight when critical (≥80%)
  if [ "${PCT:-0}" -ge 80 ] 2>/dev/null; then
    PCT_LABEL="${BG_ALERT}${B}${BADGE_FG} ${PCT}% ${R}"
  else
    PCT_LABEL="${BAR_COLOR}${PCT}%${R}"
  fi

  CTX_SECTION="${BAR_FILL}$(repeat_char "$CTX_F" '█')${C_GRAY}$(repeat_char "$CTX_E" '░')${R} ${PCT_LABEL}"

  # Token count in full form
  if [ "${PCT:-0}" -gt 50 ] 2>/dev/null && [ -n "$CTX_USED_FMT" ] && [ -n "$CTX_MAX_FMT" ]; then
    CTX_SECTION="${CTX_SECTION} ${C_GRAY}${D}${CTX_USED_FMT}/${CTX_MAX_FMT}${R}"
  fi

  CTX_SECTION="${CTX_SECTION}${COMPACT_IND}"

  if [ "${PCT:-0}" -ge 80 ] 2>/dev/null; then
    CTX_SECTION="${CTX_SECTION} ${C_RED}${B}⚡${R}"
  fi

  CTX_SECTION="${CTX_SECTION}${EXCEEDS_IND}"

  append_labeled_section "ctx" "$CTX_SECTION"
fi

# ── 11. Plan limits (always bar, adaptive width) ──────────
if [ "$SHOW_PLAN_LIMITS" = "true" ] && { [ -n "$FIVE_HR" ] || [ -n "$SEVEN_DAY" ]; }; then
  FIVE_HR=${FIVE_HR:-0}
  SEVEN_DAY=${SEVEN_DAY:-0}
  if [ "$FIVE_HR" -gt 0 ] || [ "$SEVEN_DAY" -gt 0 ] 2>/dev/null; then
    FH_C=$(plan_color_for_pct "$FIVE_HR")
    SD_C=$(plan_color_for_pct "$SEVEN_DAY")

    # Adaptive bar width: short when both low, full when either high
    if [ "${FIVE_HR:-0}" -gt 40 ] || [ "${SEVEN_DAY:-0}" -gt 40 ] 2>/dev/null; then
      PLAN_W=$PLAN_BAR_WIDTH      # full width (default 10)
    else
      PLAN_W=5                     # compact width
    fi

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
    P_COLOR=$(plan_bar_color_for_pct "$MAX_P")

    PBAR="${P_COLOR}$(repeat_char "$N_BOTH" '█')$(repeat_char "$N_MID" "$MID_CH")${R}${C_GRAY}${D}$(repeat_char "$N_EMPTY" '-')${R}"

    # 5h label — background highlight when critical (≥80%)
    if [ "${FIVE_HR:-0}" -ge 80 ] 2>/dev/null; then
      FH_LABEL="${BG_ALERT}${B}${BADGE_FG} 5h:${FIVE_HR}% ${R}"
    else
      FH_LABEL="${FH_C}${D}5h${R}${FH_C}:${FIVE_HR}%${R}"
    fi
    if [ -n "$FIVE_HR_CD" ]; then
      if [ "${FIVE_HR:-0}" -ge 100 ] 2>/dev/null; then
        # Rate-limited: countdown is primary info — red background highlight
        FH_LABEL="${FH_LABEL} ${BG_ALERT}${B}${BADGE_FG} ↻${FIVE_HR_CD} ${R}"
      elif [ "${FIVE_HR:-0}" -ge 80 ] 2>/dev/null; then
        # Critical: orange/yellow countdown — visible but not alarming
        FH_LABEL="${FH_LABEL} ${C_ORANGE}${B}↻${FIVE_HR_CD}${R}"
      else
        FH_LABEL="${FH_LABEL} ${C_GRAY}${D}↻${FIVE_HR_CD}${R}"
      fi
    fi

    # 7d label — background highlight when critical (≥80%)
    if [ "${SEVEN_DAY:-0}" -ge 80 ] 2>/dev/null; then
      SD_LABEL="${BG_ALERT}${B}${BADGE_FG} 7d:${SEVEN_DAY}% ${R}"
    else
      SD_LABEL="${SD_C}${D}7d${R}${SD_C}:${SEVEN_DAY}%${R}"
    fi
    if [ -n "$SEVEN_DAY_CD" ]; then
      if [ "${SEVEN_DAY:-0}" -ge 100 ] 2>/dev/null; then
        # Rate-limited: countdown is primary info — red background highlight
        SD_LABEL="${SD_LABEL} ${BG_ALERT}${B}${BADGE_FG} ↻${SEVEN_DAY_CD} ${R}"
      elif [ "${SEVEN_DAY:-0}" -ge 80 ] 2>/dev/null; then
        # Critical: orange/yellow countdown — visible but not alarming
        SD_LABEL="${SD_LABEL} ${C_ORANGE}${B}↻${SEVEN_DAY_CD}${R}"
      else
        SD_LABEL="${SD_LABEL} ${C_GRAY}${D}↻${SEVEN_DAY_CD}${R}"
      fi
    fi

    append_labeled_section "plan" "${PBAR} ${FH_LABEL} ${SD_LABEL}"
  fi
fi

# ── 12. claudish provider plan limits ─────────────────────
# Replacement for section 11 when the session is proxied: the ACTIVE provider's
# own plan windows, read from claudish's per-session token file.
#
# Shape (claudish writes this; absent on every provider today, so the common
# case must render NOTHING — no placeholder, no dangling separator):
#   "plan": { "label": "GLM Coding Plan",
#             "windows": [ { "id": "5h", "used_pct": 78,
#                            "resets_at": "2026-08-03T18:00:00Z" } ] }
#
# The window list is arbitrary-length with arbitrary ids — a provider may expose
# one window, three, or none, and nothing here assumes "5h"/"7d".
if [ "$SHOW_PLAN_LIMITS" = "true" ] && [ "$SHOW_CLAUDISH_PLAN" = "true" ] \
   && [ "$CLAUDISH_ROUTED" -eq 1 ] && [ -n "${CLAUDISH_TOKEN_FILE:-}" ] \
   && [ -f "$CLAUDISH_TOKEN_FILE" ] && command -v jq >/dev/null 2>&1; then

  CL_PLAN_LABEL=$(jq -r '.plan.label // empty' "$CLAUDISH_TOKEN_FILE" 2>/dev/null)
  # One TSV row per window: id, integer percent, resets_at.
  CL_PLAN_ROWS=$(jq -r '
    (.plan.windows // [])[]
    | select(type == "object")
    | select(.used_pct != null)
    | [ (.id // "?"), (.used_pct | tostring | split(".")[0]), (.resets_at // "") ]
    | @tsv
  ' "$CLAUDISH_TOKEN_FILE" 2>/dev/null)

  if [ -n "$CL_PLAN_ROWS" ]; then
    CL_LABELS=""
    CL_MAX_PCT=0

    # Heredoc, not a pipe: a piped `while read` runs in a subshell and would
    # discard CL_LABELS/CL_MAX_PCT on exit.
    CL_TAB=$(printf '\t')
    while IFS="$CL_TAB" read -r w_id w_pct w_reset; do
      [ -z "$w_id" ] && continue
      # Skip anything non-numeric rather than let arithmetic below explode.
      case "$w_pct" in ''|*[!0-9]*) continue ;; esac

      [ "$w_pct" -gt "$CL_MAX_PCT" ] 2>/dev/null && CL_MAX_PCT=$w_pct

      W_C=$(plan_color_for_pct "$w_pct")
      # Same critical highlight rule as the Anthropic labels (≥80%).
      if [ "$w_pct" -ge 80 ] 2>/dev/null; then
        W_LABEL="${BG_ALERT}${B}${BADGE_FG} ${w_id}:${w_pct}% ${R}"
      else
        W_LABEL="${W_C}${D}${w_id}${R}${W_C}:${w_pct}%${R}"
      fi

      if [ -n "$w_reset" ]; then
        W_CD=$(countdown "$w_reset")
        if [ -n "$W_CD" ]; then
          if [ "$w_pct" -ge 100 ] 2>/dev/null; then
            W_LABEL="${W_LABEL} ${BG_ALERT}${B}${BADGE_FG} ↻${W_CD} ${R}"
          elif [ "$w_pct" -ge 80 ] 2>/dev/null; then
            W_LABEL="${W_LABEL} ${C_ORANGE}${B}↻${W_CD}${R}"
          else
            W_LABEL="${W_LABEL} ${C_GRAY}${D}↻${W_CD}${R}"
          fi
        fi
      fi

      if [ -n "$CL_LABELS" ]; then
        CL_LABELS="${CL_LABELS} ${W_LABEL}"
      else
        CL_LABELS="$W_LABEL"
      fi
    done <<CLAUDISH_PLAN_EOF
$CL_PLAN_ROWS
CLAUDISH_PLAN_EOF

    if [ -n "$CL_LABELS" ]; then
      # One bar for the most-consumed window — the Anthropic segment likewise
      # colors its bar by the max of its two series, and an N-series overlay
      # would not generalize to an arbitrary window count.
      if [ "$CL_MAX_PCT" -gt 40 ] 2>/dev/null; then
        CL_W=$PLAN_BAR_WIDTH
      else
        CL_W=5
      fi
      CL_F=$((CL_MAX_PCT * CL_W / 100))
      [ "$CL_F" -gt "$CL_W" ] && CL_F=$CL_W
      CL_E=$((CL_W - CL_F))
      CL_BAR_C=$(plan_bar_color_for_pct "$CL_MAX_PCT")
      CL_BAR="${CL_BAR_C}$(repeat_char "$CL_F" '█')${R}${C_GRAY}${D}$(repeat_char "$CL_E" '-')${R}"

      CL_SECTION="${CL_BAR} ${CL_LABELS}"
      # The provider's own plan name becomes the gutter label when wrapped, so it
      # reads as a row heading rather than a prefix glued to the bar. Falls back to
      # "plan" when claudish gives no label.
      append_labeled_section "${CL_PLAN_LABEL:-plan}" "$CL_SECTION"
    fi
  fi
fi

# ── Wrap to the terminal width ────────────────────────────
# Claude Code prints every line the command emits, each indented 2 columns — verified
# by feeding it a 3-line script and reading the rendered pane back. So going multi-line
# needs no cooperation from the host beyond emitting more newlines.
#
# $COLUMNS carries the LIVE terminal width. Claude Code injects it per render: it is
# absent from the claude process's own environment (`ps -Ewww`) yet present in this
# child at the current pane width, so it tracks resizes rather than freezing at launch.
shopt -s extglob

# Columns the string occupies once printf has eaten the escapes. Escapes are still in
# their literal `\033[…m` two-character-backslash form here, which is why the pattern
# matches a literal backslash.
#
# 🤖 (U+1F916) and ⚡ (U+26A1) carry emoji presentation and take two columns each;
# every other non-ASCII character the script emits (→ ↑ ↻ ⟳ ⎇ █ ░ ▀) is one column.
# Nerd Font glyphs are counted as one, which is how iTerm2 renders the Material
# Design range — worst case that under-counts a segment by a column, which costs a
# slightly early wrap and never a broken escape.
# Each wide glyph is removed with its own FULL-STRING pattern, never a bracket set.
# `${s//[🤖⚡]/}` looks like a character class and is a BYTE class: it deletes any byte
# appearing in the UTF-8 encoding of either glyph. 🤖 is F0 9F A4 96 and ⚡ is E2 9A A1,
# and █ ░ ▀ all begin E2 — so every block character in a bar was being eaten and
# counted as double-width. The context bar measured 43 columns instead of 30 and the
# plan bar 59 instead of 48, which made the wrapper split lines on wide terminals that
# had room to spare.
# >>> display_width  (test-statusline.ts extracts between these markers — keep them)
display_width() {
  local stripped="${1//\\033\[*([0-9;])m/}"
  local n=${#stripped} w=${#stripped} t
  t=${stripped//🤖/}; w=$(( w + n - ${#t} ))
  t=${stripped//⚡/}; w=$(( w + n - ${#t} ))
  printf '%s' "$w"
}
# <<< display_width

TERM_COLS=${COLUMNS:-80}
# 2 for Claude Code's indent, 1 so a full-width line cannot trip the terminal's own
# auto-wrap and split an escape sequence across rows.
BUDGET=$((TERM_COLS - 3))
[ "$BUDGET" -lt 20 ] && BUDGET=20

SEP_WIDTH=3   # " | "

# Widths are computed once; display_width forks nothing but the loop runs per render.
SEC_W=()
for section in "${SECTIONS[@]}"; do
  SEC_W+=("$(display_width "$section")")
done

# Both layouts get built and `layout` decides between them. Under the default `auto`
# the gutter is worth a column of labels but NOT an extra ROW, so it is taken only when
# it does not increase the line count. In practice that means it rarely fires: packing
# both bars onto one shared row is usually a line cheaper than giving each its own.
# `layout: "aligned"` is the opt-in for people who want the columns lined up and are
# happy to spend the row.

# ── Layout A: plain greedy, no labels ──
PLAIN=()
CUR=""
CUR_W=0
for idx in "${!SECTIONS[@]}"; do
  w=${SEC_W[$idx]}
  if [ -z "$CUR" ]; then
    CUR="${SECTIONS[$idx]}"; CUR_W=$w
  elif [ "$WRAP" = "off" ] || [ $((CUR_W + SEP_WIDTH + w)) -le "$BUDGET" ] \
       || { [ "$MAX_LINES" -gt 0 ] 2>/dev/null && [ "${#PLAIN[@]}" -ge $((MAX_LINES - 1)) ]; }; then
    CUR="${CUR} ${SEP} ${SECTIONS[$idx]}"; CUR_W=$((CUR_W + SEP_WIDTH + w))
  else
    PLAIN+=("$CUR"); CUR="${SECTIONS[$idx]}"; CUR_W=$w
  fi
done
[ -n "$CUR" ] && PLAIN+=("$CUR")

LINES=("${PLAIN[@]}")

# ── Layout B: labelled gutter, one row per labelled section ──
# Only attempted when A already needed more than one row. On a wide terminal A is a
# single line and nothing beats that.
if [ "$WRAP" != "off" ] && [ "$LAYOUT" != "compact" ] && [ "${#PLAIN[@]}" -gt 1 ]; then
  GUTTER_W=0
  for label in "${SECTION_LABELS[@]}"; do
    [ -n "$label" ] && [ "${#label}" -gt "$GUTTER_W" ] && GUTTER_W=${#label}
  done
  [ "$GUTTER_W" -gt 0 ] && GUTTER_W=$((GUTTER_W + 2))

  if [ "$GUTTER_W" -gt 0 ]; then
    # Packed rows are NOT indented into the gutter, because they cannot be: Claude Code
    # strips leading whitespace from every line it renders. Measured — six leading
    # spaces and six leading U+00A0 both came back flush against an unindented line,
    # while a line starting with a letter kept its position. So the labelled rows align
    # with each other and the packed rows sit flush left above them, as a heading.
    #
    # The gutter is charged against the budget, or the labelled rows overflow by
    # exactly its width.
    INNER=$((BUDGET - GUTTER_W))
    [ "$INNER" -lt 16 ] && INNER=16

    GUT=()
    CUR=""
    CUR_W=0
    for idx in "${!SECTIONS[@]}"; do
      w=${SEC_W[$idx]}
      label="${SECTION_LABELS[$idx]}"
      if [ -n "$label" ]; then
        [ -n "$CUR" ] && { GUT+=("$CUR"); CUR=""; CUR_W=0; }
        GUT+=("$(printf "%s%-${GUTTER_W}s%s" "${C_GRAY}${D}" "$label" "${R}")${SECTIONS[$idx]}")
        continue
      fi
      if [ -z "$CUR" ]; then
        CUR="${SECTIONS[$idx]}"; CUR_W=$w
      elif [ $((CUR_W + SEP_WIDTH + w)) -le "$INNER" ]; then
        CUR="${CUR} ${SEP} ${SECTIONS[$idx]}"; CUR_W=$((CUR_W + SEP_WIDTH + w))
      else
        GUT+=("$CUR"); CUR="${SECTIONS[$idx]}"; CUR_W=$w
      fi
    done
    [ -n "$CUR" ] && GUT+=("$CUR")

    if [ "$LAYOUT" = "aligned" ] || [ "${#GUT[@]}" -le "${#PLAIN[@]}" ]; then
      LINES=("${GUT[@]}")
    fi
  fi
fi

for line in "${LINES[@]}"; do
  # %b, not the line as a format string. `printf "$line"` treated a branch name
  # containing `%` as a conversion spec, so a branch like `feat/100%-coverage`
  # rendered as garbage or swallowed the rest of the line. %b expands the \033
  # escapes and treats every `%` as a literal, which is also why the percentage
  # segments above now write a single `%` rather than escaping it as `%%`.
  printf '%b\n' "$line"
done
