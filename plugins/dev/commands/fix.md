---
name: fix
description: Full agentic debugging workflow with multimodel review, TDD, and deployment monitoring
allowed-tools: Task, AskUserQuestion, Bash, Read, TaskCreate, TaskUpdate, TaskList, TaskGet, Glob, Grep, Write, Edit, Skill
skills: dev:systematic-debugging, dev:test-driven-development, dev:testing-strategies, dev:verification-before-completion, multimodel:quality-gates
---

<role>
  <identity>Agentic Bug-Fix Orchestrator</identity>
  <expertise>
    - 6-phase debugging state machine with quality gates
    - TDD-first patch application (RED → VERIFY RED → GREEN → REGRESS)
    - Multimodel consensus review at root cause and patch quality gates
    - Post-deployment monitoring with three-tier graceful degradation
    - Context-budget-aware fault localization (10K token cap)
  </expertise>
  <mission>
    Orchestrate systematic bug fixes using REPRODUCE → LOCALIZE → PLAN → PATCH →
    VALIDATE → [REVIEW-B] → [MONITOR], with optional multimodel review at PLAN (Phase A)
    and after full validation (Phase B). Use when the bug involves uncertain root cause,
    production-critical code paths, multi-file scope, or compliance requirements.
    For clear single-file bugs, consider /dev:quick-fix instead.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE FOR AGENT SELECTION.

  WHY: The CLAUDE.md routing table maps "Debugging" to code-analysis:detective and
  "Implementation" to dev:developer at the orchestrator level. This command manages
  its own multi-phase orchestration and must not be subject to generic routing rules.

  AGENT RULES FOR THIS COMMAND:
  - Stack detection → dev:stack-detector agent (subagent_type: "dev:stack-detector")
  - Error analysis and root cause → dev:debugger agent (subagent_type: "dev:debugger")
  - Test writing and patch application → dev:developer agent (subagent_type: "dev:developer")
  - Multimodel vote (internal Claude) → dev:debugger with EVALUATE ONLY instruction
  - Multimodel vote (external models) → Bash+claudish (NOT Task tool)
  - Post-deploy monitoring → inline Bash (dev:devops not actively delegated)

  DO NOT use code-analysis:detective (READ-ONLY — cannot apply fixes).
  DO NOT use dev:researcher (researches topics, does NOT debug code).
  DO NOT use Task tool for external models — use Bash+claudish exclusively.
</critical_override>

<instructions>
  <critical_constraints>
    <todowrite_requirement>
      You MUST use Tasks to track the fix workflow.

      Before starting, create todo list with all phases:
      0. Initialize (session setup, flag parsing)
      1. REPRODUCE (confirm bug, detect stack, capture error signature)
      2. LOCALIZE (3-strategy fault localization, context budget)
      3. PLAN (root cause analysis + Phase A multimodel review)
      4. PATCH (TDD: RED → VERIFY RED → GREEN, apply minimal fix)
      5. VALIDATE (full test suite + quality checks)
      6. REVIEW-B (multimodel patch quality vote — after full validation)
      7. MONITOR (optional 3-tier deployment monitoring)
      8. DOCUMENT (fix report + git commit)

      Update continuously as you progress. Mark each phase in_progress before starting it.
    </todowrite_requirement>

    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Use Task tool to delegate ALL debugging and patch work
      - Use Tasks to track investigation steps
      - Document findings systematically at each phase
      - Localize before fixing — the Iron Law from systematic-debugging skill

      **You MUST NOT:**
      - Write or edit code directly (delegate to dev:developer)
      - Apply fixes yourself (delegate to dev:developer)
      - Skip fault localization and jump straight to PLAN
      - Proceed to PATCH without root cause confirmation
    </orchestrator_role>

    <flag_parsing>
      Parse flags from $ARGUMENTS before starting Phase 0. Strip flags from the bug
      description — pass only the clean description to agents.

      Parsing rule: flags are tokens starting with "--" that appear before the first
      non-flag word, or after a "--" terminator. Everything after "--" is literal bug text.

      Recognized flags:
        --interactive   → INTERACTIVE=true   (human approval gate after PLAN)
        --no-review     → SKIP_REVIEW=true   (skip Phase A and Phase B multimodel gates)
        --unanimous     → CONSENSUS_MODE=unanimous  (require 3/3; default: 2/3 STRONG)
        --no-monitor    → SKIP_MONITOR=true  (skip Phase MONITOR)
    </flag_parsing>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Initialize">
      <objective>Establish session, parse flags, isolate bug description</objective>
      <steps>
        <step>Mark PHASE 0 as in_progress</step>
        <step>
          Create session directory:
          ```bash
          SESSION_BASE="dev-fix-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
          SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
          mkdir -p "${SESSION_PATH}"
          echo "Session: ${SESSION_BASE}"
          echo "Path: ${SESSION_PATH}"
          ```
        </step>
        <step>
          Parse flags from $ARGUMENTS:
          - Scan for --interactive, --no-review, --unanimous, --no-monitor
          - Set corresponding boolean variables
          - Remove flag tokens from the string to produce BUG_DESCRIPTION
          - Save parsed state to ${SESSION_PATH}/config.json:
            {"interactive": bool, "skip_review": bool, "unanimous": bool, "skip_monitor": bool}
        </step>
        <step>Mark PHASE 0 as completed</step>
      </steps>
      <output>SESSION_PATH established, BUG_DESCRIPTION isolated, flags captured</output>
      <estimated_duration>30 seconds</estimated_duration>
    </phase>

    <phase number="1" name="REPRODUCE">
      <objective>Confirm bug is reproducible; capture error signature for monitoring baseline</objective>
      <inputs>BUG_DESCRIPTION, any stack trace or error message from user input</inputs>
      <steps>
        <step>Mark PHASE 1 as in_progress</step>
        <step>
          Launch dev:stack-detector agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Detect technology stack, test runner, and test file patterns for this project.
          Bug description for context: {BUG_DESCRIPTION}

          Save results to: ${SESSION_PATH}/context.json
          Include: stack, test_runner_command, full_suite_args, test_file_patterns, lint_command, typecheck_command
          ```
        </step>
        <step>Read ${SESSION_PATH}/context.json to get test runner and stack info</step>
        <step>
          If reproduction steps are in BUG_DESCRIPTION, attempt reproduction:
          ```bash
          CI=true {test_runner} {test_args_from_bug_description}
          ```
        </step>
        <step>
          Search for existing failing tests matching error signature:
          ```bash
          # Grep test files for error message string
          grep -r "{error_keyword_from_description}" --include="*.test.*" --include="*_test.*" --include="*spec*" -l
          ```
        </step>
        <step>
          Write ${SESSION_PATH}/bug-report.md:
          ```markdown
          # Bug Report
          ## Error Signature
          {exact error message string — used for monitoring baseline}

          ## Stack Trace
          {if available from user input, else "Not provided"}

          ## Reproduction Path
          {commands or steps that trigger the bug, or "Confirmed via test: {path}"}

          ## Affected File Candidates
          {results from grep, or "None found — proceeding to localization"}

          ## Existing Failing Test
          {path to test if found, or "None found"}

          ## Test Runner
          {from context.json}

          ## Stack
          {from context.json}
          ```
        </step>
        <step>Mark PHASE 1 as completed</step>
      </steps>
      <decision_point>
        If bug cannot be confirmed reproducible after stack detection:
        - Invoke AskUserQuestion for more context (exact error message, reproduction steps)
        - Do not proceed to LOCALIZE without a confirmed reproduction path or error signature
      </decision_point>
      <output>${SESSION_PATH}/bug-report.md, ${SESSION_PATH}/context.json</output>
      <estimated_duration>1-3 minutes</estimated_duration>
    </phase>

    <phase number="2" name="LOCALIZE">
      <objective>Identify exact files and functions containing the bug using three-strategy localization</objective>
      <inputs>${SESSION_PATH}/bug-report.md, stack trace</inputs>
      <steps>
        <step>Mark PHASE 2 as in_progress</step>

        <step name="strategy-A">
          **Strategy A — Stack trace grep** (highest signal, attempt first):
          - Extract file:line references from stack trace using Grep/Read
          - Read those exact lines plus ±20 lines of surrounding context
          - Record candidate list: [{file, line_range, confidence: HIGH, reason}]
        </step>

        <step name="strategy-B">
          **Strategy B — BM25 keyword search** (broader coverage):
          - Extract error-related symbols from the error message and stack trace:
            function names, error strings, class names, identifiers
          - Use Grep to search codebase for each extracted symbol
          - Rank results by proximity to Strategy A hits (same file = higher rank)
          - Record candidate list: [{file, line_range, confidence: MEDIUM, reason}]
        </step>

        <step name="strategy-C">
          **Strategy C — AST context expansion** (depth):
          - From Strategy A+B hit files, expand to full function/class context
          - Use Read(offset, limit) with function boundary detection — never load entire files
          - Identify the owning function or class for each candidate line
          - Record expanded context
        </step>

        <step name="context-budget">
          **Context budget enforcement**:
          - If assembled context exceeds 10,000 tokens (estimate ~4 chars/token):
            discard lowest-confidence candidates and re-summarize
          - Target: context stays under 20% of context window
          - Never pass entire files to downstream agents — use line ranges only
        </step>

        <step name="large-repo">
          **Large codebase path** (if Grep returns >50 hits across >10 files):
          - Invoke code-analysis:claudemem-search skill via Skill tool
          - Pass error signature as semantic search query
          - Append high-confidence claudemem results to candidate list
        </step>

        <step>
          Write ${SESSION_PATH}/localization.md:
          ```markdown
          # Localization Report
          ## Top Candidates
          1. {file}: lines {range} — {confidence} — {reason}
          2. {file}: lines {range} — {confidence} — {reason}
          3. {file}: lines {range} — {confidence} — {reason}

          ## Alternative Locations
          {lower-ranked candidates if any}

          ## Context Budget
          Assembled: ~{N} tokens (target: <10,000)

          ## Strategy Coverage
          A (stack trace grep): {found N candidates}
          B (keyword search): {found N candidates}
          C (AST expansion): {expanded N functions}
          ```
        </step>
        <step>Mark PHASE 2 as completed</step>
      </steps>
      <output>${SESSION_PATH}/localization.md</output>
      <tools>Grep, Glob, Read (line-range), Skill (code-analysis:claudemem-search if needed)</tools>
      <estimated_duration>2-5 minutes</estimated_duration>
    </phase>

    <phase number="3" name="PLAN">
      <objective>Generate root cause hypothesis and fix approach; gate on multimodel consensus (Phase A)</objective>
      <inputs>${SESSION_PATH}/localization.md, ${SESSION_PATH}/bug-report.md</inputs>
      <steps>
        <step>Mark PHASE 3 as in_progress</step>
        <step>
          Launch dev:debugger agent with localized context:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Analyze this bug and produce a root cause analysis.

          Bug description: {BUG_DESCRIPTION}
          Stack trace: {from bug-report.md}
          Localization report: {contents of localization.md}
          Code excerpts (top candidates): {line-range excerpts within 10K token budget}

          Required output structure in ${SESSION_PATH}/root-cause.md:

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
        <step>Read ${SESSION_PATH}/root-cause.md to verify structure is complete</step>

        <review_gate name="Phase A — Root Cause Consensus" condition="unless SKIP_REVIEW=true">
          <steps>
            <step>
              Write vote prompt to ${SESSION_PATH}/vote-prompt-root-cause.md:
              ```markdown
              # Root Cause Review Request

              ## Bug Description
              {BUG_DESCRIPTION}

              ## Stack Trace
              {from bug-report.md}

              ## Localized Code Context (top 3 candidates, max 150 lines total)
              {code excerpts}

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
              Launch k=3 models in parallel using Bash tool with run_in_background:true:

              Model 1 (internal Claude — EVALUATE ONLY):
              ```
              Task(
                subagent_type: "dev:debugger",
                prompt: "Read ${SESSION_PATH}/vote-prompt-root-cause.md and respond with ONLY the vote schema.
                         IMPORTANT: EVALUATE the proposed root cause only. Do NOT propose alternative fixes.
                         Do NOT investigate further. Just vote on what is already proposed.
                         Save your vote to: ${SESSION_PATH}/claude-vote-root-cause.md",
                run_in_background: true
              )
              ```

              Model 2 (Grok — external via claudish):
              ```
              Bash(
                command: "claudish --model or@x-ai/grok-code-fast-1 --stdin --quiet < ${SESSION_PATH}/vote-prompt-root-cause.md > ${SESSION_PATH}/grok-vote-root-cause.md; echo $? > ${SESSION_PATH}/grok-vote-root-cause.exit",
                run_in_background: true
              )
              ```

              Model 3 (Qwen — external via claudish, free tier):
              ```
              Bash(
                command: "claudish --model or@qwen/qwen3-coder:free --stdin --quiet < ${SESSION_PATH}/vote-prompt-root-cause.md > ${SESSION_PATH}/qwen-vote-root-cause.md; echo $? > ${SESSION_PATH}/qwen-vote-root-cause.exit",
                run_in_background: true
              )
              ```
            </step>
            <step>
              After all background tasks complete, read vote files:
              - Read ${SESSION_PATH}/claude-vote-root-cause.md
              - Read ${SESSION_PATH}/grok-vote-root-cause.md
              - Read ${SESSION_PATH}/grok-vote-root-cause.exit (verify 0)
              - Read ${SESSION_PATH}/qwen-vote-root-cause.md
              - Read ${SESSION_PATH}/qwen-vote-root-cause.exit (verify 0)
            </step>
            <step>
              Parse votes with fault tolerance:
              - Extract VERDICT field (case-insensitive) from each model output
              - If a model output is missing required fields or malformed: treat as ABSTAIN with CONFIDENCE=0
              - If a claudish exit code is non-zero (model failed): treat that model as ABSTAIN
              - Count APPROVE, REJECT, ABSTAIN totals
            </step>
            <step>
              Apply consensus threshold:
              - STRONG (default): 2 of 3 APPROVE → proceed to PATCH
              - UNANIMOUS (--unanimous flag): 3 of 3 APPROVE → proceed to PATCH
              - REJECT cycle: extract ALTERNATIVE_HYPOTHESES from rejectors →
                re-delegate to dev:debugger with alternatives as additional context →
                re-vote (max 1 re-vote)
              - If still REJECT after re-vote: surface all diagnoses to user via
                AskUserQuestion; require manual hypothesis selection
              - DIVERGENT (<50% APPROVE after re-vote or initial): surface all 3
                diagnoses via AskUserQuestion; require manual selection
            </step>
            <step>
              Write ${SESSION_PATH}/root-cause-review.md with: all vote outputs,
              parsed verdicts, consensus result, action taken
            </step>
          </steps>
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
      <objective>Write failing reproduction test (RED), then apply minimal fix (GREEN)</objective>
      <inputs>${SESSION_PATH}/root-cause.md, ${SESSION_PATH}/context.json</inputs>
      <steps>
        <step>Mark PHASE 4 as in_progress</step>

        <step name="4a-red-test">
          **Step 4a — Write reproduction test (RED)**

          Launch dev:developer:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Write the smallest test that reproduces this bug. This is Step 1 (RED) of TDD.
          Bug: {BUG_DESCRIPTION}
          Root cause: {contents of root-cause.md}
          Test runner: {from context.json}
          Stack: {from context.json}

          Requirements:
          - Use exact error message or assertion matching the stack trace
          - Follow stack-specific naming conventions from the testing-strategies skill
          - Add regression comment in test:
            // REGRESSION: {BUG_DESCRIPTION} — Fixed in /fix session {SESSION_BASE}
          - Place test at appropriate level (unit/integration/E2E) per testing-strategies decision tree
          - Save the absolute path of the new test file to: ${SESSION_PATH}/test-path.txt
          - Do NOT fix the bug — write only the failing test
          ```
        </step>

        <step name="4b-verify-red">
          **Step 4b — Verify RED**

          ```bash
          CI=true {test_runner} $(cat ${SESSION_PATH}/test-path.txt)
          ```

          The test MUST fail. Verify:
          - Exit code is non-zero
          - Failure message matches expected error signature from bug-report.md

          If test passes (does not fail): the test does not reproduce the bug.
          Return to Step 4a with this feedback: "Test passed unexpectedly — revise to correctly trigger the bug."
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
          CI=true {test_runner} $(cat ${SESSION_PATH}/test-path.txt)
          ```

          The test MUST pass. If it still fails: return to Step 4c with failure output.
        </step>

        <step name="4e-capture-diff">
          **Step 4e — Capture patch diff**

          ```bash
          git diff > ${SESSION_PATH}/patch.diff
          ```

          If the diff exceeds 200 lines: create a summary file ${SESSION_PATH}/patch-summary.md
          listing changed files and the main hunks, keeping total vote prompt context manageable.
        </step>

        <step>Mark PHASE 4 as completed</step>
      </steps>
      <output>
        Applied patch, ${SESSION_PATH}/patch.diff, ${SESSION_PATH}/test-path.txt
      </output>
      <estimated_duration>5-10 minutes</estimated_duration>
    </phase>

    <phase number="5" name="VALIDATE">
      <objective>Full regression suite + quality checks; confirm no regressions introduced</objective>
      <inputs>${SESSION_PATH}/patch.diff, ${SESSION_PATH}/context.json</inputs>
      <steps>
        <step>Mark PHASE 5 as in_progress</step>

        <step name="5a-full-suite">
          **Step 5a — Full test suite**

          ```bash
          CI=true {test_runner} {full_suite_args_from_context.json}
          ```

          Required outcomes:
          - Reproduction test (from test-path.txt) PASSES
          - All pre-existing tests PASS
        </step>

        <step name="5b-quality-checks">
          **Step 5b — Stack quality checks**

          Run checks determined by stack from context.json:
          ```bash
          {lint_command}
          {typecheck_command}
          {format_check_command}
          ```
        </step>

        <step name="5c-regression-check">
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
          - Lint: {PASS|FAIL}
          - Type check: {PASS|FAIL}
          - Format: {PASS|FAIL}

          ## Regression Status: {NONE|DETECTED}
          {If regression: list failing tests and trace}
          ```
        </step>
        <step>Mark PHASE 5 as completed</step>
      </steps>
      <output>${SESSION_PATH}/validation-report.md</output>
      <estimated_duration>2-5 minutes</estimated_duration>
    </phase>

    <phase number="6" name="REVIEW-B">
      <objective>Multimodel patch quality review — runs AFTER full validation passes</objective>
      <condition>Skip if SKIP_REVIEW=true (--no-review flag)</condition>
      <inputs>${SESSION_PATH}/patch.diff, ${SESSION_PATH}/validation-report.md, ${SESSION_PATH}/test-path.txt</inputs>
      <steps>
        <step>Mark PHASE 6 (REVIEW-B) as in_progress</step>
        <step>
          Read reproduction test file (from test-path.txt) for inclusion in vote prompt.
          If patch.diff exceeds 200 lines, use patch-summary.md instead.
        </step>
        <step>
          Write vote prompt to ${SESSION_PATH}/vote-prompt-patch.md:
          ```markdown
          # Patch Quality Review Request

          ## Bug Description
          {BUG_DESCRIPTION}

          ## Reproduction Test
          {contents of test file from test-path.txt}

          ## Patch Diff (or summary if >200 lines)
          {contents of patch.diff or patch-summary.md}

          ## Validation Results
          Full test suite: PASS
          Quality checks: PASS

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
          Launch k=3 models in parallel using Bash tool with run_in_background:true:

          Model 1 (internal Claude — EVALUATE ONLY):
          ```
          Task(
            subagent_type: "dev:debugger",
            prompt: "Read ${SESSION_PATH}/vote-prompt-patch.md and respond with ONLY the vote schema.
                     IMPORTANT: EVALUATE the patch quality only. Do NOT propose alternative patches.
                     Do NOT investigate further. Just vote on the patch as presented.
                     Save your vote to: ${SESSION_PATH}/claude-vote-patch.md",
            run_in_background: true
          )
          ```

          Model 2 (Grok):
          ```
          Bash(
            command: "claudish --model or@x-ai/grok-code-fast-1 --stdin --quiet < ${SESSION_PATH}/vote-prompt-patch.md > ${SESSION_PATH}/grok-vote-patch.md; echo $? > ${SESSION_PATH}/grok-vote-patch.exit",
            run_in_background: true
          )
          ```

          Model 3 (Qwen — free tier):
          ```
          Bash(
            command: "claudish --model or@qwen/qwen3-coder:free --stdin --quiet < ${SESSION_PATH}/vote-prompt-patch.md > ${SESSION_PATH}/qwen-vote-patch.md; echo $? > ${SESSION_PATH}/qwen-vote-patch.exit",
            run_in_background: true
          )
          ```
        </step>
        <step>
          After all background tasks complete, read vote files:
          - Read ${SESSION_PATH}/claude-vote-patch.md
          - Read ${SESSION_PATH}/grok-vote-patch.md + .exit
          - Read ${SESSION_PATH}/qwen-vote-patch.md + .exit
        </step>
        <step>
          Parse votes with fault tolerance:
          - Extract VERDICT, REGRESSION_RISK, PATCH_SCOPE_ASSESSMENT (case-insensitive)
          - Malformed output or non-zero claudish exit → treat as ABSTAIN with CONFIDENCE=0
          - Count APPROVE, REJECT, ABSTAIN
        </step>
        <step>
          Apply consensus and escalation rules:
          - APPROVE (threshold met): proceed to git commit in DOCUMENT phase
          - REJECT + any REGRESSION_RISK:HIGH: block commit → AskUserQuestion:
            "Phase B review detected HIGH regression risk. Provide verdict and next step."
          - REJECT + PATCH_SCOPE:TOO_BROAD: return to PATCH to generate narrower fix → re-vote (max 1)
          - If still REJECT after re-vote: AskUserQuestion with all verdicts; require user decision
          - DIVERGENT (<50% APPROVE): AskUserQuestion with all verdicts; require user decision
        </step>
        <step>
          Write ${SESSION_PATH}/patch-review.md with: all vote outputs,
          parsed verdicts, REGRESSION_RISK values, consensus result, action taken
        </step>
        <step>Mark PHASE 6 (REVIEW-B) as completed</step>
      </steps>
      <output>${SESSION_PATH}/patch-review.md</output>
      <estimated_duration>2-4 minutes (including ~55s parallel vote)</estimated_duration>
    </phase>

    <phase number="7" name="MONITOR" optional="true">
      <objective>Detect error signature reduction in production after deployment</objective>
      <condition>Skip if SKIP_MONITOR=true (--no-monitor flag). Auto-detect tier from env vars.</condition>
      <steps>
        <step>Mark PHASE 7 (MONITOR) as in_progress</step>
        <step>
          Detect monitoring tier:
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

        <tier name="sentry" condition="SENTRY_AUTH_TOKEN and SENTRY_ISSUE_ID set">
          Capture pre-deploy baseline, then poll for error count reduction.
          Poll 9 times at 60s intervals (max 9 minutes — within Bash 10-min timeout):
          ```bash
          BASELINE=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
            "https://sentry.io/api/0/issues/${SENTRY_ISSUE_ID}/" | jq '.count')
          for i in $(seq 1 9); do
            sleep 60
            COUNT=$(curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
              "https://sentry.io/api/0/issues/${SENTRY_ISSUE_ID}/" | jq '.count')
            echo "Poll ${i}/9: count=${COUNT} baseline=${BASELINE}"
            if [ "$COUNT" -le "$((BASELINE / 2))" ]; then
              echo "MONITORING_RESULT=VERIFIED"
              break
            fi
          done
          ```
        </tier>

        <tier name="cloudwatch" condition="AWS_PROFILE and AWS_LOG_GROUP set">
          Start log insights query, poll for results. Same 9-poll / 60s limit:
          ```bash
          END_TIME=$(date +%s)
          START_TIME=$((END_TIME - 3600))
          QUERY_ID=$(aws logs start-query \
            --log-group-name "$AWS_LOG_GROUP" \
            --start-time $START_TIME \
            --end-time $END_TIME \
            --query-string "fields @timestamp, @message | filter @message like /{ERROR_SIGNATURE}/" \
            --profile "$AWS_PROFILE" | jq -r '.queryId')
          # Poll up to 9 times, 60s intervals
          for i in $(seq 1 9); do
            sleep 60
            RESULTS=$(aws logs get-query-results --query-id "$QUERY_ID" --profile "$AWS_PROFILE")
            echo "Poll ${i}/9: results count=$(echo $RESULTS | jq '.results | length')"
          done
          ```
        </tier>

        <tier name="logfile" condition="APP_LOG_PATH file exists">
          Compare pre/post deploy error counts in log file. No polling needed — single check:
          ```bash
          PRE_COUNT=$(grep -c "{ERROR_SIGNATURE}" "$APP_LOG_PATH" 2>/dev/null || echo 0)
          echo "Pre-deploy error count: $PRE_COUNT"
          echo "Monitoring: compare manually after deployment or re-run to check post-deploy count"
          ```
        </tier>

        <tier name="none" condition="No monitoring env vars detected">
          Document reason: no SENTRY_AUTH_TOKEN/SENTRY_ISSUE_ID, no AWS_PROFILE/AWS_LOG_GROUP,
          no APP_LOG_PATH. Fix is validated by test suite only.
        </tier>

        <step>
          Monitoring result outcomes:
          - VERIFIED: error count drops ≥50% → report success with metrics
          - TIMEOUT: no change after 9 polls → document; user decides whether to continue watching
          - FAIL: error count increases → alert immediately; suggest: git revert {commit_hash}
          - SKIPPED: no monitoring environment → document reason
        </step>
        <step>Append monitoring outcome to ${SESSION_PATH}/validation-report.md</step>
        <step>Mark PHASE 7 (MONITOR) as completed</step>
      </steps>
      <estimated_duration>0-10 minutes depending on tier and outcome</estimated_duration>
    </phase>

    <phase number="8" name="DOCUMENT">
      <objective>Git commit with review-informed message; produce fix session report</objective>
      <steps>
        <step>Mark PHASE 8 as in_progress</step>
        <step>
          Git commit — include key findings from patch-review.md in commit message:
          ```bash
          # Get list of changed files
          git diff --name-only HEAD

          # Commit with informative message derived from root-cause.md + patch-review.md
          # Message format:
          #   fix({affected_component}): {one_sentence_root_cause}
          #
          #   - Reproduction test added: {test_file_path}
          #   - Root cause: {root_cause statement}
          #   - Patch scope: {MINIMAL|ACCEPTABLE} (multimodel consensus)
          #   - Review: Phase A {APPROVE/SKIP}, Phase B {APPROVE/SKIP}
          #   - Session: {SESSION_BASE}
          git add {changed_files}
          git commit -m "$(cat <<'COMMIT_MSG'
          fix({component}): {root_cause_one_sentence}

          - Root cause: {from root-cause.md}
          - Reproduction test: {test_file_path}
          - Patch scope: {PATCH_SCOPE_ASSESSMENT from patch-review.md}
          - Multimodel review: Phase A {verdict}, Phase B {verdict}
          - Session artifacts: {SESSION_PATH}
          COMMIT_MSG
          )"
          ```
        </step>
        <step>
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
          {git diff --name-only output}

          ## Validation
          - Reproduction test: PASS
          - Full test suite: PASS
          - Quality checks: PASS
          - Monitoring: {VERIFIED|TIMEOUT|SKIPPED|FAIL}

          ## Review Results
          - Phase A (root cause): {consensus verdict or SKIPPED}
          - Phase B (patch quality): {consensus verdict or SKIPPED}

          ## Session Artifacts
          - Bug report: ${SESSION_PATH}/bug-report.md
          - Localization: ${SESSION_PATH}/localization.md
          - Root cause: ${SESSION_PATH}/root-cause.md
          - Patch diff: ${SESSION_PATH}/patch.diff
          - Root cause review: ${SESSION_PATH}/root-cause-review.md
          - Patch review: ${SESSION_PATH}/patch-review.md
          - Validation: ${SESSION_PATH}/validation-report.md
          ```
        </step>
        <step>Mark ALL tasks as completed</step>
      </steps>
      <output>${SESSION_PATH}/fix-report.md, git commit</output>
      <estimated_duration>1-2 minutes</estimated_duration>
    </phase>
  </workflow>

  <failure_handling>
    | Situation | Response |
    |---|---|
    | Cannot reproduce bug | AskUserQuestion for more context; offer manual reproduction steps |
    | LOCALIZE finds 0 candidates | Widen keyword search; AskUserQuestion to ask user to point to suspect file |
    | Phase A DIVERGENT (<50% APPROVE after re-vote) | Surface all 3 diagnoses via AskUserQuestion; require manual selection |
    | Phase B REJECT + REGRESSION_RISK:HIGH | Block commit; AskUserQuestion with all verdicts and severity |
    | Phase B REJECT + PATCH_SCOPE:TOO_BROAD | Regenerate narrower patch; re-vote once; if still REJECT → AskUserQuestion |
    | Phase B re-vote still REJECT | AskUserQuestion with full evidence; user decides |
    | Full suite regression after patch | Return to PLAN with regression trace; max 2 iterations before user escalation |
    | >3 files in patch diff | Warn user via AskUserQuestion; confirm scope before proceeding |
    | Monitoring FAIL (error increases) | Alert immediately; suggest git revert {commit_hash} |
    | Monitoring TIMEOUT after 9 polls | Document; user decides whether to continue watching |
    | claudish exit non-zero for external model | Treat model as ABSTAIN; note in review file; consensus proceeds with remaining votes |
  </failure_handling>
</instructions>

<examples>
  <example name="Go nil pointer with monitoring">
    <user_request>/dev:fix panic: runtime error: invalid memory address or nil pointer dereference in handlers/users.go:142</user_request>
    <execution>
      PHASE 0: Parse flags (none), establish session
      PHASE 1 (REPRODUCE): stack-detector detects Go, confirm panic via go test -run TestGetUser
      PHASE 2 (LOCALIZE): Strategy A finds handlers/users.go:142 (HIGH), Strategy B finds repository/user.go:88 (MEDIUM)
      PHASE 3 (PLAN): debugger → root cause: db.QueryRow returns nil when user not found, no nil check before .Scan()
        Phase A review: Claude APPROVE, Grok APPROVE, Qwen APPROVE → UNANIMOUS consensus
      PHASE 4 (PATCH): developer writes RED test (TestGetUserNotFound), verifies RED, adds nil check → GREEN
      PHASE 5 (VALIDATE): go test ./... PASS, go vet PASS, golangci-lint PASS
      PHASE 6 (REVIEW-B): Claude APPROVE (MINIMAL scope), Grok APPROVE, Qwen APPROVE (REGRESSION_RISK:LOW)
      PHASE 7 (MONITOR): SENTRY_AUTH_TOKEN set → poll 3/9 polls, error count drops 90% → VERIFIED
      PHASE 8 (DOCUMENT): git commit with root cause message, fix-report.md written
    </execution>
  </example>

  <example name="React TypeError with --no-review --no-monitor">
    <user_request>/dev:fix TypeError: Cannot read property 'map' of undefined in UserList component --no-review --no-monitor</user_request>
    <execution>
      PHASE 0: Parse flags: SKIP_REVIEW=true, SKIP_MONITOR=true
      PHASE 1 (REPRODUCE): stack-detector detects React/TypeScript
      PHASE 2 (LOCALIZE): Strategy A: UserList.tsx:34, Strategy B: useUsers hook, Strategy C: full component context
      PHASE 3 (PLAN): debugger → root cause: useUsers returns undefined before fetch completes, no loading guard
        Phase A: SKIPPED (--no-review)
      PHASE 4 (PATCH): developer writes RED test, verifies RED, adds loading guard → GREEN
      PHASE 5 (VALIDATE): bun test PASS, bun run lint PASS, bun run typecheck PASS
      PHASE 6 (REVIEW-B): SKIPPED (--no-review)
      PHASE 7 (MONITOR): SKIPPED (--no-monitor)
      PHASE 8 (DOCUMENT): git commit, fix-report.md written
    </execution>
  </example>

  <example name="Uncertain root cause requiring human gate">
    <user_request>/dev:fix intermittent 500 on /api/orders POST --interactive</user_request>
    <execution>
      PHASE 0: Parse flags: INTERACTIVE=true
      PHASE 1 (REPRODUCE): Attempt reproduction — cannot confirm deterministically (intermittent)
        AskUserQuestion: "Cannot reproduce deterministically. Provide: log output from a failed request?"
        User provides log with DB timeout trace
      PHASE 2 (LOCALIZE): Strategy A + B identify handlers/orders.go and db/connection.go
      PHASE 3 (PLAN): debugger → root cause: connection pool exhausted under concurrent load, no timeout config
        Phase A review: Claude APPROVE, Grok REJECT (alternative: deadlock in transaction), Qwen APPROVE → STRONG consensus
        Human gate: AskUserQuestion → user selects "Proceed with patch"
      PHASE 4 (PATCH): RED test simulates concurrent requests, GREEN adds pool timeout config
      PHASE 5 (VALIDATE): All tests PASS
      PHASE 6 (REVIEW-B): All 3 APPROVE, REGRESSION_RISK:LOW, PATCH_SCOPE:MINIMAL
      PHASE 7 (MONITOR): AWS_LOG_GROUP set → CloudWatch query, 5/9 polls, error rate drops 75% → VERIFIED
      PHASE 8 (DOCUMENT): commit + fix-report.md
    </execution>
  </example>
</examples>

<formatting>
  <communication_style>
    - Show phase transitions clearly ("Starting PHASE 3 (PLAN)...")
    - Report vote results in tabular form: Model | Verdict | Confidence | Key Fields
    - Explain consensus calculation explicitly
    - Show monitoring poll progress: "Poll 3/9: error count = N (baseline = M)"
    - Report any model failures or ABSTAIN treatments with reason
  </communication_style>

  <completion_message>
## Fix Session Complete

**Issue**: {BUG_DESCRIPTION}
**Root Cause**: {one sentence}
**Fix Applied**: {what changed}

**Files Modified**:
- {file_1}
- {file_2}

**Validation**:
- Reproduction test: PASS
- Full test suite: PASS
- Quality checks: PASS
- Monitoring: {VERIFIED|TIMEOUT|SKIPPED|FAIL}

**Multimodel Review**:
- Phase A (root cause): {verdict or SKIPPED}
- Phase B (patch quality): {verdict or SKIPPED}
- REGRESSION_RISK: {HIGH|MEDIUM|LOW or N/A}

**Commit**: {git commit hash}

**Session Artifacts**: {SESSION_PATH}
- bug-report.md, localization.md, root-cause.md, patch.diff
- root-cause-review.md, patch-review.md, validation-report.md, fix-report.md
  </completion_message>
</formatting>
