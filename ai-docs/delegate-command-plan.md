# Architecture Plan: `/multimodel:delegate` Command

**Date**: 2026-03-22
**Status**: Design Complete — Ready for Implementation
**Plugin**: `plugins/multimodel`
**Files to create**:
- `plugins/multimodel/commands/delegate.md`
- `plugins/multimodel/skills/delegate-patterns/SKILL.md`

---

## Overview

`/multimodel:delegate` delegates any task — described as a natural language goal or as an explicit plugin slash command — to an external AI model via claudish. The delegated model runs Claude Code in the same working directory, inheriting all installed plugins, skills, agents, and `CLAUDE.md`. There is no need to reconstruct command files from the plugin cache; claudish handles all of that automatically.

The command solves two problems:
1. **Model choice**: Run a specific task with a specific external model (Grok, Gemini, GPT-5, etc.)
2. **Non-interactive execution**: Claudish runs headless. Pre-flight question gathering batches all interactive questions before handing off.

### Architecture Diagram

```
User: /multimodel:delegate grok implement auth module

    ┌──────────────────────────────────────────────────────┐
    │  PHASE 1: Parse & Model Selection                    │
    │  • Extract: model="grok", task="implement auth..."   │
    │  • Resolve model alias → "grok-code-fast-1"          │
    │  • No slash command → capability discovery needed    │
    └──────────────────┬───────────────────────────────────┘
                       │
    ┌──────────────────▼───────────────────────────────────┐
    │  PHASE 2: Capability Discovery (subagent)            │
    │                                                      │
    │  dev:researcher subagent (separate context):         │
    │  • Reads enabled plugin manifests                    │
    │  • Reads skill SKILL.md descriptions                 │
    │  • Reads agent .md descriptions                      │
    │  • Reads command .md front-matter                    │
    │  • Matches task → best-fit capabilities              │
    │  → Writes {SESSION_DIR}/capability-discovery.md      │
    └──────────────────┬───────────────────────────────────┘
                       │
    ┌──────────────────▼───────────────────────────────────┐
    │  PHASE 3: Pre-Flight Question Gathering              │
    │  • Check if recommended command uses AskUserQuestion │
    │  • Predict questions → batch-ask user                │
    │  → Writes {SESSION_DIR}/preflight-answers.md         │
    └──────────────────┬───────────────────────────────────┘
                       │
    ┌──────────────────▼───────────────────────────────────┐
    │  PHASE 4: Execute via Claudish                       │
    │  • Assemble prompt with capability context +         │
    │    pre-answered questions + user task                │
    │  • claudish -y --model grok-code-fast-1 --stdin      │
    │    --quiet < prompt.md > result.md                   │
    │  • Present result inline                             │
    └──────────────────────────────────────────────────────┘
```

---

## Component Design

### 1. `delegate.md` — The Command

**Responsibilities**:
- Parse `$ARGUMENTS` into model, optional slash command, and task description
- Orchestrate the 4-phase workflow
- Maintain session directory for all artifacts
- Present inline results

**Dependencies**:
- `multimodel:task-external-models` — claudish invocation patterns
- `multimodel:claudish-usage` — claudish flags, context pollution rules
- `multimodel:delegate-patterns` — new skill (see below)

### 2. `delegate-patterns/SKILL.md` — Companion Skill

**Responsibilities**:
- Document the capability discovery pattern for reuse by other commands
- Document pre-flight question gathering pattern
- Document prompt assembly pattern (capability context + preflight + task)
- Serve as the authoritative reference if `/team` or other commands adopt delegation

### 3. Capability Discovery Subagent

**Not a new agent file** — uses existing `dev:researcher` as the subagent type. The discovery prompt is constructed inline by the command and passed via the `prompt:` field of the `Task` call. The subagent:
- Runs in a fully isolated context (separate window, no main context pollution)
- Only reads files — no writes except to `{SESSION_DIR}/capability-discovery.md`
- Has a bounded scope: enabled plugins only, reading manifests + SKILL.md descriptions + agent/command front-matter

---

## Data Design

### Session Directory Structure

```
ai-docs/sessions/delegate-{slug}-{timestamp}-{rand}/
├── task.md                   # Original user task
├── capability-discovery.md   # Phase 2 output (subagent findings)
├── preflight-answers.md      # Phase 3 output (user Q&A, may not exist)
├── prompt.md                 # Phase 4 assembled prompt (for debugging)
├── result.md                 # Claudish output
└── stderr.log                # Claudish stderr
```

### Capability Discovery Output Schema

The subagent writes `capability-discovery.md` with this structure:

```markdown
## Capability Match: {task_description}

### Recommended Command
- **Command**: `/plugin:command` (or "none" if natural task description suffices)
- **Rationale**: Why this command fits the task

### Relevant Skills
- `plugin:skill-name` — {one-line description of relevance}
- ...

### Available Agents
- `plugin:agent-name` — {one-line description of relevance}
- ...

### Recommended Approach
{1-3 sentence synthesis: which command to invoke, which skills are most relevant,
what the external model should focus on}

### Has AskUserQuestion
yes | no
```

### Model Preferences File (reuses existing schema)

```json
// .claude/multimodel-team.json (existing, no schema changes)
{
  "defaultModels": ["grok-code-fast-1"],
  "claudeFlags": "--effort high",
  ...
}
```

The `defaultModels[0]` is used as the default model for delegation (single-model selection, unlike `/team` which uses the full array).

---

## API Design

### Command Invocation Formats

```
/multimodel:delegate [model] [/plugin:command] <task> [--no-preflight]
```

**Argument parsing rules (in order of token evaluation)**:
1. First token: if no `:` and no `--` prefix → model ID or alias
2. Next token starting with `/` and containing `:` → explicit slash command
3. Remaining tokens → task description (passed as `$ARGUMENTS` to delegated command)
4. `--no-preflight` flag: skip Phase 3

**Examples**:
```
/multimodel:delegate grok implement authentication module
/multimodel:delegate gemini /dev:architect design payment service
/multimodel:delegate /dev:research rate limiting patterns
/multimodel:delegate --no-preflight grok /dev:dev add user profile page
```

### Claudish Execution Command

```bash
claudish -y --model {MODEL_ID} --stdin --quiet {CLAUDE_FLAGS} \
  < {SESSION_DIR}/prompt.md \
  > {SESSION_DIR}/result.md \
  2>{SESSION_DIR}/stderr.log
echo $? > {SESSION_DIR}/result.exit
```

Where `{CLAUDE_FLAGS}` comes from `claudeFlags` in `.claude/multimodel-team.json` (may be empty).

### Assembled Prompt Structure (Phase 4)

```markdown
{preflight_section_if_exists}
---
{capability_context}
---
Now execute the following task. Use the capabilities identified above — invoke the recommended
command or approach directly. DO NOT re-ask questions that are already answered above.

{user_task}
```

Where:
- `{preflight_section_if_exists}`: The contents of `preflight-answers.md` wrapped in a preamble, or omitted
- `{capability_context}`: The full contents of `capability-discovery.md`
- `{user_task}`: The raw task string, optionally preceded by `/plugin:command` if an explicit command was given

---

## Phase-by-Phase Specification

### Phase 1: Parse & Model Selection

1. Check claudish is installed: `which claudish 2>/dev/null || echo "NOT_FOUND"`
   - If NOT_FOUND: print install instructions, stop
2. Read `.claude/multimodel-team.json` (setup read, not pre-solving)
3. Parse `$ARGUMENTS`:
   - Token 1: model if no `:` and no `--` → resolve short alias from model_aliases table
   - Next token with `/` and `:` → EXPLICIT_COMMAND
   - Remaining → TASK_DESCRIPTION
4. Resolve model:
   - Explicit arg → use verbatim (after alias resolution)
   - `defaultModels[0]` from preferences → use, announce it
   - Neither → `AskUserQuestion` for model selection
5. Read `claudeFlags` from preferences for passthrough
6. Create session directory:
   ```bash
   SLUG=$(echo "${TASK_DESCRIPTION}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c24)
   SESSION_DIR="ai-docs/sessions/delegate-${SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
   mkdir -p "$SESSION_DIR"
   ```
7. Write task to `{SESSION_DIR}/task.md`

### Phase 2: Capability Discovery

**Key insight**: claudish runs Claude Code in the same directory with all plugins loaded. The capability discovery does NOT need to resolve command files from the plugin cache. It only needs to tell the external model what tools and commands are available, so the model can invoke them directly.

**When to run capability discovery**:
- Always run when NO explicit slash command is provided (natural task description only)
- Skip if `EXPLICIT_COMMAND` is set (user already knows what they want)

**Subagent invocation**:
```
Task({
  subagent_type: "dev:researcher",
  description: "Capability discovery for delegate command",
  prompt: """
    Analyze the user's task and the installed plugins to find the best-fit capabilities.

    User task: {TASK_DESCRIPTION}

    Steps:
    1. Read .claude/settings.json to find enabled plugins
    2. For each enabled plugin (true value), locate its plugin.json in one of:
       - plugins/{plugin-name}/plugin.json (local/dev)
       - ~/.claude/plugins/cache/**/{plugin-name}/**/plugin.json (installed)
    3. Read each plugin.json to find skills/, agents/, and commands/ entries
    4. For each skill: read the SKILL.md front-matter (first 10 lines) for name+description
    5. For each agent: read the .md front-matter (first 5 lines) for name+description
    6. For each command: read the .md front-matter (first 10 lines) for name+description+allowed-tools
    7. Match the user's task to the most relevant capabilities
    8. Write findings to: {SESSION_DIR}/capability-discovery.md

    Output format (write to capability-discovery.md):
    ## Capability Match: {task_description}

    ### Recommended Command
    - **Command**: `/plugin:command` (or "none — use natural task description")
    - **Rationale**: Why this fits

    ### Relevant Skills
    - `plugin:name` — why relevant

    ### Available Agents
    - `plugin:name` — why relevant

    ### Recommended Approach
    {1-3 sentences on best execution path}

    ### Has AskUserQuestion
    yes | no

    Only include capabilities that are genuinely relevant. Quality over quantity.
  """
})
```

**Context pollution prevention**: The subagent runs in a separate context window. Only `capability-discovery.md` returns to the main context (via Read tool after the Task completes).

### Phase 3: Pre-Flight Question Gathering

**When to run**:
- An explicit command was provided AND its front-matter contains `AskUserQuestion` in `allowed-tools`
- OR the capability discovery output says `Has AskUserQuestion: yes`
- AND `--no-preflight` was NOT passed

**Steps**:
1. Read the capability discovery output (or use the explicit command front-matter directly)
2. Use local plan-mode reasoning to predict what questions the command would ask based on the task
3. Skip questions that can be inferred from the task description
4. Batch all remaining questions into a single `AskUserQuestion` call
5. Include a catch-all: "What additional context should the model know? (constraints, files, requirements) — leave blank to skip"
6. Write answers to `{SESSION_DIR}/preflight-answers.md`:
   ```
   ## Pre-answered questions for delegation

   - {Question 1}: {Answer 1}
   - {Question 2}: {Answer 2}
   ```

**Skip condition**: If no questions are predicted, write a single-line note and proceed. Do not ask the user zero questions.

### Phase 4: Execute via Claudish

1. Assemble `{SESSION_DIR}/prompt.md`:
   - If `preflight-answers.md` exists and is non-empty: include as preamble with "DO NOT re-ask these questions" instruction
   - Include capability discovery context (or a brief summary if file is large)
   - If explicit command: include `/plugin:command {task_args}` as the final instruction
   - If no explicit command: include the raw task description, referencing recommended approach

2. Execute:
   ```bash
   claudish -y --model {MODEL_ID} --stdin --quiet {CLAUDE_FLAGS} \
     < {SESSION_DIR}/prompt.md \
     > {SESSION_DIR}/result.md \
     2>{SESSION_DIR}/stderr.log
   echo $? > {SESSION_DIR}/result.exit
   ```

3. Verify:
   - Read `result.exit` — must be `0`
   - Check `result.md` exists and has >100 bytes
   - If failure: read `stderr.log`, report with exact error, stop (no auto-retry)

4. Present results:
   - Display `result.md` contents inline
   - Show session directory path for full artifacts
   - Note: "Model: {MODEL_ID} | Session: {SESSION_DIR}"

---

## Complete YAML Front-Matter for `delegate.md`

```yaml
---
name: delegate
description: |
  Delegate any task to an external AI model via claudish. The model runs Claude Code
  with all your plugins, skills, and agents loaded. Optionally specify which plugin
  slash command to invoke; otherwise capability discovery finds the best approach.

  Usage:
    /multimodel:delegate [model] [/plugin:command] <task> [--no-preflight]

  Examples:
    /multimodel:delegate grok implement authentication module
    /multimodel:delegate gemini /dev:architect design payment service
    /multimodel:delegate /dev:research rate limiting patterns
    /multimodel:delegate --no-preflight grok /dev:dev add user profile page

  Model defaults to first entry in .claude/multimodel-team.json defaultModels.
  Trigger: "delegate to grok", "run with gemini", "have grok implement", "use external model"
allowed-tools: Read, Write, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, AskUserQuestion
model: opus
skills: multimodel:task-external-models, multimodel:claudish-usage, multimodel:delegate-patterns
args:
  - name: task
    description: Model ID (optional), optional /plugin:command, and task description
    required: true
  - name: --no-preflight
    description: Skip pre-flight question gathering (useful when task description is self-contained)
    required: false
---
```

**Note on `args`**: The command uses a single `task` arg capturing everything after the command name; parsing into model, optional command, and task description happens in Phase 1.

---

## `delegate-patterns` Skill Outline

**File**: `plugins/multimodel/skills/delegate-patterns/SKILL.md`

**Front-matter**:
```yaml
---
name: delegate-patterns
version: 1.0.0
description: |
  Patterns for delegating plugin commands and tasks to external models via claudish.
  Covers capability discovery (reading installed plugin manifests to find best-fit skills,
  agents, and commands), pre-flight question gathering (predicting and batch-asking
  interactive questions before non-interactive claudish execution), and prompt assembly
  (combining capability context + pre-answered questions + task into a single --stdin prompt).
  Use when implementing cross-model command delegation, when a command needs to route tasks
  to external models, or when designing headless claudish workflows.
tags: [delegate, capability-discovery, preflight, claudish, external-model, prompt-assembly]
keywords: [delegate, capability discovery, preflight questions, command delegation, claudish stdin]
plugin: multimodel
updated: 2026-03-22
---
```

**Skill sections**:

1. **Pattern 1: Capability Discovery via Subagent** — How to launch a `dev:researcher` subagent to scan enabled plugin manifests, extract skill/agent/command descriptions, and return a structured recommendation without polluting main context.

2. **Pattern 2: Pre-Flight Question Gathering** — How to detect if a command uses `AskUserQuestion` (check `allowed-tools` front-matter), predict which questions apply to the specific task (skip inferable ones), and batch all into a single `AskUserQuestion` call.

3. **Pattern 3: Prompt Assembly for `--stdin`** — How to assemble the final claudish prompt: preflight preamble + capability context + DO NOT re-ask instruction + task/command. File-based approach to avoid shell quoting issues.

4. **Pattern 4: Result Verification** — Standard exit code + output size + stderr check. Always report failures with exact stderr, never auto-retry.

5. **Pattern 5: Session Directory Convention** — Delegate sessions go in `ai-docs/sessions/delegate-{slug}-{timestamp}-{rand}/` matching the `/team` convention.

---

## Integration with Existing `/team` Patterns

| Concern | `/team` | `/delegate` |
|---------|---------|-------------|
| Session dir | `team-{slug}-{timestamp}-{rand}` | `delegate-{slug}-{timestamp}-{rand}` |
| Model preferences | `.claude/multimodel-team.json` | Same file, same schema |
| Model resolution | `--models` > contextPreferences > defaultModels > ask | explicit arg > `defaultModels[0]` > ask |
| claudeFlags passthrough | Yes, from preferences | Yes, same field |
| Model alias table | Short aliases resolved | Same table |
| claudish invocation | `--debug --stdin --quiet` | `--stdin --quiet` (no debug needed) |
| Multiple models | Parallel (all models vote) | Single model (delegation, not voting) |
| Output location | `{SESSION_DIR}/{model-slug}-result.md` | `{SESSION_DIR}/result.md` |

**Reused infrastructure**:
- `.claude/multimodel-team.json` — no schema changes, no new fields
- Model alias resolution table (from `/team` `<model_aliases>` block)
- Session directory pattern (from `session-isolation` skill)
- Claudish error reporting rules (Rule 6: no auto-recovery)

**Not reused**:
- The vote prompt template (delegation is not voting)
- The parallel multi-model launch pattern (single model only)
- The monitor script (no concurrent subshells needed)
- `claudeFlags` from the preferences still applies to the single claudish call

---

## Error Handling

| Error | Detection | Response |
|-------|-----------|----------|
| claudish not installed | `which claudish` returns NOT_FOUND | Print install instructions (`npm install -g claudish`), stop |
| No model provided and no default | preferences file missing or empty `defaultModels` | `AskUserQuestion` for model selection |
| Invalid model | claudish exits non-zero | Read stderr, report exact error, stop — do NOT retry or substitute |
| Session dir creation fails | `mkdir` exits non-zero | Warn, fall back to `ai-docs/delegate-{slug}-{timestamp}.md` (flat file) |
| Capability discovery subagent fails | Task fails or `capability-discovery.md` not written | Warn and skip to Phase 3/4 using task description directly |
| Empty capability discovery output | `capability-discovery.md` < 50 bytes | Treat as "no recommendations", proceed with raw task |
| Result file missing or too small | `result.md` < 100 bytes after execution | Report failure with stderr contents |
| Claudish rate limit / API error | Non-zero exit + specific stderr patterns | Report verbatim error text from stderr, do not diagnose or suggest fixes |

**Hard rule**: Never auto-retry, never auto-substitute a different model, never silently skip to a fallback model. These rules mirror `/team` Rule 6.

---

## Implementation Phases

### Phase A — Core Delegation (MVP)
Deliver the basic working command that handles:
- Explicit slash command + model + task (no capability discovery)
- `--no-preflight` mode
- Session directory creation
- Claudish execution + result display
- Error handling for all failure modes

Files:
- `plugins/multimodel/commands/delegate.md` (Phases 1, 3-skip, 4 only)
- `plugins/multimodel/plugin.json` — add `delegate.md` to commands array

### Phase B — Capability Discovery
Add the Phase 2 subagent and make it the default path when no slash command is given:
- `dev:researcher` subagent with capability discovery prompt
- Reads plugin manifests from `.claude/settings.json` enabled list
- Writes `capability-discovery.md`

### Phase C — Pre-Flight Questions
Add Phase 3 question gathering:
- Front-matter inspection for `AskUserQuestion`
- Plan-mode question prediction
- Batch `AskUserQuestion` call
- `preflight-answers.md` integration into prompt assembly

### Phase D — Companion Skill
Write `plugins/multimodel/skills/delegate-patterns/SKILL.md` with all 5 patterns documented.

---

## Testing Strategy

### Manual Smoke Tests (Phase A)
1. `delegate grok /dev:research what is rate limiting` — explicit command, model alias
2. `delegate gemini-pro /dev:research auth patterns` — full model ID
3. `delegate /dev:research patterns` — no model (should prompt or use default)
4. `delegate badmodel /dev:research x` — bad model ID (should report claudish error)
5. `delegate grok implement auth` — no explicit command (Phase B feature — should work after Phase B)

### Verification Checklist
- Session directory created at `ai-docs/sessions/delegate-*`
- `task.md` contains original task
- `prompt.md` contains assembled prompt
- `result.md` is non-empty and contains substantive output
- `stderr.log` is empty or info-only
- `result.exit` contains `0`
- Main context does NOT contain the full claudish output (only summary + path)

### Edge Cases
- Task description with quotes and special characters (use file-based `--stdin`, not shell interpolation)
- Very long task descriptions (slug truncation at 24 chars, full text in `task.md`)
- Missing `.claude/multimodel-team.json` (graceful degradation to `AskUserQuestion`)
- Plugin with no skills or commands (capability discovery returns "none")
- `AskUserQuestion` in allowed-tools but no questions apply to this specific task (skip gracefully)

---

## Key Architectural Decisions

### Decision 1: Capability discovery runs in a subagent, not inline

**Rationale**: Reading 80+ SKILL.md files inline would inject thousands of tokens into the main context, persisting for the entire conversation. A `dev:researcher` subagent runs in isolation; only the 200-line `capability-discovery.md` summary comes back. This follows the guidance in `claudish-usage/SKILL.md`: "NEVER run Claudish from Main Context" extended to "never do large-scale file scanning from main context either."

**Trade-off**: Adds latency (subagent launch + execution). Acceptable because the subagent runs in parallel-capable infrastructure and the result quality improvement justifies it.

### Decision 2: claudish runs in the project's working directory (no command file reconstruction)

**Rationale**: As noted in the design brief, claudish loads Claude Code in the same directory with all plugins active. There is no need to read command `.md` files, strip front-matter, or substitute `$ARGUMENTS` manually. The external model receives a plain-English prompt and can invoke `/plugin:command` directly just like the user would. This eliminates the most complex 30% of the original research report design.

**Trade-off**: The external model may interpret command invocation differently than Claude would in the main context. Mitigated by capability discovery providing explicit guidance on which command to run.

### Decision 3: Single model, no voting

**Rationale**: `/delegate` is about using a specific model's strengths for a specific task (e.g., "Grok is faster for implementation, use it"). It is not about consensus. Adding voting would duplicate `/team` and confuse the UX. The two commands are complementary: `/delegate` for intentional single-model routing, `/team` for consensus evaluation.

### Decision 4: Reuse `.claude/multimodel-team.json` without schema changes

**Rationale**: Using `defaultModels[0]` as the delegate default is the simplest integration. Users who have already configured `/team` get delegate working immediately. A new `defaultDelegateModel` field would require migration and documentation without meaningful benefit.

### Decision 5: `--no-preflight` as a first-class flag

**Rationale**: Most tasks with explicit commands and self-contained descriptions don't need pre-flight. Making skip the default would break interactive commands; making it always-on would add noise. The flag gives users explicit control and is the right default behavior for experienced users writing automation.

---

## Open Questions / Assumptions

1. **Capability discovery for installed plugins**: The subagent reads plugin files from two potential locations — `plugins/{name}/plugin.json` (local dev) and `~/.claude/plugins/cache/...` (installed). The subagent prompt should check both. The exact cache path structure may need verification during implementation.

2. **Claudish `--stdin` with a complex working directory prompt**: The assembled prompt includes `/plugin:command` as literal text. Claudish passes this as the first user message to Claude Code, which interprets it as a slash command. This is the intended behavior but should be verified in smoke tests.

3. **Phase 3 question prediction accuracy**: Using plan-mode reasoning to predict questions from a command file is heuristic. The catch-all question ("what additional context should the model know?") serves as a safety net for any missed questions.

4. **Result display strategy for large outputs**: `result.md` may be very large for implementation tasks. The command should display a summary (first 50 lines) and note the full path, rather than dumping thousands of lines into the chat.
