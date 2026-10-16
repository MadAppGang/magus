import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { profileCheck } from "./profile-check.ts";

const scriptPath = join(import.meta.dir, "profile-check.ts");

let root: string;
// A folder with no magus manifest; the spawned hook runs here so a fallback
// to the process cwd can never produce output by accident.
let neutral: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "setup-profile-check-"));
  neutral = join(root, "neutral");
  await mkdir(neutral, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeProject(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeManifest(dir: string): Promise<void> {
  await mkdir(join(dir, ".claude"), { recursive: true });
  await writeFile(
    join(dir, ".claude", "profiles.json"),
    JSON.stringify({ version: 2, default: "dev", profiles: { dev: {} } }, null, 2),
    "utf8",
  );
}

async function writeActive(dir: string): Promise<void> {
  await mkdir(join(dir, ".claude", "profiles"), { recursive: true });
  await writeFile(join(dir, ".claude", "profiles", "active.json"), JSON.stringify({ name: "dev" }), "utf8");
}

async function writeEarlierLayoutMarker(dir: string): Promise<void> {
  await mkdir(join(dir, ".claude", "_profiles"), { recursive: true });
  await writeFile(join(dir, ".claude", "_profiles", ".active"), "dev\n", "utf8");
}

/** A project with the tracked manifest and no active profile: the warning case. */
async function unconfiguredProject(name = "unconfigured"): Promise<string> {
  const dir = await makeProject(name);
  await writeManifest(dir);
  return dir;
}

/** A project with the manifest and an active profile: set up, stay silent. */
async function configuredProject(name = "configured"): Promise<string> {
  const dir = await makeProject(name);
  await writeManifest(dir);
  await writeActive(dir);
  return dir;
}

type SpawnResult = { exitCode: number; stdout: string; stderr: string };

async function spawnHook(stdin: string, projectDirEnv?: string): Promise<SpawnResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // The test runner may itself be inside a Claude Code session.
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDirEnv !== undefined) env.CLAUDE_PROJECT_DIR = projectDirEnv;
  env.HOME = process.env.HOME ?? root;
  env.PATH = process.env.PATH ?? "";

  const proc = Bun.spawn(
    [process.execPath, "--env-file=/dev/null", "--config=/dev/null", scriptPath],
    {
      cwd: neutral,
      env,
      stdin: new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("profileCheck(dir)", () => {
  test("warns when the manifest exists and no profile is active", async () => {
    const dir = await unconfiguredProject();
    const result = profileCheck(dir);
    expect(result).not.toBeNull();
    expect(typeof result!.systemMessage).toBe("string");
    expect(result!.systemMessage.trim().length).toBeGreaterThan(0);
    expect(typeof result!.additionalContext).toBe("string");
    expect(result!.additionalContext.trim().length).toBeGreaterThan(0);
  });

  test("is silent when an active profile exists", async () => {
    const dir = await configuredProject();
    expect(profileCheck(dir)).toBeNull();
  });

  test("is silent when the earlier-layout active marker exists", async () => {
    const dir = await unconfiguredProject("earlier-layout");
    await writeEarlierLayoutMarker(dir);
    expect(profileCheck(dir)).toBeNull();
  });

  test("is silent with no manifest", async () => {
    const dir = await makeProject("plain");
    expect(profileCheck(dir)).toBeNull();
  });

  test("is silent with no manifest even when .claude/ exists", async () => {
    const dir = await makeProject("plain-claude-dir");
    await mkdir(join(dir, ".claude"), { recursive: true });
    expect(profileCheck(dir)).toBeNull();
  });

  test("is silent when profiles.json is a directory, not a file", async () => {
    const dir = await makeProject("manifest-is-dir");
    await mkdir(join(dir, ".claude", "profiles.json"), { recursive: true });
    expect(profileCheck(dir)).toBeNull();
  });

  test("is silent for a folder that does not exist", () => {
    expect(profileCheck(join(root, "does-not-exist"))).toBeNull();
  });

  test("never checks parents: manifest only in the parent is silent for the child", async () => {
    const parent = await unconfiguredProject("parent");
    const child = join(parent, "packages", "child");
    await mkdir(child, { recursive: true });
    expect(profileCheck(parent)).not.toBeNull();
    expect(profileCheck(child)).toBeNull();
  });

  test("systemMessage names `magus update` and no internal files or paths", async () => {
    const dir = await unconfiguredProject();
    const { systemMessage } = profileCheck(dir)!;
    expect(systemMessage).toContain("magus update");
    for (const forbidden of ["settings.json", ".mcp.json", "active.json", ".claude/"]) {
      expect(systemMessage).not.toContain(forbidden);
    }
  });

  test("additionalContext never claims --worktree loads the root project's plugins", async () => {
    // REGRESSION: new git worktrees of a magus-profiled repo start without project plugins — Fixed in /dev:fix session dev-fix-20261015-002521-dc0f06b1
    const dir = await unconfiguredProject();
    const { additionalContext } = profileCheck(dir)!;
    expect(additionalContext).not.toContain("loads the root project's plugins");
  });

  test("additionalContext tells the model to check the needed agent is available first", async () => {
    // REGRESSION: new git worktrees of a magus-profiled repo start without project plugins — Fixed in /dev:fix session dev-fix-20261015-002521-dc0f06b1
    const dir = await unconfiguredProject();
    const { additionalContext } = profileCheck(dir)!;
    expect(additionalContext.toLowerCase()).toContain("agent");
  });
});

describe("profile-check.ts as a script", () => {
  test("stdin cwd with CLAUDE_PROJECT_DIR unset: prints SessionStart JSON, exit 0", async () => {
    const dir = await unconfiguredProject();
    const { exitCode, stdout } = await spawnHook(JSON.stringify({ cwd: dir, hook_event_name: "SessionStart" }));
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.systemMessage.trim().length).toBeGreaterThan(0);
    expect(parsed.systemMessage).toContain("magus update");
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
    expect(parsed.hookSpecificOutput.additionalContext.trim().length).toBeGreaterThan(0);
  });

  test("CLAUDE_PROJECT_DIR wins over stdin cwd (configured env dir, unconfigured cwd: silent)", async () => {
    const configured = await configuredProject();
    const unconfigured = await unconfiguredProject();
    const { exitCode, stdout } = await spawnHook(JSON.stringify({ cwd: unconfigured }), configured);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  test("CLAUDE_PROJECT_DIR wins over stdin cwd (unconfigured env dir, configured cwd: warns)", async () => {
    const configured = await configuredProject();
    const unconfigured = await unconfiguredProject();
    const { exitCode, stdout } = await spawnHook(JSON.stringify({ cwd: configured }), unconfigured);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.systemMessage).toContain("magus update");
  });

  test("configured folder: empty stdout, exit 0", async () => {
    const dir = await configuredProject();
    const { exitCode, stdout } = await spawnHook(JSON.stringify({ cwd: dir }));
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("garbage stdin: exit 0, no stack trace on stdout", async () => {
    const { exitCode, stdout } = await spawnHook("{not json at all \u0000");
    expect(exitCode).toBe(0);
    expect(stdout).not.toMatch(/Error|\bat .+:\d+:\d+|SyntaxError/);
    expect(stdout.trim()).toBe("");
  });

  test("empty stdin: exit 0, empty stdout", async () => {
    const { exitCode, stdout } = await spawnHook("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
