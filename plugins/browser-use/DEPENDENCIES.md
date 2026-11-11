# Browser Use Plugin — Dependencies

The MCP server is a PEP 723 script. `.mcp.json` launches it with
`uv run --no-config --script`, and uv builds the Python environment its header
declares:

```python
# requires-python = ">=3.11"
# dependencies = ["browser-use==1.0.0", "mcp==2.3.0", "playwright==1.63.0"]
```

browser-use 1.0.0 in turn pins `browser-harness==0.1.13` exactly, so that version comes
with it.

Every uv call on that env passes `--no-config`. Claude Code starts the server in
your project, and uv would otherwise read that project's `uv.toml` or
`pyproject.toml`: its package index, Python preference or `offline` setting
would decide what the plugin imports, and the env built there is shared by every
project.

Nothing is installed into a system Python, so there is no `pip install` step
and no PEP 668 conflict. The machine needs uv, the env, and Playwright's
Chromium. `plugin.json` declares all four in `requires`; a session start reports
any that are missing, and one command installs them:

```bash
magus doctor --fix
```

No magus-cli yet? `bun add -g magus-cli`, then `magus doctor --fix`.

## What is declared, and how each is checked

| Requirement | Check | Installed by `magus doctor --fix` |
|---|---|---|
| `uv` | `uv --version` | `brew install uv` (macOS), else uv's own installer into `~/.local/bin` |
| `browser-use-env` | `uv run --offline --no-config --script scripts/mcp-server.py --check-env` | `uv run --no-config --script scripts/mcp-server.py --check-env` (builds the env) |
| `chromium-libs` (Linux) | `… --check-chromium-libs` | `sudo -n env DEBIAN_FRONTEND=noninteractive <env python> -B -m playwright install-deps chromium` |
| `chromium` | `… --check-chromium` | `<env python> -B -m playwright install chromium` |

The three `--check-*` flags read files only (see `scripts/browser_env.py`); none
starts a browser, apt or the Playwright driver. `--check-chromium` and
`--check-chromium-libs` both ask the launcher's own resolver whether it would find
a Chromium to start, so a session start never reports missing a browser the server
launches. A cached Chromium counts when Playwright finished installing its revision
(`INSTALLATION_COMPLETE`), whichever revision it is; on Linux it also needs
`DEPENDENCIES_VALIDATED`, which Playwright writes only when its own host-library
validation passed.

`<env python>` is the interpreter of the script's own uv env:
`uv sync --no-config --script scripts/mcp-server.py`, then
`uv python find --no-config --script scripts/mcp-server.py`. Running Playwright through it
installs exactly the browser the pinned `playwright` drives. `uv run --script`
cannot do this, because arguments after the script go to the script.

## Why these versions

- **browser-use 1.0.0, pinned.** browser-use 1.0 ships no MCP server with page
  tools, so `mcp-server.py` is a standalone mcp server that owns all 27 tools. It
  uses `browser_use.Browser` (start, stop, `use_cloud`, `live_url`), the
  accessibility helpers in `browser_use.ax` for clicking and typing by index,
  `Agent`, and the `ChatAnthropic` / `ChatOpenAI` / `ChatBrowserUse` model classes.
  Page commands go to Chrome as raw CDP through the browser-harness daemon each
  `Browser` starts, over browser-harness's private IPC module (`_ipc`). That private
  coupling is why the pin is exact: a new upstream release reaches users only
  through a plugin release that bumps it, after the tests pass on it.
- **mcp 2.3.0, pinned.** browser-use 1.0.0 pins `mcp==2.3.0` exactly, so no other
  version can be installed beside it, and the header names the same one. The
  server uses the mcp 2.x lowlevel `Server` only.
- **playwright pinned.** browser-use drives Chrome over CDP and does not depend
  on Playwright, so the header declares it. Its install CLI decides which Chromium
  revision `magus doctor --fix` installs; `scripts/test_browser_env.py` fails a
  bump that moves the revision, which PDEP-1's Chromium oracle names.

The plugin launches the newest Chromium Playwright finished installing in its
cache, of any revision, and refuses to fall back to any other browser. To drive a different build, set
`CHROME_EXECUTABLE_PATH` to its binary. The path is always passed to browser-use:
left to itself, browser-use 1.0 looks for `/Applications/Google Chrome.app` first
and would drive the user's real Chrome.

## Browser lifecycle

browser-use 1.0 owns it. Each local session gets a temporary profile directory
(`browser-use-chrome-*` under the system temp dir), and stopping the session kills
Chrome's whole process group and deletes that directory. A watchdog process does the
same if the server dies without stopping it, SIGKILL included. The server adds only a
10-minute idle timeout and an exit when its parent `claude` process is gone.

A stopped session's browser-harness daemon exits on its own about 20 to 30 seconds later.
Its logs go under `$BH_HOME/tmp/` and are not rotated by the plugin.

The daemon listens on a Unix socket under `$BH_HOME/runtime/`. `BH_HOME` defaults to
`~/.config/browser-harness` (or `$XDG_CONFIG_HOME/browser-harness`). macOS caps that path near 104 bytes, so a very
long `HOME` or `BH_HOME` makes the browser fail to start; point `BH_HOME` at a short
directory if it does.

Upgrading from a plugin built on browser-use 0.x: nothing is written under
`~/.config/browseruse/profiles/` any more, and nothing sweeps it. Directories left there
by earlier versions (`browser-use-user-data-dir-session-*` and `session-*`) are safe to
delete. `~/.config/browseruse/config.json` is no longer read either: choose the agent
model in settings.json (see the `browser-use:agent-model` skill).

## API keys

- `ANTHROPIC_API_KEY` — the default agent model, used by `retry_with_browser_use_agent`
  and `browser_extract_content` unless another is configured.
- `OPENAI_API_KEY` — optional, for the `openai` agent provider.
- `BROWSER_USE_API_KEY` — optional, Browser Use Cloud sessions (CAPTCHA handling, proxy
  rotation, stealth) and the `browser_use` agent provider, whose default model is
  `bu-fast`. Cloud task scripts also use the Node SDK: `bun add browser-use-node`.

## Verification

```bash
uv run --no-config --script plugins/browser-use/scripts/mcp-server.py --test
python3 plugins/browser-use/scripts/test_browser_env.py
```

`--test` prints `browser-use version: 1.0.0` when the env is right. For live checks of the
keyboard, focus and evaluate tools against real Chromium, see
`scripts/manual-verify/README.md`.
