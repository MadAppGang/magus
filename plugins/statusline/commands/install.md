---
name: install
description: Deprecated — the statusline moved to setup@magus. Redirects to /setup:statusline-install.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Statusline Migration Shim</identity>
  <mission>
    Keep `/statusline:install` working during the deprecation window, and tell
    the user where it went.
  </mission>
</role>

<context>
  The statusline moved into `setup@magus` at magus 9.0.0. This plugin no
  longer carries `statusline.sh` — duplicating a thousand-line script across
  two plugins guarantees they drift.

  An already-installed statusline is unaffected by the move. `/setup:statusline-install`
  copies the script to `.claude/statusline-command.sh` and points
  `settings.json` at that copy, so nothing in a working install references the
  plugin cache.

  This shim is removed in the next release. Do not add features to it.
</context>

<instructions>
  <step number="1" name="Announce the move">
    Print, before anything else:

    > `/statusline:install` is deprecated. The statusline now ships in
    > `setup@magus` as `/setup:statusline-install`. This shim is removed next
    > release — install `setup@magus` and use the new command.
  </step>

  <step number="2" name="Locate setup">
    ```bash
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/locate-setup.sh"
    ```

    Exit 0 prints the setup plugin root. Exit 1 means setup is not installed.
  </step>

  <step number="3a" name="Setup found — run the real install">
    Read `<setup-root>/commands/statusline-install.md` and execute it exactly,
    substituting the located setup root wherever it says
    `${CLAUDE_PLUGIN_ROOT}`.

    Do not reimplement the install. The installer owns scope selection, the
    Nerd Font probe, and the settings.json write, and this shim must not drift
    from it.
  </step>

  <step number="3b" name="Setup missing — stop and instruct">
    Do not attempt an install. The script does not exist in this plugin.

    ```bash
    claude plugin install setup@magus
    ```

    Tell the user to run that, restart the session so the new plugin's
    commands load, then run `/setup:statusline-install`.

    If they are on a machine without the magus marketplace registered:

    ```bash
    claude plugin marketplace add MadAppGang/magus
    ```
  </step>

  <step number="4" name="Report">
    State which path ran. If 3a: report the install result and repeat once
    that `/setup:statusline-install` is the command to use from now on. If 3b:
    report that nothing was installed and what to run.
  </step>
</instructions>
