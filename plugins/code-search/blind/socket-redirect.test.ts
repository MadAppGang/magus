import { expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseSocketDir, dirQualifies, sessionSocket, socketQualifies } from "../mcp/grep/socket";
import { grepMergeStepsAside, sandboxedCall } from "../hooks/redirect-search-to-facade";

const uid = process.getuid?.() ?? 0;
test("R12.5 P4 socket choice removes one trailing slash and keys caller pid", () => {
  const base = tmpdir();
  expect(chooseSocketDir({ TMPDIR: `${base}/` }, uid, 54321))
    .toEqual({ dir: join(base, `code-search-${uid}`), sock: join(base, `code-search-${uid}`, "54321.sock") });
  expect(chooseSocketDir({ TMPDIR: "relative" }, uid, 54321)).toBeUndefined();
});
test("R12.5 P4 socket path rejects a long TMPDIR then tries XDG_RUNTIME_DIR", () => {
  const base = tmpdir();
  const longBase = `/${"a".repeat(110)}`;
  expect(chooseSocketDir({ TMPDIR: longBase, XDG_RUNTIME_DIR: base }, uid, 42))
    .toEqual({ dir: join(base, `code-search-${uid}`), sock: join(base, `code-search-${uid}`, "42.sock") });
});
test("R12.5 P4 qualification predicates reject incorrect types, owners and modes", () => {
  const goodDir = { isDirectory: () => true, isSymbolicLink: () => false, uid, mode: 0o40700 };
  const goodSock = { isSocket: () => true, isSymbolicLink: () => false, uid };
  expect(dirQualifies(goodDir, uid)).toBe(true);
  expect(dirQualifies({ ...goodDir, mode: 0o40755 }, uid)).toBe(false);
  expect(dirQualifies({ ...goodDir, isSymbolicLink: () => true }, uid)).toBe(false);
  expect(dirQualifies({ ...goodDir, uid: uid + 1 }, uid)).toBe(false);
  expect(socketQualifies(goodSock, uid)).toBe(true);
  expect(socketQualifies({ ...goodSock, isSocket: () => false }, uid)).toBe(false);
  expect(socketQualifies({ ...goodSock, isSymbolicLink: () => true }, uid)).toBe(false);
  expect(socketQualifies({ ...goodSock, uid: uid + 1 }, uid)).toBe(false);
});
test("R12.5 P4 a real socket qualifies; mode, symlink and regular file do not", async () => {
  const base = mkdtempSync(join(tmpdir(), "csgm-sock-"));
  const dir = join(base, `code-search-${uid}`);
  const sock = join(dir, "54321.sock");
  const server = createServer();
  try {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(sock, resolve);
    });
    expect(sessionSocket({ TMPDIR: base }, uid, 54321)).toBe(sock);
    expect(sessionSocket({ TMPDIR: base }, uid, 54322)).toBeUndefined();
    for (const mode of [0o755, 0o750, 0o711]) {
      chmodSync(dir, mode);
      expect(sessionSocket({ TMPDIR: base }, uid, 54321)).toBeUndefined();
    }
    chmodSync(dir, 0o700);
    expect(sessionSocket({ TMPDIR: base }, uid, 54321)).toBe(sock);
    expect(socketQualifies(lstatSync(sock), uid)).toBe(true);
    const aliasBase = join(base, "alias");
    mkdirSync(aliasBase);
    symlinkSync(dir, join(aliasBase, `code-search-${uid}`));
    expect(sessionSocket({ TMPDIR: aliasBase }, uid, 54321)).toBeUndefined();
    symlinkSync(sock, join(dir, "54322.sock"));
    expect(sessionSocket({ TMPDIR: base }, uid, 54322)).toBeUndefined();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(sock, { force: true });
    writeFileSync(sock, "not a socket");
    expect(sessionSocket({ TMPDIR: base }, uid, 54321)).toBeUndefined();
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});

for (const command of ["grep", "grep -rn WORD .", "  grep WORD src"]) {
  test(`R12.10 D11 grep steps aside only on open gate and usable socket: ${command}`, () => {
    expect(grepMergeStepsAside(command, undefined, true)).toBe(true);
    expect(grepMergeStepsAside(command, "route-off", true)).toBe(false);
    expect(grepMergeStepsAside(command, undefined, false)).toBe(false);
  });
}
for (const command of ["rg WORD", "egrep WORD", "fgrep WORD", "grep-x WORD", "printf grep", "grep; echo hi"]) {
  test(`R12.10 D11 ${command} never steps aside`, () => {
    expect(grepMergeStepsAside(command, undefined, true)).toBe(false);
  });
}
test("R12.10 D11 sandbox uses last setting and exact escape flag", () => {
  const layers = [JSON.stringify({ sandbox: { enabled: true } }), JSON.stringify({ sandbox: { enabled: false } })];
  expect(sandboxedCall(layers, {})).toBe(false);
  expect(sandboxedCall(layers.slice(0, 1), {})).toBe(true);
  expect(sandboxedCall(layers.slice(0, 1), { dangerouslyDisableSandbox: true })).toBe(false);
  expect(sandboxedCall(layers.slice(0, 1), { dangerouslyDisableSandbox: "true" })).toBe(true);
  expect(sandboxedCall(["not JSON", "[]"], {})).toBe(false);
});
