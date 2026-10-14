import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { baseEnv, blockText, findShells, frameOf, makeWorld, runShell, sourceLine, sq, startFakeServer, STANDIN, standinBytes } from "../test-support/grep-merge-harness";

let serial = 0;
for (const shell of findShells()) {
  const mergeOptions = shell.kind === "zsh" ? "setopt NO_UNSET NOCLOBBER SH_WORD_SPLIT KSH_ARRAYS" : "set -uo pipefail";
  const errexit = shell.kind === "zsh" ? "setopt ERR_EXIT" : "set -e";
  for (const [label, options, reason] of [
    ["default", ":", "nofile"],
    ["nounset and noclobber", mergeOptions, "nofile"],
    ["errexit", errexit, "errexit"],
  ] as const) {
    test(`N1 R12.3 ${shell.name} ${label} with an unwritable request path logs ${reason}`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(blockText("WORD")));
      try {
        const script = [
          STANDIN, options, sourceLine(w.main),
          `command mkdir ${sq(w.sockDir)}/$PPID.$$.1.req`,
          "grep -rn WORD .",
        ].join("\n");
        const result = await runShell(shell, script, {
          cwd: w.cwd, env: baseEnv(w, { STANDIN_RC: "0" }), outFile: `${w.root}/nofile-${++serial}.capture`,
        });
        expect({ rc: result.rc, out: result.out, requests: server.requests.length, log: readFileSync(w.log, "utf8") })
          .toEqual({ rc: 0, out: standinBytes(["-rn", "WORD", "."]), requests: 0,
            log: expect.stringMatching(new RegExp(`^\\d+ grep pass:${reason}\\n$`)) });
      } finally { await server.close(); w.cleanup(); }
    });
  }
}
