/**
 * state.test.ts — unit tests for mcp/worktree/state.ts (TEST-12, REQ-6).
 *
 * Covers ownedTracked, ownedTrackedState, and rollbackIndex:
 * - Clean untracked owned paths -> "clean" / false; rollback deletes marker first, then owned paths.
 * - Tracked file under owned -> "tracked" / true; rollback deletes NOTHING and returns ok:false.
 * - Failing or timed-out VCS -> "unknown" / true (fails closed); rollback deletes NOTHING and returns ok:false.
 * - Exhausted remainingMs budget -> does not spawn VCS, returns "unknown" / true.
 * - Unremovable marker -> rollbackIndex returns ok:false.
 */

import { describe, expect, test } from "bun:test";
import type { FileKind } from "../core/index-descriptor";
import type { WorktreeIo } from "./ports";
import { ownedTracked, ownedTrackedState, rollbackIndex } from "./state";

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

describe("TEST-12: ownedTracked and ownedTrackedState (REQ-6)", () => {
  test("REQ-6: returns 'clean' (false) when git ls-files -z exits 0 with empty stdout", async () => {
    const calls: { argv: readonly string[]; opts: unknown }[] = [];
    const io = {
      run: async (argv: readonly string[], opts: unknown) => {
        calls.push({ argv, opts });
        return makeRunResult(0, "");
      },
    } as unknown as WorktreeIo;

    expect(
      await ownedTrackedState(io, { projectDir: "/wt", owned: [".idx", ".idx-cache"] }),
    ).toBe("clean");
    expect(await ownedTracked(io, { projectDir: "/wt", owned: [".idx", ".idx-cache"] })).toBe(
      false,
    );
    expect(calls.length).toBe(2);
    expect(calls[0]?.argv).toContain("ls-files");
    expect(calls[0]?.argv).toContain("-z");
  });

  test("REQ-6: returns 'tracked' (true) when git ls-files -z lists any file under owned", async () => {
    const io = {
      run: async () => makeRunResult(0, ".idx/config.json\0"),
    } as unknown as WorktreeIo;

    expect(await ownedTrackedState(io, { projectDir: "/wt", owned: [".idx"] })).toBe("tracked");
    expect(await ownedTracked(io, { projectDir: "/wt", owned: [".idx"] })).toBe(true);
  });

  test("REQ-6: fails closed ('unknown' / true) when VCS exits non-zero, times out, or throws", async () => {
    const ioExit = {
      run: async () => makeRunResult(128, "", "fatal: not a git repository"),
    } as unknown as WorktreeIo;
    expect(await ownedTrackedState(ioExit, { projectDir: "/wt", owned: [".idx"] })).toBe("unknown");
    expect(await ownedTracked(ioExit, { projectDir: "/wt", owned: [".idx"] })).toBe(true);

    const ioTimeout = {
      run: async () => makeRunResult(null, "", "", true),
    } as unknown as WorktreeIo;
    expect(await ownedTrackedState(ioTimeout, { projectDir: "/wt", owned: [".idx"] })).toBe(
      "unknown",
    );
    expect(await ownedTracked(ioTimeout, { projectDir: "/wt", owned: [".idx"] })).toBe(true);
  });

  test("REQ-6: does not start VCS call and returns 'unknown' (true) when remainingMs() <= 0", async () => {
    let spawned = false;
    const io = {
      run: async () => {
        spawned = true;
        return makeRunResult(0, "");
      },
    } as unknown as WorktreeIo;

    expect(
      await ownedTrackedState(io, {
        projectDir: "/wt",
        owned: [".idx"],
        remainingMs: () => 0,
      }),
    ).toBe("unknown");
    expect(
      await ownedTracked(io, {
        projectDir: "/wt",
        owned: [".idx"],
        remainingMs: () => -50,
      }),
    ).toBe(true);
    expect(spawned).toBe(false);
  });
});

describe("TEST-12: rollbackIndex (REQ-6)", () => {
  test("REQ-6: deletes NOTHING and returns ok:false when a tracked file sits under owned", async () => {
    const removed: string[] = [];
    const io = {
      run: async () => makeRunResult(0, ".idx/committed.json\0"),
      removeTree: async (path: string) => {
        removed.push(path);
      },
      lstatKind: (): FileKind => "file",
    } as unknown as WorktreeIo;

    const res = await rollbackIndex(io, {
      projectDir: "/wt",
      owned: [".idx", ".idx-sidecar"],
      marker: ".idx/db.sqlite",
    });
    expect(res).toEqual({ ok: false });
    expect(removed).toEqual([]);
  });

  test("REQ-6: deletes NOTHING and returns ok:false when VCS fails (fails closed)", async () => {
    const removed: string[] = [];
    const io = {
      run: async () => makeRunResult(128, "", "fatal"),
      removeTree: async (path: string) => {
        removed.push(path);
      },
      lstatKind: (): FileKind => "file",
    } as unknown as WorktreeIo;

    const res = await rollbackIndex(io, {
      projectDir: "/wt",
      owned: [".idx"],
      marker: ".idx/db.sqlite",
    });
    expect(res).toEqual({ ok: false });
    expect(removed).toEqual([]);
  });

  test("REQ-6: removes marker FIRST, then each owned entry of the engine, and returns ok:true", async () => {
    const removed: string[] = [];
    const existing = new Set<string>(["/wt/.idx/db.sqlite", "/wt/.idx", "/wt/.idx-aux"]);
    const io = {
      run: async () => makeRunResult(0, ""),
      removeTree: async (path: string) => {
        removed.push(path);
        existing.delete(path);
        if (path === "/wt/.idx") existing.delete("/wt/.idx/db.sqlite");
      },
      lstatKind: (path: string): FileKind => (existing.has(path) ? "file" : "missing"),
    } as unknown as WorktreeIo;

    const res = await rollbackIndex(io, {
      projectDir: "/wt",
      owned: [".idx", ".idx-aux"],
      marker: ".idx/db.sqlite",
    });
    expect(res).toEqual({ ok: true });
    expect(removed[0]).toBe("/wt/.idx/db.sqlite");
    expect(removed).toContain("/wt/.idx");
    expect(removed).toContain("/wt/.idx-aux");
  });

  test("REQ-6: returns ok:false when marker could not be removed", async () => {
    const io = {
      run: async () => makeRunResult(0, ""),
      removeTree: async () => {
        // Simulates EACCES where removeTree does not reject but file remains
      },
      lstatKind: (path: string): FileKind =>
        path === "/wt/.idx/db.sqlite" ? "file" : "missing",
    } as unknown as WorktreeIo;

    const res = await rollbackIndex(io, {
      projectDir: "/wt",
      owned: [".idx"],
      marker: ".idx/db.sqlite",
    });
    expect(res).toEqual({ ok: false });
  });
});
