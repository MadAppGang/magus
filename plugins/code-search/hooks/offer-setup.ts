#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup|clear`) — when code-search setup is incomplete in this
 * project, tell the model to offer it: set up now, not now, or ignore for this project.
 *
 * The decision is `mcp/setup/check.ts`'s fast path, the same evaluator the setup CLI's
 * `status` and the MCP server's `setup_incomplete` note use, so the three cannot disagree.
 * That path reads settings files and stats PATH entries and index markers. It spawns
 * nothing and fetches nothing, which is what keeps this hook inside its 5 s timeout.
 *
 * SILENT unless the headline state prompts (`NEEDS_SETUP`): ready, `none` (no engine, by
 * choice) and `dismissed` print nothing at all.
 *
 * `compact` and `resume` are left out of the matcher on purpose: a user who answered
 * "Not now" is not asked again in the same session. The MCP server's `setup_incomplete`
 * note covers a compacted context and subagents.
 *
 * Output, when it prompts: `hookSpecificOutput.additionalContext` carries the full advice
 * for the model; `systemMessage` tells the user in one line why Claude may ask.
 *
 * On any internal error: exit 0, nothing on stdout, one line on stderr naming the error and
 * this file. A setup reminder is never worth a hook-error notice on every session start.
 * That is why the evaluator is imported dynamically, inside the error boundary: a static
 * import that failed to load would exit 1 before any handler existed.
 */

import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CheckInput, CheckIo, SetupReport } from "../mcp/setup/check";

const HOOK_FILE = fileURLToPath(import.meta.url);
/** This file lives in `<root>/hooks/`. */
const PLUGIN_ROOT = resolve(dirname(HOOK_FILE), "..");
/** Stdin is the SessionStart payload, which the host closes at once. Never wait past this. */
const STDIN_WAIT_MS = 1_000;
/** Inside the 5 s hooks.json timeout, so a stall ends in silence, not a hook error. */
const WATCHDOG_MS = 4_000;

export interface OfferInput {
  /** The SessionStart payload, or undefined when stdin was empty or not JSON. */
  payload: unknown;
  env: Readonly<Record<string, string | undefined>>;
  pluginRoot: string;
  io: CheckIo;
  /** `evaluateSetup` from `mcp/setup/check.ts`: the fast path, never a spawn. */
  evaluate: (input: CheckInput, io: CheckIo) => SetupReport;
  /** `SETUP_COMMAND` from `mcp/core/setup-state.ts`. */
  setupCommand: string;
}

/**
 * The hook's stdout, or undefined for silence.
 *
 * Project: `CLAUDE_PROJECT_DIR` (set for every hook), then the payload's `cwd`, then the
 * process cwd. Home: `HOME`, then the OS's answer.
 */
export function offerSetup(input: OfferInput): string | undefined {
  const { env, pluginRoot, io } = input;
  const declared = env["CLAUDE_PROJECT_DIR"];
  const projectDir =
    declared !== undefined && declared !== "" ? declared : (cwdOf(input.payload) ?? process.cwd());
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();

  const report = input.evaluate({ pluginRoot, projectDir, home }, io);
  const advice = report.advice;
  if (advice === undefined) return undefined;

  const first = report.findings.find((f) => f.level === "problem" && f.code === report.headline);
  const what = first?.message ?? report.headline;
  return JSON.stringify({
    systemMessage:
      `code-search setup is incomplete (${report.headline}): ${what} ` +
      `Claude will offer to set it up before it first searches this codebase; ${input.setupCommand} runs it any time.`,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: advice.full,
    },
  });
}

function cwdOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const cwd = (payload as Record<string, unknown>)["cwd"];
  return typeof cwd === "string" && cwd !== "" ? cwd : undefined;
}

async function readPayload(): Promise<unknown> {
  if (process.stdin.isTTY === true) return undefined;
  const text = await new Promise<string>((done) => {
    let data = "";
    const finish = (): void => {
      clearTimeout(timer);
      done(data);
    };
    const timer = setTimeout(finish, STDIN_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
  try {
    return text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function fail(error: unknown): never {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`code-search offer-setup (${HOOK_FILE}): ${reason}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  setTimeout(() => fail(new Error(`no answer within ${WATCHDOG_MS} ms`)), WATCHDOG_MS).unref();

  try {
    const [{ evaluateSetup }, { makeNodeCheckIo }, { SETUP_COMMAND }] = await Promise.all([
      import("../mcp/setup/check"),
      import("../mcp/setup/node-io"),
      import("../mcp/core/setup-state"),
    ]);
    const payload = await readPayload();
    const out = offerSetup({
      payload,
      env: process.env,
      pluginRoot: PLUGIN_ROOT,
      io: makeNodeCheckIo(),
      evaluate: evaluateSetup,
      setupCommand: SETUP_COMMAND,
    });
    if (out !== undefined) {
      await new Promise<void>((done) => process.stdout.write(`${out}\n`, () => done()));
    }
  } catch (error) {
    fail(error);
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
