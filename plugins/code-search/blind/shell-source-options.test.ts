import { expect, test } from "bun:test";
import { baseEnv, blockText, capture, findShells, frameOf, makeWorld, runShell, sourceLine, startFakeServer, STANDIN, standinBytes } from "../test-support/grep-merge-harness";

const shells = findShells();
const block = blockText("WORD");
let serial = 0;
for (const shell of shells) {
  test(`R12.7 P7 ${shell.name} verbose before source does not define a wrapper`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const script = `${STANDIN}\nset -v\n${sourceLine(w.main)}\nset +v\nif typeset -f __cs_cc_grep >/dev/null 2>&1; then builtin printf WRAPPED; fi\ngrep -rn WORD .`;
      const r = await capture(shell.path, ["-c", script], { cwd: w.cwd, env: baseEnv(w) });
      expect({ rc: r.rc, stdout: r.stdout, requests: server.requests.length })
        .toEqual({ rc: 0, stdout: standinBytes(["-rn", "WORD", "."]).replace("standin-stderr\n", ""), requests: 0 });
      expect(r.stderr.endsWith("standin-stderr\n")).toBe(true);
    } finally { await server.close(); w.cleanup(); }
  });

  for (const override of [".", "["]) {
    test(`R12.7 P7 ${shell.name} caller function ${override} cannot intercept guarded source`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      try {
        const run = await runShell(shell,
          `${STANDIN}\nfunction ${override} { return 9; }\n${sourceLine(w.main)}\nif typeset -f __cs_cc_grep >/dev/null 2>&1; then builtin printf 'WRAPPED\n'; fi\ngrep -rn WORD .`,
          { cwd: w.cwd, env: baseEnv(w), outFile: `${w.root}/options-${++serial}.output` });
        expect({ rc: run.rc, out: run.out, requests: server.requests.length }).toEqual({
          rc: 0, out: "WRAPPED\n" + standinBytes(["-rn", "WORD", "."]) + block, requests: 1,
        });
      } finally { await server.close(); w.cleanup(); }
    });
  }
}
for (const shell of shells.filter((s) => s.kind === "zsh")) {
  test(`R12.7 P7 ${shell.name} SOURCE_TRACE before source produces no sourcing trace`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const script = `${STANDIN}\nsetopt SOURCE_TRACE\n${sourceLine(w.main)}\ngrep -rn WORD .`;
      const r = await capture(shell.path, ["-c", script], { cwd: w.cwd, env: baseEnv(w) });
      expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr, requests: server.requests.length }).toEqual({
        rc: 0, stdout: standinBytes(["-rn", "WORD", "."]).replace("standin-stderr\n", ""),
        stderr: "standin-stderr\n", requests: 0,
      });
    } finally { await server.close(); w.cleanup(); }
  });
}
