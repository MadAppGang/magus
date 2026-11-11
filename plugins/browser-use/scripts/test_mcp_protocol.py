#!/usr/bin/env python3
"""
Protocol-level integration tests for the Browser Use MCP server.

Unlike test_mcp_server.py (which calls the tool handlers directly, bypassing
the MCP envelope), these drive the REAL MCP protocol through the SDK's in-memory
client⇄server transport — the same `tools/list` / `tools/call` path Claude Code
uses, minus the LLM and minus a subprocess. This catches dispatch, registration,
schema, and result-serialization bugs that handler-level unit tests structurally
cannot see.

Transport: the `mcp` 2.x SDK's in-memory streams — no npx, no Node, no network,
no Chrome. Runs in milliseconds. mcp 2.x ships no one-call helper for this, so
`_connect_mcp2` assembles the public pieces exactly the way the SDK's own
in-process transport does (mcp/client/_memory.py, `InMemoryTransport._connect`):
server in a task group, client session over the other ends, `initialize()`, then
EOF both write sides and give the server a bounded grace to exit.

Probe tools need no browser (browser_doctor, browser_list_sessions, a custom
tool with no session, an unknown tool), so every test stays deterministic and
CI-safe. Browser-dependent tools are verified against real Chromium by the e2e
job and by scripts/manual-verify/.

The module runs under a temp HOME and BH_HOME with every API-key variable
cleared. It is skipped when browser_use or mcp is missing, except under CI,
where it runs and fails instead.
"""

import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

_HAVE_DEPS = (
    importlib.util.find_spec("browser_use") is not None
    and importlib.util.find_spec("mcp") is not None
)

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"

# How long the connector waits for the server task to exit on its own after
# both write sides are closed, before cancelling it. Same value the SDK uses
# (mcp/client/_memory.py, SERVER_SHUTDOWN_GRACE).
_SERVER_SHUTDOWN_GRACE = 2.0

# Variables that change what the server does or which credentials it could
# reach. Cleared for the whole module.
_ENV_SCRUB = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_CLOUD",
    "BROWSER_USE_AGENT_MODEL",
    "CLAUDE_PROJECT_DIR",
    "XDG_CONFIG_HOME",
    "BH_AGENT_WORKSPACE",
)
_module_env = None
_module_dirs: list = []


def setUpModule():
    global _module_env
    _module_env = patch.dict(os.environ, {})
    _module_env.start()
    for key in _ENV_SCRUB:
        os.environ.pop(key, None)
    home = tempfile.mkdtemp(prefix="magus-bu-protocol-home-")
    bh_home = tempfile.mkdtemp(prefix="bh", dir="/tmp")
    _module_dirs.extend([home, bh_home])
    os.environ["HOME"] = home
    os.environ["BH_HOME"] = bh_home


def tearDownModule():
    if _module_env is not None:
        _module_env.stop()
    for path in _module_dirs:
        shutil.rmtree(path, ignore_errors=True)
    _module_dirs.clear()


def _tool(properties=(), required=()):
    return {"properties": frozenset(properties), "required": frozenset(required)}


# The public contract: every tool the server advertises, with its input
# property names and required list. tools/list must match this exactly, so a
# tool that disappears, appears or changes its inputs fails here by name.
TOOL_CONTRACT = {
    "browser_navigate": _tool(("url", "new_tab"), ("url",)),
    "browser_click": _tool(("index", "coordinate_x", "coordinate_y", "new_tab")),
    "browser_type": _tool(("index", "text"), ("index", "text")),
    "browser_get_state": _tool(("include_screenshot",)),
    "browser_extract_content": _tool(("query", "extract_links"), ("query",)),
    "browser_get_html": _tool(("selector",)),
    "browser_screenshot": _tool(("full_page",)),
    "browser_scroll": _tool(("direction",)),
    "browser_go_back": _tool(),
    "browser_list_tabs": _tool(),
    "browser_switch_tab": _tool(("tab_id",), ("tab_id",)),
    "browser_close_tab": _tool(("tab_id",), ("tab_id",)),
    "retry_with_browser_use_agent": _tool(
        ("task", "max_steps", "model", "allowed_domains", "use_vision"), ("task",)
    ),
    "browser_list_sessions": _tool(),
    "browser_close_session": _tool(("session_id",), ("session_id",)),
    "browser_close_all": _tool(),
    "browser_export_session": _tool(
        ("session_id", "output_path"), ("session_id", "output_path")
    ),
    "browser_import_session": _tool(("import_path", "navigate_to"), ("import_path",)),
    "browser_run_script": _tool(
        ("script_path", "args", "timeout_seconds"), ("script_path",)
    ),
    "browser_evaluate": _tool(("script",), ("script",)),
    "browser_press_key": _tool(("key", "count"), ("key",)),
    "browser_keyboard": _tool(("keys", "text")),
    "browser_focus": _tool(("selector",), ("selector",)),
    "browser_save_screenshot": _tool(("output_path", "full_page"), ("output_path",)),
    "browser_doctor": _tool(),
    "browser_start_cloud_session": _tool(("navigate_to",)),
    "browser_set_agent_model": _tool(
        ("provider", "model", "base_url", "api_key_env", "temperature"),
        ("provider", "model"),
    ),
}


def _load_real_server_module():
    """Import mcp-server.py with the real mcp and browser_use packages."""
    spec = importlib.util.spec_from_file_location("mcp_server_real", _SERVER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_real_server_module_or_fail(testcase):
    """
    _load_real_server_module, but a server that exits at import becomes a test
    failure carrying the server's own error line, not a bare SystemExit.
    """
    import contextlib
    import io

    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            return _load_real_server_module()
    except SystemExit as exc:
        testcase.fail(
            f"mcp-server.py exited at import (code {exc.code}) against the "
            f"installed browser_use: {err.getvalue().strip()}"
        )


def _attr(model, *names):
    """First attribute of `model` that exists among `names` (wire alias or field name)."""
    for name in names:
        if hasattr(model, name):
            return getattr(model, name)
    raise AttributeError(f"{type(model).__name__} has none of {names}")


@asynccontextmanager
async def _connect_mcp2(server):
    """
    An initialized ClientSession over in-memory streams to `server`.

    Mirrors the SDK's own `InMemoryTransport._connect` (mcp/client/_memory.py):
    the server runs in a task group over one end of the stream pair, the client
    session sits on the other, and teardown EOFs both write sides so a
    well-behaved server exits on its own — cancellation is only the backstop.
    """
    import anyio
    from mcp.client.session import ClientSession
    from mcp.shared.memory import create_client_server_memory_streams

    async with create_client_server_memory_streams() as (client_streams, server_streams):
        client_read, client_write = client_streams
        server_read, server_write = server_streams
        server_done = anyio.Event()

        async def run_server() -> None:
            try:
                await server.run(
                    server_read,
                    server_write,
                    server.create_initialization_options(),
                )
            finally:
                server_done.set()

        async with anyio.create_task_group() as tg:
            tg.start_soon(run_server)
            try:
                async with ClientSession(
                    read_stream=client_read, write_stream=client_write
                ) as session:
                    await session.initialize()
                    yield session
            finally:
                await client_write.aclose()
                await server_write.aclose()
                with anyio.move_on_after(_SERVER_SHUTDOWN_GRACE):
                    await server_done.wait()
                if not server_done.is_set():
                    tg.cancel_scope.cancel()


def _connect(server):
    """Async context manager yielding an initialized in-memory ClientSession."""
    return _connect_mcp2(server)


@unittest.skipUnless(_HAVE_DEPS or os.environ.get("CI"), "browser_use / mcp not installed")
class TestRealMcpProtocol(unittest.IsolatedAsyncioTestCase):
    """End-to-end tests over the SDK's in-memory MCP transport."""

    async def _client(self):
        """An initialized in-memory ClientSession wired to the real server."""
        mod = _load_real_server_module_or_fail(self)
        server = mod.MagusBrowserServer()
        return _connect(server.server)

    async def test_tools_list_matches_the_contract(self):
        """tools/list over the real protocol must advertise exactly the contract:
        the same tool names, and for each the same input properties and the same
        required list. Element indexes, sessions and tabs may change underneath,
        but a client's call shapes may not."""
        mod = _load_real_server_module_or_fail(self)
        server = mod.MagusBrowserServer()
        async with _connect(server.server) as client:
            result = await client.list_tools()
        advertised = {}
        for t in result.tools:
            schema = _attr(t, "inputSchema", "input_schema") or {}
            advertised[t.name] = {
                "properties": frozenset((schema.get("properties") or {}).keys()),
                "required": frozenset(schema.get("required") or ()),
            }
        self.assertEqual(
            sorted(advertised), sorted(TOOL_CONTRACT),
            "advertised tool names differ from the contract",
        )
        for name, expected in TOOL_CONTRACT.items():
            with self.subTest(tool=name):
                self.assertEqual(advertised[name], expected)

    async def test_tool_schemas_have_no_oneOf_at_top_level(self):
        """No advertised tool may carry a top-level oneOf/allOf/anyOf: the Claude
        API rejects them, and a single offender breaks ALL MCP tool registration.
        The server writes every schema itself, so this guards those definitions."""
        async with await self._client() as client:
            result = await client.list_tools()
            for t in result.tools:
                schema = _attr(t, "inputSchema", "input_schema") or {}
                for forbidden in ("oneOf", "allOf", "anyOf"):
                    self.assertNotIn(
                        forbidden, schema,
                        f"{t.name} exposes top-level {forbidden} (Claude API rejects it)",
                    )

    async def test_call_browser_doctor_over_protocol(self):
        """A real tools/call to browser_doctor must round-trip a JSON report."""
        async with await self._client() as client:
            result = await client.call_tool("browser_doctor", {})
            self.assertFalse(result.is_error, f"browser_doctor errored: {result}")
            # The handler returns a JSON string as TextContent.
            data = json.loads(result.content[0].text)
            for field in ("python_version", "browser_use", "browser_harness", "mcp",
                          "playwright", "chromium_present", "api_keys"):
                self.assertIn(field, data)
            self.assertTrue(data["browser_use"]["installed"])
            self.assertFalse(any(data["api_keys"].values()), "a real API key reached the test")

    async def test_call_browser_evaluate_without_session_errors_cleanly(self):
        """browser_evaluate with no browser must return a clean error string over
        the protocol (not crash the server / not return a silent null)."""
        async with await self._client() as client:
            result = await client.call_tool("browser_evaluate", {"script": "1+1"})
            self.assertEqual(
                result.content[0].text,
                "Error: No browser session active. Navigate first (browser_navigate).",
            )

    async def test_call_browser_list_sessions_without_a_browser(self):
        async with await self._client() as client:
            result = await client.call_tool("browser_list_sessions", {})
            self.assertFalse(result.is_error)
            self.assertEqual(result.content[0].text, "No active browser sessions")

    async def test_call_an_unknown_tool_is_an_error_result(self):
        """An unknown tool is a tool result flagged is_error, not a protocol
        error that would end the client's call with an exception."""
        async with await self._client() as client:
            result = await client.call_tool("browser_does_not_exist", {})
            self.assertTrue(result.is_error)
            self.assertEqual(result.content[0].text, "Error: Unknown tool: browser_does_not_exist")


if __name__ == "__main__":
    unittest.main(verbosity=2)
