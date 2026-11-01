/**
 * run-process.ts — the one way this plugin starts a child process.
 *
 * No shell: `spawn(argv[0], argv.slice(1))`. An install command or a VCS call is data,
 * never a string a shell gets to reinterpret. stdin is closed so a child that wants to
 * prompt gets EOF instead of hanging the caller. Never rejects: every failure is a field
 * of the `RunResult`.
 *
 * A deadline signals the child, SIGTERM then SIGKILL. With `ownProcessGroup` the child is
 * started as the leader of its own process group and the signals go to the whole group, so a
 * launcher that runs the real worker as its own child (an npm shim around a binary, a shell
 * wrapper) does not leave that worker running past the deadline holding the output pipes
 * open. The group is this invocation's own: nothing is ever signalled by name.
 *
 * Shared by the setup CLI (`scripts/setup/io.ts`) and the worktree IO port
 * (`mcp/worktree/node-io.ts`).
 */

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import type { RunOptions, RunResult } from "../setup/check";

/** Characters kept from each child stream. Enough for the last 20 stderr lines of an install. */
const STREAM_KEEP = 64 * 1024;
/** Grace between SIGTERM and SIGKILL once a deadline passes. */
const KILL_GRACE_MS = 2_000;
/** After SIGKILL, how long to wait for the output pipes to close before answering anyway. */
const SETTLE_AFTER_KILL_MS = 1_000;

/** Process groups started by `ownProcessGroup` runs that have not finished. */
const liveGroups = new Set<number>();
let exitHookInstalled = false;

/** A hook that exits while a group is still running takes the group with it: nothing orphaned. */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const group of liveGroups) signalGroup(group, "SIGKILL");
  });
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal);
  } catch {
    // The group is already gone.
  }
}

export function runProcess(
  argv: readonly string[],
  opts: RunOptions,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<RunResult> {
  const [command, ...args] = argv;
  if (command === undefined) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      spawnError: "empty argv",
    });
  }

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let truncated = false;
    const stdoutKeep = opts.maxStdoutBytes ?? STREAM_KEEP;
    // One decoder per stream: a multibyte character split across two chunks is decoded whole.
    const outDecoder = new StringDecoder("utf8");
    const errDecoder = new StringDecoder("utf8");
    const keep = (buffer: string, text: string, limit: number, onCut?: () => void): string => {
      const next = buffer + text;
      if (next.length <= limit) return next;
      onCut?.();
      return next.slice(next.length - limit);
    };

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...parentEnv, ...(opts.env ?? {}) })) {
      if (value !== undefined) env[key] = value;
    }

    // Own group only where negative pids exist (not Windows).
    const grouped = opts.ownProcessGroup === true && process.platform !== "win32";

    let child;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env,
        // No stdin: an install that wants to prompt gets EOF instead of hanging the CLI.
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: grouped,
      });
    } catch (error) {
      resolvePromise({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const group = grouped ? child.pid : undefined;
    if (group !== undefined) {
      liveGroups.add(group);
      installExitHook();
    }
    const signal = (sig: NodeJS.Signals): void => {
      if (group !== undefined) signalGroup(group, sig);
      else child.kill(sig);
    };

    let killer: ReturnType<typeof setTimeout> | undefined;
    let settler: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(killer);
      clearTimeout(settler);
      // No signal here: once every member is gone the group id is free for another process.
      if (group !== undefined) liveGroups.delete(group);
      const tailOut = outDecoder.end();
      const tailErr = errDecoder.end();
      if (tailOut !== "") stdout = keep(stdout, tailOut, stdoutKeep, () => (truncated = true));
      if (tailErr !== "") stderr = keep(stderr, tailErr, STREAM_KEEP);
      resolvePromise({ ...result, stdout, stderr, ...(truncated ? { truncated } : {}) });
    };

    // The launcher's own result when it exited after the deadline while the group still had members.
    let launcherResult: RunResult | undefined;
    const groupAlive = (): boolean => {
      if (group === undefined) return false;
      try {
        process.kill(-group, 0);
        return true;
      } catch {
        return false;
      }
    };
    /** After SIGKILL: answer as soon as the group is gone, and at the latest SETTLE_AFTER_KILL_MS later. */
    const settleWhenGroupGone = (): void => {
      const stop = Date.now() + SETTLE_AFTER_KILL_MS;
      const poll = (): void => {
        if (!groupAlive() || Date.now() >= stop) {
          finish(launcherResult ?? { exitCode: null, signal: "SIGKILL", stdout, stderr, timedOut });
        } else {
          settler = setTimeout(poll, 20);
        }
      };
      poll();
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      killer = setTimeout(() => {
        signal("SIGKILL");
        // A process that escaped the group can still hold the pipes: answer anyway.
        settleWhenGroupGone();
      }, KILL_GRACE_MS);
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = keep(stdout, outDecoder.write(chunk), stdoutKeep, () => {
        truncated = true;
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = keep(stderr, errDecoder.write(chunk), STREAM_KEEP);
    });
    child.on("error", (error: Error) => {
      finish({ exitCode: null, signal: null, stdout, stderr, timedOut, spawnError: error.message });
    });
    child.on("close", (code: number | null, sig: NodeJS.Signals | null) => {
      const result: RunResult = { exitCode: code, signal: sig, stdout, stderr, timedOut };
      // After a deadline the launcher's exit proves nothing about its workers: while the group still
      // has a member, keep the SIGKILL escalation and the group's exit hook, and answer once it is gone.
      if (timedOut && groupAlive()) {
        launcherResult = result;
        return;
      }
      finish(result);
    });
  });
}
