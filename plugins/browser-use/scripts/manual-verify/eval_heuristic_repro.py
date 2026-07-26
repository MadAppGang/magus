import asyncio, importlib.util, json, sys, urllib.parse
def load(p):
    spec = importlib.util.spec_from_file_location("m", p); mod = importlib.util.module_from_spec(spec)
    sys.modules["m"]=mod; spec.loader.exec_module(mod); return mod
async def main(sp):
    mod = load(sp)
    server = mod.MagusBrowserServer.__new__(mod.MagusBrowserServer)
    server.active_sessions={}; server.browser_session=None
    from browser_use.browser import BrowserProfile, BrowserSession
    session = BrowserSession(browser_profile=BrowserProfile(headless=True, keep_alive=True))
    await session.start(); server.browser_session=session
    server._update_session_activity=lambda *a,**k:None
    data_url="data:text/html,"+urllib.parse.quote("<input id=p value=orig><button class=return-btn>x</button>")
    async def ev(s): return await server._handle_evaluate({"script":s})
    try:
        await mod.BrowserUseServer._execute_tool(server,"browser_navigate",{"url":data_url})
        for _ in range(20):
            if json.loads(await ev("return document.getElementById('p')?true:false"))["result"]: break
            await asyncio.sleep(0.3)
        print("=== Advisor bug #1: substring 'return' in IIFE heuristic ===")
        print("  '\"returned\"'      ->", await ev('"returned"'))
        print("  querySelector .return-btn ->", await ev('document.querySelector(".return-btn") ? "found" : "null"'))
        print("  plain expr 1+1     ->", await ev("1+1"))
        print("  return 1+1         ->", await ev("return 1+1"))
        print()
        print("=== Advisor bug #2: copy/cut/paste/undo/redo via commands ===")
        # cut: select all + cut should empty the field
        await ev("var p=document.getElementById('p');p.value='CUTME';p.focus();return true")
        await server._handle_press_key({"key":"Meta+a"})
        await server._handle_press_key({"key":"Meta+x"})
        print("  Meta+a, Meta+x (cut) -> field:", json.loads(await ev("return document.getElementById('p').value"))["result"], "(expect '' if cut works)")
        # paste: try pasting after cut
        await server._handle_press_key({"key":"Meta+v"})
        print("  Meta+v (paste)       -> field:", json.loads(await ev("return document.getElementById('p').value"))["result"], "(expect 'CUTME' if paste works)")
        # undo
        await ev("var p=document.getElementById('p');p.value='';p.focus();return true")
        await server._handle_keyboard({"text":"typed"})
        await server._handle_press_key({"key":"Meta+z"})
        print("  type 'typed', Meta+z (undo) -> field:", json.loads(await ev("return document.getElementById('p').value"))["result"], "(expect '' or partial if undo works)")
    finally:
        await session.stop()
asyncio.run(main(sys.argv[1]))
