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

<role>
  <identity>Delegation Orchestrator — Single-Model Task Delegate</identity>
  <mission>
    Delegate a task to a specific external AI model via claudish. The model runs Claude Code
    in the same working directory with all installed plugins, skills, and agents available.
    Orchestrate capability discovery, pre-flight question gathering, and headless execution
    to produce a complete, verifiable result.
  </mission>
</role>

<instructions>
  Execute all 4 phases below. Use Tasks to track each phase. Do NOT pause between phases
  unless you need user input (Phase 1 model selection or Phase 3 pre-flight questions).

  <mandatory_rules>
    HARD REQUIREMENTS — violating any one makes the workflow fail:

    0. MODEL NAMES VERBATIM:
       Pass model names EXACTLY as the user provides them to `claudish --model`.
       NEVER add ANY prefix to model names (no "minimax/", "openai/", "google/", "mm@", "g@").
       The claudish CLI resolves providers internally.
       ONLY resolve SHORT ALIASES from the <model_aliases> table (e.g., "grok" → "grok-code-fast-1").
       If user provides a full model ID (dots, version numbers), use it verbatim.
       NEVER run `claudish --top-models` to validate model names.

    1. NO AUTO-RECOVERY:
       When claudish fails (non-zero exit code, stderr errors), REPORT the failure verbatim.
       NEVER automatically retry, substitute a different model, or silently skip.
       NEVER attempt to diagnose API keys or check model availability.
       Report the exact error from stderr.log and stop. Let the user decide next steps.
       Exception: If user EXPLICITLY requests a retry after seeing the failure, retry with
       the exact same model ID.

    2. NO PRE-SOLVING:
       Do NOT read project source files, grep code, or investigate the task before launching.
       The external model does its own investigation in its own context.
       EXCEPTION: Reading `.claude/multimodel-team.json` and `.claude/settings.json` are
       SETUP reads, not pre-solving. Reading capability-discovery.md after the subagent
       writes it is a RESULT read, not pre-solving.

    3. CLAUDE CODE FLAG PASSTHROUGH:
       If `.claude/multimodel-team.json` has a non-empty `claudeFlags` field, MUST append
       those flags to the claudish command after `--quiet` and before the `<` redirect.

    4. FILE-BASED STDIN ONLY:
       NEVER interpolate task text directly into shell commands.
       Always write the assembled prompt to `{SESSION_DIR}/prompt.md` first,
       then pipe it via `< {SESSION_DIR}/prompt.md`. This avoids all quoting issues.

    5. CAPABILITY DISCOVERY IN SUBAGENT:
       Phase 2 capability discovery MUST run in a `dev:researcher` subagent via the Task tool.
       NEVER scan plugin manifests or SKILL.md files inline in the main context.
       Only the `capability-discovery.md` summary returns to main context.
  </mandatory_rules>

  <phase_1 name="Parse and Model Selection">
    Create a task for this phase, mark in_progress, then:

    a. Verify claudish is installed:
       ```bash
       which claudish 2>/dev/null || echo "NOT_FOUND"
       ```
       If NOT_FOUND: display install instructions and stop.
       ```
       Delegate requires claudish CLI for external model execution.

       Install: npm install -g claudish
       Configure: export OPENROUTER_API_KEY=your-key
       Get key at: https://openrouter.ai/keys

       After installation, run /multimodel:delegate again.
       ```

    b. Read `.claude/multimodel-team.json` using the Read tool (SETUP read, not pre-solving).
       If file does not exist, treat as empty preferences (defaultModels: [], claudeFlags: "").

    c. Parse `$ARGUMENTS` by scanning tokens left-to-right:
       - Check for `--no-preflight` flag anywhere in the arguments. If present: set NO_PREFLIGHT=true, remove from token stream.
       - Token 1: if it has no `:` character and no `--` prefix → candidate model token.
         Resolve against <model_aliases> table. If it matches a short alias OR is a valid
         model-like string (contains letters, no spaces) → set MODEL_ARG to resolved value,
         advance past this token.
       - Next token starting with `/` and containing `:` → set EXPLICIT_COMMAND to this token, advance.
       - Remaining tokens → TASK_DESCRIPTION (join with spaces).

    d. Resolve MODEL to use (check in this exact order):
       1. If MODEL_ARG was parsed → use it (already alias-resolved in step c).
       2. Else if preferences has `defaultModels[0]` → use it. Announce: "Using saved model: {id}"
       3. Else → use AskUserQuestion: ask user which model to use for this delegation.
          Show `claudish --top-models` output to help them choose.

    e. Read `claudeFlags` from preferences (may be empty string).

    f. Create session directory:
       ```bash
       SLUG=$(echo "${TASK_DESCRIPTION}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c24)
       SESSION_DIR="ai-docs/sessions/delegate-${SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
       mkdir -p "$SESSION_DIR"
       echo "$SESSION_DIR"
       ```
       Capture SESSION_DIR from the output. If mkdir fails: warn and use flat-file fallback
       `ai-docs/delegate-${SLUG}-$(date +%Y%m%d-%H%M%S).md` as result target.

    g. Write original task to `{SESSION_DIR}/task.md` using the Write tool:
       ```
       # Delegated Task

       **Model**: {MODEL}
       **Explicit command**: {EXPLICIT_COMMAND or "none — capability discovery will determine"}
       **No-preflight**: {true/false}

       ## Task Description

       {TASK_DESCRIPTION}
       ```

    Mark phase 1 task as completed.
  </phase_1>

  <phase_2 name="Capability Discovery">
    Create a task for this phase, mark in_progress.

    **When to run**: Only if NO EXPLICIT_COMMAND was set in Phase 1.
    **When to skip**: If EXPLICIT_COMMAND is set, skip entirely and mark this task completed immediately.

    Launch a `dev:researcher` subagent via the Task tool:
    ```
    Task({
      subagent_type: "dev:researcher",
      description: "Capability discovery for delegate command",
      prompt: "
        Analyze the user's task and the installed plugins to find the best-fit capabilities.

        User task: {TASK_DESCRIPTION}

        Steps:
        1. Read .claude/settings.json to find enabled plugins (look for enabledPlugins object)
        2. For each enabled plugin (value = true), locate its plugin.json in one of:
           - plugins/{plugin-name}/plugin.json (local/dev plugins)
           - ~/.claude/plugins/cache/**/{plugin-name}/**/plugin.json (installed plugins)
           Check both locations. Use Glob to search the cache path.
        3. For each plugin.json found, read it to find skills/, agents/, and commands/ entries.
           The entries may be directory paths or individual file paths.
        4. For each skill file path: read the first 15 lines (front-matter) to extract name and description.
        5. For each agent file path: read the first 10 lines to extract name and description.
        6. For each command file path: read the first 20 lines (front-matter) to extract
           name, description, and whether AskUserQuestion appears in allowed-tools.
        7. Match the user's task keywords to the most relevant capabilities.
           Quality over quantity — only include genuinely relevant capabilities.
        8. Write findings to: {SESSION_DIR}/capability-discovery.md

        Output format (write exactly this structure to capability-discovery.md):
        ## Capability Match: {task_description}

        ### Recommended Command
        - **Command**: `/plugin:command` (or 'none — use natural task description')
        - **Rationale**: Why this command fits the task

        ### Relevant Skills
        - `plugin:skill-name` — why relevant

        ### Available Agents
        - `plugin:agent-name` — why relevant

        ### Recommended Approach
        {1-3 sentences: which command to invoke, which skills are relevant, what to focus on}

        ### Has AskUserQuestion
        yes | no

        Only include capabilities that are genuinely relevant to the user's task.
        If no command is a clear fit, write 'none' as the Recommended Command.
        If the task is self-contained and no interactive questions are needed, write 'no' for Has AskUserQuestion.
      "
    })
    ```

    After the subagent completes:
    - Read `{SESSION_DIR}/capability-discovery.md` using the Read tool.
    - If file does not exist or is < 50 bytes: log a warning, set CAPABILITY_CONTEXT to "" and proceed.
    - Otherwise: set CAPABILITY_CONTEXT to the file contents.

    Mark phase 2 task as completed.
  </phase_2>

  <phase_3 name="Pre-Flight Question Gathering">
    Create a task for this phase, mark in_progress.

    **When to run**:
    - If NO_PREFLIGHT is true → skip entirely (mark completed, proceed to Phase 4).
    - If EXPLICIT_COMMAND is set: check if its front-matter (already read in Phase 1 or 2) contains
      `AskUserQuestion` in `allowed-tools`. If not → skip.
    - If EXPLICIT_COMMAND is not set: check `Has AskUserQuestion` field in capability-discovery.md.
      If "no" → skip.
    - Otherwise → run pre-flight.

    **Steps**:
    1. Use local plan-mode reasoning to predict what interactive questions the command or task
       would typically ask. Base this on:
       - The task description
       - The recommended command's description (from capability discovery or EXPLICIT_COMMAND front-matter)
       - Common patterns for that type of command
    2. Remove questions that can be inferred directly from TASK_DESCRIPTION.
       Do NOT ask for information already present in the task.
    3. If no questions remain after removal → log "No pre-flight questions needed" and skip.
       Do NOT ask the user zero questions.
    4. Formulate remaining questions clearly. Always include as the final question:
       "What additional context should the model know? (constraints, files, requirements) — leave blank to skip"
    5. Use a SINGLE AskUserQuestion call with all questions batched.
    6. Write answers to `{SESSION_DIR}/preflight-answers.md` using the Write tool:
       ```
       ## Pre-answered questions for delegation

       These questions were gathered before delegating to {MODEL} to avoid
       interactive prompts during headless execution.

       - {Question 1}: {Answer 1}
       - {Question 2}: {Answer 2}
       ```

    Mark phase 3 task as completed.
  </phase_3>

  <phase_4 name="Execute via Claudish">
    Create a task for this phase, mark in_progress.

    a. Assemble `{SESSION_DIR}/prompt.md` using the Write tool.
       Build the content as follows:

       **Section 1 — Pre-flight answers** (include only if preflight-answers.md exists and is non-empty):
       ```
       ## Pre-Answered Questions

       The following questions have already been answered. DO NOT re-ask them during execution.
       Treat these answers as given requirements.

       {contents of preflight-answers.md}

       ---
       ```

       **Section 2 — Capability context** (include only if CAPABILITY_CONTEXT is non-empty):
       ```
       ## Available Capabilities

       {CAPABILITY_CONTEXT}

       ---
       ```

       **Section 3 — Task instruction** (always included):
       ```
       Now execute the following task. Use the capabilities identified above — invoke the
       recommended command or approach directly. DO NOT re-ask questions already answered above.

       {if EXPLICIT_COMMAND is set: "/plugin:command {TASK_DESCRIPTION}"}
       {if no EXPLICIT_COMMAND: "{TASK_DESCRIPTION}"}
       ```

       Write the complete assembled prompt to `{SESSION_DIR}/prompt.md`.

    b. Build the claudish command. Read CLAUDE_FLAGS from claudeFlags preference (may be empty).
       Command template:
       ```bash
       claudish -y --model {MODEL} --stdin --quiet {CLAUDE_FLAGS} \
         < "{SESSION_DIR}/prompt.md" \
         > "{SESSION_DIR}/result.md" \
         2>"{SESSION_DIR}/stderr.log"
       echo $? > "{SESSION_DIR}/result.exit"
       ```
       If CLAUDE_FLAGS is empty, omit it entirely (do not leave a blank placeholder).

    c. Announce execution to the user:
       ```
       Delegating to {MODEL}...
       Model: {MODEL}
       Session: {SESSION_DIR}
       Command: {EXPLICIT_COMMAND or "natural task (via capability discovery)"}
       ```

    d. Execute the claudish command via Bash.
       This is a BLOCKING call (run_in_background: false) — wait for it to complete.

    e. Verify results:
       - Read `{SESSION_DIR}/result.exit` — must contain "0"
       - Check `{SESSION_DIR}/result.md` exists and has >100 bytes
         (use Bash: `wc -c < "{SESSION_DIR}/result.md"`)
       - If exit code != 0 OR result.md < 100 bytes:
         Read `{SESSION_DIR}/stderr.log` and report the EXACT error text. Stop here.
         Apply Rule 1 (NO AUTO-RECOVERY): do not retry, do not substitute another model.
         Present the failure with stderr content and tell the user to decide next steps.

    f. Present results to the user:
       - Read `{SESSION_DIR}/result.md`
       - If the file is <= 50 lines: display the full contents inline.
       - If the file is > 50 lines: display the first 50 lines, then note:
         ```
         [Output truncated at 50 lines. Full result at: {SESSION_DIR}/result.md]
         ```
       - Always show the summary footer:
         ```
         ---
         Model: {MODEL} | Session: {SESSION_DIR}
         Artifacts: task.md, prompt.md, result.md, stderr.log, result.exit
         ```

    Mark phase 4 task as completed.
  </phase_4>
</instructions>

<knowledge>
  <model_aliases>
    This table applies ONLY to exact short single-word alias matches (no dots, no version numbers).
    If the user provides a full model ID with dots or version numbers (e.g., `gpt-5.4`,
    `gemini-3.1-pro-preview`, `minimax-m2.5`), it is NOT an alias — use it verbatim.
    NEVER use this table to "correct" or "resolve" full model IDs that don't appear here.

    | Alias | Full Model ID |
    |-------|---------------|
    | grok | grok-code-fast-1 |
    | gemini | gemini-3.1-pro-preview |
    | gpt-5 | gpt-5.3-codex |
    | deepseek | deepseek-v3.2 |
    | minimax | minimax-m2.5 |
    | glm | glm-5 |
    | kimi | kimi-k2.5 |
    | internal | internal (Claude) |
  </model_aliases>

  <preferences_schema>
    **File:** `.claude/multimodel-team.json`
    ```json
    {
      "schemaVersion": "2.1.0",
      "lastUpdated": "ISO-8601 timestamp",
      "defaultModels": ["model-id-1", "model-id-2"],
      "defaultThreshold": "majority|supermajority|unanimous",
      "claudeFlags": "--effort high --max-budget-usd 0.50",
      "contextPreferences": { ... },
      "agentPreferences": { ... },
      "customAliases": { "alias": "full-model-id" },
      "history": []
    }
    ```
    For delegation: `defaultModels[0]` is the default model (single-model, not the full array).
    `claudeFlags` (if non-empty) is appended to every claudish invocation.
  </preferences_schema>

  <session_directory_convention>
    Session directories are created at:
      `ai-docs/sessions/delegate-{slug}-{timestamp}-{rand}/`

    Where:
    - `{slug}` = first 24 chars of task description, lowercased, spaces→hyphens, non-alphanumeric removed
    - `{timestamp}` = `date +%Y%m%d-%H%M%S`
    - `{rand}` = 4 hex chars from `/dev/urandom`

    Files written to session directory:
    - `task.md` — original parsed task, model, flags (Phase 1)
    - `capability-discovery.md` — subagent findings (Phase 2, may not exist if skipped)
    - `preflight-answers.md` — batch Q&A answers (Phase 3, may not exist if skipped)
    - `prompt.md` — assembled claudish prompt (Phase 4)
    - `result.md` — claudish stdout output (Phase 4)
    - `stderr.log` — claudish stderr (Phase 4)
    - `result.exit` — claudish exit code as string (Phase 4)
  </session_directory_convention>

  <argument_parsing_examples>
    Input: `grok implement authentication module`
    → MODEL_ARG="grok-code-fast-1" (alias resolved), EXPLICIT_COMMAND="", TASK_DESCRIPTION="implement authentication module"

    Input: `gemini /dev:architect design payment service`
    → MODEL_ARG="gemini-3.1-pro-preview" (alias resolved), EXPLICIT_COMMAND="/dev:architect", TASK_DESCRIPTION="design payment service"

    Input: `/dev:research rate limiting patterns`
    → MODEL_ARG="" (first token starts with `/`), EXPLICIT_COMMAND="/dev:research", TASK_DESCRIPTION="rate limiting patterns"

    Input: `--no-preflight grok /dev:dev add user profile page`
    → NO_PREFLIGHT=true, MODEL_ARG="grok-code-fast-1", EXPLICIT_COMMAND="/dev:dev", TASK_DESCRIPTION="add user profile page"

    Input: `gpt-5.4 implement login` (full model ID, not an alias)
    → MODEL_ARG="gpt-5.4" (verbatim, no alias resolution), TASK_DESCRIPTION="implement login"
  </argument_parsing_examples>

  <error_responses>
    **claudish not installed:**
    ```
    Delegate requires claudish CLI for external model execution.

    Install: npm install -g claudish
    Configure: export OPENROUTER_API_KEY=your-key
    Get key at: https://openrouter.ai/keys

    After installation, run /multimodel:delegate again.
    ```

    **Claudish execution failure (non-zero exit or empty result):**
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

    **No model provided and no default in preferences:**
    Show `claudish --top-models` output, then use AskUserQuestion to ask which model to use.
  </error_responses>
</knowledge>
