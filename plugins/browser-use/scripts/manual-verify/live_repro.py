#!/usr/bin/env python3
"""
LIVE end-to-end gate for the browser-use fix (NOT a mocked test).

Drives the WORKTREE MagusBrowserServer handlers against real Chrome via CDP,
reproducing the bug report's exact scenario: set a Monaco editor's text that
browser_type cannot reach. Proves the CDP params actually work on a page.

Run (see README.md in this directory for the full HTTP-server setup):
    python3 live_repro.py ../mcp-server.py "http://localhost:8799/monaco-page.html"
"""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path


def load_server_module(server_path: str):
    spec = importlib.util.spec_from_file_location("mcp_server_live", server_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mcp_server_live"] = mod
    spec.loader.exec_module(mod)
    return mod


async def main(server_path: str, page_url: str) -> int:
    mod = load_server_module(server_path)

    # Build the real server, then a real browser session (headless) via the
    # same APIs the server's _init_browser_session uses.
    server = mod.MagusBrowserServer.__new__(mod.MagusBrowserServer)
    # Minimal attrs the handlers touch:
    server.active_sessions = {}
    server.browser_session = None

    from browser_use.browser import BrowserProfile, BrowserSession

    profile = BrowserProfile(headless=True, keep_alive=True)
    session = BrowserSession(browser_profile=profile)
    await session.start()
    server.browser_session = session

    # Patch the activity tracker the handlers call (real one needs more state).
    server._update_session_activity = lambda *_a, **_k: None

    results = {}
    try:
        # Navigate via the server's OWN navigate tool (proven path).
        await mod.BrowserUseServer._execute_tool(server, "browser_navigate", {"url": page_url})
        for _ in range(60):
            r = await server._handle_evaluate(
                {"script": "return document.getElementById('status').textContent"}
            )
            if json.loads(r).get("result") == "ready":
                break
            await asyncio.sleep(0.5)
        else:
            print("FAIL: Monaco page never reached 'ready'")
            return 1

        # 1. browser_evaluate read of the original editor content.
        r = await server._handle_evaluate(
            {"script": "return window.__editor.getValue()"}
        )
        results["original"] = json.loads(r).get("result")

        # 2. THE FIX: set Monaco's value via browser_evaluate (the report's task).
        await server._handle_evaluate(
            {"script": "return window.__editor.setValue('NEW VIA EVALUATE')"}
        )
        r = await server._handle_evaluate(
            {"script": "return window.__editor.getValue()"}
        )
        results["after_setvalue"] = json.loads(r).get("result")

        # 3. browser_focus + keyboard on a plain input (clear + type).
        await server._handle_evaluate(
            {"script": "document.getElementById('plain').value = 'PRESET'; return true"}
        )
        await server._handle_focus({"selector": "#plain"})
        await server._handle_keyboard({"keys": ["Meta+a"], "text": "TYPED VIA KEYBOARD"})
        r = await server._handle_evaluate(
            {"script": "return document.getElementById('plain').value"}
        )
        results["plain_after_keyboard"] = json.loads(r).get("result")

        # 4. JS-exception surfacing (must not be silent).
        r = await server._handle_evaluate({"script": "return nope.does.not.exist"})
        results["exception_path"] = json.loads(r)

    finally:
        try:
            await session.stop()
        except Exception:
            pass

    # Assertions
    ok = True
    def check(name, got, want):
        nonlocal ok
        passed = got == want
        ok = ok and passed
        print(f"[{'PASS' if passed else 'FAIL'}] {name}: got={got!r} want={want!r}")

    check("original content read", results["original"], "ORIGINAL CONTENT")
    check("Monaco setValue via browser_evaluate", results["after_setvalue"], "NEW VIA EVALUATE")
    check("plain input cleared+typed via keyboard", results["plain_after_keyboard"], "TYPED VIA KEYBOARD")
    exc = results.get("exception_path", {})
    exc_ok = exc.get("error") == "JavaScript exception"
    ok = ok and exc_ok
    print(f"[{'PASS' if exc_ok else 'FAIL'}] JS exception surfaced: {exc!r}")

    print("\nRESULT:", "ALL PASS ✅" if ok else "SOME FAILED ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    server_path = sys.argv[1]
    # Default to the Monaco page next to this script. NOTE: Monaco loads from a
    # CDN, which a file:// origin can block — prefer serving over HTTP (see
    # README.md) and passing the http:// URL as argv[2].
    default_page = (Path(__file__).parent / "monaco-page.html").as_uri()
    page_url = sys.argv[2] if len(sys.argv) > 2 else default_page
    sys.exit(asyncio.run(main(server_path, page_url)))
