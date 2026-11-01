#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup`) — start a new linked git worktree from the main tree's
 * search index instead of from nothing.
 *
 * The decision is rows 0-5 of the plan's table here (static facts, no lock, no spawn), then
 * `inheritWorktreeIndex` for the rest: one lock, refresh main if it is behind, copy the
 * index, let the engine's own incremental update catch it up, verify, record the outcome.
 * Any failure rolls back what the engine's index declaration owns in this worktree and
 * leaves today's setup question. Nothing is resumed and nothing is half-kept.
 *
 * SILENT unless it started from an index, or tried and failed with something to say. Silent in
 * the main tree, with no engine chosen, with setup dismissed, for an engine that keeps its
 * own index per worktree or has no copy recipe, when the main tree has no index, and inside a
 * claudish session (`CLAUDISH_PANE_CHILD=1`), which has no person to tell.
 *
 * Output, when it speaks: `systemMessage` for the user; `hookSpecificOutput.additionalContext`
 * carries the setup advice, only after a failure that leaves the worktree without an index.
 *
 * On any internal error: exit 0, nothing on stdout, one line on stderr naming the error and
 * this file. Modules are imported dynamically, inside the error boundary: a static import
 * that failed to load would exit 1 before any handler existed.
 */

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Env } from "../mcp/core/index-descriptor";
import type { InheritOutcome } from "../mcp/core/worktree";
import type { evaluateSetup } from "../mcp/setup/check";
import type { WorktreeIo } from "../mcp/worktree/ports";

const HOOK_FILE = fileURLToPath(import.meta.url);
/** This file lives in `<root>/hooks/`. */
const PLUGIN_ROOT = resolve(dirname(HOOK_FILE), "..");
/** Stdin is the SessionStart payload, which the host closes at once. Never wait past this. */
const STDIN_WAIT_MS = 1_000;
/** The use case's own deadline: inside the 120 s hooks.json timeout, with room to answer. */
const BUDGET_MS = 105_000;
/**
 * Past the budget, a stall ends in silence rather than a hook-timeout notice. A timer cannot
 * fire while the synchronous SQLite work (`VACUUM INTO`, `integrity_check`) holds the thread, so
 * for that stretch the host's own 120 s kill is the real bound; a killed run is recovered by the
 * next start (row 6).
 */
const WATCHDOG_MS = 115_000;

export interface WorktreeStartInput {
  /** The SessionStart payload, or undefined when stdin was empty or not JSON. */
  payload: unknown;
  env: Env;
  pluginRoot: string;
  io: WorktreeIo;
  /** `evaluateSetup` from `mcp/setup/check.ts`: the fast path, never a spawn. */
  evaluate: typeof evaluateSetup;
}

/**
 * The hook's stdout, or undefined for silence.
 *
 * Project: `CLAUDE_PROJECT_DIR` (set for every hook), then the payload's `cwd`, then the
 * process cwd. Home: `HOME`, then the OS's answer.
 */
export async function worktreeStart(input: WorktreeStartInput): Promise<string | undefined> {
  const { env, pluginRoot, io } = input;
  // Row 0.
  if (env["CLAUDISH_PANE_CHILD"] === "1") return undefined;

  const [worktree, settings, catalog, inherit, containment] = await Promise.all([
    import("../mcp/core/worktree"),
    import("../mcp/core/settings"),
    import("../mcp/adapters/catalog"),
    import("../mcp/worktree/inherit"),
    import("../mcp/worktree/containment"),
  ]);
  const { whichOnPath } = await import("../mcp/setup/check");

  const declared = env["CLAUDE_PROJECT_DIR"];
  const projectDir =
    declared !== undefined && declared !== "" ? declared : (cwdOf(input.payload) ?? process.cwd());
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();

  // Rows 1-5: static facts, answered before the lock. `eligibility` is the table; the state
  // and the worktree's own marker belong to rows 6-8, which the use case answers under the lock.
  const layout = worktree.resolveWorktree(projectDir, io);
  if (layout.kind !== "linked") return undefined;

  const loaded = settings.loadSettings({ home, projectDir, readFileText: (path) => io.readText(path) }, layout);
  const rel = (path: string): string => (layout.relative === "" ? path : join(layout.relative, path));
  const statePath = worktree.worktreeStatePath(env, home, projectDir);

  // A start that never finished (a dead `copying` record) is cleaned up whatever rows 1-5 say
  // today: main may have lost its index, the engine may have left PATH, been changed or had setup
  // dismissed since, and the facade holds the index back until the record is gone. The rollback
  // uses the engine the dead run recorded.
  const currentEngine = loaded.settings.engine;
  const prior = worktree.parseWorktreeState(io.readText(statePath), layout.incarnation);
  const recovering = prior?.phase === "copying";
  const engineId = recovering ? prior.engine : currentEngine;
  if (engineId === undefined || engineId === false) return undefined;
  const descriptor = catalog.catalogEntry(engineId)?.index;
  if (descriptor === undefined || descriptor.worktrees !== "copy") return undefined;

  const updateCommand = descriptor.copy.update[0];
  const verdict = worktree.eligibility({
    claudishChild: false,
    layout,
    engineId: currentEngine,
    setup: loaded.settings.setup ?? "active",
    descriptor,
    commandOnPath: updateCommand !== undefined && whichOnPath(updateCommand, env["PATH"], io) !== undefined,
    mainMarker: containment.containedKind(io, layout.mainRoot, rel(descriptor.path)),
    worktreeMarker: "missing",
    ownedTracked: false,
    state: undefined,
  });
  if (!recovering && !verdict.ok) return undefined;
  // A recovery the table no longer wants (another engine, no engine, setup dismissed, main without
  // an index) cleans up and says nothing; there is no start in progress to report.
  const speaks = verdict.ok && currentEngine === engineId;

  const outcome = await inherit.inheritWorktreeIndex(
    { layout, projectDir, home, env, engineId, descriptor, budgetMs: BUDGET_MS },
    io,
  );
  const logLine = describeOutcome(outcome);
  if (logLine !== undefined) process.stderr.write(`${logLine}\n`);
  if (!speaks) return undefined;

  // A start that lost the lock race: the holder may have finished. A marker that is there
  // now means a start succeeded elsewhere, and there is nothing to say.
  if (
    outcome.kind === "blocked" &&
    outcome.stage === "timeout" &&
    containment.containedKind(io, layout.root, rel(descriptor.path)) !== "missing"
  ) {
    return undefined;
  }

  const rendered = worktree.renderOutcome(outcome);
  if (rendered.systemMessage === undefined) return undefined;

  let additionalContext: string | undefined;
  if (rendered.adviceNeeded) {
    // The question is today's setup question. The record may not have been written (an
    // unwritable cache, a lock timeout), so the evaluator is handed an in-memory `failed`
    // record: nothing is written, and the next start tries again.
    const statePath = worktree.worktreeStatePath(env, home, projectDir);
    const failed = JSON.stringify({
      phase: "failed",
      engine: engineId,
      incarnation: layout.incarnation,
      updatedAt: io.now(),
      ...(outcome.kind === "blocked" ? { stage: outcome.stage } : {}),
    });
    // A layer over `io`, not a copy of it: methods keep their own receiver.
    const view = Object.create(io, {
      readText: { value: (path: string): string | undefined => (path === statePath ? failed : io.readText(path)) },
    }) as WorktreeIo;
    additionalContext = input.evaluate({ pluginRoot, projectDir, home }, view).advice?.full;
  }

  return JSON.stringify({
    systemMessage: rendered.systemMessage,
    ...(additionalContext === undefined
      ? {}
      : { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  });
}

/** One line for stderr: what happened, for whoever reads the hook log. Never shown to the user. */
function describeOutcome(outcome: InheritOutcome): string | undefined {
  if (outcome.kind === "blocked") return `code-search worktree-start: blocked at ${outcome.stage}: ${outcome.reason}`;
  if (outcome.kind === "skipped") return undefined;
  return `code-search worktree-start: inherited (${outcome.refresh}, ${String(outcome.changed ?? "unknown")} changed)`;
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
  process.stderr.write(`code-search worktree-start (${HOOK_FILE}): ${reason}\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  setTimeout(() => fail(new Error(`no answer within ${WATCHDOG_MS} ms`)), WATCHDOG_MS).unref();

  try {
    if (process.env["CLAUDISH_PANE_CHILD"] === "1") process.exit(0);
    const [{ evaluateSetup }, { makeNodeWorktreeIo }] = await Promise.all([
      import("../mcp/setup/check"),
      import("../mcp/worktree/node-io"),
    ]);
    const payload = await readPayload();
    const out = await worktreeStart({
      payload,
      env: process.env,
      pluginRoot: PLUGIN_ROOT,
      io: makeNodeWorktreeIo(process.env),
      evaluate: evaluateSetup,
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
