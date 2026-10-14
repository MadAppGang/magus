import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { lstat as lstatAsync } from "node:fs/promises";
import { join } from "node:path";
import { makeGrepPort, resolveOracleBin } from "./port";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmp(): string {
  const root = mkdtempSync("/tmp/cs-port-");
  roots.push(root);
  return root;
}

/** A native executable: a copy of a system binary, which starts with no `#!`. */
function native(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  copyFileSync("/bin/echo", path);
  chmodSync(path, 0o755);
  return path;
}

function script(path: string, body = "exit 0"): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("resolveOracleBin (D13)", () => {
  test("1: $HOME/.local/bin/claude, spawned as rg", () => {
    const home = tmp();
    const bin = native(join(home, ".local/bin/claude"));
    const pathDir = tmp();
    native(join(pathDir, "claude"));
    expect(resolveOracleBin({ HOME: home, PATH: pathDir })).toEqual({ bin: { path: bin, argv0: "rg" }, tried: [bin] });
  });

  test("the name rule passes on the realpath: a link into claude/versions/<v>", () => {
    const home = tmp();
    const target = native(join(home, ".local/share/claude/versions/9.9.9"));
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    const link = join(home, ".local/bin/claude");
    symlinkSync(target, link);
    expect(resolveOracleBin({ HOME: home, PATH: "" }).bin).toEqual({ path: link, argv0: "rg" });
  });

  test("2: the first claude on PATH when HOME is unset or its claude is a script", () => {
    const home = tmp();
    script(join(home, ".local/bin/claude"));
    const a = tmp();
    const b = tmp();
    const first = native(join(a, "claude"));
    native(join(b, "claude"));
    expect(resolveOracleBin({ HOME: home, PATH: `relative:${a}:${b}` }).bin).toEqual({ path: first, argv0: "rg" });
    const unset = resolveOracleBin({ PATH: a });
    expect(unset.bin).toEqual({ path: first, argv0: "rg" });
    expect(unset.tried[0]).toContain("HOME unset");
  });

  test("only the FIRST claude on PATH is a candidate; a script there falls through to rg", () => {
    const a = tmp();
    const b = tmp();
    script(join(a, "claude"));
    native(join(b, "claude"));
    const rgDir = tmp();
    const rg = native(join(rgDir, "rg"));
    expect(resolveOracleBin({ HOME: "", PATH: `${a}:${b}:${rgDir}` }).bin).toEqual({ path: rg });
  });

  test("3: the first non-#! rg on PATH, spawned plainly; scripts are skipped", () => {
    const a = tmp();
    const b = tmp();
    const shim = script(join(a, "rg"));
    const rg = native(join(b, "rg"));
    const found = resolveOracleBin({ HOME: "", PATH: `${a}:${b}` });
    expect(found.bin).toEqual({ path: rg });
    expect(found.tried).toEqual(["$HOME/.local/bin/claude (HOME unset)", "claude on PATH (none)", shim, rg]);
  });

  test("a claude not named claude fails the name rule; nothing found lists every candidate", () => {
    const a = tmp();
    native(join(a, "bun"));
    script(join(a, "rg"));
    const none = resolveOracleBin({ HOME: "", PATH: a });
    expect(none.bin).toBeUndefined();
    expect(none.tried).toEqual(["$HOME/.local/bin/claude (HOME unset)", "claude on PATH (none)", join(a, "rg")]);
  });
});

describe("walk", () => {
  test("argv is --no-config --files --null <args> -- <roots>, run from cwd", async () => {
    const dir = tmp();
    // Prints its own argv and cwd NUL-separated, as `rg --files --null` prints paths.
    const fake = script(join(dir, "fake-rg"), `printf '%s\\0' "$@" "$PWD"`);
    const port = makeGrepPort({ engineSearch: async () => ({ kind: "unsupported" }), root: dir });
    const result = await port.walk({
      bin: { path: fake },
      cwd: dir,
      args: ["--hidden", "--glob", "!.git"],
      roots: ["/abs/one", "-weird"],
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(result.paths).toEqual([
      "--no-config", "--files", "--null", "--hidden", "--glob", "!.git", "--", "/abs/one", "-weird", expect.stringContaining("cs-port-"),
    ]);
  });

  // Review round 1, internal L5: rg exits 2 when one directory is unreadable, and the
  // paths it did list were walked. Exit 2 with output is a walk; exit 2 with none is not.
  test("exit 2 with listed paths: done with those paths; exit 2 with none: failed", async () => {
    const dir = tmp();
    const port = makeGrepPort({ engineSearch: async () => ({ kind: "unsupported" }), root: dir });
    const run = (body: string) =>
      port.walk({ bin: { path: script(join(dir, `rg-${Math.random()}`), body) }, cwd: dir, args: [], roots: [], signal: new AbortController().signal });
    const partial = await run(`printf 'a.ts\\0sub/b.ts\\0'; echo "rg: ./locked: Permission denied" >&2; exit 2`);
    expect(partial).toMatchObject({ kind: "done", paths: ["a.ts", "sub/b.ts"] });
    expect(await run("exit 2")).toEqual({ kind: "failed" });
    expect(await run("printf 'a.ts\\0'; exit 3")).toEqual({ kind: "failed" });
  });
});

// Review round 6, Codex MEDIUM: after the read, `pinHolds` re-pins every directory and then
// the file. A directory lstat that stalled past the deadline was followed straight away by
// the file's lstat. No lstat may start once the request's signal has aborted.
describe("readCandidate under an aborted signal", () => {
  test("abort while the last directory's re-pin lstat is pending: no further lstat starts", async () => {
    const root = realpathSync(tmp());
    mkdirSync(join(root, "sub"));
    const file = join(root, "sub", "f.ts");
    writeFileSync(file, "const x = 1;\n");
    const calls: string[] = [];
    const controller = new AbortController();
    let release: () => void = () => undefined;
    // The real lstat, with every change time made old enough to pin. Calls 1-3 pin (root,
    // sub, file), call 4 is the after-read lstat, 5 and 6 re-pin root and sub: call 6 is
    // held until the signal has aborted.
    const lstatFn = (async (path: string, options?: { bigint?: boolean }) => {
      calls.push(path);
      const index = calls.length;
      const real = await lstatAsync(path, options as { bigint: true });
      const aged = Object.assign(Object.create(Object.getPrototypeOf(real)), real, { ctimeMs: 0n });
      if (index === 6) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return options?.bigint === true ? aged : real;
    }) as unknown as typeof lstatAsync;
    const port = makeGrepPort({ engineSearch: async () => ({ kind: "unsupported" }), root, fs: { lstat: lstatFn } });
    const read = port.readCandidate(file, 1_000_000, controller.signal);
    while (calls.length < 6) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    release();
    const result = await read;
    expect(result.kind).toBe("aborted");
    expect(calls).toEqual([root, join(root, "sub"), file, file, root, join(root, "sub")]);
  });
});
