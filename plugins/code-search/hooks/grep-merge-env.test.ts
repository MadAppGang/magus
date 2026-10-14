/**
 * grep-merge-env.test.ts — the SessionStart hook that writes the guarded source line (P7).
 *
 * The process rows run the hook the way hooks.json does (`bun --env-file=/dev/null
 * --config=/dev/null <file>`), from a COPY of the plugin tree, so the asset path it
 * writes is known and a path holding a quote can be tried.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../test-support/grep-merge-harness";
import { envLineBytes, holdsSourceLine, shelloptsRefuse, sourceLineOf } from "./grep-merge-env";

const PLUGIN = join(import.meta.dir, "..");

describe("envLineBytes", () => {
  // Review round 2, Codex CRITICAL: the line sources nothing while `$-` holds `v`
  // (verbose would echo both assets) or `x` (xtrace would trace their definitions).
  // Review round 4, Codex CRITICAL: `[[ -r … ]]` and `builtin .`, so a caller's function
  // named `[` or `.` cannot abort the call here.
  test("an absolute path gives the exact bytes, guarded on verbose and xtrace", () => {
    expect(envLineBytes("/a/b/assets/grep-merge.sh")).toBe(
      "\ncase $- in *[vxr]*) ;; *) if [[ -r '/a/b/assets/grep-merge.sh' && ! -o sourcetrace ]]; then builtin . '/a/b/assets/grep-merge.sh'; fi ;; esac; :\n",
    );
  });

  test("spaces and `$` stay verbatim inside the single quotes", () => {
    expect(envLineBytes("/a b/$x/grep-merge.sh")).toBe(
      "\ncase $- in *[vxr]*) ;; *) if [[ -r '/a b/$x/grep-merge.sh' && ! -o sourcetrace ]]; then builtin . '/a b/$x/grep-merge.sh'; fi ;; esac; :\n",
    );
  });

  test("shelloptsRefuse: an exported verbose or xtrace, and nothing else", () => {
    expect(shelloptsRefuse("braceexpand:hashall:interactive-comments:verbose")).toBe(true);
    expect(shelloptsRefuse("xtrace:braceexpand")).toBe(true);
    expect(shelloptsRefuse("braceexpand:hashall:interactive-comments")).toBe(false);
    expect(shelloptsRefuse("braceexpand:verbosely")).toBe(false);
    expect(shelloptsRefuse(undefined)).toBe(false);
    expect(shelloptsRefuse("")).toBe(false);
  });

  test.each(["/a'b/grep-merge.sh", "/a\nb/grep-merge.sh", "/a\tb/grep-merge.sh", "/a\u007fb/grep-merge.sh", "/a\u0000b/x", "rel/grep-merge.sh", ""])(
    "%j cannot be written: undefined",
    (p) => {
      expect(envLineBytes(p)).toBeUndefined();
    },
  );

  test("the source line is the middle line, and is found only on a line of its own", () => {
    const line = sourceLineOf("/p/grep-merge.sh") ?? "";
    expect(line).toBe("case $- in *[vxr]*) ;; *) if [[ -r '/p/grep-merge.sh' && ! -o sourcetrace ]]; then builtin . '/p/grep-merge.sh'; fi ;; esac; :");
    expect(holdsSourceLine(`export A=1\n${line}\n:\n`, line)).toBe(true);
    expect(holdsSourceLine(`# ${line}\n`, line)).toBe(false);
    expect(holdsSourceLine(`${line} # x\n`, line)).toBe(false);
  });
});

describe("hook process", () => {
  let root: string;
  let plugin: string;
  let home: string;
  let project: string;
  let envFile: string;
  let line: string;

  const ENGINE = { engine: "mnemex", engines: { mnemex: { command: "true" } } };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "csgm-env-")));
    plugin = join(root, "plugin");
    for (const dir of ["hooks", "mcp", "assets"]) cpSync(join(PLUGIN, dir), join(plugin, dir), { recursive: true });
    home = join(root, "home");
    project = join(root, "project");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ "code-search": ENGINE }));
    envFile = join(root, "session-env", "sessionstart-hook-3.sh");
    mkdirSync(join(root, "session-env"));
    line = envLineBytes(join(plugin, "assets", "grep-merge.sh")) ?? "";
    expect(line).not.toBe("");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function hook(env: Record<string, string | undefined> = {}, from = plugin): Promise<{ rc: number; stdout: string; stderr: string }> {
    const base: Record<string, string> = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, CLAUDE_PROJECT_DIR: project, CLAUDE_ENV_FILE: envFile };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete base[k];
      else base[k] = v;
    }
    const r = await capture(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", join(from, "hooks", "grep-merge-env.ts")], {
      cwd: project,
      env: base,
    });
    return { rc: r.rc, stdout: r.stdout, stderr: r.stderr };
  }

  /** Long enough that a rewrite would change the file's mtime. */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 15));

  test("gate open, env file absent: created 0600 holding exactly the line bytes", async () => {
    expect(await hook()).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(readFileSync(envFile, "utf8")).toBe(line);
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
  });

  test("an unterminated foreign line, mode 0644: appended after it, mode kept", async () => {
    writeFileSync(envFile, "export FOO=1", { mode: 0o644 });
    expect(await hook()).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(readFileSync(envFile, "utf8")).toBe(`export FOO=1${line}`);
    expect(statSync(envFile).mode & 0o777).toBe(0o644);
  });

  test("the line already present, before or after foreign bytes: bytes and mtime unchanged", async () => {
    for (const text of [`${line}export FOO=1\n`, `export FOO=1\n${line}`]) {
      writeFileSync(envFile, text);
      const before = statSync(envFile).mtimeMs;
      await tick();
      expect(await hook()).toEqual({ rc: 0, stdout: "", stderr: "" });
      expect(readFileSync(envFile, "utf8")).toBe(text);
      expect(statSync(envFile).mtimeMs).toBe(before);
    }
  });

  test("another asset path's line, or ours behind `# `: the line is appended", async () => {
    const other = envLineBytes("/elsewhere/assets/grep-merge.sh") ?? "";
    for (const text of [other, `# ${line.trim()}\n`]) {
      writeFileSync(envFile, text);
      await hook();
      expect(readFileSync(envFile, "utf8")).toBe(`${text}${line}`);
    }
  });

  test("two runs from an absent file: the line exactly once", async () => {
    await hook();
    await hook();
    expect(readFileSync(envFile, "utf8")).toBe(line);
  });

  test.each([
    ["grep.route false", { "code-search": { ...ENGINE, grep: { route: false } } }, {}],
    ["CODE_SEARCH_MERGE=0 in the environment", { "code-search": ENGINE }, { CODE_SEARCH_MERGE: "0" }],
    ["CODE_SEARCH_MERGE \"0\" in settings env", { "code-search": ENGINE, env: { CODE_SEARCH_MERGE: "0" } }, {}],
    ["no engine", { "code-search": {} }, {}],
    ["an engine id with no engines entry", { "code-search": { engine: "fake" } }, {}],
    // Review round 5, Codex CRITICAL: an entry for an id with no shipped adapter.
    ["an engine id this plugin does not ship", { "code-search": { engine: "fake", engines: { fake: { command: "true" } } } }, {}],
  ] as const)("gate closed (%s): nothing written", async (_name, settings, env) => {
    writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify(settings));
    writeFileSync(envFile, "export FOO=1\n");
    const before = statSync(envFile).mtimeMs;
    await tick();
    expect(await hook(env)).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(readFileSync(envFile, "utf8")).toBe("export FOO=1\n");
    expect(statSync(envFile).mtimeMs).toBe(before);
  });

  test("every layer counts: route false in settings.local.json closes the gate", async () => {
    writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify({ "code-search": { grep: { route: false } } }));
    await hook();
    expect(existsSync(envFile)).toBe(false);
  });

  test("CLAUDE_ENV_FILE unset or empty: nothing created", async () => {
    expect(await hook({ CLAUDE_ENV_FILE: undefined })).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(await hook({ CLAUDE_ENV_FILE: "" })).toEqual({ rc: 0, stdout: "", stderr: "" });
    expect(existsSync(envFile)).toBe(false);
  });

  // Review round 3, Codex HIGH: every failure is silent (exit 0, empty stdout AND stderr).
  // The reason goes only to the CODE_SEARCH_MERGE_LOG file, when one is set.
  const silent = { rc: 0, stdout: "", stderr: "" };
  const logOf = (): string => (existsSync(join(root, "merge.log")) ? readFileSync(join(root, "merge.log"), "utf8") : "");

  const cases: [string, (r: string) => string, string][] = [
    ["a directory", (r: string): string => join(r, "session-env"), "EISDIR"],
    ["the root directory", (): string => "/", ""],
    ["a path under a missing directory", (r: string): string => join(r, "no", "such", "env.sh"), "ENOENT"],
  ];
  test.each(cases)("CLAUDE_ENV_FILE names %s: silent; the reason only in the merge log", async (_name, path, code) => {
    const target = path(root);
    expect(await hook({ CLAUDE_ENV_FILE: target })).toEqual(silent);
    expect(await hook({ CLAUDE_ENV_FILE: target, CODE_SEARCH_MERGE_LOG: join(root, "merge.log") })).toEqual(silent);
    expect(logOf()).toContain(`grep-merge-env: cannot append to ${target}`);
    if (code !== "") expect(logOf()).toContain(code);
  });

  test("an env file in a directory without write permission: silent", async () => {
    const locked = join(root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      expect(await hook({ CLAUDE_ENV_FILE: join(locked, "env.sh"), CODE_SEARCH_MERGE_LOG: join(root, "merge.log") })).toEqual(silent);
      expect(logOf()).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  test("a plugin path holding a quote: silent, nothing written", async () => {
    const quoted = join(root, "it's");
    mkdirSync(quoted);
    for (const dir of ["hooks", "mcp", "assets"]) cpSync(join(plugin, dir), join(quoted, dir), { recursive: true });
    expect(await hook({ CODE_SEARCH_MERGE_LOG: join(root, "merge.log") }, quoted)).toEqual(silent);
    expect(existsSync(envFile)).toBe(false);
    expect(logOf()).toContain("grep-merge-env: plugin path contains a quote or control character");
  });

  test("a module the hook imports missing (an uncaught failure): silent", async () => {
    rmSync(join(plugin, "mcp", "grep", "gate.ts"));
    expect(await hook({ CODE_SEARCH_MERGE_LOG: join(root, "merge.log") })).toEqual(silent);
    expect(existsSync(envFile)).toBe(false);
    expect(logOf()).toContain("grep-merge-env:");
  });
});
