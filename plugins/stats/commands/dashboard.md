---
name: dashboard
description: "Render a full ASCII dashboard of Claude Code session analytics with bar charts, sparklines, and productivity suggestions."
---

# Stats Dashboard

You are implementing the `/stats:dashboard` command. This command renders a complete ASCII dashboard of session analytics directly in the terminal.

## What It Does

Run: `bun ${CLAUDE_PLUGIN_ROOT}/dashboard/render.ts --days 14`

Parse `--days` and `--project` from `$CLAUDE_ARGS` and pass them through.

## Dashboard Sections

1. **Overview** — Sessions, avg duration, total tool calls, total time
2. **Activity Breakdown** — Research / coding / testing / delegation / other as horizontal bar charts (Unicode block characters) with percentages
3. **Top Tools** — Top 10 tools by call count with avg duration and activity category
4. **Daily Activity** — Last N days sparkline for duration trends and session count
5. **Suggestions** — Actionable productivity tips based on your usage patterns

## Options

- `--days N` — Time window in days (default: 14). Pass through from user arguments.
- `--project PATH` — Filter to a specific project path. Pass through from user arguments.

## Exit Codes

- `0` — Success (dashboard rendered)
- `1` — No data found in the requested time window
- `2` — Database error
