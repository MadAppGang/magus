# Phase 4: Implementation

**Objective:** Implement feature across all stack layers

**Iteration limit:** 2 fix attempts per implementation phase

## Steps

### Step 4.1: Announce the phase
Say, in one line: **Phase 4 — starting.**

### Step 4.2: Read architecture
Read implementation phases from ${SESSION_PATH}/architecture.md

### Step 4.3: Read detected stack
Read `repo.detected_stack` from ${SESSION_PATH}/context.json. The commands that check the
work live under `commands.*` in the same document — schema at
`${CLAUDE_PLUGIN_ROOT}/skills/context-detection/references/context-schema.md`.

### Step 4.4: Check for outer loop feedback
If outer_iteration > 1:
  Read previous validation feedback from ${SESSION_PATH}/validation/feedback-iteration-{N-1}.md
  Focus implementation on fixing identified issues

### Step 4.5: Implement all phases

For each implementation phase in architecture:

a. Determine if phases are independent or dependent:
   - Independent: Can run in parallel (different components/layers)
   - Dependent: Must run sequentially (one depends on another)

b. If independent phases:
   Launch in PARALLEL (single message, multiple Tasks). **Route each phase to the agent
   that owns its surface**: a phase whose files are components, screens, styles or themes
   goes to `dev:frontend` (it preloads the design-system guardrails, and
   `agent_loadouts.frontend` marks them MANDATORY); every other phase goes to
   `dev:developer`. Each agent receives ITS OWN entry from `context.agent_loadouts` —
   never the other's, and never one flat list.

   Agent: dev:developer
     Prompt: "SESSION_PATH: ${SESSION_PATH}

              Read architecture: ${SESSION_PATH}/architecture.md
              Read context: ${SESSION_PATH}/context.json

              **DISCOVERED PROJECT SKILLS** (read first - project patterns):
              {for each skill in context.discovered_skills — every project-local skill the detector found; there is no relevance flag}
              - {skill.path} ({skill.name})
              {end}

              **YOUR LOADOUT** (from context.agent_loadouts.developer.read — at most 5,
              chosen for this agent and this task; read them, mandatory first):
              {for each path in context.agent_loadouts.developer.read}
              - {path}{if path in context.agent_loadouts.developer.mandatory} ← MANDATORY{end}
              {end}
              {if context.agent_loadouts.developer.note}
              Note: {context.agent_loadouts.developer.note}
              {end}

              {If outer_iteration > 1}
              PREVIOUS VALIDATION FAILED:
              {feedback from previous iteration}
              Focus on fixing these specific issues.
              {/If}

              Implement phase: {phase_name}
              PRIORITY: Follow discovered project patterns first.
              Run quality checks before completing.

              Log progress to ${SESSION_PATH}/implementation-log.md
              Return brief summary (max 3 lines)"
   ---
   Agent: dev:frontend
     Prompt: "SESSION_PATH: ${SESSION_PATH}

              Read architecture: ${SESSION_PATH}/architecture.md
              Read context: ${SESSION_PATH}/context.json

              **DISCOVERED PROJECT SKILLS** (read first - project patterns):
              {for each skill in context.discovered_skills — every project-local skill the detector found; there is no relevance flag}
              - {skill.path} ({skill.name})
              {end}

              **YOUR LOADOUT** (from context.agent_loadouts.frontend.read — at most 5,
              chosen for this agent and this task; read them, mandatory first. The
              design-system guardrails are listed MANDATORY even though you preload them:
              the marker is what the reviewer checks):
              {for each path in context.agent_loadouts.frontend.read}
              - {path}{if path in context.agent_loadouts.frontend.mandatory} ← MANDATORY{end}
              {end}
              {if context.agent_loadouts.frontend.note}
              Note: {context.agent_loadouts.frontend.note}
              {end}

              {If outer_iteration > 1}
              PREVIOUS VALIDATION FAILED:
              {feedback from previous iteration}
              Focus on fixing these specific issues.
              {/If}

              Implement phase: {phase_name}
              PRIORITY: Follow discovered project patterns first.
              Run quality checks before completing.

              Log progress to ${SESSION_PATH}/implementation-log.md
              Return brief summary (max 3 lines)"
   ---
   ... (one dispatch per parallel phase, each to the agent that owns its surface)

c. If dependent phases:
   Launch sequentially, waiting for each to complete — same routing by surface, same
   per-agent loadout as in (b)

d. After each phase:
   - Verify quality checks passed
   - If failed: Delegate fix (max 2 attempts)
   - If still failing: Escalate to user

### Step 4.6: Track implementation progress
Track all progress in ${SESSION_PATH}/implementation-log.md:
- Phase name
- Start/end time
- Files created/modified
- Quality check results
- Issues encountered
- Outer loop iteration number

### Step 4.7: Announce the phase complete
Say, in one line: **Phase 4 — complete**, naming the artifacts you wrote.
Do this only once those files exist; the Stop hook verifies them and will block
the turn if they do not.

## Quality Gate
All stacks implemented, quality checks pass
