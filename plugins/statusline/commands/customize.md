---
name: customize-statusline
description: Interactively configure statusline sections, theme, and bar widths
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

<role>
  <identity>Status Line Customizer</identity>
  <mission>
    Provide an interactive editor for statusline configuration. Read current
    config, show it, let the user tweak settings, then save and redeploy.
  </mission>
</role>

<instructions>
  Execute ALL steps in a SINGLE response. Do NOT pause for confirmation between steps.

  <step number="1" name="Load config">
    Read `~/.claude/statusline-config.json`. If it doesn't exist, use these defaults:
    ```json
    {
      "sections": {
        "model": true,
        "branch": true,
        "worktree": true,
        "cost": true,
        "duration": true,
        "context_bar": true,
        "plan_limits": true
      },
      "context_bar_width": 12,
      "plan_bar_width": 10,
      "theme": "default"
    }
    ```
  </step>

  <step number="2" name="Show current config">
    Display the current configuration as a formatted table:
    ```
    Current Statusline Configuration
    ─────────────────────────────────
    Sections:
      model       ✓ on
      branch      ✓ on
      worktree    ✓ on
      cost        ✓ on
      duration    ✓ on
      context_bar ✓ on
      plan_limits ✓ on

    Bar Widths:
      context_bar_width: 12
      plan_bar_width:    10

    Theme: default
    ```
  </step>

  <step number="3" name="Ask what to change">
    Use AskUserQuestion:
    - question: "What would you like to customize?"
    - options:
      1. "Toggle sections" — turn individual sections on/off
      2. "Change theme" — switch between default, monochrome, minimal, neon
      3. "Change bar widths" — adjust context bar or plan bar width
      4. "Reset to defaults" — restore all settings to defaults

    Based on choice:

    **Toggle sections:** Use AskUserQuestion with multiSelect:true listing all 7 sections.
    Sections the user selects get TOGGLED (on→off, off→on). Show updated state.

    **Change theme:** Use AskUserQuestion with the 4 theme options:
    - "default" — warm/cool ANSI palette (cyan, green, yellow, orange, red)
    - "monochrome" — white/gray only
    - "minimal" — muted dim ANSI colors
    - "neon" — bright 256-color palette

    **Change bar widths:** Use AskUserQuestion:
    - "Context bar width" — then ask for number (8-20, default 12)
    - "Plan bar width" — then ask for number (6-16, default 10)

    **Reset to defaults:** Restore the default config from step 1.
  </step>

  <step number="4" name="Save config">
    Write the updated configuration to `~/.claude/statusline-config.json` with
    proper JSON formatting.
  </step>

  <step number="5" name="Redeploy script">
    Check if the statusline is currently installed:
    - Project: `.claude/statusline-command.sh`
    - Global: `~/.claude/statusline-command.sh`

    For each installed location, read the latest script from
    `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh` and overwrite the installed copy
    so the new config takes effect.
  </step>

  <step number="6" name="Preview">
    Run a test to preview the new look:
    ```bash
    echo '{"model":{"display_name":"Claude Opus 4.6"},"cost":{"total_cost_usd":1.23,"total_duration_ms":180000},"context_window":{"used_percentage":45},"cwd":"'$(pwd)'"}' | bash <installed-script-path>
    ```
    Show the rendered output to the user.
  </step>
</instructions>
