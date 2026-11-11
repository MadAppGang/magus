"""
Launch the plugin's MCP server as a subprocess and talk to it over stdio.

The same path Claude Code uses: `python mcp-server.py`, real JSON-RPC through the
mcp SDK's stdio_client. Run the scripts here with an interpreter that has the
server's pinned dependencies (the env `uv sync --no-config --script` builds, or a
venv with browser-use, mcp and playwright at the header's versions).

The server runs hermetically: a temp HOME (so it reads none of your settings,
cookies or keys), a short temp BH_HOME (the harness daemon socket path is capped
near 104 bytes on macOS), and no API keys. Chromium is resolved once with your
real HOME and passed as CHROME_EXECUTABLE_PATH, because the temp HOME has no
Playwright cache. Headless unless HEADED=1.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
SERVER_PATH = SCRIPTS_DIR / "mcp-server.py"


def _chromium() -> str:
    explicit = os.environ.get("CHROME_EXECUTABLE_PATH")
    if explicit:
        return explicit
    sys.path.insert(0, str(SCRIPTS_DIR))
    from browser_env import _resolve_chromium_binary

    return _resolve_chromium_binary()


@asynccontextmanager
async def server_session() -> AsyncIterator["Tools"]:
    """An initialised MCP client session on a fresh server subprocess."""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    home = tempfile.mkdtemp(prefix="bu-manual-home-")
    bh_home = tempfile.mkdtemp(prefix="bh", dir="/tmp")
    env = {
        "HOME": home,
        "BH_HOME": bh_home,
        "CHROME_EXECUTABLE_PATH": _chromium(),
        "BROWSER_USE_HEADLESS": "false" if os.environ.get("HEADED") == "1" else "true",
    }
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER_PATH)], env=env)
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = Tools(session)
                try:
                    yield tools
                finally:
                    await tools.call("browser_close_all")
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(bh_home, ignore_errors=True)


class Tools:
    """Thin calls on the server's tools, returning the first text block."""

    def __init__(self, session: Any) -> None:
        self._session = session

    async def call(self, name: str, args: dict[str, Any] | None = None) -> str:
        result = await self._session.call_tool(name, args or {})
        text = next((c.text for c in result.content if getattr(c, "type", "") == "text"), "")
        if result.is_error:
            raise RuntimeError(f"{name} returned an error result: {text}")
        return text

    async def evaluate(self, script: str) -> Any:
        """browser_evaluate's value, or the error dict when the script threw."""
        reply = json.loads(await self.call("browser_evaluate", {"script": script}))
        return reply["result"] if "result" in reply else reply


class Checks:
    """Collects [PASS]/[FAIL] lines; `exit_code` is 0 only when all passed."""

    def __init__(self) -> None:
        self.ok = True

    def check(self, name: str, got: Any, want: Any) -> None:
        passed = got == want
        self.ok = self.ok and passed
        print(f"[{'PASS' if passed else 'FAIL'}] {name}: {got!r} (want {want!r})")

    def exit_code(self) -> int:
        print("\nRESULT:", "ALL PASS" if self.ok else "SOME FAILED")
        return 0 if self.ok else 1
