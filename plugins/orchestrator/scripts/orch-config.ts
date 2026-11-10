#!/usr/bin/env bun
// Reads and stores the per-user answer to where new ticket windows open when
// that is ambiguous (herdr inside tmux, tmux with herdr installed).
//
// Usage: bun orch-config.ts multiplexer [--set herdr|tmux | --claim-question]
//
//   multiplexer                    print this session's multiplexer and where new ticket windows open
//   multiplexer --claim-question   the same, plus who asks: "owned" (this session), "pending" (another
//                                  session is asking), or null (nothing to ask)
//   multiplexer --set herdr|tmux   store the answer and print the fresh result
//
// `--set` and `--claim-question` are refused to a session that owns a manager
// or child record: only triage opens ticket windows, so only triage answers.
//
// Output: one JSON document on stdout, a failure as { "error": "<sentence>" }.
// Exit codes: 0 done; 1 bad input, no multiplexer to report, a refused role, a
// malformed config.json, or a failed write.

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Multiplexer, type SessionMux, type WindowMux, withMultiplexer } from "./lib/mux-choice.ts";
import { type MuxDeps, type MuxResolution, resolveMux } from "./lib/mux-io.ts";
import { type Incarnation, type StoreContext, claudeConfigDirOf, ownPid, ownedKey, pidAlive, readIdentity, writeAtomic } from "./lib/record-store.ts";
import { readUserConfig, userConfigPath, writeUserConfig } from "./lib/user-config.ts";
import { lockIsStale, stateDir } from "./lib/window.ts";

const USAGE = "usage: orch-config.ts multiplexer [--set herdr|tmux | --claim-question]";
const QUESTION_LOCK_NAME = "multiplexer-question";

class CliError extends Error {}

type Command = { kind: "read" } | { kind: "claim" } | { kind: "set"; value: string };

function parseCommand(argv: readonly string[]): Command {
  const [topic, ...rest] = argv;
  if (topic !== "multiplexer") throw new CliError(USAGE);
  if (rest.length === 0) return { kind: "read" };
  if (rest.length === 1 && rest[0] === "--claim-question") return { kind: "claim" };
  if (rest.length === 2 && rest[0] === "--set") return { kind: "set", value: rest[1] ?? "" };
  throw new CliError(USAGE);
}

function isMultiplexer(value: string): value is Multiplexer {
  return value === "tmux" || value === "herdr";
}

function sessionView(session: SessionMux): Record<string, unknown> {
  return session.ok ? { mux: session.mux, source: session.source, nesting: session.nesting } : { error: session.error };
}

function windowsView(windows: WindowMux): Record<string, unknown> {
  return windows.ok ? { mux: windows.mux, source: windows.source, ask: windows.ask, note: windows.note } : { error: windows.error };
}

function resolutionView(res: MuxResolution, config: string): Record<string, unknown> {
  return {
    session: sessionView(res.session),
    windows: windowsView(res.windows),
    stored: res.stored,
    storedError: res.storedError,
    herdrInstalled: res.herdrInstalled,
    config,
  };
}

function refuseNonTriage(ctx: StoreContext): void {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID?.trim() ?? "";
  const key = sessionId === "" ? null : ownedKey(ctx, sessionId);
  const role = key === null ? null : readIdentity(ctx, key)?.role;
  if (role === "manager" || role === "child") throw new CliError("only the triage session stores this choice");
}

function questionLockPath(ctx: StoreContext): string {
  return join(ctx.stateDir, "locks", QUESTION_LOCK_NAME);
}

function readInfo(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function lockMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** The pid a live lock's info file names, or null while the holder is still writing it. */
function holderPid(infoText: string | null): number | null {
  if (infoText === null) return null;
  try {
    const pid = (JSON.parse(infoText) as { pid?: unknown }).pid;
    return typeof pid === "number" ? pid : null;
  } catch {
    return null;
  }
}

/** Tries once to create the lock and name `self` in it; false when it already exists. */
function createQuestionLock(lock: string, self: Incarnation): boolean {
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new CliError(`cannot create the lock ${lock}: ${err instanceof Error ? err.message : String(err)}`);
  }
  writeAtomic(join(lock, "info.json"), JSON.stringify({ pid: self.pid, name: QUESTION_LOCK_NAME, since: Date.now() }));
  return true;
}

/** Whether this session may ask: it took the lock, already holds it, or another live session does. */
function takeQuestion(lock: string, self: Incarnation): "owned" | "pending" {
  // Two attempts: a stale lock is removed once and the create is tried again.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (createQuestionLock(lock, self)) return "owned";
    const infoText = readInfo(join(lock, "info.json"));
    if (!lockIsStale({ infoText, lockMtimeMs: lockMtime(lock), now: Date.now(), pidAlive })) {
      return holderPid(infoText) === self.pid ? "owned" : "pending";
    }
    rmSync(lock, { recursive: true, force: true });
  }
  return "pending";
}

function claimQuestion(ctx: StoreContext, deps: MuxDeps, config: string): { view: Record<string, unknown>; code: number } {
  refuseNonTriage(ctx);
  const first = resolveMux(process.env, deps);
  const code = first.session.ok ? 0 : 1;
  if (!first.windows.ok || first.windows.ask === null) return { view: { ...resolutionView(first, config), question: null }, code };

  const self = ownPid(ctx.claudeConfigDir);
  if (self === null) throw new CliError("this process cannot name its own Claude Code process, so it cannot hold the question");
  const lock = questionLockPath(ctx);
  const question = takeQuestion(lock, self);
  if (question === "pending") return { view: { ...resolutionView(first, config), question }, code };

  // Another session may have stored the answer while this one took the lock.
  const fresh = resolveMux(process.env, deps);
  if (!fresh.windows.ok || fresh.windows.ask === null) {
    rmSync(lock, { recursive: true, force: true });
    return { view: { ...resolutionView(fresh, config), question: null }, code };
  }
  return { view: { ...resolutionView(fresh, config), question }, code };
}

function setMultiplexer(ctx: StoreContext, deps: MuxDeps, config: string, value: string): Record<string, unknown> {
  if (!isMultiplexer(value)) throw new CliError(`invalid multiplexer ${JSON.stringify(value)}; one of: herdr tmux`);
  refuseNonTriage(ctx);
  const current = readUserConfig(ctx.stateDir);
  if (!current.ok) throw new CliError(`${config} is not valid JSON in the expected shape; fix it by hand or delete it`);
  try {
    writeUserConfig(ctx.stateDir, withMultiplexer(current.config, value, Date.now()));
  } catch (err) {
    throw new CliError(`could not write ${config}: ${err instanceof Error ? err.message : String(err)}`);
  }
  rmSync(questionLockPath(ctx), { recursive: true, force: true });
  const fresh = resolveMux(process.env, deps);
  const forced = process.env.ORCHESTRATOR_MULTIPLEXER;
  return {
    ok: true,
    stored: value,
    config,
    session: sessionView(fresh.session),
    windows: windowsView(fresh.windows),
    ...(forced ? { note: `ORCHESTRATOR_MULTIPLEXER=${forced} still overrides this` } : {}),
  };
}

function main(argv: readonly string[]): { view: Record<string, unknown>; code: number } {
  const command = parseCommand(argv);
  const home = process.env.HOME || homedir();
  const ctx: StoreContext = { stateDir: stateDir(process.env, home), claudeConfigDir: claudeConfigDirOf(process.env, home) };
  const deps: MuxDeps = { home, stateDir: ctx.stateDir };
  const config = userConfigPath(ctx.stateDir);
  switch (command.kind) {
    case "read": {
      const res = resolveMux(process.env, deps);
      return { view: resolutionView(res, config), code: res.session.ok ? 0 : 1 };
    }
    case "claim":
      return claimQuestion(ctx, deps, config);
    case "set":
      return { view: setMultiplexer(ctx, deps, config, command.value), code: 0 };
  }
}

let exitCode: number;
try {
  const { view, code } = main(process.argv.slice(2));
  console.log(JSON.stringify(view));
  exitCode = code;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ error: message }));
  console.error(`orch-config: ${message}`);
  exitCode = 1;
}
process.exit(exitCode);
