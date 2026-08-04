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

  <step number="4" name="Nerd Font icons (opt-in)">
    The statusline can render some segments as Nerd Font glyphs instead of text
    labels — today that is the RAM segment (`󰍛 1.1G` instead of `RAM 1.1G`).
    This is **off by default**: Nerd Font glyphs live in the Unicode private use
    areas, so an unpatched font shows a box (□) or nothing at all.

    **4a. Probe for a patched font (fast, no dependencies).**

    Do NOT use `fc-list` — fontconfig is usually absent on macOS. Scan the font
    directories by filename instead:

    ```bash
    find ~/Library/Fonts /Library/Fonts /System/Library/Fonts \
      -maxdepth 2 \( -type f -o -type l \) 2>/dev/null \
      | grep -Ei 'nerd|NF-|powerline' | head -5
    ```

    **4b. No matches → do not ask.** Write `icons.nerd_font: false` (see 4d) and
    move on. Mention it in the report as one line, nothing more.

    **4c. Matches found → ask, showing the real glyph.** A font inventory is NOT
    enough to decide: Nerd Font coverage is **partial and varies by font**. On a
    machine with 0xProto Nerd Font installed, `U+F035B` (nf-md-memory) renders
    correctly while `U+F2DB` (nf-fa-microchip) and `U+F4BC` (nf-oct-cpu) come out
    as blank space. Only the user can confirm the specific glyph resolves.

    Print the sample line first — it must contain the actual glyph the plugin
    will use, in context:

    ```
    Found a Nerd Font: <first matching filename>

    With icons:     󰍛 1.1G
    Without icons:  RAM 1.1G
    ```

    Then use AskUserQuestion:
    - question: "In the line above, do you see a RAM-stick icon before `1.1G`?"
    - options:
      1. "Yes, I see an icon" — enables Nerd Font glyphs (`icons.nerd_font: true`)
      2. "No — a box, or blank space" — keeps text labels (`icons.nerd_font: false`)

    "Blank space" is an explicit option on purpose: a missing glyph often renders
    as nothing rather than as tofu, and a user skimming for a box will answer yes
    to an empty gap.

    **4d. Write the answer, merging — never clobbering.**

    The config file is `~/.claude/statusline-config.json` for **both** scopes: the
    script always reads it from `$HOME`, even when installed project-scoped.

    1. Read `~/.claude/statusline-config.json` (may not exist — then start from `{}`)
    2. Set only `icons.nerd_font` to the boolean answer, leaving every other key
       untouched (users commonly have `sections`, `theme`, `context_bar_width`)
    3. Write the merged object back

    Writing `false` explicitly is fine — it matches the built-in default.
  </step>

  <step number="5" name="Verify">
    Test the installed script by running:
    ```bash
    echo '{"model":{"display_name":"Claude Test"},"cost":{"total_cost_usd":0.42,"total_duration_ms":120000},"context_window":{"used_percentage":25},"cwd":"'$(pwd)'"}' | bash <installed-script-path>
    ```
    Show the output to the user.
  </step>

  <step number="6" name="Report">
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
      - Nerd Font icons: {on|off — no patched font found|off}
      - Config: ~/.claude/statusline-config.json

    Use /statusline:customize-statusline to configure sections and themes.
    Restart Claude Code to see the new status line.
    ```
  </step>
</instructions>
