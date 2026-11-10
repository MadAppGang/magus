#!/usr/bin/env bun
// Opens a ticket window at a repo's main checkout, a tmux window or a herdr
// tab, and types one line into its shell:
//
//   git pull --ff-only && { ! command -v magus … || magus update || echo …; } && <launch>
//
// <launch> defaults to a Claude Code session in a new worktree named --name:
//
//   CLAUDE_WT_NAME=<name> CLAUDE_WT_COLOUR=<colour> claude -w <name> -n <name> [--model M] [--effort E] '/color <colour>'
//
// --launch, or ORCHESTRATOR_LAUNCH, replaces it with `<launch> <name> <colour> [-- <claude flags>]`.
//
// Either launch is preceded by `ORCHESTRATOR_CLAIM='l-<id>'` (and
// `ORCHESTRATOR_STATE_DIR='<dir>'` when that is set here). Before the line is
// typed or printed, a claim is written to <state dir>/claims/l-<id>.json naming
// the new session's role (manager for a window, child for --print-line), name,
// ticket, parent (this session's own record, if it has one) and product. The
// first Claude Code session that starts with that id binds itself to the claim;
// a nested session that inherits the variable finds it taken and binds nothing.
//
// Usage:
//   bun ticket-window.ts --name <slug> --colour <colour> [--prompt <text>]
//       [--dir <main checkout>] [--session <tmux session>] [--ticket <id>] [--ticket-url <url>]
//       [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]
//   bun ticket-window.ts --print-line --name <slug> --colour <colour>
//       [--dir <main checkout>] [--ticket <id>] [--ticket-url <url>]
//       [--model <id>] [--effort <level>] [--launch <command>]
//
//   --name        lower-case letters, digits, . _ -; starts with a letter or digit; at most 48 characters
//   --colour      (or --color) red blue green yellow purple orange pink cyan default
//   --ticket      the ticket the session works: '#229', '229', 'owner/repo#229', 'ABC-7' (quote it:
//                 an unquoted # starts a shell comment); a bare number becomes owner/repo#N from
//                 the checkout's origin
//   --ticket-url  the ticket's https URL
//   --prompt      typed into Claude Code once it is up, by a detached second stage
//   --dir         a repo's main checkout; defaults to the main checkout of the current directory
//   --session     tmux only: session for the new window; defaults to the current one; created when missing
//   --no-wait     exit 6 at once when another start in the same checkout holds the lock
//   --dry-run     print what would be done, with the commands; opens nothing, takes no lock and
//                 writes no claim (the line shows ORCHESTRATOR_CLAIM='l-dry-run')
//   --print-line  run the checkout checks, write the child's claim and print, as JSON, the line
//                 that starts a child session in another pane: cd '<dir>' && git pull --ff-only
//                 && <launch>, with the claim id. Opens nothing, takes no lock, needs no multiplexer
//
// The multiplexer: ORCHESTRATOR_MULTIPLEXER=tmux|herdr decides when set. Else
// the ticket opens where this session runs (herdr when HERDR_ENV=1 and
// HERDR_PANE_ID are set and that pane hosts this process, else tmux when TMUX
// is set), unless the answer stored by orch-config.ts picks the other one in an
// ambiguous case: herdr inside tmux, or tmux with herdr installed. Under herdr
// the ticket opens in a new tab, without taking the focus: in the caller's
// workspace, or from tmux in HERDR_WORKSPACE_ID, else the focused workspace.
//
// Exit codes:
//   0  opened (or, with --dry-run, would open; with --print-line, printed)
//   1  bad input, not inside tmux or herdr, --session under herdr, a tmux, herdr or git error,
//      no herdr server for a stored herdr choice, or the claim could not be
//      written (nothing is typed or printed then)
//   2  the main checkout is not on its default branch (the worktree would start from it)
//   3  the worktree already exists
//   6  the checkout's lock is busy (--no-wait, or 16 minutes of waiting)
//
// One start at a time per checkout: `git pull`, `magus update` and the worktree
// creation all touch the same main checkout. A lock directory under the state
// dir (ORCHESTRATOR_STATE_DIR, else ~/.claude/orchestrator) is taken before the
// window opens and released by the second stage once Claude Code is up, or on
// TIMEOUT, GONE or UNTRUSTED. The second stage records one outcome per start in
// ticket-window.log in the same directory:
//
//   SENT                          the prompt landed: Claude Code took it
//   SENT (needed a second Enter)  it landed after one more Enter
//   SENT (retyped once: …)        the first copy was dropped; a second copy was typed
//   SENT (unconfirmed)            it is on screen, but Claude Code was not seen starting on it
//   NOT_SENT                      the retyped copy did not land either; never typed a third time
//   READY                         Claude Code is up; there was no prompt to type
//   TIMEOUT, GONE, UNTRUSTED      Claude Code never came up in the pane
//
// The line is typed into an interactive shell, as a person would, so a launch
// command defined as a shell function in the user's rc file works too.
//
// Internal: --deliver-to <pane> --mux tmux|herdr --prompt <text> [--lock <dir>]
// [--trust-after <text>] [--expect-terminal <id>] runs the second stage. A
// refusal to start counts only after the last occurrence of --trust-after on
// screen. With --expect-terminal, herdr must still report that terminal for the
// pane before every input; otherwise nothing more is sent. Its exit codes:
// 0 sent or ready, 4 TIMEOUT, 5 GONE, 7 UNTRUSTED, 8 NOT_SENT.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type HerdrResult, type HerdrRunner, HERDR_TIMEOUT_MS, herdrRunner, resolveHerdrBin } from "./lib/herdr-cli.ts";
import { chooseStartMux } from "./lib/mux-choice.ts";
import { resolveMux } from "./lib/mux-io.ts";
import { type StoreContext, awaitLockHandOver, claudeConfigDirOf, handLockTo, ownedKey, pidAlive, readIdentity, writeAtomic, writeClaim } from "./lib/record-store.ts";
import { type OrchestratorClaim, isSessionId, launchKey, normaliseTicketId } from "./lib/state-core.ts";
import { childTicket, repoFromRemoteUrl } from "./lib/ticket.ts";
import {
  type DeliverArgs,
  type Multiplexer,
  type PrintLineArgs,
  type StartArgs,
  buildChildLine,
  buildHerdrRun,
  buildHerdrTabCreate,
  buildLaunchLine,
  herdrFocusedWorkspace,
  herdrPaneOfTab,
  isClaudeForeground,
  lockIsStale,
  lockPathFor,
  mainCheckoutFromCommonDir,
  parseArgs,
  parseHerdrPane,
  parseHerdrPaneState,
  parseHerdrTabCreate,
  promptStillInInput,
  screenShowsTrustError,
  stateDir,
} from "./lib/window.ts";

const EXIT_BAD_INPUT = 1;
const EXIT_OFF_DEFAULT_BRANCH = 2;
const EXIT_WORKTREE_EXISTS = 3;
const EXIT_TIMEOUT = 4;
const EXIT_GONE = 5;
const EXIT_LOCK_BUSY = 6;
const EXIT_UNTRUSTED = 7;
const EXIT_NOT_SENT = 8;

/** The claim id a `--dry-run` line shows; no claim file carries it. */
const DRY_RUN_CLAIM = "l-dry-run";

/** How long a start waits for another start in the same checkout. */
const LOCK_WAIT_MS = 16 * 60_000;
/** How long stage 2 waits to be named in the lock before leaving the lock alone. */
const LOCK_HAND_OVER_WAIT_MS = 2_000;
/** How long the second stage waits for Claude Code: git pull, magus update and boot; magus may ask a question. */
const DELIVER_DEADLINE_MS = 15 * 60_000;
/** How long the new shell may take to draw its prompt. */
const SHELL_READY_DEADLINE_MS = 15_000;
/** How long one `herdr agent wait` poll may block. */
const HERDR_AGENT_POLL_MS = 500;
/** How long stage 2 waits for Claude Code to show it took a submitted prompt. */
const LANDED_WAIT_MS = 15_000;
/** How much longer than its own `--timeout` a blocking herdr call may run. */
const HERDR_WAIT_GRACE_MS = 2_000;
const NO_HERDR_SERVER =
  "herdr is your stored choice for new ticket windows, but no herdr server answers. Start herdr, or run orch-config.ts multiplexer --set tmux.";

let heldLock: string | undefined;

function releaseLock(path: string | undefined): void {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Already gone, or not ours to remove: either way nothing is left to release.
  }
}

function fail(msg: string, code = EXIT_BAD_INPUT): never {
  console.error(`ticket-window: ${msg}`);
  releaseLock(heldLock);
  process.exit(code);
}

function run(cmd: string[], cwd?: string): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const out = (p.stdout.toString() + p.stderr.toString()).trim();
    return { ok: p.exitCode === 0, out };
  } catch (err) {
    // A missing binary (tmux, herdr or git not installed) throws instead of exiting non-zero.
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

let herdrExec: HerdrRunner | undefined;

/** One herdr call, through the resolved binary, with a timeout. */
function herdr(args: readonly string[], timeoutMs?: number): HerdrResult {
  herdrExec ??= herdrRunner(resolveHerdrBin(process.env, process.env.HOME || homedir()) ?? "herdr");
  return herdrExec(args, timeoutMs);
}

/** A herdr call's whole output, for reading a screen. */
function herdrAll(args: readonly string[]): { ok: boolean; out: string } {
  const r = herdr(args);
  return { ok: r.ok, out: (r.stdout + r.stderr).trim() };
}

/** A herdr call's stdout, so a JSON answer is not mixed with warnings on stderr; on failure its stderr. */
function herdrJson(args: readonly string[]): { ok: boolean; out: string } {
  const r = herdr(args);
  if (r.timedOut) return { ok: false, out: `herdr did not answer within ${HERDR_TIMEOUT_MS} ms` };
  return { ok: r.ok, out: (r.ok ? r.stdout : r.stderr).trim() };
}

/** Whether the pane's agent reaches one of `until` within `ms`. */
function herdrAgentReaches(pane: string, until: readonly string[], ms: number): boolean {
  return herdr(["agent", "wait", pane, ...until.flatMap((state) => ["--until", state]), "--timeout", String(ms)], ms + HERDR_WAIT_GRACE_MS).ok;
}

function resolveStateDir(): string {
  try {
    return stateDir(process.env, process.env.HOME || homedir());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// --- the multiplexers ---------------------------------------------------------

/** What both stages need from the multiplexer a pane lives in. */
interface MuxIO {
  /** Whether the pane still exists. */
  exists(pane: string): boolean;
  /** The visible screen, for telling when a fresh shell has drawn its prompt. */
  visible(pane: string): string;
  /** The recent screen and scrollback with wrapped lines joined. */
  screen(pane: string): string;
  /** Whether Claude Code is the pane's foreground program and the multiplexer sees it at rest. */
  claudeUp(pane: string): boolean;
  /** Whether the multiplexer reports that the pane's agent has finished a turn. */
  finishedTurn(pane: string): boolean;
  /** The pane's working directory, or null when it cannot be read. */
  cwd(pane: string): string | null;
  /** Types one line into the pane's interactive shell and presses Enter. */
  runLine(pane: string, line: string): { ok: boolean; out: string };
  /** Types text literally, without Enter. */
  sendText(pane: string, text: string): void;
  sendEnter(pane: string): void;
  /**
   * Whether Claude Code took a submitted prompt, waiting up to LANDED_WAIT_MS.
   * `before` is the screen as it was just before the prompt was typed;
   * `wasDone` is `finishedTurn` as it was then.
   */
  landed(pane: string, prompt: string, before: string, wasDone: boolean): boolean;
}

/** The part of a prompt looked for on screen: its first 40 characters, up to the first line break. */
function promptHead(prompt: string): string {
  return prompt.slice(0, 40).split("\n")[0] ?? "";
}

/** The screen without its input box: everything but the last `❯` line. */
function outsideInput(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trimStart().startsWith("❯")) return [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
  }
  return screen;
}

// tmux cannot tell what Claude Code is doing, so the screen decides. The prompt
// landed when its first 40 characters show outside the input box (the
// transcript echoes a submitted prompt), or when the screen differs from the
// one before typing and the prompt is not in the input box (Claude Code cleared
// the box and is working). A dropped prompt leaves the screen as it was.
function tmuxLanded(pane: string, prompt: string, before: string): boolean {
  const head = promptHead(prompt);
  const by = Date.now() + LANDED_WAIT_MS;
  for (;;) {
    const screen = tmuxIO.screen(pane);
    if (head !== "" && outsideInput(screen).includes(head)) return true;
    if (screen !== before && !promptStillInInput(screen, prompt)) return true;
    if (Date.now() > by) return false;
    Bun.sleepSync(500);
  }
}

const tmuxIO: MuxIO = {
  exists: (pane) => run(["tmux", "display", "-p", "-t", pane, "#{pane_id}"]).ok,
  visible: (pane) => run(["tmux", "capture-pane", "-p", "-t", pane]).out,
  screen: (pane) => run(["tmux", "capture-pane", "-p", "-J", "-t", pane, "-S", "-200"]).out,
  claudeUp: (pane) => {
    const fg = run(["tmux", "display", "-p", "-t", pane, "#{pane_current_command}"]);
    return fg.ok && isClaudeForeground(fg.out);
  },
  finishedTurn: () => false,
  cwd: (pane) => {
    const p = run(["tmux", "display", "-p", "-t", pane, "#{pane_current_path}"]);
    return p.ok && p.out !== "" ? p.out : null;
  },
  runLine: (pane, line) => {
    // -l types the text literally; Enter goes separately, as a keypress.
    const typed = run(["tmux", "send-keys", "-t", pane, "-l", line]);
    if (!typed.ok) return typed;
    return run(["tmux", "send-keys", "-t", pane, "Enter"]);
  },
  sendText: (pane, text) => {
    run(["tmux", "send-keys", "-t", pane, "-l", text]);
  },
  sendEnter: (pane) => {
    run(["tmux", "send-keys", "-t", pane, "Enter"]);
  },
  landed: (pane, prompt, before) => tmuxLanded(pane, prompt, before),
};

const herdrIO: MuxIO = {
  exists: (pane) => herdr(["pane", "get", pane]).ok,
  visible: (pane) => herdrAll(["pane", "read", pane, "--source", "visible"]).out,
  screen: (pane) => herdrAll(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"]).out,
  // herdr recognises Claude Code in a pane and reports when it is at rest:
  // idle, or done when it finished a turn while unfocused.
  claudeUp: (pane) => herdrAgentReaches(pane, ["idle", "done"], HERDR_AGENT_POLL_MS),
  finishedTurn: (pane) => {
    const answer = herdr(["pane", "get", pane]);
    return answer.ok && parseHerdrPaneState(answer.stdout)?.status === "done";
  },
  cwd: (pane) => {
    const p = herdrJson(["pane", "get", pane]);
    return p.ok ? parseHerdrPane(p.out)?.cwd || null : null;
  },
  runLine: (pane, line) => herdrAll(buildHerdrRun(pane, line).slice(1)),
  sendText: (pane, text) => {
    herdr(["pane", "send-text", pane, text]);
  },
  sendEnter: (pane) => {
    herdr(["pane", "send-keys", pane, "enter"]);
  },
  // herdr tracks the agent's state: a prompt Claude Code took turns it to
  // working, or to done when the turn is already over. A pane that was already
  // done would satisfy `done` at once, so only `working` proves anything there.
  landed: (pane, _prompt, _before, wasDone) => herdrAgentReaches(pane, wasDone ? ["working"] : ["working", "done"], LANDED_WAIT_MS),
};

/** Why the pane no longer holds `terminal` (or, with `needAgent`, has no agent to type to); null while it does. */
function witnessLost(pane: string, terminal: string, needAgent: boolean): string | null {
  const answer = herdr(["pane", "get", pane], HERDR_TIMEOUT_MS);
  if (answer.errorCode === "pane_not_found") return "the pane closed";
  const state = answer.ok ? parseHerdrPaneState(answer.stdout) : null;
  if (state === null) return "herdr gave no readable answer for the pane";
  if (state.terminal !== terminal) return `the pane now holds another terminal (${state.terminal ?? "none"}, expected ${terminal})`;
  return needAgent && state.agent === null ? "no agent runs in the pane any more" : null;
}

function ioFor(mux: Multiplexer): MuxIO {
  switch (mux) {
    case "tmux":
      return tmuxIO;
    case "herdr":
      return herdrIO;
  }
}

// --- entry --------------------------------------------------------------------

const parsed = parseArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  fail(
    `${parsed.error}\n` +
      "usage: --name <slug> --colour <colour> [--prompt <text>] [--dir <main checkout>] [--session <name>]\n" +
      "       [--ticket <id>] [--ticket-url <url>] [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]\n" +
      "   or: --print-line --name <slug> --colour <colour> [--dir <main checkout>] [--ticket <id>] [--ticket-url <url>]\n" +
      "       [--model <id>] [--effort <level>] [--launch <command>]",
  );
}

switch (parsed.args.mode) {
  case "deliver":
    deliver(parsed.args);
    break;
  case "print-line":
    printLine(parsed.args);
    break;
  case "start":
    start(parsed.args);
    break;
}

// --- stage 2 ----------------------------------------------------------------------

// Waits for the Claude Code that the typed line starts in the pane, then types
// the prompt and submits it. Text and Enter in one send reads as an
// unsubmitted paste, so Enter goes alone after 2 s. A pane is ready once
// Claude Code is its foreground program and its screen has been unchanged for
// 2 s. A `claude -w` that refuses an untrusted checkout exits at once; that is
// logged as UNTRUSTED and the lock is released straight away.
function deliver({ pane, prompt, lock, mux, trustAfter, expectTerminal }: DeliverArgs): never {
  const io = ioFor(mux);
  const logFile = join(resolveStateDir(), "ticket-window.log");
  const log = (msg: string): void => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      // Logging is best effort: the detached stage has no one else to tell.
    }
  };

  // Released once: after that the path may name the next start's lock. Only a
  // lock that names this stage is removed, which also keeps the starter's
  // hand-off from landing on a lock taken after this one was freed.
  let heldByThisStage = lock;
  const freeLock = (): void => {
    if (heldByThisStage !== undefined && awaitLockHandOver(heldByThisStage, LOCK_HAND_OVER_WAIT_MS)) releaseLock(heldByThisStage);
    heldByThisStage = undefined;
  };
  const gone = (why: string): never => {
    log(`${pane} GONE: ${why}; not typed: ${prompt}`);
    freeLock();
    process.exit(EXIT_GONE);
  };
  // herdr addresses input by pane id alone and a restart reuses ids, so the
  // terminal is read again right before each input.
  const requireWitness = (needAgent: boolean): void => {
    if (expectTerminal === undefined) return;
    const lost = witnessLost(pane, expectTerminal, needAgent);
    if (lost !== null) gone(lost);
  };

  const deadline = Date.now() + DELIVER_DEADLINE_MS;
  let last = "";
  let stableSince = Date.now();
  for (;;) {
    if (Date.now() > deadline) {
      log(`${pane} TIMEOUT: Claude Code never became ready; not typed: ${prompt}`);
      freeLock();
      process.exit(EXIT_TIMEOUT);
    }
    requireWitness(false);
    if (expectTerminal === undefined && !io.exists(pane)) gone("the pane closed before Claude Code was ready");
    const screen = io.screen(pane);
    if (screenShowsTrustError(screen, trustAfter)) {
      freeLock();
      const dir = io.cwd(pane) ?? "the checkout";
      log(
        `${pane} UNTRUSTED: Claude Code has not been trusted in ${dir}, so claude -w refused to start. ` +
          `Run \`claude\` once in ${dir}, accept the trust dialog, then start again; not typed: ${prompt}`,
      );
      process.exit(EXIT_UNTRUSTED);
    }
    if (screen !== last) {
      last = screen;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 2000 && io.claudeUp(pane)) {
      break;
    }
    Bun.sleepSync(500);
  }

  // Everything the typed line does is finished: the next start in this checkout may go.
  freeLock();
  if (!prompt) {
    log(`${pane} READY: Claude Code is up; no prompt to type`);
    process.exit(0);
  }

  // The launch types `/color <colour>` into the same TUI right after it starts.
  // A prompt typed while that runs is dropped with nothing on screen, so wait
  // for its acknowledgement first (capped, in case none comes), then for the
  // screen to settle again.
  const colourBy = Date.now() + 30_000;
  while (Date.now() < colourBy && !io.screen(pane).includes("Session color set")) Bun.sleepSync(500);
  let settled = io.screen(pane);
  let settledSince = Date.now();
  while (Date.now() - settledSince < 2000 && Date.now() < colourBy + 10_000) {
    Bun.sleepSync(500);
    const s = io.screen(pane);
    if (s !== settled) {
      settled = s;
      settledSince = Date.now();
    }
  }

  const typeOnce = (): void => {
    requireWitness(true);
    io.sendText(pane, prompt);
    Bun.sleepSync(2000);
    requireWitness(true);
    io.sendEnter(pane);
  };
  const wasDone = io.finishedTurn(pane);
  typeOnce();

  // A prompt still in the input box gets one more Enter, never another copy.
  Bun.sleepSync(3000);
  const secondEnter = promptStillInInput(io.screen(pane), prompt);
  if (secondEnter) {
    requireWitness(true);
    io.sendEnter(pane);
  }

  if (io.landed(pane, prompt, settled, wasDone)) {
    log(secondEnter ? `${pane} SENT (needed a second Enter): ${prompt}` : `${pane} SENT: ${prompt}`);
    process.exit(0);
  }

  // A copy that is anywhere on screen may yet be taken, or may sit in a question
  // the workflow opened; typing again could run it twice, so it is left alone.
  // Only a copy absent from the screen was dropped, and only that is retyped, once.
  const head = promptHead(prompt);
  const before = io.screen(pane);
  if (head === "" || before.includes(head)) {
    log(`${pane} SENT (unconfirmed): the prompt is on screen but Claude Code was not seen starting on it: ${prompt}`);
    process.exit(0);
  }
  typeOnce();
  log(`${pane} SENT (retyped once: the first copy was dropped): ${prompt}`);
  if (io.landed(pane, prompt, before, wasDone)) process.exit(0);

  const reason = promptStillInInput(io.screen(pane), prompt)
    ? "the retyped copy is still in the input box"
    : "Claude Code did not take the retyped copy either";
  log(`${pane} NOT_SENT: ${reason}; not typed again: ${prompt}`);
  process.exit(EXIT_NOT_SENT);
}

// --- checkout checks -------------------------------------------------------------

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function resolveCheckout(dirArg: string | undefined): string {
  const base = dirArg !== undefined ? resolve(dirArg) : process.cwd();
  if (!existsSync(base)) fail(`${base} does not exist`);
  const common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], base);
  if (!common.ok) fail(`${base} is not inside a git repository: ${common.out}`);
  const checkout = mainCheckoutFromCommonDir(common.out);
  if (checkout === null) fail(`${base} has no main checkout (git common dir: ${common.out})`);
  if (dirArg !== undefined && !sameDir(checkout, base)) {
    fail(`${base} is not a main checkout; the main checkout of that repo is ${checkout}. Pass --dir ${checkout}`);
  }
  return checkout;
}

/**
 * The guards every start shares. Exits 2 when the checkout is off its default
 * branch and 3 when the worktree already exists; returns the branch otherwise.
 */
function checkCheckout(dir: string, name: string): string {
  // `claude -w` builds the worktree from the main checkout's HEAD. A main
  // checkout parked on a feature branch would silently base the work on it.
  const head = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], dir);
  if (!head.ok) fail(`cannot read the branch of ${dir}: ${head.out}`);
  const branch = head.out;
  const originHead = run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir);
  const defaultBranch = originHead.ok ? originHead.out.replace(/^origin\//, "") : "main";
  if (branch !== defaultBranch) {
    fail(
      `${dir} is on "${branch}", not "${defaultBranch}". The worktree would start from "${branch}". ` +
        `Switch that checkout to ${defaultBranch} first, or pass --dir to another checkout.`,
      EXIT_OFF_DEFAULT_BRANCH,
    );
  }
  const worktree = join(dir, ".claude", "worktrees", name);
  if (existsSync(worktree)) fail(`worktree ${worktree} already exists; resume it in its own window instead`, EXIT_WORKTREE_EXISTS);
  return branch;
}

/** The variables in front of the launch: the claim id, and the state dir when one is set here. */
function launchEnv(claimId: string): Array<readonly [string, string]> {
  const env: Array<readonly [string, string]> = [["ORCHESTRATOR_CLAIM", claimId]];
  const state = process.env.ORCHESTRATOR_STATE_DIR;
  if (state) env.push(["ORCHESTRATOR_STATE_DIR", state]);
  return env;
}

function launchSpec(args: StartArgs | PrintLineArgs, claimId: string) {
  return {
    name: args.name,
    colour: args.colour,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    ...(args.launch !== undefined ? { launch: args.launch } : {}),
    env: launchEnv(claimId),
  };
}

function storeContext(): StoreContext {
  return { stateDir: resolveStateDir(), claudeConfigDir: claudeConfigDirOf(process.env, process.env.HOME || homedir()) };
}

/** The main checkout of the directory this launcher runs in, or null. */
function ownMainCheckout(): string | null {
  const common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common.ok ? mainCheckoutFromCommonDir(common.out) : null;
}

/**
 * Writes the claim the launched session binds to and returns its id. The parent
 * is this session's own record, if it owns one; the product is that record's,
 * else this launcher's own main checkout. A child launched by a manager that
 * owns a ticket carries that ticket (`childTicket`); a `--ticket` naming
 * another one exits 1. Any other launch normalises its ticket id against the
 * origin of `lineDir`, the checkout the line runs in. Exits 1 when the claim
 * cannot be written, before anything is typed or printed.
 */
function writeLaunchClaim(args: StartArgs | PrintLineArgs, role: OrchestratorClaim["role"], lineDir: string): string {
  const ctx = storeContext();
  const key = launchKey(randomUUID());
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID?.trim() ?? "";
  const parent = isSessionId(sessionId) ? ownedKey(ctx, sessionId) : null;
  const parentIdentity = parent !== null ? readIdentity(ctx, parent) : null;
  const product = parentIdentity?.product ?? ownMainCheckout() ?? lineDir;
  let ticket: OrchestratorClaim["ticket"] = null;
  if (role === "child" && parentIdentity?.role === "manager" && parentIdentity.ticket !== null) {
    const inherited = childTicket(args.ticket ?? null, parentIdentity.ticket);
    if (!inherited.ok) fail(inherited.error);
    ticket = inherited.ticket;
  } else if (args.ticket !== undefined) {
    const origin = run(["git", "remote", "get-url", "origin"], lineDir);
    const originRepo = origin.ok ? repoFromRemoteUrl(origin.out) : null;
    ticket = { id: normaliseTicketId(args.ticket, originRepo), url: args.ticketUrl ?? null };
  }
  const claim: OrchestratorClaim = { schema: 1, key, role, name: args.name, ticket, parent, product, createdAt: Date.now() };
  try {
    writeClaim(ctx, claim);
  } catch (err) {
    fail(`could not write the launch claim: ${err instanceof Error ? err.message : String(err)}`);
  }
  return key;
}

// --- --print-line -------------------------------------------------------------------

function printLine(args: PrintLineArgs): never {
  const dir = resolveCheckout(args.dir);
  const branch = checkCheckout(dir, args.name);
  // Validate the line before a claim exists, so a bad value leaves nothing behind.
  try {
    buildChildLine({ ...launchSpec(args, DRY_RUN_CLAIM), dir });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const claim = writeLaunchClaim(args, "child", dir);
  const line = buildChildLine({ ...launchSpec(args, claim), dir });
  console.log(JSON.stringify({ dir, branch, name: args.name, colour: args.colour, claim, line }, null, 2));
  process.exit(0);
}

// --- stage 1 ----------------------------------------------------------------------

function takeLock(lockPath: string, name: string, noWait: boolean): void {
  mkdirSync(join(lockPath, ".."), { recursive: true });
  const waitUntil = Date.now() + LOCK_WAIT_MS;
  const infoFile = join(lockPath, "info.json");
  for (;;) {
    try {
      mkdirSync(lockPath); // the atomic step
      heldLock = lockPath;
      writeAtomic(infoFile, JSON.stringify({ pid: process.pid, name, since: Date.now() }));
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") fail(`cannot create the lock ${lockPath}: ${String(err)}`);
    }
    let infoText: string | null;
    try {
      infoText = readFileSync(infoFile, "utf8");
    } catch (err) {
      infoText = (err as NodeJS.ErrnoException).code === "ENOENT" ? null : "";
    }
    let lockMtimeMs: number | null;
    try {
      lockMtimeMs = statSync(lockPath).mtimeMs;
    } catch {
      lockMtimeMs = null;
    }
    if (lockIsStale({ infoText, lockMtimeMs, now: Date.now(), pidAlive })) {
      releaseLock(lockPath); // stale: take it over on the next turn
      continue;
    }
    if (noWait) fail(`another start in this checkout is still running; try again in a minute (lock ${lockPath})`, EXIT_LOCK_BUSY);
    if (Date.now() > waitUntil) fail(`waited 16 minutes for the previous start in this checkout to finish (lock ${lockPath})`, EXIT_LOCK_BUSY);
    Bun.sleepSync(2000);
  }
}

/** Where this start opens, and whether the session itself runs in tmux. */
function windowMuxFor(args: StartArgs): { mux: Multiplexer; fromTmux: boolean } {
  const resolved = resolveMux(process.env, { home: process.env.HOME || homedir(), stateDir: resolveStateDir() });
  const start = chooseStartMux({
    session: resolved.session,
    windows: resolved.windows,
    named: args.session !== undefined,
    forced: Boolean(process.env.ORCHESTRATOR_MULTIPLEXER),
  });
  if (!start.ok) fail(start.error);
  return { mux: start.mux, fromTmux: resolved.session.ok && resolved.session.mux === "tmux" };
}

function resolveSession(sessionArg: string | undefined): string {
  if (sessionArg !== undefined) return sessionArg;
  const target = process.env.TMUX_PANE ? ["-t", process.env.TMUX_PANE] : [];
  const current = run(["tmux", "display-message", "-p", ...target, "#{session_name}"]);
  if (!current.ok || current.out === "") fail(`could not read the current tmux session: ${current.out}`);
  return current.out;
}

/** The workspace of the herdr pane this start runs in: the new tab opens beside it. */
function herdrWorkspace(): string {
  const fromEnv = process.env.HERDR_WORKSPACE_ID;
  if (fromEnv) return fromEnv;
  const self = process.env.HERDR_PANE_ID;
  const answer = herdrJson(self ? ["pane", "get", self] : ["pane", "current"]);
  if (!answer.ok) fail(`could not read the current herdr pane: ${answer.out}`);
  const workspace = parseHerdrPane(answer.out)?.workspaceId;
  if (!workspace) fail(`herdr did not name the current pane's workspace: ${answer.out}`);
  return workspace;
}

/** The workspace for a new tab opened from a tmux session, which has no herdr pane of its own. */
function herdrWorkspaceFromTmux(): string {
  const fromEnv = process.env.HERDR_WORKSPACE_ID;
  if (fromEnv) return fromEnv;
  const answer = herdrJson(["workspace", "list"]);
  if (!answer.ok) fail(NO_HERDR_SERVER);
  const workspace = herdrFocusedWorkspace(answer.out);
  if (workspace === null) fail(`herdr names no focused workspace to open the tab in. Focus one, or run orch-config.ts multiplexer --set tmux: ${answer.out}`);
  return workspace;
}

function tmuxOpenArgv(session: string, hasSession: boolean, name: string, dir: string): string[] {
  // `=name` makes tmux match the session name exactly, never by prefix. `-d` keeps the
  // user's focus where it is: keys they type must not land in the line being typed here.
  return hasSession
    ? ["tmux", "new-window", "-d", "-t", `=${session}:`, "-n", name, "-c", dir, "-P", "-F", "#{pane_id}"]
    : ["tmux", "new-session", "-d", "-s", session, "-n", name, "-c", dir, "-P", "-F", "#{pane_id}"];
}

/** Opens the tab and returns its tab id and pane id. */
function openHerdrTab(argv: string[], fromTmux: boolean): { tabId: string; pane: string } {
  // One call only: repeating a failed create could open a second tab.
  const created = herdr(argv.slice(1));
  if (!created.ok) {
    if (fromTmux && created.errorCode === "server_not_running") fail(NO_HERDR_SERVER);
    fail(`herdr could not open the tab: ${created.timedOut ? `no answer within ${HERDR_TIMEOUT_MS} ms` : created.stderr.trim()}`);
  }
  const tab = parseHerdrTabCreate(created.stdout);
  if (tab === null || tab.tabId === "") fail(`herdr opened a tab but its answer did not name it: ${created.stdout.trim()}`);
  // An empty root pane id names no pane; look the tab's pane up instead.
  if (tab.paneId !== null && tab.paneId !== "") return { tabId: tab.tabId, pane: tab.paneId };
  const panes = herdrJson(["pane", "list"]);
  const pane = panes.ok ? herdrPaneOfTab(panes.out, tab.tabId) : null;
  if (pane === null) fail(`herdr opened tab ${tab.tabId} but no pane of it was found`);
  return { tabId: tab.tabId, pane };
}

function start(args: StartArgs): never {
  const { mux, fromTmux } = windowMuxFor(args);
  const io = ioFor(mux);
  const session = mux === "tmux" ? resolveSession(args.session) : null;
  const dir = resolveCheckout(args.dir);
  const branch = checkCheckout(dir, args.name);

  let line: string;
  try {
    line = buildLaunchLine(launchSpec(args, DRY_RUN_CLAIM));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const state = resolveStateDir();
  const lockPath = lockPathFor(state, dir);
  const logFile = join(state, "ticket-window.log");

  const hasSession = session === null ? true : run(["tmux", "has-session", "-t", `=${session}`]).ok;
  const openArgv =
    session === null
      ? buildHerdrTabCreate({ dir, name: args.name, workspace: fromTmux ? herdrWorkspaceFromTmux() : herdrWorkspace() })
      : tmuxOpenArgv(session, hasSession, args.name, dir);

  if (args.dryRun) {
    const typeArgv =
      mux === "tmux"
        ? [
            ["tmux", "send-keys", "-t", "<pane>", "-l", line],
            ["tmux", "send-keys", "-t", "<pane>", "Enter"],
          ]
        : [buildHerdrRun("<pane>", line)];
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          multiplexer: mux,
          session,
          ...(mux === "tmux" ? { window: args.name } : { tab: null }),
          dir,
          branch,
          name: args.name,
          colour: args.colour,
          claim: DRY_RUN_CLAIM,
          line,
          prompt: args.prompt || null,
          lock: lockPath,
          log: logFile,
          commands: [openArgv, ...typeArgv],
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // The claim exists before the line is typed; the line carries its id.
  const claim = writeLaunchClaim(args, "manager", dir);
  line = buildLaunchLine(launchSpec(args, claim));

  takeLock(lockPath, args.name, args.noWait);

  let pane: string;
  let tabId: string | null = null;
  if (mux === "tmux") {
    const created = run(openArgv);
    if (!created.ok) fail(`tmux could not open the window: ${created.out}`);
    pane = created.out;
  } else {
    const tab = openHerdrTab(openArgv, fromTmux);
    pane = tab.pane;
    tabId = tab.tabId;
  }
  const where = mux === "tmux" ? `${session}, pane ${pane}` : `herdr tab ${tabId}, pane ${pane}`;

  // Stage 2 never runs under herdr without knowing which terminal this pane holds.
  let terminal: string | null = null;
  if (mux === "herdr") {
    const answer = herdr(["pane", "get", pane]);
    terminal = answer.ok ? (parseHerdrPaneState(answer.stdout)?.terminal ?? null) : null;
    if (terminal === null) fail(`window opened (${where}) but herdr did not name its terminal; nothing was typed`);
  }

  // Wait for the shell to be ready before typing. A login shell queries the
  // terminal (OSC 11 / DA) while it starts, and those reads eat typeahead: the
  // text survives but its Enter does not. Ready = the screen is non-empty and
  // unchanged for 700 ms, i.e. the prompt is drawn.
  let last = "";
  let stableSince = 0;
  const deadline = Date.now() + SHELL_READY_DEADLINE_MS;
  for (;;) {
    const screen = io.visible(pane);
    const now = Date.now();
    if (screen !== last) {
      last = screen;
      stableSince = now;
    } else if (screen !== "" && now - stableSince >= 700) {
      break;
    }
    if (now > deadline) fail(`window opened (${where}) but its shell never became ready; nothing was typed`);
    Bun.sleepSync(100);
  }

  const typed = io.runLine(pane, line);
  if (!typed.ok) fail(`window opened (${where}) but typing the command failed: ${typed.out}`);

  // Stage 2, detached: type the prompt once Claude Code is up.
  const child = Bun.spawn(
    [
      process.execPath,
      import.meta.path,
      "--deliver-to",
      pane,
      "--mux",
      mux,
      "--prompt",
      args.prompt,
      "--lock",
      lockPath,
      ...(terminal !== null ? ["--expect-terminal", terminal] : []),
    ],
    { stdio: ["ignore", "ignore", "ignore"], detached: true },
  );
  child.unref();
  // From here the lock belongs to stage 2; its pid is what a waiting start checks.
  handLockTo(lockPath, child.pid, args.name);
  heldLock = undefined;

  console.log(
    JSON.stringify(
      {
        multiplexer: mux,
        session,
        ...(mux === "tmux" ? { window: args.name } : { tab: tabId }),
        pane,
        dir,
        sessionCreated: !hasSession,
        claim,
        typed: line,
        prompt: args.prompt || null,
        log: logFile,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
