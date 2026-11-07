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
// Usage:
//   bun ticket-window.ts --name <slug> --colour <colour> [--prompt <text>]
//       [--dir <main checkout>] [--session <tmux session>]
//       [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]
//   bun ticket-window.ts --print-line --name <slug> --colour <colour>
//       [--dir <main checkout>] [--model <id>] [--effort <level>] [--launch <command>]
//
//   --name        lower-case letters, digits, . _ -; starts with a letter or digit; at most 48 characters
//   --colour      (or --color) red blue green yellow purple orange pink cyan default
//   --prompt      typed into Claude Code once it is up, by a detached second stage
//   --dir         a repo's main checkout; defaults to the main checkout of the current directory
//   --session     tmux only: session for the new window; defaults to the current one; created when missing
//   --no-wait     exit 6 at once when another start in the same checkout holds the lock
//   --dry-run     print what would be done, with the commands; opens nothing and takes no lock
//   --print-line  run the checkout checks and print, as JSON, the line that starts a child
//                 session in another pane: cd '<dir>' && git pull --ff-only && <launch>.
//                 Opens nothing, takes no lock, needs no multiplexer
//
// The multiplexer: ORCHESTRATOR_MULTIPLEXER=tmux|herdr decides when set. Else
// herdr when HERDR_ENV=1 and HERDR_PANE_ID are set and `herdr pane current`
// answers, else tmux when TMUX is set. Under herdr the ticket opens in a new
// tab of the caller's workspace, without taking the focus.
//
// Exit codes:
//   0  opened (or, with --dry-run, would open; with --print-line, printed)
//   1  bad input, not inside tmux or herdr, --session under herdr, or a tmux, herdr or git error
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
// runs the second stage. Its exit codes: 0 sent or ready, 4 TIMEOUT, 5 GONE,
// 7 UNTRUSTED, 8 NOT_SENT.

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type DeliverArgs,
  type Multiplexer,
  type PrintLineArgs,
  type StartArgs,
  buildChildLine,
  buildHerdrRun,
  buildHerdrTabCreate,
  buildLaunchLine,
  detectMultiplexer,
  herdrPaneOfTab,
  isClaudeForeground,
  lockIsStale,
  lockPathFor,
  mainCheckoutFromCommonDir,
  parseArgs,
  parseHerdrPane,
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

/** How long a start waits for another start in the same checkout. */
const LOCK_WAIT_MS = 16 * 60_000;
/** How long the second stage waits for Claude Code: git pull, magus update and boot; magus may ask a question. */
const DELIVER_DEADLINE_MS = 15 * 60_000;
/** How long the new shell may take to draw its prompt. */
const SHELL_READY_DEADLINE_MS = 15_000;
/** How long one `herdr agent wait` poll may block. */
const HERDR_AGENT_POLL_MS = 500;
/** How long stage 2 waits for Claude Code to show it took a submitted prompt. */
const LANDED_WAIT_MS = 15_000;

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

/** Like `run`, but stdout only, so a JSON answer is not mixed with warnings on stderr. */
function runStdout(cmd: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return { ok: p.exitCode === 0, out: p.exitCode === 0 ? p.stdout.toString().trim() : p.stderr.toString().trim() };
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

function resolveStateDir(): string {
  try {
    return stateDir(process.env, process.env.HOME || homedir());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
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
  /** The pane's working directory, or null when it cannot be read. */
  cwd(pane: string): string | null;
  /** Types one line into the pane's interactive shell and presses Enter. */
  runLine(pane: string, line: string): { ok: boolean; out: string };
  /** Types text literally, without Enter. */
  sendText(pane: string, text: string): void;
  sendEnter(pane: string): void;
  /**
   * Whether Claude Code took a submitted prompt, waiting up to LANDED_WAIT_MS.
   * `before` is the screen as it was just before the prompt was typed.
   */
  landed(pane: string, prompt: string, before: string): boolean;
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
  exists: (pane) => run(["herdr", "pane", "get", pane]).ok,
  visible: (pane) => run(["herdr", "pane", "read", pane, "--source", "visible"]).out,
  screen: (pane) => run(["herdr", "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"]).out,
  // herdr recognises Claude Code in a pane and reports when it is idle.
  claudeUp: (pane) => run(["herdr", "agent", "wait", pane, "--until", "idle", "--timeout", String(HERDR_AGENT_POLL_MS)]).ok,
  cwd: (pane) => {
    const p = runStdout(["herdr", "pane", "get", pane]);
    return p.ok ? parseHerdrPane(p.out)?.cwd || null : null;
  },
  runLine: (pane, line) => run(buildHerdrRun(pane, line)),
  sendText: (pane, text) => {
    run(["herdr", "pane", "send-text", pane, text]);
  },
  sendEnter: (pane) => {
    run(["herdr", "pane", "send-keys", pane, "enter"]);
  },
  // herdr tracks the agent's state: a prompt Claude Code took turns it to
  // working, or to done when the turn is already over.
  landed: (pane) =>
    run(["herdr", "agent", "wait", pane, "--until", "working", "--until", "done", "--timeout", String(LANDED_WAIT_MS)]).ok,
};

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
      "       [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]\n" +
      "   or: --print-line --name <slug> --colour <colour> [--dir <main checkout>] [--model <id>] [--effort <level>] [--launch <command>]",
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
function deliver({ pane, prompt, lock, mux }: DeliverArgs): never {
  const io = ioFor(mux);
  const logFile = join(resolveStateDir(), "ticket-window.log");
  const log = (msg: string): void => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      // Logging is best effort: the detached stage has no one else to tell.
    }
  };

  const deadline = Date.now() + DELIVER_DEADLINE_MS;
  let last = "";
  let stableSince = Date.now();
  for (;;) {
    if (Date.now() > deadline) {
      log(`${pane} TIMEOUT: Claude Code never became ready; not typed: ${prompt}`);
      releaseLock(lock);
      process.exit(EXIT_TIMEOUT);
    }
    if (!io.exists(pane)) {
      log(`${pane} GONE: the pane closed before Claude Code was ready; not typed: ${prompt}`);
      releaseLock(lock);
      process.exit(EXIT_GONE);
    }
    const screen = io.screen(pane);
    if (screenShowsTrustError(screen)) {
      releaseLock(lock);
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
  releaseLock(lock);
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
    io.sendText(pane, prompt);
    Bun.sleepSync(2000);
    io.sendEnter(pane);
  };
  typeOnce();

  // A prompt still in the input box gets one more Enter, never another copy.
  Bun.sleepSync(3000);
  const secondEnter = promptStillInInput(io.screen(pane), prompt);
  if (secondEnter) io.sendEnter(pane);

  if (io.landed(pane, prompt, settled)) {
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
  if (io.landed(pane, prompt, before)) process.exit(0);

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

function launchSpec(args: StartArgs | PrintLineArgs) {
  return {
    name: args.name,
    colour: args.colour,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    ...(args.launch !== undefined ? { launch: args.launch } : {}),
  };
}

// --- --print-line -------------------------------------------------------------------

function printLine(args: PrintLineArgs): never {
  const dir = resolveCheckout(args.dir);
  const branch = checkCheckout(dir, args.name);
  let line: string;
  try {
    line = buildChildLine({ ...launchSpec(args), dir });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  console.log(JSON.stringify({ dir, branch, name: args.name, colour: args.colour, line }, null, 2));
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
      writeFileSync(infoFile, JSON.stringify({ pid: process.pid, name, since: Date.now() }));
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

function chooseMultiplexer(args: StartArgs): Multiplexer {
  const detected = detectMultiplexer(process.env, () => run(["herdr", "pane", "current"]).ok);
  if (detected.ok) {
    if (detected.mux === "herdr" && args.session !== undefined) {
      fail("--session is tmux only; under herdr the ticket opens as a tab in the current workspace (ORCHESTRATOR_MULTIPLEXER=tmux forces tmux)");
    }
    return detected.mux;
  }
  // A named tmux session can be created from outside any multiplexer.
  if (args.session !== undefined && !process.env.ORCHESTRATOR_MULTIPLEXER) return "tmux";
  return fail(
    detected.error === "not inside tmux or herdr"
      ? "not inside tmux or herdr; run it from a tmux pane or a herdr tab, or pass --session <name> for a tmux session"
      : detected.error,
  );
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
  const answer = runStdout(self ? ["herdr", "pane", "get", self] : ["herdr", "pane", "current"]);
  if (!answer.ok) fail(`could not read the current herdr pane: ${answer.out}`);
  const workspace = parseHerdrPane(answer.out)?.workspaceId;
  if (!workspace) fail(`herdr did not name the current pane's workspace: ${answer.out}`);
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
function openHerdrTab(argv: string[]): { tabId: string; pane: string } {
  const created = runStdout(argv);
  if (!created.ok) fail(`herdr could not open the tab: ${created.out}`);
  const tab = parseHerdrTabCreate(created.out);
  if (tab === null || tab.tabId === "") fail(`herdr opened a tab but its answer did not name it: ${created.out}`);
  // An empty root pane id names no pane; look the tab's pane up instead.
  if (tab.paneId !== null && tab.paneId !== "") return { tabId: tab.tabId, pane: tab.paneId };
  const panes = runStdout(["herdr", "pane", "list"]);
  const pane = panes.ok ? herdrPaneOfTab(panes.out, tab.tabId) : null;
  if (pane === null) fail(`herdr opened tab ${tab.tabId} but no pane of it was found`);
  return { tabId: tab.tabId, pane };
}

function start(args: StartArgs): never {
  const mux = chooseMultiplexer(args);
  const io = ioFor(mux);
  const session = mux === "tmux" ? resolveSession(args.session) : null;
  const dir = resolveCheckout(args.dir);
  const branch = checkCheckout(dir, args.name);

  const line = buildLaunchLine(launchSpec(args));
  const state = resolveStateDir();
  const lockPath = lockPathFor(state, dir);
  const logFile = join(state, "ticket-window.log");

  const hasSession = session === null ? true : run(["tmux", "has-session", "-t", `=${session}`]).ok;
  const openArgv = session === null ? buildHerdrTabCreate({ dir, name: args.name, workspace: herdrWorkspace() }) : tmuxOpenArgv(session, hasSession, args.name, dir);

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

  takeLock(lockPath, args.name, args.noWait);

  let pane: string;
  let tabId: string | null = null;
  if (mux === "tmux") {
    const created = run(openArgv);
    if (!created.ok) fail(`tmux could not open the window: ${created.out}`);
    pane = created.out;
  } else {
    const tab = openHerdrTab(openArgv);
    pane = tab.pane;
    tabId = tab.tabId;
  }
  const where = mux === "tmux" ? `${session}, pane ${pane}` : `herdr tab ${tabId}, pane ${pane}`;

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
    [process.execPath, import.meta.path, "--deliver-to", pane, "--mux", mux, "--prompt", args.prompt, "--lock", lockPath],
    { stdio: ["ignore", "ignore", "ignore"], detached: true },
  );
  child.unref();
  // From here the lock belongs to stage 2; its pid is what a waiting start checks.
  writeFileSync(join(lockPath, "info.json"), JSON.stringify({ pid: child.pid, name: args.name, since: Date.now() }));
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
