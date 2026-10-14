/**
 * grep-tool.ts — is this Grep-tool input one the server may answer with a block? (P3)
 *
 * The input is the tool call's `tool_input`, as the PostToolUse hook received it. The
 * accepted keys are the Grep tool's own schema; any other key, `multiline: true` or the
 * count mode declines, so an input this table does not understand never gets a block.
 *
 * `walkArgs` repeat the walk-relevant part of the argv the host builds for rg
 * (research-rg-calls.md, `HVn`): `--hidden`, one `--glob !<d>` per VCS dir, `--type`,
 * then the globs, split on whitespace and commas unless the value holds `{`. The host's
 * own trailing `--iglob`/`--glob` exclusions are not repeated: they only remove files,
 * and a file the oracle lists but the host skipped can still be offered only when it does
 * not contain the pattern.
 *
 * Pagination: `offset > 0` declines (`"offset"`), because a later page would only repeat
 * page 1's block. `head_limit` is accepted and ignored: the block is capped at
 * `EXTRAS_MAX` and labelled apart from the paginated result (D8).
 */

import { isWordLike } from "./pattern";
import { VCS_DIRS, type Decline, type SearchCall } from "./call";

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "pattern",
  "path",
  "glob",
  "type",
  "output_mode",
  "-i",
  "-n",
  "-A",
  "-B",
  "-C",
  "context",
  "head_limit",
  "offset",
  "multiline",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Absent, or a non-negative integer; anything else is a shape this table does not know. */
function optionalCount(value: unknown): { ok: true; n: number | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, n: undefined };
  return isCount(value) ? { ok: true, n: value } : { ok: false };
}

function optionalBool(value: unknown): boolean | undefined | "bad" {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : "bad";
}

/** The host's split: a `{` keeps the value whole (brace alternation holds commas). */
function splitGlobs(glob: string): string[] {
  if (glob.includes("{")) return [glob];
  return glob.split(/[\s,]+/u).filter((g) => g !== "");
}

export function parseGrepToolInput(input: unknown): SearchCall | Decline {
  if (!isRecord(input)) return { decline: "input" };
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) return { decline: `key:${key}` };
  }

  const offset = input["offset"];
  if (offset !== undefined) {
    if (isCount(offset) && offset > 0) return { decline: "offset" };
    if (offset !== 0) return { decline: "value:offset" };
  }
  if (!optionalCount(input["head_limit"]).ok) return { decline: "value:head_limit" };

  const multiline = optionalBool(input["multiline"]);
  if (multiline === "bad" || multiline === true) return { decline: "multiline" };

  const outputMode = input["output_mode"];
  let mode: SearchCall["mode"];
  if (outputMode === undefined || outputMode === "files_with_matches") mode = "files";
  else if (outputMode === "content") mode = "content";
  else return { decline: "output_mode" };

  const pattern = input["pattern"];
  if (typeof pattern !== "string" || !isWordLike(pattern)) return { decline: "pattern" };

  const ignoreCase = optionalBool(input["-i"]);
  if (ignoreCase === "bad" || optionalBool(input["-n"]) === "bad") return { decline: "flag" };

  const context = optionalCount(input["context"]);
  const c = optionalCount(input["-C"]);
  const a = optionalCount(input["-A"]);
  const b = optionalCount(input["-B"]);
  if (!context.ok || !c.ok || !a.ok || !b.ok) return { decline: "context" };

  const roots: string[] = [];
  const path = input["path"];
  if (path !== undefined) {
    if (typeof path !== "string" || path === "") return { decline: "path" };
    roots.push(path);
  }

  const walkArgs: string[] = ["--hidden"];
  for (const dir of VCS_DIRS) walkArgs.push("--glob", `!${dir}`);
  const type = input["type"];
  if (type !== undefined) {
    if (typeof type !== "string" || type === "") return { decline: "type" };
    walkArgs.push("--type", type);
  }
  const glob = input["glob"];
  if (glob !== undefined) {
    if (typeof glob !== "string") return { decline: "glob" };
    const globs = splitGlobs(glob);
    if (globs.length === 0) return { decline: "glob" };
    for (const g of globs) walkArgs.push("--glob", g);
  }

  // The host sends context flags in content mode only: `-C n` when context (or -C) is
  // set, else `-B n -A n`. In files mode nothing is printed around a match.
  let before = 0;
  let after = 0;
  if (mode === "content") {
    const both = context.n ?? c.n;
    before = both ?? b.n ?? 0;
    after = both ?? a.n ?? 0;
  }

  return {
    route: "tool",
    mode,
    pattern,
    ignoreCase: ignoreCase === true,
    before,
    after,
    roots,
    walkArgs,
  };
}
