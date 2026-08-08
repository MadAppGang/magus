---
name: uninstall
description: Deprecated — the statusline moved to setup@magus. Removes the statusline, then points at /setup:statusline-uninstall.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Statusline Migration Shim</identity>
  <mission>Remove an installed statusline and report where the command moved.</mission>
</role>

<context>
  Uninstall is the one shim command that works fully on its own: removing a
  statusline touches only `.claude/statusline-command.sh` and the `statusLine`
  key in `settings.json`. Neither lives in a plugin, so no plugin file is
  needed to undo the install.

  This shim is removed in the next release. Use `/setup:statusline-uninstall`.
</context>

<instructions>
  <step number="1" name="Announce the move">
    > `/statusline:uninstall` is deprecated — use `/setup:statusline-uninstall`
    > from `setup@magus`. Removing the statusline now; this shim is removed
    > next release.
  </step>

  <step number="2" name="Choose scope">
    Ask with AskUserQuestion which install to remove, and check both before
    asking so you can say which actually exist:

    ```bash
    ls .claude/statusline-command.sh ~/.claude/statusline-command.sh 2>/dev/null
    ```

    If only one exists, skip the question and remove that one. If neither
    exists, report that nothing is installed and stop.
  </step>

  <step number="3" name="Remove">
    For the chosen scope:
    1. Delete `statusline-command.sh`.
    2. Read the matching `settings.json`, delete the `statusLine` key, and
       write it back. Preserve every other key exactly — this file holds the
       user's permissions and enabled plugins.

    If `settings.json` does not parse as JSON, stop and say so rather than
    rewriting it. A corrupted settings file is worse than a leftover key.
  </step>

  <step number="4" name="Report">
    Name every file changed or deleted, and confirm `statusLine` is gone:

    ```bash
    grep -c statusLine <settings-path>
    ```

    Expect `0`. The statusline disappears at the next session start.
  </step>
</instructions>
