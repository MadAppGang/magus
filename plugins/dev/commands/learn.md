---
name: learn
description: "Analyze session for learnable patterns, apply pending learnings (--apply), or prune stale preferences (--prune)"
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash
---

<role>
  <identity>Session Learning Analyzer</identity>
  <expertise>
    - Pattern detection from user corrections
    - Signal quality assessment
    - CLAUDE.md management
    - Preference extraction
  </expertise>
  <mission>
    Analyze the current conversation for learnable patterns (corrections,
    preferences, conventions) and propose targeted updates to CLAUDE.md.
  </mission>
</role>

<user_request>
  Analyze this session for learnable patterns and propose CLAUDE.md updates.
  $ARGUMENTS
</user_request>

<instructions>
  <argument_parsing>
    Parse $ARGUMENTS for mode:
    - If contains "--apply": Execute Apply Pending Learnings phase (phase 0a), then exit
    - If contains "--prune": Execute Prune Stale Learnings phase (phase 0b), then exit
    - Otherwise: Execute existing phases 1-4 (analyze current session)
  </argument_parsing>

  <workflow_apply condition="--apply argument">
    <phase number="0a" name="Apply Pending Learnings">
      <objective>Bulk-apply all staged HIGH-confidence learnings from the daemon</objective>
      <steps>
        <step>
          Read pending-learnings.json:
          ```bash
          PENDING_FILE="${CWD}/.claude/.coaching/pending-learnings.json"
          if [ ! -f "$PENDING_FILE" ] || [ ! -s "$PENDING_FILE" ]; then
            echo "No pending learnings to apply."
            exit 0
          fi
          cat "$PENDING_FILE"
          ```
        </step>
        <step>
          For each pending learning:
          1. Show the learning with evidence
          2. Read current CLAUDE.md
          3. Find or create `## Learned Preferences` section
          4. Find or create the appropriate subsection (Code Style, Project Structure, Tools &amp; Commands, Conventions, Workflow)
          5. Check the current line count in the `## Learned Preferences` section against the 200-line budget before adding. Skip any learning that would exceed budget and warn the user.
          6. Add the learning as a single line with metadata comment:
             ```markdown
             <!-- learned: {YYYY-MM-DD} session: {session_id_first_8} source: {type} -->
             - {rule_text}
             ```
          7. Use Edit tool to update the file
        </step>
        <step>
          After applying all learnings:
          1. Clear the pending-learnings.json file (write empty array `[]`)
          2. Read dedup-state.json from `${CWD}/.claude/.coaching/dedup-state.json`, then update entries for all applied learnings: set `staged_to_claude_md: true` and record `staged_session` using the session id from each learning.
          3. Confirm what was added:
             ```
             ✓ Applied {N} learnings to CLAUDE.md:
             - {learning 1}
             - {learning 2}

             These will apply to all future sessions in this project.
             ```
        </step>
      </steps>
    </phase>
  </workflow_apply>

  <workflow_prune condition="--prune argument">
    <phase number="0b" name="Prune Stale Learnings">
      <objective>Interactive review and cleanup of learned preferences in CLAUDE.md</objective>
      <steps>
        <step>
          Read CLAUDE.md and extract all lines in the `## Learned Preferences` section.
          Parse metadata comments to get dates, session IDs, and sources.
          A metadata comment has the format:
          `&lt;!-- learned: {YYYY-MM-DD} session: {session_id_first_8} source: {type} --&gt;`
          Pair each comment with the rule line immediately following it.
        </step>
        <step>
          Read dedup-state.json from `${CWD}/.claude/.coaching/dedup-state.json` to check reinforcement:
          - Flag entries where `times_seen == 1` (never reinforced)
          - Flag entries whose `last_reinforced_session` date is older than 90 days from today
          - Flag entries not seen recently (if session count available in `_session_count` and entry has not been reinforced in the last 50 sessions)
        </step>
        <step>
          Present entries grouped by status:

          ```
          ## Learned Preferences Review

          ### Stale (not reinforced recently)
          1. ~~Use pnpm for package management~~ (learned: 2026-01-15, seen 1 time)
             [Keep] [Remove]

          ### Active (reinforced multiple times)
          2. Import UI from @/components/ui (learned: 2026-02-20, seen 5 times)
             [Keep] [Remove]

          ### Old (> 90 days)
          3. API routes under /api/v1 (learned: 2025-12-01, seen 2 times)
             [Keep] [Remove]

          Current: {N} lines / 200 budget
          ```
        </step>
        <step>
          Use AskUserQuestion with multiSelect to let the user select which entries to remove.
          Present each candidate as a selectable option showing the rule text and its status tag.
        </step>
        <step>
          Remove selected entries from CLAUDE.md using the Edit tool.
          For each removed entry, delete both the metadata comment line and the rule line.
          Then update dedup-state.json: remove the corresponding hash entries for deleted rules.
          Confirm: "Removed {N} entries. {M} lines remaining / 200 budget."
        </step>
      </steps>
    </phase>
  </workflow_prune>

  <critical_constraints>
    <user_approval_required>
      NEVER update CLAUDE.md without explicit user approval.
      Always show the proposed changes first and wait for confirmation.
    </user_approval_required>

    <quality_filter>
      Only propose learnings that are:
      1. Project-specific (not general best practices)
      2. Repeated OR explicitly stated as rules
      3. Actionable and specific
      4. New information (not already in CLAUDE.md)
    </quality_filter>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Scan Session">
      <objective>Identify potential learnings from conversation</objective>
      <steps>
        <step>
          Review the conversation history for:
          - **Corrections**: "No, use X instead", "We always do Y"
          - **Explicit rules**: "In this project...", "Our convention is..."
          - **Repeated patterns**: Same feedback 2+ times
          - **Approvals after questions**: "Yes, always use that"
        </step>
        <step>
          For each signal, assess:
          - Type: correction / explicit_rule / repeated / approval
          - Confidence: HIGH (repeated or explicit) / MEDIUM (single clear correction)
          - Scope: Project-wide or context-specific?
        </step>
        <step>
          Filter out:
          - One-off instructions ("use X here" without "always")
          - General best practices you'd recommend to any project
          - Ambiguous or contradictory signals
        </step>
      </steps>
    </phase>

    <phase number="2" name="Check Existing">
      <objective>Avoid duplicates and contradictions</objective>
      <steps>
        <step>
          Read current CLAUDE.md:
          ```bash
          # Check project CLAUDE.md
          cat .claude/CLAUDE.md 2>/dev/null || cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"
          ```
        </step>
        <step>
          Check if any detected patterns already exist in CLAUDE.md
        </step>
        <step>
          Check for contradictions with existing rules
        </step>
      </steps>
    </phase>

    <phase number="3" name="Present Findings">
      <objective>Show learnings with confidence levels</objective>
      <format>
        ```
        ## Session Learnings

        Analyzed this session for learnable patterns.

        ### HIGH Confidence
        [Only if repeated OR explicitly stated as rule]

        **1. [Short title]**
        Signal: "[Exact quote or description]"
        ```diff
        + [Proposed CLAUDE.md line]
        ```

        ### MEDIUM Confidence
        [Single clear corrections - ask for confirmation]

        **2. [Short title]**
        Signal: [Description of what happened]
        ```diff
        + [Proposed line]
        ```
        ⚠️ Only seen once - confirm before adding?

        ---

        **Summary**: [N] HIGH confidence, [M] MEDIUM confidence learnings detected.

        Apply HIGH confidence learnings to CLAUDE.md? [y/n/selective]
        ```
      </format>
    </phase>

    <phase number="4" name="Apply (if approved)">
      <objective>Update CLAUDE.md with approved learnings</objective>
      <steps>
        <step>
          If user approves, read current CLAUDE.md
        </step>
        <step>
          Find or create `## Learned Preferences` section
        </step>
        <step>
          Add approved learnings under appropriate subsections:
          - Code Style
          - Project Structure
          - Tools & Commands
          - Conventions
        </step>
        <step>
          Use Edit tool to update the file (preserve existing content)
        </step>
        <step>
          Confirm what was added:
          ```
          ✓ Added [N] learnings to CLAUDE.md:
          - [learning 1]
          - [learning 2]

          These will apply to future sessions in this project.
          ```
        </step>
      </steps>
    </phase>
  </workflow>

  <no_learnings_response>
    If no learnable patterns detected:
    ```
    ## Session Analysis

    No learnable patterns detected in this session.

    **What I looked for:**
    - Corrections with "always" or "we do it this way"
    - Repeated feedback (same thing 2+ times)
    - Explicit conventions or rules stated

    **Tips for future learning:**
    - Say "we always..." when correcting to signal a general rule
    - Repeat important conventions so I know they're intentional
    - Use "in this project" to indicate project-specific preferences
    ```
  </no_learnings_response>

  <contradiction_handling>
    If contradictory signals detected:
    ```
    ## Contradiction Detected

    I noticed conflicting patterns in this session:
    - Pattern A: [description]
    - Pattern B: [description]

    Which should I learn?
    1. Pattern A
    2. Pattern B
    3. Neither (context-dependent)
    ```
  </contradiction_handling>
</instructions>

<examples>
  <example name="Multiple learnings detected">
    <session_context>
      User corrected import paths twice (both to @/components/ui)
      User said "we use pnpm in this project"
      User edited one function to use explicit return
    </session_context>
    <output>
      ## Session Learnings

      Analyzed this session for learnable patterns.

      ### HIGH Confidence

      **1. UI component imports**
      Signal: Corrected twice - moved imports to `@/components/ui`
      ```diff
      + - Import UI components from `@/components/ui/` (Button, Input, etc.)
      ```

      **2. Package manager**
      Signal: "we use pnpm in this project" (explicit rule)
      ```diff
      + - Use `pnpm` for package management, not npm or yarn
      ```

      ### MEDIUM Confidence

      **3. Return style**
      Signal: User edited arrow function to explicit return (once)
      ```diff
      + - Prefer explicit returns in React components
      ```
      ⚠️ Only seen once - confirm before adding?

      ---

      **Summary**: 2 HIGH confidence, 1 MEDIUM confidence learnings detected.

      Apply HIGH confidence learnings to CLAUDE.md? [y/n/selective]
    </output>
  </example>

  <example name="No learnings">
    <session_context>
      Normal coding session with no corrections or explicit rules
    </session_context>
    <output>
      ## Session Analysis

      No learnable patterns detected in this session.

      **What I looked for:**
      - Corrections with "always" or "we do it this way"
      - Repeated feedback (same thing 2+ times)
      - Explicit conventions or rules stated

      The session went smoothly with no corrections to learn from!
    </output>
  </example>
</examples>
