#!/usr/bin/env python3
"""
Browser Use MCP Server — thin wrapper over browser_use.mcp.server.BrowserUseServer.

We deliberately do NOT point .mcp.json at upstream's native server
(`python -m browser_use.mcp`) because it is broken/hostile for a Claude Code
plugin on macOS. This subclass is the minimal shim covering those gaps. Each
override's upstream status was verified 2026-06-03 against browser_use 0.12.5 and
the latest upstream `main`:

  - Strip oneOf/allOf/anyOf from upstream tool schemas (browser-use#4211).
    FIXED upstream in 0.12.6+ (PR #4212), but we install browser-use UNPINNED and
    0.12.5 still ships it — and it breaks ALL MCP tools. Kept as version-defense.
  - downloads_path → ~/.config/browseruse/downloads. Upstream uses TCC-protected
    ~/Downloads (browser-use#4548, STILL OPEN; present on latest main).
  - user_data_dir → PID-isolated profile. Upstream uses a fixed profile dir, so
    concurrent sessions hit SingletonLock (browser-use#4548, STILL OPEN).
  - Force Playwright's bundled Chromium (channel='chromium') so we never hijack
    the user's real Chrome.app.
  - Graceful shutdown (atexit + SIGTERM/SIGINT) + profile cleanup, and reap
    orphaned session profiles (and their Chrome processes) on startup. Upstream
    has none (stale locks + ~50MB profile leak). Still absent on latest main.
  - Suppress the macOS Python "rocket" dock icon. Still absent on latest main.
  - Support cloud browsers (BROWSER_USE_CLOUD env or browser_start_cloud_session).
  - Configurable agent LLM (settings.json "browser-use".agentModel, the
    browser_set_agent_model tool, or the legacy BROWSER_USE_API_KEY shim).

Plus custom tools upstream lacks: browser_export_session, browser_import_session,
browser_run_script, browser_start_cloud_session, browser_set_agent_model, and
browser_evaluate, browser_press_key, browser_keyboard, browser_focus,
browser_doctor.

Usage (via .mcp.json):
    python3 /path/to/mcp-server.py

Test mode:
    python3 mcp-server.py --test
"""

import os
import sys

# Hide Python from macOS dock — Homebrew's framework Python shows a rocket icon
# for every process. We call NSApplication.setActivationPolicy_(Prohibited) via
# ctypes so there's no pyobjc dependency.
if sys.platform == "darwin":
    try:
        import ctypes
        import ctypes.util

        _objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library("objc"))
        # AppKit must be loaded first — NSApplication isn't available in a bare
        # Python process until its framework is loaded into the address space.
        ctypes.cdll.LoadLibrary("/System/Library/Frameworks/AppKit.framework/AppKit")
        _objc.objc_getClass.restype = ctypes.c_void_p
        _objc.sel_registerName.restype = ctypes.c_void_p
        _objc.objc_msgSend.restype = ctypes.c_void_p
        _objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        _NSApp = _objc.objc_getClass(b"NSApplication")
        _app = _objc.objc_msgSend(_NSApp, _objc.sel_registerName(b"sharedApplication"))
        _objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long]
        _objc.objc_msgSend(_app, _objc.sel_registerName(b"setActivationPolicy:"), 2)
    except Exception:
        pass

# Suppress browser_use logging before any imports to prevent stdout contamination.
# MCP uses stdout for JSON-RPC — any stray output breaks the protocol.
os.environ["BROWSER_USE_LOGGING_LEVEL"] = "critical"
os.environ["BROWSER_USE_SETUP_LOGGING"] = "false"

# --- Test mode: verify imports and exit cleanly ---
if "--test" in sys.argv:
    try:
        import browser_use  # noqa: F401
        from browser_use.utils import get_browser_use_version
        from browser_use.mcp.server import BrowserUseServer  # noqa: F401
        import mcp  # noqa: F401

        version = get_browser_use_version()
        print("browser-use MCP server: OK")
        print(f"browser-use version: {version}")
        sys.exit(0)
    except ImportError as e:
        print(f"browser-use MCP server: FAIL — {e}", file=sys.stderr)
        sys.exit(1)

import asyncio
import atexit
import importlib
import json
import logging
import re
import signal
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Redirect all logging to stderr — stdout must stay clean for MCP JSON-RPC.
logging.basicConfig(
    stream=sys.stderr,
    level=logging.CRITICAL,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    force=True,
)
# Silence all loggers completely — browser_use is very chatty.
logging.disable(logging.CRITICAL)

# --- Import built-in BrowserUseServer ---
try:
    from browser_use.mcp.server import BrowserUseServer
    from browser_use.browser import BrowserProfile, BrowserSession
    from browser_use.config import get_default_llm, get_default_profile, load_browser_use_config
    from browser_use.utils import get_browser_use_version
except ImportError as exc:
    print(
        f"ERROR: browser_use not installed. Run: pip install browser-use\nDetails: {exc}",
        file=sys.stderr,
    )
    sys.exit(1)

# --- Import MCP SDK ---
try:
    import mcp.server.stdio
    import mcp.types as types
    from mcp.server import NotificationOptions, Server
    from mcp.server.models import InitializationOptions
except ImportError as exc:
    print(
        f"ERROR: mcp SDK not installed. Run: pip install mcp\nDetails: {exc}",
        file=sys.stderr,
    )
    sys.exit(1)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configurable agent-LLM selection
# ---------------------------------------------------------------------------
#
# The browser-use Agent needs a BaseChatModel to reason with. We let users pick
# the provider/model per-project (settings.json "browser-use".agentModel) or
# per-session (browser_set_agent_model tool), with a sane default. All Chat*
# classes subclass browser_use.llm.base.BaseChatModel and are lazily imported so
# unused SDKs never load.


@dataclass
class LLMChoice:
    """A resolved request for an agent chat model (provider + parameters)."""

    provider: str
    model: str
    base_url: str | None = None
    api_key_env: str | None = None
    temperature: float | None = None


@dataclass
class ProviderSpec:
    """Static metadata for one supported chat-model provider."""

    import_path: str  # "module.path:ClassName"
    default_key_env: str | None
    supports_base_url: bool
    send_temperature: bool
    requires_base_url: bool = False


# Exactly four supported providers. openai_compatible is ChatOpenAI pointed at a
# custom base_url (LM Studio, Ollama's OpenAI shim, vLLM, OpenRouter, etc.).
_PROVIDER_REGISTRY: dict[str, ProviderSpec] = {
    "anthropic": ProviderSpec(
        import_path="browser_use.llm.anthropic.chat:ChatAnthropic",
        default_key_env="ANTHROPIC_API_KEY",
        supports_base_url=True,
        requires_base_url=False,
        send_temperature=False,
    ),
    "openai": ProviderSpec(
        import_path="browser_use.llm.openai.chat:ChatOpenAI",
        default_key_env="OPENAI_API_KEY",
        supports_base_url=True,
        send_temperature=True,
    ),
    "openai_compatible": ProviderSpec(
        import_path="browser_use.llm.openai.chat:ChatOpenAI",
        default_key_env=None,
        supports_base_url=True,
        requires_base_url=True,
        send_temperature=True,
    ),
    "browser_use": ProviderSpec(
        import_path="browser_use.llm.browser_use.chat:ChatBrowserUse",
        default_key_env="BROWSER_USE_API_KEY",
        supports_base_url=True,
        send_temperature=False,
    ),
}

# Default when nothing is configured: Anthropic's flagship, key from the env.
_DEFAULT_LLM = LLMChoice(
    provider="anthropic",
    model="claude-sonnet-5",
    api_key_env="ANTHROPIC_API_KEY",
    temperature=None,
)


def _build_llm(choice: LLMChoice) -> Any:
    """
    Instantiate a browser_use chat model for the given LLMChoice.

    Lazily imports the provider class, resolves the API key from the chosen (or
    default) env var, and only forwards temperature/base_url to providers that
    accept them. Raises ValueError for unknown providers and RuntimeError when a
    required base_url or API key is absent.
    """
    spec = _PROVIDER_REGISTRY.get(choice.provider)
    if spec is None:
        raise ValueError(
            f"Unknown provider {choice.provider!r}; valid: {sorted(_PROVIDER_REGISTRY)}"
        )

    module_path, class_name = spec.import_path.split(":")
    mod = importlib.import_module(module_path)
    chat_cls = getattr(mod, class_name)

    key_env = choice.api_key_env or spec.default_key_env
    api_key = os.environ.get(key_env) if key_env else None
    if choice.provider == "openai_compatible" and api_key is None:
        raise RuntimeError(
            f"openai_compatible provider requires an API key. Set the "
            f"{key_env!r} environment variable" if key_env else
            "openai_compatible provider requires an API key via api_key_env."
        )

    if spec.requires_base_url and not choice.base_url:
        raise RuntimeError(
            f"Provider {choice.provider!r} requires a base_url (none provided)."
        )

    kwargs: dict[str, Any] = {"model": choice.model}
    if spec.supports_base_url and choice.base_url:
        kwargs["base_url"] = choice.base_url
    # Pass api_key even when None — every SDK falls back to its own env var.
    kwargs["api_key"] = api_key
    if spec.send_temperature and choice.temperature is not None:
        kwargs["temperature"] = choice.temperature

    return chat_cls(**kwargs)


# ---------------------------------------------------------------------------
# Custom tool definitions (appended to the built-in tools)
# ---------------------------------------------------------------------------

_CUSTOM_TOOLS: list[types.Tool] = [
    types.Tool(
        name="browser_export_session",
        description=(
            "Export browser session state (cookies) to a JSON file. Useful for saving "
            "authenticated sessions to re-use in future Claude Code sessions via "
            "browser_import_session."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "Session ID to export."},
                "output_path": {
                    "type": "string",
                    "description": "Full path to write the .json file.",
                },
            },
            "required": ["session_id", "output_path"],
        },
    ),
    types.Tool(
        name="browser_import_session",
        description=(
            "Import a previously exported browser session (cookies) into a new session. "
            "Enables re-authentication across Claude Code sessions without logging in again."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "import_path": {
                    "type": "string",
                    "description": "Path to the exported session .json file.",
                },
                "navigate_to": {
                    "type": "string",
                    "description": "URL to navigate to after import (optional).",
                },
            },
            "required": ["import_path"],
        },
    ),
    types.Tool(
        name="browser_run_script",
        description=(
            "Run a saved STANDALONE Python script as a subprocess. This does NOT "
            "run JavaScript and does NOT share the active browser session — the "
            "subprocess gets a fresh Python interpreter that must independently "
            "have `browser-use`/`playwright` installed and would drive its OWN, "
            "separate browser. To run JavaScript inside the page the other tools "
            "are already driving, use browser_evaluate instead. To edit a code "
            "editor (Monaco/CodeMirror) or send keystrokes, use browser_evaluate, "
            "browser_focus, and browser_press_key. Use this tool only for "
            "self-contained automation scripts that intentionally launch their own "
            "browser. Fails fast with a clear error if a required module is missing "
            "(rather than hanging until the timeout)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "script_path": {
                    "type": "string",
                    "description": "Absolute path to the standalone .py script to run.",
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Command-line arguments to pass to the script.",
                    "default": [],
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Maximum execution time in seconds. Defaults to 300.",
                    "default": 300,
                },
            },
            "required": ["script_path"],
        },
    ),
    types.Tool(
        name="browser_evaluate",
        description=(
            "Run JavaScript IN THE LIVE PAGE the other browser tools are driving "
            "and return its result. This is the in-page eval escape hatch — it "
            "executes against the current session via CDP Runtime.evaluate, so it "
            "can read/modify the DOM, call framework hooks, read localStorage, and "
            "drive code editors that expose no normal input element. Example for a "
            "Monaco editor: `monaco.editor.getModels()[0].setValue('new text')`. "
            "The script is run as an expression; a bare `return` is also accepted "
            "(it is wrapped in a function for you), and a returned Promise is "
            "awaited. The result must be JSON-serializable to be returned."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "script": {
                    "type": "string",
                    "description": (
                        "JavaScript to evaluate in the page. May be an expression "
                        "(`document.title`) or statements ending in `return ...`."
                    ),
                },
            },
            "required": ["script"],
        },
    ),
    types.Tool(
        name="browser_press_key",
        description=(
            "Press a single key or keyboard shortcut in the live page via CDP "
            "Input.dispatchKeyEvent. Supports modifiers with '+' (e.g. 'Meta+a' "
            "for select-all, 'Control+a' on Linux/Windows, 'Enter', 'Escape', "
            "'Tab', 'Backspace', 'Delete', 'ArrowDown', 'ArrowUp', 'ArrowLeft', "
            "'ArrowRight'). Use this for clearing a field (Meta+a then Delete), "
            "submitting (Enter), dismissing modals (Escape), or any keyboard-"
            "driven editor. To insert literal text rather than press a key, use "
            "browser_keyboard with `text`."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": (
                        "Key or shortcut, e.g. 'Enter', 'Escape', 'Meta+a', "
                        "'ArrowDown'. Modifiers: Meta/Cmd, Control/Ctrl, Alt, Shift."
                    ),
                },
                "count": {
                    "type": "integer",
                    "description": "How many times to press the key. Defaults to 1.",
                    "default": 1,
                },
            },
            "required": ["key"],
        },
    ),
    types.Tool(
        name="browser_keyboard",
        description=(
            "Send a batch of keystrokes and/or literal text to the live page via "
            "CDP, in order. `keys` is a list of shortcuts pressed one after "
            "another (e.g. ['Meta+a','Delete'] to clear a field); `text` is "
            "literal text inserted via Input.insertText (the reliable way to type "
            "into focused inputs and code editors, since it does not require an "
            "indexed element). Provide either or both — keys are pressed first, "
            "then text is inserted. Pair with browser_focus to target a hidden or "
            "synthetic input first."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Shortcuts to press in order, e.g. ['Meta+a','Delete'].",
                    "default": [],
                },
                "text": {
                    "type": "string",
                    "description": "Literal text to insert after the keys (via Input.insertText).",
                },
            },
        },
    ),
    types.Tool(
        name="browser_focus",
        description=(
            "Focus a DOM element by CSS selector in the live page, so it can then "
            "receive browser_keyboard / browser_press_key input. Unlike "
            "browser_type (which needs an `index` from browser_get_state's "
            "interactive-element list), this targets ANY element by selector — "
            "including the hidden/synthetic inputs that code editors use (e.g. "
            "Monaco's `textarea.inputarea`) which never appear in the index list. "
            "Returns whether an element matched and was focused."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector of the element to focus, e.g. 'textarea.inputarea'.",
                },
            },
            "required": ["selector"],
        },
    ),
    types.Tool(
        name="browser_doctor",
        description=(
            "Preflight diagnosis of this plugin's environment. Reports the Python "
            "version, whether browser-use / mcp / playwright are importable, "
            "whether a Chromium/Chrome executable is present, and which provider "
            "API keys are set — turning silent failures (a 300s run_script hang, "
            "ModuleNotFoundError) into a one-call diagnosis. Takes no arguments."
        ),
        inputSchema={
            "type": "object",
            "properties": {},
        },
    ),
    types.Tool(
        name="browser_start_cloud_session",
        description=(
            "Start a Browser Use CLOUD browser session (remote, stealth, CAPTCHA-capable). "
            "Requires BROWSER_USE_API_KEY. Returns session_id, cdp_url, and a live_url "
            "you can open to watch the remote browser. If no local session exists, the "
            "cloud session becomes primary so the built-in browser_* tools drive it."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "navigate_to": {
                    "type": "string",
                    "description": "URL to navigate to after the cloud session starts (optional).",
                },
            },
            "required": [],
        },
    ),
    types.Tool(
        name="browser_set_agent_model",
        description=(
            "Choose which LLM the browser agent reasons with, for the rest of this "
            "session. Overrides any settings.json config. Providers: 'anthropic', "
            "'openai', 'openai_compatible' (any OpenAI-API-compatible endpoint — "
            "requires base_url), 'browser_use' (Browser Use cloud models). "
            "api_key_env names an ENVIRONMENT VARIABLE that holds the key — never "
            "pass a secret directly. Applies to the live session immediately when "
            "one is active; otherwise takes effect on the next session start."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "provider": {
                    "type": "string",
                    "enum": ["anthropic", "openai", "openai_compatible", "browser_use"],
                    "description": "LLM provider id.",
                },
                "model": {
                    "type": "string",
                    "description": "Model name for the chosen provider.",
                },
                "base_url": {
                    "type": "string",
                    "description": (
                        "Base URL for the API. Required for 'openai_compatible'; "
                        "optional override for the others."
                    ),
                },
                "api_key_env": {
                    "type": "string",
                    "description": (
                        "Name of the environment variable holding the API key "
                        "(NOT the key itself). Defaults to the provider's standard var."
                    ),
                },
                "temperature": {
                    "type": "number",
                    "description": "Sampling temperature (only used by openai/openai_compatible).",
                },
            },
            "required": ["provider", "model"],
        },
    ),
]


# ---------------------------------------------------------------------------
# Thin-wrapper subclass
# ---------------------------------------------------------------------------

class MagusBrowserServer(BrowserUseServer):
    """
    Thin subclass of BrowserUseServer that:
    - Fixes downloads_path and user_data_dir (PID-isolated, avoids TCC / SingletonLock issues)
    - Extends list_tools with 5 custom tools
    - Overrides _execute_tool to dispatch the 5 custom tools, delegates rest to super()
    - Resolves a configurable agent LLM (settings.json / tool override / default)
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # super().__init__() calls _setup_handlers() internally, which registers
        # the parent's list_tools handler. We capture that handler AFTER super().__init__
        # returns, then replace it with a wrapper that appends our custom tools.
        super().__init__(*args, **kwargs)
        self._extend_list_tools()
        # Per-session agent-LLM override set via browser_set_agent_model. When
        # None, the resolver falls back to settings.json config then _DEFAULT_LLM.
        self._session_llm_override: LLMChoice | None = None

    def _extend_list_tools(self) -> None:
        """
        Replace the parent's registered list_tools handler with a wrapper that
        appends our 5 custom tool definitions and sanitizes upstream schemas.
        The MCP SDK stores a single handler per request type in
        server.request_handlers; re-registering replaces it.
        """
        # Capture the parent's handler from the MCP request_handlers dict.
        parent_handler = self.server.request_handlers.get(types.ListToolsRequest)

        @self.server.list_tools()
        async def handle_list_tools() -> list[types.Tool]:
            if parent_handler is not None:
                result = await parent_handler(
                    types.ListToolsRequest(method="tools/list", params=None)
                )
                parent_tools: list[types.Tool] = result.root.tools
            else:
                parent_tools = []
            # Sanitize upstream schemas: the Claude API rejects oneOf/allOf/anyOf
            # at the top level of a tool input_schema, and a single offending tool
            # (upstream's browser_click) breaks ALL MCP tool registration for the
            # session — not just browser-use's tools.
            #
            # Status (verified 2026-06-03): browser-use#4211 was FIXED upstream in
            # 0.12.6+ via merged PR #4212. But our plugin installs browser-use
            # UNPINNED (see plugin.json `setup`), and 0.12.5 (and earlier) still
            # emits the oneOf — confirmed by running the native server. So this
            # stays: load-bearing on browser-use <= 0.12.5, a harmless no-op on
            # 0.12.6+. Cheap insurance against an uncontrolled dependency version.
            for tool in parent_tools:
                schema = tool.inputSchema
                if isinstance(schema, dict):
                    for key in ("oneOf", "allOf", "anyOf"):
                        schema.pop(key, None)
            return parent_tools + _CUSTOM_TOOLS

    async def _init_browser_session(
        self, allowed_domains: list[str] | None = None, **kwargs: Any
    ) -> None:
        """
        Override parent to fix two bugs:

        1. downloads_path: use ~/.config/browseruse/downloads to avoid macOS TCC errors.
           The parent uses ~/Downloads/browser-use-mcp which requires a TCC permission
           grant in sandboxed / restricted environments.

        2. user_data_dir: include the PID so each Claude Code session gets its own
           Chrome profile directory, preventing SingletonLock contention when multiple
           sessions run simultaneously.

        Plus two Magus extensions:

        3. channel='chromium': launch Playwright's bundled Chromium instead of the
           user's real /Applications/Google Chrome.app (stops link-hijack/focus-steal).

        4. BROWSER_USE_CLOUD=true: run against a remote Browser Use cloud browser
           instead of any local browser (requires BROWSER_USE_API_KEY).
        """
        if self.browser_session:
            return

        profile_config = get_default_profile(self.config)

        cloud_env = os.environ.get("BROWSER_USE_CLOUD", "").lower() in ("true", "1", "yes")
        if cloud_env:
            if not os.environ.get("BROWSER_USE_API_KEY"):
                raise RuntimeError(
                    "BROWSER_USE_CLOUD is set but BROWSER_USE_API_KEY is missing. "
                    "Get a key at https://cloud.browser-use.com and export BROWSER_USE_API_KEY."
                )
            # Cloud browsers are remote — no local paths (user_data_dir, channel,
            # headless, downloads_path don't apply).
            profile_data: dict[str, Any] = {
                "wait_between_actions": 0.5,
                "keep_alive": True,
                "use_cloud": True,
                # Config file values override our defaults (user intentional config wins)
                **profile_config,
            }
        else:
            pid = os.getpid()
            headless_env = os.environ.get("BROWSER_USE_HEADLESS", "").lower() in ("true", "1", "yes")

            profile_data = {
                "downloads_path": str(Path.home() / ".config" / "browseruse" / "downloads"),
                "wait_between_actions": 0.5,
                "keep_alive": True,
                "user_data_dir": f"~/.config/browseruse/profiles/session-{pid}",
                "device_scale_factor": 1.0,
                "disable_security": False,
                "headless": headless_env or False,
                # Playwright's bundled Chromium — never the user's real Chrome.app
                "channel": "chromium",
                # Config file values override our defaults (user intentional config wins)
                **profile_config,
            }

        if allowed_domains is not None:
            profile_data["allowed_domains"] = allowed_domains

        for key, value in kwargs.items():
            profile_data[key] = value

        profile = BrowserProfile(**profile_data)
        self.browser_session = BrowserSession(browser_profile=profile)
        await self.browser_session.start()

        self._track_session(self.browser_session)

        # Initialize tools (for extract_content)
        from browser_use.tools.service import Tools
        self.tools = Tools()

        # Initialize the agent LLM from the configured/override/default choice.
        self.llm = self._resolve_agent_llm()

        # Initialize FileSystem for extract_content
        from browser_use.filesystem.file_system import FileSystem
        file_system_path = profile_config.get("file_system_path", "~/.browser-use-mcp")
        self.file_system = FileSystem(base_dir=Path(file_system_path).expanduser())

    # ------------------------------------------------------------------
    # Agent-LLM resolution
    # ------------------------------------------------------------------

    def _resolve_configured_llm(self) -> "LLMChoice | None":
        """
        Resolve the agent LLM from layered settings.json files, then legacy env.

        Merges the "browser-use"."agentModel" object (later wins) from:
          1. ~/.claude/settings.json
          2. $CLAUDE_PROJECT_DIR/.claude/settings.json
          3. $CLAUDE_PROJECT_DIR/.claude/settings.local.json
        Missing/unreadable files are skipped silently. Returns an LLMChoice when
        the merged config has at least provider + model.

        If no settings agentModel is found, falls back to the legacy env shim:
        BROWSER_USE_API_KEY present -> browser_use / BROWSER_USE_AGENT_MODEL.
        Otherwise returns None (caller uses _DEFAULT_LLM).
        """
        merged: dict[str, Any] = {}
        candidate_paths: list[Path] = [Path.home() / ".claude" / "settings.json"]
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
        if project_dir:
            base = Path(project_dir) / ".claude"
            candidate_paths.append(base / "settings.json")
            candidate_paths.append(base / "settings.local.json")

        for path in candidate_paths:
            try:
                if not path.is_file():
                    continue
                data = json.loads(path.read_text())
                agent_model = (
                    data.get("browser-use", {}).get("agentModel")
                    if isinstance(data, dict)
                    else None
                )
                if isinstance(agent_model, dict):
                    merged.update(agent_model)
            except Exception:
                continue  # skip missing/unreadable/malformed files silently

        if merged.get("provider") and merged.get("model"):
            return LLMChoice(
                provider=merged["provider"],
                model=merged["model"],
                base_url=merged.get("baseUrl"),
                api_key_env=merged.get("apiKeyEnv"),
                temperature=merged.get("temperature"),
            )

        # Legacy env compat shim (lowest priority).
        if os.environ.get("BROWSER_USE_API_KEY"):
            return LLMChoice(
                provider="browser_use",
                model=os.environ.get("BROWSER_USE_AGENT_MODEL", "bu-latest"),
            )

        return None

    def _resolve_agent_llm(self) -> Any:
        """Build the agent LLM: session override > settings config > default."""
        choice = (
            self._session_llm_override
            or self._resolve_configured_llm()
            or _DEFAULT_LLM
        )
        return _build_llm(choice)

    async def _execute_tool(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> str | list[types.TextContent | types.ImageContent]:
        """
        Dispatch our custom tools; delegate everything else to the parent.
        The parent's call_tool closure calls self._execute_tool(), so our override
        intercepts all tool invocations automatically.
        """
        if tool_name == "browser_export_session":
            return await self._handle_export_session(arguments)
        elif tool_name == "browser_import_session":
            return await self._handle_import_session(arguments)
        elif tool_name == "browser_run_script":
            return await self._handle_run_script(arguments)
        elif tool_name == "browser_evaluate":
            return await self._handle_evaluate(arguments)
        elif tool_name == "browser_press_key":
            return await self._handle_press_key(arguments)
        elif tool_name == "browser_keyboard":
            return await self._handle_keyboard(arguments)
        elif tool_name == "browser_focus":
            return await self._handle_focus(arguments)
        elif tool_name == "browser_doctor":
            return await self._handle_doctor(arguments)
        elif tool_name == "browser_start_cloud_session":
            return await self._handle_start_cloud_session(arguments)
        elif tool_name == "browser_set_agent_model":
            return await self._handle_set_agent_model(arguments)
        else:
            return await super()._execute_tool(tool_name, arguments)

    # ------------------------------------------------------------------
    # Custom tool handlers
    # ------------------------------------------------------------------

    async def _handle_export_session(self, args: dict[str, Any]) -> str:
        """Export cookies from an active session to a JSON file."""
        from datetime import datetime

        session_id = args.get("session_id", "")
        output_path = args.get("output_path", "")

        if not session_id:
            return "Error: session_id is required."
        if not output_path:
            return "Error: output_path is required."

        if session_id not in self.active_sessions:
            return (
                f"Session {session_id!r} not found. "
                "Use browser_list_sessions to see active sessions."
            )

        session: BrowserSession = self.active_sessions[session_id]["session"]

        try:
            cdp_session = await session.get_or_create_cdp_session(target_id=None, focus=False)
            cookies_result = await cdp_session.cdp_client.send.Network.getCookies(
                params={}, session_id=cdp_session.session_id
            )
            cookies = cookies_result.get("cookies", [])

            state = await session.get_browser_state_summary()
            export_data = {
                "session_id": session_id,
                "exported_at": datetime.utcnow().isoformat() + "Z",
                "url": state.url,
                "cookies": cookies,
            }

            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(export_data, indent=2))

            return json.dumps(
                {
                    "success": True,
                    "path": str(out),
                    "cookies_count": len(cookies),
                    "url": state.url,
                }
            )

        except Exception as exc:
            return f"export_session failed: {exc}"

    async def _handle_import_session(self, args: dict[str, Any]) -> str:
        """Import cookies from a JSON file into a new browser session."""
        import_path = args.get("import_path", "")
        navigate_to: str | None = args.get("navigate_to")

        if not import_path:
            return "Error: import_path is required."

        src = Path(import_path)
        if not src.exists():
            return f"Error: File not found: {import_path}"

        try:
            data = json.loads(src.read_text())
        except Exception as exc:
            return f"Error reading session file: {exc}"

        try:
            # Build a fresh session with our fixed profile paths.
            profile_config = get_default_profile(self.config)
            pid = os.getpid()
            headless_env = os.environ.get("BROWSER_USE_HEADLESS", "").lower() in ("true", "1", "yes")

            profile_data: dict[str, Any] = {
                "downloads_path": str(Path.home() / ".config" / "browseruse" / "downloads"),
                "wait_between_actions": 0.5,
                "keep_alive": True,
                "user_data_dir": f"~/.config/browseruse/profiles/session-{pid}",
                "device_scale_factor": 1.0,
                "disable_security": False,
                "headless": headless_env or False,
                # Playwright's bundled Chromium — never the user's real Chrome.app
                "channel": "chromium",
                **profile_config,
            }

            profile = BrowserProfile(**profile_data)
            session = BrowserSession(browser_profile=profile)
            await session.start()

            # Inject cookies via CDP
            cdp_session = await session.get_or_create_cdp_session(target_id=None, focus=False)
            for cookie in data.get("cookies", []):
                try:
                    await cdp_session.cdp_client.send.Network.setCookie(
                        params=cookie, session_id=cdp_session.session_id
                    )
                except Exception:
                    pass  # Skip malformed cookies

            if navigate_to:
                from browser_use.browser.events import NavigateToUrlEvent
                event = session.event_bus.dispatch(NavigateToUrlEvent(url=navigate_to))
                await event

            # Register with the parent's session tracker
            new_id = session.id
            self.active_sessions[new_id] = {
                "session": session,
                "created_at": time.time(),
                "last_activity": time.time(),
                "url": navigate_to or data.get("url"),
            }

            return json.dumps(
                {
                    "session_id": new_id,
                    "cookies_imported": len(data.get("cookies", [])),
                    "original_url": data.get("url"),
                    "navigated_to": navigate_to,
                }
            )

        except Exception as exc:
            return f"import_session failed: {exc}"

    async def _handle_run_script(self, args: dict[str, Any]) -> str:
        """Run a Python script as a subprocess and return stdout/stderr/exit_code."""
        script_path = args.get("script_path", "")
        script_args: list[str] = args.get("args", []) or []
        timeout_seconds = int(args.get("timeout_seconds", 300))

        if not script_path:
            return "Error: script_path is required."

        # Fail fast on the two things the bug report hit: passing inline JS / a
        # stream (e.g. /dev/stdin) as a "path", which then blocks for the full
        # timeout. Require an actual readable .py file before spawning anything.
        src = Path(script_path)
        if not src.is_file():
            return (
                f"Error: script_path must be a readable .py file on disk, got "
                f"{script_path!r}. browser_run_script runs a STANDALONE Python "
                "script as a subprocess — it does NOT run inline JavaScript and "
                "does NOT share the active browser session. To run JS in the live "
                "page, use browser_evaluate. To send keystrokes, use "
                "browser_press_key / browser_keyboard."
            )
        if src.suffix != ".py":
            return f"Error: script_path must be a .py file, got {src.suffix or '(no extension)'!r}: {script_path}"

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                str(src),
                *script_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=float(timeout_seconds)
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return json.dumps(
                    {"exit_code": -1, "error": f"Script timed out after {timeout_seconds}s"}
                )

            stderr_text = stderr.decode(errors="replace")
            result: dict[str, Any] = {
                "exit_code": proc.returncode,
                "stdout": stdout.decode(errors="replace"),
                "stderr": stderr_text,
            }
            # Surface the report's most common failure (a fresh interpreter
            # without browser-use/playwright installed) as an explicit hint
            # instead of leaving the user to parse a raw traceback.
            if proc.returncode != 0 and "ModuleNotFoundError" in stderr_text:
                result["hint"] = (
                    "The subprocess interpreter is missing a module. "
                    "browser_run_script does NOT share this server's environment "
                    "or browser — the script must independently install its deps "
                    "(e.g. browser-use, playwright). Run browser_doctor to see "
                    "what is installed."
                )
            return json.dumps(result)

        except Exception as exc:
            return f"run_script failed: {exc}"

    async def _handle_start_cloud_session(self, args: dict[str, Any]) -> str:
        """Start a Browser Use cloud browser session (remote, stealth-capable)."""
        navigate_to: str | None = args.get("navigate_to")

        if not os.environ.get("BROWSER_USE_API_KEY"):
            return (
                "Error: BROWSER_USE_API_KEY is not set. Cloud browser sessions require "
                "an API key — get one at https://cloud.browser-use.com and export "
                "BROWSER_USE_API_KEY."
            )

        try:
            profile = BrowserProfile(use_cloud=True, keep_alive=True)
            session = BrowserSession(browser_profile=profile)

            # browser-use 0.13.1 only persists cdpUrl from the cloud create-browser
            # response; liveUrl is logged and discarded. Wrap the cloud client's
            # create_browser (plain class, per-instance) to capture it.
            captured: dict[str, Any] = {}
            try:
                cloud_client = session._cloud_browser_client
                _orig_create = cloud_client.create_browser

                async def _capturing_create(request: Any, extra_headers: Any = None) -> Any:
                    response = await _orig_create(request, extra_headers)
                    captured["live_url"] = getattr(response, "liveUrl", None)
                    return response

                cloud_client.create_browser = _capturing_create
            except Exception:
                pass  # Best-effort — cdp_url alone is still useful

            await session.start()

            if navigate_to:
                from browser_use.browser.events import NavigateToUrlEvent
                event = session.event_bus.dispatch(NavigateToUrlEvent(url=navigate_to))
                await event

            # Register with the parent's session tracker
            new_id = session.id
            self.active_sessions[new_id] = {
                "session": session,
                "created_at": time.time(),
                "last_activity": time.time(),
                "url": navigate_to,
            }

            # If there's no primary session yet, promote this one so the built-in
            # browser_* tools drive the cloud browser.
            is_primary = False
            if self.browser_session is None:
                self.browser_session = session
                is_primary = True
                if getattr(self, "tools", None) is None:
                    from browser_use.tools.service import Tools
                    self.tools = Tools()
                if getattr(self, "file_system", None) is None:
                    from browser_use.filesystem.file_system import FileSystem
                    self.file_system = FileSystem(base_dir=Path("~/.browser-use-mcp").expanduser())
                if getattr(self, "llm", None) is None:
                    self.llm = self._resolve_agent_llm()

            result: dict[str, Any] = {
                "session_id": new_id,
                "cdp_url": session.cdp_url,
                "is_primary": is_primary,
                "navigated_to": navigate_to,
            }
            live_url = captured.get("live_url") or getattr(session, "live_url", None)
            if live_url:
                result["live_url"] = live_url
            return json.dumps(result)

        except Exception as exc:
            return f"start_cloud_session failed: {exc}"

    async def _handle_set_agent_model(self, args: dict[str, Any]) -> str:
        """
        Set the per-session agent LLM override (browser_set_agent_model tool).

        Validates the provider/base_url, stores the override, and — if a browser
        session is already live — eagerly rebuilds self.llm so the change applies
        immediately. On a build failure the prior override and self.llm are left
        untouched. Returns a secrets-free JSON summary (never the API key).
        """
        provider = args.get("provider", "")
        model = args.get("model", "")
        base_url: str | None = args.get("base_url")
        api_key_env: str | None = args.get("api_key_env")
        temperature = args.get("temperature")

        if provider not in _PROVIDER_REGISTRY:
            return (
                f"Error: unknown provider {provider!r}. "
                f"Valid: {sorted(_PROVIDER_REGISTRY)}"
            )
        if not model:
            return "Error: model is required."
        if provider == "openai_compatible" and not base_url:
            return (
                "Error: provider 'openai_compatible' requires base_url "
                "(the OpenAI-compatible endpoint URL)."
            )

        override = LLMChoice(
            provider=provider,
            model=model,
            base_url=base_url,
            api_key_env=api_key_env,
            temperature=temperature,
        )

        prior_override = self._session_llm_override
        self._session_llm_override = override

        applied_to_live_session = False
        if getattr(self, "browser_session", None) is not None:
            try:
                self.llm = _build_llm(override)
                applied_to_live_session = True
            except Exception as exc:
                # Revert — leave self.llm on the previously working model.
                self._session_llm_override = prior_override
                return f"Error building agent model: {exc}"

        return json.dumps(
            {
                "provider": override.provider,
                "model": override.model,
                "base_url": override.base_url,
                "applied_to_live_session": applied_to_live_session,
            }
        )

    # ------------------------------------------------------------------
    # Live-page CDP helpers (evaluate / keyboard / focus)
    # ------------------------------------------------------------------

    async def _live_cdp_session(self, focus: bool = False) -> Any:
        """
        Resolve a CDP session bound to the page the OTHER browser tools are
        driving — i.e. self.browser_session, NOT a session_id from
        active_sessions. Mirrors upstream's own in-page paths (_get_html,
        _execute_javascript) which use get_or_create_cdp_session(target_id=None).
        Returns the cdp_session, or None if there is no active browser.

        `focus`: keyboard input (Input.dispatchKeyEvent) routes to the *focused*
        CDP target, so the keyboard/focus paths pass focus=True (mirroring
        upstream's _type_to_page). Runtime.evaluate runs in the page context
        regardless, so the eval path leaves focus=False.
        """
        if not self.browser_session:
            return None
        # Keep the parent's activity tracker honest so its idle-cleanup loop
        # doesn't reap the session we're about to use.
        try:
            self._update_session_activity(self.browser_session.id)
        except Exception:
            pass
        return await self.browser_session.get_or_create_cdp_session(
            target_id=None, focus=focus
        )

    @staticmethod
    def _wrap_eval_script(script: str) -> str:
        """
        Decide whether a user script is a statement body (needs an IIFE wrapper
        so a top-level `return` is legal) or a plain expression (pass through, so
        Runtime.evaluate returns its value). Wrap only when it starts with a
        word-boundaried `return` or contains a statement separator (`;` / newline)
        — never on a mere substring match like `"returned"` or `.return-btn`.
        """
        stripped = script.strip()
        starts_with_return = re.match(r"^return\b", stripped) is not None
        # A real statement body has a newline, or a semicolon that is NOT just a
        # single trailing one (a plain `document.title;` is still an expression).
        inner = stripped[:-1] if stripped.endswith(";") else stripped
        has_separator = "\n" in inner or ";" in inner
        if starts_with_return or has_separator:
            return f"(function(){{ {script}\n }})()"
        return script

    async def _handle_evaluate(self, args: dict[str, Any]) -> str:
        """
        Run JavaScript in the live page and return its (JSON-serializable) result.
        Mirrors upstream's Runtime.evaluate usage but adds returnByValue +
        awaitPromise and an IIFE wrapper so a script written with a top-level
        `return` (or multiple statements) works instead of raising a SyntaxError.
        """
        script = args.get("script", "")
        if not isinstance(script, str) or not script.strip():
            return "Error: script is required."

        cdp_session = await self._live_cdp_session()
        if cdp_session is None:
            return "Error: No browser session active. Navigate first (browser_navigate)."

        # A bare `return ...` (or multi-statement body) is illegal at expression
        # top level, so wrap it in an IIFE. But only when it really IS statements:
        # wrap if it STARTS with `return` (word-boundaried, so `returned`/
        # `return_x` don't match) or contains a statement separator (`;` or
        # newline). A plain expression — `document.title`, `"returned"`,
        # `querySelector('.return-btn')` — is passed through unchanged so it isn't
        # silently turned into a no-return function that yields undefined.
        expression = self._wrap_eval_script(script)

        try:
            result = await cdp_session.cdp_client.send.Runtime.evaluate(
                params={
                    "expression": expression,
                    "returnByValue": True,
                    "awaitPromise": True,
                    "userGesture": True,
                },
                session_id=cdp_session.session_id,
            )
        except Exception as exc:
            return f"evaluate failed: {exc}"

        # Surface JS exceptions as a readable error rather than a silent null.
        exc_details = result.get("exceptionDetails")
        if exc_details:
            text = exc_details.get("exception", {}).get("description") or exc_details.get("text")
            return json.dumps({"error": "JavaScript exception", "detail": text})

        value = result.get("result", {}).get("value")
        return json.dumps({"result": value})

    async def _handle_focus(self, args: dict[str, Any]) -> str:
        """
        Focus a DOM element by CSS selector (works for hidden/synthetic inputs
        that never appear in browser_get_state's index list, e.g. Monaco's
        textarea.inputarea). Done via Runtime.evaluate el.focus().
        """
        selector = args.get("selector", "")
        if not isinstance(selector, str) or not selector:
            return "Error: selector is required."

        cdp_session = await self._live_cdp_session(focus=True)
        if cdp_session is None:
            return "Error: No browser session active. Navigate first (browser_navigate)."

        js = (
            f"(function(){{ const el = document.querySelector({json.dumps(selector)});"
            f" if (!el) return false; el.focus(); return document.activeElement === el; }})()"
        )
        try:
            result = await cdp_session.cdp_client.send.Runtime.evaluate(
                params={"expression": js, "returnByValue": True},
                session_id=cdp_session.session_id,
            )
        except Exception as exc:
            return f"focus failed: {exc}"

        focused = bool(result.get("result", {}).get("value"))
        if not focused:
            return json.dumps({"focused": False, "error": f"No element matched {selector!r}"})
        return json.dumps({"focused": True, "selector": selector})

    async def _handle_press_key(self, args: dict[str, Any]) -> str:
        """Press a single key/shortcut `count` times in the live page."""
        key = args.get("key", "")
        if not isinstance(key, str) or not key:
            return "Error: key is required."
        count = int(args.get("count", 1) or 1)

        cdp_session = await self._live_cdp_session(focus=True)
        if cdp_session is None:
            return "Error: No browser session active. Navigate first (browser_navigate)."

        try:
            for _ in range(max(1, count)):
                await self._dispatch_key(cdp_session, key)
        except Exception as exc:
            return f"press_key failed: {exc}"
        return json.dumps({"pressed": key, "count": max(1, count)})

    async def _handle_keyboard(self, args: dict[str, Any]) -> str:
        """Press a batch of shortcuts, then insert literal text, in order."""
        keys = args.get("keys", []) or []
        text = args.get("text")
        if not keys and not text:
            return "Error: provide `keys` and/or `text`."

        cdp_session = await self._live_cdp_session(focus=True)
        if cdp_session is None:
            return "Error: No browser session active. Navigate first (browser_navigate)."

        try:
            for key in keys:
                await self._dispatch_key(cdp_session, str(key))
            if text:
                await cdp_session.cdp_client.send.Input.insertText(
                    params={"text": str(text)}, session_id=cdp_session.session_id
                )
        except Exception as exc:
            return f"keyboard failed: {exc}"
        return json.dumps({"keys": list(keys), "text_inserted": bool(text)})

    # CDP modifier bitmask: Alt=1, Control=2, Meta=4, Shift=8.
    _MODIFIER_BITS = {
        "alt": 1,
        "control": 2, "ctrl": 2,
        "meta": 4, "cmd": 4, "command": 4,
        "shift": 8,
    }

    # Named keys → (key, code, windowsVirtualKeyCode). Covers the keys the bug
    # report calls out; plain single characters are handled generically below.
    _NAMED_KEYS = {
        "enter": ("Enter", "Enter", 13),
        "tab": ("Tab", "Tab", 9),
        "escape": ("Escape", "Escape", 27),
        "esc": ("Escape", "Escape", 27),
        "backspace": ("Backspace", "Backspace", 8),
        "delete": ("Delete", "Delete", 46),
        "del": ("Delete", "Delete", 46),
        "space": (" ", "Space", 32),
        "arrowup": ("ArrowUp", "ArrowUp", 38),
        "arrowdown": ("ArrowDown", "ArrowDown", 40),
        "arrowleft": ("ArrowLeft", "ArrowLeft", 37),
        "arrowright": ("ArrowRight", "ArrowRight", 39),
        "up": ("ArrowUp", "ArrowUp", 38),
        "down": ("ArrowDown", "ArrowDown", 40),
        "left": ("ArrowLeft", "ArrowLeft", 37),
        "right": ("ArrowRight", "ArrowRight", 39),
        "home": ("Home", "Home", 36),
        "end": ("End", "End", 35),
        "pageup": ("PageUp", "PageUp", 33),
        "pagedown": ("PageDown", "PageDown", 34),
    }

    # Editing shortcuts → CDP `commands` (the documented mechanism that makes a
    # synthetic Cmd/Ctrl+<key> actually perform the editor action; without it,
    # dispatchKeyEvent with modifiers alone does NOT trigger select-all/copy/etc.
    # — verified empirically against headless Chrome). Keyed by the letter only;
    # the Cmd-or-Ctrl modifier is required (see _command_for).
    _EDIT_COMMANDS = {
        "a": ["selectAll"],
        "c": ["copy"],
        "v": ["paste"],
        "x": ["cut"],
        "z": ["undo"],
        "y": ["redo"],
    }

    @classmethod
    def _parse_key_spec(cls, spec: str) -> tuple[int, str, str, int]:
        """
        Parse 'Meta+a' / 'Enter' / 'Shift+ArrowDown' into
        (modifier_bitmask, key, code, windowsVirtualKeyCode) for
        Input.dispatchKeyEvent.
        """
        parts = [p for p in spec.split("+") if p != ""]
        # A trailing literal '+' (e.g. 'Shift++') leaves an empty token; the
        # final non-modifier token is the actual key.
        modifiers = 0
        key_token = parts[-1] if parts else spec
        for tok in parts[:-1]:
            modifiers |= cls._MODIFIER_BITS.get(tok.lower(), 0)

        low = key_token.lower()
        if low in cls._NAMED_KEYS:
            key, code, vk = cls._NAMED_KEYS[low]
        elif len(key_token) == 1:
            key = key_token
            ch = key_token.lower()
            code = f"Key{ch.upper()}" if ch.isalpha() else f"Digit{ch}" if ch.isdigit() else ""
            vk = ord(ch.upper())
        else:
            # Unknown multi-char key name — pass it through as the CDP `key`.
            key, code, vk = key_token, "", 0
        return modifiers, key, code, vk

    @classmethod
    def _command_for(cls, modifiers: int, key: str) -> list[str]:
        """
        Return the CDP edit `commands` for a Cmd/Ctrl+<letter> shortcut, or [].
        Only fires when the Meta (4) or Control (2) modifier is held — so a plain
        'a' types a letter while 'Meta+a'/'Control+a' selects all.
        """
        if modifiers & (2 | 4) and len(key) == 1:
            return cls._EDIT_COMMANDS.get(key.lower(), [])
        return []

    async def _dispatch_key(self, cdp_session: Any, spec: str) -> None:
        """Send a keyDown+keyUp pair for one key/shortcut via CDP Input."""
        modifiers, key, code, vk = self._parse_key_spec(spec)
        base: dict[str, Any] = {"modifiers": modifiers, "key": key}
        if code:
            base["code"] = code
        if vk:
            base["windowsVirtualKeyCode"] = vk
            base["nativeVirtualKeyCode"] = vk

        down = {**base, "type": "keyDown"}
        # Attach the editor command (selectAll/copy/paste/…) to the keyDown so a
        # synthetic shortcut actually performs the action in the focused editor.
        commands = self._command_for(modifiers, key)
        if commands:
            down["commands"] = commands

        await cdp_session.cdp_client.send.Input.dispatchKeyEvent(
            params=down, session_id=cdp_session.session_id
        )
        await cdp_session.cdp_client.send.Input.dispatchKeyEvent(
            params={**base, "type": "keyUp"}, session_id=cdp_session.session_id
        )

    # ------------------------------------------------------------------
    # Environment preflight
    # ------------------------------------------------------------------

    async def _handle_doctor(self, args: dict[str, Any]) -> str:
        """
        Report the plugin's runtime environment so silent failures (300s
        run_script hang, ModuleNotFoundError, missing Chromium) become a
        one-call diagnosis. Pure inspection — never spawns a browser.
        """
        import importlib.util
        import platform
        import shutil

        def _module(name: str) -> dict[str, Any]:
            spec = importlib.util.find_spec(name)
            info: dict[str, Any] = {"installed": spec is not None}
            if spec is not None:
                try:
                    mod = importlib.import_module(name)
                    info["version"] = getattr(mod, "__version__", None)
                except Exception:
                    info["version"] = None
            return info

        # Chromium/Chrome discovery: PATH, then common macOS app bundle.
        chromium_path = (
            shutil.which("chromium")
            or shutil.which("chromium-browser")
            or shutil.which("google-chrome")
            or shutil.which("google-chrome-stable")
            or os.environ.get("CHROME_EXECUTABLE_PATH")
        )
        if not chromium_path and sys.platform == "darwin":
            for candidate in (
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ):
                if Path(candidate).exists():
                    chromium_path = candidate
                    break

        report = {
            "python_version": platform.python_version(),
            "python_executable": sys.executable,
            "browser_use": _module("browser_use"),
            "mcp": _module("mcp"),
            "playwright": _module("playwright"),
            "chromium_present": chromium_path is not None,
            "chromium_path": chromium_path,
            "api_keys": {
                "ANTHROPIC_API_KEY": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "OPENAI_API_KEY": bool(os.environ.get("OPENAI_API_KEY")),
                "BROWSER_USE_API_KEY": bool(os.environ.get("BROWSER_USE_API_KEY")),
            },
        }
        return json.dumps(report, indent=2)

    # ------------------------------------------------------------------
    # Graceful shutdown
    # ------------------------------------------------------------------

    @staticmethod
    def _kill_session_sync(session: Any) -> None:
        """
        Best-effort synchronous kill of one BrowserSession. Never raises.

        Under keep_alive=True, session.stop()/close() are NO-OPS on Chrome —
        only session.kill() actually terminates the browser (browser-use 0.13.1).
        """
        # Preferred path: run the async kill() to completion.
        try:
            asyncio.run(asyncio.wait_for(session.kill(), timeout=5))
        except RuntimeError:
            # Event loop already running (signal handler inside the server loop)
            # or already closed (late atexit) — fall through to the hard kill.
            pass
        except Exception:
            pass

        # Hard fallback: terminate the Chrome subprocess handle directly.
        # This is a TARGETED single-process kill via the session's own psutil
        # handle — never a pattern/name-based kill.
        try:
            watchdog = getattr(session, "_local_browser_watchdog", None)
            proc = getattr(watchdog, "_subprocess", None) if watchdog is not None else None
            if proc is not None and proc.is_running():
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except Exception:
                    proc.kill()
        except Exception:
            pass

    def _shutdown_sync(self) -> None:
        """
        Best-effort synchronous cleanup on process exit.
        Kills Chrome for the primary session AND every tracked session, then
        removes the PID-scoped profile directory.
        """
        pid = os.getpid()
        profile_dir = (
            Path.home() / ".config" / "browseruse" / "profiles" / f"session-{pid}"
        )

        # Collect every session: primary + all tracked (import/cloud) sessions.
        sessions: list[Any] = []
        primary = getattr(self, "browser_session", None)
        if primary is not None:
            sessions.append(primary)
        try:
            for entry in list(getattr(self, "active_sessions", {}).values()):
                session = entry.get("session") if isinstance(entry, dict) else None
                if session is not None and session is not primary:
                    sessions.append(session)
        except Exception:
            pass

        for session in sessions:
            self._kill_session_sync(session)

        # Remove the entire PID-scoped profile directory.
        # This is safe — each session gets its own dir, and persistent state should
        # be exported via browser_export_session before closing. Leaving stale dirs
        # causes unbounded disk growth (~50MB per Chrome profile).
        import shutil

        try:
            if profile_dir.exists():
                shutil.rmtree(profile_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Signal / atexit wiring
# ---------------------------------------------------------------------------

def _install_shutdown_handlers(server: MagusBrowserServer) -> None:
    """Register atexit and POSIX signal handlers for graceful shutdown."""
    atexit.register(server._shutdown_sync)

    def _handle_signal(signum: int, frame: Any) -> None:
        server._shutdown_sync()
        sys.exit(0)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handle_signal)
        except (OSError, ValueError):
            pass  # Not the main thread, or signal not supported


# ---------------------------------------------------------------------------
# Startup reaper — clean up profiles (and Chrome) left by dead MCP servers
# ---------------------------------------------------------------------------

def _reap_orphaned_profiles(base_dir: Path | None = None) -> None:
    """
    Reap session-{pid} profile directories whose owning MCP server is dead.

    For each ~/.config/browseruse/profiles/session-{pid} dir where {pid} is no
    longer a live process: terminate any process whose cmdline contains the
    EXACT --user-data-dir substring 'browseruse/profiles/session-{pid}' (a
    targeted match — never name-based, never touches the user's real Chrome,
    whose cmdline has no browseruse path), then rmtree the directory.

    The 'default' profile dir and dirs of live PIDs are never touched.
    Best-effort: never raises (called before server startup).

    Args:
        base_dir: profiles directory override for tests. Defaults to
                  ~/.config/browseruse/profiles.
    """
    try:
        import shutil

        import psutil  # browser-use dependency — safe to import

        profiles_dir = base_dir if base_dir is not None else (
            Path.home() / ".config" / "browseruse" / "profiles"
        )
        if not profiles_dir.is_dir():
            return

        reaped: list[str] = []
        for entry in sorted(profiles_dir.glob("session-*")):
            if not entry.is_dir():
                continue
            pid_str = entry.name[len("session-"):]
            if not pid_str.isdigit():
                continue
            pid = int(pid_str)
            if pid == os.getpid() or psutil.pid_exists(pid):
                continue  # owner still alive (or it's us) — leave it alone

            # Owner is dead: kill any Chrome still running on this exact profile.
            marker = f"browseruse/profiles/session-{pid}"
            for proc in psutil.process_iter(["pid", "cmdline"]):
                try:
                    cmdline = proc.info.get("cmdline") or []
                    if not any(marker in arg for arg in cmdline):
                        continue
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except psutil.TimeoutExpired:
                        proc.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
                except Exception:
                    continue

            shutil.rmtree(entry, ignore_errors=True)
            reaped.append(entry.name)

        if reaped:
            print(
                f"browser-use MCP: reaped {len(reaped)} orphaned profile(s): "
                f"{', '.join(reaped)}",
                file=sys.stderr,
            )
    except Exception:
        pass  # Reaping is opportunistic — never block server startup


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    """Start the MCP stdio server."""
    _reap_orphaned_profiles()

    server = MagusBrowserServer()
    _install_shutdown_handlers(server)

    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="browser-use",
                server_version=get_browser_use_version(),
                capabilities=server.server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    asyncio.run(main())
