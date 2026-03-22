#!/usr/bin/env bash
# gtd-lib.sh — Shared bash functions for GTD plugin hooks
# Source this file in all GTD hooks: source "$(dirname "$0")/gtd-lib.sh"
#
# All functions use $CWD variable for project root.
# Requires: jq

# ── Guards ──────────────────────────────────────────────────────────────────

if ! command -v jq >/dev/null 2>&1; then
  echo "GTD plugin disabled: jq not found. Install with: brew install jq" >&2
  exit 0
fi

# ── Paths ────────────────────────────────────────────────────────────────────

gtd_dir() {
  echo "${CWD}/.claude/gtd"
}

gtd_tasks_file() {
  echo "${CWD}/.claude/gtd/tasks.json"
}

gtd_session_state_file() {
  echo "${CWD}/.claude/gtd/session-state.json"
}

# ── Init ─────────────────────────────────────────────────────────────────────

# gtd_init — create .claude/gtd/tasks.json with empty schema if not exists
gtd_init() {
  local dir
  dir=$(gtd_dir)
  mkdir -p "$dir"
  local file
  file=$(gtd_tasks_file)
  if [ ! -f "$file" ]; then
    cat > "$file" <<'EOF'
{
  "version": "1.0",
  "lastReview": null,
  "activeTaskId": null,
  "tasks": []
}
EOF
  fi
}

# ── Read ─────────────────────────────────────────────────────────────────────

# gtd_read — read tasks.json, output to stdout
# Returns empty JSON structure if file missing
gtd_read() {
  local file
  file=$(gtd_tasks_file)
  if [ -f "$file" ]; then
    cat "$file"
  else
    printf '{"version":"1.0","lastReview":null,"activeTaskId":null,"tasks":[]}\n'
  fi
}

# ── Write ────────────────────────────────────────────────────────────────────

# gtd_write — write JSON from stdin to tasks.json (atomic: write tmp, then mv)
gtd_write() {
  local file
  file=$(gtd_tasks_file)
  local tmp
  tmp="${file}.tmp.$$"
  cat > "$tmp"
  mv "$tmp" "$file"
}

# ── ID Generation ────────────────────────────────────────────────────────────

# gtd_new_id — generate unique ID like gtd-a1b2c3
gtd_new_id() {
  local hex
  hex=$(head -c 3 /dev/urandom | xxd -p 2>/dev/null || openssl rand -hex 3 2>/dev/null || date +%s | tail -c 7)
  echo "gtd-${hex}"
}

# ── Active Task ───────────────────────────────────────────────────────────────

# gtd_active_task — get activeTaskId from tasks.json (empty string if none)
gtd_active_task() {
  gtd_read | jq -r '.activeTaskId // empty'
}

# ── List Counts ───────────────────────────────────────────────────────────────

# gtd_count_by_list <list> — count tasks in the given list (excluding completed)
gtd_count_by_list() {
  local list="$1"
  gtd_read | jq --arg list "$list" '[.tasks[] | select(.list == $list and .completed == null)] | length'
}

# gtd_count_overdue — count next actions with dueDate in the past
gtd_count_overdue() {
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  gtd_read | jq --arg now "$now" \
    '[.tasks[] | select(.list == "next" and .completed == null and .dueDate != null and .dueDate < $now)] | length'
}

# ── Days Since Review ─────────────────────────────────────────────────────────

# gtd_days_since_review — output integer days since lastReview (999 if never)
gtd_days_since_review() {
  local last_review
  last_review=$(gtd_read | jq -r '.lastReview // empty')
  if [ -z "$last_review" ]; then
    echo "999"
    return
  fi
  local last_epoch now_epoch
  if date -j >/dev/null 2>&1; then
    # macOS date
    last_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$last_review" "+%s" 2>/dev/null || echo "0")
  else
    # GNU date
    last_epoch=$(date -u -d "$last_review" "+%s" 2>/dev/null || echo "0")
  fi
  now_epoch=$(date -u "+%s")
  echo $(( (now_epoch - last_epoch) / 86400 ))
}

# ── Opt-Out Check ─────────────────────────────────────────────────────────────

# gtd_suggestions_enabled — returns 0 (true) if suggestions are on, 1 if off
gtd_suggestions_enabled() {
  local mode="${GTD_SUGGESTIONS:-on}"
  case "$mode" in
    off|false|0|disabled) return 1 ;;
    *) return 0 ;;
  esac
}

# gtd_suggestions_mode — prints "off", "minimal", or "on"
gtd_suggestions_mode() {
  local mode="${GTD_SUGGESTIONS:-on}"
  case "$mode" in
    off|false|0|disabled) echo "off" ;;
    minimal) echo "minimal" ;;
    *) echo "on" ;;
  esac
}

# ── Task Queries ─────────────────────────────────────────────────────────────

# gtd_get_task <id> — output task JSON object or empty
gtd_get_task() {
  local id="$1"
  gtd_read | jq --arg id "$id" '.tasks[] | select(.id == $id)'
}

# gtd_first_next — output first uncompleted next-action task as JSON
gtd_first_next() {
  gtd_read | jq 'first(.tasks[] | select(.list == "next" and .completed == null)) // empty'
}

# gtd_inbox_items — output array of uncompleted inbox tasks
gtd_inbox_items() {
  gtd_read | jq '[.tasks[] | select(.list == "inbox" and .completed == null)]'
}

# ── Append Task ───────────────────────────────────────────────────────────────

# gtd_append_task <json_object> — append a task JSON object (from stdin or arg) to tasks array
# Usage: echo '{...}' | gtd_append_task
gtd_append_task() {
  local task_json
  task_json=$(cat)
  local current
  current=$(gtd_read)
  echo "$current" | jq --argjson task "$task_json" '.tasks += [$task]' | gtd_write
}

# ── Update Task ───────────────────────────────────────────────────────────────

# gtd_update_task <id> <jq_update_expr> — apply a jq update expression to a task
# Example: gtd_update_task "gtd-abc123" '.completed = "2026-03-20T10:00:00Z"'
gtd_update_task() {
  local id="$1"
  local expr="$2"
  local current
  current=$(gtd_read)
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "$current" | jq --arg id "$id" --arg now "$now" \
    "(.tasks[] | select(.id == \$id)) |= (${expr} | .modified = \$now)" | gtd_write
}

# ── Update Active Task ────────────────────────────────────────────────────────

# gtd_set_active_task <id> — set activeTaskId in tasks.json
gtd_set_active_task() {
  local id="$1"
  local current
  current=$(gtd_read)
  echo "$current" | jq --arg id "$id" '.activeTaskId = $id' | gtd_write
}

# gtd_clear_active_task — clear activeTaskId
gtd_clear_active_task() {
  local current
  current=$(gtd_read)
  echo "$current" | jq '.activeTaskId = null' | gtd_write
}

# ── Update Last Review ────────────────────────────────────────────────────────

# gtd_touch_review — set lastReview to current UTC time
gtd_touch_review() {
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local current
  current=$(gtd_read)
  echo "$current" | jq --arg now "$now" '.lastReview = $now' | gtd_write
}
