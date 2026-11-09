import { describe, expect, test } from "bun:test";
import { ownMuxOf, targetOf, jumpPlan, ownClientArgv, parseOwnClient, tmuxJumpSteps, captureArgv, openUrlArgvs } from "./mux";
import { record } from "../../tests/testdata";

describe("multiplexer actions [R1.6, R2.1–R2.3; §4.7]", () => {
  test("[REQ-6, REQ-9, REQ-11] TEST-1101 herdr wins over inherited tmux, unless explicitly forced", () => {
    const env = { tmuxPane: "%1", herdrEnv: "1", herdrPane: "pane-a" };
    expect(ownMuxOf(env)).toBe("herdr");
    expect(ownMuxOf({ ...env, multiplexer: "tmux" })).toBe("tmux");
    expect(ownMuxOf({ tmuxPane: "%1" })).toBe("tmux");
    expect(ownMuxOf({})).toBe("none");
    expect(targetOf(record({ herdr: { pane: "pane-a", tab: "tab-a", workspace: "workspace-a" } }), { tmux: "host:@1.%1" })).toEqual({ mux: "herdr", pane: "pane-a", tab: "tab-a" });
    expect(targetOf(record(), { tmux: "product:@95.%474" })).toEqual({ mux: "tmux", session: "product", window: "@95", pane: "%474" });
    expect(targetOf(record(), { tmux: "%474" })).toEqual({ mux: "tmux", session: null, window: null, pane: "%474" });
    expect(targetOf(record(), { tmux: "bad" })).toBeNull();
  });

  test("[REQ-6, REQ-9, REQ-11] TEST-1102 tmux Jump uses the own pane's client and a separate argv step for each focus action", () => {
    const target = { mux: "tmux" as const, pane: "%474", window: "@95", session: "other" };
    const plan = jumpPlan(target, "tmux");
    expect(plan).toEqual({ kind: "tmux", pane: "%474", window: "@95", session: "other" });
    if (plan.kind !== "tmux") throw new Error("Expected tmux Jump");
    expect(ownClientArgv("%12")).toEqual(["tmux", "display-message", "-p", "-t", "%12", "#{client_tty}\t#{session_name}"]);
    expect(parseOwnClient("/dev/ttys002\tcurrent\n")).toEqual({ tty: "/dev/ttys002", session: "current" });
    expect(parseOwnClient("")).toBeNull();
    expect(tmuxJumpSteps(plan, { tty: "/dev/ttys002", session: "current" })).toEqual([
      ["tmux", "switch-client", "-c", "/dev/ttys002", "-t", "other"],
      ["tmux", "select-window", "-t", "%474"], ["tmux", "select-pane", "-t", "%474"],
    ]);
    expect(tmuxJumpSteps(plan, { tty: "/dev/ttys002", session: "other" })).toEqual([
      ["tmux", "select-window", "-t", "%474"], ["tmux", "select-pane", "-t", "%474"],
    ]);
    const withoutClient = tmuxJumpSteps(plan, null);
    expect(withoutClient.some(argv => argv.includes("switch-client"))).toBe(false);
    expect(jumpPlan(target, "herdr")).toEqual({ kind: "unreachable" });
    expect(jumpPlan(null, "tmux")).toEqual({ kind: "none" });
  });

  test("[REQ-6, REQ-9, REQ-11] TEST-1103 herdr Jump, captures and browser opener remain argument vectors", () => {
    const target = { mux: "herdr" as const, pane: "pane-a", tab: "tab-a" };
    expect(jumpPlan(target, "herdr")).toMatchObject({ kind: "herdr", argv: ["herdr", "agent", "focus", "pane-a"] });
    expect(captureArgv(target)).toEqual(["herdr", "pane", "read", "pane-a", "--source", "visible", "--format", "text"]);
    expect(captureArgv({ mux: "tmux", pane: "%474", window: "@95", session: "product" })).toEqual(["tmux", "capture-pane", "-p", "-N", "-t", "%474"]);
    const url = "https://example.test/issue/7?q=a;b";
    expect(openUrlArgvs(url)).toEqual([["open", url], ["xdg-open", url]]);
  });
});
