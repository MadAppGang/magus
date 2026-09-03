---
name: audit
description: "Structured quality audit — routes to specialist reviewers for code, UI, docs, security, or plugin quality"
allowed-tools:  Agent, AskUserQuestion, Bash, Read, mcp__plugin_claudish_claudish__team, mcp__plugin_claudish_claudish__list_models, mcp__plugin_claudish_claudish__search_models
skills: dev:context-detection
---

<role>
  <identity>Review Router</identity>
  <mission>
    Progressive disclosure entry point for code and quality review. Infers the
    scope, resolves the contract lines, checks what is installed, and dispatches
    the specialist for that scope. It carries no review text of its own.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE.
  WHY: This is a READ-ONLY router. It must NEVER self-handle review work.
  RULE: ALL review work is delegated via the Agent tool to the agent the scope
  resolves to, with the contract lines below and nothing else in the prompt.
  NEVER: Review code, assess quality, provide feedback inline, or restate a
  reviewer's checklist in the prompt — the reviewer owns its own rules.
  EXCEPTION: the design-system scope hands off to the `/dev:design-system`
  command instead of an agent — that scope is script-driven measurement,
  not subjective review, and the command owns its own workflow.
</critical_override>

<disambiguation>
  This is the dev plugin's multi-scope quality audit command.
  For PR-specific diff review, use Claude Code's built-in /code-review command instead.
</disambiguation>

<value_banner>
  Display this ONCE at the start of the command (not on subsequent uses in same session):

  **`/dev:audit` — Multi-Scope Quality Audit**
  Beyond Claude's built-in `/code-review` (PR diff review), this command adds:
  - 6 audit scopes: code quality, UI/design, design system, documentation, security, plugin/agent
  - Routes to specialist reviewers (`dev:reviewer`, `designer:design-review`, `dev:docs`)
  - Design-system drift measured by a bundled auditor via `/dev:design-system`
  - Multi-model when you name models and claudish is installed — the internal reviewer always runs, externals are additive
  - One output shape on every route: a consolidated report ending in a `VERDICT:` line
  - Structured reports with severity levels (CRITICAL/HIGH/MEDIUM/LOW)
  - Plugin-aware: detects and uses the designer plugin when installed

  *For PR-specific diff review, use the built-in `/code-review` command.*
</value_banner>

<instructions>
  <workflow>
    <step number="1" name="Scope">
      Infer scope from $ARGUMENTS if clear, otherwise ask (AskUserQuestion):

      question: "What kind of review do you want?"
      header: "Review Scope"
      options:
        - label: "Code quality"
          description: "Correctness, patterns, maintainability, best practices"
        - label: "UI / design"
          description: "Visual implementation against a design spec"
        - label: "Design system"
          description: "Token-only styling, one component library, variants over call-site restyling — measured, not read"
        - label: "Documentation"
          description: "Accuracy, completeness, clarity of docs"
        - label: "Security"
          description: "Vulnerability scan, auth patterns, input validation, dependencies, secrets"
        - label: "Plugin or agent"
          description: "Quality of Claude Code agent design or command"

      Inference rules (skip AskUserQuestion if match is confident):
      - "code", "pr", "pull request", "function", "class", "method", "module" → code
      - "ui", "design", "visual", "figma", "component", "layout", "pixel" → ui
      - "design system", "design-system", "guardrails", "tokens", "theme", "storybook",
        "variants", "hardcoded color", "style drift", "consistency" → design-system
      - "docs", "readme", "documentation", "comments", "docstring", "jsdoc" → docs
      - "security", "auth", "vulnerability", "injection", "csrf", "xss", "jwt" → security
      - "agent", "plugin", "command", "skill", "prompt" → plugin
    </step>

    <step number="2" name="Models">
      Resolve `MODELS:` — the one contract line this command owns outright.

      1. Did the user name models? Look in $ARGUMENTS for `--models a,b,c` or a
         phrase naming external models ("with grok and gemini", "get kimi's view").
      2. Is claudish present?
         ```bash
         which claudish >/dev/null 2>&1
         ```
         Presence is the claudish runtime — the binary above, or the
         `mcp__plugin_claudish_claudish__team` tool being registered in this
         session. It is never "is the multimodel plugin installed": `dev` may
         depend on the claudish runtime and may not depend on the multimodel
         orchestration plugin.
      3. Both true → resolve each name against the live catalog: `list_models`
         first, then `search_models` for a family it does not cover — the
         procedure in `claudish:claudish-usage`, "Model Alias Resolution". A
         version the user names is a hard constraint: if it is not in the
         catalog, say so and show the live alternatives; never substitute a lower
         version. The result is `MODELS: <bare catalog ids, comma-separated>`.
      4. Otherwise `MODELS: none`. If models were named but claudish is absent,
         tell the user once — "claudish is not installed; running the internal
         reviewer only" — and continue. The internal reviewer is never optional
         and never waits on an external one.

      `MODELS:` applies only to rows that dispatch `dev:reviewer`. The designer,
      docs and design-system rows have no multi-model story; do not attach it
      to them.
    </step>

    <step number="3" name="Route and Dispatch">
      **design-system does not delegate.** Hand off to `/dev:design-system`, passing
      $ARGUMENTS through. That scope checks system integrity — token-only styling, one
      component library, variants over call-site restyling — with the bundled auditor,
      not a subjective read of the code. Stop here for that scope.

      **ui may re-route.** If the request is about design-system integrity (tokens,
      drift, duplicated components, missing variants) rather than visual fidelity to a
      spec, treat it as design-system above.

      Presence checks — the only two this plugin makes, both in CLI syntax:
      ```bash
      claude plugin list 2>/dev/null | grep -q "designer@"   # designer plugin installed?
      which claudish >/dev/null 2>&1                          # claudish runtime present?
      ```
      `claude plugin list` prints one `❯ <name>@<marketplace>` entry per installed
      plugin, so `designer@` matches the plugin whichever marketplace it came from.
      The listing includes disabled installs; if the dispatch then fails with an
      unknown agent, the plugin is installed but disabled — say so.

      Then pick the row:

      | Scope | Agent | Contract lines in the prompt — and nothing else |
      |---|---|---|
      | code | `dev:reviewer` | `TARGET: <file paths from $ARGUMENTS, or BRANCH>` / `FOCUS: code` |
      | ui, designer present | `designer:design-review` | its own inputs: `REFERENCE_SOURCE: <the reference named in $ARGUMENTS>` / `IMPL_SOURCE: <the implementation named in $ARGUMENTS>` / `OUTPUT_DIR: ${AUDIT_PATH}/claude-internal` |
      | ui, designer absent | `dev:reviewer` | `TARGET: <component paths>` / `FOCUS: ui-degraded` — and tell the *user*, not the reviewer: "Designer plugin not installed; reviewing the UI from code only. For pixel-diff comparison, install designer@magus." |
      | docs | `dev:docs` | "mode=analyze" in the prompt body — `mode` is not an Agent parameter and is silently dropped if passed as one — and `SESSION_PATH: ${AUDIT_PATH}`, which is where it writes its report |
      | security | `dev:reviewer` | `TARGET: <paths, or BRANCH>` / `FOCUS: security` |
      | plugin | `dev:reviewer` | `TARGET: <agent, command or skill paths>` / `FOCUS: plugin` |

      The reviewer owns what each `FOCUS:` value means — the checklist, the
      severity scale, the thresholds. This command never restates them: a second
      copy in a dispatcher drifts on its own and overrides the reviewer's with a
      stale one.

      **Every row but design-system ends the same way, whatever agent it dispatched**:
      the reviewer persists its report to a run directory, any externals persist
      theirs beside it, and `dev:synthesizer` writes the one file this command relays.
      With one review the synthesizer passes it through and appends the verdict line;
      with several it merges them. The output has one shape on every route — a file
      ending in `VERDICT:` — so nothing downstream has to know which agent reviewed
      or whether claudish was present. The designer and docs rows take no `MODELS:`,
      so for them N is always 1; they go through the synthesizer anyway, because the
      verdict line and the output shape have one writer, and a route that relays raw
      agent output is a second shape.

      1. Make a run directory. When `MODELS:` names models (`dev:reviewer` rows
         only), also write the brief the externals will run:
         ```bash
         AUDIT_PATH="ai-docs/sessions/dev-audit-$(date +%Y%m%d-%H%M%S)"
         mkdir -p "$AUDIT_PATH"
         cat > "$AUDIT_PATH/prompt.md" <<'BRIEF_EOF'      # only when MODELS names models
         TARGET: {…}
         FOCUS: {…}
         MODELS: none
         This is READ-ONLY analysis. Do not modify any files.
         Return the full report.
         BRIEF_EOF
         ```
         The externals get the same brief the internal reviewer gets. They run as
         `dev:reviewer` too, so `MODELS: none` in the file is correct: a reviewer
         mentions externals only when told of them, and no reviewer launches other
         reviewers.

      2. Launch the review, foreground. Which call depends on the row:

         **`dev:reviewer` rows** — the internal reviewer, and, when `MODELS:` names
         models, the externals in the SAME message:
         ```
         Agent(
           subagent_type: "dev:reviewer",
           run_in_background: false,
           description: "Audit: {scope} — internal reviewer",
           prompt: "TARGET: {…}
                    FOCUS: {…}
                    OUTPUT: ${AUDIT_PATH}/claude-internal.md
                    MODELS: {none, or a,b,c}
                    This is READ-ONLY analysis. Do not modify any files.
                    Persist the full report to OUTPUT with a Bash heredoc, then return a brief summary."
         )
         ---                                                # only when MODELS names models
         claudish team(mode="run", path="${AUDIT_PATH}",
           models=[a, b, c],
           agent="dev:reviewer",
           input_file="${AUDIT_PATH}/prompt.md",
           require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)",
           min_output_bytes=400)
         ```
         `require_pattern` is the line the reviewer's report format mandates, so a
         slot that exited 0 with a shapeless or empty response is reported FAILED
         instead of joining the count as a reviewer that found nothing.

         **ui, designer present** — `designer:design-review` reads no `OUTPUT:` line.
         It takes `OUTPUT_DIR` and writes its report, `summary.md`, into that
         directory beside the images and JSON it measured. It creates that directory
         itself only when it was given none, so make it before the dispatch:
         ```bash
         mkdir -p "$AUDIT_PATH/claude-internal"
         ```
         ```
         Agent(
           subagent_type: "designer:design-review",
           run_in_background: false,
           description: "Audit: ui — design review",
           prompt: "REFERENCE_SOURCE: {the reference named in $ARGUMENTS — Figma URL, image path or browser URL}
                    IMPL_SOURCE: {the implementation named in $ARGUMENTS — URL or image path}
                    OUTPUT_DIR: ${AUDIT_PATH}/claude-internal
                    This is READ-ONLY analysis of the two sources named. Write only under OUTPUT_DIR."
         )
         ```
         The review is `${AUDIT_PATH}/claude-internal/summary.md`.

         **docs** — `dev:docs` in analyze mode writes `analysis-report.md` under the
         `SESSION_PATH` it is given:
         ```
         Agent(
           subagent_type: "dev:docs",
           run_in_background: false,
           description: "Audit: docs — {target in five words}",
           prompt: "mode=analyze
                    SESSION_PATH: ${AUDIT_PATH}
                    Documentation to analyze: {paths from $ARGUMENTS}
                    This is READ-ONLY analysis. Do not modify any files.
                    Write the full report to ${AUDIT_PATH}/analysis-report.md, then return a brief summary."
         )
         ```
         The review is `${AUDIT_PATH}/analysis-report.md`.

      3. Externals only (`dev:reviewer` rows with models): `run` returns as soon as
         the slots start. Poll `claudish team(mode="status", path="${AUDIT_PATH}")`
         until no slot in `models` has `state === "RUNNING"`; bound the loop and
         report any slot still running or FAILED rather than waiting on it.
         Procedure: `claudish:claudish-usage` → "The three-step lifecycle".

      4. Consolidate — always, on every row, never inline, never by a reviewer:
         ```
         Agent(
           subagent_type: "dev:synthesizer",
           run_in_background: false,
           description: "Consolidate {scope} review",
           prompt: "REVIEWS: {the row's review paths from the table below, one per line}
                    THRESHOLDS: {the row's rule from the table below, quoted verbatim
                                 from the reviewer's own file — read it now, never
                                 recall it}
                    OUTPUT: ${AUDIT_PATH}/consolidated.md
                    Compute the verdict line from the reviews' own measure against
                    THRESHOLDS and emit the word THRESHOLDS names.
                    You are given reviews, never code. Do not review."
         )
         ```

         | Row | `REVIEWS:` | `THRESHOLDS:` — the reviewer's own scale, by reference |
         |---|---|---|
         | every `dev:reviewer` row | `${AUDIT_PATH}/claude-internal.md`, then `${AUDIT_PATH}/response-<slot>.md` per slot that completed (none when `MODELS:` was none) | the three lines under "Apply verdict thresholds" in `${CLAUDE_PLUGIN_ROOT}/agents/reviewer.md`, Phase 5 — PASS / CONDITIONAL / FAIL over severity counts |
         | ui, designer present | `${AUDIT_PATH}/claude-internal/summary.md` | the four difference-percentage rows under `severity_thresholds` in `designer:design-review`'s agent file — PASS / WARN / FAIL / CRITICAL over the diff percentage |
         | docs | `${AUDIT_PATH}/analysis-report.md` | the four lines under "Determine verdict" in `${CLAUDE_PLUGIN_ROOT}/agents/docs.md`, Generate Report — PASS / GOOD / NEEDS_WORK / FAIL over the 52-point score |

         The synthesizer emits the word the row's rule names — WARN for a design
         review, NEEDS_WORK for docs — never a code-review word for a row that did
         not quote the code reviewer. With one review it writes that review
         unchanged plus the `VERDICT:` line; with several it merges them with
         consensus levels. Either way `consolidated.md` is the audit's output —
         relay it to the user. The review files beside it are the evidence behind it.

      `run_in_background: false` is required on every Agent call here. This command
      reports the findings back to the user in the same turn, and a background spawn
      returns a launch receipt rather than the report. Background also narrows the
      agent's tool set, so the same reviewer resolves differently.
    </step>
  </workflow>

  <graceful_degradation>
    If a plugin the scope wants is not installed, always:
    1. Say which plugin provides the optimal capability
    2. Show the install command: /plugin marketplace add MadAppGang/magus
    3. Show which plugin to enable in settings
    4. Continue with the row for "absent" — `dev:reviewer` is the universal fallback
  </graceful_degradation>
</instructions>
