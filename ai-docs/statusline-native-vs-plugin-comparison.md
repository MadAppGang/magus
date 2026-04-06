# Statusline Plugin vs Native Claude Code Statusline — Comparison Report

**Date:** 2026-03-20
**Scope:** Read-only research. No files modified.
**Sources:**
- Local binary analysis: `/Users/jack/.local/share/claude/versions/2.1.80` (extracted via `strings`)
- Plugin source: `/Users/jack/mag/magus/plugins/statusline/scripts/statusline.sh`
- Installed script: `/Users/jack/mag/magus/.claude/statusline-command.sh`
- Plugin manifest: `/Users/jack/mag/magus/plugins/statusline/plugin.json`
- Plugin skill: `/Users/jack/mag/magus/plugins/statusline/skills/statusline-customization/SKILL.md`

---

## 1. Native Claude Code Statusline — Full JSON Schema

Extracted from the Claude binary (v2.1.80) `c9$` function that constructs the JSON passed to `statusLine` commands. This is the **definitive, authoritative schema** as of v2.1.80 (2026-03-19):

```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/transcript.json",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "agent_id": "...",            // optional: only when inside a subagent
  "agent_type": "...",          // optional: e.g. "general-purpose"
  "session_name": "...",        // optional: named sessions only

  "model": {
    "id": "claude-sonnet-4-6-20251101",
    "display_name": "Claude Sonnet 4.6"
  },

  "workspace": {
    "current_dir": "/current/working/directory",
    "project_dir": "/root/project/directory",
    "added_dirs": []
  },

  "version": "2.1.80",

  "output_style": {
    "name": "default"
  },

  "cost": {
    "total_cost_usd": 1.23,
    "total_duration_ms": 183000,
    "total_api_duration_ms": 150000,
    "total_lines_added": 42,
    "total_lines_removed": 8
  },

  "context_window": {
    "total_input_tokens": 45000,
    "total_output_tokens": 3200,
    "context_window_size": 200000,
    "current_usage": 45000,
    "used_percentage": 22.5,
    "remaining_percentage": 77.5
  },

  "exceeds_200k_tokens": false,

  "rate_limits": {              // optional: only if plan data is available
    "five_hour": {
      "used_percentage": 35,   // NOTE: already multiplied by 100 (0-100 scale)
      "resets_at": "2026-03-20T16:00:00Z"
    },
    "seven_day": {
      "used_percentage": 18,
      "resets_at": "2026-03-27T00:00:00Z"
    }
  },

  "vim": { "mode": "INSERT" },  // optional: only in vim mode

  "agent": { "name": "..." },   // optional: only in subagent context

  "remote": {                   // optional: only in remote session
    "session_id": "..."
  },

  "worktree": {                 // optional: only in worktree session
    "name": "statusline",
    "path": "/path/to/.worktrees/statusline",
    "branch": "main",
    "original_cwd": "/path/to/original",
    "original_branch": "main"
  }
}
```

### How Rate Limits Reach the JSON

The native binary reads rate limit utilization from API response headers
(`anthropic-ratelimit-unified-5h-utilization`, `anthropic-ratelimit-unified-7d-utilization`)
and stores them in an in-memory state (`QGT`). The `D37()` function reads that state and
the `c9$` function converts `utilization` (0.0-1.0 float) to `used_percentage` (0-100) before
inserting into the JSON. The rate limits are populated from live API response headers, not polled separately.

### Native /statusline Command

Claude Code has a built-in `/statusline` slash command (source: `"builtin"`). When invoked:
- Launches a `"statusline-setup"` subagent
- Allowed tools: `Task`, `Read(~/**)`, `Edit(~/.claude/settings.json)`
- Default prompt: `"Configure my statusLine from my shell PS1 configuration"`
- The subagent configures the `statusLine` field in `settings.json`

The `/statusline` command appears in UI hints: `"Use /statusline to set up a custom status line that will display beneath the input box"`.

### Native statusLine Schema in settings.json

```json
{
  "statusLine": {
    "type": "command",       // only type supported
    "command": "bash .claude/statusline-command.sh",
    "padding": 1             // optional: number, horizontal padding
  }
}
```

---

## 2. Our Plugin — What We Currently Implement

### Fields We USE from the JSON stdin

| Field | Used For |
|-------|----------|
| `model.display_name` | Model name display (Opus/Sonnet/Haiku shortening) |
| `cost.total_cost_usd` | Cost display (`$1.23`) |
| `cost.total_duration_ms` | Duration display (`3m3s`) |
| `context_window.used_percentage` | Context bar fill + percentage label |
| `context_window.context_window_size` | Token count display (`156k/200k`) |
| `context_window.total_input_tokens` | Compaction detection (compare to cached value) |
| `cwd` | Git branch + worktree detection via `git rev-parse` |
| `session_id` | Per-session caches (token cache, worktree marker) |

### Fields We DON'T USE from the JSON stdin

| Field | Current Status | Notes |
|-------|---------------|-------|
| `rate_limits.five_hour.used_percentage` | **Unused** | We make our own API call for this |
| `rate_limits.five_hour.resets_at` | **Unused** | Same — we poll the API ourselves |
| `rate_limits.seven_day.used_percentage` | **Unused** | Same |
| `rate_limits.seven_day.resets_at` | **Unused** | Same |
| `worktree.name` | **Unused** | We detect via git dir comparison instead |
| `worktree.branch` | **Unused** | We detect via `git branch --show-current` |
| `worktree.path` | **Unused** | Not used at all |
| `worktree.original_cwd` | **Unused** | Not used at all |
| `worktree.original_branch` | **Unused** | Not used at all |
| `workspace.current_dir` | **Unused** | We use `cwd` (top-level) for git ops |
| `workspace.project_dir` | **Unused** | Potentially useful |
| `context_window.remaining_percentage` | **Unused** | Computed from `used_percentage` |
| `context_window.current_usage` | **Unused** | We compute from PCT * size |
| `context_window.total_output_tokens` | **Unused** | Not displayed |
| `exceeds_200k_tokens` | **Unused** | Could trigger warning display |
| `cost.total_api_duration_ms` | **Unused** | Only `total_duration_ms` used |
| `cost.total_lines_added` | **Unused** | Could add diff stats to display |
| `cost.total_lines_removed` | **Unused** | Could add diff stats to display |
| `vim.mode` | **Unused** | Could show INSERT/NORMAL in statusline |
| `agent.name` | **Unused** | Could indicate when in subagent context |
| `output_style.name` | **Unused** | Not relevant for display |
| `transcript_path` | **Unused** | Not relevant for display |
| `permission_mode` | **Unused** | Not relevant for display |
| `version` | **Unused** | Not relevant for display |
| `model.id` | **Unused** | We use `display_name` only |

### What We Build Ourselves (Custom Logic)

| Feature | Our Mechanism | Status |
|---------|--------------|--------|
| Plan limits (5h/7d) | macOS Keychain token extraction + curl to Anthropic API + 60s TTL cache | **Entirely reimplemented — native JSON has this data** |
| Git branch detection | `git branch --show-current` on `$cwd` | **Partially reimplemented — native JSON passes `worktree.branch`** |
| Worktree detection | Compare `git rev-parse --git-dir` vs `--git-common-dir` | **Entirely reimplemented — native JSON has `worktree.name`** |
| Worktree fallback | Per-session marker file (`~/.claude/.statusline-worktree-${SESSION_ID}`) | **Workaround for compaction — now redundant if we use native fields** |
| Compaction detection | Compare `total_input_tokens` to per-session cache file | **Custom — no native equivalent** |
| Token count display | Compute from PCT * context_window_size | **Partially redundant — native has `current_usage` directly** |
| Themes (4 themes) | Hardcoded ANSI escape codes | **Unique — no native equivalent** |
| Section toggling | `~/.claude/statusline-config.json` | **Unique — no native equivalent** |

---

## 3. Gap Analysis

### 3a. Plan Limits — MAJOR redundancy

**What we do:** Our script extracts an OAuth token from the macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`), calls `https://api.anthropic.com/api/oauth/usage` via `curl`, and caches the result for 60 seconds in `~/.claude/.statusline-usage-cache.json`. We read `.five_hour.utilization` (0.0-1.0 float) from that cache.

**What native provides:** The `rate_limits` object in the stdin JSON already contains `five_hour.used_percentage` (already on 0-100 scale) and `seven_day.used_percentage`, plus `resets_at` timestamps for both. This data comes directly from API response headers, so it is inherently up-to-date (no polling needed).

**Critical field name mismatch:** Our usage cache uses `.five_hour.utilization` (0-1 float from the raw API), while the native JSON provides `.rate_limits.five_hour.used_percentage` (0-100 integer). If we switch to reading from native JSON stdin, we must change the jq field paths.

**Recommendation:** Read `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` directly from stdin. Remove the entire Keychain + curl + cache + background subshell block (~30 lines). This eliminates:
- macOS-only Keychain dependency
- curl network call (even backgrounded, adds overhead)
- Cache file management
- Potential permission prompt spam

**Caveat:** The native `rate_limits` object is only present when Claude Code has rate limit data (i.e., when the user has actually made API calls in this session). On first launch, it may be absent. The graceful fallback (no plan bar shown) already exists in our code.

### 3b. Worktree Detection — MAJOR redundancy

**What we do:** We `cd "$CWD"` and run `git rev-parse --git-dir` vs `--git-common-dir`, then compare canonical paths. We also maintain a per-session worktree marker file as a fallback for compaction survival.

**What native provides:** The `worktree` object in stdin directly gives us:
- `name` — the worktree name
- `branch` — the branch the worktree is on
- `path` — the absolute worktree path
- `original_cwd` — the main repository directory
- `original_branch` — the main repository's branch

This is populated by Claude Code itself when it creates or resumes a worktree session. It is 100% accurate and requires no filesystem or git calls.

**Recommendation:** Read `worktree.name` and `worktree.branch` from stdin. If present, use them directly instead of running git commands. The worktree marker file fallback mechanism becomes unnecessary (the native data survives context compaction because it's re-injected fresh on each statusline render).

**Important note:** The native `worktree` object is only present when Claude Code itself manages the worktree (via `/worktree` command or `--worktree` flag). Manual worktrees (user `cd`s into a worktree dir) will NOT have this field. Our git-based detection handles that case. So the correct logic is: check `worktree.name` first (native), fall back to git detection for manually-entered worktrees.

### 3c. Git Branch — Partial redundancy

**What we do:** We run `git branch --show-current` on `$cwd`.

**What native provides:** `worktree.branch` for worktree sessions. For non-worktree sessions, the native JSON does NOT provide a git branch — the script must detect it.

**Recommendation:** For worktree sessions, read `worktree.branch` directly. For regular sessions, keep the git call (no native equivalent).

### 3d. Token Count — Minor redundancy

**What we do:** We compute `CTX_USED_TOKENS = PCT * CTX_MAX_TOKENS / 100` to derive the current token count.

**What native provides:** `context_window.current_usage` — the exact current token count as an integer. This is more accurate than our integer division approximation.

**Recommendation:** Use `context_window.current_usage` instead of computing from percentage × size. Also consider displaying `context_window.total_output_tokens` for extra insight.

### 3e. `exceeds_200k_tokens` Flag — Currently unused

**What native provides:** A boolean `exceeds_200k_tokens` that is true when the context exceeds 200k tokens.

**What we do:** We show a `⚡` warning when `PCT >= 80`. The native flag provides a complementary signal (absolute size, not just relative usage).

**Recommendation:** Display a distinct indicator when `exceeds_200k_tokens` is true (e.g., a `★` or different bar color), in addition to the existing `⚡` for high relative usage.

### 3f. Vim Mode — Currently unused

**What native provides:** `vim.mode` = "INSERT" or "NORMAL" when the user is in vim mode.

**Recommendation:** Add an optional `vim` section that shows the current vim mode when present. This is particularly useful for users who use vim keybindings.

### 3g. padding Setting — Currently unused

**What native provides:** The `statusLine` settings schema supports an optional `padding` field (number) for horizontal padding in the Ink React component.

**What we do:** We don't configure this.

**Recommendation:** Document the `padding` option in the install command and SKILL.md.

### 3h. Native /statusline Command vs Our Plugin Command

**Native:** Claude Code has a built-in `/statusline` slash command (source: `"builtin"`) that launches a `"statusline-setup"` subagent to configure the `statusLine` setting. It reads from `~/**` and writes to `~/.claude/settings.json`.

**Our plugin:** We have three commands: `/statusline:install-statusline`, `/statusline:uninstall-statusline`, and `/statusline:customize-statusline`.

**Potential conflict:** The native `/statusline` command configures a minimal statusline. After a user runs it, they might expect our richer plugin to work, but the native command doesn't know about our plugin. Conversely, our `/statusline:install-statusline` writes a different settings structure than what the native command expects.

**Recommendation:** In `install.md`, mention that the native `/statusline` command exists but produces a simpler output, and that our plugin supersedes it. Add a note to `SKILL.md` about this.

---

## 4. Concrete Improvement Recommendations

### Priority 1: Remove plan limits API call — read from stdin instead

Replace this block in `statusline.sh` (lines 234-271):
```bash
# ── Plan usage limits (non-blocking cache) ────────────────
USAGE_CACHE="$HOME/.claude/.statusline-usage-cache.json"
# ... entire curl + Keychain + background subshell block ...
```

With:
```bash
# ── Plan usage limits (from native JSON) ──────────────────
FIVE_HR=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null | cut -d. -f1)
SEVEN_DAY=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null | cut -d. -f1)
FIVE_HR_RESET=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty' 2>/dev/null)
SEVEN_DAY_RESET=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty' 2>/dev/null)
```

This eliminates ~30 lines of infrastructure and removes macOS Keychain dependency.

### Priority 2: Use native worktree data — remove git-based detection for managed worktrees

Replace the current worktree detection logic with:
```bash
# Try native worktree data first (reliable, compaction-safe)
NATIVE_WT_NAME=$(echo "$input" | jq -r '.worktree.name // empty' 2>/dev/null)
NATIVE_WT_BRANCH=$(echo "$input" | jq -r '.worktree.branch // empty' 2>/dev/null)

BRANCH=""
WORKTREE_NAME=""

if [ -n "$NATIVE_WT_NAME" ]; then
  # Native worktree session — use provided data directly
  WORKTREE_NAME="$NATIVE_WT_NAME"
  BRANCH="$NATIVE_WT_BRANCH"
elif [ -n "$CWD" ] && cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  # Fall back to git detection for manually-entered worktrees or regular repos
  BRANCH=$(git branch --show-current 2>/dev/null)
  [ -z "$BRANCH" ] && BRANCH=$(git rev-parse --short HEAD 2>/dev/null)
  GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
  GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
  GIT_DIR=$(cd "$GIT_DIR" 2>/dev/null && pwd)
  GIT_COMMON=$(cd "$GIT_COMMON" 2>/dev/null && pwd)
  if [ "$GIT_DIR" != "$GIT_COMMON" ]; then
    WORKTREE_NAME=$(basename "$CWD")
  fi
fi
# Remove the per-session worktree marker file fallback (no longer needed for native worktrees)
```

This eliminates the marker file mechanism (~15 lines).

### Priority 3: Use native current_usage for token count

Replace:
```bash
CTX_USED_TOKENS=0
if [ "$CTX_MAX_TOKENS" -gt 0 ] 2>/dev/null; then
  CTX_USED_TOKENS=$((PCT * CTX_MAX_TOKENS / 100))
fi
```

With:
```bash
CTX_USED_TOKENS=$(echo "$input" | jq -r '.context_window.current_usage // 0' 2>/dev/null)
```

More accurate (avoids integer rounding error).

### Priority 4: Add exceeds_200k_tokens indicator

Add after the existing `⚡` check:
```bash
EXCEEDS_200K=$(echo "$input" | jq -r '.exceeds_200k_tokens // false' 2>/dev/null)
if [ "$EXCEEDS_200K" = "true" ] 2>/dev/null; then
  CTX_SECTION="${CTX_SECTION} ${C_RED}${B}200k+${R}"
fi
```

### Priority 5: Add optional vim mode display

```bash
VIM_MODE=$(echo "$input" | jq -r '.vim.mode // empty' 2>/dev/null)
if [ -n "$VIM_MODE" ]; then
  append_section "${C_CYAN}${VIM_MODE}${R}"
fi
```

### Priority 6: Update SKILL.md documentation

Update the "Input JSON Schema" section in `SKILL.md` to reflect the full native schema. Currently the documented schema is incomplete:
```json
{
  "model": { "display_name": "Claude Opus 4.6" },
  "cost": { "total_cost_usd": 1.23, "total_duration_ms": 180000 },
  "context_window": { "used_percentage": 45.2 },
  "cwd": "/path/to/project"
}
```
Should be updated to show all fields including `rate_limits`, `worktree`, `workspace`, `exceeds_200k_tokens`, `vim`, etc.

### Priority 7: Update install command to document padding

In `install.md`, show the extended settings schema:
```json
{
  "type": "command",
  "command": "bash .claude/statusline-command.sh",
  "padding": 1
}
```

---

## 5. Summary Table — What's Native vs Custom

| Feature | Native JSON Field | Our Custom Code | Status |
|---------|------------------|----------------|--------|
| Model name | `model.display_name` | Read + shorten to Opus/Sonnet/Haiku | Used correctly |
| Cost | `cost.total_cost_usd` | Format to `$1.23` | Used correctly |
| Duration | `cost.total_duration_ms` | Format to `3m4s` | Used correctly |
| Context % | `context_window.used_percentage` | Bar + label | Used correctly |
| Context tokens | `context_window.current_usage` | Computed from PCT x size | Approximation — use native |
| Git branch | Not provided (except in worktrees) | `git branch --show-current` | Necessary for regular repos |
| Worktree name | `worktree.name` | Git dir comparison | Reimplemented — use native |
| Worktree branch | `worktree.branch` | Git detection | Reimplemented — use native |
| Plan 5h | `rate_limits.five_hour.used_percentage` | Keychain + curl API | Major reimplementation |
| Plan 7d | `rate_limits.seven_day.used_percentage` | Same as above | Major reimplementation |
| Plan resets_at | `rate_limits.*.resets_at` | Same as above | Major reimplementation |
| Compaction | None | Token count cache comparison | No native equivalent — keep |
| 200k warning | `exceeds_200k_tokens` | `PCT >= 80` approximation | Add native field |
| Vim mode | `vim.mode` | Not implemented | New opportunity |
| Themes | None | 4 ANSI themes | Unique, keep |
| Section toggle | None | Config JSON | Unique, keep |

---

## 6. Risk Assessment for Changes

| Change | Risk | Benefit |
|--------|------|---------|
| Remove API polling for plan limits | Low — native data is more reliable | Removes macOS-only Keychain hack, removes network dependency, faster render |
| Use native `worktree.*` fields | Low — falls back to git detection | Eliminates marker files, more reliable across sessions |
| Use `current_usage` for token count | Very Low | Slightly more accurate token count |
| Add `exceeds_200k_tokens` indicator | Very Low | Better warning for truly large contexts |
| Add vim mode display | Very Low (opt-in section) | Useful for vim users |
| Keep compaction detection | N/A — no change | Unique capability with no native equivalent |
| Keep theme system | N/A — no change | Unique capability |

---

## 7. What Native Claude Code Does NOT Provide

These features have no native equivalent and represent genuine plugin value:
1. **Colorful output with themes** — native Claude Code shows plain text statuslines; all color is custom
2. **Section toggling via config file** — no native way to enable/disable individual sections
3. **Compaction detection** — native JSON provides `total_input_tokens` which enables our detection, but the detection logic itself is custom
4. **The `⚡` high-context warning** — derived from native `used_percentage` but custom behavior
5. **Custom color gradients** (green→yellow→orange→red) for context and plan bars
6. **Dual-bar plan visualization** (top=5h, bottom=7d, half-block characters)
7. **Human-formatted countdowns** for plan resets (e.g., `↻1h40m`)

---

*Generated by investigative analysis of Claude binary v2.1.80 and plugin source files.*
