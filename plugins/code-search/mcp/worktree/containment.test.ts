/**
 * containment.test.ts — unit tests for mcp/worktree/containment.ts (TEST-11, REQ-6).
 *
 * Verifies that containedKind returns "file", "directory", or "missing" only when the
 * target and every ancestor between root and rel is a real non-symlink entry inside
 * root's realpath, and returns "other" for symlinks or escaping ancestors.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileKind } from "../core/index-descriptor";
import { containedKind } from "./containment";
import type { WorktreeIo } from "./ports";

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fsIo(): WorktreeIo {
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
  };
  return partial as unknown as WorktreeIo;
}

describe("TEST-11: containedKind (REQ-6)", () => {
  test("REQ-6: returns file, directory, and missing for real entries inside root", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-")));
    scratchDirs.push(base);
    mkdirSync(join(base, ".idx"), { recursive: true });
    writeFileSync(join(base, ".idx", "db.sqlite"), "sqlite-bytes");

    const io = fsIo();
    expect(containedKind(io, base, ".idx/db.sqlite")).toBe("file");
    expect(containedKind(io, base, ".idx")).toBe("directory");
    expect(containedKind(io, base, ".idx/missing.sqlite")).toBe("missing");
    expect(containedKind(io, base, ".missing-dir/db.sqlite")).toBe("missing");
  });

  test("REQ-6: returns 'other' when the marker itself is a symlink", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-symfile-")));
    scratchDirs.push(base);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-out-")));
    scratchDirs.push(outside);
    writeFileSync(join(outside, "target.sqlite"), "outside-data");

    mkdirSync(join(base, ".idx"), { recursive: true });
    symlinkSync(join(outside, "target.sqlite"), join(base, ".idx", "db.sqlite"));

    expect(containedKind(fsIo(), base, ".idx/db.sqlite")).toBe("other");
  });

  test("REQ-6: returns 'other' when an intermediate ancestor directory is a symlink", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-symdir-")));
    scratchDirs.push(base);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-outdir-")));
    scratchDirs.push(outside);
    writeFileSync(join(outside, "db.sqlite"), "outside-data");

    symlinkSync(outside, join(base, ".idx"));

    const io = fsIo();
    expect(containedKind(io, base, ".idx")).toBe("other");
    expect(containedKind(io, base, ".idx/db.sqlite")).toBe("other");
    expect(containedKind(io, base, ".idx/not-yet-created.sqlite")).toBe("other");
  });

  test("REQ-6: returns 'other' when rel traverses outside root or root has no realpath", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cs-contain-escape-")));
    scratchDirs.push(base);
    const io = fsIo();

    expect(containedKind(io, base, "../outside.db")).toBe("other");
    expect(containedKind(io, base, ".idx/../../outside.db")).toBe("other");
    expect(containedKind(io, join(base, "nonexistent-root"), ".idx/db.sqlite")).toBe("other");
  });
});
