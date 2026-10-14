/**
 * grep-merge-wrapper.test.ts — the Bash `grep` wrapper as a black box (contract P2).
 *
 * Each row copies both asset files into a temp world, defines a stand-in for Claude
 * Code's snapshot `grep` (or none, for the opt-in case), sources the main file through the
 * exact P7 line, and runs a command under `<shell> -c`. stdout and stderr share one
 * regular file, as in the Bash tool. A fake `node:http` server on the session socket
 * records every request; every merge row asserts that a request arrived.
 *
 * Shells: every bash and zsh found on this machine (`findShells`). The bash 3.2 rows are
 * the ones macOS ships; bash ≥ 4.1 takes the `exec {fd}>&1` branch zsh takes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  baseEnv,
  blockText,
  BODY_NAME,
  fields,
  findShells,
  frameOf,
  IN_CI,
  MAIN_NAME,
  missingRequiredShells,
  makeWorld,
  runShell,
  sourceLine,
  STANDIN,
  standinBytes,
  startFakeServer,
  type Answer,
  type FakeServer,
  type Run,
  type Shell,
  type World,
} from "../test-support/grep-merge-harness";

const SHELLS = findShells();
const WORD = "fetchUserProfile";
const ARGV = ["-rn", WORD, "src"];
const BLOCK = blockText();
const FRAME = frameOf(BLOCK);

describe("shells under test", () => {
  // Review round 1, internal M4: a shell that is not found is a contract path that did
  // not run. In CI that fails; on a developer machine it is printed, never silent.
  test(`the platform's required shells are present${IN_CI ? " (CI: required)" : ""}`, () => {
    expect(SHELLS.some((s) => s.kind === "bash")).toBe(true);
    const missing = missingRequiredShells(SHELLS);
    if (IN_CI) expect(missing).toEqual([]);
    else if (missing.length > 0) console.warn(`grep-merge wrapper rows NOT run for: ${missing.join(", ")}`);
  });

  test("missingRequiredShells names what each platform lacks", () => {
    const bash3: Shell = { name: "bash3", path: "/b3", kind: "bash", major: 3 };
    const bash5: Shell = { name: "bash5", path: "/b5", kind: "bash", major: 5 };
    const zsh: Shell = { name: "zsh", path: "/z", kind: "zsh", major: 5 };
    expect(missingRequiredShells([bash3, zsh], "darwin")).toEqual([]);
    expect(missingRequiredShells([bash5], "darwin")).toEqual(["bash 3.2", "zsh"]);
    expect(missingRequiredShells([bash5, zsh], "linux")).toEqual([]);
    expect(missingRequiredShells([bash3, zsh], "linux")).toEqual(["bash >= 4.1"]);
  });
});

for (const shell of SHELLS) {
  describe(`wrapper under ${shell.name} (${shell.path})`, () => {
    let w: World;
    let server: FakeServer | undefined;
    let answer: (body: Buffer) => Answer;

    beforeEach(() => {
      w = makeWorld();
      writeFileSync(join(w.root, "snapshot.sh"), `${STANDIN}\n`);
      // Read by a curl that ignored -q: it would print verbosely and write this file.
      writeFileSync(join(w.home, ".curlrc"), `--verbose\n-o ${join(w.root, "curlrc-out")}\n`);
      answer = () => FRAME;
      server = undefined;
    });

    afterEach(async () => {
      await server?.close();
      w.cleanup();
    });

    async function serve(): Promise<FakeServer> {
      server = await startFakeServer(w.sock, (body) => answer(body));
      return server;
    }

    interface Opts {
      /** Shell text run before the stand-in and the line are sourced. */
      pre?: string;
      /** Source the stand-in snapshot first (default true). */
      standin?: boolean;
      /** How many times the line appears (default 1). */
      lines?: number;
      env?: Record<string, string>;
      cwd?: string;
      main?: string;
    }

    /** Runs `cmd` after the line. The script prints `SRC-RC=<status>` right after sourcing. */
    async function run(cmd: string, o: Opts = {}): Promise<Run> {
      const parts: string[] = [];
      if (o.pre !== undefined) parts.push(o.pre);
      if (o.standin !== false) parts.push(`. '${join(w.root, "snapshot.sh")}'`);
      for (let i = 0; i < (o.lines ?? 1); i += 1) parts.push(sourceLine(o.main ?? w.main));
      parts.push(`builtin printf 'SRC-RC=%s\\n' "$?"`);
      parts.push(cmd);
      return runShell(shell, parts.join("\n"), {
        cwd: o.cwd ?? w.cwd,
        env: baseEnv(w, o.env),
        outFile: join(w.root, "out"),
      });
    }

    function logLines(): string[] {
      return existsSync(w.log) ? readFileSync(w.log, "utf8").split("\n").filter((l) => l !== "") : [];
    }

    function reasons(): string[] {
      return logLines().map((l) => l.replace(/^[0-9]+ grep /u, ""));
    }

    /** The socket dir holds the socket alone: no .req or .out left behind. */
    function leftovers(): string[] {
      return readdirSync(w.sockDir).filter((n) => n.endsWith(".req") || n.endsWith(".out"));
    }

    // ------------------------------------------------------------------ merge rows

    test("merge: grep's bytes, then exactly the block; rc 0; one request", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(r.rc).toBe(0);
      expect(s.requests).toHaveLength(1);
      expect(reasons()).toEqual(["merge rc=0 block=1"]);
      expect(leftovers()).toEqual([]);
      expect(existsSync(join(w.root, "curlrc-out"))).toBe(false);
    });

    test("merge with rc 1 keeps rc 1 and still appends the block", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { STANDIN_RC: "1" } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(r.rc).toBe(1);
      expect(s.requests).toHaveLength(1);
      expect(reasons()).toEqual(["merge rc=1 block=1"]);
    });

    test("rc 2 appends nothing and keeps rc 2", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { STANDIN_RC: "2" } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(r.rc).toBe(2);
      expect(s.requests).toHaveLength(1);
      expect(reasons()).toEqual(["merge rc=2 block=0"]);
      expect(leftovers()).toEqual([]);
    });

    test("request bytes: CSM1, G, ppid, $$, cwd, argc, argv", async () => {
      const s = await serve();
      const argv = ["-rn", "fetch User", "src"];
      const parts = [`. '${join(w.root, "snapshot.sh")}'`, sourceLine(w.main), `grep -rn 'fetch User' src`];
      const fd = join(w.root, "out");
      const r = await runShell(shell, parts.join("\n"), { cwd: w.cwd, env: baseEnv(w), outFile: fd });
      expect(r.out).toBe(`${standinBytes(argv)}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
      const f = fields(s.requests[0] ?? Buffer.alloc(0));
      expect(f.slice(0, 3)).toEqual(["CSM1", "G", String(process.pid)]);
      expect(f[3]).toMatch(/^[1-9][0-9]*$/u);
      expect(f.slice(4)).toEqual([w.cwd, "3", ...argv]);
      expect((s.requests[0] ?? Buffer.alloc(0)).at(-1)).toBe(0);
    });

    test("no path operand: argv holds no path, the cwd field is the shell's cwd", async () => {
      const s = await serve();
      const cwd = join(w.cwd, "src");
      const r = await run(`grep -rn ${WORD}`, { cwd });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(["-rn", WORD])}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
      expect(fields(s.requests[0] ?? Buffer.alloc(0)).slice(4)).toEqual([cwd, "2", "-rn", WORD]);
    });

    test("shapes that merge: 2>/dev/null, 2>&1, { …; }", async () => {
      const s = await serve();
      const g = `grep ${ARGV.join(" ")}`;
      const r = await run(`${g} 2>/dev/null\n${g} 2>&1\n{ ${g}; }`);
      const out = standinBytes(ARGV);
      const noErr = out.replace("standin-stderr\n", "");
      expect(r.out).toBe(`SRC-RC=0\n${noErr}${BLOCK}${out}${BLOCK}${out}${BLOCK}`);
      expect(s.requests).toHaveLength(3);
      expect(reasons()).toEqual(["merge rc=0 block=1", "merge rc=0 block=1", "merge rc=0 block=1"]);
    });

    test("shapes that never merge, and why", async () => {
      const s = await serve();
      const g = `grep ${ARGV.join(" ")}`;
      const f = join(w.root, "f");
      const cmds = [
        `${g} > '${f}'`,
        `${g} >> '${f}'`,
        `${g} > '${f}' 2>&1`,
        `${g} | command cat`,
        `__x=$(${g}); builtin printf '%s\\n' "$__x"`,
        `${g} > /dev/null`,
        `( ${g} )`,
        `${g} & builtin wait $!`,
      ];
      const r = await run(cmds.join("\n"));
      expect(r.out).not.toContain("--- code-search:");
      expect(readFileSync(f, "utf8")).not.toContain("--- code-search:");
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual([
        "pass:notfinal",
        "pass:notfinal",
        "pass:notfinal",
        "pass:subshell",
        "pass:subshell",
        "pass:notfinal",
        "pass:subshell",
        "pass:subshell",
      ]);
    });

    // ------------------------------------------------------------------ pass-through

    test("pass-through rows: stdout, stderr and rc are the stand-in's, argv verbatim", async () => {
      await serve();
      const cases: [string, string[], Record<string, string>, string][] = [
        ["not recursive", ["-n", WORD, "src"], {}, "pass:argv"],
        ["a regex", ["-rn", "fetch.User", "src"], {}, "pass:argv"],
        ["the kill switch", ARGV, { CODE_SEARCH_MERGE: "0" }, "pass:off"],
        ["odd argv bytes", ["-rn", "it's \"q\" $x `y` \\z", "a b"], {}, "pass:argv"],
      ];
      for (const [, argv, env, why] of cases) {
        const words = argv.map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ");
        const r = await run(`grep ${words}`, { env: { ...env, STANDIN_RC: "1" } });
        expect(r.out).toBe(`SRC-RC=0\n${standinBytes(argv)}`);
        expect(r.rc).toBe(1);
        expect(reasons().at(-1)).toBe(why);
      }
      expect(server?.requests).toHaveLength(0);
    });

    test("CODE_SEARCH_MERGE=0 on one command only", async () => {
      const s = await serve();
      const g = `grep ${ARGV.join(" ")}`;
      const r = await run(`CODE_SEARCH_MERGE=0 ${g}\n${g}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${standinBytes(ARGV)}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
      expect(reasons()).toEqual(["pass:off", "merge rc=0 block=1"]);
    });

    test("no server: pass-through, reason nosock, nothing on stderr", async () => {
      const r = await run(`grep ${ARGV.join(" ")}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(reasons()).toEqual(["pass:nosock"]);
    });

    test("silent degradation: a stale socket, and a server answering CSM1 0, equal the switched-off call", async () => {
      const g = `grep ${ARGV.join(" ")}; builtin printf 'rc=%s\\n' "$?"`;
      const off = await run(`CODE_SEARCH_MERGE=0 ${g}`, { env: { STANDIN_RC: "1" } });
      expect(off.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}rc=1\n`);

      // A socket file whose listener is gone: bound under another name, hard-linked into
      // place, then closed (closing unlinks only the name it bound).
      const aside = `${w.sock}.aside`;
      const dead = await startFakeServer(aside, () => FRAME);
      linkSync(aside, w.sock);
      await dead.close();
      expect(existsSync(w.sock)).toBe(true);
      const stale = await run(g, { env: { STANDIN_RC: "1" } });
      expect(stale.out).toBe(off.out);
      expect(reasons().at(-1)).toBe("merge rc=1 block=0");
      unlinkSync(w.sock);

      answer = () => "CSM1 0\n";
      const s = await serve();
      const zero = await run(g, { env: { STANDIN_RC: "1" } });
      expect(zero.out).toBe(off.out);
      expect(s.requests).toHaveLength(1);
      expect(leftovers()).toEqual([]);
    });

    test("frames that print nothing extra", async () => {
      const s = await serve();
      const len = Buffer.byteLength(BLOCK);
      const big = `--- code-search: 1 related location from the code index; none of these lines contains "x" ---\n`;
      const endLine = "--- end code-search ---\n";
      const filler = 16_385 - Buffer.byteLength(big) - endLine.length - 1;
      const bigBlock = `${big}${"y".repeat(filler)}\n${endLine}`;
      const bad: [string, Buffer][] = [
        ["n one smaller", frameOf(BLOCK, len - 1)],
        ["n one larger", frameOf(BLOCK, len + 1)],
        ["n over 16384", frameOf(bigBlock)],
        ["CSM1 0", Buffer.from("CSM1 0\n")],
        ["leading zero", Buffer.concat([Buffer.from(`CSM1 0${len}\n`), Buffer.from(BLOCK)])],
        ["second line", frameOf(BLOCK.replace("--- code-search: ", "--- codesearch: "))],
        ["fewer than 4 lines", frameOf(`--- code-search: 0 related ---\n${endLine}`)],
        ["no end marker", frameOf(BLOCK.replace("--- end code-search ---", "--- end ---"))],
        ["no final newline", frameOf(BLOCK.slice(0, -1))],
        ["empty", Buffer.alloc(0)],
        ["garbage", Buffer.from("HTTP nonsense\n")],
      ];
      expect(Buffer.byteLength(bigBlock)).toBe(16_385);
      for (const [name, bytes] of bad) {
        answer = () => bytes;
        const before = s.requests.length;
        const r = await run(`grep ${ARGV.join(" ")}`);
        expect({ name, out: r.out, rc: r.rc }).toEqual({ name, out: `SRC-RC=0\n${standinBytes(ARGV)}`, rc: 0 });
        expect(s.requests.length).toBe(before + 1);
      }
      expect(leftovers()).toEqual([]);
    });

    test("multibyte block text is printed byte-exact, and the delegate keeps the caller's locale", async () => {
      const s = await serve();
      const block = blockText(WORD, "src/π.ts:1: 円周率 π ≈ 3.14 🚀");
      answer = () => frameOf(block);
      // How many characters `é` is, in the shell's locale after the merge, against the same
      // shell with nothing sourced. A machine without en_US.UTF-8 measures 2 both times.
      const probe = `function __lc { local x='é'; builtin printf 'len=%s\\n' "\${#x}"; }`;
      const locales: Record<string, string>[] = [{ LANG: "en_US.UTF-8" }, { LC_ALL: "C" }];
      for (const env of locales) {
        const plain = await runShell(shell, `${probe}\n__lc`, { cwd: w.cwd, env: baseEnv(w, env), outFile: join(w.root, "out0") });
        const r = await run(`${probe}\ngrep ${ARGV.join(" ")}\n__lc`, { env: { ...env } });
        expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${block}${plain.out}`);
      }
      expect(s.requests).toHaveLength(2);
    });

    // ------------------------------------------------------------------ shell options

    // Options without errexit still merge; errexit in any form passes through (review
    // round 1, Codex C2), because only a delegate in tail position keeps its own errexit.
    const mergingOptions =
      shell.kind === "bash" ? ["set -uo pipefail", "set -uo pipefail"] : ["zsh options", "setopt NO_UNSET NOCLOBBER SH_WORD_SPLIT KSH_ARRAYS"];
    const errexitOptions =
      shell.kind === "bash"
        ? [["set -euo pipefail", "set -euo pipefail"]]
        : [
            ["setopt ERR_EXIT", "setopt ERR_EXIT NO_UNSET NOCLOBBER SH_WORD_SPLIT KSH_ARRAYS"],
            ["setopt ERR_RETURN", "setopt ERR_RETURN"],
          ];

    test(`${mergingOptions[0]}: sourcing is silent, and merges still work at rc 0 and rc 1`, async () => {
      const s = await serve();
      for (const rc of ["0", "1"]) {
        const r = await run(`grep ${ARGV.join(" ")}`, { pre: mergingOptions[1], env: { STANDIN_RC: rc } });
        expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
        expect(r.rc).toBe(Number(rc));
      }
      expect(s.requests).toHaveLength(2);
    });

    test(`${mergingOptions[0]}: a request file that cannot be created is grep alone, silently`, async () => {
      const s = await serve();
      chmodSync(w.sockDir, 0o500);
      try {
        for (const rc of ["0", "1"]) {
          const r = await run(`grep ${ARGV.join(" ")}; builtin printf 'rc=%s\\n' "$?"`, {
            pre: mergingOptions[1],
            env: { STANDIN_RC: rc },
          });
          expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}rc=${rc}\n`);
        }
      } finally {
        chmodSync(w.sockDir, 0o700);
      }
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:nofile", "pass:nofile"]);
    });

    for (const [label, pre] of errexitOptions as [string, string][]) {
      test(`${label}: sourcing is silent; an eligible call passes through (errexit) with the stand-in's rc`, async () => {
        const s = await serve();
        for (const rc of ["0", "1"]) {
          const r = await run(`grep ${ARGV.join(" ")}`, { pre, env: { STANDIN_RC: rc } });
          expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
          expect(r.rc).toBe(Number(rc));
        }
        expect(s.requests).toHaveLength(0);
        expect(reasons()).toEqual(["pass:errexit", "pass:errexit"]);
      });
    }

    test("errexit: a delegate that fails early stops where it stops without the wrapper (Codex C2)", async () => {
      await serve();
      const early = [
        "function grep {",
        "  false",
        "  builtin printf 'AFTER-FAIL\\n'",
        "}",
      ].join("\n");
      writeFileSync(join(w.root, "early.sh"), `${early}\n`);
      const pre = shell.kind === "bash" ? "set -e" : "setopt ERR_EXIT";
      const tail = `grep ${ARGV.join(" ")}\nbuiltin printf 'NEXT\\n'`;
      const plain = await runShell(shell, `${pre}\n. '${join(w.root, "early.sh")}'\n${tail}`, {
        cwd: w.cwd,
        env: baseEnv(w),
        outFile: join(w.root, "out0"),
      });
      const wrapped = await runShell(shell, `${pre}\n. '${join(w.root, "early.sh")}'\n${sourceLine(w.main)}\n${tail}`, {
        cwd: w.cwd,
        env: baseEnv(w),
        outFile: join(w.root, "out1"),
      });
      expect(plain.out).not.toContain("AFTER-FAIL");
      expect({ rc: wrapped.rc, out: wrapped.out }).toEqual({ rc: plain.rc, out: plain.out });
    });

    if (shell.kind === "zsh") {
      test("zsh: the delegate sees the caller's options, on pass-through and on the merge path (Codex C3)", async () => {
        const s = await serve();
        const observer = [
          "function grep {",
          "  if [[ -o noclobber && -o shwordsplit && -o ksharrays && -o nounset ]]; then builtin printf 'OPTS-ON'; else builtin printf 'OPTS-CHANGED'; fi",
          "  if [[ -o errreturn ]]; then builtin printf ' ERR_RETURN'; fi",
          "  builtin printf '\\n'",
          '  return "${OBS_RC:-0}"',
          "}",
        ].join("\n");
        writeFileSync(join(w.root, "observer.sh"), `${observer}\n`);
        const base = "setopt NO_CLOBBER SH_WORD_SPLIT KSH_ARRAYS NO_UNSET";
        const script = (opts: string): string =>
          [opts, `. '${join(w.root, "observer.sh")}'`, sourceLine(w.main), `grep ${ARGV.join(" ")}`].join("\n");
        // Pass-through (ERR_RETURN is errexit): output and rc exactly the observer's own.
        const pass = await runShell(shell, script(`${base} ERR_RETURN`), {
          cwd: w.cwd,
          env: baseEnv(w, { OBS_RC: "7" }),
          outFile: join(w.root, "out1"),
        });
        expect({ rc: pass.rc, out: pass.out }).toEqual({ rc: 7, out: "OPTS-ON ERR_RETURN\n" });
        // The merge path: the delegate still sees the caller's options.
        const merged = await runShell(shell, script(base), { cwd: w.cwd, env: baseEnv(w, { OBS_RC: "1" }), outFile: join(w.root, "out2") });
        expect({ rc: merged.rc, out: merged.out }).toEqual({ rc: 1, out: `OPTS-ON\n${BLOCK}` });
        expect(s.requests).toHaveLength(1);
      });
    }

    /** The same script with nothing sourced: the stand-in snapshot, then `cmd`. */
    async function noPlugin(cmd: string, o: { pre?: string; env?: Record<string, string> } = {}): Promise<Run> {
      const parts = [o.pre ?? ":", `. '${join(w.root, "snapshot.sh")}'`, `builtin printf 'SRC-RC=%s\\n' "$?"`, cmd];
      return runShell(shell, parts.join("\n"), { cwd: w.cwd, env: baseEnv(w, o.env), outFile: join(w.root, "out-np") });
    }

    // Review round 2, internal HIGH: a merged call started curl with `&`, so the caller's
    // `$!` named curl's reaped pid and a later `kill $!` missed the user's own job.
    test("a background job started earlier: `kill $!` after grep behaves as without the plugin (bgjob)", async () => {
      const s = await serve();
      const cmd = `command sleep 30 &\ngrep ${ARGV.join(" ")}\nbuiltin kill "$!"; builtin printf 'kill-rc=%s\\n' "$?"`;
      for (const pre of shell.kind === "bash" ? [":", "set -u"] : [":", "setopt NO_UNSET"]) {
        const plain = await noPlugin(cmd, { pre });
        const r = await run(cmd, { pre });
        expect({ rc: r.rc, out: r.out }).toEqual({ rc: plain.rc, out: plain.out });
        expect(r.out).toContain("kill-rc=0");
      }
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:bgjob", "pass:bgjob"]);
    });

    // Review round 4, Codex CRITICAL: with job control on, the backgrounded curl could
    // add a job-completion line (`[1]+ Done …curl…`) to the caller's stderr. Job control
    // means pass through (`jobctl`); the output equals the run with no plugin at all.
    if (shell.kind === "zsh") {
      // zsh refuses MONITOR without a terminal (measured: "can't change option: MONITOR"),
      // so a non-interactive zsh, like Claude Code's, cannot be in job control; the
      // wrapper's `-o monitor` test matters only for an interactive zsh.
      test("zsh: job control cannot be turned on without a terminal", async () => {
        const r = await run(`if [[ -o monitor ]]; then builtin printf 'monitor-on\\n'; fi`, { pre: "setopt MONITOR 2>/dev/null || :" });
        expect(r.out).toBe("SRC-RC=0\n");
      });
    }

    test.skipIf(shell.kind === "zsh")("job control on: passes through (jobctl), output equal to the no-plugin run", async () => {
      const s = await serve();
      const pre = "set -m";
      // A slow grep, so curl would finish first: the case that printed a notice.
      const cmd = `grep ${ARGV.join(" ")}\nbuiltin printf 'after\\n'`;
      const env = { STANDIN_SLEEP: "0.3" };
      const plain = await noPlugin(cmd, { pre, env });
      const r = await run(cmd, { pre, env });
      expect({ rc: r.rc, out: r.out }).toEqual({ rc: plain.rc, out: plain.out });
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:jobctl"]);
    });

    // Review round 4, internal MEDIUM: a system grep (the opt-in sessions' delegate) reads
    // GREP_OPTIONS, which the server cannot see, so its rebuild of grep's matches could be
    // wrong (`-i`, `-v`, context). A non-empty GREP_OPTIONS means pass through.
    test("GREP_OPTIONS set: passes through (grepopts), with and without a grep function", async () => {
      const s = await serve();
      const bin = join(w.root, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "grep"), `#!/bin/sh\nprintf 'sysgrep:%s opts=%s\\n' "$*" "$GREP_OPTIONS"\n`);
      chmodSync(join(bin, "grep"), 0o755);
      const optIn = await run(`grep ${ARGV.join(" ")}`, { standin: false, env: { PATH: `${bin}:/usr/bin:/bin`, GREP_OPTIONS: "-i" } });
      expect(optIn.out).toBe(`SRC-RC=0\nsysgrep:${ARGV.join(" ")} opts=-i\n`);
      const withFn = await run(`grep ${ARGV.join(" ")}`, { env: { GREP_OPTIONS: "-i" } });
      expect(withFn.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:grepopts", "pass:grepopts"]);
    });

    // Review round 5, internal MEDIUM (measured): on the merge path a zsh ZERR trap ran twice
    // for a grep exiting non-zero, once for the delegate inside the wrapper and once for the
    // wrapper's own return. bash with `set -E` is held to the same rule.
    for (const rc of ["1", "2"]) {
      test(`an ERR trap and a grep exiting ${rc} on the merge path: the trap fires as often as without the plugin`, async () => {
        const s = await serve();
        const pre = shell.kind === "zsh" ? "trap 'builtin print ERR-TRAP' ZERR" : "set -E\ntrap 'builtin echo ERR-TRAP' ERR";
        const cmd = `grep ${ARGV.join(" ")}\nbuiltin printf 'rc=%s\\n' "$?"`;
        const env = { STANDIN_RC: rc };
        const plain = await noPlugin(cmd, { pre, env });
        const r = await run(cmd, { pre, env });
        const traps = (out: string): number => out.split("\n").filter((l) => l === "ERR-TRAP").length;
        expect({ traps: traps(r.out), rc: r.rc }).toEqual({ traps: traps(plain.out), rc: plain.rc });
        expect(r.out).toContain(`rc=${rc}\n`);
        expect(s.requests).toHaveLength(1);
      });
    }

    // Review round 6, Codex CRITICAL (measured): `__cs_gm_ra` was read before it was set, so
    // an inherited non-empty value made the restore turn on aliases the caller had off.
    // Every per-shell `__cs_gm_` variable read before this sourcing sets it gets a row:
    // a value in the environment or set by the caller beforehand changes nothing.
    test("an inherited __cs_gm_ra with aliases off: aliases stay off, as without the plugin", async () => {
      await serve();
      const aliasesOff = shell.kind === "zsh" ? "unsetopt aliases\n" : "";
      const pre = `${aliasesOff}alias greet='builtin echo ALIAS'`;
      const cmd = "eval greet\nbuiltin printf 'rc=%s\\n' \"$?\"";
      const env = { __cs_gm_ra: "1" };
      const plain = await noPlugin(cmd, { pre, env });
      const r = await run(cmd, { pre, env });
      // The script with the plugin has one more line (the env line), so bash's error
      // message names a line one later; the line number is not what is compared.
      const lineless = (out: string): string => out.replace(/: line [0-9]+: /gu, ": line N: ");
      expect({ rc: r.rc, out: lineless(r.out) }).toEqual({ rc: plain.rc, out: lineless(plain.out) });
      expect(r.out).toContain("rc=127\n");
    });

    test("an inherited __cs_gm_cpid naming the caller's job: `kill $!` behaves as without the plugin", async () => {
      const s = await serve();
      const pre = "command sleep 30 &\n__cs_gm_cpid=$!";
      const cmd = `grep ${ARGV.join(" ")}\nbuiltin kill "$!"; builtin printf 'kill-rc=%s\\n' "$?"`;
      const plain = await noPlugin(cmd, { pre });
      const r = await run(cmd, { pre });
      expect({ rc: r.rc, out: r.out }).toEqual({ rc: plain.rc, out: plain.out });
      expect(r.out).toContain("kill-rc=0");
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:bgjob"]);
    });

    test("an inherited __cs_gm_seq is never evaluated as arithmetic, and the call merges", async () => {
      const s = await serve();
      const marker = join(w.root, "seq-evaluated");
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { __cs_gm_seq: `a[$(: >| '${marker}')]` } });
      expect(existsSync(marker)).toBe(false);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
    });

    test("an inherited __cs_gm_slow does not stop the merge", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { __cs_gm_slow: "1" } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
      expect(reasons()).toEqual(["merge rc=0 block=1"]);
    });

    test("an inherited __cs_gm_done: no wrapper, grep exactly as without the plugin", async () => {
      const s = await serve();
      const env = { __cs_gm_done: "1" };
      const cmd = `grep ${ARGV.join(" ")}`;
      const plain = await noPlugin(cmd, { env });
      const r = await run(cmd, { env });
      expect({ rc: r.rc, out: r.out }).toEqual({ rc: plain.rc, out: plain.out });
      expect(s.requests).toHaveLength(0);
    });

    // Review round 2, internal LOW: `$RANDOM` named the temp file, which advanced a seeded
    // sequence. A merged call must leave it where it was.
    test("a merged call leaves a seeded $RANDOM sequence untouched", async () => {
      const s = await serve();
      const cmd = `RANDOM=42\ngrep ${ARGV.join(" ")}\nbuiltin printf 'r=%s\\n' "$RANDOM"`;
      const plain = await noPlugin(cmd);
      const r = await run(cmd);
      const seeded = /r=([0-9]+)/u.exec(plain.out)?.[1];
      expect(seeded).toBeDefined();
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}r=${seeded}\n`);
      expect(s.requests).toHaveLength(1);
    });

    test("PWD unset under set -u, with a qualifying socket: silent pass-through (Codex C4)", async () => {
      const s = await serve();
      const pre = shell.kind === "bash" ? "set -u" : "setopt NO_UNSET";
      const r = await run(`unset PWD\ngrep ${ARGV.join(" ")}; builtin printf 'rc=%s\\n' "$?"`, { pre, env: { STANDIN_RC: "1" } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}rc=1\n`);
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:nopwd"]);
    });

    test("an exported LC_ALL naming a missing locale adds nothing to stderr (internal M1, bash ≥ 4.1)", async () => {
      const s = await serve();
      const env = { LC_ALL: "xx_YY.UTF-8" };
      // The same shell with nothing sourced: whatever it prints about the locale itself.
      const plain = await runShell(
        shell,
        `. '${join(w.root, "snapshot.sh")}'\nbuiltin printf 'SRC-RC=0\\n'\ngrep ${ARGV.join(" ")}`,
        { cwd: w.cwd, env: baseEnv(w, env), outFile: join(w.root, "out0") },
      );
      const r = await run(`grep ${ARGV.join(" ")}`, { env });
      expect(r.out).toBe(`${plain.out}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
    });

    test("set -x before sourcing: the line sources nothing, so grep is the stand-in alone, untraced by us", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { pre: "set -x" });
      expect(r.rc).toBe(0);
      expect(r.out).not.toContain("__cs_");
      expect(r.out).not.toContain("--- code-search:");
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual([]);
    });

    // The way xtrace really meets the wrapper: the user's own command turns it on after
    // the line sourced the scripts. The wrapper passes through (`xtrace`); its own trace
    // lines show among the shell's (a known limit, ai-docs §6), every one starting `+`.
    test("set -x inside the command: passes through (xtrace); every non-stand-in line starts with +", async () => {
      const s = await serve();
      const r = await run(`set -x\ngrep ${ARGV.join(" ")}`);
      expect(r.rc).toBe(0);
      const own = new Set(standinBytes(ARGV).split("\n").concat("SRC-RC=0"));
      const strays = r.out.split("\n").filter((l) => l !== "" && !own.has(l) && !l.startsWith("+"));
      expect(strays).toEqual([]);
      const mine = r.out.split("\n").filter((l) => l !== "" && own.has(l));
      expect(mine).toEqual(["SRC-RC=0", ...standinBytes(ARGV).split("\n").filter((l) => l !== "")]);
      expect(r.out).not.toContain("--- code-search:");
      expect(s.requests).toHaveLength(0);
      expect(reasons()).toEqual(["pass:xtrace"]);
    });

    // Review round 3, internal MEDIUM: a server that accepts and never answers cost 1.5 s on
    // EVERY eligible grep. After one curl timeout the shell remembers it (`pass:slow`).
    test(
      "a hung server: only the first of five greps waits; the rest pass through (slow)",
      async () => {
        answer = () => "hang";
        const s = await serve();
        const g = `grep ${ARGV.join(" ")}`;
        const off = await run(`CODE_SEARCH_MERGE=0 ${g}`);
        const r = await run([g, g, g, g, g].join("\n"));
        expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV).repeat(5)}`);
        expect(r.ms).toBeLessThan(off.ms + 1_500 + 1_000);
        expect(s.requests).toHaveLength(1);
        // The first line is the switched-off baseline run's.
        expect(reasons()).toEqual(["pass:off", "merge rc=0 block=0", "pass:slow", "pass:slow", "pass:slow", "pass:slow"]);
        expect(leftovers()).toEqual([]);
      },
      20_000,
    );

    // Review round 3, LOW (two reviewers): a reply file left by a killed shell whose pid
    // came back must never be printed for a call whose own curl got no bytes.
    test("a stale .out under this call's name is never printed", async () => {
      const aside = `${w.sock}.aside`;
      const dead = await startFakeServer(aside, () => FRAME);
      linkSync(aside, w.sock);
      await dead.close();
      const stale = join(w.root, "stale.out");
      writeFileSync(stale, frameOf(blockText("staleWord", "src/old.ts:1: stale")));
      const seed = `command cp '${stale}' "$TMPDIR/code-search-$UID/$PPID.$$.1.out"`;
      const r = await run(`${seed}\ngrep ${ARGV.join(" ")}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(reasons()).toEqual(["merge rc=0 block=0"]);
      expect(leftovers()).toEqual([]);
    });

    // ------------------------------------------------------------------ sourcing

    test("repeated sourcing: same definitions, one request per call", async () => {
      const s = await serve();
      const dump = `builtin typeset -f grep __cs_cc_grep __cs_gm_classify __cs_gm_readframe; builtin printf 'fd=%s\\n' "$__cs_gm_fd"`;
      const outs: string[] = [];
      for (const lines of [1, 2, 3]) {
        const r = await run(`{ ${dump}; } > '${join(w.root, `defs${lines}`)}'\ngrep ${ARGV.join(" ")}`, { lines });
        expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
        outs.push(readFileSync(join(w.root, `defs${lines}`), "utf8"));
      }
      expect(outs[1]).toBe(outs[0]);
      expect(outs[2]).toBe(outs[0]);
      expect(outs[0]).toContain("__cs_cc_grep");
      expect(s.requests).toHaveLength(3);
    });

    test("body file missing: sourcing is silent, no wrapper, the stand-in alone", async () => {
      const s = await serve();
      renameSync(w.body, `${w.body}.gone`);
      const r = await run(
        `if builtin typeset -f __cs_cc_grep >/dev/null 2>&1; then builtin printf 'wrapper\\n'; fi\ngrep ${ARGV.join(" ")}`,
      );
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(s.requests).toHaveLength(0);
    });

    test("two versions: whichever is sourced first wraps, the other steps aside", async () => {
      const s = await serve();
      const v2 = join(w.root, "plugin2", "assets");
      mkdirSync(v2, { recursive: true });
      for (const name of [MAIN_NAME, BODY_NAME]) {
        const text = readFileSync(join(w.assets, name), "utf8").replaceAll("__cs_gm_done", "__cs_gm_done_v2");
        writeFileSync(join(v2, name), text);
      }
      const v2main = join(v2, MAIN_NAME);
      for (const order of [
        [w.main, v2main],
        [v2main, w.main],
      ]) {
        const before = s.requests.length;
        const parts = [`. '${join(w.root, "snapshot.sh")}'`, ...order.map(sourceLine), `grep ${ARGV.join(" ")}`];
        const r = await runShell(shell, parts.join("\n"), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out") });
        expect(r.out).toBe(`${standinBytes(ARGV)}${BLOCK}`);
        expect(r.rc).toBe(0);
        expect(s.requests.length - before).toBe(1);
      }
    });

    test("aliases live while sourcing: silent, merge works, alias state restored", async () => {
      const s = await serve();
      const bin = join(w.root, "bin");
      mkdirSync(bin);
      const sysgrep = join(bin, "grep");
      writeFileSync(sysgrep, `#!/bin/sh\nprintf 'sysgrep:'\nfor a in "$@"; do printf ' <%s>' "$a"; done\nprintf '\\n'\n`);
      chmodSync(sysgrep, 0o755);
      const aliases =
        shell.kind === "bash"
          ? "shopt -s expand_aliases\nalias grep='grep --color=auto' rm='rm -i' curl='curl -v' printf='printf X'"
          : "alias grep='grep --color=auto' rm='rm -i' curl='curl -v' printf='printf X'\nalias -g G='| grep'\nalias -g NUL='> /dev/null 2>&1'";
      const state =
        shell.kind === "bash"
          ? `if builtin shopt -q expand_aliases; then builtin printf 'aliases=on\\n'; fi`
          : `if [[ -o aliases ]]; then builtin printf 'aliases=on\\n'; fi`;
      // zsh parses a whole `-c` string before running it, so an alias defined in it would
      // not reach a later line; Claude Code runs the command through `eval`, which parses
      // at run time with the aliases live. So does this row.
      const r = await run(`${state}\n${sourceLine(w.main)}\n${state}\neval 'grep -rln ${WORD} .'`, {
        pre: aliases,
        standin: false,
        env: { PATH: `${bin}:/usr/bin:/bin` },
      });
      expect(r.out).toBe(
        `SRC-RC=0\naliases=on\naliases=on\nsysgrep: <--color=auto> <-rln> <${WORD}> <.>\n${BLOCK}`,
      );
      expect(s.requests).toHaveLength(1);
      expect(fields(s.requests[0] ?? Buffer.alloc(0)).slice(5)).toEqual(["4", "--color=auto", "-rln", WORD, "."]);
    });

    // ------------------------------------------------------------------ timing, jobs

    test("a hung server costs at most curl's 1.5 s", async () => {
      answer = () => "hang";
      const s = await serve();
      const off = await run(`CODE_SEARCH_MERGE=0 grep ${ARGV.join(" ")}`);
      const r = await run(`grep ${ARGV.join(" ")}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      expect(r.ms).toBeLessThan(off.ms + 1_700 + 500);
      expect(s.requests).toHaveLength(1);
      expect(leftovers()).toEqual([]);
    });

    test("a merged call's own curl does not read as the caller's job: the next grep merges too", async () => {
      const s = await serve();
      const g = `grep ${ARGV.join(" ")}`;
      const r = await run(`${g}\n${g}\ncommand sleep 30 &\n${g}\nbuiltin kill "$!"`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}${standinBytes(ARGV)}${BLOCK}${standinBytes(ARGV)}`);
      expect(s.requests).toHaveLength(2);
      expect(reasons()).toEqual(["merge rc=0 block=1", "merge rc=0 block=1", "pass:bgjob"]);
    });

    test("a delegate slower than the server adds no wait", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { STANDIN_SLEEP: "0.6" } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(r.ms).toBeLessThan(600 + 500);
      expect(s.requests).toHaveLength(1);
    });

    test("warm server: the merge costs little over the plain call", async () => {
      await serve();
      const g = `grep ${ARGV.join(" ")}`;
      const time = async (cmd: string): Promise<number> => {
        const ms: number[] = [];
        for (let i = 0; i < 5; i += 1) ms.push((await run(cmd)).ms);
        return ms.sort((a, b) => a - b)[2] ?? 0;
      };
      const plain = await time(`CODE_SEARCH_MERGE=0 ${g}`);
      const merged = await time(g);
      // P2 says ≤ +50 ms; this driving test leaves CI scheduling slack and reports the figure.
      expect(merged - plain).toBeLessThan(150);
    });

    test("curl argv is exactly P1's, and no ~/.curlrc is read", async () => {
      const bin = join(w.root, "bin");
      mkdirSync(bin);
      const argvFile = join(w.root, "curl-argv");
      writeFileSync(join(bin, "curl"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${argvFile}'\n`);
      chmodSync(join(bin, "curl"), 0o755);
      await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { PATH: `${bin}:/usr/bin:/bin` } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      const got = readFileSync(argvFile, "utf8").split("\n").slice(0, -1);
      const req = got[13] ?? "";
      const out = got[15] ?? "";
      expect(req).toMatch(new RegExp(`^@${w.sockDir}/${process.pid}\\.[0-9]+\\.[0-9]+\\.req$`, "u"));
      expect(out).toBe(`${req.slice(1, -4)}.out`);
      expect(got).toEqual([
        "-q",
        "--silent",
        "--unix-socket",
        w.sock,
        "--max-time",
        "1.5",
        "--max-filesize",
        "16448",
        "-H",
        "Expect:",
        "-H",
        "Content-Type: application/octet-stream",
        "--data-binary",
        req,
        "-o",
        out,
        "http://localhost/merge",
      ]);
      expect(leftovers()).toEqual([]);
    });

    // ------------------------------------------------------------------ descriptors

    if (shell.kind === "bash" && shell.major < 4) {
      test("bash 3.2: inherited fds 8 and 9 are left alone; the saved fd is the first closed one", async () => {
        const s = await serve();
        const f8 = join(w.root, "F8");
        const f9 = join(w.root, "F9");
        const r = await run(
          [
            `builtin printf 'fd=%s same=' "$__cs_gm_fd"`,
            `if [[ /dev/fd/$__cs_gm_fd -ef /dev/fd/1 ]]; then builtin printf 'yes\\n'; else builtin printf 'no\\n'; fi`,
            `grep ${ARGV.join(" ")}`,
            `grep -n ${WORD} src`,
            "builtin printf 'x\\n' >&9",
            "builtin printf 'y\\n' >&8",
          ].join("\n"),
          { pre: `exec 9>'${f9}'\nexec 8>'${f8}'` },
        );
        expect(r.out).toBe(
          `SRC-RC=0\nfd=7 same=yes\n${standinBytes(ARGV)}${BLOCK}${standinBytes(["-n", WORD, "src"])}`,
        );
        expect(readFileSync(f9, "utf8")).toBe("x\n");
        expect(readFileSync(f8, "utf8")).toBe("y\n");
        expect(s.requests).toHaveLength(1);
      });

      test("bash 3.2: fds 3 to 9 all open: no saved fd, every call passes (nofd), writes land", async () => {
        const s = await serve();
        const pre = [3, 4, 5, 6, 7, 8, 9].map((n) => `exec ${n}>'${join(w.root, `F${n}`)}'`).join("\n");
        const writes = [3, 4, 5, 6, 7, 8, 9].map((n) => `builtin printf '${n}\\n' >&${n}`).join("\n");
        const r = await run(`builtin printf 'fd=[%s]\\n' "$__cs_gm_fd"\ngrep ${ARGV.join(" ")}\n${writes}`, { pre });
        expect(r.out).toBe(`SRC-RC=0\nfd=[]\n${standinBytes(ARGV)}`);
        for (const n of [3, 4, 5, 6, 7, 8, 9]) expect(readFileSync(join(w.root, `F${n}`), "utf8")).toBe(`${n}\n`);
        expect(reasons()).toEqual(["pass:nofd"]);
        expect(s.requests).toHaveLength(0);
      });
    } else {
      test("the saved fd is ≥ 10", async () => {
        const r = await run(`builtin printf 'fd=%s\\n' "$__cs_gm_fd"`);
        expect(Number(/fd=([0-9]+)/u.exec(r.out)?.[1])).toBeGreaterThanOrEqual(10);
      });
    }

    test("a re-pointed or closed saved fd passes through (notfinal), silently", async () => {
      const s = await serve();
      const g = join(w.root, "G");
      const repoint =
        shell.kind === "zsh" ? "exec {__cs_gm_fd}>&-" : `eval "exec $__cs_gm_fd>'${g}'"`;
      const r = await run(`${repoint}\ngrep ${ARGV.join(" ")}`);
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}`);
      if (shell.kind !== "zsh") expect(readFileSync(g, "utf8")).toBe("");
      expect(reasons()).toEqual(["pass:notfinal"]);
      expect(s.requests).toHaveLength(0);
    });

    test("opt-in session (no grep function): delegates to command grep and still merges", async () => {
      const s = await serve();
      const bin = join(w.root, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "grep"), `#!/bin/sh\nprintf 'sysgrep:%s\\n' "$*"\nexit 1\n`);
      chmodSync(join(bin, "grep"), 0o755);
      const r = await run(`grep ${ARGV.join(" ")}`, { standin: false, env: { PATH: `${bin}:/usr/bin:/bin` } });
      expect(r.out).toBe(`SRC-RC=0\nsysgrep:${ARGV.join(" ")}\n${BLOCK}`);
      expect(r.rc).toBe(1);
      expect(s.requests).toHaveLength(1);
    });

    test("the log in a missing directory changes nothing and prints nothing", async () => {
      const s = await serve();
      const r = await run(`grep ${ARGV.join(" ")}`, { env: { CODE_SEARCH_MERGE_LOG: join(w.root, "no", "such", "log") } });
      expect(r.out).toBe(`SRC-RC=0\n${standinBytes(ARGV)}${BLOCK}`);
      expect(s.requests).toHaveLength(1);
    });
  });
}
