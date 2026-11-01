/**
 * snapshot.ts — copy an engine's index from one project directory into another.
 *
 * `recipe.include` lists the files in copy order, the marker last, so the marker only appears
 * once everything before it is in place. In a `sqlite` store the marker (the database) is
 * copied by `VACUUM INTO`: one consistent file with no `-wal` or `-shm`, whatever a running
 * engine is doing to the original. Every other file, and every file of a `file` store, is a
 * plain copy. Nothing is cloned, linked or shared.
 *
 * A failed copy leaves whatever it made; the caller's rollback owns the cleanup.
 */

import { isAbsolute, join } from "node:path";

import type { CopyRecipe, IndexState } from "../core/index-descriptor";
import type { WorktreeIo } from "./ports";

type CopyResult = { ok: true; state: IndexState } | { ok: false; stage: "probe" | "copy"; reason: string };

function inside(rel: string): boolean {
  return rel !== "" && !isAbsolute(rel) && !rel.split(/[\\/]+/u).includes("..");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `inspect` on the destination, never throwing. */
function inspectAt(io: WorktreeIo, recipe: CopyRecipe, projectDir: string): { complete: boolean; state: IndexState } {
  const source = io.openIndexSource(projectDir);
  try {
    const state = recipe.inspect(source);
    return { complete: state.complete, state };
  } catch {
    return { complete: false, state: { complete: false } };
  } finally {
    source.close();
  }
}

/**
 * Copies each `recipe.include` file from `fromProjectDir` into `toProjectDir`, in order
 * (marker last), fails if the marker or a non-file destination exists (an existing regular file
 * among the others is kept as it is), verifies the copy (`sqliteIntegrity`, then
 * `recipe.inspect` complete) and returns the COPY's state. A copy that arrives but does not
 * verify is `probe` (the original index could not be used); a copy that could not be made
 * is `copy`.
 */
export async function copyIndex(
  io: WorktreeIo,
  a: { recipe: CopyRecipe; marker: string; fromProjectDir: string; toProjectDir: string },
): Promise<CopyResult> {
  const { recipe, marker } = a;
  const files = recipe.include;
  if (files.length === 0 || files[files.length - 1] !== marker) {
    return { ok: false, stage: "copy", reason: "the marker is not the last file of the copy recipe" };
  }
  const unsafe = files.find((rel) => !inside(rel));
  if (unsafe !== undefined) return { ok: false, stage: "copy", reason: `copy recipe entry escapes the project: ${unsafe}` };

  const destinations = files.map((rel) => join(a.toProjectDir, rel));
  // The marker must not exist: it would be someone's own index. Another include file that is
  // already a regular file (an ignore file the user committed, a leftover of an earlier copy) is
  // theirs to keep: it is not copied over and not removed. Anything else in the way is an error.
  const written: string[] = [];
  for (const [at, dest] of destinations.entries()) {
    const kind = io.lstatKind(dest);
    if (kind === "missing") written.push(dest);
    else if (files[at] === marker || kind !== "file") {
      return { ok: false, stage: "copy", reason: `destination exists: ${files[at]}` };
    }
  }

  // A `file` store can be read mid-write by an engine that is running; one retry on a torn copy.
  const attempts = recipe.store === "file" ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      for (const [at, rel] of files.entries()) {
        const from = join(a.fromProjectDir, rel);
        const to = destinations[at] as string;
        if (!written.includes(to)) continue;
        if (recipe.store === "sqlite" && rel === marker) await io.sqliteSnapshot(from, to);
        else await io.copyFile(from, to);
      }
    } catch (error) {
      return { ok: false, stage: "copy", reason: messageOf(error) };
    }

    if (recipe.store === "sqlite" && !(await io.sqliteIntegrity(join(a.toProjectDir, marker)))) {
      return { ok: false, stage: "probe", reason: "the copied database failed its integrity check" };
    }
    const verdict = inspectAt(io, recipe, a.toProjectDir);
    if (verdict.complete) return { ok: true, state: verdict.state };

    if (attempt < attempts) {
      for (const dest of [...written].reverse()) await io.removeTree(dest);
      continue;
    }
    return { ok: false, stage: "probe", reason: "the copied index does not read as complete" };
  }
  return { ok: false, stage: "copy", reason: "no copy attempt was made" };
}
