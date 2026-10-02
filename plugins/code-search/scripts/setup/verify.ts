/**
 * verify.ts — `verify [--query <text>]`.
 *
 * Starts THIS plugin's own `mcp/server.ts` over stdio, in the project, and calls
 * `code_search` once. A fresh server, on purpose: the one serving the live session read
 * its settings at startup, so asking it would test the configuration from before
 * `configure` ran.
 *
 * Passes when the answer was served by the configured engine — or, for `engine: false`,
 * when `code_search` answered at all. Everything else is exit 1 with the server's own
 * notes, verbatim, since they carry the remedy.
 */

import { join } from "node:path";

import { loadSettings } from "../../mcp/core/settings";
import { MCP_CLIENT_DEFAULTS } from "../../mcp/transport/mcp-stdio-client";
import type { SetupContext, SetupIo } from "./io";
import { failed, tailLines, type Outcome } from "./report";

export const DEFAULT_VERIFY_QUERY = "where is the main entry point of this project";

/**
 * Note codes that mean the engine did not really answer. `index_stale`, `result_truncated`
 * and `query_transformed` describe a real answer and do not fail verification.
 */
const BLOCKING_NOTES: ReadonlySet<string> = new Set([
  "backend_unavailable",
  "index_missing",
  "index_building",
  "capability_unsupported",
  "settings_ignored",
]);

/** Past mnemex's own 120 s cold-start budget, so its honest first call is not cut off. */
const VERIFY_CALL_MS = 150_000;

export interface VerifyFlags {
  query?: string;
}

export async function verify(io: SetupIo, ctx: SetupContext, flags: VerifyFlags): Promise<Outcome> {
  const command = "verify";
  const query = flags.query ?? DEFAULT_VERIFY_QUERY;
  const serverPath = join(ctx.pluginRoot, "mcp", "server.ts");
  const engine = loadSettings({
    home: ctx.home,
    projectDir: ctx.projectDir,
    readFileText: (path) => io.readText(path),
  }).settings.engine;

  const log: string[] = [];
  const client = io.connect(
    {
      engineId: "code-search",
      command: io.execPath,
      // Same flags as every other bun entry point here: a project's .env FIFO or
      // bunfig.toml must not hang or reconfigure the server.
      args: ["--env-file=/dev/null", "--config=/dev/null", serverPath],
      env: { CLAUDE_PROJECT_DIR: ctx.projectDir, HOME: ctx.home },
      cwd: ctx.projectDir,
    },
    { ...MCP_CLIENT_DEFAULTS, callMs: VERIFY_CALL_MS, maxRestarts: 1, log: (line) => log.push(line) },
  );

  try {
    const listed = await client.listTools();
    if (!listed.ok) {
      return failed(command, {
        code: "server_failed",
        message: `The code-search server did not start: ${listed.note.message}`,
        remedy: `Run it by hand to see why: ${io.execPath} ${serverPath}`,
        process: { command: `${io.execPath} ${serverPath}`, stderrTail: tailLines(log.join("\n")) },
      });
    }
    const tools = listed.tools.map((tool) => tool.name);
    if (!tools.includes("code_search")) {
      return failed(command, {
        code: "code_search_missing",
        message: `The server started but does not list code_search (it lists: ${tools.join(", ") || "nothing"}).`,
      });
    }

    const call = await client.call("code_search", { query });
    if (!call.ok) {
      return failed(command, {
        code: "code_search_failed",
        message: `code_search did not answer: ${call.note.message}`,
        ...(call.note.remedy === undefined ? {} : { remedy: call.note.remedy }),
      });
    }

    const text = textOf(call.content);
    const served = /^served_by: ([^/\s]+)\/(\S+)(.*)$/mu.exec(text);
    const servedEngine = served?.[1];
    const notServed = served?.[3]?.includes("not served") === true;
    const notes = [...text.matchAll(/^\[(info|degraded|error)\] ([a-z_]+): (.*)$/gmu)].map((m) => ({
      level: m[1],
      code: m[2],
      message: m[3],
    }));
    const data = { query, tools, served: served?.[0] ?? null, notes, engine: engine ?? null };

    // A served answer is not a working one: the server can serve a call and say in the
    // same breath that the engine had nothing to answer from.
    const blocking = notes.filter((n) => n.level !== "info" && BLOCKING_NOTES.has(n.code ?? ""));
    const passed =
      !call.isError &&
      (engine === false
        ? true
        : typeof engine === "string" && servedEngine === engine && !notServed && blocking.length === 0);
    if (!passed) {
      return failed(
        command,
        {
          code: "not_served",
          message:
            engine === undefined
              ? "code_search answered, but no engine is configured, so nothing served it."
              : blocking.length > 0 && servedEngine === engine
                ? `code_search reached ${String(engine)}, but the answer reports ${[...new Set(blocking.map((n) => n.code))].join(", ")}.`
                : `code_search was not served by ${String(engine)}: ${served?.[0] ?? "no served_by line"}.`,
          ...(notes.find((n) => n.level !== "info") === undefined
            ? {}
            : { remedy: "Act on the server's notes below; each carries its own remedy." }),
        },
        { details: text.split("\n").slice(0, 40), data },
      );
    }

    return {
      command,
      ok: true,
      exitCode: 0,
      summary:
        engine === false
          ? "code_search answered with no engine, as configured."
          : `code_search answered, served by ${String(engine)}.`,
      details: text.split("\n").slice(0, 20),
      data,
    };
  } finally {
    await client.dispose();
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("\n");
}
