# Browser Use Plugin — Dependencies

The MCP server is a PEP 723 script. `.mcp.json` launches it with
`uv run --no-config --script`, and uv builds the Python environment its header
declares:

```python
# requires-python = ">=3.11"
# dependencies = ["browser-use==0.13.10", "mcp==2.1.1", "playwright==1.63.0"]
```

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

- **browser-use 0.13.10, pinned.** The plugin relies on `BrowserSession.kill()`,
  the `executable_path` profile field (which upstream honours ahead of its own
  browser discovery), `use_cloud`, and `ChatBrowserUse` (bu-latest), all present
  since 0.13.1. The pin is the release the env resolves today, so a new upstream
  release reaches users only through a plugin release that bumps it.
- **mcp 2.1.1, pinned.** browser-use pins `mcp` exactly (0.13.10 pins
  `mcp==2.1.1`), and the header names the same version. `mcp-server.py` still
  detects which surface the installed SDK has
  (`hasattr(server, "add_request_handler")`), so the 1.x surface keeps working
  if a pin bump goes back to it.
- **playwright pinned.** browser-use drives Chrome over CDP and does not depend
  on Playwright, so the header declares it. Its install CLI decides which Chromium
  revision `magus doctor --fix` installs; `scripts/test_browser_env.py` fails a
  bump that moves the revision, which PDEP-1's Chromium oracle names.

The plugin launches the newest Chromium Playwright finished installing in its
cache, of any revision, and refuses to fall back to any other browser. To drive a different build, set
`CHROME_EXECUTABLE_PATH` to its binary.

## API keys

- `ANTHROPIC_API_KEY` — the autonomous agent mode (`retry_with_browser_use_agent`).
- `BROWSER_USE_API_KEY` — optional, Browser Use Cloud (CAPTCHA handling, proxy
  rotation, stealth). Cloud task scripts also use the Node SDK: `bun add browser-use-node`.
- `OPENAI_API_KEY` — optional fallback LLM.

## Verification

```bash
uv run --no-config --script plugins/browser-use/scripts/mcp-server.py --test
python3 plugins/browser-use/scripts/test_browser_env.py
```
