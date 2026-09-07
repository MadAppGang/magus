# Browser Use Plugin — Dependencies

## Required

### 1. Python 3.11+

```bash
# Check version
python3 --version  # Must be >= 3.11

# Install via pyenv (if needed)
brew install pyenv
pyenv install 3.12
pyenv global 3.12
```

### 2. uv (recommended) or pip

```bash
# Install uv (recommended — manages isolated Python environments)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 3. browser-use

```bash
# Via uv (recommended)
uv pip install 'browser-use>=0.13.1'

# Or via pip
pip install 'browser-use>=0.13.1'
```

Version 0.13.1+ is required: the plugin relies on `BrowserSession.kill()`
semantics, the `executable_path` profile field (which upstream honours ahead of
its own browser discovery), `use_cloud` cloud-browser support, and
`ChatBrowserUse` (bu-latest) — all verified against 0.13.1.

### 4. Chromium Browser

The plugin launches the newest Chromium in Playwright's cache and refuses to fall
back to any other browser, so this install is required, not optional:

```bash
python3 -m playwright install chromium
```

This is the exact command the server names when it cannot find a Chromium. To use
a different build instead, set `CHROME_EXECUTABLE_PATH` to its binary.

### 5. MCP SDK

```bash
uv pip install mcp
```

You do not choose the SDK version — **browser-use pins `mcp` exactly**, so the
line above only confirms what step 3 already resolved. `browser-use 0.13.1`
pins `mcp==1.26.0`; **`browser-use >= 0.13.10` pins `mcp==2.1.1`**. That is why
a fresh install lands on the 2.x SDK while an install from before September 2026
still runs 1.x.

**Both majors are supported by the same `mcp-server.py`.** mcp 2.x removed the
1.x handler surface the server used to extend upstream's tool list
(`Server.request_handlers`, `@Server.list_tools()`); the wrapper now detects
which surface the installed SDK has — `hasattr(server, "add_request_handler")`
— and registers its tools through that one. It branches on capability, never on
a version string, so there is nothing to pin and no upgrade step: whichever mcp
your browser-use brought along is the one the server runs on.

### 6. ANTHROPIC_API_KEY

Required for the autonomous agent mode (`retry_with_browser_use_agent`).

```bash
export ANTHROPIC_API_KEY=your-anthropic-api-key
```

## Optional

### Browser Use Cloud

For CAPTCHA handling, proxy rotation, and stealth mode:

```bash
export BROWSER_USE_API_KEY=your-browser-use-cloud-key
```

Also install the Node.js SDK for cloud task scripts:

```bash
bun add browser-use-node
```

### OpenAI API Key (fallback LLM)

```bash
export OPENAI_API_KEY=your-openai-key
```

## Verification

```bash
# Verify MCP server starts
python3 plugins/browser-use/scripts/mcp-server.py --test

# Verify browser-use is importable
python3 -c "import browser_use; print(f'browser-use {browser_use.__version__}')"
```

## Minimum Versions

| Dependency | Minimum Version | Notes |
|-----------|-----------------|-------|
| Python | 3.11 | |
| browser-use | 0.13.1 | pins the `mcp` version it needs |
| mcp | 1.26.0 | 1.x and 2.x both supported; verified on 1.26.0 and 2.1.1 |
| Chromium | Latest (auto-installed) | |
| Bun | 1.0+ (for hooks/cloud scripts) | |
