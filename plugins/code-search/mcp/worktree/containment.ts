/**
 * containment.ts — is this path really inside this tree?
 *
 * A committed symlink at an index directory, or a main tree whose index directory points
 * elsewhere, must never redirect a read, a copy or a delete. `containedKind` answers what
 * is at `root/rel` only when every ancestor between `root` and the entry is a real
 * directory that resolves inside `root`; otherwise the answer is "other".
 */

import { isAbsolute, join, sep } from "node:path";

import type { FileKind } from "../core/index-descriptor";
import type { WorktreeIo } from "./ports";

function inside(path: string | undefined, realRoot: string): boolean {
  return path !== undefined && (path === realRoot || path.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep));
}

/** "other" when an ancestor between root and rel is a symlink or resolves outside root's realpath. */
export function containedKind(io: WorktreeIo, root: string, rel: string): FileKind {
  if (isAbsolute(rel)) return "other";
  const segments = rel.split(/[\\/]+/u).filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return "other";

  const realRoot = io.realpath(root);
  if (realRoot === undefined) return "other";

  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const kind = io.lstatKind(current);
    // Nothing can exist beneath a missing ancestor.
    if (kind === "missing") return "missing";
    if (kind !== "directory") return "other";
    if (!inside(io.realpath(current), realRoot)) return "other";
  }

  const target = join(root, ...segments);
  const kind = io.lstatKind(target);
  if (kind === "missing") return "missing";
  // The entry itself, when it is a directory, must also resolve inside the root.
  if (kind === "directory" && segments.length > 0 && !inside(io.realpath(target), realRoot)) return "other";
  return kind;
}
