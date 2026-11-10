import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChildPaneArgs, SEND_KEYS, MAX_ENDED, parsePanesFile, serializePanesFile, reconcile, familyOf, parseSlotRegistry, occupantOf, shellInForeground, alternationRegex, parseAgentInfo, type PaneEntry, type PanesFile } from "./child-pane-core";

export const entry = (patch: Partial<PaneEntry> = {}): PaneEntry => ({ pane: "w1:p2", terminal: "term_2", name: "child-one", claim: "l-000000000003", dir: join(import.meta.dir, "testdata"), line: "launch child-one green", openedAt: 100, ...patch });
const file = (patch: Partial<PanesFile> = {}): PanesFile => ({ schema: 1, manager: "l-000000000002", main: "w1:p1", mainTerminal: "term_1", children: [entry()], ended: [], ...patch });
const capture = (name: string) => readFileSync(join(import.meta.dir, "testdata", name), "utf8");
const open = ["open", "--name", "child-one", "--colour", "green"];
function rejected(args: string[]) {
  const result = parseChildPaneArgs(args);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Bad CLI arguments accepted");
  expect(result.error).toMatch(/usage:/i);
}
test("[REQ-413] TEST-2801 every command has the specified default shape", () => {
  const cases = [
    [open, { cmd: "open", name: "child-one", colour: "green", pastLimit: false, noWait: false }],
    [["wait", "--pane", "w1:pA"], { cmd: "wait", pane: "w1:pA", until: "up", timeoutMs: 60000 }],
    [["prompt", "--pane", "w1:pA", "--prompt-file", "-"], { cmd: "prompt", pane: "w1:pA", promptFile: "-" }],
    [["send", "--pane", "w1:pA", "--key", "ENTER"], { cmd: "send", pane: "w1:pA", key: "enter" }],
    [["trust", "--pane", "w1:pA"], { cmd: "trust", pane: "w1:pA" }],
    [["retype", "--pane", "w1:pA"], { cmd: "retype", pane: "w1:pA" }],
    [["read", "--pane", "w1:pA"], { cmd: "read", pane: "w1:pA", lines: 60 }],
    [["list"], { cmd: "list" }], [["layout"], { cmd: "layout" }],
    [["close", "--pane", "w1:pA"], { cmd: "close", pane: "w1:pA", force: false }],
    [["close", "--pane", "w1:pA", "--force"], { cmd: "close", pane: "w1:pA", force: true }],
  ] as const;
  for (const [args, command] of cases) expect(parseChildPaneArgs(args)).toEqual({ ok: true, command });
});
test("[REQ-413] TEST-2802 open accepts both colour aliases and all launch fields literally", () => {
  const dir = join(import.meta.dir, "checkout with spaces");
  const expected = { cmd: "open", name: "child-one", colour: "green", dir, ticket: "#7", ticketUrl: "https://example.test/7", model: "model-X", effort: "high", launch: "wt --quiet", pastLimit: true, noWait: true } as const;
  expect(parseChildPaneArgs(["open", "--name", "child-one", "--color", "green", "--dir", dir, "--ticket", "#7", "--ticket-url", "https://example.test/7", "--model", "model-X", "--effort", "high", "--launch", "wt --quiet", "--past-limit", "--no-wait"])).toEqual({ ok: true, command: expected });
  for (const name of ["a", "0", "a".repeat(48), "repo.2_name-branch"]) for (const colour of ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan", "default"])
    expect(parseChildPaneArgs(["open", "--name", name, "--colour", colour]).ok).toBe(true);
  for (const bad of ["", "Upper", "-start", "a".repeat(49), "two words", "a/b"]) rejected(["open", "--name", bad, "--colour", "green"]);
  for (const bad of ["", "Green", "magenta"]) rejected(["open", "--name", "child-one", "--colour", bad]);
  expect(parseChildPaneArgs(["send", "--pane", "w1:pA", "--text", "--force"])).toEqual({ ok: true, command: { cmd: "send", pane: "w1:pA", text: "--force" } });
});
test("[REQ-413] TEST-2803 wait/read boundaries, repeated literal patterns and all normalised send keys", () => {
  for (const until of ["up", "detected", "idle", "working", "blocked", "done"] as const)
    expect(parseChildPaneArgs(["wait", "--pane", "p", "--until", until, "--timeout-ms", "1000"])).toEqual({ ok: true, command: { cmd: "wait", pane: "p", until, timeoutMs: 1000 } });
  expect(parseChildPaneArgs(["wait", "--pane", "p", "--pattern", "a.b", "--pattern", "(ready)", "--timeout-ms", "110000"])).toEqual({ ok: true, command: { cmd: "wait", pane: "p", patterns: ["a.b", "(ready)"], timeoutMs: 110000 } });
  for (const n of ["1", "500"]) expect(parseChildPaneArgs(["read", "--pane", "p", "--lines", n])).toEqual({ ok: true, command: { cmd: "read", pane: "p", lines: Number(n) } });
  expect(SEND_KEYS).toEqual(["enter", "escape", "up", "down", "left", "right", "tab", "backspace", "space", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  for (const key of SEND_KEYS) expect(parseChildPaneArgs(["send", "--pane", "p", "--text-file", "-", "--key", key.toUpperCase()])).toEqual({ ok: true, command: { cmd: "send", pane: "p", textFile: "-", key } });
});
const badArgs = [
  [], ["bogus"], [...open, "--colour", "red"], [...open, "--color", "red"], [...open, "--past-limit", "--past-limit"],
  ["open", "--name", "child-one"], ["open", "--colour", "green"], [...open, "--unknown"], [...open, "--dir"],
  ["wait"], ["wait", "--pane", ""], ["wait", "--pane", "p p"], ["wait", "--pane", "p\nq"],
  ["wait", "--pane", "p", "--until", "ready"], ["wait", "--pane", "p", "--until", "up", "--pattern", "x"],
  ["wait", "--pane", "p", "--pattern", ""], ["wait", "--pane", "p", "--pattern", "a\nb"],
  ["wait", "--pane", "p", "--until", "up", "--until", "idle"],
  ...["999", "110001", "-1", "1.5", "NaN", "Infinity"].map(n => ["wait", "--pane", "p", "--timeout-ms", n]),
  ...["0", "501", "-1", "1.5", "NaN"].map(n => ["read", "--pane", "p", "--lines", n]),
  ["prompt", "--pane", "p"], ["prompt", "--prompt-file", "-"], ["send", "--pane", "p"],
  ["send", "--pane", "p", "--text", "x", "--text-file", "-"], ["send", "--pane", "p", "--key", "ctrl+c"],
  ["send", "--pane", "p", "--key", "pageup"], ["trust"], ["retype"], ["read"], ["close"],
  ["list", "--pane", "p"], ["layout", "--force"], ["read", "--pane", "p", "extra"],
  ["send", "--pane", "p", "--text", "x", "--text", "y"],
];
for (const args of badArgs) test("[REQ-413] TEST-2804 rejects malformed argv " + JSON.stringify(args), () => rejected(args));
test("[REQ-414] TEST-2805 pane registry serialises with two spaces and a final newline", () => {
  const f = file();
  expect(serializePanesFile(f)).toBe(JSON.stringify(f, null, 2) + "\n");
  expect(parsePanesFile(serializePanesFile(f))).toEqual(f);
  for (const raw of [null, "", "{", "null", "[]", '{"schema":2}']) expect(parsePanesFile(raw)).toBeNull();
});
test("[REQ-414, REQ-435] TEST-2806 restart-reused ids are gone; changed main never discards independently witnessed children", () => {
  const f = file({ children: [entry(), entry({ pane: "w1:pA", terminal: "old_A", name: "reused" }), entry({ pane: "w1:p9", terminal: "old_9", name: "missing" })] });
  const live = new Map([["w1:p2", "term_2"], ["w1:pA", "replacement_A"]]);
  const result = reconcile(f, live, f.manager, "new-main", "new-main-terminal", 200);
  expect(result.live).toEqual([entry()]);
  expect(result.gone.map(e => e.name)).toEqual(["reused", "missing"]);
  expect(result.file).toEqual(file({ main: "new-main", mainTerminal: "new-main-terminal", children: [entry()], ended: [
    { pane: "w1:pA", name: "reused", at: 200, how: "gone" }, { pane: "w1:p9", name: "missing", at: 200, how: "gone" },
  ] }));
  expect(f.children).toHaveLength(3);
  expect(reconcile(f, live, "other-manager", "M", "term_M", 200).file).toEqual({ schema: 1, manager: "other-manager", main: "M", mainTerminal: "term_M", children: [], ended: [] });
  const oldEnded = Array.from({ length: 20 }, (_, i) => ({ pane: "old" + i, name: "old-" + i, at: i, how: "closed" as const }));
  const capped = reconcile(file({ ended: oldEnded }), new Map(), f.manager, f.main, f.mainTerminal, 200).file.ended;
  expect(MAX_ENDED).toBe(20); expect(capped).toHaveLength(20);
  expect(capped[0]!.pane).toBe("old1"); expect(capped.at(-1)!.how).toBe("gone");
});
test("[REQ-415, REQ-435] TEST-2807 a slot needs agent ownership, its live terminal and this manager's exact stamp", () => {
  const registry = JSON.parse(capture("tmux-mcp-herdr-registry.json")), layout = JSON.parse(capture("tmux-mcp-herdr-layout.json"));
  const live = new Map([["w1:p2", "term_2"], ["w1:p3", "term_3"]]);
  const check = (r: unknown, l: unknown) => parseSlotRegistry(r === null ? null : JSON.stringify(r), l === null ? null : JSON.stringify(l), live, "w1:p1");
  expect(check(registry, layout)).toEqual(new Set(["w1:p2"]));
  const variants = [
    [() => { registry.panes[0].owner = "acquired"; }],
    [() => { registry.panes[0].terminal_id = "stale"; }],
    [() => { layout.agents[0].agent_pane_id = "other-manager"; }],
    [() => { layout.agents[0].terminal_id = "stale"; }],
    [() => { layout.agents = []; }],
  ];
  for (const [change] of variants) {
    const savedR = structuredClone(registry), savedL = structuredClone(layout);
    change!(); expect(check(registry, layout)).toEqual(new Set());
    Object.assign(registry, savedR); Object.assign(layout, savedL);
  }
  expect(check(registry, null)).toEqual(new Set());
  expect(check(null, layout)).toBeNull();
  expect(check({ ...registry, version: 2 }, layout)).toBe("unreadable");
  expect(check(registry, { ...layout, version: 2 })).toBe("unreadable");
  expect(parseSlotRegistry("{", JSON.stringify(layout), live, "w1:p1")).toBe("unreadable");
  expect(parseSlotRegistry(JSON.stringify(registry), "{", live, "w1:p1")).toBe("unreadable");
});
test("[REQ-416] TEST-2808 familyOf partitions in tree order, counts slots once and splits from the last family member", () => {
  expect(familyOf(["M"], "M", [], new Set())).toEqual({ members: ["M"], children: [], slots: [], foreign: [], lastFamilyPane: "M" });
  expect(familyOf(["foreign", "M", "slot", "w1:p2", "tail"], "M", [entry()], new Set(["slot", "M", "w1:p2"]))).toEqual({
    members: ["M", "slot", "w1:p2"], children: ["w1:p2"], slots: ["slot"], foreign: ["foreign", "tail"], lastFamilyPane: "w1:p2",
  });
  expect(familyOf(["M", "a", "b"], "M", [], new Set())).toEqual({ members: ["M"], children: [], slots: [], foreign: ["a", "b"], lastFamilyPane: "M" });
  expect(familyOf(["M", "w1:p2", "slot"], "M", [entry()], new Set(["slot"])).lastFamilyPane).toBe("slot");
});
test("[REQ-416] TEST-2809 occupant classification accepts current/previous ids but never another record's agent", () => {
  const bound = { sessionId: "now", previousIds: ["before"] };
  for (const knownElsewhere of [true, false]) {
    expect(occupantOf(null, bound, knownElsewhere)).toBe("none");
    expect(occupantOf("now", bound, knownElsewhere)).toBe("child");
    expect(occupantOf("before", bound, knownElsewhere)).toBe("child");
    expect(occupantOf("another", bound, knownElsewhere)).toBe("other-agent");
  }
  expect(occupantOf("new", null, false)).toBe("unbound");
  expect(occupantOf("new", null, true)).toBe("other-agent");
  const raw = JSON.parse(capture("herdr-agent-get.json"));
  expect(parseAgentInfo(raw)).toEqual({ agent: "claude", session: "def5cd5b-1566-4099-84c3-4f36648031a6", status: "idle" });
  expect(parseAgentInfo(JSON.parse(capture("herdr-agent-not-found.json")))).toBeNull();
  expect(parseAgentInfo({ result: { agent: { agent: "claude", agent_status: "unknown" } } })).toEqual({ agent: "claude", session: null, status: "unknown" });
});
test("[REQ-416] TEST-2810 only a non-empty shell foreground is ready and patterns stay literal", () => {
  expect(shellInForeground({ shellPid: 7, foregroundPids: [7] })).toBe(true);
  expect(shellInForeground({ shellPid: 7, foregroundPids: [7, 7] })).toBe(true);
  for (const pids of [[], [8], [7, 8]]) expect(shellInForeground({ shellPid: 7, foregroundPids: pids })).toBe(false);
  const patterns = [".()[]*+?|\\^$", "Worktree removed"];
  const re = new RegExp(alternationRegex(patterns));
  expect(re.test("before " + patterns[0] + " after")).toBe(true);
  expect(re.test("Worktree removed")).toBe(true);
  expect(new RegExp(alternationRegex(["a.b"])).test("axb")).toBe(false);
});
