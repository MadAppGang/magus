#!/usr/bin/env bun
// Runs a ticket manager's child sessions as panes beside the manager, in the
// multiplexer the manager runs in: a tmux pane of its window, or a herdr pane of
// its tab. Laid out as main-columns in both: the manager full height on the
// left, the children in columns of two.
//
// Usage: bun child-pane.ts <command> …
//
//   open --name <slug> --colour <c> [--dir <main checkout>] [--ticket <id>] [--ticket-url <url>]
//        [--model M] [--effort E] [--launch <cmd>] [--past-limit] [--no-wait]
//   wait --pane <p> [--until up|detected|idle|working|blocked|done | --pattern <text> …] [--timeout-ms N]
//   prompt --pane <p> --prompt-file <path|->
//   send --pane <p> [--text <t> | --text-file <path|->] [--key <name>]
//   trust --pane <p>                     type a plain `claude`, to accept the trust dialog
//   retype --pane <p>                    type the child's launch line again
//   read --pane <p> [--lines N]          print the screen as text
//   list                                 the children and their agent states
//   close --pane <p> [--force]
//   layout                               re-apply the layout now
//
// `open`, `close` and `layout` are the only commands that write the registry
// (<state dir>/panes/<manager key>.json), and they do every read and write
// under a per-manager lock. `open` and `retype` also take the launcher's lock
// on the checkout, first and outside the manager lock, handed to a detached
// process until Claude Code is up. Only the live owner of a manager record may
// run this, inside tmux or herdr.
//
// An entry counts only while the multiplexer lists its pane with the witness
// it had when it was opened (herdr's terminal id; tmux `<pane_id>:<pane_pid>`),
// and that witness is read again right before every input, because both
// address input by pane id alone and a server restart reuses ids.
//
// Under tmux, the agent in a pane is Claude Code in the foreground with a
// session file tied to the pane by process; until that file exists, the agent
// reads as `starting`, which no wait target but the pane itself reaches.
//
// Output: one JSON document on stdout (plain text for a successful `read`); a
// failure is { "error": "<sentence>", … }.
//
// Exit codes:
//   0   done (for open and close, also when the layout was refused or failed with nothing stranded)
//   1   bad input, a multiplexer error, the registry could not be read or written, a shell never ready,
//       a claim expired, a registry of the other multiplexer, `wait --until done` under tmux
//   2   open: the checkout is off its default branch
//   3   open: the worktree exists, or a live child already has that name
//   4   wait, prompt: timeout
//   5   the pane is gone, or its witness changed; no further input was sent
//   6   a lock stayed busy for 120 s (status "checkout-busy" for the checkout's); nothing was created
//   7   wait --until up, prompt: the checkout is untrusted
//   8   prompt: not sent
//   9   not a manager, or not the record's live owner
//   10  this session runs in neither tmux nor herdr, its own pane is unknown, or a
//       forced ORCHESTRATOR_MULTIPLEXER names the outer multiplexer
//   11  not a child pane of this manager
//   12  open: 10 children are open and --past-limit was not given
//   13  the pane's state does not allow it; "status" says which
//   14  the layout left a pane outside the tab; layout.error names the command that puts it back
//   15  layout: refused for panes the orchestrator did not open

import { mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type Multiplexer, NOT_IN_A_MULTIPLEXER, resolveHerdrBin } from "../hooks/lib/mux-core.ts";
import { MAX_ENDED, type ChildPaneCommand, type Occupant, type PaneEntry, type PanesFile, familyOf, occupantOf, parseChildPaneArgs, parsePanesFile, reconcile, serializePanesFile } from "./lib/child-pane-core.ts";
import { herdrRunner } from "./lib/herdr-cli.ts";
import { type AgentSeen, type Family, type LayoutOutcome, type PaneIO, paneIO } from "./lib/mux/io.ts";
import { sessionMuxNow } from "./lib/mux/session.ts";
import type { LivePanes } from "./lib/pane-layout.ts";
import { type StoreContext, aliasKey, claimPath, claudeConfigDirOf, handLockTo, identityPath, ownPid, pidAlive, readIdentity, writableKey, writeAtomic } from "./lib/record-store.ts";
import { lockIsStale, lockPathFor, mainCheckoutFromCommonDir, promptStillInInput, screenShowsTrustError, stateDir } from "./lib/window.ts";

const EXIT_ERROR = 1;
const EXIT_NAME_TAKEN = 3;
const EXIT_TIMEOUT = 4;
const EXIT_GONE = 5;
const EXIT_LOCK_BUSY = 6;
const EXIT_UNTRUSTED = 7;
const EXIT_NOT_MANAGER = 9;
const EXIT_NO_PANE = 10;
const EXIT_NOT_CHILD = 11;
const EXIT_OVER_LIMIT = 12;
const EXIT_STATE = 13;
const EXIT_STRANDED = 14;
const EXIT_REFUSED = 15;

const CHILD_LIMIT = 10;
const LOCK_WAIT_MS = 120_000;
const LOCK_POLL_MS = 250;
const PRINT_LINE_TIMEOUT_MS = 60_000;
const SHELL_READY_MS = 15_000;
const SHELL_STABLE_MS = 700;
const SHELL_POLL_MS = 250;
const SHELL_SETTLE_MS = 1_500;
const BIND_WAIT_MS = 60_000;
const WORKING_WAIT_MS = 60_000;
const DELIVER_TIMEOUT_MS = 240_000;
const SEND_PAUSE_MS = 2_000;
const FAILURES_TO_GIVE_UP = 3;
const SCREEN_LINES = 200;

const LAUNCHER = join(import.meta.dir, "ticket-window.ts");

/** What a command answers with. `text` replaces the JSON on stdout. */
interface Outcome {
  view: Record<string, unknown>;
  code: number;
  text?: string;
}

/** A failure: its sentence and fields become the JSON document, its code the exit code. */
class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly fields: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function warn(message: string): void {
  console.error(`child-pane: ${message}`);
}

// --- locks --------------------------------------------------------------------------------

const heldLocks = new Set<string>();

function releaseLock(path: string): void {
  rmSync(path, { recursive: true, force: true });
  heldLocks.delete(path);
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function lockIsDead(lock: string): boolean {
  let infoText: string | null;
  try {
    infoText = readTextOrNull(join(lock, "info.json"));
  } catch {
    infoText = "";
  }
  let lockMtimeMs: number | null;
  try {
    lockMtimeMs = statSync(lock).mtimeMs;
  } catch {
    lockMtimeMs = null;
  }
  return lockIsStale({ infoText, lockMtimeMs, now: Date.now(), pidAlive });
}

/** Takes a lock directory, waiting up to `waitMs`. False when it stayed busy. */
function takeLock(lock: string, name: string, waitMs: number): boolean {
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock); // the atomic step
      heldLocks.add(lock);
      writeAtomic(join(lock, "info.json"), JSON.stringify({ pid: process.pid, name, since: Date.now() }));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw new CliExit(EXIT_ERROR, `cannot create the lock ${lock}: ${String(err)}`);
    }
    if (lockIsDead(lock)) {
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) return false;
    Bun.sleepSync(LOCK_POLL_MS);
  }
}

// --- who is asking, and where -------------------------------------------------------------

interface Manager {
  ctx: StoreContext;
  home: string;
  key: string;
}

interface Session extends Manager {
  mux: Multiplexer;
  io: PaneIO;
  /** This session's own pane. */
  main: string;
}

const NOT_MANAGER = "only a ticket's manager opens child panes; this session is";
const NO_MUX_LEAD = "children open beside this session only inside a multiplexer (tmux or herdr)";

function authorise(): Manager {
  const home = process.env.HOME || homedir();
  const ctx: StoreContext = { stateDir: stateDir(process.env, home), claudeConfigDir: claudeConfigDirOf(process.env, home) };
  const owned = writableKey(ctx, process.env.CLAUDE_CODE_SESSION_ID?.trim() ?? "", ownPid(ctx.claudeConfigDir));
  if (!owned.ok) {
    if (owned.reason === "not-owned") throw new CliExit(EXIT_NOT_MANAGER, `${NOT_MANAGER} not orchestrated`);
    if (owned.reason === "live-owner") throw new CliExit(EXIT_NOT_MANAGER, `${NOT_MANAGER} refused: a second live process on this session (pid ${owned.pid ?? "unknown"})`);
    throw new CliExit(EXIT_NOT_MANAGER, `${NOT_MANAGER} refused: this process cannot name its own Claude Code process`);
  }
  const role = readIdentity(ctx, owned.key)?.role ?? "not orchestrated";
  if (role !== "manager") throw new CliExit(EXIT_NOT_MANAGER, `${NOT_MANAGER} ${role}`);
  return { ctx, home, key: owned.key };
}

/**
 * The session's multiplexer and its own pane. A force that names the outer of
 * two nested multiplexers is refused here, before any pane call: the pane it
 * would name hosts the inner multiplexer, not this session.
 */
function locate(m: Manager): Session {
  const herdr = herdrRunner(resolveHerdrBin(process.env, m.home) ?? "herdr");
  const session = sessionMuxNow(process.env, { run: herdr, home: m.home, stateDir: m.ctx.stateDir });
  if (!session.ok) {
    throw new CliExit(EXIT_NO_PANE, `${NO_MUX_LEAD}; ${session.error === NOT_IN_A_MULTIPLEXER ? "this session is in neither" : session.error}`);
  }
  const outer = session.source === "forced" && ((session.mux === "tmux" && session.nesting === "herdr-in-tmux") || (session.mux === "herdr" && session.nesting === "tmux-in-herdr"));
  if (outer) {
    const other = session.mux === "tmux" ? "herdr" : "tmux";
    throw new CliExit(EXIT_NO_PANE, `ORCHESTRATOR_MULTIPLEXER=${session.mux} names the outer multiplexer here; its pane holds ${other}, not this session`);
  }
  const io = paneIO(session.mux, { herdr, home: m.home });
  const main = io.ownPane(process.env);
  if (main === null) {
    const variable = session.mux === "tmux" ? "TMUX_PANE" : "HERDR_PANE_ID";
    throw new CliExit(EXIT_NO_PANE, `this session's ${session.mux} pane is unknown (${variable} is unset or names no pane); children cannot open beside it`);
  }
  return { ...m, mux: session.mux, io, main };
}

function takeManagerLock(s: Session): void {
  const lock = join(s.ctx.stateDir, "locks", `panes-${s.key}`);
  if (!takeLock(lock, "child-pane", LOCK_WAIT_MS)) throw new CliExit(EXIT_LOCK_BUSY, `another child-pane call for this manager still holds ${lock} after 120 s`);
}

// --- the registry and the panes -----------------------------------------------------------

interface PaneState {
  live: LivePanes;
  file: PanesFile;
  children: PaneEntry[];
  gone: PaneEntry[];
}

function panesPath(s: Session): string {
  return join(s.ctx.stateDir, "panes", `${s.key}.json`);
}

function readPaneState(s: Session): PaneState {
  const path = panesPath(s);
  let text: string | null;
  try {
    text = readTextOrNull(path);
  } catch (err) {
    throw new CliExit(EXIT_ERROR, `could not read ${path}: ${String(err)}`);
  }
  const parsed = parsePanesFile(text);
  if (text !== null && parsed === null) warn(`registry ${path} did not parse; starting a fresh one`);
  // Judged on the file as read, so children are never reconciled against the
  // other multiplexer's panes. With no children left there is nothing to lose,
  // and the file takes this session's multiplexer.
  if (parsed !== null && parsed.manager === s.key && parsed.mux !== s.mux && parsed.children.length > 0) {
    throw new CliExit(EXIT_ERROR, `the registry lists children opened under ${parsed.mux}, and this session now runs in ${s.mux}; close them from there`);
  }

  const listed = s.io.livePanes();
  if (!listed.ok) throw new CliExit(EXIT_ERROR, `${listed.error}; nothing was changed`);
  const mainWitness = listed.panes.get(s.main);
  if (mainWitness === undefined) throw new CliExit(EXIT_ERROR, `this session's ${s.mux} pane ${s.main} is not live`);
  const { file, live, gone } = reconcile(parsed, listed.panes, s.key, s.main, mainWitness, Date.now(), s.mux);
  return { live: listed.panes, file, children: live, gone };
}

function writeRegistry(s: Session, file: PanesFile): void {
  try {
    writeAtomic(panesPath(s), serializePanesFile(file));
  } catch (err) {
    throw new CliExit(EXIT_ERROR, `could not write ${panesPath(s)}: ${String(err)}`);
  }
}

function requireChild(state: PaneState, pane: string): PaneEntry {
  const entry = state.children.find((child) => child.pane === pane);
  if (entry !== undefined) return entry;
  const ended = state.file.ended.findLast((e) => e.pane === pane);
  if (ended !== undefined) throw new CliExit(EXIT_GONE, `${pane} is gone (${ended.name}, ${ended.how})`, { pane });
  throw new CliExit(EXIT_NOT_CHILD, `${pane} is not a child pane of this manager`, { pane });
}

function readChild(s: Session, pane: string): { state: PaneState; entry: PaneEntry } {
  const state = readPaneState(s);
  return { state, entry: requireChild(state, pane) };
}

/** The file's text, null when it does not exist, "" (which never parses) when it cannot be read. */
function readRecordFile(path: string): string | null {
  try {
    return readTextOrNull(path);
  } catch {
    return "";
  }
}

/** The window or tab holding the manager, with a note on slots that could not be read. */
function familyNow(s: Session, live: LivePanes): Extract<Family, { ok: true }> {
  const fam = s.io.family(s.main, live);
  if (!fam.ok) throw new CliExit(EXIT_ERROR, fam.error);
  if (fam.slotsNote !== null) warn(fam.slotsNote);
  return fam;
}

function layOut(s: Session, members: readonly string[], slots: readonly string[]): LayoutOutcome {
  const outcome = s.io.layout({ layout: "main-columns", main: s.main, members, slots });
  if (outcome.status === "refused") {
    const where = s.mux === "tmux" ? "window" : "tab";
    warn(
      `layout left as it is: this ${where} holds panes the orchestrator did not open (${outcome.foreign.join(" ")}). ` +
        `Each child opened meanwhile takes half of the last family pane. Move them to another ${where} or close them, then run child-pane.ts layout.`,
    );
  }
  return outcome;
}

function relayout(s: Session, live: LivePanes, children: readonly PaneEntry[]): LayoutOutcome {
  const fam = s.io.family(s.main, live);
  if (!fam.ok) return { status: "failed", order: [], slots: [], foreign: [], restored: [], stranded: [], error: fam.error };
  if (fam.slotsNote !== null) warn(fam.slotsNote);
  const family = familyOf(fam.order, s.main, children, fam.slots);
  return layOut(s, family.members, family.slots);
}

// --- what is in a pane --------------------------------------------------------------------

/** The pane's agent, or none. The pane being gone and an unusable answer both stop the command. */
function agentOrNone(s: Session, pane: string): Extract<AgentSeen, { kind: "agent" | "none" }> {
  const seen = s.io.agent(pane);
  if (seen.kind === "gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (seen.kind === "failed") throw new CliExit(EXIT_ERROR, seen.why, { pane });
  return seen;
}

function occupantIn(s: Session, entry: PaneEntry, seen: AgentSeen): Occupant {
  if (seen.kind !== "agent") return "none";
  // An agent the multiplexer sees but cannot name has not bound this claim as far as anyone can tell.
  if (seen.session === null) return "unbound";
  const alias = aliasKey(s.ctx, seen.session);
  return occupantOf(seen.session, readIdentity(s.ctx, entry.claim), alias !== null && alias !== entry.claim);
}

function stateRefusal(pane: string, status: string, message: string): CliExit {
  return new CliExit(EXIT_STATE, message, { pane, status });
}

function otherAgent(pane: string): CliExit {
  return stateRefusal(pane, "other-agent", `${pane} now runs another agent, not this child`);
}

/** Whether the shell is in the foreground, allowing for a prompt hook that a layout's resize set off a moment ago. */
function shellSettles(s: Session, pane: string): boolean {
  const deadline = Date.now() + SHELL_SETTLE_MS;
  while (s.io.shellForeground(pane) !== true) {
    if (Date.now() >= deadline) return false;
    Bun.sleepSync(SHELL_POLL_MS);
  }
  return true;
}

function witnessLost(pane: string): CliExit {
  return new CliExit(EXIT_GONE, `${pane} closed or now holds another process; nothing more was sent`, { pane });
}

/** Before an input or a close: the pane is still the one opened and, with `needAgent`, an agent still runs in it. */
function requireWitness(s: Session, entry: PaneEntry, needAgent: boolean): void {
  const check = s.io.checkInput(entry.pane, entry.terminal, { needAgent });
  if (check.ok) return;
  if (check.reason === "no-agent") throw stateRefusal(entry.pane, "not-up", `no agent runs in ${entry.pane} any more; nothing more was sent`);
  // No usable answer is not a closed pane: the child may still be there.
  if (check.reason === "failed") throw new CliExit(EXIT_ERROR, `${check.detail}; nothing more was sent`, { pane: entry.pane });
  throw witnessLost(entry.pane);
}

/** Before a wait reports success. Nothing is typed next, so a multiplexer that gave no answer is a failure here, not a lost pane. */
function confirmWitness(s: Session, entry: PaneEntry): void {
  const check = s.io.checkInput(entry.pane, entry.terminal, { needAgent: false });
  if (check.ok) return;
  if (check.reason === "failed") throw new CliExit(EXIT_ERROR, check.detail, { pane: entry.pane });
  throw witnessLost(entry.pane);
}

/** A fresh shell is ready once it runs nothing else and has drawn its prompt: a non-empty screen unchanged for a moment. */
function waitForShell(s: Session, pane: string): boolean {
  const deadline = Date.now() + SHELL_READY_MS;
  let last = "";
  let stableSince = 0;
  for (;;) {
    const read = s.io.read(pane, { lines: 0, source: "visible" });
    const screen = read.ok ? read.text.trim() : "";
    const now = Date.now();
    if (screen !== last) {
      last = screen;
      stableSince = now;
    } else if (screen !== "" && now - stableSince >= SHELL_STABLE_MS && s.io.shellForeground(pane) === true) {
      return true;
    }
    if (now > deadline) return false;
    Bun.sleepSync(100);
  }
}

/** The launcher's stage 2 argv for `entry`, typing `prompt` (none: only wait until Claude Code is up). */
function deliverArgv(s: Session, entry: PaneEntry, prompt: string, lock?: string): string[] {
  return [
    process.execPath,
    "--env-file=/dev/null",
    LAUNCHER,
    "--deliver-to",
    entry.pane,
    "--mux",
    s.mux,
    "--prompt",
    prompt,
    ...(lock === undefined ? [] : ["--lock", lock]),
    "--trust-after",
    entry.claim,
    "--expect-witness",
    entry.terminal,
  ];
}

/** Hands the checkout lock to a detached process that holds it until Claude Code is up in the pane. */
function handOverCheckoutLock(s: Session, lock: string, entry: PaneEntry): void {
  const holder = Bun.spawn(deliverArgv(s, entry, "", lock), { stdio: ["ignore", "ignore", "ignore"], detached: true });
  holder.unref();
  handLockTo(lock, holder.pid, entry.name);
  heldLocks.delete(lock);
}

/** Types the entry's stored launch line. */
function runStoredLine(s: Session, entry: PaneEntry): { ok: boolean; why: string } {
  const typed = s.io.runLine(entry.pane, entry.line);
  return typed.ok ? { ok: true, why: "" } : { ok: false, why: typed.error };
}

// --- open ---------------------------------------------------------------------------------

function mainCheckoutOf(dirArg: string | undefined): string {
  const base = dirArg === undefined ? process.cwd() : resolve(dirArg);
  let stdout: string;
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: base, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new CliExit(EXIT_ERROR, `${base} is not inside a git repository: ${p.stderr.toString().trim()}`);
    stdout = p.stdout.toString();
  } catch (err) {
    if (err instanceof CliExit) throw err;
    throw new CliExit(EXIT_ERROR, `could not read the repository of ${base}: ${String(err)}`);
  }
  const checkout = mainCheckoutFromCommonDir(stdout);
  if (checkout === null) throw new CliExit(EXIT_ERROR, `${base} has no main checkout (git common dir: ${stdout.trim()})`);
  return checkout;
}

interface PrintedLine {
  dir: string;
  branch: string;
  claim: string;
  line: string;
}

function printLine(cmd: Extract<ChildPaneCommand, { cmd: "open" }>): PrintedLine {
  const flag = (name: string, value: string | undefined): string[] => (value === undefined ? [] : [name, value]);
  const argv = [
    "--print-line",
    "--name",
    cmd.name,
    "--colour",
    cmd.colour,
    ...flag("--dir", cmd.dir),
    ...flag("--ticket", cmd.ticket),
    ...flag("--ticket-url", cmd.ticketUrl),
    ...flag("--model", cmd.model),
    ...flag("--effort", cmd.effort),
    ...flag("--launch", cmd.launch),
  ];
  const p = Bun.spawnSync([process.execPath, "--env-file=/dev/null", LAUNCHER, ...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: PRINT_LINE_TIMEOUT_MS });
  if (p.exitedDueToTimeout === true) throw new CliExit(EXIT_ERROR, `ticket-window.ts --print-line did not answer within ${PRINT_LINE_TIMEOUT_MS} ms`);
  if (p.exitCode !== 0) throw new CliExit(p.exitCode ?? EXIT_ERROR, p.stderr.toString().trim().replace(/^ticket-window: /, ""));
  let printed: Partial<PrintedLine> | null = null;
  try {
    printed = JSON.parse(p.stdout.toString()) as Partial<PrintedLine>;
  } catch {
    // Reported just below, with the output that could not be read.
  }
  const { dir, branch, claim, line } = printed ?? {};
  if (typeof dir !== "string" || typeof branch !== "string" || typeof claim !== "string" || typeof line !== "string") {
    throw new CliExit(EXIT_ERROR, `ticket-window.ts --print-line gave no usable answer: ${p.stdout.toString().trim()}`);
  }
  return { dir, branch, claim, line };
}

function open(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "open" }>): Outcome {
  // Taken first and outside the manager lock, so waiting for a slow start in
  // one checkout never blocks close or layout.
  const checkoutLock = lockPathFor(s.ctx.stateDir, mainCheckoutOf(cmd.dir));
  if (!takeLock(checkoutLock, cmd.name, cmd.noWait ? 0 : LOCK_WAIT_MS)) {
    throw new CliExit(EXIT_LOCK_BUSY, "another start in this checkout is still running; nothing was created", { status: "checkout-busy" });
  }
  takeManagerLock(s);
  const state = readPaneState(s);
  if (state.children.length >= CHILD_LIMIT && !cmd.pastLimit) {
    throw new CliExit(EXIT_OVER_LIMIT, `${state.children.length} children are open, and the limit is ${CHILD_LIMIT}; --past-limit opens one more`);
  }
  const twin = state.children.find((child) => child.name === cmd.name);
  if (twin !== undefined) throw new CliExit(EXIT_NAME_TAKEN, `a child named ${cmd.name} is already open in ${twin.pane}`, { pane: twin.pane });

  const printed = printLine(cmd);
  const fam = familyNow(s, state.live);
  const family = familyOf(fam.order, s.main, state.children, fam.slots);

  // Split from the last family pane, so the order of starts stays the pane order.
  const split = s.io.splitBeside(family.lastFamilyPane, { dir: printed.dir });
  if (!split.ok) throw new CliExit(EXIT_ERROR, split.error);
  const { pane, witness } = split;

  const entry: PaneEntry = { pane, terminal: witness, name: cmd.name, claim: printed.claim, dir: printed.dir, line: printed.line, openedAt: Date.now() };
  const children = [...state.children, entry];
  try {
    writeRegistry(s, { ...state.file, children });
  } catch (err) {
    s.io.close(pane);
    throw err;
  }
  const layout = layOut(s, [...family.members, pane], family.slots);

  let code = 0;
  let error: string | null = null;
  // A closed or replaced pane is GONE; a multiplexer that gave no usable answer is an error, since the pane may still be there.
  const lost = (): { code: number; error: string } | null => {
    const check = s.io.checkInput(pane, witness, { needAgent: false });
    if (check.ok) return null;
    if (check.reason === "failed") return { code: EXIT_ERROR, error: `${check.detail}; nothing was typed` };
    return { code: EXIT_GONE, error: `${pane} closed or now holds another process; nothing was typed` };
  };
  const shellReady = waitForShell(s, pane);
  const lostNow = lost();
  if (lostNow !== null) {
    code = lostNow.code;
    error = lostNow.error;
  } else if (!shellReady) {
    code = EXIT_ERROR;
    error = `${pane}'s shell never became ready; nothing was typed`;
  } else {
    const typed = runStoredLine(s, entry);
    if (!typed.ok) {
      code = EXIT_ERROR;
      error = typed.why;
    }
  }
  const typed = code === 0;
  if (typed) handOverCheckoutLock(s, checkoutLock, entry);

  const promptDir = join(s.ctx.stateDir, "prompts");
  mkdirSync(promptDir, { recursive: true });
  if (typed && layout.stranded.length > 0) code = EXIT_STRANDED;
  return {
    code,
    view: {
      ...(error !== null ? { error } : {}),
      multiplexer: s.mux,
      pane,
      tab: fam.tab,
      main: s.main,
      name: cmd.name,
      colour: cmd.colour,
      dir: printed.dir,
      branch: printed.branch,
      claim: printed.claim,
      typed,
      children: children.length,
      promptDir,
      layout,
    },
  };
}

// --- wait ---------------------------------------------------------------------------------

function timedOut(pane: string, label: Record<string, unknown>, started: number): Outcome {
  return { code: EXIT_TIMEOUT, view: { error: `${pane} did not get there in time`, pane, ...label, reached: false, status: null, waitedMs: Date.now() - started } };
}

function waitForAgent(s: Session, entry: PaneEntry, until: "up" | "detected", timeoutMs: number): Outcome {
  const { pane } = entry;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let failures = 0;
  for (;;) {
    const seen = s.io.agent(pane);
    // The agent is named seconds before the child's SessionStart hook binds the claim,
    // so `up` also needs the occupant to be this child. `detected` needs only the agent,
    // and never one still starting: under tmux that is a Claude Code with no session yet.
    if (seen.kind === "agent" && seen.status !== "starting" && (until === "detected" || occupantIn(s, entry, seen) === "child")) {
      confirmWitness(s, entry);
      return { code: 0, view: { pane, until, reached: true, status: seen.status, waitedMs: Date.now() - started } };
    }
    if (seen.kind === "gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
    if (seen.kind === "agent") {
      // A record bound to another session, or a session the store knows under another key,
      // never becomes this child; only an unbound agent is still starting.
      if (occupantIn(s, entry, seen) === "other-agent") throw otherAgent(pane);
      failures = 0;
    } else if (seen.kind === "failed") {
      failures++;
      if (failures >= FAILURES_TO_GIVE_UP) throw new CliExit(EXIT_ERROR, seen.why, { pane });
    } else {
      failures = 0;
      // The claim id is in the typed line, so a refusal above the latest launch does not count.
      const screen = until === "up" ? s.io.read(pane, { lines: SCREEN_LINES, source: "recent" }) : null;
      if (screen?.ok === true && screenShowsTrustError(screen.text, entry.claim)) {
        throw new CliExit(EXIT_UNTRUSTED, "Workspace trust not yet accepted", { pane });
      }
    }
    if (Date.now() >= deadline) return timedOut(pane, { until }, started);
    Bun.sleepSync(1_000);
  }
}

function wait(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "wait" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  const { timeoutMs, patterns, until } = cmd;
  if (until === "up" || until === "detected") return waitForAgent(s, entry, until, timeoutMs);
  if (until === "done" && s.mux === "tmux") {
    throw new CliExit(EXIT_ERROR, "done is herdr's state for a turn finished while unfocused; under tmux wait --until idle", { pane });
  }

  const started = Date.now();
  const label: Record<string, unknown> = patterns !== undefined ? { pattern: patterns } : { until };
  const reached = patterns !== undefined ? s.io.waitOutput(pane, patterns, timeoutMs) : s.io.agentWait(pane, [until ?? "idle"], timeoutMs);
  if (reached === "matched" || reached === "reached") {
    confirmWitness(s, entry);
    return { code: 0, view: { pane, ...label, reached: true, status: until ?? null, waitedMs: Date.now() - started } };
  }
  if (reached === "gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (reached === "no-agent") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}`);
  if (reached === "timeout") return timedOut(pane, label, started);
  throw new CliExit(EXIT_ERROR, `${s.mux} gave no usable answer while waiting on ${pane}`, { pane });
}

// --- prompt -------------------------------------------------------------------------------

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch (err) {
    throw new CliExit(EXIT_ERROR, `could not read standard input: ${String(err)}`);
  }
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new CliExit(EXIT_ERROR, `could not read ${path}: ${String(err)}`);
  }
}

function insideWorkTree(dir: string): boolean {
  try {
    return Bun.spawnSync(["git", "-C", dir, "rev-parse", "--is-inside-work-tree"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" }).stdout.toString().trim() === "true";
  } catch {
    return false;
  }
}

/** The prompt's text, and the file to delete once it is delivered (only one under the prompts directory). */
function readPrompt(s: Session, source: string): { text: string; owned: string | null } {
  let raw: string;
  let owned: string | null = null;
  if (source === "-") {
    raw = readStdin();
  } else {
    const path = resolve(source);
    const prompts = canonical(join(s.ctx.stateDir, "prompts"));
    const underPrompts = `${canonical(dirname(path))}/`.startsWith(`${prompts}/`);
    if (!underPrompts && insideWorkTree(dirname(path))) {
      throw new CliExit(EXIT_ERROR, `a prompt file inside a checkout can be committed by mistake; write it to the session scratchpad or to ${join(s.ctx.stateDir, "prompts")}/`);
    }
    raw = readTextFile(path);
    if (underPrompts) owned = path;
  }
  const text = raw.replace(/[\r\n]+$/, "");
  if (text === "") throw new CliExit(EXIT_ERROR, "the prompt is empty");
  if (/[\r\n]/.test(text)) throw new CliExit(EXIT_ERROR, "the prompt must be one line");
  return { text, owned };
}

/** Waits for the child in the pane to be bound and at rest, or refuses. */
function awaitRest(s: Session, entry: PaneEntry): void {
  const { pane } = entry;
  const bindBy = Date.now() + BIND_WAIT_MS;
  let seen = agentOrNone(s, pane);
  for (;;) {
    if (seen.kind === "none") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}`);
    const occupant = occupantIn(s, entry, seen);
    if (occupant === "other-agent") throw otherAgent(pane);
    if (seen.status === "blocked") throw stateRefusal(pane, "blocked", `${pane} is waiting on a question or a permission`);
    if (occupant === "child") break;
    if (Date.now() >= bindBy) throw stateRefusal(pane, "unbound", `the agent in ${pane} has not bound this child's claim`);
    Bun.sleepSync(1_000);
    seen = agentOrNone(s, pane);
  }
  if (seen.status === "idle" || seen.status === "done") return;
  // A child starting up is working on its own /color line.
  const rested = s.io.agentWait(pane, ["idle", "done"], WORKING_WAIT_MS);
  if (rested === "reached") return;
  if (rested === "gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (rested === "no-agent") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}`);
  if (rested === "failed") throw new CliExit(EXIT_ERROR, `${s.mux} gave no usable answer while waiting on ${pane}`, { pane });
  throw new CliExit(EXIT_TIMEOUT, `${pane} is still working`, { pane, status: "working" });
}

const DELIVERY_OUTCOMES: Readonly<Record<number, string>> = { 0: "sent", 4: "timeout", 5: "gone", 7: "untrusted", 8: "not-sent" };

function prompt(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "prompt" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  const { text, owned } = readPrompt(s, cmd.promptFile);
  awaitRest(s, entry);

  const log = join(s.ctx.stateDir, "ticket-window.log");
  const p = Bun.spawnSync(deliverArgv(s, entry, text), { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: DELIVER_TIMEOUT_MS });
  const code = p.exitedDueToTimeout === true ? EXIT_TIMEOUT : (p.exitCode ?? EXIT_ERROR);
  const outcome = DELIVERY_OUTCOMES[code];
  if (outcome === undefined) throw new CliExit(EXIT_ERROR, `delivery failed: ${p.stderr.toString().trim() || `exit ${code}`}`, { pane });

  let inInput: boolean | null = null;
  if (outcome === "not-sent") {
    const screen = s.io.read(pane, { lines: SCREEN_LINES, source: "recent" });
    inInput = screen.ok ? promptStillInInput(screen.text, text) : null;
  }
  // Neither outcome is ever typed again; any other keeps the file for a retry.
  if (owned !== null && (outcome === "sent" || outcome === "not-sent")) rmSync(owned, { force: true });
  const view: Record<string, unknown> = { pane, outcome, inInput, log };
  if (code !== 0) view.error = `the prompt was not delivered: ${outcome}`;
  return { code, view };
}

// --- send, trust, retype, read, list ------------------------------------------------------

function send(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "send" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  // A file or heredoc ends with a newline that would submit the text.
  const text = cmd.textFile === undefined ? cmd.text : (cmd.textFile === "-" ? readStdin() : readTextFile(cmd.textFile)).replace(/[\r\n]+$/, "");
  // A newline inside would submit what stands before it.
  if (text !== undefined && /[\r\n]/.test(text)) throw new CliExit(EXIT_ERROR, "the text must be one line", { pane });
  if (text === "") throw new CliExit(EXIT_ERROR, "the text is empty", { pane });
  const seen = agentOrNone(s, pane);
  if (occupantIn(s, entry, seen) === "other-agent") throw otherAgent(pane);
  // With no agent the text would reach a shell and run as a command.
  if (text !== undefined && seen.kind === "none") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}; nothing was typed`);
  // Keys alone may go to a pane with no agent: the menu Claude Code leaves on /quit is one.
  const needAgent = seen.kind === "agent";

  const deliver = (what: string, send: () => { ok: true } | { ok: false; gone: boolean; error: string }): void => {
    requireWitness(s, entry, needAgent);
    const sent = send();
    if (sent.ok) return;
    if (sent.gone) throw witnessLost(pane);
    throw new CliExit(EXIT_ERROR, `${what}: ${sent.error}`, { pane });
  };
  if (text !== undefined) deliver("text", () => s.io.sendText(pane, text));
  const key = cmd.key;
  if (key !== undefined) {
    if (text !== undefined) Bun.sleepSync(SEND_PAUSE_MS);
    deliver("key", () => s.io.sendKeys(pane, [key]));
  }
  return { code: 0, view: { pane, typed: text?.length ?? 0, key: key ?? null } };
}

function refuseIfBound(s: Session, entry: PaneEntry): void {
  if (readRecordFile(identityPath(s.ctx, entry.claim)) !== null) {
    throw stateRefusal(entry.pane, "bound", `${entry.pane} has already bound its claim; the child has started`);
  }
}

function trust(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "trust" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  refuseIfBound(s, entry);
  if (agentOrNone(s, pane).kind !== "none" || !shellSettles(s, pane)) {
    throw stateRefusal(pane, "busy", `${pane} is not at a bare shell prompt`);
  }
  requireWitness(s, entry, false);
  const typed = s.io.runLine(pane, "claude");
  if (!typed.ok) throw new CliExit(EXIT_ERROR, typed.error, { pane, typed: false });
  return { code: 0, view: { pane, typed: true } };
}

function retype(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "retype" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  refuseIfBound(s, entry);
  if (readRecordFile(claimPath(s.ctx, entry.claim)) === null) throw new CliExit(EXIT_ERROR, "the claim expired; close this pane and open the child again", { pane });

  const checkoutLock = lockPathFor(s.ctx.stateDir, entry.dir);
  if (!takeLock(checkoutLock, entry.name, LOCK_WAIT_MS)) {
    throw new CliExit(EXIT_LOCK_BUSY, "another start in this checkout is still running", { pane, status: "checkout-busy" });
  }
  if (occupantIn(s, entry, agentOrNone(s, pane)) === "other-agent") throw otherAgent(pane);
  // A /quit just sent takes a moment to hand the pane back to the shell.
  const shellBy = Date.now() + SHELL_READY_MS;
  while (s.io.shellForeground(pane) !== true) {
    if (Date.now() >= shellBy) throw stateRefusal(pane, "busy", `${pane} did not return to its shell`);
    Bun.sleepSync(SHELL_POLL_MS);
  }
  requireWitness(s, entry, false);
  const typed = runStoredLine(s, entry);
  if (!typed.ok) throw new CliExit(EXIT_ERROR, typed.why, { pane, typed: false });
  handOverCheckoutLock(s, checkoutLock, entry);
  return { code: 0, view: { pane, typed: true } };
}

function read(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "read" }>): Outcome {
  const { pane } = readChild(s, cmd.pane).entry;
  const answer = s.io.read(pane, { lines: cmd.lines, source: "recent" });
  if (!answer.ok) {
    if (answer.gone) throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
    throw new CliExit(EXIT_ERROR, answer.error, { pane });
  }
  return { code: 0, view: {}, text: answer.text };
}

function list(s: Session): Outcome {
  const state = readPaneState(s);
  const fam = familyNow(s, state.live);
  const family = familyOf(fam.order, s.main, state.children, fam.slots);
  const children = state.children.map((entry) => {
    const seen = s.io.agent(entry.pane);
    return {
      pane: entry.pane,
      name: entry.name,
      claim: entry.claim,
      dir: entry.dir,
      openedAt: entry.openedAt,
      inTab: fam.order.includes(entry.pane),
      agent: seen.kind === "agent" ? seen.agent : null,
      status: seen.kind === "agent" ? seen.status : null,
      occupant: occupantIn(s, entry, seen),
    };
  });
  return {
    code: 0,
    view: {
      multiplexer: s.mux,
      main: s.main,
      tab: fam.tab,
      limit: CHILD_LIMIT,
      children,
      gone: state.gone.map((entry) => entry.pane),
      slots: family.slots,
      foreign: family.foreign,
      relayout: state.gone.length > 0,
    },
  };
}

// --- close, layout ------------------------------------------------------------------------

function close(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "close" }>): Outcome {
  takeManagerLock(s);
  const { state, entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  const seen = agentOrNone(s, pane);
  const occupant = occupantIn(s, entry, seen);
  if (occupant === "other-agent") throw otherAgent(pane);
  if (!cmd.force) {
    if (occupant === "unbound") throw stateRefusal(pane, "unbound", `the agent in ${pane} has not bound this child's claim; --force closes it`);
    if (seen.kind === "agent" && seen.status === "working") throw stateRefusal(pane, "working", `${pane} is working; --force closes it`);
    if (seen.kind === "none" && !shellSettles(s, pane)) throw stateRefusal(pane, "busy", `${pane} is running something; --force closes it`);
  }
  requireWitness(s, entry, false);
  const closed = s.io.close(pane);
  if (!closed.ok) {
    if (closed.gone) throw witnessLost(pane);
    throw new CliExit(EXIT_ERROR, closed.error, { pane });
  }

  const children = state.children.filter((child) => child.pane !== pane);
  const ended = [...state.file.ended, { pane, name: entry.name, at: Date.now(), how: "closed" as const }].slice(-MAX_ENDED);
  writeRegistry(s, { ...state.file, children, ended });
  const layout = relayout(s, state.live, children);
  return { code: layout.stranded.length > 0 ? EXIT_STRANDED : 0, view: { closed: pane, children: children.length, layout } };
}

function layoutCode(outcome: LayoutOutcome): number {
  if (outcome.stranded.length > 0) return EXIT_STRANDED;
  if (outcome.status === "refused") return EXIT_REFUSED;
  return outcome.status === "failed" ? EXIT_ERROR : 0;
}

function layout(s: Session): Outcome {
  takeManagerLock(s);
  const state = readPaneState(s);
  writeRegistry(s, state.file);
  const outcome = relayout(s, state.live, state.children);
  return { code: layoutCode(outcome), view: { ...outcome, children: state.children.length } };
}

// --- entry --------------------------------------------------------------------------------

function run(argv: readonly string[]): Outcome {
  const parsed = parseChildPaneArgs(argv);
  if (!parsed.ok) throw new CliExit(EXIT_ERROR, parsed.error);
  const s = locate(authorise());
  const { command } = parsed;
  switch (command.cmd) {
    case "open":
      return open(s, command);
    case "wait":
      return wait(s, command);
    case "prompt":
      return prompt(s, command);
    case "send":
      return send(s, command);
    case "trust":
      return trust(s, command);
    case "retype":
      return retype(s, command);
    case "read":
      return read(s, command);
    case "list":
      return list(s);
    case "close":
      return close(s, command);
    case "layout":
      return layout(s);
  }
}

let exitCode: number;
try {
  const { view, code, text } = run(process.argv.slice(2));
  if (text !== undefined) process.stdout.write(text);
  else console.log(JSON.stringify(view));
  if (typeof view.error === "string") warn(view.error);
  exitCode = code;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const fields = err instanceof CliExit ? err.fields : {};
  console.log(JSON.stringify({ error: message, ...fields }));
  warn(message);
  exitCode = err instanceof CliExit ? err.code : EXIT_ERROR;
} finally {
  for (const lock of [...heldLocks]) releaseLock(lock);
}
process.exit(exitCode);
