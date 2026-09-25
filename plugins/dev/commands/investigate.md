---
name: investigate
description: "Read-only code investigation — architecture traces, implementation analysis, bug origin tracking with specialist agents"
allowed-tools:  Agent, AskUserQuestion, Bash, Read
---

<role>
  <identity>Investigate Orchestrator</identity>
  <mission>
    Progressive disclosure entry point for codebase investigation. Collects
    the investigation scope, checks whether the `code-search:analyze` agent is
    loaded, and delegates to the appropriate read-only analysis agent.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<critical_override>
  THIS COMMAND OVERRIDES THE CLAUDE.md TASK ROUTING TABLE.
  WHY: This is a READ-ONLY orchestrator. It must NEVER self-handle investigation work.
  RULE: ALL investigation must be delegated via Agent tool to the resolved agent.
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
      Look for `code-search:analyze` in the Agent tool's list of available agent types.

      That list is the only authority: it is what this session actually loaded, after
      scope, enablement and version resolution. Do not check the disk instead. The plugin
      cache is laid out `cache/<marketplace>/<plugin>/<version>`, and a cached plugin can
      be disabled or installed after this session started.

      If `code-search:analyze` is listed: proceed to step 3a.
      If it is not listed: proceed to step 3b.
    </step>

    <step number="3a" name="Delegate (code-search:analyze listed)">
      Map scope to investigation mode:
        architecture  → mode: architecture, skill: code-search:investigate
        implementation → mode: implementation, skill: code-search:investigate
        bug-hunt      → mode: bug, skill: code-search:investigate
        test-audit    → mode: test, skill: code-search:investigate
        comprehensive → skill: code-search:deep-analysis (no mode parameter — it has none)

      Launch the agent:

      Agent(
        subagent_type: "code-search:analyze",
        run_in_background: false,
        description: "Investigate: {target in three or four words}",
        prompt: """
          Investigate: {$ARGUMENTS}

          Investigation mode: {mode}
          Load skill: {skill} and use mode={mode}.

          RULES:
          - This is READ-ONLY analysis. Do not modify any files.
          - Use the code-search MCP tools (mcp__plugin_code-search_ca__*) for semantic code navigation.
          - Produce a clear investigation report with findings and evidence.

          FOCUS BY MODE:
          - architecture: system boundaries, component relationships, data flows,
            architectural patterns, PageRank analysis of core abstractions.
          - implementation: entry points, call chains, data transformations,
            exact file/line evidence for each claim.
          - bug: error origins, failure conditions, blast radius,
            reproduction steps, root cause identification.
          - test: what is tested, what is not, coverage gaps,
            risky untested paths, test quality assessment.
          - (comprehensive scope routes to code-search:deep-analysis, which takes no
            mode) all 4 modes above, synthesized into unified report
            with cross-cutting observations.
        """
      )
    </step>

    <step number="3b" name="Degradation (code-search:analyze not available)">
      Inform the user:

      "Deep investigation needs the `code-search:analyze` agent from the **code-search** plugin, and this session has not loaded it.

      To install:
      1. Run: `/plugin marketplace add MadAppGang/magus`
      2. Enable `code-search@magus` in `.claude/settings.json`
      3. Restart the session, then re-run `/dev:investigate`

      If code-search is already installed, it is not enabled for this project, or it
      was installed or enabled after this session started.

      **Alternative:** I can use the built-in `Explore` agent for a surface-level
      investigation (text search and file reading, no semantic or structural analysis).
      Would you like to proceed with the fallback?"

      If user accepts fallback:

      Agent(
        subagent_type: "Explore",
        run_in_background: false,
        description: "Investigate: {target in three or four words}",
        prompt: """
          Investigate: {$ARGUMENTS}

          Search breadth: medium.
          Use text search and file reading only. Do not modify any files.
          Produce an investigation report with findings, each backed by file:line evidence.
        """
      )
    </step>
  </workflow>
</instructions>
