import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBashGrep } from "./bash-grep";
import { isDecline, VCS_DIRS, type SearchCall } from "./call";

interface Row {
  argv: string[];
  expect: "files" | "content" | "decline";
  /** Exact fields, given on the rows that pin them (P3). */
  roots?: string[];
  before?: number;
  after?: number;
  walkArgs?: string[];
}

const cases = JSON.parse(readFileSync(join(import.meta.dir, "__testdata__", "bash-grep-cases.json"), "utf8")) as Row[];

const NO_IGNORE = ["--no-ignore-dot", "--no-ignore-exclude", "--no-ignore-global", "--no-ignore-parent"];
const PREFIX = ["--hidden", "--no-require-git", ...NO_IGNORE];
const VCS_GLOBS = VCS_DIRS.flatMap((d) => ["--glob", `!${d}`]);

function accept(argv: string[]): SearchCall {
  const parsed = parseBashGrep(argv);
  if (isDecline(parsed)) throw new Error(`declined ${JSON.stringify(argv)}: ${parsed.decline}`);
  return parsed;
}

describe("parseBashGrep, shared testdata", () => {
  test.each(cases.map((row) => [JSON.stringify(row.argv), row] as const))("%s", (_name, row) => {
    const parsed = parseBashGrep(row.argv);
    expect(isDecline(parsed) ? "decline" : parsed.mode).toBe(row.expect);
    if (isDecline(parsed)) return;
    if (row.roots !== undefined) expect(parsed.roots).toEqual(row.roots);
    if (row.before !== undefined) expect(parsed.before).toBe(row.before);
    if (row.after !== undefined) expect(parsed.after).toBe(row.after);
    if (row.walkArgs !== undefined) expect(parsed.walkArgs).toEqual(row.walkArgs);
  });

  test("every row that pins a field is an accepted row", () => {
    const pinned = cases.filter((row) => row.roots !== undefined || row.walkArgs !== undefined || row.before !== undefined);
    expect(pinned.length).toBeGreaterThan(0);
    for (const row of pinned) expect(row.expect).not.toBe("decline");
  });
});

describe("parseBashGrep, fields", () => {
  test("pattern, roots as written, route and the plain-case walk args", () => {
    expect(accept(["-rn", "fetch User", "src/", "lib"])).toEqual({
      route: "bash",
      mode: "content",
      pattern: "fetch User",
      ignoreCase: false,
      before: 0,
      after: 0,
      roots: ["src/", "lib"],
      walkArgs: [...PREFIX, ...VCS_GLOBS],
    });
  });

  test("-i and --ignore-case set ignoreCase; -l and --files-with-matches set files mode", () => {
    expect(accept(["-ril", "word", "."]).ignoreCase).toBe(true);
    expect(accept(["-r", "--ignore-case", "word", "."]).ignoreCase).toBe(true);
    expect(accept(["-r", "--files-with-matches", "word", "."]).mode).toBe("files");
  });

  test("context: each side is the maximum over every flag that sets it (D6)", () => {
    expect(accept(["-rC2", "word", "."])).toMatchObject({ before: 2, after: 2 });
    expect(accept(["-rC", "2", "-A", "5", "word", "."])).toMatchObject({ before: 2, after: 5 });
    expect(accept(["-r", "-B1", "--context=4", "word", "."])).toMatchObject({ before: 4, after: 4 });
    expect(accept(["-r", "--after-context=3", "--before-context=1", "word", "."])).toMatchObject({ before: 1, after: 3 });
    expect(accept(["-rnA", "7", "word", "."])).toMatchObject({ before: 0, after: 7 });
    // A later, smaller count never lowers a side (the implementation once let it).
    expect(accept(["-rn", "-A", "5", "-C", "1", "word", "."])).toMatchObject({ before: 1, after: 5 });
    expect(accept(["-rn", "-C", "3", "-B", "1", "word", "."])).toMatchObject({ before: 3, after: 3 });
    expect(accept(["-rn", "--context=9", "-A0", "-B0", "word", "."])).toMatchObject({ before: 9, after: 9 });
  });

  test("walk args: four --no-ignore-* flags, -R follows, includes as a type filter, excludes as negated globs", () => {
    expect(accept([
      "-R", "--exclude-dir=node_modules", "--exclude=*.min.js", "--include=*.ts", "word", ".",
    ]).walkArgs).toEqual([
      ...PREFIX, "--follow", ...VCS_GLOBS,
      "--type-add", "csinc:*.ts", "--type", "csinc",
      "--glob", "!*.min.js", "--glob", "!node_modules/",
    ]);
  });

  test("an include never reaches the walk as --glob, and --type appears once", () => {
    const args = accept(["-rn", "--include=*.ts", "--include=*.tsx", "--include=Makefile", "word", "."]).walkArgs;
    expect(args.slice(PREFIX.length + VCS_GLOBS.length)).toEqual([
      "--type-add", "csinc:*.ts", "--type-add", "csinc:*.tsx", "--type-add", "csinc:Makefile", "--type", "csinc",
    ]);
    expect(args.filter((a) => a === "--type")).toHaveLength(1);
    expect(args.some((a, i) => a === "--glob" && !(args[i + 1] ?? "").startsWith("!"))).toBe(false);
  });

  test("no include: no --type-add and no --type", () => {
    const args = accept(["-rn", "--exclude=*.map", "word", "."]).walkArgs;
    expect(args).not.toContain("--type");
    expect(args).not.toContain("--type-add");
  });

  test("G rule: a leading `!` or any `:` declines on all three filters; `!` later in G is allowed", () => {
    for (const flag of ["--include", "--exclude", "--exclude-dir"]) {
      expect(isDecline(parseBashGrep(["-rn", `${flag}=!x`, "word", "."]))).toBe(true);
      expect(isDecline(parseBashGrep(["-rn", `${flag}=a:b`, "word", "."]))).toBe(true);
      expect(isDecline(parseBashGrep(["-rn", `${flag}=:b`, "word", "."]))).toBe(true);
      expect(isDecline(parseBashGrep(["-rn", `${flag}=a!b`, "word", "."]))).toBe(false);
    }
  });

  test("options after operands, and `--` ending options", () => {
    expect(accept(["word", "src", "-rn"])).toMatchObject({ pattern: "word", roots: ["src"] });
    expect(accept(["-r", "--", "word", "src"])).toMatchObject({ pattern: "word", roots: ["src"] });
  });

  test("no path operand is accepted with roots [] (D6, P0-5), in any option order", () => {
    expect(accept(["-rn", "word"])).toEqual({
      route: "bash",
      mode: "content",
      pattern: "word",
      ignoreCase: false,
      before: 0,
      after: 0,
      roots: [],
      walkArgs: [...PREFIX, ...VCS_GLOBS],
    });
    expect(accept(["word", "-rn"]).roots).toEqual([]);
    expect(accept(["-r", "--", "word"]).roots).toEqual([]);
    expect(accept(["-rl", "word"]).mode).toBe("files");
  });

  test("no path still needs recursion and a word-like pattern", () => {
    expect(parseBashGrep(["-n", "word"])).toEqual({ decline: "not-recursive" });
    expect(parseBashGrep(["-rn", "a.b"])).toEqual({ decline: "pattern" });
    expect(parseBashGrep(["-rn"])).toEqual({ decline: "no-pattern" });
  });
});
