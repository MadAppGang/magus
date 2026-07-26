"""
Unit tests for mcp-server.py — validates the 3 bug fixes from browser-use#4548.

BUG 1 (TCC / downloads_path):
    The upstream BrowserUseServer uses ~/Downloads/browser-use-mcp as the
    downloads directory.  On macOS the ~/Downloads folder is protected by
    Transparency, Consent and Control (TCC); writing there without an explicit
    grant raises PermissionError.  Our fix redirects to
    ~/.config/browseruse/downloads.

BUG 2 (SingletonLock / user_data_dir):
    The upstream server uses a fixed user_data_dir, so two Claude Code sessions
    share the same Chrome profile directory.  Chrome writes a SingletonLock file
    there; the second session cannot start Chrome because the lock is held.  Our
    fix appends the process PID (session-<pid>) so every session gets its own
    profile directory.

BUG 3 (custom tools registration):
    The server must expose browser_export_session, browser_import_session,
    browser_run_script, browser_start_cloud_session, and
    browser_set_agent_model on top of the built-in tools.  Tests verify the
    list_tools handler returns them and that the total count is >= 21.

EXTRA (graceful shutdown):
    _install_shutdown_handlers() must register atexit and POSIX signal handlers.

v1.2.0 (dual local/cloud + lifecycle fixes):
    - _shutdown_sync must use session.kill() / _local_browser_watchdog._subprocess
      (under keep_alive=True only kill() terminates Chrome; the old
      session._browser/._process probing was dead code on browser-use 0.13.1).
    - _reap_orphaned_profiles() must remove session-{pid} dirs of dead PIDs
      (and only those) on startup.
    - Local sessions must force channel='chromium' (Playwright's bundled
      Chromium, never the user's real Chrome.app).
    - BROWSER_USE_CLOUD=true must build a use_cloud profile without local paths.

Configurable agent LLM (profiles-inference-redirect):
    - _build_llm() dispatches to the right Chat* class per provider, forwarding
      temperature/base_url/api_key by the provider's rules.
    - _resolve_configured_llm() layers settings.json (user < project < local)
      over the legacy BROWSER_USE_API_KEY shim, then _DEFAULT_LLM (anthropic).
    - browser_set_agent_model sets a per-session override and never leaks secrets.
"""

import atexit
import asyncio
import importlib.util
import json
import os
import signal
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

# ---------------------------------------------------------------------------
# Module loader — import mcp-server.py (hyphen in name, use importlib)
# ---------------------------------------------------------------------------

_STUB_NAMES = [
    "browser_use",
    "browser_use.mcp",
    "browser_use.mcp.server",
    "browser_use.browser",
    "browser_use.config",
    "browser_use.utils",
    "browser_use.tools",
    "browser_use.tools.service",
    "browser_use.filesystem",
    "browser_use.filesystem.file_system",
    "browser_use.llm",
    "browser_use.llm.openai",
    "browser_use.llm.openai.chat",
    "browser_use.llm.anthropic",
    "browser_use.llm.anthropic.chat",
    "browser_use.llm.browser_use",
    "browser_use.llm.browser_use.chat",
    "mcp",
    "mcp.server",
    "mcp.server.stdio",
    "mcp.server.models",
    "mcp.types",
]


def _make_stub(name: str) -> MagicMock:
    stub = MagicMock()
    stub.__name__ = name
    stub.__package__ = name
    stub.__path__ = []
    stub.__spec__ = importlib.util.spec_from_loader(name, loader=None)
    return stub


# ---------------------------------------------------------------------------
# Real stub base class — must be a genuine Python class so that:
#   class MagusBrowserServer(BrowserUseServer): ...
# creates a real class hierarchy that patch.object can modify.
# ---------------------------------------------------------------------------

class _StubBrowserUseServer:
    """
    Minimal stand-in for browser_use.mcp.server.BrowserUseServer.

    The real class does heavy MCP/asyncio setup in __init__. We replace it with
    a no-op that sets just the attributes MagusBrowserServer expects.
    """

    def __init__(self, *args, **kwargs):
        self.config = {}
        self.browser_session = None
        self.active_sessions = {}
        self.tools = None
        self.llm = None
        self.file_system = None
        self._telemetry = MagicMock()
        self._start_time = time.time()
        # MagusBrowserServer._extend_list_tools() accesses self.server.request_handlers
        # and calls @self.server.list_tools() as a decorator.
        mock_server = MagicMock()
        mock_server.request_handlers = {}
        mock_server.list_tools.return_value = lambda fn: fn
        self.server = mock_server

    async def _execute_tool(self, tool_name, arguments):
        """Default parent implementation (never reached in tests)."""
        return f"(stub) {tool_name}"

    def _track_session(self, session):
        """No-op session tracker."""
        pass


def _install_stubs() -> dict:
    """Inject lightweight module stubs so mcp-server.py can be imported."""
    saved = {}
    for name in _STUB_NAMES:
        saved[name] = sys.modules.get(name)
        sys.modules[name] = _make_stub(name)

    # browser_use.mcp.server: expose our real stub class as BrowserUseServer
    mcp_server_bu_stub = sys.modules["browser_use.mcp.server"]
    mcp_server_bu_stub.BrowserUseServer = _StubBrowserUseServer

    # browser_use.browser: realistic class stubs
    browser_stub = sys.modules["browser_use.browser"]
    browser_stub.BrowserProfile = MagicMock(name="BrowserProfile")
    browser_stub.BrowserSession = MagicMock(name="BrowserSession")

    # browser_use.config: helper functions
    config_stub = sys.modules["browser_use.config"]
    config_stub.get_default_llm = MagicMock(return_value={})
    config_stub.get_default_profile = MagicMock(return_value={})
    config_stub.load_browser_use_config = MagicMock(return_value={})

    # browser_use.utils
    utils_stub = sys.modules["browser_use.utils"]
    utils_stub.get_browser_use_version = MagicMock(return_value="0.0.0-test")
    # The recording chat classes _build_llm needs at RUNTIME are installed in
    # setUpModule() (see _install_chat_stub_modules) — not here, because these
    # load-time stubs get torn down by _restore_stubs() before tests run.

    # mcp.server: Server class + NotificationOptions
    mcp_server_stub = sys.modules["mcp.server"]
    mcp_server_stub.NotificationOptions = MagicMock(name="NotificationOptions")
    mcp_server_stub.Server = MagicMock(name="Server")

    # mcp.server.models: InitializationOptions
    mcp_models_stub = sys.modules["mcp.server.models"]
    mcp_models_stub.InitializationOptions = MagicMock(name="InitializationOptions")

    # mcp.types: Tool, TextContent, ImageContent, ListToolsRequest
    types_stub = sys.modules["mcp.types"]

    # Minimal Tool class that behaves like a real dataclass for our purposes
    class _FakeTool:
        def __init__(self, name, description="", inputSchema=None):
            self.name = name
            self.description = description
            self.inputSchema = inputSchema or {}

    class _FakeListToolsRequest:
        def __init__(self, method="tools/list", params=None):
            self.method = method
            self.params = params

    types_stub.Tool = _FakeTool
    types_stub.ListToolsRequest = _FakeListToolsRequest
    types_stub.TextContent = MagicMock(name="TextContent")
    types_stub.ImageContent = MagicMock(name="ImageContent")

    # Ensure parent packages resolve submodule attributes to the same objects
    # we put in sys.modules.  When Python does `import mcp.types as types` it
    # calls getattr(mcp_pkg, 'types') — which on a MagicMock returns a freshly
    # auto-created MagicMock, NOT sys.modules['mcp.types'].  We must wire them
    # up explicitly so the import sees our stubs.
    sys.modules["mcp"].types = sys.modules["mcp.types"]
    sys.modules["mcp"].server = sys.modules["mcp.server"]
    sys.modules["mcp.server"].stdio = sys.modules["mcp.server.stdio"]
    sys.modules["mcp.server"].models = sys.modules["mcp.server.models"]

    sys.modules["browser_use"].mcp = sys.modules["browser_use.mcp"]
    sys.modules["browser_use.mcp"].server = sys.modules["browser_use.mcp.server"]
    sys.modules["browser_use"].browser = sys.modules["browser_use.browser"]
    sys.modules["browser_use"].config = sys.modules["browser_use.config"]
    sys.modules["browser_use"].utils = sys.modules["browser_use.utils"]

    return saved


def _restore_stubs(saved: dict) -> None:
    for name, orig in saved.items():
        if orig is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = orig



def _load_module() -> object:
    """Load mcp-server.py as a module (importlib, because of the hyphen)."""
    server_path = Path(__file__).parent / "mcp-server.py"
    spec = importlib.util.spec_from_file_location("_mcp_server_under_test", server_path)
    mod = importlib.util.module_from_spec(spec)
    # Prevent the asyncio.run(main()) block from firing
    sys.argv = ["mcp-server.py"]
    spec.loader.exec_module(mod)
    return mod


# Load the module once for the entire test session.
_saved = _install_stubs()
try:
    _mod = _load_module()
except Exception as _load_err:
    _mod = None
    print(f"WARNING: failed to load mcp-server module: {_load_err}", file=sys.stderr)
finally:
    _restore_stubs(_saved)


# ---------------------------------------------------------------------------
# Fake chat provider modules (used by _build_llm at RUNTIME, not just load time)
#
# _build_llm() does `importlib.import_module(module_path)` + getattr(class) each
# time it runs, so the three chat modules must be present in sys.modules while
# tests execute — not only during the one-shot _load_module() above. We install
# persistent recording stubs in setUpModule() and remove them in tearDownModule().
# ---------------------------------------------------------------------------

class _RecordingChat:
    """Fake Chat model that captures the kwargs _build_llm forwarded to it."""

    provider_label = "recording"

    def __init__(self, **kwargs):
        self.init_kwargs = dict(kwargs)


class FakeChatAnthropic(_RecordingChat):
    provider_label = "anthropic"


class FakeChatOpenAI(_RecordingChat):
    provider_label = "openai"


class FakeChatBrowserUse(_RecordingChat):
    provider_label = "browser_use"


# Only the three leaf .chat modules need stubbing: importlib.import_module()
# returns a fully-qualified module straight from sys.modules without re-importing
# its parents, so we must NOT clobber the real 'browser_use' package chain.
_CHAT_MODULE_SPECS = {
    "browser_use.llm.anthropic.chat": [("ChatAnthropic", FakeChatAnthropic)],
    "browser_use.llm.openai.chat": [("ChatOpenAI", FakeChatOpenAI)],
    "browser_use.llm.browser_use.chat": [("ChatBrowserUse", FakeChatBrowserUse)],
}

_saved_chat_modules: dict = {}


def _install_chat_stub_modules():
    """Install recording chat-provider modules into sys.modules (persistent)."""
    import types as _pytypes

    for name, attrs in _CHAT_MODULE_SPECS.items():
        _saved_chat_modules[name] = sys.modules.get(name)
        module = _pytypes.ModuleType(name)
        for attr_name, attr_val in attrs:
            setattr(module, attr_name, attr_val)
        sys.modules[name] = module


def _restore_chat_stub_modules():
    for name, orig in _saved_chat_modules.items():
        if orig is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = orig
    _saved_chat_modules.clear()


# ---------------------------------------------------------------------------
# Env scrub — the server's behavior branches on BROWSER_USE_* env vars; tests
# must be deterministic regardless of the developer's shell environment.
# ---------------------------------------------------------------------------

_ENV_KEYS = (
    "BROWSER_USE_CLOUD",
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_AGENT_MODEL",
    "BROWSER_USE_HEADLESS",
)
_saved_env: dict = {}


def setUpModule():
    for key in _ENV_KEYS:
        _saved_env[key] = os.environ.pop(key, None)
    _install_chat_stub_modules()


def tearDownModule():
    for key, value in _saved_env.items():
        if value is not None:
            os.environ[key] = value
    _restore_chat_stub_modules()


# ---------------------------------------------------------------------------
# Helper: build a MagusBrowserServer instance without touching real Chrome
# ---------------------------------------------------------------------------

def _make_server():
    """
    Instantiate MagusBrowserServer with all heavy dependencies stubbed.

    Because MagusBrowserServer inherits from _StubBrowserUseServer (our no-op
    base class), constructing it is safe: no Chrome, no MCP transport, no I/O.
    """
    if _mod is None:
        raise RuntimeError("mcp-server module did not load")
    return _mod.MagusBrowserServer()


# ---------------------------------------------------------------------------
# Test 1: downloads_path avoids TCC-protected ~/Downloads directory
# ---------------------------------------------------------------------------

class TestDownloadsPathAvoidsTCC(unittest.TestCase):
    """
    BUG 1 (TCC): The upstream server writes to ~/Downloads/browser-use-mcp
    which is TCC-protected on macOS.  MagusBrowserServer._init_browser_session()
    must use ~/.config/browseruse/downloads instead.
    """

    def setUp(self):
        self.server = _make_server()

    def test_downloads_path_does_not_contain_user_downloads(self):
        """downloads_path must NOT point into ~/Downloads (TCC-blocked)."""
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            # Patch _track_session to avoid AttributeError (not set up in stub)
            self.server._track_session = MagicMock()
            asyncio.run(self.server._init_browser_session())

        dp = captured.get("downloads_path", "")
        self.assertNotIn(
            "/Downloads/",
            dp,
            f"downloads_path must not include /Downloads/ (TCC-protected). Got: {dp!r}",
        )

    def test_downloads_path_uses_config_browseruse_downloads(self):
        """downloads_path must resolve to ~/.config/browseruse/downloads."""
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            self.server._track_session = MagicMock()
            asyncio.run(self.server._init_browser_session())

        dp = captured.get("downloads_path", "")
        self.assertIn(
            ".config/browseruse/downloads",
            dp,
            f"downloads_path must contain .config/browseruse/downloads. Got: {dp!r}",
        )


# ---------------------------------------------------------------------------
# Test 2: user_data_dir includes PID for session isolation
# ---------------------------------------------------------------------------

class TestUserDataDirIncludesPid(unittest.TestCase):
    """
    BUG 2 (SingletonLock): The upstream server uses a fixed user_data_dir
    shared by all sessions.  MagusBrowserServer must embed the PID so each
    Claude Code process gets its own Chrome profile directory.
    """

    def setUp(self):
        self.server = _make_server()

    def test_user_data_dir_contains_current_pid(self):
        """user_data_dir must contain str(os.getpid())."""
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            self.server._track_session = MagicMock()
            asyncio.run(self.server._init_browser_session())

        udd = captured.get("user_data_dir", "")
        self.assertIn(
            str(os.getpid()),
            udd,
            f"user_data_dir must contain the current PID ({os.getpid()}). Got: {udd!r}",
        )

    def test_user_data_dir_contains_session_prefix(self):
        """user_data_dir must contain 'session-' to identify PID-scoped profiles."""
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            self.server._track_session = MagicMock()
            asyncio.run(self.server._init_browser_session())

        udd = captured.get("user_data_dir", "")
        self.assertIn(
            "session-",
            udd,
            f"user_data_dir must contain 'session-'. Got: {udd!r}",
        )


# ---------------------------------------------------------------------------
# Test 3: Two concurrent servers get different user_data_dirs
# ---------------------------------------------------------------------------

class TestConcurrentServersGetDifferentUserDataDirs(unittest.TestCase):
    """
    BUG 2 (SingletonLock): When two MagusBrowserServer instances are created in
    different processes (different PIDs), they must use different user_data_dir
    values so Chrome doesn't encounter a SingletonLock conflict.
    """

    def test_different_pids_produce_different_user_data_dirs(self):
        """Patching os.getpid to different values yields different user_data_dir."""
        results = {}

        def run_with_pid(pid, label):
            server = _make_server()
            captured = {}

            class CapturingProfile:
                def __init__(self, **kwargs):
                    captured.update(kwargs)

            mock_session = MagicMock()
            mock_session.start = AsyncMock(return_value=None)

            with (
                patch.object(_mod, "BrowserProfile", CapturingProfile),
                patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
                patch.object(_mod, "get_default_profile", return_value={}),
                patch.object(_mod, "get_default_llm", return_value={}),
                patch("os.getpid", return_value=pid),
            ):
                server._track_session = MagicMock()
                asyncio.run(server._init_browser_session())

            results[label] = captured.get("user_data_dir", "")

        run_with_pid(1000, "server_a")
        run_with_pid(2000, "server_b")

        self.assertNotEqual(
            results["server_a"],
            results["server_b"],
            (
                f"Two servers with different PIDs must use different user_data_dirs.\n"
                f"  server_a (pid=1000): {results['server_a']!r}\n"
                f"  server_b (pid=2000): {results['server_b']!r}"
            ),
        )
        self.assertIn("1000", results["server_a"], "PID 1000 must appear in server_a's path")
        self.assertIn("2000", results["server_b"], "PID 2000 must appear in server_b's path")


# ---------------------------------------------------------------------------
# Test 4: Custom tools are registered
# ---------------------------------------------------------------------------

class TestCustomToolsRegistered(unittest.TestCase):
    """
    BUG 3 (custom tools): MagusBrowserServer must expose 5 extra tools
    (browser_export_session, browser_import_session, browser_run_script,
    browser_start_cloud_session, browser_set_agent_model) beyond the 16
    built-in BrowserUseServer tools.
    """

    def _get_tool_list(self, parent_tools=None):
        """
        Invoke the list_tools handler registered by _extend_list_tools().

        _extend_list_tools() calls @self.server.list_tools() which in our stub
        just calls the decorator function — so the wrapped handler is stored as
        server.list_tools.return_value's return_value.  We capture the actual
        handler by intercepting the decorator call.
        """
        server = _make_server()

        # _extend_list_tools already ran in __init__; the wrapped coroutine was
        # passed to server.list_tools()(handler).  Because our mock's
        # list_tools() returns a lambda that returns the fn, the coroutine is
        # available via server.server.list_tools.return_value.
        # Easier: just re-call _extend_list_tools with a capturing mock.

        captured_handler = {}

        def capturing_decorator():
            def registrar(fn):
                captured_handler["fn"] = fn
                return fn
            return registrar

        server.server.list_tools = capturing_decorator

        if parent_tools is None:
            parent_tools = []

        # parent_handler returns a mock result with .root.tools
        mock_result = MagicMock()
        mock_result.root.tools = parent_tools

        parent_handler = AsyncMock(return_value=mock_result)
        server.server.request_handlers = {
            _mod.types.ListToolsRequest: parent_handler
        }

        server._extend_list_tools()

        handler = captured_handler.get("fn")
        self.assertIsNotNone(handler, "_extend_list_tools did not register a handler")

        return asyncio.run(handler())

    # The custom tools this wrapper adds on top of upstream's built-ins.
    CUSTOM_TOOL_NAMES = (
        "browser_export_session",
        "browser_import_session",
        "browser_run_script",
        "browser_evaluate",
        "browser_press_key",
        "browser_keyboard",
        "browser_focus",
        "browser_doctor",
        "browser_start_cloud_session",
        "browser_set_agent_model",
    )

    def test_custom_tool_names_present(self):
        """list_tools must include all custom tool names."""
        tools = self._get_tool_list(parent_tools=[])
        names = [t.name for t in tools]
        for expected in self.CUSTOM_TOOL_NAMES:
            self.assertIn(
                expected,
                names,
                f"Tool {expected!r} missing from list_tools. Got: {names}",
            )

    def test_total_tool_count_with_parent_tools(self):
        """Total tool count must be 16 built-in + all custom tools."""
        # Simulate 16 built-in parent tools
        FakeTool = _mod.types.Tool
        parent_tools = [FakeTool(name=f"builtin_{i}") for i in range(16)]
        tools = self._get_tool_list(parent_tools=parent_tools)
        expected = 16 + len(self.CUSTOM_TOOL_NAMES)
        self.assertGreaterEqual(
            len(tools),
            expected,
            f"Expected >= {expected} tools (16 built-in + {len(self.CUSTOM_TOOL_NAMES)} custom). Got: {len(tools)}",
        )

    def test_custom_tools_appended_after_parent(self):
        """Custom tools must be appended after built-in tools, not prepended."""
        FakeTool = _mod.types.Tool
        parent_tools = [FakeTool(name="builtin_0")]
        tools = self._get_tool_list(parent_tools=parent_tools)
        custom_names = set(self.CUSTOM_TOOL_NAMES)
        last_custom_idx = max(
            i for i, t in enumerate(tools) if t.name in custom_names
        )
        first_builtin_idx = next(
            i for i, t in enumerate(tools) if t.name == "builtin_0"
        )
        self.assertLess(
            first_builtin_idx,
            last_custom_idx,
            "Built-in tools must appear before custom tools in the list",
        )

    def test_sanitizer_strips_oneOf_regardless_of_version(self):
        """VERSION-INDEPENDENT proof the oneOf sanitizer works: inject a parent
        tool carrying the exact upstream browser_click oneOf and assert it is
        stripped. This holds even on browser-use 0.12.6+ (where upstream no
        longer emits it) because we inject the offending schema ourselves —
        so the test proves OUR code, not the installed version's cleanliness.
        Guards against someone deleting the sanitizer assuming '#4211 is fixed'
        while the plugin still installs browser-use unpinned (0.12.5 ships it)."""
        FakeTool = _mod.types.Tool
        offending = FakeTool(
            name="browser_click",
            inputSchema={
                "type": "object",
                "properties": {"index": {"type": "integer"}},
                "oneOf": [
                    {"required": ["index"]},
                    {"required": ["coordinate_x", "coordinate_y"]},
                ],
            },
        )
        tools = self._get_tool_list(parent_tools=[offending])
        click = next(t for t in tools if t.name == "browser_click")
        self.assertNotIn("oneOf", click.inputSchema, "sanitizer failed to strip oneOf")
        for forbidden in ("allOf", "anyOf"):
            self.assertNotIn(forbidden, click.inputSchema)
        # The rest of the schema must survive — we strip only the forbidden keys.
        self.assertEqual(click.inputSchema.get("type"), "object")
        self.assertIn("index", click.inputSchema.get("properties", {}))


# ---------------------------------------------------------------------------
# Test 5: Shutdown handlers are installed
# ---------------------------------------------------------------------------

class TestShutdownHandlers(unittest.TestCase):
    """
    _install_shutdown_handlers(server) must register:
    - atexit.register(server._shutdown_sync)
    - signal.signal(SIGTERM, ...)
    - signal.signal(SIGINT, ...)
    """

    def test_atexit_registered_with_shutdown_sync(self):
        """atexit.register must be called with server._shutdown_sync."""
        server = _make_server()

        with (
            patch("atexit.register") as mock_atexit,
            patch("signal.signal"),
        ):
            _mod._install_shutdown_handlers(server)

        mock_atexit.assert_called_once_with(server._shutdown_sync)

    def test_signal_registered_for_sigterm(self):
        """signal.signal must be called for SIGTERM."""
        server = _make_server()

        with (
            patch("atexit.register"),
            patch("signal.signal") as mock_signal,
        ):
            _mod._install_shutdown_handlers(server)

        registered_sigs = [c.args[0] for c in mock_signal.call_args_list]
        self.assertIn(
            signal.SIGTERM,
            registered_sigs,
            f"SIGTERM not registered. Registered signals: {registered_sigs}",
        )

    def test_signal_registered_for_sigint(self):
        """signal.signal must be called for SIGINT."""
        server = _make_server()

        with (
            patch("atexit.register"),
            patch("signal.signal") as mock_signal,
        ):
            _mod._install_shutdown_handlers(server)

        registered_sigs = [c.args[0] for c in mock_signal.call_args_list]
        self.assertIn(
            signal.SIGINT,
            registered_sigs,
            f"SIGINT not registered. Registered signals: {registered_sigs}",
        )


# ---------------------------------------------------------------------------
# Test 6: Shutdown cleans up profile directory (not just SingletonLock)
# ---------------------------------------------------------------------------

class TestShutdownCleansProfileDir(unittest.TestCase):
    """
    BUG FIX: _shutdown_sync must remove the entire session-{pid} profile
    directory, not just SingletonLock.  Without this, stale Chrome profiles
    (~50MB each) accumulate indefinitely in ~/.config/browseruse/profiles/.
    """

    def test_shutdown_removes_profile_directory(self):
        """_shutdown_sync must call shutil.rmtree on the PID-scoped profile dir."""
        server = _make_server()

        import tempfile
        tmp = Path(tempfile.mkdtemp())
        pid = os.getpid()
        # _shutdown_sync builds: Path.home() / ".config" / "browseruse" / "profiles" / f"session-{pid}"
        # So create matching structure under tmp
        profile_dir = tmp / ".config" / "browseruse" / "profiles" / f"session-{pid}"
        profile_dir.mkdir(parents=True)
        # Create some files to simulate a Chrome profile
        (profile_dir / "SingletonLock").write_text("dummy")
        (profile_dir / "Cookies").write_text("dummy")
        (profile_dir / "Default").mkdir()

        original_home = Path.home

        def fake_home():
            return tmp

        try:
            Path.home = staticmethod(fake_home)
            server.browser_session = None  # no Chrome to terminate
            server._shutdown_sync()
        finally:
            Path.home = original_home

        self.assertFalse(
            profile_dir.exists(),
            f"Profile directory {profile_dir} should be removed by _shutdown_sync, but still exists",
        )

        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    def test_shutdown_tolerates_missing_profile_dir(self):
        """_shutdown_sync must not crash when the profile dir doesn't exist."""
        server = _make_server()
        server.browser_session = None

        import tempfile
        # tmp exists but has no .config/browseruse/profiles/session-{pid} inside
        tmp = Path(tempfile.mkdtemp())
        original_home = Path.home

        def fake_home():
            return tmp

        try:
            Path.home = staticmethod(fake_home)
            # Should not raise even though session-{pid} doesn't exist
            server._shutdown_sync()
        finally:
            Path.home = original_home

        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Test 7: New live-page tools — evaluate / keyboard / focus
# ---------------------------------------------------------------------------

class _FakeCDPClient:
    """Records every CDP send.<Domain>.<method>(params, session_id) call.

    Returns canned values keyed by 'Domain.method' so handlers can assert on
    both the params they sent and the result-shape parsing.
    """

    def __init__(self, returns=None):
        self.calls = []  # list of (path, params)
        self._returns = returns or {}

        class _Domain:
            def __init__(self, client, domain):
                self._client = client
                self._domain = domain

            def __getattr__(self, method):
                async def _call(params=None, session_id=None):
                    path = f"{self._domain}.{method}"
                    self._client.calls.append((path, params or {}))
                    return self._client._returns.get(path, {})
                return _call

        class _Send:
            def __init__(self, client):
                self._client = client

            def __getattr__(self, domain):
                return _Domain(self._client, domain)

        self.send = _Send(self)


class _FakeCDPSession:
    def __init__(self, returns=None):
        self.session_id = "cdp-sess-1"
        self.cdp_client = _FakeCDPClient(returns=returns)


def _server_with_cdp(returns=None):
    """A server whose browser_session yields a recording CDP session."""
    server = _make_server()
    fake_cdp = _FakeCDPSession(returns=returns)

    bs = MagicMock()
    bs.id = "live-session"
    bs.get_or_create_cdp_session = AsyncMock(return_value=fake_cdp)
    server.browser_session = bs
    server._update_session_activity = MagicMock()
    return server, fake_cdp


class TestEvaluateTool(unittest.IsolatedAsyncioTestCase):
    """browser_evaluate runs JS in the LIVE page (self.browser_session) via
    Runtime.evaluate with returnByValue + awaitPromise, IIFE-wrapping `return`."""

    async def test_no_session_errors_cleanly(self):
        server = _make_server()
        server.browser_session = None
        out = await server._handle_evaluate({"script": "document.title"})
        self.assertIn("No browser session", out)

    async def test_plain_expression_passed_through(self):
        server, cdp = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": "Hello"}}}
        )
        out = await server._handle_evaluate({"script": "document.title"})
        path, params = cdp.cdp_client.calls[-1]
        self.assertEqual(path, "Runtime.evaluate")
        self.assertEqual(params["expression"], "document.title")
        self.assertTrue(params["returnByValue"])
        self.assertTrue(params["awaitPromise"])
        self.assertEqual(json.loads(out), {"result": "Hello"})

    async def test_return_statement_is_iife_wrapped(self):
        """The report's `return monaco...setValue()` must not SyntaxError."""
        server, cdp = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": None}}}
        )
        await server._handle_evaluate(
            {"script": "return monaco.editor.getModels()[0].setValue('x')"}
        )
        _, params = cdp.cdp_client.calls[-1]
        self.assertTrue(
            params["expression"].startswith("(function(){"),
            f"return-bearing script must be IIFE-wrapped, got: {params['expression']!r}",
        )

    async def test_expression_containing_return_substring_not_wrapped(self):
        """REGRESSION: an expression that merely CONTAINS 'return' must pass
        through unwrapped, or it silently becomes a no-return function → null.
        (Verified live: `"returned"` returned null before the fix.)"""
        server, cdp = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": "returned"}}}
        )
        out = await server._handle_evaluate({"script": '"returned"'})
        _, params = cdp.cdp_client.calls[-1]
        self.assertEqual(params["expression"], '"returned"')  # NOT wrapped
        self.assertEqual(json.loads(out), {"result": "returned"})

    async def test_querySelector_return_class_not_wrapped(self):
        server, cdp = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": "found"}}}
        )
        await server._handle_evaluate({"script": "document.querySelector('.return-btn')"})
        _, params = cdp.cdp_client.calls[-1]
        self.assertNotIn("(function(){", params["expression"])

    async def test_js_exception_surfaced_not_silent(self):
        server, cdp = _server_with_cdp(
            returns={
                "Runtime.evaluate": {
                    "exceptionDetails": {"exception": {"description": "ReferenceError: x"}}
                }
            }
        )
        out = await server._handle_evaluate({"script": "x"})
        data = json.loads(out)
        self.assertEqual(data["error"], "JavaScript exception")
        self.assertIn("ReferenceError", data["detail"])

    async def test_empty_script_rejected(self):
        server, _ = _server_with_cdp()
        out = await server._handle_evaluate({"script": "   "})
        self.assertIn("script is required", out)


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


class TestFocusTool(unittest.IsolatedAsyncioTestCase):
    async def test_focus_uses_selector_and_reports_match(self):
        server, cdp = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": True}}}
        )
        out = await server._handle_focus({"selector": "textarea.inputarea"})
        _, params = cdp.cdp_client.calls[-1]
        self.assertIn("textarea.inputarea", params["expression"])
        self.assertEqual(json.loads(out), {"focused": True, "selector": "textarea.inputarea"})

    async def test_focus_no_match_reports_false(self):
        server, _ = _server_with_cdp(
            returns={"Runtime.evaluate": {"result": {"value": False}}}
        )
        out = await server._handle_focus({"selector": "#nope"})
        data = json.loads(out)
        self.assertFalse(data["focused"])


class TestKeyboardTools(unittest.IsolatedAsyncioTestCase):
    async def test_press_key_sends_keydown_and_keyup(self):
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "Enter"})
        paths = [p for p, _ in cdp.cdp_client.calls]
        self.assertEqual(paths, ["Input.dispatchKeyEvent", "Input.dispatchKeyEvent"])
        types = [params["type"] for _, params in cdp.cdp_client.calls]
        self.assertEqual(types, ["keyDown", "keyUp"])

    async def test_press_key_count_repeats(self):
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "ArrowDown", "count": 3})
        # 3 presses × (down+up) = 6 dispatches
        self.assertEqual(len(cdp.cdp_client.calls), 6)

    async def test_meta_a_sets_modifier_bitmask(self):
        """Cmd+A must carry the Meta modifier bit (4) and key 'a' / code 'KeyA'."""
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "Meta+a"})
        _, down = cdp.cdp_client.calls[0]
        self.assertEqual(down["modifiers"], 4)
        self.assertEqual(down["key"], "a")
        self.assertEqual(down["code"], "KeyA")

    async def test_meta_a_attaches_selectall_command(self):
        """REGRESSION: a synthetic Cmd/Ctrl+A only selects-all in the browser if
        the keyDown carries CDP `commands: ['selectAll']`. The modifier bitmask
        alone is NOT enough (verified against headless Chrome — without this the
        field is appended to, not replaced). The keyUp must NOT carry commands."""
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "Meta+a"})
        down = cdp.cdp_client.calls[0][1]
        up = cdp.cdp_client.calls[1][1]
        self.assertEqual(down.get("commands"), ["selectAll"])
        self.assertNotIn("commands", up)

    async def test_ctrl_a_also_attaches_selectall(self):
        """Control+a (Linux/Windows) must also map to selectAll."""
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "Control+a"})
        self.assertEqual(cdp.cdp_client.calls[0][1].get("commands"), ["selectAll"])

    async def test_plain_a_has_no_command(self):
        """A bare 'a' (no Cmd/Ctrl) must NOT carry an edit command — it's a letter."""
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "a"})
        self.assertNotIn("commands", cdp.cdp_client.calls[0][1])

    async def test_keyboard_path_focuses_target(self):
        """Keyboard input must request a FOCUSED cdp session (Input events route
        to the focused target); evaluate does not need focus."""
        server, cdp = _server_with_cdp()
        await server._handle_keyboard({"text": "hi"})
        server.browser_session.get_or_create_cdp_session.assert_awaited_with(
            target_id=None, focus=True
        )

    async def test_named_key_virtual_code(self):
        server, cdp = _server_with_cdp()
        await server._handle_press_key({"key": "Escape"})
        _, down = cdp.cdp_client.calls[0]
        self.assertEqual(down["key"], "Escape")
        self.assertEqual(down["windowsVirtualKeyCode"], 27)

    async def test_keyboard_keys_then_text(self):
        """browser_keyboard presses keys first, then inserts text via insertText."""
        server, cdp = _server_with_cdp()
        await server._handle_keyboard({"keys": ["Meta+a", "Delete"], "text": "new value"})
        paths = [p for p, _ in cdp.cdp_client.calls]
        # 2 keys × 2 events = 4 dispatchKeyEvent, then 1 insertText, in that order
        self.assertEqual(paths.count("Input.dispatchKeyEvent"), 4)
        self.assertEqual(paths[-1], "Input.insertText")
        _, last = cdp.cdp_client.calls[-1]
        self.assertEqual(last["text"], "new value")

    async def test_keyboard_requires_keys_or_text(self):
        server, _ = _server_with_cdp()
        out = await server._handle_keyboard({})
        self.assertIn("keys", out)


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


class TestDoctorTool(unittest.IsolatedAsyncioTestCase):
    async def test_doctor_reports_core_fields(self):
        server = _make_server()
        out = await server._handle_doctor({})
        data = json.loads(out)
        for field in ("python_version", "browser_use", "mcp", "playwright",
                      "chromium_present", "api_keys"):
            self.assertIn(field, data)
        # browser_use is importable in the test env (the suite imported it).
        self.assertTrue(data["browser_use"]["installed"])

    async def test_doctor_never_spawns_browser(self):
        """Doctor must be pure inspection — no get_or_create_cdp_session call."""
        server = _make_server()
        server.browser_session = MagicMock()
        server.browser_session.get_or_create_cdp_session = AsyncMock()
        await server._handle_doctor({})
        server.browser_session.get_or_create_cdp_session.assert_not_called()


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
# Test 7 (v1.2.0): Local sessions force Playwright's bundled Chromium
# ---------------------------------------------------------------------------

class TestChromiumChannel(unittest.TestCase):
    """
    Local sessions must pass channel='chromium' so browser-use launches
    Playwright's bundled Chromium instead of the user's real Chrome.app
    (which caused macOS link-hijack / focus-steal).
    """

    def _captured_profile(self):
        server = _make_server()
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            server._track_session = MagicMock()
            asyncio.run(server._init_browser_session())

        return captured

    def test_local_profile_uses_chromium_channel(self):
        """profile must include channel='chromium' by default."""
        captured = self._captured_profile()
        self.assertEqual(
            captured.get("channel"),
            "chromium",
            f"Local profile must force channel='chromium'. Got: {captured.get('channel')!r}",
        )

    def test_user_config_can_override_channel(self):
        """A channel set in the user's config file must win over our default."""
        server = _make_server()
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={"channel": "chrome"}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            server._track_session = MagicMock()
            asyncio.run(server._init_browser_session())

        self.assertEqual(captured.get("channel"), "chrome")


# ---------------------------------------------------------------------------
# Test 8 (v1.2.0): BROWSER_USE_CLOUD env switch
# ---------------------------------------------------------------------------

class TestCloudEnvSwitch(unittest.TestCase):
    """
    BROWSER_USE_CLOUD=true must build a use_cloud=True profile WITHOUT local
    paths (user_data_dir / channel / headless / downloads_path), and must fail
    with a clear error when BROWSER_USE_API_KEY is missing.
    """

    def _fake_chat_module(self):
        fake_mod = MagicMock()
        fake_mod.ChatBrowserUse = MagicMock(return_value=MagicMock(name="fake_bu_llm"))
        return fake_mod

    def test_cloud_profile_has_use_cloud_and_no_local_paths(self):
        server = _make_server()
        captured = {}

        class CapturingProfile:
            def __init__(self, **kwargs):
                captured.update(kwargs)

        mock_session = MagicMock()
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.dict(os.environ, {"BROWSER_USE_CLOUD": "true", "BROWSER_USE_API_KEY": "test-key"}),
            patch.dict(sys.modules, {"browser_use.llm.browser_use.chat": self._fake_chat_module()}),
            patch.object(_mod, "BrowserProfile", CapturingProfile),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
            patch.object(_mod, "get_default_profile", return_value={}),
            patch.object(_mod, "get_default_llm", return_value={}),
        ):
            server._track_session = MagicMock()
            asyncio.run(server._init_browser_session())

        self.assertIs(captured.get("use_cloud"), True, f"use_cloud must be True. Got: {captured!r}")
        for local_key in ("user_data_dir", "channel", "headless", "downloads_path"):
            self.assertNotIn(
                local_key,
                captured,
                f"Cloud profile must not include local path/option {local_key!r}. Got: {captured!r}",
            )

    def test_cloud_without_api_key_raises_clear_error(self):
        server = _make_server()

        with (
            patch.dict(os.environ, {"BROWSER_USE_CLOUD": "true"}),
            patch.object(_mod, "get_default_profile", return_value={}),
        ):
            os.environ.pop("BROWSER_USE_API_KEY", None)
            with self.assertRaises(RuntimeError) as ctx:
                asyncio.run(server._init_browser_session())

        self.assertIn("BROWSER_USE_API_KEY", str(ctx.exception))


# ---------------------------------------------------------------------------
# Test 9a: _build_llm dispatch — each registry row builds the right class with
#          the right kwargs (temperature / base_url / api_key rules).
# ---------------------------------------------------------------------------

class TestBuildLLM(unittest.TestCase):
    """
    _build_llm(choice) must:
      - build ChatAnthropic / ChatOpenAI / ChatBrowserUse per provider
      - forward temperature ONLY for openai / openai_compatible
      - forward base_url only when supported and provided
      - pass api_key (from the resolved env var) even when None
      - require base_url for openai_compatible (RuntimeError otherwise)
      - require an api key for openai_compatible (RuntimeError otherwise)
      - raise ValueError for an unknown provider
    """

    def _choice(self, **kwargs):
        return _mod.LLMChoice(**kwargs)

    def test_anthropic_row_builds_chat_anthropic_no_temperature(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-xyz"}):
            llm = _mod._build_llm(
                self._choice(provider="anthropic", model="claude-sonnet-5", temperature=0.9)
            )
        self.assertIsInstance(llm, FakeChatAnthropic)
        self.assertEqual(llm.init_kwargs["model"], "claude-sonnet-5")
        self.assertEqual(llm.init_kwargs["api_key"], "sk-ant-xyz")
        # send_temperature=False for anthropic — even a set temperature is dropped.
        self.assertNotIn("temperature", llm.init_kwargs)

    def test_anthropic_passes_none_api_key_when_env_absent(self):
        env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            llm = _mod._build_llm(self._choice(provider="anthropic", model="claude-sonnet-5"))
        self.assertIn("api_key", llm.init_kwargs)
        self.assertIsNone(llm.init_kwargs["api_key"])

    def test_openai_row_builds_chat_openai_with_temperature(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-oai-abc"}):
            llm = _mod._build_llm(
                self._choice(provider="openai", model="gpt-5", temperature=0.3)
            )
        self.assertIsInstance(llm, FakeChatOpenAI)
        self.assertEqual(llm.init_kwargs["model"], "gpt-5")
        self.assertEqual(llm.init_kwargs["api_key"], "sk-oai-abc")
        self.assertEqual(llm.init_kwargs["temperature"], 0.3)

    def test_openai_omits_temperature_when_none(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-oai-abc"}):
            llm = _mod._build_llm(self._choice(provider="openai", model="gpt-5"))
        self.assertNotIn("temperature", llm.init_kwargs)

    def test_browser_use_row_builds_chat_browser_use_no_temperature(self):
        with patch.dict(os.environ, {"BROWSER_USE_API_KEY": "bu-key"}):
            llm = _mod._build_llm(
                self._choice(provider="browser_use", model="bu-latest", temperature=0.5)
            )
        self.assertIsInstance(llm, FakeChatBrowserUse)
        self.assertEqual(llm.init_kwargs["model"], "bu-latest")
        self.assertEqual(llm.init_kwargs["api_key"], "bu-key")
        self.assertNotIn("temperature", llm.init_kwargs)

    def test_openai_compatible_builds_with_base_url_and_temperature(self):
        with patch.dict(os.environ, {"MY_LOCAL_KEY": "local-secret"}):
            llm = _mod._build_llm(
                self._choice(
                    provider="openai_compatible",
                    model="llama-3",
                    base_url="http://localhost:1234/v1",
                    api_key_env="MY_LOCAL_KEY",
                    temperature=0.1,
                )
            )
        self.assertIsInstance(llm, FakeChatOpenAI)
        self.assertEqual(llm.init_kwargs["base_url"], "http://localhost:1234/v1")
        self.assertEqual(llm.init_kwargs["api_key"], "local-secret")
        self.assertEqual(llm.init_kwargs["temperature"], 0.1)

    def test_openai_compatible_without_base_url_raises(self):
        with patch.dict(os.environ, {"MY_LOCAL_KEY": "local-secret"}):
            with self.assertRaises(RuntimeError) as ctx:
                _mod._build_llm(
                    self._choice(
                        provider="openai_compatible",
                        model="llama-3",
                        api_key_env="MY_LOCAL_KEY",
                    )
                )
        self.assertIn("base_url", str(ctx.exception))

    def test_openai_compatible_without_api_key_raises(self):
        env = {k: v for k, v in os.environ.items() if k != "MY_LOCAL_KEY"}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                _mod._build_llm(
                    self._choice(
                        provider="openai_compatible",
                        model="llama-3",
                        base_url="http://localhost:1234/v1",
                        api_key_env="MY_LOCAL_KEY",
                    )
                )
        self.assertIn("MY_LOCAL_KEY", str(ctx.exception))

    def test_base_url_override_for_anthropic(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant"}):
            llm = _mod._build_llm(
                self._choice(
                    provider="anthropic",
                    model="claude-sonnet-5",
                    base_url="https://proxy.example/anthropic",
                )
            )
        self.assertEqual(llm.init_kwargs["base_url"], "https://proxy.example/anthropic")

    def test_custom_api_key_env_overrides_default(self):
        with patch.dict(os.environ, {"CUSTOM_ANT_KEY": "sk-custom"}):
            llm = _mod._build_llm(
                self._choice(
                    provider="anthropic",
                    model="claude-sonnet-5",
                    api_key_env="CUSTOM_ANT_KEY",
                )
            )
        self.assertEqual(llm.init_kwargs["api_key"], "sk-custom")

    def test_unknown_provider_raises_value_error(self):
        with self.assertRaises(ValueError) as ctx:
            _mod._build_llm(self._choice(provider="not_a_provider", model="x"))
        self.assertIn("not_a_provider", str(ctx.exception))


# ---------------------------------------------------------------------------
# Test 9b: config-resolution precedence
#          session override > settings agentModel > legacy shim > DEFAULT
# ---------------------------------------------------------------------------

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
        self.assertEqual(choice.model, "bu-latest")

    def test_legacy_shim_respects_agent_model_env(self):
        with patch.dict(
            os.environ,
            self._env(BROWSER_USE_API_KEY="bu-key", BROWSER_USE_AGENT_MODEL="bu-2-0"),
            clear=True,
        ):
            choice = self.server._resolve_configured_llm()
        self.assertEqual(choice.model, "bu-2-0")

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
        self.assertIsInstance(llm, FakeChatAnthropic)
        self.assertEqual(llm.init_kwargs["model"], "override-model")

    def test_resolve_agent_llm_falls_back_to_default(self):
        with patch.dict(os.environ, self._env(ANTHROPIC_API_KEY="sk-ant"), clear=True):
            llm = self.server._resolve_agent_llm()
        self.assertIsInstance(llm, FakeChatAnthropic)
        self.assertEqual(llm.init_kwargs["model"], "claude-sonnet-5")


# ---------------------------------------------------------------------------
# Test 9c: browser_set_agent_model tool
# ---------------------------------------------------------------------------

class TestSetAgentModelTool(unittest.TestCase):
    """
    browser_set_agent_model must validate input, store the session override,
    eagerly rebuild self.llm when a live session exists, and return a JSON
    summary that never leaks the API key.
    """

    def setUp(self):
        self.server = _make_server()

    def test_valid_input_stores_override_no_live_session(self):
        self.server.browser_session = None
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant"}):
            result = asyncio.run(
                self.server._handle_set_agent_model(
                    {"provider": "anthropic", "model": "claude-sonnet-5"}
                )
            )
        payload = json.loads(result)
        self.assertEqual(payload["provider"], "anthropic")
        self.assertEqual(payload["model"], "claude-sonnet-5")
        self.assertFalse(payload["applied_to_live_session"])
        self.assertNotIn("api_key", payload)
        # Override persisted for the next session start.
        self.assertIsNotNone(self.server._session_llm_override)
        self.assertEqual(self.server._session_llm_override.provider, "anthropic")

    def test_valid_input_applies_to_live_session(self):
        self.server.browser_session = MagicMock(name="live_session")
        self.server.llm = MagicMock(name="old_llm")
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-oai"}):
            result = asyncio.run(
                self.server._handle_set_agent_model(
                    {"provider": "openai", "model": "gpt-5", "temperature": 0.3}
                )
            )
        payload = json.loads(result)
        self.assertTrue(payload["applied_to_live_session"])
        # self.llm was swapped to a freshly-built FakeChatOpenAI.
        self.assertIsInstance(self.server.llm, FakeChatOpenAI)
        self.assertEqual(self.server.llm.init_kwargs["model"], "gpt-5")
        self.assertEqual(self.server.llm.init_kwargs["temperature"], 0.3)

    def test_invalid_provider_returns_error_and_no_persist(self):
        self.server.browser_session = None
        result = asyncio.run(
            self.server._handle_set_agent_model({"provider": "bogus", "model": "x"})
        )
        self.assertTrue(result.startswith("Error"), f"Expected error string, got {result!r}")
        self.assertIsNone(self.server._session_llm_override)

    def test_openai_compatible_without_base_url_returns_error(self):
        self.server.browser_session = None
        result = asyncio.run(
            self.server._handle_set_agent_model(
                {"provider": "openai_compatible", "model": "llama-3"}
            )
        )
        self.assertTrue(result.startswith("Error"))
        self.assertIn("base_url", result)
        self.assertIsNone(self.server._session_llm_override)

    def test_build_failure_reverts_override_and_keeps_llm(self):
        prior_llm = MagicMock(name="prior_llm")
        prior_override = _mod.LLMChoice(provider="anthropic", model="prev-model")
        self.server.browser_session = MagicMock(name="live_session")
        self.server.llm = prior_llm
        self.server._session_llm_override = prior_override

        # openai_compatible with base_url but a MISSING api key env → _build_llm
        # raises RuntimeError, so the handler must revert.
        env = {k: v for k, v in os.environ.items() if k != "MISSING_KEY_VAR"}
        with patch.dict(os.environ, env, clear=True):
            result = asyncio.run(
                self.server._handle_set_agent_model(
                    {
                        "provider": "openai_compatible",
                        "model": "llama-3",
                        "base_url": "http://localhost:1234/v1",
                        "api_key_env": "MISSING_KEY_VAR",
                    }
                )
            )
        self.assertTrue(result.startswith("Error"), f"Expected error string, got {result!r}")
        # Override reverted; self.llm untouched.
        self.assertIs(self.server._session_llm_override, prior_override)
        self.assertIs(self.server.llm, prior_llm)

    def test_result_json_never_contains_secret(self):
        self.server.browser_session = None
        with patch.dict(os.environ, {"MY_SECRET_ENV": "super-secret-value"}):
            result = asyncio.run(
                self.server._handle_set_agent_model(
                    {
                        "provider": "openai_compatible",
                        "model": "llama-3",
                        "base_url": "http://localhost:1234/v1",
                        "api_key_env": "MY_SECRET_ENV",
                    }
                )
            )
        self.assertNotIn("super-secret-value", result)
        self.assertNotIn("api_key", json.loads(result))


# ---------------------------------------------------------------------------
# Test 9d: static guard — resolver at both call sites, no gpt-4o-mini
# ---------------------------------------------------------------------------

class TestAgentLLMStaticChecks(unittest.TestCase):
    """
    Static source guard: the LLM-selection logic must live in exactly ONE place
    (_resolve_agent_llm / _build_llm), be used at BOTH call sites
    (_init_browser_session and _handle_start_cloud_session), and the old
    duplicated selection + gpt-4o-mini default must be gone.
    """

    @classmethod
    def setUpClass(cls):
        cls.source = (Path(__file__).parent / "mcp-server.py").read_text()

    def test_no_gpt_4o_mini_default(self):
        self.assertNotIn(
            "gpt-4o-mini",
            self.source,
            "The gpt-4o-mini default must be removed — selection now goes through "
            "_resolve_agent_llm / _DEFAULT_LLM.",
        )

    def test_resolver_used_at_both_call_sites(self):
        # _resolve_agent_llm is defined once and called at both init + cloud sites.
        call_count = self.source.count("self._resolve_agent_llm()")
        self.assertGreaterEqual(
            call_count,
            2,
            f"_resolve_agent_llm() must be called at both call sites; found {call_count}.",
        )

    def test_single_resolver_definition(self):
        self.assertEqual(
            self.source.count("def _resolve_agent_llm"),
            1,
            "There must be exactly one _resolve_agent_llm definition.",
        )
        self.assertEqual(
            self.source.count("def _build_llm"),
            1,
            "There must be exactly one _build_llm definition (single selection point).",
        )

    def test_init_does_not_inline_chat_construction(self):
        import ast

        tree = ast.parse(self.source)
        init_src = ""
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and (
                node.name == "_init_browser_session"
            ):
                init_src = ast.get_source_segment(self.source, node) or ""
                break
        self.assertTrue(init_src, "Could not locate _init_browser_session")
        # The old inline ChatOpenAI/ChatBrowserUse construction must be gone.
        for dead in ("ChatOpenAI(", "ChatBrowserUse("):
            self.assertNotIn(
                dead,
                init_src,
                f"_init_browser_session must not inline {dead} — use _resolve_agent_llm().",
            )


# ---------------------------------------------------------------------------
# Test 10 (v1.2.0): browser_start_cloud_session tool
# ---------------------------------------------------------------------------

class TestStartCloudSessionTool(unittest.TestCase):
    """
    browser_start_cloud_session must fail clearly without BROWSER_USE_API_KEY,
    and on success must register the session, promote it to primary when no
    local session exists, and return session_id / cdp_url / live_url JSON.
    """

    def test_missing_api_key_returns_clear_error(self):
        server = _make_server()
        os.environ.pop("BROWSER_USE_API_KEY", None)

        result = asyncio.run(server._handle_start_cloud_session({}))

        self.assertTrue(result.startswith("Error"), f"Expected error string, got: {result!r}")
        self.assertIn("BROWSER_USE_API_KEY", result)

    def test_happy_path_registers_and_promotes_session(self):
        import json as _json

        server = _make_server()
        # Pre-set agent plumbing so promotion skips the lazy real imports.
        server.tools = MagicMock()
        server.file_system = MagicMock()
        server.llm = MagicMock()

        mock_session = MagicMock()
        mock_session.id = "cloud-123"
        mock_session.cdp_url = "wss://cloud.example/cdp/123"
        mock_session.live_url = "https://live.example/watch/123"
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.dict(os.environ, {"BROWSER_USE_API_KEY": "test-key"}),
            patch.object(_mod, "BrowserProfile", MagicMock()) as mock_profile,
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
        ):
            result = asyncio.run(server._handle_start_cloud_session({}))

        payload = _json.loads(result)
        self.assertEqual(payload["session_id"], "cloud-123")
        self.assertEqual(payload["cdp_url"], "wss://cloud.example/cdp/123")
        self.assertEqual(payload["live_url"], "https://live.example/watch/123")
        self.assertTrue(payload["is_primary"])

        # Profile must request a cloud browser that stays alive between tools.
        mock_profile.assert_called_once_with(use_cloud=True, keep_alive=True)
        # Session must be tracked and promoted to primary.
        self.assertIn("cloud-123", server.active_sessions)
        self.assertIs(server.active_sessions["cloud-123"]["session"], mock_session)
        self.assertIs(server.browser_session, mock_session)

    def test_existing_primary_session_is_not_replaced(self):
        server = _make_server()
        existing = MagicMock(name="existing_local_session")
        server.browser_session = existing

        mock_session = MagicMock()
        mock_session.id = "cloud-456"
        mock_session.cdp_url = "wss://cloud.example/cdp/456"
        mock_session.live_url = None
        mock_session.start = AsyncMock(return_value=None)

        with (
            patch.dict(os.environ, {"BROWSER_USE_API_KEY": "test-key"}),
            patch.object(_mod, "BrowserProfile", MagicMock()),
            patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
        ):
            result = asyncio.run(server._handle_start_cloud_session({}))

        import json as _json
        payload = _json.loads(result)
        self.assertFalse(payload["is_primary"])
        self.assertNotIn("live_url", payload, "live_url must be omitted when unavailable")
        self.assertIs(server.browser_session, existing, "Existing primary must not be replaced")
        self.assertIn("cloud-456", server.active_sessions)


# ---------------------------------------------------------------------------
# Test 11 (v1.2.0): Startup reaper for orphaned profiles
# ---------------------------------------------------------------------------

class TestReapOrphanedProfiles(unittest.TestCase):
    """
    _reap_orphaned_profiles(base_dir=...) must remove session-{pid} dirs whose
    PID is dead, and must never touch: the 'default' dir, dirs of live PIDs,
    or dirs whose suffix isn't a PID.
    """

    @staticmethod
    def _find_dead_pid():
        import psutil

        for candidate in range(99999, 90000, -1):
            if not psutil.pid_exists(candidate):
                return candidate
        raise RuntimeError("Could not find a dead PID in 90000-99999")

    def test_reaps_only_dead_pid_dirs(self):
        import shutil
        import tempfile

        tmp = Path(tempfile.mkdtemp())
        try:
            dead_pid = self._find_dead_pid()
            live_pid = os.getpid()

            dead_dir = tmp / f"session-{dead_pid}"
            live_dir = tmp / f"session-{live_pid}"
            default_dir = tmp / "default"
            weird_dir = tmp / "session-notapid"

            for d in (dead_dir, live_dir, default_dir, weird_dir):
                d.mkdir(parents=True)
                (d / "SingletonLock").write_text("dummy")

            _mod._reap_orphaned_profiles(base_dir=tmp)

            self.assertFalse(dead_dir.exists(), f"Dead-PID dir {dead_dir} must be reaped")
            self.assertTrue(live_dir.exists(), "Live-PID dir must survive")
            self.assertTrue(default_dir.exists(), "'default' dir must survive")
            self.assertTrue(weird_dir.exists(), "Non-PID-suffixed dir must survive")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_missing_profiles_dir_is_noop(self):
        import tempfile

        tmp = Path(tempfile.mkdtemp()) / "does-not-exist"
        # Must not raise
        _mod._reap_orphaned_profiles(base_dir=tmp)

    def test_reaper_never_raises(self):
        """Even a pathological base_dir must not raise (startup safety)."""
        _mod._reap_orphaned_profiles(base_dir=Path("/dev/null"))


# ---------------------------------------------------------------------------
# Test 12 (v1.2.0): _shutdown_sync uses the live 0.13.1 API, not dead attrs
# ---------------------------------------------------------------------------

class TestShutdownStaticChecks(unittest.TestCase):
    """
    Static source check: shutdown must go through session.kill() and the
    _local_browser_watchdog._subprocess psutil handle.  The old probing of
    session._browser / session.browser / ._process / .process was dead code
    on browser-use 0.13.1 (those attributes don't exist) and must be gone.
    """

    @classmethod
    def setUpClass(cls):
        import ast

        source = (Path(__file__).parent / "mcp-server.py").read_text()
        tree = ast.parse(source)
        segments = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "MagusBrowserServer":
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in (
                        "_shutdown_sync",
                        "_kill_session_sync",
                    ):
                        segments.append(ast.get_source_segment(source, item) or "")
        cls.shutdown_src = "\n".join(segments)
        assert cls.shutdown_src.strip(), "Could not locate shutdown methods in mcp-server.py"

    def test_shutdown_uses_kill(self):
        self.assertIn(
            ".kill()",
            self.shutdown_src,
            "Shutdown must call session.kill() — under keep_alive=True it is the "
            "only call that actually terminates Chrome",
        )

    def test_shutdown_uses_local_browser_watchdog_subprocess(self):
        self.assertIn("_local_browser_watchdog", self.shutdown_src)
        self.assertIn("_subprocess", self.shutdown_src)

    def test_shutdown_does_not_probe_dead_attributes(self):
        for dead_attr in ('"_browser"', '"_process"', '"process"'):
            self.assertNotIn(
                dead_attr,
                self.shutdown_src,
                f"Shutdown must not probe dead attribute {dead_attr} "
                "(does not exist on browser-use 0.13.1 sessions)",
            )

    def test_shutdown_iterates_active_sessions(self):
        self.assertIn(
            "active_sessions",
            self.shutdown_src,
            "Shutdown must kill tracked sessions too, not just the primary one",
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
