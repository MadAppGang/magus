#!/usr/bin/env bun
/**
 * PostToolUse:ExitPlanMode — after the user approves the plan, RESUME the pipeline.
 *
 * THE PROBLEM THIS SOLVES.
 *
 * `/dev:dev` enters plan mode at the architecture phase, designs, and calls
 * `ExitPlanMode`. The user picks "Yes, and use auto mode" (or "Yes, manually approve
 * edits"), the session leaves plan mode, and then — nothing. The run stops having
 * produced a plan, because by that point the command's own instructions are many turns
 * back while plan mode's reminder has been re-injected on every one of them. The model
 * has just been told, repeatedly, that its job is to produce a plan. It produced one.
 *
 * WHY POSTTOOLUSE IS THE RIGHT PLACE.
 *
 * It fires per-tool, after success, matched by tool name — so `ExitPlanMode` means
 * exactly "the plan was approved and the session has left plan mode". That is the precise
 * instant the pipeline must be told to carry on, and `additionalContext` is documented as
 * "non-error feedback delivered to the model; the conversation continues so the model can
 * act on it". No other event lands there.
 *
 * WHY IT IS GUARDED.
 *
 * It fires for every `ExitPlanMode` in any session, most of which have nothing to do with
 * this plugin. Without the marker it would tell an unrelated plan-mode session to resume
 * Phase 4 of a pipeline it never started. See lib/dev-run-marker.ts for why the marker is
 * a file and not a session-directory check.
 */
import { consumeDevRunMarker } from "./lib/dev-run-marker.ts";

interface HookInput {
  cwd?: string;
  tool_name?: string;
  toolName?: string;
}

const chunks: Uint8Array[] = [];
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);

let input: HookInput = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
} catch {
  process.exit(0); // malformed payload: stay silent
}

const tool = String(input.tool_name ?? input.toolName ?? "");
if (tool !== "ExitPlanMode") process.exit(0);

const cwd = input.cwd ?? process.cwd();
if (!consumeDevRunMarker(cwd, Date.now())) process.exit(0);

/**
 * Deliberately imperative and specific about the NEXT action.
 *
 * "Continue the workflow" is too weak here — the model has spent several turns being told
 * it is planning, so the instruction has to name the phase, name the artifact, and say
 * explicitly that no further approval is needed. The approval that just happened WAS the
 * gate.
 */
const RESUME = `<dev-resume-after-plan>
The plan was approved and the session has left plan mode. **/dev:dev is not finished —
resume it now.** Do not stop here, and do not summarise the plan back; the user has
already read and approved it.

Next actions, in order:

1. Write the approved plan to \${SESSION_PATH}/architecture.md. It is the Phase 3
   artifact. If \${SESSION_PATH} does not exist yet, create it now — plan mode was what
   prevented that, and plan mode has ended.
2. Say in one line: **Phase 3 — complete.** Artifacts: architecture.md
3. Continue at **Phase 4 (implementation)** and run the remaining phases for the depth
   this run selected.

Do NOT ask for approval to proceed. ExitPlanMode's dialog was the Phase 3.8 gate and the
user answered it. Asking again is the same question twice.

Writing is permitted now. The phase-artifact gate still runs when the turn ends and will
refuse it if a phase is left half done.
</dev-resume-after-plan>`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: RESUME,
    },
  }),
);
