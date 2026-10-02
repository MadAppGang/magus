/**
 * report.ts — what every subcommand returns, and the one place it becomes output.
 *
 * Exit codes: 0 done, 1 failed or refused, 2 usage error or nothing measured.
 *
 * A failure that came from a child process always carries, in text and in JSON, the four
 * things a person needs to act on it without re-running anything (R8): the exact command,
 * its exit code or the signal that ended it, the last 20 lines of its stderr, and a remedy.
 */

import { shellQuote } from "../../mcp/adapters/catalog";
import type { RunResult } from "../../mcp/setup/check";

export type ExitCode = 0 | 1 | 2;

export const STDERR_TAIL_LINES = 20;

export interface ProcessFailure {
  command: string;
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  /** Set when the process never started. */
  spawnError?: string;
  stderrTail: string[];
}

export interface Failure {
  /** Stable, machine-readable: `prerequisite_missing`, `layer_shadowed`, … */
  code: string;
  message: string;
  remedy?: string;
  path?: string;
  process?: ProcessFailure;
}

export interface Outcome {
  /** Exactly the subcommand, e.g. `install` (A21). A handler may put a descriptive label
   *  here; `setup.ts` `stampOutcome` replaces it before anything is rendered. */
  command: string;
  /** The subcommand's positional argument when one was given, e.g. `mnemex`, `none`. */
  target?: string;
  ok: boolean;
  exitCode: ExitCode;
  /** One line, for the text form. */
  summary: string;
  dryRun?: boolean;
  /** What would run or change (dry run), or what did run or change (real run), even when
   *  the run then failed. Copy-pasteable. */
  actions?: string[];
  /** What the command would have run, when a failure stopped it before anything ran. */
  planned?: string[];
  /** The host reads settings at startup. */
  restartRequired?: boolean;
  failure?: Failure;
  /** Extra text lines for humans; not part of the JSON contract's structure. */
  details?: string[];
  data?: Record<string, unknown>;
}

/** The R8 record of a finished child process. */
export function processFailure(argv: readonly string[], result: RunResult): ProcessFailure {
  const out: ProcessFailure = { command: shellQuote(argv), stderrTail: tailLines(result.stderr) };
  if (result.exitCode !== null) out.exitCode = result.exitCode;
  if (result.signal !== null) out.signal = result.signal;
  if (result.timedOut) out.timedOut = true;
  if (result.spawnError !== undefined) out.spawnError = result.spawnError;
  return out;
}

export function processSucceeded(result: RunResult): boolean {
  return result.spawnError === undefined && !result.timedOut && result.exitCode === 0;
}

export function tailLines(text: string, count = STDERR_TAIL_LINES): string[] {
  const lines = text.replace(/\s+$/u, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.slice(-count);
}

export function failed(command: string, failure: Failure, extra: Partial<Outcome> = {}): Outcome {
  return { command, ok: false, exitCode: 1, summary: failure.message, ...extra, failure };
}

export function usageError(command: string, message: string): Outcome {
  return {
    command,
    ok: false,
    exitCode: 2,
    summary: message,
    failure: { code: "usage_error", message, remedy: "Run setup.ts --help for the subcommands and flags." },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderJson(outcome: Outcome): string {
  return `${JSON.stringify(outcome, null, 2)}\n`;
}

export function renderText(outcome: Outcome): string {
  const lines: string[] = [];
  lines.push(outcome.ok ? outcome.summary : `FAILED (${outcome.failure?.code ?? "error"}): ${outcome.summary}`);

  if (outcome.actions !== undefined && outcome.actions.length > 0) {
    lines.push(
      outcome.dryRun === true
        ? "Would run / change (dry run, nothing done):"
        : outcome.ok
          ? "Done:"
          : "Ran or changed before the failure:",
    );
    for (const action of outcome.actions) lines.push(`  ${action}`);
  }
  if (outcome.planned !== undefined && outcome.planned.length > 0) {
    lines.push("Not run:");
    for (const action of outcome.planned) lines.push(`  ${action}`);
  }
  for (const detail of outcome.details ?? []) lines.push(detail);

  const failure = outcome.failure;
  if (failure !== undefined) {
    if (failure.path !== undefined) lines.push(`  path:      ${failure.path}`);
    const proc = failure.process;
    if (proc !== undefined) {
      lines.push(`  command:   ${proc.command}`);
      if (proc.spawnError !== undefined) lines.push(`  not started: ${proc.spawnError}`);
      if (proc.exitCode !== undefined) lines.push(`  exit code: ${proc.exitCode}`);
      if (proc.signal !== undefined) {
        lines.push(`  signal:    ${proc.signal}${proc.timedOut === true ? " (deadline passed)" : ""}`);
      }
      lines.push(`  stderr (last ${STDERR_TAIL_LINES} lines):`);
      if (proc.stderrTail.length === 0) lines.push("    (empty)");
      for (const line of proc.stderrTail) lines.push(`    ${line}`);
    }
    if (failure.remedy !== undefined) lines.push(`  remedy:    ${failure.remedy}`);
  }

  if (outcome.restartRequired === true) {
    lines.push(
      "Restart Claude Code (or reconnect `ca` via /mcp): settings are read at startup.",
    );
  }
  return `${lines.join("\n")}\n`;
}
