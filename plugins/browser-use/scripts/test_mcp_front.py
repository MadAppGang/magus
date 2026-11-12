#!/usr/bin/env python3
"""Black-box tests for the lazy MCP entry; run beside mcp-server.py.

Only stdlib transport/process tools and existing test constants are imported.
The direct full server is the wire oracle. Dependency stubs enter through the
documented Front.child_argv seam, never through private coordinator state.
"""
import importlib.util
import json
import os
import platform
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from test_mcp_protocol import TOOL_CONTRACT
from test_mcp_stdio import _subprocess_env

_SCRIPTS = Path(__file__).resolve().parent
_SERVER = _SCRIPTS / "mcp-server.py"
_SNAPSHOT = _SCRIPTS / "mcp_front_snapshot.json"
_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
_CAPS_KEY = "io.modelcontextprotocol/clientCapabilities"
_MODERN = "2026-07-28"
_EMPTY = "No active browser sessions"
_REGENERATE = "python3 plugins/browser-use/scripts/write_front_snapshot.py"
_RUN = bool(os.environ.get("CI")) or all(
    importlib.util.find_spec(name) is not None for name in ("mcp", "browser_use")
)
_RSS_TARGET_HOST = sys.platform == "darwin" and platform.machine().lower() in (
    "arm64", "aarch64"
)


def _validate_rpc(line):
    """Validate every line, including blank lines and unsolicited messages."""
    try:
        message = json.loads(line)
    except (ValueError, UnicodeError) as exc:
        raise AssertionError(f"stdout is not newline JSON-RPC: {line[:300]!r}") from exc
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        raise AssertionError(f"invalid JSON-RPC envelope: {message!r}")
    if "method" in message:
        if not isinstance(message["method"], str) or "result" in message or "error" in message:
            raise AssertionError(f"invalid request/notification: {message!r}")
    elif "id" not in message or (("result" in message) == ("error" in message)):
        raise AssertionError(f"invalid response: {message!r}")
    elif "error" in message:
        error = message["error"]
        if (not isinstance(error, dict) or type(error.get("code")) is not int
                or not isinstance(error.get("message"), str)):
            raise AssertionError(f"invalid error response: {message!r}")
    return message


def _process_table():
    """pid -> (ppid, status, rss KB, start identity), on macOS and Linux."""
    result = subprocess.run(
        ["ps", "-A", "-o", "pid=,ppid=,stat=,rss=,lstart="],
        capture_output=True, text=True, check=True, timeout=10,
    )
    table = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 9:
            table[int(fields[0])] = (
                int(fields[1]), fields[2], int(fields[3]), tuple(fields[4:])
            )
    return table


def _is_alive(pid, identity=None):
    row = _process_table().get(pid)
    return bool(row and not row[1].startswith("Z")
                and (identity is None or row[3] == identity))


def _wait(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return bool(predicate())


def _clean_env(testcase):
    env = _subprocess_env(testcase)
    for key in list(env):
        if (key.startswith("BROWSER_USE_") or key.endswith(("_API_KEY", "_TOKEN"))
                or key.startswith(("AWS_", "AZURE_", "GOOGLE_APPLICATION_"))):
            env.pop(key, None)
    env.update(PYTHONUNBUFFERED="1", PYTHONDONTWRITEBYTECODE="1",
               BROWSER_USE_HEADLESS="true", ANONYMIZED_TELEMETRY="false")
    return env


def _literal_argv(testcase):
    if shutil.which("uv") is None:
        if os.environ.get("CI"):
            testcase.fail("CI must install uv for the literal .mcp.json launch")
        testcase.skipTest("uv is not installed")
    plugin_root = _SCRIPTS.parent
    config = json.loads((plugin_root / ".mcp.json").read_text())
    config = config.get("mcpServers", config)["browser-use"]
    testcase.assertEqual("uv", config["command"])
    testcase.assertEqual(
        ["run", "--no-config", "--script",
         str(plugin_root / "scripts" / "mcp-server.py"), "--lazy"],
        [arg.replace("${CLAUDE_PLUGIN_ROOT}", str(plugin_root)) for arg in config["args"]],
    )
    return [config["command"], *[
        arg.replace("${CLAUDE_PLUGIN_ROOT}", str(plugin_root)) for arg in config["args"]
    ]]


def _front_argv(patch=None, server_path=None):
    server_path = str(server_path or _SERVER)
    if patch is None and server_path == str(_SERVER):
        return [sys.executable, str(_SERVER), "--lazy"]
    return [sys.executable, "-c",
            f"import sys; sys.path.insert(0, {str(_SCRIPTS)!r})\n"
            "import mcp_front\n" + (patch or "") + "\n"
            f"raise SystemExit(mcp_front.main(server_path={server_path!r}))\n"]


class _Proc:
    """Raw stdio client with bounded reads, full wire history and owned cleanup."""

    def __init__(self, testcase, argv, env):
        self.testcase, self.messages, self.owned = testcase, [], {}
        self._buffer, self._id, self._closed = b"", 0, False
        self.stderr_path = Path(env["HOME"]) / f"front-stderr-{time.monotonic_ns()}.log"
        self._err = self.stderr_path.open("wb")
        try:
            self.proc = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self._err,
                env=env, cwd=env["HOME"], bufsize=0, close_fds=True,
            )
        except BaseException:
            self._err.close()
            raise
        self.pid = self.proc.pid
        self._selector = selectors.DefaultSelector()
        self._selector.register(self.proc.stdout, selectors.EVENT_READ)
        testcase.addCleanup(self.close)
        self.record_tree()

    def record_tree(self):
        table, reachable = _process_table(), {self.pid}
        root = table.get(self.pid)
        if (self.proc.poll() is not None or root is None
                or (self.pid in self.owned and root[3] != self.owned[self.pid])):
            return set()
        while True:
            more = {pid for pid, row in table.items() if row[0] in reachable} - reachable
            if not more:
                break
            reachable.update(more)
        for pid in reachable:
            if pid in table:
                self.owned.setdefault(pid, table[pid][3])
        return reachable - {self.pid}

    def children(self, parent=None):
        self.record_tree()
        parent = self.pid if parent is None else parent
        table = _process_table()
        if (parent not in self.owned or parent not in table
                or table[parent][3] != self.owned[parent]):
            return set()
        return {pid for pid, row in table.items()
                if row[0] == parent and not row[1].startswith("Z")}

    def signal_owned(self, pid, signum):
        if pid not in self.owned:
            raise AssertionError(f"refusing to signal unowned pid {pid}")
        if not _is_alive(pid, self.owned[pid]):
            return
        if pid == self.pid:
            if self.proc.poll() is None:
                self.proc.send_signal(signum)
        else:
            os.kill(pid, signum)

    def stderr_text(self):
        if not self._err.closed:
            self._err.flush()
        return self.stderr_path.read_text(errors="replace")

    def send(self, message):
        self.send_raw((json.dumps(message, ensure_ascii=False) + "\n").encode())

    def send_raw(self, data):
        view = memoryview(data)
        while view:
            written = os.write(self.proc.stdin.fileno(), view)
            view = view[written:]

    def send_request(self, method, params=None, request_id=None):
        if request_id is None:
            self._id += 1
            request_id = self._id
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self.send(message)
        return request_id

    def read(self, timeout=30.0):
        deadline = time.monotonic() + timeout
        while True:
            if b"\n" in self._buffer:
                line, self._buffer = self._buffer.split(b"\n", 1)
                message = _validate_rpc(line)
                self.messages.append(message)
                return message
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"pid {self.pid}: no JSON-RPC in {timeout}s; "
                    f"stderr: {self.stderr_text()[-2000:]}"
                )
            if not self._selector.select(min(remaining, 0.5)):
                continue
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                if self._buffer:
                    raise AssertionError(f"unterminated stdout line: {self._buffer[:200]!r}")
                raise EOFError(f"pid {self.pid} stdout EOF; {self.stderr_text()[-2000:]}")
            self._buffer += chunk

    def response(self, request_id, timeout=60.0):
        deadline = time.monotonic() + timeout
        while True:
            for message in self.messages:
                if "method" not in message and message.get("id") == request_id:
                    return message
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no response for ID {request_id!r}; {self.stderr_text()[-2000:]}")
            self.read(remaining)

    def request(self, method, params=None, request_id=None, timeout=60.0):
        return self.response(self.send_request(method, params, request_id), timeout)

    def drain(self, seconds=0.35):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                self.read(max(0.001, deadline - time.monotonic()))
            except TimeoutError:
                return

    def once(self, ids):
        self.drain()
        actual = [m["id"] for m in self.messages if "method" not in m]
        for request_id in ids:
            self.testcase.assertEqual(1, actual.count(request_id),
                                      f"ID {request_id!r} answered {actual.count(request_id)} times")
        self.testcase.assertTrue(all(value in ids for value in actual),
                                 f"unsolicited/internal response ID: {actual!r}")

    def initialize(self, version="2025-11-25"):
        reply = self.request("initialize", _init_params(version))
        self.testcase.assertIn("result", reply, reply)
        self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return reply

    def tool(self, name="browser_list_sessions", arguments=None, modern=False, **kwargs):
        params = {"name": name, "arguments": arguments or {}}
        if modern:
            params.update(_envelope())
        return self.request("tools/call", params, **kwargs)

    def close(self):
        if self._closed:
            return
        self._closed = True
        # Assertions precede cleanup; teardown cannot prove a lifecycle result.
        try:
            self.record_tree()
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.signal_owned(self.pid, signal.SIGTERM)
                try:
                    self.proc.wait(timeout=7)
                except subprocess.TimeoutExpired:
                    self.signal_owned(self.pid, signal.SIGKILL)
                    self.proc.wait(timeout=5)
            for pid in self.owned:
                if pid != self.pid and _is_alive(pid, self.owned[pid]):
                    self.signal_owned(pid, signal.SIGTERM)
            survivors = [pid for pid in self.owned
                         if pid != self.pid and _is_alive(pid, self.owned[pid])]
            if survivors and not _wait(lambda: not any(
                    _is_alive(pid, self.owned[pid]) for pid in survivors), 2):
                for pid in survivors:
                    self.signal_owned(pid, signal.SIGKILL)
            deadline = time.monotonic() + 3
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("stdout remained open after owned-process cleanup")
                    self.read(timeout=remaining)
            except EOFError:
                pass
        finally:
            self._selector.close()
            for stream in (self.proc.stdin, self.proc.stdout, self._err):
                if stream and not stream.closed:
                    stream.close()


def _init_params(version):
    return {"protocolVersion": version, "capabilities": {},
            "clientInfo": {"name": "front-contract-tests", "version": "1"}}


def _envelope(version=_MODERN, capabilities=True):
    meta = {_VERSION_KEY: version}
    if capabilities:
        meta[_CAPS_KEY] = {}
    return {"_meta": meta}


def _tool_params(modern=False):
    return {"name": "browser_list_sessions", "arguments": {},
            **(_envelope() if modern else {})}


def _version_constants(env):
    result = subprocess.run(
        [sys.executable, "-c",
         "import json; from mcp_types.version import HANDSHAKE_PROTOCOL_VERSIONS, "
         "LATEST_HANDSHAKE_VERSION; print(json.dumps([list(HANDSHAKE_PROTOCOL_VERSIONS), "
         "LATEST_HANDSHAKE_VERSION]))"],
        env=env, cwd=env["HOME"], capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(result.stdout)


def _wire_scenarios(versions, latest):
    """Each sequence uses a fresh connection, identical IDs on both servers."""
    scenarios = {}
    for version in versions:
        scenarios["L-" + version] = [
            ("initialize", _init_params(version)),
            ("notifications/initialized", None), ("tools/list", None),
            ("tools/list", {"cursor": "x"}), ("ping", None),
        ]
    scenarios.update({
        "L-unsupported": [("initialize", _init_params("1999-01-01")), ("tools/list", None)],
        "L-preinit": [("ping", None), ("tools/list", None),
                      ("initialize", _init_params(latest)), ("tools/list", None)],
        "L-bare-initialized": [("notifications/initialized", None), ("tools/list", None),
                               ("tools/call", _tool_params())],
        "L-reinit-after-child": [
            ("ping", None), ("tools/call", {"name": "browser_doctor", "arguments": {}}),
            ("initialize", _init_params(latest)), ("notifications/initialized", None),
            ("tools/call", _tool_params()),
        ],
        "L-enveloped-after-ping": [
            ("ping", None), ("tools/list", _envelope()),
            ("initialize", _init_params(latest)), ("tools/call", _tool_params()),
        ],
        "L-enveloped-after-init": [
            ("initialize", _init_params(latest)), ("tools/list", _envelope()),
        ],
        "L-live-pipelined-init": [
            ("ping", None), ("tools/call", {"name": "browser_doctor", "arguments": {}}),
            ("PIPELINE", [("initialize", _init_params(latest)), ("tools/list", None),
                          ("tools/call", _tool_params())]),
        ],
        "M": [("server/discover", _envelope()), ("tools/list", _envelope()),
              ("tools/list", {**_envelope(), "cursor": "x"})],
        "M-list-first": [("tools/list", _envelope()), ("server/discover", _envelope())],
        "M-unsupported": [
            ("server/discover", _envelope("2099-01-01")),
            ("server/discover", _envelope()), ("tools/list", _envelope()),
            ("tools/call", _tool_params(True)),
        ],
        "M-missing-caps": [
            ("tools/list", _envelope(capabilities=False)),
            ("server/discover", _envelope()), ("tools/call", _tool_params(True)),
        ],
        "M-unsupported-first-call": [
            ("tools/call", {**_tool_params(True), **_envelope("2099-01-01")}),
            ("tools/call", _tool_params(True)),
        ],
        "M-initialize": [
            ("server/discover", _envelope()),
            ("initialize", _init_params(latest)), ("initialize", _init_params(7)),
        ],
        "M-ping": [("server/discover", _envelope()), ("ping", _envelope())],
        "M-unenveloped-after-discover": [
            ("server/discover", _envelope()), ("ping", None),
            ("tools/call", _tool_params(True)),
        ],
        "M-bad-envelope": [
            ("server/discover", _envelope()),
            ("tools/list", {"_meta": {_VERSION_KEY: _MODERN, _CAPS_KEY: 7}}),
            ("tools/call", _tool_params(True)),
        ],
        "L-malformed-init": [
            ("initialize", {"protocolVersion": latest}),
            ("initialize", _init_params(latest)), ("tools/call", _tool_params()),
        ],
        "L-exotic-list": [
            ("initialize", _init_params(latest)),
            ("tools/list", {"cursor": 7}), ("tools/list", {"unexpected": True}),
        ],
    })
    return scenarios


def _capture(proc, steps):
    replies, ids = [], []
    for method, params in steps:
        if method == "PIPELINE":
            batch = [proc.send_request(name, args) for name, args in params]
            ids.extend(batch)
            replies.extend(proc.response(request_id) for request_id in batch)
        elif method.startswith("notifications/"):
            proc.send({"jsonrpc": "2.0", "method": method})
        else:
            request_id = proc.send_request(method, params)
            ids.append(request_id)
            replies.append(proc.response(request_id))
    proc.once(ids)
    return replies


# This dependency models external failure/latency, not coordinator internals.
_STUB = r"""
import json, os, signal, sys, threading, time
from pathlib import Path
root = Path(sys.argv[1])
mode = sys.argv[2]
lock = threading.Lock()
held = {}
backstop = threading.Timer(120, lambda: os._exit(0))
backstop.daemon = True
backstop.start()
def event(text):
    with (root / ("events-" + str(os.getpid()))).open("a") as f:
        f.write(text + "\n")
def send(message):
    with lock:
        print(json.dumps({"jsonrpc": "2.0", **message}), flush=True)
def result(rid, value):
    send({"id": rid, "result": value})
def probe(rid):
    event("probe")
    if (root / "hold_probe").exists():
        while (root / "hold_probe").exists():
            time.sleep(.02)
        result(rid, {"content": [{"type": "text", "text": "No active browser sessions"}]})
        return
    if mode == "probe-error":
        send({"id": rid, "error": {"code": -32603, "message": "uncertain"}})
        return
    text = {"occupied": '[{"session_id":"owned-session"}]',
            "changed": "No sessions", "tool-error": "No active browser sessions"}.get(
                mode, "No active browser sessions")
    result(rid, {"content": [{"type": "text", "text": text}],
                 **({"isError": True} if mode == "tool-error" else {})})
def term(signum, frame):
    event("TERM")
    if mode != "stubborn":
        os._exit(0)
if mode in ("term", "stubborn"):
    signal.signal(signal.SIGTERM, term)
for line in sys.stdin:
    msg = json.loads(line)
    method, rid, params = msg.get("method"), msg.get("id"), msg.get("params", {})
    if method == "initialize":
        if (root / "reject_start").exists():
            send({"id": rid, "error": {"code": -32602, "message": "opening rejected"}})
        elif (root / "stall_start").exists():
            continue
        else:
            while (root / "hold_start").exists():
                time.sleep(.02)
            result(rid, {"protocolVersion": params["protocolVersion"],
                         "capabilities": {"tools": {}},
                         "serverInfo": {"name": "test-child", "version": "1"}})
    elif method == "server/discover":
        result(rid, {})
    elif method == "tools/call" and params.get("name") == "browser_list_sessions":
        threading.Thread(target=probe, args=(rid,), daemon=True).start()
    elif method == "qa/hold":
        held[json.dumps(rid)] = rid
        send({"method": "notifications/progress",
              "params": {"progressToken": rid, "progress": 0, "total": 1}})
    elif method == "notifications/cancelled":
        held.pop(json.dumps(params["requestId"]), None)
    elif method == "qa/relay":
        held["relay"] = rid
        send({"method": "notifications/progress",
              "params": {"progressToken": "relay-token", "progress": 1, "total": 2}})
        send({"method": "notifications/message",
              "params": {"level": "info", "data": "child log"}})
        send({"id": "child-question", "method": "qa/question", "params": {"value": 42}})
    elif method is None and rid == "child-question":
        result(held.pop("relay"), msg["result"])
    elif method == "qa/client-notification":
        send({"method": "notifications/message", "params": {"level": "info", "data": params}})
    elif method == "qa/noisy":
        os.write(1, b"not-json-from-child\n")
        os.write(2, b"child-stderr-marker\n")
        result(rid, {"ok": True})
    elif rid is not None:
        result(rid, {"pid": os.getpid(), "echo": params})
event("EOF")
if mode in ("term", "stubborn"):
    while True:
        time.sleep(.1)
"""


def _stub_patch(directory, mode="empty", extra=""):
    path = Path(directory) / "dependency.py"
    path.write_text(_STUB)
    argv = [sys.executable, str(path), str(directory), mode]
    return (
        f"mcp_front.Front.child_argv = lambda self: {argv!r}\n"
        "mcp_front.TICK_SECONDS = 0.05\n"
        "mcp_front.STOP_EOF_GRACE_SECONDS = 1.0\n"
        "mcp_front.STOP_TERM_GRACE_SECONDS = 1.0\n" + extra
    )


def _shim_argv(argv, pid_file, proxy=False):
    """proxy=True: shim alone owns client pipe ends; test talks through shim."""
    source = (
        "import os, subprocess, sys, time, threading\nfrom pathlib import Path\n"
        f"argv={argv!r}\n"
    )
    if proxy:
        source += (
            "p=subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, "
            "stderr=None, bufsize=0, close_fds=True)\n"
            f"pidfile=Path({str(pid_file)!r})\n"
            "pending=pidfile.with_suffix('.pending')\n"
            "pending.write_text(str(p.pid)); pending.replace(pidfile)\n"
            "def copy(source, dest):\n"
            "    try:\n"
            "        while True:\n"
            "            data=os.read(source,65536)\n"
            "            if not data: break\n"
            "            view=memoryview(data)\n"
            "            while view:\n"
            "                n=os.write(dest,view); view=view[n:]\n"
            "    except OSError: pass\n"
            "    try: os.close(dest)\n"
            "    except OSError: pass\n"
            "threading.Thread(target=copy,args=(0,p.stdin.fileno()),daemon=True).start()\n"
            "threading.Thread(target=copy,args=(p.stdout.fileno(),1),daemon=True).start()\n"
            "p.wait()\n"
        )
    else:
        source += (
            "p=subprocess.Popen(argv, close_fds=True)\n"
            f"pidfile=Path({str(pid_file)!r})\n"
            "pending=pidfile.with_suffix('.pending')\n"
            "pending.write_text(str(p.pid)); pending.replace(pidfile)\n"
            "p.wait()\n"
        )
    return [sys.executable, "-c", source]


@unittest.skipUnless(_RUN, "browser_use / mcp not installed")
class TestMcpFront(unittest.TestCase):
    def setUp(self):
        if os.name != "posix":
            if os.environ.get("CI"):
                self.fail("CI requires a POSIX host for process lifecycle assertions")
            self.skipTest("POSIX process tests")
        self.env = _clean_env(self)

    def front(self, patch=None, env=None, server_path=None):
        return _Proc(self, _front_argv(patch, server_path), env or self.env)

    def direct(self):
        return _Proc(self, [sys.executable, str(_SERVER)], self.env)

    def stub(self, mode="empty", idle="0.5", extra="", initialize=True):
        directory = Path(tempfile.mkdtemp(prefix="front-test-child-"))
        self.addCleanup(shutil.rmtree, directory, ignore_errors=True)
        env = {**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": str(idle)}
        proc = self.front(_stub_patch(directory, mode, extra), env)
        if initialize:
            proc.initialize()
        return proc, directory

    def child(self, proc, parent=None):
        self.assertTrue(_wait(lambda: bool(proc.children(parent)), 10), proc.stderr_text())
        children = proc.children(parent)
        self.assertEqual(1, len(children), children)
        return next(iter(children))

    def gone(self, proc, *pids, timeout=15):
        identities = {pid: proc.owned.get(pid) for pid in pids}
        self.assertTrue(_wait(lambda: all(
            not _is_alive(pid, identities[pid]) for pid in pids), timeout),
            f"owned processes survived: {pids}; {proc.stderr_text()[-2000:]}")

    def assert_tools(self, reply):
        self.assertIn("result", reply, reply)
        tools = reply["result"]["tools"]
        self.assertEqual(27, len(tools))
        self.assertEqual(sorted(TOOL_CONTRACT), sorted(tool["name"] for tool in tools))
        for tool in tools:
            expected = TOOL_CONTRACT[tool["name"]]
            schema = tool["inputSchema"]
            self.assertEqual(expected["properties"], frozenset(schema.get("properties", {})))
            self.assertEqual(expected["required"], frozenset(schema.get("required", [])))

    def assert_tool_ok(self, reply):
        self.assertIn("result", reply, reply)
        self.assertFalse(reply["result"].get("isError", False), reply)
        return reply["result"]

    def test_legacy_opening_starts_no_child(self):
        # REQ-1, REQ-2, REQ-7, REQ-9; TEST-1 / V1.
        proc = self.front()
        proc.initialize()
        self.assert_tools(proc.request("tools/list"))
        self.assert_tools(proc.request("tools/list", {"cursor": "x"}))
        self.assertEqual({}, proc.request("ping")["result"])
        proc.drain(1)
        self.assertEqual(set(), proc.children(), proc.stderr_text())

    def test_modern_opening_starts_no_child(self):
        # REQ-2, REQ-7, REQ-13; TEST-2 / V1.
        proc = self.front()
        discover = proc.request("server/discover", _envelope(), request_id="discover")
        self.assertEqual("complete", discover["result"]["resultType"])
        self.assertIn(_MODERN, discover["result"]["supportedVersions"])
        self.assert_tools(proc.request("tools/list", _envelope()))
        self.assert_tools(proc.request("tools/list", {**_envelope(), "cursor": "x"}))
        self.assertEqual(-32601, proc.request("ping", _envelope())["error"]["code"])
        self.assertEqual(-32022, proc.request("initialize", _init_params(_MODERN))["error"]["code"])
        proc.drain(1)
        self.assertEqual(set(), proc.children())

    def test_mcp_json_command_serves_without_a_child(self):
        # REQ-1, REQ-2, REQ-13, REQ-18; TEST-3 / V1+.
        proc = _Proc(self, _literal_argv(self), self.env)
        proc.initialize()
        self.assert_tools(proc.request("tools/list"))
        front = self.child(proc)
        proc.drain(1)
        self.assertEqual(set(), proc.children(front))
        table = _process_table()
        print(f"front RSS: {table[front][2]} KB; uv RSS: {table[proc.pid][2]} KB", file=sys.stderr)
        if _RSS_TARGET_HOST:
            self.assertLessEqual(table[front][2], 25600)

    def test_front_wire_equals_full_server(self):
        # REQ-2, REQ-3, REQ-9, REQ-10, REQ-13; TEST-4 / V2.
        versions, latest = _version_constants(self.env)
        for name, steps in _wire_scenarios(versions, latest).items():
            with self.subTest(scenario=name):
                front, full = self.front(), self.direct()
                try:
                    self.assertEqual(_capture(full, steps), _capture(front, steps),
                                     f"Wire drift in {name}; regenerate with {_REGENERATE}")
                finally:
                    front.close()
                    full.close()

    def test_snapshot_versions_match_mcp_constants(self):
        # REQ-10, REQ-14; TEST-5.
        versions, latest = _version_constants(self.env)
        snapshot = json.loads(_SNAPSHOT.read_text())
        self.assertEqual(versions, snapshot["legacy"]["versions"], _REGENERATE)
        self.assertEqual(latest, snapshot["legacy"]["fallbackVersion"], _REGENERATE)
        direct = self.direct()
        supported = direct.request("server/discover", _envelope())["result"]["supportedVersions"]
        self.assertEqual(supported, snapshot["modern"]["versions"], _REGENERATE)

    def test_front_imports_only_stdlib(self):
        # REQ-1, REQ-11; TEST-6. Imports are observed, never source-scanned.
        source = (
            f"import sys,json; sys.path.insert(0,{str(_SCRIPTS)!r}); "
            "baseline=set(sys.modules); import mcp_front; "
            "print(json.dumps({'modules':list(set(sys.modules)-baseline),"
            "'idle':mcp_front.IDLE_STOP_SECONDS,'env':mcp_front.IDLE_STOP_ENV}))"
        )
        result = subprocess.run(
            [sys.executable, "-c", source], env=self.env, cwd=self.env["HOME"],
            capture_output=True, text=True, timeout=15, check=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(600, data["idle"])
        self.assertEqual("BROWSER_USE_IDLE_STOP_SECONDS", data["env"])
        unexpected = {name.split(".")[0] for name in data["modules"]} - (
            set(sys.stdlib_module_names) | set(sys.builtin_module_names) | {"mcp_front", "browser_env"}
        )
        self.assertEqual(set(), unexpected, f"non-stdlib imports: {unexpected}")
        entry = subprocess.run(
            [sys.executable, "-X", "importtime", str(_SERVER), "--lazy"],
            input=b"", capture_output=True, env=self.env, cwd=self.env["HOME"], timeout=20,
        )
        self.assertEqual(0, entry.returncode, entry.stderr.decode(errors="replace"))
        self.assertEqual(b"", entry.stdout, "EOF entry leaked stdout")
        imported = {
            line.rsplit("|", 1)[-1].strip().split(".")[0]
            for line in entry.stderr.decode(errors="replace").splitlines()
            if line.startswith("import time:") and "|" in line
        }
        self.assertFalse(imported & {"mcp", "mcp_types", "pydantic", "anyio", "browser_use"},
                         f"heavy imports from real lazy entry: {imported}")

    def test_front_rss_after_initialize_and_list(self):
        # REQ-1; TEST-7 / V9. Target is explicitly scoped to macOS arm64.
        proc = self.front()
        proc.initialize()
        self.assert_tools(proc.request("tools/list"))
        measured = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(proc.pid)], capture_output=True, text=True,
            timeout=10, check=True,
        )
        rss = int(measured.stdout.strip())
        print(f"front RSS: {rss} KB", file=sys.stderr)
        self.assertGreater(rss, 0)
        if _RSS_TARGET_HOST:
            self.assertLessEqual(rss, 25600)
        self.assertEqual(set(), proc.children())

    def test_tool_call_starts_child_and_matches_server(self):
        # REQ-3, REQ-9, REQ-19; TEST-8 / V3.
        front, full = self.front(), self.direct()
        front.initialize()
        full.initialize()
        for tool in ("browser_list_sessions", "browser_doctor"):
            with self.subTest(tool=tool):
                expected = self.assert_tool_ok(full.tool(tool))
                actual = self.assert_tool_ok(front.tool(tool))
                self.assertEqual(expected, actual)
                self.child(front)
                if tool == "browser_list_sessions":
                    self.assertEqual(_EMPTY, actual["content"][0]["text"])
                else:
                    doctor = json.loads(actual["content"][0]["text"])
                    self.assertEqual(sys.executable, doctor["python_executable"])
                    self.assertFalse(any(doctor["api_keys"].values()), doctor)

    def sleeper(self, seconds=6):
        root = Path(self.env["HOME"])
        path, started = root / f"sleep-{time.monotonic_ns()}.py", root / f"started-{time.monotonic_ns()}"
        path.write_text(
            "import os,time\nfrom pathlib import Path\n"
            f"Path({str(started)!r}).write_text('started')\n"
            "parent=os.getppid(); start=time.monotonic()\n"
            f"while time.monotonic()-start < {seconds!r}:\n"
            "    if os.getppid()!=parent or time.monotonic()-start>30: raise SystemExit(0)\n"
            "    time.sleep(.05)\nprint('sleeper-complete')\n"
        )
        return {"name": "browser_run_script", "arguments": {
            "script_path": str(path), "timeout_seconds": 20}}, started

    def test_concurrent_calls_keep_their_ids(self):
        # REQ-3, REQ-7, REQ-15; TEST-9 / V3.
        proc = self.front()
        proc.initialize()
        params, started = self.sleeper()
        proc.send_request("tools/call", params, request_id="slow")
        proc.send_request("tools/call", _tool_params(), request_id=700)
        proc.send_request("tools/call", {"name": "browser_doctor", "arguments": {}},
                          request_id="doctor")
        self.assert_tool_ok(proc.response(700))
        self.assert_tool_ok(proc.response("doctor"))
        self.assertTrue(_wait(started.exists, 10), proc.stderr_text())
        self.assert_tool_ok(proc.response("slow", 25))
        replies = [m["id"] for m in proc.messages if "method" not in m]
        self.assertLess(replies.index("doctor"), replies.index("slow"))
        proc.once([1, "slow", 700, "doctor"])

    def test_idle_stop_then_restart(self):
        # REQ-4, REQ-11, REQ-13; TEST-10 / V4.
        for modern in (False, True):
            with self.subTest(modern=modern):
                proc = self.front(env={**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": "2"})
                if modern:
                    self.assertIn("result", proc.request("server/discover", _envelope()))
                else:
                    proc.initialize()
                self.assert_tool_ok(proc.tool(modern=modern))
                old = self.child(proc)
                self.gone(proc, old, timeout=10)
                self.assertIsNone(proc.proc.poll())
                self.assert_tool_ok(proc.tool(modern=modern))
                self.assertNotEqual(old, self.child(proc))
                proc.close()

    def test_inflight_call_blocks_idle_stop(self):
        # REQ-4, REQ-15; TEST-11.
        proc = self.front(env={**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": "1"})
        proc.initialize()
        params, started = self.sleeper(6)
        request_id = proc.send_request("tools/call", params)
        self.assertTrue(_wait(started.exists, 20), proc.stderr_text())
        child = self.child(proc)
        time.sleep(3)  # No client traffic while the long request is in flight.
        self.assertTrue(_is_alive(child, proc.owned[child]), proc.stderr_text())
        result = self.assert_tool_ok(proc.response(request_id, 20))
        self.assertIn("sleeper-complete", json.dumps(result))
        self.assertEqual({child}, proc.children())

    def test_child_crash_errors_inflight_call(self):
        # REQ-5, REQ-7, REQ-8; TEST-12 / V6.
        proc = self.front()
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        params1, started1 = self.sleeper(15)
        params2, started2 = self.sleeper(15)
        for rid, params in (("victim-a", params1), (900, params2)):
            proc.send_request("tools/call", params, request_id=rid)
        self.assertTrue(_wait(lambda: started1.exists() and started2.exists(), 20))
        child = self.child(proc)
        proc.record_tree()
        proc.signal_owned(child, signal.SIGKILL)
        for rid in ("victim-a", 900):
            error = proc.response(rid, timeout=5)["error"]
            self.assertEqual(-32603, error["code"])
            self.assertIn("exited unexpectedly", error["message"])
        self.assert_tool_ok(proc.tool(request_id="retry"))
        self.assertNotEqual(child, self.child(proc))
        proc.once([1, 2, "victim-a", 900, "retry"])

    def test_cancelled_call_does_not_block_idle_or_get_crash_error(self):
        # REQ-4, REQ-5, REQ-15; TEST-13.
        proc, _ = self.stub()
        proc.send_request("qa/hold", {}, request_id="cancel-me")
        self.assertEqual("notifications/progress", proc.read()["method"])
        child = self.child(proc)
        proc.send({"jsonrpc": "2.0", "method": "notifications/cancelled",
                   "params": {"requestId": "cancel-me", "reason": "test complete"}})
        self.gone(proc, child, timeout=10)
        proc.drain()
        self.assertFalse(any(m.get("id") == "cancel-me" and "method" not in m
                             for m in proc.messages))

    def test_relay_preserves_notifications_and_server_requests(self):
        # REQ-3, REQ-7, REQ-15; TEST-14.
        proc, _ = self.stub(idle="600")
        proc.send_request("qa/relay", {}, request_id="relay")
        deadline = time.monotonic() + 5
        while not any(m.get("id") == "child-question" for m in proc.messages):
            remaining = deadline - time.monotonic()
            self.assertGreater(remaining, 0, "server-initiated request was not relayed")
            proc.read(remaining)
        self.assertIn({"jsonrpc": "2.0", "method": "notifications/progress",
                       "params": {"progressToken": "relay-token", "progress": 1, "total": 2}},
                      proc.messages)
        self.assertIn({"jsonrpc": "2.0", "method": "notifications/message",
                       "params": {"level": "info", "data": "child log"}}, proc.messages)
        proc.send({"jsonrpc": "2.0", "id": "child-question", "result": {"answer": "✓ 42"}})
        self.assertEqual({"answer": "✓ 42"}, proc.response("relay")["result"])
        payload = {"unicode": "通知"}
        proc.send({"jsonrpc": "2.0", "method": "qa/client-notification", "params": payload})
        self.assertEqual(payload, proc.read(5)["params"]["data"])
        proc.once([1, "relay"])

    def test_stdout_filters_non_json_and_passes_stderr(self):
        # REQ-7; TEST-15 / V8.
        proc, _ = self.stub(idle="600")
        self.assertEqual({"ok": True}, proc.request("qa/noisy", {})["result"])
        proc.drain()
        diagnostics = proc.stderr_text()
        self.assertIn("not-json-from-child", diagnostics)
        self.assertIn("child-stderr-marker", diagnostics)

    def test_idle_probe_fails_safe(self):
        # REQ-4, REQ-19; TEST-16.
        for mode in ("occupied", "probe-error", "tool-error", "changed"):
            with self.subTest(mode=mode):
                proc, directory = self.stub(mode)
                child = proc.request("qa/echo", {})["result"]["pid"]
                proc.record_tree()
                events = directory / f"events-{child}"
                self.assertTrue(_wait(lambda: events.exists() and "probe" in events.read_text(), 5))
                time.sleep(1.2)
                self.assertTrue(_is_alive(child, proc.owned[child]))
                self.assertEqual(child, proc.request("qa/echo", {})["result"]["pid"])
                proc.close()

    def held_probe(self):
        proc, directory = self.stub(idle="2", extra="mcp_front.PROBE_TIMEOUT_SECONDS = 5.0\n")
        (directory / "hold_probe").touch()
        child = proc.request("qa/echo", {})["result"]["pid"]
        proc.record_tree()
        events = directory / f"events-{child}"
        self.assertTrue(_wait(lambda: events.exists() and "probe" in events.read_text(), 5))
        return proc, directory, child

    def test_traffic_during_probe_abandons_stop(self):
        # REQ-4, REQ-16; TEST-17.
        proc, directory, child = self.held_probe()
        self.assertEqual(child, proc.request("qa/echo", {"traffic": True})["result"]["pid"])
        (directory / "hold_probe").unlink()
        proc.drain(0.25)
        self.assertTrue(_is_alive(child, proc.owned[child]))
        self.assertEqual(child, proc.request("qa/echo", {"again": True})["result"]["pid"])

    def test_request_during_stop_restarts_once(self):
        # REQ-4, REQ-16; TEST-18.
        proc, directory = self.stub("stubborn", extra="mcp_front.STOP_EOF_GRACE_SECONDS = 3.0\n")
        old = proc.request("qa/echo", {})["result"]["pid"]
        proc.record_tree()
        event_file = directory / f"events-{old}"
        self.assertTrue(_wait(lambda: event_file.exists() and "EOF" in event_file.read_text(), 5))
        self.assertTrue(_is_alive(old, proc.owned[old]))
        reply = proc.request("qa/echo", {"retry": True}, request_id="during-stop")
        self.assertNotEqual(old, reply["result"]["pid"])
        self.assertEqual({"retry": True}, reply["result"]["echo"])
        self.assertTrue(_is_alive(old, proc.owned[old]), "old child was not still stopping")
        proc.once([1, 2, "during-stop"])
        self.gone(proc, old, timeout=10)

    def test_idle_stop_survives_a_crash_during_the_probe(self):
        # REQ-4, REQ-5, REQ-16; TEST-19.
        proc, directory, old = self.held_probe()
        notes_before = len(proc.stderr_text().splitlines())
        proc.signal_owned(old, signal.SIGKILL)
        self.gone(proc, old, timeout=5)
        self.assertTrue(_wait(lambda: len(proc.stderr_text().splitlines()) > notes_before, 5))
        (directory / "hold_probe").unlink()
        reply = proc.request("qa/echo", {"generation": 2}, request_id="restart")
        new = reply["result"]["pid"]
        proc.record_tree()
        self.assertNotEqual(old, new)
        self.gone(proc, new, timeout=10)
        self.assertIsNone(proc.proc.poll())
        proc.once([1, 2, "restart"])

    def test_probe_timeout_swallows_late_reply(self):
        # REQ-4, REQ-7, REQ-16; TEST-20.
        proc, directory = self.stub(idle="1.5", extra="mcp_front.PROBE_TIMEOUT_SECONDS = 0.3\n")
        (directory / "hold_probe").touch()
        child = proc.request("qa/echo", {})["result"]["pid"]
        proc.record_tree()
        events = directory / f"events-{child}"
        self.assertTrue(_wait(lambda: events.exists() and "probe" in events.read_text(), 5))
        time.sleep(0.5)  # Beyond timeout, before the next probe cadence.
        self.assertTrue(_is_alive(child, proc.owned[child]), "uncertain probe stopped child")
        (directory / "hold_probe").unlink()
        proc.drain(0.2)
        self.assertTrue(_is_alive(child, proc.owned[child]), "late abandoned reply stopped child")
        self.gone(proc, child, timeout=10)
        proc.once([1, 2])

    def test_startup_failure_errors_all_pending_and_retries(self):
        # REQ-3, REQ-5, REQ-17; TEST-21.
        for filename in ("stall_start", "reject_start"):
            with self.subTest(failure=filename):
                proc, directory = self.stub(
                    idle="600", extra="mcp_front.START_TIMEOUT_SECONDS = 0.4\n"
                )
                marker = directory / filename
                marker.touch()
                for rid in ("start-a", 800):
                    proc.send_request("qa/echo", {"id": rid}, request_id=rid)
                for rid in ("start-a", 800):
                    error = proc.response(rid, 40)["error"]
                    self.assertEqual(-32603, error["code"])
                    self.assertIn("failed to start", error["message"])
                marker.unlink()
                self.assertEqual({"retry": True},
                                 proc.request("qa/echo", {"retry": True},
                                              request_id="recovered")["result"]["echo"])
                proc.once([1, "start-a", 800, "recovered"])
                proc.close()

    def test_broken_snapshot_forwards_without_partial_answers(self):
        # REQ-2, REQ-14; TEST-22.
        for value in (None, "{", '{"legacy":{"versions":["2025-11-25"]}}'):
            with self.subTest(snapshot=value):
                path = Path(self.env["HOME"]) / f"snapshot-{time.monotonic_ns()}.json"
                if value is not None:
                    path.write_text(value)
                patch = f"mcp_front.SNAPSHOT_PATH = __import__('pathlib').Path({str(path)!r})\n"
                proc, full = self.front(patch), self.direct()
                steps = [("initialize", _init_params("2025-11-25")),
                         ("notifications/initialized", None), ("tools/list", None)]
                self.assertEqual(_capture(full, steps), _capture(proc, steps))
                self.child(proc)
                notes = [line for line in proc.stderr_text().splitlines()
                         if line.startswith("browser-use front:")
                         and "starting the full server" not in line]
                self.assertEqual(1, len(notes), proc.stderr_text())
                proc.close()
                full.close()

    def test_removed_server_file_names_reconnect(self):
        # REQ-5, REQ-17; TEST-23.
        server = Path(self.env["HOME"]) / "disposable-server.py"
        server.write_text("")
        proc = self.front(patch="", server_path=server)
        proc.initialize()
        self.assertEqual(set(), proc.children())
        server.unlink()
        error = proc.tool()["error"]
        self.assertEqual(-32603, error["code"])
        self.assertIn("/mcp", error["message"])
        self.assertIn("reconnect", error["message"].lower())

    def test_malformed_client_line_does_not_break_next_request(self):
        # REQ-7, REQ-13; TEST-24.
        proc = self.front()
        proc.send_raw(b"{not-json}\n")
        self.assertEqual({}, proc.request("ping")["result"])
        proc.initialize()
        self.assert_tools(proc.request("tools/list"))
        proc.drain()
        self.assertTrue(proc.stderr_text().strip(), "malformed line had no stderr diagnostic")
        self.assertEqual(set(), proc.children())

    def test_static_answers_do_not_reset_idle_timer(self):
        # REQ-2, REQ-4, REQ-20; TEST-25.
        proc = self.front(env={**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": "1"})
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        child = self.child(proc)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and _is_alive(child, proc.owned[child]):
            self.assert_tools(proc.request("tools/list"))
            time.sleep(0.15)
        self.assertFalse(_is_alive(child, proc.owned[child]), proc.stderr_text())
        self.assertIsNone(proc.proc.poll())

    def test_invalid_idle_override_reports_and_uses_default(self):
        # REQ-11, REQ-20; TEST-26.
        for value in ("0", "-1", "not-a-number", "nan"):
            with self.subTest(value=value):
                proc, _ = self.stub(idle=value)
                child = proc.request("qa/echo", {})["result"]["pid"]
                proc.record_tree()
                time.sleep(1.2)
                self.assertTrue(_is_alive(child, proc.owned[child]))
                warnings = [line for line in proc.stderr_text().splitlines()
                            if line.startswith("browser-use front:")
                            and "starting the full server" not in line]
                self.assertEqual(1, len(warnings), proc.stderr_text())
                proc.close()

    def test_shutdown_triggers_leave_no_child(self):
        # REQ-6, REQ-8, REQ-18; TEST-27 / V7.
        for trigger in ("eof", signal.SIGTERM, signal.SIGINT,
                        getattr(signal, "SIGHUP", signal.SIGTERM)):
            with self.subTest(trigger=trigger):
                proc = self.front()
                proc.initialize()
                self.assert_tool_ok(proc.tool())
                child = self.child(proc)
                if trigger == "eof":
                    proc.proc.stdin.close()
                else:
                    proc.signal_owned(proc.pid, trigger)
                self.assertEqual(0, proc.proc.wait(timeout=20))
                self.gone(proc, child, timeout=5)
                proc.close()

    def test_stop_escalates_only_as_far_as_needed(self):
        # REQ-4, REQ-6, REQ-8, REQ-18; TEST-28.
        for mode in ("empty", "term", "stubborn"):
            with self.subTest(mode=mode):
                proc, directory = self.stub(mode, idle="600")
                child = proc.request("qa/echo", {})["result"]["pid"]
                proc.record_tree()
                proc.signal_owned(proc.pid, signal.SIGTERM)
                self.assertEqual(0, proc.proc.wait(timeout=10))
                self.gone(proc, child, timeout=1)
                events = (directory / f"events-{child}").read_text().splitlines()
                self.assertIn("EOF", events)
                if mode in ("term", "stubborn"):
                    self.assertIn("TERM", events)
                    self.assertLess(events.index("EOF"), events.index("TERM"))
                else:
                    self.assertNotIn("TERM", events)
                proc.close()

    def test_parent_death_stops_front_and_child(self):
        # REQ-6, REQ-18; TEST-29. Test-held stdin remains open.
        pid_file = Path(self.env["HOME"]) / "front-pid"
        proc = _Proc(self, _shim_argv(_front_argv(), pid_file), self.env)
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        front = int(pid_file.read_text())
        child = self.child(proc, front)
        proc.record_tree()
        proc.signal_owned(proc.pid, signal.SIGKILL)
        proc.proc.wait(timeout=5)
        self.gone(proc, front, child, timeout=15)
        self.assertFalse(proc.proc.stdin.closed, "EOF masked the parent-death check")

    def test_claude_killed_under_uv(self):
        # REQ-6, REQ-18; TEST-30. Only shim owns uv's client pipe ends.
        pid_file = Path(self.env["HOME"]) / "uv-pid"
        proc = _Proc(self, _shim_argv(_literal_argv(self), pid_file, proxy=True), self.env)
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        uv = int(pid_file.read_text())
        front = self.child(proc, uv)
        child = self.child(proc, front)
        proc.record_tree()
        proc.signal_owned(proc.pid, signal.SIGKILL)
        proc.proc.wait(timeout=5)
        self.gone(proc, uv, front, child, timeout=15)

    def test_uv_killed_alone(self):
        # REQ-6, REQ-18; TEST-31.
        proc = _Proc(self, _literal_argv(self), self.env)
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        front = self.child(proc)
        child = self.child(proc, front)
        proc.signal_owned(proc.pid, signal.SIGKILL)
        proc.proc.wait(timeout=5)
        self.gone(proc, front, child, timeout=15)
        self.assertFalse(proc.proc.stdin.closed)

    def test_claude_code_stop_sequence(self):
        # REQ-6, REQ-8, REQ-18; TEST-32. Only uv, never the group.
        proc = _Proc(self, _literal_argv(self), self.env)
        proc.initialize()
        self.assert_tool_ok(proc.tool())
        front = self.child(proc)
        child = self.child(proc, front)
        for delay, signum in ((0, signal.SIGINT), (0.1, signal.SIGTERM), (0.4, signal.SIGKILL)):
            if delay:
                time.sleep(delay)
            proc.signal_owned(proc.pid, signum)
        proc.proc.wait(timeout=5)
        self.gone(proc, front, child, timeout=20)

    def test_shutdown_never_signals_an_unrelated_process(self):
        # REQ-4, REQ-6, REQ-8; TEST-33. Every PID is started by this test.
        sentinel = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(120)"],
            env=self.env, cwd=self.env["HOME"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        def stop_sentinel():
            if sentinel.poll() is None:
                sentinel.terminate()
                try:
                    sentinel.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    sentinel.kill()
                    sentinel.wait(timeout=3)
        self.addCleanup(stop_sentinel)
        other = self.front(env={**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": "600"})
        other.initialize()
        self.assert_tool_ok(other.tool())
        other_child = self.child(other)
        victim = self.front(env={**self.env, "BROWSER_USE_IDLE_STOP_SECONDS": "1"})
        victim.initialize()
        self.assert_tool_ok(victim.tool())
        victim_child = self.child(victim)
        self.gone(victim, victim_child, timeout=10)
        victim.signal_owned(victim.pid, signal.SIGTERM)
        victim.proc.wait(timeout=20)
        self.assertIsNone(sentinel.poll(), "unrelated process was signalled")
        self.assertIsNone(other.proc.poll())
        self.assertTrue(_is_alive(other_child, other.owned[other_child]))
        self.assert_tool_ok(other.tool())


if __name__ == "__main__":
    unittest.main(verbosity=2)
