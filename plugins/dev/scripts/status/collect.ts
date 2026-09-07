#!/usr/bin/env bun
/**
 * Collect the /dev:status evidence bundle.
 *
 *   bun collect.ts --cwd <dir> [--session <id>] [--json | --md]
 *                  [--no-transcript] [--no-fetch] [--no-gh]
 *                  [--gh-timeout-ms N] [--fetch-timeout-ms N] [--max-chars N] [--source X]
 *
 * Facts only, from cheapest source to dearest: the session's own transcript, git, `gh`,
 * the live-session registry, the task list, the plan file, the `/dev:dev` artifacts this
 * session wrote, and the last /dev:status report. Anything that cannot be read becomes a
 * line in `errors` or a `reason` field, never an exception: commands/status.md and
 * hooks/status-reinject.ts both call this and both must degrade to whatever is available.
 *
 * `--json` (default) prints the bundle; `--md` prints the deterministic head that the
 * SessionStart hook injects. Exit code is always 0 — a status report that cannot be
 * produced is reported as such in the output, not as a crash.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { devSessionFacts, planFileFacts, priorReport } from "./artifacts.ts";
import { evaluateGate } from "./gate.ts";
import { collectPr } from "./gh.ts";
import { collectGit, defaultRunner } from "./git.ts";
import { nothingToReport, renderHead } from "./render.ts";
import { claudeConfigDir, isPidAlive, liveSessionsIn, resolveSession } from "./sessions.ts";
import { readTasks } from "./tasks.ts";
import { emptyFacts, parseTranscript } from "./transcript.ts";
import type { Bundle, Runner } from "./types.ts";

export interface CollectOptions {
  cwd: string;
  sessionId?: string;
  /** Skip resolution when the caller (a hook) already knows the path. */
  transcriptPath?: string;
  transcript?: boolean;
  gh?: boolean;
  fetch?: boolean;
  fetchTimeoutMs?: number;
  ghTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  run?: Runner;
}

export function collect(opts: CollectOptions): Bundle {
  const env = opts.env ?? process.env;
  const configDir = opts.configDir ?? claudeConfigDir(env);
  const run = opts.run ?? defaultRunner();
  const cwd = resolve(opts.cwd);
  const errors: string[] = [];

  const session = resolveSession({ explicit: opts.sessionId, cwd, env, configDir });
  const transcriptPath = opts.transcriptPath ?? session.transcriptPath;

  let transcript = emptyFacts(transcriptPath ?? "");
  if (opts.transcript === false) transcript.skippedReason = "transcript disabled (--no-transcript)";
  else if (!transcriptPath) transcript.skippedReason = session.id ? `no transcript found for session ${session.id}` : "session id could not be resolved";
  else transcript = parseTranscript(transcriptPath);
  if (transcript.skippedReason) errors.push(transcript.skippedReason);

  const git = collectGit(cwd, run, {
    fetch: opts.fetch !== false,
    fetchTimeoutMs: opts.fetchTimeoutMs ?? 5_000,
    baseHint: transcript.worktree?.baseCommit,
  });
  errors.push(...git.errors);

  const pr =
    opts.gh === false
      ? { available: false, reason: "gh disabled (--no-gh)" }
      : collectPr(run, cwd, git.branch, transcript.prLink?.number, opts.ghTimeoutMs ?? 8_000);

  const sessionId = session.id ?? transcript.sessionId;
  const otherSessions = liveSessionsIn(cwd, sessionId, configDir);

  // The worktree lock names the pid of the session that created it. It is "ours" when that
  // pid's live-session record carries our session id (or is our own process).
  let lockHeldByOther = false;
  const lockPid = git.worktree.lockPid;
  if (lockPid) {
    const selfPid = Number(env.CLAUDE_PID ?? process.ppid);
    let lockSession: string | undefined;
    try {
      const p = join(configDir, "sessions", `${lockPid}.json`);
      if (existsSync(p)) lockSession = (JSON.parse(readFileSync(p, "utf-8")) as { sessionId?: string }).sessionId;
    } catch {
      // unreadable record: fall through to the pid comparison
    }
    const isSelf = lockPid === selfPid || (!!lockSession && lockSession === sessionId);
    lockHeldByOther = !isSelf && isPidAlive(lockPid);
  }

  const bundle: Bundle = {
    generatedAt: new Date().toISOString(),
    cwd,
    sessionId,
    sessionIdSource: session.source,
    transcript,
    git,
    pr,
    otherSessions,
    tasks: readTasks(sessionId, configDir),
    planFile: transcript.planFile ? planFileFacts(transcript.planFile) : undefined,
    devSessions: devSessionFacts(cwd, transcript.sessionDirs),
    priorReport: priorReport(cwd, sessionId),
    gate: evaluateGate({ git, pr, otherSessions, lockHeldByOther }),
    errors,
  };
  return bundle;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const has = (n: string) => argv.includes(n);
  const bundle = collect({
    cwd: arg(argv, "--cwd") ?? process.cwd(),
    sessionId: arg(argv, "--session"),
    transcript: !has("--no-transcript"),
    gh: !has("--no-gh"),
    fetch: !has("--no-fetch"),
    ghTimeoutMs: Number(arg(argv, "--gh-timeout-ms") ?? 8_000),
    fetchTimeoutMs: Number(arg(argv, "--fetch-timeout-ms") ?? 5_000),
  });
  if (has("--md")) {
    const text = nothingToReport(bundle)
      ? "(nothing to report: no decisions, verification, commits or changes in this session)"
      : renderHead(bundle, { maxChars: Number(arg(argv, "--max-chars") ?? 12_000), source: arg(argv, "--source"), includePriorReport: true });
    process.stdout.write(`${text}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
  }
}
