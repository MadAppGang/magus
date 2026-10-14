import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDecline, VCS_DIRS, type SearchCall } from "./call";
import { parseGrepToolInput } from "./grep-tool";

interface Row {
  input: unknown;
  expect: "files" | "content" | "decline";
}

const cases = JSON.parse(readFileSync(join(import.meta.dir, "__testdata__", "grep-tool-cases.json"), "utf8")) as Row[];
const VCS_GLOBS = VCS_DIRS.flatMap((d) => ["--glob", `!${d}`]);

function accept(input: unknown): SearchCall {
  const parsed = parseGrepToolInput(input);
  if (isDecline(parsed)) throw new Error(`declined ${JSON.stringify(input)}: ${parsed.decline}`);
  return parsed;
}

describe("parseGrepToolInput, shared testdata", () => {
  test.each(cases.map((row) => [JSON.stringify(row.input), row] as const))("%s", (_name, row) => {
    const parsed = parseGrepToolInput(row.input);
    expect(isDecline(parsed) ? "decline" : parsed.mode).toBe(row.expect);
  });
});

describe("parseGrepToolInput, fields", () => {
  test("defaults: files mode, cwd root, the host's walk prefix", () => {
    expect(accept({ pattern: "sessionStore" })).toEqual({
      route: "tool",
      mode: "files",
      pattern: "sessionStore",
      ignoreCase: false,
      before: 0,
      after: 0,
      roots: [],
      walkArgs: ["--hidden", ...VCS_GLOBS],
    });
  });

  test("path becomes the one root; type then globs follow the VCS globs", () => {
    expect(accept({ pattern: "word", path: "/p/src", type: "ts", glob: "*.ts, *.tsx" })).toMatchObject({
      roots: ["/p/src"],
      walkArgs: ["--hidden", ...VCS_GLOBS, "--type", "ts", "--glob", "*.ts", "--glob", "*.tsx"],
    });
  });

  test("a glob holding `{` is one glob, as the host passes it", () => {
    expect(accept({ pattern: "word", glob: "*.{ts,tsx}" }).walkArgs.slice(-2)).toEqual(["--glob", "*.{ts,tsx}"]);
  });

  test("context: context or -C sets both sides; else -A and -B; files mode keeps none", () => {
    expect(accept({ pattern: "word", output_mode: "content", context: 3, "-A": 1 })).toMatchObject({ before: 3, after: 3 });
    expect(accept({ pattern: "word", output_mode: "content", "-C": 2 })).toMatchObject({ before: 2, after: 2 });
    expect(accept({ pattern: "word", output_mode: "content", "-A": 4, "-B": 1 })).toMatchObject({ before: 1, after: 4 });
    expect(accept({ pattern: "word", "-C": 2 })).toMatchObject({ mode: "files", before: 0, after: 0 });
  });

  test("offset > 0 declines with the reason the service reports", () => {
    expect(parseGrepToolInput({ pattern: "word", offset: 5 })).toEqual({ decline: "offset" });
  });

  test("head_limit is accepted and ignored", () => {
    expect(accept({ pattern: "word", head_limit: 1 })).toEqual(accept({ pattern: "word" }));
  });
});
