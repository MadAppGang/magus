#!/usr/bin/env python3
"""
Live check that browser_evaluate, browser_focus and browser_keyboard reach a
Monaco editor, which exposes no input that browser_type can index. Drives the
shipped server over MCP stdio against real Chromium.

Serves monaco-page.html from this directory on 127.0.0.1 itself; the page loads
Monaco from cdnjs, so this check needs network access. Pass a URL to test
another page with the same ids (#status, #plain, window.__editor).

    python3 live_repro.py [page-url]
"""

import asyncio
import functools
import http.server
import sys
import threading
from pathlib import Path

from stdio_server import Checks, server_session


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


def _serve_here() -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(_QuietHandler, directory=str(Path(__file__).parent))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/monaco-page.html"


async def main(page_url: str) -> int:
    checks = Checks()
    async with server_session() as tools:
        await tools.call("browser_navigate", {"url": page_url})
        for _ in range(60):
            if await tools.evaluate("return document.getElementById('status').textContent") == "ready":
                break
            await asyncio.sleep(0.5)
        else:
            print("[FAIL] the Monaco page never reached 'ready' (is cdnjs reachable?)")
            return 1

        checks.check("read the editor", await tools.evaluate("return window.__editor.getValue()"), "ORIGINAL CONTENT")
        await tools.evaluate("return window.__editor.setValue('NEW VIA EVALUATE')")
        checks.check(
            "setValue via browser_evaluate",
            await tools.evaluate("return window.__editor.getValue()"),
            "NEW VIA EVALUATE",
        )

        await tools.evaluate("document.getElementById('plain').value = 'PRESET'; return true")
        await tools.call("browser_focus", {"selector": "#plain"})
        await tools.call("browser_keyboard", {"keys": ["Meta+a"], "text": "TYPED VIA KEYBOARD"})
        checks.check(
            "focus, select all and type over a plain input",
            await tools.evaluate("return document.getElementById('plain').value"),
            "TYPED VIA KEYBOARD",
        )

        await tools.call("browser_focus", {"selector": "textarea.inputarea"})
        await tools.call("browser_keyboard", {"keys": ["Meta+a"], "text": "TYPED INTO MONACO"})
        checks.check(
            "focus Monaco's hidden textarea and type",
            await tools.evaluate("return window.__editor.getValue()"),
            "TYPED INTO MONACO",
        )
    return checks.exit_code()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(asyncio.run(main(sys.argv[1])))
    server, url = _serve_here()
    try:
        sys.exit(asyncio.run(main(url)))
    finally:
        server.shutdown()
