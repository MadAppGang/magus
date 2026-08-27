#!/usr/bin/env bun
/**
 * UserPromptSubmit — tell /dev:dev how to use plan mode, and mark the run as started.
 *
 * TWO REQUIREMENTS, and the first one is the feature.
 *
 *   1. `/dev:dev` should ENTER plan mode at the architecture step, so the user sees and
 *      approves the design before any file is written.
 *   2. When the user approves and the session flips to auto or accept-edits, the pipeline
 *      must CARRY ON into implementation rather than stopping with a plan in hand.
 *
 * Requirement 2 is not handled here — it needs a signal at the moment of approval, which
 * is `PostToolUse:ExitPlanMode`. See resume-after-plan.ts. This hook writes the marker
 * that one consumes.
 *
 * WHY A HOOK RATHER THAN TEXT IN dev.md.
 *
 * Plan mode re-injects its reminder on EVERY turn ("Plan mode still active … Read-only
 * except plan file"). A slash command is expanded ONCE. By the architecture phase the
 * reminder has been repeated several times and dev.md has been repeated zero times, so
 * whatever dev.md said about plan mode has been out-lasted rather than out-ranked.
 *
 * An earlier revision put this protocol inline in dev.md. DPM-1 measured it: across five
 * sessions its language appeared ZERO times and the fixed tree was indistinguishable from
 * the unfixed one. Moved to this hook, the same words appeared in 5 of 5 (p=0.004).
 * **Do not move it back.**
 */
import { writeDevRunMarker } from "./lib/dev-run-marker.ts";

interface HookInput {
  prompt?: string;
  cwd?: string;
}

const chunks: Uint8Array[] = [];
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);

let input: HookInput = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
} catch {
  process.exit(0); // malformed payload: stay silent rather than inject noise
}

const prompt = String(input.prompt ?? "");
// Word-boundaried: `/dev:dever`, or the string inside prose, must not trigger this.
if (!/(^|\s)\/dev:dev(\s|$)/.test(prompt)) process.exit(0);

writeDevRunMarker(input.cwd ?? process.cwd(), Date.now());

/**
 * The NOT-active branch leads, because that is the normal case and the requested feature.
 * The adopt branch is second: it handles the collision where plan mode was already on
 * when the command was typed.
 *
 * The protocol does not branch on a detected mode, because this hook cannot reliably know
 * one — `permission_mode` is not a documented UserPromptSubmit field. The model can see
 * its own plan-mode reminder, so the condition is written for it to resolve.
 */
const PROTOCOL = `<dev-plan-mode-protocol>
/dev:dev was just invoked. Plan mode is part of this workflow. Resolve it explicitly
before Step 0, and STATE WHICH BRANCH YOU TOOK IN ONE LINE. Silence is the bug this
exists to prevent: the banner prints, no phase runs, and nothing reports it.

Plan mode is ACTIVE if a system reminder in this conversation says "Plan mode is active"
or "Plan mode still active" and names a plan file path.

── IF PLAN MODE IS NOT ACTIVE (the normal case) ──────────────────────────────
Say: "Plan mode not active — running the pipeline from Phase 0. Architecture will be
designed in plan mode."

Run Phases 0-2 normally. **Then, at Phase 3 (architecture), enter plan mode:**

  1. Call \`EnterPlanMode\`. It takes no arguments, is read-only, and opens no dialog —
     it flips the session's permission mode directly. ONLY YOU may call it: inside a
     subagent it throws "EnterPlanMode tool cannot be used in agent contexts".
  2. Write the design checklist into the plan file immediately. It is the only file plan
     mode lets you write and the only thing it re-reads every turn.
  3. Delegate read-only exploration to Agent(subagent_type: "dev:architect").
  4. Call \`ExitPlanMode\` with the design. **Its dialog IS the Phase 3.8 approval gate** —
     do not also ask with AskUserQuestion.
  5. Write architecture.md only AFTER it returns, never during. Then continue at Phase 4.

── IF PLAN MODE IS ALREADY ACTIVE (adopt it) ─────────────────────────────────
Say: "Plan mode is active. /dev:dev is adopting it as Phase 3."

  1. The plan file IS the Phase 3 artifact. Do not re-derive an approved architecture.
  2. Run Phases 0-3 read-only. Write NOTHING except the plan file, and do not create the
     session directory yet.
  3. Call \`ExitPlanMode\`. Its dialog is the Phase 3.8 gate; do not ask twice.
  4. After it returns, copy the approved plan to \${SESSION_PATH}/architecture.md and
     resume at Phase 4.

── BOTH BRANCHES ─────────────────────────────────────────────────────────────
Approval ENDS the planning, it does not end the run. When ExitPlanMode returns, /dev:dev
continues at Phase 4 in the same turn. Do not stop and wait, and do not ask whether to
proceed — that approval was the gate.

Plan mode permits writing exactly ONE file, the plan file, so the phase artifact gates
cannot be satisfied while it is active. Exit first; never route around a gate that is
only temporarily unsatisfiable.
</dev-plan-mode-protocol>`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: PROTOCOL,
    },
  }),
);
