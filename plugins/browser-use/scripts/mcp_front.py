"""
The lazy front of the browser-use MCP server. Standard library only.

`mcp-server.py --lazy` hands its process to `main()` before importing anything
heavy. The front speaks MCP over stdio to the client and answers what it can
prove equal to the full server's answer by itself, from mcp_front_snapshot.json:
`initialize`, `notifications/initialized`, `ping`, `tools/list` and the modern
era's `server/discover`. Any other request starts the full server
(`mcp-server.py` with no flag) as this process's child, and from then on the
front relays JSON-RPC both ways, ids untouched.

The child is stopped again once it has been idle for IDLE_STOP_SECONDS and holds
no browser session; the next request starts a new one. Every child is stopped on
the front's own shutdown: stdin EOF, SIGTERM, SIGINT, SIGHUP, a broken client
pipe, or the death of the front's parent.

Rules this module keeps:
  - stdout carries only JSON-RPC. fd 1 is pointed at stderr at start, and the
    one real channel is a private dup written only by Front.write_client.
  - The only processes it signals are children it started, through their Popen.
  - All mutable state belongs to the coordinator (the main thread). Other
    threads only read pipes and post events, or own one child's Popen.
"""

from __future__ import annotations

import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

IDLE_STOP_SECONDS = 600.0
IDLE_STOP_ENV = "BROWSER_USE_IDLE_STOP_SECONDS"
TICK_SECONDS = 1.0
START_TIMEOUT_SECONDS = 60.0
STOP_EOF_GRACE_SECONDS = 10.0
STOP_TERM_GRACE_SECONDS = 5.0
PROBE_TIMEOUT_SECONDS = 30.0
PROBE_INTERVAL_SECONDS = 60.0
SELF_TEST_TIMEOUT_SECONDS = 30.0
KEEPER_POLL_SECONDS = 0.5
READER_DRAIN_SECONDS = 2.0
NO_SESSIONS_TEXT = "No active browser sessions"
SNAPSHOT_PATH = Path(__file__).with_name("mcp_front_snapshot.json")
PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities"
CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo"

LOG_PREFIX = "browser-use front: "
INTERNAL_ERROR = -32603
CRASH_MESSAGE = (
    "The browser-use MCP server exited unexpectedly (exit code {rc}) while handling this request. "
    "Any browser sessions it held are closed. Retry the call; it starts a new server."
)
START_FAILED_MESSAGE = "The browser-use MCP server failed to start: {reason}"
VANISHED_REASON = (
    "The browser-use plugin was updated or its Python environment was removed while this session "
    "was running. Reconnect the browser-use MCP server (/mcp) or start a new session."
)

_TRANSITIONS = {"absent": {"starting"}, "starting": {"ready", "absent"}, "ready": {"absent"}}


def log(message: str) -> None:
    """One diagnostic line on stderr, which Claude Code keeps in its MCP log."""
    try:
        sys.stderr.write(LOG_PREFIX + message + "\n")
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def _dumps(obj: object) -> bytes:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"


def _id_key(request_id: object) -> str:
    return json.dumps(request_id, sort_keys=True)


def _has_envelope_key(params: object) -> bool:
    """Whether `params._meta` carries the modern protocol-version key, the server's era signal."""
    if not isinstance(params, dict):
        return False
    meta = params.get("_meta")
    return isinstance(meta, dict) and PROTOCOL_VERSION_KEY in meta


def _acceptable_initialize_params(params: object) -> bool:
    if not isinstance(params, dict):
        return False
    client_info = params.get("clientInfo")
    return (
        isinstance(params.get("protocolVersion"), str)
        and isinstance(params.get("capabilities"), dict)
        and isinstance(client_info, dict)
        and isinstance(client_info.get("name"), str)
        and isinstance(client_info.get("version"), str)
    )


def _acceptable_list_params(params: object, era: str) -> bool:
    if params is None:
        return True
    if not isinstance(params, dict) or not set(params) <= {"cursor", "_meta"}:
        return False
    if "cursor" in params and not isinstance(params["cursor"], str):
        return False
    if "_meta" in params and not isinstance(params["_meta"], dict):
        return False
    if era == "legacy" and _has_envelope_key(params):
        return False
    return True


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


class Snapshot:
    """The full server's static answers, as captured by write_front_snapshot.py."""

    def __init__(self, data: dict) -> None:
        legacy = data["legacy"]
        modern = data["modern"]
        self.legacy_versions = _str_list(legacy["versions"])
        self.legacy_fallback = legacy["fallbackVersion"]
        self.legacy_initialize = _dict(legacy["initialize"])
        self.legacy_tools_list = _tools_result(legacy["toolsList"])
        self.legacy_not_initialized = _error_obj(legacy["notInitializedError"])
        self.modern_versions = _str_list(modern["versions"])
        self.modern_discover = _dict(modern["discover"])
        self.modern_tools_list = _tools_result(modern["toolsList"])
        self.modern_initialize_refused = _error_obj(modern["initializeRefused"])
        self.modern_ping_error = _error_obj(modern["pingError"])
        if not isinstance(self.legacy_fallback, str) or self.legacy_fallback not in self.legacy_versions:
            raise ValueError("legacy.fallbackVersion is not one of legacy.versions")

    @classmethod
    def load(cls, path: Path) -> Snapshot | None:
        """The snapshot at `path`, or None (with one stderr line) when it is missing or invalid."""
        try:
            with open(path, encoding="utf-8") as fh:
                return cls(json.load(fh))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            log(f"no usable snapshot at {path} ({exc}); every request starts the full server")
            return None


def _dict(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("expected an object")
    return value


def _str_list(value: object) -> list:
    if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
        raise ValueError("expected a non-empty list of strings")
    return value


def _tools_result(value: object) -> dict:
    result = _dict(value)
    if not isinstance(result.get("tools"), list) or not result["tools"]:
        raise ValueError("a tools/list result has no tools")
    return result


def _error_obj(value: object) -> dict:
    error = _dict(value)
    if not isinstance(error.get("code"), int) or not isinstance(error.get("message"), str):
        raise ValueError("an error object needs an int code and a str message")
    return error


# ---------------------------------------------------------------------------
# Child: one spawned full server
# ---------------------------------------------------------------------------


class Child:
    """
    One full-server process and its three threads.

    The reader posts every stdout line to the coordinator. The writer is the
    only writer of its stdin. The keeper is the only user of the Popen after
    spawn: it reaps, and it runs the stop sequence, so no signal can race a reap.
    """

    def __init__(self, gen: int, argv: list[str], events: queue.SimpleQueue) -> None:
        self.gen = gen
        self.events = events
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            bufsize=0,
            close_fds=True,
        )
        self.pid = self.proc.pid
        self.started_at = time.monotonic()
        self.writer_queue: queue.SimpleQueue = queue.SimpleQueue()
        self.keeper_queue: queue.SimpleQueue = queue.SimpleQueue()
        # Idle-stop probe state belongs to one child, so a new child starts clean.
        self.probe_id: str | None = None
        self.probe_sent_at: float | None = None
        self.probe_traffic_mark: float | None = None
        self.next_probe_at = 0.0
        self.reader_thread = threading.Thread(target=self._read, name=f"child-reader-{gen}", daemon=True)
        self.writer_thread = threading.Thread(target=self._write, name=f"child-writer-{gen}", daemon=True)
        self.keeper_thread = threading.Thread(target=self._keep, name=f"child-keeper-{gen}", daemon=True)
        self.reader_thread.start()
        self.writer_thread.start()
        self.keeper_thread.start()

    # -- threads ------------------------------------------------------------

    def _read(self) -> None:
        fd = self.proc.stdout.fileno()
        buffer = bytearray()
        try:
            while True:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                start = len(buffer)
                buffer += chunk
                newline = buffer.find(b"\n", start)
                while newline != -1:
                    self.events.put(("child", self.gen, bytes(buffer[:newline])))
                    del buffer[: newline + 1]
                    newline = buffer.find(b"\n")
            if buffer.strip():
                self.events.put(("child", self.gen, bytes(buffer)))
        finally:
            self.keeper_queue.put("eof")

    def _write(self) -> None:
        stdin = self.proc.stdin
        fd = stdin.fileno()
        while True:
            data = self.writer_queue.get()
            if data is None:
                break
            view = memoryview(data)
            try:
                while view:
                    written = os.write(fd, view)
                    view = view[written:]
            except OSError:
                break
        try:
            stdin.close()
        except OSError:
            pass

    def _keep(self) -> None:
        stopping = False
        while True:
            try:
                command = self.keeper_queue.get(timeout=KEEPER_POLL_SECONDS)
            except queue.Empty:
                if self.proc.poll() is None:
                    continue
                command = "exited"
            if command == "stop":
                stopping = True
            break
        if stopping:
            self.stop_sequence()
        else:
            self._reap_after_exit()
        self.reader_thread.join(READER_DRAIN_SECONDS)
        self.events.put(("child_exit", self.gen, self.proc.returncode))

    # -- the stop sequence, run only on the keeper thread ---------------------

    def close_stdin(self) -> None:
        self.writer_queue.put(None)

    def terminate(self) -> None:
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)

    def kill(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()

    def _wait(self, seconds: float) -> bool:
        try:
            self.proc.wait(timeout=seconds)
            return True
        except subprocess.TimeoutExpired:
            return False

    def stop_sequence(self) -> None:
        """Close stdin (the server's own EOF path stops its browsers), then SIGTERM, then SIGKILL."""
        self.close_stdin()
        if self._wait(STOP_EOF_GRACE_SECONDS):
            return
        self._escalate()

    def _reap_after_exit(self) -> None:
        """The child closed its stdout or exited by itself: give it the EOF grace, then escalate."""
        self.close_stdin()
        if self._wait(STOP_EOF_GRACE_SECONDS):
            return
        self._escalate()

    def _escalate(self) -> None:
        self.terminate()
        if self._wait(STOP_TERM_GRACE_SECONDS):
            return
        self.kill()
        self.proc.wait()


class InFlight:
    """A client request that was forwarded or queued and is not answered yet."""

    __slots__ = ("gen", "method", "params", "request_id")

    def __init__(self, gen: int, method: str, params: object, request_id: object) -> None:
        self.gen = gen
        self.method = method
        self.params = params
        self.request_id = request_id


# ---------------------------------------------------------------------------
# Front: the coordinator
# ---------------------------------------------------------------------------


class Front:
    def __init__(self, server_path: str, out_fd: int, snapshot: Snapshot | None) -> None:
        self.server_path = server_path
        self.out_fd = out_fd
        self.snapshot = snapshot
        self.events: queue.SimpleQueue = queue.SimpleQueue()
        self.idle_seconds = _idle_seconds_from_env()
        self.parent_pid = os.getppid()
        self.token = os.urandom(8).hex()
        self.internal_prefix = f"browser-use-front:{self.token}:"
        self.internal_counter = 0
        self.internal: dict[str, str] = {}

        self.era: str | None = None
        self.legacy_init_params: dict | None = None
        self.legacy_initialized_seen = False
        self.legacy_gate_open = False
        self.modern_envelope: dict | None = None
        self.modern_opening_meta: dict | None = None

        self.child: Child | None = None
        self.state = "absent"
        self.gen = 0
        self.stopping: dict[int, Child] = {}
        self.pending: list[tuple[str | None, bytes]] = []
        self.inflight: dict[str, InFlight] = {}
        self.child_request_ids: set[str] = set()
        self.last_traffic = time.monotonic()
        self.shutting_down = False
        self.client_gone = False

    # -- entry --------------------------------------------------------------

    def child_argv(self) -> list[str]:
        return [sys.executable, self.server_path]

    def run(self) -> int:
        self._install_signal_handlers()
        threading.Thread(target=self._read_client, name="stdin-reader", daemon=True).start()
        while not self.shutting_down:
            try:
                event = self.events.get(timeout=TICK_SECONDS)
            except queue.Empty:
                event = None
            if event is not None:
                self._dispatch(event)
            if not self.shutting_down:
                self.tick()
        return self._finish_shutdown()

    def _install_signal_handlers(self) -> None:
        def post(signum, _frame):
            self.events.put(("signal", signum))

        for name in ("SIGTERM", "SIGINT", "SIGHUP"):
            signum = getattr(signal, name, None)
            if signum is not None:
                signal.signal(signum, post)

    def _read_client(self) -> None:
        buffer = bytearray()
        while True:
            try:
                chunk = os.read(0, 65536)
            except InterruptedError:
                continue
            except OSError:
                break
            if not chunk:
                break
            start = len(buffer)
            buffer += chunk
            newline = buffer.find(b"\n", start)
            while newline != -1:
                self.events.put(("client", bytes(buffer[:newline])))
                del buffer[: newline + 1]
                newline = buffer.find(b"\n")
        if buffer.strip():
            self.events.put(("client", bytes(buffer)))
        self.events.put(("client_eof",))

    def _dispatch(self, event: tuple) -> None:
        kind = event[0]
        if kind == "client":
            self.handle_client_line(event[1])
        elif kind == "child":
            self.handle_child_line(event[1], event[2])
        elif kind == "child_exit":
            self.handle_child_exit(event[1], event[2])
        elif kind == "start_diagnosis":
            self._fail_inflight(event[1], START_FAILED_MESSAGE.format(reason=event[2]))
        elif kind == "client_eof":
            self.begin_shutdown("stdin closed")
        elif kind == "signal":
            self.begin_shutdown(f"signal {event[1]}")

    # -- output to the client -----------------------------------------------

    def write_client(self, data: bytes) -> None:
        if self.client_gone:
            return
        view = memoryview(data)
        try:
            while view:
                written = os.write(self.out_fd, view)
                view = view[written:]
        except OSError:
            self.client_gone = True
            self.begin_shutdown("the client's stdout is closed")

    def _reply(self, request_id: object, result: object) -> None:
        self.write_client(_dumps({"jsonrpc": "2.0", "id": request_id, "result": result}))

    def _reply_error(self, request_id: object, error: dict) -> None:
        self.write_client(_dumps({"jsonrpc": "2.0", "id": request_id, "error": error}))

    # -- client → front -------------------------------------------------------

    def handle_client_line(self, raw: bytes) -> None:
        line = raw.rstrip(b"\r")
        if not line.strip():
            return
        try:
            msg = json.loads(line)
        except ValueError:
            log("dropped a client line that is not JSON")
            return
        if not isinstance(msg, dict):
            log("dropped a client line that is not a JSON-RPC object")
            return
        line = bytes(line) + b"\n"
        method = msg.get("method")
        if isinstance(method, str) and "id" in msg:
            self._handle_client_request(msg, method, line)
        elif isinstance(method, str):
            self._handle_client_notification(msg, method, line)
        elif "id" in msg:
            self._handle_client_response(msg, line)
        else:
            log("dropped a client message that is neither a request, a notification nor a response")

    def _handle_client_request(self, msg: dict, method: str, line: bytes) -> None:
        params = msg.get("params")
        if self.era is None:
            self.era = "modern" if method != "initialize" and _has_envelope_key(params) else "legacy"
            if self.era == "modern":
                self.modern_opening_meta = params["_meta"]
        if self.era == "modern" and method != "initialize":
            self._remember_envelope(params)
        if self._answer_static(msg):
            return
        self._forward_request(msg, method, params, line)

    def _remember_envelope(self, params: object) -> None:
        if not isinstance(params, dict):
            return
        meta = params.get("_meta")
        if self._valid_envelope(meta):
            self.modern_envelope = meta

    def _valid_envelope(self, meta: object) -> bool:
        if not isinstance(meta, dict):
            return False
        version = meta.get(PROTOCOL_VERSION_KEY)
        if self.snapshot is not None:
            if version not in self.snapshot.modern_versions:
                return False
        elif not isinstance(version, str):
            return False
        if not isinstance(meta.get(CLIENT_CAPABILITIES_KEY), dict):
            return False
        return CLIENT_INFO_KEY not in meta or isinstance(meta[CLIENT_INFO_KEY], dict)

    def _child_live(self) -> bool:
        return self.state in ("starting", "ready")

    def _answer_static(self, msg: dict) -> bool:
        """Answer `msg` from the snapshot when the answer is provably the full server's. True if answered."""
        snap = self.snapshot
        if snap is None:
            return False
        method = msg["method"]
        params = msg.get("params")
        request_id = msg["id"]
        if self.era == "legacy":
            if method == "initialize":
                if self._child_live() or not _acceptable_initialize_params(params):
                    return False
                requested = params["protocolVersion"]
                result = dict(snap.legacy_initialize)
                result["protocolVersion"] = (
                    requested if requested in snap.legacy_versions else snap.legacy_fallback
                )
                self.legacy_init_params = params
                self.legacy_gate_open = True
                self._reply(request_id, result)
                return True
            if method == "ping" and not _has_envelope_key(params):
                self._reply(request_id, {})
                return True
            if method == "tools/list" and _acceptable_list_params(params, "legacy"):
                if self.legacy_gate_open:
                    self._reply(request_id, snap.legacy_tools_list)
                    return True
                if self._child_live():
                    return False
                self._reply_error(request_id, snap.legacy_not_initialized)
                return True
            return False

        if method == "initialize":
            error = dict(snap.modern_initialize_refused)
            requested = params.get("protocolVersion") if isinstance(params, dict) else None
            if isinstance(requested, str):
                error["data"] = {"supported": list(snap.modern_versions), "requested": requested}
            else:
                error["data"] = {"supported": list(snap.modern_versions)}
            self._reply_error(request_id, error)
            return True
        meta = params.get("_meta") if isinstance(params, dict) else None
        if not self._valid_envelope(meta):
            return False
        if method == "server/discover":
            self._reply(request_id, snap.modern_discover)
            return True
        if method == "tools/list" and _acceptable_list_params(params, "modern"):
            self._reply(request_id, snap.modern_tools_list)
            return True
        if method == "ping":
            self._reply_error(request_id, snap.modern_ping_error)
            return True
        return False

    def _forward_request(self, msg: dict, method: str, params: object, line: bytes) -> None:
        key = _id_key(msg["id"])
        self.last_traffic = time.monotonic()
        if self.state == "absent":
            # Registered under the generation about to start, so a failed start answers it.
            self.inflight[key] = InFlight(self.gen + 1, method, params, msg["id"])
            self._start_child(msg)
        else:
            self.inflight[key] = InFlight(self.gen, method, params, msg["id"])
        if self.state == "starting":
            self.pending.append((key, line))
        elif self.state == "ready":
            self.child.writer_queue.put(line)

    def _handle_client_notification(self, msg: dict, method: str, line: bytes) -> None:
        if method == "notifications/initialized" and self.era != "modern":
            self.legacy_gate_open = True
            self.legacy_initialized_seen = True
        if method == "notifications/cancelled":
            self._handle_cancel(msg, line)
            return
        if self.state == "starting":
            self.pending.append((None, line))
            self.last_traffic = time.monotonic()
        elif self.state == "ready":
            self.child.writer_queue.put(line)
            self.last_traffic = time.monotonic()

    def _handle_cancel(self, msg: dict, line: bytes) -> None:
        params = msg.get("params")
        if not isinstance(params, dict) or "requestId" not in params:
            return
        key = _id_key(params["requestId"])
        if key not in self.inflight:
            return
        queued = [i for i, (k, _) in enumerate(self.pending) if k == key]
        if queued:
            for index in reversed(queued):
                del self.pending[index]
        elif self.state == "ready":
            self.child.writer_queue.put(line)
        del self.inflight[key]
        self.last_traffic = time.monotonic()

    def _handle_client_response(self, msg: dict, line: bytes) -> None:
        key = _id_key(msg["id"])
        if self.state == "ready" and key in self.child_request_ids:
            self.child_request_ids.discard(key)
            self.child.writer_queue.put(line)
            self.last_traffic = time.monotonic()
            return
        log("dropped a client response to a request no live server is waiting on")

    # -- child start ----------------------------------------------------------

    def _enter(self, state: str) -> None:
        if state not in _TRANSITIONS[self.state]:
            raise RuntimeError(f"illegal transition {self.state} -> {state}")
        self.state = state

    def _next_internal_id(self, purpose: str) -> str:
        self.internal_counter += 1
        internal_id = f"{self.internal_prefix}{self.internal_counter}"
        self.internal[internal_id] = purpose
        return internal_id

    def _default_envelope(self) -> dict | None:
        if self.modern_envelope is not None:
            return self.modern_envelope
        if self.snapshot is not None:
            return {
                PROTOCOL_VERSION_KEY: self.snapshot.modern_versions[-1],
                CLIENT_CAPABILITIES_KEY: {},
            }
        return self.modern_opening_meta

    def _start_child(self, trigger: dict) -> None:
        self.gen += 1
        self._enter("starting")
        self.pending = []
        if not self._server_files_exist():
            self._start_failed(VANISHED_REASON, None)
            return
        try:
            child = Child(self.gen, self.child_argv(), self.events)
        except OSError as exc:
            self._start_failed(f"could not run {sys.executable}: {exc}", None)
            return
        self.child = child
        log(f"starting the full server (pid {child.pid}) for {trigger.get('method')}")

        method = trigger.get("method")
        params = trigger.get("params")
        if self.era == "legacy":
            if method == "initialize":
                self._child_ready()
            elif self.legacy_init_params is not None:
                opening_id = self._next_internal_id("opening_initialize")
                replay = {
                    "jsonrpc": "2.0",
                    "id": opening_id,
                    "method": "initialize",
                    "params": self.legacy_init_params,
                }
                child.writer_queue.put(_dumps(replay))
            else:
                if self.legacy_gate_open:
                    child.writer_queue.put(_dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}))
                # A bare ping locks the child into the legacy era, uninitialized, as the client is.
                # Without it an enveloped trigger would open the child in the modern era.
                lock_id = self._next_internal_id("legacy_lock")
                child.writer_queue.put(_dumps({"jsonrpc": "2.0", "id": lock_id, "method": "ping"}))
                self._child_ready()
        else:
            if method != "initialize" and _has_envelope_key(params):
                self._child_ready()
            else:
                opening_id = self._next_internal_id("opening_discover")
                envelope = self._default_envelope()
                discover: dict = {"jsonrpc": "2.0", "id": opening_id, "method": "server/discover"}
                if envelope is not None:
                    discover["params"] = {"_meta": envelope}
                child.writer_queue.put(_dumps(discover))

    def _server_files_exist(self) -> bool:
        return os.path.exists(self.server_path) and os.path.exists(sys.executable)

    def _child_ready(self) -> None:
        self._enter("ready")
        self.last_traffic = time.monotonic()
        self._flush_pending()

    def _flush_pending(self) -> None:
        pending, self.pending = self.pending, []
        for _, line in pending:
            self.child.writer_queue.put(line)

    def _start_failed(self, reason: str | None, rc: int | None) -> None:
        """Answer this generation's requests with the reason the start failed, and go back to absent."""
        gen = self.gen
        child = self.child
        self.pending = []
        self.child = None
        self._abandon_internal()
        self.state = "absent"
        if child is not None:
            self.stopping[child.gen] = child
            child.keeper_queue.put("stop")
        if reason is not None:
            self._fail_inflight(gen, START_FAILED_MESSAGE.format(reason=reason))
            log(f"the full server failed to start: {reason}")
            return
        threading.Thread(
            target=self._diagnose_start, args=(gen, rc), name=f"start-diagnosis-{gen}", daemon=True
        ).start()

    def _diagnose_start(self, gen: int, rc: int | None) -> None:
        """Find the reason a start failed, off the coordinator, and post it."""
        if not self._server_files_exist():
            reason = VANISHED_REASON
        else:
            reason = self._self_test_reason() or (
                f"it exited with code {rc}" if rc is not None
                else f"it did not answer within {START_TIMEOUT_SECONDS:.0f} s"
            )
        log(f"the full server failed to start: {reason}")
        self.events.put(("start_diagnosis", gen, reason))

    def _self_test_reason(self) -> str | None:
        """The FAIL line of a one-off `mcp-server.py --test` run, or None when it passes."""
        try:
            completed = subprocess.run(
                [sys.executable, self.server_path, "--test"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=SELF_TEST_TIMEOUT_SECONDS,
                close_fds=True,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if completed.returncode == 0:
            return None
        lines = completed.stderr.decode(errors="replace").strip().splitlines()
        for text in reversed(lines):
            if "FAIL" in text or "ERROR" in text:
                return text.strip()
        return lines[-1].strip() if lines else None

    def _fail_inflight(self, gen: int, message: str) -> None:
        for key, entry in list(self.inflight.items()):
            if entry.gen != gen:
                continue
            del self.inflight[key]
            self._reply_error(entry.request_id, {"code": INTERNAL_ERROR, "message": message})

    def _abandon_internal(self) -> None:
        self.internal.clear()

    # -- child → client -------------------------------------------------------

    def handle_child_line(self, gen: int, raw: bytes) -> None:
        if self.child is None or gen != self.child.gen:
            return
        line = raw.rstrip(b"\r")
        if not line.strip():
            return
        try:
            msg = json.loads(line)
        except ValueError:
            log("the full server wrote a non-JSON line to stdout: " + line[:200].decode(errors="replace"))
            return
        if not isinstance(msg, dict):
            log("the full server wrote a non-object JSON line to stdout")
            return
        out = bytes(line) + b"\n"
        method = msg.get("method")
        if isinstance(method, str):
            if "id" in msg:
                self.child_request_ids.add(_id_key(msg["id"]))
            self.last_traffic = time.monotonic()
            self.write_client(out)
            return
        response_id = msg.get("id")
        if isinstance(response_id, str) and response_id.startswith(self.internal_prefix):
            purpose = self.internal.pop(response_id, None)
            if purpose is not None:
                self._handle_internal_reply(purpose, response_id, msg)
            return
        key = _id_key(response_id)
        entry = self.inflight.pop(key, None)
        if entry is not None and entry.method == "initialize" and "result" in msg:
            if isinstance(entry.params, dict):
                self.legacy_init_params = entry.params
            self.legacy_gate_open = True
        self.last_traffic = time.monotonic()
        self.write_client(out)

    def _handle_internal_reply(self, purpose: str, internal_id: str, msg: dict) -> None:
        if purpose == "opening_initialize" and self.state == "starting":
            if "error" in msg:
                error = msg["error"] if isinstance(msg["error"], dict) else {}
                self._start_failed(f"it refused the session's initialize: {error.get('message')}", None)
                return
            if self.legacy_initialized_seen:
                self.child.writer_queue.put(_dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            self._child_ready()
        elif purpose == "opening_discover" and self.state == "starting":
            self._child_ready()
        elif purpose == "idle_probe" and self.child is not None and self.child.probe_id == internal_id:
            self._handle_probe_reply(msg)

    # -- idle stop ------------------------------------------------------------

    def _idle_check(self) -> None:
        child = self.child
        if self.state != "ready" or child is None:
            return
        now = time.monotonic()
        if child.probe_sent_at is not None:
            if now - child.probe_sent_at >= PROBE_TIMEOUT_SECONDS:
                self.internal.pop(child.probe_id, None)
                child.probe_id = None
                child.probe_sent_at = None
                child.next_probe_at = now + min(PROBE_INTERVAL_SECONDS, self.idle_seconds)
            return
        if self.inflight or now - self.last_traffic < self.idle_seconds or now < child.next_probe_at:
            return
        self._send_probe()

    def _send_probe(self) -> None:
        child = self.child
        probe_id = self._next_internal_id("idle_probe")
        params: dict = {"name": "browser_list_sessions", "arguments": {}}
        if self.era == "modern":
            envelope = self._default_envelope()
            if envelope is not None:
                params["_meta"] = envelope
        child.probe_id = probe_id
        child.probe_sent_at = time.monotonic()
        child.probe_traffic_mark = self.last_traffic
        child.writer_queue.put(_dumps({"jsonrpc": "2.0", "id": probe_id, "method": "tools/call", "params": params}))

    def _probe_says_empty(self, reply: dict) -> bool:
        """True only for the full server's exact "no sessions" answer. Anything else keeps the child."""
        if "error" in reply:
            return False
        result = reply.get("result")
        if not isinstance(result, dict) or result.get("isError"):
            return False
        content = result.get("content")
        if not isinstance(content, list) or not content or not isinstance(content[0], dict):
            return False
        return content[0].get("text") == NO_SESSIONS_TEXT

    def _handle_probe_reply(self, reply: dict) -> None:
        child = self.child
        mark = child.probe_traffic_mark
        child.probe_id = None
        child.probe_sent_at = None
        child.probe_traffic_mark = None
        if self._probe_says_empty(reply) and not self.inflight and self.last_traffic == mark:
            self._detach(child)
            log(f"stopped the idle full server (pid {child.pid})")
            return
        child.next_probe_at = time.monotonic() + min(PROBE_INTERVAL_SECONDS, self.idle_seconds)

    def _detach(self, child: Child) -> None:
        self.stopping[child.gen] = child
        child.keeper_queue.put("stop")
        self.child = None
        self.child_request_ids.clear()
        self._abandon_internal()
        self._enter("absent")

    # -- child exit -----------------------------------------------------------

    def handle_child_exit(self, gen: int, rc: int | None) -> None:
        if self.stopping.pop(gen, None) is not None:
            return
        if self.child is None or gen != self.child.gen:
            return
        if self.state == "starting":
            # Already reaped by its keeper: nothing left to stop.
            self.child = None
            self._start_failed(None, rc)
            return
        log(f"the full server (pid {self.child.pid}) exited unexpectedly with code {rc}")
        self.child = None
        self.child_request_ids.clear()
        self._abandon_internal()
        self._enter("absent")
        self._fail_inflight(gen, CRASH_MESSAGE.format(rc=rc))

    # -- ticks ----------------------------------------------------------------

    def tick(self) -> None:
        if not self._parent_alive():
            self.begin_shutdown("the parent process is gone")
            return
        if self.state == "starting" and self.child is not None:
            if time.monotonic() - self.child.started_at >= START_TIMEOUT_SECONDS:
                self._start_failed(None, None)
                return
        self._idle_check()

    def _parent_alive(self) -> bool:
        return os.getppid() == self.parent_pid

    # -- shutdown -------------------------------------------------------------

    def begin_shutdown(self, why: str) -> None:
        if self.shutting_down:
            return
        self.shutting_down = True
        child = self.child
        if child is not None:
            log(f"stopping the full server (pid {child.pid}): {why}")
            # Close the child's stdin now, so it sees EOF even if this process is killed next.
            child.close_stdin()
            child.writer_thread.join(0.2)
            self.stopping[child.gen] = child
            child.keeper_queue.put("stop")
            self.child = None

    def _finish_shutdown(self) -> int:
        for child in list(self.stopping.values()):
            child.keeper_thread.join()
        return 0


def _idle_seconds_from_env() -> float:
    raw = os.environ.get(IDLE_STOP_ENV)
    if raw is None:
        return IDLE_STOP_SECONDS
    try:
        value = float(raw)
    except ValueError:
        value = 0.0
    if value > 0 and value == value and value != float("inf"):
        return value
    log(f"ignored {IDLE_STOP_ENV}={raw!r}: it must be a positive number of seconds; using {IDLE_STOP_SECONDS:.0f}")
    return IDLE_STOP_SECONDS


def main(server_path: str) -> int:
    """Serve MCP over stdio as the lazy front of the full server at `server_path`."""
    out_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    snapshot = Snapshot.load(SNAPSHOT_PATH)
    return Front(server_path, out_fd, snapshot).run()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: mcp_front.py /path/to/mcp-server.py  (normally run as mcp-server.py --lazy)", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(server_path=os.path.abspath(sys.argv[1])))
