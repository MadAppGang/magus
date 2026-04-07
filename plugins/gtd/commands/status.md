---
name: status
description: "Show the GTD dashboard with color-coded task counts. Usage: /gtd:status [--json]"
---

# GTD Status Dashboard

You are implementing the GTD status command. The user wants an ANSI-colored dashboard showing the current state of their GTD system at a glance.

## Parse the Input

- `--json` flag: output machine-readable JSON instead of ANSI dashboard

## Run the Dashboard

Run the display tool:

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" status
```

## If --json Flag

Output structured JSON instead:

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" status --json
```

## After Showing Status

Offer contextual suggestions based on counts:
- Inbox > 5: "You have many unprocessed items. Run `/gtd:clarify` to clarify them."
- Next == 0 and Inbox > 0: "No next actions! Run `/gtd:clarify` to move inbox items to next actions."
- Overdue > 0: "You have overdue items. Check `/gtd:next` to address them."
- Review overdue: "Your weekly review is overdue. Run `/gtd:review` when you have 15 minutes."
- Everything healthy: "Your GTD system is in good shape!"
