import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goplsId, guardBasenameBytes, socketDirProblem, type Env } from "../src/adapters.ts";
import { bunVersionSupported, idleMsFrom, plan } from "../src/plan.ts";
import { worktreeRoot } from "../src/worktree.ts";

function tree(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "lp-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function executable(path: string, body = "fake binary") {
  writeFileSync(path, body, { mode: 0o700 });
  return path;
}

test("REQ-1 manifest registers both servers, all extensions and only Bun as a dependency", async () => {
  const manifest = await Bun.file(join(import.meta.dir, "../.claude-plugin/plugin.json")).json();
  const launch = "${CLAUDE_PLUGIN_ROOT}/bin/launch.sh";
  expect(manifest.lspServers).toEqual({
    gopls: { command: "sh", args: [launch, "gopls"], extensionToLanguage: { ".go": "go" } },
    typescript: {
      command: "sh", args: [launch, "typescript-language-server", "--stdio"],
      extensionToLanguage: {
        ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript",
        ".jsx": "javascriptreact", ".mts": "typescript", ".cts": "typescript",
        ".mjs": "javascript", ".cjs": "javascript",
      },
    },
  });
  expect(manifest.requires.bin.map(({ name }: { name: string }) => name)).toEqual(["bun"]);
});

test("REQ-3 REQ-8 idle config accepts decimals and written zero, otherwise defaults with a note", () => {
  expect(idleMsFrom(undefined)).toEqual({ idleMs: 600_000, note: null });
  for (const raw of ["0", "0.0", ".0"]) expect(idleMsFrom(raw)).toEqual({ idleMs: 0, note: null });
  expect(idleMsFrom(".25")).toEqual({ idleMs: 15_000, note: null });
  expect(idleMsFrom("35791.3941")).toEqual({ idleMs: 2_147_483_646, note: null });
  for (const raw of ["", "-1", "1e1", "Infinity", "garbage", ".00001", "35791.39412", "." + "0".repeat(330) + "1"]) {
    expect(idleMsFrom(raw).idleMs).toBe(600_000);
    expect(idleMsFrom(raw).note).toEqual(expect.any(String));
    expect(idleMsFrom(raw).note!.length).toBeGreaterThan(0);
  }
});

test("REQ-8 old-bun-fails-check, and 1.4.0 including its prerelease passes the version rule", () => {
  for (const v of ["1.3.99", "0.9.0"]) expect(bunVersionSupported(v)).toBe(false);
  for (const v of ["1.4.0", "1.4.0-canary.1", "1.10.0", "2.0.0"]) expect(bunVersionSupported(v)).toBe(true);
});

test("REQ-6 worktree root is the nearest .git entry and uses the real path", () => tree(root => {
  const outer = join(root, "outer");
  const work = join(outer, "linked worktree");
  const nested = join(work, "pkg");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(outer, ".git"));
  writeFileSync(join(work, ".git"), "gitdir: unused\n");
  const alias = join(root, "alias");
  symlinkSync(work, alias);
  expect(worktreeRoot(nested)).toBe(realpathSync(work));
  expect(worktreeRoot(alias)).toBe(realpathSync(work));
  expect(worktreeRoot(root)).toBe(realpathSync(root));
}));

const fingerprint = [
  "GOWORK", "GOPACKAGESDRIVER", "GOROOT", "GOTOOLCHAIN", "GOFLAGS", "HOME",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "MISE_GO_VERSION", "ASDF_GOLANG_VERSION", "GOENV_VERSION",
];
test.each(fingerprint)("REQ-6 id-separates for %s, including empty versus unset", name => tree(root => {
  const env = { PATH: root };
  const id = goplsId(root, env);
  const empty = goplsId(root, { ...env, [name]: "" });
  const value = goplsId(root, { ...env, [name]: "different" });
  expect(new Set([id, empty, value]).size).toBe(3);
}));

test("REQ-6 id-separates by root and real tool paths, not aliases or unrelated variables", () => tree(root => {
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  const env = { PATH: a };
  const absent = goplsId(root, env);
  expect(absent).toBe(createHash("sha256").update([root, "", "", ...fingerprint].join("\0")).digest("hex").slice(0, 10));
  expect(goplsId(a, env)).not.toBe(absent);
  expect(goplsId(root, { ...env, UNRELATED: "change", USER: "other", TMPDIR: b, XDG_RUNTIME_DIR: b })).toBe(absent);
  for (const tool of ["go", "gopackagesdriver"]) {
    const path = executable(join(a, tool));
    const id = goplsId(root, env);
    expect(id).not.toBe(absent);
    symlinkSync(path, join(b, tool));
    expect(goplsId(root, { PATH: b })).toBe(id);
    rmSync(join(b, tool));
    executable(join(b, tool));
    expect(goplsId(root, { PATH: b })).not.toBe(id);
    rmSync(path);
    rmSync(join(b, tool));
  }
}));

test("REQ-6 guard-uses-longer-basename and guard-script-floor-16", () => tree(root => {
  const long = "goplsxxxxxxxxxxxxxxxx";
  const target = executable(join(root, long));
  const alias = join(root, "g");
  symlinkSync(target, alias);
  expect(guardBasenameBytes(alias)).toBe(Buffer.byteLength(long));
  expect(guardBasenameBytes(executable(join(root, "shim"), "#!/bin/sh\n"))).toBe(16);
}));

test.each([["darwin", 103], ["linux", 107]] as const)(
  "REQ-6 %s socket guard shares at %i bytes and refuses the next byte", (platform, max) => tree(root => {
    const bin = executable(join(root, "gopls"));
    const env = { PATH: root, XDG_RUNTIME_DIR: root };
    const fixed = Buffer.byteLength(join(root, "gopls-******-daemon.-0123456789"));
    const user = "u".repeat(max - fixed - 2) + "é";
    const good = plan(["gopls"], { ...env, USER: user }, root, platform);
    expect(good.shared?.id).toMatch(/^[0-9a-f]{10}$/);
    expect(Buffer.byteLength(good.shared!.socketPath)).toBe(max);
    expect(good.argv).toEqual([bin, "-remote=auto;" + good.shared!.id, "-remote.listen.timeout=1m"]);
    const bad = plan(["gopls"], { ...env, USER: user + "u" }, root, platform);
    expect(bad.shared).toBeNull();
    expect(bad.argv).toEqual([bin]);
    expect(bad.notes.length).toBeGreaterThan(0);
  }),
);

test("REQ-6 tmpdir-changes-socket-not-id and guard-other-platform-skips", () => tree(root => {
  executable(join(root, "gopls"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a, { mode: 0o700 });
  mkdirSync(b, { mode: 0o700 });
  const make = (TMPDIR: string, platform = "darwin") => plan(["gopls"], { PATH: root, TMPDIR, USER: "u" }, root, platform);
  const first = make(a).shared!;
  const second = make(b).shared!;
  expect(first.id).toBe(second.id);
  expect(first.socketPath).toBe(join(a, "gopls-******-daemon.u-" + first.id));
  expect(second.socketPath).toBe(join(b, "gopls-******-daemon.u-" + first.id));
  expect(make(a, "freebsd").shared).toBeNull();
  expect(make(a, "freebsd").notes.length).toBeGreaterThan(0);
}));

test("REQ-6 owner-only guard refuses missing, public, file and symlink socket directories", () => tree(root => {
  executable(join(root, "gopls"));
  const safe = join(root, "safe");
  const pub = join(root, "pub");
  const alias = join(root, "alias");
  const file = join(root, "file");
  mkdirSync(safe, { mode: 0o700 });
  mkdirSync(pub);
  chmodSync(pub, 0o710);
  symlinkSync(safe, alias);
  writeFileSync(file, "");
  const make = (XDG_RUNTIME_DIR: string, USER = "u") =>
    plan(["gopls"], { PATH: root, TMPDIR: safe, XDG_RUNTIME_DIR, USER }, root, "darwin");
  expect(make(safe).shared).not.toBeNull();
  const uid = process.getuid!();
  expect(socketDirProblem(safe, uid)).toBeNull();
  expect(socketDirProblem(safe, uid + 1)).toEqual(expect.any(String));
  for (const dir of [join(root, "missing"), pub, file, alias, alias + "/"]) {
    const p = make(dir);
    expect(p.shared).toBeNull();
    expect(p.notes.join(" ")).toContain(dir.replace(/\/$/, ""));
  }
  expect(make(safe, "nested/user").shared).toBeNull();
}));

test("REQ-6 guard refuses a cleaned socket parent that resolves somewhere else", () => tree(root => {
  executable(join(root, "gopls"));
  for (const dir of ["a", "b", "b/nested", "a/safe", "b/safe"]) {
    mkdirSync(join(root, dir), { mode: 0o700 });
  }
  symlinkSync(join(root, "b/nested"), join(root, "a/link"));
  const env: Env = { PATH: root, USER: "u", XDG_RUNTIME_DIR: root + "/a/link/../safe" };
  expect(plan(["gopls"], env, root, "darwin").shared).toBeNull();
}));

test("REQ-6 REQ-7 configured gopls args and non-Go commands are plain but still idle", () => tree(root => {
  const go = executable(join(root, "gopls"));
  const ts = executable(join(root, "typescript-language-server"));
  const env = { PATH: root, XDG_RUNTIME_DIR: root, MAGUS_LSP_IDLE_MINUTES: ".25" };
  for (const [name, binary, arg] of [["gopls", go, "-rpc.trace"], ["typescript-language-server", ts, "--stdio"]]) {
    const p = plan([name, arg], env, root, "darwin");
    expect(p.argv).toEqual([binary, arg]);
    expect(p.plainArgv).toEqual(p.argv);
    expect(p.shared).toBeNull();
    expect(p.idleMs).toBe(15_000);
  }
  expect(() => plan(["missing-server"], env, root, "darwin")).toThrow(/missing-server.*not found on PATH/);
}));
