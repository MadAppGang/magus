/**
 * hooks-json.test.ts — how the grep-merge hooks are launched (review round 1, internal L6
 * and glm-5.3 MEDIUM).
 *
 * - The plugin root is quoted: `envLineBytes` supports a plugin path with a space, so the
 *   hook that writes it must start from one too.
 * - A missing bun, or a bun that fails to load the hook, is silent:
 *   `command -v bun … && CODE_SEARCH_SESSION_PID=$PPID bun … 2>/dev/null || true`. No
 *   `exec`, so `|| true` still runs; bun's stderr is discarded; each hook decides on stdout.
 *   deps-check reports a missing bun once per session; a hook error on every Grep call
 *   would only repeat it.
 * - Every bun launch carries `--env-file=/dev/null --config=/dev/null`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PLUGIN = join(import.meta.dir, "..");

interface Entry {
  matcher?: string;
  hooks: { command: string }[];
}

const HOOKS = (JSON.parse(readFileSync(join(import.meta.dir, "hooks.json"), "utf8")) as { hooks: Record<string, Entry[]> }).hooks;

function commandFor(event: string, file: string): string {
  const found = (HOOKS[event] ?? []).flatMap((e) => e.hooks).find((h) => h.command.includes(`/hooks/${file}`));
  if (found === undefined) throw new Error(`${event} has no ${file}`);
  return found.command;
}

const MERGE_HOOKS: [string, string][] = [
  ["SessionStart", "grep-merge-env.ts"],
  ["PostToolUse", "grep-tool-merge.ts"],
];
const ALL_HOOKS: [string, string][] = [...MERGE_HOOKS, ["PreToolUse", "redirect-search-to-facade.ts"]];

describe("launch commands", () => {
  // Review round 2, Codex HIGH: `exec bun … || true` cannot catch a bun that fails to
  // load (the shell is gone), so there is no `exec`; the claude pid the hook used to read
  // as its own parent is passed in CODE_SEARCH_SESSION_PID instead. `true`, not `exit`,
  // because check-plugin-requires reads a word after `||` as a launcher and allowlists `true`.
  test.each(ALL_HOOKS)("%s %s: quoted root, both bun flags, the session pid, no exec, || true", (event, file) => {
    const command = commandFor(event, file);
    // Review round 3, Codex HIGH: bun's own loader diagnostics go to stderr, so bun's
    // stderr is discarded. All three hooks decide on stdout (JSON) with status 0, and
    // grep-merge-env writes nothing to stderr at all, so nothing a hook means is lost.
    expect(command).toBe(
      `command -v bun >/dev/null 2>&1 && CODE_SEARCH_SESSION_PID=$PPID bun --env-file=/dev/null --config=/dev/null "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}" 2>/dev/null || true`,
    );
  });
});

describe("launching from a plugin root with a space, with and without bun", () => {
  let root: string;
  let plugin: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync("/tmp/cs-hooksjson-"));
    plugin = join(root, "plugin root");
    for (const dir of ["hooks", "mcp", "assets"]) cpSync(join(PLUGIN, dir), join(plugin, dir), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function launch(command: string, path: string): { rc: number | null; stdout: string; stderr: string } {
    const r = spawnSync("/bin/sh", ["-c", command], {
      env: { PATH: path, HOME: root, TMPDIR: root, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ cwd: root, tool_input: { pattern: "abc" } }),
      encoding: "utf8",
    });
    return { rc: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  test.each(ALL_HOOKS)("%s %s: runs (exit 0, silent) with bun on PATH", (event, file) => {
    expect(launch(commandFor(event, file), `${dirname(process.execPath)}:/usr/bin:/bin`)).toEqual({ rc: 0, stdout: "", stderr: "" });
  });

  test.each(ALL_HOOKS)("%s %s: exit 0, silent, with no bun on PATH", (event, file) => {
    expect(launch(commandFor(event, file), "/usr/bin:/bin")).toEqual({ rc: 0, stdout: "", stderr: "" });
  });

  // Review round 2, Codex HIGH: an incomplete plugin update. bun itself reports the
  // missing module on stderr; the hook's status must stay 0 and its stdout empty.
  const BUN_PATH = (): string => `${dirname(process.execPath)}:/usr/bin:/bin`;

  test.each(ALL_HOOKS)("%s %s: missing entrypoint → exit 0, empty stdout, empty stderr", (event, file) => {
    rmSync(join(plugin, "hooks", file));
    expect(launch(commandFor(event, file), BUN_PATH())).toEqual({ rc: 0, stdout: "", stderr: "" });
  });

  test("the redirect hook's deny still arrives on stdout through the launcher", () => {
    const project = join(root, "proj");
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({ "code-search": { engine: "mnemex", engines: { mnemex: { command: "true" } }, adoption: { interceptBash: true } } }),
    );
    const r = spawnSync("/bin/sh", ["-c", commandFor("PreToolUse", "redirect-search-to-facade.ts")], {
      env: { PATH: BUN_PATH(), HOME: root, TMPDIR: root, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_PROJECT_DIR: project },
      input: JSON.stringify({ session_id: "s-deny", cwd: project, tool_name: "Bash", tool_input: { command: "rg saveSettings" } }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
  });

  test("grep-tool-merge.ts with a module it imports missing → exit 0, empty stdout", () => {
    for (const gone of ["block.ts", "socket.ts"]) rmSync(join(plugin, "mcp", "grep", gone));
    const r = launch(commandFor("PostToolUse", "grep-tool-merge.ts"), BUN_PATH());
    expect({ rc: r.rc, stdout: r.stdout, stderr: r.stderr }).toEqual({ rc: 0, stdout: "", stderr: "" });
  });
});
