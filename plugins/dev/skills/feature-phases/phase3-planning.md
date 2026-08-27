# Phase 3: Multi-Model Planning

**Objective:** Design architecture under plan mode, get it approved, then validate it with multi-model review

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 2)

## Why this phase has two gates

Design happens under **plan mode**, so nothing can be written to the repo while the
architecture is still being argued about. Plan mode permits exactly one write target —
the session's plan file — so during design the agents **return** their work and the
orchestrator stages it there. `ExitPlanMode` is the first gate: you approve a design
before a single file exists.

Everything file-bound runs *after* that gate, because it cannot run before it:

- `claudish team` **requires** a `path` and writes each model's output into it. There is
  no file-free mode. Multi-model review therefore cannot happen inside plan mode.
- `dev:test-architect` may read `architecture.md` and nothing else (see
  `<test_independence>` in `dev.md`). That file is the isolation boundary that keeps
  tests black-box, so it has to exist as a file.
- `phase-completion-validator.ts` refuses to mark this phase complete until
  `architecture.md`, `reviews/plan-review/consolidated.md` and
  `reviews/plan-review/claude-internal.md` all exist at their required sizes.

The second gate (Step 3.12) is the existing consensus gate, unchanged.

## Steps

### Step 3.1: Announce the phase
Say, in one line: **Phase 3 — starting.**

### Step 3.2: Read iteration config
```bash
plan_revision_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.planRevision')
```

### Step 3.3: Check for outer loop feedback
If outer_iteration > 1:
  Read previous validation feedback from ${SESSION_PATH}/validation/feedback-iteration-{N-1}.md
  Include in architect prompt: "Previous validation failed: {feedback}"

### Step 3.4: Enter plan mode

Call **EnterPlanMode**.

This requires the user's consent, which is the point — from here until Step 3.8 the
session cannot modify the repo. Note the plan file path from the plan-mode system
message; Steps 3.6 and 3.7 write to it, and `ExitPlanMode` reads it.

If the user declines plan mode, skip to Step 3.9 and run the phase file-based as
before. Declining is a valid choice, not an error — say so and continue.

### Step 3.5: Launch stack-detector agent (in-context)
Prompt: "SESSION_PATH: ${SESSION_PATH}

         Detect ALL technology stacks AND discover real project skills.

         1. Detect stacks from config files (package.json, go.mod, etc.)
         2. **DISCOVER REAL SKILLS** in:
            - .claude/skills/**/SKILL.md
            - Enabled plugins from .claude/settings.json
            - .claude-plugin/*/skills/**/SKILL.md

         3. Auto-load skills matching feature keywords:
            - Parse ${SESSION_PATH}/requirements.md for keywords
            - Match to discovered skill categories

         **Plan mode is active — do NOT write context.json.**
         Return the JSON as your final message instead, with:
         - detected_stack
         - discovered_skills (name, description, path, source, categories)
         - bundled_skill_paths"
Output: returned JSON, held in orchestrator context

### Step 3.6: Display discovered skills
From the returned JSON, identify auto-loaded skills. Display to orchestrator:
```
Discovered Skills ({count}):
{for each skill}
- {name} ({source}) - {description}
  Auto-loaded: {if matches feature keywords}
{end}
```

### Step 3.7: Launch architect agent (in-context)
Prompt: "SESSION_PATH: ${SESSION_PATH}

         Read requirements: ${SESSION_PATH}/requirements.md
         Read research: ${SESSION_PATH}/research.md (if exists)
         Read validation criteria: ${SESSION_PATH}/validation-criteria.md

         DETECTED CONTEXT (from stack-detector, no file on disk yet):
         {returned JSON from Step 3.5}

         **DISCOVERED PROJECT SKILLS** (read these first - project-specific patterns):
         {for each skill in discovered_skills where auto_loaded == true}
         - {skill.path} ({skill.name} - {skill.description})
         {end}

         **BUNDLED SKILLS** (fallback patterns):
         {for each path in bundled_skill_paths}
         - {path}
         {end}

         {If outer_iteration > 1}
         PREVIOUS VALIDATION FAILED:
         {feedback from previous iteration}

         Fix the issues identified above.
         {/If}

         Design architecture for this feature.
         **Priority**: Follow discovered skill patterns first, then bundled skills.

         Include: component structure, data flow, API contracts,
         database schema (if applicable), testing strategy, implementation phases.

         **Plan mode is active — no output path is given, so do NOT call Write.**
         Return the complete architecture document as your final message."

Write the returned document into the plan file, under a `## Architecture` heading.

### Step 3.8: GATE 1 — ExitPlanMode

Call **ExitPlanMode**. The user approves or rejects the staged design.

If rejected with feedback, stay in plan mode, re-run Step 3.7 with the feedback, and
call ExitPlanMode again. Count these against `plan_revision_limit`.

Nothing below this line runs until the design is approved.

### Step 3.9: Materialise the approved design

Now that writes are permitted again, persist what was approved:

- `${SESSION_PATH}/context.json` ← the JSON returned in Step 3.5
- `${SESSION_PATH}/architecture.md` ← the `## Architecture` section of the plan file

These are the same files, with the same content, that this phase has always produced.
Everything downstream — Phase 4, `dev:test-architect`, the completion validator — is
unchanged and does not know planning happened under plan mode.

### Step 3.10: Multi-model plan review (P1b — READ FROM CONFIG, NO RE-ASKING)

Read model selection from ${SESSION_PATH}/iteration-config.json:
```bash
selected_models=$(cat ${SESSION_PATH}/iteration-config.json | jq '.selectedModels')
```

If selectedModels.configured = true and selectedModels.models is non-empty:
  Display: "Using pre-configured models: {model list}"

  a. Write plan review prompt to ${SESSION_PATH}/reviews/plan-review/prompt.md

  b. Launch PARALLEL plan reviews (SINGLE message, multiple Tasks):

     Agent: dev:architect
       Prompt: "Review ${SESSION_PATH}/architecture.md for issues.
                Write review to ${SESSION_PATH}/reviews/plan-review/claude-internal.md
                Return brief summary"
     ---
     claudish team(mode="run", path=${SESSION_PATH}/reviews/plan-review,
       models=[{model1}, {model2}, ...],
       input=contents_of_prompt.md, timeout=180,
       min_output_bytes=400)

     `min_output_bytes` floors the external slots — the prompt mandates topics but no
     machine-checkable format, so `require_pattern` has nothing to match. A slot that
     exited 0 having produced nothing would otherwise enter the consensus count as a
     reviewer that found no issues, which reads as agreement.

  c. Wait for all reviews to complete

  d. Consolidate reviews with blinded voting:
     - Read all review files
     - Apply consensus analysis (unanimous, strong, majority, divergent)
     - Prioritize issues by consensus and severity
     - Write ${SESSION_PATH}/reviews/plan-review/consolidated.md

  e. If CRITICAL issues found:
     - Launch architect to revise plan
     - Re-review (max plan_revision_limit iterations total)
     - If still critical after limit: Escalate to user

If selectedModels.configured = false OR models is empty:
  Show warning: "No external models configured. Review will use internal Claude only."
  Launch architect for internal review only:
  Agent: dev:architect
    Prompt: "Review ${SESSION_PATH}/architecture.md for issues.
             Write review to ${SESSION_PATH}/reviews/plan-review/claude-internal.md
             Also write to ${SESSION_PATH}/reviews/plan-review/consolidated.md
             Return brief summary"

### Step 3.11: GATE 2 — consensus approval

**PRESET CHECK:** If `./dev-preset.json` exists in cwd and has `automation: "autonomous"` AND multi-model consensus is non-critical (no CRITICAL issues in consolidated review), skip this widget and auto-approve. Read the preset now if you haven't already this session. If CRITICAL issues were found, still escalate to user (autonomous mode doesn't override critical consensus).

Use AskUserQuestion to present the consensus analysis (if multi-model).
Options:
1. Approve plan and proceed
2. Request specific changes
3. Cancel feature development

### Step 3.12: Offer to raise the permission mode

Implementation is about to start, and it is edit-heavy. Tell the user once, in one
line, that they can raise the permission mode before Phase 4:

> Plan approved. Phase 4 writes a lot of files — **shift+tab** cycles the permission
> mode if you want to stop approving each edit.

**Suggest it, never set it.** A plugin cannot raise the mode for the user:
`setMode: "bypassPermissions"` is rejected outright unless the session was launched
with `--allow-dangerously-skip-permissions`, and `auto` depends on gates this command
cannot see. The shift+tab cycle from `default` is `acceptEdits → plan → bypassPermissions
(if available) → auto (if available)`, so the user always has a one-keystroke path and
keeps the decision.

### Step 3.13: Announce the phase complete
Say, in one line: **Phase 3 — complete**, naming the artifacts you wrote.
Do this only once those files exist; the Stop hook verifies them and reports
if a phase was started and left half done.

## Quality Gate
Design approved via ExitPlanMode AND plan approved by consensus AND user.
Required artifacts:
- ${SESSION_PATH}/architecture.md
- ${SESSION_PATH}/reviews/plan-review/consolidated.md
- ${SESSION_PATH}/reviews/plan-review/claude-internal.md
