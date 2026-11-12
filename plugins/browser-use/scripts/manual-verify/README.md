# Live checks against real Chromium

These scripts start the plugin's full MCP server as a subprocess (`mcp-server.py`
without `--lazy`, so no front sits in between) and call its tools over stdio against a
real Chromium. They check what the
unit suite cannot: that the CDP commands behind `browser_evaluate`, `browser_focus`,
`browser_press_key` and `browser_keyboard` actually act on a page. They are not run
in CI. Run them by hand after changing those code paths.

## The test layers

| Layer | File | Drives | Needs Chromium? | In CI? |
|---|---|---|---|---|
| Handler unit tests | `../test_mcp_server.py` | handlers directly, recorded CDP calls | No | Yes |
| Protocol | `../test_mcp_protocol.py` | real MCP `tools/call` through the SDK's in-memory client | No | Yes |
| Stdio process | `../test_mcp_stdio.py` | the server as a subprocess, no browser | No | Yes |
| Lifecycle | `../test_e2e_lifecycle.py` | the server as a subprocess, real Chromium: launch, page round trip, cleanup | Yes | Yes (e2e job) |
| Keyboard and editors | this directory | the server as a subprocess, real Chromium: keys, focus, evaluate, Monaco | Yes | No |

## Why these exist

A recorded CDP call proves the server sent it, not that Chrome acted on it. A live
run is what found that a synthetic `Meta+A` (`modifiers: 4`) selects nothing unless
the keyDown also carries `commands: ["selectAll"]`.

## Run

Use an interpreter with the server's pinned dependencies: the env
`uv sync --no-config --script ../mcp-server.py` builds (find it with
`uv python find --no-config --script ../mcp-server.py`), or any venv holding the
versions in the header. Playwright's Chromium must be installed (`magus doctor --fix`).

```sh
cd plugins/browser-use/scripts/manual-verify

# Keys, shortcuts, focus and evaluate on a data: URL page. No network.
<env python> keyboard_repro.py

# Monaco editor: setValue via evaluate, and typing into its hidden textarea.
# Serves monaco-page.html itself on 127.0.0.1; Monaco loads from cdnjs, so it needs network.
<env python> live_repro.py
```

`stdio_server.py` is the shared launcher. It gives the server a temp `HOME`, a short
temp `BH_HOME` and no API keys, resolves Chromium once from your real `HOME`, and runs
it headless (`HEADED=1` to watch). Each script prints `[PASS]`/`[FAIL]` lines and exits
non-zero on any failure. Nothing here calls a model or a cloud browser.
