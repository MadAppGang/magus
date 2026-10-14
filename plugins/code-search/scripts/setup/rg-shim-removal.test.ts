import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  headHasOwnerLine,
  RG_SHIM_COMMAND,
  RG_SHIM_FINDING,
  RG_SHIM_HEAD_BYTES,
  RIPGREP_ENV_WITHOUT_SHIM,
} from "./rg-shim-removal";
import { GREP_ROUTE_SUMMARY } from "./status";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..");
const SETUP = join(PLUGIN_ROOT, "scripts", "setup.ts");

const OURS = "#!/bin/bash\n# rg — ripgrep shim for Claude Code's Grep tool.\n#\n# OWNER=code-search\n# VERSION=8.1.0\nexec true\n";
const MNEMEX = "#!/bin/sh\n# OWNER=mnemex\nexit 0\n";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Site {
  home: string;
  project: string;
  empty: string;
  shim: string;
  user: string;
  env: Record<string, string>;
}

function site(): Site {
  const root = mkdtempSync(join(tmpdir(), "cs-rg-shim-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  const empty = join(root, "empty-bin");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  mkdirSync(empty);
  return {
    home, project, empty,
    shim: join(home, ".local", "bin", "rg"),
    user: join(home, ".claude", "settings.json"),
    // No inherited HOME, PATH, CODE_SEARCH_MERGE or env file.
    env: { HOME: home, PATH: empty, CLAUDE_PROJECT_DIR: project },
  };
}

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cli(s: Site, args: string[], json = true): { exitCode: number | null; stdout: string; out: Record<string, any> } {
  const result = spawnSync(
    process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", SETUP, ...args, ...(json ? ["--json"] : []), "--project", s.project],
    { cwd: s.project, env: s.env, encoding: "utf8", timeout: 15_000 },
  );
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  return { exitCode: result.status, stdout, out: json ? (JSON.parse(stdout) as Record<string, any>) : {} };
}

function configuredEngine(s: Site, extra: object = {}): void {
  writeJson(join(s.project, ".claude", "settings.json"), {
    "code-search": { engine: "codegraph", setup: "active", engines: { codegraph: { command: "codegraph", args: [] } }, ...extra },
  });
}

describe("headHasOwnerLine", () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  test("the exact marker line, LF or CRLF, is ours", () => {
    expect(headHasOwnerLine(bytes(OURS))).toBe(true);
    expect(headHasOwnerLine(bytes("#!/bin/bash\r\n# OWNER=code-search\r\n"))).toBe(true);
    expect(headHasOwnerLine(bytes("# OWNER=code-search"))).toBe(true); // whole file, no newline
  });

  test("another owner, extra text on the line, or a marker past 512 bytes is not", () => {
    expect(headHasOwnerLine(bytes(MNEMEX))).toBe(false);
    expect(headHasOwnerLine(bytes("# OWNER=code-search VERSION=6.0.0\n"))).toBe(false);
    expect(headHasOwnerLine(bytes(`${"#".repeat(RG_SHIM_HEAD_BYTES)}\n# OWNER=code-search\n`))).toBe(false);
  });

  test("a longer owner cut at byte 512 does not read as ours", () => {
    const prefix = "#".repeat(RG_SHIM_HEAD_BYTES - "# OWNER=code-search".length - 1);
    const text = `${prefix}\n# OWNER=code-search-fork\n`;
    expect(headHasOwnerLine(bytes(text))).toBe(false);
  });
});

describe("status reports the 8.1 shim and USE_BUILTIN_RIPGREP", () => {
  test("a marked shim is reported, with the remove verb, and nothing changes", () => {
    const s = site();
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    const { exitCode, out } = cli(s, ["status"]);
    expect(exitCode).toBe(0);
    expect(out.data.grepRoute.rgShim).toBe(RG_SHIM_FINDING);
    expect(out.data.grepRoute.ripgrepEnv).toBeUndefined();
    expect(out.details).toContain(`${RG_SHIM_FINDING}; remove it with: ${RG_SHIM_COMMAND}`);
    expect(readFileSync(s.shim, "utf8")).toBe(OURS);
  });

  test('user env "0" with no marked shim gets the P9 line; a foreign rg does not count as ours', () => {
    const s = site();
    writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0" } });
    writeFileSync(s.shim, MNEMEX, { mode: 0o755 });
    const before = readFileSync(s.user, "utf8");
    const { out } = cli(s, ["status"]);
    expect(out.data.grepRoute.ripgrepEnv).toBe(RIPGREP_ENV_WITHOUT_SHIM);
    expect(out.data.grepRoute.rgShim).toBeUndefined();
    expect(out.details).toContain(RIPGREP_ENV_WITHOUT_SHIM);
    expect(readFileSync(s.user, "utf8")).toBe(before);
  });

  test('user env "0" next to a marked shim is the shim finding, not the P9 line', () => {
    const s = site();
    writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0" } });
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    const { out } = cli(s, ["status"]);
    expect(out.data.grepRoute.rgShim).toBe(RG_SHIM_FINDING);
    expect(out.data.grepRoute.ripgrepEnv).toBeUndefined();
  });
});

describe("status: the Bash grep route summary (P9)", () => {
  test("an engine configured: the rendered report carries the sandbox limit and the disclosure", () => {
    const s = site();
    configuredEngine(s);
    const { exitCode, stdout } = cli(s, ["status"], false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(GREP_ROUTE_SUMMARY);
    expect(stdout).toContain(
      "It does not run inside Claude Code's Bash sandbox. The block may name files that a Read deny rule hides from the Grep tool.",
    );
  });

  test("no oracle binary reachable: `oracle unavailable` names what was tried", () => {
    const s = site();
    configuredEngine(s);
    const { out } = cli(s, ["status"]);
    expect(out.data.grepRoute.gate).toBe("open");
    expect(out.data.grepRoute.oracleUnavailable).toStartWith("oracle unavailable: ");
    expect(out.data.grepRoute.oracleUnavailable).toContain(join(s.home, ".local", "bin", "claude"));
  });

  test("grep.route false, CODE_SEARCH_MERGE \"0\" or no engine: no summary line", () => {
    const off = site();
    configuredEngine(off, { grep: { route: false } });
    expect(cli(off, ["status"]).out.data.grepRoute).toMatchObject({ gate: "route-off" });
    expect(cli(off, ["status"]).out.data.grepRoute.summary).toBeUndefined();

    const killed = site();
    configuredEngine(killed);
    writeJson(killed.user, { env: { CODE_SEARCH_MERGE: "0" } });
    expect(cli(killed, ["status"]).out.data.grepRoute.gate).toBe("kill-switch");

    const none = site();
    const result = cli(none, ["status"]);
    expect(result.out.data.grepRoute.gate).toBe("no-engine");
    expect(result.out.details.join("\n")).not.toContain("Read deny rule");
  });

  // Review round 1, internal M3 / kimi-k3 LOW: an engine id with no `engines` entry never
  // binds a server, so status must not say the route is on.
  test("an engine id with no engines entry: no-engine, no summary line", () => {
    const typo = site();
    writeJson(join(typo.project, ".claude", "settings.json"), { "code-search": { engine: "typo", setup: "active" } });
    const result = cli(typo, ["status"]);
    expect(result.out.data.grepRoute.gate).toBe("no-engine");
    expect(result.out.data.grepRoute.summary).toBeUndefined();
  });
});

describe("remove-rg-shim", () => {
  test("--dry-run lists both changes and changes nothing", () => {
    const s = site();
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0" }, theme: "dark" });
    const before = readFileSync(s.user, "utf8");
    const { exitCode, out } = cli(s, [RG_SHIM_COMMAND, "--dry-run"]);
    expect(exitCode).toBe(0);
    expect(out.dryRun).toBe(true);
    expect(out.actions).toEqual([`delete ${s.shim}`, `${s.user}: delete env.USE_BUILTIN_RIPGREP`]);
    expect(readFileSync(s.shim, "utf8")).toBe(OURS);
    expect(readFileSync(s.user, "utf8")).toBe(before);
  });

  test('deletes the marked shim, then env "0", keeping every other setting', () => {
    const s = site();
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0", FOO: "1" }, theme: "dark" });
    const { exitCode, out } = cli(s, [RG_SHIM_COMMAND]);
    expect(exitCode).toBe(0);
    expect(out.command).toBe(RG_SHIM_COMMAND);
    expect(out.summary).toContain("restart sessions that use the Grep tool");
    expect(out.data).toMatchObject({ removed: true, envDeleted: true });
    expect(existsSync(s.shim)).toBe(false);
    expect(JSON.parse(readFileSync(s.user, "utf8"))).toEqual({ env: { FOO: "1" }, theme: "dark" });
  });

  test("an env left empty is dropped; a value other than exactly \"0\" is kept", () => {
    const emptied = site();
    writeFileSync(emptied.shim, OURS, { mode: 0o755 });
    writeJson(emptied.user, { env: { USE_BUILTIN_RIPGREP: "0" } });
    expect(cli(emptied, [RG_SHIM_COMMAND]).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(emptied.user, "utf8"))).toEqual({});

    const deliberate = site();
    writeFileSync(deliberate.shim, OURS, { mode: 0o755 });
    writeJson(deliberate.user, { env: { USE_BUILTIN_RIPGREP: "false" } });
    const before = readFileSync(deliberate.user, "utf8");
    const { out } = cli(deliberate, [RG_SHIM_COMMAND]);
    expect(out.data).toMatchObject({ removed: true, envDeleted: false });
    expect(existsSync(deliberate.shim)).toBe(false);
    expect(readFileSync(deliberate.user, "utf8")).toBe(before);
  });

  test('no shim: exit 0, nothing removed, and env "0" is NOT deleted', () => {
    const s = site();
    writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0" } });
    const before = readFileSync(s.user, "utf8");
    const { exitCode, out } = cli(s, [RG_SHIM_COMMAND]);
    expect(exitCode).toBe(0);
    expect(out.data).toMatchObject({ removed: false, envDeleted: false });
    expect(out.details).toContain(RIPGREP_ENV_WITHOUT_SHIM);
    expect(readFileSync(s.user, "utf8")).toBe(before);
  });

  test("refuses another owner, a symlink and an unmarked binary, changing nothing", () => {
    for (const make of [
      (s: Site) => writeFileSync(s.shim, MNEMEX, { mode: 0o755 }),
      (s: Site) => {
        const target = join(s.home, "ours-elsewhere");
        writeFileSync(target, OURS, { mode: 0o755 });
        symlinkSync(target, s.shim);
      },
      (s: Site) => writeFileSync(s.shim, new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0, 1, 2]), { mode: 0o755 }),
    ]) {
      const s = site();
      make(s);
      writeJson(s.user, { env: { USE_BUILTIN_RIPGREP: "0" } });
      const before = readFileSync(s.user, "utf8");
      const { exitCode, out } = cli(s, [RG_SHIM_COMMAND]);
      expect(exitCode).toBe(1);
      expect(out.failure.code).toBe("rg_shim_foreign");
      expect(existsSync(s.shim)).toBe(true);
      expect(readFileSync(s.user, "utf8")).toBe(before);
    }
  });

  test("an unparseable user settings file is never written; the shim still goes", () => {
    const s = site();
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    const broken = '{ "env": { "USE_BUILTIN_RIPGREP": "0" }, ';
    writeFileSync(s.user, broken);
    // The env value cannot be read, so no edit is attempted at all.
    const { exitCode, out } = cli(s, [RG_SHIM_COMMAND]);
    expect(exitCode).toBe(0);
    expect(out.data).toMatchObject({ removed: true, envDeleted: false });
    expect(existsSync(s.shim)).toBe(false);
    expect(readFileSync(s.user, "utf8")).toBe(broken);
  });

  test('a user "env" that is not an object is left alone', () => {
    const s = site();
    writeFileSync(s.shim, OURS, { mode: 0o755 });
    writeJson(s.user, { env: ["USE_BUILTIN_RIPGREP=0"] });
    const before = readFileSync(s.user, "utf8");
    const { exitCode, out } = cli(s, [RG_SHIM_COMMAND]);
    expect(exitCode).toBe(0);
    expect(out.data).toMatchObject({ removed: true, envDeleted: false });
    expect(readFileSync(s.user, "utf8")).toBe(before);
  });

  test("takes no positional argument", () => {
    const s = site();
    expect(cli(s, [RG_SHIM_COMMAND, "now"]).exitCode).toBe(2);
  });
});

test("the verb is spelled remove-rg-shim in setup.ts, the skill and both commands", () => {
  for (const relative of ["scripts/setup.ts", "skills/setup/SKILL.md", "commands/setup.md", "commands/help.md"]) {
    expect(readFileSync(join(PLUGIN_ROOT, relative), "utf8")).toContain("remove-rg-shim");
  }
});

test("the skill and both commands carry the P9 summary line verbatim", () => {
  for (const relative of ["skills/setup/SKILL.md", "commands/setup.md", "commands/help.md"]) {
    expect(readFileSync(join(PLUGIN_ROOT, relative), "utf8")).toContain(GREP_ROUTE_SUMMARY);
  }
});
