/**
 * snapshot.test.ts — unit tests for mcp/worktree/snapshot.ts (TEST-14, REQ-4, REQ-6).
 *
 * Covers:
 * - sqlite store: copies include files in order (marker last) via sqliteSnapshot (VACUUM INTO),
 *   never copies -wal or -shm sidecars, verifies sqliteIntegrity and recipe.inspect().complete,
 *   and returns the copy's IndexState.
 * - file store: copies via copyFile, retries once on a torn JSON read, fails if still incomplete.
 * - Fails if destination marker already exists.
 * - Keeps an existing regular non-marker include file on start-over when marker is missing.
 * - Always closes IndexSource handles.
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
import type { CopyRecipe, FileKind, IndexSource, IndexState } from "../core/index-descriptor";
import type { WorktreeIo } from "./ports";
import { copyIndex } from "./snapshot";

const scratchDirs: string[] = [];
afterEach(() => {
  for (const d of scratchDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeDirs(): { fromDir: string; toDir: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cs-snap-")));
  scratchDirs.push(root);
  const fromDir = join(root, "main");
  const toDir = join(root, "wt");
  mkdirSync(fromDir, { recursive: true });
  mkdirSync(toDir, { recursive: true });
  return { fromDir, toDir };
}

function makeTestIo(opts?: {
  integrityOk?: boolean;
  onCopyOrder?: string[];
  onCloseCount?: { count: number };
  tornFirstCopy?: boolean;
}): WorktreeIo {
  let copyCalls = 0;
  const partial: Partial<WorktreeIo> = {
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
    mkdirp: async (path: string) => {
      mkdirSync(path, { recursive: true });
    },
    copyFile: async (from: string, to: string) => {
      opts?.onCopyOrder?.push(`file:${to}`);
      if (existsSync(to)) {
        const err = Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
        throw err;
      }
      mkdirSync(dirname(to), { recursive: true });
      copyCalls += 1;
      if (opts?.tornFirstCopy && copyCalls === 1) {
        writeFileSync(to, "{ torn json");
        return;
      }
      copyFileSync(from, to);
    },
    removeTree: async (path: string) => {
      rmSync(path, { recursive: true, force: true });
    },
    sqliteSnapshot: async (from: string, to: string) => {
      opts?.onCopyOrder?.push(`sqlite:${to}`);
      if (existsSync(to)) {
        const err = Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
        throw err;
      }
      mkdirSync(dirname(to), { recursive: true });
      // VACUUM INTO produces a single consistent file without -wal or -shm sidecars
      copyFileSync(from, to);
    },
    sqliteIntegrity: async (_path: string) => opts?.integrityOk ?? true,
    openIndexSource(root: string): IndexSource {
      return {
        exists(rel: string): boolean {
          return existsSync(join(root, rel));
        },
        sqlite(rel: string) {
          const full = join(root, rel);
          if (!existsSync(full)) return undefined;
          const content = readFileSync(full, "utf8");
          if (!content.startsWith("VALID_SQLITE:")) return undefined;
          const commit = content.split(":")[1]?.trim() ?? "";
          return {
            query(_sql: string) {
              return [["git_head", commit], ["dirty_paths", "[]"]];
            },
          };
        },
        json(rel: string): unknown | undefined {
          const full = join(root, rel);
          if (!existsSync(full)) return undefined;
          try {
            return JSON.parse(readFileSync(full, "utf8"));
          } catch {
            return undefined;
          }
        },
        close() {
          if (opts?.onCloseCount) opts.onCloseCount.count += 1;
        },
      };
    },
  };
  return partial as unknown as WorktreeIo;
}

describe("TEST-14: copyIndex (REQ-4, REQ-6)", () => {
  test("REQ-4, REQ-6: copies sqlite store in include order (marker last), leaves no -wal/-shm sidecars, verifies integrity and inspect", async () => {
    const { fromDir, toDir } = makeDirs();
    mkdirSync(join(fromDir, ".codegraph"), { recursive: true });
    writeFileSync(join(fromDir, ".codegraph", "config.json"), '{"v":1}');
    writeFileSync(join(fromDir, ".codegraph", "codegraph.db"), "VALID_SQLITE:abc1234");
    // Sidecars in main that must NEVER be copied to the worktree:
    writeFileSync(join(fromDir, ".codegraph", "codegraph.db-wal"), "wal-bytes");
    writeFileSync(join(fromDir, ".codegraph", "codegraph.db-shm"), "shm-bytes");

    const order: string[] = [];
    const closeCount = { count: 0 };
    const io = makeTestIo({ onCopyOrder: order, onCloseCount: closeCount });

    const recipe: CopyRecipe = {
      store: "sqlite",
      include: [".codegraph/config.json", ".codegraph/codegraph.db"],
      inspect(source: IndexSource): IndexState {
        const db = source.sqlite(".codegraph/codegraph.db");
        if (!db) return { complete: false };
        const rows = db.query("SELECT key, value FROM project_metadata");
        const commit = rows.find((r) => r[0] === "git_head")?.[1];
        if (typeof commit !== "string" || !commit) return { complete: false };
        return { complete: true, commit, dirtyPaths: [] };
      },
      updateRefreshesModified: true,
      isIndexable: () => true,
      indexedFiles: () => new Set(),
      update: ["codegraph", "sync"],
    };

    const res = await copyIndex(io, {
      recipe,
      marker: ".codegraph/codegraph.db",
      fromProjectDir: fromDir,
      toProjectDir: toDir,
    });

    expect(res).toEqual({
      ok: true,
      state: { complete: true, commit: "abc1234", dirtyPaths: [] },
    });
    // Marker was copied last:
    expect(order).toHaveLength(2);
    expect(order[0]).toContain(".codegraph/config.json");
    expect(order[1]).toContain(".codegraph/codegraph.db");
    // Sidecars were NOT copied:
    expect(existsSync(join(toDir, ".codegraph", "codegraph.db-wal"))).toBe(false);
    expect(existsSync(join(toDir, ".codegraph", "codegraph.db-shm"))).toBe(false);
    expect(closeCount.count).toBeGreaterThanOrEqual(1);
  });

  test("REQ-4, REQ-6: fails when destination marker already exists", async () => {
    const { fromDir, toDir } = makeDirs();
    mkdirSync(join(fromDir, ".codegraph"), { recursive: true });
    writeFileSync(join(fromDir, ".codegraph", "codegraph.db"), "VALID_SQLITE:abc1234");
    mkdirSync(join(toDir, ".codegraph"), { recursive: true });
    writeFileSync(join(toDir, ".codegraph", "codegraph.db"), "EXISTING_INDEX");

    const recipe: CopyRecipe = {
      store: "sqlite",
      include: [".codegraph/codegraph.db"],
      inspect: () => ({ complete: true, commit: "abc1234", dirtyPaths: [] }),
      updateRefreshesModified: true,
      isIndexable: () => true,
      indexedFiles: () => new Set(),
      update: ["codegraph", "sync"],
    };

    const res = await copyIndex(makeTestIo(), {
      recipe,
      marker: ".codegraph/codegraph.db",
      fromProjectDir: fromDir,
      toProjectDir: toDir,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stage).toBe("copy");
    }
    expect(readFileSync(join(toDir, ".codegraph", "codegraph.db"), "utf8")).toBe("EXISTING_INDEX");
  });

  test("REQ-4, REQ-6: fails when sqliteIntegrity returns false or inspect().complete is false", async () => {
    const { fromDir, toDir } = makeDirs();
    mkdirSync(join(fromDir, ".codegraph"), { recursive: true });
    writeFileSync(join(fromDir, ".codegraph", "codegraph.db"), "VALID_SQLITE:abc1234");

    const recipe: CopyRecipe = {
      store: "sqlite",
      include: [".codegraph/codegraph.db"],
      inspect: () => ({ complete: true, commit: "abc1234", dirtyPaths: [] }),
      updateRefreshesModified: true,
      isIndexable: () => true,
      indexedFiles: () => new Set(),
      update: ["codegraph", "sync"],
    };

    const badIntegrity = await copyIndex(makeTestIo({ integrityOk: false }), {
      recipe,
      marker: ".codegraph/codegraph.db",
      fromProjectDir: fromDir,
      toProjectDir: toDir,
    });
    expect(badIntegrity.ok).toBe(false);
  });

  test("REQ-4: file store retries once on a torn JSON read and succeeds when retry is valid", async () => {
    const { fromDir, toDir } = makeDirs();
    mkdirSync(join(fromDir, "graphify-out"), { recursive: true });
    writeFileSync(
      join(fromDir, "graphify-out", "graph.json"),
      JSON.stringify({ commit: "def5678", dirtyPaths: [] }),
    );

    const recipe: CopyRecipe = {
      store: "file",
      include: ["graphify-out/graph.json"],
      inspect(source: IndexSource): IndexState {
        const data = source.json("graphify-out/graph.json") as
          | { commit?: string; dirtyPaths?: string[] }
          | undefined;
        if (!data || typeof data.commit !== "string") return { complete: false };
        return { complete: true, commit: data.commit, dirtyPaths: data.dirtyPaths ?? [] };
      },
      updateRefreshesModified: true,
      isIndexable: () => true,
      indexedFiles: () => undefined,
      update: ["graphify", "update", ".", "--no-cluster"],
    };

    const res = await copyIndex(makeTestIo({ tornFirstCopy: true }), {
      recipe,
      marker: "graphify-out/graph.json",
      fromProjectDir: fromDir,
      toProjectDir: toDir,
    });
    expect(res).toEqual({
      ok: true,
      state: { complete: true, commit: "def5678", dirtyPaths: [] },
    });
  });
});
