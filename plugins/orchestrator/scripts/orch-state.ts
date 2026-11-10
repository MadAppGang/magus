#!/usr/bin/env bun
// Records what an orchestrated session is doing, for the status band and the
// herdr sidebar: its role and ticket, its task table, what it waits on, whether
// it needs the user, what shared environment it holds, and whether it is done.
//
// Usage: bun orch-state.ts <verb> [flags]
//
//   register --role triage|manager|child [--name N] [--ticket ID] [--ticket-url URL]
//   tasks                     the markdown progress table on stdin (| # | Step | Who | State |)
//   dep add <kind>:<ref> [--note T]      kind: session, pr (full URL), release ("<artifact> <version>")
//   dep done <kind>:<ref>
//   dep drop <kind>:<ref>
//   block "<reason>"          the session needs the user
//   unblock
//   hold "<what>"             the session holds a shared environment
//   release "<what>"
//   done                      after the final report
//   show [--table]            print the record (or its task table)
//   prune [--days 7]          delete records gone for that long, old claims and temp files
//
// The session is CLAUDE_CODE_SESSION_ID. Every verb but register, show and
// prune works on the record this session owns. Run one call at a time, never
// in the background: each file has one writer, and one session's calls must
// not overlap.
//
// Output: one JSON line { ok, key, sessionId, rev, record?, herdr } on stdout.
// `herdr` is "reported", "skipped" or "failed: <reason>": after every write the
// owning session publishes its record to the herdr sidebar when herdr is
// detected, and a failed publish never changes the exit code.
// `tasks` and `show --table` print the table on stdout and the JSON on stderr;
// `tasks` prints the normalised table on every exit code.
//
// State: ORCHESTRATOR_STATE_DIR, else ~/.claude/orchestrator. Claude Code's
// session files: CLAUDE_CONFIG_DIR, else ~/.claude.
//
// Exit codes:
//   0  done
//   1  bad input (unknown verb or flag, bad kind, a pr ref that is not a full URL,
//      a table with no rows, a role change, a live session owning the record)
//   2  no session id (CLAUDE_CODE_SESSION_ID unset)
//   3  this session owns no record (run the role skill, or register --role <role>),
//      or another live process holds the record under the same session id
//   4  the write failed; the message names the path

import { homedir } from "node:os";
import {
  type BindResult,
  type StoreContext,
  bindSession,
  claudeConfigDirOf,
  fillTicket,
  ownPid,
  ownedKey,
  prune,
  readRecord,
  safeCwd,
  updateProgress,
  writableKey,
} from "./lib/record-store.ts";
import {
  type OrchestratorOp,
  type OrchestratorRecord,
  type OrchestratorTask,
  isRole,
  normaliseTicketId,
  parseDepSpec,
  parseTasksTable,
  renderTasksTable,
} from "./lib/state-core.ts";
import { repoFromRemoteUrl } from "./lib/ticket.ts";
import { herdrIdsOf } from "./lib/herdr-meta.ts";
import { type HerdrOutcome, publishRecord } from "./lib/herdr-publish.ts";
import { sessionMuxNow } from "./lib/mux-io.ts";
import { mainCheckoutFromCommonDir, stateDir } from "./lib/window.ts";

const EXIT_BAD_INPUT = 1;
const EXIT_NO_SESSION = 2;
const EXIT_NOT_OWNED = 3;
const EXIT_WRITE_FAILED = 4;

/** Same shape the launcher accepts for `--ticket`. */
const TICKET_RE = /^[A-Za-z0-9#][A-Za-z0-9/#._-]{0,79}$/;
const TICKET_URL_RE = /^https:\/\/[^\s'"\\]{1,400}$/;

class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function die(code: number, message: string): never {
  throw new CliExit(code, message);
}

/** What `tasks` prints on stdout whatever the exit code, once stdin has been read. */
let tableOut: string | null = null;
/** Where the JSON line goes: stderr for `tasks` and `show --table`. */
let jsonToStderr = false;

function emit(value: Record<string, unknown>): void {
  const line = JSON.stringify(value);
  if (jsonToStderr) console.error(line);
  else console.log(line);
}

// --- arguments ----------------------------------------------------------------------

type Parsed = { positional: string[]; flags: Map<string, string>; booleans: Set<string> };

function parseFlags(argv: readonly string[], valueFlags: readonly string[], booleanFlags: readonly string[] = []): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (valueFlags.includes(name)) {
      const value = argv[i + 1];
      if (value === undefined) die(EXIT_BAD_INPUT, `--${name} needs a value`);
      if (flags.has(name)) die(EXIT_BAD_INPUT, `--${name} given more than once`);
      flags.set(name, value);
      i++;
    } else if (booleanFlags.includes(name)) {
      booleans.add(name);
    } else {
      die(EXIT_BAD_INPUT, `unknown flag ${JSON.stringify(token)}`);
    }
  }
  return { positional, flags, booleans };
}

function exactPositional(parsed: Parsed, count: number, usage: string): string[] {
  if (parsed.positional.length !== count) die(EXIT_BAD_INPUT, `usage: ${usage}`);
  return parsed.positional;
}

// --- environment ----------------------------------------------------------------------

function storeContext(): StoreContext {
  const home = process.env.HOME || homedir();
  try {
    return { stateDir: stateDir(process.env, home), claudeConfigDir: claudeConfigDirOf(process.env, home) };
  } catch (err) {
    return die(EXIT_BAD_INPUT, err instanceof Error ? err.message : String(err));
  }
}

function sessionIdOrExit(): string {
  const id = process.env.CLAUDE_CODE_SESSION_ID?.trim();
  if (!id) die(EXIT_NO_SESSION, "CLAUDE_CODE_SESSION_ID is not set: run this from a Claude Code session");
  return id;
}

function gitOut(args: string[], cwd: string): string | null {
  try {
    const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** The main checkout of `cwd`'s repository, or `cwd` itself outside a repository. */
function productOf(cwd: string): string {
  const common = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return (common !== null ? mainCheckoutFromCommonDir(common) : null) ?? cwd;
}

function originRepoOf(cwd: string): string | null {
  const url = gitOut(["remote", "get-url", "origin"], cwd);
  return url === null ? null : repoFromRemoteUrl(url);
}

function writeFailed(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  return die(EXIT_WRITE_FAILED, `the state write failed: ${message}`);
}

/**
 * The record this process may write, or exit 3 naming why: the session owns
 * no record, another live process holds it under the same session id, or this
 * process cannot tell whether the live holder is itself.
 */
function ownedOrExit(ctx: StoreContext, sessionId: string): string {
  const owned = writableKey(ctx, sessionId, ownPid(ctx.claudeConfigDir));
  if (owned.ok) return owned.key;
  if (owned.reason === "unknown-incarnation") {
    die(
      EXIT_NOT_OWNED,
      `record ${owned.key} of session ${sessionId} is held by a live Claude Code process${owned.pid !== null ? ` (pid ${owned.pid})` : ""}, ` +
        "and this command could not find the Claude Code process it runs under among its nearest parent processes, so it cannot tell " +
        "whether that holder is its own session; it writes nothing. Run it directly from the session's Bash tool, not from a nested script or another terminal",
    );
  }
  if (owned.reason === "live-owner") {
    die(
      EXIT_NOT_OWNED,
      `record ${owned.key} belongs to another live process of session ${sessionId}${owned.pid !== null ? ` (pid ${owned.pid})` : ""}; ` +
        "this process resumed the same session while that one runs, so it writes nothing to the record",
    );
  }
  return die(
    EXIT_NOT_OWNED,
    "this session owns no orchestration record: run its role skill (/orchestrator:triage, /orchestrator:manager or /orchestrator:child), " +
      "or bun orch-state.ts register --role <role>",
  );
}

function result(key: string | null, sessionId: string, record: OrchestratorRecord | null, withRecord: boolean, herdr: HerdrOutcome = "skipped"): Record<string, unknown> {
  return {
    ok: true,
    key,
    sessionId,
    rev: record?.rev ?? 0,
    ...(withRecord ? { record } : {}),
    herdr,
  };
}

/**
 * Publishes a record this session owns, after a successful write. Only the
 * owner reaches this (register binds it; every other write verb checks
 * ownership first), so a nested session never publishes.
 */
function publish(record: OrchestratorRecord | null): HerdrOutcome {
  return record === null ? "skipped" : publishRecord(record, process.env);
}

// --- verbs ------------------------------------------------------------------------------

function register(argv: readonly string[]): void {
  const parsed = parseFlags(argv, ["role", "name", "ticket", "ticket-url"]);
  exactPositional(parsed, 0, "register --role triage|manager|child [--name N] [--ticket ID] [--ticket-url URL]");
  const role = parsed.flags.get("role");
  if (role === undefined) die(EXIT_BAD_INPUT, "--role is required: triage, manager or child");
  if (!isRole(role)) die(EXIT_BAD_INPUT, `invalid role ${JSON.stringify(role)}; one of: triage manager child`);
  const sessionId = sessionIdOrExit();
  const ctx = storeContext();
  const home = process.env.HOME || homedir();
  const cwd = safeCwd(process.env, home);
  const now = Date.now();

  // A stray argument never fails the skill's line: an unusable ticket or URL is stored as null.
  const ticketArg = parsed.flags.get("ticket")?.trim() ?? "";
  const urlArg = parsed.flags.get("ticket-url")?.trim() ?? "";
  const ticketId = TICKET_RE.test(ticketArg) ? normaliseTicketId(ticketArg, originRepoOf(cwd)) : null;
  if (ticketArg !== "" && ticketId === null) console.error(`orch-state: ignoring --ticket ${JSON.stringify(ticketArg)}: not a ticket id`);
  const ticket = ticketId === null ? null : { id: ticketId, url: TICKET_URL_RE.test(urlArg) ? urlArg : null };

  const session = sessionMuxNow(process.env, { home, stateDir: ctx.stateDir });
  let bound: BindResult;
  try {
    bound = bindSession(ctx, {
      sessionId,
      claimId: process.env.ORCHESTRATOR_CLAIM?.trim() || null,
      cwd,
      herdr: herdrIdsOf(process.env, session),
      now,
      self: ownPid(ctx.claudeConfigDir),
      allowClear: true,
      register: { role, name: parsed.flags.get("name") ?? null, ticket, product: () => productOf(cwd) },
    });
  } catch (err) {
    writeFailed(err);
  }
  if (!bound.ok) {
    if (bound.reason === "live-owner") {
      die(
        EXIT_BAD_INPUT,
        `record ${bound.key} belongs to the live session ${bound.sessionId}${bound.pid !== null ? ` (pid ${bound.pid})` : ""}; ` +
          (role === "triage" ? "one product has one triage" : "a session cannot take a live session's record"),
      );
    }
    die(EXIT_BAD_INPUT, `invalid session id ${JSON.stringify(sessionId)}`);
  }
  if (bound.identity.role !== role) {
    die(EXIT_BAD_INPUT, `this session is already ${bound.identity.role}; a session's role does not change`);
  }
  if (ticket !== null && bound.identity.ticket === null) {
    try {
      fillTicket(ctx, bound.identity, ticket, now);
    } catch (err) {
      writeFailed(err);
    }
  }
  const record = readRecord(ctx, bound.key);
  emit({ ...result(bound.key, sessionId, record, true, publish(record)), route: bound.route });
}

async function tasks(argv: readonly string[]): Promise<void> {
  jsonToStderr = true;
  const parsed = parseFlags(argv, []);
  exactPositional(parsed, 0, "tasks < table.md");
  const text = await Bun.stdin.text();
  const table: OrchestratorTask[] | null = parseTasksTable(text);
  if (table === null) die(EXIT_BAD_INPUT, "no progress table on stdin: a markdown table with the header | # | Step | Who | State | and at least one row");
  tableOut = renderTasksTable(table);
  writeOp({ op: "tasks", tasks: table });
}

/** Applies a progress operation to the record this session owns and reports it. */
function writeOp(op: OrchestratorOp): void {
  const sessionId = sessionIdOrExit();
  const ctx = storeContext();
  const key = ownedOrExit(ctx, sessionId);
  try {
    updateProgress(ctx, key, op, Date.now());
  } catch (err) {
    writeFailed(err);
  }
  const record = readRecord(ctx, key);
  if (op.op === "tasks" && record !== null) tableOut = renderTasksTable(record.tasks);
  emit(result(key, sessionId, record, false, publish(record)));
}

function dep(argv: readonly string[]): void {
  const sub = argv[0];
  const parsed = parseFlags(argv.slice(1), sub === "add" ? ["note"] : []);
  const usage = "dep add <kind>:<ref> [--note T] | dep done <kind>:<ref> | dep drop <kind>:<ref>";
  if (sub !== "add" && sub !== "done" && sub !== "drop") die(EXIT_BAD_INPUT, `usage: ${usage}`);
  const [spec] = exactPositional(parsed, 1, usage);
  const dependency = parseDepSpec(spec ?? "");
  if (!dependency.ok) die(EXIT_BAD_INPUT, dependency.error);
  const { kind, ref } = dependency;
  if (sub === "add") writeOp({ op: "dep-add", kind, ref, note: parsed.flags.get("note") ?? null });
  else if (sub === "done") writeOp({ op: "dep-done", kind, ref });
  else writeOp({ op: "dep-drop", kind, ref });
}

function textVerb(verb: "block" | "hold" | "release", argv: readonly string[]): void {
  const parsed = parseFlags(argv, []);
  const [text] = exactPositional(parsed, 1, `${verb} "<text>"`);
  const value = (text ?? "").trim();
  if (value === "") die(EXIT_BAD_INPUT, `${verb} needs a non-empty text`);
  if (verb === "block") writeOp({ op: "block", reason: value });
  else if (verb === "hold") writeOp({ op: "hold", what: value });
  else writeOp({ op: "release", what: value });
}

function bareVerb(verb: "unblock" | "done", argv: readonly string[]): void {
  exactPositional(parseFlags(argv, []), 0, verb);
  writeOp(verb === "done" ? { op: "done" } : { op: "unblock" });
}

function show(argv: readonly string[]): void {
  const parsed = parseFlags(argv, [], ["table"]);
  exactPositional(parsed, 0, "show [--table]");
  const asTable = parsed.booleans.has("table");
  if (asTable) jsonToStderr = true;
  const sessionId = sessionIdOrExit();
  const ctx = storeContext();
  const key = ownedKey(ctx, sessionId);
  const record = key === null ? null : readRecord(ctx, key);
  if (asTable && record !== null) process.stdout.write(renderTasksTable(record.tasks));
  emit(result(key, sessionId, record, true));
}

function pruneVerb(argv: readonly string[]): void {
  const parsed = parseFlags(argv, ["days"]);
  exactPositional(parsed, 0, "prune [--days 7]");
  const daysText = parsed.flags.get("days") ?? "7";
  const days = Number(daysText);
  if (!/^\d+(\.\d+)?$/.test(daysText) || !Number.isFinite(days)) die(EXIT_BAD_INPUT, `invalid --days ${JSON.stringify(daysText)}`);
  const ctx = storeContext();
  const pruned = prune(ctx, { days, now: Date.now() });
  emit({ ok: true, pruned });
}

// --- entry --------------------------------------------------------------------------------

const VERBS = "register tasks dep block unblock hold release done show prune";

async function main(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv;
  switch (verb) {
    case "register":
      return register(rest);
    case "tasks":
      return tasks(rest);
    case "dep":
      return dep(rest);
    case "block":
    case "hold":
    case "release":
      return textVerb(verb, rest);
    case "unblock":
    case "done":
      return bareVerb(verb, rest);
    case "show":
      return show(rest);
    case "prune":
      return pruneVerb(rest);
    default:
      die(EXIT_BAD_INPUT, verb === undefined ? `a verb is required; one of: ${VERBS}` : `unknown verb ${JSON.stringify(verb)}; one of: ${VERBS}`);
  }
}

let exitCode = 0;
try {
  await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliExit) {
    console.error(`orch-state: ${err.message}`);
    exitCode = err.code;
  } else {
    console.error(`orch-state: ${err instanceof Error ? err.message : String(err)}`);
    exitCode = EXIT_BAD_INPUT;
  }
}
if (tableOut !== null) process.stdout.write(tableOut);
process.exit(exitCode);
