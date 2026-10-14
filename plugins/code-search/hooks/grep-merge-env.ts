#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup|resume|clear|compact`) — turn on the Bash `grep` merge
 * for this session by appending ONE guarded source line to `$CLAUDE_ENV_FILE` (P7).
 *
 * Claude Code splices that file into every Bash call of the session, so the line
 *
 *   case $- in *[vxr]*) ;; *) if [[ -r '<main>' && ! -o sourcetrace ]]; then builtin . '<main>'; fi ;; esac; :
 *
 * (`<main>` is `<plugin>/assets/grep-merge.sh`)
 *
 * loads the wrapper from the plugin directory at the start of each call. All logic lives
 * in the sourced script; the env file holds no function body and no state, and nothing
 * here ever rewrites it.
 *
 * Process:
 *   1. `CLAUDE_ENV_FILE` unset or empty: write nothing.
 *   2. The merge gate (`mergeGate`, shared with the server and the redirect hook) is
 *      closed: write nothing, and never open the env file. Turning the merge off later is
 *      the server's job (`gate_closed`), and `CODE_SEARCH_MERGE=0` works per command.
 *   3. The plugin path holds `'` or a control character: nothing written.
 *   4. The env file already holds the source line: write nothing, log nothing.
 *   5. A sibling hook file already holds it (`siblingHoldingSourceLine`): write nothing,
 *      and do not create the env file. On Claude Code 2.1.299 SessionStart runs of one
 *      session id were handed different `sessionstart-hook-<n>.sh` files inside
 *      `session-env/<id>/`: `startup` got `-6`, while `compact` and `resume` shared `-3`
 *      (`/clear` starts a new id, whose run got `-4`). `<n>` is the hook's position among
 *      all matched hooks, so which runs share a file is not stable. Every Bash call
 *      spliced EVERY such file of the directory. Without the sibling check a `/compact`
 *      after `startup` added a second line, and every later Bash call sourced the wrapper
 *      twice. A sibling counts only when it is a
 *      regular file (never a symlink), at most 64 KiB, among the first 16 by `<n>`, and
 *      holds the identical line. Anything else is ignored, which can only cost a harmless
 *      duplicate line, never a missing one.
 *   6. Otherwise exactly one `appendFileSync`.
 *
 * The sibling rule depends on Claude Code splicing every hook file of the id's directory
 * (measured on 2.1.299). A build that splices only the handed-out file would let a sibling
 * holder suppress the append; re-check on every Claude Code version bump.
 *
 * SILENT ON EVERY FAILURE (review round 3): stdout and stderr are always empty and the exit
 * status is always 0, for a path it cannot write, an append that fails, an unsuitable
 * plugin path, or any error at all. When `CODE_SEARCH_MERGE_LOG` names a file, the reason
 * is appended there (`grep-merge-env: <reason>`). The gate's modules are imported
 * dynamically, inside the error boundary, so a module that failed to load cannot exit 1
 * before a handler exists.
 *
 * WHEN A LINE TAKES EFFECT. Claude Code 2.1.293 reads the env script once per process and
 * session id: a line takes effect at `startup`, at `/clear` (new id) and at resume (new
 * process), and a line written by a `compact` run waits for the next `/clear` or resume.
 * The `compact` matcher stays for builds that re-read at `/compact`.
 */

import { appendFileSync, closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, readSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** Inside the 5 s hooks.json timeout, so a stall ends in silence, not a hook error. */
const WATCHDOG_MS = 4_000;

/**
 * The exact bytes appended for an asset path, or `undefined` when the path cannot be
 * written as a single-quoted shell literal on one line: not absolute, or holding `'`,
 * U+0000–U+001F or U+007F.
 *
 * The leading `\n` keeps the line on a line of its own whatever an earlier writer left
 * at the file's end. The trailing `; :` makes the bytes end in a command that succeeds,
 * so the user's command runs whether or not Claude Code adds its own terminator after
 * the spliced script. The `.` carries no redirection: the script reads fd 1 and fd 2
 * while it is sourced.
 *
 * The `case` sources nothing while `$-` holds `v` or `x` (review round 2): under verbose
 * mode both shells echo every line they source, and under xtrace they trace it, so the
 * assets would add about 424 lines to stderr on every Bash call before any line of
 * theirs could decline. The wrapper passes xtrace through anyway, so nothing is lost.
 *
 * Nor while `$-` holds `r` or zsh has SOURCE_TRACE on (review round 5, measured in bash 3.2,
 * bash 5.2 and zsh 5.9): a restricted shell refuses `.` of a path holding `/` (bash aborted
 * the call under errexit; zsh half-loaded the wrapper over the caller's own `grep`), and
 * SOURCE_TRACE prints one line per sourced file. `[[ ! -o sourcetrace ]]` is silent in bash,
 * which has no such option and answers false for `-o`, under `set -eu` too.
 *
 * `[[ -r … ]]` and `builtin .`, never `[` and `.` (review round 4, measured in bash 3.2,
 * bash 5.2 and zsh 5.9): a caller's function named `.` returning nonzero under `set -e` or
 * zsh `ERR_RETURN` aborted the call at this line, before the user's command; `[[` is a
 * reserved word and `builtin` skips functions.
 *
 * ONE line, `; :` rather than a `:` line of its own (review round 2, measured): Claude
 * Code trims the file and splices it into its `&&` chain, so a single line joins the line
 * the chain was parsed on. A second line is read after the snapshot ran, so under a
 * verbose mode the snapshot set, bash echoes it and the rest of the chain, and zsh's
 * xtrace numbers every later line differently.
 */
export function envLineBytes(assetPath: string): string | undefined {
  if (!assetPath.startsWith("/")) return undefined;
  if (/['\u0000-\u001f\u007f]/u.test(assetPath)) return undefined;
  return `\ncase $- in *[vxr]*) ;; *) if [[ -r '${assetPath}' && ! -o sourcetrace ]]; then builtin . '${assetPath}'; fi ;; esac; :\n`;
}

/** The source line alone: `envLineBytes` without its surrounding newlines. */
export function sourceLineOf(assetPath: string): string | undefined {
  const bytes = envLineBytes(assetPath);
  return bytes === undefined ? undefined : (bytes.split("\n")[1] ?? undefined);
}

/** Does an exported SHELLOPTS start every bash with verbose or xtrace on? */
export function shelloptsRefuse(shellopts: string | undefined): boolean {
  if (shellopts === undefined || shellopts === "") return false;
  return shellopts.split(":").some((option) => option === "verbose" || option === "xtrace");
}

/** Does this env file text already hold the source line, on a line of its own? */
export function holdsSourceLine(text: string, sourceLine: string): boolean {
  return text.split("\n").includes(sourceLine);
}

/**
 * Claude Code's SessionStart hook file name, `sessionstart-hook-<n>.sh`. Its own predicate
 * is `sessionstart-hook-(\d+)\.sh`; the 1–9 digit cap is deliberate and defensive, keeping
 * `<n>` an exact number for sorting. A longer index only costs a harmless duplicate.
 */
export const HOOK_FILE_PATTERN = /^sessionstart-hook-[0-9]{1,9}\.sh$/u;

/** A sibling larger than this is not a plain env file and is ignored (measured: 462 bytes). */
export const SIBLING_MAX_BYTES = 65_536;

/** At most this many siblings are opened, in ascending `<n>` order. */
export const SIBLING_MAX_FILES = 16;

/** Is `name` a SessionStart hook file name? Case-sensitive. */
export function isHookFileName(name: string): boolean {
  return HOOK_FILE_PATTERN.test(name);
}

export interface SiblingScan {
  /** Basename of the first sibling holding the line, or undefined. */
  holder: string | undefined;
  /** Log reasons, without the `grep-merge-env: ` prefix. */
  notes: string[];
}

function hookIndex(name: string): number {
  return Number(name.slice("sessionstart-hook-".length, -".sh".length));
}

/**
 * Does a sibling hook file of `envFile` hold `sourceLine` on a line of its own?
 *
 * Never throws, never writes, reads nothing outside `dirname(envFile)`. Siblings are opened
 * `O_NOFOLLOW | O_NONBLOCK`: a symlink fails the open (it could point anywhere and change
 * after the check; trusting it risks a MISSING line, which turns the merge off for the
 * session), and a FIFO or device cannot block the hook. Bounded by the caps: at most
 * `SIBLING_MAX_FILES` files and `SIBLING_MAX_BYTES + 1` bytes each. The 4 s watchdog is a
 * timer and cannot interrupt these synchronous calls; the listing itself relies on the
 * directory being Claude Code's small per-session directory, and the hard bound is the
 * 5 s hook timeout in hooks.json.
 */
export function siblingHoldingSourceLine(envFile: string, sourceLine: string, io: SiblingIo = NODE_IO): SiblingScan {
  const notes: string[] = [];
  const dir = dirname(envFile);
  const self = basename(envFile);
  let names: string[];
  try {
    names = io.readdirSync(dir);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return { holder: undefined, notes: [] };
    return { holder: undefined, notes: [`cannot list ${dir}: ${code}`] };
  }
  // Ascending `<n>`. Two names can share an `<n>` (`-3.sh`, `-03.sh`): both are scanned, in
  // listing order, so a tie can only reorder which holder is named.
  const matched = names.filter((name) => name !== self && isHookFileName(name)).sort((a, b) => hookIndex(a) - hookIndex(b));
  for (const name of matched.slice(0, SIBLING_MAX_FILES)) {
    const text = readSibling(io, join(dir, name), name, notes);
    if (text !== undefined && holdsSourceLine(text, sourceLine)) return { holder: name, notes };
  }
  if (matched.length > SIBLING_MAX_FILES) notes.push(`sibling scan stopped after ${SIBLING_MAX_FILES} files`);
  return { holder: undefined, notes };
}

/**
 * The file-system calls the sibling scan makes. Production passes `node:fs`; tests pass a
 * double to reach paths a real file cannot (a file that grows past its `fstat` size).
 */
export interface SiblingIo {
  readdirSync(dir: string): string[];
  openSync(path: string, flags: number): number;
  fstatSync(fd: number): { isFile(): boolean; size: number };
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: null): number;
  closeSync(fd: number): void;
}

const NODE_IO: SiblingIo = {
  readdirSync: (dir) => readdirSync(dir),
  openSync: (path, flags) => openSync(path, flags),
  fstatSync: (fd) => fstatSync(fd),
  readSync: (fd, buffer, offset, length, position) => readSync(fd, buffer, offset, length, position),
  closeSync: (fd) => closeSync(fd),
};

/** One sibling's text, or undefined with the reason pushed onto `notes`. */
function readSibling(io: SiblingIo, path: string, name: string, notes: string[]): string | undefined {
  let fd: number | undefined;
  try {
    fd = io.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = io.fstatSync(fd);
    if (!stat.isFile()) {
      notes.push(`sibling ${name} ignored: not a regular file`);
      return undefined;
    }
    const tooBig = `sibling ${name} ignored: over ${SIBLING_MAX_BYTES} bytes`;
    if (stat.size > SIBLING_MAX_BYTES) {
      notes.push(tooBig);
      return undefined;
    }
    const buffer = Buffer.alloc(SIBLING_MAX_BYTES + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const got = io.readSync(fd, buffer, filled, buffer.length - filled, null);
      if (got === 0) break;
      filled += got;
    }
    if (filled > SIBLING_MAX_BYTES) {
      notes.push(tooBig);
      return undefined;
    }
    // Replacement decoding, never fatal: invalid bytes become U+FFFD and the scan goes on.
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, filled));
  } catch (error) {
    notes.push(`sibling ${name} ignored: ${errorCode(error)}`);
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        io.closeSync(fd);
      } catch {
        // Nothing to recover: the descriptor is gone either way.
      }
    }
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why the hook wrote no line, for whoever asked: one line to `$CODE_SEARCH_MERGE_LOG` when
 * it is set, else nowhere. Never stderr (review round 3): Claude Code shows a hook's stderr,
 * and a SessionStart failure is never worth a message on every session start.
 *
 * Opened `O_NONBLOCK`: a log path naming a FIFO with no reader fails the open at once
 * (ENXIO) instead of blocking the hook, which the watchdog timer could not interrupt.
 */
function note(reason: string): void {
  const log = process.env["CODE_SEARCH_MERGE_LOG"];
  if (log === undefined || log === "") return;
  let fd: number | undefined;
  try {
    fd = openSync(log, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NONBLOCK, 0o666);
    writeSync(fd, `grep-merge-env: ${reason}\n`);
  } catch {
    // A log that cannot be written costs the log line and nothing else.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Nothing to recover.
      }
    }
  }
}

async function main(): Promise<void> {
  const quit = (error: unknown): never => {
    note(`failed: ${errorCode(error)}`);
    process.exit(0);
  };
  process.on("uncaughtException", quit);
  process.on("unhandledRejection", quit);
  setTimeout(() => process.exit(0), WATCHDOG_MS).unref();
  try {
    await run();
  } catch (error) {
    quit(error);
  }
  process.exit(0);
}

async function run(): Promise<void> {
  const env = process.env;
  const envFile = env["CLAUDE_ENV_FILE"];
  if (envFile === undefined || envFile === "") process.exit(0);

  // An exported SHELLOPTS hands every bash its options at startup. With verbose there, bash
  // echoes the line while parsing it, before its own `case $-` guard can run; with xtrace
  // it traces the guard (measured, review round 4). No line can decline in-band, so none
  // is written. zsh ignores SHELLOPTS.
  if (shelloptsRefuse(env["SHELLOPTS"])) {
    note("SHELLOPTS exports verbose or xtrace; no line written");
    process.exit(0);
  }

  const [{ combineGateEnv, gateSettings, mergeGate }, { settingsLayerPaths }] = await Promise.all([
    import("../mcp/grep/gate"),
    import("../mcp/core/settings"),
  ]);

  // The gate, from the same three layers the server reads (as at HEAD: under HOME's
  // `.claude`, and the project's `.claude`).
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();
  const declared = env["CLAUDE_PROJECT_DIR"];
  const projectDir = declared !== undefined && declared !== "" ? declared : process.cwd();
  const texts = settingsLayerPaths(home, projectDir).map((path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  });
  // `engineConfigured` is gate.ts's one definition, shared with the server, the redirect
  // hook and setup status.
  const s = gateSettings(texts);
  const closed = mergeGate({
    platform: process.platform,
    env: combineGateEnv(env, s.env),
    route: s.route,
    engineConfigured: s.engineConfigured,
  });
  if (closed !== undefined) process.exit(0);

  const assetPath = resolve(import.meta.dir, "..", "assets", "grep-merge.sh");
  const bytes = envLineBytes(assetPath);
  const line = sourceLineOf(assetPath);
  if (bytes === undefined || line === undefined) {
    note("plugin path contains a quote or control character; no line written");
    process.exit(0);
  }

  try {
    if (holdsSourceLine(readFileSync(envFile, "utf8"), line)) process.exit(0);
  } catch {
    // Missing or unreadable: the sibling scan and the append below decide.
  }

  const scan = siblingHoldingSourceLine(envFile, line);
  for (const reason of scan.notes) note(reason);
  if (scan.holder !== undefined) {
    note(`source line present in ${scan.holder}; no line written`);
    process.exit(0);
  }

  try {
    appendFileSync(envFile, bytes, { mode: 0o600 });
  } catch (error) {
    note(`cannot append to ${envFile}: ${errorCode(error)}`);
  }
}

if (import.meta.main) {
  await main();
}
