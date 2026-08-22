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


@unittest.skipUnless(_HAVE_DEPS, "browser_use / mcp not installed")
class TestSigtermActuallyExits(unittest.TestCase):
    """
    SIGTERM must end the process, not just run its cleanup.

    `_handle_signal` used to finish with `sys.exit(0)`, which raises SystemExit
    on the main thread and then waits for every non-daemon thread. The MCP stdio
    reader sits blocked in read(), so the interpreter never got to exit: cleanup
    ran correctly and the server stayed resident forever.

    Under Claude Code the stdin pipe usually closes at the same moment, which
    hides it — but a bare SIGTERM leaves the server alive, and a machine
    accumulates one stranded server per session that ended that way. Found by
    the E2E lifecycle suite, which had to force-kill the servers it started.
    """

    def test_server_exits_within_a_few_seconds_of_sigterm(self):
        import os
        import signal
        import subprocess
        import time

        # stdin stays OPEN on purpose. Closing it would let the reader thread
        # finish on EOF and mask the bug this test exists to catch.
        proc = subprocess.Popen(
            [sys.executable, str(_SERVER_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(self._force_kill, proc)

        # Let it finish booting before signalling it.
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                self.fail(f"server exited during startup, rc={proc.returncode}")
            time.sleep(0.25)
            if time.monotonic() > deadline - 17:
                break

        proc.send_signal(signal.SIGTERM)

        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.fail(
                "server did not exit within 15s of SIGTERM — cleanup ran but the "
                "process stayed resident, which is how servers accumulate. The "
                "signal handler must terminate the process rather than raise "
                "SystemExit and wait on the blocked stdio reader thread."
            )

    @staticmethod
    def _force_kill(proc):
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                stream and stream.close()
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
