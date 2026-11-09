import { describe, expect, test } from "bun:test";
import { herdrDetected, herdrIdsOf, herdrTitle, herdrLabels, herdrMetaArgv, herdrClearArgv } from "./herdr-meta";
import { record, taskRows, NOW, MANAGER } from "../../tests/testdata";

describe("herdr metadata [R2.1–R2.3; §4.5, final metadata decisions]", () => {
  test("[REQ-10, REQ-11] TEST-401 requires a detected herdr pane and honours forced tmux inside herdr", () => {
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-a", HERDR_TAB_ID: "tab-a", HERDR_WORKSPACE_ID: "workspace-a", TMUX: "inherited" };
    expect(herdrDetected(env)).toBe(true);
    expect(herdrIdsOf(env)).toEqual({ pane: "pane-a", tab: "tab-a", workspace: "workspace-a" });
    expect(herdrDetected({ ...env, ORCHESTRATOR_MULTIPLEXER: "tmux" })).toBe(false);
    expect(herdrIdsOf({ ...env, ORCHESTRATOR_MULTIPLEXER: "tmux" })).toBeNull();
    expect(herdrDetected({ HERDR_PANE_ID: "pane-a" })).toBe(false);
    expect(herdrDetected({ HERDR_ENV: "1" })).toBe(false);
    expect(herdrDetected({ HERDR_ENV: "yes", HERDR_PANE_ID: "pane-a" })).toBe(false);
    expect(herdrIdsOf({ ORCHESTRATOR_MULTIPLEXER: "herdr", HERDR_PANE_ID: "pane-a", HERDR_TAB_ID: "" })).toEqual({ pane: "pane-a", tab: null, workspace: null });
  });

  test("[REQ-10, REQ-11] TEST-402 only an explicit block marks title; idle labels omit session dependencies", () => {
    const r = record({
      tasks: taskRows(),
      deps: [
        { kind: "session", ref: "worker", since: NOW - 300, doneAt: null, note: null },
        { kind: "pr", ref: "https://github.com/example/product/pull/9", since: NOW - 200, doneAt: NOW - 100, note: null },
        { kind: "release", ref: "api 2.0", since: NOW - 100, doneAt: null, note: null },
      ],
    });
    expect(herdrTitle(r)).toBe("manager · example/product#7");
    expect(herdrLabels(r)).toEqual([
      "working=example/product#7 1/2",
      "idle=example/product#7 1/2 · waits release api 2.0",
      "blocked=example/product#7 needs you", "done=example/product#7 done",
    ]);
    expect(herdrTitle({ ...r, blocked: { reason: "choose", since: NOW } })).toBe("manager · example/product#7 · blocked");
    expect(herdrTitle({ ...r, ticket: null })).toBe("manager · api-manager");
    expect(herdrTitle({ ...r, ticket: null, name: null })).toBe("manager · " + MANAGER);
    expect(herdrLabels({ ...r, tasks: [], deps: [r.deps[0]!] })[1]).toBe("idle=example/product#7");
  });

  test("[REQ-10, REQ-11] TEST-403 publishes pane-first full labels with record updatedAt, clears both fields with current sequence", () => {
    const r = record({ herdr: { pane: "pane-a", tab: null, workspace: null }, updatedAt: NOW });
    expect(herdrMetaArgv(r, NOW + 99)).toEqual([
      "herdr", "pane", "report-metadata", "pane-a", "--source", "orchestrator",
      "--title", "manager · example/product#7",
      "--state-label", "working=example/product#7", "--state-label", "idle=example/product#7",
      "--state-label", "blocked=example/product#7 needs you", "--state-label", "done=example/product#7 done",
      "--seq", String(NOW),
    ]);
    expect(herdrMetaArgv({ ...r, herdr: null })).toBeNull();
    expect(herdrClearArgv("pane-a", NOW + 1)).toEqual([
      "herdr", "pane", "report-metadata", "pane-a", "--source", "orchestrator",
      "--clear-title", "--clear-state-labels", "--seq", String(NOW + 1),
    ]);
  });
});
