#!/usr/bin/env bun
/**
 * PostToolUse (matcher `^Grep$`) — append related locations from the code index to a
 * Grep tool result, as `additionalContext` (P8).
 *
 * The Grep tool route of the search merge: sessions that opted into the Grep tool, and
 * subagents whose tools omit Bash. The hook sends the tool's own input to this session's
 * code-search server over its unix socket (kind T) and, when the server answers with a
 * block, hands that block to the model. The server owns every decision (gate, parse,
 * `offset` and `head_limit`, scope); this hook only carries bytes.
 *
 * SILENT ON EVERY FAILURE: exit 0, no stdout, no stderr, for a kill switch, a ripgrep
 * config, a payload that is not a Grep call, a tool error, no socket, a slow or broken
 * server, an invalid frame, or a module of this plugin that fails to load. A watchdog
 * ends the process at 2500 ms whatever is in flight. The plugin's own modules are
 * imported dynamically, after the handlers exist (review round 2): a static import that
 * failed would exit 1 with bun's error on stderr before any handler ran.
 *
 * The socket is keyed by the claude pid: `CODE_SEARCH_SESSION_PID`, which the hooks.json
 * launcher sets to its own `$PPID`, else this process's parent (`sessionPid`). The
 * request's cwd is the payload's, never this process's.
 */

import { request } from "node:http";

/** Ends the hook whatever is in flight. */
export const WATCHDOG_MS = 2_500;
/** The fetch budget, measured from the hook's start (P10 `HOOK_FETCH_MS`). */
export const HOOK_FETCH_MS = 1_500;

const hookStart = performance.now();

/** The payload fields the hook uses, or `undefined` when it is not a Grep call to merge. */
export function readPayload(payload: unknown): { cwd: string; toolInput: Record<string, unknown> } | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const p = payload as Record<string, unknown>;
  const toolInput = p["tool_input"];
  const cwd = p["cwd"];
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) return undefined;
  if (typeof cwd !== "string" || cwd === "") return undefined;
  if (isToolError(p["tool_response"])) return undefined;
  return { cwd, toolInput: toolInput as Record<string, unknown> };
}

/**
 * A Grep result that reports an error: the error text itself, or an error-flagged object.
 * Assumes a successful Grep result is always an object (measured: P0-6, Claude Code
 * 2.1.293). A build that returned plain-string successes would lose the block, never get a
 * wrong one.
 */
export function isToolError(response: unknown): boolean {
  if (typeof response === "string") return true;
  if (typeof response !== "object" || response === null) return false;
  const r = response as Record<string, unknown>;
  return r["is_error"] === true || r["isError"] === true || (r["error"] !== undefined && r["error"] !== null && r["error"] !== false);
}

/**
 * Does a ripgrep config file apply to the Grep tool's search? (review round 2) A config
 * can change what the tool matched in ways no reconstruction keeps a superset of:
 * `--invert-match`, `--files-without-match`, `--count`, context. With one set, the route
 * declines and sends nothing. An empty value names no file.
 */
export function ripgrepConfigApplies(env: Readonly<Record<string, string | undefined>>): boolean {
  const path = env["RIPGREP_CONFIG_PATH"];
  return path !== undefined && path !== "";
}

/** `CSM1\0T\0<ppid>\0<pid>\0<cwd>\0<tool_input JSON>\0` (P4, kind T). */
export function requestBody(ppid: number, pid: number, cwd: string, toolInput: unknown): Uint8Array {
  return Buffer.from(`CSM1\0T\0${ppid}\0${pid}\0${cwd}\0${JSON.stringify(toolInput)}\0`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * One `POST /merge` over the unix socket, aborted `timeoutMs` after it starts (a total
 * deadline, not an idle timeout). The response body, or `undefined` on any failure.
 */
function post(sock: string, body: Uint8Array, timeoutMs: number): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const req = request(
      {
        socketPath: sock,
        path: "/merge",
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "Content-Length": body.length, Connection: "close" },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(undefined));
        res.on("aborted", () => resolve(undefined));
      },
    );
    req.on("error", () => resolve(undefined));
    req.end(body);
  });
}

const quiet: () => never = () => process.exit(0);

async function main(): Promise<void> {
  process.on("uncaughtException", quiet);
  process.on("unhandledRejection", quiet);
  setTimeout(quiet, WATCHDOG_MS).unref();

  if (process.env["CODE_SEARCH_MERGE"] === "0") quiet();
  if (ripgrepConfigApplies(process.env)) quiet();

  let socket: typeof import("../mcp/grep/socket");
  let block: typeof import("../mcp/grep/block");
  try {
    [socket, block] = await Promise.all([import("../mcp/grep/socket"), import("../mcp/grep/block")]);
  } catch {
    quiet();
  }

  const claude = socket.sessionPid(process.env, process.ppid);
  const uid = process.getuid?.();
  if (claude <= 1 || uid === undefined) quiet();

  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    quiet();
  }
  const call = readPayload(payload);
  if (call === undefined) quiet();

  // Only a socket under the shared rule (`sessionSocket`: a real 0700 dir and a real
  // socket, both this uid's). A socket another OS user pre-created gets nothing.
  const sock = socket.sessionSocket({ TMPDIR: process.env["TMPDIR"], XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"] }, uid, claude);
  if (sock === undefined) quiet();

  const budget = Math.max(0, HOOK_FETCH_MS - (performance.now() - hookStart));
  if (budget === 0) quiet();
  const response = await post(sock, requestBody(claude, process.pid, call.cwd, call.toolInput), budget);
  const text = response === undefined ? undefined : block.blockOf(response);
  if (text === undefined) quiet();

  const out = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } });
  await new Promise<void>((resolve) => process.stdout.write(out, () => resolve()));
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
