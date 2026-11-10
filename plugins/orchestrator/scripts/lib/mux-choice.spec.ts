import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectSessionMux, chooseWindowMux, chooseStartMux, parseProcessInfo, parsePsTable, ancestry, herdrHostsSelf, type SessionMux, type WindowMux, type Multiplexer } from "./mux-choice";

type Env = Record<string, string | undefined>;
const herdr = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" };
const tmux: SessionMux = { ok: true, mux: "tmux", source: "detected", nesting: null };
const hd: SessionMux = { ok: true, mux: "herdr", source: "detected", nesting: null };
const nested: SessionMux = { ...hd, nesting: "herdr-in-tmux" };
const no: SessionMux = { ok: false, error: "not inside tmux or herdr" };
const win = (mux: Multiplexer, source: "forced" | "stored" | "detected" | "provisional", ask: "herdr-in-tmux" | "herdr-installed" | null = null, note: string | null = null): WindowMux => ({ ok: true, mux, source, ask, note });
export const storedHerdrNote = "New ticket windows open as herdr tabs (your stored choice). This session's own children stay in tmux slots.";
describe("session mux is independent of stored window preference", () => {
  const cases: [string, Env, boolean | null, SessionMux][] = [
    ["S1 forced tmux in nested environment", { ...herdr, TMUX: "host", ORCHESTRATOR_MULTIPLEXER: "tmux" }, true, { ok: true, mux: "tmux", source: "forced", nesting: null }],
    ["S1 forced tmux requires TMUX", { ...herdr, ORCHESTRATOR_MULTIPLEXER: "tmux" }, true, { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=tmux, but not inside tmux (TMUX is unset)" }],
    ["S1 empty TMUX is unset", { ...herdr, TMUX: "", ORCHESTRATOR_MULTIPLEXER: "tmux" }, null, { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=tmux, but not inside tmux (TMUX is unset)" }],
    ["S2 forced herdr needs only pane id", { HERDR_PANE_ID: "w1:p1", HERDR_ENV: "0", ORCHESTRATOR_MULTIPLEXER: "herdr" }, false, { ok: true, mux: "herdr", source: "forced", nesting: null }],
    ["S2 no pane", { TMUX: "host", ORCHESTRATOR_MULTIPLEXER: "herdr" }, true, { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=herdr, but not inside herdr (HERDR_PANE_ID is unset)" }],
    ["S2 empty pane", { HERDR_PANE_ID: "", TMUX: "host", ORCHESTRATOR_MULTIPLEXER: "herdr" }, null, { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=herdr, but not inside herdr (HERDR_PANE_ID is unset)" }],
    ["S4 confirmed plain herdr", herdr, true, hd],
    ["S4 unknown probe trusts herdr env", herdr, null, hd],
    ["S4 nested confirmed", { ...herdr, TMUX: "host" }, true, nested],
    ["S4 nested unknown", { ...herdr, TMUX: "host", ORCHESTRATOR_MULTIPLEXER: "" }, null, nested],
    ["S5 tmux under inherited herdr", { ...herdr, TMUX: "host" }, false, { ...tmux, nesting: "tmux-in-herdr" }],
    ["S5 plain tmux", { TMUX: "host" }, null, tmux],
    ["S6 outside", {}, null, no],
    ["S6 stale herdr without tmux", herdr, false, no],
  ];
  for (const [label, env, hostsSelf, expected] of cases) test("[REQ-401] TEST-2101 " + label, () => {
    expect(detectSessionMux({ env: Object.freeze(env), hostsSelf })).toEqual(expected);
  });
  for (const v of ["screen", "TMUX", "HERDR", " tmux", "tmux ", " ", "0"]) test("[REQ-401] TEST-2102 invalid override " + JSON.stringify(v) + " never falls back", () => {
    expect(detectSessionMux({ env: { ...herdr, TMUX: "host", ORCHESTRATOR_MULTIPLEXER: v }, hostsSelf: true })).toEqual({ ok: false, error: 'invalid ORCHESTRATOR_MULTIPLEXER "' + v + '"; one of: tmux herdr' });
  });
  const incomplete: Env[] = [{}, { HERDR_ENV: "1" }, { HERDR_ENV: "1", HERDR_PANE_ID: "" }, { HERDR_PANE_ID: "w1:p1" },
    ...["0", "true", "01", "1 ", "yes"].map(HERDR_ENV => ({ HERDR_ENV, HERDR_PANE_ID: "w1:p1" })), { HERDR_WORKSPACE_ID: "w1" }];
  for (const env of incomplete) test("[REQ-401] TEST-2103 incomplete herdr claim " + JSON.stringify(env) + " cannot redirect a tmux session", () => {
    for (const hostsSelf of [true, null, false]) {
      expect(detectSessionMux({ env, hostsSelf })).toEqual(no);
      expect(detectSessionMux({ env: { ...env, TMUX: "host" }, hostsSelf })).toEqual(tmux);
    }
  });
  test("[REQ-401] TEST-2104 non-empty routing values remain literal, including whitespace", () => {
    expect(detectSessionMux({ env: { ORCHESTRATOR_MULTIPLEXER: "tmux", TMUX: " " }, hostsSelf: null })).toEqual({ ...tmux, source: "forced" });
    expect(detectSessionMux({ env: { ORCHESTRATOR_MULTIPLEXER: "herdr", HERDR_PANE_ID: " " }, hostsSelf: false })).toEqual({ ...hd, source: "forced" });
  });
});
describe("window and named-session choices", () => {
  const cases: [string, SessionMux, Multiplexer | null, boolean, WindowMux][] = [
    ["W1", { ...tmux, source: "forced" }, "herdr", true, win("tmux", "forced")],
    ["W1 herdr", { ...hd, source: "forced" }, "tmux", false, win("herdr", "forced")],
    ["W2 tmux", nested, "tmux", true, win("tmux", "stored")],
    ["W2 herdr", nested, "herdr", false, win("herdr", "stored")],
    ["W3", nested, null, true, win("herdr", "provisional", "herdr-in-tmux")],
    ["W4", hd, "tmux", true, win("herdr", "detected")],
    ["W5", tmux, "herdr", true, win("herdr", "stored", null, storedHerdrNote)],
    ["W6", tmux, "tmux", true, win("tmux", "stored")],
    ["W7", tmux, null, true, win("tmux", "provisional", "herdr-installed")],
    ["W8 ignores absent executable", tmux, "herdr", false, win("tmux", "detected")],
    ["W8 no stored", tmux, null, false, win("tmux", "detected")],
    ["W8 tmux-in-herdr", { ...tmux, nesting: "tmux-in-herdr" }, "herdr", false, win("tmux", "detected")],
    ["session error", no, "herdr", true, no],
  ];
  for (const [label, session, stored, herdrInstalled, expected] of cases) test("[REQ-402] TEST-2105 " + label + " returns exact source, ask and note", () => {
    expect(chooseWindowMux({ env: {}, session, stored, herdrInstalled })).toEqual(expected);
  });
  const nameError = "--session is tmux only; under herdr the ticket opens as a tab in the current workspace (ORCHESTRATOR_MULTIPLEXER=tmux forces tmux)";
  const startCases = [
    { label: "N1", session: tmux, windows: win("herdr", "stored"), named: false, forced: false, expected: { ok: true, mux: "herdr" } },
    { label: "N2 S6", session: no, windows: no, named: false, forced: false, expected: { ok: false, error: "not inside tmux or herdr; run it from a tmux pane or a herdr tab, or pass --session <name> for a tmux session" } },
    { label: "N2 other failure", session: no, windows: { ok: false, error: "bad config" } as WindowMux, named: false, forced: false, expected: { ok: false, error: "bad config" } },
    { label: "N3", session: hd, windows: win("herdr", "detected"), named: true, forced: false, expected: { ok: false, error: nameError } },
    { label: "N3 forced herdr", session: { ...hd, source: "forced" } as SessionMux, windows: win("herdr", "forced"), named: true, forced: true, expected: { ok: false, error: nameError } },
    { label: "N4 stored herdr", session: tmux, windows: win("herdr", "stored"), named: true, forced: false, expected: { ok: true, mux: "tmux" } },
    { label: "N5 S6", session: no, windows: no, named: true, forced: false, expected: { ok: true, mux: "tmux" } },
    { label: "N6", session: { ok: false, error: "invalid override" } as SessionMux, windows: no, named: true, forced: true, expected: { ok: false, error: "invalid override" } },
  ] as const;
  for (const { label, expected, ...facts } of startCases) test("[REQ-403] TEST-2106 " + label + " keeps the named tmux contract", () => {
    expect(chooseStartMux(facts)).toEqual(expected);
  });
});
describe("process evidence", () => {
  test("[REQ-404] TEST-2107 parses captured foregrounds, stderr error bodies and failures", () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, "testdata", "herdr-pane-process-info.json"), "utf8"));
    expect(parseProcessInfo(JSON.stringify(raw.idle_shell), 0)).toEqual({ shellPid: 81297, foregroundPids: [81297] });
    expect(parseProcessInfo(JSON.stringify(raw.running_command), 0)).toEqual({ shellPid: 81297, foregroundPids: [88592] });
    for (const [code, expected] of [["pane_not_found", "absent"], ["server_not_running", "no-server"], ["permission_denied", null], ["timeout", null]] as const)
      expect(parseProcessInfo(JSON.stringify({ error: { code } }), 1)).toBe(expected);
    for (const text of ["", "{", "null", "{}", '{"result":{"process_info":{}}}']) expect(parseProcessInfo(text, 0)).toBeNull();
    expect(parseProcessInfo(JSON.stringify(raw.idle_shell), 1)).toBeNull();
    expect(parseProcessInfo(JSON.stringify(raw.idle_shell), null)).toBeNull();
  });
  test("[REQ-404] TEST-2108 skips malformed ps lines, ends cycles and caps parent links", () => {
    const table = parsePsTable(" 10 5\n5 1\n1 0\njunk\n11 nope\nx 9\n");
    expect([...table]).toEqual([[10, 5], [5, 1], [1, 0]]);
    expect(ancestry(table, 10)).toEqual([10, 5, 1]);
    expect(ancestry(new Map([[10, 5], [5, 10]]), 10)).toEqual([10, 5]);
    const long = new Map(Array.from({ length: 50 }, (_, i) => [100 - i, 99 - i]));
    const chain = ancestry(long, 100);
    expect(chain.slice(0, 3)).toEqual([100, 99, 98]);
    expect(chain.length).toBeLessThanOrEqual(33);
    expect(chain.length).toBeGreaterThanOrEqual(32);
    expect(new Set(chain).size).toBe(chain.length);
  });
  const probe = { shellPid: 10, foregroundPids: [20, 21] };
  const cases = [
    [probe, [30, 10, 1], false, true], [probe, [30, 21, 1], false, true],
    [probe, [30, 1], false, false], [probe, null, false, null],
    ["absent", null, false, false], [null, [30, 10], false, null],
    ["no-server", [30, 10], false, null], ["no-server", null, true, false],
  ] as const;
  for (const [evidence, ancestors, socketGone, expected] of cases) test("[REQ-404] TEST-2109 hosting evidence " + JSON.stringify([evidence, ancestors, socketGone]), () => {
    expect(herdrHostsSelf(evidence, ancestors, socketGone)).toBe(expected);
  });
});
