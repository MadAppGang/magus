import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseEnv, blockText, findShells, frameOf, makeWorld, runShell, sourceLine, startFakeServer } from "../test-support/grep-merge-harness";

const block = blockText("WORD");
const stdout = Buffer.from([0xff, 0x00, 0x58]);
const stderr = Buffer.from([0xfe, 0x59]);
const standin = [
  "function grep {",
  "  builtin printf '\\377\\000X'",
  "  builtin printf '\\376Y' >&2",
  '  return "${STANDIN_RC:-0}"',
  "}",
].join("\n");
for (const shell of findShells()) {
  for (const rc of [0, 1, 2]) {
    test(`N1 R12.3 ${shell.name} rc ${rc} leaves stdout bytes and stderr bytes unchanged`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      const capture = join(w.root, "binary.capture");
      const stderrFile = join(w.cwd, "stderr.bin");
      try {
        const script = `${standin}\n${sourceLine(w.main)}\ngrep -rn WORD . 2>${JSON.stringify(stderrFile)}`;
        const result = await runShell(shell, script, {
          cwd: w.cwd, env: baseEnv(w, { STANDIN_RC: String(rc) }), outFile: capture,
        });
        expect(result.rc).toBe(rc);
        expect(readFileSync(capture)).toEqual(Buffer.concat([stdout, rc < 2 ? Buffer.from(block) : Buffer.alloc(0)]));
        expect(readFileSync(stderrFile)).toEqual(stderr);
        expect(server.requests).toHaveLength(1);
        expect(readFileSync(w.log, "utf8")).toMatch(new RegExp(`^\\d+ grep merge rc=${rc} block=${rc < 2 ? 1 : 0}\\n$`));
      } finally { await server.close(); w.cleanup(); }
    });
  }
}
