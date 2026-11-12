#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "browser-use==1.0.0",
#     "mcp==2.3.0",
#     "playwright==1.63.0",
# ]
# ///
"""
Browser Use MCP Server: a standalone mcp 2.x stdio server on browser-use 1.0.

browser-use 1.0 ships no MCP server with page-level tools, so this file owns the
whole tool surface: 27 tools, each with a fixed name and fixed input properties.
It drives `browser_use.Browser` objects, and every page action is a raw CDP
command sent through the browser-harness daemon each Browser starts (`_cdp`,
`_meta`). Element clicks and typing by index go through `browser_use.ax`'s
AxHelpers, whose element ids are Chrome backendNodeIds.

browser-use 1.0 owns the browser lifecycle: each local Browser gets a temp
profile, a watchdog that cleans up if this process dies, and atexit / SIGTERM /
SIGHUP handlers that stop every live Browser. This server keeps only what 1.0
does not do:

  - Launch Playwright's Chromium, never the user's real Chrome. 1.0's own binary
    search tries /Applications/Google Chrome.app first, so the binary is always
    resolved here (browser_env.py) and passed as executable_path. A Chromium that
    cannot be resolved is a hard error naming `magus doctor --fix`.
  - Send downloads to ~/.config/browseruse/downloads. Chrome's default,
    ~/Downloads, is TCC-protected on macOS.
  - Stop sessions idle for 10 minutes, and exit when the parent process (the
    lazy front, or `claude` when started directly) is gone.
  - Keep stdout for JSON-RPC alone: nothing the server, browser_use or
    browser_harness prints may reach it.
  - Suppress the macOS Python "rocket" dock icon.

Usage (via .mcp.json): uv builds the env this file's PEP 723 header declares.
`--no-config` keeps a uv.toml or pyproject.toml in the project it runs in out of
that env.
    uv run --no-config --script /path/to/mcp-server.py --lazy

`--lazy` runs the small stdlib-only front in mcp_front.py instead: it answers the
handshake and `tools/list` itself, starts this file without the flag as its child
on the first browser call, and stops that child after 10 idle minutes once it
holds no browser. Without `--lazy` this file is the full server, which is how the
tests and scripts/manual-verify start it:
    uv run --no-config --script /path/to/mcp-server.py

Test mode (full imports):
    uv run --no-config --script mcp-server.py --test

Dependency checks (plugin.json `requires`; file reads only, see browser_env.py):
    uv run --offline --no-config --script mcp-server.py --check-env | --check-chromium | --check-chromium-libs
"""

import os
import sys

# browser_env sits beside this file. `uv run --script` already puts this
# directory on sys.path; a test loading the file by path does not.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import browser_env  # noqa: E402

# The dependency checks run on every session start: answer them before any
# heavy import, the dock workaround included.
for _flag in browser_env.CHECK_FLAGS:
    if _flag in sys.argv[1:]:
        sys.exit(browser_env.check(_flag))

# The lazy front imports only the standard library, so it is handed the process
# before the dock workaround and every heavy import. On POSIX the interpreter is
# replaced (same pid) by one that runs mcp_front.py alone: compiling this file's
# source has already cost several MB of resident memory the front would keep.
if "--lazy" in sys.argv[1:]:
    _server_path = os.path.abspath(__file__)
    if os.name == "posix":
        import subprocess  # noqa: E402

        _front_path = os.path.join(os.path.dirname(_server_path), "mcp_front.py")
        _flags = getattr(subprocess, "_args_from_interpreter_flags", list)()
        try:
            os.execv(sys.executable, [sys.executable, *_flags, _front_path, _server_path])
        except OSError as _exc:
            print(f"browser-use front: could not re-exec ({_exc}); running in this process", file=sys.stderr)
    import mcp_front  # noqa: E402

    sys.exit(mcp_front.main(server_path=_server_path))

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

# Quiet browser_use before it is imported. MCP uses stdout for JSON-RPC, and any
# stray output breaks the protocol.
os.environ["BROWSER_USE_LOGGING_LEVEL"] = "critical"
os.environ["BROWSER_USE_SETUP_LOGGING"] = "false"

import importlib.metadata  # noqa: E402
import importlib.util  # noqa: E402
import re  # noqa: E402


def _package_version(dist: str) -> str | None:
    """The installed version of a distribution, or None when it is absent."""
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None


def _pinned_version(dist: str) -> str | None:
    """The version this file's PEP 723 header pins for `dist`, or None."""
    try:
        with open(os.path.abspath(__file__), encoding="utf-8") as fh:
            header = fh.read(2048)
    except OSError:
        return None
    match = re.search(rf'"{re.escape(dist)}==([^"]+)"', header)
    return match.group(1) if match else None


def _import_dependencies() -> str | None:
    """
    Import what the server needs. Returns None, or the one line that says why
    the server cannot run in this interpreter.

    A missing package and an installed package of the wrong major are different
    problems with different fixes, so they get different messages.
    """
    if importlib.util.find_spec("browser_use") is None:
        return "browser_use is not in this interpreter. Run: magus doctor --fix"
    try:
        import browser_harness._ipc  # noqa: F401
        import browser_use  # noqa: F401
        import browser_use.ax  # noqa: F401
        from browser_use.browser import Browser  # noqa: F401
    except ImportError as exc:
        installed = _package_version("browser-use") or "of an unknown version"
        wanted = _pinned_version("browser-use") or "1.0"
        if installed == wanted:
            return (
                f"browser-use {installed} is installed, but {exc.name or 'part of it'} cannot be "
                f"imported, so the install is incomplete. Run: magus doctor --fix. Details: {exc}"
            )
        return (
            f"browser-use {installed} is installed, but this server is written for browser-use "
            f"{wanted}, and {exc.name or 'part of its API'} is missing. Launch the server with "
            "`uv run --no-config --script mcp-server.py`, which installs the version the script "
            f"header pins. Details: {exc}"
        )
    if importlib.util.find_spec("mcp") is None:
        return "the mcp SDK is not in this interpreter. Run: magus doctor --fix"
    try:
        import mcp.server.stdio  # noqa: F401
        import mcp.types  # noqa: F401
        from mcp.server import Server  # noqa: F401
    except ImportError as exc:
        installed = _package_version("mcp") or "of an unknown version"
        wanted = _pinned_version("mcp") or "2.x"
        return (
            f"mcp {installed} is installed, but this server is written for mcp {wanted}. "
            f"Details: {exc}"
        )
    return None


# --- Test mode: verify imports and exit cleanly ---
if "--test" in sys.argv:
    _problem = _import_dependencies()
    if _problem:
        print(f"browser-use MCP server: FAIL — {_problem}", file=sys.stderr)
        sys.exit(1)
    print("browser-use MCP server: OK")
    print(f"browser-use version: {_package_version('browser-use')}")
    sys.exit(0)

_problem = _import_dependencies()
if _problem:
    print(f"ERROR: {_problem}", file=sys.stderr)
    sys.exit(1)

import asyncio  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
import logging  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import uuid  # noqa: E402
from dataclasses import dataclass, field, replace  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import browser_use  # noqa: E402
import mcp.server.stdio  # noqa: E402
import mcp.types as types  # noqa: E402
from browser_use.ax import CONTROLS  # noqa: E402
from mcp.server import Server  # noqa: E402

from browser_env import _resolve_chromium_binary  # noqa: E402

# Redirect all logging to stderr — stdout must stay clean for MCP JSON-RPC.
logging.basicConfig(
    stream=sys.stderr,
    level=logging.CRITICAL,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    force=True,
)
# Silence all loggers completely — browser_use is very chatty.
logging.disable(logging.CRITICAL)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("true", "1", "yes")


# ---------------------------------------------------------------------------
# The browser-harness daemon channel
# ---------------------------------------------------------------------------
#
# Every browser_use.Browser starts its own browser-harness daemon, named by
# Browser.name, and the daemon holds the CDP connection. These two functions
# are the one place this server talks to a daemon. They mirror browser-use's
# private `_daemon_request` / `_daemon_cdp` (browser/browser.py); a local copy
# keeps that coupling visible in one spot, and the header pins the version.
#
# With session_id None the daemon sends the command to the tab it is attached
# to, and it drops the session for every Target.* method. The leading
# arguments are positional-only because CDP params may themselves be called
# `name` (Network.setCookie).

_DAEMON_CONNECT_TIMEOUT = 5.0
_DAEMON_RESPONSE_TIMEOUT = 30.0


def _daemon_request(name: str, request: dict, timeout: float = _DAEMON_RESPONSE_TIMEOUT) -> dict:
    from browser_harness import _ipc as ipc

    conn, token = ipc.connect(name, timeout=_DAEMON_CONNECT_TIMEOUT)
    try:
        conn.settimeout(timeout)
        return ipc.request(conn, token, request)
    finally:
        conn.close()


def _cdp(name: str, method: str, session_id: str | None = None, /, **params: Any) -> dict:
    """
    One CDP command through the daemon `name`. Raises RuntimeError on a CDP error.

    `_response_timeout` is not a CDP param: it is how long to wait for the
    reply, as in browser_harness.helpers.cdp, whose callers (AxHelpers) pass it.
    """
    timeout = float(params.pop("_response_timeout", None) or _DAEMON_RESPONSE_TIMEOUT)
    response = _daemon_request(
        name, {"method": method, "params": params, "session_id": session_id}, timeout
    )
    if "error" in response:
        raise RuntimeError(f"{method} failed: {response['error']}")
    return response.get("result") or {}


def _meta(name: str, meta: str, /, **fields: Any) -> dict:
    """One daemon meta request (current_tab, set_session, ...). Raises on an error reply."""
    response = _daemon_request(name, {"meta": meta, **fields})
    if isinstance(response, dict) and "error" in response:
        raise RuntimeError(f"daemon {meta} failed: {response['error']}")
    return response


# ---------------------------------------------------------------------------
# AxHelpers: element actions by backendNodeId
# ---------------------------------------------------------------------------

def _import_harness_helpers() -> Any:
    """
    Import browser_harness.helpers without running anything a user put there.

    Its import loads `.env` files and execs <agent workspace>/agent_helpers.py,
    copying every public name into the module. A user's file there could print
    to stdout, which corrupts JSON-RPC, or replace the helpers our tools call.
    So the import sees a private, empty workspace, writes to stderr only, and
    leaves os.environ exactly as it found it.
    """
    module = sys.modules.get("browser_harness.helpers")
    if module is not None:
        return module

    saved_env = dict(os.environ)
    saved_stdout = sys.stdout
    workspace = tempfile.mkdtemp(prefix="magus-bh-workspace-")
    try:
        os.environ["BH_AGENT_WORKSPACE"] = workspace
        sys.stdout = sys.stderr
        import importlib

        return importlib.import_module("browser_harness.helpers")
    finally:
        sys.stdout = saved_stdout
        for key in [k for k in os.environ if k not in saved_env]:
            del os.environ[key]
        for key, value in saved_env.items():
            if os.environ.get(key) != value:
                os.environ[key] = value
        shutil.rmtree(workspace, ignore_errors=True)


def _make_ax_helpers(cdp: Any) -> Any:
    """
    The one place an AxHelpers is built. Its log goes nowhere: the library
    default is print, which would write every action line onto the JSON-RPC
    stream.
    """
    _import_harness_helpers()
    from browser_use.ax import AxHelpers

    return AxHelpers(cdp, log=lambda line: None)


# ---------------------------------------------------------------------------
# Configurable agent-LLM selection
# ---------------------------------------------------------------------------
#
# browser_extract_content and retry_with_browser_use_agent reason with a chat
# model. Users pick the provider and model per project (settings.json
# "browser-use".agentModel) or per session (browser_set_agent_model), with a
# default. The classes are browser-use 1.0's own Chat wrappers, which Agent and
# Pydantic AI both accept.


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
    # browser-use 1.0's ChatAnthropic takes no base_url.
    "anthropic": ProviderSpec(
        import_path="browser_use:ChatAnthropic",
        default_key_env="ANTHROPIC_API_KEY",
        supports_base_url=False,
        send_temperature=False,
    ),
    "openai": ProviderSpec(
        import_path="browser_use:ChatOpenAI",
        default_key_env="OPENAI_API_KEY",
        supports_base_url=True,
        send_temperature=True,
    ),
    "openai_compatible": ProviderSpec(
        import_path="browser_use:ChatOpenAI",
        default_key_env=None,
        supports_base_url=True,
        requires_base_url=True,
        send_temperature=True,
    ),
    "browser_use": ProviderSpec(
        import_path="browser_use:ChatBrowserUse",
        default_key_env="BROWSER_USE_API_KEY",
        supports_base_url=True,
        send_temperature=False,
    ),
}

# Default when nothing is configured: Anthropic's flagship, key from the env.
_DEFAULT_LLM = LLMChoice(
    provider="anthropic",
    model="claude-sonnet-5-5",
    api_key_env="ANTHROPIC_API_KEY",
    temperature=None,
)

# browser-use 1.0's default Browser Use gateway model.
_DEFAULT_BROWSER_USE_MODEL = "bu-fast"


def _build_llm(choice: LLMChoice) -> Any:
    """
    Instantiate a browser_use chat model for the given LLMChoice.

    Resolves the API key from the chosen (or default) env var, and forwards
    temperature and base_url only to providers that accept them. Raises
    ValueError for an unknown provider or a base_url the provider cannot take,
    and RuntimeError when a required base_url or API key is absent. The class
    itself raises ValueError for a 0.x gateway model such as bu-latest.
    """
    spec = _PROVIDER_REGISTRY.get(choice.provider)
    if spec is None:
        raise ValueError(
            f"Unknown provider {choice.provider!r}; valid: {sorted(_PROVIDER_REGISTRY)}"
        )
    if choice.base_url and not spec.supports_base_url:
        raise ValueError(
            f"Provider {choice.provider!r} takes no base_url in browser-use 1.0. Drop "
            "base_url, or use provider 'openai_compatible' for an OpenAI-compatible endpoint."
        )
    if spec.requires_base_url and not choice.base_url:
        raise RuntimeError(
            f"Provider {choice.provider!r} requires a base_url (none provided)."
        )

    key_env = choice.api_key_env or spec.default_key_env
    api_key = os.environ.get(key_env) if key_env else None
    if choice.provider == "openai_compatible" and api_key is None:
        raise RuntimeError(
            f"openai_compatible provider requires an API key. Set the "
            f"{key_env!r} environment variable" if key_env else
            "openai_compatible provider requires an API key via api_key_env."
        )

    module_path, class_name = spec.import_path.split(":")
    chat_cls = getattr(importlib.import_module(module_path), class_name)

    kwargs: dict[str, Any] = {"model": choice.model, "api_key": api_key}
    if spec.supports_base_url and choice.base_url:
        kwargs["base_url"] = choice.base_url
    if spec.send_temperature and choice.temperature is not None:
        kwargs["temperature"] = choice.temperature
    return chat_cls(**kwargs)


def _missing_api_key(choice: LLMChoice) -> str | None:
    """The env var a model call would need and does not have, or None."""
    spec = _PROVIDER_REGISTRY.get(choice.provider)
    if spec is None or choice.provider in ("openai_compatible", "browser_use"):
        # openai_compatible: _build_llm checks it. browser_use: a stored
        # `browser-use login` also counts, which only the class can see.
        return None
    key_env = choice.api_key_env or spec.default_key_env
    if key_env and not os.environ.get(key_env, "").strip():
        return key_env
    return None


def _missing_key_message(tool: str, choice: LLMChoice, missing: str) -> str:
    """The error a model-backed tool returns, before it starts anything, when its key is unset."""
    return (
        f"Error: {tool} needs an API key for the agent model "
        f"({choice.provider}/{choice.model}): set {missing}, or choose another model "
        "with browser_set_agent_model."
    )


# ---------------------------------------------------------------------------
# Browser options
# ---------------------------------------------------------------------------

def _downloads_dir() -> Path:
    return Path.home() / ".config" / "browseruse" / "downloads"


def _local_browser_options() -> dict[str, Any]:
    """
    Keyword arguments for a local browser_use.Browser: Playwright's Chromium.

    executable_path is always set. 1.0's own search tries the user's
    /Applications/Google Chrome.app first and Playwright's cache last, so leaving
    it unset is how the real Chrome gets hijacked. headless is always set too:
    1.0 does not read BROWSER_USE_HEADLESS. No user_data_dir: 1.0 then gives
    each Browser its own temp profile and removes it on stop.
    """
    return {
        "kind": "chromium",
        "executable_path": _resolve_chromium_binary(),
        "headless": _env_flag("BROWSER_USE_HEADLESS"),
    }


def _browser_options() -> dict[str, Any]:
    """
    Keyword arguments for the browser_use.Browser a primary session starts.

    BROWSER_USE_CLOUD=true makes it a Browser Use cloud browser, which takes no
    local options at all.
    """
    if _env_flag("BROWSER_USE_CLOUD"):
        if not os.environ.get("BROWSER_USE_API_KEY"):
            raise RuntimeError(
                "BROWSER_USE_CLOUD is set but BROWSER_USE_API_KEY is missing. "
                "Get a key at https://cloud.browser-use.com and export BROWSER_USE_API_KEY."
            )
        return {"use_cloud": True}
    return _local_browser_options()


# ---------------------------------------------------------------------------
# Tool definitions — the public contract
# ---------------------------------------------------------------------------

_READ_ONLY = types.ToolAnnotations(read_only_hint=True)
_EMPTY_SCHEMA: dict[str, Any] = {"type": "object", "properties": {}}
_INDEX_DESCRIPTION = (
    "The element's index from browser_get_state's interactive_elements (a Chrome "
    "backendNodeId, stable while the element exists)."
)

_PAGE_TOOLS: list[types.Tool] = [
    types.Tool(
        name="browser_navigate",
        description="Navigate to a URL in the browser",
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The URL to navigate to"},
                "new_tab": {"type": "boolean", "description": "Whether to open in a new tab", "default": False},
            },
            "required": ["url"],
        },
    ),
    types.Tool(
        name="browser_click",
        description=(
            "Click an element by index or at specific viewport coordinates. Use index for "
            "elements from browser_get_state, or coordinate_x/coordinate_y for pixel-precise clicking."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "index": {
                    "type": "integer",
                    "description": f"{_INDEX_DESCRIPTION} Provide this OR coordinate_x+coordinate_y.",
                },
                "coordinate_x": {
                    "type": "integer",
                    "description": (
                        "X coordinate in pixels from the left edge of the viewport. Must be used "
                        "together with coordinate_y. Provide this OR index."
                    ),
                },
                "coordinate_y": {
                    "type": "integer",
                    "description": (
                        "Y coordinate in pixels from the top edge of the viewport. Must be used "
                        "together with coordinate_x. Provide this OR index."
                    ),
                },
                "new_tab": {
                    "type": "boolean",
                    "description": "Open a clicked link in a new tab instead of clicking it",
                    "default": False,
                },
            },
        },
    ),
    types.Tool(
        name="browser_type",
        description='Type text into an input field. Clears existing text by default; pass text="" to clear only.',
        input_schema={
            "type": "object",
            "properties": {
                "index": {"type": "integer", "description": _INDEX_DESCRIPTION},
                "text": {
                    "type": "string",
                    "description": 'The text to type. Pass an empty string ("") to clear the field without typing.',
                },
            },
            "required": ["index", "text"],
        },
    ),
    types.Tool(
        name="browser_get_state",
        description=(
            "Get the current state of the page including all interactive elements. Each "
            "element's index is a Chrome backendNodeId; pass it to browser_click or browser_type."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "include_screenshot": {
                    "type": "boolean",
                    "description": "Whether to include a screenshot of the current page",
                    "default": False,
                },
            },
        },
        annotations=_READ_ONLY,
    ),
    types.Tool(
        name="browser_extract_content",
        description=(
            "Extract structured content from the current page based on a query. Uses the "
            "agent model (browser_set_agent_model / settings.json agentModel)."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What information to extract from the page"},
                "extract_links": {
                    "type": "boolean",
                    "description": "Whether to include links in the extraction",
                    "default": False,
                },
            },
            "required": ["query"],
        },
    ),
    types.Tool(
        name="browser_get_html",
        description="Get the raw HTML of the current page or a specific element by CSS selector",
        input_schema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": (
                        "Optional CSS selector to get HTML of a specific element. If omitted, "
                        "returns full page HTML."
                    ),
                },
            },
        },
        annotations=_READ_ONLY,
    ),
    types.Tool(
        name="browser_screenshot",
        description=(
            "Take a screenshot of the current page. Returns viewport metadata as text and the "
            "screenshot as an image."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "full_page": {
                    "type": "boolean",
                    "description": "Whether to capture the full scrollable page or just the visible viewport",
                    "default": False,
                },
            },
        },
        annotations=_READ_ONLY,
    ),
    types.Tool(
        name="browser_scroll",
        description="Scroll the page",
        input_schema={
            "type": "object",
            "properties": {
                "direction": {
                    "type": "string",
                    "enum": ["up", "down"],
                    "description": "Direction to scroll",
                    "default": "down",
                },
            },
        },
    ),
    types.Tool(
        name="browser_go_back",
        description="Go back to the previous page",
        input_schema=_EMPTY_SCHEMA,
    ),
    types.Tool(
        name="browser_list_tabs",
        description="List all open tabs",
        input_schema=_EMPTY_SCHEMA,
        annotations=_READ_ONLY,
    ),
    types.Tool(
        name="browser_switch_tab",
        description="Switch to a different tab",
        input_schema={
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "4 Character Tab ID of the tab to switch to"},
            },
            "required": ["tab_id"],
        },
    ),
    types.Tool(
        name="browser_close_tab",
        description="Close a tab",
        input_schema={
            "type": "object",
            "properties": {
                "tab_id": {"type": "string", "description": "4 Character Tab ID of the tab to close"},
            },
            "required": ["tab_id"],
        },
    ),
    types.Tool(
        name="retry_with_browser_use_agent",
        description=(
            "Retry a task using the browser-use agent, in a fresh local Chromium of its own. "
            "Only use this as a last resort if you fail to interact with a page multiple times."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": (
                        "The high-level goal and detailed step-by-step description of the task the AI "
                        "browser agent needs to attempt, along with any relevant data needed to complete "
                        "the task and info about previous attempts."
                    ),
                },
                "max_steps": {
                    "type": "integer",
                    "description": "Maximum number of steps an agent can take.",
                    "default": 100,
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Model name for the configured agent provider, replacing its configured "
                        "model for this run."
                    ),
                },
                "allowed_domains": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Domains the agent's browser may open (security feature), e.g. "
                        "'example.com' or '*.example.com'. Omit, or pass an empty list, for no restriction."
                    ),
                },
                "use_vision": {
                    "type": "boolean",
                    "description": "Whether the agent's model sees screenshots. false keeps them from the model.",
                    "default": True,
                },
            },
            "required": ["task"],
        },
    ),
    types.Tool(
        name="browser_list_sessions",
        description="List all active browser sessions with their details and last activity time",
        input_schema=_EMPTY_SCHEMA,
        annotations=_READ_ONLY,
    ),
    types.Tool(
        name="browser_close_session",
        description="Close a specific browser session by its ID",
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The browser session ID to close (get from browser_list_sessions)",
                },
            },
            "required": ["session_id"],
        },
    ),
    types.Tool(
        name="browser_close_all",
        description="Close all active browser sessions and clean up resources",
        input_schema=_EMPTY_SCHEMA,
    ),
]

_CUSTOM_TOOLS: list[types.Tool] = [
    types.Tool(
        name="browser_export_session",
        description=(
            "Export browser session state (cookies) to a JSON file. Useful for saving "
            "authenticated sessions to re-use in future Claude Code sessions via "
            "browser_import_session."
        ),
        input_schema={
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
            "Enables re-authentication across Claude Code sessions without logging in again. "
            "The new session becomes the one the page tools drive when none is active."
        ),
        input_schema={
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
        input_schema={
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
        input_schema={
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
        input_schema={
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
        input_schema={
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
        input_schema={
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
        name="browser_save_screenshot",
        description=(
            "Capture the live page the other browser tools are driving and WRITE it "
            "to a PNG file. browser_screenshot only shows the image to the model; "
            "use this when a file on disk is needed (pixel diffs, design references, "
            "attachments). Captures via CDP Page.captureScreenshot. Returns the path, "
            "byte count and pixel size."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "output_path": {
                    "type": "string",
                    "description": "Absolute path of the .png file to write. Parent directories are created.",
                },
                "full_page": {
                    "type": "boolean",
                    "description": "Capture the whole scrollable page instead of the viewport.",
                    "default": False,
                },
            },
            "required": ["output_path"],
        },
    ),
    types.Tool(
        name="browser_doctor",
        description=(
            "Preflight diagnosis of this plugin's environment. Reports the Python "
            "version, whether browser-use / browser-harness / mcp / playwright are "
            "installed, whether a Chromium/Chrome executable is present, and which provider "
            "API keys are set — turning silent failures (a 300s run_script hang, "
            "ModuleNotFoundError) into a one-call diagnosis. Takes no arguments."
        ),
        input_schema=_EMPTY_SCHEMA,
    ),
    types.Tool(
        name="browser_start_cloud_session",
        description=(
            "Start a Browser Use CLOUD browser session (remote, stealth, CAPTCHA-capable). "
            "Requires BROWSER_USE_API_KEY. Returns session_id, cdp_url, and a live_url "
            "you can open to watch the remote browser. If no session is active, the "
            "cloud session becomes the one the page tools drive."
        ),
        input_schema={
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
            "Choose which LLM the browser agent (retry_with_browser_use_agent) and "
            "browser_extract_content reason with, for the rest of this session. Overrides "
            "any settings.json config. Providers: 'anthropic', 'openai', "
            "'openai_compatible' (any OpenAI-API-compatible endpoint — requires base_url), "
            "'browser_use' (Browser Use gateway models such as bu-fast). 'anthropic' takes "
            "no base_url. api_key_env names an ENVIRONMENT VARIABLE that holds the key — "
            "never pass a secret directly. The model is built at once, so a bad choice is "
            "reported here, and applies from the next call on."
        ),
        input_schema={
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
                        "optional override for 'openai' and 'browser_use'."
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

_ALL_TOOLS: list[types.Tool] = _PAGE_TOOLS + _CUSTOM_TOOLS


# ---------------------------------------------------------------------------
# Page helpers
# ---------------------------------------------------------------------------

# JSON-serialisable page facts in one evaluate (browser_harness.helpers.page_info).
_PAGE_INFO_JS = (
    "({url: location.href, title: document.title, w: innerWidth, h: innerHeight, "
    "sx: scrollX, sy: scrollY, pw: document.documentElement.scrollWidth, "
    "ph: document.documentElement.scrollHeight})"
)
_LOAD_TIMEOUT_SECONDS = 15.0
_LOAD_POLL_SECONDS = 0.3
_SCROLL_PIXELS = 500
_ELEMENT_TEXT_CHARS = 100
_EXTRACT_PAGE_CHARS = 100_000
_SESSION_IDLE_SECONDS = 600
_MAINTENANCE_INTERVAL_SECONDS = 120

# The fields Network.setCookie takes; an exported cookie carries more.
_SET_COOKIE_FIELDS = (
    "name", "value", "url", "domain", "path", "secure", "httpOnly", "sameSite",
    "expires", "priority", "sameParty", "sourceScheme", "sourcePort", "partitionKey",
)


def _looks_sensitive(text: str) -> str | None:
    """
    'email' or 'credential' for text that is probably secret, else None. Only
    very obvious patterns are flagged, to keep false positives rare.
    """
    if len(text) < 6:
        return None
    if "@" in text and "." in text.split("@")[-1]:
        return "email"
    if (
        len(text) >= 16
        and any(ch.isdigit() for ch in text)
        and any(ch.isalpha() for ch in text)
        and any(ch in ".-_" for ch in text)
    ):
        return "credential"
    return None


def _attributes(node: dict) -> dict[str, str]:
    """DOM.describeNode's flat [name, value, ...] attribute list as a dict."""
    flat = node.get("attributes") or []
    return {flat[i]: flat[i + 1] for i in range(0, len(flat) - 1, 2)}


def _ax_value(field_value: Any) -> Any:
    return field_value.get("value") if isinstance(field_value, dict) else None


def _png_size(png: bytes) -> tuple[int, int]:
    """Width and height from a PNG's IHDR chunk (bytes 16-24, big-endian)."""
    return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")


class _ToolError(Exception):
    """A tool failure reported to the model as the tool's own text result."""


class _JavaScriptError(RuntimeError):
    """A script the server evaluated threw, or did not compile."""


def _exception_text(details: dict) -> str:
    """The readable message of a Runtime.evaluate exceptionDetails."""
    exception = details.get("exception") or {}
    return str(exception.get("description") or details.get("text") or "unknown JavaScript exception")


@dataclass
class _Session:
    """One browser this server started, and what list_sessions reports about it."""

    browser: Any
    kind: str  # "local", "cloud" or "import"
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    url: str | None = None

    @property
    def name(self) -> str:
        """The browser-harness daemon name of this session's Browser."""
        name = getattr(self.browser, "name", None)
        if not name:
            raise _ToolError("Error: this browser session is no longer running.")
        return name


# Tools that do not take the browser lock: they never touch a live session's
# daemon, or (retry) run in a browser of their own for minutes at a time.
_UNLOCKED_TOOLS = frozenset({
    "retry_with_browser_use_agent",
    "browser_run_script",
    "browser_doctor",
    "browser_set_agent_model",
    "browser_extract_content",
})

# Tools that need a primary session and start one when there is none.
_AUTOSTART_TOOLS = frozenset({
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_get_state",
    "browser_get_html",
    "browser_screenshot",
    "browser_scroll",
    "browser_go_back",
    "browser_list_tabs",
    "browser_switch_tab",
    "browser_close_tab",
})

_NO_SESSION = "Error: No browser session active. Navigate first (browser_navigate)."


def _load_note(loaded: bool) -> str:
    """What navigate appends to its result: nothing, or that the page is still loading."""
    if loaded:
        return ""
    return (
        f" (still loading after {_LOAD_TIMEOUT_SECONDS:g} s: the page may not be ready; "
        "check it with browser_get_state before acting on it)"
    )


# ---------------------------------------------------------------------------
# The server
# ---------------------------------------------------------------------------

class MagusBrowserServer:
    """
    The MCP server: tool definitions, a session registry, and one handler per
    tool. `self.server` is the mcp lowlevel Server that main() runs over stdio.
    """

    def __init__(self) -> None:
        self.server = Server(
            "browser-use",
            version=_package_version("browser-use") or "",
            on_list_tools=self._handle_list_tools,
            on_call_tool=self._handle_call_tool,
        )
        self._sessions: dict[str, _Session] = {}
        # The session the page tools drive.
        self._primary: str | None = None
        # Daemon IPC is blocking and stateful (the attached tab): one tool at a time.
        self._lock = asyncio.Lock()
        self._ax: Any = None
        self._ax_name: str | None = None
        # Per-session agent-LLM override set via browser_set_agent_model. When
        # None, the resolver falls back to settings.json config then _DEFAULT_LLM.
        self._session_llm_override: LLMChoice | None = None
        # The process that spawned us: the lazy front, or `claude` when started
        # directly. os.getppid() changes the instant the kernel reparents us,
        # which is how the maintenance loop notices a SIGKILLed parent — see
        # _exit_if_parent_died().
        self._parent_pid = os.getppid()

    # ------------------------------------------------------------------
    # MCP handlers
    # ------------------------------------------------------------------

    async def _handle_list_tools(self, _ctx: Any, _params: Any) -> types.ListToolsResult:
        return types.ListToolsResult(tools=list(_ALL_TOOLS))

    async def _handle_call_tool(self, _ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        """Run one tool. A failure is a tool result the model can read, never a JSON-RPC error."""
        try:
            result = await self._execute_tool(params.name, params.arguments or {})
        except Exception as exc:
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=f"Error: {exc}")],
                is_error=True,
            )
        if isinstance(result, list):
            return types.CallToolResult(content=result)
        return types.CallToolResult(content=[types.TextContent(type="text", text=result)])

    async def _execute_tool(
        self, name: str, arguments: dict[str, Any]
    ) -> str | list[types.TextContent | types.ImageContent]:
        """Dispatch one tool call by name. Raises ValueError for a tool that does not exist."""
        handler = getattr(self, f"_handle_{name.removeprefix('browser_')}", None)
        if name not in _TOOL_NAMES or handler is None:
            raise ValueError(f"Unknown tool: {name}")
        try:
            if name in _UNLOCKED_TOOLS:
                return await handler(arguments)
            async with self._lock:
                if name in _AUTOSTART_TOOLS:
                    await self._ensure_primary()
                return await handler(arguments)
        except _ToolError as exc:
            return str(exc)

    # ------------------------------------------------------------------
    # Sessions
    # ------------------------------------------------------------------

    def _register(self, browser: Any, kind: str, url: str | None = None) -> str:
        key = uuid.uuid4().hex
        self._sessions[key] = _Session(browser=browser, kind=kind, url=url)
        return key

    def _primary_session(self) -> _Session | None:
        if self._primary is None:
            return None
        session = self._sessions.get(self._primary)
        if session is None:
            self._primary = None
        return session

    def _live(self) -> _Session:
        """The primary session, marked active. Raises _ToolError when there is none."""
        session = self._primary_session()
        if session is None:
            raise _ToolError(_NO_SESSION)
        session.last_activity = time.time()
        return session

    async def _ensure_primary(self) -> _Session:
        """The primary session, starting a browser for it when there is none."""
        session = self._primary_session()
        if session is not None:
            session.last_activity = time.time()
            return session
        options = _browser_options()
        browser = browser_use.Browser(**options)
        await browser.start()
        kind = "cloud" if options.get("use_cloud") else "local"
        self._primary = self._register(browser, kind)
        if kind == "local":
            await self._send_downloads(self._sessions[self._primary])
        return self._sessions[self._primary]

    async def _send_downloads(self, session: _Session) -> None:
        """
        Point the browser's downloads at ~/.config/browseruse/downloads.

        browser-use 1.0 sets a downloads directory only for Agent runs, so
        Chrome would otherwise use the TCC-protected ~/Downloads. The setting
        goes on a browser-target session so it covers every tab. 'allow' keeps
        the file's own name; 1.0's 'allowAndName' saves a GUID that only its
        REPL worker renames.
        """
        downloads = _downloads_dir()
        downloads.mkdir(parents=True, exist_ok=True)
        browser_session = (await self._daemon(session.name, "Target.attachToBrowserTarget"))["sessionId"]
        await self._daemon(
            session.name,
            "Browser.setDownloadBehavior",
            browser_session,
            behavior="allow",
            downloadPath=str(downloads),
            eventsEnabled=True,
        )

    async def _close_session(self, session_id: str) -> str:
        """Stop one session's browser and forget it. The caller holds the lock."""
        session = self._sessions.get(session_id)
        if session is None:
            return f"Session {session_id} not found"
        try:
            await session.browser.stop()
        except Exception as exc:
            return f"Error closing session {session_id}: {exc}"
        # A cloud stop that fails returns normally and keeps the browser's
        # cloud id; a successful one clears it, and a local browser has none.
        cloud_id = getattr(session.browser, "id", None)
        if cloud_id:
            return (
                f"Error closing session {session_id}: the cloud browser {cloud_id} could not be "
                "stopped and is still running. Close the session again to retry."
            )
        del self._sessions[session_id]
        if self._primary == session_id:
            self._primary = None
        return f"Successfully closed session {session_id}"

    async def _cleanup_expired_sessions(self) -> None:
        """
        Stop sessions idle longer than 10 minutes, then exit if the parent is
        gone. Never raises: it runs inside the maintenance loop, and taking that
        loop down would silently end both jobs.
        """
        def idle(key: str) -> bool:
            session = self._sessions.get(key)
            return session is not None and time.time() - session.last_activity > _SESSION_IDLE_SECONDS

        if any(idle(key) for key in list(self._sessions)):
            async with self._lock:
                # Checked again under the lock: a tool that held it may have
                # just used one of these sessions.
                for key in [key for key in list(self._sessions) if idle(key)]:
                    try:
                        await self._close_session(key)
                    except Exception:
                        pass
        self._exit_if_parent_died()

    async def _maintenance_loop(self) -> None:
        while True:
            try:
                await self._cleanup_expired_sessions()
            except Exception:
                pass
            await asyncio.sleep(_MAINTENANCE_INTERVAL_SECONDS)

    def _exit_if_parent_died(self) -> None:
        """
        Exit when the `claude` process that spawned us is gone.

        A SIGKILLed parent leaves us reparented to init: nobody reads our stdio,
        nobody signals us, and our browsers would survive indefinitely. Comparing
        os.getppid() against the value captured at startup catches reparenting
        to init and to a subreaper alike.

        The exit is a SIGTERM to ourselves, so browser-use's own handler stops
        every live Browser before the process ends. With no Browser constructed
        the default action ends the process, and there is nothing to clean.
        """
        try:
            if os.getppid() == self._parent_pid:
                return
        except Exception:
            return  # Cannot tell — never exit on a guess.

        print(
            f"browser-use MCP: parent process {self._parent_pid} is gone — shutting down",
            file=sys.stderr,
        )
        try:
            sys.stderr.flush()
        except Exception:
            pass
        os.kill(os.getpid(), signal.SIGTERM)

    # ------------------------------------------------------------------
    # Daemon calls
    # ------------------------------------------------------------------

    async def _daemon(self, name: str, method: str, session_id: str | None = None, /, **params: Any) -> dict:
        """_cdp in a worker thread: the harness IPC uses blocking sockets."""
        return await asyncio.to_thread(_cdp, name, method, session_id, **params)

    async def _daemon_meta(self, name: str, meta: str, /, **fields: Any) -> dict:
        return await asyncio.to_thread(_meta, name, meta, **fields)

    async def _page(self, method: str, /, **params: Any) -> dict:
        """One CDP command on the primary session's attached tab."""
        return await self._daemon(self._live().name, method, None, **params)

    async def _evaluate_value(self, expression: str) -> Any:
        """
        The value of a JavaScript expression in the attached tab. Raises
        _JavaScriptError when the expression throws or does not compile, so a
        broken script is never mistaken for a null result.
        """
        result = await self._page("Runtime.evaluate", expression=expression, returnByValue=True)
        details = result.get("exceptionDetails")
        if details:
            raise _JavaScriptError(_exception_text(details))
        return (result.get("result") or {}).get("value")

    async def _main_frame_loader(self) -> str | None:
        tree = (await self._page("Page.getFrameTree")).get("frameTree") or {}
        return (tree.get("frame") or {}).get("loaderId")

    async def _wait_for_load(self, loader_id: str | None = None) -> bool:
        """
        Wait until the main frame's document is 'complete', for up to 15 s.
        Returns False on timeout.

        With the loaderId Page.navigate returned, the wait first lets the new
        document commit: until then readyState is the OLD document's, which
        usually reads 'complete' already.
        """
        deadline = time.monotonic() + _LOAD_TIMEOUT_SECONDS
        committed = loader_id is None
        while True:
            try:
                if not committed:
                    committed = await self._main_frame_loader() == loader_id
                if committed and await self._evaluate_value("document.readyState") == "complete":
                    return True
            except RuntimeError:
                pass  # The old document went away mid-navigation; ask again.
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(_LOAD_POLL_SECONDS)

    async def _current_target(self, session: _Session) -> dict:
        return await self._daemon_meta(session.name, "current_tab")

    async def _activate_current_tab(self) -> None:
        """
        Bring the attached tab to the front. A browser-harness daemon works in a
        background tab, where Chrome may answer a capture or key event late or
        not at all.
        """
        session = self._live()
        target = (await self._current_target(session)).get("targetId")
        if target:
            await self._daemon(session.name, "Target.activateTarget", None, targetId=target)

    async def _attach(self, session: _Session, target_id: str) -> None:
        """Attach the daemon to another tab, so every page command goes there."""
        attached = await self._daemon(
            session.name, "Target.attachToTarget", None, targetId=target_id, flatten=True
        )
        await self._daemon_meta(
            session.name, "set_session", session_id=attached["sessionId"], target_id=target_id
        )

    async def _page_targets(self, session: _Session) -> list[dict]:
        infos = (await self._daemon(session.name, "Target.getTargets")).get("targetInfos") or []
        return [info for info in infos if info.get("type") == "page"]

    async def _resolve_tab(self, session: _Session, tab_id: str) -> dict:
        """The page target whose id ends in `tab_id`. Raises _ToolError when none or several do."""
        wanted = str(tab_id or "").strip().lower()
        if not wanted:
            raise _ToolError("Error: tab_id is required.")
        matches = [t for t in await self._page_targets(session) if t["targetId"].lower().endswith(wanted)]
        if not matches:
            raise _ToolError(f"Error: no tab with id {tab_id!r}. Use browser_list_tabs to see the tabs.")
        if len(matches) > 1:
            ids = ", ".join(t["targetId"] for t in matches)
            raise _ToolError(
                f"Error: tab id {tab_id!r} matches {len(matches)} tabs ({ids}); pass more of its id."
            )
        return matches[0]

    async def _navigate_session(self, session: _Session, url: str) -> str | None:
        """Navigate the session's attached tab. Returns the new document's loaderId, if any."""
        result = await self._daemon(session.name, "Page.navigate", None, url=url)
        if result.get("errorText"):
            raise _ToolError(f"Error: navigation to {url} failed: {result['errorText']}")
        session.url = url
        return result.get("loaderId")

    async def _open_tab(self, session: _Session, url: str) -> bool:
        """
        A new background tab, attached, then navigated (browser_harness new_tab).
        Returns whether the page finished loading in time.
        """
        created = await self._daemon(
            session.name, "Target.createTarget", None, url="about:blank", background=True
        )
        await self._attach(session, created["targetId"])
        loader = await self._navigate_session(session, url)
        return await self._wait_for_load(loader)

    async def _capture(self, full_page: bool) -> tuple[str, dict]:
        """
        A PNG of the attached tab, base64, and the clip it covers.

        Always passes an explicit clip. Without one, a headless window whose
        size differs from the CSS viewport returns the page tiled across the
        frame (measured on example.com: a 3x3 grid of the page).
        """
        await self._activate_current_tab()
        metrics = await self._page("Page.getLayoutMetrics")
        params: dict[str, Any] = {"format": "png"}
        if full_page:
            size = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
            clip = {"x": 0, "y": 0, "width": size.get("width", 0), "height": size.get("height", 0)}
            params["captureBeyondViewport"] = True
        else:
            viewport = metrics.get("cssVisualViewport") or metrics.get("visualViewport") or {}
            clip = {
                "x": viewport.get("pageX", 0),
                "y": viewport.get("pageY", 0),
                "width": viewport.get("clientWidth", 0),
                "height": viewport.get("clientHeight", 0),
            }
        if not clip["width"] or not clip["height"]:
            raise _ToolError("Error: the browser reported no page size to capture.")
        params["clip"] = {**clip, "scale": 1}
        result = await self._page("Page.captureScreenshot", **params)
        data = result.get("data")
        if not data:
            raise _ToolError("Error: the browser returned no image data.")
        return data, clip

    def _ax_helpers(self) -> Any:
        """
        The server's AxHelpers, pointed at the primary session's daemon.

        AxHelpers reads daemon events through browser_harness.helpers, which
        connects to the module global helpers.NAME at call time, so that global
        follows the primary session.
        """
        name = self._live().name
        if self._ax is None:
            self._ax = _make_ax_helpers(self._ax_cdp)
        self._ax_name = name
        _import_harness_helpers().NAME = name
        return self._ax

    def _ax_cdp(self, method: str, session_id: str | None = None, /, **params: Any) -> dict:
        """
        The CDP callable AxHelpers is built with. AxHelpers expects the error
        browser_harness raises, the daemon's error text alone, which it parses
        into 'CDP <code>: <message>'; so the method prefix comes off.
        """
        try:
            return _cdp(self._ax_name, method, session_id, **params)
        except RuntimeError as exc:
            prefix = f"{method} failed: "
            text = str(exc)
            if text.startswith(prefix):
                raise RuntimeError(text[len(prefix):]) from None
            raise

    # ------------------------------------------------------------------
    # Agent LLM resolution
    # ------------------------------------------------------------------

    def _resolve_configured_llm(self) -> "LLMChoice | None":
        """
        Resolve the agent LLM from layered settings.json files, then the env.

        Merges the "browser-use"."agentModel" object (later wins) from:
          1. ~/.claude/settings.json
          2. $CLAUDE_PROJECT_DIR/.claude/settings.json
          3. $CLAUDE_PROJECT_DIR/.claude/settings.local.json
        Missing/unreadable files are skipped silently. Returns an LLMChoice when
        the merged config has at least provider + model.

        Without a settings agentModel, BROWSER_USE_API_KEY selects the Browser
        Use gateway: BROWSER_USE_AGENT_MODEL, else bu-fast. Otherwise returns
        None (the caller uses _DEFAULT_LLM).
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

        if os.environ.get("BROWSER_USE_API_KEY"):
            return LLMChoice(
                provider="browser_use",
                model=os.environ.get("BROWSER_USE_AGENT_MODEL") or _DEFAULT_BROWSER_USE_MODEL,
            )

        return None

    def _agent_llm_choice(self) -> LLMChoice:
        """Session override > settings config > default."""
        return self._session_llm_override or self._resolve_configured_llm() or _DEFAULT_LLM

    def _resolve_agent_llm(self) -> Any:
        """Build the agent LLM: session override > settings config > default."""
        return _build_llm(self._agent_llm_choice())

    # ------------------------------------------------------------------
    # Page tools
    # ------------------------------------------------------------------

    async def _handle_navigate(self, args: dict[str, Any]) -> str:
        url = args.get("url")
        if not isinstance(url, str) or not url:
            return "Error: url is required."
        session = self._live()
        if args.get("new_tab"):
            loaded = await self._open_tab(session, url)
            return f"Opened new tab with URL: {url}{_load_note(loaded)}"
        loader = await self._navigate_session(session, url)
        loaded = await self._wait_for_load(loader)
        return f"Navigated to: {url}{_load_note(loaded)}"

    async def _handle_click(self, args: dict[str, Any]) -> str:
        index = args.get("index")
        x, y = args.get("coordinate_x"), args.get("coordinate_y")
        if x is not None and y is not None:
            for kind in ("mousePressed", "mouseReleased"):
                await self._page(
                    "Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1
                )
            return f"Clicked at coordinates ({x}, {y})"
        if index is None:
            return "Error: Provide either index or both coordinate_x and coordinate_y"

        if args.get("new_tab"):
            href = await self._link_href(int(index))
            if href:
                await self._open_tab(self._live(), href)
                return f"Clicked element {index} and opened in new tab {href[:20]}..."
            await asyncio.to_thread(self._ax_helpers().click, int(index))
            return f"Clicked element {index} (new tab not supported for non-link elements)"

        await asyncio.to_thread(self._ax_helpers().click, int(index))
        return f"Clicked element {index}"

    async def _link_href(self, index: int) -> str | None:
        """The absolute href of the element with this backendNodeId, or None."""
        resolved = await self._page("DOM.resolveNode", backendNodeId=index)
        object_id = (resolved.get("object") or {}).get("objectId")
        if not object_id:
            raise _ToolError(f"Element with index {index} not found")
        try:
            result = await self._page(
                "Runtime.callFunctionOn",
                objectId=object_id,
                functionDeclaration=(
                    "function(){ const h = this.getAttribute && this.getAttribute('href');"
                    " return h ? new URL(h, document.baseURI).href : null; }"
                ),
                returnByValue=True,
            )
        finally:
            try:
                await self._page("Runtime.releaseObject", objectId=object_id)
            except Exception:
                pass
        return (result.get("result") or {}).get("value")

    async def _handle_type(self, args: dict[str, Any]) -> str:
        index, text = args.get("index"), args.get("text")
        if index is None or not isinstance(text, str):
            return "Error: index and text are required."
        await asyncio.to_thread(self._ax_helpers().type, int(index), text)
        label = _looks_sensitive(text)
        if label:
            return f"Typed <{label}> into element {index}"
        return f"Typed '{text}' into element {index}"

    async def _handle_get_state(self, args: dict[str, Any]) -> list[types.TextContent | types.ImageContent]:
        session = self._live()
        info = await self._evaluate_value(_PAGE_INFO_JS) or {}
        result: dict[str, Any] = {
            "url": info.get("url"),
            "title": info.get("title"),
            "tabs": [
                {"url": t.get("url"), "title": t.get("title")} for t in await self._page_targets(session)
            ],
            "interactive_elements": await self._interactive_elements(),
            "viewport": {"width": info.get("w"), "height": info.get("h")},
            "page": {"width": info.get("pw"), "height": info.get("ph")},
            "scroll": {"x": info.get("sx"), "y": info.get("sy")},
        }
        if info.get("url"):
            session.url = info["url"]
        image: str | None = None
        if args.get("include_screenshot"):
            image, _clip = await self._capture(full_page=False)
            result["screenshot_dimensions"] = {"width": info.get("w"), "height": info.get("h")}
        content: list[types.TextContent | types.ImageContent] = [
            types.TextContent(type="text", text=json.dumps(result, indent=2))
        ]
        if image:
            content.append(types.ImageContent(type="image", data=image, mime_type="image/png"))
        return content

    async def _ax_nodes(self) -> list[dict]:
        """
        Accessibility nodes of the main frame, then of every child frame the
        attached tab's renderer holds (same-origin, srcdoc and about:blank
        frames), in frame-tree order. This is what AxHelpers reads for its own
        state, so every index listed here is one its click and type can reach.

        A cross-site iframe runs out of process: its tree is not readable
        through this tab's session, the call fails, and that frame is skipped.
        """
        nodes = list((await self._page("Accessibility.getFullAXTree")).get("nodes") or [])
        frame_ids: list[str] = []

        def walk(tree: dict) -> None:
            for child in tree.get("childFrames") or []:
                frame_id = (child.get("frame") or {}).get("id")
                if frame_id:
                    frame_ids.append(frame_id)
                walk(child)

        try:
            walk((await self._page("Page.getFrameTree")).get("frameTree") or {})
        except RuntimeError:
            return nodes
        for frame_id in frame_ids:
            try:
                tree = await self._page("Accessibility.getFullAXTree", frameId=frame_id)
            except RuntimeError:
                continue
            nodes.extend(tree.get("nodes") or [])
        return nodes

    async def _interactive_elements(self) -> list[dict[str, Any]]:
        """
        The page's controls, in accessibility-tree order and frame by frame:
        every node that is not ignored and whose role is one AxHelpers acts on.
        index is the node's backendNodeId, which browser_click and browser_type
        take back.
        """
        elements: list[dict[str, Any]] = []
        seen: set[int] = set()
        for node in await self._ax_nodes():
            backend_id = node.get("backendDOMNodeId")
            if node.get("ignored") or backend_id is None or backend_id in seen:
                continue
            if _ax_value(node.get("role")) not in CONTROLS:
                continue
            seen.add(backend_id)
            try:
                described = (await self._page("DOM.describeNode", backendNodeId=backend_id)).get("node") or {}
            except RuntimeError:
                continue  # The node went away between the two calls.
            attributes = _attributes(described)
            element: dict[str, Any] = {
                "index": backend_id,
                "tag": str(described.get("nodeName") or "").lower(),
                "text": str(_ax_value(node.get("name")) or "")[:_ELEMENT_TEXT_CHARS],
            }
            if attributes.get("placeholder"):
                element["placeholder"] = attributes["placeholder"]
            if attributes.get("href"):
                element["href"] = attributes["href"]
            elements.append(element)
        return elements

    async def _handle_extract_content(self, args: dict[str, Any]) -> str:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            return "Error: query is required."
        # It reads the page that is open; it never starts a browser to read a blank one.
        if self._primary_session() is None:
            return _NO_SESSION
        choice = self._agent_llm_choice()
        missing = _missing_api_key(choice)
        if missing:
            return _missing_key_message("browser_extract_content", choice, missing)
        try:
            llm = _build_llm(choice)
            model = llm.pydantic_model()
            settings = llm.model_settings()
        except Exception as exc:
            return f"Error building agent model: {exc}"

        async with self._lock:
            self._live()
            page = await self._page_text(bool(args.get("extract_links")))

        from pydantic_ai import Agent as PydanticAgent

        extractor = PydanticAgent(
            model,
            instructions=(
                "You extract information from the text of a web page. Answer the query using "
                "only that text. Say so when the page does not contain the answer."
            ),
        )
        try:
            result = await extractor.run(
                f"Query: {query}\n\n<page>\n{page}\n</page>", model_settings=settings or None
            )
        except Exception as exc:
            return f"Error: the agent model failed: {exc}"
        return str(result.output or "").strip() or "No content extracted"

    async def _page_text(self, with_links: bool) -> str:
        """The page's visible text, then (with_links) its links, clipped."""
        script = (
            "(() => { const out = {url: location.href, title: document.title,"
            " text: document.body ? document.body.innerText : ''};"
            + (
                " out.links = Array.from(document.querySelectorAll('a[href]'))"
                ".map(a => [(a.innerText || '').trim(), a.href]);"
                if with_links else ""
            )
            + " return out; })()"
        )
        page = await self._evaluate_value(script) or {}
        parts = [f"URL: {page.get('url')}", f"Title: {page.get('title')}", "", str(page.get("text") or "")]
        if with_links:
            parts += ["", "Links:"] + [f"- {text} ({href})" for text, href in page.get("links") or []]
        return "\n".join(parts)[:_EXTRACT_PAGE_CHARS]

    async def _handle_get_html(self, args: dict[str, Any]) -> str:
        selector = args.get("selector")
        if selector:
            js = (
                f"(function(){{ const el = document.querySelector({json.dumps(selector)}); "
                "return el ? el.outerHTML : null; })()"
            )
        else:
            js = "document.documentElement.outerHTML"
        try:
            html = await self._evaluate_value(js)
        except _JavaScriptError as exc:
            raise RuntimeError(f"JavaScript exception in browser_get_html: {exc}") from None
        if html is None:
            return f"No element found for selector: {selector}" if selector else "Error: Could not get page HTML"
        return html

    async def _handle_screenshot(self, args: dict[str, Any]) -> list[types.TextContent | types.ImageContent]:
        data, clip = await self._capture(bool(args.get("full_page")))
        meta = {
            "size_bytes": len(base64.b64decode(data)),
            "viewport": {"width": clip["width"], "height": clip["height"]},
        }
        return [
            types.TextContent(type="text", text=json.dumps(meta)),
            types.ImageContent(type="image", data=data, mime_type="image/png"),
        ]

    async def _handle_scroll(self, args: dict[str, Any]) -> str:
        direction = args.get("direction") or "down"
        if direction not in ("up", "down"):
            return "Error: direction must be 'up' or 'down'."
        size = await self._evaluate_value("({w: innerWidth, h: innerHeight})") or {}
        await self._page(
            "Input.dispatchMouseEvent",
            type="mouseWheel",
            x=(size.get("w") or 0) // 2,
            y=(size.get("h") or 0) // 2,
            deltaX=0,
            deltaY=_SCROLL_PIXELS if direction == "down" else -_SCROLL_PIXELS,
        )
        return f"Scrolled {direction}"

    async def _handle_go_back(self, args: dict[str, Any]) -> str:
        history = await self._page("Page.getNavigationHistory")
        current = history.get("currentIndex", 0)
        entries = history.get("entries") or []
        if current <= 0 or current > len(entries) - 1:
            return "Error: there is no previous page in this tab's history."
        await self._page("Page.navigateToHistoryEntry", entryId=entries[current - 1]["id"])
        await self._wait_for_load()
        self._live().url = entries[current - 1].get("url")
        return "Navigated back"

    async def _handle_list_tabs(self, args: dict[str, Any]) -> str:
        tabs = [
            {"tab_id": t["targetId"][-4:], "url": t.get("url"), "title": t.get("title") or ""}
            for t in await self._page_targets(self._live())
        ]
        return json.dumps(tabs, indent=2)

    async def _handle_switch_tab(self, args: dict[str, Any]) -> str:
        session = self._live()
        target = await self._resolve_tab(session, args.get("tab_id"))
        await self._daemon(session.name, "Target.activateTarget", None, targetId=target["targetId"])
        await self._attach(session, target["targetId"])
        session.url = target.get("url")
        return f"Switched to tab {args.get('tab_id')}: {target.get('url')}"

    async def _handle_close_tab(self, args: dict[str, Any]) -> str:
        session = self._live()
        target = await self._resolve_tab(session, args.get("tab_id"))
        closing = target["targetId"]
        try:
            attached = (await self._current_target(session)).get("targetId")
        except RuntimeError:
            attached = None
        await self._daemon(session.name, "Target.closeTarget", None, targetId=closing)
        if attached not in (None, closing):
            now_on = await self._current_target(session)
            return f"Closed tab # {args.get('tab_id')}, now on {now_on.get('url')}"
        # The attached tab closed: attach the first one left, or a new blank one,
        # rather than leave the daemon on a session that no longer exists.
        remaining = [t for t in await self._page_targets(session) if t["targetId"] != closing]
        if remaining:
            successor = remaining[0]
        else:
            created = await self._daemon(session.name, "Target.createTarget", None, url="about:blank")
            successor = {"targetId": created["targetId"], "url": "about:blank"}
        await self._attach(session, successor["targetId"])
        session.url = successor.get("url")
        return f"Closed tab # {args.get('tab_id')}, now on {successor.get('url')}"

    # ------------------------------------------------------------------
    # Agent
    # ------------------------------------------------------------------

    async def _handle_retry_with_browser_use_agent(self, args: dict[str, Any]) -> str:
        """
        Run browser-use's Agent on a fresh local Chromium of its own. Agent's
        default browser is a billed cloud browser, so it is never left to choose.
        """
        task = args.get("task")
        if not isinstance(task, str) or not task.strip():
            return "Error: task is required."
        max_steps = int(args.get("max_steps") or 100)
        choice = self._agent_llm_choice()
        if args.get("model"):
            choice = replace(choice, model=str(args["model"]))
        missing = _missing_api_key(choice)
        if missing:
            return _missing_key_message("retry_with_browser_use_agent", choice, missing)
        try:
            llm = _build_llm(choice)
            domains = [str(d) for d in args.get("allowed_domains") or []]
            browser = browser_use.Browser(
                **_local_browser_options(), **({"allowed_domains": domains} if domains else {})
            )
            agent_kwargs: dict[str, Any] = {"browser": browser}
            # 1.0 honours only use_vision=False and warns about True.
            if args.get("use_vision") is False:
                agent_kwargs["use_vision"] = False
            agent = browser_use.Agent(task=task, llm=llm, **agent_kwargs)
        except Exception as exc:
            return f"Error: {exc}"

        try:
            history = await agent.run(max_steps=max_steps)
        except Exception as exc:
            return f"Agent task failed: {exc}"
        finally:
            try:
                await agent.close()
            except Exception:
                pass
            if getattr(browser, "name", None):
                try:
                    await browser.stop()
                except Exception:
                    pass

        lines = [
            f"Task completed in {history.number_of_steps()} steps",
            f"Success: {history.is_successful()}",
        ]
        final = history.final_result()
        if final:
            lines.append(f"\nFinal result:\n{final}")
        errors = history.errors()
        if errors:
            lines.append(f"\nErrors encountered:\n{json.dumps(errors, indent=2)}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Session tools
    # ------------------------------------------------------------------

    async def _handle_list_sessions(self, args: dict[str, Any]) -> str:
        if not self._sessions:
            return "No active browser sessions"
        now = time.time()
        rows = []
        for key, session in self._sessions.items():
            rows.append({
                "session_id": key,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(session.created_at)),
                "last_activity": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(session.last_activity)),
                "active": bool(getattr(session.browser, "name", None)),
                "current_url": session.url or "Unknown",
                "age_minutes": (now - session.created_at) / 60,
            })
        return json.dumps(rows, indent=2)

    async def _handle_close_session(self, args: dict[str, Any]) -> str:
        session_id = args.get("session_id")
        if not session_id:
            return "Error: session_id is required."
        return await self._close_session(str(session_id))

    async def _handle_close_all(self, args: dict[str, Any]) -> str:
        if not self._sessions:
            return "No active sessions to close"
        closed, errors = 0, []
        for key in list(self._sessions):
            result = await self._close_session(key)
            if result.startswith("Successfully closed"):
                closed += 1
            else:
                errors.append(f"{key}: {result}")
        # _close_session clears the primary when it closed. A primary that
        # failed to stop stays primary, so no second browser starts beside it.
        message = f"Closed {closed} sessions"
        if errors:
            message += f". Errors: {'; '.join(errors)}"
        return message

    async def _handle_export_session(self, args: dict[str, Any]) -> str:
        """Export cookies from any registered session to a JSON file."""
        session_id = args.get("session_id", "")
        output_path = args.get("output_path", "")
        if not session_id:
            return "Error: session_id is required."
        if not output_path:
            return "Error: output_path is required."
        session = self._sessions.get(session_id)
        if session is None:
            return (
                f"Session {session_id!r} not found. "
                "Use browser_list_sessions to see active sessions."
            )
        try:
            # Storage.getCookies returns every cookie in the browser context.
            # Network.getCookies with no urls returns only the current page's.
            cookies = (await self._daemon(session.name, "Storage.getCookies")).get("cookies", [])
            url = (await self._current_target(session)).get("url")
            export_data = {
                "session_id": session_id,
                "exported_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "url": url,
                "cookies": cookies,
            }
            out = Path(output_path).expanduser()
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(export_data, indent=2))
        except Exception as exc:
            return f"export_session failed: {exc}"
        session.last_activity = time.time()
        return json.dumps(
            {"success": True, "path": str(out), "cookies_count": len(cookies), "url": url}
        )

    async def _handle_import_session(self, args: dict[str, Any]) -> str:
        """Import cookies from a JSON file into a new local browser session."""
        import_path = args.get("import_path", "")
        navigate_to: str | None = args.get("navigate_to")
        if not import_path:
            return "Error: import_path is required."
        src = Path(import_path).expanduser()
        if not src.exists():
            return f"Error: File not found: {import_path}"
        try:
            data = json.loads(src.read_text())
        except Exception as exc:
            return f"Error reading session file: {exc}"
        cookies = data.get("cookies", []) if isinstance(data, dict) else []

        browser = None
        try:
            browser = browser_use.Browser(**_local_browser_options())
            await browser.start()
            session = _Session(browser=browser, kind="import", url=navigate_to or data.get("url"))
            for cookie in cookies:
                if not isinstance(cookie, dict):
                    continue  # Skip malformed cookies
                params = {k: cookie[k] for k in _SET_COOKIE_FIELDS if k in cookie}
                if cookie.get("session") or (params.get("expires") or 0) < 0:
                    params.pop("expires", None)
                try:
                    await self._daemon(session.name, "Network.setCookie", None, **params)
                except Exception:
                    pass  # Skip malformed cookies
            if navigate_to:
                await self._navigate_session(session, navigate_to)
        except Exception as exc:
            if browser is not None and getattr(browser, "name", None):
                try:
                    await browser.stop()
                except Exception:
                    pass
            return f"import_session failed: {exc}"

        key = self._register(browser, "import", url=session.url)
        is_primary = self._primary_session() is None
        if is_primary:
            self._primary = key
        # Every imported browser is local, primary or not.
        try:
            await self._send_downloads(self._sessions[key])
        except Exception:
            pass
        return json.dumps(
            {
                "session_id": key,
                "cookies_imported": len(cookies),
                "original_url": data.get("url"),
                "navigated_to": navigate_to,
                "is_primary": is_primary,
            }
        )

    async def _handle_start_cloud_session(self, args: dict[str, Any]) -> str:
        """Start a Browser Use cloud browser session (remote, stealth-capable)."""
        navigate_to: str | None = args.get("navigate_to")
        if not os.environ.get("BROWSER_USE_API_KEY"):
            return (
                "Error: BROWSER_USE_API_KEY is not set. Cloud browser sessions require "
                "an API key — get one at https://cloud.browser-use.com and export "
                "BROWSER_USE_API_KEY."
            )
        browser = None
        try:
            # A cloud Browser takes no headless or executable_path: 1.0 raises.
            browser = browser_use.Browser(use_cloud=True)
            await browser.start()
            session = _Session(browser=browser, kind="cloud", url=navigate_to)
            if navigate_to:
                await self._navigate_session(session, navigate_to)
        except Exception as exc:
            if browser is not None and getattr(browser, "name", None):
                try:
                    await browser.stop()
                except Exception:
                    pass
            return f"start_cloud_session failed: {exc}"

        key = self._register(browser, "cloud", url=navigate_to)
        is_primary = self._primary_session() is None
        if is_primary:
            self._primary = key
        result: dict[str, Any] = {
            "session_id": key,
            "cdp_url": browser.cloud_cdp_url,
            "is_primary": is_primary,
            "navigated_to": navigate_to,
        }
        if browser.live_url:
            result["live_url"] = browser.live_url
        return json.dumps(result)

    # ------------------------------------------------------------------
    # Live-page tools: evaluate, keyboard, focus, save_screenshot
    # ------------------------------------------------------------------
    # These drive the primary session and never start one.

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
        Run JavaScript in the live page and return its (JSON-serializable)
        result, with returnByValue + awaitPromise and an IIFE wrapper so a script
        written with a top-level `return` (or several statements) works.
        """
        script = args.get("script", "")
        if not isinstance(script, str) or not script.strip():
            return "Error: script is required."
        self._live()
        try:
            result = await self._page(
                "Runtime.evaluate",
                expression=self._wrap_eval_script(script),
                returnByValue=True,
                awaitPromise=True,
                userGesture=True,
            )
        except Exception as exc:
            return f"evaluate failed: {exc}"

        # Surface JS exceptions as a readable error rather than a silent null.
        exc_details = result.get("exceptionDetails")
        if exc_details:
            text = exc_details.get("exception", {}).get("description") or exc_details.get("text")
            return json.dumps({"error": "JavaScript exception", "detail": text})
        return json.dumps({"result": result.get("result", {}).get("value")})

    async def _handle_focus(self, args: dict[str, Any]) -> str:
        """
        Focus a DOM element by CSS selector (works for hidden/synthetic inputs
        that never appear in browser_get_state's index list, e.g. Monaco's
        textarea.inputarea). Done via Runtime.evaluate el.focus().
        """
        selector = args.get("selector", "")
        if not isinstance(selector, str) or not selector:
            return "Error: selector is required."
        self._live()
        js = (
            f"(function(){{ const el = document.querySelector({json.dumps(selector)});"
            f" if (!el) return false; el.focus(); return document.activeElement === el; }})()"
        )
        try:
            await self._activate_current_tab()
            result = await self._page("Runtime.evaluate", expression=js, returnByValue=True)
        except Exception as exc:
            return f"focus failed: {exc}"
        if not result.get("result", {}).get("value"):
            return json.dumps({"focused": False, "error": f"No element matched {selector!r}"})
        return json.dumps({"focused": True, "selector": selector})

    async def _handle_save_screenshot(self, args: dict[str, Any]) -> str:
        """
        Write the live page to a PNG file. browser_screenshot returns an image
        block the model can see but cannot save.
        """
        output_path = args.get("output_path", "")
        if not isinstance(output_path, str) or not output_path:
            return "Error: output_path is required."
        out = Path(output_path)
        if not out.is_absolute():
            return f"Error: output_path must be absolute, got {output_path!r}."
        if out.suffix.lower() != ".png":
            return f"Error: output_path must end in .png, got {output_path!r}."
        self._live()

        try:
            data, _clip = await self._capture(bool(args.get("full_page")))
        except _ToolError:
            raise
        except Exception as exc:
            return f"save_screenshot failed: {exc}"
        try:
            png = base64.b64decode(data)
        except (ValueError, TypeError) as exc:
            return f"Error: the browser returned image data that is not base64: {exc}"
        if png[:8] != b"\x89PNG\r\n\x1a\n":
            return "Error: the browser returned data that is not a PNG."
        width, height = _png_size(png)
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(png)
        except OSError as exc:
            return f"Error: cannot write {out}: {exc}"
        return json.dumps(
            {"path": str(out), "size_bytes": len(png), "width": width, "height": height}
        )

    async def _handle_press_key(self, args: dict[str, Any]) -> str:
        """Press a single key/shortcut `count` times in the live page."""
        key = args.get("key", "")
        if not isinstance(key, str) or not key:
            return "Error: key is required."
        count = max(1, int(args.get("count", 1) or 1))
        self._live()
        try:
            await self._activate_current_tab()
            for _ in range(count):
                await self._dispatch_key(key)
        except Exception as exc:
            return f"press_key failed: {exc}"
        return json.dumps({"pressed": key, "count": count})

    async def _handle_keyboard(self, args: dict[str, Any]) -> str:
        """Press a batch of shortcuts, then insert literal text, in order."""
        keys = args.get("keys", []) or []
        text = args.get("text")
        if not keys and not text:
            return "Error: provide `keys` and/or `text`."
        self._live()
        try:
            await self._activate_current_tab()
            for key in keys:
                await self._dispatch_key(str(key))
            if text:
                await self._page("Input.insertText", text=str(text))
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

    # Named keys → (key, code, windowsVirtualKeyCode). Plain single characters
    # are handled generically in _parse_key_spec.
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

    # The character Shift gives a key on a US layout, for 'Shift+1' and the like.
    _SHIFTED = dict(zip("1234567890-=[]\\;',./`", '!@#$%^&*()_+{}|:"<>?~'))

    @classmethod
    def _key_text(cls, modifiers: int, key: str) -> str | None:
        """
        The character a key types, or None. Only a single printable character
        with no Alt, Control or Meta types: a chord is a command, never text.
        Shift turns a letter upper-case and a US-layout symbol key into its
        shifted symbol.
        """
        if modifiers & (1 | 2 | 4) or len(key) != 1 or not key.isprintable():
            return None
        if modifiers & 8:
            return key.upper() if key.isalpha() else cls._SHIFTED.get(key, key)
        return key

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

    async def _dispatch_key(self, spec: str) -> None:
        """
        Send a keyDown+keyUp pair for one key/shortcut via CDP Input. A
        printable key's keyDown carries its text, which is what makes Chrome
        type it: a keyDown without text fires key events and inserts nothing.
        """
        modifiers, key, code, vk = self._parse_key_spec(spec)
        text = self._key_text(modifiers, key)
        if text is not None:
            key = text
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
        if text is not None:
            down["text"] = text
            down["unmodifiedText"] = text

        await self._page("Input.dispatchKeyEvent", **down)
        await self._page("Input.dispatchKeyEvent", **{**base, "type": "keyUp"})

    # ------------------------------------------------------------------
    # Tools that need no browser
    # ------------------------------------------------------------------

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
            # Surface the most common failure (a fresh interpreter without
            # browser-use/playwright installed) as an explicit hint instead of
            # leaving the user to parse a raw traceback.
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

    async def _handle_set_agent_model(self, args: dict[str, Any]) -> str:
        """
        Set the per-session agent LLM override (browser_set_agent_model tool).

        Validates the input and builds the model once, so a choice that cannot
        work is reported now rather than on the first agent call. On a failure
        the prior override is kept. Returns a secrets-free JSON summary.
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
        if base_url and not _PROVIDER_REGISTRY[provider].supports_base_url:
            return (
                f"Error: provider {provider!r} takes no base_url in browser-use 1.0. Drop "
                "base_url, or use provider 'openai_compatible' for an OpenAI-compatible endpoint."
            )

        override = LLMChoice(
            provider=provider,
            model=model,
            base_url=base_url,
            api_key_env=api_key_env,
            temperature=temperature,
        )
        try:
            _build_llm(override)
        except Exception as exc:
            return f"Error building agent model: {exc}"
        self._session_llm_override = override
        return json.dumps(
            {
                "provider": override.provider,
                "model": override.model,
                "base_url": override.base_url,
                "applied_to_live_session": self._primary_session() is not None,
            }
        )

    async def _handle_doctor(self, args: dict[str, Any]) -> str:
        """
        Report the plugin's runtime environment so silent failures (300s
        run_script hang, ModuleNotFoundError, missing Chromium) become a
        one-call diagnosis. Pure inspection — never spawns a browser.
        """
        import platform

        def _module(module: str, dist: str) -> dict[str, Any]:
            installed = importlib.util.find_spec(module) is not None
            return {"installed": installed, "version": _package_version(dist) if installed else None}

        # Report exactly what the launcher would use — same resolver, so the
        # doctor and the browser can never disagree. PATH discovery is
        # deliberately not consulted: it is how the user's real Chrome used to
        # win over their explicit CHROME_EXECUTABLE_PATH.
        chromium_path: str | None = None
        chromium_error: str | None = None
        chromium_source = "env" if os.environ.get("CHROME_EXECUTABLE_PATH") else "playwright"
        try:
            chromium_path = _resolve_chromium_binary()
        except Exception as exc:  # diagnostics must never raise
            chromium_source = "error"
            chromium_error = str(exc)

        report = {
            "python_version": platform.python_version(),
            "python_executable": sys.executable,
            "browser_use": _module("browser_use", "browser-use"),
            "browser_harness": _module("browser_harness", "browser-harness"),
            "mcp": _module("mcp", "mcp"),
            "playwright": _module("playwright", "playwright"),
            "chromium_present": chromium_path is not None,
            "chromium_path": chromium_path,
            # Where chromium_path came from: "env" (CHROME_EXECUTABLE_PATH),
            # "playwright" (bundled cache), or "error" (nothing resolvable).
            "chromium_source": chromium_source,
            "chromium_error": chromium_error,
            "api_keys": {
                "ANTHROPIC_API_KEY": bool(os.environ.get("ANTHROPIC_API_KEY")),
                "OPENAI_API_KEY": bool(os.environ.get("OPENAI_API_KEY")),
                "BROWSER_USE_API_KEY": bool(os.environ.get("BROWSER_USE_API_KEY")),
            },
        }
        return json.dumps(report, indent=2)

    async def close_all_sessions(self) -> None:
        """Stop every browser this server started. Used when the client disconnects."""
        async with self._lock:
            for key in list(self._sessions):
                try:
                    await self._close_session(key)
                except Exception:
                    pass


_TOOL_NAMES = frozenset(tool.name for tool in _ALL_TOOLS)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    """Serve MCP over stdio until the client disconnects."""
    server = MagusBrowserServer()
    maintenance = asyncio.create_task(server._maintenance_loop())
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        # stdio_server already points fd 1 at stderr while it serves. Python-level
        # writes to sys.stdout go there too, so a print from any library thread
        # cannot reach the JSON-RPC stream either.
        saved_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            await server.server.run(
                read_stream,
                write_stream,
                server.server.create_initialization_options(),
            )
        except BrokenPipeError:
            pass
        finally:
            sys.stdout = saved_stdout
            maintenance.cancel()
            await server.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
