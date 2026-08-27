/**
 * server.e2e.test.ts — acceptance A1. Spawns the REAL server and speaks real JSON-RPC.
 *
 * Nothing here is mocked. Every case starts `bun mcp/server.ts` as a child process with
 * `CLAUDE_PROJECT_DIR` pointed at a fresh `mkdtemp` project, writes settings into that
 * project, and drives the process over its stdio the way Claude Code does. A mocked
 * transport would assert only that the mock matches the code, and the three failures
 * this file exists to catch — a handshake missing `listChanged`, a stray line on
 * stdout, a `tools/list` that spawns — are all properties of the real process.
 *
 * Run: bun test plugins/code-analysis/mcp/server.e2e.test.ts
 *
 * ISOLATION. `HOME` is redirected into the temp tree as well as `CLAUDE_PROJECT_DIR`,
 * because `settings.ts` reads `<home>/.claude/settings.json` as its lowest layer. A
 * developer with a real `code-analysis` block there would otherwise change what this
 * suite measures, and it would pass or fail by whose machine ran it. No test writes
 * anything into the repo.
 *
 * CHILD PROCESSES. Every pid this file starts is tracked and killed BY PID in
 * `afterEach` — SIGTERM, then SIGKILL after a second. No pattern-matching process kill
 * is used anywhere: this repo runs many concurrent `bun` and `claude` processes and a
 * pattern kill takes unrelated sessions down with it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_IDS } from "./adapters/index";
import { encode, makeLineReader, type RpcResponse } from "./transport/jsonrpc";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.ts");

/** A command that cannot exist. Used wherever the point is that the engine is absent. */
const ABSENT_COMMAND = "/nonexistent/code-analysis-e2e/definitely-not-a-binary";

/** Ceiling for one request: enough for a cold `bun` start plus the transport's first
 *  1s restart backoff, short enough to fail rather than hang the suite. */
const REQUEST_BUDGET_MS = 30_000;

/** Cases that let the transport spawn need room for that backoff. */
const SPAWNING_CASE_MS = 60_000;

interface Paths {
  root: string;
  project: string;
  home: string;
}

interface Server extends Paths {
  request(method: string, params?: unknown): Promise<RpcResponse>;
  notify(method: string, params?: unknown): void;
  /** Methods of every id-less message the server sent, in order. */
  notifications(): string[];
  /** Everything written to stdout, verbatim and unparsed. */
  rawStdout(): string;
  rawStderr(): string;
  stop(): Promise<void>;
}

interface StartOptions {
  /** The `code-analysis` block for `<project>/.claude/settings.json`. A function is
   *  called with the temp paths, because an engine command is only knowable after
   *  `mkdtemp` has run. */
  settings?: unknown | ((paths: Paths) => unknown);
  /** Verbatim `<project>/.claude/settings.json`, for testing what invalid JSON does. */
  rawSettings?: string;
  /** Files dropped into the temp root before the server starts. */
  files?: Record<string, string>;
}

const running: ChildProcess[] = [];
const scratch: string[] = [];

function startServer(options: StartOptions = {}): Server {
  const root = mkdtempSync(join(tmpdir(), "ca-server-e2e-"));
  scratch.push(root);

  const home = join(root, "home");
  const project = join(root, "project");
  const paths: Paths = { root, project, home };
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  // An explicitly EMPTY home layer, so the developer's real one cannot leak in.
  writeFileSync(join(home, ".claude", "settings.json"), "{}");

  for (const [name, body] of Object.entries(options.files ?? {})) {
    writeFileSync(join(root, name), body);
  }

  const settingsPath = join(project, ".claude", "settings.json");
  if (options.rawSettings !== undefined) {
    writeFileSync(settingsPath, options.rawSettings);
  } else if (options.settings !== undefined) {
    const block =
      typeof options.settings === "function"
        ? (options.settings as (p: Paths) => unknown)(paths)
        : options.settings;
    writeFileSync(settingsPath, JSON.stringify({ "code-analysis": block }, null, 2));
  }

  // `process.execPath` under `bun test` IS bun, which is exactly what `.mcp.json`
  // names as the command. The host's spawn and this one differ in nothing that matters.
  const child = spawn(process.execPath, [SERVER], {
    cwd: project,
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
    stdio: ["pipe", "pipe", "pipe"],
  });
  running.push(child);

  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const notified: string[] = [];
  const pending = new Map<string | number, (r: RpcResponse) => void>();

  const read = makeLineReader((message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "number" && typeof id !== "string") {
      const method = record["method"];
      if (typeof method === "string") notified.push(method);
      return;
    }
    pending.get(id)?.(record as unknown as RpcResponse);
    pending.delete(id);
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    read(chunk);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const write = (payload: object): void => {
    child.stdin?.write(encode(payload));
  };

  return {
    ...paths,
    rawStdout: () => stdout,
    rawStderr: () => stderr,
    notifications: () => [...notified],

    request(method: string, params?: unknown): Promise<RpcResponse> {
      const id = nextId++;
      return new Promise<RpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} did not answer in ${REQUEST_BUDGET_MS}ms. stderr:\n${stderr}`));
        }, REQUEST_BUDGET_MS);
        pending.set(id, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      });
    },

    notify(method: string, params?: unknown): void {
      write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },

    stop: () => stopChild(child),
  };
}

/** SIGTERM, then SIGKILL, BY PID. Never a pattern kill. */
function stopChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => {
      if (child.pid === undefined) return;
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // Gone between the check and the signal. Nothing left to do.
      }
    }, 1_000);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.stdin?.end();
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(escalate);
      resolve();
    }
  });
}

afterEach(async () => {
  for (const child of running.splice(0)) await stopChild(child);
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handshake(server: Server): Promise<RpcResponse> {
  const response = await server.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "server-e2e", version: "1.0.0" },
  });
  server.notify("notifications/initialized");
  return response;
}

interface ListedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function listedTools(response: RpcResponse): ListedTool[] {
  expect(response.error).toBeUndefined();
  const tools = (response.result as { tools?: unknown } | undefined)?.tools;
  expect(Array.isArray(tools)).toBe(true);
  return tools as ListedTool[];
}

async function toolNames(server: Server): Promise<string[]> {
  return listedTools(await server.request("tools/list")).map((tool) => tool.name);
}

function callResult(response: RpcResponse): { text: string; isError: unknown } {
  expect(response.error).toBeUndefined();
  const result = response.result as
    | { content?: { type: string; text: string }[]; isError?: unknown }
    | undefined;
  return {
    text: (result?.content ?? []).map((block) => block.text).join(""),
    isError: result?.isError,
  };
}

/** Every non-empty stdout line must be a JSON-RPC message. One banner and the framing
 *  is corrupt — and the symptom is a protocol error nowhere near the cause. */
function assertStdoutIsPureJsonRpc(server: Server): void {
  const lines = server.rawStdout().split("\n").filter((line) => line.trim() !== "");
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    const parsed: unknown = JSON.parse(line);
    expect(typeof parsed).toBe("object");
    expect((parsed as Record<string, unknown>)["jsonrpc"]).toBe("2.0");
  }
}

/** Stands in for an engine binary: records every spawn, then exits. Makes "did
 *  anything start?" a file-existence question rather than a guess. */
const SPAWN_MARKER_ENGINE = `import { appendFileSync } from "node:fs";
appendFileSync(process.env["CA_SPAWN_MARKER"], String(process.pid) + "\\n");
process.exit(0);
`;

/**
 * An engine that starts cleanly and then answers NOTHING — not even the handshake.
 *
 * The only way to observe a per-call deadline end to end is to have something miss it,
 * and a child that is merely slow races the assertion. This one is silent for as long
 * as it is left running, so the deadline is the only thing that can end the call and
 * the number in the note is therefore the number that was in effect.
 */
const MUTE_ENGINE = `process.stdin.resume();
setInterval(() => {}, 60000);
`;

/**
 * A HEALTHY mnemex that is missing the graph tools — the shape an upstream release
 * produces when it drops or renames one, and the only probe result that delists a tool.
 *
 * It must be healthy in every other respect or the test measures the wrong branch. It
 * exposes `index_status` (so the probe reads a real snapshot rather than reporting the
 * engine unreadable) reporting 216 files and a completed run, and `search` (so the
 * canary passes rather than short-circuiting on a failed embedding call). What it does
 * NOT expose is `callers`, `callees` or `impact` — so `findDependents`, `findDependencies`,
 * `callTree` and `impact` are PERMANENT incapacities for this install, while
 * `generalSearch`, `knowledgeSearch`, `locateSymbol` and `readSource` are unaffected.
 *
 * `lastIndexed` is null next to a real `indexDbLastIndexed` on purpose: that is exactly
 * what a live mnemex returns, and reading only the first field is the R1 bug that once
 * declared a complete 216-file index empty.
 */
const MNEMEX_WITHOUT_GRAPH_TOOLS = `const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const ok = (id, text) => send({ jsonrpc: "2.0", id,
  result: { content: [{ type: "text", text }], isError: false } });
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined || msg.id === null) continue;
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05",
        capabilities: { tools: {} }, serverInfo: { name: "mnemex", version: "0.0.0" } } });
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
        { name: "index_status", description: "Index health.", inputSchema: { type: "object" } },
        { name: "search", description: "Semantic search.", inputSchema: { type: "object" } },
      ] } });
    } else if (msg.method === "tools/call") {
      if (msg.params && msg.params.name === "index_status") {
        ok(msg.id, JSON.stringify({ initialized: true, indexedFileCount: 216,
          indexDbLastIndexed: "2026-08-26T02:59:43.233Z", lastIndexed: null }));
      } else {
        ok(msg.id, JSON.stringify({ results: [] }));
      }
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } });
    }
  }
});
`;

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

describe("initialize", () => {
  test("advertises tools.listChanged, without which delisting is a silent no-op", async () => {
    const server = startServer();
    const response = await handshake(server);

    expect(response.error).toBeUndefined();
    const result = response.result as {
      protocolVersion?: string;
      capabilities?: { tools?: { listChanged?: boolean } };
      serverInfo?: { name?: string; version?: string };
    };

    expect(result.protocolVersion).toBe("2024-11-05");
    // THE assertion. A host is entitled to discard notifications/tools/list_changed
    // from a server that never declared it; the tool then stays in the host's list and
    // every call to it fails.
    expect(result.capabilities?.tools?.listChanged).toBe(true);
    expect(result.serverInfo?.name).toBe("ca");
    expect(typeof result.serverInfo?.version).toBe("string");
    expect(result.serverInfo?.version).not.toBe("");
  });

  test("answers ping, and an unknown method is -32601", async () => {
    const server = startServer();
    await handshake(server);

    expect((await server.request("ping")).error).toBeUndefined();
    expect((await server.request("resources/list")).error?.code).toBe(-32601);
  });
});

// ---------------------------------------------------------------------------
// tools/list — a pure function of committed settings
// ---------------------------------------------------------------------------

describe("tools/list", () => {
  test("A1 — no engine configured lists EXACTLY code_search", async () => {
    const server = startServer();
    await handshake(server);

    expect(await toolNames(server)).toEqual(["code_search"]);
  });

  test("A1 — a settings file with no code-analysis block lists EXACTLY code_search", async () => {
    const server = startServer({ rawSettings: '{"model":"opus"}' });
    await handshake(server);

    expect(await toolNames(server)).toEqual(["code_search"]);
  });

  test("mnemex lists code_search plus the tier-1 tools it actually declares", async () => {
    const server = startServer({
      settings: { engine: "mnemex", engines: { mnemex: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    // mnemex declares eight capabilities: generalSearch, knowledgeSearch, locateSymbol,
    // readSource, findDependencies, findDependents, callTree and impact. Four of those
    // have a tier-1 tool. `find_implementations` is ABSENT, and its absence is the point
    // — the list is what this engine can genuinely answer, never a fixed six.
    expect(await toolNames(server)).toEqual([
      "code_search",
      "find_dependencies",
      "find_dependents",
      "call_tree",
      "impact",
    ]);
  });

  test("SWITCHING THE ENGINE CHANGES WHICH TOOLS EXIST — serena lists a different set", async () => {
    // The facade's whole claim, at the wire. Same server binary, same settings file
    // shape, one key different — and the tool list is not a subset or a superset of
    // mnemex's, it OVERLAPS it. `find_dependents` is common; serena adds
    // `find_implementations`, which mnemex cannot answer, and drops the three
    // outgoing-edge tools, which serena cannot answer.
    //
    // A test that only checked the count would pass against a gate that had learned to
    // count instead of to read.
    const server = startServer({
      settings: { engine: "serena", engines: { serena: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    expect(await toolNames(server)).toEqual([
      "code_search",
      "find_dependents",
      "find_implementations",
    ]);
  });

  test("tier 2 ships EMPTY: no listed name carries an engine prefix", async () => {
    const server = startServer({
      settings: { engine: "mnemex", engines: { mnemex: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    // Built from the live engine list, so an engine added tomorrow is covered without
    // anyone remembering this line.
    const tier2 = new RegExp(`^(?:${ENGINE_IDS.join("|")})_`, "u");
    const prefixed = (await toolNames(server)).filter((name) => tier2.test(name));
    expect(prefixed).toEqual([]);
  });

  test("every listed tool carries a closed object schema the host will accept", async () => {
    const server = startServer({
      settings: { engine: "mnemex", engines: { mnemex: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    for (const tool of listedTools(await server.request("tools/list"))) {
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
      // The host prefixes `mcp__plugin_code-analysis_ca__` — 30 characters — onto every
      // name, and its ceiling is 64.
      expect(30 + tool.name.length).toBeLessThanOrEqual(64);
    }
  });

  test("tools/list NEVER spawns a subprocess; the first tools/call does", async () => {
    const server = startServer({
      files: { "engine.ts": SPAWN_MARKER_ENGINE },
      settings: ({ root }: Paths) => ({
        engine: "mnemex",
        engines: {
          mnemex: {
            command: process.execPath,
            args: [join(root, "engine.ts")],
            env: { CA_SPAWN_MARKER: join(root, "spawns.txt") },
          },
        },
      }),
    });
    const marker = join(server.root, "spawns.txt");

    await handshake(server);
    expect(await toolNames(server)).toContain("find_dependents");
    await toolNames(server);
    // The startup set is a pure function of committed settings. Listing it twice has
    // still started nothing — a broken engine costs nothing at session start.
    expect(existsSync(marker)).toBe(false);

    await server.request("tools/call", {
      name: "code_search",
      arguments: { query: "anything at all" },
    });
    // The probe is lazy and runs as part of the FIRST call, so by now it has started.
    expect(existsSync(marker)).toBe(true);
  }, SPAWNING_CASE_MS);
});

// ---------------------------------------------------------------------------
// tools/call — the three-way dispatch
// ---------------------------------------------------------------------------

describe("tools/call", () => {
  test("no engine configured answers success-shaped, with a code and a remedy", async () => {
    const server = startServer();
    await handshake(server);

    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "code_search",
        arguments: { query: "where is parse defined" },
      }),
    );

    // Unavailability is an ANSWER. `isError` is reserved for a security refusal or a
    // genuine malfunction; spending it here teaches the agent to stop calling the tool.
    expect(isError).toBe(false);
    expect(text).toContain("served_by:");
    expect(text).toContain("backend_unavailable");
    expect(text).toContain("remedy:");
  });

  test("E2 — an engine absent from PATH keeps its tools and answers with a remedy", async () => {
    const server = startServer({
      settings: { engine: "mnemex", engines: { mnemex: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    // Still listed: a configured engine that is down keeps its tools, because
    // unavailability is an answer and not a missing tool.
    expect(await toolNames(server)).toContain("find_dependents");

    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "code_search",
        arguments: { query: "who calls resolveEngine" },
      }),
    );

    expect(isError).toBe(false);
    expect(text).toContain("backend_unavailable");
    expect(text).toContain("remedy:");
    expect(text).toContain("mnemex");
    // Down, not delisted — the tool set is unchanged after the failed probe.
    expect(await toolNames(server)).toContain("find_dependents");
  }, SPAWNING_CASE_MS);

  test("a tier-1 call against an absent engine is also success-shaped", async () => {
    const server = startServer({
      settings: { engine: "mnemex", engines: { mnemex: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "find_dependents",
        arguments: { symbol: "resolveEngine" },
      }),
    );

    expect(isError).toBe(false);
    expect(text).toContain("served_by: mnemex/findDependents");
    expect(text).toContain("remedy:");
  }, SPAWNING_CASE_MS);

  test("MIDDLE BRANCH — a tool delisted by the probe that ran during this very call", async () => {
    const server = startServer({
      files: { "engine.mjs": MNEMEX_WITHOUT_GRAPH_TOOLS },
      settings: ({ root }: Paths) => ({
        engine: "mnemex",
        engines: { mnemex: { command: process.execPath, args: [join(root, "engine.mjs")] } },
      }),
    });
    await handshake(server);

    // Before any call the list is a pure function of what the adapter DECLARES.
    expect(await toolNames(server)).toEqual([
      "code_search",
      "find_dependencies",
      "find_dependents",
      "call_tree",
      "impact",
    ]);

    // This call is what probes. The engine is healthy — 216 files indexed, canary search
    // answers — but `callers`/`callees`/`impact` are simply not in its tools/list, so all
    // four graph capabilities are permanently withdrawn, including the one in flight.
    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "find_dependents",
        arguments: { symbol: "resolveEngine" },
      }),
    );

    // Success-shaped, carrying the PROBE's own reason. -32601 here would be the facade
    // punishing the agent for the facade's own correct behaviour.
    expect(isError).toBe(false);
    expect(text).toContain("capability_unsupported");
    expect(text).toContain("does not expose callers");
    expect(text).toContain("remedy:");

    // The host was told, which is the half that `listChanged: true` makes count.
    expect(server.notifications()).toContain("notifications/tools/list_changed");

    // And the list has actually shrunk to what this build can answer. `code_search`
    // survives because `search` IS exposed — a probe that withdrew everything would
    // prove nothing about the gate reading per-capability requirements.
    expect(await toolNames(server)).toEqual(["code_search"]);

    // A second call to the same delisted name is still an answer, not a protocol error.
    const again = await server.request("tools/call", {
      name: "find_dependents",
      arguments: { symbol: "resolveEngine" },
    });
    expect(again.error).toBeUndefined();
    expect(callResult(again).isError).toBe(false);
  }, SPAWNING_CASE_MS);

  test("a name the server has never listed is -32601", async () => {
    const server = startServer();
    await handshake(server);

    const response = await server.request("tools/call", {
      name: "mnemex_index_status",
      arguments: {},
    });

    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toContain("mnemex_index_status");
    expect(response.result).toBeUndefined();
  });

  test("a tier-1 name THIS engine never listed is also -32601", async () => {
    const server = startServer({
      settings: { engine: "serena", engines: { serena: { command: ABSENT_COMMAND } } },
    });
    await handshake(server);

    // serena has no outgoing edge, so it never listed `impact` — which mnemex DOES list.
    // The name is real, this session's engine just never offered it, and that has to be
    // a method-not-found rather than a call that quietly returns nothing.
    const response = await server.request("tools/call", {
      name: "impact",
      arguments: { symbol: "x" },
    });
    expect(response.error?.code).toBe(-32601);
  });

  test("a missing required argument names the argument rather than guessing one", async () => {
    const server = startServer();
    await handshake(server);

    const response = await server.request("tools/call", { name: "code_search", arguments: {} });
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain("query");
  });

  test("a misconfigured engine reports the CAUSE, not just the symptom", async () => {
    // `engine` names an id with no `engines` entry — the settings typo that otherwise
    // leaves a user staring at a tier-0-only tool list with no explanation at all.
    const server = startServer({ settings: { engine: "mnemex", engines: {} } });
    await handshake(server);

    expect(await toolNames(server)).toEqual(["code_search"]);

    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "code_search",
        arguments: { query: "how does auth work" },
      }),
    );
    expect(isError).toBe(false);
    expect(text).toContain('"code-analysis".engines has no entry for it');
  });

  test("a timeout note quotes the CONFIGURED deadline, not the 30_000 default", async () => {
    // The composition root is the only thing that can turn `engines.<id>.callTimeoutMs`
    // into `McpClientOptions.callMs`, and this is the only test that can see it happen
    // end to end: a real server process, real settings on disk, a real child that never
    // answers, and the number the operator wrote coming back out in the note.
    //
    // A 20/24 paid run failed on `mnemex did not answer search within 30000ms` with no
    // way to change the number. A configurable deadline whose note still said 30000
    // would be the same defect with a longer wait attached.
    const DEADLINE_MS = 1_500;
    const server = startServer({
      files: { "mute.mjs": MUTE_ENGINE },
      settings: ({ root }: Paths) => ({
        engine: "mnemex",
        engines: {
          mnemex: {
            command: process.execPath,
            args: [join(root, "mute.mjs")],
            callTimeoutMs: DEADLINE_MS,
          },
        },
      }),
    });
    await handshake(server);

    const { text, isError } = callResult(
      await server.request("tools/call", {
        name: "code_search",
        arguments: { query: "who calls resolveEngine" },
      }),
    );

    expect(isError).toBe(false);
    expect(text).toContain("backend_unavailable");
    expect(text).toContain(`within ${DEADLINE_MS}ms`);
    // The regression this whole change exists to prevent: a number in the note that is
    // not the number in effect.
    expect(text).not.toContain("30000ms");
  }, SPAWNING_CASE_MS);

});

// ---------------------------------------------------------------------------
// The protocol channel
// ---------------------------------------------------------------------------

describe("stdout purity", () => {
  test("nothing but JSON-RPC ever reaches stdout, across a full session", async () => {
    const server = startServer({
      settings: {
        // A rejected engine id AND an out-of-range ratchet, so the settings reader has
        // plenty to complain about. All of it must land on stderr.
        engine: "mnemex",
        engines: { mnemex: { command: ABSENT_COMMAND }, "BAD-ID": { command: "x" } },
        passthrough: { enabled: false, maxPerEngine: 99 },
      },
    });

    await handshake(server);
    await toolNames(server);
    await server.request("tools/call", {
      name: "code_search",
      arguments: { query: "who calls resolveEngine" },
    });
    await server.request("tools/call", { name: "not_a_tool", arguments: {} });

    assertStdoutIsPureJsonRpc(server);
    // The complaints did happen — they just went to the right channel.
    expect(server.rawStderr()).toContain("code-analysis/ca");
    expect(server.rawStderr()).toContain("settings_ignored");
  }, SPAWNING_CASE_MS);

  test("a malformed settings layer neither crashes the server nor reaches stdout", async () => {
    const server = startServer({ rawSettings: "{ this is not json" });
    await handshake(server);

    expect(await toolNames(server)).toEqual(["code_search"]);
    assertStdoutIsPureJsonRpc(server);
    expect(server.rawStderr()).toContain("malformed");
  });
});
