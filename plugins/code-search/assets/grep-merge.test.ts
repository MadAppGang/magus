/**
 * grep-merge.test.ts — the two sourced files as text (P1 static rules), and the shell
 * classifier against the server's parser (P3 drift).
 *
 * `__cs_gm_classify` (in grep-merge-body.sh) is a builtins-only copy of `parseBashGrep`
 * (mcp/grep/bash-grep.ts). The parser decides; the classifier only spares a fork on calls
 * the parser would decline. If they drift, one of two things breaks silently: the shell
 * sends calls the server always declines (cost), or skips calls the server would merge
 * (reach). So they must agree on every row of the shared table and on a generated
 * product of it, in both directions, in every shell present.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBashGrep } from "../mcp/grep/bash-grep";
import { isDecline } from "../mcp/grep/call";
import {
  ASSETS_DIR,
  BODY_NAME,
  captureSync,
  findShells,
  MAIN_NAME,
  makeWorld,
  sq,
  type Shell,
} from "../test-support/grep-merge-harness";

const SHELLS = findShells();
const MAIN = readFileSync(join(ASSETS_DIR, MAIN_NAME), "utf8");
const BODY = readFileSync(join(ASSETS_DIR, BODY_NAME), "utf8");
const FILES: [string, string][] = [
  [MAIN_NAME, MAIN],
  [BODY_NAME, BODY],
];

/** Code lines: comments and blank lines removed (a `#` inside quotes never starts a line here). */
function codeLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

// ---------------------------------------------------------------------------
// P1 static rules
// ---------------------------------------------------------------------------

describe("P1 static rules", () => {
  for (const shell of SHELLS) {
    test.each(FILES)(`%s parses under ${shell.name} -n`, (name) => {
      const r = captureSync(shell.path, ["-n", join(ASSETS_DIR, name)]);
      expect({ rc: r.rc, stderr: r.stderr }).toEqual({ rc: 0, stderr: "" });
    });
  }

  test.each(FILES)("%s: every function is `function name {`, none is `name()`", (_name, text) => {
    const code = codeLines(text);
    expect(code.filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/u.test(l))).toEqual([]);
    for (const l of code.filter((x) => /\bfunction\b/u.test(x))) {
      expect(l).toMatch(/^\s*function [A-Za-z_][A-Za-z0-9_]* \{$/u);
    }
  });

  test.each(FILES)("%s: no `exit`, no top-level `return`, no exec on fd 0, 1 or 2", (_name, text) => {
    expect(text).not.toMatch(/\bexit\b/u);
    // Track function bodies by their own indentation: `function x {` ... the matching `}`.
    let depth = 0;
    let indent = "";
    const topLevelReturns: string[] = [];
    for (const l of text.split("\n")) {
      const open = /^(\s*)function [A-Za-z_][A-Za-z0-9_]* \{$/u.exec(l);
      if (depth === 0 && open !== null) {
        depth = 1;
        indent = open[1] ?? "";
        continue;
      }
      if (depth === 1 && l === `${indent}}`) {
        depth = 0;
        continue;
      }
      if (depth === 0 && !l.trim().startsWith("#") && /\breturn\b/u.test(l)) topLevelReturns.push(l);
    }
    expect(topLevelReturns).toEqual([]);
    expect(codeLines(text).filter((l) => /\bexec\s+[012]?[<>]/u.test(l))).toEqual([]);
  });

  // The body is parsed whole with aliases suspended, so a final `:` is safe there. The main
  // file restores the caller's aliases, so its last statement must be that restore: any
  // statement after it would be parsed with them on (review round 5). The restore is an
  // `if` whose every branch ends in a builtin that returns 0.
  test.each(FILES)("%s: ends in a statement that returns 0 and no alias can reach", (name, text) => {
    if (name === BODY_NAME) {
      expect(text.endsWith("\n:\n")).toBe(true);
      return;
    }
    const tail = text.slice(text.lastIndexOf("\nif [[ -n ${__cs_gm_ra-} ]]; then\n") + 1);
    expect(tail).toBe(
      "if [[ -n ${__cs_gm_ra-} ]]; then\n" +
        "  \\builtin unset __cs_gm_ra\n" +
        "  if [[ -n ${ZSH_VERSION-} ]]; then \\builtin setopt aliases; else \\builtin shopt -s expand_aliases; fi\n" +
        "else\n" +
        "  \\builtin unset __cs_gm_ra\n" +
        "fi\n",
    );
  });

  test.each(FILES)("%s: no bare external command word; prefixes are `command` or `builtin`", (_name, text) => {
    const bare = /(^|[;&|{(]|\bthen|\bdo|\belse)\s*(rm|curl|printf|read|wait|cat|sleep|kill|echo|test|grep|shopt|setopt|unsetopt|emulate|functions|\[)\s/u;
    const offenders = codeLines(text).filter((l) => {
      const stripped = l.replace(/'[^']*'/gu, "''");
      return bare.test(stripped) && !/^\s*function grep \{$/u.test(l);
    });
    expect(offenders).toEqual([]);
  });

  test.each(FILES)("%s: no file redirection whose open error can reach the caller", (_name, text) => {
    // `cmd > "$f" 2>/dev/null` reports the open failure on the caller's stderr (P0-9 side
    // finding 2). The silent form is `{ cmd > "$f"; } 2>/dev/null`.
    expect(codeLines(text).filter((l) => /[^&0-9][<>]>?\s*"\$[^"]+"\s*2>\/dev\/null/u.test(l))).toEqual([]);
  });

  test("frozen names, and the body named by basename only", () => {
    expect(MAIN).toContain("if [[ -z ${__cs_gm_done-} ]]; then");
    expect(BODY).toContain("\n__cs_gm_done=1\n");
    expect(BODY).toContain("if builtin typeset -f __cs_cc_grep >/dev/null 2>&1; then");
    expect(MAIN).toContain("__cs_gm_b=${__cs_gm_b%/*}/grep-merge-body.sh");
    // No absolute path other than the device files the contract names.
    for (const [, text] of FILES) {
      const paths = codeLines(text).flatMap((l) => l.match(/(?<![\w.$}])\/[A-Za-z][\w./-]*/gu) ?? []);
      expect(paths.filter((p) => !p.startsWith("/dev/") && p !== "/localhost/merge")).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// P3 drift: __cs_gm_classify vs parseBashGrep
// ---------------------------------------------------------------------------

interface Row {
  argv: string[];
  expect: "files" | "content" | "decline";
}

const TABLE = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "mcp", "grep", "__testdata__", "bash-grep-cases.json"), "utf8"),
) as Row[];

function tsVerdict(argv: readonly string[]): string {
  const parsed = parseBashGrep(argv);
  return isDecline(parsed) ? "decline" : parsed.mode;
}

/** The classifier's verdict for every argv, from ONE shell process. */
function shellVerdicts(shell: Shell, argvs: readonly (readonly string[])[], pre = ""): string[] {
  const w = makeWorld();
  try {
    const lines = [pre, `. ${sq(w.main)}`];
    for (const argv of argvs) {
      lines.push(
        `if __cs_gm_classify ${argv.map(sq).join(" ")}; then builtin printf '%s\\n' "$__cs_gm_mode"; else builtin printf 'decline\\n'; fi`,
      );
    }
    const script = join(w.root, "drift.sh");
    writeFileSync(script, `${lines.join("\n")}\n`);
    const r = captureSync(shell.path, [script], { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" });
    expect(r.stderr).toBe("");
    const out = r.stdout.split("\n").slice(0, -1);
    expect(out).toHaveLength(argvs.length);
    return out;
  } finally {
    w.cleanup();
  }
}

/** A deterministic generator, so a failure names an argv that reproduces. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const OPTION_GROUPS: string[][] = [
  ["-r"], ["-R"], ["-rn"], ["-rl"], ["-rL"], ["-rc"], ["-n"], ["-l"], ["-ri"], ["-rnwHsIF"], ["-rh"], ["-rE"],
  ["-rnC2"], ["-rnC"], ["-rnC", "2"], ["-A", "5"], ["-A5"], ["-A"], ["-B", "x"], ["-C", "1000"], ["-C", "999"],
  ["-rA3"], ["-rA3n"], ["-rAB", "2"], ["-B007"], ["-2"],
  ["--recursive"], ["--dereference-recursive"], ["--files-with-matches"], ["--ignore-case"], ["--line-number"],
  ["--word-regexp"], ["--with-filename"], ["--no-messages"], ["--fixed-strings"],
  ["--include=*.ts"], ["--include=*!.ts"], ["--include=!x"], ["--include=a:b"], ["--include=*.{a,b}"],
  ["--include=**.ts"], ["--include=a**.ts"], ["--exclude=x**"], ["--exclude-dir=**"], ["--include=*.*"],
  ["--include=[]a]*"], ["--include=[!]]*"], ["--include=[^]]*"], ["--exclude-dir=[]d]"],
  ["--include=[!t]*.ts"], ["--include=[a]]x"],
  ["--include=a,b"], ["--include=a\\b"], ["--include="], ["--include"], ["--include", "*.ts"],
  ["--exclude=*.min.js"], ["--exclude=!x"], ["--exclude-dir=node_modules"], ["--exclude-dir=a/b"], ["--exclude-dir=!d"],
  ["--exclude-from=x"],
  ["--color"], ["--color=auto"], ["--color=never"], ["--color=always"], ["--color="], ["--colour"], ["--colour=never"],
  ["--context=3"], ["--context=x"], ["--context="], ["--context"], ["--after-context=999"], ["--before-context=1000"],
  ["--null"], ["-e"], ["--"], ["-"], ["--recursive=x"], ["-rZ"], ["---x"], ["--rec"], ["-r", "-L"],
];

const PATTERNS = [
  "fetchUserProfile", "ab", "abc", "a::b", "a:::b", "a::", "::a", "fetch user", "fetch  user", "x-y", "x-", "-x",
  "_ok", "9ab", "std::vector", "a-b-c-d", "a-b-c-d-e", "a b::c-d", "fetch.User", "", "fé", "a\tb", "a\nb",
  "x".repeat(100), "x".repeat(101), "ÿber", "--", "-rn", "it's", "a b c d", "a b c d e", "A_1", "a:b",
];

const PATH_SETS: string[][] = [
  [], ["."], ["src", "lib/"], ["../x"], ["src/.."], ["a/../b"], ["a..b"], [""], ["-"], ["--"], ["-i"],
  Array.from({ length: 16 }, (_, i) => `p${i}`),
  Array.from({ length: 17 }, (_, i) => `p${i}`),
  ["a b"], ["it's"], [".."], ["/abs/path"],
];

function generated(): string[][] {
  const out: string[][] = [];
  // A full cross of a slice of each pool, in three placements.
  for (const o of OPTION_GROUPS.slice(0, 30)) {
    for (const p of PATTERNS.slice(0, 12)) {
      for (const paths of PATH_SETS.slice(0, 6)) {
        out.push([...o, p, ...paths]);
        out.push([p, ...paths, ...o]);
      }
    }
  }
  // Random draws over every pool: 1 to 3 option groups, spread before, between and after.
  const rand = seeded(20261009);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  for (let i = 0; i < 3_000; i += 1) {
    const groups = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(OPTION_GROUPS));
    const pattern = pick(PATTERNS);
    const paths = pick(PATH_SETS);
    const cut = Math.floor(rand() * (paths.length + 1));
    const where = Math.floor(rand() * 3);
    const [g0 = [], ...rest] = groups;
    const restFlat = rest.flat();
    if (where === 0) out.push([...g0, ...restFlat, pattern, ...paths]);
    else if (where === 1) out.push([...g0, pattern, ...paths.slice(0, cut), ...restFlat, ...paths.slice(cut)]);
    else out.push([pattern, ...paths, ...g0, ...restFlat]);
  }
  return out;
}

describe("P3 drift: __cs_gm_classify agrees with parseBashGrep", () => {
  test("the shared table has rows of every verdict", () => {
    const verdicts = new Set(TABLE.map((r) => r.expect));
    expect([...verdicts].sort()).toEqual(["content", "decline", "files"]);
    // The table is the parser's own contract; the drift test reads the same rows.
    for (const row of TABLE) expect(tsVerdict(row.argv)).toBe(row.expect);
  });

  const GEN = generated();

  test("the generated product exercises both verdicts heavily", () => {
    const ts = GEN.map(tsVerdict);
    expect(ts.filter((v) => v === "decline").length).toBeGreaterThan(500);
    expect(ts.filter((v) => v !== "decline").length).toBeGreaterThan(300);
    expect(ts.filter((v) => v === "files").length).toBeGreaterThan(30);
  });

  for (const shell of SHELLS) {
    test(`${shell.name}: every table row`, () => {
      const got = shellVerdicts(shell, TABLE.map((r) => r.argv));
      const diffs = TABLE.flatMap((row, i) => (got[i] === row.expect ? [] : [{ argv: row.argv, table: row.expect, shell: got[i] }]));
      expect(diffs).toEqual([]);
    });

    test(`${shell.name}: generated product, both directions`, () => {
      const got = shellVerdicts(shell, GEN);
      const ts = GEN.map(tsVerdict);
      // Shell accepts what the parser declines (cost), and declines what it accepts (reach).
      const shellOnly = GEN.flatMap((argv, i) => (got[i] !== "decline" && got[i] !== ts[i] ? [{ argv, ts: ts[i], shell: got[i] }] : []));
      const tsOnly = GEN.flatMap((argv, i) => (ts[i] !== "decline" && got[i] !== ts[i] ? [{ argv, ts: ts[i], shell: got[i] }] : []));
      expect(shellOnly.slice(0, 10)).toEqual([]);
      expect(tsOnly.slice(0, 10)).toEqual([]);
    });

    if (shell.kind === "bash") {
      test(`${shell.name}: nocasematch on in the caller changes nothing, and is restored`, () => {
        const argvs = [["-rL", "fetchUserProfile", "."], ["-rl", "fetchUserProfile", "."], ["-rc", "fetchUserProfile", "."]];
        expect(shellVerdicts(shell, argvs, "shopt -s nocasematch")).toEqual(["decline", "files", "decline"]);
        const w = makeWorld();
        try {
          const r = captureSync(shell.path, [
            "-c",
            `shopt -s nocasematch\n. ${sq(w.main)}\n__cs_gm_classify -rn abc . || :\nshopt -q nocasematch && builtin printf on`,
          ]);
          expect(r.stdout).toBe("on");
        } finally {
          w.cleanup();
        }
      });
    }
  }
});
