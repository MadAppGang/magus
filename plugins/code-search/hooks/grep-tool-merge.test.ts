/**
 * grep-tool-merge.test.ts — the PostToolUse hook for the Grep tool (P8).
 *
 * The process rows spawn the hook directly from this test, so its `process.ppid` is this
 * process's pid and the socket it looks for is `<TMPDIR>/code-search-<uid>/<process.pid>.sock`,
 * where a fake `node:http` server listens.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  blockText,
  capture,
  fields,
  frameOf,
  makeWorld,
  startFakeServer,
  type Answer,
  type FakeServer,
  type World,
} from "../test-support/grep-merge-harness";
import { blockOf } from "../mcp/grep/block";
import { isToolError, readPayload, requestBody } from "./grep-tool-merge";

const HOOK = join(import.meta.dir, "grep-tool-merge.ts");
const BLOCK = blockText();

describe("pure parts", () => {
  test("requestBody is the P4 kind-T layout", () => {
    const body = Buffer.from(requestBody(42, 7, "/w", { pattern: "abc", "-n": true }));
    expect(body.toString("utf8")).toBe('CSM1\0T\x0042\x007\0/w\0{"pattern":"abc","-n":true}\0');
  });

  test("blockOf accepts exactly a valid frame", () => {
    expect(blockOf(frameOf(BLOCK))).toBe(BLOCK);
    const len = Buffer.byteLength(BLOCK);
    const end = "--- end code-search ---\n";
    for (const bad of [
      frameOf(BLOCK, len - 1),
      frameOf(BLOCK, len + 1),
      Buffer.from("CSM1 0\n"),
      Buffer.concat([Buffer.from(`CSM1 0${len}\n`), Buffer.from(BLOCK)]),
      Buffer.concat([Buffer.from(`CSM1 ${len}`), Buffer.from(BLOCK)]),
      frameOf(BLOCK.replace("--- code-search: ", "--- codesearch: ")),
      frameOf(BLOCK.slice(0, -1)),
      frameOf(BLOCK.replace("\n--- end code-search ---", "--- end code-search ---")),
      frameOf(`--- code-search: x ---\n${"y".repeat(16_385)}\n${end}`),
      // Header and end marker with no line between: the wrapper's L ≥ 4 rule (glm-5.3 LOW).
      frameOf(`--- code-search: 0 related ---\n${end}`),
      Buffer.alloc(0),
      Buffer.concat([Buffer.from("CSM1 3\n"), Buffer.from([0xff, 0xfe, 0x0a])]),
    ]) {
      expect(blockOf(bad)).toBeUndefined();
    }
  });

  test("readPayload needs tool_input and cwd, and no tool error", () => {
    expect(readPayload({ tool_input: { pattern: "abc" }, cwd: "/w" })).toEqual({ cwd: "/w", toolInput: { pattern: "abc" } });
    expect(readPayload({ tool_input: { pattern: "abc" }, cwd: "/w", tool_response: { mode: "content", numFiles: 0 } })).toBeDefined();
    for (const bad of [null, [], "x", { cwd: "/w" }, { tool_input: {} }, { tool_input: [], cwd: "/w" }, { tool_input: {}, cwd: "" }]) {
      expect(readPayload(bad)).toBeUndefined();
    }
    expect(readPayload({ tool_input: {}, cwd: "/w", tool_response: "Error: bad regex" })).toBeUndefined();
    expect(isToolError({ is_error: true })).toBe(true);
    expect(isToolError({ error: "x" })).toBe(true);
    expect(isToolError({ mode: "files", filenames: [] })).toBe(false);
    expect(isToolError(undefined)).toBe(false);
  });
});

describe("hook process", () => {
  let w: World;
  let server: FakeServer | undefined;

  beforeEach(() => {
    w = makeWorld();
    server = undefined;
  });

  afterEach(async () => {
    await server?.close();
    w.cleanup();
  });

  async function serve(answer: (body: Buffer) => Answer): Promise<FakeServer> {
    server = await startFakeServer(w.sock, answer);
    return server;
  }

  async function hook(payload: unknown, env: Record<string, string> = {}, cwd = w.root): Promise<{ rc: number; stdout: string; stderr: string; ms: number }> {
    return capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", HOOK], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: w.home, TMPDIR: w.tmp, ...env },
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  const PAYLOAD = {
    hook_event_name: "PostToolUse",
    tool_name: "Grep",
    cwd: "/w",
    tool_input: { pattern: "fetchUserProfile", output_mode: "content", "-n": true },
    tool_response: { mode: "content", numFiles: 0, filenames: [], content: "src/a.ts:1:x", numLines: 1 },
  };

  test("a valid frame: stdout is exactly the additionalContext JSON", async () => {
    const s = await serve(() => frameOf(BLOCK));
    const r = await hook(PAYLOAD);
    expect(r).toMatchObject({ rc: 0, stderr: "" });
    expect(r.stdout).toBe(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: BLOCK } }));
    expect(s.requests).toHaveLength(1);
  });

  test("the request bytes for a fixed payload, with the payload's cwd, not the process's", async () => {
    const s = await serve(() => "CSM1 0\n");
    const r = await hook(PAYLOAD, {}, "/tmp");
    expect(r).toEqual({ rc: 0, stdout: "", stderr: "", ms: r.ms });
    expect(s.requests).toHaveLength(1);
    const f = fields(s.requests[0] ?? Buffer.alloc(0));
    expect(f[0]).toBe("CSM1");
    expect(f[1]).toBe("T");
    expect(f[2]).toBe(String(process.pid));
    expect(f[3]).toMatch(/^[1-9][0-9]*$/u);
    expect(f.slice(4)).toEqual(["/w", JSON.stringify(PAYLOAD.tool_input)]);
  });

  test("the same frame with n off by one: empty stdout", async () => {
    await serve(() => frameOf(BLOCK, Buffer.byteLength(BLOCK) + 1));
    expect(await hook(PAYLOAD)).toMatchObject({ rc: 0, stdout: "", stderr: "" });
  });

  test("offset 5: the request is still sent; the server's CSM1 0 leaves stdout empty", async () => {
    const s = await serve(() => "CSM1 0\n");
    const r = await hook({ ...PAYLOAD, tool_input: { ...PAYLOAD.tool_input, offset: 5 } });
    expect(r).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(s.requests).toHaveLength(1);
  });

  test("a server that never answers: exit 0, empty stdout, within 1500 + 200 ms", async () => {
    await serve(() => "hang");
    const r = await hook(PAYLOAD);
    expect(r).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(r.ms).toBeLessThan(1_500 + 200 + 300);
  });

  test.each([
    ["CODE_SEARCH_MERGE=0", PAYLOAD, { CODE_SEARCH_MERGE: "0" }],
    ["a tool error", { ...PAYLOAD, tool_response: "Error: invalid regex" }, {}],
    ["no tool_input", { cwd: "/w" }, {}],
    ["not JSON", "{nope", {}],
  ] as const)("%s: no request, silent", async (_name, payload, env) => {
    const s = await serve(() => frameOf(BLOCK));
    expect(await hook(payload, { ...env })).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(s.requests).toHaveLength(0);
  });

  test("no socket: silent", async () => {
    expect(await hook(PAYLOAD)).toMatchObject({ rc: 0, stdout: "", stderr: "" });
  });

  // Review round 1, Codex C6: the hook trusts a socket only under the shared rule. Another
  // OS user who pre-creates the path must receive nothing.
  test("a socket dir that is not 0700: no request, silent", async () => {
    const s = await serve(() => frameOf(BLOCK));
    chmodSync(w.sockDir, 0o755);
    expect(await hook(PAYLOAD)).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(s.requests).toHaveLength(0);
  });

  test("a symlinked socket dir: no request, silent", async () => {
    const s = await serve(() => frameOf(BLOCK));
    const other = join(w.root, "t2");
    mkdirSync(other);
    symlinkSync(w.sockDir, join(other, basename(w.sockDir)));
    expect(await hook(PAYLOAD, { TMPDIR: other })).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(s.requests).toHaveLength(0);
  });

  // Review round 2, Codex HIGH: a ripgrep config can change what the Grep tool matched
  // (--invert-match, --files-without-match, context), so no superset rule holds. With
  // RIPGREP_CONFIG_PATH set the hook sends nothing.
  test("RIPGREP_CONFIG_PATH set: no request, silent", async () => {
    const s = await serve(() => frameOf(BLOCK));
    expect(await hook(PAYLOAD, { RIPGREP_CONFIG_PATH: join(w.root, "rgrc") })).toMatchObject({ rc: 0, stdout: "", stderr: "" });
    expect(s.requests).toHaveLength(0);
    // An empty value is no config: the hook proceeds.
    expect((await hook(PAYLOAD, { RIPGREP_CONFIG_PATH: "" })).stdout).not.toBe("");
    expect(s.requests).toHaveLength(1);
  });

  // Review round 2, Codex HIGH (no `exec` in the launcher): the session pid arrives in
  // CODE_SEARCH_SESSION_PID, so the hook no longer depends on being its shell's exec.
  test("CODE_SEARCH_SESSION_PID names the session socket and the request's ppid", async () => {
    const sock = join(w.sockDir, "4242.sock");
    const s = await startFakeServer(sock, () => frameOf(BLOCK));
    try {
      const r = await hook(PAYLOAD, { CODE_SEARCH_SESSION_PID: "4242" });
      expect(r.stdout).toBe(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: BLOCK } }));
      expect(fields(s.requests[0] ?? Buffer.alloc(0)).slice(0, 3)).toEqual(["CSM1", "T", "4242"]);
      // Not a pid: the hook falls back to its own parent, which has no socket here.
      expect((await hook(PAYLOAD, { CODE_SEARCH_SESSION_PID: "x1" })).stdout).toBe("");
      expect(s.requests).toHaveLength(1);
    } finally {
      await s.close();
    }
  });

  test("a regular file at the socket path: silent", async () => {
    writeFileSync(w.sock, "not a socket");
    expect(await hook(PAYLOAD)).toMatchObject({ rc: 0, stdout: "", stderr: "" });
  });
});
