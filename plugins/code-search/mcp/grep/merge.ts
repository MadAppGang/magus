/**
 * merge.ts — which engine hits become extras in the block after grep's own output.
 *
 * The server never sees grep's output. It rebuilds grep's match set from the same file
 * bytes instead: a line grep matched is one the superset matcher matches, and a line
 * grep printed is one inside the context window of such a line. Everything here is a
 * pure function of the call, the candidate files' lines and the engine's ranked hits.
 *
 * Two rules keep an extra from ever repeating grep (D8):
 *   - content mode keeps an engine hit line only if it does not match and lies outside
 *     printed(F); only the hit line itself is kept, never a window around it;
 *   - files mode lists only files in which no line matches, which grep therefore omitted.
 *
 * The matcher is a SUPERSET of grep's (a substring test whatever `-w` says, `iu` folding
 * for `-i`). A superset can only call more lines "matched", which removes extras; it can
 * never let a line grep printed through as an extra. So the header's "none of these lines
 * contains PATTERN" is true by construction.
 */

import type { SearchCall } from "./call";
import { makeLineMatcher } from "./pattern";

/**
 * A repo-relative engine path to a path relative to `baseRel`, or `undefined` when it
 * lies outside it.
 *
 * `baseRel` is a directory relative to the project root: "" at the root, else e.g.
 * `src/store`. The service spells the emitted path from the operand as written.
 */
export function rebase(file: string, baseRel: string): string | undefined {
  // Absolute or escaping: the port promises repo-relative POSIX, and a path that still
  // leaves the repo cannot be inside the searched tree.
  if (file === "" || file.startsWith("/") || file === ".." || file.startsWith("../")) return undefined;
  if (baseRel === "") return file;
  const prefix = `${baseRel}/`;
  if (!file.startsWith(prefix)) return undefined;
  const rest = file.slice(prefix.length);
  return rest === "" ? undefined : rest;
}

/**
 * The engine's own line number to a 1-based line of the file, or `undefined` when it
 * cannot be one. No snapping, no nearest-line guess: a hit whose number does not land
 * on a real line is dropped, because an extra on the wrong line is worse than none.
 */
export function normaliseLine(
  rawLine: number | undefined,
  lineBase: 0 | 1,
  lineCount: number,
): number | undefined {
  if (rawLine === undefined) return undefined;
  const line = rawLine + 1 - lineBase;
  return Number.isInteger(line) && line >= 1 && line <= lineCount ? line : undefined;
}

export interface Candidate {
  /** The path as the block spells it (the service applies P5's spelling rule). */
  path: string;
  /** `splitLines` of the BOM-stripped file. */
  lines: readonly string[];
  /** Normalised 1-based lines, in engine rank order (content mode); may be []. */
  hitLines: readonly number[];
  /** Engine rank of the file's first hit, 0 = best. */
  rank: number;
}

export type Plan =
  | { mode: "content"; files: { path: string; lines: { n: number; text: string }[] }[] }
  | { mode: "files"; paths: string[] };

/**
 * `printed[k]` for k in 1..N: the union of `[m − before, m + after] ∩ [1, N]` over every
 * matching line m. A sweep over a difference array, so a large `-C` costs O(N), not
 * O(matches × window).
 */
function printedLines(
  lines: readonly string[],
  matches: (line: string) => boolean,
  before: number,
  after: number,
): boolean[] {
  const n = lines.length;
  const delta = new Array<number>(n + 2).fill(0);
  for (let m = 1; m <= n; m += 1) {
    if (!matches(lines[m - 1] ?? "")) continue;
    delta[Math.max(1, m - before)] = (delta[Math.max(1, m - before)] ?? 0) + 1;
    const stop = Math.min(n, m + after) + 1;
    delta[stop] = (delta[stop] ?? 0) - 1;
  }
  const printed = new Array<boolean>(n + 1).fill(false);
  let open = 0;
  for (let k = 1; k <= n; k += 1) {
    open += delta[k] ?? 0;
    printed[k] = open > 0;
  }
  return printed;
}

/** Best rank first; a stable sort keeps the caller's order on ties. A path seen twice
 *  keeps its better-ranked entry, so no file can be emitted twice. */
function rankOrder(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return [...candidates]
    .sort((a, b) => a.rank - b.rank)
    .filter((c) => {
      if (seen.has(c.path)) return false;
      seen.add(c.path);
      return true;
    });
}

/**
 * The extras for one call.
 *
 * Content: a hit line is an extra iff it does not match and lies outside printed(F),
 * where printed(F) = ∪[m − before, m + after] ∩ [1, N] over the matching lines m. Only the
 * hit line is kept. At most `extrasMax` lines overall. Files are taken in candidate rank
 * order and, within a file, hits in engine order (duplicates dropped); the candidate's
 * rank is the only cross-file rank the port carries, so that is the order the cap is
 * applied in.
 *
 * Files: a candidate is an extra iff no line matches. At most `extrasMax`, in rank order.
 *
 * `Candidate.path` is carried through as given: the caller spells it as the block shows it.
 */
export function planExtras(
  call: Pick<SearchCall, "route" | "mode" | "pattern" | "ignoreCase" | "before" | "after">,
  candidates: readonly Candidate[],
  extrasMax: number,
): Plan {
  // The tool route always folds case (review round 1, internal M2). Claude Code's system
  // rg reads RIPGREP_CONFIG_PATH, where `--smart-case` folds case with no `-i` in the
  // tool input, so a case-sensitive test could offer a line the tool already printed.
  // Folding is a superset: it can only drop an extra, never repeat one. The Bash route's
  // ugrep reads no config, so `-i` there is the whole truth.
  const matches = makeLineMatcher(call.pattern, call.ignoreCase || call.route === "tool");
  const ordered = rankOrder(candidates);

  if (call.mode === "files") {
    const paths: string[] = [];
    for (const candidate of ordered) {
      if (paths.length >= extrasMax) break;
      if (!candidate.lines.some(matches)) paths.push(candidate.path);
    }
    return { mode: "files", paths };
  }

  const files: { path: string; lines: { n: number; text: string }[] }[] = [];
  let budget = extrasMax;

  for (const candidate of ordered) {
    if (budget <= 0) break;
    const { lines } = candidate;
    const n = lines.length;
    if (n === 0 || candidate.hitLines.length === 0) continue;
    const printed = printedLines(lines, matches, call.before, call.after);

    const kept: { n: number; text: string }[] = [];
    const seen = new Set<number>();
    for (const hit of candidate.hitLines) {
      if (kept.length >= budget) break;
      if (!Number.isInteger(hit) || hit < 1 || hit > n || seen.has(hit)) continue;
      seen.add(hit);
      // printed[hit] covers a matching hit too: a match lies inside its own window.
      if (printed[hit] === true) continue;
      kept.push({ n: hit, text: lines[hit - 1] ?? "" });
    }
    if (kept.length === 0) continue;
    budget -= kept.length;
    files.push({ path: candidate.path, lines: kept });
  }

  return { mode: "content", files };
}
