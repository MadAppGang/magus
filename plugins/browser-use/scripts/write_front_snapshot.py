#!/usr/bin/env python3
"""
Generate mcp_front_snapshot.json: the full server's static answers, captured live.

The lazy front (mcp_front.py) answers `initialize`, `server/discover`, `ping` and
`tools/list` without starting the full server. It cannot import `mcp` to build
those answers, so it reads them from mcp_front_snapshot.json, which this script
writes by starting the full server (`mcp-server.py`, no flag) and recording what
it says on the wire, once per protocol version it serves.

Run it with an interpreter that has the pinned dependencies (the env of
mcp-server.py's PEP 723 header) after any change to a tool, the `mcp` pin or the
`browser-use` pin:

    python3 plugins/browser-use/scripts/write_front_snapshot.py           # rewrite the file
    python3 plugins/browser-use/scripts/write_front_snapshot.py --check   # exit 1 if it is stale

`capture_snapshot()` is importable, so a test can compare the committed file
with a fresh capture.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
SERVER_PATH = SCRIPTS_DIR / "mcp-server.py"
SNAPSHOT_PATH = SCRIPTS_DIR / "mcp_front_snapshot.json"
GENERATED_BY = "python3 plugins/browser-use/scripts/write_front_snapshot.py"

PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities"
CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo"

# A version no server serves, used to capture the legacy fallback and the
# modern refusal's shape.
UNSERVED_VERSION = "1999-01-01"
READ_TIMEOUT_SECONDS = 60.0
CLIENT_INFO = {"name": "write-front-snapshot", "version": "1.0.0"}


class SnapshotError(Exception):
    """The live server's answers cannot be recorded in the snapshot's format."""


class _WireSession:
    """One full-server process spoken to as a newline-delimited JSON-RPC client."""

    def __init__(self, argv: list[str], env: dict[str, str] | None = None) -> None:
        self._stderr = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr,
            env=env,
            bufsize=0,
        )
        self._lines: queue.SimpleQueue[bytes | None] = queue.SimpleQueue()
        self._next_id = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def _send(self, message: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message).encode() + b"\n")
        self.proc.stdin.flush()

    def notify(self, method: str, params: dict | None = None) -> None:
        message: dict = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._send(message)

    def request(self, method: str, params: dict | None = None) -> dict:
        """Send one request and return its response, skipping notifications."""
        self._next_id += 1
        request_id = self._next_id
        message: dict = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self._send(message)
        while True:
            try:
                line = self._lines.get(timeout=READ_TIMEOUT_SECONDS)
            except queue.Empty:
                raise SnapshotError(f"no answer to {method} within {READ_TIMEOUT_SECONDS:.0f} s") from None
            if line is None:
                raise SnapshotError(f"the server exited before answering {method}: {self.stderr_tail()}")
            reply = json.loads(line)
            if reply.get("id") == request_id and "method" not in reply:
                return reply

    def stderr_tail(self) -> str:
        self._stderr.seek(0)
        text = self._stderr.read().decode(errors="replace").strip()
        return text.splitlines()[-1] if text else f"exit code {self.proc.poll()}"

    def close(self) -> None:
        if self.proc.stdin is not None:
            try:
                self.proc.stdin.close()
            except OSError:
                pass
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self._stderr.close()


def _result(reply: dict, what: str) -> dict:
    if "result" not in reply:
        raise SnapshotError(f"{what} returned an error, not a result: {reply.get('error')}")
    return reply["result"]


def _error(reply: dict, what: str) -> dict:
    if "error" not in reply:
        raise SnapshotError(f"{what} returned a result, expected an error: {reply.get('result')}")
    return reply["error"]


def _envelope(version: str) -> dict:
    return {
        "_meta": {
            PROTOCOL_VERSION_KEY: version,
            CLIENT_CAPABILITIES_KEY: {},
            CLIENT_INFO_KEY: CLIENT_INFO,
        }
    }


def _initialize_params(version: str) -> dict:
    return {"protocolVersion": version, "capabilities": {}, "clientInfo": CLIENT_INFO}


def _same_everywhere(values: dict[str, object], what: str) -> object:
    """The one value every protocol version produced, or a SnapshotError naming the split."""
    distinct = {json.dumps(value, sort_keys=True) for value in values.values()}
    if len(distinct) != 1:
        raise SnapshotError(
            f"{what} differs between protocol versions {sorted(values)}; the snapshot format "
            "holds one answer for every version and needs a per-version table first"
        )
    return next(iter(values.values()))


def capture_snapshot(server_argv: list[str] | None = None, env: dict[str, str] | None = None) -> dict:
    """Start the full server once per scenario and return the snapshot document."""
    from mcp_types import version as mcp_versions

    import importlib.metadata

    argv = server_argv or [sys.executable, str(SERVER_PATH)]
    handshake_versions = list(mcp_versions.HANDSHAKE_PROTOCOL_VERSIONS)
    modern_versions = list(mcp_versions.MODERN_PROTOCOL_VERSIONS)

    plan = (
        [("legacy", v) for v in handshake_versions]
        + [("legacy-preinit", UNSERVED_VERSION)]
        + [("modern", v) for v in modern_versions]
    )
    # Every scenario needs its own connection, because the first request locks
    # the era. Start them together so their imports overlap.
    sessions = [(kind, version, _WireSession(argv, env)) for kind, version in plan]
    initialize: dict[str, object] = {}
    legacy_tools: dict[str, object] = {}
    discover: dict[str, object] = {}
    modern_tools: dict[str, object] = {}
    initialize_refused: dict[str, object] = {}
    ping_error: dict[str, object] = {}
    fallback_version = None
    not_initialized_error = None
    try:
        for kind, version, session in sessions:
            if kind == "legacy":
                result = dict(_result(session.request("initialize", _initialize_params(version)), "initialize"))
                negotiated = result.pop("protocolVersion", None)
                if negotiated != version:
                    raise SnapshotError(f"initialize({version}) negotiated {negotiated}")
                session.notify("notifications/initialized")
                initialize[version] = result
                legacy_tools[version] = _result(session.request("tools/list"), "tools/list")
                if _result(session.request("ping"), "ping") != {}:
                    raise SnapshotError("legacy ping answered something other than {}")
            elif kind == "legacy-preinit":
                if _result(session.request("ping"), "ping before initialize") != {}:
                    raise SnapshotError("legacy ping before initialize answered something other than {}")
                not_initialized_error = _error(session.request("tools/list"), "tools/list before initialize")
                result = _result(session.request("initialize", _initialize_params(version)), "initialize")
                fallback_version = result.get("protocolVersion")
                if fallback_version not in handshake_versions:
                    raise SnapshotError(f"initialize({version}) negotiated {fallback_version}")
            else:
                envelope = _envelope(version)
                discover[version] = _result(session.request("server/discover", envelope), "server/discover")
                modern_tools[version] = _result(session.request("tools/list", envelope), "tools/list")
                refused = dict(
                    _error(session.request("initialize", _initialize_params(version)), "modern initialize")
                )
                data = refused.pop("data", None)
                if not isinstance(data, dict) or data.get("supported") != modern_versions:
                    raise SnapshotError(f"modern initialize refusal carries unexpected data: {data}")
                initialize_refused[version] = refused
                ping_error[version] = _error(session.request("ping", envelope), "modern ping")
    finally:
        for _, _, session in sessions:
            session.close()

    return {
        "generatedBy": GENERATED_BY,
        "source": {
            "mcp": importlib.metadata.version("mcp"),
            "browser-use": importlib.metadata.version("browser-use"),
        },
        "legacy": {
            "versions": handshake_versions,
            "fallbackVersion": fallback_version,
            "initialize": _same_everywhere(initialize, "legacy initialize"),
            "toolsList": _same_everywhere(legacy_tools, "legacy tools/list"),
            "notInitializedError": not_initialized_error,
        },
        "modern": {
            "versions": modern_versions,
            "discover": _same_everywhere(discover, "server/discover"),
            "toolsList": _same_everywhere(modern_tools, "modern tools/list"),
            "initializeRefused": _same_everywhere(initialize_refused, "modern initialize refusal"),
            "pingError": _same_everywhere(ping_error, "modern ping"),
        },
    }


def render(snapshot: dict) -> str:
    return json.dumps(snapshot, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    try:
        rendered = render(capture_snapshot())
    except SnapshotError as exc:
        print(f"write_front_snapshot: {exc}", file=sys.stderr)
        return 1
    if check:
        current = SNAPSHOT_PATH.read_text(encoding="utf-8") if SNAPSHOT_PATH.exists() else ""
        if current != rendered:
            print(
                f"write_front_snapshot: {SNAPSHOT_PATH.name} is stale. Regenerate it: {GENERATED_BY}",
                file=sys.stderr,
            )
            return 1
        print(f"write_front_snapshot: {SNAPSHOT_PATH.name} is current")
        return 0
    tmp = SNAPSHOT_PATH.with_suffix(".json.tmp")
    tmp.write_text(rendered, encoding="utf-8")
    os.replace(tmp, SNAPSHOT_PATH)
    print(f"write_front_snapshot: wrote {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
