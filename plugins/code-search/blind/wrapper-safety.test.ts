import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { blockText, baseEnv, findShells, frameOf, makeWorld, runShell, sourceLine, sq, startFakeServer, STANDIN, standinBytes } from "../test-support/grep-merge-harness";

const shells = findShells();
const block = blockText("WORD");
const standard = standinBytes(["-rn", "WORD", "."]);
let serial = 0;
async function run(shell: (typeof shells)[number], w: ReturnType<typeof makeWorld>, body: string, env: Record<string, string> = {}) {
  return runShell(shell, `${STANDIN}\n${body}`, {
    cwd: w.cwd, env: baseEnv(w, env), outFile: `${w.root}/safety-${++serial}.output`,
  });
}
const logs = (w: ReturnType<typeof makeWorld>) =>
  readFileSync(w.log, "utf8").trimEnd().split("\n").map((line) => line.replace(/^\d+ grep /, ""));

for (const shell of shells) {
  test(`N1 R12.3 ${shell.name} xtrace before sourcing leaves no wrapper`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `set -x\n${sourceLine(w.main)}\nset +x\ngrep -rn WORD .\nif typeset -f __cs_cc_grep >/dev/null 2>&1; then builtin printf 'WRAPPED\n'; fi`);
      expect(r.rc).toBe(0);
      expect(r.out.endsWith(standard)).toBe(true);
      expect(r.out.includes("WRAPPED")).toBe(false);
      expect(r.out.includes("grep-merge")).toBe(false);
      expect(server.requests).toHaveLength(0);
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} xtrace after sourcing passes through`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\nset -x\ngrep -rn WORD .\nset +x`);
      expect(r.rc).toBe(0);
      // R12.3: stdout is the stand-in's, and every stderr line that is not the stand-in's
      // starts with `+`. stdout and stderr share one file, so trace lines may sit between
      // the stand-in's stdout line and its stderr line; compare line sets, not a substring.
      const lines = r.out.split("\n").filter((l) => l !== "");
      const [outLine, errLine] = standard.split("\n");
      expect(lines.filter((l) => l === outLine)).toHaveLength(1);
      expect(lines.filter((l) => l === errLine)).toHaveLength(1);
      expect(lines.indexOf(outLine!)).toBeLessThan(lines.indexOf(errLine!));
      expect(lines.filter((l) => l !== outLine && l !== errLine && !l.startsWith("+"))).toEqual([]);
      expect(r.out.includes("--- code-search:")).toBe(false);
      expect(server.requests).toHaveLength(0);
      expect(logs(w)).toEqual(["pass:xtrace"]);
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} restricted shell never sources main`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const restricted = shell.kind === "zsh" ? "setopt RESTRICTED" : "set -r";
      const r = await run(shell, w, `${restricted}\n${sourceLine(w.main)}\ngrep -rn WORD .`);
      expect({ rc: r.rc, out: r.out, requests: server.requests.length, log: existsSync(w.log) })
        .toEqual({ rc: 0, out: standard, requests: 0, log: false });
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.14 ${shell.name} inherited curl pid matching caller job still logs bgjob`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const script = `command sleep 30 &\n__cs_gm_cpid=$!\n${sourceLine(w.main)}\ngrep -rn WORD .\nkill "$!"`;
      const r = await run(shell, w, script);
      expect({ out: r.out, rc: r.rc, requests: server.requests.length, logs: logs(w) })
        .toEqual({ out: standard, rc: 0, requests: 0, logs: ["pass:bgjob"] });
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} repeated sourcing defines one wrapper and one request`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\n${sourceLine(w.main)}\n${sourceLine(w.main)}\ngrep -rn WORD .`);
      expect({ rc: r.rc, out: r.out, requests: server.requests.length, logs: logs(w) })
        .toEqual({ rc: 0, out: standard + block, requests: 1, logs: ["merge rc=0 block=1"] });
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} request has exact argv and cwd, without a path operand`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\ngrep -rn WORD`);
      const fields = server.requests[0]?.toString("utf8").split("\0");
      expect(r.out).toBe(standinBytes(["-rn", "WORD"]) + block);
      expect(r.rc).toBe(0);
      expect(server.requests).toHaveLength(1);
      expect(fields).toEqual(["CSM1", "G", String(process.pid), expect.stringMatching(/^[1-9][0-9]*$/), w.cwd, "2", "-rn", "WORD", ""]);
      expect(logs(w)).toEqual(["merge rc=0 block=1"]);
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} Unicode block is preserved byte-for-byte under C locale`, async () => {
    const w = makeWorld();
    const unicode = blockText("WORD", "src/b.ts:7: π 漢字 😀");
    const server = await startFakeServer(w.sock, () => frameOf(unicode));
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\ngrep -rn WORD .`, { LC_ALL: "C" });
      expect(Buffer.from(r.out)).toEqual(Buffer.from(standard + unicode));
      expect(r.rc).toBe(0);
      expect(server.requests).toHaveLength(1);
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} missing body sources silently and delegates`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    const missing = `${w.body}.removed`;
    const { renameSync } = await import("node:fs");
    renameSync(w.body, missing);
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\ngrep -rn WORD .`);
      expect({ rc: r.rc, out: r.out, requests: server.requests.length, log: existsSync(w.log) })
        .toEqual({ rc: 0, out: standard, requests: 0, log: false });
    } finally { await server.close(); w.cleanup(); }
  });
  test(`N1 R12.3 ${shell.name} stale socket and no listener do not append`, async () => {
    const w = makeWorld();
    const server = await startFakeServer(w.sock, () => frameOf(block));
    await server.close();
    try {
      const r = await run(shell, w, `${sourceLine(w.main)}\ngrep -rn WORD .\ngrep -rn WORD .`);
      expect({ out: r.out, rc: r.rc, logs: logs(w) }).toEqual({
        out: standard.repeat(2), rc: 0, logs: ["pass:nosock", "pass:nosock"],
      });
    } finally { w.cleanup(); }
  });
  for (const glob of ["**.ts", "[]a]*", "[!]]*", "[^]]*"]) {
    test(`R12.4 P3 ${shell.name} classifier declines ${glob} like TS parser`, async () => {
      const w = makeWorld();
      try {
        const r = await run(shell, w, `${sourceLine(w.main)}\nif __cs_gm_classify -rn ${sq(`--include=${glob}`)} WORD src; then builtin printf 'accepted\n'; else builtin printf 'declined\n'; fi`);
        expect({ rc: r.rc, out: r.out }).toEqual({ rc: 0, out: "declined\n" });
      } finally { w.cleanup(); }
    });
  }
  for (const glob of ["[!t]*.ts", "[^t]*.ts", "[a]]x", "[a-c]*"]) {
    test(`R12.4 P3 ${shell.name} classifier accepts ${glob} like TS parser`, async () => {
      const w = makeWorld();
      try {
        const r = await run(shell, w, `${sourceLine(w.main)}\nif __cs_gm_classify -rn ${sq(`--include=${glob}`)} WORD src; then builtin printf 'accepted\n'; else builtin printf 'declined\n'; fi`);
        expect({ rc: r.rc, out: r.out }).toEqual({ rc: 0, out: "accepted\n" });
      } finally { w.cleanup(); }
    });
  }
}
