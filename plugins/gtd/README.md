# GTD

Getting Things Done inside Claude Code. Capture, clarify, organise, reflect, and engage over
a task store that hooks keep in sync with your session in real time.

The sync is the part that makes it work: tasks the assistant creates during a session land
in your GTD store automatically, so the list does not drift from what actually happened.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "gtd@magus": true } }
```

## Commands

| Command | Stage | What it does |
|---|---|---|
| `/gtd:capture "<text>"` | Capture | Drop something into the inbox. `--someday` to defer it |
| `/gtd:clarify` | Clarify | Walk the inbox through the GTD decision tree. `--id gtd-xxx` for one item |
| `/gtd:next` | Engage | Next actions, filterable by context, energy, or time available |
| `/gtd:engage <task>` | Engage | Set the active task; its subtasks load into the session |
| `/gtd:status` | — | Dashboard with colour-coded counts. `--json` for machine output |
| `/gtd:review` | Reflect | The weekly review. `--quick` for the short form |
| `/gtd:help` | — | All commands with examples |

The daily loop is `/gtd:capture` as things occur to you, `/gtd:clarify` to empty the inbox,
then `/gtd:engage` to pick what you are actually doing.

## Terminology

v2.0.0 moved to canonical GTD stage names. **Clarify** and **Engage** replaced the older
names, so `/gtd:engage` is what sets your active task.

## Agent

**`gtd:gtd-reviewer`** runs the full weekly review protocol in its own context window:
inbox processing, project review, and next-action generation. That is deliberately a
separate context, because a weekly review reads a lot and you do not want it competing with
your working session.

## Skills

- **`gtd:gtd-capture`** — detects capture triggers ("I need to", "we should", "remind me")
  so things get captured without you switching modes
- **`gtd:gtd-review`** — drives the weekly review

## Hooks

GTD installs `SessionStart`, `PreToolUse:TaskCreate`, `PostToolUse:TaskCreate/TaskUpdate`,
and `Stop` hooks. These are what keep the task store synchronised with the session. If tasks
stop syncing, that is the first place to look.

## Relationship to kanban

`kanban@magus` is a separate plugin with its own task store. They do not share state; pick
whichever model fits how you work.
