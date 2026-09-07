#!/usr/bin/env bun
/**
 * SessionStart (matcher `compact|resume`) — put the session's facts back after compaction.
 *
 * WHY HERE. Compaction replaces the conversation with a summary whose sections are fixed:
 * accomplished, in progress, files, next steps, constraints. Decisions, verification
 * outcomes, blockers and plan changes have no slot, so they are the first things the model
 * loses, and it happens without the user asking. `SessionStart` with source `compact` is
 * the one event that fires right after and whose output lands in the fresh context. The
 * same hook serves `resume`, which covers "resume from summary" too.
 *
 * WHY NOT PreCompact. The transcript on disk is not compacted: Claude Code appends the
 * summary and keeps every earlier line. So the facts are still readable here; a snapshot
 * taken before compaction would only duplicate them.
 *
 * WHAT IT COSTS. Facts only, no model call. No `git fetch` and `gh` capped at 2 s, so the
 * whole thing fits the 5 s hook budget. A session with nothing to report (no decisions,
 * verification, commits or changes) injects nothing at all.
 */
import { collect } from "../scripts/status/collect.ts";
import { nothingToReport, renderHead } from "../scripts/status/render.ts";
import { additionalContext, readHookInput } from "./lib/hook-io.ts";

const MAX_CHARS = 4_000;

const input = readHookInput();
if (!input) process.exit(0);

const source = typeof input.raw.source === "string" ? input.raw.source : "";
if (source && source !== "compact" && source !== "resume") process.exit(0);

const cwd = input.cwd ?? process.cwd();

try {
  const bundle = collect({
    cwd,
    sessionId: input.sessionId,
    transcriptPath: input.transcriptPath,
    fetch: false,
    ghTimeoutMs: 2_000,
  });
  if (nothingToReport(bundle)) process.exit(0);
  const head = renderHead(bundle, { maxChars: MAX_CHARS, source: source || "session start", includePriorReport: true });
  additionalContext(
    `<dev-status-reinject>
The context was ${source === "resume" ? "resumed" : "compacted"}. The block below is evidence collected from git, the pull request and this session's transcript — not a summary. Decisions listed here were made by the user; verification lines are what actually ran. Prefer it over the compaction summary where they disagree. Run /dev:status for the full report.

${head}
</dev-status-reinject>`,
  );
} catch {
  process.exit(0); // a broken hook must never cost the user their turn
}
