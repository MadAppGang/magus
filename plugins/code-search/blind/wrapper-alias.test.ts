import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { baseEnv, blockText, findShells, frameOf, makeWorld, runShell, sourceLine, sq, startFakeServer, STANDIN, standinBytes } from "../test-support/grep-merge-harness";

for (const shell of findShells()) {
  test(`N1 R12.3 ${shell.name} live aliases survive two sourcings and merge once`, async () => {
    const w = makeWorld();
    const block = blockText("WORD");
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const aliases = shell.kind === "bash" ? "shopt -s expand_aliases" : "setopt aliases";
      const options = shell.kind === "bash" ? "shopt -q expand_aliases" : "[[ -o aliases ]]";
      const rest = [
        sourceLine(w.main), sourceLine(w.main),
        "grep -rn WORD .",
        `if ${options}; then builtin printf 'ALIASES-ON\\n'; else builtin printf 'ALIASES-OFF\\n'; fi`,
      ].join("\n");
      // zsh parses a whole `-c` string before running any of it, so an alias defined in the
      // same string never applies to later lines (measured, zsh 5.9). Claude Code defines
      // aliases in the sourced snapshot and runs the command through `eval`; do the same
      // so the aliases are live when the line and the grep are parsed.
      const script = [
        STANDIN, aliases,
        "alias grep='grep --color=auto' rm='rm -i' curl='curl -v' printf='printf X' unset='echo ALIASED-UNSET'",
        shell.kind === "zsh" ? `eval ${sq(rest)}` : rest,
      ].join("\n");
      const r = await runShell(shell, script, { cwd: w.cwd, env: baseEnv(w), outFile: `${w.root}/alias.capture` });
      expect({ rc: r.rc, out: r.out, requests: server.requests.length })
        .toEqual({ rc: 0, out: standinBytes(["--color=auto", "-rn", "WORD", "."]) + block + "ALIASES-ON\n", requests: 1 });
      expect(readFileSync(w.log, "utf8")).toMatch(/^\d+ grep merge rc=0 block=1\n$/);
    } finally { await server.close(); w.cleanup(); }
  });
}
