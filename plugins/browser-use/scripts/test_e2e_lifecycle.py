#!/usr/bin/env python3
"""
End-to-end browser lifecycle tests — REAL browser, REAL processes, no mocks.

Every other guard on this behaviour is mocked: test_mcp_server.py patches
`psutil.process_iter`, invents PIDs, and never launches anything. That proves the
reaper's *arithmetic*, not that it reaps. This file proves the shipped thing works
by doing it: it boots `python3 mcp-server.py` as a subprocess (the same way
`.mcp.json` does — see test_mcp_stdio.py, whose transport approach this reuses),
drives it over real MCP JSON-RPC, and then inspects the actual operating system.

What is proven, against processes that really exist:

  1. The launched binary is Playwright's Chromium, NOT the user's /Applications
     Google Chrome. This is the regression test for the original hijack bug.
  2. The PID-scoped profile directory is created as
     `browser-use-user-data-dir-session-<server pid>`, and the browser's real
     `--user-data-dir` argument names exactly that directory.
  3. Closing the session through the server kills the browser AND frees the
     directory.
  4. SIGTERM on the server kills the browser AND removes the directory, and the
     server then exits rather than lingering with its cleanup done.
  5. A newly started server's reaper terminates a REAL orphaned browser — one
     whose owning server was SIGKILLed and is genuinely gone.
  6. That same reaper does NOT touch a browser owned by a LIVE server, including
     the PID-prefix case (`session-8173` must not reap `session-81735`), built
     from a real dead PID and a real live one rather than a patched process_iter.

Safety rules this file obeys, without exception:
  - No `pkill`, no `killall`, no name or pattern matching. Every process it
    terminates is one it started, killed by explicit PID, and `_terminate_owned`
    refuses any PID not in `_OWNED_PIDS`.
  - Every server runs with `HOME` pointed at a temp directory, so no test can
    reach the user's real `~/.config/browseruse/profiles`. setUpClass asserts
    that before launching anything.
  - `BROWSER_USE_HEADLESS=true` throughout: nothing appears on screen.
  - `addClassCleanup` tears the world down even when an assertion fails.

Cost control: browsers are slow, so each class runs its scenario ONCE in
setUpClass, records what it observed, and the test methods assert on those
recordings. That keeps the suite near a minute while still letting each
behaviour fail on its own.

Negative control: `SABOTAGE` (below) lets a driver inject Python that runs after
mcp-server.py is imported but before `main()` — e.g. neutering
`_remove_session_profile_dir`. That is how this suite demonstrates each assertion
can fail WITHOUT editing mcp-server.py. It is None in every normal run.

Skips (loudly, with a reason) when browser_use/mcp/psutil are missing, when
Playwright's Chromium is not installed, or on a platform without POSIX signals.
"""

import importlib.util
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

_SERVER_PATH = Path(__file__).parent / "mcp-server.py"

# Must match mcp-server.py's _SESSION_PROFILE_PREFIX. Deliberately duplicated
# rather than imported: a test that asks the code under test what to expect
# cannot detect the code under test changing it.
_PROFILE_PREFIX = "browser-use-user-data-dir-session-"

# Negative-control hook — see the module docstring. Normal runs leave this None.
SABOTAGE: str | None = None


# ---------------------------------------------------------------------------
# Environment gating
# ---------------------------------------------------------------------------

def _missing_dependency() -> str | None:
    """Reason this machine cannot run these tests, or None."""
    if os.name != "posix":
        return "POSIX only: the suite sends SIGTERM/SIGKILL to the server"
    for module in ("browser_use", "mcp", "psutil"):
        if importlib.util.find_spec(module) is None:
            return f"{module} is not installed"
    if not _SERVER_PATH.is_file():
        return f"server not found at {_SERVER_PATH}"
    if _playwright_chromium() is None:
        return (
            "no Playwright Chromium in the browser cache — install it with "
            "'python3 -m playwright install chromium'"
        )
    return None


def _playwright_cache_root() -> Path:
    """Playwright's browser cache root. Resolved independently of mcp-server.py:
    a test must not ask the code under test where the browser lives."""
    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _exe_of(pid: int, required: bool = False, attempts: int = 5) -> str | None:
    """
    The executable path of `pid`, or None once it is gone.

    Reading it is inherently racy: psutil resolves /proc/<pid>/exe on Linux, so a
    process that exits between the check and the read raises FileNotFoundError
    rather than NoSuchProcess. Chrome reaps helper processes constantly, so this
    fires in normal operation — it failed a CI run on a helper, not on anything
    the test was asserting about.

    `required=True` retries briefly before giving up, for a process the caller
    genuinely expects to be alive (the main browser). Everything else is
    best-effort and simply drops out of the result.
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


_SKIP_REASON = _missing_dependency()


# ---------------------------------------------------------------------------
# Process ownership — nothing is killed unless this test started it
# ---------------------------------------------------------------------------

_OWNED_PIDS: set[int] = set()


def _own_tree(pid: int) -> list[int]:
    """
    Record `pid` and every descendant as ours, and return the descendants.

    Chrome forks helpers and renderers continuously, so this is called at each
    observation point rather than once. Anything reachable from a PID we spawned
    was spawned by us, transitively — which is what makes killing it in cleanup
    legitimate.
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

    The guard is the point: it makes an accidental kill of a process belonging to
    the user (their Chrome, their editor, anything) impossible by construction,
    rather than by a pattern that happens to be careful today.
    """
    import psutil

    if pid not in _OWNED_PIDS:
        raise AssertionError(
            f"refusing to terminate pid {pid}: not started by this test"
        )
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
    import psutil

    for pid in sorted(_OWNED_PIDS):
        if psutil.pid_exists(pid):
            _terminate_owned(pid, timeout=3.0)


def _alive(pid: int) -> bool:
    """True while `pid` is a live, non-zombie process."""
    import psutil

    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except Exception:
        return False


def _wait_until(predicate, timeout: float, interval: float = 0.25) -> bool:
    """Poll `predicate` until true or `timeout` elapses. Returns its final value."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return bool(predicate())


def _describe_survivors(profile_dir: Path, limit: int = 40) -> str:
    """
    What is still inside `profile_dir`, or '<gone>'. Never raises.

    A profile that survived shutdown is not one bug but a choice of two, and the
    contents tell them apart: a full Chrome profile means the removal never ran,
    while a handful of files (a stray journal, one directory) means it ran and
    lost a race with something still writing. Without this, a CI failure reports
    only that the path exists.
    """
    try:
        if not profile_dir.exists():
            return "<gone>"
        names = sorted(str(p.relative_to(profile_dir)) for p in profile_dir.rglob("*"))
    except Exception as exc:  # pragma: no cover - diagnostics must not fail a run
        return f"<unreadable: {exc}>"
    shown = ", ".join(names[:limit]) or "<empty directory>"
    suffix = f" (+{len(names) - limit} more)" if len(names) > limit else ""
    return f"{len(names)} entries: {shown}{suffix}"


def _user_data_dir_args(pid: int) -> list[str]:
    """Every --user-data-dir VALUE on a live process's real command line."""
    import psutil

    try:
        cmdline = psutil.Process(pid).cmdline()
    except Exception:
        return []
    values = []
    for index, arg in enumerate(cmdline):
        if arg.startswith("--user-data-dir="):
            values.append(arg.split("=", 1)[1])
        elif arg == "--user-data-dir" and index + 1 < len(cmdline):
            values.append(cmdline[index + 1])
    return values


def _dead_digit_prefix(pid: int) -> int | None:
    """
    A PID that is a DIGIT PREFIX of `pid` and does not currently exist.

    This is how the suite builds the prefix collision with real processes:
    a dead 8173 whose profile directory name is a string prefix of live 81735's.
    Returns the longest such prefix, or None when every prefix is taken.
    """
    import psutil

    text = str(pid)
    for cut in range(len(text) - 1, 0, -1):
        candidate = text[:cut]
        if candidate.startswith("0"):
            continue
        value = int(candidate)
        if value <= 1:  # 1 is init/launchd and always exists
            continue
        if psutil.pid_exists(value):
            continue
        return value
    return None


# ---------------------------------------------------------------------------
# Real MCP server subprocess, driven over real stdio JSON-RPC
# ---------------------------------------------------------------------------

_LAUNCHER_TEMPLATE = """\
import asyncio, importlib.util, sys
spec = importlib.util.spec_from_file_location("magus_mcp_server", {server!r})
mod = importlib.util.module_from_spec(spec)
sys.modules["magus_mcp_server"] = mod
spec.loader.exec_module(mod)
{sabotage}
asyncio.run(mod.main())
"""


class _Server:
    """
    A real `mcp-server.py` subprocess plus a minimal JSON-RPC client.

    test_mcp_stdio.py uses the MCP SDK's stdio_client for the same job; this
    speaks the newline-delimited framing directly because these tests need the
    server's PID (to compute its profile directory name) and need to signal it —
    neither of which the SDK's transport exposes.
    """

    def __init__(self, home: Path, extra_env: dict[str, str] | None = None):
        self.home = home
        self._scratch: Path | None = None
        self.stderr_path = home / f"server-stderr-{time.monotonic_ns()}.log"
        self._stderr_file = open(self.stderr_path, "wb")
        self._buffer = b""
        self._next_id = 0

        env = dict(os.environ)
        env.update(
            HOME=str(home),
            # The temp HOME has no browser cache, so point the resolver at the
            # real one. This is also what keeps assertion 1 meaningful: the
            # binary must come from HERE, not from /Applications.
            PLAYWRIGHT_BROWSERS_PATH=str(_playwright_cache_root()),
            BROWSER_USE_HEADLESS="true",
            ANONYMIZED_TELEMETRY="false",
            PYTHONUNBUFFERED="1",
        )
        for key in ("CHROME_EXECUTABLE_PATH", "CLAUDE_PROJECT_DIR", "BROWSER_USE_CLOUD"):
            env.pop(key, None)
        env.update(extra_env or {})

        self.proc = subprocess.Popen(
            self._argv(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_file,
            env=env,
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
            _LAUNCHER_TEMPLATE.format(server=str(_SERVER_PATH), sabotage=SABOTAGE)
        )
        return [sys.executable, str(launcher)]

    @property
    def profile_dir(self) -> Path:
        """Where this server's PID-scoped Chrome profile must appear."""
        return self.home / ".config" / "browseruse" / "profiles" / f"{_PROFILE_PREFIX}{self.pid}"

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
        """One JSON-RPC request/response round trip, skipping notifications."""
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
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "e2e-lifecycle", "version": "1"},
            },
            timeout=timeout,
        )
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call_tool(self, name: str, arguments: dict | None = None, timeout: float = 180.0) -> str:
        """Call an MCP tool and return its text content."""
        reply = self.request(
            "tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout
        )
        result = reply.get("result") or {}
        if result.get("isError"):
            raise RuntimeError(f"{name} failed: {result}")
        content = result.get("content") or []
        return content[0].get("text", "") if content else ""

    # -- lifecycle ------------------------------------------------------

    def launch_browser(self) -> int:
        """
        Start a real browser through the server and return its root PID.

        `browser_navigate` is the tool the plugin uses; it lazily calls
        `_init_browser_session`, which is the code path under test. about:blank
        keeps it offline and fast.
        """
        import psutil

        self.call_tool("browser_navigate", {"url": "about:blank"})
        _own_tree(self.pid)
        children = psutil.Process(self.pid).children()
        if not children:
            raise RuntimeError("server launched no browser process")
        return children[0].pid

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
            _terminate_owned(self.pid, timeout=5.0)
            if self.proc.poll() is None:
                try:
                    self.proc.kill()
                except Exception:
                    pass
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


_RAW_PROCS: list[subprocess.Popen] = []


def _launch_raw_chromium(profile_dir: Path) -> int:
    """
    Launch Playwright's Chromium directly on `profile_dir` and return its PID.

    Used to stand up the reaper's *victims* cheaply. The reaper identifies a
    browser solely by the `--user-data-dir` value on its command line, so a
    directly-launched Chromium is indistinguishable from a server-launched one
    to the code under test — and costs ~1s instead of ~15s.
    """
    binary = _playwright_chromium()
    assert binary is not None
    profile_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            binary,
            "--headless=new",
            f"--user-data-dir={profile_dir}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--remote-debugging-port=0",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _RAW_PROCS.append(proc)  # keep a reference so Python reaps it, not the GC
    _OWNED_PIDS.add(proc.pid)
    if not _wait_until(lambda: bool(_user_data_dir_args(proc.pid)), timeout=20.0):
        _terminate_owned(proc.pid)
        raise RuntimeError("raw Chromium did not come up")
    _own_tree(proc.pid)
    return proc.pid


def _make_home() -> Path:
    """A temp directory to use as HOME, so nothing touches the real profiles."""
    return Path(tempfile.mkdtemp(prefix="browser-use-e2e-home-"))


# ---------------------------------------------------------------------------
# 1-4: launch, profile directory, close, shutdown
# ---------------------------------------------------------------------------

@unittest.skipIf(_SKIP_REASON is not None, f"E2E unavailable: {_SKIP_REASON}")
class TestServerOwnedBrowserLifecycle(unittest.TestCase):
    """One real server, two real browsers, one recorded scenario.

    Sequence, run once in setUpClass:
      launch -> observe -> close through the server -> observe
             -> launch again -> SIGTERM the server -> observe
    """

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        import psutil

        cls.observations = {}
        home = _make_home()
        cls.addClassCleanup(shutil.rmtree, home, ignore_errors=True)
        cls.addClassCleanup(_terminate_all_owned)

        server = _Server(home)
        cls.addClassCleanup(server.close)

        profiles_root = home / ".config" / "browseruse" / "profiles"
        assert str(profiles_root).startswith(str(home)), "profiles must live under the temp HOME"

        server.initialize()

        # --- launch -----------------------------------------------------
        browser_pid = server.launch_browser()
        tree = _own_tree(server.pid)
        cls.observations["browser_pid"] = browser_pid
        cls.observations["browser_exe"] = _exe_of(browser_pid, required=True)
        # Chrome spawns and reaps helper processes continuously, so
        # `pid_exists(pid)` followed by `Process(pid).exe()` is a race: on Linux
        # the second call reads /proc/<pid>/exe and raises FileNotFoundError for
        # a helper that died in between. Observed on CI. Drop what vanished
        # rather than failing the run over it — the assertion cares about which
        # binaries ran, not about catching every short-lived helper.
        cls.observations["descendant_exes"] = sorted(
            {exe for exe in (_exe_of(pid) for pid in tree) if exe}
        )
        cls.observations["user_data_dir_args"] = _user_data_dir_args(browser_pid)
        cls.observations["profile_dir"] = server.profile_dir
        cls.observations["profiles_root_entries"] = sorted(
            p.name for p in profiles_root.iterdir()
        ) if profiles_root.is_dir() else []
        cls.observations["profile_dir_exists_after_launch"] = server.profile_dir.is_dir()

        # --- close the session through the server -----------------------
        sessions = json.loads(server.call_tool("browser_list_sessions"))
        session_id = sessions[0]["session_id"]
        # Re-snapshot: Chrome forks renderers as it runs, so the tree recorded at
        # launch is already out of date by the time the session is closed.
        tree = _own_tree(server.pid)
        cls.observations["close_result"] = server.call_tool(
            "browser_close_session", {"session_id": session_id}
        )
        # Helpers exit a beat after the process that spawned them, so the whole
        # tree is part of the wait, not just the root.
        _wait_until(
            lambda: (
                not _alive(browser_pid)
                and not any(_alive(p) for p in tree)
                and not server.profile_dir.exists()
            ),
            timeout=30.0,
        )
        cls.observations["browser_alive_after_close"] = _alive(browser_pid)
        cls.observations["tree_alive_after_close"] = [p for p in tree if _alive(p)]
        cls.observations["profile_dir_exists_after_close"] = server.profile_dir.exists()

        # --- launch again, then SIGTERM the server ----------------------
        browser_pid_2 = server.launch_browser()
        cls.observations["browser_pid_2"] = browser_pid_2
        cls.observations["profile_dir_exists_after_relaunch"] = server.profile_dir.is_dir()

        tree_2 = _own_tree(server.pid)
        server.signal(signal.SIGTERM)
        # The server's own exit is part of the wait, not a separate check after
        # it: shutdown removes the directory microseconds before os._exit(0), so
        # sampling the two independently is a race the harness would lose.
        _wait_until(
            lambda: (
                not _alive(browser_pid_2)
                and not any(_alive(p) for p in tree_2)
                and not server.profile_dir.exists()
                and server.proc.poll() is not None
            ),
            timeout=45.0,
        )
        cls.observations["browser_alive_after_sigterm"] = _alive(browser_pid_2)
        cls.observations["tree_alive_after_sigterm"] = [p for p in tree_2 if _alive(p)]
        cls.observations["profile_dir_exists_after_sigterm"] = server.profile_dir.exists()
        cls.observations["server_exited_after_sigterm"] = server.proc.poll() is not None
        # What is left when this fails is the whole diagnosis: a directory that
        # rmtree emptied and something wrote back into looks nothing like one it
        # never touched. Recording it here is the only chance — the temp HOME is
        # deleted at class teardown.
        cls.observations["profile_dir_survivors"] = _describe_survivors(server.profile_dir)

    def test_launched_binary_is_playwright_chromium(self):
        """The browser must come from Playwright's cache — the resolver's whole job."""
        exe = self.observations["browser_exe"]
        self.assertIn(
            "ms-playwright",
            exe,
            f"browser was launched from {exe!r}, which is not Playwright's Chromium",
        )

    def test_launched_binary_is_not_the_users_real_chrome(self):
        """The original bug: the plugin silently drove /Applications/Google Chrome."""
        real_chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        for exe in [self.observations["browser_exe"], *self.observations["descendant_exes"]]:
            self.assertNotEqual(exe, real_chrome, "launched the user's real Chrome")
            self.assertNotIn(
                "/Applications/Google Chrome.app",
                exe,
                f"a browser process is running out of the user's Chrome bundle: {exe!r}",
            )

    def test_profile_directory_is_created_with_the_session_pid_name(self):
        """`browser-use-user-data-dir-session-<server pid>`, under the temp HOME."""
        profile_dir = self.observations["profile_dir"]
        self.assertTrue(
            self.observations["profile_dir_exists_after_launch"],
            f"{profile_dir} was not created; profiles dir held "
            f"{self.observations['profiles_root_entries']}",
        )
        self.assertTrue(profile_dir.name.startswith(_PROFILE_PREFIX))
        self.assertTrue(profile_dir.name[len(_PROFILE_PREFIX):].isdigit())

    def test_user_data_dir_argument_points_at_that_profile_directory(self):
        """Not just named right — the real Chrome process must actually use it."""
        values = self.observations["user_data_dir_args"]
        self.assertTrue(values, "browser process had no --user-data-dir argument")
        expected = os.path.realpath(self.observations["profile_dir"])
        resolved = [os.path.realpath(v) for v in values]
        self.assertIn(
            expected,
            resolved,
            f"--user-data-dir was {resolved}, expected {expected}",
        )

    def test_closing_the_session_kills_the_browser_and_frees_the_profile_dir(self):
        """browser_close_session must end the process AND reclaim the ~50MB dir."""
        self.assertIn("Successfully closed", self.observations["close_result"])
        self.assertFalse(
            self.observations["browser_alive_after_close"],
            "browser survived browser_close_session",
        )
        self.assertEqual(
            [], self.observations["tree_alive_after_close"], "browser helpers survived close"
        )
        self.assertFalse(
            self.observations["profile_dir_exists_after_close"],
            f"{self.observations['profile_dir']} survived browser_close_session",
        )

    def test_sigterm_shutdown_kills_the_browser_and_removes_the_profile_dir(self):
        """A normally-terminated server must not strand Chrome or its profile."""
        self.assertTrue(
            self.observations["profile_dir_exists_after_relaunch"],
            "the second launch did not recreate the profile directory",
        )
        self.assertFalse(
            self.observations["browser_alive_after_sigterm"],
            "browser survived SIGTERM of its server",
        )
        self.assertEqual(
            [],
            self.observations["tree_alive_after_sigterm"],
            "browser helpers survived SIGTERM of their server",
        )
        self.assertFalse(
            self.observations["profile_dir_exists_after_sigterm"],
            f"{self.observations['profile_dir']} survived SIGTERM of its server; "
            f"what is left: {self.observations['profile_dir_survivors']}",
        )
        # Cleanup is bounded, so it may delay the exit but must never prevent it.
        # A server that cleaned up perfectly and then stayed resident is the bug
        # os._exit(0) exists to prevent, and it would otherwise pass this class.
        self.assertTrue(
            self.observations["server_exited_after_sigterm"],
            "the server cleaned up but never exited after SIGTERM",
        )


# ---------------------------------------------------------------------------
# 5-6: the reaper, against processes that really exist
# ---------------------------------------------------------------------------

@unittest.skipIf(_SKIP_REASON is not None, f"E2E unavailable: {_SKIP_REASON}")
class TestReaperAgainstRealProcesses(unittest.TestCase):
    """
    Three real browsers and three real servers, sharing one HOME:

      LIVE     server L, running, with its own real browser on session-<L>
      ORPHAN   server B, SIGKILLed after launching a browser -> session-<B>
      PREFIX   a real Chromium on session-<D>, where D is a real DEAD pid whose
               digits are a prefix of L's -> its directory name is a string
               prefix of LIVE's

    Then server R starts. Its reaper must kill ORPHAN and PREFIX and remove their
    directories, and must leave LIVE's browser and directory completely alone.
    The PREFIX pair is the bug just fixed: a substring test reaping dead 8173
    also killed live 81735's browser mid-task.
    """

    observations: dict = {}

    @classmethod
    def setUpClass(cls):
        import psutil

        cls.observations = {}
        home = _make_home()
        cls.addClassCleanup(shutil.rmtree, home, ignore_errors=True)
        cls.addClassCleanup(_terminate_all_owned)
        profiles_root = home / ".config" / "browseruse" / "profiles"

        # --- LIVE: a real server with a real browser --------------------
        live = _Server(home)
        cls.addClassCleanup(live.close)
        live.initialize()
        live_browser = live.launch_browser()
        live_tree = _own_tree(live.pid)
        if not live.profile_dir.is_dir():
            raise unittest.SkipTest("live server did not create its profile directory")

        # --- ORPHAN: a real server SIGKILLed with a browser running -----
        # Ordered before the PREFIX case on purpose: every server reaps at
        # startup, so a prefix directory created now would be swept by this
        # server rather than by the reaper the test is actually measuring.
        orphan_server = _Server(home)
        orphan_server.initialize()
        orphan_browser = orphan_server.launch_browser()
        orphan_tree = _own_tree(orphan_server.pid)
        orphan_dir = orphan_server.profile_dir
        orphan_server_pid = orphan_server.pid

        orphan_server.signal(signal.SIGKILL)
        orphan_server.proc.wait(timeout=15)  # reap the zombie: pid_exists must go False
        orphan_server.close()

        cls.observations["orphan_server_dead"] = not psutil.pid_exists(orphan_server_pid)
        cls.observations["orphan_browser_alive_before_reap"] = _alive(orphan_browser)
        cls.observations["orphan_dir_exists_before_reap"] = orphan_dir.exists()

        if not cls.observations["orphan_browser_alive_before_reap"]:
            raise unittest.SkipTest(
                "the SIGKILLed server's browser died with it, so there is no orphan "
                "to reap on this platform"
            )

        # --- PREFIX: a dead PID whose digits prefix the live server's ---
        dead_prefix = _dead_digit_prefix(live.pid)
        if dead_prefix is None:
            raise unittest.SkipTest(
                f"no digit prefix of live server pid {live.pid} is free; "
                "cannot build the PID-prefix collision with real processes"
            )
        prefix_dir = profiles_root / f"{_PROFILE_PREFIX}{dead_prefix}"
        prefix_browser = _launch_raw_chromium(prefix_dir)
        prefix_tree = _own_tree(prefix_browser)

        cls.observations["prefix_browser_alive_before_reap"] = _alive(prefix_browser)
        cls.observations["live_browser_alive_before_reap"] = _alive(live_browser)

        # --- REAPER: a newly started server -----------------------------
        if psutil.pid_exists(dead_prefix):
            raise unittest.SkipTest(
                f"pid {dead_prefix} was reused before the reaper ran; rerun the suite"
            )
        reaper = _Server(home)
        cls.addClassCleanup(reaper.close)
        if reaper.pid == dead_prefix:
            raise unittest.SkipTest(
                f"the reaper server was assigned pid {dead_prefix}, the PID this test "
                "needs to be dead; rerun the suite"
            )

        live_tree = _own_tree(live.pid)
        _wait_until(
            lambda: (
                not _alive(orphan_browser)
                and not any(_alive(p) for p in orphan_tree)
                and not orphan_dir.exists()
                and not _alive(prefix_browser)
                and not any(_alive(p) for p in prefix_tree)
                and not prefix_dir.exists()
            ),
            timeout=60.0,
        )
        # The reaper runs before the handshake; make sure the server really is up
        # so a hang is reported as a hang rather than as a missed reap.
        reaper.initialize()

        cls.observations.update(
            live_pid=live.pid,
            dead_prefix=dead_prefix,
            orphan_server_pid=orphan_server_pid,
            reaper_pid=reaper.pid,
            orphan_browser_alive_after_reap=_alive(orphan_browser),
            orphan_tree_alive_after_reap=[p for p in orphan_tree if _alive(p)],
            orphan_dir_exists_after_reap=orphan_dir.exists(),
            prefix_browser_alive_after_reap=_alive(prefix_browser),
            prefix_tree_alive_after_reap=[p for p in prefix_tree if _alive(p)],
            prefix_dir_exists_after_reap=prefix_dir.exists(),
            live_browser_alive_after_reap=_alive(live_browser),
            live_tree_dead_after_reap=[p for p in live_tree if not _alive(p)],
            live_dir_exists_after_reap=live.profile_dir.exists(),
            reaper_stderr=reaper.stderr_tail(2000),
        )

    def test_setup_produced_a_real_orphan_and_a_real_prefix_collision(self):
        """Guard the scenario itself: without these, 5 and 6 prove nothing."""
        self.assertTrue(self.observations["orphan_server_dead"], "the SIGKILLed server is not gone")
        self.assertTrue(
            self.observations["orphan_browser_alive_before_reap"],
            "no live orphan existed to reap",
        )
        self.assertTrue(
            self.observations["orphan_dir_exists_before_reap"],
            "the orphaned profile directory was already gone before the reaper ran",
        )
        self.assertTrue(
            self.observations["prefix_browser_alive_before_reap"],
            "the prefix-case browser never started",
        )
        self.assertTrue(
            self.observations["live_browser_alive_before_reap"],
            "the live server's browser never started",
        )
        self.assertTrue(
            str(self.observations["live_pid"]).startswith(str(self.observations["dead_prefix"])),
            "the dead pid is not a digit prefix of the live one — no collision to test",
        )

    def test_reaper_terminates_a_real_orphaned_browser(self):
        """A browser whose server was SIGKILLed must be killed by the next server."""
        self.assertFalse(
            self.observations["orphan_browser_alive_after_reap"],
            f"orphaned browser of dead server {self.observations['orphan_server_pid']} "
            f"survived the reaper; reaper stderr: {self.observations['reaper_stderr']}",
        )
        self.assertEqual(
            [],
            self.observations["orphan_tree_alive_after_reap"],
            "orphaned browser helpers survived the reaper",
        )

    def test_reaper_removes_the_orphaned_profile_directory(self):
        """The ~50MB directory goes with the process it belonged to."""
        self.assertFalse(
            self.observations["orphan_dir_exists_after_reap"],
            "the orphaned profile directory survived the reaper",
        )

    def test_reaper_does_not_kill_a_live_servers_browser(self):
        """The reaper must never reach a browser whose owning server is running."""
        self.assertTrue(
            self.observations["live_browser_alive_after_reap"],
            f"the reaper killed live server {self.observations['live_pid']}'s browser; "
            f"reaper stderr: {self.observations['reaper_stderr']}",
        )
        self.assertEqual(
            [],
            self.observations["live_tree_dead_after_reap"],
            "some of the live server's browser processes were killed by the reaper",
        )
        self.assertTrue(
            self.observations["live_dir_exists_after_reap"],
            "the reaper removed a live server's profile directory",
        )

    def test_reaping_a_pid_prefix_directory_spares_the_longer_pid(self):
        """
        session-<D> and session-<D…> are different directories, with real PIDs.

        Reaping dead D must kill D's browser and leave live D… alone. A substring
        test passes the first half and fails the second — which is exactly how
        the shipped bug behaved.
        """
        self.assertFalse(
            self.observations["prefix_browser_alive_after_reap"],
            f"the browser on session-{self.observations['dead_prefix']} (dead owner) "
            "was not reaped",
        )
        self.assertFalse(
            self.observations["prefix_dir_exists_after_reap"],
            f"session-{self.observations['dead_prefix']} survived the reaper",
        )
        self.assertTrue(
            self.observations["live_browser_alive_after_reap"],
            f"reaping session-{self.observations['dead_prefix']} also killed the browser on "
            f"session-{self.observations['live_pid']} — the PID-prefix collision is back",
        )


# ---------------------------------------------------------------------------
# Stray-process guard
# ---------------------------------------------------------------------------

_PLAYWRIGHT_PIDS_BEFORE: set[int] = set()


def _playwright_processes() -> set[int]:
    """
    Every Playwright-Chromium PID on the machine right now.

    Read-only: this counts, and never kills. Killing by pattern is exactly what
    this suite refuses to do.

    Recorded as a PID SET rather than a count on purpose. A raw before/after
    count is not an answer to "did the suite leak?" — this machine runs an
    unrelated chrome-headless-shell out of the same Playwright cache, and it
    starting or stopping mid-run moves the count in both directions. The set
    difference names exactly the processes that appeared and stayed.
    """
    import psutil

    root = str(_playwright_cache_root())
    found = set()
    for proc in psutil.process_iter(["pid", "exe"]):
        try:
            exe = proc.info.get("exe") or ""
        except Exception:
            continue
        if exe.startswith(root):
            found.add(proc.info["pid"])
    return found


def setUpModule():
    global _PLAYWRIGHT_PIDS_BEFORE
    if _SKIP_REASON is not None:
        return
    _PLAYWRIGHT_PIDS_BEFORE = _playwright_processes()
    print(
        f"\n[e2e] Playwright Chromium processes before: {len(_PLAYWRIGHT_PIDS_BEFORE)} "
        f"{sorted(_PLAYWRIGHT_PIDS_BEFORE) or ''}",
        file=sys.stderr,
    )


def tearDownModule():
    if _SKIP_REASON is not None:
        return
    _terminate_all_owned()
    for proc in _RAW_PROCS:  # collect exit statuses so nothing is left a zombie
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
    # Chrome's helpers take a moment to follow their parent down.
    _wait_until(
        lambda: not (_playwright_processes() - _PLAYWRIGHT_PIDS_BEFORE), timeout=15.0
    )
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
