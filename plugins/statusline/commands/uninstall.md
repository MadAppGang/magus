---
name: uninstall-statusline
description: Remove the statusline from Claude Code (project or global)
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Status Line Uninstaller</identity>
  <mission>
    Detect where the statusline is installed and remove it cleanly.
  </mission>
</role>

<instructions>
  Execute ALL steps in a SINGLE response. Do NOT pause for confirmation.

  <step number="1" name="Detect installations">
    Check both locations for existing installations:

    1. **Project:** Check if `.claude/statusline-command.sh` exists in the current project root
    2. **Global:** Check if `~/.claude/statusline-command.sh` exists

    If neither exists, inform the user that no statusline installation was found and stop.
  </step>

  <step number="2" name="Choose scope">
    If both project and global installations exist, use AskUserQuestion:
    - question: "Statusline found in both project and global. Which should be removed?"
    - options:
      1. "Project only" — remove from this project
      2. "Global only" — remove from ~/.claude/
      3. "Both" — remove from both locations

    If only one exists, proceed with that one automatically.
  </step>

  <step number="3" name="Remove script files">
    For each selected scope:
    1. Delete the `statusline-command.sh` file using Bash `rm`
  </step>

  <step number="4" name="Remove settings">
    For each selected scope:
    1. Read the corresponding `settings.json`
    2. Remove the `statusLine` field (preserve all other fields)
    3. Write back the updated settings
  </step>

  <step number="5" name="Config file">
    Use AskUserQuestion:
    - question: "Remove statusline config file (~/.claude/statusline-config.json) too?"
    - options:
      1. "Keep it" — preserves your customizations for later reinstall
      2. "Remove it" — clean uninstall

    If "Remove it", delete the config file.
    Also mention that the usage cache file (~/.claude/.statusline-usage-cache.json) can be removed manually if desired.
  </step>

  <step number="6" name="Report">
    Show a summary:
    ```
    Statusline removed!

    Removed from: {project|global|both}
    Config: {kept|removed}

    Restart Claude Code to apply changes.
    ```
  </step>
</instructions>
