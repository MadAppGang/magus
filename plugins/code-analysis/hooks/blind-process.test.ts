import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scriptPath = join(import.meta.dir, "redirect-search-to-facade.ts");

let root: string;
let home: string;
let project: string;
let isolatedTmp: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "redirect-search-hook-"));
  home = join(root, "home");
  project = join(root, "project");
  isolatedTmp = join(root, "tmp");

  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(project, { recursive: true }),
    mkdir(isolatedTmp, { recursive: true }),
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSettings(
  base: string,
  filename: "settings.json" | "settings.local.json",
  value: unknown,
): Promise<void> {
  const claudeDirectory = join(base, ".claude");
  await mkdir(claudeDirectory, { recursive: true });
  await writeFile(join(claudeDirectory, filename), JSON.stringify(value, null, 2), "utf8");
}

async function writeRawSettings(
  base: string,
  filename: "settings.json" | "settings.local.json",
  contents: string,
): Promise<void> {
  const claudeDirectory = join(base, ".claude");
  await mkdir(claudeDirectory, { recursive: true });
  await writeFile(join(claudeDirectory, filename), contents, "utf8");
}

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function spawnHook(
  command: string,
  options: {
    sessionId?: string;
    cwd?: string;
    payload?: unknown;
    traceOverride?: string;
  } = {},
): Promise<SpawnResult> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.HOME = home;
  env.TMPDIR = isolatedTmp;

  // An inherited developer override must never enable tracing in these tests.
  delete env.CA_HOOK_TRACE;

  if (options.traceOverride !== undefined) {
    env.CA_HOOK_TRACE = options.traceOverride;
  }

  const payload = options.payload ?? {
    session_id: options.sessionId ?? crypto.randomUUID(),
    cwd: options.cwd ?? project,
    tool_name: "Bash",
    tool_input: { command },
  };

  const child = Bun.spawn({
    cmd: ["bun", "--env-file=/dev/null", scriptPath],
    cwd: options.cwd ?? project,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
  child.stdin.end();

  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  const exitCode = await child.exited;

  return {
    exitCode,
    stdout: await stdoutPromise,
    stderr: await stderrPromise,
  };
}

function expectAllowed(result: SpawnResult): void {
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
}

/**
 * CORRECTED AFTER THE FACT — and the correction is to the SPEC, not to the hook.
 *
 * The brief these tests were written from said only that a denial "writes one JSON object
 * to stdout containing `permissionDecision: deny`". The author of these tests read that as
 * a flat object, which is a fair reading, and all four denial assertions failed against a
 * hook that was behaving correctly.
 *
 * Claude Code's PreToolUse contract requires the decision to sit inside a
 * `hookSpecificOutput` envelope carrying `hookEventName`. The envelope is load-bearing:
 * output without `hookEventName` is ignored outright, so a hook that emitted the flat shape
 * would be silently inert — the failure mode this whole file exists to catch. Asserting
 * `hookEventName` here therefore tests something real, rather than restating a wrapper.
 */
function expectDenied(result: SpawnResult): void {
  expect(result.exitCode).toBe(0);

  const trimmed = result.stdout.trim();
  expect(trimmed.length).toBeGreaterThan(0);

  const output = JSON.parse(trimmed);
  const decision = output.hookSpecificOutput;
  expect(decision).toBeDefined();
  expect(decision.hookEventName).toBe("PreToolUse");
  expect(decision.permissionDecision).toBe("deny");
  expect(typeof decision.permissionDecisionReason).toBe("string");
  expect(decision.permissionDecisionReason).toContain("code_search");
}

async function allFiles(directory: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const childPath = join(path, entry.name);

      if (entry.isDirectory()) {
        await visit(childPath);
      } else if (entry.isFile()) {
        results.push(childPath);
      }
    }
  }

  await visit(directory);
  return results;
}

async function filesContaining(directory: string, needle: string): Promise<string[]> {
  const matches: string[] = [];
  const needleBytes = Buffer.from(needle);

  for (const path of await allFiles(directory)) {
    const contents = await readFile(path);
    if (contents.includes(needleBytes)) {
      matches.push(path);
    }
  }

  return matches;
}

describe("process contract", () => {
  test("always exits zero and writes nothing when missing configuration allows", async () => {
    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("allows when an engine is configured but interceptBash is absent", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("allows when interceptBash is not exactly true", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: "true",
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("allows when interceptBash is true but no engine is configured", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("denial output is one JSON object directing the caller to code_search", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectDenied(result);
  });

  test("an unreadable JSON payload allows and exits zero", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("", {
      payload: "{ this is not valid JSON",
    });

    expectAllowed(result);
  });

  test("a malformed settings file allows and exits zero", async () => {
    await writeRawSettings(project, "settings.json", "{ this is not valid JSON");

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("a payload missing the command allows and exits zero", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("", {
      payload: {
        session_id: crypto.randomUUID(),
        cwd: project,
        tool_name: "Bash",
        tool_input: {},
      },
    });

    expectAllowed(result);
  });
});

describe("diagnostic tracing is strictly opt-in", () => {
  test("arming interception does not create a plaintext command log by default", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    const secret = `Bearer secret-${crypto.randomUUID()}`;
    const command = `curl -H "Authorization: ${secret}" https://example.invalid/private`;

    const result = await spawnHook(command);

    expectAllowed(result);

    // HOME, cwd, and TMPDIR are all isolated beneath root. No file created by
    // the hook in those destinations may contain the command or credential.
    expect(await filesContaining(root, command)).toEqual([]);
    expect(await filesContaining(root, secret)).toEqual([]);
  });

  test("an explicit adoption.traceFile enables tracing at that path", async () => {
    const tracePath = join(root, "configured-trace.log");
    const command = `echo trace-marker-${crypto.randomUUID()}`;

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: false,
          traceFile: tracePath,
        },
      },
    });

    const result = await spawnHook(command);

    expectAllowed(result);
    expect((await stat(tracePath)).isFile()).toBe(true);
    expect(await readFile(tracePath, "utf8")).toContain(command);
  });

  test("tracing occurs before the interceptBash check", async () => {
    const tracePath = join(root, "pre-intercept-trace.log");
    const command = `echo before-intercept-${crypto.randomUUID()}`;

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: false,
          traceFile: tracePath,
        },
      },
    });

    const result = await spawnHook(command);

    expectAllowed(result);
    expect(await readFile(tracePath, "utf8")).toContain(command);
  });

  test("CA_HOOK_TRACE explicitly enables its named trace destination", async () => {
    const tracePath = join(root, "developer-override-trace.log");
    const command = `echo override-marker-${crypto.randomUUID()}`;

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: false,
        },
      },
    });

    const result = await spawnHook(command, {
      traceOverride: tracePath,
    });

    expectAllowed(result);
    expect((await stat(tracePath)).isFile()).toBe(true);
    expect(await readFile(tracePath, "utf8")).toContain(command);
  });
});

describe("configuration layers are merged", () => {
  test("merges project engine with local interceptBash", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
      },
    });

    await writeSettings(project, "settings.local.json", {
      "code-analysis": {
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectDenied(result);
  });

  test("merges HOME engine with project-local interceptBash", async () => {
    await writeSettings(home, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
      },
    });

    await writeSettings(project, "settings.local.json", {
      "code-analysis": {
        adoption: {
          interceptBash: true,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectDenied(result);
  });

  test("merges adoption one level deeper so its keys accumulate", async () => {
    const tracePath = join(root, "accumulated-adoption-trace.log");
    const command = "rg withFileLock";

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    await writeSettings(project, "settings.local.json", {
      "code-analysis": {
        adoption: {
          traceFile: tracePath,
        },
      },
    });

    const result = await spawnHook(command);

    expectDenied(result);
    expect(await readFile(tracePath, "utf8")).toContain(command);
  });

  test("the local layer wins per adoption key and can turn interception off", async () => {
    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "configured-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    await writeSettings(project, "settings.local.json", {
      "code-analysis": {
        adoption: {
          interceptBash: false,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("project settings win over HOME settings per key", async () => {
    await writeSettings(home, "settings.json", {
      "code-analysis": {
        engine: "home-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        adoption: {
          interceptBash: false,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });

  test("project-local settings win over both earlier layers per key", async () => {
    await writeSettings(home, "settings.json", {
      "code-analysis": {
        engine: "home-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    await writeSettings(project, "settings.json", {
      "code-analysis": {
        engine: "project-engine",
        adoption: {
          interceptBash: true,
        },
      },
    });

    await writeSettings(project, "settings.local.json", {
      "code-analysis": {
        adoption: {
          interceptBash: false,
        },
      },
    });

    const result = await spawnHook("rg withFileLock");

    expectAllowed(result);
  });
});
