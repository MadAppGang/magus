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
user-invocable: false
---

# Delegate Patterns

Patterns for the `/multimodel:delegate` command and any future delegation workflows
that route tasks to external models via claudish headless execution.

---

## Pattern 1: Capability Discovery via Subagent

**Problem**: When a user provides a natural language task (no explicit `/plugin:command`),
the external model needs to know what tools, skills, and commands are available so it can
choose the right approach. Scanning 80+ SKILL.md files inline would inject thousands of tokens
into the main context, persisting for the entire conversation.

**Solution**: Launch a `dev:researcher` subagent to scan enabled plugin manifests, extract
capability descriptions, and write a structured summary to a session file. Only the summary
comes back to the main context.

**Implementation**:

```
Task({
  subagent_type: "dev:researcher",
  description: "Capability discovery for delegate command",
  prompt: "
    Analyze the user's task and find the best-fit capabilities from installed plugins.

    User task: {TASK_DESCRIPTION}

    Steps:
    1. Read .claude/settings.json — find enabledPlugins (object with boolean values)
    2. For each enabled plugin (value = true), find plugin.json in:
       - plugins/{plugin-name}/plugin.json (local/dev)
       - ~/.claude/plugins/cache/**/{plugin-name}/**/plugin.json (installed)
    3. From each plugin.json, find skills/, agents/, commands/ entries
    4. For each skill: read first 15 lines (front-matter) for name + description
    5. For each agent: read first 10 lines for name + description
    6. For each command: read first 20 lines for name, description, allowed-tools
    7. Match task keywords to most relevant capabilities
    8. Write to: {SESSION_DIR}/capability-discovery.md

    Output structure:
    ## Capability Match: {task}
    ### Recommended Command
    - **Command**: `/plugin:command` (or 'none')
    - **Rationale**: Why this fits
    ### Relevant Skills
    - `plugin:name` — why relevant
    ### Available Agents
    - `plugin:name` — why relevant
    ### Recommended Approach
    {1-3 sentences on best execution path}
    ### Has AskUserQuestion
    yes | no
  "
})
```

**After the subagent completes**:
- Read `{SESSION_DIR}/capability-discovery.md` using the Read tool
- If file < 50 bytes or missing: treat as "no recommendations", proceed with raw task
- Otherwise: include contents in the assembled prompt (Pattern 3)

**Key rule**: The subagent runs in an isolated context window. Only `capability-discovery.md`
returns to the main context. Never scan SKILL.md files inline in the main context.

**When to skip**: If the user explicitly provides a `/plugin:command` in their invocation,
skip capability discovery entirely. The user already knows what they want.

---

## Pattern 2: Pre-Flight Question Gathering

**Problem**: Claudish runs Claude Code headlessly (non-interactive). If the delegated command
or task would normally call `AskUserQuestion`, it cannot — there is no user to answer.
This blocks execution or produces low-quality results due to missing context.

**Solution**: Before launching claudish, predict which questions the command would ask,
batch them into a single `AskUserQuestion` call in the main context, and inject the answers
into the prompt so the external model never needs to ask.

**When to run**:
- The recommended command (from capability discovery) lists `AskUserQuestion` in `allowed-tools`
  AND the capability-discovery.md `Has AskUserQuestion` field is "yes"
- OR an explicit command was provided and its front-matter contains `AskUserQuestion`
- AND `--no-preflight` flag was NOT passed

**How to predict questions**:
1. Read the command or task description to understand what inputs it typically needs
2. Compare against the task description — remove any question that is already answered
3. Skip questions inferable from the task (e.g., task says "auth module in Go" → language is Go)
4. If no unanswerable questions remain: skip pre-flight entirely (do NOT ask zero questions)

**Batching all questions into one call**:

```
AskUserQuestion({
  questions: [
    "{Question 1 about task-specific configuration}",
    "{Question 2 about constraints or requirements}",
    "What additional context should the model know? (constraints, files, requirements) — leave blank to skip"
  ]
})
```

Always include the catch-all as the last question. It is the safety net for anything missed.

**Writing the output**:

```markdown
## Pre-answered questions for delegation

These questions were gathered before delegating to {MODEL} to avoid
interactive prompts during headless execution.

- {Question 1}: {Answer 1}
- {Question 2}: {Answer 2}
```

Write this to `{SESSION_DIR}/preflight-answers.md`.

**Key rule**: Never ask zero questions. If no questions are predicted, skip pre-flight
entirely rather than presenting an empty or trivial form.

---

## Pattern 3: Prompt Assembly for `--stdin`

**Problem**: Claudish reads the entire prompt from stdin via `< prompt.md`. The assembled
prompt must combine pre-answered questions, capability context, and the task instruction
into a single coherent file. Shell interpolation of multi-line text into bash commands
causes quoting failures and truncation.

**Solution**: Always write the assembled prompt to `{SESSION_DIR}/prompt.md` using the
Write tool first, then pipe it via `< {SESSION_DIR}/prompt.md`. Never interpolate task text
directly into a bash command string.

**Prompt structure**:

```markdown
{IF preflight-answers.md exists and is non-empty:}
## Pre-Answered Questions

The following questions have already been answered. DO NOT re-ask them during execution.
Treat these answers as given requirements.

{contents of preflight-answers.md}

---
{END IF}

{IF capability-discovery.md exists and is non-empty:}
## Available Capabilities

{contents of capability-discovery.md}

---
{END IF}

Now execute the following task. Use the capabilities identified above — invoke the
recommended command or approach directly. DO NOT re-ask questions already answered above.

{if explicit command: "/plugin:command {task_args}"}
{if no explicit command: "{raw task description}"}
```

**Building the claudish command**:

```bash
# {CLAUDE_FLAGS} from claudeFlags in .claude/multimodel-team.json (may be empty)
claudish -y --model {MODEL_ID} --stdin --quiet {CLAUDE_FLAGS} \
  < "{SESSION_DIR}/prompt.md" \
  > "{SESSION_DIR}/result.md" \
  2>"{SESSION_DIR}/stderr.log"
echo $? > "{SESSION_DIR}/result.exit"
```

If `CLAUDE_FLAGS` is empty, omit it entirely. Do not leave blank placeholders in the command.

**Key rules**:
- Always quote session directory paths in the shell command (spaces in path would break it)
- Use `-y` (auto-approve) because claudish runs headless — no user to approve tool calls
- Capture both stdout and stderr to separate files for verification and debugging
- Always capture the exit code to `result.exit`

---

## Pattern 4: Result Verification

**Problem**: Claudish can exit 0 but produce empty or minimal output if the model had nothing
to say, or exit non-zero with a meaningful error in stderr. Both cases look like "done"
without proper verification.

**Solution**: Always perform a three-check verification sequence after claudish completes.

**Verification steps**:

```
1. Read {SESSION_DIR}/result.exit
   → Expected value: "0"
   → If non-zero: FAIL — go to failure handler

2. Check output size:
   Bash: wc -c < "{SESSION_DIR}/result.md"
   → Expected: > 100 bytes
   → If < 100 bytes: FAIL — go to failure handler

3. (Optional) Spot-check result.md for substantive content
   → Not a blank response or just "Done."
```

**On success**: display results using the truncation rule:
- If result.md <= 50 lines: display inline
- If result.md > 50 lines: display first 50 lines + path note:
  `[Output truncated at 50 lines. Full result at: {SESSION_DIR}/result.md]`

**Failure handler** (hard rule: NO AUTO-RECOVERY):

```
Delegation failed.

Model: {MODEL}
Exit code: {exit_code}
Output size: {bytes} bytes

Stderr:
{exact content of stderr.log, first 20 lines}

Session artifacts preserved at: {SESSION_DIR}
(prompt.md, stderr.log, result.exit available for inspection)

To proceed: fix the model ID, check OPENROUTER_API_KEY, or choose a different model.
```

Report the failure verbatim. NEVER retry automatically. NEVER substitute a different model.
NEVER diagnose API keys or suggest fixes beyond presenting the raw stderr.

If the user explicitly requests a retry after seeing the failure, they may retry with
the same model ID.

---

## Pattern 5: Session Directory Convention

**Purpose**: Delegate sessions store all artifacts in a predictable, inspectable location
matching the `/team` command convention. This enables debugging, result comparison, and
historical reference.

**Directory path**:
```
ai-docs/sessions/delegate-{slug}-{timestamp}-{rand}/
```

**Construction**:
```bash
SLUG=$(echo "${TASK_DESCRIPTION}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c24)
SESSION_DIR="ai-docs/sessions/delegate-${SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
mkdir -p "$SESSION_DIR"
```

**Artifacts written per phase**:

| Phase | File | Written by | Always present |
|-------|------|-----------|----------------|
| 1 | `task.md` | Main context (Write tool) | Yes |
| 2 | `capability-discovery.md` | dev:researcher subagent | No (skipped if explicit command) |
| 3 | `preflight-answers.md` | Main context (Write tool) | No (skipped if --no-preflight or no questions) |
| 4 | `prompt.md` | Main context (Write tool) | Yes |
| 4 | `result.md` | claudish stdout | Yes (may be empty on failure) |
| 4 | `stderr.log` | claudish stderr | Yes (may be empty on success) |
| 4 | `result.exit` | Bash echo | Yes |

**Fallback**: If `ai-docs/sessions/` directory creation fails (permissions, missing parent),
fall back to a flat file at `ai-docs/delegate-{slug}-{timestamp}.md` as the result target.
Warn the user that session isolation is unavailable.

**Comparison with `/team` convention**:

| Field | `/team` | `/delegate` |
|-------|---------|-------------|
| Prefix | `team-` | `delegate-` |
| Slug length | 20 chars | 24 chars |
| Result file | `{model-slug}-result.md` | `result.md` |
| Multiple results | Yes (one per model) | No (single model) |
| Monitor artifacts | Yes | No |
