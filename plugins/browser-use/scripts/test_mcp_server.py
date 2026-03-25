"""
Unit tests for mcp-server.py — SingletonLock contention fix.

REGRESSION: SingletonLock contention — Fixed in /dev:fix session dev-fix-20260325-143046-4ff02ed6

These are RED tests for the TDD cycle. They verify the behaviour that SHOULD
exist after the fix is applied. Since the helper function
`_read_devtools_active_port` does not exist in the current code, importing it
will raise ImportError and every test in this file will fail — which is the
expected RED state.

The fix (GREEN step) must:
1. Add `_read_devtools_active_port(user_data_dir: str | Path) -> str | None`
   to mcp-server.py.
2. Update `get_or_create_session()` to call that helper and, when it returns a
   non-None URL, pass `cdp_url=<url>` to BrowserProfile instead of launching a
   new Chrome subprocess.
"""

import importlib
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Bootstrap: we need to import _read_devtools_active_port from mcp-server.py
# without triggering the full server startup (which would try to import
# browser_use, set up MCP transport, etc.).
#
# Strategy: temporarily inject a stub for every heavy third-party module so
# the file can be exec'd in isolation, then retrieve the symbol we need.
# ---------------------------------------------------------------------------

_STUB_NAMES = [
    "browser_use",
    "browser_use.browser",
    "browser_use.config",
    "browser_use.utils",
    "mcp",
    "mcp.server",
    "mcp.server.stdio",
    "mcp.server.models",
    "mcp.types",
    "langchain_openai",
    "langchain_anthropic",
    "langchain_google_genai",
]


def _make_stub(name: str) -> MagicMock:
    stub = MagicMock()
    stub.__name__ = name
    stub.__package__ = name
    stub.__path__ = []  # mark as package so sub-imports work
    stub.__spec__ = importlib.util.spec_from_loader(name, loader=None)
    return stub


def _install_stubs() -> dict:
    """Inject lightweight module stubs so mcp-server.py can be imported."""
    saved = {}
    for name in _STUB_NAMES:
        saved[name] = sys.modules.get(name)
        sys.modules[name] = _make_stub(name)

    # browser_use.browser needs realistic class names used at module level
    browser_stub = sys.modules["browser_use.browser"]
    browser_stub.BrowserProfile = MagicMock(name="BrowserProfile")
    browser_stub.BrowserSession = MagicMock(name="BrowserSession")

    # browser_use.config helpers used at module level
    config_stub = sys.modules["browser_use.config"]
    config_stub.get_default_llm = MagicMock(return_value=MagicMock())
    config_stub.get_default_profile = MagicMock(return_value={})
    config_stub.load_browser_use_config = MagicMock(return_value={})

    # mcp.server needs Server class and sub-attributes used at module level
    mcp_server_stub = sys.modules["mcp.server"]
    mcp_server_stub.NotificationOptions = MagicMock(name="NotificationOptions")
    mcp_server_stub.Server = MagicMock(name="Server")

    # mcp.server.models needs InitializationOptions
    mcp_models_stub = sys.modules["mcp.server.models"]
    mcp_models_stub.InitializationOptions = MagicMock(name="InitializationOptions")

    return saved


def _restore_stubs(saved: dict) -> None:
    for name, orig in saved.items():
        if orig is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = orig


def _load_mcp_server_module():
    """
    Load mcp-server.py as a module named '_mcp_server_under_test'.

    Raises ImportError if _read_devtools_active_port is absent (RED state).
    """
    server_path = Path(__file__).parent / "mcp-server.py"
    spec = importlib.util.spec_from_file_location("_mcp_server_under_test", server_path)
    mod = importlib.util.module_from_spec(spec)
    # Prevent the --test / asyncio.run block from firing
    sys.argv = ["mcp-server.py"]
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Attempt to load the module once for the whole test session.
# If the symbol is missing we surface a clear ImportError so CI shows RED.
# ---------------------------------------------------------------------------
_saved_modules = _install_stubs()
try:
    _server_mod = _load_mcp_server_module()
    # This line is the tripwire: if the function doesn't exist yet, AttributeError
    # is raised here and every test class below will error out → RED.
    _read_devtools_active_port = _server_mod._read_devtools_active_port
except (ImportError, AttributeError) as _load_err:
    _server_mod = None
    _read_devtools_active_port = None
    _LOAD_ERROR = _load_err
else:
    _LOAD_ERROR = None
finally:
    _restore_stubs(_saved_modules)


def _require_function(test_case: unittest.TestCase) -> None:
    """Skip-with-failure helper: turns missing symbol into a hard test failure."""
    if _read_devtools_active_port is None:
        test_case.fail(
            f"_read_devtools_active_port not found in mcp-server.py — "
            f"RED state as expected. Original error: {_LOAD_ERROR}"
        )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestReadDevtoolsActivePortFileAbsent(unittest.TestCase):
    """Returns None when DevToolsActivePort does not exist."""

    def test_returns_none_when_file_missing(self):
        _require_function(self)

        with patch("tempfile.mkdtemp") as _:
            import tempfile

            tmp = Path(tempfile.mkdtemp())
            try:
                result = _read_devtools_active_port(tmp)
                self.assertIsNone(
                    result,
                    "Expected None when DevToolsActivePort is absent, got: %r" % result,
                )
            finally:
                import shutil

                shutil.rmtree(tmp, ignore_errors=True)


class TestReadDevtoolsActivePortPortReachable(unittest.TestCase):
    """Returns a cdp_url string when the file exists and port is reachable."""

    def test_returns_cdp_url_when_port_reachable(self):
        _require_function(self)

        import tempfile

        tmp = Path(tempfile.mkdtemp())
        try:
            # Write a realistic DevToolsActivePort file (port on line 1)
            active_port_file = tmp / "DevToolsActivePort"
            active_port_file.write_text("9222\n/devtools/browser/some-uuid\n")

            # Patch socket so the reachability check always succeeds
            with patch("socket.create_connection") as mock_conn:
                mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock())
                mock_conn.return_value.__exit__ = MagicMock(return_value=False)

                result = _read_devtools_active_port(tmp)

            self.assertIsNotNone(
                result,
                "Expected a CDP URL string when port is reachable, got None",
            )
            self.assertIn(
                "9222",
                result,
                "CDP URL must include the port number from DevToolsActivePort",
            )
            self.assertTrue(
                result.startswith("http://"),
                "CDP URL should start with http://",
            )
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


class TestReadDevtoolsActivePortPortUnreachable(unittest.TestCase):
    """Returns None when the file exists but the port is stale / not listening."""

    def test_returns_none_when_port_not_reachable(self):
        _require_function(self)

        import tempfile

        tmp = Path(tempfile.mkdtemp())
        try:
            active_port_file = tmp / "DevToolsActivePort"
            active_port_file.write_text("9222\n/devtools/browser/some-uuid\n")

            # Patch socket to simulate connection refused
            with patch("socket.create_connection", side_effect=OSError("Connection refused")):
                result = _read_devtools_active_port(tmp)

            self.assertIsNone(
                result,
                "Expected None when port is unreachable (stale lock), got: %r" % result,
            )
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


class TestGetOrCreateSessionUsesCdpUrl(unittest.TestCase):
    """
    When DevToolsActivePort is present and reachable, get_or_create_session()
    must construct BrowserProfile with cdp_url rather than launching a new
    Chrome process.
    """

    def test_passes_cdp_url_to_browser_profile_when_port_reachable(self):
        _require_function(self)

        import asyncio
        import tempfile

        if _server_mod is None:
            self.fail("mcp-server module failed to load: %s" % _LOAD_ERROR)

        tmp = Path(tempfile.mkdtemp())
        try:
            active_port_file = tmp / "DevToolsActivePort"
            active_port_file.write_text("9222\n/devtools/browser/some-uuid\n")

            captured_kwargs: list[dict] = []

            class CapturingBrowserProfile:
                def __init__(self, **kwargs):
                    captured_kwargs.append(kwargs)

            mock_session = MagicMock()
            # Use AsyncMock for the awaitable start() method
            mock_session.start = AsyncMock(return_value=None)

            # Clear the in-process session registry so get_or_create_session creates new
            _server_mod._sessions.clear()

            # Patch at module level — the names are bound by 'from ... import'
            with (
                patch.object(_server_mod, "BrowserProfile", CapturingBrowserProfile),
                patch.object(_server_mod, "BrowserSession", MagicMock(return_value=mock_session)),
                patch.object(_server_mod, "_read_devtools_active_port", return_value="http://127.0.0.1:9222"),
                patch.object(_server_mod, "load_browser_use_config", return_value={}),
                patch.object(_server_mod, "get_default_profile", return_value={}),
            ):
                asyncio.run(_server_mod.get_or_create_session())

            self.assertTrue(
                len(captured_kwargs) > 0,
                "BrowserProfile was never instantiated",
            )
            last_call = captured_kwargs[-1]
            self.assertIn(
                "cdp_url",
                last_call,
                "BrowserProfile must be constructed with cdp_url when port is reachable. "
                "Got kwargs: %s" % list(last_call.keys()),
            )
            self.assertEqual(
                last_call["cdp_url"],
                "http://127.0.0.1:9222",
                "cdp_url value must match the URL returned by _read_devtools_active_port",
            )
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
