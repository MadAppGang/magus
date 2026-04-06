# MCP Server: downloads_path TCC failure + SingletonLock contention with multiple sessions

## Summary

The built-in `BrowserUseServer` MCP server has two bugs in `browser_use/mcp/server.py` that cause failures when:

1. Running on macOS (TCC blocks `~/Downloads` access)
2. Running multiple MCP server instances (e.g., multiple Claude Code sessions)

---

## Bug 1: `downloads_path` defaults to `~/Downloads/browser-use-mcp` — TCC permission denied on macOS

**Location:** `server.py` line ~583, `_init_browser_session()`

**Problem:**

`downloads_path` defaults to `Path.home() / "Downloads" / "browser-use-mcp"`. On macOS, the TCC (Transparency, Consent, and Control) framework blocks Python processes from creating directories in `~/Downloads` without explicit Full Disk Access permission. This triggers `[Errno 1] Operation not permitted` before Chrome even launches.

**Impact:**

The MCP server fails on the first tool call for any macOS user who hasn't granted their terminal Full Disk Access. This is a silent failure from the user's perspective — Chrome never opens, the tool returns an error, and the fix is non-obvious.

**Suggested fix:**

Use `~/.config/browseruse/downloads` instead. This is in the same config tree browser-use already uses (`~/.config/browseruse/profiles/default`), and doesn't require TCC permissions.

```python
# Before
downloads_path = Path.home() / "Downloads" / "browser-use-mcp"

# After
downloads_path = Path.home() / ".config" / "browseruse" / "downloads"
```

---

## Bug 2: `user_data_dir` defaults to shared path — Chrome SingletonLock blocks concurrent sessions

**Location:** `server.py` line ~586, `_init_browser_session()`

**Problem:**

`user_data_dir` defaults to `~/.config/browseruse/profiles/default`. When multiple MCP server processes start (e.g., one per Claude Code session), Chrome's SingletonLock mechanism causes contention:

1. First process launches Chrome and acquires the lock (`SingletonLock` symlink → `hostname-PID`)
2. Second process tries to launch Chrome with the same `--user-data-dir`
3. Chrome detects the lock and opens a tab in the **existing** Chrome instance instead of launching a new one
4. The second MCP server never gets a WebSocket connection → `BrowserStartEvent` times out after 30s

**Observed state:**

On a developer machine with 15+ Claude Code sessions open, 36 MCP server processes were running, all contending for the same Chrome profile lock. Only the first session that acquired the lock was functional.

**Suggested fix:**

Include a unique identifier (PID or UUID) in the profile path so each MCP server process gets its own Chrome instance:

```python
import os

# Before
user_data_dir = Path.home() / ".config" / "browseruse" / "profiles" / "default"

# After
user_data_dir = Path.home() / ".config" / "browseruse" / "profiles" / f"session-{os.getpid()}"
```

---

## Related: `_retry_with_browser_use_agent` has the same issue

The `_retry_with_browser_use_agent` function (line ~682) constructs a separate `BrowserProfile` that also uses the shared config defaults, so it has the same SingletonLock contention problem when called from multiple concurrent sessions.

---

## Environment

- **browser-use version:** 0.12.5
- **OS:** macOS 15.5 (Darwin 25.3.0)
- **Python:** 3.14
- **MCP client:** Claude Code (launches one MCP server process per session)

---

## Workaround

Until a fix is released, create `~/.config/browseruse/config.yaml` to override both paths:

```yaml
profile:
  downloads_path: ~/.config/browseruse/downloads
  user_data_dir: ~/.config/browseruse/profiles/my-session
```

Note that this workaround only resolves the issue for users who know to configure it. The SingletonLock problem will still affect any user running multiple sessions without per-session profile paths.
