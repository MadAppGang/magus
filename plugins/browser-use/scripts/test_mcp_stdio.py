#!/usr/bin/env python3
"""
End-to-end harness test: drive the REAL MCP server the way the plugin does.

This is the layer test_mcp_protocol.py (in-memory) and test_mcp_server.py
(handler-level) both skip: it launches `python3 mcp-server.py` as an actual
SUBPROCESS over stdio — exactly how `.mcp.json` starts it and how Claude Code
connects — then speaks real MCP JSON-RPC to it via the SDK's `stdio_client`.

It proves the shipped process actually works: it boots past the dependency
import checks, the dock-icon ctypes hack, the logging suppression and `main()`'s
stdio wiring, registers all 27 tools, and answers `tools/list` / `tools/call`.
None of the other test layers exercise the process/transport boundary, which is
the plugin's real contract (and historically the most fragile part — stray
stdout breaks JSON-RPC).

Probe tool: `browser_doctor` — full subprocess round-trip, no browser, so it's
deterministic and CI-safe. (Browser-driving behaviour is verified against real
Chromium by the e2e job and by scripts/manual-verify/.)

The two context managers are entered as PROPERLY NESTED `async with` blocks:
`ClientSession.__aexit__` raises an ExceptionGroup when the body failed, and a
hand-rolled `__aexit__` that ran the session exit first never reached the
transport exit — leaving the server subprocess alive and the event loop waiting
on it forever. A failing assertion must fail, not hang the CI job.

Every server subprocess runs with a temp HOME and BH_HOME, and without the variables the
e2e suite strips (API keys, CLAUDE_PROJECT_DIR, CHROME_EXECUTABLE_PATH, BH_* and the rest), so it
can read neither the developer's settings nor their credentials.

Skipped if `browser_use` / `mcp` aren't importable, except under CI.
"""

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

from test_e2e_lifecycle import _STRIPPED_ENV, _STRIPPED_ENV_PREFIXES
from test_mcp_protocol import TOOL_CONTRACT

_HAVE_DEPS = (
    importlib.util.find_spec("browser_use") is not None
    and importlib.util.find_spec("mcp") is not None
)
_RUN = _HAVE_DEPS or bool(os.environ.get("CI"))

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"


def _hermetic_env(testcase) -> dict:
    """HOME and BH_HOME for a server subprocess: fresh temp dirs, removed afterwards."""
    home = tempfile.mkdtemp(prefix="magus-bu-stdio-home-")
    # The harness daemon socket path is capped near 104 bytes on macOS.
    bh_home = tempfile.mkdtemp(prefix="bh", dir="/tmp")
    for path in (home, bh_home):
        testcase.addCleanup(shutil.rmtree, path, ignore_errors=True)
    return {"HOME": home, "BH_HOME": bh_home}


def _subprocess_env(testcase) -> dict:
    """
    The full environment for a server subprocess: this process's, minus
    everything the e2e suite strips (model and cloud keys, the user's Chrome,
    their project and config dirs, any harness state), on a temp HOME and BH_HOME.
    """
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in _STRIPPED_ENV and not key.startswith(_STRIPPED_ENV_PREFIXES)
    }
    env.update(_hermetic_env(testcase))
    return env


@unittest.skipUnless(_RUN, "browser_use / mcp not installed")
class TestRealStdioSubprocess(unittest.IsolatedAsyncioTestCase):
    """Spawn the real server as a subprocess and talk to it over stdio."""

    @asynccontextmanager
    async def _session(self):
        """Async context manager yielding an initialized ClientSession bound to
        a freshly-spawned `python3 mcp-server.py` subprocess.

        Nested `async with`, deliberately: the transport's exit must run even
        when the session's exit raises (it does after a failed body), or the
        subprocess is never reaped and the test hangs instead of failing.
        """
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(
            command=sys.executable,
            args=[str(_SERVER_PATH)],
            # The SDK passes only its own safe set of variables (PATH, USER,
            # ...), which carries no API key; these replace the real HOME.
            env=_hermetic_env(self),
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    async def test_subprocess_boots_and_lists_all_tools(self):
        """The shipped process must boot over stdio and advertise exactly the
        contract's tool names — proving the stdout guards / init hacks don't
        break JSON-RPC, and that no tool went missing on the way."""
        async with self._session() as session:
            result = await session.list_tools()
            names = {t.name for t in result.tools}
        for expected in (
            "browser_navigate", "browser_evaluate", "browser_press_key",
            "browser_keyboard", "browser_focus", "browser_doctor",
        ):
            self.assertIn(expected, names, f"{expected} missing from real stdio server")
        self.assertEqual(sorted(names), sorted(TOOL_CONTRACT))

    async def test_subprocess_call_browser_doctor(self):
        """A real tools/call over the subprocess must round-trip a JSON report."""
        async with self._session() as session:
            result = await session.call_tool("browser_doctor", {})
            self.assertFalse(result.is_error, f"browser_doctor errored: {result}")
            data = json.loads(result.content[0].text)
            for field in ("python_version", "browser_use", "chromium_present", "api_keys"):
                self.assertIn(field, data)
            self.assertEqual(data["python_executable"], sys.executable)
            self.assertFalse(any(data["api_keys"].values()), "a real API key reached the server")

    async def test_subprocess_stdout_is_clean_jsonrpc(self):
        """If the server leaked non-JSON to stdout, initialize()/list_tools()
        would fail to parse. Reaching a valid result IS the clean-stdout proof."""
        async with self._session() as session:
            result = await session.list_tools()
            self.assertTrue(hasattr(result, "tools"))


class TestSubprocessEnvironment(unittest.TestCase):
    """The environment a server subprocess here inherits from the developer's shell."""

    def test_settings_paths_and_harness_state_are_stripped(self):
        leaky = {
            "ANTHROPIC_API_KEY": "k", "OPENAI_API_KEY": "k", "BROWSER_USE_API_KEY": "k",
            "BROWSER_USE_CLOUD": "true", "CLAUDE_PROJECT_DIR": "/some/project",
            "CHROME_EXECUTABLE_PATH": "/Applications/Google Chrome.app", "XDG_CONFIG_HOME": "/x",
            "BH_AGENT_WORKSPACE": "/w", "BROWSER_HARNESS_HOME": "/h", "BU_NAME": "n",
        }
        with patch.dict(os.environ, leaky):
            env = _subprocess_env(self)
        for key in leaky:
            self.assertNotIn(key, env)
        self.assertIn("PATH", env)
        self.assertTrue(env["HOME"].startswith(tempfile.gettempdir()), env["HOME"])
        self.assertTrue(env["BH_HOME"].startswith("/tmp/"), env["BH_HOME"])


@unittest.skipUnless(_RUN, "browser_use / mcp not installed")
class TestSigtermActuallyExits(unittest.TestCase):
    """
    SIGTERM must end the process, even while the MCP stdio reader sits blocked
    in read() on a stdin that is still open.

    A server that handles SIGTERM by raising SystemExit on the main thread
    waits for every non-daemon thread, including that reader, and so never
    exits. Under Claude Code the stdin pipe usually closes at the same moment,
    which hides it; a bare SIGTERM would leave one stranded server per session
    that ended that way.

    The server installs no SIGTERM handler of its own. With no Browser yet, the
    default action ends it; once a Browser exists, browser-use's handler stops
    every live Browser, restores the default and re-sends the signal.
    """

    def test_server_exits_within_a_few_seconds_of_sigterm(self):
        import signal
        import subprocess
        import time

        env = _subprocess_env(self)
        # stdin stays OPEN on purpose. Closing it would let the reader thread
        # finish on EOF and mask the bug this test exists to catch.
        proc = subprocess.Popen(
            [sys.executable, str(_SERVER_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
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
                "server did not exit within 15s of SIGTERM: the process stayed "
                "resident, which is how servers accumulate. Nothing may turn "
                "SIGTERM into a SystemExit that waits on the blocked stdio reader."
            )

    @staticmethod
    def _force_kill(proc):
        # Only ever the one process this test started, by its own handle.
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
