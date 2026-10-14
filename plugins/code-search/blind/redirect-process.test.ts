import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseEnv, capture, makeWorld, startFakeServer, type World } from "../test-support/grep-merge-harness";

const entry = resolve(import.meta.dir, "../hooks/redirect-search-to-facade.ts");
const openSettings = (w: World, grep: Record<string, unknown> = {}, engine = "mnemex", enabled = true) => {
  mkdirSync(join(w.cwd, ".claude"), { recursive: true });
  writeFileSync(join(w.cwd, ".claude", "settings.json"), JSON.stringify({
    "code-search": { engine, engines: enabled ? { [engine]: { command: engine } } : {}, grep,
      adoption: { interceptBash: true, traceFile: join(w.root, "trace.log") } },
  }));
};
async function decision(w: World, command: string, extraEnv: Record<string, string> = {}, toolInput: Record<string, unknown> = {}) {
  const result = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", entry], {
    cwd: w.cwd, env: baseEnv(w, { CLAUDE_PROJECT_DIR: w.cwd, CODE_SEARCH_SESSION_PID: String(process.pid), ...extraEnv }),
    input: JSON.stringify({ tool_name: "Bash", cwd: w.cwd, tool_input: { command, ...toolInput } }),
  });
  expect(result.rc).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}
// R12.10 step 7: a step-aside allow writes this line to adoption.traceFile; an early allow
// (step 5 or 6) does not. Proves which rule allowed the call. The trace file's existing
// format prefixes each line with a timestamp, which R12.10 does not restate, so the line
// is matched by its ending.
const STEP_ASIDE = "  -> allowed: grep merge active";
const stepAsideTraced = (w: World) =>
  existsSync(join(w.root, "trace.log")) &&
  readFileSync(join(w.root, "trace.log"), "utf8").split("\n").some((l) => l.endsWith(STEP_ASIDE));
function expectDeny(stdout: string) {
  // R12.10: a deny is "one stdout line". The contract does not say whether the line carries
  // a terminating "\n" (R12.8's sibling hook prints exactly JSON.stringify, with none), so
  // accept at most one trailing "\n" and require no other newline.
  const body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  expect(body.length).toBeGreaterThan(0);
  expect(body.includes("\n")).toBe(false);
  const parsed = JSON.parse(body);
  expect(parsed).toEqual({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: expect.any(String),
  } });
  expect(parsed.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0);
}

test("R12.10 D11 grep steps aside with configured engine, socket and no sandbox", async () => {
  const w = makeWorld();
  openSettings(w);
  const server = await startFakeServer(w.sock, () => "CSM1 0\n");
  try {
    expect(await decision(w, "grep -rn WORD .")).toBe("");
    expect(stepAsideTraced(w)).toBe(true);
  } finally { await server.close(); w.cleanup(); }
});
test("R12.10 D11 grep stays subject to redirect if socket is absent", async () => {
  const w = makeWorld();
  openSettings(w);
  try { expectDeny(await decision(w, "grep -rn WORD .")); }
  finally { w.cleanup(); }
});
test("R12.10 D11 route-off keeps redirect even with a socket", async () => {
  const w = makeWorld();
  openSettings(w, { route: false });
  const server = await startFakeServer(w.sock, () => "CSM1 0\n");
  try { expectDeny(await decision(w, "grep -rn WORD .")); }
  finally { await server.close(); w.cleanup(); }
});
test("R12.10 D11 sandbox redirects grep, exact escape restores step-aside", async () => {
  const w = makeWorld();
  openSettings(w);
  writeFileSync(join(w.cwd, ".claude", "settings.local.json"), JSON.stringify({ sandbox: { enabled: true } }));
  const server = await startFakeServer(w.sock, () => "CSM1 0\n");
  try {
    expectDeny(await decision(w, "grep -rn WORD ."));
    expect(stepAsideTraced(w)).toBe(false);
    expect(await decision(w, "grep -rn WORD .", {}, { dangerouslyDisableSandbox: true })).toBe("");
    expect(stepAsideTraced(w)).toBe(true);
  } finally { await server.close(); w.cleanup(); }
});
for (const [label, engine, entryPresent] of [
  ["unconfigured", "mnemex", false],
  ["unshipped", "not-shipped", true],
] as const) {
  test(`R12.10 D11 ${label} engine permits grep and rg without redirect`, async () => {
    const w = makeWorld();
    openSettings(w, {}, engine, entryPresent);
    try {
      expect(await decision(w, "grep -rn WORD .")).toBe("");
      expect(await decision(w, "rg WORD .")).toBe("");
      // allowed at step 6 (engine not configured), never by the step aside
      expect(stepAsideTraced(w)).toBe(false);
    } finally { w.cleanup(); }
  });
}
