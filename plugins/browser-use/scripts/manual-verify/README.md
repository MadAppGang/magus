# Live verification harness (browser-use v1.2.0 tools)

These scripts drive the **real** `MagusBrowserServer` handlers against a live
headless Chrome via CDP — they verify behavior the mocked `test_mcp_server.py`
unit suite cannot (that the CDP params actually work on a page). They are NOT run
in CI (they need Chrome + network); run them by hand when changing the
`browser_evaluate` / keyboard / focus code paths.

## The three test layers (use the right one)

| Layer | File | Drives | Needs Chrome? | In CI? |
|---|---|---|---|---|
| Handler unit tests | `../test_mcp_server.py` | `_handle_*` directly, mocked CDP | No | Yes |
| Protocol integration | `../test_mcp_protocol.py` | real MCP `tools/call` via the SDK's in-memory client (`mcp.shared.memory.create_connected_server_and_client_session`) — same path Claude Code uses | No | Yes |
| Live CDP gate | this dir | real handlers vs real headless Chrome | **Yes** | No |

`test_mcp_protocol.py` is the automated stand-in for "call the tool in a real
Claude session": it spawns no subprocess and needs no Chrome, but exercises the
real protocol envelope (dispatch, schema sanitization, result serialization) that
the handler-level unit tests bypass. Prefer it over the MCP Inspector for
automation — Inspector's `--cli` mode works but is a human-first Node tool that
spins up a localhost UI proxy.

## Why these exist

The unit suite mocks the CDP client, so it proves dispatch wiring and schema but
not that, e.g., a synthetic `Cmd+A` truly selects-all. A live run caught exactly
that: `dispatchKeyEvent` with `modifiers: 4` alone does **not** select-all —
Chrome requires the `commands: ["selectAll"]` field on the keyDown. These
harnesses are the gate that catches such CDP-correctness gaps.

## Run

Requires `browser-use` installed and a Chrome/Chromium present (`browser_doctor`
reports both).

```sh
SERVER=../mcp-server.py   # path to the plugin's mcp-server.py

# Full Monaco scenario (the bug report's headline case). Serve the page over
# HTTP so the CDN-loaded Monaco works (a file:// origin blocks some CDN fetches):
python3 -m http.server 8799 &   # cwd containing monaco-page.html (rename to index.html or pass the URL)
python3 live_repro.py "$SERVER" "http://localhost:8799/monaco-page.html"

# Full keyboard surface (Backspace, arrows+count, Enter/Escape, Meta+a+Delete):
python3 keyboard_repro.py "$SERVER"
```

Each prints `[PASS]/[FAIL]` lines and exits non-zero on any failure.
