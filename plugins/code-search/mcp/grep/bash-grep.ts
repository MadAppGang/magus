/**
 * bash-grep.ts — is this Bash `grep` argv one the server may append a block to? (D6)
 *
 * The argv is what the user's command passed to `grep`, before Claude Code's snapshot
 * function adds its own ugrep flags. Only an enumerated set of forms is accepted:
 * recursive, a word-like pattern as the first operand, and options that change which
 * lines grep prints in ways the server can rebuild. Anything else declines, so an
 * unrecognised shape always gets grep's own output and nothing more.
 *
 * The sourced shell script runs the same table as a builtins-only classifier
 * (`__cs_gm_classify`); the shared testdata in `__testdata__/bash-grep-cases.json` keeps
 * the two in agreement. This parser is the one that decides.
 *
 * Rules, as GNU getopt applies them to grep:
 *   - a cluster is `-` then letters from "rRnliwHsIF", optionally ending in one of A, B, C
 *     with its count either attached (`-C2`) or as the next argument (`-C 2`);
 *   - long options take their value only in the `--name=value` form;
 *   - options may follow operands; `--` ends options;
 *   - the first operand is the pattern, every later one is a path.
 */

import { isWordLike } from "./pattern";
import { VCS_DIRS, type Decline, type SearchCall } from "./call";

const CLUSTER_FLAGS = "rRnliwHsIF";
const MAX_PATHS = 16;
const COUNT = /^[0-9]{1,3}$/u;
/** A glob for --include/--exclude/--exclude-dir (P3's G rule): none of these characters,
 *  because each either means something different to ugrep and rg (`/`, `,`, `{`) or is an
 *  escape the two read differently (`\`). No `:`, so `--type-add csinc:G` (D7) has one
 *  reading. No leading `!`: ugrep and the oracle disagree on a negated include (P0-4
 *  finding 2). */
const SIMPLE_GLOB = /^[^!/,{\\:][^/,{\\:]*$/u;
/** Glob text ugrep and rg read differently even inside the G rule's characters: `**`, and
 *  a bracket class whose first member is a literal `]` (`[]`, `[!]`, `[^]`). The shell
 *  classifier's decline case lists the same four substrings. */
const DIVERGENT_GLOB = /\*\*|\[\]|\[!\]|\[\^\]/u;
/** The rg type name the Bash route's includes are registered under (D7 step 4). */
const INCLUDE_TYPE = "csinc";

/** Flags that take no value and change nothing the server has to rebuild. */
const LONG_BARE: Readonly<Record<string, (s: State) => void>> = {
  "--recursive": (s) => {
    s.recursive = true;
  },
  "--dereference-recursive": (s) => {
    s.recursive = true;
    s.follow = true;
  },
  "--line-number": () => undefined,
  "--files-with-matches": (s) => {
    s.files = true;
  },
  "--ignore-case": (s) => {
    s.ignoreCase = true;
  },
  "--word-regexp": () => undefined,
  "--with-filename": () => undefined,
  "--no-messages": () => undefined,
  "--fixed-strings": () => undefined,
  "--color": () => undefined,
  "--colour": () => undefined,
};

interface State {
  recursive: boolean;
  follow: boolean;
  files: boolean;
  ignoreCase: boolean;
  before: number;
  after: number;
  includes: string[];
  excludes: string[];
  excludeDirs: string[];
  operands: string[];
}

function clusterLetter(s: State, letter: string): void {
  switch (letter) {
    case "r":
      s.recursive = true;
      return;
    case "R":
      s.recursive = true;
      s.follow = true;
      return;
    case "l":
      s.files = true;
      return;
    case "i":
      s.ignoreCase = true;
      return;
    default:
      // n w H s I F: accepted, nothing to rebuild. `-w` needs nothing because the matcher
      // is a substring test, a superset of a word match (D6).
      return;
  }
}

/** Context counts take the maximum over every flag that sets a side (D6): `-C` raises
 *  both, `-A`/`-B` raise one. An overestimate of printed(F) only costs recall; an
 *  underestimate could offer a line grep already printed as context. */
function setContext(s: State, which: "A" | "B" | "C", n: number): void {
  if (which === "A" || which === "C") s.after = Math.max(s.after, n);
  if (which === "B" || which === "C") s.before = Math.max(s.before, n);
}

/** A path operand as grep would read it: not empty, not stdin, and never through `..`. */
function pathOk(path: string): boolean {
  if (path === "" || path === "-") return false;
  return !path.split("/").includes("..");
}

export function parseBashGrep(argv: readonly string[]): SearchCall | Decline {
  const s: State = {
    recursive: false,
    follow: false,
    files: false,
    ignoreCase: false,
    before: 0,
    after: 0,
    includes: [],
    excludes: [],
    excludeDirs: [],
    operands: [],
  };

  let optionsEnded = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (optionsEnded || !arg.startsWith("-") || arg === "-") {
      s.operands.push(arg);
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const value = eq === -1 ? undefined : arg.slice(eq + 1);
      if (value === undefined) {
        const apply = LONG_BARE[name];
        if (apply === undefined) return { decline: `flag:${name}` };
        apply(s);
        continue;
      }
      switch (name) {
        case "--context":
        case "--after-context":
        case "--before-context": {
          if (!COUNT.test(value)) return { decline: `value:${name}` };
          setContext(s, name === "--context" ? "C" : name === "--after-context" ? "A" : "B", Number(value));
          continue;
        }
        case "--include":
        case "--exclude":
        case "--exclude-dir": {
          // No `**` either (review round 4, measured): `--include='**.ts'` matched no file
          // under Claude Code's ugrep 7.8.4 and 904 under the rg oracle; `a**.ts` 0 vs 71.
          // Nor a class opening with a literal `]` (review round 5, measured): `[]a]*` matched
          // 0 files under ugrep and 148 under rg; `[!]]*` and `[^]]*` 0 vs every file.
          if (!SIMPLE_GLOB.test(value) || DIVERGENT_GLOB.test(value)) return { decline: `value:${name}` };
          (name === "--include" ? s.includes : name === "--exclude" ? s.excludes : s.excludeDirs).push(value);
          continue;
        }
        case "--color":
        case "--colour":
          if (value !== "auto" && value !== "never") return { decline: `value:${name}` };
          continue;
        default:
          return { decline: `flag:${name}` };
      }
    }

    // A short cluster.
    for (let k = 1; k < arg.length; k += 1) {
      const letter = arg[k] ?? "";
      if (CLUSTER_FLAGS.includes(letter)) {
        clusterLetter(s, letter);
        continue;
      }
      if (letter !== "A" && letter !== "B" && letter !== "C") return { decline: `flag:-${letter}` };
      // The count letter ends the cluster: its value is the rest, or the next argument.
      const attached = arg.slice(k + 1);
      let value: string | undefined = attached;
      if (attached === "") {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined || !COUNT.test(value)) return { decline: `value:-${letter}` };
      setContext(s, letter, Number(value));
      break;
    }
  }

  if (!s.recursive) return { decline: "not-recursive" };
  const [pattern, ...paths] = s.operands;
  if (pattern === undefined) return { decline: "no-pattern" };
  if (!isWordLike(pattern)) return { decline: "pattern" };
  // No path operand (D6, measured P0-5): ugrep `-r` searches the cwd recursively and
  // prints paths with no `./`. `roots: []` is the request cwd, spelled the same way (P5).
  if (paths.length > MAX_PATHS) return { decline: "paths" };
  if (!paths.every(pathOk)) return { decline: "path" };

  // D7, Bash route, exact order. The four --no-ignore-* flags make rg read only the
  // .gitignore files met during recursion, as ugrep's --ignore-files does: no parent
  // .gitignore, no .ignore/.rgignore, no .git/info/exclude, no global excludes.
  const walkArgs: string[] = [
    "--hidden",
    "--no-require-git",
    "--no-ignore-dot",
    "--no-ignore-exclude",
    "--no-ignore-global",
    "--no-ignore-parent",
  ];
  if (s.follow) walkArgs.push("--follow");
  for (const dir of VCS_DIRS) walkArgs.push("--glob", `!${dir}`);
  // Includes as a type filter, never `--glob G`: an rg glob is an override that re-admits
  // a file an ignore rule excludes, and ugrep's --include does not (P0-4 finding 1).
  for (const g of s.includes) walkArgs.push("--type-add", `${INCLUDE_TYPE}:${g}`);
  if (s.includes.length > 0) walkArgs.push("--type", INCLUDE_TYPE);
  // Negated globs only remove files, so excludes keep the --glob form (measured equal).
  for (const g of s.excludes) walkArgs.push("--glob", `!${g}`);
  for (const g of s.excludeDirs) walkArgs.push("--glob", `!${g}/`);

  return {
    route: "bash",
    mode: s.files ? "files" : "content",
    pattern,
    ignoreCase: s.ignoreCase,
    before: s.before,
    after: s.after,
    roots: paths,
    walkArgs,
  };
}
