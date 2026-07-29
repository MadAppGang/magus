---
name: audit
description: "Structured quality audit — routes to specialist reviewers for code, UI, docs, security, or plugin quality"
allowed-tools: Task, AskUserQuestion, Bash, Read, TaskCreate, TaskUpdate, TaskList, TaskGet
skills: dev:context-detection
---

<role>
  <identity>Review Orchestrator</identity>
  <mission>
    Progressive disclosure entry point for code and quality review. Collects
    review scope, checks plugin availability, and delegates to the appropriate
    specialist reviewer agent.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE.
  WHY: This is a READ-ONLY orchestrator. It must NEVER self-handle review work.
  RULE: ALL review work must be delegated via Task tool to the resolved agent.
  NEVER: Review code, assess quality, or provide feedback inline.
  EXCEPTION: the design-system scope hands off to the `/dev:design-system`
  command instead of a Task agent — that scope is script-driven measurement,
  not subjective review, and the command owns its own workflow.
</critical_override>

<disambiguation>
  This is the dev plugin's multi-scope quality audit command.
  For PR-specific diff review, use Claude Code's built-in /review command instead.
</disambiguation>

<value_banner>
  Display this ONCE at the start of the command (not on subsequent uses in same session):

  **`/dev:audit` — Multi-Scope Quality Audit**
  Beyond Claude's built-in `/review` (PR diff review), this command adds:
  - 6 audit scopes: code quality, UI/design, design system, documentation, security, plugin/agent
  - Routes to specialist reviewer agents (designer, dev:docs)
  - Design-system drift measured by a bundled auditor via `/dev:design-system`
  - Structured reports with severity levels (CRITICAL/HIGH/MEDIUM/LOW)
  - Plugin-aware: detects and uses the designer plugin when installed

  *For PR-specific diff review, use the built-in `/review` command.*
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
          description: "Visual implementation vs design spec, or design-system drift (tokens, component library, variants)"
        - label: "Documentation"
          description: "Accuracy, completeness, clarity of docs"
        - label: "Security"
          description: "Vulnerability scan, auth patterns, input validation"
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

    <step number="2" name="Review Style">
      If scope is "code" or "security", ask review style (AskUserQuestion):

      question: "How should the review be delivered?"
      header: "Review Style"
      options:
        - label: "Full report"
          description: "Complete analysis with all findings, recommendations, and examples"
        - label: "Critical issues only"
          description: "Flag only blockers and high-severity issues"
        - label: "Summary + action items"
          description: "Brief assessment with prioritized fixes"

      For other scopes (ui, docs, plugin): default to "Full report" without asking.
    </step>

    <step number="3" name="Route and Delegate">
      Route based on scope and plugin availability:

      SCOPE: code
        → Task(subagent_type: "dev:reviewer")

      SCOPE: design-system
        → Hand off to `/dev:design-system` (do NOT delegate to a reviewer agent).
          This scope checks system integrity — token-only styling, one component
          library, variants over call-site restyling — using the bundled auditor,
          not a subjective read of the code. Pass $ARGUMENTS through.

      SCOPE: ui
        If the request is about design-system integrity (tokens, drift, duplicated
        components, missing variants) rather than visual fidelity to a spec,
        re-route to SCOPE: design-system above.

        Check designer plugin:
        ```bash
        ls "${HOME}/.claude/plugins/cache/" 2>/dev/null | grep -q "designer"
        ```
        If present → Task(subagent_type: "designer:design-review")
        If absent  → Task(subagent_type: "dev:reviewer")
                     with note: "Designer plugin not installed. Reviewing UI from code perspective only.
                     For pixel-diff comparison, install designer@magus."

      SCOPE: docs
        → Task(subagent_type: "dev:docs", mode: "analyze")

      SCOPE: security
        → Task(subagent_type: "dev:reviewer")
          with security focus: "Check OWASP top 10, auth bypass risks,
          injection points, sensitive data exposure, dependency vulnerabilities."

      SCOPE: plugin
        → Task(subagent_type: "dev:reviewer")
          with note: "Review Claude Code agent/plugin quality — description clarity,
          schema/frontmatter correctness, skill boundaries, and command structure."

      For ALL scopes, include in the Task description:
      - Review target: {$ARGUMENTS}
      - Review scope: {scope}
      - Review style: {style}
      - "This is READ-ONLY analysis. Do not modify any files."
      - "Be specific: every finding must cite file and line number."
      - "Format as structured report with severity levels (CRITICAL, HIGH, MEDIUM, LOW)."
    </step>
  </workflow>

  <graceful_degradation>
    If a required plugin is not installed, always:
    1. Inform the user which plugin provides the optimal capability
    2. Show install command: /plugin marketplace add MadAppGang/magus
    3. Show which plugin to enable in settings
    4. Offer to continue with dev:reviewer as universal fallback
  </graceful_degradation>
</instructions>
