---
name: install-statusline
description: Install colorful statusline with worktree awareness, plan limits, and reset countdowns (project or global)
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Status Line Installer</identity>
  <mission>
    Install the colorful statusline script and configure Claude Code settings to use it.
    Supports project-level or global scope.
  </mission>
</role>

<instructions>
  Execute ALL steps in a SINGLE response. Do NOT pause for confirmation.

  <step number="1" name="Choose scope">
    Use AskUserQuestion to ask the user:
    - question: "Where should the status line be installed?"
    - options:
      1. "Project only (Recommended)" — installs to this project's .claude/ directory
      2. "Global" — installs to ~/.claude/ for all projects
  </step>

  <step number="2" name="Read the script">
    Read the status line script from the plugin:
    `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh`
  </step>

  <step number="3" name="Install script">
    Based on the scope chosen:

    **Project scope:**
    1. Write the script to `.claude/statusline-command.sh` in the current project root
    2. Make it executable: `chmod +x .claude/statusline-command.sh`
    3. Read the project's `.claude/settings.json` (create if needed)
    4. Set the `statusLine` field to:
       ```json
       {
         "type": "command",
         "command": "bash .claude/statusline-command.sh"
       }
       ```
    5. Write back the updated settings (preserve all other fields)

    **Global scope:**
    1. Write the script to `~/.claude/statusline-command.sh`
    2. Make it executable: `chmod +x ~/.claude/statusline-command.sh`
    3. Read `~/.claude/settings.json`
    4. Set the `statusLine` field to:
       ```json
       {
         "type": "command",
         "command": "bash ~/.claude/statusline-command.sh"
       }
       ```
    5. Write back the updated settings (preserve all other fields)
  </step>

  <step number="4" name="Verify">
    Test the installed script by running:
    ```bash
    echo '{"model":{"display_name":"Claude Test"},"cost":{"total_cost_usd":0.42,"total_duration_ms":120000},"context_window":{"used_percentage":25},"cwd":"'$(pwd)'"}' | bash <installed-script-path>
    ```
    Show the output to the user.
  </step>

  <step number="5" name="Report">
    Show a summary:
    ```
    Status line installed!

    Scope: {project|global}
    Script: {path-to-script}
    Settings: {path-to-settings.json}

    What it shows:
      * Model | branch | worktree | $cost | duration | context-bar | plan-limits

    Features:
      - Reset countdowns: shows when 5h/7d plan limits reset
      - Themes: default, monochrome, minimal, neon
      - Sections: toggle any section on/off via config
      - Config: ~/.claude/statusline-config.json

    Use /statusline:customize-statusline to configure sections and themes.
    Restart Claude Code to see the new status line.
    ```
  </step>
</instructions>
