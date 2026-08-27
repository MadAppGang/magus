# Phase 2: Research (Optional)

**Objective:** Gather external information if needed

## Steps

### Step 2.1: Announce the phase
Say, in one line: **Phase 2 — starting.**

### Step 2.2: Analyze requirements for research needs
- External APIs or libraries
- Design patterns for similar features
- Performance benchmarks
- Security best practices
- Technology compatibility

### Step 2.3: Research (conditional)

If research needed:
  a. Ask user (AskUserQuestion): "Would you like me to research [topics]?"
  b. If yes: Identify specific questions to research
  c. Gather information (via available tools)
  d. Write ${SESSION_PATH}/research.md with findings

If not needed:
  a. Skip this phase
  b. Log: "Research phase skipped - no external dependencies"

### Step 2.4: Announce the phase complete
Say, in one line: **Phase 2 — complete**, naming the artifacts you wrote.
Do this only once those files exist; the Stop hook verifies them and will block
the turn if they do not.

## Quality Gate
Research complete or explicitly skipped
