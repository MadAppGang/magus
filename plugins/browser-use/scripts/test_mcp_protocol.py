#!/usr/bin/env python3
"""
Protocol-level integration tests for the Browser Use MCP server.

Unlike test_mcp_server.py (which calls the _handle_* methods directly, bypassing
the MCP envelope), these drive the REAL MCP protocol through the SDK's in-memory
client⇄server transport — the same `tools/list` / `tools/call` path Claude Code
uses, minus the LLM and minus a subprocess. This catches dispatch, registration,
schema, and result-serialization bugs that handler-level unit tests structurally
cannot see.

Transport: the official `mcp` Python SDK's in-memory streams — no npx, no Node,
no network, no Chrome. Runs in milliseconds. Two SDK majors are in the field and
this file must pass on both, because mcp-server.py ships one file for both:

  - mcp 1.x ships `mcp.shared.memory.create_connected_server_and_client_session`,
    which wires a lowlevel Server to a ClientSession and initializes it.
  - mcp 2.x removed that helper. What remains public is
    `mcp.shared.memory.create_client_server_memory_streams` (the stream pair),
    `mcp.client.session.ClientSession`, and `Server.run(...)`. `_connect_mcp2`
    below assembles those exactly the way the SDK's own in-process transport
    does (mcp 2.1.1, mcp/client/_memory.py, `InMemoryTransport._connect`):
    server in a task group, client session over the other ends, `initialize()`,
    then EOF both write sides and give the server a bounded grace to exit.

The choice is an import-try on the helper that vanished, which is the honest
capability check here: it is the symbol itself that is or is not there.

Field names differ between the majors too — 1.x models `Tool.inputSchema` and
`CallToolResult.isError`; 2.x renamed them `input_schema` / `is_error` and kept
the camelCase only as the wire alias — so the tests read them through `_attr`.

Probe tool: `browser_doctor`, which exercises the full round-trip but needs no
browser, so it stays deterministic and CI-safe. (Browser-dependent tools are
verified live against real Chrome by scripts/manual-verify/.)

Requires the real `browser_use` + `mcp` packages installed. If `browser_use`
isn't importable, the whole module is skipped.
"""

import importlib.util
import json
import unittest
from contextlib import asynccontextmanager
from pathlib import Path

# Skip the entire module cleanly if the real deps aren't present.
_HAVE_DEPS = (
    importlib.util.find_spec("browser_use") is not None
    and importlib.util.find_spec("mcp") is not None
)

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"

# How long the 2.x connector waits for the server task to exit on its own after
# both write sides are closed, before cancelling it. Same value the SDK uses
# (mcp/client/_memory.py, SERVER_SHUTDOWN_GRACE).
_SERVER_SHUTDOWN_GRACE = 2.0


def _load_real_server_module():
    """Import mcp-server.py with the REAL mcp/browser_use SDKs (no stubs)."""
    spec = importlib.util.spec_from_file_location("mcp_server_real", _SERVER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _attr(model, *names):
    """First attribute of `model` that exists among `names` (1.x vs 2.x field names)."""
    for name in names:
        if hasattr(model, name):
            return getattr(model, name)
    raise AttributeError(f"{type(model).__name__} has none of {names}")


@asynccontextmanager
async def _connect_mcp2(server):
    """
    mcp 2.x: an initialized ClientSession over in-memory streams to `server`.

    Mirrors mcp 2.1.1's own `InMemoryTransport._connect` (mcp/client/_memory.py):
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
    """
    Async context manager yielding an initialized in-memory ClientSession.

    mcp 1.x ships a helper that does the whole job; mcp 2.x removed it, and the
    import-try is the capability check — the missing symbol IS the difference.
    """
    try:
        from mcp.shared.memory import create_connected_server_and_client_session
    except ImportError:
        return _connect_mcp2(server)
    return create_connected_server_and_client_session(server)


@unittest.skipUnless(_HAVE_DEPS, "browser_use / mcp not installed")
class TestRealMcpProtocol(unittest.IsolatedAsyncioTestCase):
    """End-to-end tests over the SDK's in-memory MCP transport."""

    async def _client(self):
        """An initialized in-memory ClientSession wired to the real server."""
        mod = _load_real_server_module()
        server = mod.MagusBrowserServer()
        return _connect(server.server)

    async def test_tools_list_includes_all_custom_tools_over_protocol(self):
        """tools/list over the real protocol must advertise all 5 new tools."""
        async with await self._client() as client:
            result = await client.list_tools()
            names = {t.name for t in result.tools}
        for expected in (
            "browser_evaluate", "browser_press_key", "browser_keyboard",
            "browser_focus", "browser_doctor",
        ):
            self.assertIn(expected, names, f"{expected} not advertised over MCP")
        # 16 upstream + 8 custom; assert the new floor.
        self.assertGreaterEqual(len(names), 24, f"expected >= 24 tools, got {len(names)}")

    async def test_tool_schemas_have_no_oneOf_at_top_level(self):
        """No advertised tool may carry a top-level oneOf/allOf/anyOf — the Claude
        API rejects them and a single offender breaks ALL MCP tool registration.

        NOTE: this is an OUTCOME check. It passes whether the result is clean
        because our sanitizer stripped a oneOf (browser-use <= 0.12.5) OR because
        the installed upstream is already clean (0.12.6+, where #4211/PR#4212
        removed it). test_mcp_server.py::TestCustomToolsRegistered
        ::test_sanitizer_strips_oneOf_regardless_of_version proves the sanitizer
        itself works, version-independently (it injects the offending schema)."""
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
            self.assertFalse(
                _attr(result, "isError", "is_error"),
                f"browser_doctor errored: {result}",
            )
            # The handler returns a JSON string as TextContent.
            text = result.content[0].text
            data = json.loads(text)
            for field in ("python_version", "browser_use", "mcp",
                          "playwright", "chromium_present", "api_keys"):
                self.assertIn(field, data)
            # browser_use is importable here (the suite imported it).
            self.assertTrue(data["browser_use"]["installed"])

    async def test_call_browser_evaluate_without_session_errors_cleanly(self):
        """browser_evaluate with no browser must return a clean error string over
        the protocol (not crash the server / not return a silent null)."""
        async with await self._client() as client:
            result = await client.call_tool("browser_evaluate", {"script": "1+1"})
            text = result.content[0].text
            self.assertIn("No browser session", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
