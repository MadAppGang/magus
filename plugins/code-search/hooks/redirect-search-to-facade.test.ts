/**
 * redirect-search-to-facade.test.ts — the discrimination, which IS the design.
 *
 * A five-model review panel split on whether intercepting Bash is even the right idea,
 * and both reviewers who voted named the same failure: a blanket grep-deny enforces
 * WORSE behaviour, because `rg` genuinely beats an index for an exact literal. So the
 * value of this hook is entirely in what it DOES NOT fire on, and that is what the bulk
 * of this file asserts.
 *
 * Run: bun test plugins/code-search/hooks/
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";

import { discoveryTarget, grepMergeStepsAside } from "./redirect-search-to-facade";

describe("redirects a discovery search — 'where is this symbol'", () => {
  test("a bare identifier is the case this hook exists for", () => {
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
    expect(discoveryTarget("grep -rn saveSettings src/")).toBe("saveSettings");
    expect(discoveryTarget("rg -n LOCK_TIMEOUT_MS")).toBe("LOCK_TIMEOUT_MS");
    expect(discoveryTarget("  grep   BaseStore  ")).toBe("BaseStore");
  });

  test("quoting a plain identifier does not change what it is", () => {
    expect(discoveryTarget('rg "withFileLock"')).toBe("withFileLock");
    expect(discoveryTarget("rg 'saveSettings'")).toBe("saveSettings");
  });
});

/**
 * THE REGRESSION THAT MADE A PAID BENCHMARK ARM MEASURE NOTHING.
 *
 * The first version of this hook rejected any command containing `| ; & > <`. Run against
 * the 84 Bash commands a real agent issued across 24 benchmark scenarios, it fired on
 * exactly ONE: 51 of the 84 were rejected by that guard alone. An agent almost never
 * writes a bare `rg foo` — it writes `rg foo 2>/dev/null` or pipes the result through a
 * filter. The arm ran, cost money, and tested nothing.
 *
 * These are real commands from that run. They are the cases that matter, because they are
 * what the hook will actually meet.
 */
describe("fires on the shapes an agent REALLY writes", () => {
  test("stderr suppression is noise, not a pipeline", () => {
    // `2>/dev/null` hides permission errors. It does not change the question being asked.
    expect(discoveryTarget('grep -r "reconcileOrphanedSymlinks" . 2>/dev/null')).toBe(
      "reconcileOrphanedSymlinks",
    );
    expect(discoveryTarget("rg gapFillInstalledPluginVersions 2>&1")).toBe(
      "gapFillInstalledPluginVersions",
    );
  });

  test("trailing result-trimming keeps the question intact", () => {
    // The agent still wants "where is X"; it is only shortening the list it gets back.
    expect(discoveryTarget("rg withFileLock | head -20")).toBe("withFileLock");
    expect(discoveryTarget("rg saveSettings | sort")).toBe("saveSettings");
    expect(discoveryTarget("grep -rn BaseStore | grep -v node_modules")).toBe("BaseStore");
  });

  test("but a pipeline that TRANSFORMS the answer is still left alone", () => {
    // `wc -l` turns a location question into a count. The facade does not answer counts.
    expect(discoveryTarget("rg withFileLock | wc -l")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock | xargs sed -i ''")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock | awk '{print $1}'")).toBeUndefined();
    // Sequencing further commands: a denial strands everything after it.
    expect(discoveryTarget("rg withFileLock && echo found")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock; ls")).toBeUndefined();
    // Redirection into a file the agent means to read back.
    expect(discoveryTarget("rg withFileLock > hits.txt")).toBeUndefined();
  });
});

describe("LEAVES ALONE everything an index answers no better", () => {
  test("regex metacharacters mean the agent wants pattern semantics", () => {
    // The facade takes a query, not a regex. Redirecting here loses the actual request.
    expect(discoveryTarget("rg 'withFileLock|saveSettings'")).toBeUndefined();
    expect(discoveryTarget("rg '^export async function'")).toBeUndefined();
    expect(discoveryTarget("grep -rn 'save.*Settings' src/")).toBeUndefined();
    expect(discoveryTarget("rg 'TODO(.*)'")).toBeUndefined();
  });

  test("a quoted phrase with spaces is literal text, not a symbol", () => {
    expect(discoveryTarget('rg "no active project"')).toBeUndefined();
    expect(discoveryTarget("grep -rn 'index is stale' .")).toBeUndefined();
  });

  test("counting and file-listing are things the facade does not do at all", () => {
    // THE case the dissenting reviewer raised: rg is not merely acceptable here, it is
    // the only tool that answers. Denying it would enforce strictly worse behaviour.
    expect(discoveryTarget("rg -c withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg --count withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg -l withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg --files-with-matches withFileLock")).toBeUndefined();
    expect(discoveryTarget("rg -o withFileLock")).toBeUndefined();
  });

  test("a listing flag buried in a COMBINED group still counts", () => {
    // Real commands from the benchmark run. `-rli` and `-rIl` are "which files contain
    // this", not "where is this defined", and a word-boundary check missed all of them —
    // which would have redirected exactly the questions the facade cannot answer.
    expect(discoveryTarget('grep -rli "symlink" --include="*.ts" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget('grep -rIl "checksum" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget('grep -rl "ScreenLayout" . 2>/dev/null')).toBeUndefined();
    expect(discoveryTarget("rg -cn withFileLock")).toBeUndefined();
    // But a group with NONE of c/l/L/o is still a location question.
    expect(discoveryTarget('grep -rn "gapFillInstalledPluginVersions" . 2>/dev/null')).toBe(
      "gapFillInstalledPluginVersions",
    );
  });

  test("`find` is a FILENAME question end to end and is never redirected", () => {
    expect(discoveryTarget("find . -name '*.ts'")).toBeUndefined();
    expect(discoveryTarget("find src -type f -name lock.ts")).toBeUndefined();
    // Even one that looks symbol-shaped: the facade has no filename-pattern operation.
    expect(discoveryTarget("find . -name withFileLock")).toBeUndefined();
  });

  test("a pipeline feeds something else, and denying strands the whole plan", () => {
    expect(discoveryTarget("rg withFileLock | wc -l")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock > out.txt")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock && echo done")).toBeUndefined();
    expect(discoveryTarget("rg withFileLock; ls")).toBeUndefined();
  });

  test("anything not search-shaped is none of this hook's business", () => {
    expect(discoveryTarget("bun test")).toBeUndefined();
    expect(discoveryTarget("git status")).toBeUndefined();
    expect(discoveryTarget("ls -R src")).toBeUndefined();
    expect(discoveryTarget("npm run build")).toBeUndefined();
    // `ls -R` is a directory question; the facade has no directory-listing answer, so it
    // is deliberately absent from the intercepted set rather than silently omitted.
  });

  test("a token too short to be a lookup is a text search", () => {
    // `rg id` matches half a corpus. That is grepping, not locating.
    expect(discoveryTarget("rg id")).toBeUndefined();
    expect(discoveryTarget("rg abc")).toBeUndefined();
    expect(discoveryTarget("rg abcd")).toBe("abcd");
  });

  test("a path argument is not the pattern", () => {
    // `src/` and `lock.ts` must never be mistaken for the thing being searched for.
    expect(discoveryTarget("rg withFileLock src/")).toBe("withFileLock");
    expect(discoveryTarget("rg withFileLock src/lock.ts")).toBe("withFileLock");
  });

  test("no pattern at all is not a redirect", () => {
    expect(discoveryTarget("rg")).toBeUndefined();
    expect(discoveryTarget("rg -n")).toBeUndefined();
    expect(discoveryTarget("")).toBeUndefined();
  });
});

/**
 * THE WIDE GUARD — `discoveryTarget(cmd, { listIsLocation: true })`.
 *
 * A plain option, set per call. It used to be an env var read once at module load and
 * tested through a subprocess; that env var was set by a wrapper script the bench injected
 * by absolute path, which madbench's sandbox refused to read. The calibration now arrives
 * in the `adoption` settings block the hook already opens, so the guard takes it as an
 * argument and the test needs no spawn.
 */
describe("discoveryTarget with listIsLocation", () => {
  const wide = (command: string): string | undefined =>
    discoveryTarget(command, { listIsLocation: true });

  test("`-l` becomes a location query — the shape a real agent actually writes", () => {
    // Measured: over a smoke run the narrow guard fired 11 times and denied 0, because
    // every command was this shape rather than the bare `rg withFileLock` it was tuned on.
    expect(wide('grep -rln "withFileLock" --include="*.ts" .')).toBe("withFileLock");
    expect(wide("grep -rl withFileLock .")).toBe("withFileLock");
    expect(wide("rg -l withFileLock")).toBe("withFileLock");
  });

  test("a count and a matched substring stay excluded — the facade answers neither", () => {
    expect(wide("grep -rc withFileLock .")).toBeUndefined();
    expect(wide("grep -ro withFileLock .")).toBeUndefined();
    expect(wide("grep -r --count withFileLock .")).toBeUndefined();
  });

  test("widening `-l` does not disable any OTHER guard", () => {
    // Each is rejected by a DIFFERENT guard, and all must survive the widening.
    expect(wide('grep -rl "index is stale" .')).toBeUndefined(); // quoted phrase
    expect(wide("grep -rl abc .")).toBeUndefined(); // token too short
    expect(wide('grep -rln "a\\|withFileLock" .')).toBeUndefined(); // regex metachars
    expect(wide("find . -name '*.ts'")).toBeUndefined(); // filename question
    expect(wide("grep -rl withFileLock . | wc -l")).toBeUndefined(); // transforming pipe
  });

  test("the narrow default is unchanged in this same process", () => {
    // Guards the flag against leaking: the module imported here has it unset.
    expect(discoveryTarget('grep -rln "withFileLock" --include="*.ts" .')).toBeUndefined();
    expect(discoveryTarget("rg withFileLock")).toBe("withFileLock");
  });
});

/**
 * D11 — WHILE THE SEARCH MERGE IS ON, `grep` IS LEFT ALONE.
 *
 * A Bash `grep` in a session with the merge on already ends with the index's related
 * locations, so a redirect to `code_search` only costs the agent a round trip. The step
 * aside is for the `grep` binary alone: `rg` and the rest are judged as before, and with
 * the gate closed `grep` is judged as before too.
 */
describe("grepMergeStepsAside", () => {
  test("grep, and only grep, steps aside while the gate is open and the socket exists", () => {
    expect(grepMergeStepsAside("grep -rn saveSettings src/", undefined, true)).toBe(true);
    expect(grepMergeStepsAside("  grep saveSettings", undefined, true)).toBe(true);
    for (const cmd of ["rg saveSettings", "egrep -r saveSettings .", "fgrep saveSettings", "grep-x saveSettings", "ag saveSettings"]) {
      expect(grepMergeStepsAside(cmd, undefined, true)).toBe(false);
    }
  });

  test("a closed gate, or no session socket, steps aside for nothing", () => {
    for (const why of ["win32", "kill-switch", "route-off", "no-engine"] as const) {
      expect(grepMergeStepsAside("grep -rn saveSettings src/", why, true)).toBe(false);
    }
    expect(grepMergeStepsAside("grep -rn saveSettings src/", undefined, false)).toBe(false);
  });
});

describe("the hook process, with the merge gate", () => {
  let root: string;
  let home: string;
  let project: string;
  let trace: string;
  let server: Server | undefined;
  let session = 0;

  const HOOK = join(import.meta.dir, "redirect-search-to-facade.ts");
  const uid = process.getuid?.() ?? 0;

  beforeEach(() => {
    // Under /tmp: the session socket path must stay within 100 bytes.
    root = realpathSync(mkdtempSync("/tmp/cs-redirect-"));
    home = join(root, "home");
    project = join(root, "project");
    trace = join(root, "trace.log");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(project, ".claude"), { recursive: true });
    server = undefined;
  });

  afterEach(async () => {
    const s = server;
    if (s !== undefined) await new Promise<void>((resolve) => s.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  /** This session's socket: the hook is spawned by this process, so its ppid is ours. */
  async function sessionSocket(pid = process.pid): Promise<void> {
    const dir = join(root, `code-search-${uid}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const s = createServer();
    server = s;
    await new Promise<void>((resolve) => s.listen(join(dir, `${pid}.sock`), () => resolve()));
  }

  function settings(extra: Record<string, unknown> = {}, env?: Record<string, string>, top: Record<string, unknown> = {}): void {
    const block = {
      engine: "mnemex",
      engines: { mnemex: { command: "true" } },
      adoption: { interceptBash: true, traceFile: trace },
      ...extra,
    };
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({ "code-search": block, ...(env ? { env } : {}), ...top }),
    );
  }

  function decide(
    command: string,
    env: Record<string, string> = {},
    o: { cwd?: string; input?: Record<string, unknown> } = {},
  ): "allow" | "deny" {
    session += 1;
    const payload = {
      session_id: `s-${process.pid}-${session}`,
      cwd: o.cwd ?? project,
      tool_name: "Bash",
      tool_input: { command, ...o.input },
    };
    const r = spawnSync(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", HOOK], {
      cwd: project,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, TMPDIR: root, ...env },
      input: JSON.stringify(payload),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    return r.stdout.includes('"permissionDecision":"deny"') ? "deny" : "allow";
  }

  test("gate open and this session's socket present: grep is allowed with a trace line; rg is still redirected", async () => {
    settings();
    await sessionSocket();
    expect(decide("grep -rn saveSettings src/")).toBe("allow");
    expect(readFileSync(trace, "utf8")).toContain("-> allowed: grep merge active");
    expect(decide("rg saveSettings")).toBe("deny");
  });

  // Review round 1, internal M3: an open gate with no socket means the merge cannot run
  // (sandbox, no TMPDIR, server not bound), so the redirect must not step aside.
  test("gate open but no session socket: grep is redirected as before", () => {
    settings();
    expect(decide("grep -rn saveSettings src/")).toBe("deny");
  });

  test.each([
    ["grep.route false", { grep: { route: false } }, undefined, {}],
    ["CODE_SEARCH_MERGE \"0\" in settings env", {}, { CODE_SEARCH_MERGE: "0" }, {}],
    ["CODE_SEARCH_MERGE=0 in the hook's environment", {}, undefined, { CODE_SEARCH_MERGE: "0" }],
  ] as const)("gate closed (%s), socket present: grep is redirected as before", async (_name, extra, env, procEnv) => {
    settings(extra, env);
    await sessionSocket();
    expect(decide("grep -rn saveSettings src/", { ...procEnv })).toBe("deny");
  });

  // Review round 3, Codex CRITICAL: an engine id with no `engines` entry builds no engine,
  // so there is no facade to redirect to; the redirect must judge "configured" by gate.ts's
  // one rule, not by a non-empty engine string, and leave every search alone.
  test("an engine id with no engines entry: grep and rg are both allowed", () => {
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({ "code-search": { engine: "typo", engines: {}, adoption: { interceptBash: true, traceFile: trace } } }),
    );
    expect(decide("grep -rn saveSettings src/")).toBe("allow");
    expect(decide("rg saveSettings")).toBe("allow");
  });

  // Review round 5, Codex CRITICAL: an id with an `engines` entry that names no adapter
  // this plugin ships resolves to nothing in the server (`resolveEngine`), so no facade and
  // no merge exist; the redirect must leave every search alone.
  test("an engine id this plugin does not ship, with an entry: grep and rg are both allowed", () => {
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({ "code-search": { engine: "fake", engines: { fake: { command: "true" } }, adoption: { interceptBash: true, traceFile: trace } } }),
    );
    expect(decide("grep -rn saveSettings src/")).toBe("allow");
    expect(decide("rg saveSettings")).toBe("allow");
  });

  // Review round 2, MEDIUM (three reviewers): under the Bash sandbox the shell cannot reach
  // the socket the hook can see (P0-9), so the merge does not run there and the redirect
  // must not step aside, unless this call runs outside the sandbox.
  test("sandbox enabled in settings, socket present: grep is redirected; dangerouslyDisableSandbox: steps aside", async () => {
    settings({}, undefined, { sandbox: { enabled: true } });
    await sessionSocket();
    expect(decide("grep -rn saveSettings src/")).toBe("deny");
    expect(decide("grep -rn saveSettings src/", {}, { input: { dangerouslyDisableSandbox: true } })).toBe("allow");
  });

  test("a later settings layer turning the sandbox off wins", async () => {
    settings({}, undefined, { sandbox: { enabled: true } });
    writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify({ sandbox: { enabled: false } }));
    await sessionSocket();
    expect(decide("grep -rn saveSettings src/")).toBe("allow");
  });

  // Review round 2, Codex HIGH: the launcher no longer execs bun, so the claude pid is
  // passed in CODE_SEARCH_SESSION_PID rather than read as the hook's parent.
  test("CODE_SEARCH_SESSION_PID names the session whose socket is checked", async () => {
    settings();
    await sessionSocket(4242);
    expect(decide("grep -rn saveSettings src/")).toBe("deny");
    expect(decide("grep -rn saveSettings src/", { CODE_SEARCH_SESSION_PID: "4242" })).toBe("allow");
  });

  // Review round 2, internal LOW: settings are the project's (CLAUDE_PROJECT_DIR), as the
  // merge hooks read them, not the payload cwd, which a `cd` can move into a subdirectory.
  test("settings come from CLAUDE_PROJECT_DIR when the payload cwd is a subdirectory", async () => {
    settings();
    await sessionSocket();
    const sub = join(project, "src");
    mkdirSync(sub);
    expect(decide("rg saveSettings", { CLAUDE_PROJECT_DIR: project }, { cwd: sub })).toBe("deny");
    expect(decide("grep -rn saveSettings src/", { CLAUDE_PROJECT_DIR: project }, { cwd: sub })).toBe("allow");
  });

  // Review round 4, LOW: the watchdog must be able to fire. A payload that never ends
  // (stdin held open) ends in an allow inside the 5 s hooks.json timeout, never a hook error.
  test("stdin held open: the hook exits 0 with no decision inside the hooks.json timeout", async () => {
    settings();
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", HOOK], {
      cwd: project,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, TMPDIR: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write('{"tool_name":"Bash",');
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    const started = Date.now();
    const code = await new Promise<number | null | "hung">((resolve) => {
      const t = setTimeout(() => resolve("hung"), 5_000);
      child.on("exit", (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    if (code === "hung") child.kill("SIGKILL");
    child.stdin.destroy();
    expect({ code, deny: out.includes('"deny"') }).toEqual({ code: 0, deny: false });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);
});
