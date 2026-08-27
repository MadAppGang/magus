/**
 * live-engines.test.ts — the facade against REAL engines, one after the other.
 *
 * Every other test in this plugin proves the facade against something we wrote: a
 * scripted `McpClient`, a fake stdio server, a command that does not exist. Those are
 * the right tools for the branch logic, and they share one blind spot — they cannot
 * tell you whether the adapter's idea of an engine matches the engine. Four adapters
 * were deleted from this plugin precisely because nothing had ever closed that gap for
 * them: their tool names, argument shapes and line bases were all taken from
 * documentation and never once checked against a running server.
 *
 * So this file spawns `bun mcp/server.ts` as a child, points it at a real `serena` and
 * a real `mnemex`, and asserts on what actually comes back over stdio.
 *
 * ---------------------------------------------------------------------------------
 * SKIPPING IS ANNOUNCED, LOUDLY, BECAUSE A SILENT SKIP IS A GREEN TEST THAT CHECKED
 * NOTHING. Neither engine is a dependency of this repo — CI has neither binary — so a
 * missing one must not fail the build. It must also not disappear: each skip writes a
 * line to stderr naming the engine and what went unverified, and the run prints
 * "skipped" in its own summary. If you are reading a green run and want to know whether
 * these cases executed, that is the line to look for.
 *
 * Run: bun test plugins/code-analysis/mcp/live-engines.test.ts
 *
 * MEASURED 2026-08-27 — serena 1.7.0, mnemex 0.31.2, macOS. These are the numbers the
 * expectations below were written from, not numbers they aspire to:
 *
 *   serena  tools/list -> ["code_search","find_dependents","find_implementations"]
 *           code_search "withFileLock" -> 5441ms
 *           served_by: serena/locateSymbol
 *           1. src/lock.ts:2-4  withFileLock  [function]
 *
 *   mnemex  tools/list -> ["code_search","find_dependencies","find_dependents",
 *                          "call_tree","impact"]
 *           code_search "withFileLock" -> 396ms
 *           served_by: mnemex/locateSymbol, no results, and:
 *           [error] index_missing: the engine reports 0 indexed files …
 *             remedy: mnemex index
 *
 * That mnemex answer is the DEGRADED path working, not a failure of it. mnemex needs an
 * embedding credential and an index run before it can answer anything, and the facade's
 * whole job in that state is to say so instead of returning an empty list that reads as
 * "this codebase has no matches". The assertion below accepts either outcome — real
 * hits, or an empty answer carrying `index_missing` — and rejects the third thing, an
 * empty answer with no explanation, which is what a broken facade produces.
 *
 * CHILD PROCESSES are killed BY PID. No pattern kill: this repo runs many concurrent
 * `bun` and `claude` processes and a pattern kill takes unrelated sessions down.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, makeLineReader, type RpcResponse } from "./transport/jsonrpc";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "server.ts");

/** Serena cold-starts a language server; 5.4s measured, and a first run may fetch it. */
const LIVE_CASE_MS = 180_000;

/** Generous, and per-engine rather than global — see `EngineSpec.callTimeoutMs`. */
const CALL_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// The corpus. Three files, one real relationship between them.
// ---------------------------------------------------------------------------

/**
 * `withFileLock` is declared in `lock.ts` and called from `settings.ts`, so a symbol
 * search has one right answer and a dependents search has one right answer, and they
 * are different files. Kept tiny because serena indexes it on demand and mnemex would
 * have to embed it.
 */
const SOURCES: Readonly<Record<string, string>> = {
  "src/lock.ts": `export const LOCK_TIMEOUT_MS = 5000;

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}
`,
  "src/settings.ts": `import { withFileLock } from "./lock";

export async function saveSettings(data: unknown): Promise<void> {
  await withFileLock("settings.json", async () => {
    console.log(data);
  });
}
`,
  "src/index.ts": `import { saveSettings } from "./settings";

export async function main(): Promise<void> {
  await saveSettings({ ok: true });
}
`,
};

/**
 * Serena's `--project-from-cwd` walks UP for `.serena/project.yml` or `.git`, and this
 * file is what stops the walk inside the corpus. Its absence has TWO failure modes and
 * both were measured, which is why it is seeded rather than trusted:
 *
 *   in a temp dir with nothing above it — serena activates NO project, and every call
 *     comes back `Error executing tool find_symbol: No active project.` The facade
 *     renders that as `backend_unavailable` with a remedy, so it is at least loud.
 *     Reproduced 2026-08-27 by deleting the seed: `no results` plus that note.
 *
 *   inside an enclosing checkout — the walk succeeds one level too high and serena
 *     indexes the ENCLOSING tree, answering with paths prefixed by a directory the
 *     caller never searched. That one is silent: it renders as a uniform zero, which
 *     reads as "found nothing" rather than "searched the wrong tree". It is what CS-1
 *     hit against a `git archive` staged under this repo.
 */
const SERENA_PROJECT_YML = `project_name: "ca-live-corpus"
language_servers:
- typescript
encoding: "utf-8"
ignore_all_files_in_gitignore: false
read_only: true
ls_workspace_folders:
- .
initial_prompt: ''
activation_command_timeout: 180.0
`;

// ---------------------------------------------------------------------------
// Which engines this machine can actually test
// ---------------------------------------------------------------------------

function onPath(binary: string): boolean {
  return spawnSync("command", ["-v", binary], { shell: true, stdio: "ignore" }).status === 0;
}

const HAS_SERENA = onPath("serena");
const HAS_MNEMEX = onPath("mnemex");

function announceSkip(engine: string, unverified: string): void {
  process.stderr.write(
    `\n[live-engines] SKIPPED: ${engine} is not on PATH. UNVERIFIED on this run: ${unverified}\n`,
  );
}

if (!HAS_SERENA) announceSkip("serena", "tool names, result shape, and the engine switch");
if (!HAS_MNEMEX) announceSkip("mnemex", "tool names, the degraded index_missing path, and the switch");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const running: ChildProcess[] = [];
const scratch: string[] = [];

interface Live {
  request(method: string, params?: unknown): Promise<RpcResponse>;
  notify(method: string): void;
  stderr(): string;
}

function startAgainst(engineId: string, spec: Record<string, unknown>, seedSerena: boolean): Live {
  const root = mkdtempSync(join(tmpdir(), `ca-live-${engineId}-`));
  scratch.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  // An explicitly EMPTY home layer, so the developer's real settings cannot leak in and
  // make this suite pass or fail by whose machine ran it.
  writeFileSync(join(home, ".claude", "settings.json"), "{}");
  for (const [name, body] of Object.entries(SOURCES)) writeFileSync(join(project, name), body);
  if (seedSerena) {
    mkdirSync(join(project, ".serena"), { recursive: true });
    writeFileSync(join(project, ".serena", "project.yml"), SERENA_PROJECT_YML);
  }
  writeFileSync(
    join(project, ".claude", "settings.json"),
    JSON.stringify({ "code-analysis": { engine: engineId, engines: { [engineId]: spec } } }, null, 2),
  );

  const child = spawn(process.execPath, [SERVER], {
    cwd: project,
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
    stdio: ["pipe", "pipe", "pipe"],
  });
  running.push(child);

  let stderr = "";
  let nextId = 1;
  const pending = new Map<number | string, (r: RpcResponse) => void>();
  const read = makeLineReader((message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    const id = record["id"];
    if (typeof id !== "number" && typeof id !== "string") return;
    pending.get(id)?.(record as unknown as RpcResponse);
    pending.delete(id);
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => read(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    request(method, params?) {
      const id = nextId++;
      return new Promise<RpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} did not answer in ${CALL_TIMEOUT_MS}ms. stderr:\n${stderr}`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        child.stdin?.write(
          encode({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
        );
      });
    },
    notify(method) {
      child.stdin?.write(encode({ jsonrpc: "2.0", method }));
    },
    stderr: () => stderr,
  };
}

async function handshake(live: Live): Promise<void> {
  await live.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "live-engines", version: "0" },
  });
  live.notify("notifications/initialized");
}

async function toolNames(live: Live): Promise<string[]> {
  const response = await live.request("tools/list");
  const tools = (response.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  return tools.map((tool) => tool.name);
}

function textOf(response: RpcResponse): { text: string; isError: boolean } {
  const result = response.result as
    | { content?: Array<{ text?: string }>; isError?: boolean }
    | undefined;
  return {
    text: (result?.content ?? []).map((part) => part.text ?? "").join(""),
    isError: result?.isError === true,
  };
}

afterEach(async () => {
  for (const child of running.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.stdin?.end();
    try {
      child.kill("SIGTERM");
    } catch {
      continue;
    }
    await new Promise<void>((resolve) => {
      const escalate = setTimeout(() => {
        if (child.pid !== undefined) {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            // Gone between the check and the signal.
          }
        }
        resolve();
      }, 1_000);
      child.once("exit", () => {
        clearTimeout(escalate);
        resolve();
      });
    });
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The engine specs, verbatim — these ARE the documentation for how to configure one
// ---------------------------------------------------------------------------

/**
 * All three dashboard flags are required, and `--open-web-dashboard False` alone is not
 * enough: measured against 1.7.0, passing only that one leaves serena registering an
 * `open_dashboard` MCP tool (24 instead of 23), which changes the tool surface under
 * test. Every wrong spelling raises before the server starts — `--no-web-dashboard` is
 * `NoSuchOption`, a bare `--enable-web-dashboard` is `BadOptionUsage` — so a flag that
 * survives startup is a flag serena parsed.
 */
const SERENA_SPEC = {
  command: "serena",
  args: [
    "start-mcp-server",
    "--context",
    "claude-code",
    "--project-from-cwd",
    "--enable-web-dashboard",
    "False",
    "--open-web-dashboard",
    "False",
    "--enable-gui-log-window",
    "False",
  ],
  callTimeoutMs: CALL_TIMEOUT_MS,
};

/** Matches `plugins/mnemex/.mcp.json`. `MNEMEX_LSP` is mnemex's own switch, not ours. */
const MNEMEX_SPEC = {
  command: "mnemex",
  args: ["--mcp"],
  env: { MNEMEX_LSP: "true" },
  callTimeoutMs: CALL_TIMEOUT_MS,
};

// ---------------------------------------------------------------------------
// serena
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_SERENA)("serena, live", () => {
  test(
    "lists exactly the three tools its capabilities support",
    async () => {
      const live = startAgainst("serena", SERENA_SPEC, true);
      await handshake(live);
      expect(await toolNames(live)).toEqual([
        "code_search",
        "find_dependents",
        "find_implementations",
      ]);
    },
    LIVE_CASE_MS,
  );

  test(
    "answers code_search from the corpus, with a repo-relative path",
    async () => {
      const live = startAgainst("serena", SERENA_SPEC, true);
      await handshake(live);

      const { text, isError } = textOf(
        await live.request("tools/call", {
          name: "code_search",
          arguments: { query: "withFileLock" },
        }),
      );

      expect(isError).toBe(false);
      expect(text).toContain("served_by: serena/");
      // The path is the assertion that matters. An ABSOLUTE path here, or one carrying
      // the enclosing checkout's prefix, is the `--project-from-cwd` failure: serena
      // walked out of the corpus and searched a tree this test never wrote.
      expect(text).toContain("src/lock.ts");
      expect(text).not.toContain(tmpdir());
      // And it found the symbol rather than merely returning the file.
      expect(text).toContain("withFileLock");
    },
    LIVE_CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// mnemex
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_MNEMEX)("mnemex, live", () => {
  test(
    "lists exactly the five tools its capabilities support",
    async () => {
      const live = startAgainst("mnemex", MNEMEX_SPEC, false);
      await handshake(live);
      expect(await toolNames(live)).toEqual([
        "code_search",
        "find_dependencies",
        "find_dependents",
        "call_tree",
        "impact",
      ]);
    },
    LIVE_CASE_MS,
  );

  test(
    "an unindexed corpus produces an EXPLAINED empty answer, never a bare one",
    async () => {
      const live = startAgainst("mnemex", MNEMEX_SPEC, false);
      await handshake(live);

      const { text, isError } = textOf(
        await live.request("tools/call", {
          name: "code_search",
          arguments: { query: "withFileLock" },
        }),
      );

      // Success-shaped whatever the engine's state. One or two `isError` results early
      // in a session and the agent stops calling the tool for the rest of it.
      expect(isError).toBe(false);
      expect(text).toContain("served_by: mnemex/");

      // Either it answered, or it explained why it could not. The third possibility —
      // an empty answer with no note — is the silent failure this facade exists to
      // remove, and it is what an agent reads as "this codebase has no matches".
      const answered = text.includes("src/lock.ts");
      const explained = text.includes("index_missing") && text.includes("remedy:");
      expect(
        answered || explained,
        `mnemex returned an unexplained empty answer:\n${text}`,
      ).toBe(true);
    },
    LIVE_CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The switch itself
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_SERENA || !HAS_MNEMEX)("the facade switches between them", () => {
  test(
    "one settings key changes which tools exist and which engine serves the call",
    async () => {
      const serena = startAgainst("serena", SERENA_SPEC, true);
      const mnemex = startAgainst("mnemex", MNEMEX_SPEC, false);
      await handshake(serena);
      await handshake(mnemex);

      const serenaTools = await toolNames(serena);
      const mnemexTools = await toolNames(mnemex);

      // Same binary, same settings shape, one key different. The lists OVERLAP rather
      // than nest: a subset would be consistent with a gate that had learned to count
      // instead of to read.
      expect(serenaTools).not.toEqual(mnemexTools);
      expect(serenaTools).toContain("find_dependents");
      expect(mnemexTools).toContain("find_dependents");
      expect(serenaTools).toContain("find_implementations");
      expect(mnemexTools).not.toContain("find_implementations");
      expect(mnemexTools).toContain("impact");
      expect(serenaTools).not.toContain("impact");

      // And the answers name their own engine, so `served_by` is not decoration.
      const ask = (live: Live) =>
        live.request("tools/call", { name: "code_search", arguments: { query: "withFileLock" } });
      expect(textOf(await ask(serena)).text).toContain("served_by: serena/");
      expect(textOf(await ask(mnemex)).text).toContain("served_by: mnemex/");
    },
    LIVE_CASE_MS,
  );
});
