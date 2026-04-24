---
name: help
description: "Show all kanban commands with descriptions and usage examples."
---

# Kanban Help

You are implementing the kanban help command. Show a formatted help panel listing all kanban commands.

## Display

Run this Bash command to render the help panel:

```bash
echo -e "
\033[90m┌── Kanban Plugin — Board View for Claude Code ────────────────────────────────┐\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mBoard\033[0m                                                                     \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:board\033[0m              — Visual kanban board (all columns)           \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--filter @context\033[0m        Filter cards by context tag                   \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--project #id\033[0m            Filter by project                             \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--compact\033[0m                Compact display                               \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mAdd\033[0m                                                                       \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:add\033[0m \033[90m\"title\"\033[0m          — Create a task on the board               \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--status todo\033[0m            Column: backlog|todo|in-progress|review|done  \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--priority high\033[0m          Priority: urgent|high|medium|low              \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--context @tag\033[0m           Context tag for filtering                     \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mMove\033[0m                                                                      \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:move\033[0m \033[90m#id <status>\033[0m     — Move task to a column                   \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mDependencies\033[0m                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:block\033[0m \033[90m#id #blocker\033[0m    — #blocker blocks #id (cycle-safe)        \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:unblock\033[0m \033[90m#id [#b]\033[0m      — Remove blocker (all if no #b given)    \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mInspect\033[0m                                                                   \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:show\033[0m \033[90m#id\033[0m              — Detailed task: subtasks, deps, history  \033[90m│\033[0m
\033[90m│\033[0m  \033[92m/kanban:list\033[0m               — Filtered task list                          \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--status in-progress\033[0m     Filter by column                              \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--blocked\033[0m                Show only blocked tasks                       \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--ready\033[0m                  Tasks with no open blockers                   \033[90m│\033[0m
\033[90m│\033[0m    \033[90m--priority high\033[0m          Filter by priority level                      \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mData\033[0m                                                                      \033[90m│\033[0m
\033[90m│\033[0m  Store: \033[90m.claude/kanban/tasks.json\033[0m (kanban-only, independent)            \033[90m│\033[0m
\033[90m│\033[0m                                                                              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mColumns\033[0m: backlog → todo → in-progress → review → done                    \033[90m│\033[0m
\033[90m│\033[0m  \033[97mPriorities\033[0m: \033[91m⚡U\033[0m urgent  \033[93m⚡H\033[0m high  \033[90m·M\033[0m medium  \033[90m·L\033[0m low              \033[90m│\033[0m
\033[90m│\033[0m  \033[97mWIP Limit\033[0m: 3 tasks max in-progress (configurable in tasks.json)          \033[90m│\033[0m
\033[90m└────────────────────────────────────────────────────────────────────────────────┘\033[0m
"
```

## After Displaying

Briefly explain:
- Tasks live in `.claude/kanban/tasks.json` with an independent kanban-only schema. Upgrading from v1.5.x: legacy tasks in `.claude/gtd/tasks.json` are not auto-migrated — re-add with `/kanban:add`.
- The workflow: `backlog → todo → in-progress → review → done`
- Dependency tracking: use `/kanban:block` to prevent tasks from starting before blockers are resolved
