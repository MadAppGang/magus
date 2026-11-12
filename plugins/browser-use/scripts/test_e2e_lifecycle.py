#!/usr/bin/env python3
"""
End-to-end browser lifecycle tests: REAL browser, REAL processes, no mocks.

The unit suites fake the browser-harness daemon. This file proves the shipped
thing works by doing it: it boots `python3 mcp-server.py` as a subprocess (the
way `.mcp.json` does), drives it over real MCP JSON-RPC on stdio, and then
inspects the operating system.

Each local session of the server owns three child processes, all started by
browser-use 1.0:
  - Chrome, in its own process group, on a temp profile
    `<tmp>/browser-use-chrome-*/profile` that browser-use creates and deletes;
  - the browser-harness daemon (`python -m browser_harness.daemon`), which
    speaks CDP to Chrome and lingers for about 20-30 s after it is told to stop;
  - the LocalBrowser watchdog (`python -P -c ...`), which blocks on a pipe only
    the server holds, and cleans up Chrome, the daemon and the temp profile when
    the server dies without stopping them (SIGKILL, OOM).

What is proven, against processes that really exist:

  1. The launched binary is Playwright's Chromium, not the user's real Chrome.
  2. The real `--user-data-dir` argument is a browser-use temp profile, not a
     directory under `~/.config/browseruse/profiles`, and two servers get two
     different ones.
  3. Closing the session through the server kills Chrome and removes its temp
     profile.
  4. SIGTERM on the server kills Chrome and removes the profile before the
     server exits, and the server does exit.
  5. A SIGKILLed server leaves nothing behind: the watchdog kills Chrome and
     removes the profile within 10 s, and the daemon is gone within 40 s, while a
     second live server's browser keeps running and keeps working.
  6. The port drives a page: navigate, get_state, click by index, evaluate,
     save_screenshot, and a download that lands in the config downloads dir.
  7. On pages from a local HTTP server: get_html with a selector, and an
     invalid selector reported as an error; controls inside a srcdoc iframe
     indexed, clicked and typed by index; printable keys typed by press_key and
     keyboard while modifier chords stay commands; export_session carrying the
     cookies of two origins (127.0.0.1 and localhost); and an imported session
     that is not the primary downloading into the config downloads dir.

Safety rules this file obeys, without exception:
  - No `pkill`, no `killall`, no killing by name or pattern. Every process it
    terminates is one it started, killed by explicit PID, and `_terminate_owned`
    refuses any PID not in `_OWNED_PIDS`. Chrome, the daemon and the watchdog are
    children of a server this file started, so they are recorded as owned.
  - Every server runs with HOME in a temp dir, so no test reads or writes the
    user's real config, and with BH_HOME in a short /tmp dir: the daemon socket
    path is capped near 104 bytes, which a macOS $TMPDIR path would exceed.
  - The servers run in the temp HOME with every model and cloud API key removed
    from their environment, so nothing can call a model or a cloud service.
  - `BROWSER_USE_HEADLESS=true` throughout: nothing appears on screen.
  - `addClassCleanup` tears the world down even when an assertion fails.

Cost control: each class runs its scenario once in setUpClass, records what it
observed, and the test methods assert on those recordings.

Negative control: `SABOTAGE` (below) lets a driver inject Python that runs after
mcp-server.py is imported but before `main()`, for example making
`browser_use.browser.local.LocalBrowser.stop` a no-op. That is how this suite
shows its assertions can fail without editing mcp-server.py. It is None in every
normal run.

The suite refuses to run (each class reports why) when browser_use, mcp or psutil
is missing, when Playwright's Chromium is not installed, or on a platform without
POSIX signals.
"""

import base64
import http.server
import importlib.util
import json
import os
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from dataclasses import dataclass
from html import escape as html_escape
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_SERVER_PATH = _SCRIPTS_DIR / "mcp-server.py"

# browser-use 1.0's temp-dir prefix (browser_use/browser/local.py TMP_PREFIX).
# Duplicated on purpose: a test that asks the code under test what to expect
# cannot notice the code under test changing it.
_TEMP_PROFILE_PREFIX = "browser-use-chrome-"

# Negative-control hook; see the module docstring. Normal runs leave this None.
SABOTAGE: str | None = None

# Environment the servers must never inherit: anything that could reach a model,
# a cloud browser, the user's Chrome, or the user's own harness state.
_STRIPPED_ENV = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_CLOUD",
    "BROWSER_USE_ALLOWED_DOMAINS",
    "CHROME_EXECUTABLE_PATH",
    "CLAUDE_PROJECT_DIR",
    "XDG_CONFIG_HOME",
)
_STRIPPED_ENV_PREFIXES = ("BH_", "BROWSER_HARNESS_", "BU_")


# ---------------------------------------------------------------------------
# Environment gating
# ---------------------------------------------------------------------------

def _playwright_cache_root() -> Path:
    """Playwright's browser cache root. Resolved independently of mcp-server.py:
    a test must not ask the code under test where the browser lives."""
    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _playwright_chromium() -> str | None:
    """The newest Playwright Chromium executable, or None if none is installed."""
    root = _playwright_cache_root()
    pattern = (
        "chromium-*/chrome-mac*/*.app/Contents/MacOS/*"
        if sys.platform == "darwin"
        else "chromium-*/chrome-linux*/chrome"
    )
    matches = sorted(p for p in root.glob(pattern) if p.is_file())
    return str(matches[-1]) if matches else None


def _missing_dependency() -> str | None:
    """Reason this machine cannot run these tests, or None."""
    if os.name != "posix":
        return "POSIX only: the suite sends SIGTERM/SIGKILL to the server"
    for module in ("browser_use", "browser_harness", "mcp", "psutil"):
        if importlib.util.find_spec(module) is None:
            return f"{module} is not installed"
    if not _SERVER_PATH.is_file():
        return f"server not found at {_SERVER_PATH}"
    if _playwright_chromium() is None:
        return (
            "no Playwright Chromium in the browser cache; install it with "
            "'python3 -m playwright install chromium'"
        )
    return None


_UNAVAILABLE = _missing_dependency()


# ---------------------------------------------------------------------------
# Process ownership: nothing is killed unless this test started it
# ---------------------------------------------------------------------------

_OWNED_PIDS: set[int] = set()


def _own_tree(pid: int) -> list[int]:
    """
    Record `pid` and every descendant as ours, and return the descendants.

    Chrome forks helpers and renderers continuously, so this is called at each
    observation point rather than once. Anything reachable from a PID we spawned
    was spawned by us, transitively, which is what makes killing it in cleanup
    legitimate. It must run while the server is alive: after a SIGKILL its
    children are reparented and no longer reachable from it.
    """
    import psutil

    _OWNED_PIDS.add(pid)
    try:
        children = psutil.Process(pid).children(recursive=True)
    except Exception:
        return []
    found = []
    for child in children:
        _OWNED_PIDS.add(child.pid)
        found.append(child.pid)
    return found


def _terminate_owned(pid: int, timeout: float = 5.0) -> None:
    """
    Terminate one PID this test created. Raises if the PID is not ours.

    The guard makes an accidental kill of a process belonging to the user (their
    Chrome, their editor, anything) impossible by construction.
    """
    import psutil

    if pid not in _OWNED_PIDS:
        raise AssertionError(f"refusing to terminate pid {pid}: not started by this test")
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    try:
        proc.terminate()
        proc.wait(timeout=timeout)
    except psutil.NoSuchProcess:
        return
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=timeout)
        except Exception:
            pass


def _terminate_all_owned() -> None:
    """Kill every PID this test started that is somehow still alive."""
    for pid in sorted(_OWNED_PIDS):
        if _alive(pid):
            _terminate_owned(pid, timeout=3.0)


def _alive(pid: int | None) -> bool:
    """True while `pid` is a live, non-zombie process."""
    import psutil

    if not pid:
        return False
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except Exception:
        return False


def _wait_until(predicate, timeout: float, interval: float = 0.1) -> bool:
    """Poll `predicate` until true or `timeout` elapses. Returns its final value."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return bool(predicate())


def _exe_of(pid: int, required: bool = False, attempts: int = 5) -> str | None:
    """
    The executable path of `pid`, or None once it is gone.

    Racy by nature: Chrome reaps helpers constantly, and on Linux psutil reads
    /proc/<pid>/exe, which raises FileNotFoundError for a process that exited in
    between. `required=True` retries briefly, for the main browser process.
    """
    import psutil

    for attempt in range(attempts if required else 1):
        try:
            return psutil.Process(pid).exe()
        except (psutil.NoSuchProcess, psutil.AccessDenied, FileNotFoundError, OSError):
            if not required:
                return None
            if attempt == attempts - 1:
                raise AssertionError(
                    f"could not read the executable path of pid {pid}; the process "
                    "the test expects to be running is gone"
                )
            time.sleep(0.2)
    return None


def _cmdline(pid: int) -> list[str]:
    import psutil

    try:
        return psutil.Process(pid).cmdline()
    except Exception:
        return []


def _user_data_dir_args(pid: int) -> list[str]:
    """Every --user-data-dir VALUE on a live process's real command line."""
    cmdline = _cmdline(pid)
    values = []
    for index, arg in enumerate(cmdline):
        if arg.startswith("--user-data-dir="):
            values.append(arg.split("=", 1)[1])
        elif arg == "--user-data-dir" and index + 1 < len(cmdline):
            values.append(cmdline[index + 1])
    return values


def _role(pid: int) -> str:
    """
    What one direct child of a server is: 'chrome', 'daemon', 'watchdog' or
    'other'. Read from the command line of a process this test already owns,
    only to classify it; nothing is ever killed by what this returns.
    """
    cmdline = _cmdline(pid)
    joined = " ".join(cmdline)
    if any(arg.startswith("--user-data-dir") for arg in cmdline):
        return "chrome"
    if "browser_harness.daemon" in joined:
        return "daemon"
    if "-c" in cmdline and "sys.stdin.buffer.read()" in joined:
        return "watchdog"
    return "other"


def _describe_survivors(path: Path, limit: int = 40) -> str:
    """What is still inside `path`, or '<gone>'. Never raises.

    A full Chrome profile means the removal never ran; a few files mean it ran
    and lost a race with something still writing."""
    try:
        if not path.exists():
            return "<gone>"
        names = sorted(str(p.relative_to(path)) for p in path.rglob("*"))
    except Exception as exc:  # pragma: no cover - diagnostics must not fail a run
        return f"<unreadable: {exc}>"
    shown = ", ".join(names[:limit]) or "<empty directory>"
    suffix = f" (+{len(names) - limit} more)" if len(names) > limit else ""
    return f"{len(names)} entries: {shown}{suffix}"


# ---------------------------------------------------------------------------
# Real MCP server subprocess, driven over real stdio JSON-RPC
# ---------------------------------------------------------------------------

_LAUNCHER_TEMPLATE = """\
import asyncio, importlib.util, sys
sys.path.insert(0, {scripts!r})
spec = importlib.util.spec_from_file_location("magus_mcp_server", {server!r})
mod = importlib.util.module_from_spec(spec)
sys.modules["magus_mcp_server"] = mod
spec.loader.exec_module(mod)
{sabotage}
asyncio.run(mod.main())
"""


@dataclass
class _Launch:
    """The three processes one local browser session started, and its profile."""

    chrome: int
    daemon: int | None
    watchdog: int | None
    profile_dir: Path

    @property
    def temp_dir(self) -> Path:
        """`<tmp>/browser-use-chrome-*`: browser-use deletes it on stop."""
        return self.profile_dir.parent


class _Server:
    """
    A real `mcp-server.py` subprocess plus a minimal JSON-RPC client.

    This speaks the newline-delimited framing directly rather than through the
    MCP SDK's stdio_client, because these tests need the server's PID and need
    to signal it, which the SDK's transport does not expose.
    """

    def __init__(self, home: Path, bh_home: Path):
        self.home = home
        self._scratch: Path | None = None
        self.stderr_path = home / f"server-stderr-{time.monotonic_ns()}.log"
        self._stderr_file = open(self.stderr_path, "wb")
        self._buffer = b""
        self._next_id = 0

        env = {
            key: value
            for key, value in os.environ.items()
            if key not in _STRIPPED_ENV and not key.startswith(_STRIPPED_ENV_PREFIXES)
        }
        env.update(
            HOME=str(home),
            BH_HOME=str(bh_home),
            # The temp HOME has no browser cache, so point the resolver at the
            # real one. The binary must come from here, not /Applications.
            PLAYWRIGHT_BROWSERS_PATH=str(_playwright_cache_root()),
            BROWSER_USE_HEADLESS="true",
            ANONYMIZED_TELEMETRY="false",
            PYTHONUNBUFFERED="1",
        )

        self.proc = subprocess.Popen(
            self._argv(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_file,
            env=env,
            # browser-use reads a .env from the working directory at import.
            cwd=str(home),
            bufsize=0,
        )
        self.pid = self.proc.pid
        _OWNED_PIDS.add(self.pid)
        self._selector = selectors.DefaultSelector()
        self._selector.register(self.proc.stdout, selectors.EVENT_READ)

    def _argv(self) -> list[str]:
        """`python3 mcp-server.py`, or a launcher that imports it and applies
        the negative-control patch before calling main()."""
        if SABOTAGE is None:
            return [sys.executable, str(_SERVER_PATH)]
        self._scratch = Path(tempfile.mkdtemp(prefix="e2e-sabotage-"))
        launcher = self._scratch / "launcher.py"
        launcher.write_text(
            _LAUNCHER_TEMPLATE.format(
                scripts=str(_SCRIPTS_DIR), server=str(_SERVER_PATH), sabotage=SABOTAGE
            )
        )
        return [sys.executable, str(launcher)]

    # -- transport ------------------------------------------------------

    def _send(self, message: dict) -> None:
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        self.proc.stdin.flush()

    def _read_message(self, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            if b"\n" in self._buffer:
                line, self._buffer = self._buffer.split(b"\n", 1)
                if line.strip():
                    return json.loads(line)
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"server {self.pid} sent no reply in {timeout}s; "
                    f"stderr tail: {self.stderr_tail(800)}"
                )
            if not self._selector.select(timeout=min(remaining, 1.0)):
                if self.proc.poll() is not None:
                    raise RuntimeError(
                        f"server {self.pid} exited with {self.proc.returncode}; "
                        f"stderr tail: {self.stderr_tail(800)}"
                    )
                continue
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError(
                    f"server {self.pid} closed stdout; stderr tail: {self.stderr_tail(800)}"
                )
            self._buffer += chunk

    def request(self, method: str, params: dict | None = None, timeout: float = 120.0) -> dict:
        """One JSON-RPC request/response round trip, passing over notifications."""
        self._next_id += 1
        request_id = self._next_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        while True:
            message = self._read_message(timeout)
            if message.get("id") == request_id:
                return message

    def initialize(self, timeout: float = 90.0) -> None:
        self.request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "e2e-lifecycle", "version": "1"},
            },
            timeout=timeout,
        )
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call_tool_raw(self, name: str, arguments: dict | None = None, timeout: float = 120.0) -> tuple[str, bool]:
        """Call an MCP tool and return (first text content, isError), whatever it says."""
        reply = self.request(
            "tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout
        )
        if "error" in reply:
            raise RuntimeError(f"{name}: JSON-RPC error {reply['error']}")
        result = reply.get("result") or {}
        content = result.get("content") or []
        text = content[0].get("text", "") if content else ""
        return text, bool(result.get("isError"))

    def call_tool(self, name: str, arguments: dict | None = None, timeout: float = 120.0) -> str:
        """Call an MCP tool and return its first text content. Raises on an error result."""
        text, is_error = self.call_tool_raw(name, arguments, timeout)
        if is_error or text.startswith("Error"):
            raise RuntimeError(f"{name} failed: {text}")
        return text

    # -- lifecycle ------------------------------------------------------

    def children(self) -> set[int]:
        import psutil

        try:
            return {child.pid for child in psutil.Process(self.pid).children()}
        except Exception:
            return set()

    def launch_browser(self, url: str = "about:blank") -> _Launch:
        """
        Start a real browser through the server and return what it started.

        `browser_navigate` starts the primary session on demand, which is the
        code path under test. Only children that appeared during this call are
        considered, so an earlier session's lingering daemon (or, under the
        negative control, its surviving Chrome) is never mistaken for this one.
        """
        before = self.children()
        self.call_tool("browser_navigate", {"url": url})
        roles: dict[str, list[int]] = {}

        def classified() -> bool:
            roles.clear()
            for pid in self.children() - before:
                roles.setdefault(_role(pid), []).append(pid)
            return all(roles.get(role) for role in ("chrome", "daemon", "watchdog"))

        _wait_until(classified, timeout=10.0)
        _own_tree(self.pid)
        if not roles.get("chrome"):
            raise RuntimeError(
                f"server launched no browser process; new children by role: {roles}; "
                f"stderr tail: {self.stderr_tail(800)}"
            )
        chrome = roles["chrome"][0]
        user_data_dirs = _user_data_dir_args(chrome)
        if not user_data_dirs:
            raise RuntimeError(f"browser {chrome} has no --user-data-dir argument")
        return _Launch(
            chrome=chrome,
            daemon=(roles.get("daemon") or [None])[0],
            watchdog=(roles.get("watchdog") or [None])[0],
            profile_dir=Path(user_data_dirs[0]),
        )

    def only_session_id(self) -> str:
        sessions = json.loads(self.call_tool("browser_list_sessions"))
        if len(sessions) != 1:
            raise RuntimeError(f"expected one session, the server lists {sessions}")
        return sessions[0]["session_id"]

    def stderr_tail(self, limit: int = 4000) -> str:
        try:
            self._stderr_file.flush()
            return self.stderr_path.read_text(errors="replace")[-limit:]
        except Exception:
            return "<unavailable>"

    def signal(self, signum: int) -> None:
        os.kill(self.pid, signum)

    def close(self) -> None:
        """Force the server down. Only ever called on a PID we spawned."""
        try:
            self._selector.close()
        except Exception:
            pass
        for stream in (self.proc.stdin, self.proc.stdout):
            try:
                stream.close()
            except Exception:
                pass
        if self.proc.poll() is None:
            # stdin is closed, so the server stops its browsers and returns.
            try:
                self.proc.wait(timeout=15)
            except Exception:
                _terminate_owned(self.pid, timeout=5.0)
        try:
            self.proc.wait(timeout=5)
        except Exception:
            pass
        try:
            self._stderr_file.close()
        except Exception:
            pass
        if self._scratch is not None:
            shutil.rmtree(self._scratch, ignore_errors=True)


def _make_world(cls) -> tuple[Path, Path]:
    """
    A temp HOME and a short BH_HOME for one class, with cleanups registered.

    BH_HOME lives directly under /tmp because the daemon's socket path must stay
    under the AF_UNIX limit (about 104 bytes on macOS).
    """
    home = Path(tempfile.mkdtemp(prefix="browser-use-e2e-home-"))
    bh_home = Path(tempfile.mkdtemp(prefix="bh", dir="/tmp"))
    # Cleanups run last-in first-out: servers first, then strays, then dirs.
    cls.addClassCleanup(shutil.rmtree, home, ignore_errors=True)
    cls.addClassCleanup(shutil.rmtree, bh_home, ignore_errors=True)
    cls.addClassCleanup(_terminate_all_owned)
    real_config = Path.home() / ".config"
    assert not str(home).startswith(str(real_config)), "HOME must be a temp dir"
    return home, bh_home


def _data_url(html: str) -> str:
    return "data:text/html," + urllib.parse.quote(html)


def _server_tmp_root() -> str:
    """The temp root the servers inherit through TMPDIR, resolved."""
    return os.path.realpath(tempfile.gettempdir())


# ---------------------------------------------------------------------------
# Launch, profile directory, close, SIGTERM
# ---------------------------------------------------------------------------

@unittest.skipIf(_UNAVAILABLE is not None, f"E2E unavailable: {_UNAVAILABLE}")
class TestServerOwnedBrowserLifecycle(unittest.TestCase):
    """One real server, two real browsers, one recorded scenario.

    Sequence, run once in setUpClass:
      launch -> observe -> close through the server -> observe
             -> launch again -> SIGTERM the server -> observe at exit and after
    """

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        obs = cls.observations = {}
        home, bh_home = _make_world(cls)
        obs["home"] = home

        server = _Server(home, bh_home)
        cls.addClassCleanup(server.close)
        server.initialize()

        # --- launch -----------------------------------------------------
        first = server.launch_browser()
        tree = _own_tree(server.pid)
        obs["first"] = first
        obs["browser_exe"] = _exe_of(first.chrome, required=True)
        obs["descendant_exes"] = sorted({exe for exe in (_exe_of(pid) for pid in tree) if exe})
        obs["user_data_dir_args"] = _user_data_dir_args(first.chrome)
        obs["profile_exists_after_launch"] = first.profile_dir.is_dir()

        # --- close the session through the server -----------------------
        session_id = server.only_session_id()
        chrome_tree = [pid for pid in _own_tree(first.chrome)]
        obs["close_result"] = server.call_tool("browser_close_session", {"session_id": session_id})
        _wait_until(
            lambda: (
                not _alive(first.chrome)
                and not any(_alive(p) for p in chrome_tree)
                and not first.temp_dir.exists()
            ),
            timeout=30.0,
        )
        obs["browser_alive_after_close"] = _alive(first.chrome)
        obs["tree_alive_after_close"] = [p for p in chrome_tree if _alive(p)]
        obs["watchdog_alive_after_close"] = _alive(first.watchdog)
        obs["temp_dir_exists_after_close"] = first.temp_dir.exists()
        obs["temp_dir_survivors_after_close"] = _describe_survivors(first.temp_dir)

        # --- launch again, then SIGTERM the server ----------------------
        second = server.launch_browser()
        obs["second"] = second
        obs["profile_exists_after_relaunch"] = second.profile_dir.is_dir()
        chrome_tree_2 = _own_tree(second.chrome)
        _own_tree(server.pid)

        server.signal(signal.SIGTERM)
        try:
            server.proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            pass
        # Sampled the instant the server is gone. browser-use's SIGTERM handler
        # stops the browser before the process dies, so by now Chrome is dead
        # and its profile removed. The watchdog would also clean up, but only
        # after the server has exited, so it cannot make this sample pass.
        obs["server_exited_after_sigterm"] = server.proc.poll() is not None
        obs["browser_alive_at_exit"] = _alive(second.chrome)
        obs["temp_dir_exists_at_exit"] = second.temp_dir.exists()
        obs["temp_dir_survivors_at_exit"] = _describe_survivors(second.temp_dir)

        _wait_until(lambda: not any(_alive(p) for p in chrome_tree_2), timeout=15.0)
        obs["tree_alive_after_sigterm"] = [p for p in chrome_tree_2 if _alive(p)]
        # The daemons linger for about 20-30 s after they acknowledge shutdown.
        daemons = [pid for pid in (first.daemon, second.daemon) if pid]
        _wait_until(lambda: not any(_alive(p) for p in daemons), timeout=45.0, interval=0.5)
        obs["daemons_alive_at_end"] = [p for p in daemons if _alive(p)]
        obs["stderr"] = server.stderr_tail(1500)

    def test_launched_binary_is_playwright_chromium(self):
        """The browser must come from Playwright's cache, the resolver's whole job."""
        exe = os.path.realpath(self.observations["browser_exe"])
        root = os.path.realpath(_playwright_cache_root())
        self.assertTrue(
            exe.startswith(root + os.sep),
            f"browser was launched from {exe!r}, which is not under Playwright's cache {root!r}",
        )

    def test_launched_binary_is_not_the_users_real_chrome(self):
        """The original bug: the plugin silently drove /Applications/Google Chrome."""
        real_chromes = (
            "/Applications/Google Chrome.app",
            "/opt/google/chrome",
            "/usr/bin/google-chrome",
        )
        for exe in [self.observations["browser_exe"], *self.observations["descendant_exes"]]:
            for real in real_chromes:
                self.assertFalse(
                    exe.startswith(real),
                    f"a browser process is running out of the user's Chrome: {exe!r}",
                )

    def test_user_data_dir_is_a_browser_use_chrome_temp_dir(self):
        """The real --user-data-dir is <tmp>/browser-use-chrome-*/profile, nowhere in HOME."""
        values = self.observations["user_data_dir_args"]
        self.assertEqual(1, len(values), f"expected one --user-data-dir, saw {values}")
        profile = Path(os.path.realpath(values[0]))
        self.assertEqual("profile", profile.name, f"--user-data-dir is {profile}")
        self.assertTrue(
            profile.parent.name.startswith(_TEMP_PROFILE_PREFIX),
            f"--user-data-dir {profile} is not inside a {_TEMP_PROFILE_PREFIX}* temp dir",
        )
        self.assertEqual(
            _server_tmp_root(),
            str(profile.parent.parent),
            f"--user-data-dir {profile} is not in the system temp dir",
        )
        self.assertTrue(self.observations["profile_exists_after_launch"])
        home = os.path.realpath(self.observations["home"])
        self.assertFalse(
            str(profile).startswith(home + os.sep),
            f"--user-data-dir {profile} is under HOME",
        )
        self.assertFalse(
            (self.observations["home"] / ".config" / "browseruse" / "profiles").exists(),
            "something created ~/.config/browseruse/profiles; profiles belong in the temp dir",
        )

    def test_closing_the_session_kills_the_browser_and_frees_the_profile_dir(self):
        """browser_close_session must end Chrome AND remove its temp profile."""
        first = self.observations["first"]
        self.assertIsNotNone(first.watchdog, "the session started no watchdog")
        self.assertIsNotNone(first.daemon, "the session started no browser-harness daemon")
        self.assertIn("Successfully closed", self.observations["close_result"])
        self.assertFalse(
            self.observations["browser_alive_after_close"], "browser survived browser_close_session"
        )
        self.assertEqual(
            [], self.observations["tree_alive_after_close"], "browser helpers survived close"
        )
        self.assertFalse(
            self.observations["watchdog_alive_after_close"],
            "the watchdog survived a normal close; it would clean up a second time later",
        )
        self.assertFalse(
            self.observations["temp_dir_exists_after_close"],
            f"{first.temp_dir} survived browser_close_session; what is left: "
            f"{self.observations['temp_dir_survivors_after_close']}",
        )

    def test_sigterm_shutdown_kills_the_browser_and_removes_the_profile_dir(self):
        """A server ended by SIGTERM cleans up before it exits, and does exit."""
        second = self.observations["second"]
        self.assertIsNotNone(second.daemon, "the second session started no browser-harness daemon")
        self.assertTrue(
            self.observations["profile_exists_after_relaunch"],
            "the second launch did not create a profile directory",
        )
        self.assertTrue(
            self.observations["server_exited_after_sigterm"],
            f"the server did not exit within 45 s of SIGTERM; stderr: {self.observations['stderr']}",
        )
        self.assertFalse(
            self.observations["browser_alive_at_exit"],
            "Chrome was still running when its server exited after SIGTERM",
        )
        self.assertFalse(
            self.observations["temp_dir_exists_at_exit"],
            f"{second.temp_dir} still existed when its server exited after SIGTERM; "
            f"what was there: {self.observations['temp_dir_survivors_at_exit']}",
        )
        self.assertEqual(
            [],
            self.observations["tree_alive_after_sigterm"],
            "browser helpers survived SIGTERM of their server",
        )
        self.assertEqual(
            [],
            self.observations["daemons_alive_at_end"],
            "a browser-harness daemon was still running 45 s after its server stopped",
        )


# ---------------------------------------------------------------------------
# The server drives a real page
# ---------------------------------------------------------------------------

_DOWNLOAD_NAME = "e2e-download.txt"
_DOWNLOAD_BODY = "downloaded by the browser-use e2e suite\n"
_PAGE = (
    "<title>start</title>"
    "<button onclick=\"document.title='clicked'\">Press me</button>"
    "<a href=\"data:text/plain;base64,"
    + base64.b64encode(_DOWNLOAD_BODY.encode()).decode()
    + f"\" download=\"{_DOWNLOAD_NAME}\">Get the file</a>"
)


@unittest.skipIf(_UNAVAILABLE is not None, f"E2E unavailable: {_UNAVAILABLE}")
class TestServerDrivesARealPage(unittest.TestCase):
    """One server, one page: the tools a model uses, end to end."""

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        obs = cls.observations = {}
        home, bh_home = _make_world(cls)
        server = _Server(home, bh_home)
        cls.addClassCleanup(server.close)
        server.initialize()

        launch = server.launch_browser(_data_url(_PAGE))
        obs["temp_dir"] = launch.temp_dir

        state = json.loads(server.call_tool("browser_get_state"))
        obs["state"] = state
        elements = state.get("interactive_elements") or []
        button = next((e for e in elements if e.get("tag") == "button"), None)
        link = next((e for e in elements if e.get("tag") == "a"), None)
        obs["button"], obs["link"] = button, link

        if button is not None:
            obs["click_result"] = server.call_tool("browser_click", {"index": button["index"]})
            obs["title_after_click"] = json.loads(
                server.call_tool("browser_evaluate", {"script": "document.title"})
            )
        obs["evaluate_sum"] = json.loads(
            server.call_tool("browser_evaluate", {"script": "return 6 * 7"})
        )

        shot = home / "shots" / "page.png"
        obs["shot_path"] = shot
        obs["save_result"] = json.loads(
            server.call_tool("browser_save_screenshot", {"output_path": str(shot)})
        )
        obs["shot_bytes"] = shot.read_bytes() if shot.is_file() else b""

        downloads = home / ".config" / "browseruse" / "downloads"
        target = downloads / _DOWNLOAD_NAME
        obs["download_target"] = target
        if link is not None:
            obs["download_click"] = server.call_tool("browser_click", {"index": link["index"]})
            _wait_until(lambda: target.is_file() and target.read_text() == _DOWNLOAD_BODY, 20.0)
        obs["download_text"] = target.read_text() if target.is_file() else None
        obs["downloads_listing"] = sorted(p.name for p in downloads.iterdir()) if downloads.is_dir() else []
        obs["real_downloads_untouched"] = not (home / "Downloads" / _DOWNLOAD_NAME).exists()

        obs["close_all"] = server.call_tool("browser_close_all")
        _wait_until(lambda: not _alive(launch.chrome) and not launch.temp_dir.exists(), 30.0)

    def test_navigate_get_state_click_evaluate_round_trip(self):
        """Navigate a data: page, find the button by index, click it, read the title back."""
        state = self.observations["state"]
        self.assertEqual("start", state.get("title"), f"get_state: {state}")
        button = self.observations["button"]
        self.assertIsNotNone(button, f"get_state listed no button: {state.get('interactive_elements')}")
        self.assertIsInstance(button["index"], int)
        self.assertIn("Press me", button.get("text", ""))
        self.assertEqual(f"Clicked element {button['index']}", self.observations["click_result"])
        self.assertEqual(
            {"result": "clicked"},
            self.observations["title_after_click"],
            "clicking the button by its get_state index did not run its onclick",
        )
        self.assertEqual({"result": 42}, self.observations["evaluate_sum"])

    def test_save_screenshot_writes_a_png(self):
        """browser_save_screenshot writes a real PNG of the live page to the path given."""
        result = self.observations["save_result"]
        data = self.observations["shot_bytes"]
        self.assertEqual(str(self.observations["shot_path"]), result["path"])
        self.assertEqual(b"\x89PNG\r\n\x1a\n", data[:8], "the file is not a PNG")
        self.assertEqual(len(data), result["size_bytes"])
        self.assertGreater(result["width"], 0)
        self.assertGreater(result["height"], 0)

    def test_download_lands_in_config_downloads(self):
        """A download goes to ~/.config/browseruse/downloads under its own name."""
        self.assertIsNotNone(self.observations["link"], "get_state listed no download link")
        self.assertEqual(
            _DOWNLOAD_BODY,
            self.observations["download_text"],
            f"{self.observations['download_target']} did not receive the download; the "
            f"downloads dir holds {self.observations['downloads_listing']}",
        )
        self.assertTrue(self.observations["real_downloads_untouched"], "the file went to ~/Downloads")


# ---------------------------------------------------------------------------
# Tool behaviour on real pages served over local HTTP
# ---------------------------------------------------------------------------

_FRAME_DOC = (
    "<button onclick=\"parent.frameClicked = true\">Frame button</button>"
    "<input id=\"fi\" aria-label=\"Frame field\">"
)
_SITE_PAGES = {
    "/html": "<title>html</title><div id=\"main\"><p>hi</p></div>",
    "/frames": (
        "<title>frames</title>"
        "<button onclick=\"window.mainClicked = true\">Main button</button>"
        f"<iframe srcdoc=\"{html_escape(_FRAME_DOC, quote=True)}\"></iframe>"
    ),
    "/keys": "<title>keys</title><input id=\"k\">",
    "/dl": "<title>dl</title><a id=\"dl\" href=\"/file\">file</a>",
}
_IMPORT_DOWNLOAD_NAME = "import-download.txt"
_IMPORT_DOWNLOAD_BODY = "downloaded by an imported session\n"


class _SiteHandler(http.server.BaseHTTPRequestHandler):
    """The test site: a few fixed pages, a cookie setter and a file download."""

    def log_message(self, *args):  # keep the test output to test results
        pass

    def _reply(self, body: str, content_type: str = "text/html", headers: tuple = ()) -> None:
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/set/"):
            name = path[len("/set/"):]
            self._reply(
                f"<title>set {name}</title>",
                headers=(("Set-Cookie", f"{name}=on; Path=/; Max-Age=3600"),),
            )
        elif path == "/file":
            self._reply(
                _IMPORT_DOWNLOAD_BODY,
                content_type="text/plain",
                headers=(("Content-Disposition", f"attachment; filename=\"{_IMPORT_DOWNLOAD_NAME}\""),),
            )
        elif path in _SITE_PAGES:
            self._reply(_SITE_PAGES[path])
        else:
            self.send_error(404)


def _start_site(cls) -> int:
    """
    Serve the test site on a free port on 127.0.0.1, and on ::1 at the same port
    when the machine has IPv6 loopback, so `localhost` reaches it either way.
    Two hostnames give two cookie origins on one server.
    """
    servers = [http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SiteHandler)]
    port = servers[0].server_address[1]

    class _V6Server(http.server.ThreadingHTTPServer):
        address_family = socket.AF_INET6

    try:
        servers.append(_V6Server(("::1", port), _SiteHandler))
    except OSError:
        pass
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.addClassCleanup(server.server_close)
        cls.addClassCleanup(server.shutdown)
    return port


def _daemon_sockets(bh_home: Path) -> set[Path]:
    """The browser-harness daemon sockets under a BH_HOME this test created."""
    return set(bh_home.rglob("bu-*.sock"))


def _daemon_cdp(sock: Path, method: str, **params) -> dict:
    """
    One CDP command to the attached tab of a daemon the server under test
    started for this test. Used only where no tool reaches that daemon.
    """
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(30)
    try:
        conn.connect(str(sock))
        conn.sendall((json.dumps({"method": method, "params": params, "session_id": None}) + "\n").encode())
        data = b""
        while not data.endswith(b"\n"):
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
    finally:
        conn.close()
    reply = json.loads(data or b"{}")
    if "error" in reply:
        raise RuntimeError(f"{method} failed: {reply['error']}")
    return reply.get("result") or {}


def _attempt(obs: dict, key: str, step) -> None:
    """Record what one step returned, or why it failed, so later steps still run."""
    try:
        obs[key] = step()
    except Exception as exc:
        obs[key] = f"<failed: {exc}>"


def _element(state, text: str) -> dict | None:
    if not isinstance(state, dict):
        return None
    return next((e for e in state.get("interactive_elements") or [] if e.get("text") == text), None)


@unittest.skipIf(_UNAVAILABLE is not None, f"E2E unavailable: {_UNAVAILABLE}")
class TestToolsOnRealPages(unittest.TestCase):
    """
    One server, pages from a local HTTP server: get_html with a selector, controls
    inside a srcdoc iframe, printable keys, cookie export across two origins, and
    an imported session that is not the primary.
    """

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        obs = cls.observations = {}
        home, bh_home = _make_world(cls)
        port = _start_site(cls)
        on_ip = f"http://127.0.0.1:{port}"
        on_localhost = f"http://localhost:{port}"
        server = _Server(home, bh_home)
        cls.addClassCleanup(server.close)
        server.initialize()
        launches = [server.launch_browser(on_ip + "/html")]

        # get_html with a selector: a match, no match, an invalid selector.
        _attempt(obs, "html_main", lambda: server.call_tool_raw("browser_get_html", {"selector": "#main"}))
        _attempt(obs, "html_missing", lambda: server.call_tool_raw("browser_get_html", {"selector": "#nope"}))
        _attempt(obs, "html_invalid", lambda: server.call_tool_raw("browser_get_html", {"selector": "[["}))

        # Controls inside a same-origin srcdoc iframe, clicked and typed by index.
        _attempt(obs, "frames_nav", lambda: server.call_tool("browser_navigate", {"url": on_ip + "/frames"}))
        _attempt(obs, "frames_state", lambda: json.loads(server.call_tool("browser_get_state")))
        main_button = _element(obs["frames_state"], "Main button")
        frame_button = _element(obs["frames_state"], "Frame button")
        frame_field = _element(obs["frames_state"], "Frame field")
        obs["frame_controls"] = (main_button, frame_button, frame_field)
        if main_button:
            _attempt(obs, "main_click", lambda: server.call_tool_raw("browser_click", {"index": main_button["index"]}))
        if frame_button:
            _attempt(obs, "frame_click", lambda: server.call_tool_raw("browser_click", {"index": frame_button["index"]}))
        if frame_field:
            _attempt(obs, "frame_type", lambda: server.call_tool_raw(
                "browser_type", {"index": frame_field["index"], "text": "typed in frame"}
            ))
        _attempt(obs, "frames_after", lambda: json.loads(server.call_tool("browser_evaluate", {"script": (
            "return [window.mainClicked === true, window.frameClicked === true,"
            " document.querySelector('iframe').contentDocument.getElementById('fi').value]"
        )})))

        # Printable keys and modifier chords into a focused input.
        field = "return document.getElementById('k').value"

        def keys():
            server.call_tool("browser_navigate", {"url": on_ip + "/keys"})
            server.call_tool("browser_focus", {"selector": "#k"})
            for key in ("a", "A", "1", " "):
                server.call_tool("browser_press_key", {"key": key})
            typed = json.loads(server.call_tool("browser_evaluate", {"script": field}))
            server.call_tool("browser_keyboard", {"keys": ["Shift+b", "!"]})
            shifted = json.loads(server.call_tool("browser_evaluate", {"script": field}))
            server.call_tool("browser_press_key", {"key": "Control+a"})
            server.call_tool("browser_press_key", {"key": "z"})
            replaced = json.loads(server.call_tool("browser_evaluate", {"script": field}))
            return typed, shifted, replaced

        _attempt(obs, "keys", keys)

        # Cookies on two origins, then export the session.
        export = home / "export" / "session.json"
        obs["export_path"] = export

        def export_cookies():
            server.call_tool("browser_navigate", {"url": on_ip + "/set/ip_cookie"})
            server.call_tool("browser_navigate", {"url": on_localhost + "/set/localhost_cookie"})
            session_id = server.only_session_id()
            json.loads(server.call_tool(
                "browser_export_session", {"session_id": session_id, "output_path": str(export)}
            ))
            return json.loads(export.read_text())

        _attempt(obs, "export", export_cookies)

        # Import that file into a second session, which is not the primary,
        # and download a file in it.
        downloads = home / ".config" / "browseruse" / "downloads"
        target = downloads / _IMPORT_DOWNLOAD_NAME
        obs["import_download_target"] = target

        def import_and_download():
            before = _daemon_sockets(bh_home)
            result = json.loads(server.call_tool(
                "browser_import_session", {"import_path": str(export), "navigate_to": on_ip + "/dl"}
            ))
            _own_tree(server.pid)
            _wait_until(lambda: _daemon_sockets(bh_home) - before, timeout=10.0)
            new = sorted(_daemon_sockets(bh_home) - before)
            if len(new) != 1:
                raise RuntimeError(f"expected one new daemon socket, found {new}")
            sock = new[0]

            def ready():
                try:
                    value = _daemon_cdp(sock, "Runtime.evaluate", expression=(
                        "document.readyState === 'complete' && !!document.getElementById('dl')"
                    ), returnByValue=True)
                except RuntimeError:
                    return False
                return (value.get("result") or {}).get("value") is True

            if not _wait_until(ready, timeout=15.0, interval=0.2):
                raise RuntimeError("the imported session's page never loaded")
            _daemon_cdp(sock, "Runtime.evaluate", expression="document.getElementById('dl').click()",
                        userGesture=True)
            _wait_until(lambda: target.is_file() and target.read_text() == _IMPORT_DOWNLOAD_BODY, 20.0)
            again = home / "export" / "imported.json"
            server.call_tool("browser_export_session", {"session_id": result["session_id"], "output_path": str(again)})
            return result, json.loads(again.read_text())

        _attempt(obs, "import", import_and_download)
        obs["import_download_text"] = target.read_text() if target.is_file() else None
        obs["downloads_listing"] = sorted(p.name for p in downloads.iterdir()) if downloads.is_dir() else []
        obs["home_downloads"] = (
            sorted(p.name for p in (home / "Downloads").iterdir()) if (home / "Downloads").is_dir() else []
        )

        chromes = [pid for pid in _own_tree(server.pid) if _role(pid) == "chrome"] + [launches[0].chrome]
        obs["close_all"] = server.call_tool("browser_close_all")
        _wait_until(lambda: not any(_alive(pid) for pid in chromes), 30.0)

    def _ok(self, key: str) -> object:
        value = self.observations.get(key)
        if isinstance(value, str) and value.startswith("<failed"):
            self.fail(f"{key}: {value}")
        return value

    def test_get_html_with_a_selector_returns_the_element(self):
        """A selector that matches returns that element's outerHTML."""
        text, is_error = self._ok("html_main")
        self.assertFalse(is_error, text)
        self.assertEqual('<div id="main"><p>hi</p></div>', text)
        missing, missing_error = self._ok("html_missing")
        self.assertEqual("No element found for selector: #nope", missing)
        self.assertFalse(missing_error)

    def test_get_html_reports_a_javascript_exception_as_an_error(self):
        """An invalid selector throws in the page; that is an error, not 'no element'."""
        text, is_error = self._ok("html_invalid")
        self.assertTrue(is_error, f"an invalid selector was not an error result: {text!r}")
        self.assertNotIn("No element found", text)
        self.assertIn("SyntaxError", text)

    def test_get_state_lists_controls_inside_a_srcdoc_iframe(self):
        """browser_get_state indexes the iframe's button and input beside the main-frame button."""
        self._ok("frames_state")
        main_button, frame_button, frame_field = self.observations["frame_controls"]
        elements = self.observations["frames_state"].get("interactive_elements")
        self.assertIsNotNone(main_button, f"no main-frame button: {elements}")
        self.assertIsNotNone(frame_button, f"the iframe's button has no index: {elements}")
        self.assertIsNotNone(frame_field, f"the iframe's input has no index: {elements}")

    def test_click_and_type_by_index_reach_the_iframe(self):
        """An index from a child frame works with browser_click and browser_type."""
        for key in ("main_click", "frame_click", "frame_type"):
            self.assertIn(key, self.observations, f"{key} never ran: get_state gave no index for it")
            text, is_error = self._ok(key)
            self.assertFalse(is_error or text.startswith("Error"), f"{key}: {text}")
        self.assertEqual({"result": [True, True, "typed in frame"]}, self._ok("frames_after"))

    def test_press_key_types_printable_characters(self):
        """'a', 'A', '1' and a space type into the focused input; Shift+b and '!' too."""
        typed, shifted, _replaced = self._ok("keys")
        self.assertEqual({"result": "aA1 "}, typed)
        self.assertEqual({"result": "aA1 B!"}, shifted)

    def test_modifier_chords_stay_commands(self):
        """Control+a selects all instead of typing 'a', so the next key replaces the text."""
        _typed, _shifted, replaced = self._ok("keys")
        self.assertEqual({"result": "z"}, replaced)

    def test_export_session_includes_cookies_from_every_origin(self):
        """Cookies set on 127.0.0.1 and on localhost both reach the export file."""
        data = self._ok("export")
        names = {(c.get("name"), c.get("domain")) for c in data.get("cookies") or []}
        self.assertIn(("ip_cookie", "127.0.0.1"), names, f"exported: {names}")
        self.assertIn(("localhost_cookie", "localhost"), names, f"exported: {names}")

    def test_import_restores_cookies_from_every_origin(self):
        """The export file imports into a new session that holds both origins' cookies."""
        result, exported_again = self._ok("import")
        self.assertIs(False, result["is_primary"])
        names = {(c.get("name"), c.get("domain")) for c in exported_again.get("cookies") or []}
        self.assertIn(("ip_cookie", "127.0.0.1"), names, f"imported session holds: {names}")
        self.assertIn(("localhost_cookie", "localhost"), names, f"imported session holds: {names}")

    def test_a_non_primary_imported_session_downloads_to_the_config_dir(self):
        """A download in an imported session that is not the primary lands in the config dir."""
        self._ok("import")
        self.assertEqual(
            _IMPORT_DOWNLOAD_BODY,
            self.observations["import_download_text"],
            f"{self.observations['import_download_target']} did not receive the download; the "
            f"downloads dir holds {self.observations['downloads_listing']}, "
            f"~/Downloads holds {self.observations['home_downloads']}",
        )


# ---------------------------------------------------------------------------
# A SIGKILLed server: browser-use's watchdog cleans up after it
# ---------------------------------------------------------------------------

@unittest.skipIf(_UNAVAILABLE is not None, f"E2E unavailable: {_UNAVAILABLE}")
class TestServerKilledHard(unittest.TestCase):
    """
    Two real servers sharing one HOME and one BH_HOME, each with a browser:

      LIVE    keeps running throughout
      VICTIM  is SIGKILLed, so none of its own cleanup code can run

    The VICTIM's watchdog must then kill its Chrome, end its daemon and remove its
    temp profile, and must leave LIVE's browser, daemon and profile alone.
    """

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        obs = cls.observations = {}
        home, bh_home = _make_world(cls)

        live = _Server(home, bh_home)
        cls.addClassCleanup(live.close)
        live.initialize()
        live_launch = live.launch_browser()
        obs["live"] = live_launch

        victim = _Server(home, bh_home)
        cls.addClassCleanup(victim.close)
        victim.initialize()
        victim_launch = victim.launch_browser()
        obs["victim"] = victim_launch
        # Chrome's helpers; the daemon and the watchdog have deadlines of their own.
        victim_tree = [
            p for p in _own_tree(victim.pid)
            if p not in (victim_launch.daemon, victim_launch.watchdog)
        ]

        obs["before_kill"] = {
            "chrome_alive": _alive(victim_launch.chrome),
            "daemon_alive": _alive(victim_launch.daemon),
            "watchdog_alive": _alive(victim_launch.watchdog),
            "temp_dir_exists": victim_launch.temp_dir.is_dir(),
        }

        victim.signal(signal.SIGKILL)
        started = time.monotonic()
        try:
            obs["victim_returncode"] = victim.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            obs["victim_returncode"] = None
        obs["chrome_alive_right_after_kill"] = _alive(victim_launch.chrome)

        _wait_until(
            lambda: not _alive(victim_launch.chrome) and not any(_alive(p) for p in victim_tree),
            timeout=10.0,
        )
        obs["chrome_dead_after_s"] = time.monotonic() - started
        obs["chrome_alive_after_10s"] = _alive(victim_launch.chrome)
        obs["tree_alive_after_10s"] = [p for p in victim_tree if _alive(p)]

        _wait_until(lambda: not victim_launch.temp_dir.exists(), timeout=max(0.0, 10.0 - (time.monotonic() - started)))
        obs["temp_dir_exists_after_10s"] = victim_launch.temp_dir.exists()
        obs["temp_dir_survivors"] = _describe_survivors(victim_launch.temp_dir)

        _wait_until(lambda: not _alive(victim_launch.daemon), timeout=40.0, interval=0.5)
        obs["daemon_alive_after_40s"] = _alive(victim_launch.daemon)
        _wait_until(lambda: not _alive(victim_launch.watchdog), timeout=10.0)
        obs["watchdog_alive_at_end"] = _alive(victim_launch.watchdog)

        obs["live_after"] = {
            "chrome_alive": _alive(live_launch.chrome),
            "daemon_alive": _alive(live_launch.daemon),
            "temp_dir_exists": live_launch.temp_dir.is_dir(),
        }
        try:
            live.call_tool("browser_navigate", {"url": _data_url("<title>still here</title>")})
            obs["live_title"] = json.loads(
                live.call_tool("browser_evaluate", {"script": "document.title"})
            )
        except Exception as exc:
            obs["live_title"] = f"<failed: {exc}>"
        obs["live_stderr"] = live.stderr_tail(1500)
        live.call_tool("browser_close_all")

    def test_setup_produced_a_real_kill(self):
        """Guard the scenario itself: without a real SIGKILL of a live session, the rest proves nothing."""
        before = self.observations["before_kill"]
        self.assertTrue(before["chrome_alive"], "the victim's Chrome was not running before the kill")
        self.assertTrue(before["daemon_alive"], "the victim's daemon was not running before the kill")
        self.assertTrue(before["watchdog_alive"], "the victim had no watchdog before the kill")
        self.assertTrue(before["temp_dir_exists"], "the victim's temp profile did not exist before the kill")
        self.assertEqual(-signal.SIGKILL, self.observations["victim_returncode"])
        self.assertTrue(
            self.observations["chrome_alive_right_after_kill"],
            "Chrome died with its server, so nothing here exercises the watchdog",
        )

    def test_two_servers_get_different_profile_dirs(self):
        """Concurrent servers never share a profile, so never a SingletonLock."""
        live, victim = self.observations["live"], self.observations["victim"]
        self.assertNotEqual(
            os.path.realpath(live.profile_dir), os.path.realpath(victim.profile_dir)
        )
        for launch in (live, victim):
            self.assertTrue(launch.temp_dir.name.startswith(_TEMP_PROFILE_PREFIX), str(launch.profile_dir))

    def test_watchdog_kills_the_orphaned_browser(self):
        """Chrome and its helpers die within 10 s of their server's SIGKILL."""
        self.assertFalse(
            self.observations["chrome_alive_after_10s"],
            "the SIGKILLed server's Chrome was still running 10 s later",
        )
        self.assertEqual(
            [], self.observations["tree_alive_after_10s"], "browser helpers survived the watchdog"
        )

    def test_watchdog_removes_the_orphaned_profile_dir(self):
        """The temp profile is removed within 10 s of the SIGKILL."""
        self.assertFalse(
            self.observations["temp_dir_exists_after_10s"],
            f"{self.observations['victim'].temp_dir} survived its server's SIGKILL; what is left: "
            f"{self.observations['temp_dir_survivors']}",
        )

    def test_daemon_of_a_killed_server_exits(self):
        """The browser-harness daemon is gone within 40 s, and so is the watchdog."""
        self.assertFalse(
            self.observations["daemon_alive_after_40s"],
            "the SIGKILLed server's daemon was still running 40 s later",
        )
        self.assertFalse(self.observations["watchdog_alive_at_end"], "the watchdog never finished")

    def test_second_servers_browser_survives(self):
        """Cleaning up after one server never reaches another server's browser."""
        after = self.observations["live_after"]
        self.assertTrue(after["chrome_alive"], "the live server's Chrome was killed")
        self.assertTrue(after["daemon_alive"], "the live server's daemon was killed")
        self.assertTrue(after["temp_dir_exists"], "the live server's profile was removed")

    def test_second_server_still_drives_its_page(self):
        """The live server still navigates and evaluates after the other one died."""
        self.assertEqual(
            {"result": "still here"},
            self.observations["live_title"],
            f"live server stderr: {self.observations['live_stderr']}",
        )


# ---------------------------------------------------------------------------
# Lazy front: real Chromium survives idle and is cleaned up on every exit path
# ---------------------------------------------------------------------------

# A driver may inject only the documented front seams. SABOTAGE above still
# applies to the full-server child, so its browser/profile controls remain usable.
FRONT_SABOTAGE: str | None = None


@unittest.skipIf(
    _UNAVAILABLE is not None and not os.environ.get("CI"),
    f"E2E unavailable: {_UNAVAILABLE}",
)
class TestLazyFrontBrowserLifecycle(unittest.TestCase):
    """Each method owns a fresh front, child, browser and isolated environment."""

    def setUp(self):
        if _UNAVAILABLE is not None:
            self.fail(f"CI must satisfy the real-browser prerequisites: {_UNAVAILABLE}")
        # Imports are deferred to avoid circular imports with the existing
        # stdio suite, which consumes this file's environment constants.
        import test_mcp_front as wire
        self.wire = wire
        self.env = wire._clean_env(self)
        self.env.update(
            PLAYWRIGHT_BROWSERS_PATH=str(_playwright_cache_root()),
            BROWSER_USE_IDLE_STOP_SECONDS="2",
        )

    def _world(self, *, through_uv=False, shim_parent=False):
        wire = self.wire
        patch = FRONT_SABOTAGE or ""
        if SABOTAGE is not None:
            child_launcher = Path(self.env["HOME"]) / "browser-child-launcher.py"
            child_launcher.write_text(_LAUNCHER_TEMPLATE.format(
                scripts=str(_SCRIPTS_DIR), server=str(_SERVER_PATH), sabotage=SABOTAGE,
            ))
            argv = [sys.executable, str(child_launcher)]
            patch += f"\nmcp_front.Front.child_argv = lambda self: {argv!r}\n"
        if through_uv:
            self.assertFalse(patch, "literal uv topology must use the shipped command")
            argv = wire._literal_argv(self)
        else:
            argv = wire._front_argv(patch if patch else None)
        pid_file = Path(self.env["HOME"]) / "browser-front-pid"
        if shim_parent:
            argv = wire._shim_argv(argv, pid_file)
        client = wire._Proc(self, argv, self.env)
        client.initialize()
        if shim_parent:
            self.assertTrue(wire._wait(pid_file.is_file, 5), "shim did not publish its child PID")
            front_pid = int(pid_file.read_text())
        elif through_uv:
            self.assertTrue(wire._wait(lambda: bool(client.children()), 10))
            front_children = client.children()
            self.assertEqual(1, len(front_children), front_children)
            front_pid = next(iter(front_children))
        else:
            front_pid = client.pid
        reply = client.tool("browser_navigate", {"url": "about:blank"}, timeout=120)
        self.assertIn("result", reply, reply)
        self.assertFalse(reply["result"].get("isError"), reply)
        full_children = client.children(front_pid)
        self.assertEqual(1, len(full_children), full_children)
        child_pid = next(iter(full_children))
        roles = {}

        def classified():
            roles.clear()
            for pid in client.children(child_pid):
                roles.setdefault(_role(pid), []).append(pid)
            return all(roles.get(role) for role in ("chrome", "daemon", "watchdog"))

        self.assertTrue(wire._wait(classified, 10),
                        f"no real browser tree: {roles}; {client.stderr_text()[-2000:]}")
        chrome = roles["chrome"][0]
        profiles = _user_data_dir_args(chrome)
        self.assertEqual(1, len(profiles), profiles)
        launch = _Launch(chrome, roles["daemon"][0], roles["watchdog"][0], Path(profiles[0]))

        def cleanup_profile():
            # Stop processes before removing an owned profile, even on a failed
            # assertion or an intentionally broken browser-stop control.
            try:
                client.close()
            finally:
                shutil.rmtree(launch.temp_dir, ignore_errors=True)
        self.addCleanup(cleanup_profile)
        self.assertTrue(launch.profile_dir.is_dir())
        self.assertTrue(launch.temp_dir.name.startswith(_TEMP_PROFILE_PREFIX))
        sessions_reply = client.tool("browser_list_sessions")
        self.assertIn("result", sessions_reply, sessions_reply)
        sessions = json.loads(sessions_reply["result"]["content"][0]["text"])
        self.assertEqual(1, len(sessions))
        pids = client.record_tree() | {client.pid}
        return {
            "client": client, "front": front_pid, "child": child_pid, "launch": launch,
            "pids": pids, "session": sessions[0]["session_id"],
        }

    def _survivors(self, world):
        table = self.wire._process_table()
        client = world["client"]
        return sorted(
            pid for pid in world["pids"]
            if pid in table and not table[pid][1].startswith("Z")
            and table[pid][3] == client.owned[pid]
        )

    def _assert_cleaned(self, world, timeout=40):
        launch = world["launch"]
        self.assertTrue(
            self.wire._wait(
                lambda: not self._survivors(world) and not launch.temp_dir.exists(), timeout,
            ),
            f"survivors: {self._survivors(world)}; profile: "
            f"{_describe_survivors(launch.temp_dir)}; "
            f"stderr: {world['client'].stderr_text()[-2000:]}",
        )
        world["client"].proc.wait(timeout=5)
        self.assertFalse(launch.temp_dir.exists())

    def test_open_browser_blocks_idle_until_closed(self):
        # REQ-4, REQ-8, REQ-19; TEST-34 / V5.
        world = self._world()
        client, launch = world["client"], world["launch"]
        # No MCP traffic during this observation: browser ownership alone must
        # retain the child for five complete idle intervals.
        time.sleep(10)
        self.assertTrue(self.wire._is_alive(world["child"], client.owned[world["child"]]))
        self.assertTrue(self.wire._is_alive(launch.chrome, client.owned[launch.chrome]))
        self.assertTrue(launch.profile_dir.is_dir())
        listed = client.tool("browser_list_sessions")
        sessions = json.loads(listed["result"]["content"][0]["text"])
        self.assertEqual([world["session"]], [s["session_id"] for s in sessions])
        self.assertEqual({world["child"]}, client.children(world["front"]))
        closed = client.tool("browser_close_all", timeout=120)
        self.assertIn("result", closed, closed)
        self.assertFalse(closed["result"].get("isError"), closed)
        self.assertTrue(self.wire._wait(
            lambda: not self.wire._is_alive(world["child"], client.owned[world["child"]]), 75,
        ), client.stderr_text()[-2000:])
        self.assertIsNone(client.proc.poll(), "front died with its idle child")
        self.assertTrue(self.wire._wait(
            lambda: not self.wire._is_alive(launch.chrome, client.owned[launch.chrome])
            and not launch.temp_dir.exists(), 40,
        ), _describe_survivors(launch.temp_dir))

    def test_stdin_eof_front_cleans_browser_profile(self):
        # REQ-6, REQ-18; TEST-35 / V7 with a real browser.
        world = self._world()
        world["client"].proc.stdin.close()
        self._assert_cleaned(world)

    def test_sigterm_front_cleans_browser_profile(self):
        # REQ-6, REQ-18; TEST-36 / V7 with a real browser.
        world = self._world()
        world["client"].signal_owned(world["front"], signal.SIGTERM)
        self._assert_cleaned(world)

    def test_parent_death_front_cleans_browser_profile(self):
        # REQ-6, REQ-18; TEST-37. Open pipes isolate the getppid mechanism.
        world = self._world(shim_parent=True)
        client = world["client"]
        client.signal_owned(client.pid, signal.SIGKILL)
        client.proc.wait(timeout=5)
        self._assert_cleaned(world)
        self.assertFalse(client.proc.stdin.closed)

    def test_sigkill_front_cleans_browser_profile(self):
        # REQ-6, REQ-18; TEST-38 / architecture M6.
        world = self._world()
        client = world["client"]
        client.signal_owned(world["front"], signal.SIGKILL)
        self.assertEqual(-signal.SIGKILL, client.proc.wait(timeout=5))
        self._assert_cleaned(world, timeout=40)

    def test_uv_stop_sequence_cleans_browser_profile(self):
        # REQ-6, REQ-8, REQ-18; TEST-39. Signal only uv, never a group.
        world = self._world(through_uv=True)
        client = world["client"]
        for delay, signum in (
            (0, signal.SIGINT), (0.1, signal.SIGTERM), (0.4, signal.SIGKILL),
        ):
            if delay:
                time.sleep(delay)
            client.signal_owned(client.pid, signum)
        self._assert_cleaned(world)


# ---------------------------------------------------------------------------
# Stray-process guard
# ---------------------------------------------------------------------------

_PLAYWRIGHT_PIDS_BEFORE: set[int] = set()


def _playwright_processes() -> set[int]:
    """
    Every Playwright-Chromium PID on the machine right now.

    Read-only: this counts, and never kills. A PID set rather than a count, so an
    unrelated Playwright browser starting or stopping mid-run cannot move it; the
    set difference names exactly what appeared and stayed.
    """
    import psutil

    root = os.path.realpath(_playwright_cache_root())
    found = set()
    for proc in psutil.process_iter(["pid", "exe"]):
        try:
            exe = proc.info.get("exe") or ""
        except Exception:
            continue
        if exe and os.path.realpath(exe).startswith(root):
            found.add(proc.info["pid"])
    return found


def setUpModule():
    global _PLAYWRIGHT_PIDS_BEFORE
    if _UNAVAILABLE is not None:
        return
    _PLAYWRIGHT_PIDS_BEFORE = _playwright_processes()
    print(
        f"\n[e2e] Playwright Chromium processes before: {len(_PLAYWRIGHT_PIDS_BEFORE)} "
        f"{sorted(_PLAYWRIGHT_PIDS_BEFORE) or ''}",
        file=sys.stderr,
    )


def tearDownModule():
    if _UNAVAILABLE is not None:
        return
    _terminate_all_owned()
    _wait_until(lambda: not (_playwright_processes() - _PLAYWRIGHT_PIDS_BEFORE), timeout=15.0)
    after = _playwright_processes()
    new = sorted(after - _PLAYWRIGHT_PIDS_BEFORE)
    leaked = sorted(pid for pid in _OWNED_PIDS if _alive(pid))
    print(
        f"[e2e] Playwright Chromium processes after:  {len(after)} "
        f"(before: {len(_PLAYWRIGHT_PIDS_BEFORE)}); new since start: {new or 'none'}; "
        f"pids started by this suite: {len(_OWNED_PIDS)}, still alive: {leaked or 'none'}",
        file=sys.stderr,
    )
    if leaked:
        raise AssertionError(f"the suite leaked processes it started: {leaked}")
    if new:
        raise AssertionError(f"Playwright Chromium processes appeared and stayed: {new}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
