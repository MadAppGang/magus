#!/usr/bin/env bun
// Runs a ticket manager's child sessions as herdr panes in the manager's own
// tab, laid out as main-columns: the manager full height on the left, the
// children in columns of two.
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
// on the checkout, handed to a detached process until Claude Code is up. Only
// the live owner of a manager record may run this, inside herdr.
//
// An entry counts only while herdr lists its pane with the terminal id it had
// when it was opened, and that terminal id is read again right before every
// input, because herdr addresses input by pane id alone and a restart reuses
// ids.
//
// Output: one JSON document on stdout (plain text for a successful `read`); a
// failure is { "error": "<sentence>", … }.
//
// Exit codes:
//   0   done (for open and close, also when the layout was refused or failed with nothing stranded)
//   1   bad input, a herdr error, the registry could not be read or written, a shell never ready, a claim expired
//   2   open: the checkout is off its default branch
//   3   open: the worktree exists, or a live child already has that name
//   4   wait, prompt: timeout
//   5   the pane is gone, or its terminal changed; no further input was sent
//   6   a lock stayed busy for 120 s (status "checkout-busy" for the checkout's); nothing was created
//   7   wait --until up, prompt: the checkout is untrusted
//   8   prompt: not sent
//   9   not a manager, or not the record's live owner
//   10  this session does not run in herdr
//   11  not a child pane of this manager
//   12  open: 10 children are open and --past-limit was not given
//   13  the pane's state does not allow it; "status" says which
//   14  the layout left a pane outside the tab; layout.error names the command that puts it back
//   15  layout: refused for panes the orchestrator did not open

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  MAX_ENDED,
  type ChildPaneCommand,
  type Occupant,
  type PaneEntry,
  type PanesFile,
  alternationRegex,
  familyOf,
  occupantOf,
  parseAgentInfo,
  parseChildPaneArgs,
  parsePanesFile,
  parseSlotRegistry,
  reconcile,
  serializePanesFile,
  shellInForeground,
} from "./lib/child-pane-core.ts";
import { type HerdrRunner, type LayoutOutcome, HERDR_TIMEOUT_MS, applyLayout, failureDetail, herdrRunner, readLivePanes, readTabLayout, resolveHerdrBin } from "./lib/herdr-cli.ts";
import { parseProcessInfo } from "./lib/mux-choice.ts";
import { sessionMuxNow } from "./lib/mux-io.ts";
import type { LivePanes } from "./lib/pane-layout.ts";
import { type StoreContext, aliasKey, claimPath, claudeConfigDirOf, handLockTo, identityPath, ownPid, pidAlive, readIdentity, writableKey, writeAtomic } from "./lib/record-store.ts";
import { buildHerdrRun, lockIsStale, lockPathFor, mainCheckoutFromCommonDir, parseHerdrPane, parseHerdrPaneState, promptStillInInput, screenShowsTrustError, stateDir } from "./lib/window.ts";

const EXIT_ERROR = 1;
const EXIT_NAME_TAKEN = 3;
const EXIT_TIMEOUT = 4;
const EXIT_GONE = 5;
const EXIT_LOCK_BUSY = 6;
const EXIT_UNTRUSTED = 7;
const EXIT_NOT_MANAGER = 9;
const EXIT_NOT_HERDR = 10;
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
const WAIT_GRACE_MS = 2_000;
const FAILURES_TO_GIVE_UP = 3;
const SCREEN_LINES = "200";

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

// --- who is asking ------------------------------------------------------------------------

interface Session {
  ctx: StoreContext;
  home: string;
  key: string;
  run: HerdrRunner;
}

const NOT_MANAGER = "only a ticket's manager opens child panes; this session is";

function authorise(): Session {
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
  return { ctx, home, key: owned.key, run: herdrRunner(resolveHerdrBin(process.env, home) ?? "herdr") };
}

function requireHerdrSession(s: Session): void {
  const session = sessionMuxNow(process.env, { run: s.run, home: s.home, stateDir: s.ctx.stateDir });
  const lead = "children open as herdr panes only when this session runs in herdr";
  if (!session.ok) throw new CliExit(EXIT_NOT_HERDR, `${lead}; ${session.error}`);
  if (session.mux !== "herdr") {
    const detail = session.nesting === null ? session.source : `${session.source}, ${session.nesting}`;
    throw new CliExit(EXIT_NOT_HERDR, `${lead}; this session uses ${session.mux} (${detail})`);
  }
}

function takeManagerLock(s: Session): void {
  const lock = join(s.ctx.stateDir, "locks", `panes-${s.key}`);
  if (!takeLock(lock, "child-pane", LOCK_WAIT_MS)) throw new CliExit(EXIT_LOCK_BUSY, `another child-pane call for this manager still holds ${lock} after 120 s`);
}

// --- the registry and the panes -----------------------------------------------------------

interface PaneState {
  main: string;
  live: LivePanes;
  file: PanesFile;
  children: PaneEntry[];
  gone: PaneEntry[];
}

function panesPath(s: Session): string {
  return join(s.ctx.stateDir, "panes", `${s.key}.json`);
}

function readPaneState(s: Session): PaneState {
  const listed = readLivePanes(s.run);
  if (!listed.ok) throw new CliExit(EXIT_ERROR, `herdr pane list failed: ${listed.error.replace(/^herdr pane list: /, "")}; nothing was changed`);
  const main = process.env.HERDR_PANE_ID ?? "";
  const mainTerminal = listed.live.get(main);
  if (mainTerminal === undefined) throw new CliExit(EXIT_ERROR, `this session's herdr pane ${main} is not live`);
  const path = panesPath(s);
  let text: string | null;
  try {
    text = readTextOrNull(path);
  } catch (err) {
    throw new CliExit(EXIT_ERROR, `could not read ${path}: ${String(err)}`);
  }
  const parsed = parsePanesFile(text);
  if (text !== null && parsed === null) warn(`registry ${path} did not parse; starting a fresh one`);
  const { file, live, gone } = reconcile(parsed, listed.live, s.key, main, mainTerminal, Date.now());
  return { main, live: listed.live, file, children: live, gone };
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

/** The terminal-plugin slots this manager opened. Read only: tmux-mcp replaces these files by rename. */
function readSlots(s: Session, state: PaneState): Set<string> {
  const socket = process.env.HERDR_SOCKET_PATH;
  if (!socket) return new Set();
  const root = join(process.env.XDG_STATE_HOME || join(s.home, ".local", "state"), "tmux-mcp", "herdr");
  const hash = createHash("sha256").update(socket).digest("hex");
  const registry = join(root, `${hash}.json`);
  const slots = parseSlotRegistry(readRecordFile(registry), readRecordFile(join(root, `${hash}.layout.json`)), state.live, state.main);
  if (slots === "unreadable") {
    warn(`terminal slot records at ${registry} could not be read; slots count as foreign`);
    return new Set();
  }
  return slots ?? new Set();
}

function layOut(s: Session, main: string, members: readonly string[], slots: readonly string[]): LayoutOutcome {
  const outcome = applyLayout(s.run, { layout: "main-columns", main, members, slots });
  if (outcome.status === "refused") {
    warn(
      `layout left as it is: this tab holds panes the orchestrator did not open (${outcome.foreign.join(" ")}). ` +
        "Each child opened meanwhile takes half of the last family pane. Move them to another tab or close them, then run child-pane.ts layout.",
    );
  }
  return outcome;
}

function relayout(s: Session, main: string, children: readonly PaneEntry[], slots: ReadonlySet<string>): LayoutOutcome {
  const tab = readTabLayout(s.run, main);
  if (!tab.ok) return { status: "failed", order: [], slots: [], foreign: [], restored: [], stranded: [], error: tab.error };
  const family = familyOf(
    tab.view.panes.map((pane) => pane.id),
    main,
    children,
    slots,
  );
  return layOut(s, main, family.members, family.slots);
}

// --- what is in a pane --------------------------------------------------------------------

type AgentSeen = { kind: "agent"; agent: string; session: string | null; status: string | null } | { kind: "none" } | { kind: "pane-gone" } | { kind: "failed"; why: string };

function askAgent(run: HerdrRunner, pane: string): AgentSeen {
  const answer = run(["agent", "get", pane]);
  if (answer.errorCode === "pane_not_found") return { kind: "pane-gone" };
  if (answer.errorCode === "agent_not_found") return { kind: "none" };
  const info = answer.ok ? parseAgentInfo(answer.json) : null;
  if (info !== null) return { kind: "agent", ...info };
  return { kind: "failed", why: answer.ok ? "herdr agent get: unreadable answer" : `herdr agent get: ${failureDetail(answer)}` };
}

/** The pane's agent, or none. The pane being gone and an unusable answer both stop the command. */
function agentOrNone(s: Session, pane: string): Extract<AgentSeen, { kind: "agent" | "none" }> {
  const seen = askAgent(s.run, pane);
  if (seen.kind === "pane-gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (seen.kind === "failed") throw new CliExit(EXIT_ERROR, seen.why, { pane });
  return seen;
}

function occupantIn(s: Session, entry: PaneEntry, seen: AgentSeen): Occupant {
  if (seen.kind !== "agent") return "none";
  // An agent herdr sees but cannot name has not bound this claim as far as anyone can tell.
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

function shellForeground(run: HerdrRunner, pane: string): boolean {
  const answer = run(["pane", "process-info", "--pane", pane]);
  const procs = parseProcessInfo(answer.stdout.trim() !== "" ? answer.stdout : answer.stderr, answer.exitCode);
  return procs !== null && typeof procs === "object" && shellInForeground(procs);
}

/** Whether the shell is in the foreground, allowing for a prompt hook that a layout's resize set off a moment ago. */
function shellSettles(run: HerdrRunner, pane: string): boolean {
  const deadline = Date.now() + SHELL_SETTLE_MS;
  while (!shellForeground(run, pane)) {
    if (Date.now() >= deadline) return false;
    Bun.sleepSync(SHELL_POLL_MS);
  }
  return true;
}

function witnessHolds(run: HerdrRunner, entry: PaneEntry): boolean {
  const answer = run(["pane", "get", entry.pane], HERDR_TIMEOUT_MS);
  return answer.ok && parseHerdrPaneState(answer.stdout)?.terminal === entry.terminal;
}

function witnessLost(pane: string): CliExit {
  return new CliExit(EXIT_GONE, `${pane} closed or now holds another terminal; nothing more was sent`, { pane });
}

function requireWitness(s: Session, entry: PaneEntry): void {
  if (!witnessHolds(s.run, entry)) throw witnessLost(entry.pane);
}

/** Before a wait reports success. Nothing is typed next, so a herdr that gave no answer is a failure here, not a lost pane. */
function confirmWitness(s: Session, entry: PaneEntry): void {
  const { pane } = entry;
  const answer = s.run(["pane", "get", pane], HERDR_TIMEOUT_MS);
  if (answer.errorCode === "pane_not_found") throw witnessLost(pane);
  if (!answer.ok) throw new CliExit(EXIT_ERROR, `herdr pane get: ${failureDetail(answer)}`, { pane });
  if (parseHerdrPaneState(answer.stdout)?.terminal !== entry.terminal) throw witnessLost(pane);
}

/** A fresh shell is ready once it runs nothing else and has drawn its prompt: a non-empty screen unchanged for a moment. */
function waitForShell(run: HerdrRunner, pane: string): boolean {
  const deadline = Date.now() + SHELL_READY_MS;
  let last = "";
  let stableSince = 0;
  for (;;) {
    const answer = run(["pane", "read", pane, "--source", "visible"]);
    const screen = answer.ok ? answer.stdout.trim() : "";
    const now = Date.now();
    if (screen !== last) {
      last = screen;
      stableSince = now;
    } else if (screen !== "" && now - stableSince >= SHELL_STABLE_MS && shellForeground(run, pane)) {
      return true;
    }
    if (now > deadline) return false;
    Bun.sleepSync(100);
  }
}

/** Hands the checkout lock to a detached process that holds it until Claude Code is up in the pane. */
function handOverCheckoutLock(lock: string, entry: PaneEntry): void {
  const holder = Bun.spawn(
    [
      process.execPath,
      "--env-file=/dev/null",
      LAUNCHER,
      "--deliver-to",
      entry.pane,
      "--mux",
      "herdr",
      "--prompt",
      "",
      "--lock",
      lock,
      "--trust-after",
      entry.claim,
      "--expect-terminal",
      entry.terminal,
    ],
    { stdio: ["ignore", "ignore", "ignore"], detached: true },
  );
  holder.unref();
  handLockTo(lock, holder.pid, entry.name);
  heldLocks.delete(lock);
}

/** Types the entry's stored launch line. */
function runStoredLine(s: Session, entry: PaneEntry): { ok: boolean; why: string } {
  const answer = s.run(buildHerdrRun(entry.pane, entry.line).slice(1));
  return { ok: answer.ok, why: answer.ok ? "" : `herdr pane run: ${failureDetail(answer)}` };
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
  const tab = readTabLayout(s.run, state.main);
  if (!tab.ok) throw new CliExit(EXIT_ERROR, tab.error);
  const family = familyOf(
    tab.view.panes.map((pane) => pane.id),
    state.main,
    state.children,
    readSlots(s, state),
  );

  // Split from the last family pane, so the order of starts stays the tree order.
  const split = s.run(["pane", "split", family.lastFamilyPane, "--direction", "right", "--ratio", "0.5", "--cwd", printed.dir, "--no-focus"]);
  if (!split.ok) throw new CliExit(EXIT_ERROR, `herdr pane split: ${failureDetail(split)}`);
  const pane = parseHerdrPane(split.stdout)?.paneId ?? null;
  const terminal = parseHerdrPaneState(split.stdout)?.terminal ?? null;
  if (pane === null) throw new CliExit(EXIT_ERROR, `herdr pane split named no pane: ${split.stdout.trim()}`);
  if (terminal === null) {
    s.run(["pane", "close", pane]);
    throw new CliExit(EXIT_ERROR, `herdr pane split named no terminal, so ${pane} was closed unused`);
  }

  const entry: PaneEntry = { pane, terminal, name: cmd.name, claim: printed.claim, dir: printed.dir, line: printed.line, openedAt: Date.now() };
  const children = [...state.children, entry];
  try {
    writeRegistry(s, { ...state.file, children });
  } catch (err) {
    s.run(["pane", "close", pane]);
    throw err;
  }
  const layout = layOut(s, state.main, [...family.members, pane], family.slots);

  let code = 0;
  let error: string | null = null;
  if (!waitForShell(s.run, pane)) {
    code = witnessHolds(s.run, entry) ? EXIT_ERROR : EXIT_GONE;
    error = code === EXIT_GONE ? `${pane} closed or now holds another terminal; nothing was typed` : `${pane}'s shell never became ready; nothing was typed`;
  } else if (!witnessHolds(s.run, entry)) {
    code = EXIT_GONE;
    error = `${pane} closed or now holds another terminal; nothing was typed`;
  } else {
    const typed = runStoredLine(s, entry);
    if (!typed.ok) {
      code = EXIT_ERROR;
      error = typed.why;
    }
  }
  const typed = code === 0;
  if (typed) handOverCheckoutLock(checkoutLock, entry);

  const promptDir = join(s.ctx.stateDir, "prompts");
  mkdirSync(promptDir, { recursive: true });
  if (typed && layout.stranded.length > 0) code = EXIT_STRANDED;
  return {
    code,
    view: {
      ...(error !== null ? { error } : {}),
      pane,
      tab: tab.view.tabId,
      main: state.main,
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
    const seen = askAgent(s.run, pane);
    // herdr names the agent seconds before the child's SessionStart hook binds the claim,
    // so `up` also needs the occupant to be this child; `detected` needs only the agent.
    if (seen.kind === "agent" && (until === "detected" || occupantIn(s, entry, seen) === "child")) {
      confirmWitness(s, entry);
      return { code: 0, view: { pane, until, reached: true, status: seen.status, waitedMs: Date.now() - started } };
    }
    if (seen.kind === "pane-gone") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
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
      const screen = until === "up" ? s.run(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", SCREEN_LINES]) : null;
      if (screen?.ok === true && screenShowsTrustError(screen.stdout, entry.claim)) {
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

  const started = Date.now();
  const label: Record<string, unknown> = patterns !== undefined ? { pattern: patterns } : { until };
  const args =
    patterns !== undefined
      ? ["pane", "wait-output", pane, "--regex", alternationRegex(patterns), "--source", "recent-unwrapped", "--lines", SCREEN_LINES, "--timeout", String(timeoutMs)]
      : ["agent", "wait", pane, "--until", String(until), "--timeout", String(timeoutMs)];
  const answer = s.run(args, timeoutMs + WAIT_GRACE_MS);
  if (answer.ok) {
    confirmWitness(s, entry);
    return { code: 0, view: { pane, ...label, reached: true, status: until ?? null, waitedMs: Date.now() - started } };
  }
  if (answer.errorCode === "pane_not_found") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (patterns === undefined && answer.errorCode === "agent_not_found") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}`);
  if (answer.timedOut || answer.errorCode === "timeout") return timedOut(pane, label, started);
  throw new CliExit(EXIT_ERROR, `herdr ${args[0]} ${args[1]}: ${failureDetail(answer)}`, { pane });
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
  const answer = s.run(["agent", "wait", pane, "--until", "idle", "--until", "done", "--timeout", String(WORKING_WAIT_MS)], WORKING_WAIT_MS + WAIT_GRACE_MS);
  if (answer.ok) return;
  if (answer.errorCode === "pane_not_found") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (answer.errorCode === "agent_not_found") throw stateRefusal(pane, "not-up", `no agent runs in ${pane}`);
  throw new CliExit(EXIT_TIMEOUT, `${pane} is still working`, { pane, status: "working" });
}

const DELIVERY_OUTCOMES: Readonly<Record<number, string>> = { 0: "sent", 4: "timeout", 5: "gone", 7: "untrusted", 8: "not-sent" };

function prompt(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "prompt" }>): Outcome {
  const { entry } = readChild(s, cmd.pane);
  const { pane } = entry;
  const { text, owned } = readPrompt(s, cmd.promptFile);
  awaitRest(s, entry);

  const log = join(s.ctx.stateDir, "ticket-window.log");
  const p = Bun.spawnSync(
    [process.execPath, "--env-file=/dev/null", LAUNCHER, "--deliver-to", pane, "--mux", "herdr", "--prompt", text, "--trust-after", entry.claim, "--expect-terminal", entry.terminal],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: DELIVER_TIMEOUT_MS },
  );
  const code = p.exitedDueToTimeout === true ? EXIT_TIMEOUT : (p.exitCode ?? EXIT_ERROR);
  const outcome = DELIVERY_OUTCOMES[code];
  if (outcome === undefined) throw new CliExit(EXIT_ERROR, `delivery failed: ${p.stderr.toString().trim() || `exit ${code}`}`, { pane });

  let inInput: boolean | null = null;
  if (outcome === "not-sent") {
    const screen = s.run(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", SCREEN_LINES]);
    inInput = screen.ok ? promptStillInInput(screen.stdout, text) : null;
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

  const deliver = (args: string[]): void => {
    requireWitness(s, entry);
    const answer = s.run(args);
    if (answer.errorCode === "pane_not_found") throw witnessLost(pane);
    if (!answer.ok) throw new CliExit(EXIT_ERROR, `herdr ${args[1]}: ${failureDetail(answer)}`, { pane });
  };
  if (text !== undefined) deliver(["pane", "send-text", pane, text]);
  if (cmd.key !== undefined) {
    if (text !== undefined) Bun.sleepSync(SEND_PAUSE_MS);
    deliver(["pane", "send-keys", pane, cmd.key]);
  }
  return { code: 0, view: { pane, typed: text?.length ?? 0, key: cmd.key ?? null } };
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
  if (agentOrNone(s, pane).kind !== "none" || !shellSettles(s.run, pane)) {
    throw stateRefusal(pane, "busy", `${pane} is not at a bare shell prompt`);
  }
  requireWitness(s, entry);
  const answer = s.run(buildHerdrRun(pane, "claude").slice(1));
  if (!answer.ok) throw new CliExit(EXIT_ERROR, `herdr pane run: ${failureDetail(answer)}`, { pane, typed: false });
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
  while (!shellForeground(s.run, pane)) {
    if (Date.now() >= shellBy) throw stateRefusal(pane, "busy", `${pane} did not return to its shell`);
    Bun.sleepSync(SHELL_POLL_MS);
  }
  requireWitness(s, entry);
  const typed = runStoredLine(s, entry);
  if (!typed.ok) throw new CliExit(EXIT_ERROR, typed.why, { pane, typed: false });
  handOverCheckoutLock(checkoutLock, entry);
  return { code: 0, view: { pane, typed: true } };
}

function read(s: Session, cmd: Extract<ChildPaneCommand, { cmd: "read" }>): Outcome {
  const { pane } = readChild(s, cmd.pane).entry;
  const lines = String(cmd.lines);
  let answer = s.run(["agent", "read", pane, "--source", "recent-unwrapped", "--lines", lines]);
  if (answer.errorCode === "agent_not_found") answer = s.run(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", lines]);
  if (answer.errorCode === "pane_not_found") throw new CliExit(EXIT_GONE, `${pane} is gone`, { pane });
  if (!answer.ok) throw new CliExit(EXIT_ERROR, `could not read ${pane}: ${failureDetail(answer)}`, { pane });
  return { code: 0, view: {}, text: answer.stdout };
}

function list(s: Session): Outcome {
  const state = readPaneState(s);
  const tab = readTabLayout(s.run, state.main);
  if (!tab.ok) throw new CliExit(EXIT_ERROR, tab.error);
  const order = tab.view.panes.map((pane) => pane.id);
  const family = familyOf(order, state.main, state.children, readSlots(s, state));
  const children = state.children.map((entry) => {
    const seen = askAgent(s.run, entry.pane);
    return {
      pane: entry.pane,
      name: entry.name,
      claim: entry.claim,
      dir: entry.dir,
      openedAt: entry.openedAt,
      inTab: order.includes(entry.pane),
      agent: seen.kind === "agent" ? seen.agent : null,
      status: seen.kind === "agent" ? seen.status : null,
      occupant: occupantIn(s, entry, seen),
    };
  });
  return {
    code: 0,
    view: {
      main: state.main,
      tab: tab.view.tabId,
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
    if (seen.kind === "none" && !shellSettles(s.run, pane)) throw stateRefusal(pane, "busy", `${pane} is running something; --force closes it`);
  }
  requireWitness(s, entry);
  const answer = s.run(["pane", "close", pane]);
  if (answer.errorCode === "pane_not_found") throw witnessLost(pane);
  if (!answer.ok) throw new CliExit(EXIT_ERROR, `herdr pane close: ${failureDetail(answer)}`, { pane });

  const children = state.children.filter((child) => child.pane !== pane);
  const ended = [...state.file.ended, { pane, name: entry.name, at: Date.now(), how: "closed" as const }].slice(-MAX_ENDED);
  writeRegistry(s, { ...state.file, children, ended });
  const layout = relayout(s, state.main, children, readSlots(s, state));
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
  const outcome = relayout(s, state.main, state.children, readSlots(s, state));
  return { code: layoutCode(outcome), view: { ...outcome, children: state.children.length } };
}

// --- entry --------------------------------------------------------------------------------

function run(argv: readonly string[]): Outcome {
  const parsed = parseChildPaneArgs(argv);
  if (!parsed.ok) throw new CliExit(EXIT_ERROR, parsed.error);
  const s = authorise();
  requireHerdrSession(s);
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
