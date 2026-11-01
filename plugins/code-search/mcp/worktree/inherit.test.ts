/**
 * inherit.test.ts — unit tests for mcp/worktree/inherit.ts (TEST-15, REQ-3, REQ-4, REQ-6).
 *
 * Covers inheritWorktreeIndex across rows 6-11 of the decision table:
 * - Lock acquisition timeout -> blocked at "timeout", state untouched.
 * - Dead "copying" state recovery -> rollbackIndex, failed at "state" (or advice:false if rollback fails).
 * - Under-lock eligibility re-checks (previous_attempt_failed, worktree_has_index, path_unsafe, VCS timeout).
 * - Writing "copying" state before creating anything in the worktree.
 * - Probe failure on incomplete main index -> blocked at "probe".
 * - Fresh main index -> copy, catch-up, verify, complete ("fresh").
 * - Stale main index -> refresh in main first, copy, catch-up, verify ("refreshed").
 * - Stale main index when refresh fails -> copy stale index, catch-up full diff ("not_refreshed").
 * - Dirty main paths at index time -> changed count is undefined.
 * - Verification matrix: docs-only pass, missing indexable file fail, deleted file remaining fail,
 *   indexedFiles() undefined pass, catch-up command failure -> blocked at "catchup" / "verify".
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CopyRecipe,
  FileKind,
  IndexDescriptor,
  IndexSource,
  IndexState,
} from "../core/index-descriptor";
import { parseWorktreeState, worktreeStatePath, type WorktreeLayout } from "../core/worktree";
import { inheritWorktreeIndex, type InheritInput } from "./inherit";
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

const scratchDirs: string[] = [];
afterEach(() => {
  for (const d of scratchDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Harness {
  root: string;
  home: string;
  mainRoot: string;
  wtRoot: string;
  layout: Extract<WorktreeLayout, { kind: "linked" }>;
  stateFile: string;
  mainState: IndexState;
  wtState: IndexState;
  wtIndexed: Set<string>;
  indexedFilesReturnUndefined: boolean;
  mainHead: string;
  wtHead: string;
  mainDirtyPorcelain: string;
  wtDiffNameStatus: string;
  wtPorcelain: string;
  lsFilesStdout: string;
  lsFilesExitCode: number;
  lockOk: boolean;
  failWriteCopying: boolean;
  failRemoveMarker: boolean;
  mainRefreshExitCode: number;
  wtCatchupExitCode: number;
  onMainRefresh?: () => void;
  onWtCatchup?: () => void;
  descriptor: Extract<IndexDescriptor, { worktrees: "copy" }>;
  input: InheritInput;
  io: WorktreeIo;
}

function setupHarness(): Harness {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cs-inherit-")));
  scratchDirs.push(root);
  const home = join(root, "home");
  const mainRoot = join(root, "main");
  const wtRoot = join(root, "wt");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(mainRoot, ".codegraph"), { recursive: true });
  mkdirSync(join(wtRoot, "src"), { recursive: true });
  writeFileSync(join(mainRoot, ".codegraph", "codegraph.db"), "MAIN_DB");
  writeFileSync(join(wtRoot, "src", "changed.ts"), "export const x = 1;\n");

  const layout: Extract<WorktreeLayout, { kind: "linked" }> = {
    kind: "linked",
    root: wtRoot,
    mainRoot,
    relative: "",
    mainProjectDir: mainRoot,
    incarnation: "inc-test-1",
  };

  const stateFile = worktreeStatePath({}, home, wtRoot);

  const h: Harness = {
    root,
    home,
    mainRoot,
    wtRoot,
    layout,
    stateFile,
    mainState: { complete: true, commit: "1111111111111111111111111111111111111111", dirtyPaths: [] },
    wtState: { complete: true, commit: "2222222222222222222222222222222222222222", dirtyPaths: [] },
    wtIndexed: new Set<string>(["src/changed.ts"]),
    indexedFilesReturnUndefined: false,
    mainHead: "1111111111111111111111111111111111111111",
    wtHead: "2222222222222222222222222222222222222222",
    mainDirtyPorcelain: "",
    wtDiffNameStatus: "M\0src/changed.ts\0",
    wtPorcelain: "",
    lsFilesStdout: "",
    lsFilesExitCode: 0,
    lockOk: true,
    failWriteCopying: false,
    failRemoveMarker: false,
    mainRefreshExitCode: 0,
    wtCatchupExitCode: 0,
    descriptor: null as unknown as Extract<IndexDescriptor, { worktrees: "copy" }>,
    input: null as unknown as InheritInput,
    io: null as unknown as WorktreeIo,
  };

  const recipe: CopyRecipe = {
    store: "sqlite",
    include: [".codegraph/codegraph.db"],
    inspect(source: IndexSource): IndexState {
      const tag = source.sqlite(".codegraph/codegraph.db")?.query("SELECT 1")?.[0]?.[0];
      if (tag === "main") return h.mainState;
      if (tag === "wt") return h.wtState;
      return { complete: false };
    },
    updateRefreshesModified: true,
    isIndexable(rel: string): boolean {
      return rel.endsWith(".ts");
    },
    indexedFiles(_source: IndexSource): ReadonlySet<string> | undefined {
      if (h.indexedFilesReturnUndefined) return undefined;
      return h.wtIndexed;
    },
    update: ["codegraph", "sync"],
  };

  h.descriptor = {
    worktrees: "copy",
    path: ".codegraph/codegraph.db",
    owned: [".codegraph"],
    paths: "relative",
    incremental: true,
    copy: recipe,
  };

  h.input = {
    layout,
    projectDir: wtRoot,
    home,
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    engineId: "codegraph",
    descriptor: h.descriptor,
    budgetMs: 60_000,
  };

  const partialIo: Partial<WorktreeIo> & Record<string, unknown> = {
    home,
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    platform: process.platform,
    now: () => 1_000_000,
    which: (bin: string) => `/usr/bin/${bin}`,
    isExecutable: () => true,
    readText(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    kind(path: string): "missing" | "file" | "directory" | "other" {
      try {
        const st = lstatSync(path);
        if (st.isFile()) return "file";
        if (st.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    lstatKind(path: string): FileKind {
      try {
        const st = lstatSync(path);
        if (st.isSymbolicLink()) return "other";
        if (st.isFile()) return "file";
        if (st.isDirectory()) return "directory";
        return "other";
      } catch {
        return "missing";
      }
    },
    realpath(path: string): string | undefined {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
    mtimeMs(path: string): number | undefined {
      try {
        return lstatSync(path).mtimeMs;
      } catch {
        return undefined;
      }
    },
    statFile(path: string): { size: number; mtimeMs: number } | undefined {
      try {
        const st = lstatSync(path);
        if (!st.isFile()) return undefined;
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return undefined;
      }
    },
    mkdirp: async (path: string) => {
      mkdirSync(path, { recursive: true });
    },
    writeText: async (path: string, text: string) => {
      if (h.failWriteCopying && path === stateFile && text.includes('"copying"')) {
        throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    },
    copyFile: async (from: string, to: string) => {
      if (existsSync(to)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    removeTree: async (path: string) => {
      if (h.failRemoveMarker && path.endsWith("codegraph.db")) return;
      rmSync(path, { recursive: true, force: true });
    },
    sqliteSnapshot: async (from: string, to: string) => {
      if (existsSync(to)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    sqliteIntegrity: async (_path: string) => true,
    openIndexSource(rootDir: string): IndexSource {
      const isMain = rootDir === mainRoot;
      return {
        exists(rel: string) {
          return existsSync(join(rootDir, rel));
        },
        sqlite(rel: string) {
          if (!existsSync(join(rootDir, rel))) return undefined;
          return {
            query() {
              return [[isMain ? "main" : "wt"]];
            },
          };
        },
        json() {
          return undefined;
        },
        close() {},
      };
    },
    acquireLock: async (_path: string) => {
      if (!h.lockOk) return { ok: false as const };
      return {
        ok: true as const,
        release: async () => {},
      };
    },
    run: async (argv: readonly string[], opts: { cwd?: string }) => {
      const cwd = opts?.cwd ?? "";
      const isMain = cwd === mainRoot || argv.includes(mainRoot);
      if (argv[0] === "codegraph") {
        if (isMain) {
          h.onMainRefresh?.();
          return makeRunResult(h.mainRefreshExitCode, "");
        }
        h.onWtCatchup?.();
        return makeRunResult(h.wtCatchupExitCode, "");
      }
      if (argv.includes("ls-files")) {
        return makeRunResult(h.lsFilesExitCode, h.lsFilesStdout);
      }
      if (argv.includes("--show-prefix")) {
        return makeRunResult(0, "\n");
      }
      if (argv.includes("rev-parse") && argv.includes("HEAD")) {
        return makeRunResult(0, `${isMain ? h.mainHead : h.wtHead}\n`);
      }
      if (argv.includes("cat-file")) {
        return makeRunResult(0, "commit\n");
      }
      if (argv.includes("diff")) {
        return makeRunResult(0, h.wtDiffNameStatus);
      }
      if (argv.includes("status")) {
        return makeRunResult(0, isMain ? h.mainDirtyPorcelain : h.wtPorcelain);
      }
      return makeRunResult(0, "");
    },
  };

  h.io = partialIo as unknown as WorktreeIo;
  return h;
}

describe("TEST-15: inheritWorktreeIndex (REQ-3, REQ-4, REQ-6)", () => {
  test("REQ-3, REQ-6: returns blocked at 'timeout' when lock cannot be acquired, leaving state untouched", async () => {
    const h = setupHarness();
    h.lockOk = false;

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "timeout",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(h.stateFile)).toBe(false);
  });

  test("REQ-6: row 6 — dead 'copying' state rolls back, writes 'failed' (stage 'state'), and returns blocked with advice:true", async () => {
    const h = setupHarness();
    mkdirSync(join(h.wtRoot, ".codegraph"), { recursive: true });
    writeFileSync(join(h.wtRoot, ".codegraph", "codegraph.db"), "PARTIAL_DB");
    mkdirSync(dirname(h.stateFile), { recursive: true });
    writeFileSync(
      h.stateFile,
      JSON.stringify({
        phase: "copying",
        engine: "codegraph",
        incarnation: h.layout.incarnation,
        updatedAt: 500,
      }),
    );

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "state",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(h.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);
    const saved = parseWorktreeState(readFileSync(h.stateFile, "utf8"), h.layout.incarnation);
    expect(saved?.phase).toBe("failed");
    expect(saved?.stage).toBe("state");
  });

  test("REQ-6: row 6 — when rollback cannot remove marker, state stays 'copying' and advice is false", async () => {
    const h = setupHarness();
    h.failRemoveMarker = true;
    mkdirSync(join(h.wtRoot, ".codegraph"), { recursive: true });
    writeFileSync(join(h.wtRoot, ".codegraph", "codegraph.db"), "STUCK_DB");
    mkdirSync(dirname(h.stateFile), { recursive: true });
    writeFileSync(
      h.stateFile,
      JSON.stringify({
        phase: "copying",
        engine: "codegraph",
        incarnation: h.layout.incarnation,
        updatedAt: 500,
      }),
    );

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "state",
      reason: expect.any(String),
      advice: false,
    });
    const saved = parseWorktreeState(readFileSync(h.stateFile, "utf8"), h.layout.incarnation);
    expect(saved?.phase).toBe("copying");
  });

  test("REQ-6: row 8 — tracked file under owned records 'failed' (stage 'path'), deletes nothing, and returns blocked with advice:true", async () => {
    const h = setupHarness();
    h.lsFilesStdout = ".codegraph/tracked-config.json\0";
    mkdirSync(join(h.wtRoot, ".codegraph"), { recursive: true });
    writeFileSync(join(h.wtRoot, ".codegraph", "tracked-config.json"), '{"tracked":true}');

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "path",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(h.wtRoot, ".codegraph", "tracked-config.json"))).toBe(true);
    expect(existsSync(join(h.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);
    const saved = parseWorktreeState(readFileSync(h.stateFile, "utf8"), h.layout.incarnation);
    expect(saved?.phase).toBe("failed");
    expect(saved?.stage).toBe("path");
  });

  test("REQ-6: row 8 exception — VCS timeout during ownedTracked check while marker is missing writes no failed state (next start retries)", async () => {
    const h = setupHarness();
    h.lsFilesExitCode = 128;

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "state",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(h.stateFile)).toBe(false);
  });

  test("REQ-6: row 9 — if 'copying' state cannot be written, nothing is created in the worktree", async () => {
    const h = setupHarness();
    h.failWriteCopying = true;

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "state",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(h.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);
  });

  test("REQ-4, REQ-6: row 10 — incomplete main index fails at 'probe' and rolls back", async () => {
    const h = setupHarness();
    h.mainState = { complete: false };

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "blocked",
      stage: "probe",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(h.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);
    const saved = parseWorktreeState(readFileSync(h.stateFile, "utf8"), h.layout.incarnation);
    expect(saved?.phase).toBe("failed");
    expect(saved?.stage).toBe("probe");
  });

  test("REQ-4: row 11 — fresh main index copies, catches up, verifies, and writes complete ('fresh')", async () => {
    const h = setupHarness();
    let mainRefreshed = false;
    h.onMainRefresh = () => {
      mainRefreshed = true;
    };

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "inherited",
      refresh: "fresh",
      changed: 1,
    });
    expect(mainRefreshed).toBe(false);
    expect(existsSync(join(h.wtRoot, ".codegraph", "codegraph.db"))).toBe(true);
    const saved = parseWorktreeState(readFileSync(h.stateFile, "utf8"), h.layout.incarnation);
    expect(saved?.phase).toBe("complete");
  });

  test("REQ-3, REQ-4: row 11 — stale main index refreshes main first, then copies and catches up ('refreshed')", async () => {
    const h = setupHarness();
    h.mainState = {
      complete: true,
      commit: "0000000000000000000000000000000000000000",
      dirtyPaths: [],
    };
    h.onMainRefresh = () => {
      h.mainState = { complete: true, commit: h.mainHead, dirtyPaths: [] };
    };

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "inherited",
      refresh: "refreshed",
      changed: 1,
    });
  });

  test("REQ-3, REQ-4: row 11 — when main refresh fails but main index stays complete, falls back to stale copy ('not_refreshed')", async () => {
    const h = setupHarness();
    h.mainState = {
      complete: true,
      commit: "0000000000000000000000000000000000000000",
      dirtyPaths: [],
    };
    h.mainRefreshExitCode = 1;

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "inherited",
      refresh: "not_refreshed",
      changed: 1,
    });
  });

  test("REQ-4: row 11 — when copied index has dirtyPaths from main, changed count is undefined", async () => {
    const h = setupHarness();
    h.mainState = {
      complete: true,
      commit: h.mainHead,
      dirtyPaths: ["src/dirty-in-main.ts"],
    };
    h.mainRefreshExitCode = 1; // keep dirtyPaths on the copied stale state
    // copyIndex inspects the copy in wtRoot; set wtState's initial copy inspect or mainState:
    let inspectedWt = 0;
    const origInspect = h.descriptor.copy.inspect;
    h.descriptor.copy.inspect = (src) => {
      const tag = src.sqlite(".codegraph/codegraph.db")?.query("SELECT 1")?.[0]?.[0];
      if (tag === "wt") {
        inspectedWt += 1;
        // First inspect of wt is inside copyIndex (before catchup), second is verification after catchup:
        if (inspectedWt === 1) {
          return {
            complete: true,
            commit: h.mainHead,
            dirtyPaths: ["src/dirty-in-main.ts"],
          };
        }
        return h.wtState;
      }
      return origInspect(src);
    };

    const out = await inheritWorktreeIndex(h.input, h.io);
    expect(out).toEqual({
      kind: "inherited",
      refresh: "not_refreshed",
      changed: undefined,
    });
  });

  test("REQ-4: verification matrix — docs-only change passes, missing indexable file or leftover deleted file fails at 'verify'", async () => {
    // 1. Docs-only change (README.md is not indexable):
    const hDocs = setupHarness();
    writeFileSync(join(hDocs.wtRoot, "README.md"), "# docs\n");
    hDocs.wtDiffNameStatus = "M\0README.md\0";
    hDocs.wtIndexed = new Set(); // README.md not in indexedFiles, and should not need to be
    expect(await inheritWorktreeIndex(hDocs.input, hDocs.io)).toEqual({
      kind: "inherited",
      refresh: "fresh",
      changed: 1,
    });

    // 2. Missing indexable changed file in indexedFiles -> blocked at "verify" and rolled back:
    const hMissing = setupHarness();
    hMissing.wtIndexed = new Set(); // src/changed.ts is indexable but missing from index!
    const outMissing = await inheritWorktreeIndex(hMissing.input, hMissing.io);
    expect(outMissing).toEqual({
      kind: "blocked",
      stage: "verify",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(hMissing.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);

    // 3. Deleted file still present in indexedFiles -> blocked at "verify" and rolled back:
    const hDeleted = setupHarness();
    hDeleted.wtDiffNameStatus = "D\0src/deleted.ts\0";
    hDeleted.wtIndexed = new Set(["src/deleted.ts"]);
    const outDeleted = await inheritWorktreeIndex(hDeleted.input, hDeleted.io);
    expect(outDeleted).toEqual({
      kind: "blocked",
      stage: "verify",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(hDeleted.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);

    // 4. indexedFiles() returns undefined -> checks 1 & 2 only -> passes:
    const hNoSet = setupHarness();
    hNoSet.indexedFilesReturnUndefined = true;
    hNoSet.wtIndexed = new Set();
    expect(await inheritWorktreeIndex(hNoSet.input, hNoSet.io)).toEqual({
      kind: "inherited",
      refresh: "fresh",
      changed: 1,
    });

    // 5. Catch-up command fails -> blocked at "catchup" and rolled back:
    const hCatchupFail = setupHarness();
    hCatchupFail.wtCatchupExitCode = 2;
    const outCatchup = await inheritWorktreeIndex(hCatchupFail.input, hCatchupFail.io);
    expect(outCatchup).toEqual({
      kind: "blocked",
      stage: "catchup",
      reason: expect.any(String),
      advice: true,
    });
    expect(existsSync(join(hCatchupFail.wtRoot, ".codegraph", "codegraph.db"))).toBe(false);
  });
});
