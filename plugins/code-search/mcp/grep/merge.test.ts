import { describe, expect, test } from "bun:test";
import type { SearchCall } from "./call";
import type { Candidate } from "./merge";
import { normaliseLine, planExtras, rebase } from "./merge";

const call: SearchCall = {
  route: "bash", mode: "content", pattern: "needle", ignoreCase: false,
  before: 1, after: 1, roots: ["."], walkArgs: [],
};

function candidate(path: string, lines: string[], hitLines: number[], rank = 0): Candidate {
  return { path, lines, hitLines, rank };
}

describe("path and line normalization", () => {
  test.each([
    ["src/a.ts", "", "src/a.ts"],
    ["pkg/src/a.ts", "pkg", "src/a.ts"],
    ["pkg-other/a.ts", "pkg", undefined],
    ["pkg", "pkg", undefined],
    ["../a.ts", "", undefined],
    ["/a.ts", "", undefined],
  ] as const)("rebase(%s, %s)", (file, base, expected) => {
    expect(rebase(file, base)).toBe(expected);
  });

  test.each([
    [undefined, 0, 3, undefined], [0, 0, 3, 1], [1, 0, 3, 2],
    [1, 1, 3, 1], [3, 1, 3, 3], [0, 1, 3, undefined],
    [4, 1, 3, undefined], [1.5, 1, 3, undefined],
  ] as const)("normaliseLine(%s, %s, %s)", (raw, base, count, expected) => {
    expect(normaliseLine(raw, base, count)).toBe(expected);
  });
});

describe("content extras: surviving hit lines only", () => {
  test("drops matching hits and hits inside printed(F); keeps only the hit line itself", () => {
    const plan = planExtras(call, [candidate("./a.ts", [
      "zero\n", "engine hit\n", "needle literal\n", "inside grep context\n", "far hit\n", "tail\n",
    ], [2, 3, 4, 5])], 10);
    expect(plan).toEqual({ mode: "content", files: [{ path: "./a.ts", lines: [{ n: 5, text: "far hit\n" }] }] });
  });

  test("printed(F) follows before/after independently", () => {
    const lines = ["a\n", "b\n", "needle\n", "d\n", "e\n", "f\n"];
    const narrow = planExtras({ ...call, before: 0, after: 2 }, [candidate("x", lines, [2, 4, 5, 6])], 10);
    expect(narrow).toEqual({ mode: "content", files: [{ path: "x", lines: [{ n: 2, text: "b\n" }, { n: 6, text: "f\n" }] }] });
  });

  test("the superset matcher: -i folding removes a case-variant hit; a substring inside a word counts", () => {
    const lines = ["NEEDLE here\n", "needles\n", "plain\n"];
    const ci = planExtras({ ...call, ignoreCase: true, before: 0, after: 0 }, [candidate("x", lines, [1, 2, 3])], 10);
    expect(ci).toEqual({ mode: "content", files: [{ path: "x", lines: [{ n: 3, text: "plain\n" }] }] });
    const cs = planExtras({ ...call, before: 0, after: 0 }, [candidate("x", lines, [1, 2, 3])], 10);
    expect(cs).toEqual({ mode: "content", files: [{ path: "x", lines: [{ n: 1, text: "NEEDLE here\n" }, { n: 3, text: "plain\n" }] }] });
  });

  test("keeps engine order within a file, orders files by rank, dedups, and caps across files", () => {
    const lines = ["a\n", "b\n", "c\n", "d\n"];
    const plan = planExtras({ ...call, before: 0, after: 0 }, [
      candidate("later.ts", lines, [1, 2], 4),
      candidate("first.ts", lines, [4, 2, 4, 9], 1),
      candidate("first.ts", lines, [1], 7),
    ], 3);
    expect(plan).toEqual({
      mode: "content",
      files: [
        { path: "first.ts", lines: [{ n: 4, text: "d\n" }, { n: 2, text: "b\n" }] },
        { path: "later.ts", lines: [{ n: 1, text: "a\n" }] },
      ],
    });
  });
});

// Review round 1, internal M2: with a --smart-case RIPGREP_CONFIG_PATH the Grep tool can fold
// case without -i, so the tool route always matches case-insensitively: a superset only
// loses extras, never repeats a line the tool printed.
describe("tool route: case-insensitive whatever -i says", () => {
  test("a case variant of the pattern is never offered on the tool route", () => {
    const lines = ["const NEEDLE = 1;\n", "plain\n"];
    const tool = planExtras({ ...call, route: "tool", ignoreCase: false, before: 0, after: 0 }, [candidate("x", lines, [1, 2])], 10);
    expect(tool).toEqual({ mode: "content", files: [{ path: "x", lines: [{ n: 2, text: "plain\n" }] }] });
    const files = planExtras({ ...call, route: "tool", mode: "files", ignoreCase: false }, [candidate("y", ["Needle here\n"], [], 0)], 10);
    expect(files).toEqual({ mode: "files", paths: [] });
  });

  test("the bash route keeps grep's own case rule", () => {
    const lines = ["const NEEDLE = 1;\n"];
    const bash = planExtras({ ...call, before: 0, after: 0 }, [candidate("x", lines, [1])], 10);
    expect(bash).toEqual({ mode: "content", files: [{ path: "x", lines: [{ n: 1, text: "const NEEDLE = 1;\n" }] }] });
  });
});

describe("files extras", () => {
  test("keeps only engine-ranked files with no matching line, capped by extrasMax", () => {
    const plan = planExtras({ ...call, mode: "files" }, [
      candidate("literal.ts", ["has needle here\n"], [], 0),
      candidate("second.ts", ["semantic only\n"], [], 2),
      candidate("first.ts", ["semantic only\n"], [], 1),
    ], 1);
    expect(plan).toEqual({ mode: "files", paths: ["first.ts"] });
  });

  test("returns an empty plan when every candidate already matches", () => {
    expect(planExtras({ ...call, mode: "files" }, [candidate("literal.ts", ["needle\n"], [], 0)], 10))
      .toEqual({ mode: "files", paths: [] });
  });
});
