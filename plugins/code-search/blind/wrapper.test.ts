import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  STANDIN, baseEnv, blockText, findShells, frameOf, makeWorld,
  missingRequiredShells, runShell, sourceLine, sq, startFakeServer, standinBytes,
  type Shell, type World,
} from "../test-support/grep-merge-harness";

const shells = findShells();
test("R12.3 required shell families are available", () => {
  expect(missingRequiredShells(shells)).toEqual([]);
});

const argv = ["-rn", "WORD", "."];
const baseline = standinBytes(argv);
const block = blockText("WORD");
const command = "grep -rn WORD .";
const source = (w: World) => `${STANDIN}\n${sourceLine(w.main)}\n`;
const logLines = (w: World) => readFileSync(w.log, "utf8").trimEnd().split("\n").map((x) => x.replace(/^\d+ grep /, ""));
let serial = 0;
async function run(shell: Shell, w: World, script: string, env: Record<string, string> = {}, label = "run") {
  return runShell(shell, script, {
    cwd: w.cwd, env: baseEnv(w, env), outFile: `${w.root}/${label}-${++serial}.capture`,
  });
}

for (const shell of shells) {
  for (const rc of [0, 1, 2, 7]) {
    test(`N1 R12.3 ${shell.name} merge preserves grep bytes, stderr and rc ${rc}`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      try {
        const r = await run(shell, w, source(w) + command, { STANDIN_RC: String(rc) });
        expect({ rc: r.rc, out: r.out, requests: server.requests.length, logs: logLines(w) }).toEqual({
          rc, out: baseline + (rc < 2 ? block : ""), requests: 1,
          logs: [`merge rc=${rc} block=${rc < 2 ? 1 : 0}`],
        });
        expect(server.requests[0]!.toString("utf8").split("\0").slice(0, 2)).toEqual(["CSM1", "G"]);
      } finally { await server.close(); w.cleanup(); }
    });
  }

  for (const [label, env, reason] of [
    ["command switch", { CODE_SEARCH_MERGE: "0" }, "off"],
    ["unsupported argv", {}, "argv"],
    ["no socket", {}, "nosock"],
    ["GREP_OPTIONS", { GREP_OPTIONS: "-n" }, "grepopts"],
  ] as const) {
    test(`N1 R12.2 ${shell.name} ${label} delegates exactly once with ${reason}`, async () => {
      const w = makeWorld();
      const needSocket = reason !== "nosock";
      const server = needSocket ? await startFakeServer(w.sock, () => frameOf(block)) : undefined;
      try {
        const call = reason === "argv" ? "grep -c WORD ." : command;
        const expected = reason === "argv" ? standinBytes(["-c", "WORD", "."]) : baseline;
        const r = await run(shell, w, source(w) + call, { ...env, STANDIN_RC: "2" });
        expect({ out: r.out, rc: r.rc, requests: server?.requests.length ?? 0, logs: logLines(w) })
          .toEqual({ out: expected, rc: 2, requests: 0, logs: [`pass:${reason}`] });
      } finally { await server?.close(); w.cleanup(); }
    });
  }

  test(`N1 R12.3 ${shell.name} nounset and caller options still merge at rc 1`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    const opts = shell.kind === "zsh" ? "setopt NO_UNSET NOCLOBBER SH_WORD_SPLIT KSH_ARRAYS" : "set -uo pipefail";
    try {
      const r = await run(shell, w, `${STANDIN}\n${opts}\n${sourceLine(w.main)}\n${command}`, { STANDIN_RC: "1" });
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: baseline + block, rc: 1, requests: 1, logs: ["merge rc=1 block=1"] });
    } finally { await server.close(); w.cleanup(); }
  });

  for (const opt of shell.kind === "zsh" ? ["setopt ERR_EXIT", "setopt ERR_RETURN", "setopt ERR_EXIT ERR_RETURN"] : ["set -e", "set -euo pipefail"]) {
    test(`N1 R12.3 ${shell.name} ${opt} passes through and retains failure status`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      try {
        const r = await run(shell, w, `${STANDIN}\n${opt}\n${sourceLine(w.main)}\n${command}`, { STANDIN_RC: "1" });
        expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
          .toEqual({ out: baseline, rc: 1, requests: 0, logs: ["pass:errexit"] });
      } finally { await server.close(); w.cleanup(); }
    });
  }

  for (const [label, prefix, suffix, reason] of [
    // R12.2: the first failing test decides. A pipe element and `$( )` run one subshell
    // deeper (BASH_SUBSHELL / ZSH_SUBSHELL = 1, measured on bash 3.2 and zsh 5.9), so test 6
    // (`subshell`) fails before test 13 (`notfinal`). R12.3's grouping of these two shapes
    // under `notfinal` loses to the eligibility order.
    ["pipe", "", `${command} | cat`, "subshell"],
    ["redirect", "", `${command} > output`, "notfinal"],
    ["append", "", `${command} >> output`, "notfinal"],
    ["redirect stderr", "", `${command} > output 2>&1`, "notfinal"],
    ["null output", "", `${command} > /dev/null`, "notfinal"],
    ["subshell", "", `( ${command} )`, "subshell"],
    ["background", "", `${command} & wait $!`, "subshell"],
    ["substitution", "", `builtin printf '%s' "$(${command})"`, "subshell"],
  ] as const) {
    test(`N1 R12.3 ${shell.name} ${label} cannot append and logs ${reason}`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      try {
        const outputFile = `${w.cwd}/output`;
        const plain = await run(shell, w, `${STANDIN}\n${prefix}${suffix}`);
        const plainOutput = existsSync(outputFile) ? readFileSync(outputFile) : undefined;
        rmSync(outputFile, { force: true });
        const r = await run(shell, w, source(w) + prefix + suffix);
        const orderIndependent = (text: string) => text.split("\n").filter(Boolean).sort();
        expect({ rc: r.rc, out: label === "pipe" ? orderIndependent(r.out) : r.out,
          redirected: existsSync(outputFile) ? readFileSync(outputFile) : undefined,
          requests: server.requests.length, logs: logLines(w) })
          .toEqual({ rc: plain.rc, out: label === "pipe" ? orderIndependent(plain.out) : plain.out,
            redirected: plainOutput, requests: 0, logs: [`pass:${reason}`] });
        if (label === "pipe") expect(orderIndependent(r.out))
          .toEqual(["standin:3 <-rn> <WORD> <.>", "standin-stderr"].sort());
      } finally { await server.close(); w.cleanup(); }
    });
  }

  for (const [label, expr, expected] of [
    ["plain", command, baseline + block],
    ["stderr redirected", `${command} 2>/dev/null`, baseline.replace("standin-stderr\n", "") + block],
    ["stderr to stdout", `${command} 2>&1`, baseline + block],
    ["brace group", `{ ${command}; }`, baseline + block],
  ] as const) {
    test(`N1 R12.3 ${shell.name} final ${label} appends after grep`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      try {
        const r = await run(shell, w, source(w) + expr);
        expect({ rc: r.rc, out: r.out, requests: server.requests.length, logs: logLines(w) })
          .toEqual({ rc: 0, out: expected, requests: 1, logs: ["merge rc=0 block=1"] });
      } finally { await server.close(); w.cleanup(); }
    });
  }

  test(`N1 R12.3 ${shell.name} unset PWD under nounset passes through silently`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const opts = shell.kind === "zsh" ? "setopt NO_UNSET" : "set -u";
      const r = await run(shell, w, `${STANDIN}\n${opts}\n${sourceLine(w.main)}\nunset PWD\n${command}`);
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: baseline, rc: 0, requests: 0, logs: ["pass:nopwd"] });
    } finally { await server.close(); w.cleanup(); }
  });

  test(`N1 R12.3 ${shell.name} caller background job is not mistaken for curl`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const opts = shell.kind === "zsh" ? "setopt NO_UNSET" : "set -u";
      const r = await run(shell, w, `${STANDIN}\n${opts}\n${sourceLine(w.main)}\ncommand sleep 30 &\n${command}\nkill "$!"`);
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: baseline, rc: 0, requests: 0, logs: ["pass:bgjob"] });
    } finally { await server.close(); w.cleanup(); }
  });

  test(`N1 R12.3 ${shell.name} first merged curl does not block the second`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${source(w)}${command}\n${command}`);
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: (baseline + block).repeat(2), rc: 0, requests: 2,
          logs: ["merge rc=0 block=1", "merge rc=0 block=1"] });
    } finally { await server.close(); w.cleanup(); }
  });

  test(`N1 R12.3 ${shell.name} hung server costs one timeout per shell`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => "hang");
    try {
      const r = await run(shell, w, source(w) + Array(5).fill(command).join("\n"));
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: baseline.repeat(5), rc: 0, requests: 1,
          logs: ["merge rc=0 block=0", ...Array(4).fill("pass:slow")] });
      expect(r.ms).toBeLessThan(3500);
    } finally { await server.close(); w.cleanup(); }
  }, 10_000);

  for (const [name, reply] of [
    ["zero frame", "CSM1 0\n"],
    ["short frame", frameOf(block, Buffer.byteLength(block) - 1)],
    ["long frame", frameOf(block, Buffer.byteLength(block) + 1)],
    ["missing terminator", frameOf(block.replace("--- end code-search ---\n", ""))],
    ["missing final newline", frameOf(block.trimEnd())],
    ["oversize", frameOf(block, 16385)],
  ] as const) {
    test(`N1 R12.3 ${shell.name} ${name} never appends a block`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => reply);
      try {
        const r = await run(shell, w, source(w) + command);
        expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
          .toEqual({ out: baseline, rc: 0, requests: 1, logs: ["merge rc=0 block=0"] });
      } finally { await server.close(); w.cleanup(); }
    });
  }

  for (const variable of ["__cs_gm_slow", "__cs_gm_seq", "__cs_gm_ra"]) {
    test(`N1 R12.14 ${shell.name} inherited ${variable} does not disable merge`, async () => {
      const w = makeWorld();
      const server = await startFakeServer(w.sock, () => frameOf(block));
      const marker = `${w.root}/evaluated`;
      const value = variable === "__cs_gm_seq" ? `a[$(: >| ${sq(marker)})]` : "1";
      try {
        const r = await run(shell, w, source(w) + command, { [variable]: value });
        expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w), marker: existsSync(marker) })
          .toEqual({ out: baseline + block, rc: 0, requests: 1, logs: ["merge rc=0 block=1"], marker: false });
      } finally { await server.close(); w.cleanup(); }
    });
  }

  test(`N1 R12.14 ${shell.name} inherited done sentinel keeps grep untouched`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${source(w)}${command}`, { __cs_gm_done: "1" });
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logExists: existsSync(w.log) })
        .toEqual({ out: baseline, rc: 0, requests: 0, logExists: false });
    } finally { await server.close(); w.cleanup(); }
  });
}

for (const shell of shells.filter((s) => s.kind === "bash")) {
  test(`N1 R12.3 ${shell.name} job control passes through`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${STANDIN}\nset -m\n${sourceLine(w.main)}\n${command}`);
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logLines(w) })
        .toEqual({ out: baseline, rc: 0, requests: 0, logs: ["pass:jobctl"] });
    } finally { await server.close(); w.cleanup(); }
  });
}
