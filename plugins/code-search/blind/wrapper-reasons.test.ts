import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { baseEnv, blockText, findShells, frameOf, makeWorld, runShell, sourceLine, startFakeServer, STANDIN, standinBytes } from "../test-support/grep-merge-harness";

let serial = 0;
for (const shell of findShells()) {
  for (const [reason, middle, env] of [
    // R12.2 step 5: zsh's `exec {__cs_gm_fd}>&1` makes the variable an integer, so a bare
    // `__cs_gm_fd=` sets it to "0" (non-empty). Unset first to get the empty value test 7 reads.
    ["nofd", "unset __cs_gm_fd; __cs_gm_fd=", {}],
    // A PATH naming no real directory, never an empty one: Debian's /etc/zsh/zshenv, which
    // zsh always reads, replaces an empty PATH with the system default, and curl comes back.
    ["nocurl", ":", { PATH: "/nonexistent-code-search-nocurl" }],
  ] as const) {
    test(`N1 R12.2 ${shell.name} ${reason} preserves delegate bytes and rc 1`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(blockText("WORD")));
      try {
        const script = `${STANDIN}\n${sourceLine(w.main)}\n${middle}\ngrep -rn WORD .`;
        const r = await runShell(shell, script, {
          cwd: w.cwd, env: baseEnv(w, { ...env, STANDIN_RC: "1" }),
          outFile: `${w.root}/reason-${++serial}.capture`,
        });
        expect({ rc: r.rc, out: r.out, requests: server.requests.length, log: readFileSync(w.log, "utf8") })
          .toEqual({ rc: 1, out: standinBytes(["-rn", "WORD", "."]), requests: 0,
            log: expect.stringMatching(new RegExp(`^\\d+ grep pass:${reason}\\n$`)) });
      } finally { await server.close(); w.cleanup(); }
    });
  }
}
