// Blind tests for R13.1 (a source line in a sibling SessionStart hook file counts as present),
// the testable R13.6 clauses, and the R12.7 normal paths they build on.
// Written from the contract only; the implementation was not read.
import { afterEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  envLineBytes, HOOK_FILE_PATTERN, isHookFileName, SIBLING_MAX_BYTES, SIBLING_MAX_FILES,
  siblingHoldingSourceLine, sourceLineOf,
} from "../hooks/grep-merge-env";

const entry = resolve(import.meta.dir, "../hooks/grep-merge-env.ts");
const asset = resolve(import.meta.dir, "../assets/grep-merge.sh");
const line = envLineBytes(asset)!;          // "\n" + source line + "\n"
const src = sourceLineOf(asset)!;           // the source line alone
const T = 20_000;                           // per-test timeout; the child has its own watchdog below
const PAST = new Date("2001-02-03T04:05:06.000Z");
const isRoot = process.getuid?.() === 0;
// An engine entry without `command` is dropped by the settings schema, so "configured" needs one.
const SETTINGS = { "code-search": { engine: "mnemex", engines: { mnemex: { command: "mnemex" } }, grep: { route: true } } };
const present = (holder: string) => `grep-merge-env: source line present in ${holder}; no line written\n`;
const hook = (n: number | string) => `sessionstart-hook-${n}.sh`;

type World = { root: string; dir: string; log: string; target: string; at(name: string): string };
const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length) disposers.pop()!(); });

/** A copied-plugin-tree run setup: gate open, temp project settings, a fresh directory D. */
function world(targetName = hook(3)): World {
  const root = mkdtempSync(join(tmpdir(), "csgm-sib-"));
  mkdirSync(join(root, "home", ".claude"), { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(SETTINGS));
  const dir = join(root, "session-env", "5e551011-id");
  mkdirSync(dir, { recursive: true });
  disposers.push(() => {
    try { chmodSync(dir, 0o700); } catch { /* already gone */ }
    rmSync(root, { force: true, recursive: true });
  });
  return { root, dir, log: join(root, "merge.log"), target: join(dir, targetName), at: (name) => join(dir, name) };
}

/** Writes a file and pins its mtime in the past, so any later write is visible in mtimeMs. */
function seed(path: string, content: string | Buffer, mode?: number): void {
  writeFileSync(path, content);
  utimesSync(path, PAST, PAST);
  if (mode !== undefined) chmodSync(path, mode);
}
function snap(path: string): { hex: string; mtimeMs: number } {
  return { hex: readFileSync(path).toString("hex"), mtimeMs: lstatSync(path).mtimeMs };
}
function listing(dir: string): string[] { return readdirSync(dir).sort(); }
function logOf(w: World): string | null { return existsSync(w.log) ? readFileSync(w.log, "utf8") : null; }
function sourceLinesIn(dir: string): number {
  return readdirSync(dir).reduce((n, name) =>
    n + readFileSync(join(dir, name), "utf8").split("\n").filter((l) => l === src).length, 0);
}
function mkfifo(path: string): void {
  const r = spawnSync("mkfifo", [path]);
  if (r.status !== 0) throw new Error(`mkfifo failed: ${r.stderr}`);
}

type Run = { rc: number | null; stdout: string; stderr: string; ms: number; killed: boolean };
/** Spawns the hook as env-hook.test.ts does; a watchdog kills it so a hang fails instead of stalling. */
function run(w: World, opts: { envFile?: string; log?: string | null; limitMs?: number } = {}): Promise<Run> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(w.root, "home"), CLAUDE_PROJECT_DIR: w.root,
    CLAUDE_ENV_FILE: opts.envFile ?? w.target,
  };
  if (opts.log !== null) env.CODE_SEARCH_MERGE_LOG = opts.log ?? w.log;
  const started = performance.now();
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", entry], {
      env, cwd: w.root, stdio: ["ignore", "pipe", "pipe"],
    });
    let killed = false;
    const watchdog = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, opts.limitMs ?? 8_000);
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (e) => { clearTimeout(watchdog); reject(e); });
    child.on("close", (code) => {
      clearTimeout(watchdog);
      resolveRun({ rc: code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"),
        ms: performance.now() - started, killed });
    });
  });
}
/** Every R13.1 row: exit 0, empty stdout, empty stderr (and the test watchdog never fired). */
function expectSilentExit(r: Run): void {
  expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr, killed: r.killed })
    .toEqual({ rc: 0, stdout: "", stderr: "", killed: false });
}

const NON_MATCHING = [
  "sessionstart-hook-6.sh.bak", "SessionStart-hook-6.sh", "sessionstart-hook-.sh", "sessionstart-hook-6a.sh",
  "sessionstart-hook-6.txt", "sessionstart-hook-1234567890.sh", "env.sh",
];

// ---------------------------------------------------------------------------------------------
// Unit rows (direct calls)
// ---------------------------------------------------------------------------------------------

test("R13.1 unit: SIBLING_MAX_BYTES is 65,536 and SIBLING_MAX_FILES is 16", () => {
  expect({ bytes: SIBLING_MAX_BYTES, files: SIBLING_MAX_FILES }).toEqual({ bytes: 65_536, files: 16 });
});

test("R13.1 unit: isHookFileName accepts sessionstart-hook-3.sh and a 9-digit index", () => {
  for (const name of [hook(3), hook(123456789)]) {
    expect([isHookFileName(name), isHookFileName(name), HOOK_FILE_PATTERN.test(name)]).toEqual([true, true, true]);
  }
});

for (const name of NON_MATCHING) {
  test(`R13.1 unit: isHookFileName rejects ${name} (row 6 name), case-sensitively and repeatably`, () => {
    expect([isHookFileName(name), isHookFileName(name), HOOK_FILE_PATTERN.test(name)]).toEqual([false, false, false]);
  });
}

test("R13.1 unit: siblingHoldingSourceLine with no other file in D returns no holder and no notes", () => {
  const w = world();
  expect(siblingHoldingSourceLine(w.target, src)).toEqual({ holder: undefined, notes: [] });
  expect(listing(w.dir)).toEqual([]);
});

test("R13.1 unit: siblingHoldingSourceLine with a missing D (ENOENT) returns no holder and no notes", () => {
  const w = world();
  expect(siblingHoldingSourceLine(join(w.root, "missing", hook(3)), src)).toEqual({ holder: undefined, notes: [] });
});

test("R13.1 unit step 1: a D that is a regular file (ENOTDIR) returns no holder and no notes", () => {
  const w = world();
  seed(join(w.root, "plain"), line);
  expect(siblingHoldingSourceLine(join(w.root, "plain", hook(3)), src)).toEqual({ holder: undefined, notes: [] });
});

test("R13.1 unit: the target's own name is never the holder, even when it holds the line", () => {
  const w = world();
  seed(w.target, line);
  expect(siblingHoldingSourceLine(w.target, src)).toEqual({ holder: undefined, notes: [] });
});

test("R13.1 unit: siblings -10 and -2 both holding the line → holder is -2 (numeric order)", () => {
  const w = world();
  seed(w.at(hook(10)), line);
  seed(w.at(hook(2)), line);
  expect(siblingHoldingSourceLine(w.target, src)).toEqual({ holder: hook(2), notes: [] });
});

test("R13.1 unit: the scan never writes — D's names, bytes and mtimes are unchanged", () => {
  const w = world();
  seed(w.at(hook(6)), `export A=1${line}export B=2\n`);
  seed(w.at(hook(7)), "export C=3\n");
  const before = { names: listing(w.dir), six: snap(w.at(hook(6))), seven: snap(w.at(hook(7))) };
  expect(siblingHoldingSourceLine(w.target, src)).toEqual({ holder: hook(6), notes: [] });
  expect({ names: listing(w.dir), six: snap(w.at(hook(6))), seven: snap(w.at(hook(7))) }).toEqual(before);
});

test("R13.1 unit step 3: a directory named like a hook file gives the 'not a regular file' note", () => {
  const w = world();
  mkdirSync(w.at(hook(6)));
  expect(siblingHoldingSourceLine(w.target, src))
    .toEqual({ holder: undefined, notes: [`sibling ${hook(6)} ignored: not a regular file`] });
});

test("R13.1 unit step 3: a symlinked sibling is ignored with a note (code prefix only)", () => {
  const w = world();
  const outside = join(w.root, "outside-holder.sh");
  seed(outside, line);
  symlinkSync(outside, w.at(hook(6)));
  const scan = siblingHoldingSourceLine(w.target, src);
  expect(scan.holder).toBeUndefined();
  expect(scan.notes.length).toBe(1);
  expect(scan.notes[0]!.startsWith(`sibling ${hook(6)} ignored: `)).toBe(true);
  expect(scan.notes[0]!.length).toBeGreaterThan(`sibling ${hook(6)} ignored: `.length);
});

test("R13.1 unit step 3: a sibling of 65,537 bytes is ignored with the over-cap note", () => {
  const w = world();
  seed(w.at(hook(6)), line + "a".repeat(65_537 - Buffer.byteLength(line)));
  expect(siblingHoldingSourceLine(w.target, src))
    .toEqual({ holder: undefined, notes: [`sibling ${hook(6)} ignored: over 65536 bytes`] });
});

test("R13.1 unit step 4: 17 non-holding siblings → the single note 'sibling scan stopped after 16 files'", () => {
  const w = world(hook(99));
  for (let n = 1; n <= 17; n++) seed(w.at(hook(n)), `export N=${n}\n`);
  expect(siblingHoldingSourceLine(w.target, src))
    .toEqual({ holder: undefined, notes: ["sibling scan stopped after 16 files"] });
});

test("R13.1 unit step 3: invalid UTF-8 before the line decodes with replacement and still finds it", () => {
  const w = world();
  seed(w.at(hook(6)), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line)]));
  expect(siblingHoldingSourceLine(w.target, src)).toEqual({ holder: hook(6), notes: [] });
});

test.skipIf(isRoot)("R13.1 unit step 1: an unlistable D (0300) gives the note 'cannot list <D>: EACCES'", () => {
  const w = world();
  chmodSync(w.dir, 0o300);
  expect(siblingHoldingSourceLine(w.target, src))
    .toEqual({ holder: undefined, notes: [`cannot list ${w.dir}: EACCES`] });
});

// ---------------------------------------------------------------------------------------------
// Normal paths (R12.7 steps 5–6 as amended by R13.1 5a/5c)
// ---------------------------------------------------------------------------------------------

test("R13.1 5c: no sibling, target absent → exactly one append, mode 0600, nothing logged", async () => {
  const w = world();
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(lstatSync(w.target).mode & 0o777).toBe(0o600);
  expect(listing(w.dir)).toEqual([hook(3)]);
  expect(logOf(w)).toBeNull();
}, T);

test("R13.1 5a: target already holds the line → bytes and mtime unchanged, nothing logged even with a holding sibling", async () => {
  const w = world();
  seed(w.target, `export FOO=1${line}export BAR=2\n`);
  seed(w.at(hook(6)), line);
  const before = { target: snap(w.target), sibling: snap(w.at(hook(6))) };
  const r = await run(w);
  expectSilentExit(r);
  expect({ target: snap(w.target), sibling: snap(w.at(hook(6))) }).toEqual(before);
  expect(logOf(w)).toBeNull();
}, T);

test("R13.1 5c: target holding foreign bytes and no sibling → the line is appended after them", async () => {
  const w = world();
  seed(w.target, "export FOO=1", 0o644);
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe("export FOO=1" + line);
  expect(lstatSync(w.target).mode & 0o777).toBe(0o644);
}, T);

// ---------------------------------------------------------------------------------------------
// Blind rows 1–16 (hook process)
// ---------------------------------------------------------------------------------------------

test("R13.1 row 1: sibling -6 holds the line, target absent → target not created, sibling untouched, 'present in' logged", async () => {
  const w = world();
  seed(w.at(hook(6)), line);
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(listing(w.dir)).toEqual([hook(6)]);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

test("R13.1 row 1 / 5b: with CODE_SEARCH_MERGE_LOG unset the reason goes nowhere — no new file, empty stderr", async () => {
  const w = world();
  seed(w.at(hook(6)), line);
  const before = { root: listing(w.root), dir: listing(w.dir), sibling: snap(w.at(hook(6))) };
  const r = await run(w, { log: null });
  expectSilentExit(r);
  expect({ root: listing(w.root), dir: listing(w.dir), sibling: snap(w.at(hook(6))) }).toEqual(before);
}, T);

test("R13.1 row 2: foreign lines before and after the line in the sibling → same as row 1", async () => {
  const w = world();
  seed(w.at(hook(6)), `export A=1\nexport B=2${line}export C=3\n# trailing`);
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

test("R13.1 row 3: target holds 'export FOO=1', sibling holds the line → target bytes and mtime unchanged", async () => {
  const w = world();
  seed(w.target, "export FOO=1");
  seed(w.at(hook(6)), line);
  const before = { target: snap(w.target), sibling: snap(w.at(hook(6))) };
  const r = await run(w);
  expectSilentExit(r);
  expect({ target: snap(w.target), sibling: snap(w.at(hook(6))) }).toEqual(before);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

test("R13.1 row 4: sibling holds the source line of another absolute asset path → appended", async () => {
  const w = world();
  seed(w.at(hook(6)), envLineBytes("/another/plugin/assets/grep-merge.sh")!);
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(logOf(w)).toBeNull();
}, T);

for (const [label, variant] of [["a leading '# '", `# ${src}`], ["a trailing ' # x'", `${src} # x`], ["a trailing \\r", `${src}\r`]] as const) {
  test(`R13.1 row 5: sibling holds the source line with ${label} on its line → appended`, async () => {
    const w = world();
    seed(w.at(hook(6)), `\n${variant}\n`);
    const before = snap(w.at(hook(6)));
    const r = await run(w);
    expectSilentExit(r);
    expect(readFileSync(w.target, "utf8")).toBe(line);
    expect(snap(w.at(hook(6)))).toEqual(before);
    expect(logOf(w)).toBeNull();
  }, T);
}

for (const name of NON_MATCHING) {
  test(`R13.1 row 6: the line in a non-matching name ${name} does not count → appended, file not opened for a note`, async () => {
    const w = world();
    seed(w.at(name), line);
    const before = snap(w.at(name));
    const r = await run(w);
    expectSilentExit(r);
    expect(readFileSync(w.target, "utf8")).toBe(line);
    expect(snap(w.at(name))).toEqual(before);
    expect(logOf(w)).toBeNull();
  }, T);
}

test("R13.1 row 7: sibling -6 is a symlink to a holding file outside D → appended, note logged, link target unchanged", async () => {
  const w = world();
  const outside = join(w.root, "outside-holder.sh");
  seed(outside, line);
  symlinkSync(outside, w.at(hook(6)));
  const before = snap(outside);
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(snap(outside)).toEqual(before);
  expect(lstatSync(w.at(hook(6))).isSymbolicLink()).toBe(true);
  expect(logOf(w)).toMatch(/^grep-merge-env: sibling sessionstart-hook-6\.sh ignored: [^\n]+\n$/);
}, T);

test.skipIf(isRoot)("R13.1 row 8: a holding sibling with mode 000 → appended, silent, log names EACCES", async () => {
  const w = world();
  seed(w.at(hook(6)), line, 0o000);
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(lstatSync(w.at(hook(6))).mtimeMs).toBe(PAST.getTime());
  expect(logOf(w)).toBe(`grep-merge-env: sibling ${hook(6)} ignored: EACCES\n`);
}, T);

test("R13.1 row 9: a holding sibling of 65,537 bytes (line in its first 100 bytes) → appended, over-cap note", async () => {
  const w = world();
  const body = line + "a".repeat(65_537 - Buffer.byteLength(line));
  seed(w.at(hook(6)), body);
  expect(lstatSync(w.at(hook(6))).size).toBe(65_537);
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(logOf(w)).toBe(`grep-merge-env: sibling ${hook(6)} ignored: over 65536 bytes\n`);
}, T);

test("R13.1 row 9: the same holding sibling at exactly 65,536 bytes → not appended (row 1's outcome)", async () => {
  const w = world();
  seed(w.at(hook(6)), line + "a".repeat(65_536 - Buffer.byteLength(line)));
  expect(lstatSync(w.at(hook(6))).size).toBe(65_536);
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

test("R13.1 row 10: sibling -6 is a directory → appended, 'not a regular file' note", async () => {
  const w = world();
  mkdirSync(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(logOf(w)).toBe(`grep-merge-env: sibling ${hook(6)} ignored: not a regular file\n`);
}, T);

test("R13.1 row 10: sibling -6 is a FIFO with no writer → appended within the 5 s hook timeout, 'not a regular file' note", async () => {
  const w = world();
  mkfifo(w.at(hook(6)));
  const r = await run(w, { limitMs: 6_000 });
  expectSilentExit(r);
  expect(r.ms).toBeLessThan(5_000);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(logOf(w)).toBe(`grep-merge-env: sibling ${hook(6)} ignored: not a regular file\n`);
}, T);

function seedRange(w: World, from: number, to: number, holder: number, skip?: number): void {
  for (let n = from; n <= to; n++) {
    if (n === skip) continue;
    seed(w.at(hook(n)), n === holder ? `export N=${n}${line}` : `export N=${n}\n`);
  }
}

test("R13.1 row 11: target -99, siblings -1…-17, line only in -17 → appended, 'scan stopped after 16 files'", async () => {
  const w = world(hook(99));
  seedRange(w, 1, 17, 17);
  const before = snap(w.at(hook(17)));
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(snap(w.at(hook(17)))).toEqual(before);
  expect(logOf(w)).toBe("grep-merge-env: sibling scan stopped after 16 files\n");
}, T);

test("R13.1 row 11: target -99, siblings -1…-17, line only in -16 → not appended", async () => {
  const w = world(hook(99));
  seedRange(w, 1, 17, 16);
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(logOf(w)).toBe(present(hook(16)));
}, T);

// The contract opens the first 16 names sorted by <n> as a NUMBER (1…16 here). A lexical sort would
// open 1, 10…17, 2…8 and skip -9.
test("R13.1 count cap: the 16 opened are the lowest <n> numerically — line only in -9 of -1…-17 → not appended", async () => {
  const w = world(hook(99));
  seedRange(w, 1, 17, 9);
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(logOf(w)).toBe(present(hook(9)));
}, T);

// Step 2 removes the target's own name before the cap applies, so 16 siblings are all opened.
test("R13.1 count cap: target -5 among -1…-17 leaves exactly 16 siblings, all opened — line only in -17 → not appended", async () => {
  const w = world(hook(5));
  seedRange(w, 1, 17, 17, 5);
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(logOf(w)).toBe(present(hook(17)));
}, T);

test("R13.1 row 12: run with target -6, then target -3, same D → one source line across D, -3 not created", async () => {
  const w = world(hook(6));
  expectSilentExit(await run(w));
  const first = snap(w.at(hook(6)));
  expectSilentExit(await run(w, { envFile: w.at(hook(3)) }));
  expect(existsSync(w.at(hook(3)))).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(first);
  expect(listing(w.dir)).toEqual([hook(6)]);
  expect(sourceLinesIn(w.dir)).toBe(1);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

test.skipIf(isRoot)("R13.1 row 13: D has mode 0300 (no listing) → appended, 'cannot list <D>: EACCES' logged", async () => {
  const w = world();
  seed(w.at(hook(6)), line);   // a holder the hook cannot discover without a listing
  chmodSync(w.dir, 0o300);
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(logOf(w)).toBe(`grep-merge-env: cannot list ${w.dir}: EACCES\n`);
}, T);

test("R13.1 row 14: target under a missing directory → 'cannot append … ENOENT' and no 'cannot list' line", async () => {
  const w = world();
  const envFile = join(w.root, "missing", hook(3));
  const r = await run(w, { envFile });
  expectSilentExit(r);
  expect(existsSync(join(w.root, "missing"))).toBe(false);
  const log = logOf(w) ?? "";
  expect(log).toMatch(/^grep-merge-env: cannot append to [^\n]*: ENOENT\n$/);
  expect(log.includes("cannot list")).toBe(false);
}, T);

test("R13.1 row 15: sibling holds invalid UTF-8 bytes and no source line → appended, no 'failed:' logged", async () => {
  const w = world();
  seed(w.at(hook(6)), Buffer.from([0xff, 0xfe, 0x0a, 0x80, 0x0a]));
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect((logOf(w) ?? "").includes("failed:")).toBe(false);
}, T);

test("R13.1 row 16: invalid UTF-8 bytes, then the source line on its own line → not appended", async () => {
  const w = world();
  seed(w.at(hook(6)), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line)]));
  const before = snap(w.at(hook(6)));
  const r = await run(w);
  expectSilentExit(r);
  expect(existsSync(w.target)).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(logOf(w)).toBe(present(hook(6)));
}, T);

// ---------------------------------------------------------------------------------------------
// Log path robustness (R12.7 "Log" + R13.1 "notes go only to CODE_SEARCH_MERGE_LOG"; R13.6 item 6)
// ---------------------------------------------------------------------------------------------

test.skipIf(isRoot)("R13.1 5b: a note with CODE_SEARCH_MERGE_LOG unset is silent — appended, no stderr, no new file", async () => {
  const w = world();
  seed(w.at(hook(6)), line, 0o000);
  const rootBefore = listing(w.root);
  const r = await run(w, { log: null });
  expectSilentExit(r);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(listing(w.root)).toEqual(rootBefore);
  expect(listing(w.dir)).toEqual([hook(3), hook(6)].sort());
}, T);

test("R13.6 item 6: a log path that is a FIFO with no reader does not block a 'present in' run", async () => {
  const w = world();
  const fifo = join(w.root, "merge.fifo");
  mkfifo(fifo);
  seed(w.at(hook(6)), line);
  const before = snap(w.at(hook(6)));
  const r = await run(w, { log: fifo, limitMs: 6_000 });
  expectSilentExit(r);
  expect(r.ms).toBeLessThan(4_000);   // finished on its own, not by the hook's 4 s watchdog
  expect(existsSync(w.target)).toBe(false);
  expect(snap(w.at(hook(6)))).toEqual(before);
  expect(lstatSync(fifo).isFIFO()).toBe(true);
}, T);

test("R13.6 item 6: a log path that is a FIFO with no reader does not block a run that notes and then appends", async () => {
  const w = world();
  const fifo = join(w.root, "merge.fifo");
  mkfifo(fifo);
  seed(w.at(hook(6)), line + "a".repeat(65_537 - Buffer.byteLength(line)));
  const r = await run(w, { log: fifo, limitMs: 6_000 });
  expectSilentExit(r);
  expect(r.ms).toBeLessThan(4_000);
  expect(readFileSync(w.target, "utf8")).toBe(line);
  expect(lstatSync(fifo).isFIFO()).toBe(true);
}, T);
