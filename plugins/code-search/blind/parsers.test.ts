import { expect, test } from "bun:test";
import { parseBashGrep } from "../mcp/grep/bash-grep";
import { parseGrepToolInput } from "../mcp/grep/grep-tool";
import { combineGateEnv, engineConfigured, gateSettings, mergeGate } from "../mcp/grep/gate";
import type { SearchCall } from "../mcp/grep/call";

const vcs = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"].flatMap((d) => ["--glob", `!${d}`]);
const bashWalk = ["--hidden", "--no-require-git", "--no-ignore-dot", "--no-ignore-exclude", "--no-ignore-global", "--no-ignore-parent", ...vcs];
const bash = (changes: Partial<SearchCall> = {}): SearchCall => ({
  route: "bash", mode: "content", pattern: "WORD", ignoreCase: false,
  before: 0, after: 0, roots: ["src"], walkArgs: bashWalk, ...changes,
});

for (const [name, argv, expected] of [
  ["no path", ["-rn", "WORD"], bash({ roots: [] })],
  ["options after pattern", ["WORD", "-rn"], bash({ roots: [] })],
  ["flags and include ordering", ["-Rnli", "-B2", "-A", "5", "--include=*.ts", "--include=[a-c]*", "--exclude=*.js", "--exclude-dir=dist", "WORD", "src"],
    bash({ mode: "files", ignoreCase: true, before: 2, after: 5,
      walkArgs: [...bashWalk.slice(0, 6), "--follow", ...vcs,
        "--type-add", "csinc:*.ts", "--type-add", "csinc:[a-c]*", "--type", "csinc",
        "--glob", "!*.js", "--glob", "!dist/"] })],
  ["context maximum", ["-r", "-A5", "-C1", "-B3", "WORD", "src"], bash({ before: 3, after: 5 })],
  ["terminator and literal hyphen root", ["-rn", "--", "WORD", "-file"], bash({ roots: ["-file"] })],
] as const) {
  test(`R12.4 P3 Bash parser ${name} returns full search call`, () => {
    expect(parseBashGrep(argv)).toEqual(expected);
  });
}

for (const [name, argv] of [
  ["no recursion", ["WORD", "src"]],
  ["count mode", ["-rc", "WORD", "src"]],
  ["regex dot", ["-rn", "foo.bar", "src"]],
  ["regex star", ["-rn", "foo*", "src"]],
  ["path parent", ["-rn", "WORD", "src/../other"]],
  ["seventeen paths", ["-rn", "WORD", ...Array.from({ length: 17 }, (_, n) => `p${n}`)]],
  ["stdin root", ["-rn", "WORD", "-"]],
  ["unknown option", ["--binary", "-rn", "WORD", "src"]],
  ["empty include", ["-rn", "--include=", "WORD", "src"]],
] as const) {
  test(`R12.4 P3 Bash parser declines ${name}`, () => {
    expect(parseBashGrep(argv)).toEqual({ decline: expect.any(String) });
  });
}

for (const flag of ["--include", "--exclude", "--exclude-dir"]) {
  for (const glob of ["*.ts", "*.t*", "[!t]*.ts", "[^t]*.ts", "[a]]x", "[a-c]*"]) {
    test(`R12.4 P3 ${flag}=${glob} is accepted without glob rewriting`, () => {
      const result = parseBashGrep(["-rn", `${flag}=${glob}`, "WORD", "src"]);
      expect(result).toEqual(bash({ walkArgs:
        flag === "--include" ? [...bashWalk, "--type-add", `csinc:${glob}`, "--type", "csinc"] :
          [...bashWalk, "--glob", flag === "--exclude-dir" ? `!${glob}/` : `!${glob}`],
      }));
    });
  }
  for (const glob of ["**.ts", "a**.ts", "**", "x**y", "[]a]*", "[!]]*", "[^]]*", "x[]]y", "!*.js", "a:b", "a/b", "a,b", "{a,b}", "a\\b", ""]) {
    test(`R12.4 P3 ${flag}=${glob} declines the entire call`, () => {
      expect(parseBashGrep(["-rn", `${flag}=${glob}`, "WORD", "src"]))
        .toEqual({ decline: `value:${flag}` });
    });
  }
}

const toolWalk = ["--hidden", ...vcs];
for (const [name, input, expected] of [
  ["default files mode", { pattern: "WORD" }, { route: "tool", mode: "files", pattern: "WORD", ignoreCase: false, before: 0, after: 0, roots: [], walkArgs: toolWalk }],
  ["content context", { pattern: "WORD", path: "src", output_mode: "content", context: 2, "-B": 4, "-A": 7 },
    { route: "tool", mode: "content", pattern: "WORD", ignoreCase: false, before: 2, after: 2, roots: ["src"], walkArgs: toolWalk }],
  ["head limit ignored", { pattern: "WORD", head_limit: 1, offset: 0 },
    { route: "tool", mode: "files", pattern: "WORD", ignoreCase: false, before: 0, after: 0, roots: [], walkArgs: toolWalk }],
] as const) {
  test(`R12.4 P3 Grep-tool parser ${name}`, () => {
    expect(parseGrepToolInput(input)).toEqual(expected);
  });
}

for (const [name, input, reason] of [
  ["positive offset", { pattern: "WORD", offset: 5 }, "offset"],
  ["count mode", { pattern: "WORD", output_mode: "count" }, "any"],
  ["multiline", { pattern: "WORD", multiline: true }, "any"],
  ["unknown key", { pattern: "WORD", mystery: true }, "any"],
  ["wrong flag type", { pattern: "WORD", "-i": 1 }, "any"],
  ["negative context", { pattern: "WORD", "-C": -1 }, "any"],
  ["fractional head limit", { pattern: "WORD", head_limit: 1.5 }, "any"],
  ["empty path", { pattern: "WORD", path: "" }, "any"],
  ["regex", { pattern: "foo.bar" }, "any"],
] as const) {
  test(`R12.4 P3 Grep-tool parser declines ${name}`, () => {
    const result = parseGrepToolInput(input);
    expect(result).toEqual({ decline: reason === "offset" ? "offset" : expect.any(String) });
  });
}

for (const id of ["codegraph", "graphify", "mnemex", "serena"]) {
  test(`R12.4 P3 ${id} needs an own engine entry`, () => {
    expect(engineConfigured({ engine: id, engines: { [id]: {} } } as unknown as Parameters<typeof engineConfigured>[0])).toBe(true);
    expect(engineConfigured({ engine: id, engines: {} })).toBe(false);
  });
}
test("R12.4 P3 inherited or unshipped engine cannot open the gate", () => {
  expect(engineConfigured({ engine: "constructor", engines: {} })).toBe(false);
  expect(engineConfigured({ engine: "fake", engines: { fake: {} } } as unknown as Parameters<typeof engineConfigured>[0])).toBe(false);
  expect(engineConfigured({ engine: 5, engines: { mnemex: {} } } as unknown as Parameters<typeof engineConfigured>[0])).toBe(false);
});
test("R12.4 P3 gate reasons follow documented precedence", () => {
  const closed = { env: { CODE_SEARCH_MERGE: "0" }, route: false, engineConfigured: false };
  expect(mergeGate({ platform: "win32", ...closed })).toBe("win32");
  expect(mergeGate({ platform: "darwin", ...closed })).toBe("kill-switch");
  expect(mergeGate({ platform: "darwin", ...closed, env: {} })).toBe("route-off");
  expect(mergeGate({ platform: "darwin", ...closed, env: {}, route: true })).toBe("no-engine");
  expect(mergeGate({ platform: "darwin", env: {}, route: true, engineConfigured: true })).toBeUndefined();
});
test("R12.4 P3 any exact zero in gate environments wins", () => {
  expect(combineGateEnv({ CODE_SEARCH_MERGE: "1" }, { CODE_SEARCH_MERGE: "0" }).CODE_SEARCH_MERGE).toBe("0");
  expect(combineGateEnv({ CODE_SEARCH_MERGE: "00" }, { CODE_SEARCH_MERGE: "1" }).CODE_SEARCH_MERGE).toBe("00");
});
test("R12.4 P3 settings layers select route, env and configured engine", () => {
  // The contract leaves the depth of `mergeSettingsLayers` (whether a later layer's partial
  // `code-search` block keeps a lower layer's `engine`) to HEAD, so the engine is declared in
  // the same layer that overrides the route; the row holds under either merge depth.
  const texts = [
    JSON.stringify({ "code-search": { grep: { route: true } }, env: { A: "old", CODE_SEARCH_MERGE: "0" } }),
    JSON.stringify({ env: { A: 3 }, "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } }, grep: { route: false } } }),
    JSON.stringify({ env: { B: 4 } }),
  ];
  expect(gateSettings(texts)).toEqual({ route: false, engineConfigured: true, env: { A: "3", B: "4", CODE_SEARCH_MERGE: "0" } });
});
// Contract amendment (orchestrator, iteration 1): the settings schema `mergeSettingsLayers`
// applies drops an `engines.<id>` entry unless it carries a non-empty string `command`.
// gateSettings computes engineConfigured over the merged blocks (R12.4), so only an entry
// with a command counts there. Direct engineConfigured() rows above keep `{}`.
const layered = (entry: unknown) => {
  const cs = JSON.stringify({ "code-search": { engine: "mnemex", engines: { mnemex: entry } } });
  return [[cs, undefined, undefined], [undefined, cs, undefined], [undefined, undefined, cs]];
};
test("R12.4 P3 gateSettings reports an engine entry with a command as configured, in any layer", () => {
  for (const texts of layered({ command: "mnemex" })) {
    expect(gateSettings(texts).engineConfigured).toBe(true);
  }
});
for (const [label, entry] of [["empty entry", {}], ["empty command", { command: "" }]] as const) {
  test(`R12.4 P3 gateSettings reports an engine ${label} as not configured, in any layer`, () => {
    for (const texts of layered(entry)) {
      expect(gateSettings(texts).engineConfigured).toBe(false);
    }
  });
}
