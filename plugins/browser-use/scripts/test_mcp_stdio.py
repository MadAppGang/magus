#!/usr/bin/env python3
"""
End-to-end harness test: drive the REAL MCP server the way the plugin does.

This is the layer test_mcp_protocol.py (in-memory) and test_mcp_server.py
(handler-level) both skip: it launches `python3 mcp-server.py` as an actual
SUBPROCESS over stdio — exactly how `.mcp.json` starts it and how Claude Code
connects — then speaks real MCP JSON-RPC to it via the SDK's `stdio_client`.

It proves the shipped process actually works: it boots past the stdout-
contamination guards, the dock-icon ctypes hack, the logging suppression, the
signal handlers, and `main()`'s stdio wiring, registers all 24 tools, and
answers `tools/list` / `tools/call`. None of the other test layers exercise the
process/transport boundary, which is the plugin's real contract (and historically
the most fragile part — stray stdout breaks JSON-RPC).

Probe tool: `browser_doctor` — full subprocess round-trip, no Chrome, so it's
deterministic and CI-safe. (Browser-driving behavior is verified live against
real Chrome by scripts/manual-verify/.)

Skipped if `browser_use` / `mcp` aren't importable.
"""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

_HAVE_DEPS = (
    importlib.util.find_spec("browser_use") is not None
    and importlib.util.find_spec("mcp") is not None
)

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"


@unittest.skipUnless(_HAVE_DEPS, "browser_use / mcp not installed")
class TestRealStdioSubprocess(unittest.IsolatedAsyncioTestCase):
    """Spawn the real server as a subprocess and talk to it over stdio."""

    async def _session(self):
        """Async context manager yielding an initialized ClientSession bound to
        a freshly-spawned `python3 mcp-server.py` subprocess."""
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=[str(_SERVER_PATH)],
            # Inherit env so the server finds its deps (mirrors how the plugin
            # inherits the launching environment).
            env=None,
        )

        class _Ctx:
            async def __aenter__(self):
                self._stdio_cm = stdio_client(params)
                read, write = await self._stdio_cm.__aenter__()
                self._sess_cm = ClientSession(read, write)
                session = await self._sess_cm.__aenter__()
                await session.initialize()
                return session

            async def __aexit__(self, *exc):
                await self._sess_cm.__aexit__(*exc)
                await self._stdio_cm.__aexit__(*exc)

        return _Ctx()

    async def test_subprocess_boots_and_lists_all_tools(self):
        """The shipped process must boot over stdio and advertise all 24 tools —
        proving the stdout guards / init hacks don't break JSON-RPC."""
        async with await self._session() as session:
            result = await session.list_tools()
            names = {t.name for t in result.tools}
        for expected in (
            "browser_navigate", "browser_evaluate", "browser_press_key",
            "browser_keyboard", "browser_focus", "browser_doctor",
        ):
            self.assertIn(expected, names, f"{expected} missing from real stdio server")
        self.assertGreaterEqual(len(names), 24, f"expected >= 24 tools, got {len(names)}")

    async def test_subprocess_call_browser_doctor(self):
        """A real tools/call over the subprocess must round-trip a JSON report."""
        async with await self._session() as session:
            result = await session.call_tool("browser_doctor", {})
            self.assertFalse(result.isError, f"browser_doctor errored: {result}")
            data = json.loads(result.content[0].text)
            for field in ("python_version", "browser_use", "chromium_present", "api_keys"):
                self.assertIn(field, data)

    async def test_subprocess_stdout_is_clean_jsonrpc(self):
        """If the server leaked non-JSON to stdout, initialize()/list_tools()
        would fail to parse. Reaching a valid result IS the clean-stdout proof."""
        async with await self._session() as session:
            result = await session.list_tools()
            self.assertTrue(hasattr(result, "tools"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
