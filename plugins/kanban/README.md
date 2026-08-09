# Kanban

A kanban board for task management inside Claude Code. Five columns, cycle-safe task
dependencies, priority indicators, and WIP limits.

Cycle-safe matters: blocking A on B on A is rejected rather than silently creating a
deadlock you discover later when nothing is startable.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "kanban@magus": true } }
```

## Commands

| Command | What it does |
|---|---|
| `/kanban:board` | Show the board. `--filter @context`, `--project #id`, `--compact` |
| `/kanban:add "title"` | Add a task. `--status todo`, `--priority` |
| `/kanban:list` | Filtered list. `--status in-progress`, `--blocked` |
| `/kanban:show #id` | One task in detail: subtask progress, dependency chain, status |
| `/kanban:move #id <status>` | Move between columns |
| `/kanban:block #id #blocker-id` | Add a blocking dependency |
| `/kanban:unblock #id [#blocker-id]` | Remove one |
| `/kanban:help` | All commands with examples |

Typical loop: `/kanban:board` to see the state, `/kanban:move` as work progresses,
`/kanban:block` when something turns out to depend on something else.

## WIP limits

The board enforces work-in-progress limits per column. Hitting one is the signal to finish
something before starting the next thing, which is the entire point of a kanban board and
the part most tools let you ignore.

## Dependencies and blocking

`/kanban:block` records that one task cannot start until another finishes. `/kanban:list
--blocked` shows everything currently waiting, and `/kanban:show` renders the full
dependency chain for a single task so you can see what is actually holding it up.

## Relationship to GTD

`gtd@magus` is a separate plugin over an independent task store. Kanban decoupled from GTD
at v1.6.0; they no longer share state. Use whichever matches how you plan, or both for
different projects.

## Hooks

Kanban installs hooks to keep the board in sync with tasks created during a session.
