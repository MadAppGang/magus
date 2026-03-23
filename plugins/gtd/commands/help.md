---
name: help
description: "Show all GTD commands with descriptions and usage examples."
---

# GTD Help

You are implementing the GTD help command. Show a formatted help panel listing all GTD commands.

## Display

Run this Bash command to render the help panel:

```bash
echo -e "
\033[90m┌── GTD Plugin — Getting Things Done for Claude Code ──────────────────────────┐\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mCapture\033[0m                                                                   \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:capture\033[0m \033[90m\"<text>\"\033[0m  — Add item to inbox instantly                     \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--someday\033[0m        Bypass inbox, go direct to Someday/Maybe            \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--context @tag\033[0m   Pre-assign a context tag                             \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mClarify\033[0m                                                                   \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:clarify\033[0m       — Walk inbox through GTD decision tree                \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--id gtd-xxx\033[0m     Clarify a single specific item                       \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mEngage\033[0m                                                                    \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:next\033[0m          — Show actionable next actions                        \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--context @code\033[0m  Filter by context tag                                \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--energy high\033[0m    Filter by energy level (high/medium/low)             \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--time 30\033[0m        Show tasks taking <= N minutes                       \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--waiting\033[0m        Show Waiting For list instead                        \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:engage\033[0m \033[90m<id|name>\033[0m — Set active task, load subtasks into session    \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mReview\033[0m                                                                    \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:review\033[0m        — Run the GTD Weekly Review (8 auto + 4 guided)      \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--quick\033[0m          Abbreviated review (inbox + stale waiting)           \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mDashboard\033[0m                                                                 \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/gtd:status\033[0m        — Color-coded dashboard (inbox/next/waiting counts)  \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--json\033[0m           Machine-readable JSON output                         \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mData\033[0m                                                                      \033[90m│\033[0m
\033[90m│\033[0m  Stored in: \033[90m.claude/gtd/tasks.json\033[0m (project-local, git-committable)        \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mOpt-Out\033[0m                                                                   \033[90m│\033[0m
\033[90m│\033[0m  Set \033[90mGTD_SUGGESTIONS=off\033[0m to disable proactive suggestions                 \033[90m│\033[0m
\033[90m│\033[0m  Set \033[90mGTD_SUGGESTIONS=minimal\033[0m for session-start reminders only              \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mContexts\033[0m (where/how you can do the task — use for filtering):             \033[90m│\033[0m
\033[90m│\033[0m    @code @review @test @deploy @research @meeting @offline               \033[90m│\033[0m
\033[90m│\033[0m    Filter: \033[92m/gtd:next --context @review\033[0m                                      \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mLists\033[0m: inbox | next | waiting | someday | project | reference              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mEnergy\033[0m: high | medium | low                                               \033[90m│\033[0m
\033[90m└────────────────────────────────────────────────────────────────────────────────┘\033[0m

\033[90mGTD Workflow: Capture → Clarify → Organize → Reflect → Engage\033[0m
"
```

After displaying the help panel, briefly explain:
- The GTD mindset: "capture everything, clarify later, act on what matters"
- The recommended starting point: `/gtd:capture` to add your first item, then `/gtd:clarify` to process it
- The session integration: tasks created via TaskCreate are automatically synced to the GTD store
