#!/usr/bin/env python3
"""
Browser Use MCP Server — thin wrapper over browser_use.mcp.server.BrowserUseServer.

Subclasses BrowserUseServer to:
  - Fix downloads_path and user_data_dir (PID-isolated profile)
  - Add 3 custom tools: browser_export_session, browser_import_session, browser_run_script
  - Add graceful shutdown (atexit + signal handlers)
  - Suppress macOS dock icon

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
import json
import logging
import signal
import time
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
# Custom tool definitions (appended to the 15 built-in tools)
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
# Thin-wrapper subclass
# ---------------------------------------------------------------------------

class MagusBrowserServer(BrowserUseServer):
    """
    Thin subclass of BrowserUseServer that:
    - Fixes downloads_path and user_data_dir (PID-isolated, avoids TCC / SingletonLock issues)
    - Extends list_tools with 3 custom tools
    - Overrides _execute_tool to dispatch the 3 custom tools, delegates rest to super()
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # super().__init__() calls _setup_handlers() internally, which registers
        # the parent's list_tools handler. We capture that handler AFTER super().__init__
        # returns, then replace it with a wrapper that appends our 3 custom tools.
        super().__init__(*args, **kwargs)
        self._extend_list_tools()

    def _extend_list_tools(self) -> None:
        """
        Replace the parent's registered list_tools handler with a wrapper that
        appends our 3 custom tool definitions and sanitizes upstream schemas.
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
            # at the top level of tool input_schema (browser-use#4211).
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
        """
        if self.browser_session:
            return

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

        # Initialize LLM from config
        llm_config = get_default_llm(self.config)
        base_url = llm_config.get("base_url")
        llm_kwargs: dict[str, Any] = {}
        if base_url:
            llm_kwargs["base_url"] = base_url
        if api_key := llm_config.get("api_key"):
            from browser_use.llm.openai.chat import ChatOpenAI
            self.llm = ChatOpenAI(
                model=llm_config.get("model", "gpt-4o-mini"),
                api_key=api_key,
                temperature=llm_config.get("temperature", 0.7),
                **llm_kwargs,
            )

        # Initialize FileSystem for extract_content
        from browser_use.filesystem.file_system import FileSystem
        file_system_path = profile_config.get("file_system_path", "~/.browser-use-mcp")
        self.file_system = FileSystem(base_dir=Path(file_system_path).expanduser())

    async def _execute_tool(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> str | list[types.TextContent | types.ImageContent]:
        """
        Dispatch our 3 custom tools; delegate everything else to the parent.
        The parent's call_tool closure calls self._execute_tool(), so our override
        intercepts all tool invocations automatically.
        """
        if tool_name == "browser_export_session":
            return await self._handle_export_session(arguments)
        elif tool_name == "browser_import_session":
            return await self._handle_import_session(arguments)
        elif tool_name == "browser_run_script":
            return await self._handle_run_script(arguments)
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

    # ------------------------------------------------------------------
    # Graceful shutdown
    # ------------------------------------------------------------------

    def _shutdown_sync(self) -> None:
        """
        Best-effort synchronous cleanup on process exit.
        Kills Chrome child processes and removes the PID-specific SingletonLock file
        so stale locks don't block future sessions.
        """
        pid = os.getpid()
        profile_dir = (
            Path.home() / ".config" / "browseruse" / "profiles" / f"session-{pid}"
        )

        # Attempt to terminate the Chrome subprocess via the session's internal state.
        session = getattr(self, "browser_session", None)
        if session is not None:
            try:
                browser = getattr(session, "_browser", None) or getattr(session, "browser", None)
                if browser is not None:
                    proc = getattr(browser, "_process", None) or getattr(browser, "process", None)
                    if proc is not None and hasattr(proc, "terminate"):
                        proc.terminate()
            except Exception:
                pass

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
# Main entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    """Start the MCP stdio server."""
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
