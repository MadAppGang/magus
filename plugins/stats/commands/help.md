---
name: help
description: "Show all available stats commands with descriptions and usage examples."
---

# Stats Help

You are implementing the `/stats:help` command. Display a formatted help panel listing all stats plugin commands.

## Display

Run this Bash command to render the help panel:

```bash
echo -e "
\033[90m┌── Stats Plugin — Session Analytics for Claude Code ──────────────────────────┐\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mReport\033[0m                                                                    \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/stats:report\033[0m              — ASCII report: sessions, tools, trends        \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--days N\033[0m                 Time window in days (default: 7)               \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--project <path>\033[0m         Filter to a specific project                   \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--all-projects\033[0m           Include data from all projects                 \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--json\033[0m                   Output raw JSON instead of ASCII               \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mDashboard\033[0m                                                                 \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/stats:dashboard\033[0m           — ASCII dashboard with charts and suggestions  \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--days N\033[0m                 Time window in days (default: 14)              \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--project <path>\033[0m         Filter to a specific project                   \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mConfig\033[0m                                                                    \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/stats:config\033[0m              — Show current configuration                   \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--retention-days N\033[0m       Set data retention (1–3650 days)               \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--session-summary on|off\033[0m Toggle session-start context injection         \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--enabled on|off\033[0m         Enable or disable all stats collection         \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mClear\033[0m                                                                     \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/stats:clear\033[0m               — Wipe all stats data (irreversible)           \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--force\033[0m                  Skip confirmation prompt                       \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mData\033[0m                                                                      \033[90m│\033[0m
\033[90m│\033[0m  Database: \033[90m~/.claude/stats/stats.db\033[0m                                        \033[90m│\033[0m
\033[90m│\033[0m  Config:   \033[90m~/.claude/stats/config.json\033[0m                                     \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mPrivacy\033[0m                                                                   \033[90m│\033[0m
\033[90m│\033[0m  Records: tool names, durations, session timestamps, project paths           \033[90m│\033[0m
\033[90m│\033[0m  Never records: file contents, parameters, message text                      \033[90m│\033[0m
\033[90m└────────────────────────────────────────────────────────────────────────────────┘\033[0m

\033[90mActivity categories: research | coding | testing | delegation | other\033[0m
"
```

After displaying the help panel, briefly explain:
- What the stats plugin tracks: tool call counts, durations, session length, activity breakdown
- The quickest way to get started: `/stats:report` for an immediate overview of the last 7 days
- How to disable collection temporarily: `/stats:config --enabled off`
