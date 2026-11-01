/**
 * worktree.test.ts — unit tests for mcp/core/worktree.ts (REQ-1, REQ-2, REQ-3, REQ-4, REQ-6).
 *
 * Covers:
 * - TEST-1: resolveWorktree (main, relative and absolute commondir, subdirectory, submodule,
 *   bare repo, foreign .git pointer rejected by back-link check, non-git, parity with real git)
 * - TEST-2: inheritedLayerPaths (3 vs 5 layers, subdirectory projectDir)
 * - TEST-4: staleness (fresh iff complete, commit === mainHead, both dirty lists defined & empty)
 * - TEST-5: worktreeStatePath and parseWorktreeState (XDG_CACHE_HOME, FNV-1a per projectDir,
 *   incarnation filtering, malformed resilience)
 * - TEST-6: eligibility (every row of section 5 table in exact order, row 6 copying allowed,
 *   row 7 before row 8, complete with missing marker start-over)
 * - TEST-7: indexQuestionOwner (hook / engine / evaluator)
 * - TEST-8: indexReady (facade gate)
 * - TEST-9: mergeChanged (unique, sorted, partitioned by FileKind)
 * - TEST-10: renderOutcome (exact messages per stage, adviceNeeded flag, no path/mechanism words)
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CopyRecipe, FileKind, IndexDescriptor, IndexState } from "./index-descriptor";
import {
  eligibility,
  indexQuestionOwner,
  indexReady,
  inheritedLayerPaths,
  mergeChanged,
  parseWorktreeState,
  renderOutcome,
  resolveWorktree,
  staleness,
  worktreeStatePath,
  type BlockStage,
  type EligibilityInput,
  type ReadPort,
  type WorktreeLayout,
  type WorktreeState,
} from "./worktree";

interface MemEntry {
  kind: "file" | "directory" | "other";
  text?: string;
  realpath?: string;
  mtimeMs?: number;
}

function makeReadPort(entries: Record<string, MemEntry>): ReadPort {
  return {
    readText(path: string): string | undefined {
      return entries[path]?.text;
    },
    kind(path: string): "missing" | "file" | "directory" | "other" {
      return entries[path]?.kind ?? "missing";
    },
    realpath(path: string): string | undefined {
      const e = entries[path];
      if (!e) return undefined;
      return e.realpath ?? path;
    },
    mtimeMs(path: string): number | undefined {
      const e = entries[path];
      if (!e) return undefined;
      return e.mtimeMs ?? 1700000000000;
    },
  };
}

const DUMMY_RECIPE: CopyRecipe = {
  store: "sqlite",
  include: [".idx/db.sqlite"],
  inspect: () => ({ complete: true, commit: "abc1234", dirtyPaths: [] }),
  updateRefreshesModified: true,
  isIndexable: (rel) => rel.endsWith(".ts"),
  indexedFiles: () => new Set(),
  update: ["idx-bin", "sync"],
};

const COPY_DESCRIPTOR: IndexDescriptor = {
  worktrees: "copy",
  path: ".idx/db.sqlite",
  owned: [".idx"],
  paths: "relative",
  incremental: true,
  copy: DUMMY_RECIPE,
};

const ENGINE_MANAGED_DESCRIPTOR: IndexDescriptor = {
  worktrees: "engine-managed",
  path: ".managed/index.db",
};

const LINKED_LAYOUT: Extract<WorktreeLayout, { kind: "linked" }> = {
  kind: "linked",
  root: "/fixture/wt",
  mainRoot: "/fixture/main",
  relative: "",
  mainProjectDir: "/fixture/main",
  incarnation: "inc-wt-1",
};

describe("TEST-1: resolveWorktree (REQ-1)", () => {
  test("REQ-1: classifies a main checkout when .git is a directory", () => {
    const read = makeReadPort({
      "/repo": { kind: "directory" },
      "/repo/.git": { kind: "directory" },
      "/repo/.git/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
    });
    expect(resolveWorktree("/repo", read)).toEqual({ kind: "main" });
  });

  test("REQ-1: classifies a non-git directory as unknown (not_git)", () => {
    const read = makeReadPort({
      "/plain/dir": { kind: "directory" },
      "/plain": { kind: "directory" },
      "/": { kind: "directory" },
    });
    expect(resolveWorktree("/plain/dir", read)).toEqual({
      kind: "unknown",
      reason: "not_git",
    });
  });

  test("REQ-1: resolves a linked worktree with relative commondir", () => {
    const read = makeReadPort({
      "/main": { kind: "directory" },
      "/main/.git": { kind: "directory" },
      "/main/.git/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
      "/main/.git/worktrees": { kind: "directory" },
      "/main/.git/worktrees/wt1": { kind: "directory", mtimeMs: 123456 },
      "/main/.git/worktrees/wt1/HEAD": { kind: "file", text: "ref: refs/heads/feat\n" },
      "/main/.git/worktrees/wt1/commondir": { kind: "file", text: "../..\n" },
      "/main/.git/worktrees/wt1/gitdir": { kind: "file", text: "/wt/wt1/.git\n" },
      "/wt/wt1": { kind: "directory" },
      "/wt/wt1/.git": { kind: "file", text: "gitdir: /main/.git/worktrees/wt1\n", mtimeMs: 123456 },
    });
    const res = resolveWorktree("/wt/wt1", read);
    expect(res).toEqual({
      kind: "linked",
      root: "/wt/wt1",
      mainRoot: "/main",
      relative: "",
      mainProjectDir: "/main",
      incarnation: expect.any(String),
    });
    if (res.kind === "linked") {
      expect(res.incarnation.length).toBeGreaterThan(0);
    }
  });

  test("REQ-1: resolves a linked worktree with absolute commondir and a subdirectory projectDir", () => {
    const read = makeReadPort({
      "/main": { kind: "directory" },
      "/main/packages": { kind: "directory" },
      "/main/packages/app": { kind: "directory" },
      "/main/.git": { kind: "directory" },
      "/main/.git/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
      "/main/.git/worktrees/wt2": { kind: "directory", mtimeMs: 789000 },
      "/main/.git/worktrees/wt2/HEAD": { kind: "file", text: "ref: refs/heads/feat\n" },
      "/main/.git/worktrees/wt2/commondir": { kind: "file", text: "/main/.git\n" },
      "/main/.git/worktrees/wt2/gitdir": { kind: "file", text: "/wt/wt2/.git\n" },
      "/wt/wt2": { kind: "directory" },
      "/wt/wt2/packages": { kind: "directory" },
      "/wt/wt2/packages/app": { kind: "directory" },
      "/wt/wt2/.git": { kind: "file", text: "gitdir: /main/.git/worktrees/wt2\n", mtimeMs: 789000 },
    });
    const res = resolveWorktree("/wt/wt2/packages/app", read);
    expect(res).toEqual({
      kind: "linked",
      root: "/wt/wt2",
      mainRoot: "/main",
      relative: "packages/app",
      mainProjectDir: "/main/packages/app",
      incarnation: expect.any(String),
    });
  });

  test("REQ-1: classifies a git submodule (.git pointing into .git/modules/...) as unknown", () => {
    const read = makeReadPort({
      "/super": { kind: "directory" },
      "/super/.git": { kind: "directory" },
      "/super/.git/modules": { kind: "directory" },
      "/super/.git/modules/sub": { kind: "directory" },
      "/super/.git/modules/sub/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
      "/super/.git/modules/sub/config": { kind: "file", text: "[core]\n\tworktree = ../../../sub\n" },
      "/super/sub": { kind: "directory" },
      "/super/sub/.git": { kind: "file", text: "gitdir: ../.git/modules/sub\n" },
    });
    expect(resolveWorktree("/super/sub", read).kind).toBe("unknown");
  });

  test("REQ-1: classifies a worktree of a bare repository as unknown with reason no_main_tree", () => {
    const read = makeReadPort({
      "/bare.git": { kind: "directory" },
      "/bare.git/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
      "/bare.git/worktrees": { kind: "directory" },
      "/bare.git/worktrees/wt-bare": { kind: "directory" },
      "/bare.git/worktrees/wt-bare/HEAD": { kind: "file", text: "ref: refs/heads/feat\n" },
      "/bare.git/worktrees/wt-bare/commondir": { kind: "file", text: "../..\n" },
      "/bare.git/worktrees/wt-bare/gitdir": { kind: "file", text: "/wt-bare/.git\n" },
      "/wt-bare": { kind: "directory" },
      "/wt-bare/.git": { kind: "file", text: "gitdir: /bare.git/worktrees/wt-bare\n" },
    });
    expect(resolveWorktree("/wt-bare", read)).toEqual({
      kind: "unknown",
      reason: "no_main_tree",
    });
  });

  test("REQ-1: rejects a foreign .git pointer when the back-link check fails", () => {
    const read = makeReadPort({
      "/main": { kind: "directory" },
      "/main/.git": { kind: "directory" },
      "/main/.git/HEAD": { kind: "file", text: "ref: refs/heads/main\n" },
      "/main/.git/worktrees": { kind: "directory" },
      "/main/.git/worktrees/wt1": { kind: "directory" },
      "/main/.git/worktrees/wt1/HEAD": { kind: "file", text: "ref: refs/heads/feat\n" },
      "/main/.git/worktrees/wt1/commondir": { kind: "file", text: "../..\n" },
      // Back-link points to /legit/wt1/.git, NOT /spoof/wt1/.git:
      "/main/.git/worktrees/wt1/gitdir": { kind: "file", text: "/legit/wt1/.git\n" },
      "/spoof/wt1": { kind: "directory" },
      "/spoof/wt1/.git": { kind: "file", text: "gitdir: /main/.git/worktrees/wt1\n" },
    });
    expect(resolveWorktree("/spoof/wt1", read).kind).toBe("unknown");
  });

  test("REQ-1: parity with real git init and git worktree add", () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cs-wt-resolve-")));
    try {
      const mainDir = join(scratch, "main");
      const wtDir = join(scratch, "linked-wt");
      mkdirSync(join(mainDir, "pkg"), { recursive: true });
      writeFileSync(join(mainDir, "pkg", "a.ts"), "export const a = 1;\n");

      const git = (cwd: string, args: string[]) =>
        spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
          cwd,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Test",
            GIT_AUTHOR_EMAIL: "test@example.com",
            GIT_COMMITTER_NAME: "Test",
            GIT_COMMITTER_EMAIL: "test@example.com",
          },
          encoding: "utf8",
        });

      expect(git(mainDir, ["init", "-b", "main"]).status).toBe(0);
      expect(git(mainDir, ["add", "."]).status).toBe(0);
      expect(git(mainDir, ["commit", "-m", "init"]).status).toBe(0);
      expect(git(mainDir, ["worktree", "add", "-b", "feat", wtDir]).status).toBe(0);

      const fsRead: ReadPort = {
        readText(p) {
          try {
            return readFileSync(p, "utf8");
          } catch {
            return undefined;
          }
        },
        kind(p) {
          try {
            const st = statSync(p);
            if (st.isFile()) return "file";
            if (st.isDirectory()) return "directory";
            return "other";
          } catch {
            return "missing";
          }
        },
        realpath(p) {
          try {
            return realpathSync(p);
          } catch {
            return undefined;
          }
        },
        mtimeMs(p) {
          try {
            return statSync(p).mtimeMs;
          } catch {
            return undefined;
          }
        },
      };

      expect(resolveWorktree(mainDir, fsRead)).toEqual({ kind: "main" });
      const resolvedRoot = resolveWorktree(wtDir, fsRead);
      expect(resolvedRoot).toEqual({
        kind: "linked",
        root: wtDir,
        mainRoot: mainDir,
        relative: "",
        mainProjectDir: mainDir,
        incarnation: expect.any(String),
      });

      const resolvedSub = resolveWorktree(join(wtDir, "pkg"), fsRead);
      expect(resolvedSub).toEqual({
        kind: "linked",
        root: wtDir,
        mainRoot: mainDir,
        relative: "pkg",
        mainProjectDir: join(mainDir, "pkg"),
        incarnation: expect.any(String),
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("TEST-2: inheritedLayerPaths (REQ-1)", () => {
  test("REQ-1: returns 3 paths for main or unknown and 5 paths for linked worktree", () => {
    const home = "/fixture/home";
    const project = "/fixture/wt";
    expect(inheritedLayerPaths(home, project, { kind: "main" })).toEqual([
      "/fixture/home/.claude/settings.json",
      "/fixture/wt/.claude/settings.json",
      "/fixture/wt/.claude/settings.local.json",
    ]);
    expect(inheritedLayerPaths(home, project, { kind: "unknown", reason: "not_git" })).toEqual([
      "/fixture/home/.claude/settings.json",
      "/fixture/wt/.claude/settings.json",
      "/fixture/wt/.claude/settings.local.json",
    ]);
    expect(inheritedLayerPaths(home, project, LINKED_LAYOUT)).toEqual([
      "/fixture/home/.claude/settings.json",
      "/fixture/main/.claude/settings.json",
      "/fixture/wt/.claude/settings.json",
      "/fixture/main/.claude/settings.local.json",
      "/fixture/wt/.claude/settings.local.json",
    ]);
  });
});

describe("TEST-4: staleness (REQ-3)", () => {
  test("REQ-3: fresh iff complete, commit === mainHead, dirtyPaths empty, and mainDirty defined and empty", () => {
    const freshState: IndexState = { complete: true, commit: "deadbeef", dirtyPaths: [] };
    expect(staleness(freshState, "deadbeef", [])).toBe("fresh");
    expect(staleness({ complete: true, commit: "deadbeef" }, "deadbeef", [])).toBe("stale");

    // Incomplete state is stale:
    expect(staleness({ complete: false, commit: "deadbeef", dirtyPaths: [] }, "deadbeef", [])).toBe("stale");
    // Commit mismatch or undefined is stale:
    expect(staleness(freshState, "cafebabe", [])).toBe("stale");
    expect(staleness({ complete: true, dirtyPaths: [] }, "deadbeef", [])).toBe("stale");
    // mainHead undefined is stale:
    expect(staleness(freshState, undefined, [])).toBe("stale");
    // Non-empty indexed dirtyPaths is stale:
    expect(
      staleness({ complete: true, commit: "deadbeef", dirtyPaths: ["src/a.ts"] }, "deadbeef", []),
    ).toBe("stale");
    // mainDirty undefined or non-empty is stale:
    expect(staleness(freshState, "deadbeef", undefined)).toBe("stale");
    expect(staleness(freshState, "deadbeef", ["src/b.ts"])).toBe("stale");
  });
});

describe("TEST-5: worktreeStatePath and parseWorktreeState (REQ-6)", () => {
  test("REQ-6: worktreeStatePath uses XDG_CACHE_HOME or ~/.cache and hashes projectDir with 64-bit FNV-1a", () => {
    const p1 = worktreeStatePath({}, "/fixture/home", "/fixture/wt");
    expect(p1).toMatch(/^\/fixture\/home\/\.cache\/magus\/code-search\/worktrees\/[0-9a-f]{16}\.json$/u);

    const pXdg = worktreeStatePath({ XDG_CACHE_HOME: "/custom/cache" }, "/fixture/home", "/fixture/wt");
    expect(pXdg).toMatch(/^\/custom\/cache\/magus\/code-search\/worktrees\/[0-9a-f]{16}\.json$/u);

    const pSub = worktreeStatePath({}, "/fixture/home", "/fixture/wt/pkg");
    expect(pSub).not.toBe(p1);
    expect(worktreeStatePath({}, "/fixture/home", "/fixture/wt")).toBe(p1);
  });

  test("REQ-6: parseWorktreeState returns state for matching incarnation and undefined otherwise, never throwing", () => {
    const validCopying: WorktreeState = {
      phase: "copying",
      engine: "codegraph",
      incarnation: "inc-1",
      updatedAt: 1000,
    };
    expect(parseWorktreeState(JSON.stringify(validCopying), "inc-1")).toEqual(validCopying);

    const validFailed: WorktreeState = {
      phase: "failed",
      engine: "codegraph",
      incarnation: "inc-1",
      updatedAt: 2000,
      stage: "verify",
      reason: "missing file",
    };
    expect(parseWorktreeState(JSON.stringify(validFailed), "inc-1")).toEqual(validFailed);

    // Different incarnation is treated as absent:
    expect(parseWorktreeState(JSON.stringify(validFailed), "inc-2")).toBeUndefined();

    // Absent, malformed, or wrong-shape inputs return undefined without throwing:
    for (const bad of [
      undefined,
      "",
      "{ broken json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ phase: "unknown", engine: "codegraph", incarnation: "inc-1", updatedAt: 1 }),
      JSON.stringify({ phase: "complete", engine: "", incarnation: "inc-1", updatedAt: 1 }),
      JSON.stringify({ phase: "complete", engine: "codegraph", incarnation: "inc-1", updatedAt: "bad" }),
    ]) {
      expect(parseWorktreeState(bad, "inc-1")).toBeUndefined();
    }
  });
});

describe("TEST-6: eligibility (REQ-2, REQ-6)", () => {
  const BASE_OK: EligibilityInput = {
    claudishChild: false,
    layout: LINKED_LAYOUT,
    engineId: "codegraph",
    setup: "active",
    descriptor: COPY_DESCRIPTOR,
    commandOnPath: true,
    mainMarker: "file",
    worktreeMarker: "missing",
    ownedTracked: false,
    state: undefined,
  };

  test("REQ-6: returns ok:true when all eligibility checks pass", () => {
    expect(eligibility(BASE_OK)).toEqual({ ok: true });
  });

  test("REQ-6: row 0 — claudish_child wins first", () => {
    expect(
      eligibility({
        ...BASE_OK,
        claudishChild: true,
        layout: { kind: "main" },
        engineId: undefined,
      }),
    ).toEqual({ ok: false, reason: "claudish_child" });
  });

  test("REQ-6: row 1 — not_linked_worktree and main_tree_unknown", () => {
    expect(eligibility({ ...BASE_OK, layout: { kind: "main" } })).toEqual({
      ok: false,
      reason: "not_linked_worktree",
    });
    expect(
      eligibility({ ...BASE_OK, layout: { kind: "unknown", reason: "not_git" } }),
    ).toEqual({ ok: false, reason: "not_linked_worktree" });
    expect(
      eligibility({ ...BASE_OK, layout: { kind: "unknown", reason: "no_main_tree" } }),
    ).toEqual({ ok: false, reason: "main_tree_unknown" });
  });

  test("REQ-6: row 2 — no_engine and setup_dismissed", () => {
    expect(eligibility({ ...BASE_OK, engineId: undefined })).toEqual({
      ok: false,
      reason: "no_engine",
    });
    expect(eligibility({ ...BASE_OK, engineId: false })).toEqual({
      ok: false,
      reason: "no_engine",
    });
    expect(eligibility({ ...BASE_OK, setup: "dismissed" })).toEqual({
      ok: false,
      reason: "setup_dismissed",
    });
  });

  test("REQ-6: row 3 — no_copy_descriptor for undefined or engine-managed", () => {
    expect(eligibility({ ...BASE_OK, descriptor: undefined })).toEqual({
      ok: false,
      reason: "no_copy_descriptor",
    });
    expect(eligibility({ ...BASE_OK, descriptor: ENGINE_MANAGED_DESCRIPTOR })).toEqual({
      ok: false,
      reason: "no_copy_descriptor",
    });
  });

  test("REQ-6: row 4 — command_missing", () => {
    expect(eligibility({ ...BASE_OK, commandOnPath: false })).toEqual({
      ok: false,
      reason: "command_missing",
    });
  });

  test("REQ-6: row 5 — main_has_no_index when mainMarker is missing, directory, or other", () => {
    for (const mainMarker of ["missing", "directory", "other"] as const) {
      expect(eligibility({ ...BASE_OK, mainMarker })).toEqual({
        ok: false,
        reason: "main_has_no_index",
      });
    }
  });

  test("REQ-6: row 6 — state copying is NOT a skip reason (returns ok:true so inheritWorktreeIndex recovers it)", () => {
    const copyingState: WorktreeState = {
      phase: "copying",
      engine: "codegraph",
      incarnation: LINKED_LAYOUT.incarnation,
      updatedAt: 1000,
    };
    expect(
      eligibility({
        ...BASE_OK,
        worktreeMarker: "file",
        ownedTracked: true,
        state: copyingState,
      }),
    ).toEqual({ ok: true });
  });

  test("REQ-6: row 7 — previous_attempt_failed wins before row 8 (path_unsafe / worktree_has_index)", () => {
    const failedState: WorktreeState = {
      phase: "failed",
      engine: "codegraph",
      incarnation: LINKED_LAYOUT.incarnation,
      updatedAt: 1000,
      stage: "verify",
      reason: "bad",
    };
    expect(
      eligibility({
        ...BASE_OK,
        state: failedState,
        ownedTracked: true,
        worktreeMarker: "other",
      }),
    ).toEqual({ ok: false, reason: "previous_attempt_failed" });
  });

  test("REQ-6: row 7 — state complete with missing marker allows start-over, and ownedTracked is not a veto on that start-over", () => {
    const completeState: WorktreeState = {
      phase: "complete",
      engine: "codegraph",
      incarnation: LINKED_LAYOUT.incarnation,
      updatedAt: 1000,
    };
    expect(
      eligibility({
        ...BASE_OK,
        state: completeState,
        worktreeMarker: "missing",
        ownedTracked: true,
      }),
    ).toEqual({ ok: true });
  });

  test("REQ-6: row 8 — worktree_has_index when marker is file, path_unsafe when marker is directory/other or ownedTracked", () => {
    expect(eligibility({ ...BASE_OK, worktreeMarker: "file" })).toEqual({
      ok: false,
      reason: "worktree_has_index",
    });
    expect(eligibility({ ...BASE_OK, worktreeMarker: "directory" })).toEqual({
      ok: false,
      reason: "path_unsafe",
    });
    expect(eligibility({ ...BASE_OK, worktreeMarker: "other" })).toEqual({
      ok: false,
      reason: "path_unsafe",
    });
    expect(eligibility({ ...BASE_OK, worktreeMarker: "missing", ownedTracked: true })).toEqual({
      ok: false,
      reason: "path_unsafe",
    });
  });
});

describe("TEST-7: indexQuestionOwner (REQ-2, REQ-5)", () => {
  const BASE: EligibilityInput = {
    claudishChild: false,
    layout: LINKED_LAYOUT,
    engineId: "codegraph",
    setup: "active",
    descriptor: COPY_DESCRIPTOR,
    commandOnPath: true,
    mainMarker: "file",
    worktreeMarker: "missing",
    ownedTracked: false,
    state: undefined,
  };

  test("REQ-5: returns 'engine' for linked engine-managed with active engine and mainMarker === 'file'", () => {
    expect(
      indexQuestionOwner({
        ...BASE,
        engineId: "mnemex",
        descriptor: ENGINE_MANAGED_DESCRIPTOR,
        mainMarker: "file",
      }),
    ).toBe("engine");

    // If main has no index file, evaluator owns it (today's flow):
    expect(
      indexQuestionOwner({
        ...BASE,
        engineId: "mnemex",
        descriptor: ENGINE_MANAGED_DESCRIPTOR,
        mainMarker: "missing",
      }),
    ).toBe("evaluator");
  });

  test("REQ-2: returns 'hook' when linked copy engine is eligible or copying/complete, and 'evaluator' when failed or unsafe", () => {
    expect(indexQuestionOwner(BASE)).toBe("hook");
    expect(indexQuestionOwner({ ...BASE, worktreeMarker: "file" })).toBe("hook");
    expect(
      indexQuestionOwner({
        ...BASE,
        state: { phase: "copying", engine: "codegraph", incarnation: "inc-wt-1", updatedAt: 1 },
      }),
    ).toBe("hook");

    // Once state is failed, evaluator owns the question again:
    expect(
      indexQuestionOwner({
        ...BASE,
        state: {
          phase: "failed",
          engine: "codegraph",
          incarnation: "inc-wt-1",
          updatedAt: 1,
          stage: "verify",
        },
      }),
    ).toBe("evaluator");

    // Symlink/escape/directory at worktreeMarker with no record yet -> evaluator:
    expect(indexQuestionOwner({ ...BASE, worktreeMarker: "other" })).toBe("evaluator");
    expect(indexQuestionOwner({ ...BASE, worktreeMarker: "directory" })).toBe("evaluator");

    // Main tree, claudish child, missing command, missing main index -> evaluator:
    expect(indexQuestionOwner({ ...BASE, layout: { kind: "main" } })).toBe("evaluator");
    expect(indexQuestionOwner({ ...BASE, claudishChild: true })).toBe("evaluator");
    expect(indexQuestionOwner({ ...BASE, commandOnPath: false })).toBe("evaluator");
    expect(indexQuestionOwner({ ...BASE, mainMarker: "missing" })).toBe("evaluator");
  });
});

describe("TEST-8: indexReady (REQ-2)", () => {
  test("REQ-2: false only when state.phase === 'copying' or marker !== 'file'", () => {
    expect(indexReady("file", undefined)).toBe(true);
    expect(
      indexReady("file", { phase: "complete", engine: "codegraph", incarnation: "i", updatedAt: 1 }),
    ).toBe(true);
    expect(
      indexReady("file", { phase: "failed", engine: "codegraph", incarnation: "i", updatedAt: 1 }),
    ).toBe(true);
    expect(
      indexReady("file", { phase: "copying", engine: "codegraph", incarnation: "i", updatedAt: 1 }),
    ).toBe(false);

    for (const kind of ["missing", "directory", "other"] as const) {
      expect(indexReady(kind, undefined)).toBe(false);
      expect(
        indexReady(kind, { phase: "complete", engine: "codegraph", incarnation: "i", updatedAt: 1 }),
      ).toBe(false);
    }
  });
});

describe("TEST-9: mergeChanged (REQ-4)", () => {
  test("REQ-4: deduplicates, sorts, and partitions into changed (file) and deleted (missing, other, directory)", () => {
    const kinds: Record<string, FileKind> = {
      "src/b.ts": "file",
      "src/a.ts": "file",
      "src/gone.ts": "missing",
      "src/link.ts": "other",
      "src/became-dir": "directory",
    };
    const result = mergeChanged(
      {
        committed: ["src/b.ts", "src/gone.ts", "src/a.ts"],
        uncommitted: ["src/a.ts", "src/link.ts", "src/became-dir"],
      },
      (rel) => kinds[rel] ?? "missing",
    );
    expect(result).toEqual({
      changed: ["src/a.ts", "src/b.ts"],
      deleted: ["src/became-dir", "src/gone.ts", "src/link.ts"],
    });
  });
});

describe("TEST-10: renderOutcome (REQ-4)", () => {
  test("REQ-4: skipped produces no systemMessage and adviceNeeded: false", () => {
    expect(renderOutcome({ kind: "skipped", reason: "not_linked_worktree" })).toEqual({
      systemMessage: undefined,
      adviceNeeded: false,
    });
  });

  test("REQ-4: inherited produces exact messages for fresh, refreshed, and not_refreshed with 0, N, and undefined counts", () => {
    expect(renderOutcome({ kind: "inherited", refresh: "fresh", changed: 0 })).toEqual({
      systemMessage: "Started from the main project's index; nothing to update.",
      adviceNeeded: false,
    });
    expect(renderOutcome({ kind: "inherited", refresh: "fresh", changed: 3 })).toEqual({
      systemMessage: "Started from the main project's index; 3 changed files updated.",
      adviceNeeded: false,
    });
    expect(renderOutcome({ kind: "inherited", refresh: "fresh", changed: undefined })).toEqual({
      systemMessage: "Started from the main project's index; changed files updated.",
      adviceNeeded: false,
    });

    expect(renderOutcome({ kind: "inherited", refresh: "refreshed", changed: 0 })).toEqual({
      systemMessage:
        "Started from the main project's index, brought up to date first; nothing to update.",
      adviceNeeded: false,
    });
    expect(renderOutcome({ kind: "inherited", refresh: "refreshed", changed: 5 })).toEqual({
      systemMessage:
        "Started from the main project's index, brought up to date first; 5 changed files updated.",
      adviceNeeded: false,
    });
    expect(renderOutcome({ kind: "inherited", refresh: "refreshed", changed: undefined })).toEqual({
      systemMessage:
        "Started from the main project's index, brought up to date first; changed files updated.",
      adviceNeeded: false,
    });

    expect(renderOutcome({ kind: "inherited", refresh: "not_refreshed", changed: 0 })).toEqual({
      systemMessage:
        "Started from the main project's index, which is behind and could not be brought up to date first; nothing to update.",
      adviceNeeded: false,
    });
    expect(renderOutcome({ kind: "inherited", refresh: "not_refreshed", changed: 4 })).toEqual({
      systemMessage:
        "Started from the main project's index, which is behind and could not be brought up to date first; 4 changed files updated.",
      adviceNeeded: false,
    });
    expect(
      renderOutcome({ kind: "inherited", refresh: "not_refreshed", changed: undefined }),
    ).toEqual({
      systemMessage:
        "Started from the main project's index, which is behind and could not be brought up to date first; changed files updated.",
      adviceNeeded: false,
    });
  });

  test("REQ-4: blocked produces exact stage messages, respects advice flag, and never leaks internal reason or paths", () => {
    expect(
      renderOutcome({
        kind: "blocked",
        stage: "probe",
        reason: "/secret/path/sqlite PRAGMA integrity_check failed",
        advice: true,
      }),
    ).toEqual({
      systemMessage:
        "The main project's search index could not be used, so this worktree has no index yet.",
      adviceNeeded: true,
    });

    for (const stage of ["copy", "catchup", "verify", "state", "path"] as const satisfies readonly BlockStage[]) {
      const withAdvice = renderOutcome({
        kind: "blocked",
        stage,
        reason: `/internal/path/${stage} mechanism error`,
        advice: true,
      });
      expect(withAdvice).toEqual({
        systemMessage:
          "Could not start from the main project's index, so this worktree has no index yet.",
        adviceNeeded: true,
      });
      expect(withAdvice.systemMessage).not.toContain("/internal/path");
    }

    expect(
      renderOutcome({
        kind: "blocked",
        stage: "state",
        reason: "rollback incomplete",
        advice: false,
      }),
    ).toEqual({
      systemMessage:
        "Could not start from the main project's index, so this worktree has no index yet.",
      adviceNeeded: false,
    });

    expect(
      renderOutcome({
        kind: "blocked",
        stage: "timeout",
        reason: "lock wait timed out after 105000ms",
        advice: true,
      }),
    ).toEqual({
      systemMessage:
        "Another start is still preparing the search index for this project, so this worktree has no index yet.",
      adviceNeeded: true,
    });
  });
});
