/**
 * Tests for the MCP stdio client. These spawn REAL child processes — the fixture in
 * `__fixtures__/echo-server.ts` — because every behaviour under test is a property of
 * process lifecycle, and a mocked child would assert only that the mock was written
 * to match the code.
 *
 * Run: bun test plugins/code-analysis/mcp/transport/
 *
 * The §C deadlines are 300s idle and 30s per call. Waiting on those would make the
 * suite useless, so each test injects compressed values through `McpClientOptions` —
 * which is precisely why they are options and not module constants. Nothing here
 * sleeps for a production timeout.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_CLIENT_DEFAULTS,
  makeMcpClient,
  type McpClient,
  type McpClientOptions,
} from "./mcp-stdio-client";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "__fixtures__", "echo-server.ts");

/**
 * Compressed deadlines. Same shape as production, three orders of magnitude smaller.
 *
 * `callMs` is 2000, NOT the 200 it started at. Every case here spawns a real `bun`
 * child, and a cold spawn on a loaded machine was measured at 170-620 ms against that
 * 200 ms deadline — so the timeout tests raced the spawn they were timing and two of
 * them failed intermittently when the suite ran back-to-back. The deadline under test
 * has to be comfortably longer than the process startup that precedes it, or the test
 * measures the machine rather than the client.
 *
 * A flaky test is worse than no test: it trains everyone to re-run rather than read.
 * Cases that genuinely need a short deadline pass their own via `harness({ callMs })`,
 * where the value is local and its reason is visible.
 */
const FAST: McpClientOptions = {
  idleMs: 250,
  callMs: 2_000,
  maxRestarts: 3,
  backoffMs: [5, 10, 20],
  log: () => {},
};

interface Harness {
  client: McpClient;
  /** Pids of every child the fixture has started, oldest first. */
  starts(): number[];
}

const live: McpClient[] = [];
const scratch: string[] = [];

function harness(
  opts: Partial<McpClientOptions> = {},
  env: Record<string, string> = {},
  command?: string,
): Harness {
  const dir = mkdtempSync(join(tmpdir(), "mcp-transport-"));
  scratch.push(dir);
  const pidFile = join(dir, "pids");

  const client = makeMcpClient(
    {
      engineId: "echo",
      command: command ?? process.execPath,
      args: command ? [] : [FIXTURE],
      env: { ...env, ECHO_PIDFILE: pidFile },
      cwd: dir,
    },
    { ...FAST, ...opts },
  );
  live.push(client);

  return {
    client,
    starts: () => {
      let raw = "";
      try {
        raw = readFileSync(pidFile, "utf8");
      } catch {
        return [];
      }
      return raw.split("\n").filter(Boolean).map(Number);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function untilGone(pid: number, budgetMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await sleep(10);
  }
  return !alive(pid);
}

/** The MCP text payload the fixture returns, unwrapped for readability. */
function text(content: unknown): string {
  const first = Array.isArray(content) ? content[0] : undefined;
  if (typeof first === "object" && first !== null && "text" in first) {
    return String((first as { text: unknown }).text);
  }
  return "";
}

afterEach(async () => {
  // Every child must be gone before the next test, and `dispose` is the only thing
  // that may end one. A survivor here is the "hung engine holds the facade open"
  // failure, caught in the test that created it rather than at suite exit.
  const clients = live.splice(0, live.length);
  await Promise.all(clients.map((c) => c.dispose()));
  for (const dir of scratch.splice(0, scratch.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("handshake and round trip", () => {
  test("initializes, lists tools and calls one", async () => {
    const { client } = harness();

    const listed = await client.listTools();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.tools.map((t) => t.name)).toEqual(["echo", "history"]);
    expect(listed.tools[0]?.description).toBe("Returns its arguments verbatim.");

    const called = await client.call("echo", { text: "hello" });
    expect(called.ok).toBe(true);
    if (!called.ok) return;
    expect(called.isError).toBe(false);
    expect(JSON.parse(text(called.content))).toEqual({ text: "hello" });
  });

  test("sends initialize then the initialized notification, before any tool traffic", async () => {
    const { client } = harness();

    const called = await client.call("history", {});
    expect(called.ok).toBe(true);
    if (!called.ok) return;
    expect(JSON.parse(text(called.content))).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
  });

  test("spawns nothing until the first request", async () => {
    const h = harness();
    await sleep(50);
    expect(h.starts()).toEqual([]);

    await h.client.listTools();
    expect(h.starts()).toHaveLength(1);
  });

  test("reuses one child across calls", async () => {
    const h = harness();
    await h.client.call("echo", {});
    await h.client.call("echo", {});
    await h.client.listTools();
    expect(h.starts()).toHaveLength(1);
  });

  test("serves concurrent calls on one child, correlating by id", async () => {
    const h = harness();
    const results = await Promise.all([
      h.client.call("echo", { n: 1 }),
      h.client.call("echo", { n: 2 }),
      h.client.call("echo", { n: 3 }),
    ]);
    const seen = results.map((r) => (r.ok ? JSON.parse(text(r.content)).n : null));
    expect(seen.sort()).toEqual([1, 2, 3]);
    expect(h.starts()).toHaveLength(1);
  });
});

describe("stdout that is not JSON-RPC", () => {
  test("survives a banner printed before the first message", async () => {
    const { client } = harness({}, { ECHO_SCENARIO: "banner" });

    const called = await client.call("echo", { text: "after the banner" });
    expect(called.ok).toBe(true);
    if (!called.ok) return;
    expect(JSON.parse(text(called.content))).toEqual({ text: "after the banner" });
  });

  test("skips a non-JSON line mid-session without losing the response after it", async () => {
    const { client } = harness();

    const called = await client.call("garbage_then_ok", {});
    expect(called.ok).toBe(true);
    if (!called.ok) return;
    expect(text(called.content)).toBe("ok despite the noise");
  });
});

describe("failures become notes, never throws", () => {
  test("a call that misses its deadline resolves to a note and kills the child", async () => {
    // This case OWNS its deadline, because it asserts on it. Derived from the constant
    // rather than written twice, so changing one cannot leave the other stale.
    const DEADLINE_MS = 200;
    const h = harness({ callMs: DEADLINE_MS });

    const called = await h.client.call("slow", {});
    expect(called.ok).toBe(false);
    if (called.ok) return;
    expect(called.note.code).toBe("backend_unavailable");
    expect(called.note.level).toBe("error");
    expect(called.note.message).toContain(`did not answer slow within ${DEADLINE_MS}ms`);

    const pid = h.starts()[0];
    expect(pid).toBeDefined();
    expect(await untilGone(pid as number)).toBe(true);
  });

  test("a mid-session crash surfaces the child's own stderr", async () => {
    const { client } = harness();

    const called = await client.call("crash", {});
    expect(called.ok).toBe(false);
    if (called.ok) return;
    expect(called.note.code).toBe("backend_unavailable");
    expect(called.note.message).toContain("exited with code 3");
    expect(called.note.message).toContain("fatal: index segment 7 is corrupt");
  });

  test("a valid JSON-RPC response with the wrong result shape is a note", async () => {
    const { client } = harness();

    const called = await client.call("wrong_shape", {});
    expect(called.ok).toBe(false);
    if (called.ok) return;
    expect(called.note.code).toBe("backend_unavailable");
    expect(called.note.message).toContain("not an MCP tool result");
  });

  test("a tools/list result with no tools array is a note", async () => {
    const { client } = harness({}, { ECHO_SCENARIO: "bad-list" });

    const listed = await client.listTools();
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.note.message).toContain("no tools array");
  });

  test("a JSON-RPC error object is a note naming the upstream code", async () => {
    const { client } = harness();

    const called = await client.call("rpc_error", {});
    expect(called.ok).toBe(false);
    if (called.ok) return;
    expect(called.note.message).toContain("engine refused the call");
    expect(called.note.message).toContain("JSON-RPC -32000");
  });

  test("a missing binary is a note, not a spawn exception", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-transport-"));
    scratch.push(dir);
    const { client } = harness({}, {}, join(dir, "no-such-engine"));

    const called = await client.call("echo", {});
    expect(called.ok).toBe(false);
    if (called.ok) return;
    expect(called.note.code).toBe("backend_unavailable");
    expect(called.note.message).toContain("could not be started");
  });

  test("an upstream isError is an answer, not a transport failure", async () => {
    const { client } = harness();

    const called = await client.call("boom", {});
    expect(called.ok).toBe(true);
    if (!called.ok) return;
    expect(called.isError).toBe(true);
    expect(text(called.content)).toBe("the engine could not answer that");
  });

  test("lastFailure is undefined until something fails", async () => {
    const { client } = harness();
    expect(client.lastFailure()).toBeUndefined();

    await client.call("echo", {});
    expect(client.lastFailure()).toBeUndefined();

    await client.call("wrong_shape", {});
    expect(client.lastFailure()?.code).toBe("backend_unavailable");
  });
});

describe("lifecycle", () => {
  test("kills an idle child and re-spawns on the next call", async () => {
    const h = harness({ idleMs: 120 });

    await h.client.call("echo", {});
    const first = h.starts()[0];
    expect(first).toBeDefined();

    expect(await untilGone(first as number)).toBe(true);

    const again = await h.client.call("echo", { text: "second life" });
    expect(again.ok).toBe(true);

    const pids = h.starts();
    expect(pids).toHaveLength(2);
    expect(pids[1]).not.toBe(pids[0]);
  });

  test("an idle kill is not a failure — it never counts toward the latch", async () => {
    const h = harness({ idleMs: 60 });

    for (let i = 0; i < 4; i++) {
      const r = await h.client.call("echo", {});
      expect(r.ok).toBe(true);
      // Poll rather than sleep past the deadline: the assertion is that each child
      // was reaped and replaced, and a fixed wait would only be a slower guess.
      const pid = h.starts()[i];
      expect(pid).toBeDefined();
      expect(await untilGone(pid as number)).toBe(true);
    }
    expect(h.client.isPermanentlyUnready()).toBe(false);
    expect(h.starts()).toHaveLength(4);
  });

  test("three consecutive start failures latch, and the fourth call spawns nothing", async () => {
    // Short deadline on purpose: this waits out THREE handshake timeouts in sequence,
    // so the suite's default would make one case cost six seconds on its own.
    const h = harness({ callMs: 300 }, { ECHO_SCENARIO: "refuse-handshake" });

    for (let i = 0; i < 3; i++) {
      const r = await h.client.call("echo", {});
      expect(r.ok).toBe(false);
    }
    expect(h.client.isPermanentlyUnready()).toBe(true);
    expect(h.starts()).toHaveLength(3);

    const fourth = await h.client.call("echo", {});
    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.note.message).toContain("will not be started again this session");
    // The latch carries the ORIGINAL crash reason as its remedy — the latch itself
    // says nothing a user could act on.
    expect(fourth.note.remedy).toContain("did not answer the handshake");
    expect(h.starts()).toHaveLength(3);
  });

  test("holds off each restart for its backoff step", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-transport-"));
    scratch.push(dir);
    // A missing binary fails in about a millisecond, so anything the clock shows
    // beyond a rounding error is the backoff and nothing else.
    const { client } = harness({ backoffMs: [150, 150, 150] }, {}, join(dir, "no-such-engine"));

    const started = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await client.call("echo", {});
      expect(r.ok).toBe(false);
    }
    // Two waits, because the first attempt has nothing to back off from.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(client.isPermanentlyUnready()).toBe(true);
  });

  test("a successful call clears the failure count", async () => {
    const h = harness();

    await h.client.call("crash", {});
    await h.client.call("echo", {});
    await h.client.call("crash", {});
    await h.client.call("echo", {});
    await h.client.call("crash", {});

    expect(h.client.isPermanentlyUnready()).toBe(false);
  });

  test("dispose kills the child, and later calls neither throw nor spawn", async () => {
    const h = harness();

    await h.client.call("echo", {});
    const pid = h.starts()[0];
    expect(pid).toBeDefined();

    await h.client.dispose();
    expect(await untilGone(pid as number)).toBe(true);

    const after = await h.client.call("echo", {});
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.note.message).toContain("disposed");
    expect(h.starts()).toHaveLength(1);
  });

  test("a SIGTERM to the host kills the child, and still terminates the host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-transport-"));
    scratch.push(dir);
    const pidFile = join(dir, "pids");

    // A real second process, because the two things asserted here are process-global:
    // that the client's signal handler reaps the child, and that installing that
    // handler does not swallow the default terminate and leave the facade running.
    // The engine runs the `cling` scenario so the teardown is the ONLY thing that can
    // end it: a fixture that quits on stdin EOF quits when the host exits, and the
    // test would then pass with the teardown deleted.
    const driver = `
      const { makeMcpClient } = await import(process.env.CLIENT_MODULE);
      const client = makeMcpClient(
        {
          engineId: "echo",
          command: process.execPath,
          args: [process.env.FIXTURE],
          env: { ECHO_PIDFILE: process.env.PIDFILE, ECHO_SCENARIO: "cling" },
          cwd: process.env.WORKDIR,
        },
        { idleMs: 60000, callMs: 5000, maxRestarts: 3, backoffMs: [1], log: () => {} },
      );
      await client.call("echo", {});
      console.log("ready");
      await new Promise(() => {});
    `;

    const host = spawn(process.execPath, ["-e", driver], {
      cwd: dir,
      env: {
        ...process.env,
        CLIENT_MODULE: join(HERE, "mcp-stdio-client.ts"),
        FIXTURE,
        PIDFILE: pidFile,
        WORKDIR: dir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const exited = new Promise<void>((resolve) => host.once("exit", () => resolve()));
    const ready = new Promise<void>((resolve, reject) => {
      const bail = setTimeout(() => reject(new Error("driver never became ready")), 10_000);
      host.stdout?.setEncoding("utf8");
      host.stdout?.on("data", (chunk: string) => {
        if (chunk.includes("ready")) {
          clearTimeout(bail);
          resolve();
        }
      });
    });
    await ready;

    const engine = readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number)[0];
    expect(engine).toBeDefined();

    host.kill("SIGTERM");
    await Promise.race([exited, sleep(10_000)]);
    expect(host.exitCode !== null || host.signalCode !== null).toBe(true);

    const reaped = await untilGone(engine as number);
    if (!reaped) {
      // A `cling` engine outlives everything by design, so a failure here would
      // otherwise leak a process for the rest of the machine's uptime.
      try {
        process.kill(engine as number, "SIGKILL");
      } catch {
        // Already gone between the poll and here.
      }
    }
    expect(reaped).toBe(true);
  }, 30_000);

  test("dispose is idempotent", async () => {
    const h = harness();
    await h.client.call("echo", {});
    await h.client.dispose();
    await h.client.dispose();
    expect(h.starts()).toHaveLength(1);
  });
});

describe("defaults", () => {
  test("carry the deadlines the design specifies", () => {
    expect(MCP_CLIENT_DEFAULTS).toEqual({
      idleMs: 300_000,
      callMs: 30_000,
      maxRestarts: 3,
      backoffMs: [1_000, 4_000],
    });
  });

  /**
   * The design is internally inconsistent here and this test records which side won.
   *
   * §C lists `backoffMs: [1_000, 4_000, 16_000]` while §E says three consecutive
   * failures latch. Both cannot hold: `recordFailure` latches at
   * `consecutiveFailures >= maxRestarts`, so with maxRestarts 3 only failures 1 and 2
   * ever schedule a retry and the third entry is unreachable. §E is the explicit
   * statement, so it wins and the dead entry is gone.
   *
   * Asserting the INVARIANT rather than the literal is the point: a future change that
   * raises maxRestarts without extending the backoff (or the reverse) fails here, which
   * a hardcoded array would not catch.
   */
  test("every backoff step is reachable — no dead config", () => {
    const { maxRestarts, backoffMs } = MCP_CLIENT_DEFAULTS;
    expect(backoffMs).toHaveLength(maxRestarts - 1);

    // Replay the step selection in recordFailure for every failure that does NOT latch,
    // and assert the highest index it can reach is the last one defined.
    const reached = new Set<number>();
    for (let failures = 1; failures < maxRestarts; failures++) {
      reached.add(Math.min(failures - 1, backoffMs.length - 1));
    }
    expect([...reached].sort((a, b) => a - b)).toEqual(backoffMs.map((_, i) => i));
  });
});
