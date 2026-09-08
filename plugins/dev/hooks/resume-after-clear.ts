#!/usr/bin/env bun
/**
 * SessionStart (source: clear | compact) — put a /dev:dev run back on its feet after the
 * context that was orchestrating it is gone.
 *
 * THE TWO EVENTS THIS CATCHES.
 *
 *   clear    The plan-approval dialog's "Yes, clear context …" option (settings key
 *            `showClearContextOnPlanAccept`). Claude Code DENIES the ExitPlanMode call,
 *            clears the conversation, runs SessionStart hooks with source "clear", then
 *            submits "Implement the following plan: …" as the first message. Denied means
 *            PostToolUse:ExitPlanMode never fires, so resume-after-plan.ts never speaks,
 *            and the fresh context holds nothing but the plan text. Without this hook the
 *            model implements the plan ad hoc and Phases 4-8 and their gates are gone.
 *            A manual /clear mid-run lands here too.
 *
 *   compact  /compact, or auto-compaction, mid-run. The summary keeps a paraphrase; the
 *            command's 46 KB of orchestrator rules do not survive it.
 *
 * WHAT IT DOES. Reads the run's state from disk (lib/dev-session-state.ts) and injects it
 * with ONE instruction: re-invoke the orchestrator in resume mode. The orchestrator's own
 * <resume_protocol> then restores depth and automation from session-meta.json and
 * continues at the first phase whose artifacts are incomplete. The hook carries state,
 * never the pipeline rules — those live in commands/dev.md, and re-expanding that file is
 * the whole point of resuming through the Skill tool rather than "continuing" in place.
 *
 * WHY THE PLAN'S <dev-flow> FOOTER ALSO EXISTS. Plan mode adopted before Phase 0 has no
 * session directory to read, and this hook can be disabled. The footer is the belt to
 * this hook's braces: written into the plan file by the plan-mode protocol, it rides
 * inside the only text guaranteed to reach the next context.
 *
 * Never throws, never blocks: exit 0 with nothing on stdout is "not a dev run".
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { consumeDevRunMarker, peekDevRunMarker, writeDevRunMarker } from "./lib/dev-run-marker.ts";
import {
  deriveRunState,
  inProgressSessions,
  type RunState,
} from "./lib/dev-session-state.ts";
import type { Deps } from "./phase-completion-validator.ts";

export type ClearSource = "clear" | "compact";

interface HookInput {
  cwd?: string;
  source?: string;
  agent_type?: string;
}

const RESUME_SKILL = 'Skill(skill: "dev:dev", args: "--resume <session-id>")';

/**
 * session-meta.json is written by the plugin under a git-ignored path, so this is not a
 * trust boundary — but its strings are interpolated into the model's context, and a
 * value with newlines or angle brackets could forge a line of this block. Flatten, cap,
 * and never let a missing field read as a real one.
 */
function clean(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const s = String(value).replace(/[\r\n<>]/g, " ").trim();
  return s.length === 0 ? fallback : s.slice(0, 200);
}

function describePhases(state: RunState): string[] {
  return state.phases.map((p) => {
    const detail = p.errors.length > 0 ? ` — ${p.errors.join("; ")}` : "";
    return `  - ${p.phase} ${p.name}: ${p.state}${detail}`;
  });
}

function describeSession(state: RunState): string[] {
  const meta = state.meta;
  const checkpoint = meta?.checkpoint;
  const id = clean(meta?.sessionId, "");
  const lines = [
    `Session:    ${state.sessionPath}${id ? ` (id: ${id})` : ""}`,
    `Feature:    ${clean(meta?.feature)}`,
    `Depth:      ${clean(meta?.depth)}   Automation: ${clean(meta?.automation)}   (session-meta.json; "unknown" means ask once, or read the plan's <dev-flow> footer)`,
  ];
  if (checkpoint && typeof checkpoint === "object") {
    lines.push(
      `Checkpoint: lastCompletedPhase=${clean(checkpoint.lastCompletedPhase, "?")} nextPhase=${clean(checkpoint.nextPhase, "?")}   (as recorded — may be stale)`,
    );
  }
  lines.push("Artifacts on disk — the evidence; trust these over the checkpoint:");
  lines.push(...describePhases(state));
  lines.push(
    state.nextPhase
      ? `Derived next phase: ${state.nextPhase}`
      : "Derived next phase: none — every gated phase has its artifacts; only Phase 8 reporting may remain",
  );
  return lines;
}

/**
 * The injected text. Pure, so the tests can pin every branch.
 *
 * Deliberately imperative about the FIRST action and explicit about the three things
 * the next message can be. The model reading this has no memory of the run, and the
 * plan that follows it says "Implement the following plan" — a direct instruction this
 * block has to out-rank by being specific about why not.
 */
export interface ComposeInput {
  source: ClearSource;
  /** Open /dev:dev sessions, newest first. */
  states: RunState[];
  /** A run marker younger than six hours exists. */
  markerRecent: boolean;
  /**
   * Any `dev-feature-*` directory exists, open or not. With sessions on disk and none
   * open, a live marker is left over from a finished run — a quick-depth run never enters
   * plan mode, so nothing consumed it — and asserting "a run was in progress" would be
   * false on every /clear for six hours (review finding, 2026-09-08).
   */
  anySessionDirs: boolean;
}

export function composeResumeContext(input: ComposeInput): string | null {
  const { source, states, markerRecent, anySessionDirs } = input;
  const verb = source === "clear" ? "CLEARED" : "COMPACTED";

  if (states.length === 0) {
    // The marker-only case is exactly one shape: a clear during planning that was adopted
    // before Phase 0. A compaction cannot be that (plan mode is still running), and a
    // directory of finished runs means the marker is stale, not a run.
    if (!markerRecent || source !== "clear" || anySessionDirs) return null;
  }

  const head = [
    "<dev-resume-after-clear>",
    `The context was just ${verb} while a /dev:dev run was in progress. Everything the`,
    "orchestrator knew is gone from context. It is all on disk, and this is it:",
    "",
  ];

  /**
   * ONE decision, keyed on the next message. An earlier revision said "FIRST ACTION —
   * before anything else" and, six lines later, "if the next message is about something
   * else, do not start the pipeline"; a model obeying the first literally re-expanded the
   * command on an unrelated message.
   */
  const tail = [
    "",
    "Decide from the NEXT MESSAGE, and only then:",
    "",
    '  (a) It is "Implement the following plan:" and the plan ends with a <dev-flow> footer,',
    "      or it asks to continue or resume, or it is /dev:dev --resume. Then your first",
    "      action, before implementing anything, is to re-invoke the orchestrator:",
    `        ${RESUME_SKILL}`,
    "      Its <resume_protocol> restores depth and automation from session-meta.json, skips",
    "      the phases whose artifacts are complete, and continues at the derived next phase.",
    "      It re-expands the full command, which is the point — the rules did not survive.",
    "      A plan handed over this way was approved in the plan-approval dialog with \"clear",
    '      context" and has NOT been saved to the session: ExitPlanMode was denied to trigger',
    "      the clear, so Phase 3 Step 3.9 never ran. The resume protocol writes it to",
    "      architecture.md and continues. Do NOT implement it directly — the pipeline still",
    "      owes Phase 4 onward and their gates.",
    "",
    "  (b) Anything else. Do not start the pipeline. Say in one line that the run can be",
    "      resumed with /dev:dev --resume <id>, and answer the message.",
    "</dev-resume-after-clear>",
  ];

  if (states.length === 0) {
    return [
      ...head,
      "A run marker says /dev:dev was invoked within the last six hours, and no session",
      "directory exists: plan mode was adopted before Phase 0, so nothing could be written",
      "except the plan file. The plan's <dev-flow> footer carries the feature, depth and",
      "automation. With no session id, the resume protocol reads that footer, runs Phase 0",
      "to create the session, materialises the plan as architecture.md, and continues at",
      "Phase 4.",
      ...tail.map((l) => l.replace(RESUME_SKILL, 'Skill(skill: "dev:dev", args: "--resume")')),
    ].join("\n");
  }

  if (states.length > 1) {
    return [
      ...head,
      `${states.length} sessions are open. Pick the one named on the \`session:\` line of the`,
      "plan's <dev-flow> footer; if there is no plan in context, ask the user which one.",
      "",
      ...states.flatMap((s) => [...describeSession(s), ""]),
      ...tail,
    ].join("\n");
  }

  return [...head, ...describeSession(states[0]), ...tail].join("\n");
}

// ── Entry point ─────────────────────────────────────────────────────────────

function liveDeps(cwd: string): Deps {
  return {
    sizeOf: (p) => {
      try {
        return statSync(p).size;
      } catch {
        return null;
      }
    },
    read: (p) => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    sessions: () => {
      const dir = join(cwd, "ai-docs/sessions");
      if (!existsSync(dir)) return [];
      try {
        return readdirSync(dir)
          .filter((d) => d.startsWith("dev-feature-"))
          .map((d) => join(dir, d));
      } catch {
        return [];
      }
    },
    // Unused here: artifact presence is derived from files, and the git evidence check
    // belongs to the completion gate, not to a state report.
    dirtyPaths: () => [],
  };
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);

  let input: HookInput = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  } catch {
    process.exit(0);
  }

  const source = input.source;
  if (source !== "clear" && source !== "compact") process.exit(0);
  // A subagent's SessionStart carries agent_type. Subagents do not orchestrate.
  if (typeof input.agent_type === "string" && input.agent_type !== "") process.exit(0);

  const cwd = input.cwd ?? process.cwd();
  const now = Date.now();

  let text: string | null = null;
  try {
    const deps = liveDeps(cwd);
    const anySessionDirs = deps.sessions().length > 0;
    const states = inProgressSessions(deps).map((p) => deriveRunState(p, deps));
    // On clear the plan-approval gate has passed (or the run was abandoned) — either way
    // the ExitPlanMode hint the marker arms is stale, so consume it. A compaction during
    // planning leaves plan mode running, so only look.
    const markerRecent =
      source === "clear" ? consumeDevRunMarker(cwd, now) : peekDevRunMarker(cwd, now);
    text = composeResumeContext({ source, states, markerRecent, anySessionDirs });
    // The resumed run is re-invoked through the Skill tool, which never passes
    // UserPromptSubmit, so nothing else re-arms the marker. If planning is still ahead —
    // Phase 3 not done, or no session yet — the resumed run WILL call ExitPlanMode again
    // and needs resume-after-plan.ts to speak. Re-arm it for exactly that case.
    if (text !== null && source === "clear") {
      const planningAhead = states.length === 0 || states.some((s) => s.nextPhase === "phase3");
      if (planningAhead) writeDevRunMarker(cwd, now);
    }
  } catch {
    process.exit(0);
  }

  if (text) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: text,
        },
      }),
    );
  }
  process.exit(0);
}

if (import.meta.main) await main();
