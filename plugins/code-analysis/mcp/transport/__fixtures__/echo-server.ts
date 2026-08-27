#!/usr/bin/env bun
/**
 * echo-server.ts — a scriptable fake MCP server. Test fixture only; nothing ships
 * against it.
 *
 * The transport's contract is that no engine misbehaviour reaches the caller as a
 * throw, so the tests need an engine that misbehaves on demand. This is that engine.
 *
 * Two axes, because the two kinds of misbehaviour happen at different moments:
 *
 *   Boot, via ECHO_SCENARIO — decided before the first byte is written.
 *     normal            the well-behaved server (default)
 *     banner            a human-readable banner and a non-JSON line on stdout BEFORE
 *                       the handshake, which is what a real engine does and which
 *                       must not take the client down
 *     refuse-handshake  never answers `initialize`
 *     bad-list          answers `tools/list` with a `tools` field that is not an array
 *     cling             outlives its parent: ignores stdin EOF and holds the loop open,
 *                       which plenty of real servers do. Without it a teardown test
 *                       proves nothing, because a fixture that quits on EOF quits
 *                       whether or not anything reaped it
 *
 *   Per call, via the tool NAME — decided by whatever the test asks for.
 *     echo              returns its arguments
 *     history           returns every method received, in order; this is how a test
 *                       sees that `notifications/initialized` was actually sent
 *     boom              a well-formed result carrying `isError: true` — an upstream
 *                       tool error, which is an ANSWER and not a transport failure
 *     rpc_error         a JSON-RPC `error` object
 *     slow              replies after ECHO_SLOW_MS (default 5000), tripping `callMs`
 *     crash             writes to stderr and exits non-zero, mid-session
 *     wrong_shape       a valid JSON-RPC response whose `result` is a number
 *     garbage_then_ok   a non-JSON line, then the correct result on the next line
 *
 * Other env:
 *   ECHO_PIDFILE  append this process's pid on boot. Lets a test count how many
 *                 children were started and check that none outlived the client.
 *   ECHO_SLOW_MS  the `slow` tool's delay.
 *
 * Writes go through `writeSync` rather than the stdout stream: the `crash` tool exits
 * immediately after writing, and a buffered stream would drop the evidence the test
 * is asserting on.
 */

import { appendFileSync, writeSync } from "node:fs";
import { encode, makeLineReader } from "../jsonrpc";

const STDOUT_FD = 1;
const STDERR_FD = 2;

const scenario = process.env["ECHO_SCENARIO"] ?? "normal";
const slowMs = Number(process.env["ECHO_SLOW_MS"] ?? "5000");
const pidFile = process.env["ECHO_PIDFILE"];

if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);

const TOOLS = [
  {
    name: "echo",
    description: "Returns its arguments verbatim.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "history",
    description: "Returns every JSON-RPC method this server has received, in order.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    // A nameless entry: the client must drop it and keep the rest, because a tool
    // with no name cannot be called and so cannot be listed.
    description: "Unnameable.",
    inputSchema: { type: "object" },
  },
];

const history: string[] = [];

function send(msg: object): void {
  writeSync(STDOUT_FD, encode(msg));
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function textResult(text: string, isError = false): object {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

if (scenario === "banner") {
  writeSync(STDOUT_FD, "echo-server 0.0.0 — indexing 12 files\n");
  writeSync(STDOUT_FD, "{ this line is not JSON at all\n");
}

function handleCall(id: unknown, name: string, args: unknown): void {
  switch (name) {
    case "history":
      reply(id, textResult(JSON.stringify(history)));
      return;
    case "boom":
      reply(id, textResult("the engine could not answer that", true));
      return;
    case "rpc_error":
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: "engine refused the call" } });
      return;
    case "slow":
      setTimeout(() => reply(id, textResult("finally")), slowMs);
      return;
    case "crash":
      writeSync(STDERR_FD, "fatal: index segment 7 is corrupt\n");
      process.exit(3);
      return;
    case "wrong_shape":
      send({ jsonrpc: "2.0", id, result: 42 });
      return;
    case "garbage_then_ok":
      writeSync(STDOUT_FD, ">>> progress: 40% <<<\n");
      reply(id, textResult("ok despite the noise"));
      return;
    default:
      reply(id, textResult(JSON.stringify(args ?? {})));
  }
}

const read = makeLineReader((msg: unknown) => {
  if (typeof msg !== "object" || msg === null) return;
  const rec = msg as Record<string, unknown>;
  const method = typeof rec["method"] === "string" ? rec["method"] : "";
  const id = rec["id"];

  history.push(method);

  // A notification carries no id and must never be answered.
  if (id === undefined) return;

  switch (method) {
    case "initialize":
      if (scenario === "refuse-handshake") return;
      reply(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-server", version: "0.0.0" },
      });
      return;
    case "tools/list":
      reply(id, scenario === "bad-list" ? { tools: "nope" } : { tools: TOOLS });
      return;
    case "tools/call": {
      const params = rec["params"];
      const p = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
      handleCall(id, typeof p["name"] === "string" ? p["name"] : "", p["arguments"]);
      return;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => read(chunk));

if (scenario === "cling") {
  // Deliberately ref'd: holding the loop open is the whole point of the scenario.
  setInterval(() => {}, 1_000);
} else {
  process.stdin.on("end", () => process.exit(0));
}
