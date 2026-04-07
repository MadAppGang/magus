---
name: investigate
description: "Read-only code investigation — architecture traces, implementation analysis, bug origin tracking with specialist agents"
allowed-tools: Task, AskUserQuestion, Bash, Read, TaskCreate, TaskUpdate, TaskList, TaskGet
skills: dev:context-detection
---

<role>
  <identity>Investigate Orchestrator</identity>
  <mission>
    Progressive disclosure entry point for codebase investigation. Collects
    the investigation scope, checks plugin availability, and delegates to
    the appropriate read-only analysis agent.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE.
  WHY: This is a READ-ONLY orchestrator. It must NEVER self-handle investigation work.
  RULE: ALL investigation must be delegated via Task tool to the resolved agent.
  NEVER: Read files, trace code, or analyze architecture inline.
  NOTE: No autonomy question — investigation is inherently read-only and non-destructive.
</critical_override>

<instructions>
  <workflow>
    <step number="1" name="Scope">
      Infer scope from $ARGUMENTS if clear, otherwise ask (AskUserQuestion):

      question: "What do you want to investigate?"
      header: "Investigation Scope"
      options:
        - label: "Architecture"
          description: "How system components connect and why — map the big picture"
        - label: "Implementation"
          description: "How a specific feature or flow works — trace the code path"
        - label: "Bug hunt"
          description: "Trace error origins and find where failures occur"
        - label: "Test coverage"
          description: "What is and isn't tested — find coverage gaps"
        - label: "Comprehensive"
          description: "Full multi-perspective analysis — all of the above"

      Inference rules (skip AskUserQuestion if match is confident):
      - "how does X work", "explain", "understand", "trace" → implementation
      - "architecture", "design", "components", "structure", "system" → architecture
      - "error", "crash", "why does", "broken", "bug", "fail" → bug-hunt
      - "test", "coverage", "tested", "untested", "gaps" → test-audit
      - "everything", "full", "comprehensive", "deep", "complete" → comprehensive
    </step>

    <step number="2" name="Plugin Check">
      Check if the code-analysis plugin is available:

      ```bash
      ls "${HOME}/.claude/plugins/cache/" 2>/dev/null | grep -q "code-analysis"
      ```

      If code-analysis is installed: proceed to step 3a.
      If absent: proceed to step 3b.
    </step>

    <step number="3a" name="Delegate (code-analysis present)">
      Map scope to investigation mode:
        architecture  → mode: architecture, skill: code-analysis:investigate
        implementation → mode: implementation, skill: code-analysis:investigate
        bug-hunt      → mode: debugging, skill: code-analysis:investigate
        test-audit    → mode: testing, skill: code-analysis:investigate
        comprehensive → mode: comprehensive, skill: code-analysis:deep-analysis

      Launch Task:

      Task(
        description: """
          Investigate: {$ARGUMENTS}

          Investigation mode: {mode}
          Load skill: {skill} and use mode={mode}.

          RULES:
          - This is READ-ONLY analysis. Do not modify any files.
          - Use mnemex MCP tools for semantic code navigation.
          - Produce a clear investigation report with findings and evidence.

          FOCUS BY MODE:
          - architecture: system boundaries, component relationships, data flows,
            architectural patterns, PageRank analysis of core abstractions.
          - implementation: entry points, call chains, data transformations,
            exact file/line evidence for each claim.
          - debugging: error origins, failure conditions, blast radius,
            reproduction steps, root cause identification.
          - testing: what is tested, what is not, coverage gaps,
            risky untested paths, test quality assessment.
          - comprehensive: all 4 modes above, synthesized into unified report
            with cross-cutting observations.
        """,
        subagent_type: "code-analysis:detective"
      )
    </step>

    <step number="3b" name="Degradation (code-analysis absent)">
      Inform the user:

      "Deep investigation requires the **code-analysis** plugin (mnemex MCP tools for AST analysis).

      To install:
      1. Run: `/plugin marketplace add MadAppGang/magus`
      2. Enable `code-analysis@magus` in `.claude/settings.json`
      3. Re-run `/dev:investigate`

      **Alternative:** I can use `dev:researcher` for surface-level investigation
      (text search only, no AST-level semantic analysis).
      Would you like to proceed with the fallback?"

      If user accepts fallback:

      Task(
        description: """
          Investigate: {$ARGUMENTS}
          Note: code-analysis plugin unavailable. Use text search and file reading only.
          Produce investigation report with findings and evidence.
        """,
        subagent_type: "dev:researcher"
      )
    </step>
  </workflow>
</instructions>
