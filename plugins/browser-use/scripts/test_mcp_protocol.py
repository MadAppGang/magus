#!/usr/bin/env python3
"""
Protocol-level integration tests for the Browser Use MCP server.

Unlike test_mcp_server.py (which calls the _handle_* methods directly, bypassing
the MCP envelope), these drive the REAL MCP protocol through the SDK's in-memory
client⇄server transport — the same `tools/list` / `tools/call` path Claude Code
uses, minus the LLM and minus a subprocess. This catches dispatch, registration,
schema, and result-serialization bugs that handler-level unit tests structurally
cannot see.

Tool of choice: the official `mcp` Python SDK's
`mcp.shared.memory.create_connected_server_and_client_session` — no npx, no Node,
no network, no Chrome. Runs in pytest in milliseconds.

Probe tool: `browser_doctor`, which exercises the full round-trip but needs no
browser, so it stays deterministic and CI-safe. (Browser-dependent tools are
verified live against real Chrome by scripts/manual-verify/.)

Requires the real `browser_use` + `mcp` packages installed. If `browser_use`
isn't importable, the whole module is skipped.
"""

import importlib.util
import json
import unittest
from pathlib import Path

# Skip the entire module cleanly if the real deps aren't present.
_HAVE_DEPS = (
    importlib.util.find_spec("browser_use") is not None
    and importlib.util.find_spec("mcp") is not None
)

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"


def _load_real_server_module():
    """Import mcp-server.py with the REAL mcp/browser_use SDKs (no stubs)."""
    spec = importlib.util.spec_from_file_location("mcp_server_real", _SERVER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@unittest.skipUnless(_HAVE_DEPS, "browser_use / mcp not installed")
class TestRealMcpProtocol(unittest.IsolatedAsyncioTestCase):
    """End-to-end tests over the SDK's in-memory MCP transport."""

    async def _client(self):
        """Yield an initialized in-memory ClientSession wired to the real server."""
        from mcp.shared.memory import create_connected_server_and_client_session
        mod = _load_real_server_module()
        server = mod.MagusBrowserServer()
        # create_connected_server_and_client_session is an async context manager
        # returning a connected ClientSession; we expose both for the test.
        return create_connected_server_and_client_session(server.server)

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
                schema = t.inputSchema or {}
                for forbidden in ("oneOf", "allOf", "anyOf"):
                    self.assertNotIn(
                        forbidden, schema,
                        f"{t.name} exposes top-level {forbidden} (Claude API rejects it)",
                    )

    async def test_call_browser_doctor_over_protocol(self):
        """A real tools/call to browser_doctor must round-trip a JSON report."""
        async with await self._client() as client:
            result = await client.call_tool("browser_doctor", {})
            self.assertFalse(result.isError, f"browser_doctor errored: {result}")
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
