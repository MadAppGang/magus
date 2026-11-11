"""
Unit tests for mcp-server.py, the browser-use MCP server on browser-use 1.0.

The server is loaded against the browser_use package that is actually
installed; nothing is stubbed at import. No test here launches a browser,
starts a browser-harness daemon, or reaches a model or a paid service:

  - every CDP command goes through a recording fake of the server's daemon
    channel (`_cdp` / `_meta`), patched per test;
  - a Browser that a tool would start is a fake, or a real browser_use.Browser
    whose start and stop are patched;
  - browser_use.Agent and every model call are replaced;
  - the whole module runs under a temp HOME and a short BH_HOME with every
    API-key variable cleared, so neither the developer's ~/.claude/settings.json
    nor ~/.config/browseruse can reach a test.

Real Chromium is exercised by the e2e job, not here.

Run under CI with CI=true: a test that would otherwise skip because browser_use
or uv is absent fails instead.
"""

import asyncio
import base64
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil as _shutil
import signal
import subprocess
import sys
import tempfile as _tempfile
import textwrap
import time
import tomllib
import types as _pytypes
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

_SERVER_FILE = Path(__file__).parent / "mcp-server.py"

# The server module under test, loaded once in setUpModule.
_mod = None
_module_env = None
_module_dirs: list = []


def _load_server_module():
    """Load mcp-server.py against the installed browser_use, or explain why not."""
    if importlib.util.find_spec("browser_use") is None:
        if os.environ.get("CI"):
            raise RuntimeError("browser_use must be installed under CI")
        raise unittest.SkipTest("browser_use is not installed")
    spec = importlib.util.spec_from_file_location("_mcp_server_under_test", _SERVER_FILE)
    mod = importlib.util.module_from_spec(spec)
    saved_argv = sys.argv
    sys.argv = ["mcp-server.py"]
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            spec.loader.exec_module(mod)
    except SystemExit as exc:
        raise RuntimeError(
            f"mcp-server.py exited at import (code {exc.code}): {err.getvalue().strip()}"
        ) from None
    finally:
        sys.argv = saved_argv
    return mod


def setUpModule():
    global _mod, _module_env
    _module_env = patch.dict(os.environ, {})
    _module_env.start()
    for key in _REAL_ENV_SCRUB:
        os.environ.pop(key, None)
    home = Path(_tempfile.mkdtemp(prefix="magus-bu-home-")).resolve()
    # The harness daemon socket path is capped near 104 bytes on macOS.
    bh_home = Path(_tempfile.mkdtemp(prefix="bh", dir="/tmp"))
    _module_dirs.extend([home, bh_home])
    os.environ["HOME"] = str(home)
    os.environ["BH_HOME"] = str(bh_home)
    _mod = _load_server_module()


def tearDownModule():
    if _module_env is not None:
        _module_env.stop()
    for path in _module_dirs:
        _shutil.rmtree(path, ignore_errors=True)
    _module_dirs.clear()


def _make_server():
    """A MagusBrowserServer with no session. Constructing one starts nothing."""
    return _mod.MagusBrowserServer()


# ---------------------------------------------------------------------------
# Fakes: the daemon channel, Browser, AxHelpers
# ---------------------------------------------------------------------------

class _FakeDaemon:
    """
    Answers the server's daemon channel from a table and records every call.

    An answer is a dict, a callable taking the call's params, or an exception
    to raise. Runtime.evaluate answers "complete" unless a test says otherwise,
    which is what the server's document.readyState poll waits for.
    """

    def __init__(self):
        self.calls: list = []  # (daemon name, method, session_id, params)
        self.meta_calls: list = []  # (daemon name, meta, fields)
        self.answers: dict = {
            "Runtime.evaluate": {"result": {"value": "complete"}},
            "Target.attachToBrowserTarget": {"sessionId": "browser-target-session"},
        }
        self.meta_answers: dict = {
            "current_tab": {"targetId": "TARGETAAAA", "url": "https://example.com/", "title": "Example"},
            "set_session": {"ok": True},
        }

    # Positional-only like the server's own _cdp: CDP params may be called `name`.
    def cdp(self, name, method, session_id=None, /, **params):
        self.calls.append((name, method, session_id, params))
        answer = self.answers.get(method, {})
        if callable(answer):
            answer = answer(params)
        if isinstance(answer, BaseException):
            raise answer
        return answer

    def meta(self, name, meta, /, **fields):
        self.meta_calls.append((name, meta, fields))
        answer = self.meta_answers.get(meta, {})
        return answer(fields) if callable(answer) else answer

    def methods(self) -> list:
        return [call[1] for call in self.calls]

    def params_of(self, method: str) -> list:
        return [call[3] for call in self.calls if call[1] == method]

    def evaluate(self, by_expression: dict, default="complete"):
        """Answer Runtime.evaluate by its expression."""
        def answer(params):
            return {"result": {"value": by_expression.get(params.get("expression"), default)}}
        self.answers["Runtime.evaluate"] = answer

    @contextlib.contextmanager
    def installed(self):
        with patch.object(_mod, "_cdp", self.cdp), patch.object(_mod, "_meta", self.meta):
            yield self


class _FakeBrowser:
    """Stands in for browser_use.Browser: records its options, starts nothing."""

    created: list = []
    start_error: BaseException | None = None

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.name = None
        self.started = False
        self.stopped = False
        self.stop_error: BaseException | None = None
        self.live_url = "https://live.browser-use.example/abc" if kwargs.get("use_cloud") else None
        self.cloud_cdp_url = "wss://cdp.browser-use.example/abc" if kwargs.get("use_cloud") else None
        _FakeBrowser.created.append(self)

    async def start(self):
        if _FakeBrowser.start_error is not None:
            raise _FakeBrowser.start_error
        self.started = True
        self.name = f"bufake{len(_FakeBrowser.created):04d}"
        return self

    async def stop(self):
        if self.stop_error is not None:
            raise self.stop_error
        self.stopped = True
        self.name = None


@contextlib.contextmanager
def _fake_browsers(options=None):
    """browser_use.Browser replaced by _FakeBrowser, with fixed local options."""
    import browser_use

    _FakeBrowser.created = []
    _FakeBrowser.start_error = None
    local = options or {"kind": "chromium", "executable_path": "/fake/chromium", "headless": True}
    with patch.object(browser_use, "Browser", _FakeBrowser), \
            patch.object(_mod, "_local_browser_options", lambda: dict(local)), \
            patch.object(_mod, "_browser_options", lambda: dict(local)):
        yield _FakeBrowser.created
    _FakeBrowser.start_error = None


class _FakeAx:
    """Stands in for browser_use.ax.AxHelpers: records clicks and typing."""

    def __init__(self, cdp=None):
        self.cdp = cdp
        self.clicks: list = []
        self.typed: list = []

    def click(self, element_id):
        self.clicks.append(element_id)

    def type(self, element_id, text):
        self.typed.append((element_id, text))


# A real 1x1 PNG: the signature, then an IHDR chunk carrying width=1, height=1.
_PNG_1x1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class _ToolTestCase(unittest.IsolatedAsyncioTestCase):
    """
    A server with one live primary session (daemon "budaemon01") on a fake
    daemon, and a fake AxHelpers. Tests call tools through _execute_tool, the
    same entry point the MCP call_tool handler uses.
    """

    def setUp(self):
        super().setUp()
        self.daemon = _FakeDaemon()
        self.enterContext(self.daemon.installed())
        self.enterContext(patch.object(_mod, "_LOAD_POLL_SECONDS", 0))
        self.ax = _FakeAx()
        self.ax_builds = 0

        def make_ax(cdp):
            self.ax_builds += 1
            self.ax.cdp = cdp
            return self.ax

        self.harness = _pytypes.SimpleNamespace(NAME="default")
        self.enterContext(patch.object(_mod, "_make_ax_helpers", make_ax))
        self.enterContext(patch.object(_mod, "_import_harness_helpers", lambda: self.harness))
        self.server = _make_server()
        self.browser = _FakeBrowser()
        self.browser.name = "budaemon01"
        self.session_id = self.server._register(self.browser, "local", url="https://example.com/")
        self.server._primary = self.session_id

    async def call(self, name, **arguments):
        return await self.server._execute_tool(name, arguments)


class TestHermeticEnvironment(unittest.TestCase):
    """The guard every other test leans on: no real home, no real keys."""

    def test_home_and_keys_are_isolated(self):
        self.assertTrue(
            any(os.environ["HOME"] == str(path) for path in _module_dirs),
            f"HOME is not this module's temp dir: {os.environ['HOME']}",
        )
        self.assertEqual(Path.home(), Path(os.environ["HOME"]))
        for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "BROWSER_USE_API_KEY", "XDG_CONFIG_HOME"):
            self.assertNotIn(key, os.environ)


class TestDaemonChannel(unittest.TestCase):
    """_cdp / _meta: the request each sends to the daemon, and their errors."""

    def setUp(self):
        self.requests: list = []
        self.reply: dict = {"result": {"ok": 1}}

        def fake_request(name, request, timeout=30.0):
            self.requests.append((name, request, timeout))
            return self.reply

        self.enterContext(patch.object(_mod, "_daemon_request", fake_request))

    def test_cdp_request_shape(self):
        self.assertEqual(_mod._cdp("bu1", "Page.navigate", None, url="https://a.test/"), {"ok": 1})
        self.assertEqual(self.requests, [(
            "bu1", {"method": "Page.navigate", "params": {"url": "https://a.test/"}, "session_id": None}, 30.0,
        )])

    def test_a_param_called_name_is_a_cdp_param(self):
        _mod._cdp("bu1", "Network.setCookie", None, name="sid", value="1")
        self.assertEqual(self.requests[0][1]["params"], {"name": "sid", "value": "1"})

    def test_response_timeout_is_not_sent_to_chrome(self):
        _mod._cdp("bu1", "Page.handleJavaScriptDialog", "s1", accept=True, _response_timeout=5)
        name, request, timeout = self.requests[0]
        self.assertEqual(request["params"], {"accept": True})
        self.assertEqual(request["session_id"], "s1")
        self.assertEqual(timeout, 5.0)

    def test_cdp_error(self):
        self.reply = {"error": "{'code': -32000, 'message': 'No node'}"}
        with self.assertRaises(RuntimeError) as cm:
            _mod._cdp("bu1", "DOM.resolveNode", None, backendNodeId=1)
        self.assertEqual(str(cm.exception), "DOM.resolveNode failed: {'code': -32000, 'message': 'No node'}")

    def test_meta_request_and_error(self):
        self.reply = {"targetId": "T1"}
        self.assertEqual(_mod._meta("bu1", "current_tab"), {"targetId": "T1"})
        self.assertEqual(self.requests[-1][1], {"meta": "current_tab"})
        self.reply = {"error": "no tab"}
        with self.assertRaises(RuntimeError):
            _mod._meta("bu1", "set_session", session_id="s", target_id="t")
        self.assertEqual(self.requests[-1][1], {"meta": "set_session", "session_id": "s", "target_id": "t"})

    def test_ax_helpers_get_the_daemon_error_text_alone(self):
        server = _make_server()
        server._ax_name = "bu1"
        self.reply = {"error": "{'code': -32000, 'message': 'No node'}"}
        with self.assertRaises(RuntimeError) as cm:
            server._ax_cdp("DOM.resolveNode", None, backendNodeId=1)
        self.assertEqual(str(cm.exception), "{'code': -32000, 'message': 'No node'}")
        self.assertEqual(self.requests[0][0], "bu1")


# ---------------------------------------------------------------------------
# The MCP surface: tool list and call_tool error handling
# ---------------------------------------------------------------------------

class TestToolList(unittest.IsolatedAsyncioTestCase):
    """The full contract is frozen in test_mcp_protocol.py; this checks the shape."""

    async def test_lists_27_unique_tools_with_object_schemas(self):
        result = await _make_server()._handle_list_tools(None, None)
        names = [tool.name for tool in result.tools]
        self.assertEqual(len(names), 27)
        self.assertEqual(len(set(names)), 27)
        for tool in result.tools:
            self.assertEqual(tool.input_schema.get("type"), "object", tool.name)

    async def test_custom_tools_are_listed(self):
        names = {tool.name for tool in (await _make_server()._handle_list_tools(None, None)).tools}
        for custom in (
            "browser_export_session", "browser_import_session", "browser_run_script",
            "browser_evaluate", "browser_press_key", "browser_keyboard", "browser_focus",
            "browser_save_screenshot", "browser_doctor", "browser_start_cloud_session",
            "browser_set_agent_model",
        ):
            self.assertIn(custom, names)

    async def test_read_only_tools_are_annotated(self):
        tools = {tool.name: tool for tool in (await _make_server()._handle_list_tools(None, None)).tools}
        for name in ("browser_get_state", "browser_get_html", "browser_screenshot",
                     "browser_list_tabs", "browser_list_sessions"):
            self.assertTrue(tools[name].annotations and tools[name].annotations.read_only_hint, name)
        self.assertIsNone(tools["browser_navigate"].annotations)


class TestCallToolErrors(_ToolTestCase):
    async def test_unknown_tool_raises_in_execute(self):
        with self.assertRaises(ValueError) as cm:
            await self.server._execute_tool("browser_nope", {})
        self.assertIn("Unknown tool: browser_nope", str(cm.exception))

    async def test_unknown_tool_is_an_error_result(self):
        import mcp.types as mcp_types

        result = await self.server._handle_call_tool(
            None, mcp_types.CallToolRequestParams(name="browser_nope", arguments={})
        )
        self.assertTrue(result.is_error)
        self.assertEqual(result.content[0].text, "Error: Unknown tool: browser_nope")

    async def test_a_cdp_failure_is_an_error_result_not_a_crash(self):
        import mcp.types as mcp_types

        self.daemon.answers["Runtime.evaluate"] = RuntimeError("Runtime.evaluate failed: boom")
        result = await self.server._handle_call_tool(
            None, mcp_types.CallToolRequestParams(name="browser_get_html", arguments={})
        )
        self.assertTrue(result.is_error)
        self.assertIn("boom", result.content[0].text)

    async def test_string_results_become_text_content(self):
        import mcp.types as mcp_types

        self.daemon.evaluate({"document.documentElement.outerHTML": "<html></html>"})
        result = await self.server._handle_call_tool(
            None, mcp_types.CallToolRequestParams(name="browser_get_html", arguments={})
        )
        self.assertFalse(result.is_error)
        self.assertEqual(result.content[0].text, "<html></html>")


# ---------------------------------------------------------------------------
# The primary session: started on demand, downloads redirected
# ---------------------------------------------------------------------------

class TestPrimarySessionStart(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.daemon = _FakeDaemon()
        self.enterContext(self.daemon.installed())
        self.daemon.evaluate({"document.documentElement.outerHTML": "<html></html>"})

    async def test_page_tool_starts_one_local_browser_and_reuses_it(self):
        with _fake_browsers() as created:
            server = _make_server()
            await server._execute_tool("browser_get_html", {})
            await server._execute_tool("browser_get_html", {})
        self.assertEqual(len(created), 1)
        self.assertEqual(
            created[0].kwargs,
            {"kind": "chromium", "executable_path": "/fake/chromium", "headless": True},
        )
        self.assertTrue(created[0].started)
        self.assertEqual(server._sessions[server._primary].kind, "local")

    async def test_local_start_sends_downloads_to_the_config_dir(self):
        with _fake_browsers():
            server = _make_server()
            await server._execute_tool("browser_get_html", {})
        params = self.daemon.params_of("Browser.setDownloadBehavior")
        self.assertEqual(len(params), 1)
        self.assertEqual(params[0]["downloadPath"], str(Path.home() / ".config" / "browseruse" / "downloads"))
        self.assertTrue((Path.home() / ".config" / "browseruse" / "downloads").is_dir())

    async def test_cloud_start_sets_no_downloads(self):
        with _fake_browsers(), patch.object(_mod, "_browser_options", lambda: {"use_cloud": True}):
            server = _make_server()
            await server._execute_tool("browser_get_html", {})
        self.assertEqual(server._sessions[server._primary].kind, "cloud")
        self.assertNotIn("Browser.setDownloadBehavior", self.daemon.methods())

    async def test_custom_tools_never_start_a_browser(self):
        with _fake_browsers() as created:
            server = _make_server()
            for name, args in (
                ("browser_evaluate", {"script": "1"}),
                ("browser_focus", {"selector": "input"}),
                ("browser_press_key", {"key": "Enter"}),
                ("browser_keyboard", {"text": "x"}),
                ("browser_save_screenshot", {"output_path": "/tmp/never-written.png"}),
            ):
                with self.subTest(name):
                    text = await server._execute_tool(name, args)
                    self.assertEqual(text, "Error: No browser session active. Navigate first (browser_navigate).")
        self.assertEqual(created, [])

    async def test_session_tools_never_start_a_browser(self):
        with _fake_browsers() as created:
            server = _make_server()
            self.assertEqual(await server._execute_tool("browser_list_sessions", {}), "No active browser sessions")
            self.assertEqual(await server._execute_tool("browser_close_all", {}), "No active sessions to close")
        self.assertEqual(created, [])

    async def test_a_failed_start_is_an_error_result(self):
        import mcp.types as mcp_types

        with _fake_browsers():
            _FakeBrowser.start_error = RuntimeError("chromium would not launch")
            server = _make_server()
            result = await server._handle_call_tool(
                None, mcp_types.CallToolRequestParams(name="browser_navigate", arguments={"url": "https://a.test/"})
            )
        self.assertTrue(result.is_error)
        self.assertIn("chromium would not launch", result.content[0].text)
        self.assertIsNone(server._primary)


# ---------------------------------------------------------------------------
# Page tools
# ---------------------------------------------------------------------------

class TestNavigateTool(_ToolTestCase):
    async def test_navigates_the_attached_tab_and_waits_for_load(self):
        text = await self.call("browser_navigate", url="https://a.test/")
        self.assertEqual(text, "Navigated to: https://a.test/")
        self.assertEqual(self.daemon.params_of("Page.navigate"), [{"url": "https://a.test/"}])
        navigate = self.daemon.methods().index("Page.navigate")
        self.assertIn("Runtime.evaluate", self.daemon.methods()[navigate:])
        self.assertEqual(self.daemon.calls[navigate][0], "budaemon01")
        self.assertIsNone(self.daemon.calls[navigate][2])
        self.assertEqual(self.server._sessions[self.session_id].url, "https://a.test/")

    async def test_waits_until_the_document_is_complete(self):
        states = iter(["loading", "interactive", "complete"])
        self.daemon.answers["Runtime.evaluate"] = lambda params: {"result": {"value": next(states)}}
        await self.call("browser_navigate", url="https://a.test/")
        self.assertEqual(self.daemon.methods().count("Runtime.evaluate"), 3)

    async def test_a_load_timeout_is_reported(self):
        self.daemon.answers["Runtime.evaluate"] = {"result": {"value": "loading"}}
        with patch.object(_mod, "_LOAD_TIMEOUT_SECONDS", 0.05):
            text = await self.call("browser_navigate", url="https://slow.test/")
        self.assertTrue(text.startswith("Navigated to: https://slow.test/"), text)
        self.assertIn("still loading", text)

    async def test_a_new_tab_load_timeout_is_reported(self):
        self.daemon.answers["Runtime.evaluate"] = {"result": {"value": "loading"}}
        self.daemon.answers["Target.createTarget"] = {"targetId": "NEWTAB0003"}
        self.daemon.answers["Target.attachToTarget"] = {"sessionId": "s3"}
        with patch.object(_mod, "_LOAD_TIMEOUT_SECONDS", 0.05):
            text = await self.call("browser_navigate", url="https://slow.test/", new_tab=True)
        self.assertTrue(text.startswith("Opened new tab with URL: https://slow.test/"), text)
        self.assertIn("still loading", text)

    async def test_waits_for_the_new_document_before_reading_ready_state(self):
        """The old document still reads 'complete' right after Page.navigate."""
        self.daemon.answers["Page.navigate"] = {"frameId": "MAIN", "loaderId": "NEWLOADER"}
        loaders = iter(["OLDLOADER", "OLDLOADER", "NEWLOADER"])
        self.daemon.answers["Page.getFrameTree"] = lambda params: {
            "frameTree": {"frame": {"id": "MAIN", "loaderId": next(loaders, "NEWLOADER")}}
        }
        text = await self.call("browser_navigate", url="https://a.test/")
        self.assertEqual(text, "Navigated to: https://a.test/")
        methods = self.daemon.methods()
        after = methods[methods.index("Page.navigate") + 1:]
        self.assertIn("Runtime.evaluate", after)
        self.assertEqual(
            after[:after.index("Runtime.evaluate")].count("Page.getFrameTree"), 3,
            f"readyState was read before the new document committed: {after}",
        )

    async def test_navigation_error_is_reported(self):
        self.daemon.answers["Page.navigate"] = {"errorText": "net::ERR_NAME_NOT_RESOLVED"}
        text = await self.call("browser_navigate", url="https://nowhere.invalid/")
        self.assertTrue(text.startswith("Error"), text)
        self.assertIn("ERR_NAME_NOT_RESOLVED", text)

    async def test_new_tab_creates_attaches_then_navigates(self):
        self.daemon.answers["Target.createTarget"] = {"targetId": "NEWTAB0001"}
        self.daemon.answers["Target.attachToTarget"] = {"sessionId": "new-tab-session"}
        text = await self.call("browser_navigate", url="https://b.test/", new_tab=True)
        self.assertEqual(text, "Opened new tab with URL: https://b.test/")
        methods = self.daemon.methods()
        self.assertLess(methods.index("Target.createTarget"), methods.index("Target.attachToTarget"))
        self.assertLess(methods.index("Target.attachToTarget"), methods.index("Page.navigate"))
        self.assertEqual(self.daemon.params_of("Target.createTarget"), [{"url": "about:blank", "background": True}])
        self.assertEqual(
            self.daemon.params_of("Target.attachToTarget"), [{"targetId": "NEWTAB0001", "flatten": True}]
        )
        self.assertIn(
            ("budaemon01", "set_session", {"session_id": "new-tab-session", "target_id": "NEWTAB0001"}),
            self.daemon.meta_calls,
        )

    async def test_url_is_required(self):
        self.assertEqual(await self.call("browser_navigate"), "Error: url is required.")
        self.assertNotIn("Page.navigate", self.daemon.methods())


class TestClickTool(_ToolTestCase):
    async def test_click_by_index_goes_through_ax_helpers(self):
        text = await self.call("browser_click", index=42)
        self.assertEqual(text, "Clicked element 42")
        self.assertEqual(self.ax.clicks, [42])
        self.assertEqual(self.harness.NAME, "budaemon01")

    async def test_ax_helpers_follow_the_primary_session(self):
        await self.call("browser_click", index=1)
        other = _FakeBrowser()
        other.name = "budaemon02"
        self.server._primary = self.server._register(other, "local")
        await self.call("browser_click", index=2)
        self.assertEqual(self.ax_builds, 1, "one AxHelpers serves every session")
        self.assertEqual(self.harness.NAME, "budaemon02")
        self.ax.cdp("DOM.getDocument")
        self.assertEqual(self.daemon.calls[-1][0], "budaemon02")

    async def test_click_at_coordinates_presses_and_releases(self):
        text = await self.call("browser_click", coordinate_x=10, coordinate_y=20)
        self.assertEqual(text, "Clicked at coordinates (10, 20)")
        events = self.daemon.params_of("Input.dispatchMouseEvent")
        self.assertEqual([e["type"] for e in events], ["mousePressed", "mouseReleased"])
        for event in events:
            self.assertEqual((event["x"], event["y"], event["button"], event["clickCount"]), (10, 20, "left", 1))
        self.assertEqual(self.ax.clicks, [])

    async def test_click_needs_index_or_both_coordinates(self):
        for args in ({}, {"coordinate_x": 5}):
            with self.subTest(args):
                text = await self.call("browser_click", **args)
                self.assertEqual(text, "Error: Provide either index or both coordinate_x and coordinate_y")
        self.assertEqual(self.ax.clicks, [])

    async def test_new_tab_on_a_link_opens_its_href(self):
        self.daemon.answers["DOM.resolveNode"] = {"object": {"objectId": "obj-1"}}
        self.daemon.answers["Runtime.callFunctionOn"] = {"result": {"value": "https://example.com/next/page"}}
        self.daemon.answers["Target.createTarget"] = {"targetId": "NEWTAB0002"}
        self.daemon.answers["Target.attachToTarget"] = {"sessionId": "s2"}
        text = await self.call("browser_click", index=7, new_tab=True)
        self.assertEqual(text, "Clicked element 7 and opened in new tab https://example.com/...")
        self.assertEqual(self.daemon.params_of("DOM.resolveNode"), [{"backendNodeId": 7}])
        self.assertEqual(self.daemon.params_of("Page.navigate"), [{"url": "https://example.com/next/page"}])
        self.assertIn("Runtime.releaseObject", self.daemon.methods())
        self.assertEqual(self.ax.clicks, [])

    async def test_new_tab_on_a_non_link_just_clicks(self):
        self.daemon.answers["DOM.resolveNode"] = {"object": {"objectId": "obj-1"}}
        self.daemon.answers["Runtime.callFunctionOn"] = {"result": {"value": None}}
        text = await self.call("browser_click", index=7, new_tab=True)
        self.assertEqual(text, "Clicked element 7 (new tab not supported for non-link elements)")
        self.assertEqual(self.ax.clicks, [7])

    async def test_new_tab_on_a_missing_element(self):
        self.daemon.answers["DOM.resolveNode"] = {}
        text = await self.call("browser_click", index=99, new_tab=True)
        self.assertEqual(text, "Element with index 99 not found")


class TestTypeTool(_ToolTestCase):
    async def test_types_through_ax_helpers(self):
        text = await self.call("browser_type", index=5, text="hello")
        self.assertEqual(text, "Typed 'hello' into element 5")
        self.assertEqual(self.ax.typed, [(5, "hello")])

    async def test_empty_text_clears(self):
        text = await self.call("browser_type", index=5, text="")
        self.assertEqual(text, "Typed '' into element 5")
        self.assertEqual(self.ax.typed, [(5, "")])

    async def test_an_email_is_masked_in_the_result(self):
        text = await self.call("browser_type", index=5, text="person@example.com")
        self.assertEqual(text, "Typed <email> into element 5")
        self.assertEqual(self.ax.typed, [(5, "person@example.com")])

    async def test_a_credential_is_masked_in_the_result(self):
        secret = "sk_live_abc123def456ghi"
        text = await self.call("browser_type", index=5, text=secret)
        self.assertEqual(text, "Typed <credential> into element 5")
        self.assertNotIn(secret, text)

    async def test_index_and_text_are_required(self):
        self.assertEqual(await self.call("browser_type", index=5), "Error: index and text are required.")
        self.assertEqual(self.ax.typed, [])


class TestGetStateTool(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.daemon.evaluate({_mod._PAGE_INFO_JS: {
            "url": "https://a.test/form", "title": "Form", "w": 800, "h": 600,
            "sx": 0, "sy": 120, "pw": 800, "ph": 2400,
        }})
        self.daemon.answers["Target.getTargets"] = {"targetInfos": [
            {"targetId": "TARGETAAAA", "type": "page", "url": "https://a.test/form", "title": "Form"},
            {"targetId": "TARGETBBBB", "type": "page", "url": "https://b.test/", "title": "B"},
            {"targetId": "WORKER0001", "type": "service_worker", "url": "https://a.test/sw.js", "title": ""},
        ]}
        self.daemon.answers["Accessibility.getFullAXTree"] = {"nodes": [
            {"nodeId": "1", "ignored": False, "role": {"value": "RootWebArea"}, "backendDOMNodeId": 1},
            {"nodeId": "2", "ignored": False, "role": {"value": "button"}, "name": {"value": "Go"},
             "backendDOMNodeId": 11},
            {"nodeId": "3", "ignored": True, "role": {"value": "button"}, "backendDOMNodeId": 12},
            {"nodeId": "4", "ignored": False, "role": {"value": "link"}, "name": {"value": "Docs " + "x" * 200},
             "backendDOMNodeId": 13},
            {"nodeId": "5", "ignored": False, "role": {"value": "textbox"}, "name": {"value": ""},
             "backendDOMNodeId": 14},
            {"nodeId": "6", "ignored": False, "role": {"value": "StaticText"}, "name": {"value": "hi"},
             "backendDOMNodeId": 15},
            {"nodeId": "7", "ignored": False, "role": {"value": "button"}, "name": {"value": "no dom"}},
        ]}
        nodes = {
            11: {"nodeName": "BUTTON", "attributes": ["type", "submit"]},
            13: {"nodeName": "A", "attributes": ["href", "/docs", "class", "nav"]},
            14: {"nodeName": "INPUT", "attributes": ["placeholder", "Search"]},
        }
        self.daemon.answers["DOM.describeNode"] = lambda params: {"node": nodes[params["backendNodeId"]]}

    async def test_reports_page_facts_and_controls(self):
        content = await self.call("browser_get_state")
        self.assertEqual(len(content), 1)
        state = json.loads(content[0].text)
        self.assertEqual(state["url"], "https://a.test/form")
        self.assertEqual(state["title"], "Form")
        self.assertEqual(state["tabs"], [
            {"url": "https://a.test/form", "title": "Form"}, {"url": "https://b.test/", "title": "B"},
        ])
        self.assertEqual(state["viewport"], {"width": 800, "height": 600})
        self.assertEqual(state["page"], {"width": 800, "height": 2400})
        self.assertEqual(state["scroll"], {"x": 0, "y": 120})
        self.assertNotIn("screenshot_dimensions", state)
        self.assertEqual(state["interactive_elements"], [
            {"index": 11, "tag": "button", "text": "Go"},
            {"index": 13, "tag": "a", "text": ("Docs " + "x" * 200)[:100], "href": "/docs"},
            {"index": 14, "tag": "input", "text": "", "placeholder": "Search"},
        ])
        self.assertEqual(self.server._sessions[self.session_id].url, "https://a.test/form")

    async def test_controls_in_child_frames_are_listed(self):
        main_tree = self.daemon.answers["Accessibility.getFullAXTree"]
        frame_trees = {
            "CHILD1": {"nodes": [
                {"nodeId": "1", "ignored": False, "role": {"value": "RootWebArea"}, "backendDOMNodeId": 30},
                {"nodeId": "2", "ignored": False, "role": {"value": "button"}, "name": {"value": "In frame"},
                 "backendDOMNodeId": 31},
            ]},
            "GRANDCHILD": {"nodes": [
                {"nodeId": "1", "ignored": False, "role": {"value": "textbox"}, "name": {"value": "Deep"},
                 "backendDOMNodeId": 41},
            ]},
            "CROSSSITE": RuntimeError("Accessibility.getFullAXTree failed: Frame with the given id was not found"),
        }
        self.daemon.answers["Accessibility.getFullAXTree"] = (
            lambda params: frame_trees[params["frameId"]] if "frameId" in params else main_tree
        )
        self.daemon.answers["Page.getFrameTree"] = {"frameTree": {
            "frame": {"id": "MAIN", "loaderId": "L1", "url": "https://a.test/form"},
            "childFrames": [
                {"frame": {"id": "CHILD1", "url": "about:srcdoc"},
                 "childFrames": [{"frame": {"id": "GRANDCHILD", "url": "about:srcdoc"}}]},
                {"frame": {"id": "CROSSSITE", "url": "https://other.test/"}},
            ],
        }}
        nodes = {
            11: {"nodeName": "BUTTON", "attributes": []},
            13: {"nodeName": "A", "attributes": ["href", "/docs"]},
            14: {"nodeName": "INPUT", "attributes": ["placeholder", "Search"]},
            31: {"nodeName": "BUTTON", "attributes": []},
            41: {"nodeName": "INPUT", "attributes": []},
        }
        self.daemon.answers["DOM.describeNode"] = lambda params: {"node": nodes[params["backendNodeId"]]}
        state = json.loads((await self.call("browser_get_state"))[0].text)
        self.assertEqual(
            [e["index"] for e in state["interactive_elements"]], [11, 13, 14, 31, 41],
            state["interactive_elements"],
        )
        self.assertEqual(state["interactive_elements"][3], {"index": 31, "tag": "button", "text": "In frame"})

    async def test_include_screenshot_adds_an_image(self):
        self.daemon.answers["Page.getLayoutMetrics"] = {
            "cssVisualViewport": {"pageX": 0, "pageY": 120, "clientWidth": 800, "clientHeight": 600},
        }
        self.daemon.answers["Page.captureScreenshot"] = {"data": _PNG_1x1}
        content = await self.call("browser_get_state", include_screenshot=True)
        self.assertEqual(len(content), 2)
        self.assertEqual(json.loads(content[0].text)["screenshot_dimensions"], {"width": 800, "height": 600})
        self.assertEqual(content[1].type, "image")
        self.assertEqual(content[1].mime_type, "image/png")
        self.assertEqual(content[1].data, _PNG_1x1)


class TestExtractContentTool(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.prompts: list = []
        self.daemon.answers["Runtime.evaluate"] = lambda params: {"result": {"value": {
            "url": "https://shop.test/item", "title": "Item", "text": "Price: 42 EUR",
            "links": [["Docs", "https://shop.test/docs"]],
        }}}

    def _model(self, reply="42 EUR", error=None):
        from pydantic_ai.messages import ModelResponse, TextPart
        from pydantic_ai.models.function import FunctionModel

        def respond(messages, info):
            self.prompts.append(repr(messages))
            if error is not None:
                raise error
            return ModelResponse(parts=[TextPart(reply)])

        model = FunctionModel(respond)
        return _pytypes.SimpleNamespace(pydantic_model=lambda: model, model_settings=lambda: {})

    async def test_without_a_key_it_says_which_one_and_calls_nothing(self):
        build = MagicMock()
        with patch.object(_mod, "_build_llm", build):
            text = await self.call("browser_extract_content", query="price?")
        self.assertIn("ANTHROPIC_API_KEY", text)
        self.assertIn("browser_set_agent_model", text)
        build.assert_not_called()
        self.assertNotIn("Runtime.evaluate", self.daemon.methods())

    async def test_answers_from_the_page_text(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch.object(_mod, "_build_llm", lambda choice: self._model()):
            text = await self.call("browser_extract_content", query="What is the price?")
        self.assertEqual(text, "42 EUR")
        self.assertEqual(len(self.prompts), 1)
        self.assertIn("Price: 42 EUR", self.prompts[0])
        self.assertIn("What is the price?", self.prompts[0])
        self.assertNotIn("https://shop.test/docs", self.prompts[0])

    async def test_extract_links_adds_the_links(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch.object(_mod, "_build_llm", lambda choice: self._model()):
            await self.call("browser_extract_content", query="links?", extract_links=True)
        self.assertIn("https://shop.test/docs", self.prompts[0])

    async def test_a_model_failure_is_reported(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch.object(_mod, "_build_llm", lambda choice: self._model(error=RuntimeError("rate limited"))):
            text = await self.call("browser_extract_content", query="q")
        self.assertTrue(text.startswith("Error: the agent model failed"), text)
        self.assertIn("rate limited", text)

    async def test_an_empty_answer(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch.object(_mod, "_build_llm", lambda choice: self._model(reply="  ")):
            self.assertEqual(await self.call("browser_extract_content", query="q"), "No content extracted")

    async def test_query_is_required(self):
        self.assertEqual(await self.call("browser_extract_content", query=" "), "Error: query is required.")

    async def test_with_no_session_it_starts_no_browser(self):
        build = MagicMock(side_effect=lambda choice: self._model())
        with _fake_browsers() as created, patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch.object(_mod, "_build_llm", build):
            server = _make_server()
            text = await server._execute_tool("browser_extract_content", {"query": "price?"})
        self.assertEqual(text, _mod._NO_SESSION)
        self.assertEqual(created, [])
        self.assertEqual(self.prompts, [])


def _js_brackets_balanced(expression: str) -> bool:
    """
    Whether every (, [ and { in a JavaScript expression closes in order,
    outside string literals. A fake Runtime.evaluate uses it to answer an
    unbalanced expression the way Chrome does, with a SyntaxError, instead of
    pretending the script ran.
    """
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list = []
    quote = None
    escaped = False
    for ch in expression:
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in "'\"`":
            quote = ch
        elif ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack and quote is None


def _syntax_error(description: str) -> dict:
    return {
        "result": {"type": "object", "subtype": "error", "description": description},
        "exceptionDetails": {"text": "Uncaught", "exception": {"description": description}},
    }


class TestGetHtmlTool(_ToolTestCase):
    async def test_full_page(self):
        self.daemon.evaluate({"document.documentElement.outerHTML": "<html><body>x</body></html>"})
        self.assertEqual(await self.call("browser_get_html"), "<html><body>x</body></html>")

    async def test_selector(self):
        def answer(params):
            expression = params["expression"]
            if not _js_brackets_balanced(expression):
                return _syntax_error("SyntaxError: Unexpected token '}'")
            return {"result": {"value": "<div id=\"main\"></div>" if '"#main"' in expression else None}}

        self.daemon.answers["Runtime.evaluate"] = answer
        self.assertEqual(await self.call("browser_get_html", selector="#main"), '<div id="main"></div>')

    async def test_a_javascript_exception_is_an_error_not_a_missing_element(self):
        import mcp.types as mcp_types

        self.daemon.answers["Runtime.evaluate"] = _syntax_error(
            "SyntaxError: Failed to execute 'querySelector' on 'Document': '[[' is not a valid selector."
        )
        result = await self.server._handle_call_tool(
            None, mcp_types.CallToolRequestParams(name="browser_get_html", arguments={"selector": "[["})
        )
        self.assertTrue(result.is_error, result.content[0].text)
        self.assertIn("is not a valid selector", result.content[0].text)
        self.assertNotIn("No element found", result.content[0].text)

    def test_the_bracket_check_can_fail(self):
        self.assertTrue(_js_brackets_balanced('(function(){ return "}}"; })()'))
        self.assertFalse(_js_brackets_balanced("(function(){ return 1; }})()"))

    async def test_selector_with_no_match(self):
        self.daemon.evaluate({}, default=None)
        self.assertEqual(await self.call("browser_get_html", selector="#nope"), "No element found for selector: #nope")

    async def test_no_html(self):
        self.daemon.evaluate({}, default=None)
        self.assertEqual(await self.call("browser_get_html"), "Error: Could not get page HTML")


class TestScreenshotTool(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.daemon.answers["Page.getLayoutMetrics"] = {
            "cssVisualViewport": {"pageX": 0, "pageY": 10, "clientWidth": 800, "clientHeight": 600},
            "cssContentSize": {"width": 800, "height": 2000},
        }
        self.daemon.answers["Page.captureScreenshot"] = {"data": _PNG_1x1}

    async def test_viewport_capture_with_an_explicit_clip(self):
        content = await self.call("browser_screenshot")
        capture = self.daemon.params_of("Page.captureScreenshot")[0]
        self.assertEqual(capture["clip"], {"x": 0, "y": 10, "width": 800, "height": 600, "scale": 1})
        self.assertNotIn("captureBeyondViewport", capture)
        self.assertEqual(
            json.loads(content[0].text),
            {"size_bytes": len(base64.b64decode(_PNG_1x1)), "viewport": {"width": 800, "height": 600}},
        )
        self.assertEqual((content[1].type, content[1].data), ("image", _PNG_1x1))

    async def test_brings_the_attached_tab_to_the_front_first(self):
        await self.call("browser_screenshot")
        methods = self.daemon.methods()
        self.assertEqual(self.daemon.params_of("Target.activateTarget"), [{"targetId": "TARGETAAAA"}])
        self.assertLess(methods.index("Target.activateTarget"), methods.index("Page.captureScreenshot"))

    async def test_full_page(self):
        await self.call("browser_screenshot", full_page=True)
        capture = self.daemon.params_of("Page.captureScreenshot")[0]
        self.assertEqual(capture["clip"], {"x": 0, "y": 0, "width": 800, "height": 2000, "scale": 1})
        self.assertIs(capture["captureBeyondViewport"], True)

    async def test_no_page_size(self):
        self.daemon.answers["Page.getLayoutMetrics"] = {}
        text = await self.call("browser_screenshot")
        self.assertEqual(text, "Error: the browser reported no page size to capture.")
        self.assertNotIn("Page.captureScreenshot", self.daemon.methods())


class TestScrollTool(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.daemon.evaluate({"({w: innerWidth, h: innerHeight})": {"w": 800, "h": 600}})

    async def test_down_by_default_at_the_viewport_centre(self):
        self.assertEqual(await self.call("browser_scroll"), "Scrolled down")
        wheel = self.daemon.params_of("Input.dispatchMouseEvent")[0]
        self.assertEqual(wheel, {"type": "mouseWheel", "x": 400, "y": 300, "deltaX": 0, "deltaY": 500})

    async def test_up(self):
        self.assertEqual(await self.call("browser_scroll", direction="up"), "Scrolled up")
        self.assertEqual(self.daemon.params_of("Input.dispatchMouseEvent")[0]["deltaY"], -500)

    async def test_bad_direction(self):
        self.assertEqual(
            await self.call("browser_scroll", direction="sideways"), "Error: direction must be 'up' or 'down'."
        )
        self.assertNotIn("Input.dispatchMouseEvent", self.daemon.methods())


class TestGoBackTool(_ToolTestCase):
    async def test_goes_to_the_previous_entry(self):
        self.daemon.answers["Page.getNavigationHistory"] = {"currentIndex": 1, "entries": [
            {"id": 101, "url": "https://a.test/"}, {"id": 102, "url": "https://a.test/next"},
        ]}
        self.assertEqual(await self.call("browser_go_back"), "Navigated back")
        self.assertEqual(self.daemon.params_of("Page.navigateToHistoryEntry"), [{"entryId": 101}])
        self.assertEqual(self.server._sessions[self.session_id].url, "https://a.test/")

    async def test_no_previous_entry(self):
        self.daemon.answers["Page.getNavigationHistory"] = {"currentIndex": 0, "entries": [
            {"id": 101, "url": "https://a.test/"},
        ]}
        text = await self.call("browser_go_back")
        self.assertTrue(text.startswith("Error"), text)
        self.assertNotIn("Page.navigateToHistoryEntry", self.daemon.methods())


class TestTabTools(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.targets = [
            {"targetId": "AAAAAAAA1111", "type": "page", "url": "https://a.test/", "title": "A"},
            {"targetId": "BBBBBBBB2222", "type": "page", "url": "https://b.test/", "title": "B"},
            {"targetId": "CCCCCCCC2222", "type": "service_worker", "url": "https://b.test/sw.js", "title": ""},
        ]
        self.daemon.answers["Target.getTargets"] = lambda params: {"targetInfos": list(self.targets)}
        self.daemon.answers["Target.attachToTarget"] = {"sessionId": "attached-session"}
        self.daemon.meta_answers["current_tab"] = {"targetId": "AAAAAAAA1111", "url": "https://a.test/"}

    async def test_list_tabs_shows_pages_with_4_char_ids(self):
        self.assertEqual(json.loads(await self.call("browser_list_tabs")), [
            {"tab_id": "1111", "url": "https://a.test/", "title": "A"},
            {"tab_id": "2222", "url": "https://b.test/", "title": "B"},
        ])

    async def test_switch_tab_activates_and_attaches(self):
        text = await self.call("browser_switch_tab", tab_id="2222")
        self.assertEqual(text, "Switched to tab 2222: https://b.test/")
        self.assertEqual(self.daemon.params_of("Target.activateTarget"), [{"targetId": "BBBBBBBB2222"}])
        self.assertEqual(
            self.daemon.params_of("Target.attachToTarget"), [{"targetId": "BBBBBBBB2222", "flatten": True}]
        )
        self.assertIn(
            ("budaemon01", "set_session", {"session_id": "attached-session", "target_id": "BBBBBBBB2222"}),
            self.daemon.meta_calls,
        )

    async def test_an_ambiguous_tab_id_is_an_error(self):
        self.targets.append({"targetId": "DDDDDDDD1111", "type": "page", "url": "https://d.test/", "title": "D"})
        text = await self.call("browser_switch_tab", tab_id="1111")
        self.assertIn("matches 2 tabs", text)
        self.assertNotIn("Target.attachToTarget", self.daemon.methods())

    async def test_a_longer_id_disambiguates(self):
        self.targets.append({"targetId": "DDDDDDDD1111", "type": "page", "url": "https://d.test/", "title": "D"})
        text = await self.call("browser_switch_tab", tab_id="DD1111")
        self.assertEqual(text, "Switched to tab DD1111: https://d.test/")

    async def test_an_unknown_tab_id_is_an_error(self):
        text = await self.call("browser_switch_tab", tab_id="zzzz")
        self.assertIn("no tab with id 'zzzz'", text)

    async def test_close_another_tab_keeps_the_attached_one(self):
        text = await self.call("browser_close_tab", tab_id="2222")
        self.assertEqual(text, "Closed tab # 2222, now on https://a.test/")
        self.assertEqual(self.daemon.params_of("Target.closeTarget"), [{"targetId": "BBBBBBBB2222"}])
        self.assertNotIn("Target.attachToTarget", self.daemon.methods())

    async def test_closing_the_attached_tab_attaches_another(self):
        text = await self.call("browser_close_tab", tab_id="1111")
        self.assertEqual(text, "Closed tab # 1111, now on https://b.test/")
        self.assertEqual(
            self.daemon.params_of("Target.attachToTarget"), [{"targetId": "BBBBBBBB2222", "flatten": True}]
        )

    async def test_closing_the_last_tab_opens_a_blank_one(self):
        self.targets[:] = [self.targets[0]]
        self.daemon.answers["Target.createTarget"] = {"targetId": "BLANK0000001"}
        text = await self.call("browser_close_tab", tab_id="1111")
        self.assertEqual(text, "Closed tab # 1111, now on about:blank")
        self.assertEqual(self.daemon.params_of("Target.createTarget"), [{"url": "about:blank"}])
        self.assertEqual(
            self.daemon.params_of("Target.attachToTarget"), [{"targetId": "BLANK0000001", "flatten": True}]
        )


# ---------------------------------------------------------------------------
# Session tools
# ---------------------------------------------------------------------------

class TestSessionTools(_ToolTestCase):
    async def test_list_sessions(self):
        rows = json.loads(await self.call("browser_list_sessions"))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["session_id"], self.session_id)
        self.assertEqual(row["current_url"], "https://example.com/")
        self.assertIs(row["active"], True)
        for key in ("created_at", "last_activity", "age_minutes"):
            self.assertIn(key, row)
        time.strptime(row["created_at"], "%Y-%m-%d %H:%M:%S")

    async def test_close_session(self):
        text = await self.call("browser_close_session", session_id=self.session_id)
        self.assertEqual(text, f"Successfully closed session {self.session_id}")
        self.assertTrue(self.browser.stopped)
        self.assertEqual(self.server._sessions, {})
        self.assertIsNone(self.server._primary)

    async def test_close_an_unknown_session(self):
        self.assertEqual(await self.call("browser_close_session", session_id="nope"), "Session nope not found")
        self.assertFalse(self.browser.stopped)

    async def test_a_failed_close_keeps_the_session(self):
        self.browser.stop_error = RuntimeError("daemon gone")
        text = await self.call("browser_close_session", session_id=self.session_id)
        self.assertEqual(text, f"Error closing session {self.session_id}: daemon gone")
        self.assertIn(self.session_id, self.server._sessions)

    async def test_close_all(self):
        broken = _FakeBrowser()
        broken.name = "budaemon02"
        broken.stop_error = RuntimeError("stuck")
        broken_id = self.server._register(broken, "local")
        text = await self.call("browser_close_all")
        self.assertTrue(text.startswith("Closed 1 sessions. Errors: "), text)
        self.assertIn(broken_id, text)
        self.assertTrue(self.browser.stopped)
        self.assertIsNone(self.server._primary)

    async def test_close_all_keeps_a_primary_that_failed_to_stop(self):
        self.browser.stop_error = RuntimeError("stuck")
        text = await self.call("browser_close_all")
        self.assertTrue(text.startswith("Closed 0 sessions. Errors: "), text)
        self.assertEqual(self.server._primary, self.session_id)
        self.assertIn(self.session_id, self.server._sessions)


class _CloudStopFails(_FakeBrowser):
    """A cloud browser whose stop returns normally but leaves it running, as 1.0 does."""

    def __init__(self, **kwargs):
        super().__init__(use_cloud=True, **kwargs)
        self.id = "cloud-browser-0001"

    async def stop(self):
        self.name = None


class _CloudStopWorks(_CloudStopFails):
    async def stop(self):
        self.stopped = True
        self.name = None
        self.id = None


class TestCloudStopFailure(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.cloud = _CloudStopFails()
        self.cloud.name = "bucloud01"
        self.cloud_id = self.server._register(self.cloud, "cloud")
        self.server._primary = self.cloud_id

    def listed(self, rows_json):
        return [row["session_id"] for row in json.loads(rows_json)]

    async def test_a_cloud_browser_still_running_after_stop_keeps_its_session(self):
        text = await self.call("browser_close_session", session_id=self.cloud_id)
        self.assertTrue(text.startswith(f"Error closing session {self.cloud_id}:"), text)
        self.assertIn("still running", text)
        self.assertIn(self.cloud_id, self.listed(await self.call("browser_list_sessions")))
        self.assertEqual(self.server._primary, self.cloud_id)

    async def test_close_all_reports_a_cloud_browser_still_running(self):
        text = await self.call("browser_close_all")
        self.assertTrue(text.startswith("Closed 1 sessions. Errors: "), text)
        self.assertIn(f"{self.cloud_id}: Error closing session {self.cloud_id}:", text)
        self.assertEqual(list(self.server._sessions), [self.cloud_id])
        self.assertEqual(self.server._primary, self.cloud_id)

    async def test_a_cloud_browser_whose_stop_clears_its_id_closes(self):
        ok = _CloudStopWorks()
        ok.name = "bucloud02"
        ok_id = self.server._register(ok, "cloud")
        text = await self.call("browser_close_session", session_id=ok_id)
        self.assertEqual(text, f"Successfully closed session {ok_id}")
        self.assertNotIn(ok_id, self.server._sessions)


class TestRealCloudStopFailure(unittest.IsolatedAsyncioTestCase):
    """
    The pinned browser_use.Browser, never started: its cloud stop request
    fails, so 1.0's stop() returns normally with the cloud browser still
    registered under its id. Nothing reaches the network: the request
    function is replaced and so is the retry back-off.
    """

    async def test_the_session_is_kept_when_the_real_cloud_stop_fails(self):
        import browser_use
        from browser_use.browser import browser as bu_browser

        requests: list = []

        def cloud_down(path, method="GET", body=None):
            requests.append((path, method, body))
            raise RuntimeError("Browser Use Cloud unreachable")

        self.enterContext(patch.object(bu_browser, "_cloud", cloud_down))
        self.enterContext(patch.object(bu_browser.time, "sleep", lambda _seconds: None))

        browser = browser_use.Browser(use_cloud=True)
        self.assertTrue(browser.use_cloud)
        browser.id = "cloud-browser-real-0001"
        self.addCleanup(setattr, browser, "id", None)
        self.assertNotIn(browser, bu_browser._LIVE)

        server = _make_server()
        session_id = server._register(browser, "cloud")
        server._primary = session_id

        text = await server._close_session(session_id)

        self.assertEqual(
            requests,
            [("/browsers/cloud-browser-real-0001", "PATCH", {"action": "stop"})] * 3,
        )
        self.assertEqual(browser.id, "cloud-browser-real-0001")
        self.assertFalse(browser.stopped)
        self.assertTrue(text.startswith(f"Error closing session {session_id}:"), text)
        self.assertIn(session_id, server._sessions)
        self.assertEqual(server._primary, session_id)


class TestExportSessionTool(_ToolTestCase):
    async def test_writes_cookies_and_url(self):
        cookies = [{"name": "sid", "value": "1", "domain": "a.test"}, {"name": "t", "value": "2", "domain": "b.test"}]
        self.daemon.answers["Storage.getCookies"] = {"cookies": cookies}
        self.daemon.answers["Network.getCookies"] = {"cookies": cookies[:1]}
        out = Path(_tempfile.mkdtemp(prefix="magus-export-")) / "nested" / "session.json"
        self.addCleanup(_shutil.rmtree, out.parent.parent, ignore_errors=True)
        result = json.loads(await self.call("browser_export_session", session_id=self.session_id, output_path=str(out)))
        self.assertEqual(result, {"success": True, "path": str(out), "cookies_count": 2, "url": "https://example.com/"})
        saved = json.loads(out.read_text())
        self.assertEqual(saved["cookies"], cookies)
        self.assertEqual(saved["url"], "https://example.com/")
        self.assertEqual(saved["session_id"], self.session_id)
        self.assertNotIn("Network.getCookies", self.daemon.methods(), "Network.getCookies is scoped to one page")

    async def test_unknown_session(self):
        text = await self.call("browser_export_session", session_id="nope", output_path="/tmp/x.json")
        self.assertIn("'nope' not found", text)


class TestImportSessionTool(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.daemon = _FakeDaemon()
        self.enterContext(self.daemon.installed())
        self.created = self.enterContext(_fake_browsers())
        self.dir = Path(_tempfile.mkdtemp(prefix="magus-import-"))
        self.addCleanup(_shutil.rmtree, self.dir, ignore_errors=True)
        self.file = self.dir / "session.json"
        self.file.write_text(json.dumps({"url": "https://a.test/home", "cookies": [
            {"name": "sid", "value": "1", "domain": "a.test", "path": "/", "size": 4, "expires": 2000000000},
            "not a cookie",
            {"name": "tmp", "value": "2", "domain": "a.test", "session": True, "expires": -1},
        ]}))

    async def test_imports_into_a_new_primary_session(self):
        server = _make_server()
        result = json.loads(await server._execute_tool(
            "browser_import_session", {"import_path": str(self.file), "navigate_to": "https://a.test/app"}
        ))
        self.assertEqual(len(self.created), 1)
        self.assertEqual(self.created[0].kwargs["kind"], "chromium")
        self.assertIs(result["is_primary"], True)
        self.assertEqual(server._primary, result["session_id"])
        self.assertEqual(result["cookies_imported"], 3)
        self.assertEqual(result["original_url"], "https://a.test/home")
        self.assertEqual(self.daemon.params_of("Network.setCookie"), [
            {"name": "sid", "value": "1", "domain": "a.test", "path": "/", "expires": 2000000000},
            {"name": "tmp", "value": "2", "domain": "a.test"},
        ])
        self.assertEqual(self.daemon.params_of("Page.navigate"), [{"url": "https://a.test/app"}])
        self.assertIn("Browser.setDownloadBehavior", self.daemon.methods())

    async def test_an_existing_primary_stays_primary(self):
        server = _make_server()
        existing = _FakeBrowser()
        existing.name = "budaemon01"
        server._primary = server._register(existing, "local")
        primary = server._primary
        result = json.loads(await server._execute_tool("browser_import_session", {"import_path": str(self.file)}))
        self.assertIs(result["is_primary"], False)
        self.assertEqual(server._primary, primary)
        self.assertIn(result["session_id"], server._sessions)

    async def test_a_non_primary_import_also_downloads_to_the_config_dir(self):
        server = _make_server()
        existing = _FakeBrowser()
        existing.name = "budaemon01"
        server._primary = server._register(existing, "local")
        result = json.loads(await server._execute_tool("browser_import_session", {"import_path": str(self.file)}))
        imported = server._sessions[result["session_id"]].name
        targets = [c[0] for c in self.daemon.calls if c[1] == "Browser.setDownloadBehavior"]
        self.assertEqual(targets, [imported])
        self.assertEqual(
            self.daemon.params_of("Browser.setDownloadBehavior")[0]["downloadPath"],
            str(Path.home() / ".config" / "browseruse" / "downloads"),
        )

    async def test_a_missing_file(self):
        text = await _make_server()._execute_tool("browser_import_session", {"import_path": str(self.dir / "no.json")})
        self.assertTrue(text.startswith("Error: File not found"), text)
        self.assertEqual(self.created, [])

    async def test_a_failure_stops_the_new_browser(self):
        self.daemon.answers["Page.navigate"] = {"errorText": "net::ERR_FAILED"}
        server = _make_server()
        text = await server._execute_tool(
            "browser_import_session", {"import_path": str(self.file), "navigate_to": "https://a.test/app"}
        )
        self.assertTrue(text.startswith("import_session failed"), text)
        self.assertTrue(self.created[0].stopped)
        self.assertEqual(server._sessions, {})


class TestStartCloudSessionTool(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.daemon = _FakeDaemon()
        self.enterContext(self.daemon.installed())
        self.created = self.enterContext(_fake_browsers())

    async def test_requires_browser_use_api_key(self):
        text = await _make_server()._execute_tool("browser_start_cloud_session", {})
        self.assertIn("BROWSER_USE_API_KEY is not set", text)
        self.assertEqual(self.created, [])

    async def test_starts_a_cloud_browser_and_becomes_primary(self):
        server = _make_server()
        with patch.dict(os.environ, {"BROWSER_USE_API_KEY": "bu-test-key"}):
            first = json.loads(await server._execute_tool("browser_start_cloud_session", {}))
            second = json.loads(await server._execute_tool(
                "browser_start_cloud_session", {"navigate_to": "https://a.test/"}
            ))
        self.assertEqual([b.kwargs for b in self.created], [{"use_cloud": True}, {"use_cloud": True}])
        self.assertIs(first["is_primary"], True)
        self.assertEqual(server._primary, first["session_id"])
        self.assertEqual(first["cdp_url"], "wss://cdp.browser-use.example/abc")
        self.assertEqual(first["live_url"], "https://live.browser-use.example/abc")
        self.assertIs(second["is_primary"], False)
        self.assertEqual(second["navigated_to"], "https://a.test/")
        navigate = [c for c in self.daemon.calls if c[1] == "Page.navigate"]
        self.assertEqual(navigate[0][0], self.created[1].name)
        self.assertNotIn("Browser.setDownloadBehavior", self.daemon.methods())

    async def test_a_failed_start_registers_nothing(self):
        _FakeBrowser.start_error = RuntimeError("no cloud quota")
        server = _make_server()
        with patch.dict(os.environ, {"BROWSER_USE_API_KEY": "bu-test-key"}):
            text = await server._execute_tool("browser_start_cloud_session", {})
        self.assertEqual(text, "start_cloud_session failed: no cloud quota")
        self.assertEqual(server._sessions, {})


# ---------------------------------------------------------------------------
# retry_with_browser_use_agent (the RED class above covers the browser it gets)
# ---------------------------------------------------------------------------

class TestRetryAgentResults(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        import browser_use

        self.created = self.enterContext(_fake_browsers())
        self.agents: list = []
        self.run_error = None
        test = self

        class _History:
            def number_of_steps(self):
                return 3

            def is_successful(self):
                return False

            def final_result(self):
                return None

            def errors(self):
                return ["step 2: element not found"]

        class _Agent:
            def __init__(self, task=None, llm=None, **kwargs):
                self.task, self.llm, self.kwargs = task, llm, kwargs
                self.closed = False
                test.agents.append(self)

            async def run(self, max_steps=100, **_kwargs):
                if test.run_error is not None:
                    raise test.run_error
                self.kwargs["browser"].name = "buagent0001"
                return _History()

            async def close(self):
                self.closed = True

        self.enterContext(patch.object(browser_use, "Agent", _Agent))
        self.enterContext(patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}))

    async def test_reports_failure_and_errors(self):
        text = await _make_server()._execute_tool("retry_with_browser_use_agent", {"task": "t"})
        self.assertIn("Task completed in 3 steps", text)
        self.assertIn("Success: False", text)
        self.assertIn("element not found", text)
        self.assertNotIn("Final result", text)
        self.assertTrue(self.agents[0].closed)
        self.assertTrue(self.created[0].stopped)

    async def test_an_agent_failure_is_reported_and_cleaned_up(self):
        self.run_error = RuntimeError("model refused")
        text = await _make_server()._execute_tool("retry_with_browser_use_agent", {"task": "t"})
        self.assertEqual(text, "Agent task failed: model refused")
        self.assertTrue(self.agents[0].closed)
        self.assertFalse(self.created[0].stopped, "a browser that never started is not stopped")

    async def test_model_argument_replaces_the_configured_model(self):
        await _make_server()._execute_tool("retry_with_browser_use_agent", {"task": "t", "model": "claude-other"})
        self.assertEqual(self.agents[0].llm.model, "claude-other")

    async def test_task_is_required(self):
        self.assertEqual(
            await _make_server()._execute_tool("retry_with_browser_use_agent", {"task": ""}),
            "Error: task is required.",
        )
        self.assertEqual(self.agents, [])

    async def test_without_a_key_it_says_which_one_and_starts_nothing(self):
        build = MagicMock()
        with patch.dict(os.environ), patch.object(_mod, "_build_llm", build):
            os.environ.pop("ANTHROPIC_API_KEY", None)
            text = await _make_server()._execute_tool("retry_with_browser_use_agent", {"task": "t"})
        self.assertTrue(text.startswith("Error"), text)
        self.assertIn("ANTHROPIC_API_KEY", text)
        self.assertIn("browser_set_agent_model", text)
        build.assert_not_called()
        self.assertEqual(self.created, [], "a browser was built for a run that cannot call a model")
        self.assertEqual(self.agents, [])

    async def test_runs_beside_page_tools_without_their_lock(self):
        server = _make_server()
        async with server._lock:
            text = await asyncio.wait_for(
                server._execute_tool("retry_with_browser_use_agent", {"task": "t"}), timeout=5
            )
        self.assertIn("Task completed", text)


# ---------------------------------------------------------------------------
# Live-page custom tools: evaluate, focus, keyboard, save_screenshot
# ---------------------------------------------------------------------------

class TestEvaluateTool(_ToolTestCase):
    async def test_expression_result(self):
        self.daemon.answers["Runtime.evaluate"] = {"result": {"value": "Example Domain"}}
        self.assertEqual(json.loads(await self.call("browser_evaluate", script="document.title")),
                         {"result": "Example Domain"})
        params = self.daemon.params_of("Runtime.evaluate")[0]
        self.assertEqual(params["expression"], "document.title")
        self.assertIs(params["returnByValue"], True)
        self.assertIs(params["awaitPromise"], True)

    async def test_a_return_statement_is_wrapped(self):
        await self.call("browser_evaluate", script="return 1 + 1")
        self.assertTrue(self.daemon.params_of("Runtime.evaluate")[0]["expression"].startswith("(function(){"))

    async def test_a_js_exception_is_reported(self):
        self.daemon.answers["Runtime.evaluate"] = {
            "result": {}, "exceptionDetails": {"text": "Uncaught", "exception": {"description": "ReferenceError: x"}},
        }
        self.assertEqual(json.loads(await self.call("browser_evaluate", script="x")),
                         {"error": "JavaScript exception", "detail": "ReferenceError: x"})

    async def test_a_cdp_failure_is_reported(self):
        self.daemon.answers["Runtime.evaluate"] = RuntimeError("Runtime.evaluate failed: gone")
        self.assertEqual(await self.call("browser_evaluate", script="1"), "evaluate failed: Runtime.evaluate failed: gone")

    async def test_script_is_required(self):
        self.assertEqual(await self.call("browser_evaluate", script="  "), "Error: script is required.")


class TestFocusTool(_ToolTestCase):
    async def test_focused(self):
        self.daemon.answers["Runtime.evaluate"] = {"result": {"value": True}}
        self.assertEqual(json.loads(await self.call("browser_focus", selector="textarea.inputarea")),
                         {"focused": True, "selector": "textarea.inputarea"})
        self.assertIn('"textarea.inputarea"', self.daemon.params_of("Runtime.evaluate")[0]["expression"])
        self.assertIn("Target.activateTarget", self.daemon.methods())

    async def test_no_match(self):
        self.daemon.answers["Runtime.evaluate"] = {"result": {"value": False}}
        self.assertIs(json.loads(await self.call("browser_focus", selector="#nope"))["focused"], False)


class TestKeyboardTools(_ToolTestCase):
    async def test_press_key_sends_down_and_up(self):
        self.assertEqual(json.loads(await self.call("browser_press_key", key="Enter")), {"pressed": "Enter", "count": 1})
        events = self.daemon.params_of("Input.dispatchKeyEvent")
        self.assertEqual([e["type"] for e in events], ["keyDown", "keyUp"])
        self.assertEqual(events[0]["key"], "Enter")
        self.assertEqual(events[0]["windowsVirtualKeyCode"], 13)

    async def test_press_key_count(self):
        await self.call("browser_press_key", key="ArrowDown", count=3)
        self.assertEqual(len(self.daemon.params_of("Input.dispatchKeyEvent")), 6)

    async def test_select_all_carries_the_edit_command(self):
        await self.call("browser_press_key", key="Meta+a")
        down, up = self.daemon.params_of("Input.dispatchKeyEvent")
        self.assertEqual(down["commands"], ["selectAll"])
        self.assertEqual(down["modifiers"], 4)
        self.assertNotIn("commands", up)

    async def test_printable_keys_carry_their_text(self):
        for spec, text in (("a", "a"), ("A", "A"), ("1", "1"), (" ", " "), ("Space", " "),
                           ("Shift+b", "B"), ("Shift+1", "!"), ("?", "?")):
            with self.subTest(spec):
                self.daemon.calls.clear()
                await self.call("browser_press_key", key=spec)
                down, up = self.daemon.params_of("Input.dispatchKeyEvent")
                self.assertEqual(down["type"], "keyDown")
                self.assertEqual(down.get("text"), text, down)
                self.assertNotIn("text", up)

    async def test_modifier_chords_and_named_keys_carry_no_text(self):
        for spec in ("Meta+a", "Control+c", "Meta+z", "Alt+a", "Enter", "ArrowDown", "Backspace"):
            with self.subTest(spec):
                self.daemon.calls.clear()
                await self.call("browser_press_key", key=spec)
                down, _up = self.daemon.params_of("Input.dispatchKeyEvent")
                self.assertNotIn("text", down)

    async def test_keyboard_keys_type_printable_characters(self):
        await self.call("browser_keyboard", keys=["x", "Meta+a"])
        events = [e for e in self.daemon.params_of("Input.dispatchKeyEvent") if e["type"] == "keyDown"]
        self.assertEqual([e.get("text") for e in events], ["x", None])

    async def test_keyboard_presses_keys_then_inserts_text(self):
        result = json.loads(await self.call("browser_keyboard", keys=["Meta+a", "Delete"], text="new"))
        self.assertEqual(result, {"keys": ["Meta+a", "Delete"], "text_inserted": True})
        methods = self.daemon.methods()
        self.assertEqual(methods.count("Input.dispatchKeyEvent"), 4)
        self.assertEqual(methods[-1], "Input.insertText")
        self.assertEqual(self.daemon.params_of("Input.insertText"), [{"text": "new"}])

    async def test_keyboard_needs_keys_or_text(self):
        self.assertEqual(await self.call("browser_keyboard"), "Error: provide `keys` and/or `text`.")


class TestSaveScreenshotTool(_ToolTestCase):
    def setUp(self):
        super().setUp()
        self.daemon.answers["Page.getLayoutMetrics"] = {
            "cssVisualViewport": {"pageX": 0, "pageY": 0, "clientWidth": 1, "clientHeight": 1},
        }
        self.daemon.answers["Page.captureScreenshot"] = {"data": _PNG_1x1}
        self.dir = Path(_tempfile.mkdtemp(prefix="magus-shot-")).resolve()
        self.addCleanup(_shutil.rmtree, self.dir, ignore_errors=True)

    async def test_writes_the_png(self):
        out = self.dir / "a" / "shot.png"
        result = json.loads(await self.call("browser_save_screenshot", output_path=str(out)))
        png = base64.b64decode(_PNG_1x1)
        self.assertEqual(result, {"path": str(out), "size_bytes": len(png), "width": 1, "height": 1})
        self.assertEqual(out.read_bytes(), png)

    async def test_rejects_a_relative_path(self):
        text = await self.call("browser_save_screenshot", output_path="shot.png")
        self.assertIn("must be absolute", text)

    async def test_rejects_a_non_png_path(self):
        text = await self.call("browser_save_screenshot", output_path=str(self.dir / "shot.jpg"))
        self.assertIn("must end in .png", text)

    async def test_rejects_data_that_is_not_a_png(self):
        self.daemon.answers["Page.captureScreenshot"] = {"data": base64.b64encode(b"GIF89a....").decode()}
        text = await self.call("browser_save_screenshot", output_path=str(self.dir / "shot.png"))
        self.assertEqual(text, "Error: the browser returned data that is not a PNG.")
        self.assertFalse((self.dir / "shot.png").exists())


class TestDoctorTool(unittest.IsolatedAsyncioTestCase):
    async def test_doctor_reports_core_fields(self):
        data = json.loads(await _make_server()._handle_doctor({}))
        for field in ("python_version", "python_executable", "browser_use", "browser_harness",
                      "mcp", "playwright", "chromium_present", "chromium_path", "chromium_source",
                      "chromium_error", "api_keys"):
            self.assertIn(field, data)
        self.assertTrue(data["browser_use"]["installed"])
        self.assertEqual(data["browser_use"]["version"], _mod._package_version("browser-use"))
        self.assertEqual(
            set(data["api_keys"]), {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "BROWSER_USE_API_KEY"}
        )
        self.assertFalse(any(data["api_keys"].values()))

    async def test_doctor_never_starts_a_browser(self):
        with _fake_browsers() as created:
            server = _make_server()
            await server._execute_tool("browser_doctor", {})
        self.assertEqual(created, [])
        self.assertEqual(server._sessions, {})


# ---------------------------------------------------------------------------
# Pure helpers: the eval wrapper, key parsing, run_script
# ---------------------------------------------------------------------------

class TestWrapEvalScript(unittest.TestCase):
    """Direct tests of the expression-vs-statement heuristic."""

    def setUp(self):
        self.wrap = _mod.MagusBrowserServer._wrap_eval_script

    def test_plain_expression_passthrough(self):
        for expr in ('document.title', '1+1', '"returned"',
                     "document.querySelector('.return-btn')", 'window.__editor.getValue()',
                     'document.title;'):  # single trailing semicolon is still an expression
            self.assertEqual(self.wrap(expr), expr, f"{expr!r} must pass through unwrapped")

    def test_return_statement_wrapped(self):
        for stmt in ('return 1+1', 'return monaco.editor.getModels()[0].setValue("x")'):
            self.assertTrue(self.wrap(stmt).startswith('(function(){'), f"{stmt!r} must wrap")

    def test_multi_statement_wrapped(self):
        s = "const x = 1; return x + 1"
        self.assertTrue(self.wrap(s).startswith('(function(){'))

    def test_returned_identifier_not_wrapped(self):
        # 'returnValue' / 'returned' start with the letters but are not `return`.
        self.assertEqual(self.wrap('returnValue'), 'returnValue')
        self.assertEqual(self.wrap('returned'), 'returned')


class TestParseKeySpec(unittest.TestCase):
    """Direct unit tests of the key-spec parser (modifier + vk derivation)."""

    def test_single_letter(self):
        mods, key, code, vk = _mod.MagusBrowserServer._parse_key_spec("a")
        self.assertEqual((mods, key, code, vk), (0, "a", "KeyA", ord("A")))

    def test_ctrl_shift_combo(self):
        mods, key, code, vk = _mod.MagusBrowserServer._parse_key_spec("Control+Shift+ArrowRight")
        self.assertEqual(mods, 2 | 8)  # Control + Shift
        self.assertEqual(key, "ArrowRight")
        self.assertEqual(vk, 39)

    def test_digit(self):
        mods, key, code, vk = _mod.MagusBrowserServer._parse_key_spec("5")
        self.assertEqual(code, "Digit5")

    def test_command_for_select_all(self):
        # Meta (4) or Control (2) + 'a' → selectAll; plain 'a' → none.
        self.assertEqual(_mod.MagusBrowserServer._command_for(4, "a"), ["selectAll"])
        self.assertEqual(_mod.MagusBrowserServer._command_for(2, "a"), ["selectAll"])
        self.assertEqual(_mod.MagusBrowserServer._command_for(0, "a"), [])
        self.assertEqual(_mod.MagusBrowserServer._command_for(4, "c"), ["copy"])
        # Shift (8) alone is not an edit modifier here.
        self.assertEqual(_mod.MagusBrowserServer._command_for(8, "a"), [])


class TestRunScriptFailFast(unittest.IsolatedAsyncioTestCase):
    """browser_run_script must reject non-file paths fast instead of hanging."""

    async def test_inline_js_rejected_immediately(self):
        server = _make_server()
        out = await server._handle_run_script(
            {"script_path": "monaco.editor.getModels()[0].setValue('x')"}
        )
        self.assertIn("readable .py file", out)
        self.assertIn("browser_evaluate", out)  # points the user to the right tool

    async def test_non_py_extension_rejected(self):
        server = _make_server()
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".txt") as f:
            out = await server._handle_run_script({"script_path": f.name})
        self.assertIn(".py file", out)


# ---------------------------------------------------------------------------
# Agent LLM: _build_llm, browser_set_agent_model
# ---------------------------------------------------------------------------

class _RecordingChat:
    """Captures the kwargs _build_llm hands a Chat class."""

    def __init__(self, **kwargs):
        self.init_kwargs = dict(kwargs)


class _RecordingAnthropic(_RecordingChat):
    pass


class _RecordingOpenAI(_RecordingChat):
    pass


class _RecordingBrowserUse(_RecordingChat):
    pass


@contextlib.contextmanager
def _recording_chats():
    """browser_use's three Chat classes replaced by recorders, for kwargs checks."""
    import browser_use

    with patch.object(browser_use, "ChatAnthropic", _RecordingAnthropic), \
            patch.object(browser_use, "ChatOpenAI", _RecordingOpenAI), \
            patch.object(browser_use, "ChatBrowserUse", _RecordingBrowserUse):
        yield


class TestBuildLLM(unittest.TestCase):
    """
    _build_llm(choice) builds browser-use 1.0's ChatAnthropic / ChatOpenAI /
    ChatBrowserUse per provider, forwarding temperature only for openai and
    openai_compatible and base_url only where the class takes one. The classes
    themselves are exercised in TestBuildLLMReal10.
    """

    def setUp(self):
        self.enterContext(_recording_chats())

    def _build(self, **kwargs):
        return _mod._build_llm(_mod.LLMChoice(**kwargs))

    def test_anthropic_drops_temperature(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-xyz"}):
            llm = self._build(provider="anthropic", model="claude-sonnet-5", temperature=0.9)
        self.assertIsInstance(llm, _RecordingAnthropic)
        self.assertEqual(llm.init_kwargs, {"model": "claude-sonnet-5", "api_key": "sk-ant-xyz"})

    def test_a_missing_key_is_passed_as_none(self):
        llm = self._build(provider="anthropic", model="claude-sonnet-5")
        self.assertIn("api_key", llm.init_kwargs)
        self.assertIsNone(llm.init_kwargs["api_key"])

    def test_anthropic_with_base_url_is_refused_before_construction(self):
        with self.assertRaises(ValueError) as cm:
            self._build(provider="anthropic", model="m", base_url="https://proxy.example/anthropic")
        self.assertIn("openai_compatible", str(cm.exception))

    def test_openai_forwards_temperature(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-oai"}):
            llm = self._build(provider="openai", model="gpt-5", temperature=0.3)
        self.assertIsInstance(llm, _RecordingOpenAI)
        self.assertEqual(llm.init_kwargs, {"model": "gpt-5", "api_key": "sk-oai", "temperature": 0.3})

    def test_openai_omits_temperature_when_none(self):
        self.assertNotIn("temperature", self._build(provider="openai", model="gpt-5").init_kwargs)

    def test_browser_use_drops_temperature_and_unset_base_url(self):
        with patch.dict(os.environ, {"BROWSER_USE_API_KEY": "bu-key"}):
            llm = self._build(provider="browser_use", model="bu-fast", temperature=0.5)
        self.assertIsInstance(llm, _RecordingBrowserUse)
        # ChatBrowserUse turns base_url=None into the string "None".
        self.assertEqual(llm.init_kwargs, {"model": "bu-fast", "api_key": "bu-key"})

    def test_browser_use_forwards_a_base_url(self):
        llm = self._build(provider="browser_use", model="bu-fast", base_url="https://gw.example/v1")
        self.assertEqual(llm.init_kwargs["base_url"], "https://gw.example/v1")

    def test_openai_compatible_forwards_base_url_key_and_temperature(self):
        with patch.dict(os.environ, {"MY_LOCAL_KEY": "local-secret"}):
            llm = self._build(provider="openai_compatible", model="llama-3",
                              base_url="http://localhost:1234/v1", api_key_env="MY_LOCAL_KEY", temperature=0.1)
        self.assertIsInstance(llm, _RecordingOpenAI)
        self.assertEqual(llm.init_kwargs, {
            "model": "llama-3", "api_key": "local-secret",
            "base_url": "http://localhost:1234/v1", "temperature": 0.1,
        })

    def test_openai_compatible_needs_a_base_url(self):
        with patch.dict(os.environ, {"MY_LOCAL_KEY": "local-secret"}), self.assertRaises(RuntimeError) as cm:
            self._build(provider="openai_compatible", model="llama-3", api_key_env="MY_LOCAL_KEY")
        self.assertIn("base_url", str(cm.exception))

    def test_openai_compatible_needs_a_key(self):
        with self.assertRaises(RuntimeError) as cm:
            self._build(provider="openai_compatible", model="llama-3",
                        base_url="http://localhost:1234/v1", api_key_env="MY_LOCAL_KEY")
        self.assertIn("MY_LOCAL_KEY", str(cm.exception))

    def test_custom_api_key_env(self):
        with patch.dict(os.environ, {"CUSTOM_ANT_KEY": "sk-custom"}):
            llm = self._build(provider="anthropic", model="m", api_key_env="CUSTOM_ANT_KEY")
        self.assertEqual(llm.init_kwargs["api_key"], "sk-custom")

    def test_unknown_provider(self):
        with self.assertRaises(ValueError) as cm:
            self._build(provider="not_a_provider", model="x")
        self.assertIn("not_a_provider", str(cm.exception))


class TestSetAgentModelTool(unittest.IsolatedAsyncioTestCase):
    """
    browser_set_agent_model validates, builds the model once so a bad choice is
    reported at once, stores the override, and never echoes a secret.
    """

    def setUp(self):
        self.server = _make_server()

    async def _set(self, **args):
        return await self.server._execute_tool("browser_set_agent_model", args)

    async def test_stores_the_override(self):
        payload = json.loads(await self._set(provider="anthropic", model="claude-sonnet-5"))
        self.assertEqual(payload, {
            "provider": "anthropic", "model": "claude-sonnet-5", "base_url": None,
            "applied_to_live_session": False,
        })
        self.assertEqual(self.server._session_llm_override.model, "claude-sonnet-5")

    async def test_reports_a_live_session(self):
        browser = _FakeBrowser()
        browser.name = "budaemon01"
        self.server._primary = self.server._register(browser, "local")
        payload = json.loads(await self._set(provider="openai", model="gpt-5", temperature=0.3))
        self.assertIs(payload["applied_to_live_session"], True)
        self.assertEqual(self.server._agent_llm_choice().temperature, 0.3)

    async def test_override_is_what_the_agent_tools_use(self):
        await self._set(provider="openai", model="gpt-5")
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-oai"}):
            import browser_use

            llm = self.server._resolve_agent_llm()
        self.assertIsInstance(llm, browser_use.ChatOpenAI)
        self.assertEqual(llm.model, "gpt-5")

    async def test_invalid_input_is_refused_and_not_stored(self):
        cases = (
            ({"provider": "bogus", "model": "x"}, "unknown provider"),
            ({"provider": "openai", "model": ""}, "model is required"),
            ({"provider": "openai_compatible", "model": "llama-3"}, "base_url"),
            ({"provider": "anthropic", "model": "m", "base_url": "https://proxy.example"}, "base_url"),
            ({"provider": "browser_use", "model": "bu-latest"}, "bu-fast"),
            ({"provider": "openai_compatible", "model": "llama-3", "base_url": "http://localhost:1234/v1",
              "api_key_env": "MISSING_KEY_VAR"}, "MISSING_KEY_VAR"),
        )
        prior = _mod.LLMChoice(provider="anthropic", model="prev-model")
        for args, expected in cases:
            with self.subTest(args):
                self.server._session_llm_override = prior
                text = await self._set(**args)
                self.assertTrue(text.startswith("Error"), text)
                self.assertIn(expected, text)
                self.assertIs(self.server._session_llm_override, prior)

    async def test_never_echoes_a_secret(self):
        with patch.dict(os.environ, {"MY_SECRET_ENV": "super-secret-value"}):
            text = await self._set(provider="openai_compatible", model="llama-3",
                                   base_url="http://localhost:1234/v1", api_key_env="MY_SECRET_ENV")
        self.assertNotIn("super-secret-value", text)
        self.assertNotIn("api_key", json.loads(text))


class TestAgentLLMStaticChecks(unittest.TestCase):
    """Model selection lives in one place, and both agent tools use it."""

    @classmethod
    def setUpClass(cls):
        import ast

        cls.source = _SERVER_FILE.read_text()
        cls.methods: dict = {}
        for node in ast.walk(ast.parse(cls.source)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                cls.methods[node.name] = ast.get_source_segment(cls.source, node) or ""

    def test_no_gpt_4o_mini_default(self):
        self.assertNotIn("gpt-4o-mini", self.source)

    def test_one_build_point(self):
        self.assertEqual(self.source.count("def _build_llm"), 1)
        for chat in ("ChatAnthropic(", "ChatOpenAI(", "ChatBrowserUse("):
            self.assertNotIn(chat, self.source, f"{chat} must be built only through _build_llm")

    def test_both_agent_tools_use_the_configured_choice(self):
        for handler in ("_handle_retry_with_browser_use_agent", "_handle_extract_content"):
            self.assertIn("self._agent_llm_choice()", self.methods[handler], handler)
            self.assertIn("_build_llm(", self.methods[handler], handler)


# ---------------------------------------------------------------------------
# Lifecycle: idle sweep, parent death, main()
# ---------------------------------------------------------------------------

class TestIdleSweep(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(patch.object(os, "getppid", lambda: 4242))
        self.kills = self.enterContext(patch.object(os, "kill"))
        self.server = _make_server()

    def _session(self, name, idle_seconds):
        browser = _FakeBrowser()
        browser.name = name
        key = self.server._register(browser, "local")
        self.server._sessions[key].last_activity = time.time() - idle_seconds
        return key, browser

    async def test_stops_sessions_idle_over_10_minutes_only(self):
        stale_id, stale = self._session("bustale", 601)
        fresh_id, fresh = self._session("bufresh", 30)
        self.server._primary = stale_id
        await self.server._cleanup_expired_sessions()
        self.assertTrue(stale.stopped)
        self.assertFalse(fresh.stopped)
        self.assertEqual(list(self.server._sessions), [fresh_id])
        self.assertIsNone(self.server._primary)
        self.kills.assert_not_called()

    async def test_a_failed_stop_never_raises(self):
        stale_id, stale = self._session("bustale", 3600)
        stale.stop_error = RuntimeError("daemon gone")
        await self.server._cleanup_expired_sessions()
        self.assertIn(stale_id, self.server._sessions)

    async def test_a_session_used_while_the_sweep_waits_for_the_lock_survives(self):
        key, browser = self._session("busy", 3600)
        async with self.server._lock:
            sweep = asyncio.create_task(self.server._cleanup_expired_sessions())
            await asyncio.sleep(0)
            self.server._sessions[key].last_activity = time.time()
        await sweep
        self.assertFalse(browser.stopped, "the sweep closed a session a tool had just used")
        self.assertIn(key, self.server._sessions)

    async def test_tool_use_keeps_a_session_alive(self):
        daemon = _FakeDaemon()
        daemon.evaluate({"document.documentElement.outerHTML": "<html></html>"})
        key, browser = self._session("budaemon01", 3600)
        self.server._primary = key
        with daemon.installed():
            await self.server._execute_tool("browser_get_html", {})
        await self.server._cleanup_expired_sessions()
        self.assertFalse(browser.stopped)

    async def test_the_loop_survives_a_failing_cycle(self):
        calls = 0
        done = asyncio.Event()

        async def cycle():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("first cycle fails")
            done.set()

        with patch.object(_mod, "_MAINTENANCE_INTERVAL_SECONDS", 0), \
                patch.object(self.server, "_cleanup_expired_sessions", cycle):
            task = asyncio.create_task(self.server._maintenance_loop())
            await asyncio.wait_for(done.wait(), timeout=5)
            task.cancel()
        self.assertGreaterEqual(calls, 2)

    def test_the_interval_and_timeout(self):
        self.assertEqual(_mod._MAINTENANCE_INTERVAL_SECONDS, 120)
        self.assertEqual(_mod._SESSION_IDLE_SECONDS, 600)


class TestParentDeathShutdown(unittest.TestCase):
    """
    A SIGKILLed `claude` reparents the server. The server then sends itself
    SIGTERM, so browser-use's own handler stops every live Browser on the way
    out. Only that one PID is ever signalled.
    """

    def _server(self, parent=4242):
        with patch.object(os, "getppid", lambda: parent):
            return _make_server()

    def test_a_reparented_server_sends_itself_sigterm(self):
        server = self._server()
        with patch.object(os, "getppid", lambda: 1), patch.object(os, "kill") as kill, \
                contextlib.redirect_stderr(io.StringIO()) as err:
            server._exit_if_parent_died()
        kill.assert_called_once_with(os.getpid(), signal.SIGTERM)
        self.assertIn("parent process 4242 is gone", err.getvalue())

    def test_a_live_parent_changes_nothing(self):
        server = self._server()
        with patch.object(os, "getppid", lambda: 4242), patch.object(os, "kill") as kill:
            server._exit_if_parent_died()
        kill.assert_not_called()

    def test_an_unreadable_parent_is_never_a_reason_to_exit(self):
        server = self._server()

        def broken():
            raise OSError("no")

        with patch.object(os, "getppid", broken), patch.object(os, "kill") as kill:
            server._exit_if_parent_died()
        kill.assert_not_called()

    def test_the_sweep_checks_the_parent(self):
        server = self._server()
        with patch.object(os, "getppid", lambda: 1), patch.object(os, "kill") as kill, \
                contextlib.redirect_stderr(io.StringIO()):
            asyncio.run(server._cleanup_expired_sessions())
        kill.assert_called_once_with(os.getpid(), signal.SIGTERM)


class TestServerSourceChecks(unittest.TestCase):
    """What the source must and must not contain, beyond what behaviour shows."""

    @classmethod
    def setUpClass(cls):
        import ast

        cls.source = _SERVER_FILE.read_text()
        tree = ast.parse(cls.source)
        cls.main = next(
            ast.get_source_segment(cls.source, node) or ""
            for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "main"
        )
        cls.imports = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in (node.names if isinstance(node, ast.Import) else [ast.alias(node.module or "")])
        }

    def test_no_pattern_based_process_kill(self):
        for banned in ("pkill", "killall", "kill -9"):
            self.assertNotIn(
                banned, self.source,
                f"{banned!r} kills by name or pattern and would reach processes this server does not own.",
            )

    def test_no_process_tree_machinery(self):
        self.assertNotIn("psutil", self.imports)
        for gone in ("_install_shutdown_handlers", "_shutdown_sync", "_exit_process",
                     "_reap_orphaned_profiles", "os._exit"):
            self.assertNotIn(gone, self.source)

    def test_main_runs_the_maintenance_loop_and_keeps_stdout_for_json_rpc(self):
        self.assertIn("_maintenance_loop()", self.main)
        self.assertIn("sys.stdout = sys.stderr", self.main)
        self.assertIn("close_all_sessions()", self.main)


def _real_chat_anthropic():
    """browser-use 1.0's own ChatAnthropic class."""
    import browser_use

    return browser_use.ChatAnthropic


class TestResolveConfiguredLLM(unittest.TestCase):
    """
    _resolve_configured_llm / _resolve_agent_llm precedence and the settings
    layering (local > project > user). Runs under an isolated HOME and
    CLAUDE_PROJECT_DIR so the developer's real settings never interfere.
    """

    def setUp(self):
        import tempfile

        self.server = _make_server()
        self.home = Path(tempfile.mkdtemp())
        self.project = Path(tempfile.mkdtemp())
        (self.home / ".claude").mkdir(parents=True)
        (self.project / ".claude").mkdir(parents=True)
        self._orig_home = Path.home
        Path.home = staticmethod(lambda: self.home)

    def tearDown(self):
        import shutil

        Path.home = self._orig_home
        shutil.rmtree(self.home, ignore_errors=True)
        shutil.rmtree(self.project, ignore_errors=True)

    def _write_settings(self, path: Path, agent_model: dict):
        path.write_text(json.dumps({"browser-use": {"agentModel": agent_model}}))

    def _env(self, **extra):
        base = {"CLAUDE_PROJECT_DIR": str(self.project)}
        base.update(extra)
        return base

    def test_nothing_set_returns_none_and_default_is_anthropic(self):
        env = {k: v for k, v in os.environ.items()
               if k not in ("CLAUDE_PROJECT_DIR", "BROWSER_USE_API_KEY")}
        with patch.dict(os.environ, env, clear=True):
            self.assertIsNone(self.server._resolve_configured_llm())
        # _DEFAULT_LLM is anthropic/claude-sonnet-5
        self.assertEqual(_mod._DEFAULT_LLM.provider, "anthropic")
        self.assertEqual(_mod._DEFAULT_LLM.model, "claude-sonnet-5")

    def test_legacy_shim_only_browser_use_api_key(self):
        with patch.dict(os.environ, self._env(BROWSER_USE_API_KEY="bu-key"), clear=True):
            choice = self.server._resolve_configured_llm()
        self.assertIsNotNone(choice)
        self.assertEqual(choice.provider, "browser_use")
        self.assertEqual(choice.model, "bu-fast")

    def test_legacy_shim_respects_agent_model_env(self):
        with patch.dict(
            os.environ,
            self._env(BROWSER_USE_API_KEY="bu-key", BROWSER_USE_AGENT_MODEL="bu-max"),
            clear=True,
        ):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.model, "bu-max")

    def test_settings_agent_model_beats_legacy_shim(self):
        self._write_settings(
            self.home / ".claude" / "settings.json",
            {"provider": "openai", "model": "gpt-5"},
        )
        # Even with the legacy key present, settings config wins.
        with patch.dict(os.environ, self._env(BROWSER_USE_API_KEY="bu-key"), clear=True):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.provider, "openai")
        self.assertEqual(choice.model, "gpt-5")

    def test_settings_layer_local_beats_project_beats_user(self):
        self._write_settings(
            self.home / ".claude" / "settings.json",
            {"provider": "anthropic", "model": "user-model"},
        )
        self._write_settings(
            self.project / ".claude" / "settings.json",
            {"provider": "openai", "model": "project-model"},
        )
        self._write_settings(
            self.project / ".claude" / "settings.local.json",
            {"provider": "openai_compatible", "model": "local-model", "baseUrl": "http://x/v1"},
        )
        with patch.dict(os.environ, self._env(), clear=True):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.provider, "openai_compatible")
        self.assertEqual(choice.model, "local-model")
        self.assertEqual(choice.base_url, "http://x/v1")

    def test_settings_layer_partial_merge_fills_missing_keys(self):
        # user sets provider+model; local sets only temperature + baseUrl.
        self._write_settings(
            self.home / ".claude" / "settings.json",
            {"provider": "openai", "model": "gpt-5"},
        )
        (self.project / ".claude" / "settings.local.json").write_text(
            json.dumps({"browser-use": {"agentModel": {"temperature": 0.4, "baseUrl": "http://p/v1"}}})
        )
        with patch.dict(os.environ, self._env(), clear=True):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.provider, "openai")
        self.assertEqual(choice.model, "gpt-5")
        self.assertEqual(choice.temperature, 0.4)
        self.assertEqual(choice.base_url, "http://p/v1")

    def test_maps_json_keys_to_choice_fields(self):
        self._write_settings(
            self.home / ".claude" / "settings.json",
            {
                "provider": "openai_compatible",
                "model": "llama-3",
                "baseUrl": "http://localhost:1234/v1",
                "apiKeyEnv": "MY_KEY",
                "temperature": 0.2,
            },
        )
        with patch.dict(os.environ, self._env(), clear=True):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.base_url, "http://localhost:1234/v1")
        self.assertEqual(choice.api_key_env, "MY_KEY")
        self.assertEqual(choice.temperature, 0.2)

    def test_malformed_settings_file_is_skipped(self):
        (self.home / ".claude" / "settings.json").write_text("{ not valid json ")
        with patch.dict(os.environ, self._env(BROWSER_USE_API_KEY="bu-key"), clear=True):
            choice = self.server._resolve_configured_llm()
        # Falls through to the legacy shim rather than raising.
        self.assertEqual(choice.provider, "browser_use")

    def test_session_override_wins_in_resolve_agent_llm(self):
        # Even with settings + legacy present, an explicit override is used.
        self._write_settings(
            self.home / ".claude" / "settings.json",
            {"provider": "openai", "model": "gpt-5"},
        )
        self.server._session_llm_override = _mod.LLMChoice(
            provider="anthropic", model="override-model"
        )
        with patch.dict(
            os.environ,
            self._env(BROWSER_USE_API_KEY="bu-key", ANTHROPIC_API_KEY="sk-ant"),
            clear=True,
        ):
            llm = self.server._resolve_agent_llm()
        self.assertIsInstance(llm, _real_chat_anthropic())
        self.assertEqual(llm.model, "override-model")

    def test_resolve_agent_llm_falls_back_to_default(self):
        with patch.dict(os.environ, self._env(ANTHROPIC_API_KEY="sk-ant"), clear=True):
            llm = self.server._resolve_agent_llm()
        self.assertIsInstance(llm, _real_chat_anthropic())
        self.assertEqual(llm.model, "claude-sonnet-5")


# ---------------------------------------------------------------------------
# Chromium binary resolution (browser_env._resolve_chromium_binary)
# ---------------------------------------------------------------------------

# The one path that must never come back from binary resolution.
_HIJACK_PATH_FRAGMENT = "Google Chrome.app"


def _current_platform_key() -> str:
    """Map sys.platform onto the three Playwright cache layouts."""
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("win"):
        return "win32"
    return "linux"


def _make_fake_chromium(
    cache_root: Path,
    revision: int,
    platform_key: str,
    mac_dir: str = "chrome-mac-arm64",
    mac_bundle: str = "Google Chrome for Testing",
) -> Path:
    """
    Create one fake, finished Playwright chromium install under cache_root and
    return the binary path.  Layouts mirror what Playwright actually ships today:

        darwin: chromium-<rev>/chrome-mac-arm64/<Bundle>.app/Contents/MacOS/<Bundle>
        linux : chromium-<rev>/chrome-linux/chrome
        win32 : chromium-<rev>/chrome-win/chrome.exe

    Finished means the markers Playwright writes: INSTALLATION_COMPLETE, and on
    Linux DEPENDENCIES_VALIDATED. The resolver launches no revision without them.
    """
    rev_dir = cache_root / f"chromium-{revision}"
    if platform_key == "darwin":
        binary = rev_dir / mac_dir / f"{mac_bundle}.app" / "Contents" / "MacOS" / mac_bundle
    elif platform_key == "win32":
        binary = rev_dir / "chrome-win" / "chrome.exe"
    else:
        binary = rev_dir / "chrome-linux" / "chrome"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    (rev_dir / "INSTALLATION_COMPLETE").write_text("")
    if platform_key == "linux":
        (rev_dir / "DEPENDENCIES_VALIDATED").write_text("")
    return binary


@contextlib.contextmanager
def _chromium_env(cache_root=None, chrome_executable=None):
    """
    Deterministic environment for binary resolution: both env vars are cleared
    first so a developer's real shell cannot leak in, then set as requested.
    patch.dict restores deletions as well as additions on exit.
    """
    with patch.dict(os.environ, {}):
        os.environ.pop("CHROME_EXECUTABLE_PATH", None)
        os.environ.pop("PLAYWRIGHT_BROWSERS_PATH", None)
        if cache_root is not None:
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(cache_root)
        if chrome_executable is not None:
            os.environ["CHROME_EXECUTABLE_PATH"] = str(chrome_executable)
        yield


@contextlib.contextmanager
def _captured_streams():
    """
    Collect stdout and stderr separately for the duration of the block.

    Both streams matter for the resolver's CHROME_EXECUTABLE_PATH advisory: it
    must reach stderr, and it must NOT reach stdout — MCP speaks JSON-RPC over
    stdout, so a stray print there corrupts the protocol for every tool call.
    """
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        yield out, err


@contextlib.contextmanager
def _hermetic_chromium_cache():
    """
    A throwaway Playwright cache containing exactly one Chromium build.

    A test that resolves the binary would otherwise pass or fail on whether the
    developer's machine happens to have Playwright installed, and error on a
    fresh CI runner. Points
    PLAYWRIGHT_BROWSERS_PATH at the fixture so the real ~/Library/Caches or
    ~/.cache copy is never touched.
    """
    cache = Path(_tempfile.mkdtemp(prefix="magus-chromium-fixture-")).resolve()
    try:
        _make_fake_chromium(cache, 1234, _current_platform_key())
        with _chromium_env(cache_root=cache):
            yield cache
    finally:
        _shutil.rmtree(cache, ignore_errors=True)


class _TempDirMixin(unittest.TestCase):
    """Temp directories that clean themselves up, resolved to their real path."""

    def _tmpdir(self) -> Path:
        tmp = Path(_tempfile.mkdtemp(prefix="magus-chromium-test-")).resolve()
        self.addCleanup(_shutil.rmtree, tmp, ignore_errors=True)
        return tmp

    def _resolver(self):
        """
        Return mcp-server.py's _resolve_chromium_binary, or fail with the reason.
        """
        fn = getattr(_mod, "_resolve_chromium_binary", None)
        if fn is None:
            self.fail(
                "mcp-server.py must define _resolve_chromium_binary(): binary selection "
                "cannot be delegated to upstream, whose channel='chromium' is only a soft "
                "preference and silently falls through to /Applications/Google Chrome.app"
            )
        return fn


# ---------------------------------------------------------------------------
# Test 13a: _resolve_chromium_binary — never returns the user's real Chrome
# ---------------------------------------------------------------------------

class TestResolveChromiumBinary(_TempDirMixin):
    """
    Binary resolution must be owned by mcp-server.py, assert on the RESOLVED
    PATH (not on a profile setting), and have no code path that can return the
    user's real Chrome.
    """

    def test_empty_playwright_cache_raises_instead_of_using_real_chrome(self):
        """
        THE regression test for this bug: an empty Playwright cache must be a
        loud, actionable error — never a silent fall-through to the user's Chrome.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        empty_cache = self._tmpdir()  # exists, contains no chromium-* at all

        # A path that looks exactly like the user's real Chrome — the binary
        # upstream's prioritized+rest loop degrades to when every glob misses.
        decoy_root = self._tmpdir()
        decoy = decoy_root / "Applications" / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome"
        decoy.parent.mkdir(parents=True, exist_ok=True)
        decoy.write_text("#!/bin/sh\nexit 0\n")
        decoy.chmod(0o755)

        with _chromium_env(cache_root=empty_cache):
            with self.assertRaises(RuntimeError) as ctx:
                resolved = resolve()
                # Only reached when it did NOT raise. Name the hijack explicitly
                # before the context manager reports "RuntimeError not raised".
                self.assertNotIn(
                    _HIJACK_PATH_FRAGMENT,
                    str(resolved),
                    "_resolve_chromium_binary() returned the user's real Chrome "
                    f"({resolved!r}) when Playwright's cache was empty. This is the "
                    "macOS single-instance hijack: it steals the com.google.Chrome "
                    "slot so the user's own Chrome icon reopens the automation window.",
                )

        self.assertIn(
            "magus doctor --fix",
            str(ctx.exception).lower(),
            "The error must name the remedy (magus doctor --fix). "
            f"Got: {str(ctx.exception)!r}",
        )

    def test_resolves_binary_under_playwright_cache_on_every_layout(self):
        """
        Happy path across all three current Playwright layouts.  The macOS cases
        include a differently-named .app bundle to prove the resolver globs the
        bundle instead of hardcoding 'Google Chrome for Testing' — hardcoding is
        what went stale upstream and caused this bug.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cases = [
            (
                "darwin",
                {"mac_dir": "chrome-mac-arm64", "mac_bundle": "Google Chrome for Testing"},
                "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/"
                "Google Chrome for Testing",
            ),
            (
                # Wildcard-friendly: a bundle Playwright has never shipped under
                # this name. A hardcoded bundle name fails here.
                "darwin",
                {"mac_dir": "chrome-mac", "mac_bundle": "Chromium Nightly"},
                "chrome-mac/Chromium Nightly.app/Contents/MacOS/Chromium Nightly",
            ),
            ("linux", {}, "chrome-linux/chrome"),
            ("win32", {}, "chrome-win/chrome.exe"),
        ]

        for platform_key, layout_kwargs, expected_suffix in cases:
            with self.subTest(platform=platform_key, layout=expected_suffix):
                cache = self._tmpdir()
                expected = _make_fake_chromium(cache, 1234, platform_key, **layout_kwargs)

                with _chromium_env(cache_root=cache), patch.object(sys, "platform", platform_key):
                    resolved = str(resolve())

                self.assertTrue(
                    resolved.startswith(str(cache)),
                    f"Resolved binary must live under the Playwright cache {str(cache)!r}. "
                    f"Got: {resolved!r}",
                )
                self.assertIn(
                    expected_suffix,
                    resolved.replace("\\", "/"),
                    f"Expected the {platform_key} layout binary {str(expected)!r}. "
                    f"Got: {resolved!r}",
                )
                self.assertNotIn(
                    _HIJACK_PATH_FRAGMENT,
                    resolved,
                    f"Resolution must never return the user's real Chrome. Got: {resolved!r}",
                )

    def test_revisions_are_ordered_numerically_not_lexicographically(self):
        """
        chromium-1234 beats chromium-999.  Upstream does matches.sort() then
        matches[-1], which picks the older build the moment the revision number
        changes digit width.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cache = self._tmpdir()
        _make_fake_chromium(cache, 999, "linux")
        _make_fake_chromium(cache, 1234, "linux")

        with _chromium_env(cache_root=cache), patch.object(sys, "platform", "linux"):
            resolved = str(resolve())

        self.assertIn(
            "chromium-1234",
            resolved,
            "Revision 1234 is newer than 999 and must win. A lexicographic sort() "
            f"picks 'chromium-999'. Got: {resolved!r}",
        )
        self.assertNotIn("chromium-999", resolved, f"Got the older revision: {resolved!r}")

    def test_chrome_executable_path_env_wins_over_playwright_cache(self):
        """
        CHROME_EXECUTABLE_PATH is documented as the browser override, so an
        existing file it names must be returned ahead of any cache hit.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        override_dir = self._tmpdir()
        override = override_dir / "my-chromium"
        override.write_text("#!/bin/sh\nexit 0\n")
        override.chmod(0o755)

        with _chromium_env(cache_root=cache, chrome_executable=override):
            resolved = resolve()

        self.assertEqual(
            str(Path(resolved).resolve()),
            str(override.resolve()),
            "CHROME_EXECUTABLE_PATH must take precedence over the Playwright cache. "
            f"Got: {resolved!r}",
        )

    def test_chrome_executable_path_pointing_nowhere_raises(self):
        """
        A bad CHROME_EXECUTABLE_PATH must be a hard error naming the bad value —
        never a silent fall-through to cache discovery or to the user's Chrome.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        bogus = self._tmpdir() / "no-such-chromium-binary"
        self.assertFalse(bogus.exists(), "precondition: the override must not exist")

        with _chromium_env(cache_root=cache, chrome_executable=bogus):
            with self.assertRaises(RuntimeError) as ctx:
                resolved = resolve()
                self.fail(
                    "A nonexistent CHROME_EXECUTABLE_PATH must raise, not silently fall "
                    f"back. Got: {resolved!r}"
                )

        self.assertIn(
            str(bogus),
            str(ctx.exception),
            f"The error must name the bad value {str(bogus)!r}. Got: {str(ctx.exception)!r}",
        )

    def test_chrome_executable_path_pointing_at_a_directory_raises(self):
        """
        A directory is not an executable, and exists() cannot tell them apart.

        This is the macOS trap: `/Applications/Google Chrome.app` is the obvious
        thing to type into CHROME_EXECUTABLE_PATH — it exists, it is what Finder
        shows, and it is a bundle DIRECTORY whose binary sits two levels inside at
        Contents/MacOS/. An exists()-only check accepts it and hands upstream a
        path no browser can be launched from, so the failure surfaces later and
        somewhere else. The resolver requires is_file() and says so.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        # A local stand-in for /Applications/Google Chrome.app, complete with the
        # binary inside it. Built in a temp dir on purpose: the test must not
        # depend on the machine running it having a real Chrome installed.
        bundle = self._tmpdir() / "Applications" / "Google Chrome.app"
        (bundle / "Contents" / "MacOS").mkdir(parents=True, exist_ok=True)
        inner = bundle / "Contents" / "MacOS" / "Google Chrome"
        inner.write_text("#!/bin/sh\nexit 0\n")
        inner.chmod(0o755)
        self.assertTrue(bundle.is_dir(), "precondition: the override must BE a directory")

        with _chromium_env(cache_root=cache, chrome_executable=bundle):
            with self.assertRaises(RuntimeError) as ctx:
                resolved = resolve()
                self.fail(
                    "A CHROME_EXECUTABLE_PATH naming a directory must raise. It must not "
                    "be returned as if it were an executable, and it must not silently "
                    f"fall through to the Playwright cache either. Got: {resolved!r}"
                )

        message = str(ctx.exception)
        self.assertIn(
            str(bundle),
            message,
            f"The error must name the offending path {str(bundle)!r}. Got: {message!r}",
        )
        self.assertIn(
            "directory",
            message.lower(),
            "The error must diagnose it AS a directory and point at the binary inside "
            "the bundle. Dropping the is_dir() check would send this path to the "
            "'does not exist' branch, which raises the same RuntimeError while telling "
            f"the user something false and unactionable. Got: {message!r}",
        )

    def test_override_outside_playwright_cache_warns_but_still_returns(self):
        """
        An override that is not a Playwright Chromium is legitimate — it is the
        user asking for that browser out loud — but it must never be invisible:
        .env.example once shipped the user's real Chrome as its example value, and
        on macOS driving a real Chrome.app also seizes its single-instance slot.

        The advisory is an advisory. It must not become a refusal, so the path is
        still returned; and it goes to stderr, never stdout, because stdout
        carries MCP's JSON-RPC.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        override = self._tmpdir() / "Google Chrome"
        override.write_text("#!/bin/sh\nexit 0\n")
        override.chmod(0o755)
        self.assertNotIn(
            "ms-playwright",
            str(override),
            "precondition: the override must live outside Playwright's cache",
        )

        with _chromium_env(cache_root=cache, chrome_executable=override):
            with _captured_streams() as (out, err):
                resolved = resolve()

        self.assertEqual(
            str(Path(resolved).resolve()),
            str(override.resolve()),
            "The advisory must not turn into a refusal — an explicit override is still "
            f"honoured and returned. Got: {resolved!r}",
        )

        warning = err.getvalue()
        self.assertIn(
            "CHROME_EXECUTABLE_PATH",
            warning,
            "The advisory must name the variable responsible so the user knows what to "
            f"unset. stderr was: {warning!r}",
        )
        self.assertIn(
            str(override),
            warning,
            f"The advisory must name the path it resolved to. stderr was: {warning!r}",
        )
        self.assertIn(
            "playwright",
            warning.lower(),
            "The advisory must say what this is NOT (a Playwright Chromium) — that is "
            f"the whole point of the warning. stderr was: {warning!r}",
        )
        self.assertEqual(
            out.getvalue(),
            "",
            "The advisory must go to stderr only. stdout carries MCP's JSON-RPC, so a "
            f"print there breaks every tool call. stdout was: {out.getvalue()!r}",
        )

    def test_override_inside_playwright_cache_returns_silently(self):
        """
        The mirror case: an override that IS a bundled Playwright Chromium is the
        expected browser, so warning about it would train the user to ignore the
        warning that matters.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        # 'ms-playwright' in the path is how the resolver tells a bundled Chromium
        # from the user's own browser, so the fixture cache must be named for it.
        cache = self._tmpdir() / "ms-playwright"
        cache.mkdir(parents=True)
        binary = _make_fake_chromium(cache, 1234, _current_platform_key())

        with _chromium_env(cache_root=cache, chrome_executable=binary):
            with _captured_streams() as (out, err):
                resolved = resolve()

        self.assertEqual(
            str(Path(resolved).resolve()),
            str(binary.resolve()),
            f"The override must still be returned unchanged. Got: {resolved!r}",
        )
        self.assertEqual(
            err.getvalue(),
            "",
            "An override that already IS a Playwright Chromium must resolve silently — "
            "warning on the normal case is how a warning stops being read. stderr was: "
            f"{err.getvalue()!r}",
        )
        self.assertEqual(
            out.getvalue(),
            "",
            f"Nothing may ever reach stdout. stdout was: {out.getvalue()!r}",
        )


class TestDoctorReportsChromiumResolution(_TempDirMixin, unittest.IsolatedAsyncioTestCase):
    """
    The doctor exists to diagnose exactly the failure this bug produced, so
    chromium_path alone is not enough: a path with no provenance cannot tell the
    user whether their CHROME_EXECUTABLE_PATH won or Playwright's cache did.

    The old doctor ran its own shutil.which() chain with the env override LAST,
    so it could confidently report a browser the launcher would never use.  It
    now calls _resolve_chromium_binary(), the same function the launcher calls,
    and reports chromium_source / chromium_error alongside the path.  Nothing
    else in the suite locks those two fields, so without this class a refactor
    could drop them and stay green.
    """

    async def _doctor(self) -> dict:
        """Run browser_doctor and return its parsed report."""
        return json.loads(await _make_server()._handle_doctor({}))

    async def test_doctor_reports_playwright_source_for_a_cache_hit(self):
        """
        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        resolve = self._resolver()

        with _hermetic_chromium_cache() as cache:
            expected = resolve()
            data = await self._doctor()

        self.assertEqual(
            data["chromium_path"],
            expected,
            "The doctor must report the launcher's own resolution. Reporting a "
            "separately-discovered browser is what let it show "
            "/Applications/Google Chrome.app as healthy. "
            f"Expected {expected!r}, got {data['chromium_path']!r}",
        )
        self.assertTrue(
            data["chromium_present"],
            f"A resolvable binary means chromium_present is true. Report: {data!r}",
        )
        self.assertEqual(
            data["chromium_source"],
            "playwright",
            "With no CHROME_EXECUTABLE_PATH set, the binary came from Playwright's "
            f"cache ({str(cache)!r}) and must be labelled 'playwright'. "
            f"Got: {data.get('chromium_source')!r}",
        )
        self.assertIsNone(
            data["chromium_error"],
            f"A successful resolution carries no error. Got: {data['chromium_error']!r}",
        )

    async def test_doctor_reports_env_source_when_the_override_is_set(self):
        """
        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        override = self._tmpdir() / "my-chromium"
        override.write_text("#!/bin/sh\nexit 0\n")
        override.chmod(0o755)

        with _chromium_env(cache_root=cache, chrome_executable=override):
            # The override sits outside Playwright's cache, so the resolver prints
            # its advisory; swallow it to keep the suite's own output readable.
            # The advisory's content is pinned by TestResolveChromiumBinary.
            with _captured_streams():
                data = await self._doctor()

        self.assertEqual(
            data["chromium_source"],
            "env",
            "CHROME_EXECUTABLE_PATH was set and won, so the report must say the binary "
            f"came from the environment, not the cache. Got: {data.get('chromium_source')!r}",
        )
        self.assertEqual(
            str(Path(data["chromium_path"]).resolve()),
            str(override.resolve()),
            f"The reported path must be the override. Got: {data['chromium_path']!r}",
        )
        self.assertTrue(data["chromium_present"], f"Report: {data!r}")
        self.assertIsNone(
            data["chromium_error"],
            f"A successful resolution carries no error. Got: {data['chromium_error']!r}",
        )

    async def test_doctor_survives_a_resolution_failure(self):
        """
        The case the doctor exists for.  'No Chromium anywhere' is precisely when
        a user runs browser_doctor, so a resolver RuntimeError must be caught and
        REPORTED, never propagated — a diagnostic that dies of the fault it was
        called to diagnose tells the user nothing.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium.
        """
        empty_cache = self._tmpdir()  # exists, contains no chromium-* at all

        with _chromium_env(cache_root=empty_cache):
            try:
                data = await self._doctor()
            except Exception as exc:  # noqa: BLE001 — the point is that nothing escapes
                self.fail(
                    "browser_doctor must not raise when Chromium cannot be resolved; it "
                    f"must report the failure. Got {type(exc).__name__}: {exc}"
                )

        self.assertFalse(
            data["chromium_present"],
            f"Nothing was resolvable, so chromium_present must be false. Report: {data!r}",
        )
        self.assertIsNone(
            data["chromium_path"],
            "There is no path to report — a placeholder here would read as a working "
            f"browser. Got: {data['chromium_path']!r}",
        )
        self.assertEqual(
            data["chromium_source"],
            "error",
            "A failed resolution is its own source; labelling it 'playwright' would "
            f"claim a cache hit that never happened. Got: {data.get('chromium_source')!r}",
        )
        self.assertTrue(
            data["chromium_error"],
            "chromium_error must carry the resolver's message — it is the only thing "
            f"telling the user what to do next. Got: {data['chromium_error']!r}",
        )
        self.assertIn(
            "magus doctor --fix",
            str(data["chromium_error"]).lower(),
            "The reported error must name the remedy (magus doctor --fix). "
            f"Got: {data['chromium_error']!r}",
        )


# ---------------------------------------------------------------------------
# browser-use 1.0: the real installed package, no stubs
# ---------------------------------------------------------------------------
#
# Each test below loads a fresh copy of the server against the package that is
# actually installed, constructs real browser_use objects, and fakes only the
# browser-harness daemon (the `_cdp` / `_meta` channel and Browser.start /
# Browser.stop).


_SERVER_PATH = Path(__file__).parent / "mcp-server.py"

# Modules and names browser-use 1.0 deleted. Any of them in the server source
# is a dependency on the 0.x API.
_REMOVED_0X_NAMES = (
    "browser_use.mcp.server",
    "browser_use.browser.events",
    "browser_use.tools.service",
    "browser_use.filesystem",
    "BrowserProfile",
    "BrowserSession",
    "get_default_profile",
    "load_browser_use_config",
)

# The exact pins the PEP 723 header must carry. browser-use 1.0.0 itself pins
# mcp==2.3.0, so any other mcp pin is unsatisfiable.
_EXPECTED_PINS = ["browser-use==1.0.0", "mcp==2.3.0", "playwright==1.63.0"]

# Variables that change what the server builds. Cleared for every test so the
# developer's shell cannot leak in.
_REAL_ENV_SCRUB = (
    "BROWSER_USE_CLOUD",
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_AGENT_MODEL",
    "BROWSER_USE_HEADLESS",
    "BROWSER_USE_ALLOWED_DOMAINS",
    "CHROME_EXECUTABLE_PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CLAUDE_PROJECT_DIR",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XDG_CONFIG_HOME",
    "BH_AGENT_WORKSPACE",
    "BH_CONFIG_DIR",
    "BH_RUNTIME_DIR",
    "BH_TMP_DIR",
    "BROWSER_HARNESS_HOME",
)


def _load_real_server(testcase: unittest.TestCase) -> object:
    """
    Load a fresh copy of mcp-server.py against the installed browser_use.

    A server that exits at import becomes a test failure that carries the
    server's own error line, rather than a bare SystemExit.
    """
    spec = importlib.util.spec_from_file_location("_mcp_server_real", _SERVER_PATH)
    mod = importlib.util.module_from_spec(spec)
    saved_argv = sys.argv
    sys.argv = ["mcp-server.py"]
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            spec.loader.exec_module(mod)
    except SystemExit as exc:
        testcase.fail(
            f"mcp-server.py exited at import (code {exc.code}) against the installed "
            f"browser_use: {err.getvalue().strip()}"
        )
    finally:
        sys.argv = saved_argv
    return mod


def _pep723_metadata() -> dict:
    """The server's PEP 723 `script` block, parsed as TOML."""
    text = _SERVER_PATH.read_text()
    match = re.search(r"^# /// script\n(.*?)^# ///$", text, re.S | re.M)
    if match is None:
        raise AssertionError("mcp-server.py has no PEP 723 `# /// script` block")
    body = "\n".join(
        line[2:] if line.startswith("# ") else line[1:]
        for line in match.group(1).splitlines()
    )
    return tomllib.loads(body)


def _text_of(result) -> str:
    """A tool result as one string, whether the handler returned str or content."""
    if isinstance(result, str):
        return result
    return "\n".join(getattr(item, "text", "") or "" for item in result or ())


class _FakeAxCdp:
    """
    A CDP callable shaped like the one browser_use.ax.AxHelpers takes. It
    answers just enough for click and type to run to completion, which is the
    point where AxHelpers writes its action line through `log`.
    """

    def __init__(self):
        self.methods: list[str] = []

    def __call__(self, method, session_id=None, **params):
        self.methods.append(method)
        if method == "DOM.resolveNode":
            return {"object": {"objectId": "fake-object"}}
        if method == "Runtime.callFunctionOn":
            return {"result": {"value": {
                "x": 5, "y": 5, "covered": False, "tag": "INPUT", "type": "text",
            }}}
        if method == "Runtime.evaluate":
            return {"result": {"value": {
                "ready": "complete", "idle": 10_000, "doc": "doc", "url": "about:blank", "n": 1,
            }}}
        return {}


@contextlib.contextmanager
def _fresh_harness_helpers():
    """
    Evict browser_harness.helpers so the next import re-runs its import-time
    code (the .env loading and the agent workspace's agent_helpers.py), then
    put back whatever was there before.
    """
    import browser_harness

    saved_module = sys.modules.pop("browser_harness.helpers", None)
    had_attr = "helpers" in vars(browser_harness)
    saved_attr = vars(browser_harness).get("helpers")
    if had_attr:
        delattr(browser_harness, "helpers")
    try:
        yield
    finally:
        sys.modules.pop("browser_harness.helpers", None)
        if "helpers" in vars(browser_harness):
            delattr(browser_harness, "helpers")
        if saved_module is not None:
            sys.modules["browser_harness.helpers"] = saved_module
        if had_attr:
            browser_harness.helpers = saved_attr


class _RealBrowserUseTestCase(unittest.TestCase):
    """
    Hermetic environment for tests against the real package: HOME is a temp
    dir (no settings.json, no ~/.config/browseruse) and BH_HOME is a short /tmp
    dir (the harness daemon socket path has a ~104-byte cap on macOS).
    """

    def setUp(self):
        super().setUp()
        if importlib.util.find_spec("browser_use") is None:
            if os.environ.get("CI"):
                self.fail("browser_use must be installed under CI")
            self.skipTest("browser_use is not installed")
        self._home = self._tmp()
        bh_home = Path(_tempfile.mkdtemp(prefix="bh", dir="/tmp"))
        self.addCleanup(_shutil.rmtree, bh_home, ignore_errors=True)
        self.enterContext(patch.dict(os.environ, {}))
        for key in _REAL_ENV_SCRUB:
            os.environ.pop(key, None)
        os.environ["HOME"] = str(self._home)
        os.environ["BH_HOME"] = str(bh_home)

    def _tmp(self) -> Path:
        tmp = Path(_tempfile.mkdtemp(prefix="magus-bu1-test-")).resolve()
        self.addCleanup(_shutil.rmtree, tmp, ignore_errors=True)
        return tmp

    def _server_function(self, mod, name: str, purpose: str):
        fn = getattr(mod, name, None)
        if fn is None:
            self.fail(f"mcp-server.py must define {name}(): {purpose}")
        return fn


class TestHeaderPinsBrowserUse10(unittest.TestCase):
    """The PEP 723 header is the one place versions live, and it must resolve."""

    def test_header_pins_browser_use_1_0(self):
        deps = _pep723_metadata().get("dependencies", [])
        self.assertEqual(sorted(deps), sorted(_EXPECTED_PINS))

        if _shutil.which("uv") is None:
            if os.environ.get("CI"):
                self.fail("uv is required under CI: it is what proves the pins resolve")
            self.skipTest("uv is not on PATH")
        proc = subprocess.run(
            ["uv", "pip", "compile", "--no-config", "--quiet",
             "--python-version", "3.12", "-"],
            input="\n".join(deps) + "\n",
            capture_output=True,
            text=True,
            timeout=600,
        )
        self.assertEqual(
            proc.returncode, 0,
            f"the header's pins do not resolve together: {proc.stderr.strip()}",
        )


class TestNoRemoved0xImports(_RealBrowserUseTestCase):
    """The server must not name any part of the API browser-use 1.0 deleted."""

    def test_no_removed_0x_imports(self):
        source = _SERVER_PATH.read_text()
        present = [name for name in _REMOVED_0X_NAMES if name in source]
        self.assertEqual(present, [], f"mcp-server.py still names removed 0.x API: {present}")
        mod = _load_real_server(self)
        self.assertTrue(hasattr(mod, "MagusBrowserServer"))


class TestLocalBrowserOptions(_RealBrowserUseTestCase):
    """
    _browser_options() is the keyword set for the browser_use.Browser a session
    starts. A local session is always kind "chromium" with our resolved binary:
    1.0's own binary search tries /Applications/Google Chrome.app first.
    """

    def test_local_browser_options_build_a_real_chromium_Browser(self):
        mod = _load_real_server(self)
        import browser_use

        options = self._server_function(
            mod, "_browser_options",
            "the keyword arguments of the browser_use.Browser a session starts",
        )
        tmp = self._tmp()
        cache = tmp / "ms-playwright"
        binary = _make_fake_chromium(cache, 1234, _current_platform_key())

        with self.subTest("Playwright Chromium, headed by default"):
            with _chromium_env(cache_root=cache), _captured_streams() as (out, _err):
                opts = options()
                browser = browser_use.Browser(**opts)
            self.assertEqual(opts.get("kind"), "chromium")
            self.assertEqual(Path(opts["executable_path"]).resolve(), binary.resolve())
            self.assertIs(opts.get("headless"), False)
            self.assertIsNone(opts.get("user_data_dir"))
            self.assertEqual(browser.kind, "chromium")
            self.assertFalse(browser.use_cloud)
            self.assertEqual(Path(browser.executable_path).resolve(), binary.resolve())
            self.assertEqual(out.getvalue(), "")

        with self.subTest("BROWSER_USE_HEADLESS=true"):
            with _chromium_env(cache_root=cache), \
                    patch.dict(os.environ, {"BROWSER_USE_HEADLESS": "true"}):
                opts = options()
                browser_use.Browser(**opts)
            self.assertIs(opts.get("headless"), True)

        with self.subTest("CHROME_EXECUTABLE_PATH wins over the Playwright cache"):
            override = tmp / "override" / "chrome"
            override.parent.mkdir(parents=True)
            override.write_text("#!/bin/sh\nexit 0\n")
            override.chmod(0o755)
            with _chromium_env(cache_root=cache, chrome_executable=override), \
                    _captured_streams() as (out, _err):
                opts = options()
                browser_use.Browser(**opts)
            self.assertEqual(Path(opts["executable_path"]).resolve(), override.resolve())
            self.assertEqual(out.getvalue(), "")

        with self.subTest("no Chromium anywhere names magus doctor --fix"):
            empty = tmp / "empty-cache"
            empty.mkdir()
            with _chromium_env(cache_root=empty), self.assertRaises(Exception) as cm:
                options()
            self.assertIn("magus doctor --fix", str(cm.exception))

        with self.subTest("BROWSER_USE_CLOUD=true is a cloud Browser with no local options"):
            with _chromium_env(cache_root=cache), patch.dict(
                os.environ, {"BROWSER_USE_CLOUD": "true", "BROWSER_USE_API_KEY": "bu-test-key"}
            ):
                opts = options()
                browser = browser_use.Browser(**opts)
            self.assertIs(opts.get("use_cloud"), True)
            for local_only in ("executable_path", "headless", "user_data_dir"):
                self.assertNotIn(local_only, opts)
            self.assertNotEqual(opts.get("kind"), "chromium")
            self.assertEqual(browser.kind, "cloud")


class TestBuildLLMReal10(_RealBrowserUseTestCase):
    """_build_llm must build browser-use 1.0's own Chat classes."""

    def test_build_llm_with_real_1_0_classes(self):
        mod = _load_real_server(self)
        import browser_use

        choice = mod.LLMChoice
        os.environ.update({
            "ANTHROPIC_API_KEY": "anthropic-test-key",
            "OPENAI_API_KEY": "openai-test-key",
            "COMPAT_TEST_KEY": "compat-test-key",
            "BROWSER_USE_API_KEY": "bu-test-key",
        })
        cases = (
            ("anthropic", choice(provider="anthropic", model="claude-test", temperature=0.4),
             browser_use.ChatAnthropic),
            ("openai", choice(provider="openai", model="gpt-test", temperature=0.4),
             browser_use.ChatOpenAI),
            ("openai_compatible", choice(
                provider="openai_compatible", model="local-test",
                base_url="http://127.0.0.1:1234/v1", api_key_env="COMPAT_TEST_KEY",
                temperature=0.4,
            ), browser_use.ChatOpenAI),
            ("browser_use", choice(provider="browser_use", model="bu-fast", temperature=0.4),
             browser_use.ChatBrowserUse),
        )
        for label, llm_choice, chat_cls in cases:
            with self.subTest(label):
                llm = mod._build_llm(llm_choice)
                self.assertIsInstance(llm, chat_cls)
                if label in ("openai", "openai_compatible"):
                    self.assertEqual(llm.temperature, 0.4)
                else:
                    self.assertIsNone(getattr(llm, "temperature", None))
                if label == "openai_compatible":
                    self.assertEqual(llm.base_url, "http://127.0.0.1:1234/v1")
                    self.assertEqual(llm.api_key, "compat-test-key")

        with self.subTest("anthropic with base_url is our error, not the class's"):
            with patch.object(browser_use, "ChatAnthropic") as chat_cls:
                with self.assertRaises(Exception) as cm:
                    mod._build_llm(choice(
                        provider="anthropic", model="claude-test",
                        base_url="https://proxy.example/v1",
                    ))
            chat_cls.assert_not_called()
            self.assertNotIsInstance(cm.exception, TypeError)
            self.assertIn("base_url", str(cm.exception))

        with self.subTest("BROWSER_USE_API_KEY alone resolves to bu-fast"):
            for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
                os.environ.pop(key, None)
            server = mod.MagusBrowserServer()
            resolved = server._resolve_configured_llm()
            self.assertIsNotNone(resolved)
            self.assertEqual((resolved.provider, resolved.model), ("browser_use", "bu-fast"))
            self.assertIsInstance(mod._build_llm(resolved), browser_use.ChatBrowserUse)


class TestRetryAgentBrowser(_RealBrowserUseTestCase):
    """
    retry_with_browser_use_agent must hand browser_use.Agent a local Chromium
    Browser. Agent's own default browser is a billed cloud browser.
    """

    def test_retry_agent_never_uses_a_cloud_or_default_browser(self):
        mod = _load_real_server(self)
        import browser_use

        os.environ["ANTHROPIC_API_KEY"] = "anthropic-test-key"
        tmp = self._tmp()
        cache = tmp / "ms-playwright"
        binary = _make_fake_chromium(cache, 1234, _current_platform_key())
        agents: list = []

        class _FakeHistory:
            def number_of_steps(self):
                return 7

            def is_successful(self):
                return True

            def final_result(self):
                return "the final answer"

            def errors(self):
                return []

        class _RecordingAgent:
            def __init__(self, task=None, llm=None, **kwargs):
                self.task, self.llm, self.kwargs = task, llm, kwargs
                self.max_steps = None
                agents.append(self)

            async def run(self, max_steps=100, **_kwargs):
                self.max_steps = max_steps
                return _FakeHistory()

            async def close(self):
                return None

        def run_tool(arguments):
            async def scenario():
                server = mod.MagusBrowserServer()
                return await server._execute_tool("retry_with_browser_use_agent", arguments)

            agents.clear()
            with contextlib.ExitStack() as stack:
                stack.enter_context(_chromium_env(cache_root=cache))
                stack.enter_context(patch.object(browser_use, "Agent", _RecordingAgent))
                # A server that still runs the 0.x upstream handler reads the
                # Agent name it imported into its own module. Replace that copy
                # too, so this test can never start a real agent, a real browser
                # or a billed model call; it fails on the assertions below instead.
                # sys.modules.get never triggers 1.0's removed-module finder.
                upstream = sys.modules.get("browser_use.mcp.server")
                if upstream is not None and hasattr(upstream, "Agent"):
                    stack.enter_context(patch.object(upstream, "Agent", _RecordingAgent))
                text = _text_of(asyncio.run(scenario()))
            self.assertEqual(len(agents), 1, f"browser_use.Agent was not constructed once; tool said: {text}")
            agent = agents[0]
            browser = agent.kwargs.get("browser") or agent.kwargs.get("browser_session")
            self.assertIsInstance(browser, browser_use.Browser, f"Agent got browser={browser!r}")
            self.assertEqual(browser.kind, "chromium")
            self.assertFalse(browser.use_cloud)
            self.assertEqual(Path(browser.executable_path).resolve(), binary.resolve())
            self.assertIsNotNone(agent.llm)
            return agent, browser, text

        with self.subTest("defaults: no domains, vision left to Agent"):
            agent, browser, text = run_tool({"task": "find the title", "max_steps": 5})
            self.assertEqual(agent.task, "find the title")
            self.assertEqual(agent.max_steps, 5)
            self.assertEqual(tuple(browser.domains.allowed), ())
            self.assertNotIn("use_vision", agent.kwargs)
            self.assertRegex(text, r"\b7\b")
            self.assertIn("the final answer", text)
            self.assertNotRegex(text, r"(?i)\burls?\b")

        with self.subTest("non-empty allowed_domains and use_vision=False are forwarded"):
            agent, browser, _text = run_tool({
                "task": "t", "allowed_domains": ["example.com"], "use_vision": False,
            })
            self.assertIn("example.com", repr(browser.domains.allowed))
            self.assertIs(agent.kwargs.get("use_vision"), False)

        with self.subTest("an empty allowed_domains list is not forwarded"):
            _agent, browser, _text = run_tool({"task": "t", "allowed_domains": []})
            self.assertEqual(tuple(browser.domains.allowed), ())


class TestAxHelpersStdout(_RealBrowserUseTestCase):
    """
    browser_use.ax.AxHelpers logs every action line through `log`, which
    defaults to print. On an MCP stdio server that line corrupts JSON-RPC.
    """

    def test_ax_helpers_never_print_to_stdout(self):
        mod = _load_real_server(self)
        make = self._server_function(
            mod, "_make_ax_helpers",
            "the one place AxHelpers is built for a CDP callable, with its log kept off stdout",
        )
        fake = _FakeAxCdp()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            ax = make(fake)
            ax.click(42)
            ax.type(42, "hello")
        self.assertIn("Input.dispatchMouseEvent", fake.methods)
        self.assertIn("Input.insertText", fake.methods)
        self.assertEqual(out.getvalue(), "", "AxHelpers wrote to stdout")

        # Control: the library default does print here, so the check above can fail.
        from browser_use.ax import AxHelpers

        control = io.StringIO()
        with contextlib.redirect_stdout(control):
            AxHelpers(_FakeAxCdp()).click(42)
        self.assertIn("[ok] click", control.getvalue())


class TestHarnessHelpersImportIsolated(_RealBrowserUseTestCase):
    """
    Importing browser_harness.helpers execs <agent workspace>/agent_helpers.py
    and copies its public names into the module, and loads the workspace .env.
    The server's import must not run a user's file: one that prints corrupts
    JSON-RPC, and one that replaces click changes what the tools do.
    """

    def test_workspace_agent_helpers_cannot_print_or_replace_click(self):
        mod = _load_real_server(self)
        make = self._server_function(
            mod, "_make_ax_helpers",
            "the one place AxHelpers is built, importing browser_harness.helpers in isolation",
        )
        from browser_use.ax import AxHelpers

        library_click = AxHelpers.click
        self.addCleanup(setattr, AxHelpers, "click", library_click)

        workspace = self._tmp() / "agent-workspace"
        workspace.mkdir()
        (workspace / "agent_helpers.py").write_text(textwrap.dedent("""\
            print("agent_helpers.py ran and printed to stdout")
            from browser_use.ax import AxHelpers as _AxHelpers

            def click(*args, **kwargs):
                return "agent_helpers click"

            def _replaced_click(self, id):
                return "agent_helpers click"

            _AxHelpers.click = _replaced_click
            """))
        (workspace / ".env").write_text("MAGUS_TEST_WORKSPACE_DOTENV=leaked\n")
        os.environ["BH_AGENT_WORKSPACE"] = str(workspace)
        env_before = dict(os.environ)

        fake = _FakeAxCdp()
        out = io.StringIO()
        with _fresh_harness_helpers(), contextlib.redirect_stdout(out):
            ax = make(fake)
            helpers = sys.modules.get("browser_harness.helpers")
            ax.click(42)

        self.assertEqual(out.getvalue(), "", "the helpers import wrote to stdout")
        self.assertIs(AxHelpers.click, library_click, "agent_helpers.py replaced AxHelpers.click")
        self.assertIn("Input.dispatchMouseEvent", fake.methods)
        self.assertIsNotNone(helpers, "building AxHelpers must import browser_harness.helpers")
        self.assertNotIn("click", vars(helpers), "agent_helpers.py names reached browser_harness.helpers")
        self.assertEqual(dict(os.environ), env_before, "the helpers import changed os.environ")


class TestDownloadsDirOnPrimaryStart(_RealBrowserUseTestCase):
    """
    1.0 points Chrome's downloads at a directory only for Agent. Every primary
    start must set it to ~/.config/browseruse/downloads, away from the
    TCC-protected ~/Downloads, on the browser target's session.
    """

    def test_downloads_go_to_config_dir(self):
        mod = _load_real_server(self)
        import browser_use

        for name in ("_cdp", "_meta"):
            self._server_function(
                mod, name, "the browser-harness daemon channel every CDP call goes through",
            )
        tmp = self._tmp()
        cache = tmp / "ms-playwright"
        _make_fake_chromium(cache, 1234, _current_platform_key())
        calls: list = []

        def fake_cdp(name, method, session_id=None, **params):
            calls.append((name, method, session_id, params))
            if method == "Target.attachToBrowserTarget":
                return {"sessionId": "browser-target-session"}
            if method == "Runtime.evaluate":
                return {"result": {"value": "complete"}}
            if method == "Target.getTargets":
                return {"targetInfos": [
                    {"targetId": "TARGET0001", "type": "page", "url": "about:blank", "title": ""},
                ]}
            return {}

        def fake_meta(name, *args, **kwargs):
            return {"targetId": "TARGET0001", "url": "about:blank", "title": "",
                    "session_id": "page-session"}

        async def fake_start(browser):
            browser.name = "bufakedaemon"
            return browser

        async def fake_stop(browser):
            return None

        async def scenario():
            server = mod.MagusBrowserServer()
            try:
                return await server._execute_tool("browser_navigate", {"url": "about:blank"}), None
            except Exception as exc:  # reported below with the recorded calls
                return None, exc

        with _chromium_env(cache_root=cache), \
                patch.object(mod, "_cdp", fake_cdp), \
                patch.object(mod, "_meta", fake_meta), \
                patch.object(browser_use.Browser, "start", fake_start), \
                patch.object(browser_use.Browser, "stop", fake_stop):
            result, error = asyncio.run(scenario())

        methods = [c[1] for c in calls]
        context = f"tool result {result!r}, error {error!r}, CDP calls {methods}"
        self.assertIn("Target.attachToBrowserTarget", methods, context)
        self.assertIn("Browser.setDownloadBehavior", methods, context)
        self.assertLess(
            methods.index("Target.attachToBrowserTarget"),
            methods.index("Browser.setDownloadBehavior"),
            context,
        )
        name, _method, session_id, params = calls[methods.index("Browser.setDownloadBehavior")]
        self.assertEqual(name, "bufakedaemon")
        self.assertEqual(session_id, "browser-target-session")
        self.assertEqual(params.get("behavior"), "allow")
        self.assertEqual(
            params.get("downloadPath"),
            str(self._home / ".config" / "browseruse" / "downloads"),
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
