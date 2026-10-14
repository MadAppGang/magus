import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { blockOf } from "../mcp/grep/block";
import { sessionPid } from "../mcp/grep/socket";
import { isToolError, readPayload, requestBody, ripgrepConfigApplies } from "../hooks/grep-tool-merge";
import { baseEnv, blockText, capture, frameOf, makeWorld, startFakeServer } from "../test-support/grep-merge-harness";

const hook = resolve(import.meta.dir, "../hooks/grep-tool-merge.ts");
const valid = blockText("WORD");
for (const [name, response, expected] of [
  ["valid", frameOf(valid), valid],
  ["zero", Buffer.from("CSM1 0\n"), undefined],
  ["n too short", frameOf(valid, Buffer.byteLength(valid) - 1), undefined],
  ["n too long", frameOf(valid, Buffer.byteLength(valid) + 1), undefined],
  ["invalid utf8", Buffer.concat([Buffer.from("CSM1 4\n"), Buffer.from([0xff, 0xff, 0xff, 0xff])]), undefined],
  ["no entry", frameOf('--- code-search: 0 related locations ---\n--- end code-search ---\n'), undefined],
  ["no final newline", frameOf(valid.trimEnd()), undefined],
] as const) {
  test(`R12.8 P8 blockOf ${name} validates all frame bytes`, () => {
    expect(blockOf(response)).toBe(expected);
  });
}
test("R12.8 P8 requestBody serializes T request with exact NUL fields", () => {
  expect(Buffer.from(requestBody(123, 456, "/w", { pattern: "π", head_limit: 1 })))
    .toEqual(Buffer.from(['CSM1', 'T', '123', '456', '/w', '{"pattern":"π","head_limit":1}', ''].join('\0')));
});
test("R12.8 P8 payload accepts only successful object with cwd and tool_input", () => {
  const input = { pattern: "WORD" };
  expect(readPayload({ cwd: "/w", tool_input: input, tool_response: {} }))
    .toEqual({ cwd: "/w", toolInput: input });
  for (const bad of [null, [], {}, { cwd: "", tool_input: input }, { cwd: "/w", tool_input: [] },
    { cwd: "/w", tool_input: input, tool_response: "error" }]) {
    expect(readPayload(bad)).toBeUndefined();
  }
});
for (const [response, error] of [
  [undefined, false], [null, false], ["failed", true], [{ is_error: true }, true],
  [{ isError: true }, true], [{ error: 0 }, true], [{ error: false }, false], [{ error: null }, false],
] as const) {
  test(`R12.8 P8 isToolError(${JSON.stringify(response)}) returns ${error}`, () => {
    expect(isToolError(response)).toBe(error);
  });
}
test("R12.8 P8 ripgrep config only blocks when non-empty", () => {
  expect(ripgrepConfigApplies({})).toBe(false);
  expect(ripgrepConfigApplies({ RIPGREP_CONFIG_PATH: "" })).toBe(false);
  expect(ripgrepConfigApplies({ RIPGREP_CONFIG_PATH: "/config" })).toBe(true);
});
test("R12.5 P4 session pid accepts a decimal id greater than one", () => {
  expect(sessionPid({ CODE_SEARCH_SESSION_PID: "345" }, 77)).toBe(345);
  for (const value of ["0", "1", "01", "-2", "3.0", "a", "12345678901", ""]) {
    expect(sessionPid({ CODE_SEARCH_SESSION_PID: value }, 77)).toBe(77);
  }
});

const payload = (cwd: string, input: Record<string, unknown> = { pattern: "WORD" }) =>
  JSON.stringify({ tool_name: "Grep", cwd, tool_input: input, tool_response: {} });
for (const [name, answer, expected] of [
  ["valid", frameOf(valid), valid],
  ["zero", "CSM1 0\n", undefined],
  ["missing entry", frameOf('--- code-search: none ---\n--- end code-search ---\n'), undefined],
  ["wrong size", frameOf(valid, Buffer.byteLength(valid) + 1), undefined],
] as const) {
  test(`R12.8 P8 PostToolUse ${name} response emits only a valid context line`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => answer);
    try {
      const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", hook], {
        cwd: w.root, env: baseEnv(w, { CODE_SEARCH_SESSION_PID: String(process.pid) }),
        input: payload(w.cwd),
      });
      expect({ rc: r.rc, stderr: r.stderr, stdout: r.stdout, requests: server.requests.length }).toEqual({
        rc: 0, stderr: "", stdout: expected === undefined ? "" :
          // R12.8 step 9: stdout is exactly JSON.stringify(...), no trailing newline.
          JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: expected } }),
        requests: 1,
      });
      expect(server.requests[0]).toEqual(Buffer.from(requestBody(process.pid, Number(server.requests[0]!.toString("utf8").split("\0")[3]), w.cwd, { pattern: "WORD" })));
    } finally { await server.close(); w.cleanup(); }
  });
}
test("R12.8 P8 offset still sends exactly one request and prints nothing on zero frame", async () => {
  const w = makeWorld();
  const server = await startFakeServer(w.sock, () => "CSM1 0\n");
  try {
    const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", hook], {
      cwd: w.root, env: baseEnv(w, { CODE_SEARCH_SESSION_PID: String(process.pid) }),
      input: payload(w.cwd, { pattern: "WORD", offset: 5 }),
    });
    expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr, requests: server.requests.length, fields: server.requests[0]!.toString("utf8").split("\0").slice(0, 3) })
      .toEqual({ rc: 0, stdout: "", stderr: "", requests: 1, fields: ["CSM1", "T", String(process.pid)] });
  } finally { await server.close(); w.cleanup(); }
});
for (const [name, env] of [
  ["kill switch", { CODE_SEARCH_MERGE: "0" }],
  ["ripgrep config", { RIPGREP_CONFIG_PATH: "/config" }],
] as const) {
  test(`R12.8 P8 ${name} makes no socket request`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(valid));
    try {
      const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", hook], {
        cwd: w.root, env: baseEnv(w, { CODE_SEARCH_SESSION_PID: String(process.pid), ...env }), input: payload(w.cwd),
      });
      expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr, requests: server.requests.length })
        .toEqual({ rc: 0, stdout: "", stderr: "", requests: 0 });
    } finally { await server.close(); w.cleanup(); }
  });
}
test("R12.8 P8 nonempty RIPGREP_CONFIG_PATH is the only config veto", async () => {
  const w = makeWorld();
  const server = await startFakeServer(w.sock, () => frameOf(valid));
  try {
    const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", hook], {
      cwd: w.root, env: baseEnv(w, { CODE_SEARCH_SESSION_PID: String(process.pid), RIPGREP_CONFIG_PATH: "" }), input: payload(w.cwd),
    });
    expect({ rc: r.rc, stderr: r.stderr, requests: server.requests.length }).toEqual({ rc: 0, stderr: "", requests: 1 });
  } finally { await server.close(); w.cleanup(); }
});
test("R12.8 P8 hanging socket times out silently once", async () => {
  const w = makeWorld();
  const server = await startFakeServer(w.sock, () => "hang");
  try {
    const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", hook], {
      cwd: w.root, env: baseEnv(w, { CODE_SEARCH_SESSION_PID: String(process.pid) }), input: payload(w.cwd),
    });
    expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr, requests: server.requests.length })
      .toEqual({ rc: 0, stdout: "", stderr: "", requests: 1 });
    expect(r.ms).toBeLessThan(1700);
  } finally { await server.close(); w.cleanup(); }
}, 10_000);
