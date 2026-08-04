# Release Notes

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `RELEASES.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## Statusline Plugin v2.3.1 (2026-08-04)

**Tag:** `plugins/statusline/v2.3.1`

### Overview

Two label changes, no behaviour change. `MEM:1.1G` becomes **`RAM 1.1G`**, and the Claude-edits diff chip becomes **🤖**. Both are about the same thing: making a glance at the statusline unambiguous.

### What's Changed

- **`MEM:` → `RAM `.** The number is the resident set of the Claude Code process and always has been — but in this product's context the word "memory" reads as LLM/agentic memory (MEMORY.md, mnemex, conversation recall) rather than RAM. The segment now renders `RAM 1.1G`: the label, one space, the value, no colon.

  Deliberately **no emoji or glyph** was added. A brain would deepen exactly the ambiguity being fixed, and a neutral glyph reintroduces the "what does this mean?" question that an explicit three-letter word already answers. Dim-cyan styling, placement, and the value itself are untouched.

- **`✨ +N/-M` → `🤖 +N/-M`** for the Claude-edits chip. The two diff chips now pair semantically: 🤖 (U+1F916) is what the agent wrote in this conversation, `⎇` is what is uncommitted in git. The sparkle was decorative and carried no meaning of its own. Both glyphs are East Asian Wide, so column alignment is byte-for-byte unchanged; colour, `+N/-M` formatting, and the hide-when-zero rule are untouched.

### Compatibility

The config key stays **`.sections.memory`** (`SHOW_MEMORY`) even though the label now reads `RAM`. Renaming it to `ram` would silently break every existing `~/.claude/statusline-config.json` that disables the segment, and the key is not what a user reads on screen. A comment in the script records the intentional mismatch.

All 9 shipped fixtures render correctly; no logic path changed.

### Upgrading

`/statusline:install` deploys a **copy** of the script to `~/.claude/statusline-command.sh`. Updating the plugin does not update that copy — re-run `/statusline:install` to pick this release up.

---

---

## Statusline Plugin v2.3.0 (2026-08-04)

**Tag:** `plugins/statusline/v2.3.0`

### Overview

**The `MEM:` segment has never shown Claude Code's memory.** It was measuring the statusline script's own shell. On the machine this was found on it reported `MEM:2M` while Claude Code was using 1.09 GB — and the fix changes that reading to `MEM:1.0G`. Alongside it, the uncommitted-changes chip gets a glyph that reads as git.

### What's Fixed

- **`MEM:` measured the wrong process.** `find_claude_pid()` walked up the process tree matching any command containing `claude`. The statusline runs as `bash ~/.claude/statusline-command.sh` — that path contains "claude" — so the very first process examined matched, and the function returned the script's own shell every time. The segment reported 2–3 MB from the day it shipped.

  ```
  before:  … | MEM:2M   | ✨ +128/-34  ● +159/-21 | …
  after:   … | MEM:1.0G | ✨ +128/-34  ⎇ +159/-21 | …
  ```

- **The matcher now identifies the entrypoint, not a substring.** It reads `argv[0]` and accepts three shapes, all verified against live processes:

  | Shape | Example |
  |---|---|
  | basename exactly `claude` | `claude --dangerously-skip-permissions`, `/Users/x/.local/bin/claude --resume …`, `…/ClaudeCode.app/Contents/MacOS/claude`, `…/claude-agent-sdk-darwin-arm64/claude` |
  | command contains `@anthropic-ai/claude-code` | `node …/@anthropic-ai/claude-code/cli.js` — npm install, where `argv[0]` is the interpreter |
  | native versioned launcher | `/Users/x/.local/share/claude/versions/2.1.220 --session-id …` — `argv[0]` has no "claude" basename at all |

  Rejected: `/bin/zsh -c source ~/.claude/shell-snapshots/…`, `bash ~/.claude/statusline-command.sh`, and `op run … -- claude …` (a launcher wrapping Claude, not Claude). A rejection continues the walk upward instead of ending it, under the same 10-level depth cap as before.

- **No Claude Code ancestor now means no segment.** Previously unreachable, since something always matched; the fallback is explicitly "render nothing" rather than "report whatever is nearby".

- **The PID cache self-heals.** `~/.claude/.statusline-pid-cache-<session>` files written by 2.2.0 and earlier contain the wrong PID. Liveness was the only check, so a wrong-but-alive PID persisted for the life of the session. The cached value is now re-tested against the entrypoint criteria on every render, so existing caches heal on the next paint with no user action.

- **`fmt_mem` could print `1.10G`.** The tenths digit was `(kb % 1GB) / 104857`, which evaluates to 10 in the top ~6 KB of every gigabyte. Now `(kb % 1GB) * 10 / 1GB`, which cannot exceed 9. Verified: 1048576 KB → `1.0G`, 250000 KB → `244M`, 2097151 KB → `1.9G` (was `1.10G`).

- **A latent zsh bug, exposed by walking further.** A bare `local ppid` re-declared on the second loop iteration makes zsh echo `ppid=<value>` to stdout, which was concatenated into the function's return value and blanked the segment. Never visible before, because the old matcher returned at depth 0 and never reached a second iteration. Declared-and-assigned in one statement; output verified identical under `bash` and `zsh`.

### What's Changed

- **The uncommitted-changes chip is `⎇ +N/-M`**, previously `● +N/-M`. A yellow filled circle carried no meaning; U+2387 (BRANCHING) reads as git at a glance. It is plain Unicode, deliberately not the Powerline branch glyph U+E0A0 — that lives in the Unicode private use area and renders as a blank box without a Nerd Font. Colour and number formatting are unchanged, and the `✨` Claude-edits chip is untouched, so the two chips remain easy to tell apart side by side.

### Upgrading

`/statusline:install` deploys a **copy** of the script to `~/.claude/statusline-command.sh`. Updating the plugin does not update that copy — re-run `/statusline:install` to pick this release up.

---

---

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
