#!/usr/bin/env python3
"""
Browser Use MCP Server — Custom in-process asyncio MCP server.

Wraps the browser_use Python library directly (no subprocess, no HTTP layer).
Browser sessions persist in a global registry across tool calls within the
same Claude Code session.

Usage (via .mcp.json):
    python3 /path/to/mcp-server.py

Test mode:
    python3 mcp-server.py --test

Architecture:
- Uses mcp SDK stdio_server for transport (standard Claude Code MCP pattern)
- Sessions held in global _sessions dict: session_id -> BrowserSession
- All tool handlers are asyncio coroutines (no timeout ceiling)
- retry_with_browser_use_agent runs as a coroutine — can run indefinitely
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
        import mcp  # noqa: F401

        version = get_browser_use_version()
        print("browser-use MCP server: OK")
        print(f"browser-use version: {version}")
        sys.exit(0)
    except ImportError as e:
        print(f"browser-use MCP server: FAIL — {e}", file=sys.stderr)
        sys.exit(1)

import asyncio
import base64
import json
import logging
import socket
import time
import uuid
from datetime import datetime
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

# --- Import browser_use ---
try:
    from browser_use import Agent
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

# ---------------------------------------------------------------------------
# Global session registry
# Sessions persist across tool calls within the same MCP server process.
# Key: session_id (8-char hex string)
# Value: dict with "session" (BrowserSession), "created_at", "last_activity"
# ---------------------------------------------------------------------------
_sessions: dict[str, dict[str, Any]] = {}

# Session directory for last-session.json (used by SessionStart hook)
_session_dir = Path(
    os.environ.get("BROWSER_USE_SESSION_DIR", Path.home() / ".browser-use" / "sessions")
)

# MCP app instance
app = Server("browser-use")


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _new_session_id() -> str:
    """Generate a short unique session ID."""
    return uuid.uuid4().hex[:8]


def _read_devtools_active_port(user_data_dir: str) -> str | None:
    """
    Read DevToolsActivePort from a Chrome profile directory.

    Chrome writes this file on startup; line 0 = port number,
    line 1 = browser target path. Returns CDP URL if port is
    reachable, None otherwise.
    """
    port_file = Path(user_data_dir).expanduser() / "DevToolsActivePort"
    if not port_file.exists():
        return None
    try:
        lines = port_file.read_text().strip().splitlines()
        port = int(lines[0])
        # Verify the port is actually accepting connections
        with socket.create_connection(("127.0.0.1", port), timeout=1.0):
            pass
        return f"http://127.0.0.1:{port}/"
    except Exception:
        return None


async def get_or_create_session(session_id: str | None = None) -> tuple[str, BrowserSession]:
    """
    Return (session_id, BrowserSession). Creates a new session if session_id
    is None or not found in the registry.
    """
    if session_id and session_id in _sessions:
        _sessions[session_id]["last_activity"] = time.time()
        return session_id, _sessions[session_id]["session"]

    # Create a new browser session
    config = load_browser_use_config()
    profile_config = get_default_profile(config)

    # Merge sane defaults with any config file values
    # BROWSER_USE_HEADLESS=true runs Chrome without a visible window (useful for CI/E2E)
    headless_env = os.environ.get("BROWSER_USE_HEADLESS", "").lower() in ("true", "1", "yes")
    profile_data: dict[str, Any] = {
        "downloads_path": str(Path.home() / "Downloads" / "browser-use-mcp"),
        "wait_between_actions": 0.5,
        "keep_alive": True,
        "user_data_dir": "~/.config/browseruse/profiles/default",
        "device_scale_factor": 1.0,
        "disable_security": False,
        "headless": headless_env or False,
        **profile_config,
    }

    # Detect existing Chrome instance to avoid SingletonLock contention
    existing_cdp_url = _read_devtools_active_port(profile_data["user_data_dir"])
    if existing_cdp_url:
        profile_data["cdp_url"] = existing_cdp_url

    profile = BrowserProfile(**profile_data)
    session = BrowserSession(browser_profile=profile)
    await session.start()

    sid = _new_session_id()
    _sessions[sid] = {
        "session": session,
        "created_at": time.time(),
        "last_activity": time.time(),
    }
    return sid, session


async def close_session(session_id: str) -> str:
    """Close a session and remove it from the registry."""
    if session_id not in _sessions:
        return f"Session {session_id} not found. Use browser_list_sessions() to see active sessions."

    session = _sessions[session_id]["session"]
    try:
        if hasattr(session, "kill"):
            await session.kill()
        elif hasattr(session, "close"):
            await session.close()
    except Exception as exc:
        return f"Warning: error while closing session {session_id}: {exc}"
    finally:
        _sessions.pop(session_id, None)
        _write_last_session_json()

    return f"Session {session_id} closed."


def _write_last_session_json() -> None:
    """Write last-session.json for the SessionStart hook to read."""
    try:
        _session_dir.mkdir(parents=True, exist_ok=True)
        last = _session_dir.parent / "last-session.json"
        sessions_info = []
        for sid, data in _sessions.items():
            sess = data["session"]
            sessions_info.append(
                {
                    "id": sid,
                    "final_url": getattr(sess, "current_url", None),
                    "profile_path": "~/.config/browseruse/profiles/default",
                    "cookies_saved": False,  # updated to True on explicit export
                }
            )
        payload = {
            "closed_at": datetime.utcnow().isoformat() + "Z",
            "sessions": sessions_info,
            "profiles": {},
        }
        last.write_text(json.dumps(payload, indent=2))
    except Exception:
        pass  # Non-fatal — hook will just skip


# ---------------------------------------------------------------------------
# LLM helper (for retry_with_browser_use_agent and extract_content)
# ---------------------------------------------------------------------------

def _get_llm():
    """
    Build an LLM instance from environment/config.
    Prefers Anthropic (ANTHROPIC_API_KEY) then OpenAI (OPENAI_API_KEY).
    Returns None if no API key is available.
    """
    config = load_browser_use_config()
    llm_config = get_default_llm(config)
    model_provider = llm_config.get("model_provider") or os.environ.get("MODEL_PROVIDER", "")

    if model_provider.lower() == "bedrock":
        try:
            from browser_use.llm import ChatAWSBedrock

            return ChatAWSBedrock(
                model=llm_config.get("model") or "us.anthropic.claude-sonnet-4-20250514-v1:0",
                aws_region=llm_config.get("region") or os.environ.get("REGION", "us-east-1"),
                aws_sso_auth=True,
            )
        except Exception:
            return None

    # Try Anthropic first
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            from browser_use.llm import ChatAnthropic

            return ChatAnthropic(
                model="claude-sonnet-4-6",
                api_key=anthropic_key,
            )
        except Exception:
            pass

    # Fall back to OpenAI
    openai_key = llm_config.get("api_key") or os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from browser_use.llm.openai.chat import ChatOpenAI

            return ChatOpenAI(
                model=llm_config.get("model", "gpt-4o"),
                api_key=openai_key,
                temperature=llm_config.get("temperature", 0.7),
            )
        except Exception:
            pass

    return None


# ---------------------------------------------------------------------------
# Tool list
# ---------------------------------------------------------------------------

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    """Expose all 15 browser automation tools plus 3 custom tools."""
    return [
        # ------------------------------------------------------------------
        # 1. browser_navigate
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_navigate",
            description=(
                "Navigate to a URL. Creates a new browser session if no session_id is given "
                "or the specified session does not exist. Returns the session_id to use in "
                "subsequent calls."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to (must include scheme, e.g. https://)",
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Existing session ID. Omit to create a new session.",
                    },
                    "new_tab": {
                        "type": "boolean",
                        "description": "Open URL in a new tab within the existing session.",
                        "default": False,
                    },
                },
                "required": ["url"],
            },
        ),
        # ------------------------------------------------------------------
        # 2. browser_click
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_click",
            description=(
                "Click a DOM element by its index (from browser_get_state) or by pixel "
                "coordinates. Index-based clicking is more reliable for interactive elements."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Active session ID.",
                    },
                    "index": {
                        "type": "integer",
                        "description": "Element index from browser_get_state. Use this OR coordinates.",
                    },
                    "coordinate_x": {
                        "type": "integer",
                        "description": "X pixel coordinate (viewport-relative). Use with coordinate_y.",
                    },
                    "coordinate_y": {
                        "type": "integer",
                        "description": "Y pixel coordinate (viewport-relative). Use with coordinate_x.",
                    },
                    "new_tab": {
                        "type": "boolean",
                        "description": "Open resulting navigation in a new tab.",
                        "default": False,
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 3. browser_type
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_type",
            description="Type text into an input field identified by its DOM index.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "index": {
                        "type": "integer",
                        "description": "Element index from browser_get_state.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type into the element.",
                    },
                },
                "required": ["session_id", "index", "text"],
            },
        ),
        # ------------------------------------------------------------------
        # 4. browser_get_state
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_get_state",
            description=(
                "Get the current DOM state: URL, title, tabs, and a map of interactive "
                "elements with their indices. Call this before clicking or typing so you "
                "know which index to use."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "include_screenshot": {
                        "type": "boolean",
                        "description": "Include a base64 screenshot in the response.",
                        "default": False,
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 5. browser_extract_content
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_extract_content",
            description=(
                "Use an LLM to extract structured content from the current page based on a "
                "natural-language query. Requires ANTHROPIC_API_KEY or OPENAI_API_KEY."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "query": {
                        "type": "string",
                        "description": "Natural-language description of what to extract.",
                    },
                    "extract_links": {
                        "type": "boolean",
                        "description": "Include hyperlinks in the extracted content.",
                        "default": False,
                    },
                },
                "required": ["session_id", "query"],
            },
        ),
        # ------------------------------------------------------------------
        # 6. browser_get_html
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_get_html",
            description=(
                "Get the raw HTML of the current page or a specific element by CSS selector."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "selector": {
                        "type": "string",
                        "description": (
                            "CSS selector to scope the result. Omit to return the full page HTML."
                        ),
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 7. browser_screenshot
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_screenshot",
            description=(
                "Take a screenshot of the current page. Returns base64-encoded PNG data "
                "along with viewport dimensions."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "full_page": {
                        "type": "boolean",
                        "description": "Capture the full scrollable page instead of just the viewport.",
                        "default": False,
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 8. browser_scroll
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_scroll",
            description="Scroll the current page up or down.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "direction": {
                        "type": "string",
                        "enum": ["up", "down"],
                        "description": "Scroll direction.",
                        "default": "down",
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Pixels to scroll. Defaults to 500.",
                        "default": 500,
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 9. browser_go_back
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_go_back",
            description="Navigate back to the previous page in browser history.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 10. browser_list_tabs
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_list_tabs",
            description="List all open tabs in the browser session.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 11. browser_switch_tab
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_switch_tab",
            description="Switch to a different browser tab by its tab_id.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "tab_id": {
                        "type": "string",
                        "description": "4-character tab ID from browser_list_tabs.",
                    },
                },
                "required": ["session_id", "tab_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 12. browser_close_tab
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_close_tab",
            description="Close a specific browser tab by its tab_id.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Active session ID."},
                    "tab_id": {
                        "type": "string",
                        "description": "4-character tab ID from browser_list_tabs.",
                    },
                },
                "required": ["session_id", "tab_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 13. browser_list_sessions
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_list_sessions",
            description=(
                "List all active browser sessions with their IDs and last-activity timestamps."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        # ------------------------------------------------------------------
        # 14. browser_close_session
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_close_session",
            description="Close a browser session and free its resources.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Session ID to close. Use browser_list_sessions() to find it.",
                    },
                },
                "required": ["session_id"],
            },
        ),
        # ------------------------------------------------------------------
        # 15. retry_with_browser_use_agent
        # ------------------------------------------------------------------
        types.Tool(
            name="retry_with_browser_use_agent",
            description=(
                "Run an autonomous AI browser agent on a high-level task. Use this as a "
                "fallback when direct browser control fails — the agent will navigate, click, "
                "type, and extract content autonomously until the task is complete or "
                "max_steps is reached. No timeout ceiling: runs until done."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": (
                            "High-level goal for the agent, including step-by-step instructions "
                            "and any data needed (e.g. login credentials, target URL)."
                        ),
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Existing session ID to reuse. Omit to create a new one.",
                    },
                    "max_steps": {
                        "type": "integer",
                        "description": "Maximum number of agent steps. Defaults to 100.",
                        "default": 100,
                    },
                    "use_vision": {
                        "type": "boolean",
                        "description": "Whether the agent should use screenshots for decision-making.",
                        "default": True,
                    },
                    "allowed_domains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Restrict the agent to these domains (security feature).",
                        "default": [],
                    },
                },
                "required": ["task"],
            },
        ),
        # ------------------------------------------------------------------
        # 16. browser_export_session (custom)
        # ------------------------------------------------------------------
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
        # ------------------------------------------------------------------
        # 17. browser_import_session (custom)
        # ------------------------------------------------------------------
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
        # ------------------------------------------------------------------
        # 18. browser_run_script (custom)
        # ------------------------------------------------------------------
        types.Tool(
            name="browser_run_script",
            description=(
                "Run a saved Python browser automation script as a subprocess. "
                "Scripts are typically stored in the project's browser-scripts/ directory."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "script_path": {
                        "type": "string",
                        "description": "Absolute path to the .py script to run.",
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
    ]


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------

@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
    """Dispatch an MCP tool call to the appropriate handler."""
    try:
        result = await _dispatch(name, arguments or {})
    except Exception as exc:
        result = f"Error: {exc}"
    return [types.TextContent(type="text", text=str(result))]


async def _dispatch(name: str, args: dict[str, Any]) -> str:
    """Route tool name to handler function."""
    handlers: dict[str, Any] = {
        "browser_navigate": _handle_navigate,
        "browser_click": _handle_click,
        "browser_type": _handle_type,
        "browser_get_state": _handle_get_state,
        "browser_extract_content": _handle_extract_content,
        "browser_get_html": _handle_get_html,
        "browser_screenshot": _handle_screenshot,
        "browser_scroll": _handle_scroll,
        "browser_go_back": _handle_go_back,
        "browser_list_tabs": _handle_list_tabs,
        "browser_switch_tab": _handle_switch_tab,
        "browser_close_tab": _handle_close_tab,
        "browser_list_sessions": _handle_list_sessions,
        "browser_close_session": _handle_close_session,
        "retry_with_browser_use_agent": _handle_agent,
        "browser_export_session": _handle_export_session,
        "browser_import_session": _handle_import_session,
        "browser_run_script": _handle_run_script,
    }
    handler = handlers.get(name)
    if handler is None:
        return f"Unknown tool: {name}"
    return await handler(args)


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

async def _handle_navigate(args: dict[str, Any]) -> str:
    url = args.get("url", "")
    if not url:
        return "Error: url is required."

    session_id, session = await get_or_create_session(args.get("session_id"))
    new_tab = args.get("new_tab", False)

    try:
        from browser_use.browser.events import NavigateToUrlEvent

        event = session.event_bus.dispatch(NavigateToUrlEvent(url=url, new_tab=bool(new_tab)))
        await event
        action = "Opened new tab" if new_tab else "Navigated"
        return f"{action}: {url}\nsession_id: {session_id}"
    except Exception as exc:
        return f"Navigation failed for {url}: {exc}\nsession_id: {session_id}"


async def _handle_click(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()

    index = args.get("index")
    coord_x = args.get("coordinate_x")
    coord_y = args.get("coordinate_y")
    new_tab = args.get("new_tab", False)

    try:
        if coord_x is not None and coord_y is not None:
            from browser_use.browser.events import ClickCoordinateEvent

            event = session.event_bus.dispatch(
                ClickCoordinateEvent(coordinate_x=int(coord_x), coordinate_y=int(coord_y))
            )
            await event
            return f"Clicked at coordinates ({coord_x}, {coord_y})"

        if index is None:
            return "Error: Provide either index or both coordinate_x and coordinate_y."

        element = await session.get_dom_element_by_index(int(index))
        if element is None:
            return (
                f"Element index {index} not found. "
                "Use browser_get_state() to refresh the DOM element map."
            )

        if new_tab:
            href = element.attributes.get("href")
            if href:
                from urllib.parse import urlparse

                state = await session.get_browser_state_summary()
                current_url = state.url or ""
                if href.startswith("/"):
                    parsed = urlparse(current_url)
                    full_url = f"{parsed.scheme}://{parsed.netloc}{href}"
                else:
                    full_url = href
                from browser_use.browser.events import NavigateToUrlEvent

                event = session.event_bus.dispatch(
                    NavigateToUrlEvent(url=full_url, new_tab=True)
                )
                await event
                return f"Clicked element {index} and opened in new tab: {full_url}"

        from browser_use.browser.events import ClickElementEvent

        event = session.event_bus.dispatch(ClickElementEvent(node=element))
        await event
        return f"Clicked element {index}"

    except Exception as exc:
        return f"Click failed: {exc}"


async def _handle_type(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()

    index = args.get("index")
    text = args.get("text", "")
    if index is None:
        return "Error: index is required."

    try:
        element = await session.get_dom_element_by_index(int(index))
        if element is None:
            return (
                f"Element index {index} not found. "
                "Use browser_get_state() to refresh the DOM element map."
            )

        from browser_use.browser.events import TypeTextEvent

        event = session.event_bus.dispatch(
            TypeTextEvent(node=element, text=text, is_sensitive=False, sensitive_key_name=None)
        )
        await event
        return f"Typed into element {index}: '{text[:40]}{'...' if len(text) > 40 else ''}'"

    except Exception as exc:
        return f"Type failed: {exc}"


async def _handle_get_state(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()
    include_screenshot = args.get("include_screenshot", False)

    try:
        state = await session.get_browser_state_summary()

        result: dict[str, Any] = {
            "session_id": session_id,
            "url": state.url,
            "title": state.title,
            "tabs": [
                {"url": tab.url, "title": tab.title or ""} for tab in (state.tabs or [])
            ],
            "interactive_elements": [],
        }

        # Viewport + scroll info
        if state.page_info:
            pi = state.page_info
            result["viewport"] = {"width": pi.viewport_width, "height": pi.viewport_height}
            result["page"] = {"width": pi.page_width, "height": pi.page_height}
            result["scroll"] = {"x": pi.scroll_x, "y": pi.scroll_y}

        # Interactive elements with DOM indices
        for idx, element in state.dom_state.selector_map.items():
            elem: dict[str, Any] = {
                "index": idx,
                "tag": element.tag_name,
                "text": element.get_all_children_text(max_depth=2)[:120],
            }
            if element.attributes.get("placeholder"):
                elem["placeholder"] = element.attributes["placeholder"]
            if element.attributes.get("href"):
                elem["href"] = element.attributes["href"]
            if element.attributes.get("type"):
                elem["type"] = element.attributes["type"]
            result["interactive_elements"].append(elem)

        if include_screenshot and state.screenshot:
            result["screenshot"] = state.screenshot
            if state.page_info:
                result["screenshot_dimensions"] = {
                    "width": state.page_info.viewport_width,
                    "height": state.page_info.viewport_height,
                }

        return json.dumps(result, indent=2)

    except Exception as exc:
        return f"get_state failed: {exc}"


async def _handle_extract_content(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()
    query = args.get("query", "")
    extract_links = args.get("extract_links", False)

    llm = _get_llm()
    if llm is None:
        return (
            "Error: No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY "
            "to use browser_extract_content."
        )

    try:
        from browser_use.filesystem.file_system import FileSystem
        from browser_use.tools.service import Tools
        from pydantic import create_model
        from browser_use import ActionModel

        file_system = FileSystem(base_dir=Path.home() / ".browser-use-mcp")
        tools = Tools()

        ExtractAction = create_model(
            "ExtractAction",
            __base__=ActionModel,
            extract=dict[str, Any],
        )
        action = ExtractAction.model_validate(
            {"extract": {"query": query, "extract_links": extract_links}}
        )
        action_result = await tools.act(
            action=action,
            browser_session=session,
            page_extraction_llm=llm,
            file_system=file_system,
        )
        return action_result.extracted_content or "No content extracted."

    except Exception as exc:
        return f"extract_content failed: {exc}"


async def _handle_get_html(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()
    selector = args.get("selector")

    try:
        cdp_session = await session.get_or_create_cdp_session(target_id=None, focus=False)
        if not cdp_session:
            return "Error: No active CDP session."

        if selector:
            js = (
                f"(function(){{ const el = document.querySelector({json.dumps(selector)}); "
                f"return el ? el.outerHTML : null; }})()"
            )
        else:
            js = "document.documentElement.outerHTML"

        result = await cdp_session.cdp_client.send.Runtime.evaluate(
            params={"expression": js, "returnByValue": True},
            session_id=cdp_session.session_id,
        )
        html = result.get("result", {}).get("value")
        if html is None:
            if selector:
                return f"No element found for selector: {selector}"
            return "Error: Could not get page HTML."
        return html

    except Exception as exc:
        return f"get_html failed: {exc}"


async def _handle_screenshot(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()
    full_page = args.get("full_page", False)

    try:
        data = await session.take_screenshot(full_page=bool(full_page))
        b64 = base64.b64encode(data).decode()

        state = await session.get_browser_state_summary()
        result: dict[str, Any] = {
            "screenshot": b64,
            "encoding": "base64",
            "format": "png",
            "size_bytes": len(data),
        }
        if state.page_info:
            result["viewport"] = {
                "width": state.page_info.viewport_width,
                "height": state.page_info.viewport_height,
            }
        return json.dumps(result)

    except Exception as exc:
        return f"screenshot failed: {exc}"


async def _handle_scroll(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()
    direction = args.get("direction", "down")
    amount = int(args.get("amount", 500))

    try:
        from browser_use.browser.events import ScrollEvent

        event = session.event_bus.dispatch(ScrollEvent(direction=direction, amount=amount))
        await event
        return f"Scrolled {direction} by {amount}px"

    except Exception as exc:
        return f"scroll failed: {exc}"


async def _handle_go_back(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    _sessions[session_id]["last_activity"] = time.time()

    try:
        from browser_use.browser.events import GoBackEvent

        event = session.event_bus.dispatch(GoBackEvent())
        await event
        return "Navigated back"

    except Exception as exc:
        return f"go_back failed: {exc}"


async def _handle_list_tabs(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]

    try:
        tabs_info = await session.get_tabs()
        tabs = [
            {
                "tab_id": tab.target_id[-4:],
                "url": tab.url,
                "title": tab.title or "",
            }
            for tab in tabs_info
        ]
        return json.dumps(tabs, indent=2)

    except Exception as exc:
        return f"list_tabs failed: {exc}"


async def _handle_switch_tab(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    tab_id = args.get("tab_id", "")

    try:
        from browser_use.browser.events import SwitchTabEvent

        target_id = await session.get_target_id_from_tab_id(tab_id)
        event = session.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
        await event
        state = await session.get_browser_state_summary()
        return f"Switched to tab {tab_id}: {state.url}"

    except Exception as exc:
        return f"switch_tab failed: {exc}"


async def _handle_close_tab(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )

    session = _sessions[session_id]["session"]
    tab_id = args.get("tab_id", "")

    try:
        from browser_use.browser.events import CloseTabEvent

        target_id = await session.get_target_id_from_tab_id(tab_id)
        event = session.event_bus.dispatch(CloseTabEvent(target_id=target_id))
        await event
        current_url = await session.get_current_page_url()
        return f"Closed tab {tab_id}, now on: {current_url}"

    except Exception as exc:
        return f"close_tab failed: {exc}"


async def _handle_list_sessions(_args: dict[str, Any]) -> str:
    if not _sessions:
        return "No active browser sessions."

    sessions_info = []
    for sid, data in _sessions.items():
        sessions_info.append(
            {
                "session_id": sid,
                "created_at": time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(data["created_at"])
                ),
                "last_activity": time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(data["last_activity"])
                ),
                "age_minutes": round((time.time() - data["created_at"]) / 60, 1),
            }
        )
    return json.dumps(sessions_info, indent=2)


async def _handle_close_session(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    return await close_session(session_id)


async def _handle_agent(args: dict[str, Any]) -> str:
    """
    Run retry_with_browser_use_agent as an asyncio coroutine.
    No timeout ceiling — runs until task completes or max_steps exhausted.
    """
    task = args.get("task", "")
    if not task:
        return "Error: task is required."

    max_steps = int(args.get("max_steps", 100))
    use_vision = bool(args.get("use_vision", True))
    allowed_domains: list[str] = args.get("allowed_domains", []) or []
    session_id = args.get("session_id")

    llm = _get_llm()
    if llm is None:
        return (
            "Error: No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY "
            "to run retry_with_browser_use_agent."
        )

    config = load_browser_use_config()
    profile_config = get_default_profile(config)
    if allowed_domains:
        profile_config["allowed_domains"] = allowed_domains

    # Reuse existing session profile path if provided
    if session_id and session_id in _sessions:
        existing_session = _sessions[session_id]["session"]
        profile_config.update(
            {
                "user_data_dir": getattr(
                    existing_session, "browser_profile", BrowserProfile()
                ).user_data_dir
                or "~/.config/browseruse/profiles/default"
            }
        )

    profile = BrowserProfile(**profile_config)
    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=profile,
        use_vision=use_vision,
    )

    new_session_id = _new_session_id()

    try:
        history = await agent.run(max_steps=max_steps)

        lines = [
            f"Agent task completed.",
            f"Steps taken: {len(history.history)}",
            f"Success: {history.is_successful()}",
        ]

        final_result = history.final_result()
        if final_result:
            lines.append(f"\nFinal result:\n{final_result}")

        errors = history.errors()
        if errors:
            lines.append(f"\nErrors encountered:\n{json.dumps(errors, indent=2)}")

        urls = history.urls()
        if urls:
            valid_urls = [str(u) for u in urls if u is not None]
            if valid_urls:
                lines.append(f"\nURLs visited: {', '.join(valid_urls)}")

        # Track the agent's session if it created a browser session
        if agent.browser_session:
            _sessions[new_session_id] = {
                "session": agent.browser_session,
                "created_at": time.time(),
                "last_activity": time.time(),
            }
            lines.append(f"\nAgent session available as: {new_session_id}")

        return "\n".join(lines)

    except Exception as exc:
        return f"Agent task failed: {exc}"

    finally:
        # Only close agent resources if we didn't keep its session
        if new_session_id not in _sessions:
            try:
                await agent.close()
            except Exception:
                pass


async def _handle_export_session(args: dict[str, Any]) -> str:
    session_id = args.get("session_id", "")
    output_path = args.get("output_path", "")

    if not session_id or session_id not in _sessions:
        return (
            f"Session {session_id!r} not found. "
            "Use browser_list_sessions() to see active sessions."
        )
    if not output_path:
        return "Error: output_path is required."

    session = _sessions[session_id]["session"]

    try:
        # Get cookies via CDP
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

        # Mark as cookies_saved in last-session.json
        if session_id in _sessions:
            _write_last_session_json()

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


async def _handle_import_session(args: dict[str, Any]) -> str:
    import_path = args.get("import_path", "")
    navigate_to = args.get("navigate_to")

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
        # Create a fresh session
        config = load_browser_use_config()
        profile_config = get_default_profile(config)
        # Detect existing Chrome instance to avoid SingletonLock contention
        existing_cdp_url = _read_devtools_active_port(
            profile_config.get("user_data_dir", "~/.config/browseruse/profiles/default")
        )
        if existing_cdp_url:
            profile_config["cdp_url"] = existing_cdp_url
        profile = BrowserProfile(**profile_config)
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
                pass  # Skip invalid cookies

        # Navigate to URL if provided
        if navigate_to:
            from browser_use.browser.events import NavigateToUrlEvent

            event = session.event_bus.dispatch(NavigateToUrlEvent(url=navigate_to))
            await event

        new_id = _new_session_id()
        _sessions[new_id] = {
            "session": session,
            "created_at": time.time(),
            "last_activity": time.time(),
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


async def _handle_run_script(args: dict[str, Any]) -> str:
    script_path = args.get("script_path", "")
    script_args: list[str] = args.get("args", []) or []
    timeout_seconds = int(args.get("timeout_seconds", 300))

    if not script_path:
        return "Error: script_path is required."

    src = Path(script_path)
    if not src.exists():
        return f"Error: Script not found: {script_path}"

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

        return json.dumps(
            {
                "exit_code": proc.returncode,
                "stdout": stdout.decode(errors="replace"),
                "stderr": stderr.decode(errors="replace"),
            }
        )

    except Exception as exc:
        return f"run_script failed: {exc}"


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    """Start the MCP stdio server."""
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="browser-use",
                server_version=get_browser_use_version(),
                capabilities=app.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    asyncio.run(main())
