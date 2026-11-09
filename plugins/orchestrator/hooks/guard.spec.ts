import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sandbox, runBun, type Sandbox } from "../scripts/lib/process-testdata";
import { identity, claim, MANAGER, SELF } from "../tests/testdata";

const spaces: Sandbox[] = [];
const space = () => { const s = sandbox(); spaces.push(s); return s; };
afterEach(() => { for (const s of spaces.splice(0)) s.cleanup(); });
const event = (patch: Record<string, unknown> = {}) => JSON.stringify({
  session_id: SELF, hook_event_name: "PreToolUse", tool_name: "Bash",
  tool_input: { command: "gh issue create --title x" }, ...patch,
});

describe("guard process [R3.3–R3.4; §4.3, §6 Hook processes]", () => {
  test("[REQ-15, REQ-16] TEST-701 owned manager emits only the deny envelope and exits zero", async () => {
    const s = space();
    s.identity(identity()); s.alias(SELF, MANAGER);
    const before = readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8");
    const r = await runBun(s, "hooks/guard.ts", [], event());
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse", permissionDecision: "deny",
        permissionDecisionReason: expect.any(String),
      },
    });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/triage/);
    expect(readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8")).toBe(before);
    const allowed = await runBun(s, "hooks/guard.ts", [], event({ tool_input: { command: "gh issue view 7" } }));
    expect(allowed).toEqual({ code: 0, stdout: "", stderr: "" });
  });
  for (const role of ["triage", "child"] as const) {
    test(`[REQ-15, REQ-16] TEST-702 role ${role} comes from stdin identity, not inherited environment`, async () => {
      const s = space();
      s.identity(identity({ role })); s.alias(SELF, MANAGER);
      const r = await runBun(s, "hooks/guard.ts", [], event(), {
        CLAUDE_CODE_SESSION_ID: "different1", ORCHESTRATOR_ROLE: role === "triage" ? "child" : "triage",
        ORCHESTRATOR_NAME: "pretend", ORCHESTRATOR_TICKET: "DEMO-7",
      });
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      if (role === "triage") expect(r.stdout).toBe("");
      else expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(/manager/) });
    });
  }
  test("[REQ-15, REQ-16] TEST-703 a stale alias owned by another id is unbound even when the old role was child", async () => {
    const s = space();
    s.identity(identity({ sessionId: "newid001", role: "child", previousIds: [SELF] }));
    s.alias(SELF, MANAGER);
    expect(await runBun(s, "hooks/guard.ts", [], event())).toEqual({ code: 0, stdout: "", stderr: "" });
  });
  test("[REQ-15, REQ-16] TEST-704 missing index fast path does not consume an inherited claim or create files", async () => {
    const s = space();
    s.claim(claim());
    const before = readdirSync(join(s.ctx.stateDir, "sessions"));
    const claimBefore = readFileSync(join(s.ctx.stateDir, "claims", MANAGER + ".json"), "utf8");
    const r = await runBun(s, "hooks/guard.ts", [], event(), { ORCHESTRATOR_CLAIM: MANAGER, ORCHESTRATOR_ROLE: "child" });
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(readdirSync(join(s.ctx.stateDir, "sessions"))).toEqual(before);
    expect(readdirSync(join(s.ctx.stateDir, "by-session"))).toEqual([]);
    expect(readFileSync(join(s.ctx.stateDir, "claims", MANAGER + ".json"), "utf8")).toBe(claimBefore);
  });
  for (const bad of ["", "{", "null", "[]", JSON.stringify({ tool_name: "Bash" }), event({ session_id: "../outside" })]) {
    test(`[REQ-15, REQ-16] TEST-705 malformed/missing input fails open silently: ${JSON.stringify(bad)}`, async () => {
      const s = space();
      expect(await runBun(s, "hooks/guard.ts", [], bad)).toEqual({ code: 0, stdout: "", stderr: "" });
    });
  }
  test("[REQ-15, REQ-16] TEST-705 corrupt identity and corrupt alias fail open rather than block plain work", async () => {
    const s = space();
    s.alias(SELF, MANAGER);
    writeFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "{");
    expect(await runBun(s, "hooks/guard.ts", [], event())).toEqual({ code: 0, stdout: "", stderr: "" });
    s.alias(SELF, "../badpath");
    expect(await runBun(s, "hooks/guard.ts", [], event())).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
