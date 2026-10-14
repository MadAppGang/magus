/**
 * oracle-ugrep.test.ts — the scope oracle against the grep it stands in for (review round 4).
 *
 * The Bash route's oracle lists the files Claude Code's `grep` would have searched by
 * running ripgrep with `walkArgs` (D7). Claude Code's `grep` is its embedded ugrep. Both
 * live in the claude binary: argv0 `rg` and argv0 `ugrep`. This runs both over one small
 * tree, with the ugrep flags the snapshot's `grep` function passes, for every
 * include/exclude glob form the parser accepts, and requires the same file set.
 *
 * Forms the parser declines (`**`, a leading `!`, `/ , { \ :`) are not compared: the merge
 * never runs for them. `**` is declined because it was measured to differ (`**.ts`: ugrep 0
 * files, rg 904).
 *
 * Needs the claude binary (`resolveOracleBin`). Where none is found the comparison does
 * not run, and says so; CI runners do not install Claude Code.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseBashGrep } from "./bash-grep";
import { isDecline, VCS_DIRS } from "./call";
import { resolveOracleBin } from "./port";

const WORD = "fetchUserProfile";
const found = resolveOracleBin(process.env).bin;
const claude = found?.argv0 === "rg" ? found.path : undefined;

function run(argv0: string, args: readonly string[], cwd: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    if (claude === undefined) {
      resolve({ code: null, out: "" });
      return;
    }
    const child = spawn(claude, args, { argv0, cwd, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("close", (code) => resolve({ code, out: Buffer.concat(chunks).toString("utf8") }));
    child.on("error", () => resolve({ code: null, out: "" }));
  });
}

let root = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync("/tmp/cs-oracle-ugrep-"));
  const files = [
    "a.ts", "b.tsx", "c.js", "d.min.js", "x.t1", "ab.ts", "z.mjs",
    "sub/e.ts", "sub/f.test.ts", "sub/deep/g.ts",
    "node_modules/h.ts", "dist/i.ts", "sub/dist/j.ts",
    "ignored.ts", "sub/also-ignored.js", ".hidden.ts", "q!.js", "]a.ts", "a]x",
  ];
  for (const f of files) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), `const x = ${WORD}();\n`);
  }
  writeFileSync(join(root, ".gitignore"), "ignored.ts\n");
  writeFileSync(join(root, "sub", ".gitignore"), "also-ignored.js\n");
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

/** What Claude Code's `grep -rl <flags> WORD .` lists, through the snapshot's ugrep flags. */
async function ugrepFiles(flags: readonly string[]): Promise<string[]> {
  const snapshot = ["-G", "--ignore-files", "--hidden", "-I", ...VCS_DIRS.map((d) => `--exclude-dir=${d}`)];
  const r = await run("ugrep", [...snapshot, "-rl", ...flags, WORD, "."], root);
  return r.out.split("\n").filter((l) => l !== "").map((l) => l.replace(/^\.\//u, "")).sort();
}

/**
 * What the server's oracle lists for the same argv (D7 walkArgs), cut to the files that
 * hold the word: the service only ever meets files an engine hit names, so a walked file
 * without the word (a `.gitignore`) is never in question.
 */
async function oracleFiles(flags: readonly string[]): Promise<string[]> {
  const call = parseBashGrep(["-rl", ...flags, WORD, "."]);
  if (isDecline(call)) throw new Error(`declined: ${JSON.stringify(flags)}`);
  const r = await run("rg", ["--no-config", "--files", "--null", ...call.walkArgs, "--", root], root);
  return r.out
    .split("\0")
    .filter((l) => l !== "" && readFileSync(l, "utf8").includes(WORD))
    .map((p) => relative(root, p))
    .sort();
}

const ACCEPTED: string[][] = [
  [],
  ["--include=*.ts"],
  ["--include=*.t*"],
  ["--include=?.ts"],
  ["--include=[ab].*"],
  ["--include=[!t]*.ts"],
  ["--include=[^t]*.ts"],
  ["--include=[a]]x"],
  ["--include=[a-c]*"],
  ["--include=*.ts", "--include=*.tsx"],
  ["--include=a.ts"],
  ["--include=*!.js"],
  ["--exclude=*.min.js"],
  ["--exclude=*.test.ts"],
  ["--exclude-dir=node_modules"],
  ["--exclude-dir=dist"],
  ["--exclude-dir=deep"],
  ["--include=*.ts", "--exclude=*.test.ts", "--exclude-dir=node_modules"],
  ["--include=*.js", "--exclude-dir=sub"],
];

describe("oracle vs embedded ugrep, for every accepted glob form", () => {
  if (claude === undefined) {
    test("NOT run: no claude binary found for the oracle and ugrep", () => {
      console.warn("oracle-ugrep differential NOT run: no claude binary (resolveOracleBin found none)");
    });
    return;
  }

  test.each(ACCEPTED.map((flags) => [flags.join(" ") || "(no glob)", flags] as const))("%s", async (_name, flags) => {
    const [ugrep, oracle] = await Promise.all([ugrepFiles(flags), oracleFiles(flags)]);
    expect(ugrep.length).toBeGreaterThan(0);
    expect(oracle).toEqual(ugrep);
  });

  test("`**` forms are declined by the parser (they differ: measured)", async () => {
    for (const g of ["--include=**.ts", "--include=a**.ts", "--exclude-dir=**"]) {
      expect(isDecline(parseBashGrep(["-rl", g, WORD, "."]))).toBe(true);
    }
    // The evidence the decline rests on, in this tree.
    const ugrep = await ugrepFiles(["--include=**.ts"]);
    const rgAsInclude = await run("rg", ["--no-config", "--files", "--null", "--hidden", "--no-require-git", "--type-add", "csinc:**.ts", "--type", "csinc", "--", root], root);
    const oracle = rgAsInclude.out.split("\0").filter((l) => l !== "");
    expect(ugrep.length).not.toBe(oracle.length);
  });

  // Review round 5, Codex MEDIUM (measured): a `]` as the first member of a bracket class
  // is a literal to rg and ends the class early for ugrep (`[]a]*`: ugrep 0 files, rg 148).
  test("a class opening with a literal `]` is declined by the parser (it differs: measured here)", async () => {
    for (const g of ["[]a]*", "[!]]*", "[^]]*"]) {
      expect(isDecline(parseBashGrep(["-rl", `--include=${g}`, WORD, "."]))).toBe(true);
      const ugrep = await ugrepFiles([`--include=${g}`]);
      const rg = await run("rg", ["--no-config", "--files", "--null", "--hidden", "--no-require-git", "--type-add", `csinc:${g}`, "--type", "csinc", "--", root], root);
      const oracle = rg.out
        .split("\0")
        .filter((l) => l !== "" && readFileSync(l, "utf8").includes(WORD))
        .map((p) => relative(root, p))
        .sort();
      expect({ g, differs: JSON.stringify(ugrep) !== JSON.stringify(oracle) }).toEqual({ g, differs: true });
    }
  });
});
