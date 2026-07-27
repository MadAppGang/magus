# Release Notes

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `RELEASES.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

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
