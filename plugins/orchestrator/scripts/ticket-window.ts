#!/usr/bin/env bun
// Opens a tmux window (or, with --split, a pane beside the caller) at a repo's
// main checkout and types one line into its shell:
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
//       [--dir <main checkout>] [--session <tmux session>] [--split <pane>]
//       [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]
//
//   --name     lower-case letters, digits, . _ -; starts with a letter or digit; at most 48 characters
//   --colour   (or --color) red blue green yellow purple orange pink cyan default
//   --prompt   typed into Claude Code once it is up, by a detached second stage
//   --dir      a repo's main checkout; defaults to the main checkout of the current directory
//   --session  tmux session for the new window; defaults to the current one; created when missing
//   --split    open a pane beside this pane id (the caller's $TMUX_PANE) instead of a window
//   --no-wait  exit 6 at once when another start in the same checkout holds the lock
//   --dry-run  print what would be done; opens nothing and takes no lock
//
// Exit codes:
//   0  opened (or, with --dry-run, would open)
//   1  bad input, not inside tmux, or a tmux or git error
//   2  the main checkout is not on its default branch (the worktree would start from it)
//   3  the worktree already exists
//   6  the checkout's lock is busy (--no-wait, or 16 minutes of waiting)
//
// One start at a time per checkout: `git pull`, `magus update` and the worktree
// creation all touch the same main checkout. A lock directory under the state
// dir (ORCHESTRATOR_STATE_DIR, else ~/.claude/orchestrator) is taken before the
// window opens and released by the second stage once Claude Code is up, or on
// TIMEOUT or GONE. The second stage records SENT, READY, TIMEOUT or GONE in
// ticket-window.log in the same directory.
//
// The line is typed into an interactive shell, as a person would, so a launch
// command defined as a shell function in the user's rc file works too.
//
// Internal: --deliver-to <pane> --prompt <text> [--lock <dir>] runs the second stage.

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type DeliverArgs,
  type StartArgs,
  buildLaunchLine,
  isClaudeForeground,
  lockIsStale,
  lockPathFor,
  mainCheckoutFromCommonDir,
  parseArgs,
  promptStillInInput,
  stateDir,
} from "./lib/window.ts";

const EXIT_BAD_INPUT = 1;
const EXIT_OFF_DEFAULT_BRANCH = 2;
const EXIT_WORKTREE_EXISTS = 3;
const EXIT_TIMEOUT = 4;
const EXIT_GONE = 5;
const EXIT_LOCK_BUSY = 6;

/** How long a start waits for another start in the same checkout. */
const LOCK_WAIT_MS = 16 * 60_000;
/** How long the second stage waits for Claude Code: git pull, magus update and boot; magus may ask a question. */
const DELIVER_DEADLINE_MS = 15 * 60_000;
/** How long the new shell may take to draw its prompt. */
const SHELL_READY_DEADLINE_MS = 15_000;

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
    // A missing binary (tmux or git not installed) throws instead of exiting non-zero.
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

const parsed = parseArgs(process.argv.slice(2), process.env);
if (!parsed.ok) {
  fail(
    `${parsed.error}\n` +
      "usage: --name <slug> --colour <colour> [--prompt <text>] [--dir <main checkout>] [--session <name>]\n" +
      "       [--split <pane>] [--model <id>] [--effort <level>] [--launch <command>] [--no-wait] [--dry-run]",
  );
}

if (parsed.args.mode === "deliver") {
  deliver(parsed.args);
} else {
  start(parsed.args);
}

// --- stage 2 ----------------------------------------------------------------------

// Waits for the Claude Code that the typed line starts in the pane, then types
// the prompt and submits it. Text and Enter in one send-keys reads as an
// unsubmitted paste, so Enter goes alone after 2 s. A pane is a Claude Code TUI
// once its foreground command is a version string and its screen has been
// unchanged for 2 s.
function deliver({ pane, prompt, lock }: DeliverArgs): never {
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
    const fg = run(["tmux", "display", "-p", "-t", pane, "#{pane_current_command}"]);
    if (!fg.ok) {
      log(`${pane} GONE: the pane closed before Claude Code was ready; not typed: ${prompt}`);
      releaseLock(lock);
      process.exit(EXIT_GONE);
    }
    const screen = run(["tmux", "capture-pane", "-p", "-t", pane]).out;
    if (screen !== last) {
      last = screen;
      stableSince = Date.now();
    } else if (isClaudeForeground(fg.out) && Date.now() - stableSince >= 2000) {
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
  const screenNow = (): string => run(["tmux", "capture-pane", "-p", "-J", "-t", pane, "-S", "-200"]).out;
  const colourBy = Date.now() + 30_000;
  while (Date.now() < colourBy && !screenNow().includes("Session color set")) Bun.sleepSync(500);
  let settled = screenNow();
  let settledSince = Date.now();
  while (Date.now() - settledSince < 2000 && Date.now() < colourBy + 10_000) {
    Bun.sleepSync(500);
    const s = screenNow();
    if (s !== settled) {
      settled = s;
      settledSince = Date.now();
    }
  }

  run(["tmux", "send-keys", "-t", pane, "-l", prompt]);
  Bun.sleepSync(2000);
  run(["tmux", "send-keys", "-t", pane, "Enter"]);

  // Never type the prompt twice: a second copy could land in a question the
  // workflow already opened. Only a prompt still in the input box gets one more Enter.
  Bun.sleepSync(3000);
  if (promptStillInInput(screenNow(), prompt)) {
    run(["tmux", "send-keys", "-t", pane, "Enter"]);
    log(`${pane} SENT (needed a second Enter): ${prompt}`);
  } else {
    log(`${pane} SENT: ${prompt}`);
  }
  process.exit(0);
}

// --- stage 1 ----------------------------------------------------------------------

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

function resolveSession(sessionArg: string | undefined, split: string | undefined): string | null {
  if (split !== undefined) return null; // the pane opens in the caller's window
  if (sessionArg !== undefined) return sessionArg;
  if (!process.env.TMUX) fail("not inside tmux; run it from a tmux pane, or pass --session <name>");
  const target = process.env.TMUX_PANE ? ["-t", process.env.TMUX_PANE] : [];
  const current = run(["tmux", "display-message", "-p", ...target, "#{session_name}"]);
  if (!current.ok || current.out === "") fail(`could not read the current tmux session: ${current.out}`);
  return current.out;
}

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

function start(args: StartArgs): void {
  if (args.split !== undefined) {
    const panes = run(["tmux", "list-panes", "-a", "-F", "#{pane_id}"]);
    if (!panes.ok || !panes.out.split("\n").includes(args.split)) {
      fail(`--split: no tmux pane "${args.split}" (pass the caller's $TMUX_PANE, for example %123)`);
    }
  }
  const session = resolveSession(args.session, args.split);
  const dir = resolveCheckout(args.dir);

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

  const worktree = join(dir, ".claude", "worktrees", args.name);
  if (existsSync(worktree)) fail(`worktree ${worktree} already exists; resume it in its own window instead`, EXIT_WORKTREE_EXISTS);

  const line = buildLaunchLine({
    name: args.name,
    colour: args.colour,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    ...(args.launch !== undefined ? { launch: args.launch } : {}),
  });
  const state = resolveStateDir();
  const lockPath = lockPathFor(state, dir);
  const logFile = join(state, "ticket-window.log");

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        { dryRun: true, session, split: args.split ?? null, dir, branch, name: args.name, colour: args.colour, line, prompt: args.prompt || null, lock: lockPath, log: logFile },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  takeLock(lockPath, args.name, args.noWait);

  // `=name` makes tmux match the session name exactly, never by prefix.
  const hasSession = session === null ? true : run(["tmux", "has-session", "-t", `=${session}`]).ok;
  const created =
    args.split !== undefined
      ? run(["tmux", "split-window", "-h", "-t", args.split, "-c", dir, "-P", "-F", "#{pane_id}"])
      : hasSession
        ? run(["tmux", "new-window", "-t", `=${session}:`, "-n", args.name, "-c", dir, "-P", "-F", "#{pane_id}"])
        : run(["tmux", "new-session", "-d", "-s", session ?? "", "-n", args.name, "-c", dir, "-P", "-F", "#{pane_id}"]);
  if (!created.ok) fail(`tmux could not open the ${args.split !== undefined ? "pane" : "window"}: ${created.out}`);
  const pane = created.out;
  const where = args.split !== undefined ? `pane ${pane} beside ${args.split}` : `${session}, pane ${pane}`;

  // Wait for the shell to be ready before typing. A login shell queries the
  // terminal (OSC 11 / DA) while it starts, and those reads eat typeahead: the
  // text survives but its Enter does not. Ready = the screen is non-empty and
  // unchanged for 700 ms, i.e. the prompt is drawn.
  let last = "";
  let stableSince = 0;
  const deadline = Date.now() + SHELL_READY_DEADLINE_MS;
  for (;;) {
    const screen = run(["tmux", "capture-pane", "-p", "-t", pane]).out;
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

  // -l types the text literally; Enter goes separately, as a keypress.
  const typed = run(["tmux", "send-keys", "-t", pane, "-l", line]);
  const entered = typed.ok && run(["tmux", "send-keys", "-t", pane, "Enter"]).ok;
  if (!entered) fail(`window opened (${where}) but typing the command failed: ${typed.out}`);

  // Stage 2, detached: type the prompt once Claude Code is up.
  const child = Bun.spawn([process.execPath, import.meta.path, "--deliver-to", pane, "--prompt", args.prompt, "--lock", lockPath], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();
  // From here the lock belongs to stage 2; its pid is what a waiting start checks.
  writeFileSync(join(lockPath, "info.json"), JSON.stringify({ pid: child.pid, name: args.name, since: Date.now() }));
  heldLock = undefined;

  console.log(
    JSON.stringify(
      {
        session,
        window: args.split !== undefined ? null : args.name,
        split: args.split ?? null,
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
