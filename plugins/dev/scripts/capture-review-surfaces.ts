#!/usr/bin/env bun
/**
 * The single place the dev plugin computes "what should be reviewed".
 *
 * Three sites used to each invent their own range, and all three were wrong in
 * different ways. That divergence is the root cause, so the logic lives here and
 * the markdown files call it rather than restating it.
 *
 * WHY SEPARATE SURFACES: `git diff <commit>` compares the baseline tree to the
 * working-tree ENDPOINT. It does not concatenate baseline→index and
 * index→worktree, so a change that is staged and then reverted in the worktree
 * vanishes from it entirely. Three successive designs shipped a false-empty
 * capture for that reason. Never collapse these back into one range.
 *
 * READ-ONLY BY CONSTRUCTION: nothing here writes to the index. `git add -N` would
 * expose untracked files more cheaply, but it leaves intent-to-add entries that
 * make a later `git stash` fail outright and change what `git commit -a` commits.
 *
 * Usage:
 *   capture-review-surfaces.ts --repo <abs-path> --baseline <sha>   # session mode
 *   capture-review-surfaces.ts --repo <abs-path> [--base <ref>]     # branch mode
 *   ...add --stat for a summary instead of full patches.
 *   ...add --name-only for one path per line across every surface, deduplicated,
 *      with no headers — the machine-readable form a commit step can stage from.
 *   ...add --exclude-from <file> to drop paths from EVERY surface, in every mode.
 *      The file holds one root-relative path per line, exactly as --name-only
 *      prints them (newline-separated, blank lines ignored, no quoting). A path
 *      naming a directory drops everything beneath it. This is how a commit step
 *      subtracts the paths that were already dirty before its session started,
 *      so a commit baseline stops meaning "everything that differs from HEAD".
 *
 * Exit 0 with empty stdout means "nothing to review" — which callers MUST treat
 * as a reason to emit no verdict, not as a clean review.
 * Exit 2 means an argument was unusable: a value-taking flag (--repo, --baseline,
 * --base, --exclude-from) given with no value or an empty one, an --exclude-from
 * file that does not exist, or a --base that does not resolve. An empty
 * `--baseline ""` used to parse as a bare flag and silently select branch mode;
 * the header's "not guessing" promise covers arguments too, so it is fatal.
 * Exit 3 means git itself failed; that is not the same as an empty capture.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface Surface {
  label: string;
  body: string;
}

/** Above this many untracked files the untracked surface lists names instead of
 *  per-file patches. Each patch is one `git` process; an unignored build
 *  directory would otherwise spawn hundreds of them and stall the turn. */
const UNTRACKED_PATCH_CAP = 200;

/** Flags that take a value. Present with none, or with an empty string, is an
 *  argument error — not a signal to fall back to a different mode. */
const VALUE_FLAGS = ["repo", "baseline", "base", "exclude-from"] as const;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    // `!== undefined`, not truthiness: an empty string is a value that was
    // GIVEN, and main() must see it to reject it. Truthiness turned `--baseline ""`
    // into `--baseline` (true), which then read as "no baseline" → branch mode.
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function fatal(msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(2);
}

/** Run git in `repo`. Never inherits cwd — a linked worktree must be addressed
 *  explicitly, because callers cannot rely on shell state surviving between
 *  tool calls. `allowFail` covers commands whose non-zero exit is meaningful
 *  (`diff --no-index` exits 1 when it finds differences). */
function git(repo: string, args: string[], allowFail = false): string {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) {
    console.error(`git ${args.join(" ")}: ${r.error.message}`);
    process.exit(3);
  }
  if (r.status !== 0 && !allowFail) {
    console.error(`git ${args.join(" ")} exited ${r.status}: ${r.stderr?.trim()}`);
    process.exit(3);
  }
  return r.stdout ?? "";
}

/** Best-effort merge base against the repo's default branch.
 *  Returns null rather than falling back to HEAD~1 — that fallback silently
 *  reviews one commit of a many-commit branch and reports it as the whole
 *  change, which is the original bug. */
function resolveBase(repo: string, explicit?: string): string | null {
  if (explicit) {
    const r = spawnSync("git", ["-C", repo, "merge-base", "HEAD", explicit], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      // An explicitly requested base is an instruction, not a preference.
      fatal(`base '${explicit}' does not resolve. Not guessing.`);
    }
    return r.stdout.trim();
  }
  for (const cand of [
    "origin/HEAD",
    "origin/main",
    "origin/master",
    "origin/develop",
    "main",
    "master",
  ]) {
    const r = spawnSync("git", ["-C", repo, "merge-base", "HEAD", cand], {
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

/** The `--exclude-from` list, applied two ways so every surface agrees:
 *  - `pathspec`: appended after `--` to each `git diff`, as `:(exclude,literal)`
 *    magic. `literal` keeps `?`/`*`/`[` in a filename from becoming a glob;
 *    exclude-only pathspecs mean "everything except", and a directory entry
 *    excludes its contents — git's own semantics, so nothing is re-derived here.
 *    `git diff` has no --pathspec-from-file, so the list rides on argv; a
 *    session's dirty set is far below ARG_MAX, and a bigger one fails loudly at
 *    spawn (exit 3) rather than being silently truncated.
 *  - `drop(p)`: the same rule for the untracked listing, which comes from
 *    `ls-files` rather than a diff and so cannot take the pathspec. */
interface Exclusion {
  pathspec: string[];
  drop: (p: string) => boolean;
}

function loadExclusion(file: string | undefined): Exclusion {
  if (file === undefined) return { pathspec: [], drop: () => false };
  if (!existsSync(file)) fatal(`--exclude-from '${file}' does not exist. Not guessing.`);
  const entries = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l !== "");
  const exact = new Set(entries.map((e) => e.replace(/\/+$/, "")));
  const prefixes = [...exact].map((e) => `${e}/`);
  return {
    pathspec: entries.length ? ["--", ...entries.map((e) => `:(exclude,literal)${e}`)] : [],
    drop: (p) => exact.has(p) || prefixes.some((d) => p.startsWith(d)),
  };
}

/** Every untracked, non-ignored path, root-relative. */
function untrackedPaths(repo: string): string[] {
  const listing = git(repo, ["ls-files", "-z", "--others", "--exclude-standard"]);
  return listing.split("\0").filter(Boolean);
}

/** One `/dev/null`→file patch per untracked, non-ignored path. `--no-index`
 *  touches no index entry, so this stays read-only. It exits 1 when it finds
 *  differences, which is the normal case here. Above UNTRACKED_PATCH_CAP the
 *  surface degrades to the `--stat` shape (names only) and says so on stderr,
 *  so the caller knows the patches were withheld rather than absent. */
function untrackedPatches(repo: string, paths: string[], stat: boolean): string {
  if (paths.length === 0) return "";
  if (stat) return paths.map((p) => `  new file: ${p}`).join("\n");
  if (paths.length > UNTRACKED_PATCH_CAP) {
    console.error(
      `NOTE: ${paths.length} untracked files exceed the ${UNTRACKED_PATCH_CAP}-file patch cap; the untracked surface lists names only.`,
    );
    return paths.map((p) => `  new file: ${p}`).join("\n");
  }
  return paths
    .map((p) =>
      git(repo, ["diff", "--binary", "--no-index", "--", "/dev/null", p], true),
    )
    .join("");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const flag of VALUE_FLAGS) {
    if (flag in args && (args[flag] === true || args[flag] === "")) {
      fatal(`--${flag} requires a non-empty value. Not guessing.`);
    }
  }
  const repo = typeof args.repo === "string" ? args.repo : process.cwd();
  const baseline = typeof args.baseline === "string" ? args.baseline : undefined;
  const explicitBase = typeof args.base === "string" ? args.base : undefined;
  const excludeFrom =
    typeof args["exclude-from"] === "string" ? args["exclude-from"] : undefined;
  const stat = args.stat === true;
  const nameOnly = args["name-only"] === true;
  // `--no-renames` in name-only mode lists BOTH sides of a rename: a commit
  // step that stages only the destination leaves the source deletion unstaged.
  // NUL separation keeps unusual filenames intact (no core.quotePath escaping).
  const fmt = nameOnly
    ? ["--name-only", "--no-renames", "-z"]
    : stat
      ? ["--stat"]
      : ["--binary", "--unified=5"];
  const exclude = loadExclusion(excludeFrom);
  const ps = exclude.pathspec;

  const surfaces: Surface[] = [];

  if (baseline) {
    // SESSION MODE — everything that changed since this session started.
    surfaces.push({
      label: `committed-since-baseline + staged (baseline ${baseline.slice(0, 12)})`,
      body: git(repo, ["diff", ...fmt, "--cached", baseline, ...ps]),
    });
    surfaces.push({
      label: "unstaged working tree",
      body: git(repo, ["diff", ...fmt, ...ps]),
    });
  } else {
    // BRANCH MODE — what this branch adds, plus whatever is still uncommitted.
    const base = resolveBase(repo, explicitBase);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    if (base && base !== head) {
      const count = git(repo, ["rev-list", "--count", `${base}..HEAD`]).trim();
      surfaces.push({
        label: `branch commits vs base ${base.slice(0, 12)} (${count} commits)`,
        body: git(repo, ["diff", ...fmt, base, "HEAD", ...ps]),
      });
    } else {
      // Not an error, and not silence either: the caller must be told that the
      // committed half of the review is missing, so it cannot claim coverage.
      console.error(
        base
          ? "NOTE: base resolves to HEAD; no branch commits to review."
          : "WARNING: no base branch resolved. Committed branch work is NOT covered.",
      );
    }
    surfaces.push({ label: "staged", body: git(repo, ["diff", ...fmt, "--cached", ...ps]) });
    surfaces.push({ label: "unstaged", body: git(repo, ["diff", ...fmt, ...ps]) });
  }

  const untracked = untrackedPaths(repo).filter((p) => !exclude.drop(p));

  if (nameOnly) {
    // One path per line, every surface, deduplicated, nothing else. A path
    // touched in two surfaces (staged and then edited again) appears once.
    // Empty stdout still means "nothing to review".
    const seen = new Set<string>();
    for (const s of surfaces) for (const p of s.body.split("\0")) if (p) seen.add(p);
    for (const p of untracked) seen.add(p);
    for (const p of seen) process.stdout.write(`${p}\n`);
    return;
  }

  surfaces.push({ label: "untracked", body: untrackedPatches(repo, untracked, stat) });

  const present = surfaces.filter((s) => s.body.trim() !== "");
  // An empty capture prints nothing at all, so a caller cannot mistake a header
  // for content and emit a verdict over it.
  if (present.length === 0) return;

  for (const s of present) {
    process.stdout.write(`\n##### SURFACE: ${s.label} #####\n`);
    process.stdout.write(s.body.endsWith("\n") ? s.body : `${s.body}\n`);
  }
}

main();
