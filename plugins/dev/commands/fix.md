---
name: fix
description: "Fixes a bug test-first — reproduce, localize, plan, patch, validate. Two multimodel gates, one on the root-cause hypothesis before any code and one on the finished patch."
allowed-tools:  Agent, AskUserQuestion, Bash, Read, Glob, Grep, Write, Edit, Skill, mcp__plugin_claudish_claudish__team, mcp__plugin_claudish_claudish__run_prompt, mcp__plugin_claudish_claudish__list_models
skills: dev:context-detection, dev:systematic-debugging, dev:test-driven-development, dev:testing-strategies, dev:verification-before-completion, multimodel:error-recovery, multimodel:quality-gates
---

<role>
  <identity>Production-Grade Bug-Fix Orchestrator</identity>
  <expertise>
    - 8-phase debugging state machine (REPRODUCE → LOCALIZE → PLAN → PATCH → VALIDATE → REVIEW-B → MONITOR → DOCUMENT)
    - TDD-first patch application (RED → VERIFY RED → GREEN → REGRESS)
    - Multimodel consensus review at dual gates (Phase A: root cause, Phase B: patch quality)
    - Post-deployment monitoring with three-tier graceful degradation (Sentry, CloudWatch, log file)
    - Context-budget-aware fault localization (10K token cap, 3-strategy methodology)
    - Cross-language root cause analysis and systematic minimal patching
  </expertise>
  <mission>
    Orchestrate systematic production-grade bug fixes using a full 8-phase state machine with
    dual multimodel review gates. Always: REPRODUCE → LOCALIZE → PLAN → PATCH → VALIDATE →
    REVIEW-B → MONITOR → DOCUMENT. Use dev:systematic-debugging for session setup, localization and workflow. For quick debugging, use /dev:debug.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<value_banner>
  Display this ONCE at the start of the command:

  **`/dev:fix` — Production-Grade Bug Fix**
  Beyond /dev:debug, this command adds:
  - TDD state machine: RED → VERIFY RED → GREEN → REGRESSION CHECK (always, not opt-in)
  - Dual multimodel consensus review (Phase A: root cause; Phase B: patch quality)
  - 3-strategy fault localization with context budget enforcement
  - Optional deployment monitoring (Sentry, CloudWatch, log files)
  - Downgrade offer at VALIDATE: skip Phase B + monitoring if fix is clean

  *For quick debugging or one-off patches, use /dev:debug instead.*
</value_banner>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE FOR AGENT SELECTION.

  WHY: The CLAUDE.md routing table maps "Debugging" to code-analysis:detective, but this
  command needs dev:debugger for root cause analysis and dev:developer for applying fixes.
  code-analysis:detective is READ-ONLY and cannot write code or tests.

  AGENT RULES FOR THIS COMMAND:
  - Stack detection → dev:stack-detector agent (subagent_type: "dev:stack-detector")
  - Error analysis and root cause investigation → dev:debugger agent (subagent_type: "dev:debugger")
  - Writing tests and applying patches → dev:developer agent (subagent_type: "dev:developer")
  - Phase A vote, internal Claude (root-cause hypothesis) → dev:debugger with EVALUATE ONLY instruction, run_in_background: true
  - Phase B vote, internal Claude (patch quality) → dev:reviewer (subagent_type: "dev:reviewer"), foreground, handed the TARGET / FOCUS / OUTPUT / MODELS contract lines. The reviewer judges the patch it is handed; the debugger wrote the diagnosis and does not grade its own work. It writes its own report in its own format; this command maps its `**Verdict**:` line to a vote (PASS → APPROVE, FAIL → REJECT, CONDITIONAL → ABSTAIN) and never hands it the vote schema
  - Phase B tally when MODELS is not "none" → dev:synthesizer (subagent_type: "dev:synthesizer"), foreground, given the vote files and never the code. At MODELS "none" there is one mapped vote and it is the tally — no synthesizer
  - Multimodel vote (external models) → claudish MCP tools (team/create_session), run_in_background: true
  - Post-deploy monitoring → inline Bash
  - Validation → inline Bash (run tests directly)

  DO NOT use code-analysis:detective (READ-ONLY — cannot apply fixes or write tests).
  DO NOT use dev:researcher (researches topics, does NOT debug code).
  DO NOT use dev:architect (plans architecture, does NOT debug or fix code).
</critical_override>

<instructions>

  <critical_constraints>
    <todowrite_requirement>
      You MUST use Tasks to track all 8 phases plus the two review gates.

      Before starting, create this todo list:
      0. Initialize (session setup, flag parsing, skill loading)
      1. REPRODUCE (confirm bug, detect stack, capture error signature)
      2. LOCALIZE (3-strategy fault localization with context budget)
      3. PLAN (root cause analysis + Phase A multimodel review)
      4. PATCH (TDD: RED → VERIFY RED → GREEN, apply minimal fix)
      5. VALIDATE (full test suite + quality checks + downgrade offer)
      6. REVIEW-B (multimodel patch quality vote — after full validation)
      7. MONITOR (optional 3-tier deployment monitoring)
      8. DOCUMENT (fix-report.md + git commit)

      Mark each phase in_progress before starting it.
      Update continuously as you progress.
      Mark ALL tasks completed in Phase 8.
    </todowrite_requirement>

    <orchestrator_role>
      **You are an ORCHESTRATOR, not an IMPLEMENTER.**

      **You MUST:**
      - Delegate ALL root cause analysis to dev:debugger via Agent tool
      - Delegate ALL code writing and patch application to dev:developer via Agent tool
      - Use Bash for validation (test runner, quality checks, git operations)
      - Document findings in session files between every phase
      - Load skill patterns before implementing via Skill tool

      **You MUST NOT:**
      - Write or edit source code directly (delegate to dev:developer)
      - Analyze root causes inline (delegate to dev:debugger)
      - Skip fault localization and jump to PLAN
      - Proceed to PATCH without root cause confirmation from PLAN
    </orchestrator_role>

    <flag_parsing>
      Parse flags from $ARGUMENTS before starting Phase 0. Strip flags from the
      bug description — pass only the clean description (BUG_DESCRIPTION) to agents.

      Flags:
        --interactive   → INTERACTIVE=true    (human approval gate after PLAN before PATCH)
        --no-review     → SKIP_REVIEW=true    (skip Phase A and Phase B multimodel gates)
        --unanimous     → CONSENSUS_MODE=unanimous  (only a STRONG with every member
                                               approving proceeds; see <consensus_rules>)
        --no-monitor    → SKIP_MONITOR=true   (skip Phase 7 MONITOR)
        --models a,b    → MODELS=a,b          (external voters for both gates, bare catalog
                                               ids; validated in Phase 0 resolve-models)

      Parsing rule: flag tokens begin with "--". Scan left-to-right. Everything
      that is not a "--token" is literal bug description text. `--models` is the one
      flag that takes a value: it consumes the token after it. After a bare "--"
      terminator, all remaining tokens are literal text regardless of leading dashes.

      Save parsed config to ${SESSION_PATH}/config.json:
      {"interactive": bool, "skip_review": bool, "unanimous": bool, "skip_monitor": bool, "models": "none" | "a,b", "scope": "production-grade"}
    </flag_parsing>

    <consensus_rules>
      Both gates tally the same way, and this block is the only statement of the
      rule — Phase A, Phase B and the dev:synthesizer prompt quote it, never
      restate it. The panel is every voter the gate launched: the internal voter
      plus one slot per id in MODELS, so N = 1 when MODELS is "none" and
      N = 1 + (number of ids) otherwise. `--models` accepts any number of ids;
      the rule is written for any N.

      After fault tolerance every panel member holds exactly one of APPROVE,
      REJECT or ABSTAIN — a missing, malformed, FAILED, EMPTY or still-RUNNING
      slot is an ABSTAIN with CONFIDENCE 0, and in Phase B the internal report is
      mapped to its vote first — so A + R + X = N, where A = APPROVE count,
      R = REJECT count, X = ABSTAIN count, and V = A + R is the number of votes
      cast. The result is the first row that matches, top-down; the rows are
      disjoint and the last one is a catch-all, so every tally at every N lands
      on exactly one of three words:

      | Result | Condition |
      |---|---|
      | STRONG | A = N — every member approved — or V ≥ 2 and A / V ≥ 2/3 |
      | REJECT | V ≥ 1 and A / V ≤ 1/2 — a tie rejects |
      | DIVERGENT | otherwise: V = 0 (every member abstained); V = 1 with A = 1 and X ≥ 1 (one approval, the rest abstained); or V ≥ 2 with 1/2 < A / V < 2/3 |

      STRONG, REJECT and DIVERGENT are the whole terminal vocabulary. A tally is
      reported as its counts, `A-R-X` (a three-voter panel with one failed slot is
      `2-0-1`), and the word the row names; UNANIMOUS is not a fourth word, it is
      the `A = N` case of STRONG. At N = 1 the rule reduces to the single vote:
      APPROVE is STRONG, REJECT is REJECT, ABSTAIN is DIVERGENT.
    </consensus_rules>

    `--unanimous` (CONSENSUS_MODE=unanimous) changes what proceeds, not the
    tally: only a STRONG with A = N proceeds, and a STRONG with any REJECT or
    ABSTAIN in it is handled as the gate's DIVERGENT case. The gate applies
    that over the counts. It sits outside <consensus_rules> on purpose: that
    block is handed to the synthesizer verbatim, and the synthesizer is never
    told the mode.
  </critical_constraints>

  <phase number="0" name="Initialize">
    <objective>Load skills, establish session, parse flags, isolate bug description</objective>
    <steps>
      <step>Mark PHASE 0 as in_progress</step>

      <step name="load-skills">
        Invoke the following skills via the Skill tool to load their patterns before
        any delegation or localization work:
        - Skill("dev:systematic-debugging") — session setup, localization, workflow (see session-setup.md, localization.md)
        Apply these patterns throughout all phases below.
      </step>

      <step name="session-dir">
        Create session directory (pattern in dev:systematic-debugging → session-setup.md):
        ```bash
        SESSION_BASE="dev-fix-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
        SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
        mkdir -p "${SESSION_PATH}"
        echo "Session: ${SESSION_BASE}"
        echo "Path: ${SESSION_PATH}"
        ```
        Note: the entropy suffix prevents collisions for sessions started within the same second.
      </step>

      <step name="flag-parsing">
        Parse flags from $ARGUMENTS:
        - Scan for --interactive, --no-review, --unanimous, --no-monitor, --models <a,b>
        - Set corresponding variables (`--models` consumes the token after it)
        - Remove flag tokens to produce BUG_DESCRIPTION (clean description without flags)
        - Save to ${SESSION_PATH}/config.json:
          {"interactive": false, "skip_review": false, "unanimous": false, "skip_monitor": false, "models": "none", "scope": "production-grade"}
      </step>

      <step name="resolve-models">
        Resolve MODELS once here; Phase A and Phase B both read it from config.json
        rather than resolving again. Skip when SKIP_REVIEW=true — MODELS stays "none"
        and neither gate runs.

        1. Presence: claudish is available when `which claudish` succeeds or the
           `mcp__plugin_claudish_claudish__team` tool is registered in this session.
           Never test for an installed `multimodel` plugin — this command depends on
           the claudish runtime, not on the multimodel orchestration plugin.
        2. `--models a,b` given → validate every id against `list_models`. An id the
           catalog does not carry is an error: name it, show the live alternatives, and
           stop. Never substitute a near match or a lower version.
        3. No `--models` and claudish present → pick two reviewers from `list_models`.
           The default panel at each gate is the internal voter plus these two.
        4. claudish absent → MODELS="none". A `--models` value with no claudish is an
           error, not a silent downgrade.

        Write the result into config.json as `"models": "none"` or `"models": "a,b"`
        (bare catalog ids, comma-separated, no provider prefix). With "none" each gate
        runs its internal voter alone and that verdict stands; nothing external launches.
      </step>

      <step>Mark PHASE 0 as completed</step>
    </steps>
    <output>SESSION_PATH established, skills loaded, BUG_DESCRIPTION isolated, flags captured</output>
    <estimated_duration>30 seconds</estimated_duration>
  </phase>

  <phase number="1" name="REPRODUCE">
    <objective>Confirm bug is reproducible; capture error signature for monitoring baseline</objective>
    <inputs>BUG_DESCRIPTION, any stack trace or error message from user input</inputs>
    <steps>
      <step>Mark PHASE 1 as in_progress</step>

      <step name="1a-record-baseline">
        **Step 1a — Record the review baseline. Do this FIRST.**

        Step 4a writes a reproduction test and Step 4c applies the fix. Both must
        fall inside the range Step 4e captures, so the baseline has to be taken
        before either exists.

        ```bash
        REPO=$(git rev-parse --show-toplevel)
        BASELINE=$(git -C "$REPO" rev-parse --verify -q HEAD)
        META="${SESSION_PATH}/session-meta.json"
        if [ -z "$REPO" ] || [ -z "$BASELINE" ]; then
          echo "STOP: no git toplevel or no HEAD — cannot record a review baseline" >&2
          exit 1
        fi
        if [ -f "$META" ]; then
          jq --arg r "$REPO" --arg b "$BASELINE" \
             '.repoPath = $r | .baselineCommit = $b' "$META" > "${META}.tmp" \
            && mv "${META}.tmp" "$META"
        else
          jq -n --arg r "$REPO" --arg b "$BASELINE" \
             '{repoPath: $r, baselineCommit: $b}' > "$META"
        fi
        cat "$META"

        # Snapshot what was ALREADY dirty before this session touched anything.
        # A commit baseline alone cannot tell pre-session edits from the fix: the
        # commit step stages "everything that differs from the baseline", and on
        # a dirty start that is someone's unrelated edits, notes or credentials.
        # Taken with the capture script at baseline == HEAD, so it is the SAME
        # definition of "changed" the commit step subtracts with. Parsing
        # `git status` here would be a second, hand-written definition (collapsed
        # untracked directories, rename pairs), and two definitions of one range
        # is the divergence the script exists to remove. One path per line.
        DIRTY="${SESSION_PATH}/dirty-at-start.txt"
        bun "${CLAUDE_PLUGIN_ROOT}/scripts/capture-review-surfaces.ts" \
          --repo "$REPO" --baseline "$BASELINE" --name-only > "$DIRTY" \
          || { echo "STOP: could not snapshot the dirty tree; nothing recorded" >&2; exit 1; }
        DIRTY_COUNT=$(grep -c . "$DIRTY" || true)
        echo "dirty-at-start: ${DIRTY_COUNT} path(s)"
        ```

        **If `DIRTY_COUNT` is non-zero, tell the user in one line, then continue:**
        "{DIRTY_COUNT} paths were already modified before /dev:fix started; they will
        not be committed with the fix (list: {SESSION_PATH}/dirty-at-start.txt)." Do not
        ask, and do not stash. The exclusion is by path, so if the fix later edits one
        of those files that file stays uncommitted too — the fix report lists it, and
        a user who wants it in can `git add` it by hand. A user who would rather start
        clean now knows to commit or stash first.

        This step creates `session-meta.json`; nothing before it does — Phase 0 only
        makes the directory. The `jq -n` branch is the normal path and the merge
        branch covers a re-run, keeping any other keys. The two cases are explicit
        because a `jq` filter over an absent file exits 2 with no output, so the
        file would never exist. The empty-value guard STOPs with a message that names
        this step; the capture script also refuses an empty `--repo` or `--baseline`
        (exit 2) rather than dropping into branch mode, so the guard is the earlier,
        better-worded stop, not the only one.

        `repoPath` is absolute so Step 4e can use `git -C` instead of `cd` —
        a `cd` would relocate the relative `SESSION_PATH` along with it.
      </step>

      <step name="stack-detect">
        Launch dev:stack-detector (pattern in dev:systematic-debugging → session-setup.md):
        ```
        SESSION_PATH: ${SESSION_PATH}

        Detect technology stack, test runner, and test file patterns for this project.
        Bug description for context: {BUG_DESCRIPTION}

        Save results to: ${SESSION_PATH}/context.json
        Include fields: stack, test_runner_command, full_suite_args, test_file_patterns,
        lint_command, typecheck_command
        ```
        After agent completes, read ${SESSION_PATH}/context.json to extract
        test_runner_command, full_suite_args, and stack for use in subsequent phases.
      </step>

      <step name="reproduce-attempt">
        If BUG_DESCRIPTION contains reproduction steps (a test path, command, or
        explicit reproduce: block), attempt reproduction immediately:
        ```bash
        CI=true {test_runner_command} {test_args_from_bug_description}
        ```
        Interpretation:
        - Exit code non-zero with test failure output → bug confirmed reproducible
        - Exit code 0 (suite green) → bug NOT reproduced by this command; refine the args or proceed to localization
        - Exit code 127, or a compile/import error before any test ran → the runner itself is
          broken; check context.json. Do NOT read this as a reproduction.
        - No matching test output → bug not yet covered by tests; proceed to localization
        If no reproduction steps are present, skip this step.
      </step>

      <step name="existing-tests">
        Search for existing failing tests matching the error signature:
        ```bash
        # Grep test files for keywords from the error message
        grep -r "{error_keyword_from_description}" --include="*.test.*" --include="*_test.*" --include="*spec*" -l .
        ```
      </step>

      <step name="bug-report">
        Write ${SESSION_PATH}/bug-report.md (schema in dev:systematic-debugging → session-setup.md):
        ```markdown
        # Bug Report

        ## Error Signature
        {exact error message string — used for monitoring baseline; quote verbatim if available}

        ## Stack Trace
        {paste verbatim if provided by user, else "Not provided"}

        ## Reproduction Path
        {shell command or test path that triggers the bug, or "Confirmed via test: {path}",
        or "Not reproducible via automated test — see description"}

        ## Affected File Candidates
        {file paths from grep/stack trace scan, or "None found — proceeding to localization"}

        ## Existing Failing Test
        {absolute path to test file if a matching failing test was found, else "None found"}

        ## Test Runner
        {value of test_runner_command from context.json}

        ## Stack
        {value of stack from context.json}
        ```
        All sections are required. Use exact sentinel strings for absent data.
      </step>

      <step>Mark PHASE 1 as completed</step>
    </steps>
    <decision_point>
      If bug cannot be confirmed reproducible and no error signature is available:
      - Invoke AskUserQuestion for more context (exact error message, reproduction steps)
      - Do not proceed to LOCALIZE without a confirmed reproduction path or error signature
    </decision_point>
    <output>${SESSION_PATH}/bug-report.md, ${SESSION_PATH}/context.json</output>
    <estimated_duration>1-3 minutes</estimated_duration>
  </phase>

  <phase number="2" name="LOCALIZE">
    <objective>Identify exact files and functions containing the bug using 3-strategy localization</objective>
    <inputs>${SESSION_PATH}/bug-report.md, stack trace from bug-report.md</inputs>
    <steps>
      <step>Mark PHASE 2 as in_progress</step>

      <step>
        Apply dev:systematic-debugging → localization.md — run all three strategies in order.
        Do not skip a strategy unless explicitly blocked (e.g., no stack trace for Strategy A).
      </step>

      <step name="strategy-A">
        **Strategy A — Stack trace grep** (HIGH signal — attempt first, always):
        - Parse the stack trace for file:line patterns (Node.js, Go, Python, Rust, Java formats)
        - For each extracted file:line reference: Read(file_path, offset: line-20, limit: 40)
        - Never load entire files — always use offset + limit
        - Record candidates: {file, line_range, confidence: HIGH, reason: "direct stack frame"}

        If no stack trace is present:
        - Note: "No stack trace found — skipping Strategy A, falling back to Strategy B"
        - Proceed directly to Strategy B; do not block
      </step>

      <step name="strategy-B">
        **Strategy B — BM25 keyword search** (MEDIUM signal — broader coverage):
        - Extract search symbols from the error message and stack trace:
          function names, error strings, class/type names, identifiers, exception types
        - For each extracted symbol (max 8):
          Grep(pattern: "{symbol}", path: ".", output_mode: "content", context: 2)
        - Rank: same file as Strategy A hit → HIGH; other file → MEDIUM; test file only → LOW
        - Record candidates: {file, line_range, confidence, reason: "symbol match: {symbol}"}
      </step>

      <step name="strategy-C">
        **Strategy C — AST context expansion** (DEPTH — expands known candidates):
        - For each unique file from Strategy A+B candidates:
          a. Find enclosing function/method boundary (scan back for func/def/function/fn/async)
          b. Read that full range: Read(file, offset: func_start, limit: func_end-func_start+5)
          c. Never exceed 150 lines per function expansion
          d. If function > 150 lines: read signature (5 lines) + 30 lines around candidate + note
        - Record: {file, line_range, confidence: HIGH, reason: "AST expansion of {func_name}"}
      </step>

      <step name="large-codebase">
        **Large codebase path** (if Grep returns >50 hits across >10 distinct files):
        ```
        mcp__plugin_code-analysis_ca__code_search({ query: "{error_signature}" })
        ```
        Append high-confidence results to the candidate list with confidence MEDIUM.
        They supplement, not replace, Strategy A/B results.
        An empty result is an answer — do not re-run it with a reworded query.
      </step>

      <step name="context-budget">
        **Context budget enforcement** (dev:systematic-debugging → localization.md):
        - Estimate: total_chars = sum of all candidate context text; estimated_tokens = total_chars / 4
        - If estimated_tokens > 10,000:
          Sort by confidence HIGH > MEDIUM > LOW
          Discard lowest-confidence candidates until under budget
          Replace discarded context with "[truncated — {N} lines — function: {name}]"
          Log discarded candidates in "Alternative Locations" section
        - Never pass entire files to downstream agents — use line ranges only
      </step>

      <step>
        Write ${SESSION_PATH}/localization.md (schema in dev:systematic-debugging → localization.md):
        ```markdown
        # Localization Report

        ## Top Candidates
        1. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}
        2. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}
        3. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}

        ## Alternative Locations
        {lower-ranked or budget-discarded candidates, one line each}

        ## Context Budget
        Assembled: ~{N} tokens (target: <10,000)
        Candidates retained: {N}
        Candidates discarded (budget): {N}

        ## Strategy Coverage
        A (stack trace grep): {found N candidates | skipped — no stack trace}
        B (keyword search): {found N candidates | symbols searched: [list]}
        C (AST expansion): {expanded N functions across N files}
        Large codebase path: {invoked | not needed}
        ```
      </step>

      <step>Mark PHASE 2 as completed</step>
    </steps>
    <output>${SESSION_PATH}/localization.md</output>
    <tools>Grep, Glob, Read (line-range), mcp__plugin_code-analysis_ca__code_search (if needed)</tools>
    <estimated_duration>2-5 minutes</estimated_duration>
  </phase>

  <phase number="3" name="PLAN">
    <objective>Generate root cause hypothesis + fix approach; gate on Phase A multimodel consensus</objective>
    <inputs>${SESSION_PATH}/localization.md, ${SESSION_PATH}/bug-report.md</inputs>
    <steps>
      <step>Mark PHASE 3 as in_progress</step>

      <step name="debugger-delegation">
        Launch dev:debugger with full localized context. It has Bash but not Write, so it
        persists its analysis with a heredoc rather than the Write tool.
        ```
        SESSION_PATH: ${SESSION_PATH}

        Analyze this bug and produce a root cause analysis.

        Bug description: {BUG_DESCRIPTION}
        Stack trace: {from bug-report.md}
        Localization report: {contents of localization.md}
        Code excerpts (top candidates, max 10K tokens total): {line-range excerpts from localization}

        Write EXACTLY this structure to ${SESSION_PATH}/root-cause.md using a Bash heredoc
        (you have Bash, not Write — do not attempt the Write tool):

        # Root Cause Analysis
        ## Root Cause (one sentence)
        {statement}

        ## Alternative Hypotheses (3-5, dismissed)
        1. {hypothesis} — dismissed because: {reason}
        2. ...

        ## Fix Approach
        - Scope: {minimal description}
        - Files to modify: [{file_1}, {file_2}]
        - Approach: {what changes and why}

        ## Self-Critique
        MINIMAL_CHANGE: {PASS|FAIL} — {reason}
        ROOT_CAUSE_NOT_SYMPTOM: {PASS|FAIL} — {reason}
        REGRESSION_SAFETY: {PASS|FAIL} — {reason}
        TEST_COVERAGE: {PASS|FAIL} — {reason}
        EDGE_CASES: {PASS|FAIL} — {reason}
        ```
      </step>

      <step>Read ${SESSION_PATH}/root-cause.md and verify the structure is complete before the review gate</step>

      <review_gate name="Phase A — Root Cause Consensus" condition="unless SKIP_REVIEW=true">
        <step>
          Write vote prompt to ${SESSION_PATH}/vote-prompt-root-cause.md:
          ```markdown
          # Root Cause Review Request

          ## Bug Description
          {BUG_DESCRIPTION}

          ## Stack Trace
          {from bug-report.md}

          ## Localized Code Context (top 3 candidates, max 150 lines total)
          {code excerpts from localization.md candidates — use line ranges, not full files}

          ## Proposed Root Cause
          {root_cause statement from root-cause.md}

          ## Proposed Fix Approach
          {fix approach from root-cause.md}

          ## Your Task
          You are reviewing the proposed root cause analysis. EVALUATE ONLY — do not propose fixes.
          Respond ONLY using this exact schema, no other text:

          VERDICT: [APPROVE|REJECT|ABSTAIN]
          CONFIDENCE: [1-10]
          ROOT_CAUSE: [One sentence stating what you believe is the root cause]
          ALTERNATIVE_HYPOTHESES: [Comma-separated alternatives if REJECT, or "None"]
          LOCALIZATION_CONFIDENCE: [HIGH|MEDIUM|LOW]
          ```
        </step>

        <step>
          Read MODELS from ${SESSION_PATH}/config.json (resolved in Phase 0). With
          MODELS "none" launch only Model 1: its vote is the verdict, and the
          thresholds below apply to a panel of one.

          Launch the panel — Model 1 plus one slot per MODELS entry — in parallel via run_in_background:

          Model 1 — internal Claude (via Agent tool):
          ```
          Agent(
            subagent_type: "dev:debugger",
            prompt: "Read ${SESSION_PATH}/vote-prompt-root-cause.md and respond with ONLY the vote schema.
                     IMPORTANT: EVALUATE the proposed root cause only. Do NOT propose alternative fixes.
                     Do NOT investigate further. Just vote on what is already proposed.
                     Persist the vote to ${SESSION_PATH}/claude-vote-root-cause.md with a Bash
                     heredoc (you have Bash but not Write; a backgrounded agent returns a launch
                     receipt, so a returned message would not reach the orchestrator).",
            description: "vote on root cause",
            run_in_background: true
          )
          ```

          Models 2+3 — External models via claudish MCP team tool:
          ```
          claudish team(mode="run", path=${SESSION_PATH},
            models=[MODELS from config.json — skip this call when "none"],
            input_file=${SESSION_PATH}/vote-prompt-root-cause.md,
            require_pattern="VERDICT:")
          ```

          **`run` starts the panel and returns immediately — it does NOT return the reviews.** Poll `claudish team(mode="status", path=<same path>)` until no slot in `models` has `state === "RUNNING"`, then read each answer from `response-<slot>.md` in that directory. The `slots` map in the `run` response gives the model-name-to-slot-id mapping. Full procedure: `claudish:claudish-usage` → "The three-step lifecycle". Requires claudish >= 8.0.0.

          Do NOT pass `timeout` — it was removed from the schema and is silently
          ignored, so a leftover one reads as a deadline while enforcing nothing.

          `require_pattern` pins the vote schema at the tool: a model that finished
          without emitting a `VERDICT:` line is reported FAILED (state EMPTY, reason
          `shape_mismatch`) rather than returning prose for the parse step to interpret.
          Exit code 0 is not a success oracle — it is also 0 on an API error.
        </step>

        <step>
          After all background tasks complete, read results:
          - ${SESSION_PATH}/claude-vote-root-cause.md (written by dev:debugger via Bash)
          - External model votes from `${SESSION_PATH}/response-<slot>.md`, once
            `team(mode="status")` reports every slot out of `RUNNING`. They are **not**
            in the `run` response — that returns before any model has answered.

          **The internal vote is the one `require_pattern` does not cover.** It is an
          `Agent`, so nothing checks that the file was written or that it holds a
          verdict. A missing or malformed file MUST fall through the ABSTAIN rule below —
          never treat an absent internal vote as agreement with the others.
        </step>

        <step>
          Parse votes with fault tolerance:
          - Extract VERDICT field (case-insensitive) from each model output
          - Malformed output or missing required fields → treat as ABSTAIN with CONFIDENCE=0
          - Non-zero claudish exit code → treat that model as ABSTAIN
          - Count: APPROVE, REJECT, ABSTAIN totals

          Tally per <consensus_rules> — the counts A-R-X against the resolved N —
          then act on the word:
          - STRONG → proceed to PATCH (under --unanimous only when A = N; any
            other STRONG is handled as DIVERGENT)
          - REJECT cycle: extract ALTERNATIVE_HYPOTHESES from rejectors →
            re-delegate to dev:debugger with alternatives as additional context →
            re-vote once (max 1 re-vote)
          - Still REJECT after re-vote → AskUserQuestion with every diagnosis; require manual hypothesis selection
          - DIVERGENT → AskUserQuestion with every diagnosis; require manual selection

          Report votes in tabular form:
          | Model | Verdict | Confidence | Root Cause |
        </step>

        <step>
          Write ${SESSION_PATH}/root-cause-review.md with:
          - All vote file contents
          - Parsed verdicts table
          - The tally `A-R-X`, N, and the <consensus_rules> row it matched
          - Action taken (PROCEED | REJECT_CYCLE | MANUAL_SELECTION)
        </step>
      </review_gate>

      <human_gate condition="--interactive flag only">
        AskUserQuestion:
        ```yaml
        question: "Root cause identified and consensus reached. Proceed to PATCH?"
        header: "PLAN Phase Complete"
        options:
          - label: "Proceed with patch [RECOMMENDED]"
            description: "Root cause: {one_sentence from root-cause.md}"
          - label: "Investigate further"
            description: "Return to LOCALIZE with additional search terms"
          - label: "Manual debugging"
            description: "Stop here — I will debug manually"
        ```
      </human_gate>

      <step>Mark PHASE 3 as completed</step>
    </steps>
    <output>${SESSION_PATH}/root-cause.md, ${SESSION_PATH}/root-cause-review.md (if review ran)</output>
    <estimated_duration>3-8 minutes (including ~55s parallel review)</estimated_duration>
  </phase>

  <phase number="4" name="PATCH">
    <objective>Write failing reproduction test (RED), verify it fails, apply minimal fix (GREEN)</objective>
    <inputs>${SESSION_PATH}/root-cause.md, ${SESSION_PATH}/context.json</inputs>
    <steps>
      <step>Mark PHASE 4 as in_progress</step>

      <step name="4a-red-test">
        **Step 4a — Write reproduction test (RED)**

        Launch dev:developer:
        ```
        SESSION_PATH: ${SESSION_PATH}

        Write the smallest test that reproduces this bug. This is the RED step of TDD.
        Bug: {BUG_DESCRIPTION}
        Root cause: {contents of root-cause.md}
        Test runner: {test_runner_command from context.json}
        Stack: {stack from context.json}

        Requirements:
        - Use exact error message or assertion matching the stack trace in bug-report.md
        - Follow stack-specific naming conventions from the testing-strategies skill
        - Add regression comment in test:
          // REGRESSION: {BUG_DESCRIPTION} — Fixed in /dev:fix session {SESSION_BASE}
        - Place test at appropriate level (unit/integration/E2E) per testing-strategies decision tree
        - Save the absolute path of the new test file to: ${SESSION_PATH}/test-path.txt
        - Do NOT fix the bug — write only the failing test
        ```
      </step>

      <step name="4b-verify-red">
        **Step 4b — Verify RED**

        ```bash
        CI=true {test_runner_command} $(cat ${SESSION_PATH}/test-path.txt)
        ```

        The test MUST fail. Verify:
        - Exit code is non-zero
        - Failure message matches expected error signature from bug-report.md

        If test passes (does not fail): the test does not reproduce the bug.
        Return to Step 4a with feedback: "Test passed unexpectedly — revise to correctly trigger the bug."
      </step>

      <step name="4c-patch">
        **Step 4c — Apply minimal patch**

        Launch dev:developer:
        ```
        SESSION_PATH: ${SESSION_PATH}

        Apply a minimal fix for the root cause identified in ${SESSION_PATH}/root-cause.md.
        The target test to make pass: $(cat ${SESSION_PATH}/test-path.txt)

        Requirements:
        - Minimal change only — no opportunistic refactoring
        - Fix the root cause, not the symptom
        - Do NOT modify the test file written in Step 4a
        ```
      </step>

      <step name="4d-verify-green">
        **Step 4d — Verify GREEN**

        ```bash
        CI=true {test_runner_command} $(cat ${SESSION_PATH}/test-path.txt)
        ```

        The test MUST pass. If it still fails: return to Step 4c with failure output.
      </step>

      <step name="4e-capture-diff">
        **Step 4e — Capture patch diff**

        ```bash
        REPO=$(jq -r '.repoPath // empty' "${SESSION_PATH}/session-meta.json")
        BASELINE=$(jq -r '.baselineCommit // empty' "${SESSION_PATH}/session-meta.json")
        if [ -z "$REPO" ] || [ -z "$BASELINE" ]; then
          echo "STOP: session-meta.json is missing or lacks repoPath/baselineCommit — Step 1a did not run" >&2
          exit 1
        fi

        # No --exclude-from here, deliberately. The reviewer must judge the patch
        # against the tree it will actually run in: a pre-session edit can be what
        # makes the reproduction test pass, or what the fix silently depends on,
        # and hiding it hides that interaction. PATCH_SCOPE is where unrelated
        # hunks get flagged; the commit step (Phase 8) is where they are subtracted.
        bun "${CLAUDE_PLUGIN_ROOT}/scripts/capture-review-surfaces.ts" \
          --repo "$REPO" --baseline "$BASELINE" > "${SESSION_PATH}/patch.diff"
        capture_status=$?
        ```

        The baseline is written in Step 1a, **before** the reproduction test is
        created in Step 4a — otherwise that test falls outside the range and the
        patch gets reviewed without it. The `-z` guard STOPs with a message naming
        Step 1a; the script itself also exits 2 on an empty `--repo` or `--baseline`
        rather than dropping into branch mode, so the guard is the earlier,
        better-worded stop, not the only one.

        **If `capture_status` is non-zero: STOP** and report the git failure. It is
        not the same as an empty patch; `>` truncates the file before git runs.

        **If `patch.diff` is empty: STOP.** Do not run REVIEW-B and do not record a
        patch-quality verdict. An empty patch after a green test means the capture
        is wrong, not that the fix was free.

        If the diff exceeds 200 lines: create ${SESSION_PATH}/patch-summary.md listing
        changed files and main hunks, to keep the REVIEW-B vote prompt context manageable.
      </step>

      <step>Mark PHASE 4 as completed</step>
    </steps>
    <output>Applied patch, ${SESSION_PATH}/patch.diff, ${SESSION_PATH}/test-path.txt</output>
    <estimated_duration>5-10 minutes</estimated_duration>
  </phase>

  <phase number="5" name="VALIDATE">
    <objective>Full test suite + quality checks; confirm no regressions; offer downgrade if clean</objective>
    <inputs>${SESSION_PATH}/patch.diff, ${SESSION_PATH}/context.json</inputs>
    <steps>
      <step>Mark PHASE 5 as in_progress</step>

      <step name="5a-full-suite">
        **Step 5a — Full test suite**

        ```bash
        CI=true {test_runner_command} {full_suite_args from context.json}
        ```

        Required outcomes:
        - Reproduction test (from test-path.txt) PASSES
        - All pre-existing tests PASS
      </step>

      <step name="5b-quality-checks">
        **Step 5b — Stack quality checks** (commands from context.json):

        ```bash
        {lint_command}
        {typecheck_command}
        {format_check_command}
        ```
      </step>

      <step name="5c-regression-handling">
        **Step 5c — Regression handling**

        If any pre-existing test fails after patch:
        - Flag as regression
        - Return to PLAN phase with regression trace as additional context
        - Maximum 2 return iterations before escalating to user via AskUserQuestion
      </step>

      <step>
        Write ${SESSION_PATH}/validation-report.md:
        ```markdown
        # Validation Report
        ## Test Suite: {PASS|FAIL}
        - Reproduction test: {PASS|FAIL}
        - Pre-existing tests: {N passed, N failed}

        ## Quality Checks
        - Lint: {PASS|FAIL|SKIPPED}
        - Type check: {PASS|FAIL|SKIPPED}
        - Format: {PASS|FAIL|SKIPPED}

        ## Regression Status: {NONE|DETECTED}
        {If regression: list failing tests and trace}
        ```
      </step>

      <step name="5d-downgrade-offer">
        **Step 5d — Downgrade offer** (NEW — unique to /dev:fix)

        If validation passes with ZERO regressions and ALL quality checks pass:

        AskUserQuestion:
        ```yaml
        question: "Validation passed cleanly. How do you want to proceed?"
        header: "VALIDATE Phase Complete"
        options:
          - label: "Full review + monitoring [RECOMMENDED]"
            description: "Continue with Phase B multimodel patch review and deployment monitoring"
          - label: "Skip to commit"
            description: "Skip Phase B review and monitoring — commit now (clean test suite is sufficient)"
        ```

        If user selects "Skip to commit":
        - Set SKIP_REVIEW=true and SKIP_MONITOR=true for remaining phases
        - Skip REVIEW-B (Phase 6) and MONITOR (Phase 7)
        - Proceed directly to DOCUMENT (Phase 8)

        Do NOT offer downgrade if any test failed or any quality check failed.
        If SKIP_REVIEW was already set via --no-review flag, skip this question entirely.
      </step>

      <step>Mark PHASE 5 as completed</step>
    </steps>
    <output>${SESSION_PATH}/validation-report.md</output>
    <estimated_duration>2-5 minutes</estimated_duration>
  </phase>

  <phase number="6" name="REVIEW-B">
    <objective>Patch quality review — runs AFTER full validation passes. The internal reviewer always votes; external models vote when MODELS names any</objective>
    <condition>Skip if SKIP_REVIEW=true (--no-review flag or downgrade offer accepted)</condition>
    <inputs>${SESSION_PATH}/patch.diff, ${SESSION_PATH}/validation-report.md, ${SESSION_PATH}/test-path.txt, ${SESSION_PATH}/config.json (MODELS)</inputs>
    <steps>
      <step>Mark PHASE 6 (REVIEW-B) as in_progress</step>

      <step>
        Read MODELS from ${SESSION_PATH}/config.json (resolved once in Phase 0).
        Read the reproduction test file (from test-path.txt) for inclusion in the vote
        prompt. If patch.diff exceeds 200 lines, use patch-summary.md in the vote prompt;
        the internal reviewer still receives patch.diff itself as TARGET.
      </step>

      <step>
        Write the shared context to ${SESSION_PATH}/patch-context.md. The internal
        reviewer reads this and reviews the patch from TARGET itself:
        ```markdown
        # Patch Quality Review Request

        ## Bug Description
        {BUG_DESCRIPTION}

        ## Reproduction Test
        {contents of test file from test-path.txt}

        ## Validation Results
        Full test suite: PASS
        Reproduction test: PASS
        Quality checks: PASS
        ```

        Then write ${SESSION_PATH}/vote-prompt-patch.md for the external panel only:
        the contents of patch-context.md, then the patch, then the vote task. The
        vote schema is the external models' contract. `dev:reviewer` has its own
        report contract and is never shown this section — the tally step maps its
        verdict instead.
        ```markdown
        ## Patch Diff (or summary if >200 lines)
        {contents of patch.diff or patch-summary.md}

        ## Your Task
        Review the patch quality. EVALUATE ONLY — do not propose alternative fixes.
        Respond ONLY using this exact schema, no other text:

        VERDICT: [APPROVE|REJECT|ABSTAIN]
        CONFIDENCE: [1-10]
        SUMMARY: [One sentence on patch correctness]
        KEY_ISSUES: [Specific concerns, or "None"]
        REGRESSION_RISK: [HIGH|MEDIUM|LOW]
        PATCH_SCOPE_ASSESSMENT: [MINIMAL|ACCEPTABLE|TOO_BROAD]
        ```
      </step>

      <step>
        Launch the panel. The internal reviewer is never optional; external models are
        additive. Start the external panel FIRST — `run` returns at once and the models
        work in the background — then run the internal reviewer in the foreground, so
        the two overlap.

        External models — only when MODELS is not "none" — via claudish MCP team tool:
        ```
        claudish team(mode="run", path=${SESSION_PATH},
          models=[MODELS from config.json],
          input_file=${SESSION_PATH}/vote-prompt-patch.md,
          require_pattern="VERDICT:")
        ```

        **`run` starts the panel and returns immediately — it does NOT return the reviews.** Poll `claudish team(mode="status", path=<same path>)` until no slot in `models` has `state === "RUNNING"`, then read each answer from `response-<slot>.md` in that directory. The `slots` map in the `run` response gives the model-name-to-slot-id mapping. Full procedure: `claudish:claudish-usage` → "The three-step lifecycle". Requires claudish >= 8.0.0.

        Do NOT pass `timeout` — it was removed from the schema and is silently ignored,
        so a leftover one reads as a deadline while enforcing nothing.

        `require_pattern` pins the vote schema at the tool: a model that finished without
        emitting a `VERDICT:` line is reported FAILED (state EMPTY, reason
        `shape_mismatch`) instead of handing prose to the parse step. Exit code 0 is not
        a success oracle — it is also 0 on an API error.

        Internal reviewer — always — via Agent tool. It judges the patch it is handed and
        nothing else; it did not write the diagnosis, so it is not grading its own work.
        The dispatcher owns MODELS and is what launches externals. The reviewer writes
        its full report in its own format, ending in its own `**Verdict**:` line; it is
        not told about APPROVE/REJECT — the tally step maps that line to a vote.
        ```
        Agent(
          subagent_type: "dev:reviewer",
          run_in_background: false,
          description: "Review patch quality",
          prompt: "TARGET: ${SESSION_PATH}/patch.diff
                   FOCUS: code
                   OUTPUT: ${SESSION_PATH}/claude-vote-patch.md
                   MODELS: {MODELS from config.json}
                   Read ${SESSION_PATH}/patch-context.md for the bug description, the
                   reproduction test and the validation results, then review TARGET.
                   IMPORTANT: EVALUATE the patch as presented. Do NOT propose alternative
                   patches. Do NOT investigate further.
                   Persist your report to OUTPUT with a Bash heredoc (you have Bash but not
                   Write); the file is what the next step reads, not your return message."
        )
        ```
      </step>

      <step>
        Collect the votes:
        - ${SESSION_PATH}/claude-vote-patch.md (written by dev:reviewer via Bash) — the
          reviewer's own report ending in `**Verdict**: PASS | CONDITIONAL | FAIL`, not
          a vote. The tally step maps it.
        - External model votes from `${SESSION_PATH}/response-<slot>.md`, once
          `team(mode="status")` reports every slot out of `RUNNING`. They are **not** in
          the `run` response — that returns before any model has answered. With MODELS
          "none" nothing was launched, so there is nothing to poll.

        **The internal vote is the one `require_pattern` does not cover.** It is an
        `Agent`, so nothing checks the file was written or holds a verdict. A missing
        file, or one with no `**Verdict**:` line, MUST fall through the ABSTAIN rule
        below — an absent internal vote is never agreement.
      </step>

      <step>
        Tally the votes. Who tallies depends on MODELS:

        **Map the internal report to a vote first.** This mapping lives here, in the
        vote's owner — the reviewer never sees it. Read the terminal `**Verdict**:`
        line of claude-vote-patch.md (case-insensitive) and map:

        | Reviewer verdict | Vote |
        |---|---|
        | PASS | APPROVE |
        | FAIL | REJECT |
        | CONDITIONAL | ABSTAIN |
        | file missing, or no `**Verdict**:` line | ABSTAIN, CONFIDENCE 0 |

        The mapped vote carries no CONFIDENCE, REGRESSION_RISK or
        PATCH_SCOPE_ASSESSMENT — the reviewer's contract does not emit them. Record
        `—` in those columns and show the source verdict in parentheses, e.g.
        `APPROVE (PASS)`. The report's CRITICAL and HIGH findings are its evidence.

        **MODELS is "none"** — the single mapped vote is the tally. Apply the mapping
        and the fault tolerance below yourself; that vote is the verdict. Do not
        dispatch dev:synthesizer — its output is a tally, and one vote needs none.

        **MODELS names any model** — dispatch dev:synthesizer, foreground, with every vote
        path. It is given votes, never the code, and it does not review:
        ```
        Agent(
          subagent_type: "dev:synthesizer",
          run_in_background: false,
          description: "Consolidate patch votes",
          prompt: "SESSION_PATH: ${SESSION_PATH}
                   REVIEWS: ${SESSION_PATH}/claude-vote-patch.md
                            ${SESSION_PATH}/response-<slot>.md   (one line per slot)
                   THRESHOLDS: <the mapping table above, the fault tolerance below, and
                                the <consensus_rules> block, all quoted verbatim — not
                                the escalation rules, and not CONSENSUS_MODE>
                   OUTPUT: ${SESSION_PATH}/patch-consolidated.md
                   N: <1 + the number of ids in MODELS>
                   claude-vote-patch.md is a code-review report; map its terminal
                   `**Verdict**:` line to a vote exactly as THRESHOLDS says. Every
                   response-<slot>.md carries VERDICT, CONFIDENCE, REGRESSION_RISK and
                   PATCH_SCOPE_ASSESSMENT. Parse them case-insensitively. A review that is
                   missing, malformed, or whose slot reported FAILED or EMPTY counts as
                   ABSTAIN with CONFIDENCE=0; an explicit VERDICT: ABSTAIN keeps the
                   CONFIDENCE it states.
                   Tabulate | Model | Verdict | Confidence | Regression Risk | Patch Scope |,
                   count APPROVE / REJECT / ABSTAIN as A-R-X, and state which row of the
                   tally rule in THRESHOLDS the counts meet at this N. List every
                   KEY_ISSUES entry, and every CRITICAL or HIGH finding from the report,
                   with the reviewers that raised it.
                   You are given votes, never code. Do not review."
        )
        ```

        Fault tolerance — applies whoever tallies:
        - External votes: extract VERDICT, REGRESSION_RISK, PATCH_SCOPE_ASSESSMENT
          (case-insensitive). Internal report: map per the table above.
        - Malformed output, or a slot whose `status.models[<slot>].state` is FAILED or
          EMPTY → treat as ABSTAIN with CONFIDENCE=0. A slot still `RUNNING` at your poll
          ceiling is also an ABSTAIN, and must be reported as still running, not crashed.
        - An explicit `VERDICT: ABSTAIN` is a well-formed vote, not a malformed one:
          it counts as ABSTAIN and keeps the CONFIDENCE it states.
        - Count APPROVE, REJECT, ABSTAIN as `A-R-X`; A + R + X = N

        Report votes in tabular form:
        | Model | Verdict | Confidence | Regression Risk | Patch Scope |
      </step>

      <step>
        Tally per <consensus_rules> — the counts A-R-X against the resolved N; the
        synthesizer's `VERDICT:` line is that word when it ran — then act on it:
        - STRONG → proceed to DOCUMENT (under --unanimous only when A = N; any
          other STRONG is handled as DIVERGENT)
        - REJECT + any REGRESSION_RISK:HIGH → block commit → AskUserQuestion:
          "Phase B review detected HIGH regression risk in this patch.
           Full verdicts: {table}. How would you like to proceed?"
        - REJECT + PATCH_SCOPE_ASSESSMENT:TOO_BROAD → return to PATCH for narrower fix →
          re-vote once (max 1 re-vote)
        - Still REJECT after re-vote → AskUserQuestion with all verdicts; require user decision
        - DIVERGENT → AskUserQuestion with full evidence; require user decision
        - A REJECT with no REGRESSION_RISK or PATCH_SCOPE_ASSESSMENT — the mapped
          internal report — matches neither field rule: AskUserQuestion with the
          report's CRITICAL and HIGH findings as the evidence; require user decision

        With MODELS "none", N = 1 and the mapped vote is the result: APPROVE (PASS)
        is STRONG and proceeds, REJECT (FAIL) is REJECT and goes to AskUserQuestion
        with the report's findings, and ABSTAIN — CONDITIONAL, a missing file, or a
        report with no `**Verdict**:` line — is DIVERGENT.
      </step>

      <step>
        Write ${SESSION_PATH}/patch-review.md with:
        - All vote file contents
        - Parsed verdicts table (Model | Verdict | Confidence | REGRESSION_RISK | PATCH_SCOPE_ASSESSMENT)
          — taken from patch-consolidated.md when the synthesizer ran; the internal
          row shows the mapped vote with the reviewer's verdict in parentheses
        - The tally `A-R-X`, N, the <consensus_rules> row it matched, and MODELS as resolved
        - Action taken (PROCEED | BLOCK | NARROW_AND_REVOTE | MANUAL_DECISION)
      </step>

      <step>Mark PHASE 6 (REVIEW-B) as completed</step>
    </steps>
    <output>${SESSION_PATH}/patch-review.md</output>
    <estimated_duration>2-4 minutes (including ~55s parallel vote)</estimated_duration>
  </phase>

  <phase number="7" name="MONITOR" optional="true">
    <objective>Detect error signature reduction in production after deployment</objective>
    <condition>Skip if SKIP_MONITOR=true (--no-monitor flag or downgrade offer accepted)</condition>
    <steps>
      <step>Mark PHASE 7 (MONITOR) as in_progress</step>

      <step name="tier-detection">
        Auto-detect monitoring tier from environment variables:
        ```bash
        if [ -n "$SENTRY_AUTH_TOKEN" ] && [ -n "$SENTRY_ISSUE_ID" ]; then
          echo "MONITORING_TIER=sentry"
        elif [ -n "$AWS_PROFILE" ] && [ -n "$AWS_LOG_GROUP" ]; then
          echo "MONITORING_TIER=cloudwatch"
        elif [ -n "$APP_LOG_PATH" ] && [ -f "$APP_LOG_PATH" ]; then
          echo "MONITORING_TIER=logfile"
        else
          echo "MONITORING_TIER=none"
        fi
        ```
      </step>

      <tier name="Tier 1 — Sentry" condition="SENTRY_AUTH_TOKEN and SENTRY_ISSUE_ID set">
        Capture pre-deploy baseline, then poll for error count reduction.
        Poll 9 times at 60s intervals (9 minutes max — within Bash 10-min timeout):
        ```bash
        BASELINE=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
          "https://sentry.io/api/0/issues/${SENTRY_ISSUE_ID}/" | jq '.count')
        echo "Baseline error count: ${BASELINE}"
        MONITORING_RESULT="TIMEOUT"
        for i in $(seq 1 9); do
          sleep 60
          COUNT=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
            "https://sentry.io/api/0/issues/${SENTRY_ISSUE_ID}/" | jq '.count')
          echo "Poll ${i}/9: count=${COUNT} baseline=${BASELINE}"
          if [ "$COUNT" -gt "$((BASELINE * 2))" ]; then
            MONITORING_RESULT="FAIL"
            break
          fi
          if [ "$COUNT" -le "$((BASELINE / 2))" ]; then
            MONITORING_RESULT="VERIFIED"
            break
          fi
        done
        echo "MONITORING_RESULT=${MONITORING_RESULT}"
        ```
      </tier>

      <tier name="Tier 2 — CloudWatch" condition="AWS_PROFILE and AWS_LOG_GROUP set">
        Start log insights query, poll for results. Same 9-poll / 60s limit:
        ```bash
        END_TIME=$(date +%s)
        START_TIME=$((END_TIME - 3600))
        ERROR_SIGNATURE="{error_signature_from_bug-report.md}"
        QUERY_ID=$(aws logs start-query \
          --log-group-name "$AWS_LOG_GROUP" \
          --start-time $START_TIME \
          --end-time $END_TIME \
          --query-string "fields @timestamp, @message | filter @message like /${ERROR_SIGNATURE}/" \
          --profile "$AWS_PROFILE" | jq -r '.queryId')
        for i in $(seq 1 9); do
          sleep 60
          RESULTS=$(aws logs get-query-results --query-id "$QUERY_ID" --profile "$AWS_PROFILE")
          COUNT=$(echo $RESULTS | jq '.results | length')
          echo "Poll ${i}/9: matching log entries = ${COUNT}"
        done
        ```
      </tier>

      <tier name="Tier 3 — Log file" condition="APP_LOG_PATH file exists">
        Compare pre/post deploy error counts in log file:
        ```bash
        PRE_COUNT=$(grep -c "{error_signature_from_bug-report.md}" "$APP_LOG_PATH" 2>/dev/null || echo 0)
        echo "Pre-deploy error occurrences in log: ${PRE_COUNT}"
        echo "Note: Re-run this grep after deployment to compare post-deploy count"
        echo "MONITORING_RESULT=SKIPPED (logfile tier requires manual post-deploy re-check)"
        ```
      </tier>

      <tier name="Tier 4 — None" condition="No monitoring env vars detected">
        Document reason and record outcome:
        ```
        No monitoring environment detected:
        - SENTRY_AUTH_TOKEN / SENTRY_ISSUE_ID: not set
        - AWS_PROFILE / AWS_LOG_GROUP: not set
        - APP_LOG_PATH: not set

        Fix is validated by test suite only. MONITORING_RESULT=SKIPPED.
        ```
      </tier>

      <step>
        Monitoring result outcomes and actions:
        - VERIFIED: error count drops >= 50% → report success with poll metrics
        - TIMEOUT: no change after 9 polls → document; user decides whether to continue watching
        - FAIL: error count increases → alert immediately; suggest: `git revert {commit_hash}`
        - SKIPPED: no monitoring environment → document reason; fix is test-suite-validated only
      </step>

      <step>Append monitoring outcome to ${SESSION_PATH}/validation-report.md</step>
      <step>Mark PHASE 7 (MONITOR) as completed</step>
    </steps>
    <estimated_duration>0-10 minutes depending on tier and outcome</estimated_duration>
  </phase>

  <phase number="8" name="DOCUMENT">
    <objective>Git commit with review-informed message; produce full fix session report</objective>
    <steps>
      <step>Mark PHASE 8 as in_progress</step>

      <step name="git-commit">
        Git commit — include key findings from root-cause.md and patch-review.md:
        ```bash
        # Stage exactly the paths Step 4e reviewed, MINUS what was already dirty
        # when the session started (Step 1a's snapshot). The capture script is the
        # only implementor of that range; a plain name-only diff against HEAD would
        # miss the reproduction test, which is still untracked at this point, and
        # a commit baseline alone would stage pre-session edits as if they were
        # the fix. An empty REPO/BASELINE makes the script exit 2, which the
        # `||` below turns into a STOP — no caller-side -z guard is needed here.
        REPO=$(jq -r '.repoPath // empty' "${SESSION_PATH}/session-meta.json")
        BASELINE=$(jq -r '.baselineCommit // empty' "${SESSION_PATH}/session-meta.json")
        DIRTY="${SESSION_PATH}/dirty-at-start.txt"
        [ -f "$DIRTY" ] \
          || { echo "STOP: ${DIRTY} missing — Step 1a did not run; staging without it would commit pre-session work" >&2; exit 1; }
        # Also exclude the session's OWN artifacts. Nothing guarantees ${SESSION_PATH}
        # is git-ignored in the repo /dev:fix runs in, and everything written since
        # Step 1a (root-cause.md, patch.diff, the reviews, this list) is untracked
        # at this point — it would be staged as part of the fix. A directory entry
        # excludes everything beneath it. Root-relative like every other line:
        # SESSION_PATH is relative to the cwd, which need not be the toplevel.
        SESSION_REL=$(cd "$SESSION_PATH" && pwd -P); SESSION_REL="${SESSION_REL#"$REPO"/}"
        grep -qxF "$SESSION_REL" "$DIRTY" || echo "$SESSION_REL" >> "$DIRTY"
        bun "${CLAUDE_PLUGIN_ROOT}/scripts/capture-review-surfaces.ts" \
          --repo "$REPO" --baseline "$BASELINE" --name-only --exclude-from "$DIRTY" \
          > "${SESSION_PATH}/changed-files.txt" \
          || { echo "STOP: capture failed; nothing staged" >&2; exit 1; }
        [ -s "${SESSION_PATH}/changed-files.txt" ] \
          || { echo "STOP: empty path list — git add over nothing is a silent no-op" >&2; exit 1; }

        # One path per line: deletions and both sides of a rename stage correctly
        git -C "$REPO" add --pathspec-from-file=- < "${SESSION_PATH}/changed-files.txt"

        # Commit with review-informed message
        # Same list as the add: a bare `git commit -m` commits the whole index, pre-session staging included
        git -C "$REPO" commit --pathspec-from-file=- -m "$(cat <<'COMMIT_MSG'
        fix({affected_component}): {one_sentence_root_cause}

        - Root cause: {root_cause statement from root-cause.md}
        - Reproduction test: {test_file_path from test-path.txt}
        - Patch scope: {PATCH_SCOPE_ASSESSMENT from patch-review.md, or "N/A — review skipped"}
        - Multimodel review: Phase A {APPROVE|SKIP}, Phase B {APPROVE|SKIP}
        - Session: {SESSION_BASE}
        COMMIT_MSG
        )" < "${SESSION_PATH}/changed-files.txt"
        ```
      </step>

      <step name="fix-report">
        Write ${SESSION_PATH}/fix-report.md:
        ```markdown
        # Fix Session Report

        ## Issue
        {BUG_DESCRIPTION}

        ## Root Cause
        {one sentence from root-cause.md}

        ## Fix Applied
        {what changed and why, from root-cause.md fix approach}

        ## Files Modified
        {contents of changed-files.txt — the capture-review-surfaces --name-only output}

        ## Not Committed
        {contents of dirty-at-start.txt — paths dirty before the session started, plus the
        session directory itself; none were committed. A path the user had already staged
        is left in the index as it was. "none" if only the session directory}

        ## Validation
        - Reproduction test: PASS
        - Full test suite: PASS
        - Quality checks: PASS
        - Monitoring: {VERIFIED|TIMEOUT|SKIPPED|FAIL}

        ## Review Results
        - Phase A (root cause): {consensus verdict or SKIPPED}
        - Phase B (patch quality): {consensus verdict or SKIPPED}

        ## Session Artifacts
        - Bug report:         {SESSION_PATH}/bug-report.md
        - Localization:       {SESSION_PATH}/localization.md
        - Root cause:         {SESSION_PATH}/root-cause.md
        - Patch diff:         {SESSION_PATH}/patch.diff
        - Root cause review:  {SESSION_PATH}/root-cause-review.md
        - Patch review:       {SESSION_PATH}/patch-review.md
        - Validation report:  {SESSION_PATH}/validation-report.md
        ```
      </step>

      <step>Mark ALL tasks as completed</step>
    </steps>
    <output>${SESSION_PATH}/fix-report.md, git commit</output>
    <estimated_duration>1-2 minutes</estimated_duration>
  </phase>

</instructions>

<failure_handling>
  All situations handled without panicking the workflow. Prefer AskUserQuestion over silent failure.

  | Situation | Response |
  |---|---|
  | Cannot reproduce bug | AskUserQuestion for more context (exact error message, reproduction steps, env) |
  | LOCALIZE finds 0 candidates | Widen keyword search in Strategy B; AskUserQuestion to ask user to point to suspect file |
  | Strategy A unavailable (no stack trace) | Fall back to Strategy B keyword grep; note reduced signal in localization.md |
  | Phase A DIVERGENT | Surface every diagnosis via AskUserQuestion; require manual hypothesis selection |
  | Phase A still REJECT after re-vote | AskUserQuestion with all vote outputs; require user to select or provide root cause |
  | RED test passes unexpectedly (Step 4b) | Return to Step 4a with: "Test passed unexpectedly — revise to correctly trigger the bug" |
  | GREEN test still fails after patch (Step 4d) | Return to Step 4c with failure output; max 2 iterations |
  | Full suite regression after patch | Return to PLAN with regression trace as additional context; max 2 iterations |
  | >3 files changed in patch diff | Note to user via inline comment in VALIDATE; optionally AskUserQuestion to confirm scope |
  | Phase B REJECT + REGRESSION_RISK:HIGH | Block commit; AskUserQuestion with all verdicts and severity |
  | Phase B REJECT + PATCH_SCOPE:TOO_BROAD | Regenerate narrower patch; re-vote once; if still REJECT → AskUserQuestion |
  | Phase B re-vote still REJECT | AskUserQuestion with full evidence; user decides |
  | Monitoring FAIL (error count increases) | Alert immediately; provide: `git revert {commit_hash}` |
  | Monitoring TIMEOUT after 9 polls | Document; user decides whether to continue watching |
  | claudish exit non-zero (external model) | Treat model as ABSTAIN with CONFIDENCE=0; note in review file; consensus proceeds with remaining votes |
  | claudish absent, or MODELS resolves to "none" | Each gate runs its internal voter alone and that verdict stands; no `team` call, no dev:synthesizer dispatch; record MODELS "none" in the review file |
  | `--models` names an id the catalog does not carry | Stop in Phase 0; show the id and the live alternatives from `list_models`; never substitute a near match or a lower version |
  | Internal Phase B report missing, or without a `**Verdict**:` line | ABSTAIN with CONFIDENCE=0 — never counted as agreement; with MODELS "none" that is DIVERGENT → AskUserQuestion |
  | Internal Phase B verdict CONDITIONAL | Maps to ABSTAIN; with MODELS "none" that is DIVERGENT → AskUserQuestion with the report's findings |
  | Internal Phase B verdict FAIL | Maps to REJECT; it carries no REGRESSION_RISK or PATCH_SCOPE field, so it goes to AskUserQuestion with the report's CRITICAL and HIGH findings |
  | Step 1a or Step 4e finds no repoPath/baselineCommit | STOP before any capture — the script would also exit 2 on the empty value; this stop names the step that did not run |
  | Tree already dirty at Step 1a | One line to the user, then continue; those paths are excluded from the commit, never stashed or committed |
  | `dirty-at-start.txt` missing at the commit step | STOP — Step 1a did not run; staging without the subtraction commits pre-session work |
</failure_handling>

<examples>
  <example name="Go nil pointer with monitoring — production-grade (auto-inferred from 'production' + 'critical')">
    <user_request>/dev:fix production panic: runtime error: invalid memory address in handlers/users.go:142 — critical</user_request>
    <execution>
      PHASE 0: No flags; establish dev-fix-{ts}-{rand} session; load dev:systematic-debugging;
        `which claudish` succeeds → MODELS = two reviewers from list_models
      PHASE 1 (REPRODUCE): stack-detector → Go; reproduce via: go test -run TestGetUser ./handlers/...
      PHASE 2 (LOCALIZE):
        Strategy A: handlers/users.go:142 — HIGH — direct stack frame
        Strategy B: repository/user.go:88 — MEDIUM — symbol match: db.QueryRow
        Strategy C: Expand GetUser handler (lines 130-178) and ScanUser method (lines 83-96)
        Context budget: ~3,200 tokens — under limit
      PHASE 3 (PLAN): debugger → root cause: db.QueryRow returns nil when user not found, no nil check before .Scan()
        Phase A review (3 models, parallel):
        | Model   | Verdict | Confidence | Root Cause |
        | Claude  | APPROVE | 9          | nil check missing before .Scan() |
        | Grok    | APPROVE | 8          | QueryRow nil dereference |
        | Qwen    | APPROVE | 7          | nil pointer on missing user |
        Tally 3-0-0, N=3 → STRONG (A = N) → proceed to PATCH
      PHASE 4 (PATCH):
        4a: developer writes TestGetUserNotFound — RED
        4b: CI=true go test -run TestGetUserNotFound → FAIL (confirmed RED)
        4c: developer adds nil check before .Scan() in handlers/users.go:142
        4d: CI=true go test -run TestGetUserNotFound → PASS (confirmed GREEN)
        4e: capture-review-surfaces.ts --baseline → patch.diff (22 lines — under 200, no summary needed)
      PHASE 5 (VALIDATE): go test ./... PASS, go vet PASS, golangci-lint PASS, gofmt PASS
        Downgrade offer: "All checks pass cleanly. Skip Phase B + monitoring?"
        User: "Full review + monitoring [RECOMMENDED]"
      PHASE 6 (REVIEW-B): team(run) launched for MODELS, then dev:reviewer foreground on
        TARGET patch.diff, writing its own report (Verdict: PASS); dev:synthesizer maps
        that to APPROVE and tallies the three files:
        | Model        | Verdict        | Confidence | REGRESSION_RISK | PATCH_SCOPE |
        | dev:reviewer | APPROVE (PASS) | —          | —               | —           |
        | Grok         | APPROVE        | 8          | LOW             | MINIMAL     |
        | Qwen         | APPROVE        | 8          | LOW             | MINIMAL     |
        Tally 3-0-0, N=3 → STRONG (A = N) → proceed to commit
      PHASE 7 (MONITOR): SENTRY_AUTH_TOKEN detected → poll starts
        Poll 1/9: count=42 baseline=48
        Poll 3/9: count=19 baseline=48 → drops >50% → MONITORING_RESULT=VERIFIED
      PHASE 8 (DOCUMENT): capture-review-surfaces.ts --name-only --exclude-from dirty-at-start.txt
        → changed-files.txt (handlers/users.go, handlers/users_test.go);
        git add --pathspec-from-file=- and git commit --pathspec-from-file=- over that
        same list; fix-report.md
    </execution>
  </example>

  <example name="Production-grade with --no-review --no-monitor flags (skips both gates)">
    <user_request>/dev:fix intermittent 500 on /api/orders POST --no-review --no-monitor</user_request>
    <execution>
      PHASE 0: Parse flags: SKIP_REVIEW=true, SKIP_MONITOR=true
              BUG_DESCRIPTION="intermittent 500 on /api/orders POST"
      PHASE 1 (REPRODUCE): Cannot reproduce deterministically (intermittent)
        AskUserQuestion: "Cannot reproduce. Provide log output from a failed request?"
        User provides log with DB connection timeout trace
      PHASE 2 (LOCALIZE): Strategy A (from log trace) + B identify handlers/orders.go and db/connection.go
      PHASE 3 (PLAN): debugger → root cause: connection pool exhausted under concurrent load
        Phase A: SKIPPED (SKIP_REVIEW=true)
      PHASE 4 (PATCH): RED test simulates N concurrent requests → FAIL; add pool timeout config → GREEN
      PHASE 5 (VALIDATE): All tests PASS; downgrade offer SKIPPED (SKIP_REVIEW already set)
      PHASE 6 (REVIEW-B): SKIPPED (SKIP_REVIEW=true)
      PHASE 7 (MONITOR): SKIPPED (SKIP_MONITOR=true)
      PHASE 8 (DOCUMENT): commit + fix-report.md
    </execution>
  </example>

  <example name="TypeScript React error with downgrade offer accepted">
    <user_request>/dev:fix TypeError: Cannot read properties of undefined (reading 'items') in OrderList.tsx:67</user_request>
    <execution>
      PHASE 0: No flags; establish session
      PHASE 1 (REPRODUCE): stack-detector → react-typescript; strategy A pulls OrderList.tsx:67
      PHASE 2 (LOCALIZE): Strategy A: OrderList.tsx:67 — HIGH; Strategy B: useOrders hook — MEDIUM
        Strategy C: expand renderItems function (lines 58-80)
      PHASE 3 (PLAN): debugger → root cause: useOrders returns undefined before data loads, no guard
        Phase A review: Claude APPROVE (9), Grok APPROVE (8), Qwen APPROVE (7) — tally 3-0-0 → STRONG
      PHASE 4 (PATCH):
        4a: Write test asserting loading state renders without crash — RED
        4b: Verify RED (test fails with TypeError)
        4c: Add loading guard: if (!orders) return null
        4d: Verify GREEN (test passes)
      PHASE 5 (VALIDATE): bun test PASS, bun run lint PASS, bun run typecheck PASS
        Downgrade offer: "All checks pass cleanly. Skip Phase B + monitoring?"
        User: "Skip to commit"
        → SKIP_REVIEW=true, SKIP_MONITOR=true
      PHASE 6 (REVIEW-B): SKIPPED (downgrade accepted)
      PHASE 7 (MONITOR): SKIPPED (downgrade accepted)
      PHASE 8 (DOCUMENT): git commit + fix-report.md
    </execution>
  </example>
</examples>

<formatting>
  <communication_style>
    - Announce session path at Phase 0 completion: "Session: {SESSION_BASE} | Path: {SESSION_PATH}"
    - Show phase transitions clearly: "Starting PHASE 3 (PLAN)..."
    - Report vote results in tabular form: Model | Verdict | Confidence | Key Fields
    - Explain the tally explicitly, counts first: "2-1-0 at N=3 — A/V = 2/3 → STRONG"
    - Show monitoring poll progress: "Poll 3/9: error count = 19 (baseline = 48)"
    - For downgrade offer: explain what gets skipped and what is retained
    - Be systematic and comprehensive — this is the production-grade path
    - Show quality check results individually, not just a single pass/fail
  </communication_style>

  <completion_message>
## Fix Complete

**Issue**: {BUG_DESCRIPTION}
**Root Cause**: {one sentence from root-cause.md}
**Fix Applied**: {what changed and why}

**Files Modified**:
- {file_1} ({change description})
- {file_2} ({change description})

**TDD Cycle**:
- Reproduction test (RED): WRITTEN — {test_file_path}
- RED verification: CONFIRMED FAIL
- Patch (GREEN): APPLIED
- GREEN verification: CONFIRMED PASS

**Validation**:
- Full test suite: PASS
- Quality checks: PASS (lint, typecheck, format)
- Regression status: NONE

**Multimodel Review**:
- Phase A (root cause): {STRONG | REJECT | DIVERGENT} ({A-R-X}, N={N}) | SKIPPED
- Phase B (patch quality): {STRONG | REJECT | DIVERGENT} ({A-R-X}, N={N}) | SKIPPED
- REGRESSION_RISK: {HIGH|MEDIUM|LOW | N/A}

**Monitoring**: {VERIFIED (Sentry/CloudWatch) | SKIPPED (no env vars) | TIMEOUT | FAIL}

**Commit**: {git commit hash}

**Session Artifacts**: {SESSION_PATH}
- bug-report.md, localization.md, root-cause.md, patch.diff
- root-cause-review.md, patch-review.md (+ patch-consolidated.md when MODELS was not "none"), validation-report.md, fix-report.md
  </completion_message>
</formatting>
