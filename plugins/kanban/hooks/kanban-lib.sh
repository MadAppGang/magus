#!/usr/bin/env bash
# kanban-lib.sh — Shared bash functions for kanban plugin
# Source this file in kanban command scripts:
#   source "$(dirname "$0")/kanban-lib.sh"
#
# All functions use $CWD variable for project root.
# Independent task store at .claude/kanban/tasks.json.
# Requires: jq

# ── Guards ──────────────────────────────────────────────────────────────────

if ! command -v jq >/dev/null 2>&1; then
  echo "Kanban plugin disabled: jq not found. Install with: brew install jq" >&2
  exit 0
fi

# ── Paths ────────────────────────────────────────────────────────────────────

kanban_dir() {
  echo "${CWD}/.claude/kanban"
}

kanban_tasks_file() {
  echo "${CWD}/.claude/kanban/tasks.json"
}

# ── Init ─────────────────────────────────────────────────────────────────────

# kanban_init — create tasks.json with v4.0 kanban-only schema if not exists
kanban_init() {
  local dir
  dir=$(kanban_dir)
  mkdir -p "$dir"
  local file
  file=$(kanban_tasks_file)
  if [ ! -f "$file" ]; then
    cat > "$file" <<'EOF'
{
  "version": "4.0",
  "nextId": 1,
  "kanban": {
    "columns": ["backlog", "todo", "in-progress", "review", "done"],
    "wipLimit": 3
  },
  "tasks": []
}
EOF
  fi
}

# ── Read / Write ──────────────────────────────────────────────────────────────

# kanban_read — read tasks.json, output to stdout
kanban_read() {
  local file
  file=$(kanban_tasks_file)
  if [ -f "$file" ]; then
    cat "$file"
  else
    printf '{"version":"4.0","nextId":1,"kanban":{"columns":["backlog","todo","in-progress","review","done"],"wipLimit":3},"tasks":[]}\n'
  fi
}

# kanban_write — write JSON from stdin to tasks.json (atomic: tmp then mv)
kanban_write() {
  local file
  file=$(kanban_tasks_file)
  local tmp
  tmp="${file}.tmp.$$"
  cat > "$tmp"
  mv "$tmp" "$file"
}

# ── ID Generation ────────────────────────────────────────────────────────────

# kanban_new_id — allocate next sequential ID (atomic read-increment-write)
# Returns: the new ID as a plain number (e.g. "1", "19")
kanban_new_id() {
  local file
  file=$(kanban_tasks_file)
  local current
  current=$(cat "$file")
  local id
  id=$(echo "$current" | jq -r '.nextId')
  local next=$(( id + 1 ))
  echo "$current" | jq --argjson next "$next" '.nextId = $next' | kanban_write
  echo "$id"
}

# ── Kanban Operations ─────────────────────────────────────────────────────────

# kanban_move <id> <status> — set status on a task
# Returns: 0 on success, 1 if task not found
kanban_move() {
  local id="$1"
  local status="$2"
  local file
  file=$(kanban_tasks_file)

  # Validate task exists
  local exists
  exists=$(jq -r --arg id "$id" '.tasks[] | select(.id == $id) | .id' "$file")
  if [ -z "$exists" ]; then
    return 1
  fi

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp="${file}.tmp.$$"
  jq --arg id "$id" --arg status "$status" --arg now "$now" \
    '(.tasks[] | select(.id == $id)) |= (.status = $status | .modified = $now)' \
    "$file" > "$tmp" && mv "$tmp" "$file"
  return 0
}

# kanban_block <id> <blocker_id> — add blocking dependency
# <id> is blocked by <blocker_id>
# Returns: 0 on success, 1 if either task not found
kanban_block() {
  local id="$1"
  local blocker_id="$2"
  local file
  file=$(kanban_tasks_file)

  # Validate both tasks exist
  local id_exists blocker_exists
  id_exists=$(jq -r --arg id "$id" '.tasks[] | select(.id == $id) | .id' "$file")
  blocker_exists=$(jq -r --arg id "$blocker_id" '.tasks[] | select(.id == $id) | .id' "$file")
  if [ -z "$id_exists" ] || [ -z "$blocker_exists" ]; then
    return 1
  fi

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp="${file}.tmp.$$"

  # Update both tasks atomically in one jq pass
  jq --arg id "$id" --arg blocker "$blocker_id" --arg now "$now" '
    # Add blocker to id.dependencies.blockedBy (deduplicated)
    (.tasks[] | select(.id == $id)) |=
      (.dependencies = (.dependencies // {"blockedBy": [], "blocks": []}) |
       .dependencies.blockedBy = ((.dependencies.blockedBy // []) + [$blocker] | unique) |
       .modified = $now) |
    # Add id to blocker.dependencies.blocks (deduplicated)
    (.tasks[] | select(.id == $blocker)) |=
      (.dependencies = (.dependencies // {"blockedBy": [], "blocks": []}) |
       .dependencies.blocks = ((.dependencies.blocks // []) + [$id] | unique) |
       .modified = $now)
  ' "$file" > "$tmp" && mv "$tmp" "$file"
  return 0
}

# kanban_unblock <id> [blocker_id] — remove blocking dependency
# If blocker_id is omitted, remove all blockers from <id>
# Returns: 0 on success, 1 if task not found
kanban_unblock() {
  local id="$1"
  local blocker_id="${2:-}"
  local file
  file=$(kanban_tasks_file)

  # Validate task exists
  local exists
  exists=$(jq -r --arg id "$id" '.tasks[] | select(.id == $id) | .id' "$file")
  if [ -z "$exists" ]; then
    return 1
  fi

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp="${file}.tmp.$$"

  if [ -n "$blocker_id" ]; then
    # Remove specific blocker — update both sides
    jq --arg id "$id" --arg blocker "$blocker_id" --arg now "$now" '
      # Remove blocker from id.dependencies.blockedBy
      (.tasks[] | select(.id == $id)) |=
        (.dependencies.blockedBy = ((.dependencies.blockedBy // []) - [$blocker]) |
         .modified = $now) |
      # Remove id from blocker.dependencies.blocks
      (.tasks[] | select(.id == $blocker)) |=
        (.dependencies.blocks = ((.dependencies.blocks // []) - [$id]) |
         .modified = $now)
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    # Remove all blockers from id
    # First collect current blockers to clean up the reverse links
    local blockers
    blockers=$(jq -r --arg id "$id" \
      '(.tasks[] | select(.id == $id) | .dependencies.blockedBy // []) | .[]' "$file")

    # Build a jq expression to clear reverse links from all former blockers
    jq --arg id "$id" --arg now "$now" '
      (.tasks[] | select(.id == $id)) |=
        (.dependencies.blockedBy = [] | .modified = $now) |
      (.tasks[] | select(.dependencies.blocks != null and (.dependencies.blocks | contains([$id])))) |=
        (.dependencies.blocks = (.dependencies.blocks - [$id]) | .modified = $now)
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  fi
  return 0
}

# ── Cycle Detection ───────────────────────────────────────────────────────────

# kanban_detect_cycle <id> <new_blocker_id>
# Check if adding new_blocker_id as a blocker of id would create a cycle.
# A cycle exists if id can transitively reach new_blocker_id via "blocks" edges.
# (i.e., id already blocks new_blocker_id, so making new_blocker_id block id creates a loop)
# Uses DFS starting from id, following blocks edges, looking for new_blocker_id.
# Returns: 0 if SAFE (no cycle), 1 if CYCLE DETECTED
kanban_detect_cycle() {
  local id="$1"
  local new_blocker="$2"
  local file
  file=$(kanban_tasks_file)

  # Build adjacency map (id -> [blocks]) and DFS from $id looking for $new_blocker
  local result
  result=$(jq -r --arg start "$id" --arg target "$new_blocker" '
    # Build map: task_id -> [ids it blocks]
    reduce .tasks[] as $t ({}; .[$t.id] = ($t.dependencies.blocks // [])) as $adj |
    # DFS from $start following blocks edges, looking for $target
    def dfs(visited; node):
      if node == $target then "cycle"
      elif (visited | contains([node])) then "safe"
      else
        reduce ($adj[node] // [])[] as $next (
          "safe";
          if . == "cycle" then "cycle"
          else dfs(visited + [node]; $next)
          end
        )
      end;
    dfs([]; $start)
  ' "$file" 2>/dev/null || echo "safe")

  if [ "$result" = "cycle" ]; then
    return 1
  fi
  return 0
}
