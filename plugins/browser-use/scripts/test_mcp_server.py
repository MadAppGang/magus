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
    The server must expose browser_export_session, browser_import_session, and
    browser_run_script on top of the built-in tools.  Tests verify the list_tools
    handler returns them and that the total count is >= 19.

EXTRA (graceful shutdown):
    _install_shutdown_handlers() must register atexit and POSIX signal handlers.
"""

import atexit
import asyncio
import importlib.util
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
    BUG 3 (custom tools): MagusBrowserServer must expose 3 extra tools
    (browser_export_session, browser_import_session, browser_run_script)
    beyond the 16 built-in BrowserUseServer tools.
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

    def test_custom_tool_names_present(self):
        """list_tools must include all 3 custom tool names."""
        tools = self._get_tool_list(parent_tools=[])
        names = [t.name for t in tools]
        for expected in ("browser_export_session", "browser_import_session", "browser_run_script"):
            self.assertIn(
                expected,
                names,
                f"Tool {expected!r} missing from list_tools. Got: {names}",
            )

    def test_total_tool_count_with_parent_tools(self):
        """Total tool count must be >= 19 (16 built-in + 3 custom)."""
        # Simulate 16 built-in parent tools
        FakeTool = _mod.types.Tool
        parent_tools = [FakeTool(name=f"builtin_{i}") for i in range(16)]
        tools = self._get_tool_list(parent_tools=parent_tools)
        self.assertGreaterEqual(
            len(tools),
            19,
            f"Expected >= 19 tools (16 built-in + 3 custom). Got: {len(tools)}",
        )

    def test_custom_tools_appended_after_parent(self):
        """Custom tools must be appended after built-in tools, not prepended."""
        FakeTool = _mod.types.Tool
        parent_tools = [FakeTool(name="builtin_0")]
        tools = self._get_tool_list(parent_tools=parent_tools)
        custom_names = {"browser_export_session", "browser_import_session", "browser_run_script"}
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
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
