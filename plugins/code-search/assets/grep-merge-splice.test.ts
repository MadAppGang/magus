/**
 * grep-merge-splice.test.ts — the env-file line inside Claude Code's command assembly
 * (P1 + P7 splice harness).
 *
 * A conservative reduction of what Claude Code builds for one Bash call:
 *
 *   ["source <snapshot>", envScript, "eval '<cmd>'", "pwd -P >| <tmp>"].join(" && ")
 *
 * where envScript is every session-env hook file, each `.trim()`ed, joined with `\n`.
 * Each case runs as is and with Claude Code 2.1.292's `\n:` terminator appended. The
 * user's command must run in every case, with its own stdout, stderr and rc; a merged
 * grep must merge exactly once however many lines precede it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envLineBytes } from "../hooks/grep-merge-env";
import {
  baseEnv,
  blockText,
  capture,
  captureSync,
  findShells,
  frameOf,
  makeWorld,
  runShell,
  STANDIN,
  standinBytes,
  startFakeServer,
  type FakeServer,
  type Shell,
  type World,
} from "../test-support/grep-merge-harness";

const SHELLS = findShells();
const ARGV = ["-rn", "fetchUserProfile", "."];
const BLOCK = blockText();
const FOREIGN = "export FOO=1";
const HOOK = join(import.meta.dir, "..", "hooks", "grep-merge-env.ts");

type Case = { n: number; name: string; files: (w: World) => string[]; setup?: (w: World) => void; merges: boolean; errexit: boolean; parseError?: boolean };

const ours = (w: World): string => envLineBytes(w.main) ?? "";

/**
 * Does a function run by `eval` from a non-final `&&` element (as the splice runs the
 * user's command) see errexit on? Measured: bash 3.2 no (it drops `e` from `$-` there),
 * bash 5.2 yes, zsh yes (`-o errexit`).
 */
function errexitVisibleInAndList(shell: Shell): boolean {
  const probe =
    shell.kind === "zsh"
      ? "function f { if [[ -o errexit ]]; then builtin printf on; fi; }\neval 'setopt ERR_EXIT' && eval 'f' && :"
      : "function f { if [[ $- == *e* ]]; then builtin printf on; fi; }\neval 'set -e' && eval 'f' && :";
  return captureSync(shell.path, ["-c", probe]).stdout === "on";
}

const CASES: Case[] = [
  { n: 1, name: "our file alone", files: (w) => [ours(w)], merges: true, errexit: true },
  { n: 2, name: "ours, then a foreign file", files: (w) => [ours(w), FOREIGN], merges: true, errexit: true },
  { n: 3, name: "a foreign file, then ours", files: (w) => [FOREIGN, ours(w)], merges: true, errexit: true },
  { n: 4, name: "two of ours with a foreign file between", files: (w) => [ours(w), FOREIGN, ours(w)], merges: true, errexit: true },
  {
    n: 5,
    name: "the main file does not exist",
    files: (w) => [ours(w)],
    setup: (w) => renameSync(w.main, `${w.main}.gone`),
    merges: false,
    errexit: false,
  },
  {
    n: 6,
    name: "the main file holds a syntax error",
    files: (w) => [ours(w)],
    setup: (w) => writeFileSync(w.main, "if then fi (\n"),
    merges: false,
    errexit: false,
    parseError: true,
  },
  {
    n: 7,
    name: "the main file's last command is false",
    files: (w) => [ours(w)],
    setup: (w) => writeFileSync(w.main, "false\n"),
    merges: false,
    errexit: false,
  },
  {
    n: 8,
    name: "the body file does not exist",
    files: (w) => [ours(w)],
    setup: (w) => renameSync(w.body, `${w.body}.gone`),
    merges: false,
    errexit: true,
  },
];

for (const shell of SHELLS) {
  describe(`splice under ${shell.name}`, () => {
    let w: World;
    let server: FakeServer;

    beforeEach(async () => {
      w = makeWorld();
      server = await startFakeServer(w.sock, () => frameOf(BLOCK));
    });

    afterEach(async () => {
      await server.close();
      w.cleanup();
    });

    for (const c of CASES) {
      for (const errexit of c.errexit ? [false, true] : [false]) {
        for (const terminator of [false, true]) {
          const label = `case ${c.n}: ${c.name}${errexit ? ", errexit" : ""}${terminator ? ", with \\n:" : ""}`;
          test(label, async () => {
            c.setup?.(w);
            const errexitLine = errexit ? (shell.kind === "zsh" ? "setopt ERR_EXIT\n" : "set -e\n") : "";
            const snapshot = join(w.root, "snapshot.sh");
            writeFileSync(snapshot, `${errexitLine}${STANDIN}\n`);
            const envScript = c.files(w).map((f) => f.trim()).join("\n") + (terminator ? "\n:" : "");
            const pwdFile = join(w.root, "pwd");
            const build = (cmd: string): string =>
              [`source '${snapshot}'`, envScript, `eval '${cmd}'`, `pwd -P >| '${pwdFile}'`].join(" && ");

            // The plain command runs, with its own output and rc.
            const echo = await runShell(shell, build("echo ran"), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out1") });
            const parse = (out: string): { rest: string; parseLines: string[] } => {
              const lines = out.split("\n");
              const parseLines = lines.filter((l) => l.includes("grep-merge.sh"));
              return { rest: lines.filter((l) => !l.includes("grep-merge.sh")).join("\n"), parseLines };
            };
            const e = parse(echo.out);
            expect({ rc: echo.rc, out: e.rest }).toEqual({ rc: 0, out: "ran\n" });
            expect(e.parseLines.length > 0).toBe(c.parseError === true);

            // The grep: merged exactly once in cases 1–4, grep alone otherwise. With errexit
            // visible to the call a call passes through (review round 1, Codex C2).
            // Measured: inside Claude Code's `&&` chain bash 3.2 drops `e` from `$-` (the
            // delegate then has no errexit to lose, so it merges); bash 5 keeps it, and zsh
            // keeps `-o errexit`; both pass through. The probe asks the shell itself.
            const merges = c.merges && !(errexit && errexitVisibleInAndList(shell));
            const before = server.requests.length;
            const g = await runShell(shell, build(`grep ${ARGV.join(" ")}`), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out2") });
            const gp = parse(g.out);
            expect(g.rc).toBe(0);
            expect(gp.rest).toBe(`${standinBytes(ARGV)}${merges ? BLOCK : ""}`);
            expect(server.requests.length - before).toBe(merges ? 1 : 0);
          });
        }
      }
    }

    // Review round 4, Codex CRITICAL: a caller's function named `.` (or `[`) returning
    // nonzero under errexit aborted the call at the env line, before the user's command.
    // The line and the main file now use `[[ -r … ]]` and `builtin .`.
    const overrides: [string, string][] =
      shell.kind === "zsh"
        ? [
            ["`.` function, ERR_EXIT", "function . { return 9; }\nsetopt ERR_EXIT"],
            ["`.` function, ERR_RETURN", "function . { return 9; }\nsetopt ERR_RETURN"],
            ["`[` function, ERR_EXIT", "function [ { return 9; }\nsetopt ERR_EXIT"],
          ]
        : [
            ["`.` function, set -e", "function . { return 9; }\nset -e"],
            ["`[` function, set -e", "function [ { return 9; }\nset -e"],
          ];
    for (const [label, pre] of overrides) {
      test(`a caller ${label}: the command runs, and the wrapper still loads`, async () => {
        const snapshot = join(w.root, "snapshot.sh");
        writeFileSync(snapshot, `${pre}\n${STANDIN}\n`);
        const pwdFile = join(w.root, "pwd");
        const chain = (cmd: string): string =>
          [`source '${snapshot}'`, (envLineBytes(w.main) ?? "").trim(), `eval '${cmd}'`, `pwd -P >| '${pwdFile}'`].join(" && ");
        const echo = await runShell(shell, chain("echo ran"), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out1") });
        expect({ rc: echo.rc, out: echo.out }).toEqual({ rc: 0, out: "ran\n" });
        const before = server.requests.length;
        const g = await runShell(shell, chain(`grep ${ARGV.join(" ")}`), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out2") });
        expect(g.rc).toBe(0);
        // Merged where errexit is invisible inside the chain (bash 3.2), grep alone where
        // it is visible (the wrapper's errexit rule); either way the command ran.
        const merges = !errexitVisibleInAndList(shell);
        expect(g.out).toBe(`${standinBytes(ARGV)}${merges ? BLOCK : ""}`);
        expect(server.requests.length - before).toBe(merges ? 1 : 0);
        // The wrapper is defined: the body loaded through `builtin .`.
        const defined = await runShell(
          shell,
          chain("if builtin typeset -f __cs_cc_grep >/dev/null 2>&1; then builtin printf defined; fi"),
          { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out3") },
        );
        expect(defined.out).toBe("defined");
      });
    }

    // Review round 5, Codex + internal CRITICAL (measured): a restricted shell refuses `.`
    // of a path holding `/` (bash: the call aborted under errexit; zsh: the wrapper
    // half-loaded over the caller's own `grep`), and zsh's SOURCE_TRACE printed one line
    // per sourced file on every call. The line now sources nothing when `$-` holds `r` or
    // zsh has SOURCE_TRACE on, so the call is exactly the call without the plugin.
    const userGrep = "function grep { builtin printf 'user-grep %s\\n' \"$*\"; return 3; }";
    const errexitOn = shell.kind === "zsh" ? "setopt ERR_EXIT" : "set -e";
    const restrictedOn = shell.kind === "zsh" ? "setopt RESTRICTED" : "set -r";
    const quiet: [string, string][] = [
      ["restricted, errexit, a custom grep", `${userGrep}\n${errexitOn}\n${restrictedOn}`],
      ["restricted, a custom grep", `${userGrep}\n${restrictedOn}`],
      ...(shell.kind === "zsh" ? [["SOURCE_TRACE", "setopt SOURCE_TRACE"] as [string, string]] : []),
    ];
    for (const [label, pre] of quiet) {
      test(`${label}: stdout, stderr and rc equal the run without the plugin`, async () => {
        const snapshot = join(w.root, "snapshot.sh");
        writeFileSync(snapshot, `${STANDIN}\n${pre}\n`);
        const chain = (envScript: string | undefined, cmd: string): string =>
          [`source '${snapshot}'`, ...(envScript === undefined ? [] : [envScript]), `eval '${cmd}'`].join(" && ");
        for (const cmd of ["echo ran", `grep ${ARGV.join(" ")}`]) {
          const plain = await runShell(shell, chain(undefined, cmd), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out1") });
          const ours = await runShell(shell, chain((envLineBytes(w.main) ?? "").trim(), cmd), {
            cwd: w.cwd,
            env: baseEnv(w),
            outFile: join(w.root, "out2"),
          });
          expect({ cmd, rc: ours.rc, out: ours.out }).toEqual({ cmd, rc: plain.rc, out: plain.out });
        }
        expect(server.requests).toHaveLength(0);
      });
    }

    // Review round 5, internal LOW (measured): the main file's last two statements were
    // parsed after the caller's aliases came back, so an alias on `unset` printed on every
    // Bash call. The wrapper still loads and merges.
    test("an alias on unset: the line prints nothing, and grep still merges", async () => {
      const aliasOn = shell.kind === "zsh" ? "alias unset='echo ALIASED-UNSET'" : "shopt -s expand_aliases\nalias unset='echo ALIASED-UNSET'";
      const snapshot = join(w.root, "snapshot.sh");
      writeFileSync(snapshot, `${STANDIN}\n${aliasOn}\n`);
      const chain = (envScript: string | undefined, cmd: string): string =>
        [`source '${snapshot}'`, ...(envScript === undefined ? [] : [envScript]), `eval '${cmd}'`].join(" && ");
      const line = (envLineBytes(w.main) ?? "").trim();
      const plain = await runShell(shell, chain(undefined, "echo ran"), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out1") });
      const ours = await runShell(shell, chain(line, "echo ran"), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out2") });
      expect({ rc: ours.rc, out: ours.out }).toEqual({ rc: plain.rc, out: plain.out });
      const g = await runShell(shell, chain(line, `grep ${ARGV.join(" ")}`), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out3") });
      expect(g.out).toBe(`${standinBytes(ARGV)}${BLOCK}`);
      expect(server.requests).toHaveLength(1);
    });

    // Review round 4, Codex CRITICAL: bash inherits verbose or xtrace through an exported
    // SHELLOPTS and then echoes (or traces) the env line itself while parsing it, before
    // any guard inside it can run. So the SessionStart hook writes no line at all then.
    if (shell.kind === "bash") {
      for (const opt of ["verbose", "xtrace"]) {
        test(`SHELLOPTS exporting ${opt}: what the hook writes changes nothing on stderr`, async () => {
          const shellopts = `braceexpand:hashall:interactive-comments:${opt}`;
          // The real hook, in that environment, with an engine configured.
          const project = join(w.root, "proj");
          mkdirSync(join(project, ".claude"), { recursive: true });
          writeFileSync(
            join(project, ".claude", "settings.json"),
            JSON.stringify({ "code-search": { engine: "mnemex", engines: { mnemex: { command: "true" } } } }),
          );
          const envFile = join(w.root, "sessionstart-hook-1.sh");
          const hook = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", HOOK], {
            cwd: project,
            env: { PATH: "/usr/bin:/bin", HOME: w.home, CLAUDE_PROJECT_DIR: project, CLAUDE_ENV_FILE: envFile, SHELLOPTS: shellopts },
          });
          expect(hook).toMatchObject({ rc: 0, stdout: "", stderr: "" });
          const written = existsSync(envFile) ? readFileSync(envFile, "utf8").trim() : "";
          const snapshot = join(w.root, "snapshot.sh");
          writeFileSync(snapshot, `${STANDIN}\n`);
          const chain = (envScript: string): string =>
            [`source '${snapshot}'`, ...(envScript === "" ? [] : [envScript]), "eval 'echo ran'"].join(" && ");
          const env = baseEnv(w, { SHELLOPTS: shellopts });
          const plain = await runShell(shell, chain(""), { cwd: w.cwd, env, outFile: join(w.root, "out1") });
          const ours = await runShell(shell, chain(written), { cwd: w.cwd, env, outFile: join(w.root, "out2") });
          expect(ours.out).toBe(plain.out);
          expect(written).toBe("");
        });
      }
    }

    // Review round 2, Codex CRITICAL: under verbose mode the shell echoed both sourced
    // asset files (about 424 lines) to stderr on every Bash call, and under xtrace it
    // traced their definitions. The env line now sources nothing while `$-` holds `v` or
    // `x`. The mode is set where a real session would have it: in the snapshot, the first
    // element of the chain, so the chain itself was parsed before the mode came on.
    for (const mode of ["verbose", "xtrace"] as const) {
      for (const cmd of ["echo ran", `grep ${ARGV.join(" ")}`]) {
        test(`${mode} on in the snapshot: \`${cmd}\` gives the no-plugin output${mode === "xtrace" ? " plus the env line's own trace" : ""}`, async () => {
          const on = shell.kind === "zsh" ? `setopt ${mode.toUpperCase()}` : mode === "verbose" ? "set -v" : "set -x";
          const snapshot = join(w.root, "snapshot.sh");
          writeFileSync(snapshot, `${on}\n${STANDIN}\n`);
          const pwdFile = join(w.root, "pwd");
          const chain = (envScript: string | undefined): string =>
            [`source '${snapshot}'`, ...(envScript === undefined ? [] : [envScript]), `eval '${cmd}'`, `pwd -P >| '${pwdFile}'`].join(" && ");
          const plain = await runShell(shell, chain(undefined), { cwd: w.cwd, env: baseEnv(w), outFile: join(w.root, "out1") });
          const ours = await runShell(shell, chain((envLineBytes(w.main) ?? "").trim()), {
            cwd: w.cwd,
            env: baseEnv(w),
            outFile: join(w.root, "out2"),
          });
          expect(ours.rc).toBe(plain.rc);
          if (mode === "verbose") {
            expect(ours.out).toBe(plain.out);
          } else {
            // xtrace traces every command, so the env line's own words (its `case`, the
            // `:`) appear; nothing from the assets may.
            const remaining = [...plain.out.split("\n")];
            const extra: string[] = [];
            for (const line of ours.out.split("\n")) {
              const i = remaining.indexOf(line);
              if (i >= 0) remaining.splice(i, 1);
              else extra.push(line);
            }
            expect(remaining).toEqual([]);
            expect(extra.length).toBeLessThanOrEqual(3);
            for (const line of extra) {
              expect(line.startsWith("+")).toBe(true);
              expect(line).not.toContain("__cs_");
              expect(line).not.toContain("grep-merge");
            }
          }
          expect(server.requests).toHaveLength(0);
        });
      }
    }
  });
}
