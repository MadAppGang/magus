/**
 * tools-budget.test.ts — N1. What the tool list COSTS, measured, never estimated.
 *
 * Every tool this server lists is injected into every turn of every session, whether or
 * not it is called. That is the tax the facade charges for existing, so it is measured
 * the only honest way: spawn the real server, take the real `tools/list` payload, and
 * divide its bytes by four.
 *
 * Run: bun test plugins/code-analysis/mcp/tools-budget.test.ts
 *
 * THE BASELINE IS 153 TOKENS PER TOOL, and it is measured too: a real `mnemex --mcp`
 * `tools/list` returned 33 tools in 20,242 bytes — 613 bytes each, ~5,061 tokens.
 * The design's 250-per-tool figure is an estimate and it is 63% too high; do not
 * restore it, and do not reason about "is the facade cheaper than the status quo" with
 * it, because every number downstream of it inherits the inflation.
 *
 * The two ceilings are RATCHETS. Lower them as descriptions tighten. Never raise one to
 * make a build pass — the headroom exists so a regression cannot hide inside it, and
 * widening it is how the measurement stops meaning anything.
 *
 *   tier 0 alone   floor 153   ceiling  400   (§11 wants a richer tier-0 description
 *                                              than any mnemex tool carries, plus the
 *                                              injected call-budget sentence)
 *   tier 0 + 1     floor 918   ceiling 1200   (~30% over the six-tool floor)
 *
 * CHILD PROCESSES are tracked and killed BY PID. No pattern-matching process kill.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_IDS } from "./adapters/index";
import { TIER0_TOOL, TIER1_TOOLS } from "./core/registry";
import { encode, makeLineReader, type RpcResponse } from "./transport/jsonrpc";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.ts");
const ABSENT_COMMAND = "/nonexistent/code-analysis-budget/definitely-not-a-binary";
const REQUEST_BUDGET_MS = 30_000;

/** Bytes per token. The same crude divisor the platform's own budget maths uses. */
const BYTES_PER_TOKEN = 4;

const TIER0_CEILING_TOKENS = 400;
const TIER0_PLUS_1_CEILING_TOKENS = 1_200;

interface WireTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface Measurement {
  label: string;
  tools: number;
  bytes: number;
  tokens: number;
  tokensPerTool: number;
}

const running: ChildProcess[] = [];
const scratch: string[] = [];

afterEach(async () => {
  for (const child of running.splice(0)) await stop(child);
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Spawn the real server, handshake, and hand back its real `tools/list` payload.
 *
 * HOME is redirected into the temp tree alongside CLAUDE_PROJECT_DIR: `settings.ts`
 * reads `<home>/.claude/settings.json` as its lowest layer, so a developer's own
 * `code-analysis` block would otherwise change the measurement.
 */
async function listTools(settings?: unknown): Promise<WireTool[]> {
  const root = mkdtempSync(join(tmpdir(), "ca-budget-"));
  scratch.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}");
  if (settings !== undefined) {
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({ "code-analysis": settings }),
    );
  }

  const child = spawn(process.execPath, [SERVER], {
    cwd: project,
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
    stdio: ["pipe", "pipe", "pipe"],
  });
  running.push(child);

  let stderr = "";
  let nextId = 1;
  const pending = new Map<number, (r: RpcResponse) => void>();
  const read = makeLineReader((message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "number") return;
    pending.get(id)?.(record as unknown as RpcResponse);
    pending.delete(id);
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => read(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const request = (method: string, params?: unknown): Promise<RpcResponse> => {
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
      child.stdin?.write(encode({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
    });
  };

  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tools-budget", version: "1.0.0" },
  });
  child.stdin?.write(encode({ jsonrpc: "2.0", method: "notifications/initialized" }));

  const response = await request("tools/list");
  expect(response.error).toBeUndefined();
  const tools = (response.result as { tools?: unknown }).tools;
  expect(Array.isArray(tools)).toBe(true);
  return tools as WireTool[];
}

function stop(child: ChildProcess): Promise<void> {
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
        // Gone between the check and the signal.
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

/** The payload the host actually injects: the tools array, serialised. */
function measure(label: string, tools: readonly WireTool[]): Measurement {
  const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
  const tokens = Math.round(bytes / BYTES_PER_TOKEN);
  return {
    label,
    tools: tools.length,
    bytes,
    tokens,
    tokensPerTool: tools.length === 0 ? 0 : Math.round(tokens / tools.length),
  };
}

function report(m: Measurement): void {
  // Printed on purpose: a threshold that passes silently tells a human nothing about
  // which way the number is moving.
  console.log(
    `  tools-budget  ${m.label.padEnd(28)} ${String(m.tools).padStart(2)} tools  ` +
      `${String(m.bytes).padStart(5)} bytes  ${String(m.tokens).padStart(4)} tokens  ` +
      `${String(m.tokensPerTool).padStart(3)} tokens/tool`,
  );
}

describe("tool-list budget", () => {
  test("tier 0 alone is under 400 tokens, measured on the wire", async () => {
    const tools = await listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["code_search"]);

    const m = measure("tier 0 (no engine)", tools);
    report(m);

    expect(m.tokens).toBeLessThan(TIER0_CEILING_TOKENS);
    // The measured 153/tool floor. Below it, something has stripped the description
    // that §11 spends its budget on, which is a regression in the other direction.
    expect(m.tokens).toBeGreaterThan(100);
  }, 30_000);

  test("tier 0 + 1 is under 1,200 tokens for the widest engine on the wire", async () => {
    // mnemex declares eight of nine capabilities — four of them tier-1 tools — which is
    // the largest set any shipped adapter puts on the wire. `findImplementations` has no
    // key, so `find_implementations` is absent.
    const tools = await listTools({
      engine: "mnemex",
      engines: { mnemex: { command: ABSENT_COMMAND } },
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "code_search",
      "find_dependencies",
      "find_dependents",
      "call_tree",
      "impact",
    ]);

    const m = measure("tier 0+1 (mnemex)", tools);
    report(m);

    expect(m.tokens).toBeLessThan(TIER0_PLUS_1_CEILING_TOKENS);
  }, 30_000);

  test("switching to serena changes WHICH tools are listed, not just how many", async () => {
    // The budget half of the switch, and the reason this is not merely a smaller number:
    // serena and mnemex overlap on `find_dependents` and diverge everywhere else, so a
    // tool set that only shrank would mean the capability gate is counting rather than
    // reading. serena's outgoing-edge tools are absent because it has no outgoing edge;
    // `find_implementations` is present because it is the one thing mnemex cannot do.
    const tools = await listTools({
      engine: "serena",
      engines: { serena: { command: ABSENT_COMMAND } },
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "code_search",
      "find_dependents",
      "find_implementations",
    ]);

    const m = measure("tier 0+1 (serena)", tools);
    report(m);

    expect(m.tokens).toBeLessThan(TIER0_PLUS_1_CEILING_TOKENS);
  }, 30_000);

  test("the complete tier-0+1 set — all six TOOLS — still fits under 1,200", async () => {
    // Six tools, not six engines: tier 0 plus all five tier-1 descriptors. Neither
    // shipped adapter declares all five tier-1 capabilities — mnemex is missing
    // `findImplementations`, serena is missing three — so this set cannot be put on the
    // wire today. It is measured from the same descriptors the server serialises,
    // through the same encoder, so it is the ceiling that binds the day an engine does
    // declare them all.
    const wire: WireTool[] = [TIER0_TOOL, ...Object.values(TIER1_TOOLS)]
      .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    expect(wire.length).toBe(6);

    const m = measure("tier 0+1 (all six)", wire);
    report(m);

    expect(m.tokens).toBeLessThan(TIER0_PLUS_1_CEILING_TOKENS);
  });

  test("tier 2 contributes nothing to the budget in this release", async () => {
    const tools = await listTools({
      engine: "mnemex",
      engines: { mnemex: { command: ABSENT_COMMAND } },
      passthrough: { enabled: false },
    });
    // Built from the live engine list rather than a hand-typed alternation, so an
    // engine added tomorrow is covered without anyone remembering this line.
    const tier2 = new RegExp(`^(?:${ENGINE_IDS.join("|")})_`, "u");
    const prefixed = tools.filter((tool) => tier2.test(tool.name));
    expect(prefixed).toEqual([]);
  }, 30_000);
});
