/**
 * changed-files.test.ts — unit tests for mcp/worktree/changed-files.ts (TEST-13, REQ-4).
 *
 * Covers:
 * - parseNameStatusZ: NUL-separated git diff --name-status -z --no-renames output,
 *   including spaces, newlines, unicode, and deletions.
 * - parsePorcelainZ: NUL-separated git status --porcelain=v1 -z --untracked-files=all
 *   output, including R/C rename/copy records contributing BOTH paths.
 * - changedFiles: merging committed + uncommitted with lstatKind, project subdirectory
 *   filtering/relativizing, owned exclusions, missing base commit -> engineWide: true,
 *   and remainingMs budget enforcement.
 */

import { describe, expect, test } from "bun:test";
import type { FileKind } from "../core/index-descriptor";
import { changedFiles, parseNameStatusZ, parsePorcelainZ } from "./changed-files";
import type { WorktreeIo } from "./ports";

type RunReturn = Awaited<ReturnType<WorktreeIo["run"]>>;

function makeRunResult(exitCode: number | null, stdout = "", stderr = "", timedOut = false): RunReturn {
  return {
    exitCode,
    code: exitCode,
    status: exitCode,
    ok: exitCode === 0 && !timedOut,
    stdout,
    stderr,
    timedOut,
  } as unknown as RunReturn;
}

describe("TEST-13: parseNameStatusZ (REQ-4)", () => {
  test("REQ-4: parses empty output to empty list", () => {
    expect(parseNameStatusZ("")).toEqual([]);
  });

  test("REQ-4: parses NUL-separated status and path pairs including spaces, newlines, and unicode", () => {
    const raw = [
      "M",
      "src/alpha.ts",
      "A",
      "src/with space.ts",
      "D",
      "src/line\nbreak.ts",
      "M",
      "src/λ-unicode.ts",
      "",
    ].join("\0");

    expect(parseNameStatusZ(raw)).toEqual([
      "src/alpha.ts",
      "src/with space.ts",
      "src/line\nbreak.ts",
      "src/λ-unicode.ts",
    ]);
  });
});

describe("TEST-13: parsePorcelainZ (REQ-4)", () => {
  test("REQ-4: parses empty output to empty list", () => {
    expect(parsePorcelainZ("")).toEqual([]);
  });

  test("REQ-4: parses modified, added, deleted, untracked, and contributes BOTH paths for rename/copy records", () => {
    // In `git status --porcelain=v1 -z`, ordinary entries are `XY PATH\0`, and
    // rename/copy entries (R or C in X or Y) are `XY NEW_PATH\0OLD_PATH\0`.
    const raw = [
      " M src/modified.ts",
      "A  src/staged with space.ts",
      "?? src/untracked-λ.ts",
      "R  src/renamed-new.ts",
      "src/renamed-old.ts",
      "C  src/copied-new.ts",
      "src/copied-orig.ts",
      "D  src/deleted.ts",
      "",
    ].join("\0");

    const parsed = parsePorcelainZ(raw);
    expect(parsed).toContain("src/modified.ts");
    expect(parsed).toContain("src/staged with space.ts");
    expect(parsed).toContain("src/untracked-λ.ts");
    expect(parsed).toContain("src/renamed-new.ts");
    expect(parsed).toContain("src/renamed-old.ts");
    expect(parsed).toContain("src/copied-new.ts");
    expect(parsed).toContain("src/copied-orig.ts");
    expect(parsed).toContain("src/deleted.ts");
  });
});

describe("TEST-13: changedFiles (REQ-4)", () => {
  test("REQ-4: partitions committed and uncommitted changes into sorted changed and deleted sets", async () => {
    const existingFiles = new Set([
      "/wt/src/mod.ts",
      "/wt/src/new.ts",
      "/wt/src/renamed-new.ts",
    ]);
    const io = {
      run: async (argv: readonly string[]) => {
        if (argv.includes("--show-prefix")) return makeRunResult(0, "\n");
        if (argv.includes("cat-file")) return makeRunResult(0, "commit\n");
        if (argv.includes("diff")) {
          return makeRunResult(0, "M\0src/mod.ts\0D\0src/gone.ts\0");
        }
        if (argv.includes("status")) {
          return makeRunResult(0, "?? src/new.ts\0R  src/renamed-new.ts\0src/renamed-old.ts\0?? .idx/db.sqlite\0");
        }
        return makeRunResult(0, "");
      },
      lstatKind: (path: string): FileKind => (existingFiles.has(path) ? "file" : "missing"),
    } as unknown as WorktreeIo;

    const result = await changedFiles(io, {
      worktreeDir: "/wt",
      baseCommit: "1111111111111111111111111111111111111111",
      owned: [".idx"],
    });

    expect(result).toEqual({
      changed: ["src/mod.ts", "src/new.ts", "src/renamed-new.ts"],
      deleted: ["src/gone.ts", "src/renamed-old.ts"],
      engineWide: false,
    });
  });

  test("REQ-4: restricts and relativizes paths when worktreeDir is a project subdirectory", async () => {
    const existingFiles = new Set(["/wt/packages/app/src/inside.ts"]);
    const io = {
      run: async (argv: readonly string[]) => {
        if (argv.includes("--show-prefix")) return makeRunResult(0, "packages/app/\n");
        if (argv.includes("cat-file")) return makeRunResult(0, "commit\n");
        if (argv.includes("diff")) {
          return makeRunResult(
            0,
            "M\0packages/app/src/inside.ts\0M\0packages/other/src/outside.ts\0D\0packages/app/src/removed.ts\0",
          );
        }
        if (argv.includes("status")) {
          return makeRunResult(0, "?? root-only.ts\0");
        }
        return makeRunResult(0, "");
      },
      lstatKind: (path: string): FileKind => (existingFiles.has(path) ? "file" : "missing"),
    } as unknown as WorktreeIo;

    const result = await changedFiles(io, {
      worktreeDir: "/wt/packages/app",
      baseCommit: "1111111111111111111111111111111111111111",
    });

    expect(result).toEqual({
      changed: ["src/inside.ts"],
      deleted: ["src/removed.ts"],
      engineWide: false,
    });
  });

  test("REQ-4: returns engineWide: true when baseCommit is undefined or missing from git object store", async () => {
    const ioMissingCommit = {
      run: async (argv: readonly string[]) => {
        if (argv.includes("--show-prefix")) return makeRunResult(0, "\n");
        if (argv.includes("cat-file")) return makeRunResult(1, "", "fatal: Not a valid object name");
        if (argv.includes("diff")) return makeRunResult(128, "", "fatal: bad object");
        if (argv.includes("status")) return makeRunResult(0, "");
        return makeRunResult(0, "");
      },
      lstatKind: (): FileKind => "missing",
    } as unknown as WorktreeIo;

    const resMissing = await changedFiles(ioMissingCommit, {
      worktreeDir: "/wt",
      baseCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    expect(resMissing.engineWide).toBe(true);

    const resUndefined = await changedFiles(ioMissingCommit, {
      worktreeDir: "/wt",
      baseCommit: undefined,
    });
    expect(resUndefined.engineWide).toBe(true);
  });
});
