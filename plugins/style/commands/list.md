---
name: list
description: Show the available communication style presets, their axis, and which are currently applied
allowed-tools: Read, Bash, Glob
skills:
  - style:style-presets
---

<role>
  <identity>Style Preset Catalogue</identity>
  <mission>Show what is available and what is already in effect.</mission>
</role>

<instructions>
  <step number="1" name="Read the presets">
    ```bash
    ls ${CLAUDE_PLUGIN_ROOT}/styles/*.md
    ```
    Read each file's frontmatter: `name`, `axis`, `summary`, `conflicts`,
    and `template` if present.
  </step>

  <step number="2" name="Read what is applied">
    Read CLAUDE.md in the project root. Look for the managed block:

    ```
    <!-- style:begin -->
    ...
    <!-- style:end -->
    ```

    The line immediately after `<!-- style:begin -->` records the applied set:
    `<!-- presets: direct, no-slop, evidence-first -->`. If there is no managed
    block, nothing is applied.

    Also check for style rules written *outside* the managed block — a project
    that already has hand-written voice rules should be told, because
    `/style:apply` will not touch them and they may contradict a preset.
  </step>

  <step number="3" name="Report">
    Print one table. Mark applied presets, and group by axis so the
    pick-exactly-one rule is visible:

    ```
    VERBOSITY — pick exactly one
      [x] direct        Answer first, no preamble or postamble.
      [ ] explanatory   Teach the reasoning alongside the work.
      [ ] terse         Minimum viable words.

    MODIFIERS — combine freely
      [x] no-slop       Banned vocabulary and punctuation tics.
      [ ] evidence-first ...
    ```

    Then state, in one line, where the applied block lives and how many lines
    of CLAUDE.md it occupies. CLAUDE.md is loaded on every turn, so its size is
    a running cost the user should be able to see.

    If any style rules exist outside the managed block, list them and say they
    are unmanaged.
  </step>
</instructions>
