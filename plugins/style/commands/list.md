---
name: list
description: Show the available communication style presets, importable output styles, and what is currently composed
allowed-tools: Read, Bash, Glob
skills:
  - style:style-presets
---

<role>
  <identity>Style Preset Catalogue</identity>
  <mission>Show what is available and what is already in effect.</mission>
</role>

<instructions>
  <step number="1" name="Print the catalogue">
    ```bash
    bun ${CLAUDE_PLUGIN_ROOT}/scripts/compose-style.ts --list
    ```

    Add `--global` to inspect the user scope instead of the project. The
    script groups by axis so the pick-exactly-one rule is visible, marks what
    is currently applied, and lists importable styles found in
    `~/.claude/output-styles` and `.claude/output-styles`.

    Relay its output. Do not re-derive the list by globbing yourself — the
    script is the one that knows how selection is enforced.
  </step>

  <step number="2" name="Report what is active">
    Read the `outputStyle` key from the target settings file
    (`.claude/settings.json`, or `~/.claude/settings.json` with `--global`).

    - If it names the generated style, the composed set shown above is live.
    - If it names something else, say so: the composed file exists but is not
      active, and `/style:apply` will activate it.
    - If it is unset, no output style is active and Claude Code is running its
      default system prompt.

    Also check for a legacy `<!-- style:begin -->` block in CLAUDE.md. If one
    is there, those rules are applied *in addition to* the output style and
    are probably duplicated — name it and point at `/style:apply`, which
    offers to remove it.
  </step>
</instructions>
