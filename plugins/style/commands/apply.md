---
name: apply
description: Choose communication style presets and write them into CLAUDE.md as one managed, re-appliable section
argument-hint: "[preset,preset,...] [--global] [--dry-run]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
skills:
  - style:style-presets
---

<role>
  <identity>Style Applier</identity>
  <mission>
    Compose a set of communication style rules and write them into CLAUDE.md
    as a single managed block that can be re-applied any number of times
    without ever duplicating itself.
  </mission>
</role>

<context>
  CLAUDE.md is loaded into context on every turn. Style rules written there
  are a permanent running cost, which is why these presets are short and why
  this command writes one bounded block instead of scattering rules.

  The block is delimited so a second run replaces it rather than appending a
  near-duplicate. Appending is the failure mode that makes a project's
  CLAUDE.md grow to three contradictory voice sections.
</context>

<constraints>
  <rule id="one-block">
    All applied presets live between `<!-- style:begin -->` and
    `<!-- style:end -->`. Re-applying REPLACES everything between the markers.
    Never append a second block, and never write style rules outside it.
  </rule>
  <rule id="preserve-outside">
    Content outside the markers is the user's. Do not reformat it, reorder it,
    or move the block relative to it.
  </rule>
  <rule id="one-verbosity">
    Exactly one preset with `axis: verbosity` may be applied. `direct`,
    `explanatory`, and `terse` contradict each other; applying two produces
    rules that cancel out.
  </rule>
  <rule id="verbatim-copy">
    Copy preset bodies verbatim from `${CLAUDE_PLUGIN_ROOT}/styles/<name>.md`
    — everything after the closing frontmatter delimiter. Do not paraphrase,
    summarise, or "improve" them on the way in. The exception is a preset
    marked `template: true`, which is filled in at step 4.
  </rule>
</constraints>

<instructions>
  <step number="1" name="Load presets">
    ```bash
    ls ${CLAUDE_PLUGIN_ROOT}/styles/*.md
    ```

    Read every file. Record `name`, `axis`, `summary`, `conflicts`, and
    `template` from each frontmatter, and keep the body after the frontmatter
    for step 5.
  </step>

  <step number="2" name="Read the current state">
    Read the target CLAUDE.md:
    - default: `CLAUDE.md` in the project root
    - `--global`: `~/.claude/CLAUDE.md`

    If it does not exist, note that you will create it.

    If a `<!-- style:begin -->` block exists, parse the
    `<!-- presets: ... -->` line for the currently applied set and offer it as
    the default selection.
  </step>

  <step number="3" name="Choose presets">
    If the arguments name presets explicitly (`/style:apply direct,no-slop`),
    use those and skip the questions. Reject an unknown name with an error
    that lists the valid set — never near-match a typo to a real preset.

    Otherwise ask two questions in one AskUserQuestion call:

    1. **Verbosity** (single select, required) — `direct`, `explanatory`,
       `terse`. Use each preset's `summary` as the option description.
       Recommend `direct`.
    2. **Modifiers** (multiSelect) — every preset with `axis: modifier`.
       Recommend `no-slop` and `evidence-first`.

    Enforce the one-verbosity rule here. If the arguments name two verbosity
    presets, stop and say which conflict.
  </step>

  <step number="4" name="Fill templates">
    Only for selected presets with `template: true`.

    `terminology` carries an empty table that is worthless unless filled from
    the actual codebase. Populate it:

    - Grep for the same concept under different names. Real signals: a model
      named one thing and its table named another; `user`/`account`/`member`
      used interchangeably; `fetch`/`get`/`load` on sibling functions.
    - Read the README and any `docs/` glossary for the domain's own words.
    - Propose at most six rows. Six enforceable rules beat twenty aspirational
      ones.

    Show the proposed rows and confirm before writing. If you find nothing
    worth a row, drop the table and keep only the prose rules — do not ship an
    empty table with a placeholder comment in it.
  </step>

  <step number="5" name="Compose the block">
    Build exactly this, verbosity preset first, then modifiers in the order
    selected:

    ```markdown
    <!-- style:begin -->
    <!-- presets: direct, no-slop, evidence-first -->
    ## Communication style

    Applied by `/style:apply`. Re-run it to change this section; edits between
    the markers are overwritten.

    <body of each selected preset, verbatim, separated by a blank line>
    <!-- style:end -->
    ```

    Each preset body already opens with its own `###` heading, so they nest
    correctly under the `##`.
  </step>

  <step number="6" name="Write">
    If the arguments contain `--dry-run`, print the composed block and the
    diff, write nothing, and stop.

    Otherwise:
    - **Existing block:** replace everything between the markers, inclusive.
      Touch nothing else in the file.
    - **No block, file exists:** append it at the end of the file, after one
      blank line.
    - **No file:** create it with a `# Project Context` heading, then the
      block.

    Use Edit for the replace case with the marker lines included in the match,
    so a partial overlap cannot corrupt the file.
  </step>

  <step number="7" name="Verify and report">
    Confirm the file has exactly one block:

    ```bash
    grep -c 'style:begin' <target>
    grep -c 'style:end' <target>
    ```

    Both must print `1`. If either prints more, you appended instead of
    replacing — fix it before reporting.

    Report:

    ```
    STYLE APPLIED
    ════════════════════════════════════════
    Target:     <path>
    Verbosity:  <preset>
    Modifiers:  <presets, or none>
    Block size: <N> lines, <M> chars (loaded every turn)
    Changed:    created | replaced | appended
    ════════════════════════════════════════
    ```

    Close with one line: the rules take effect in the next session, or
    immediately on the next turn if the harness re-reads CLAUDE.md. If any
    style rules exist outside the managed block, name them and say they are
    unmanaged and may contradict what was just applied.
  </step>
</instructions>
