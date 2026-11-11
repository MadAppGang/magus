#!/usr/bin/env python3
"""
Live check of browser_evaluate, browser_press_key, browser_keyboard and
browser_focus against real Chromium, through the shipped server over MCP stdio.

The unit suite records CDP calls; it cannot prove that Chrome acts on them. A
live run is what found that a synthetic Meta+A selects nothing unless the
keyDown carries `commands: ["selectAll"]`. No network: the page is a data: URL.

    python3 keyboard_repro.py
"""

import asyncio
import sys
import urllib.parse

from stdio_server import Checks, server_session

PAGE = (
    "<input id=p><button class=return-btn>x</button><div id=log></div>"
    "<script>document.getElementById('p').addEventListener('keydown', e => {"
    " if (e.key === 'Enter' || e.key === 'Escape')"
    " document.getElementById('log').textContent += e.key + ' '; });</script>"
)
FIELD = "return document.getElementById('p').value"


async def main() -> int:
    checks = Checks()
    async with server_session() as tools:
        await tools.call("browser_navigate", {"url": "data:text/html," + urllib.parse.quote(PAGE)})

        # browser_evaluate decides between an expression and a statement body.
        # The word "return" inside a string or a selector must not make it a body.
        checks.check("string containing 'return'", await tools.evaluate('"returned"'), "returned")
        checks.check(
            "selector containing 'return'",
            await tools.evaluate('document.querySelector(".return-btn") ? "found" : "null"'),
            "found",
        )
        checks.check("plain expression", await tools.evaluate("1+1"), 2)
        checks.check("statement body with return", await tools.evaluate("return 1+1"), 2)
        thrown = await tools.evaluate("return nope.does.not.exist")
        checks.check("JS exception is reported", thrown.get("error"), "JavaScript exception")

        await tools.evaluate("var p=document.getElementById('p'); p.value='abc'; p.focus(); return true")
        await tools.call("browser_press_key", {"key": "Backspace"})
        checks.check("Backspace deletes the last character", await tools.evaluate(FIELD), "ab")

        await tools.evaluate(
            "var p=document.getElementById('p'); p.value='hello'; p.focus(); p.setSelectionRange(5,5); return true"
        )
        await tools.call("browser_press_key", {"key": "ArrowLeft", "count": 2})
        checks.check(
            "ArrowLeft x2 moves the caret",
            await tools.evaluate("return document.getElementById('p').selectionStart"),
            3,
        )

        await tools.call("browser_focus", {"selector": "#p"})
        await tools.call("browser_press_key", {"key": "Enter"})
        await tools.call("browser_press_key", {"key": "Escape"})
        checks.check(
            "Enter and Escape reach keydown",
            (await tools.evaluate("return document.getElementById('log').textContent")).strip(),
            "Enter Escape",
        )

        await tools.evaluate("var p=document.getElementById('p'); p.value='REPLACE ME'; p.focus(); return true")
        await tools.call("browser_keyboard", {"keys": ["Meta+a", "Delete"]})
        checks.check("Meta+a then Delete clears the field", await tools.evaluate(FIELD), "")

        await tools.evaluate("var p=document.getElementById('p'); p.value='CUTME'; p.focus(); return true")
        await tools.call("browser_keyboard", {"keys": ["Meta+a", "Meta+x"]})
        checks.check("Meta+a then Meta+x cuts the text", await tools.evaluate(FIELD), "")

        await tools.call("browser_keyboard", {"text": "typed"})
        checks.check("browser_keyboard text inserts literally", await tools.evaluate(FIELD), "typed")
        await tools.call("browser_press_key", {"key": "Meta+z"})
        checks.check("Meta+z undoes the insert", await tools.evaluate(FIELD), "")
    return checks.exit_code()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
