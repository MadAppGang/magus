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
    - _reap_orphaned_profiles() must remove PID-scoped profile dirs of dead PIDs
      (and only those) on startup.
    - Local sessions must launch Playwright's bundled Chromium, never the user's
      real Chrome.app (see the REGRESSION note below for why channel='chromium'
      is not enough on its own).
    - BROWSER_USE_CLOUD=true must build a use_cloud profile without local paths.

REGRESSION (dev-fix-20260822-browser-chrome-hijack):
    channel='chromium' is only a SOFT preference upstream: when its stale macOS
    globs miss Playwright's renamed bundle, _find_installed_browser_path falls
    through to the user's real /Applications/Google Chrome.app, hijacking the
    macOS single-instance slot for com.google.Chrome.  The server must resolve
    the binary itself (_resolve_chromium_binary) and pass executable_path, which
    upstream honours before any glob runs.  Setting executable_path in turn trips
    upstream's _copy_profile is_chrome check, so the profile-directory convention
    must embed the 'browser-use-user-data-dir-' marker to keep user_data_dir out
    of a temp dir and visible to the reaper.

Automatic self-cleanup (dev-fix-20260822-browser-chrome-hijack, follow-up):
    Every cleanup path used to fire at a PROCESS boundary — _shutdown_sync at
    exit, _reap_orphaned_profiles at startup — while an MCP server lives for
    days.  The server must instead maintain itself on upstream's 120s cleanup
    cadence: free the PID-scoped profile dir whenever the LAST browser dies
    (never while one is live), reap orphans of dead servers every cycle, and
    exit when the parent `claude` is SIGKILLed.  And main() must START that
    cadence — upstream spawns it only from BrowserUseServer.run(), which main()
    bypasses to own the stdio wiring.

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

    # Upstream's default idle timeout (browser_use/mcp/server.py:190).
    session_timeout_minutes = 10

    def __init__(self, *args, **kwargs):
        self.config = {}
        self.browser_session = None
        self.active_sessions = {}
        self.tools = None
        self.llm = None
        self.file_system = None
        self._telemetry = MagicMock()
        self._start_time = time.time()
        self._cleanup_task = None
        self.cleanup_task_starts = 0
        # MagusBrowserServer._extend_list_tools() accesses self.server.request_handlers
        # and calls @self.server.list_tools() as a decorator.
        mock_server = MagicMock()
        mock_server.request_handlers = {}
        mock_server.list_tools.return_value = lambda fn: fn
        # main() awaits server.server.run(...) — a bare MagicMock is not awaitable.
        mock_server.run = AsyncMock(return_value=None)
        self.server = mock_server

    async def _execute_tool(self, tool_name, arguments):
        """Default parent implementation (never reached in tests)."""
        return f"(stub) {tool_name}"

    def _track_session(self, session):
        """No-op session tracker."""
        pass

    # ------------------------------------------------------------------
    # Session lifecycle — faithful transcription of upstream's semantics
    # (browser_use/mcp/server.py:1143-1229, browser-use 0.13.x).  The Magus
    # subclass overrides these, so the stub must behave like the real parent
    # or the overrides would be tested against a fiction.  A static check
    # (TestAutoCleanupStaticChecks) asserts the overrides still delegate.
    # ------------------------------------------------------------------

    async def _close_session(self, session_id):
        if session_id not in self.active_sessions:
            return f"Session {session_id} not found"

        session_data = self.active_sessions[session_id]
        session = session_data["session"]
        try:
            if hasattr(session, "kill"):
                await session.kill()
            elif hasattr(session, "close"):
                await session.close()

            del self.active_sessions[session_id]

            if self.browser_session and self.browser_session.id == session_id:
                self.browser_session = None
                self.tools = None

            return f"Successfully closed session {session_id}"
        except Exception as exc:
            return f"Error closing session {session_id}: {exc}"

    async def _close_all_sessions(self):
        if not self.active_sessions:
            return "No active sessions to close"

        closed_count = 0
        for session_id in list(self.active_sessions.keys()):
            result = await self._close_session(session_id)
            if "Successfully closed" in result:
                closed_count += 1

        self.browser_session = None
        self.tools = None
        return f"Closed {closed_count} sessions"

    async def _cleanup_expired_sessions(self):
        current_time = time.time()
        timeout_seconds = self.session_timeout_minutes * 60

        expired = [
            session_id
            for session_id, session_data in self.active_sessions.items()
            if current_time - session_data["last_activity"] > timeout_seconds
        ]
        for session_id in expired:
            await self._close_session(session_id)

    async def _start_cleanup_task(self):
        """Upstream spawns cleanup_loop() here; the stub just records the call."""
        self.cleanup_task_starts += 1
        self._cleanup_task = "started"


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
            _hermetic_chromium_cache(),
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
            _hermetic_chromium_cache(),
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
            _hermetic_chromium_cache(),
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
            _hermetic_chromium_cache(),
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
                _hermetic_chromium_cache(),
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
    BUG FIX: _shutdown_sync must remove the entire PID-scoped profile
    directory, not just SingletonLock.  Without this, stale Chrome profiles
    (~50MB each) accumulate indefinitely in ~/.config/browseruse/profiles/.
    """

    def test_shutdown_removes_profile_directory(self):
        """_shutdown_sync must call shutil.rmtree on the PID-scoped profile dir."""
        server = _make_server()

        import tempfile
        tmp = Path(tempfile.mkdtemp())
        pid = os.getpid()
        # _shutdown_sync builds Path.home()/".config"/"browseruse"/"profiles"/
        # f"{_NEW_SESSION_PREFIX}{pid}" — create the matching structure under tmp.
        profile_dir = tmp / ".config" / "browseruse" / "profiles" / f"{_NEW_SESSION_PREFIX}{pid}"
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
        # tmp exists but holds no .config/browseruse/profiles/<prefix>{pid} inside
        tmp = Path(tempfile.mkdtemp())
        original_home = Path.home

        def fake_home():
            return tmp

        try:
            Path.home = staticmethod(fake_home)
            # Should not raise even though the profile dir doesn't exist
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

    The setting alone does not achieve that — see TestProfileCarriesResolvedBinary
    for the executable_path that does. It is still asserted here because a user
    config may deliberately override it, which is what opts a profile out of our
    binary resolution.
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
            _hermetic_chromium_cache(),
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
            _hermetic_chromium_cache(),
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
    _reap_orphaned_profiles(base_dir=...) must remove PID-scoped profile dirs
    whose PID is dead, and must never touch: the 'default' dir, dirs of live
    PIDs, or dirs whose suffix isn't a PID.
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

            dead_dir = tmp / f"{_NEW_SESSION_PREFIX}{dead_pid}"
            live_dir = tmp / f"{_NEW_SESSION_PREFIX}{live_pid}"
            default_dir = tmp / "default"
            weird_dir = tmp / f"{_NEW_SESSION_PREFIX}notapid"

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
# Test 13: Chromium binary resolution — helpers
#
# REGRESSION: browser-use launched the user's real Chrome instead of Playwright's
# Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
#
# Why these tests do NOT use the CapturingProfile pattern for the profile guard:
# CapturingProfile substitutes BrowserProfile with a kwargs recorder, so no real
# profile is ever constructed, model_post_init never runs, and no binary is ever
# resolved. That is precisely why 90 tests passed while the bug was live. The
# resolver tests below assert the RESOLVED BINARY PATH, and the _copy_profile
# guard constructs a REAL BrowserProfile.
# ---------------------------------------------------------------------------

import contextlib  # noqa: E402
import io  # noqa: E402
import shutil as _shutil  # noqa: E402
import tempfile as _tempfile  # noqa: E402

# The profile-directory convention that keeps upstream's _copy_profile() from
# relocating our user_data_dir into tempfile.mkdtemp() once executable_path is
# set (profile.py returns early when this marker appears in the path).
_NEW_SESSION_PREFIX = "browser-use-user-data-dir-session-"

# The pre-1.5.0 convention. A server SIGKILLed before it could clean up left one
# of these behind at ~50MB, and the reaper must still sweep it.
_OLD_SESSION_PREFIX = "session-"

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
    Create one fake Playwright chromium install under cache_root and return the
    binary path.  Layouts mirror what Playwright actually ships today:

        darwin: chromium-<rev>/chrome-mac-arm64/<Bundle>.app/Contents/MacOS/<Bundle>
        linux : chromium-<rev>/chrome-linux/chrome
        win32 : chromium-<rev>/chrome-win/chrome.exe
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

    Every test that reaches _init_browser_session now resolves a real binary, so
    without this it would pass or fail on whether the developer's machine happens
    to have Playwright installed — and error on a fresh CI runner. Points
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


def _capture_profile_kwargs(profile_config=None) -> dict:
    """Run _init_browser_session and return the kwargs handed to BrowserProfile."""
    server = _make_server()
    captured: dict = {}

    class CapturingProfile:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    mock_session = MagicMock()
    mock_session.start = AsyncMock(return_value=None)

    with (
        patch.object(_mod, "BrowserProfile", CapturingProfile),
        patch.object(_mod, "BrowserSession", MagicMock(return_value=mock_session)),
        patch.object(_mod, "get_default_profile", return_value=profile_config or {}),
        patch.object(_mod, "get_default_llm", return_value={}),
    ):
        server._track_session = MagicMock()
        asyncio.run(server._init_browser_session())

    return captured


class _TempDirMixin(unittest.TestCase):
    """Temp directories that clean themselves up, resolved to their real path."""

    def _tmpdir(self) -> Path:
        tmp = Path(_tempfile.mkdtemp(prefix="magus-chromium-test-")).resolve()
        self.addCleanup(_shutil.rmtree, tmp, ignore_errors=True)
        return tmp

    def _resolver(self):
        """
        Return mcp-server.py's _resolve_chromium_binary, or fail with the reason.

        The function does not exist yet — that is the point of the RED step.
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
            "playwright install",
            str(ctx.exception).lower(),
            "The error must name the remedy (python3 -m playwright install chromium). "
            f"Got: {str(ctx.exception)!r}",
        )

    def test_resolves_binary_under_playwright_cache_on_every_layout(self):
        """
        Happy path across all three current Playwright layouts.  The macOS cases
        include a differently-named .app bundle to prove the resolver globs the
        bundle instead of hardcoding 'Google Chrome for Testing' — hardcoding is
        what went stale upstream and caused this bug.

        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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


# ---------------------------------------------------------------------------
# Test 13b: _copy_profile guard — REAL BrowserProfile, no CapturingProfile
# ---------------------------------------------------------------------------

class TestCopyProfileKeepsUserDataDir(_TempDirMixin):
    """
    Setting executable_path trips upstream's is_chrome check (profile.py: the
    path contains 'chrome' on every platform), which relocates user_data_dir
    into tempfile.mkdtemp() and blinds the reaper.  Upstream returns early when
    'browser-use-user-data-dir-' appears in the path, so our profile-directory
    convention must embed that marker.

    This is deliberate coupling to an upstream implementation detail, pinned
    here so an upstream marker change fails loudly instead of silently
    re-breaking the reaper.  It MUST construct a real BrowserProfile —
    _copy_profile runs in model_post_init, at construction, not at launch.
    """

    def test_real_profile_keeps_user_data_dir_under_browseruse_profiles(self):
        """
        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
        """
        try:
            from browser_use.browser.profile import BrowserProfile as RealBrowserProfile
        except Exception as err:  # not installed in this environment
            self.skipTest(f"browser_use is not importable: {err}")

        cache = self._tmpdir()
        fake_binary = _make_fake_chromium(cache, 1234, _current_platform_key())
        self.assertIn(
            "chrome",
            str(fake_binary).lower(),
            "precondition: every Playwright chromium binary contains 'chrome', which is "
            "what trips upstream's is_chrome check",
        )

        # Take the plugin's ACTUAL user_data_dir convention rather than restating
        # it, so this test tracks mcp-server.py instead of a copy of it.
        with _chromium_env(cache_root=cache):
            captured = _capture_profile_kwargs()
        user_data_dir = captured.get("user_data_dir")
        self.assertTrue(user_data_dir, f"profile must set user_data_dir. Got: {captured!r}")

        profiles_root = str(Path.home() / ".config" / "browseruse" / "profiles")
        temp_root = os.path.realpath(_tempfile.gettempdir())

        profile = RealBrowserProfile(
            user_data_dir=user_data_dir,
            channel="chromium",
            executable_path=str(fake_binary),
            headless=True,
        )
        resolved = str(profile.user_data_dir)

        try:
            self.assertTrue(
                resolved.startswith(profiles_root),
                "user_data_dir must stay under ~/.config/browseruse/profiles/ after "
                "executable_path is set, otherwise upstream's _copy_profile() relocates it "
                "to a temp dir the reaper cannot see. Our convention must embed the "
                f"'{_NEW_SESSION_PREFIX}' marker. Started as {user_data_dir!r}, "
                f"became {resolved!r}",
            )
            self.assertFalse(
                resolved.startswith(temp_root),
                f"user_data_dir must NOT be relocated into a temp dir. Got: {resolved!r}",
            )
        finally:
            # Upstream may have created a temp profile dir behind our back.
            if (
                not resolved.startswith(profiles_root)
                and "browser-use-user-data-dir-" in Path(resolved).name
                and Path(resolved).is_dir()
            ):
                _shutil.rmtree(resolved, ignore_errors=True)


# ---------------------------------------------------------------------------
# Test 13c: reaper round-trip over the renamed profile-directory prefix
# ---------------------------------------------------------------------------

class TestReaperHandlesNewProfilePrefix(_TempDirMixin):
    """
    The prefix rename has six code sites in mcp-server.py; the two the reaper
    owns are the glob and the PID parse (entry.name[len("session-"):]), plus the
    cmdline marker used to kill leftover Chrome.  Update the glob alone and the
    PID parse yields a non-digit string, so the reaper skips every directory —
    a silent no-op.  This test fails for either omission.
    """

    def test_dead_pid_dir_is_found_parsed_and_its_chrome_terminated(self):
        """
        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
        """
        import psutil

        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        live_pid = os.getpid()

        dead_dir = tmp / f"{_NEW_SESSION_PREFIX}{dead_pid}"
        live_dir = tmp / f"{_NEW_SESSION_PREFIX}{live_pid}"
        default_dir = tmp / "default"
        weird_dir = tmp / f"{_NEW_SESSION_PREFIX}notapid"
        for d in (dead_dir, live_dir, default_dir, weird_dir):
            d.mkdir(parents=True)
            (d / "SingletonLock").write_text("dummy")

        # Chrome still running on the dead session's profile — must be
        # terminated. The cmdline names the directory being swept, which is what
        # production looks like: browser-use records the same absolute path the
        # reaper then walks.
        orphan_chrome = MagicMock(name="orphan_chrome")
        orphan_chrome.info = {
            "pid": 4242,
            "cmdline": ["/fake/chromium", f"--user-data-dir={dead_dir}"],
        }
        # The user's own Chrome — no browseruse path, must never be touched.
        users_chrome = MagicMock(name="users_chrome")
        users_chrome.info = {
            "pid": 4243,
            "cmdline": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        }

        with patch.object(psutil, "process_iter", return_value=[orphan_chrome, users_chrome]):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        self.assertFalse(
            dead_dir.exists(),
            f"Dead-PID dir {dead_dir.name!r} must be reaped under the "
            f"'{_NEW_SESSION_PREFIX}' convention. Either the glob still matches only "
            "'session-*', or the PID parse still strips only len('session-') characters "
            "and produced a non-digit string.",
        )
        self.assertTrue(live_dir.exists(), "Live-PID dir must survive")
        self.assertTrue(default_dir.exists(), "'default' dir must survive")
        self.assertTrue(weird_dir.exists(), "Non-PID-suffixed dir must survive")

        orphan_chrome.terminate.assert_called_once_with()
        users_chrome.terminate.assert_not_called()


# ---------------------------------------------------------------------------
# Test 13e: the reaper also sweeps the pre-1.5.0 'session-<pid>' convention
# ---------------------------------------------------------------------------

class TestReaperSweepsBothProfilePrefixes(_TempDirMixin):
    """
    v1.5.0 renamed the profile convention from 'session-<pid>' to
    'browser-use-user-data-dir-session-<pid>' and the reaper's glob moved with
    it.  A directory written by a pre-1.5.0 server whose owner was SIGKILLed
    before it could clean up is therefore matched by nothing: it sits on disk at
    ~50MB with no code path that will ever remove it.

    The reaper must sweep BOTH names, and must derive the PID parse, the
    liveness check, the cmdline kill marker and the rmtree from whichever prefix
    matched — one code path, not two.
    """

    @staticmethod
    def _chrome(pid: int, profile_dir: Path) -> MagicMock:
        """
        A fake Chrome running on `profile_dir`, named by its absolute path.

        The path is the one the sweep is actually walking, which is what a real
        browser records: browser-use passes the user_data_dir it was given, and
        the reaper walks that same directory.
        """
        proc = MagicMock(name=f"chrome-{profile_dir.name}")
        proc.info = {
            "pid": pid,
            "cmdline": ["/fake/chromium", f"--user-data-dir={profile_dir}"],
        }
        return proc

    def test_glob_prefixes_cannot_double_match_the_same_directory(self):
        """
        The whole design rests on glob() anchoring at the start of the entry
        name: if 'session-*' also matched 'browser-use-user-data-dir-session-1',
        sweeping two prefixes would visit that directory twice and parse a PID
        of 'browser-use-user-data-dir-session-1' the second time.
        """
        tmp = self._tmpdir()
        for name in (
            f"{_OLD_SESSION_PREFIX}1",
            f"{_NEW_SESSION_PREFIX}1",
            "default",
        ):
            (tmp / name).mkdir()

        self.assertEqual(
            sorted(p.name for p in tmp.glob(f"{_OLD_SESSION_PREFIX}*")),
            [f"{_OLD_SESSION_PREFIX}1"],
            "glob('session-*') must not also match the new prefix — it anchors "
            "at the start of the name.",
        )
        self.assertEqual(
            sorted(p.name for p in tmp.glob(f"{_NEW_SESSION_PREFIX}*")),
            [f"{_NEW_SESSION_PREFIX}1"],
        )

    def test_old_prefix_dir_with_dead_owner_is_reaped(self):
        import psutil

        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        dead_dir = tmp / f"{_OLD_SESSION_PREFIX}{dead_pid}"
        dead_dir.mkdir()
        (dead_dir / "SingletonLock").write_text("dummy")

        with patch.object(psutil, "process_iter", return_value=[]):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        self.assertFalse(
            dead_dir.exists(),
            f"A pre-1.5.0 '{_OLD_SESSION_PREFIX}<pid>' dir whose owner is dead must be "
            "reaped. Nothing else on the machine will ever remove it, so it "
            "leaks ~50MB forever.",
        )

    def test_old_prefix_dir_with_live_owner_is_spared(self):
        import psutil

        tmp = self._tmpdir()
        live_dir = tmp / f"{_OLD_SESSION_PREFIX}{os.getpid()}"
        live_dir.mkdir()
        (live_dir / "SingletonLock").write_text("dummy")

        with patch.object(psutil, "process_iter", return_value=[]):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        self.assertTrue(
            live_dir.exists(),
            "The liveness guard must apply to the old prefix too — pulling the "
            "profile out from under a running Chrome corrupts it.",
        )

    def test_old_prefix_guards_default_and_non_numeric_suffixes(self):
        import psutil

        tmp = self._tmpdir()
        default_dir = tmp / "default"
        weird_dir = tmp / f"{_OLD_SESSION_PREFIX}notanumber"
        for d in (default_dir, weird_dir):
            d.mkdir()
            (d / "SingletonLock").write_text("dummy")

        with patch.object(psutil, "process_iter", return_value=[]):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        self.assertTrue(
            default_dir.exists(),
            "'default' is the user's shared profile and must never be parsed, "
            "matched or removed under any prefix.",
        )
        self.assertTrue(
            weird_dir.exists(),
            "'session-notanumber' must still be skipped by the isdigit() guard "
            "— the PID parse has to strip the prefix that actually matched.",
        )

    def test_old_prefix_sweep_never_kills_a_same_pid_new_prefix_browser(self):
        """
        The dangerous case. Both conventions end in '<pid>', so any test looser
        than 'these are the same directory' lets the old-prefix sweep reach a
        browser owned by the new-prefix directory at the same PID.

        Whole directory names must be compared:
        'session-4242' != 'browser-use-user-data-dir-session-4242'.
        """
        import psutil

        tmp = self._tmpdir()
        pid = TestReapOrphanedProfiles._find_dead_pid()

        old_dir = tmp / f"{_OLD_SESSION_PREFIX}{pid}"
        old_dir.mkdir()
        (old_dir / "SingletonLock").write_text("dummy")

        # Same numeric suffix, different convention: this browser belongs to the
        # new-prefix directory beside it and is none of the old-prefix sweep's
        # business — same parent, different directory.
        new_prefix_chrome = self._chrome(7001, tmp / f"{_NEW_SESSION_PREFIX}{pid}")
        # Same PID under the OLD convention: this one IS ours and must die.
        old_prefix_chrome = self._chrome(7002, old_dir)
        # The user's own Chrome — no browseruse path anywhere.
        users_chrome = MagicMock(name="users_chrome")
        users_chrome.info = {
            "pid": 7003,
            "cmdline": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        }

        with patch.object(
            psutil,
            "process_iter",
            return_value=[new_prefix_chrome, old_prefix_chrome, users_chrome],
        ):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        new_prefix_chrome.terminate.assert_not_called()
        new_prefix_chrome.kill.assert_not_called()
        old_prefix_chrome.terminate.assert_called_once_with()
        users_chrome.terminate.assert_not_called()
        self.assertFalse(old_dir.exists(), "The old-prefix dir must still be reaped")

    def test_both_prefixes_are_swept_in_a_single_pass(self):
        import psutil

        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        live_pid = os.getpid()

        old_dead = tmp / f"{_OLD_SESSION_PREFIX}{dead_pid}"
        new_dead = tmp / f"{_NEW_SESSION_PREFIX}{dead_pid}"
        old_live = tmp / f"{_OLD_SESSION_PREFIX}{live_pid}"
        new_live = tmp / f"{_NEW_SESSION_PREFIX}{live_pid}"
        default_dir = tmp / "default"
        for d in (old_dead, new_dead, old_live, new_live, default_dir):
            d.mkdir()
            (d / "SingletonLock").write_text("dummy")

        old_chrome = self._chrome(7101, old_dead)
        new_chrome = self._chrome(7102, new_dead)

        with patch.object(
            psutil, "process_iter", return_value=[old_chrome, new_chrome]
        ):
            _mod._reap_orphaned_profiles(base_dir=tmp)

        self.assertFalse(old_dead.exists(), "Old-prefix orphan must be reaped")
        self.assertFalse(new_dead.exists(), "New-prefix orphan must be reaped")
        self.assertTrue(old_live.exists(), "Old-prefix live dir must survive")
        self.assertTrue(new_live.exists(), "New-prefix live dir must survive")
        self.assertTrue(default_dir.exists(), "'default' must survive")

        old_chrome.terminate.assert_called_once_with()
        new_chrome.terminate.assert_called_once_with()

    def test_source_declares_the_prefixes_as_a_tuple_not_a_special_case(self):
        """
        The reaper must iterate a declared tuple of known prefixes. A second
        hand-rolled loop over 'session-' would drift from the first the next
        time the convention changes.
        """
        source = (Path(__file__).parent / "mcp-server.py").read_text()
        self.assertIn(
            "_REAPABLE_PROFILE_PREFIXES",
            source,
            "mcp-server.py must declare the known profile prefixes in one tuple.",
        )
        prefixes = getattr(_mod, "_REAPABLE_PROFILE_PREFIXES", None)
        self.assertIsInstance(
            prefixes, tuple, "_REAPABLE_PROFILE_PREFIXES must be a tuple"
        )
        self.assertEqual(
            list(prefixes),
            [_NEW_SESSION_PREFIX, _OLD_SESSION_PREFIX],
            "Current convention first, then the pre-1.5.0 name.",
        )


# ---------------------------------------------------------------------------
# Test 13f: the reaper matches the --user-data-dir ARGUMENT, not a substring
# ---------------------------------------------------------------------------

class TestReaperMatchesUserDataDirArgument(_TempDirMixin):
    """
    The reaper decided what to terminate with a plain substring test against the
    whole command line:

        marker = f"browseruse/profiles/{entry.name}"
        if not any(marker in arg for arg in cmdline): continue
        proc.terminate()

    Every profile directory ends in a PID, so one directory's marker is a PREFIX
    of another's name:

        marker  'browseruse/profiles/session-123'
        cmdline '--user-data-dir=~/.config/browseruse/profiles/session-1234'
                -> substring match: True

    Sweeping the dead PID 123 therefore terminated the browser of the LIVE
    server 1234.  The user lost a browser mid-task, with no error anywhere.
    Both naming conventions are affected, because both end in digits.

    v1.6.0 moved the reaper off startup and onto upstream's 120s cleanup
    cadence, which turns a rare collision into a recurring one.

    The match must be on the VALUE of a --user-data-dir argument, compared as a
    normalised path, for both spellings Chrome accepts.
    """

    @staticmethod
    def _proc(pid: int, cmdline: list, label: str = "chrome") -> MagicMock:
        proc = MagicMock(name=f"{label}-{pid}")
        proc.info = {"pid": pid, "cmdline": list(cmdline)}
        return proc

    @staticmethod
    def _profile_path(base_dir: Path, profile_name: str) -> str:
        """
        The path recorded by a browser launched on `base_dir`/`profile_name`.

        Production sees ONE directory here: browser-use is handed the
        user_data_dir the server built, and the reaper later walks that same
        directory. Building the cmdline under the base_dir being swept is
        therefore the faithful pairing. Naming a path under $HOME while the
        sweep walks a temp directory is a combination that never occurs, and
        asserting on it once forced a looser rule into the kill path.
        """
        return f"{base_dir}/{profile_name}"

    def _orphan_dir(self, prefix: str) -> tuple:
        """A profiles dir holding one orphan directory under `prefix`."""
        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        entry = tmp / f"{prefix}{dead_pid}"
        entry.mkdir()
        (entry / "SingletonLock").write_text("dummy")
        return tmp, entry, dead_pid

    def _sweep(self, base_dir: Path, processes: list) -> None:
        import psutil

        with patch.object(psutil, "process_iter", return_value=processes):
            _mod._reap_orphaned_profiles(base_dir=base_dir)

    # -- the exact bug -----------------------------------------------------

    def test_new_prefix_sweep_spares_a_browser_whose_pid_extends_its_digits(self):
        """
        THE BUG. Dead PID 123's sweep must not touch the live PID 1234's browser.
        """
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        # A LIVE server whose PID merely starts with the dead one's digits.
        live_browser = self._proc(
            8001,
            [
                "/fake/chromium",
                f"--user-data-dir={self._profile_path(tmp, f'{_NEW_SESSION_PREFIX}{dead_pid}4')}",
            ],
            label="live-browser",
        )

        self._sweep(tmp, [live_browser])

        live_browser.terminate.assert_not_called()
        live_browser.kill.assert_not_called()
        self.assertEqual(
            live_browser.terminate.call_count,
            0,
            f"Reaping the dead PID {dead_pid} terminated the browser of the LIVE "
            f"server {dead_pid}4, whose profile name merely EXTENDS the dead "
            "one's digits. The user loses a browser mid-task with no error. "
            "Match the --user-data-dir value as a path, not as a substring.",
        )
        self.assertFalse(entry.exists(), "The orphan dir itself must still be reaped")

    def test_old_prefix_sweep_spares_a_browser_whose_pid_extends_its_digits(self):
        """Same collision under the pre-1.5.0 'session-<pid>' convention."""
        tmp, entry, dead_pid = self._orphan_dir(_OLD_SESSION_PREFIX)

        live_browser = self._proc(
            8002,
            [
                "/fake/chromium",
                f"--user-data-dir={self._profile_path(tmp, f'{_OLD_SESSION_PREFIX}{dead_pid}4')}",
            ],
            label="live-browser",
        )

        self._sweep(tmp, [live_browser])

        self.assertEqual(
            live_browser.terminate.call_count,
            0,
            f"Reaping '{_OLD_SESSION_PREFIX}{dead_pid}' terminated the browser on "
            f"'{_OLD_SESSION_PREFIX}{dead_pid}4'. Both conventions end in digits, "
            "so both carry the prefix collision.",
        )
        live_browser.kill.assert_not_called()
        self.assertFalse(entry.exists(), "The orphan dir itself must still be reaped")

    def test_space_separated_spelling_spares_a_longer_pid_too(self):
        """The collision must not survive in the '--user-data-dir <path>' form."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        live_browser = self._proc(
            8003,
            [
                "/fake/chromium",
                "--user-data-dir",
                self._profile_path(tmp, f"{_NEW_SESSION_PREFIX}{dead_pid}4"),
            ],
            label="live-browser",
        )

        self._sweep(tmp, [live_browser])

        self.assertEqual(live_browser.terminate.call_count, 0)
        live_browser.kill.assert_not_called()
        self.assertFalse(entry.exists())

    # -- the legitimate case still works -----------------------------------

    def test_the_dead_owners_own_browser_is_still_terminated(self):
        """Killing the orphan's own browser is the whole point of the sweep."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        orphan_browser = self._proc(
            8004,
            ["/fake/chromium", f"--user-data-dir={self._profile_path(tmp, entry.name)}"],
            label="orphan-browser",
        )

        self._sweep(tmp, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()
        self.assertFalse(entry.exists())

    def test_the_swept_directorys_own_full_path_matches(self):
        """
        base_dir is a documented parameter: a browser recorded with the path the
        reaper is actually walking must be matched by that path. Full path
        equality is the ONLY rule, so this is the one that has to hold.
        """
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        orphan_browser = self._proc(
            8005,
            ["/fake/chromium", f"--user-data-dir={entry}"],
            label="orphan-browser",
        )

        self._sweep(tmp, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()

    def test_a_symlinked_base_dir_still_matches_the_real_path(self):
        """
        The reaper reaches its entries through base_dir, so pointing it at a
        symlink to the profiles directory yields '<link>/<name>' while the
        browser recorded the real '<dir>/<name>'. Both sides go through the same
        realpath normalisation, which is what keeps an override directory
        comparable — and is the whole job the deleted last-three-segments rule
        claimed to do.
        """
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        link = self._tmpdir() / "profiles-link"
        link.symlink_to(tmp, target_is_directory=True)

        orphan_browser = self._proc(
            8019,
            ["/fake/chromium", f"--user-data-dir={entry}"],
            label="orphan-browser",
        )

        self._sweep(link, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()
        self.assertFalse(entry.exists(), "The orphan dir itself must still be reaped")

    def test_a_symlinked_entry_is_never_reaped(self):
        """
        A symlink PLANTED in the profiles directory must be skipped outright.

        Ownership is decided by realpath equality, so a link named
        '<prefix><dead-pid>' pointing anywhere makes a browser running on the
        LINK'S TARGET compare equal — including the user's real Chrome. The
        directory contents survive (rmtree refuses a top-level symlink), but the
        kill does not: we would terminate a browser we do not own.

        Skipping symlinked entries closes it. It does not weaken
        test_a_symlinked_base_dir_still_matches_the_real_path above: there the
        symlink is base_dir itself and the entry's own final component is a real
        directory, which is the case that legitimately needs realpath.
        """
        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        target = self._tmpdir() / "someone-elses-profile"
        target.mkdir()

        planted = tmp / f"{_NEW_SESSION_PREFIX}{dead_pid}"
        planted.symlink_to(target, target_is_directory=True)

        # A browser legitimately running on the link's target, owned by nobody here.
        foreign_browser = self._proc(
            8020,
            ["/fake/chromium", f"--user-data-dir={target}"],
            label="foreign-browser",
        )

        self._sweep(tmp, [foreign_browser])

        foreign_browser.terminate.assert_not_called()
        self.assertTrue(
            planted.is_symlink(),
            "The planted link must be left alone, not followed and reaped",
        )
        self.assertTrue(target.is_dir(), "The link's target must be untouched")

    def test_space_separated_user_data_dir_is_matched(self):
        """Chrome accepts '--user-data-dir <path>'; the value is the NEXT arg."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        orphan_browser = self._proc(
            8006,
            ["/fake/chromium", "--user-data-dir", self._profile_path(tmp, entry.name)],
            label="orphan-browser",
        )

        self._sweep(tmp, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()

    def test_a_dangling_user_data_dir_flag_is_not_a_match(self):
        """'--user-data-dir' as the last argument has no value to compare."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        proc = self._proc(8007, ["/fake/chromium", "--user-data-dir"], label="dangling")

        self._sweep(tmp, [proc])

        proc.terminate.assert_not_called()
        proc.kill.assert_not_called()

    # -- normalisation -----------------------------------------------------

    def test_a_trailing_slash_on_the_cmdline_value_still_matches(self):
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        orphan_browser = self._proc(
            8008,
            ["/fake/chromium", f"--user-data-dir={self._profile_path(tmp, entry.name)}/"],
            label="orphan-browser",
        )

        self._sweep(tmp, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()

    def test_dot_dot_segments_in_the_cmdline_value_still_match(self):
        """Both sides must be normalised the same way before comparing."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        noisy = f"{tmp}/../{tmp.name}/./{entry.name}"
        orphan_browser = self._proc(
            8009, ["/fake/chromium", f"--user-data-dir={noisy}"], label="orphan-browser"
        )

        self._sweep(tmp, [orphan_browser])

        orphan_browser.terminate.assert_called_once_with()

    def test_a_trailing_slash_does_not_reopen_the_collision(self):
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        live_browser = self._proc(
            8010,
            [
                "/fake/chromium",
                f"--user-data-dir={self._profile_path(tmp, f'{_NEW_SESSION_PREFIX}{dead_pid}4')}/",
            ],
            label="live-browser",
        )

        self._sweep(tmp, [live_browser])

        self.assertEqual(live_browser.terminate.call_count, 0)
        live_browser.kill.assert_not_called()

    # -- everything else on the machine is untouchable ---------------------

    def test_the_users_own_chrome_is_never_terminated(self):
        """No browseruse path anywhere: not ours, under any matching rule."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        users_chrome = self._proc(
            8011,
            [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                f"--user-data-dir={Path.home()}/Library/Application Support/Google/Chrome",
            ],
            label="users-chrome",
        )

        self._sweep(tmp, [users_chrome])

        users_chrome.terminate.assert_not_called()
        users_chrome.kill.assert_not_called()

    def test_the_profile_path_in_another_flag_is_not_a_kill_signal(self):
        """
        Only --user-data-dir says 'this process is running ON that profile'. A
        path that merely appears somewhere else in the command line does not.
        """
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        log_reader = self._proc(
            8012,
            [
                "/fake/chromium",
                f"--log-file={self._profile_path(tmp, entry.name)}/chrome_debug.log",
                f"--user-data-dir={self._profile_path(tmp, 'default')}",
            ],
            label="other-flag",
        )

        self._sweep(tmp, [log_reader])

        log_reader.terminate.assert_not_called()
        log_reader.kill.assert_not_called()

    def test_a_relative_user_data_dir_is_never_matched(self):
        """
        A relative --user-data-dir is resolved against the OWNING process's
        working directory, which the reaper does not know. Normalising it
        against the reaper's own cwd invents a path and can manufacture a match
        for a directory that is not ours — so a non-absolute value is skipped.

        Nothing this plugin launches can be affected: user_data_dir is built
        from Path.home() and is always absolute.
        """
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        # Stand the REAPER in the directory it is sweeping, which is where a
        # naive normalisation does the damage: without the isabs guard,
        # './<name>' resolves against THIS process's cwd straight onto the swept
        # entry, and a browser that never named our directory is terminated.
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(tmp)

        someone_elses = [
            self._proc(
                8018,
                ["/fake/chromium", f"--user-data-dir=browseruse/profiles/{entry.name}"],
                label="relative-path",
            ),
            self._proc(
                8020,
                ["/fake/chromium", f"--user-data-dir=./{entry.name}"],
                label="relative-onto-cwd",
            ),
        ]

        self._sweep(tmp, someone_elses)

        for proc in someone_elses:
            proc.terminate.assert_not_called()
            proc.kill.assert_not_called()

    def test_a_malformed_cmdline_never_raises_and_never_matches(self):
        """cmdline is untrusted input read from an arbitrary process."""
        tmp, entry, dead_pid = self._orphan_dir(_NEW_SESSION_PREFIX)

        weird = [
            self._proc(8013, [], label="empty"),
            self._proc(8014, ["--user-data-dir="], label="empty-value"),
            self._proc(8015, ["--user-data-dir", ""], label="empty-next"),
            self._proc(8016, [None, 42, "--user-data-dir"], label="non-strings"),
        ]
        no_cmdline = MagicMock(name="no-cmdline")
        no_cmdline.info = {"pid": 8017, "cmdline": None}
        weird.append(no_cmdline)

        self._sweep(tmp, weird)

        for proc in weird:
            proc.terminate.assert_not_called()
            proc.kill.assert_not_called()
        self.assertFalse(entry.exists(), "The sweep must still complete")


# ---------------------------------------------------------------------------
# Test 13g: the reaper never reaches a browser under a DIFFERENT root
# ---------------------------------------------------------------------------

class TestReaperNeverReachesAnotherHome(_TempDirMixin):
    """
    Ownership used to be accepted on EITHER of two rules: full path equality
    with the directory being swept, or the value's last three segments being
    'browseruse/profiles/<that directory name>'.

    The second rule is not an ownership proof.  It matches any absolute path on
    the machine that ends in those three segments — a second user account's
    ~/.config/browseruse/profiles/<name>, a container's mounted rootfs, a
    restored backup — as long as the profile directory NAME matches.  Those
    names collide readily: they are '<prefix><pid>', and PIDs repeat across
    boots, across accounts and inside containers, so the collision needs no bad
    luck at all.

    Sweeping OUR orphan could therefore terminate a browser owned by someone
    else — the same class of bug as the substring match, reached by a different
    route.  Ownership is full normalised path equality with the directory being
    swept, and nothing else.
    """

    @staticmethod
    def _proc(pid: int, cmdline: list, label: str = "chrome") -> MagicMock:
        proc = MagicMock(name=f"{label}-{pid}")
        proc.info = {"pid": pid, "cmdline": list(cmdline)}
        return proc

    def _orphan(self, prefix: str) -> tuple:
        """A profiles dir holding one dead-owner orphan directory."""
        tmp = self._tmpdir()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()
        entry = tmp / f"{prefix}{dead_pid}"
        entry.mkdir()
        (entry / "SingletonLock").write_text("dummy")
        return tmp, entry

    def _sweep(self, base_dir: Path, processes: list) -> None:
        import psutil

        with patch.object(psutil, "process_iter", return_value=processes):
            _mod._reap_orphaned_profiles(base_dir=base_dir)

    def test_new_prefix_sweep_spares_the_same_name_under_another_home(self):
        """
        THE HAZARD. Another account's browser, same profile directory NAME,
        different $HOME: not ours, must not be touched.
        """
        tmp, entry = self._orphan(_NEW_SESSION_PREFIX)

        stranger = self._proc(
            8101,
            [
                "/fake/chromium",
                f"--user-data-dir=/some/other/home/.config/browseruse/profiles/{entry.name}",
            ],
            label="another-users-browser",
        )

        self._sweep(tmp, [stranger])

        self.assertEqual(
            stranger.terminate.call_count,
            0,
            "The reaper terminated a browser running under a DIFFERENT root "
            f"(/some/other/home/.config/browseruse/profiles/{entry.name}) that "
            f"merely shares the swept directory's NAME. {entry} is not that "
            "directory. Ownership must be full normalised path equality.",
        )
        stranger.kill.assert_not_called()
        self.assertFalse(entry.exists(), "The orphan dir itself must still be reaped")

    def test_old_prefix_sweep_spares_the_same_name_under_another_root(self):
        """Same hazard under the pre-1.5.0 convention, via a container mount."""
        tmp, entry = self._orphan(_OLD_SESSION_PREFIX)

        stranger = self._proc(
            8102,
            [
                "/fake/chromium",
                "--user-data-dir=/mnt/containers/app/root/.config/browseruse/"
                f"profiles/{entry.name}",
            ],
            label="container-browser",
        )

        self._sweep(tmp, [stranger])

        self.assertEqual(
            stranger.terminate.call_count,
            0,
            "A container mount holding the same profile name is a different "
            "directory and a different process namespace. Both naming "
            "conventions carry this collision, because both end in a PID.",
        )
        stranger.kill.assert_not_called()
        self.assertFalse(entry.exists(), "The orphan dir itself must still be reaped")

    def test_the_swept_directorys_own_browser_is_still_terminated(self):
        """
        The rule must stay useful: the browser actually running on the swept
        directory still dies, under either prefix, while the same-name stranger
        beside it survives the same sweep.
        """
        for prefix in (_NEW_SESSION_PREFIX, _OLD_SESSION_PREFIX):
            with self.subTest(prefix=prefix):
                tmp, entry = self._orphan(prefix)

                ours = self._proc(
                    8103,
                    ["/fake/chromium", f"--user-data-dir={entry}"],
                    label="ours",
                )
                stranger = self._proc(
                    8104,
                    [
                        "/fake/chromium",
                        "--user-data-dir=/some/other/home/.config/browseruse/"
                        f"profiles/{entry.name}",
                    ],
                    label="stranger",
                )

                self._sweep(tmp, [ours, stranger])

                ours.terminate.assert_called_once_with()
                self.assertEqual(
                    stranger.terminate.call_count,
                    0,
                    "Only the browser on the swept directory itself is ours.",
                )
                self.assertFalse(entry.exists())


# ---------------------------------------------------------------------------
# Test 13d: the profile build actually carries the resolver's output
# ---------------------------------------------------------------------------

class TestProfileCarriesResolvedBinary(_TempDirMixin):
    """
    channel='chromium' alone is a soft preference upstream ignores when its
    globs miss.  The profile must carry an explicit executable_path, which
    upstream honours before any glob runs.
    """

    def test_profile_includes_executable_path_that_is_not_the_users_chrome(self):
        """
        # REGRESSION: browser-use launched the user's real Chrome instead of
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
        """
        cache = self._tmpdir()
        _make_fake_chromium(cache, 1234, _current_platform_key())

        with _chromium_env(cache_root=cache):
            captured = _capture_profile_kwargs()

        executable_path = captured.get("executable_path")
        self.assertIsNotNone(
            executable_path,
            "Local profiles must set executable_path from _resolve_chromium_binary(). "
            "Without it, channel='chromium' is only a soft preference and upstream "
            "falls through to /Applications/Google Chrome.app. "
            f"Profile kwargs were: {sorted(captured)!r}",
        )
        self.assertNotIn(
            _HIJACK_PATH_FRAGMENT,
            str(executable_path),
            f"executable_path must never be the user's real Chrome. Got: {executable_path!r}",
        )
        self.assertTrue(
            str(executable_path).startswith(str(cache)),
            "executable_path must come from the Playwright cache named by "
            f"PLAYWRIGHT_BROWSERS_PATH ({str(cache)!r}). Got: {executable_path!r}",
        )


# ---------------------------------------------------------------------------
# Test 13e: browser_doctor reports WHERE the binary came from, and survives
# the resolver raising
# ---------------------------------------------------------------------------

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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
        # Playwright's Chromium — /dev:fix session dev-fix-20260822-browser-chrome-hijack
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
            "playwright install",
            str(data["chromium_error"]).lower(),
            "The reported error must name the remedy (python3 -m playwright install "
            f"chromium). Got: {data['chromium_error']!r}",
        )


# ---------------------------------------------------------------------------
# Test 14: the server cleans up after itself WHILE IT RUNS, not only at exit
#
# Shipped state: every cleanup path fired exactly once, at a process boundary.
# _shutdown_sync (atexit / SIGTERM) was the only thing that removed the ~50MB
# PID-scoped profile dir, and _reap_orphaned_profiles ran only from main().
# An MCP server lives for days, so:
#   - upstream's 10-minute idle sweep killed Chrome and left the profile behind;
#   - orphans of dead servers were never swept unless a NEW server started;
#   - a SIGKILLed parent stranded the server, its Chrome and its profile forever.
# Measured: 38 live plugin servers, 0 Chrome processes, one 74MB profile per PID.
#
# Worse, main() bypasses upstream's BrowserUseServer.run() to own the stdio
# wiring — and run() is the only caller of _start_cleanup_task(), so the idle
# sweep never ran here at all.
# ---------------------------------------------------------------------------


def _fake_browser_session(session_id: str, kill_error: BaseException | None = None):
    """A BrowserSession stand-in whose kill() is awaitable (and can fail)."""
    session = MagicMock(name=f"session-{session_id}")
    session.id = session_id
    session.kill = AsyncMock(side_effect=kill_error) if kill_error else AsyncMock(return_value=None)
    return session


def _track(server, *sessions, last_activity=None):
    """Register sessions the way upstream's _track_session does."""
    now = time.time()
    for session in sessions:
        server.active_sessions[session.id] = {
            "session": session,
            "created_at": now,
            "last_activity": now if last_activity is None else last_activity,
            "url": None,
        }


_IDLE_LONGER_THAN_TIMEOUT = 3600  # seconds; upstream's timeout is 10 minutes


@contextlib.contextmanager
def _fake_home(create_profile_dir: bool = True):
    """
    A throwaway HOME containing this process's PID-scoped profile directory.

    Everything under test resolves the profile dir through Path.home(), so
    redirecting it keeps the developer's real ~/.config/browseruse untouched —
    these tests delete directories and must never reach a live one.
    """
    tmp = Path(_tempfile.mkdtemp(prefix="magus-profile-home-")).resolve()
    profile_dir = (
        tmp / ".config" / "browseruse" / "profiles" / f"{_NEW_SESSION_PREFIX}{os.getpid()}"
    )
    if create_profile_dir:
        profile_dir.mkdir(parents=True)
        (profile_dir / "Cookies").write_text("dummy")
        (profile_dir / "SingletonLock").write_text("dummy")
        (profile_dir / "Default").mkdir()

    original_home = Path.home
    try:
        Path.home = staticmethod(lambda: tmp)
        yield tmp, profile_dir
    finally:
        Path.home = original_home
        _shutil.rmtree(tmp, ignore_errors=True)


class _FakeStdioServer:
    """Async context manager standing in for mcp.server.stdio.stdio_server()."""

    async def __aenter__(self):
        return (MagicMock(name="read_stream"), MagicMock(name="write_stream"))

    async def __aexit__(self, *exc_info):
        return False


# ---------------------------------------------------------------------------
# Test 14a: the profile directory is freed when the last browser dies
# ---------------------------------------------------------------------------

class TestProfileDirFreedWhenBrowserDies(unittest.TestCase):
    """
    Killing Chrome must also free its profile directory — at whichever moment
    the browser actually dies, not merely at process exit.  Never while a
    browser is still running on it.
    """

    def test_profile_dir_removed_when_last_session_is_closed(self):
        server = _make_server()
        session = _fake_browser_session("s1")
        server.browser_session = session
        _track(server, session)

        with _fake_home() as (_, profile_dir):
            result = asyncio.run(server._close_session("s1"))
            survived = profile_dir.exists()

        self.assertIn("Successfully closed", result)
        self.assertFalse(
            survived,
            "The last browser session was closed, so nothing is running on the "
            "PID-scoped profile dir — it must be removed there and then. Waiting "
            "for process exit leaks ~50MB for the multi-day life of the server.",
        )

    def test_profile_dir_survives_while_another_session_is_live(self):
        server = _make_server()
        first = _fake_browser_session("s1")
        second = _fake_browser_session("s2")
        server.browser_session = first
        _track(server, first, second)

        with _fake_home() as (_, profile_dir):
            asyncio.run(server._close_session("s1"))
            survived = profile_dir.exists()

        self.assertTrue(
            survived,
            "Session s2 is still running on this profile directory. Removing it "
            "would pull the profile out from under a live Chrome.",
        )

    def test_idle_sweep_frees_profile_dir(self):
        """The 10-minute idle path kills Chrome — the profile must go with it."""
        server = _make_server()
        session = _fake_browser_session("idle")
        server.browser_session = session
        _track(server, session, last_activity=time.time() - _IDLE_LONGER_THAN_TIMEOUT)

        with (
            _fake_home() as (_, profile_dir),
            patch.object(_mod, "_reap_orphaned_profiles", MagicMock()),
        ):
            asyncio.run(server._cleanup_expired_sessions())
            survived = profile_dir.exists()

        self.assertNotIn("idle", server.active_sessions, "Upstream must have closed it")
        self.assertFalse(
            survived,
            "Upstream's idle sweep killed the browser after 10 idle minutes but "
            "left its profile dir on disk. That is the leak: 38 servers x 74MB.",
        )

    def test_idle_sweep_keeps_profile_dir_when_a_session_is_still_active(self):
        server = _make_server()
        expired = _fake_browser_session("expired")
        active = _fake_browser_session("active")
        server.browser_session = active
        _track(server, expired, last_activity=time.time() - _IDLE_LONGER_THAN_TIMEOUT)
        _track(server, active)

        with (
            _fake_home() as (_, profile_dir),
            patch.object(_mod, "_reap_orphaned_profiles", MagicMock()),
        ):
            asyncio.run(server._cleanup_expired_sessions())
            survived = profile_dir.exists()

        self.assertNotIn("expired", server.active_sessions)
        self.assertIn("active", server.active_sessions)
        self.assertTrue(
            survived,
            "One session expired but another is still driving a browser on this "
            "profile directory — it must survive.",
        )

    def test_failed_close_keeps_profile_dir(self):
        """
        A close that errors leaves the session tracked, so the browser may well
        still be alive.  Removing the directory under it is the one unsafe move.
        """
        server = _make_server()
        session = _fake_browser_session("stuck", kill_error=RuntimeError("kill timed out"))
        server.browser_session = session
        _track(server, session)

        with _fake_home() as (_, profile_dir):
            result = asyncio.run(server._close_session("stuck"))
            survived = profile_dir.exists()

        self.assertIn("Error closing session", result)
        self.assertIn("stuck", server.active_sessions)
        self.assertTrue(
            survived,
            "kill() failed, so Chrome may still be running on this profile. The "
            "directory must not be removed on a failed close.",
        )

    def test_close_all_sessions_frees_profile_dir(self):
        server = _make_server()
        first = _fake_browser_session("s1")
        second = _fake_browser_session("s2")
        server.browser_session = first
        _track(server, first, second)

        with _fake_home() as (_, profile_dir):
            asyncio.run(server._close_all_sessions())
            survived = profile_dir.exists()

        self.assertFalse(
            survived,
            "browser_close_all_sessions killed every browser this server owns; "
            "the profile dir must be freed with the last one.",
        )


# ---------------------------------------------------------------------------
# Test 14b: the orphan reaper runs on a timer, not only at startup
# ---------------------------------------------------------------------------

class TestPeriodicOrphanReaping(unittest.TestCase):
    """
    _reap_orphaned_profiles only ever ran from main().  On a machine where no
    new server starts, nothing is ever swept — orphaned profiles and any Chrome
    stranded by a dead server sit there indefinitely.
    """

    def test_cleanup_cycle_invokes_the_reaper(self):
        server = _make_server()
        reaper = MagicMock()

        with patch.object(_mod, "_reap_orphaned_profiles", reaper):
            asyncio.run(server._cleanup_expired_sessions())

        reaper.assert_called_once_with()

    def test_periodic_sweep_spares_live_pids_and_the_default_profile(self):
        """The timer must reuse the reaper's guards, not a looser copy of them."""
        import psutil

        server = _make_server()
        dead_pid = TestReapOrphanedProfiles._find_dead_pid()

        with _fake_home(create_profile_dir=False) as (home, _):
            profiles = home / ".config" / "browseruse" / "profiles"
            dead_dir = profiles / f"{_NEW_SESSION_PREFIX}{dead_pid}"
            live_dir = profiles / f"{_NEW_SESSION_PREFIX}{os.getpid()}"
            default_dir = profiles / "default"
            weird_dir = profiles / f"{_NEW_SESSION_PREFIX}notapid"
            for directory in (dead_dir, live_dir, default_dir, weird_dir):
                directory.mkdir(parents=True)
                (directory / "SingletonLock").write_text("dummy")

            # No real process scan: this test must never touch a live process.
            with patch.object(psutil, "process_iter", return_value=[]):
                asyncio.run(server._cleanup_expired_sessions())

            results = {
                "dead": dead_dir.exists(),
                "live": live_dir.exists(),
                "default": default_dir.exists(),
                "weird": weird_dir.exists(),
            }

        self.assertFalse(
            results["dead"],
            "A profile dir whose owning server is dead must be reaped by the "
            "periodic sweep, without waiting for some future server to start.",
        )
        self.assertTrue(results["live"], "A live PID's profile dir must survive")
        self.assertTrue(results["default"], "The 'default' profile dir must never be touched")
        self.assertTrue(results["weird"], "A non-PID-suffixed dir must survive")

    def test_main_starts_the_cleanup_loop(self):
        """
        main() bypasses upstream's run(), which is the ONLY caller of
        _start_cleanup_task().  Without an explicit start here, every periodic
        behaviour in this file is dead code.
        """
        started: list = []

        async def recording_start(self):
            started.append(self)

        with (
            patch.object(_mod, "_reap_orphaned_profiles", MagicMock()),
            patch.object(_mod, "_install_shutdown_handlers", MagicMock()),
            patch.object(_mod.MagusBrowserServer, "_start_cleanup_task", recording_start),
            patch.object(
                _mod.mcp.server.stdio,
                "stdio_server",
                MagicMock(return_value=_FakeStdioServer()),
            ),
        ):
            asyncio.run(_mod.main())

        self.assertEqual(
            len(started),
            1,
            "main() must start the periodic cleanup loop exactly once. Upstream "
            "starts it in BrowserUseServer.run(), which main() does not call.",
        )


# ---------------------------------------------------------------------------
# Test 14c: exit when the parent claude process dies
# ---------------------------------------------------------------------------

class TestParentDeathShutdown(unittest.TestCase):
    """
    A SIGKILLed `claude` leaves the server reparented to init: nobody reads its
    stdio, nobody signals it, and its Chrome plus ~50MB profile survive forever.
    os.getppid() changes the instant the kernel reparents us — that is the whole
    signal, and it needs no process scan and no name matching.
    """

    def _require(self, name: str):
        attr = getattr(_mod, name, None)
        if attr is None:
            self.fail(
                f"mcp-server.py must define {name}(): parent-death shutdown has to go "
                "through a module-level seam so it can be exercised without killing "
                "the test runner."
            )
        return attr

    def test_parent_pid_is_captured_at_startup(self):
        server = _make_server()
        captured = getattr(server, "_parent_pid", None)
        if captured is None:
            self.fail(
                "MagusBrowserServer must capture os.getppid() at startup — after "
                "reparenting there is nothing left to compare against."
            )
        self.assertEqual(captured, os.getppid())

    def test_reparented_server_shuts_down_and_exits(self):
        self._require("_exit_process")
        server = _make_server()

        with (
            patch.object(_mod, "_reap_orphaned_profiles", MagicMock()),
            patch.object(server, "_shutdown_sync", MagicMock()) as shutdown,
            patch.object(_mod, "_exit_process", MagicMock()) as exit_process,
            patch.object(os, "getppid", return_value=1),
        ):
            asyncio.run(server._cleanup_expired_sessions())

        shutdown.assert_called_once_with()
        self.assertEqual(
            exit_process.call_args_list,
            [call(0)],
            "A reparented server must take itself down through the existing "
            "shutdown path (killing Chrome, removing the profile dir) and then "
            "exit — otherwise it lingers with nobody to clean up after it.",
        )

    def test_live_parent_does_not_shut_down(self):
        self._require("_exit_process")
        server = _make_server()
        parent_pid = server._parent_pid

        with (
            patch.object(_mod, "_reap_orphaned_profiles", MagicMock()),
            patch.object(server, "_shutdown_sync", MagicMock()) as shutdown,
            patch.object(_mod, "_exit_process", MagicMock()) as exit_process,
            patch.object(os, "getppid", return_value=parent_pid),
        ):
            asyncio.run(server._cleanup_expired_sessions())

        shutdown.assert_not_called()
        exit_process.assert_not_called()


# ---------------------------------------------------------------------------
# Test 14d: static guards on the cleanup wiring
# ---------------------------------------------------------------------------

class TestAutoCleanupStaticChecks(unittest.TestCase):
    """
    The overrides above are tested against a transcription of upstream's
    behaviour (_StubBrowserUseServer).  These checks pin the two things that
    transcription cannot prove: that the overrides still DELEGATE to the real
    parent, and that no cleanup path resorts to a pattern-based process kill.
    """

    @classmethod
    def setUpClass(cls):
        import ast

        source = (Path(__file__).parent / "mcp-server.py").read_text()
        cls.source = source
        tree = ast.parse(source)

        cls.methods: dict = {}
        cls.functions: dict = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "MagusBrowserServer":
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        cls.methods[item.name] = ast.get_source_segment(source, item) or ""
        for item in tree.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                cls.functions[item.name] = ast.get_source_segment(source, item) or ""

    def _method(self, name: str) -> str:
        src = self.methods.get(name)
        if not src:
            self.fail(f"MagusBrowserServer must override {name}()")
        return src

    def test_close_session_override_delegates_to_super(self):
        self.assertIn(
            "super()._close_session",
            self._method("_close_session"),
            "The override must delegate: upstream is what actually kills the "
            "browser and untracks the session.",
        )

    def test_cleanup_cycle_override_delegates_to_super(self):
        self.assertIn(
            "super()._cleanup_expired_sessions",
            self._method("_cleanup_expired_sessions"),
            "The override must delegate: upstream is what expires idle sessions.",
        )

    def test_main_awaits_the_cleanup_task(self):
        self.assertIn(
            "_start_cleanup_task",
            self.functions.get("main", ""),
            "main() bypasses upstream's run(), so it must start the periodic "
            "cleanup loop itself.",
        )

    def test_no_pattern_based_process_kill(self):
        for banned in ("pkill", "killall", "kill -9"):
            self.assertNotIn(
                banned,
                self.source,
                f"{banned!r} kills by name/pattern and would reach processes this "
                "server does not own. Every kill must target an explicit PID.",
            )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
