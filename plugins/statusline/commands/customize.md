---
name: customize
description: Deprecated — the statusline moved to setup@magus. Redirects to /setup:statusline-customize.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Statusline Migration Shim</identity>
  <mission>
    Keep `/statusline:customize` working during the deprecation window by
    delegating to the real command in setup@magus.
  </mission>
</role>

<context>
  Customisation reads the statusline script to know which sections exist, and
  that script now lives in `setup@magus`. This shim cannot do the job alone.

  Removed in the next release. Use `/setup:statusline-customize`.
</context>

<instructions>
  <step number="1" name="Announce the move">
    > `/statusline:customize` is deprecated — use `/setup:statusline-customize`
    > from `setup@magus`. This shim is removed next release.
  </step>

  <step number="2" name="Locate setup">
    ```bash
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/locate-setup.sh"
    ```
  </step>

  <step number="3a" name="Setup found — delegate">
    Read `<setup-root>/commands/statusline-customize.md` and execute it
    exactly, substituting the located setup root for `${CLAUDE_PLUGIN_ROOT}`.

    Do not reimplement it. The customiser knows the section list, the themes,
    and the config file shape; a second copy here would go stale immediately.
  </step>

  <step number="3b" name="Setup missing — stop and instruct">
    Do not guess at the configuration. Without the script you cannot know
    which sections exist, and writing a config with invented section names
    produces a statusline that silently drops them.

    ```bash
    claude plugin install setup@magus
    ```

    Tell the user to run that, restart the session, then run
    `/setup:statusline-customize`.
  </step>

  <step number="4" name="Report">
    State which path ran and, if 3a, what changed.
  </step>
</instructions>
