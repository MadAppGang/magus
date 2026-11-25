// Behaviour tests for hooks/conflict-check.ts, the SessionStart warning about
// official language server plugins that claim the same file extensions as lsp.
// Each test runs the script as its own process against a temporary HOME and project.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "hooks", "conflict-check.ts");
const HOOKS_JSON = resolve(import.meta.dir, "..", "hooks", "hooks.json");
const GOPLS = "gopls-lsp@claude-plugins-official";
const TS = "typescript-lsp@claude-plugins-official";

type Scope = "user" | "project" | "local";

interface Env {
  home: string;
  project: string;
}

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeEnv(): Env {
  const home = mkdtempSync(join(tmpdir(), "lsp-conflict-home-"));
  const project = mkdtempSync(join(tmpdir(), "lsp-conflict-project-"));
  created.push(home, project);
  return { home, project };
}

function settingsPath(env: Env, scope: Scope): string {
  switch (scope) {
    case "user":
      return join(env.home, ".claude", "settings.json");
    case "project":
      return join(env.project, ".claude", "settings.json");
    case "local":
      return join(env.project, ".claude", "settings.local.json");
  }
}

function writeRaw(env: Env, scope: Scope, text: string): void {
  const path = settingsPath(env, scope);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function writeEnabled(env: Env, scope: Scope, enabledPlugins: Record<string, boolean>): void {
  writeRaw(env, scope, JSON.stringify({ enabledPlugins }, null, 2));
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function run(env: Env, opts: { stdin?: string; cwd?: string } = {}): RunResult {
  const stdin =
    opts.stdin ?? JSON.stringify({ hook_event_name: "SessionStart", cwd: env.project, source: "startup" });
  const proc = Bun.spawnSync(["bun", "--env-file=/dev/null", "--config=/dev/null", SCRIPT], {
    cwd: opts.cwd,
    env: { ...process.env, HOME: env.home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

interface HookOutput {
  systemMessage: string;
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

function parseOutput(result: RunResult): HookOutput {
  const text = result.stdout.trim();
  expect(text.length).toBeGreaterThan(0);
  const parsed = JSON.parse(text) as HookOutput;
  expect(typeof parsed.systemMessage).toBe("string");
  return parsed;
}

function expectSilent(result: RunResult): void {
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
}

function uninstall(id: string, scope: Scope): string {
  return `claude plugin uninstall ${id} --scope ${scope}`;
}

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(abs);
      out.push(`${r}:${st.isDirectory() ? "d" : st.size}:${st.mtimeMs}`);
      if (st.isDirectory()) walk(abs, r);
    }
  };
  walk(root, "");
  return out;
}

describe("lsp conflict check at session start", () => {
  test("REQ-W1 prints nothing and exits 0 when no settings files exist", () => {
    const env = makeEnv();
    expectSilent(run(env));
  });

  test("REQ-W2 names gopls-lsp and its user-scope uninstall command when enabled at user scope", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(GOPLS);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "user"));
  });

  test("REQ-W3 names the project-scope uninstall command when enabled in the project settings", () => {
    const env = makeEnv();
    writeEnabled(env, "project", { [GOPLS]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(GOPLS);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "project"));
  });

  test("REQ-W4 names the local-scope uninstall command when enabled in the local settings", () => {
    const env = makeEnv();
    writeEnabled(env, "local", { [GOPLS]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(GOPLS);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "local"));
  });

  test("REQ-W5 prints nothing when local scope sets false over a user-scope true", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    writeEnabled(env, "local", { [GOPLS]: false });
    expectSilent(run(env));
  });

  test("REQ-W6 prints nothing when project scope sets false over a user-scope true", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [TS]: true });
    writeEnabled(env, "project", { [TS]: false });
    expectSilent(run(env));
  });

  test("REQ-W7 names the deciding (latest) scope when a plugin is true at user and project", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    writeEnabled(env, "project", { [GOPLS]: true });
    const out = parseOutput(run(env));
    expect(out.systemMessage).toContain(uninstall(GOPLS, "project"));
  });

  test("REQ-W8 reports a later-scope true over an earlier false, with the later scope", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: false });
    writeEnabled(env, "local", { [GOPLS]: true });
    const out = parseOutput(run(env));
    expect(out.systemMessage).toContain(GOPLS);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "local"));
  });

  test("REQ-W9 detects typescript-lsp from another marketplace name", () => {
    const env = makeEnv();
    const id = "typescript-lsp@some-other-market";
    writeEnabled(env, "user", { [id]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(id);
    expect(out.systemMessage).toContain(uninstall(id, "user"));
  });

  test("REQ-W10 names both plugins, each with its own scope, when both are enabled", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    writeEnabled(env, "project", { [TS]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(GOPLS);
    expect(out.systemMessage).toContain(TS);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "user"));
    expect(out.systemMessage).toContain(uninstall(TS, "project"));
  });

  test("REQ-W11 prints nothing for a key whose name only starts with gopls-lsp", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { "gopls-lsp-extra@x": true, "typescript-lsp-pro@y": true, "my-gopls-lsp@z": true });
    expectSilent(run(env));
  });

  test("REQ-W12 prints nothing for an unrelated enabled plugin", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { "lsp@magus": true, "dev@magus": true });
    expectSilent(run(env));
  });

  test("REQ-W13 ignores an invalid JSON settings file and exits 0", () => {
    const env = makeEnv();
    writeRaw(env, "user", "{ this is not json");
    expectSilent(run(env));
  });

  test("REQ-W14 still reports a conflict from a valid file when another file is invalid JSON", () => {
    const env = makeEnv();
    writeRaw(env, "user", "{ broken");
    writeEnabled(env, "project", { [GOPLS]: true });
    const result = run(env);
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result).systemMessage).toContain(uninstall(GOPLS, "project"));
  });

  test("REQ-W15 treats a non-object enabledPlugins as no entries", () => {
    const env = makeEnv();
    writeRaw(env, "user", JSON.stringify({ enabledPlugins: [GOPLS] }));
    writeRaw(env, "project", JSON.stringify({ enabledPlugins: "gopls-lsp@claude-plugins-official" }));
    writeRaw(env, "local", JSON.stringify({ somethingElse: true }));
    expectSilent(run(env));
  });

  test("REQ-W16 uses the process working directory when stdin is empty", () => {
    const env = makeEnv();
    writeEnabled(env, "project", { [GOPLS]: true });
    const result = run(env, { stdin: "", cwd: env.project });
    expect(result.exitCode).toBe(0);
    const out = parseOutput(result);
    expect(out.systemMessage).toContain(uninstall(GOPLS, "project"));
  });

  test("REQ-W17 uses the process working directory when stdin is invalid JSON", () => {
    const env = makeEnv();
    writeEnabled(env, "local", { [TS]: true });
    const result = run(env, { stdin: "not json at all", cwd: env.project });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result).systemMessage).toContain(uninstall(TS, "local"));
  });

  test("REQ-W18 reads project settings from the stdin cwd, not the process directory", () => {
    const env = makeEnv();
    const elsewhere = mkdtempSync(join(tmpdir(), "lsp-conflict-elsewhere-"));
    created.push(elsewhere);
    writeEnabled(env, "project", { [GOPLS]: true });
    const result = run(env, { cwd: elsewhere });
    expect(parseOutput(result).systemMessage).toContain(uninstall(GOPLS, "project"));
  });

  test("REQ-W19 output is one JSON object with hookEventName SessionStart and additionalContext", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    const out = parseOutput(run(env));
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof out.hookSpecificOutput.additionalContext).toBe("string");
    expect(out.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
  });

  test("REQ-W20 writes no files in HOME or the project", () => {
    const env = makeEnv();
    writeEnabled(env, "user", { [GOPLS]: true });
    writeEnabled(env, "project", { [TS]: true });
    writeEnabled(env, "local", { "dev@magus": true });
    const homeBefore = listTree(env.home);
    const projectBefore = listTree(env.project);
    const result = run(env);
    expect(result.exitCode).toBe(0);
    expect(listTree(env.home)).toEqual(homeBefore);
    expect(listTree(env.project)).toEqual(projectBefore);
  });

  test("REQ-W21 hooks.json registers conflict-check.ts as a SessionStart hook on startup", () => {
    const hooks = JSON.parse(readFileSync(HOOKS_JSON, "utf8")) as {
      hooks: { SessionStart?: { matcher?: string; hooks: { type: string; command: string }[] }[] };
    };
    const groups = hooks.hooks.SessionStart ?? [];
    const match = groups.some(
      (g) =>
        g.matcher === "startup" &&
        g.hooks.some(
          (h) =>
            h.type === "command" &&
            h.command.includes("conflict-check.ts") &&
            h.command.includes("--env-file=/dev/null") &&
            h.command.includes("--config=/dev/null"),
        ),
    );
    expect(match).toBe(true);
  });
});
