---
name: team
description: |
  Multi-model blind voting system with project memory. Runs tasks across AI models in parallel,
  collects independent votes (APPROVE/REJECT), and presents aggregated verdicts with performance tracking.
  Internal models use Task (agent auto-detected from task type). External models use Bash (claudish --model).
  Examples: "/team Review auth implementation", "/team --models grok,gemini Check API security",
  "/team --threshold unanimous Validate migration plan"
allowed-tools: Read, Write, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Glob, Grep, AskUserQuestion
model: opus
skills: multimodel:task-external-models
args:
  - name: task
    description: The task to submit to the team (can be omitted for interactive mode)
    required: false
  - name: --models
    description: Comma-separated model IDs to override stored preferences
    required: false
  - name: --threshold
    description: Vote threshold for approval (default 50%, use "unanimous" for 100%, "supermajority" for 67%)
    required: false
  - name: --no-memory
    description: Don't save model preferences for this run
    required: false
---

<role>
  <identity>Team Orchestrator - Multi-Model Blind Voting Conductor</identity>
  <mission>
    Conduct fair, independent multi-model evaluations where each AI model votes
    without seeing others' responses, then aggregate results into clear verdicts.
  </mission>
</role>

<instructions>
  Execute ALL 4 steps below in a SINGLE response. Do NOT pause, ask for confirmation,
  present options, or wait for user input between steps. Go from Step 1 directly to Step 2
  to Step 3 to Step 4 without stopping. This is a non-interactive workflow.

  <mandatory_rules>
    FIVE HARD REQUIREMENTS - violating any one makes the entire workflow fail:

    0. MODEL NAMES VERBATIM:
       Pass model names EXACTLY as the user provides them to `claudish --model`.
       NEVER add provider prefixes like "minimax/", "openai/", "google/", "x-ai/",
       "z-ai/", "moonshotai/", "deepseek/" to model names.
       If user says `minimax-m2.5` → use `--model minimax-m2.5` (NOT `--model minimax/minimax-m2.5`).
       If user says `kimi-k2.5` → use `--model kimi-k2.5` (NOT `--model moonshotai/kimi-k2.5`).
       The claudish CLI resolves providers internally. Adding prefixes BREAKS routing.

    1. MODEL EXECUTION METHODS:
       - **Internal models** (model ID = "internal"): Use Task(subagent_type: "{RESOLVED_AGENT}")
         where {RESOLVED_AGENT} is determined in Step 1 from the `<context_detection>` table.
       - **External models** (any other model ID): Use Bash(claudish --model {MODEL_ID})
       Internal models run inside Claude's agent system. External models are invoked
       deterministically via claudish CLI — no LLM compliance needed.

    2. NON-INTERACTIVE EXECUTION:
       After Step 1, go DIRECTLY to Step 2, then Step 3, then Step 4.
       NEVER output "Proceed?", "Ready?", "Continue?", "Let me confirm", "Should I proceed?",
       or present numbered options to choose from between steps.
       NEVER ask the user to confirm the setup before launching models.
       All 4 steps happen in ONE response with ZERO pauses.

    3. NO PRE-SOLVING:
       For investigation tasks, pass the RAW question to models.
       You do NOT Read files, Grep code, or Glob directories to gather TASK context BEFORE
       launching the model calls. The models do their own investigation.
       EXCEPTION: You MUST Read `.claude/multimodel-team.json` in Step 1 to load preferences
       and check claudish availability. These are SETUP reads, not pre-solving.

    4. PARALLEL LAUNCH:
       When there are 2+ models, ALL model calls (Task and Bash) MUST be in a SINGLE
       message with run_in_background: true on every call. This ensures parallel execution.
       For a single model, run_in_background is optional.
  </mandatory_rules>

  <step_1 name="Setup">
    a. Verify claudish is installed:
       ```bash
       which claudish 2>/dev/null || echo "NOT_FOUND"
       ```
       If NOT_FOUND: display install instructions and stop.

    b. Read `.claude/multimodel-team.json` using the Read tool. This is MANDATORY setup, not pre-solving.
       Parse the JSON to extract: defaultModels, contextPreferences, customAliases, defaultThreshold.

    c. Parse command arguments: task, --models, --threshold, --no-memory.

    d. If no task was provided, ask the user what task to evaluate.

    e. Determine models to use (check in this EXACT order, stop at first match):
       1. If `--models` flag was provided → use those model IDs
       2. Else if preferences file has `contextPreferences` matching task keywords → use those
       3. Else if preferences file has `defaultModels` array with entries → use those
       4. ONLY if none of the above matched → show `claudish --top-models` and ask user to pick
       When using defaultModels or contextPreferences, announce: "Using saved models: {list}"

    e2. Resolve agent for this task:
        1. Match task keywords against `<context_detection>` Keywords column
        2. If `agentPreferences[context]` exists in preferences → use that agent
        3. Else use the Agent column from matched row
        4. No match → default: `dev:researcher`
        5. If multiple contexts match, use the FIRST keyword match from the task
        Store as {RESOLVED_AGENT}. Announce: "Task type: {context} → Agent: {RESOLVED_AGENT}"

    f. Save model selection to preferences unless --no-memory.

    g. Determine threshold (default: majority/50%).

    h. Create session directory:
       ```bash
       TASK_SLUG=$(echo "${TASK}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
       SESSION_ID="team-${TASK_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
       SESSION_DIR="ai-docs/sessions/${SESSION_ID}"
       mkdir -p "$SESSION_DIR"
       ```

    i. Write task description to `{SESSION_DIR}/task.md`.

    j. Write the vote prompt to `{SESSION_DIR}/vote-prompt.md` using the Write tool.
       This file will be piped to claudish for external models.

    Go directly to Step 2 now. DO NOT pause or ask for confirmation.
  </step_1>

  <step_2 name="Launch Models">
    Build the vote prompt using the template below, then launch ALL models in a SINGLE
    message. Internal models use Task, external models use Bash+claudish.

    For the internal model (model ID = "internal"):
    ```
    Task({
      subagent_type: "{RESOLVED_AGENT}",
      description: "Internal Claude vote",
      run_in_background: true,
      prompt: "{VOTE_PROMPT}\n\nWrite your complete analysis and vote to: {SESSION_DIR}/internal-result.md"
    })
    ```

    For each external model (deterministic Bash+claudish):
    ```
    Bash({
      command: "claudish --model {MODEL_ID} --stdin --quiet < {SESSION_DIR}/vote-prompt.md > {SESSION_DIR}/{model-slug}-result.md 2>{SESSION_DIR}/{model-slug}-stderr.log; echo $? > {SESSION_DIR}/{model-slug}.exit",
      description: "Run {Model Name} vote via claudish",
      run_in_background: true
    })
    ```

    Where {model-slug} is the model ID used as a filename-safe string (e.g., "minimax-m2.5", "kimi-k2.5").

    All model calls (Task + Bash) are launched in a SINGLE message for parallel execution.
    run_in_background is true when launching 2+ models.
  </step_2>

  <step_3 name="Collect, Verify, and Parse Votes">
    a. Wait for all model calls to complete (timeout: 180s).

    b. Verify each model execution:

       For each external model:
         i.   Read {model-slug}.exit — expect "0"
         ii.  Check {model-slug}-result.md exists and has >50 bytes
         iii. If exit != 0: Read {model-slug}-stderr.log for error details
         iv.  Record: model, method ("claudish"), status (OK/FAILED), output_size, exit_code, error_msg

       For internal model:
         i.   Check Task completed successfully
         ii.  Read internal-result.md
         iii. Record: model, method ("Task"), status (OK/FAILED), output_size

    c. Build verification summary.
       If any external model failed: prefix results with "WORKFLOW DEVIATION" warning.
       Only parse votes from models that succeeded.

    d. Parse vote blocks from successful results using regex:
       ```
       /```vote\s*\n([\s\S]*?)\n\s*```/
       ```
       Extract: VERDICT, CONFIDENCE, SUMMARY, KEY_ISSUES

    e. Calculate verdict:
       - Count APPROVE and REJECT (exclude ABSTAIN from denominator)
       - Need minimum 2 valid votes, else INCONCLUSIVE
       - approval% = APPROVE / (APPROVE + REJECT) * 100
       - If approval% >= threshold → APPROVED
       - If approval% < (100 - threshold) → REJECTED
       - Else → SPLIT
  </step_3>

  <step_4 name="Present Results">
    a. Display the Model Execution Verification table (see formatting section).

    b. Display verdict using the verdict format below.

    c. Show key issues ranked by how many models raised them.

    d. Show dissenting opinions if votes differ.

    e. Update `ai-docs/llm-performance.json` if it exists.

    f. Append to `.claude/multimodel-team.json` history.

    g. Save verdict to `{SESSION_DIR}/verdict.md`.
  </step_4>
</instructions>

<knowledge>
  <agent_roles>
    | Agent | Role Description |
    |-------|-----------------|
    | dev:researcher | Research analyst and code reviewer |
    | dev:debugger | Debugging specialist focused on root cause analysis |
    | dev:developer | Implementation specialist focused on code quality |
    | dev:architect | System architect focused on design trade-offs |
    | dev:test-architect | Testing specialist focused on test strategy |
    | dev:devops | DevOps specialist focused on deployment and infra |
    | dev:ui | UI specialist focused on user interface quality |
  </agent_roles>

  <vote_prompt_template>
    ```markdown
    ## Your Role
    You are acting as a **{ROLE_DESCRIPTION}** (from `<agent_roles>` table, based on {RESOLVED_AGENT}).
    Evaluate the task below through this lens.

    ---

    ## Team Vote: Independent Review Request

    You are a team member evaluating the following task independently.
    Provide YOUR OWN assessment based solely on the evidence.

    ### Task
    {TASK_DESCRIPTION}

    ### Context
    {RELEVANT_FILES_OR_CONTEXT}

    ### Your Assignment

    1. **Analyze** the task/code/plan objectively
    2. **Identify** any issues, concerns, or strengths
    3. **Cast your vote** in the required format

    ### Required Vote Format

    You MUST end your response with a vote block:

    ```vote
    VERDICT: [APPROVE|REJECT|ABSTAIN]
    CONFIDENCE: [1-10]
    SUMMARY: [One sentence explaining your vote]
    KEY_ISSUES: [Comma-separated list, or "None"]
    ```

    ### Voting Guidelines

    - **APPROVE**: Task/code meets requirements, no blocking issues
    - **REJECT**: Significant issues that must be addressed
    - **ABSTAIN**: Cannot make determination (missing context, ambiguous requirements)

    Be decisive. Abstain only when truly unable to evaluate.
    ```
  </vote_prompt_template>

  <model_aliases>
    | Alias | Full Model ID |
    |-------|---------------|
    | grok | grok-code-fast-1 |
    | gemini | gemini-3-pro-preview |
    | gpt-5 | gpt-5.2-codex |
    | deepseek | deepseek-v3.2 |
    | minimax | minimax-m2.5 |
    | glm | glm-4.7 |
    | internal | internal (Claude) |
  </model_aliases>

  <critical_override>
    PASS MODEL NAMES EXACTLY AS THE USER PROVIDES THEM to `claudish --model`.
    Do NOT add provider prefixes like "minimax/", "openai/", "google/", "x-ai/", "z-ai/", "moonshotai/", "deepseek/".
    The claudish CLI handles model routing and provider detection internally.
    Only resolve SHORT ALIASES from the table above (e.g., "grok" → "grok-code-fast-1").
    If user says `--models minimax-m2.5,kimi-k2.5` → use exactly `minimax-m2.5` and `kimi-k2.5`.
  </critical_override>

  <preferences_schema>
    **File:** `.claude/multimodel-team.json`
    ```json
    {
      "schemaVersion": "2.0.0",
      "lastUpdated": "ISO-8601 timestamp",
      "defaultModels": ["model-id-1", "model-id-2"],
      "defaultThreshold": "majority|supermajority|unanimous",
      "contextPreferences": {
        "debug": ["models for debugging tasks"],
        "research": ["models for research tasks"],
        "coding": ["models for implementation tasks"],
        "review": ["models for code review tasks"]
      },
      "agentPreferences": {
        "debug": "dev:debugger"
      },
      "customAliases": { "alias": "full-model-id" },
      "history": []
    }
    ```
    `agentPreferences` is optional. When present, overrides the default agent from `<context_detection>`
    for specific contexts. If absent, agents are resolved from the table's Agent column.
  </preferences_schema>

  <context_detection>
    | Context | Keywords | Default Models | Agent |
    |---------|----------|----------------|-------|
    | debug | debug, error, bug, fix, trace, issue | grok, glm, minimax | dev:debugger |
    | research | research, investigate, analyze, explore, find | gemini, gpt-5, glm | dev:researcher |
    | coding | implement, build, create, code, develop, feature | grok, minimax, deepseek | dev:developer |
    | review | review, audit, check, validate, verify | gemini, gpt-5, glm, grok | dev:researcher |
    | architecture | architecture, design, plan, system, refactor | gemini, gpt-5, glm | dev:architect |
    | testing | test, coverage, unit test, integration, e2e | grok, minimax, deepseek | dev:test-architect |
    | devops | deploy, infrastructure, ci, cd, pipeline, docker | grok, deepseek, minimax | dev:devops |
    | ui | ui, frontend, component, css, layout | gemini, gpt-5, minimax | dev:ui |
  </context_detection>

  <abstain_handling>
    - ABSTAIN votes are EXCLUDED from the denominator
    - Only APPROVE and REJECT count as valid votes
    - Minimum 2 valid votes required for a verdict
    - If less than 2 valid votes, result is INCONCLUSIVE
  </abstain_handling>
</knowledge>

<formatting>
  <verification_table>
    ### Model Execution Verification

    | Model | Method | Status | Output | Exit | Notes |
    |-------|--------|--------|--------|------|-------|
    | Internal (Claude) | Task | OK | 4.2KB | N/A | |
    | grok-code-fast-1 | claudish | OK | 3.8KB | 0 | |
    | gemini-3-pro-preview | claudish | FAILED | 0B | 1 | Rate limit exceeded |

    External models verified: {ok_count}/{total_external} ({percent}%)
    {If any failed: "WORKFLOW DEVIATION: {n} external model(s) failed — see stderr logs in session dir"}
  </verification_table>

  <verdict_display>
    ## Team Verdict: {APPROVED|REJECTED|SPLIT|INCONCLUSIVE}

    | Model | Vote | Confidence | Time |
    |-------|------|------------|------|
    | {model} | {vote} | {n}/10 | {s}s |

    **Result:** {approve}/{valid} APPROVE ({percentage}%)
    **Threshold:** {threshold} ({required}%)
    **Verdict:** {verdict}

    ### Key Issues Raised
    1. [{n} models] {issue}

    ### Dissenting Opinion ({model})
    "{summary}"
  </verdict_display>

  <first_run_welcome>
    Welcome to Team! No saved preferences found.

    Run `claudish --top-models` to see available models, then ask the user to pick.
    Pass model names exactly as shown by claudish — do NOT add provider prefixes.
  </first_run_welcome>
</formatting>

<error_handling>
  <claudish_not_found>
    ```
    Team requires claudish CLI for multi-model execution.

    Install: npm install -g claudish
    Configure: export OPENROUTER_API_KEY=your-key
    Get key at: https://openrouter.ai/keys

    After installation, run /team again.
    ```
  </claudish_not_found>

  <all_models_fail>
    If ALL models return ERROR: report failures, no verdict possible.
  </all_models_fail>

  <parse_failure>
    If vote block cannot be parsed: count as ERROR, include raw excerpt, continue with others.
  </parse_failure>
</error_handling>
