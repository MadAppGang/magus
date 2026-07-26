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
    page="<input id=p><div id=log></div><script>document.getElementById('p').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape')document.getElementById('log').textContent+=e.key+' ';});</script>"
    data_url="data:text/html,"+urllib.parse.quote(page)
    async def ev(s): return json.loads(await server._handle_evaluate({"script":s}))["result"]
    ok=True
    def chk(n,g,w):
        nonlocal ok; p=g==w; ok=ok and p; print(f"[{'PASS' if p else 'FAIL'}] {n}: {g!r} (want {w!r})")
    try:
        await mod.BrowserUseServer._execute_tool(server,"browser_navigate",{"url":data_url})
        for _ in range(20):
            if await ev("return document.getElementById('p')?true:false"): break
            await asyncio.sleep(0.3)
        # Backspace
        await ev("var p=document.getElementById('p');p.value='abc';p.focus();return true")
        await server._handle_press_key({"key":"Backspace"})
        chk("Backspace deletes last char", await ev("return document.getElementById('p').value"), "ab")
        # arrows + count
        await ev("var p=document.getElementById('p');p.value='hello';p.setSelectionRange(5,5);p.focus();return true")
        await server._handle_press_key({"key":"ArrowLeft","count":2})
        chk("ArrowLeft x2 moves caret", await ev("return document.getElementById('p').selectionStart"), 3)
        # Enter + Escape land as keydown
        await ev("document.getElementById('p').focus();return true")
        await server._handle_press_key({"key":"Enter"})
        await server._handle_press_key({"key":"Escape"})
        chk("Enter/Escape dispatch", (await ev("return document.getElementById('log').textContent")).strip(), "Enter Escape")
        # keyboard: select-all + delete clears
        await ev("var p=document.getElementById('p');p.value='REPLACE ME';p.focus();return true")
        await server._handle_keyboard({"keys":["Meta+a","Delete"]})
        chk("Meta+a then Delete clears", await ev("return document.getElementById('p').value"), "")
        print("\nRESULT:", "ALL PASS ✅" if ok else "SOME FAILED ❌")
    finally:
        await session.stop()
    sys.exit(0 if ok else 1)
asyncio.run(main(sys.argv[1]))
