import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { RELAY_SENTENCE } from "../../mcp/core/setup-state";
import { PLUGIN_ROOT, SKILL, codeSearch, site, type Site } from "./support";

const SERVER = join(PLUGIN_ROOT, "mcp", "server.ts");
const children: ChildProcess[] = [];
const REQUEST_TIMEOUT = 30_000;

type Response = { jsonrpc: string; id: number; result?: any; error?: { code: number; message: string } };

function start(s: Site) {
  const child = spawn(process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", SERVER],
    { cwd: s.project, env: s.env, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  const input = child.stdin;
  const output = child.stdout;
  const errors = child.stderr;
  if (!input || !output || !errors) throw new Error("stdio server did not open pipes");
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<number, (reply: Response) => void>();
  output.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const reply = JSON.parse(line) as Response;
      if (typeof reply.id === "number") {
        pending.get(reply.id)?.(reply);
        pending.delete(reply.id);
      }
    }
  });
  errors.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  input.on("error", () => {});

  function send(payload: object): void {
    input.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
  }

  async function request(method: string, params?: object): Promise<Response> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out; server stderr: ${stderr}`));
      }, REQUEST_TIMEOUT);
      pending.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
      send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  return {
    request,
    async initialize(): Promise<void> {
      const response = await request("initialize", {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "setup-black-box-qa", version: "1.0.0" },
      });
      expect(response.error).toBeUndefined();
      expect(response.result?.capabilities?.tools).toBeDefined();
      send({ method: "notifications/initialized" });
    },
    async names(): Promise<string[]> {
      const response = await request("tools/list");
      expect(response.error).toBeUndefined();
      const names = response.result?.tools?.map((tool: { name: string }) => tool.name);
      expect(Array.isArray(names)).toBe(true);
      return names;
    },
    async search(): Promise<string> {
      const response = await request("tools/call", {
        name: "code_search", arguments: { query: "where is setup configured" },
      });
      expect(response.error).toBeUndefined();
      expect(response.result?.isError).toBe(false);
      const content = response.result?.content as { type: string; text: string }[];
      expect(content.length).toBeGreaterThan(0);
      return content.map((part) => part.text).join("");
    },
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try { process.kill(child.pid, "SIGKILL"); } catch { /* already exited */ }
      }
    }, 1_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.stdin?.end();
    child.kill("SIGTERM");
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) await stop(child);
});

function assertCommonAdvice(text: string, state: string, s: Site): void {
  expect(text).toContain(`(${state})`);
  expect(text).toContain(SKILL);
  expect(text).toContain(RELAY_SENTENCE);
  expect(text).toContain("dismiss --project");
  expect(text).toContain(s.project);
}

describe("code_search MCP setup notes over real stdio", () => {
  test("unconfigured sends full note once and a self-sufficient short note next", async () => {
    const s = site();
    const server = start(s);
    await server.initialize();
    expect(await server.names()).toEqual(["code_search"]);

    const full = await server.search();
    expect(full.match(/setup_incomplete/g)).toHaveLength(1);
    assertCommonAdvice(full, "unconfigured", s);
    expect(full).toContain("AskUserQuestion");
    expect(full).toContain("Set up now");
    expect(full).toContain("Not now");
    expect(full).toContain("Ignore for this project");
    expect(full).toContain("Before you first search or investigate this codebase by any means");
    expect(full).toContain("Grep, Glob, `code_search`");

    const short = await server.search();
    expect(short.match(/setup_incomplete/g)).toHaveLength(1);
    assertCommonAdvice(short, "unconfigured", s);
    expect(short).not.toContain("AskUserQuestion");
    expect(short).not.toContain("- Not now:");
    expect(short).toContain("Grep, Glob, `code_search`");
  });

  test("engine:false returns one informational no_engine note without remedy", async () => {
    const s = site();
    codeSearch(s.projectSettings, { engine: false, setup: "active" });
    const server = start(s);
    await server.initialize();
    expect(await server.names()).toEqual(["code_search"]);
    const text = await server.search();
    expect(text.match(/no_engine/g)).toHaveLength(1);
    expect(text.match(/^\[info\] no_engine: No engine configured, by choice; use Grep, Glob and Read\.$/gm)).toHaveLength(1);
    expect(text).toContain("No engine configured, by choice; use Grep, Glob and Read.");
    expect(text).not.toMatch(/^\s*remedy\s*:/im);
    expect(text).not.toContain("remedy:");
    expect(text).not.toContain("backend_unavailable");
    expect(text).not.toContain("setup_incomplete");
  });

  test("dismissed without engine returns one informational setup_dismissed note", async () => {
    const s = site();
    codeSearch(s.projectSettings, { setup: "dismissed" });
    const server = start(s);
    await server.initialize();
    expect(await server.names()).toEqual(["code_search"]);
    const text = await server.search();
    expect(text.match(/setup_dismissed/g)).toHaveLength(1);
    expect(text.match(/^\[info\] setup_dismissed: Code search is not set up in this project \(setup dismissed\); use Grep, Glob and Read\.$/gm)).toHaveLength(1);
    expect(text).toContain("Code search is not set up in this project (setup dismissed); use Grep, Glob and Read.");
    expect(text).not.toMatch(/^\s*remedy\s*:/im);
    expect(text).not.toContain("remedy:");
    expect(text).not.toContain("backend_unavailable");
    expect(text).not.toContain("/code-search:setup");
  });
});
