/**
 * The hook as the runtime actually invokes it: a real process, a real PreToolUse payload
 * on stdin, real settings files on disk.
 *
 * These two defects are unreachable from `discoveryTarget` unit tests, because neither
 * lives in the pattern logic — one is where the trace goes, the other is which settings
 * layers get read. Both shipped live in the first cut of this hook and both were found by
 * a release review rather than by the CS-1 bench, which could not see either: that bench
 * writes ONE overlay file carrying `engine` and `adoption` together, and names an explicit
 * `traceFile`, so neither the default trace path nor the layer split ever occurred.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "redirect-search-to-facade.ts");

let root: string;
let home: string;
let temp: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ca-hook-proc-"));
  home = join(root, "home");
  temp = join(root, "temp");
  project = join(root, "project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(temp, { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function settings(dir: string, name: string, block: unknown): void {
  writeFileSync(join(dir, ".claude", name), JSON.stringify({ "code-analysis": block }));
}

interface Result {
  stdout: string;
  exitCode: number;
}

async function runHook(command: string, env: Record<string, string> = {}): Promise<Result> {
  const payload = JSON.stringify({
    session_id: `s-${Math.random().toString(36).slice(2)}`,
    cwd: project,
    tool_name: "Bash",
    tool_input: { command },
  });
  const child = Bun.spawn(["bun", "--env-file=/dev/null", HOOK], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
    // HOME and TMPDIR are redirected so the test can never read or write the real ones.
    // CA_HOOK_TRACE is cleared explicitly: inheriting a developer's export would mask the
    // very default this file exists to pin down.
    env: { ...process.env, HOME: home, TMPDIR: temp, CA_HOOK_TRACE: "", ...env },
  });
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  return { stdout, exitCode };
}

/** Every file under a directory tree, relative paths, for asserting emptiness. */
function filesUnder(dir: string): string[] {
  const glob = new Bun.Glob("**/*");
  return [...glob.scanSync({ cwd: dir, onlyFiles: true, dot: true })];
}

describe("the trace is opt-in — no destination, no file", () => {
  test("an unconfigured project writes NO command log anywhere", async () => {
    // The defect: `trace()` ran before the `interceptBash` gate and fell back to a fixed
    // path under os.tmpdir(), so EVERY user of this plugin accumulated a plaintext record
    // of every shell command — credentials included — having opted into nothing.
    settings(project, "settings.json", { engine: "codegraph" });

    const result = await runHook('curl -H "Authorization: Bearer sk-secret-123" https://x.test');

    expect(result.exitCode).toBe(0);
    expect(filesUnder(temp)).toEqual([]);
  });

  test("no command log even when the lever is fully armed", async () => {
    // Arming the redirect is not consent to be logged; only naming a path is.
    settings(project, "settings.json", {
      engine: "codegraph",
      adoption: { interceptBash: true },
    });

    await runHook('curl -H "Authorization: Bearer sk-secret-123" https://x.test');

    const written = filesUnder(temp);
    // The budget counter is allowed to exist; a trace log is not.
    expect(written.filter((f) => f.includes("trace"))).toEqual([]);
  });

  test("naming a traceFile turns it on, and that is the whole switch", async () => {
    const target = join(root, "trace.log");
    settings(project, "settings.json", {
      engine: "codegraph",
      adoption: { traceFile: target },
    });

    await runHook("rg withFileLock");

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("withFileLock");
  });
});

describe("settings layers are merged, not picked", () => {
  // The defect: readBlock returned the FIRST layer carrying a block and never read the
  // home layer, so the split that /code-analysis:setup documents left the hook holding an
  // `adoption` with no `engine`. It failed its own engine check and allowed everything —
  // the lever read as on and did nothing, with no diagnostic.
  test("engine in settings.json + interceptBash in settings.local.json still denies", async () => {
    settings(project, "settings.json", { engine: "codegraph" });
    settings(project, "settings.local.json", { adoption: { interceptBash: true } });

    const result = await runHook("rg withFileLock");

    expect(result.stdout).toContain('"permissionDecision":"deny"');
    expect(result.stdout).toContain("code_search");
  });

  test("an engine set in the HOME layer is honoured", async () => {
    settings(home, "settings.json", { engine: "codegraph" });
    settings(project, "settings.local.json", { adoption: { interceptBash: true } });

    const result = await runHook("rg withFileLock");

    expect(result.stdout).toContain('"permissionDecision":"deny"');
  });

  test("the local layer still wins per key", async () => {
    // Both layers name an engine; the local one decides. If the merge order inverted,
    // this would still deny and look fine — so the assertion is on precedence being
    // observable at all, via a local layer that turns the lever OFF again.
    settings(project, "settings.json", { engine: "codegraph", adoption: { interceptBash: true } });
    settings(project, "settings.local.json", { adoption: { interceptBash: false } });

    const result = await runHook("rg withFileLock");

    expect(result.stdout).toBe("");
  });
});
