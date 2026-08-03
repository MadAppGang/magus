# Release Notes

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `RELEASES.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## Statusline Plugin v2.2.0 (2026-08-03)

**Tag:** `plugins/statusline/v2.2.0`

### Overview

**claudish-aware plan limits.** When a session is proxied through [claudish](https://github.com/MadAppGang/claudish) to a non-Anthropic provider, the statusline no longer reports Anthropic plan usage — those percentages describe an account the session is not spending. In its place, the active provider's own plan windows render when claudish exposes them.

### What's New

- **Routing detection** — `CLAUDISH_ACTIVE_MODEL_NAME` or `CLAUDISH_TOKEN_FILE` in the environment is sufficient proof the session is routed. Either variable alone flips the statusline into claudish mode; `CLAUDISH_ACTIVE_MODEL_NAME` is always exported, `CLAUDISH_TOKEN_FILE` from claudish 7.29.
- **Provider plan segment** — when `CLAUDISH_TOKEN_FILE` carries a `plan` block, it renders in the same visual language as the Anthropic segment: one bar coloured by the most-consumed window, per-window `id:pct%` labels, `↻` reset countdowns, and the same ≥80% critical highlight.

  ```json
  "plan": {
    "label": "GLM Coding Plan",
    "windows": [ { "id": "5h", "used_pct": 78, "resets_at": "2026-08-03T18:00:00Z" } ]
  }
  ```

  The window list is arbitrary-length with arbitrary ids — a provider may expose one window, three, or none, and nothing in the renderer assumes `5h`/`7d`.
- **`.sections.claudish_plan`** (default `true`) — hides the new segment on its own. The existing `.sections.plan_limits` still suppresses all plan output, claudish or not.

### What's Changed

- **Both Anthropic sources are cut when routed**, not just one. The native `.rate_limits` fields are blanked, *and* the `api.anthropic.com/api/oauth/usage` fallback poll is gated independently.

### Why

The two suppressions have to be independent, and that is the whole subtlety of this release. The fallback poll exists to cover the case where Claude Code's native fields are missing — so blanking those fields is precisely the condition that *triggers* it. Suppressing only the fields would have produced the exact bug it was meant to fix, with an added network round-trip.

Skipping the poll matters for a second reason: it writes `~/.claude/.statusline-usage-cache.json`. Letting a claudish session poll would leave a cache entry that the user's *real* Anthropic sessions later read as their own usage.

Degradation is silent by design. No provider ships the `plan` block today, so the common case renders **nothing** — no placeholder, no dangling separator. The claudish session simply shows no plan segment rather than a wrong one.

### Compatibility

Non-claudish sessions are byte-identical against all 9 shipped fixtures. The routing check is the only new branch on that path, and it is false whenever neither variable is set.

### Updated Files

- `plugins/statusline/scripts/statusline.sh`
- `plugins/statusline/commands/customize.md`
- `plugins/statusline/skills/statusline-customization/SKILL.md`
- `plugins/statusline/plugin.json`

---

---

## Code Analysis Plugin v4.0.0 (2026-03-03)

**Tag:** `plugins/code-analysis/v4.0.0`

### Overview

**MCP-based claudemem integration** — Major architecture shift from hook-based tool enforcement to native MCP server integration. claudemem tools are now available directly in Claude Code as MCP tools, eliminating the need for PreToolUse hooks that blocked native search tools.

### What's New

- **MCP server integration**: claudemem runs as an MCP server (`claudemem --mcp`) providing 18 tools directly to Claude Code
- **11 structured tools**: search, symbol, callers, callees, context, map, dead_code, test_gaps, impact, index_status, reindex
- **7 legacy tools**: backward-compatible tools for older workflows
- **Freshness metadata**: Every response includes `freshness: "fresh"|"stale"`, `lastIndexed`, `reindexingInProgress`
- **Auto-reindexing**: File watcher detects changes, reindexes in background with 2-minute debounce
- **ToolSearch discovery**: MCP tools are deferred and loaded on-demand via `ToolSearch("claudemem")`

### What's Removed

- **Entire hooks/ directory**: PreToolUse hooks that blocked Grep/Glob/Read/Bash
- **Hook enforcement system**: "INESCAPABLE" tool blocking, evasion detection, compliance tracking
- **State management**: hooks/state.ts, session-start.sh, handler.ts
- **Auto-reindex hook**: Replaced by MCP server's built-in file watcher

### Why

| Before (hooks) | After (MCP) |
|----------------|-------------|
| Block native tools, force claudemem | Tools available naturally, model chooses |
| Each block adds context tokens | Zero overhead — direct tool responses |
| Adversarial ("no workaround") | Cooperative (freshness signals) |
| No feedback on index staleness | Real-time freshness metadata |
| Bash-based hooks (fragile) | Proper MCP server (robust) |

### E2E Test Coverage

5 test cases with 100% pass rate (20/20 checks):
- index-status-01, search-code-02, map-architecture-03, symbol-lookup-04, freshness-check-05

---

---

## Code Analysis Plugin v1.3.2 (2025-11-25)

**Tag:** `plugins/code-analysis/v1.3.2`

### 🎯 Overview

**User Choice for Analysis Agents** - The detective agent now respects your default model setting.

### ✨ What's New

- Removed `model: sonnet` from: `codebase-detective`

---
