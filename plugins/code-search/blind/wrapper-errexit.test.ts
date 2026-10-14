import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { baseEnv, blockText, findShells, frameOf, makeWorld, runShell, sourceLine, startFakeServer } from "../test-support/grep-merge-harness";

let serial = 0;
for (const shell of findShells()) {
  const options = shell.kind === "zsh" ? ["setopt ERR_EXIT", "setopt ERR_RETURN"] : ["set -e"];
  for (const option of options) {
    test(`N1 R12.3 ${shell.name} ${option} keeps a failing delegate's early-exit behaviour`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(blockText("WORD")));
      try {
        const standin = "function grep { command false; builtin printf 'AFTER-FAIL\\n'; }";
        const plain = await runShell(shell, `${standin}\n${option}\ngrep -rn WORD .`, {
          cwd: w.cwd, env: baseEnv(w), outFile: `${w.root}/plain-${++serial}.capture`,
        });
        const wrapped = await runShell(shell, `${standin}\n${option}\n${sourceLine(w.main)}\ngrep -rn WORD .`, {
          cwd: w.cwd, env: baseEnv(w), outFile: `${w.root}/wrapped-${++serial}.capture`,
        });
        expect({ rc: wrapped.rc, out: wrapped.out, requests: server.requests.length,
          log: readFileSync(w.log, "utf8") })
          .toEqual({ rc: plain.rc, out: plain.out, requests: 0,
            log: expect.stringMatching(/^\d+ grep pass:errexit\n$/) });
        expect(wrapped.out.includes("AFTER-FAIL")).toBe(plain.out.includes("AFTER-FAIL"));
      } finally { await server.close(); w.cleanup(); }
    });
  }
}
