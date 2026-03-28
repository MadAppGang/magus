---
name: gtd-review
description: Weekly review automation for GTD workflow. Guides through inbox processing, project review, and next actions.
user-invocable: false
---

# GTD Review Skill — Weekly Review Automation

## When This Skill Applies

Apply this skill when any of the following occur:

### Direct Invocation
- User runs `/gtd:review`
- User says "weekly review", "do my GTD review", "run the review"

### Delegation
- `gtd-reviewer` agent is invoked
- User asks "review my tasks", "check my GTD system"

## Review Protocol

This skill implements the full GTD Weekly Review protocol, adapted for developer workflows.

### Phase 1: Get Clear (Collect Loose Ends)

1. **Gather stray papers and materials** — In Claude Code context, this means: any TODOs in code recently touched, any items mentioned in chat that weren't captured.

2. **Empty inbox** — All inbox items should be processed before proceeding. If inbox > 0, prompt: "Your inbox has [N] items. Process them now before the weekly review? [Y/n]"

### Phase 2: Get Current (Update Your System)

3. **Review Next Actions** — Go through each next action:
   - Still relevant?
   - Appropriately estimated (time + energy)?
   - Correct context tag?

4. **Review Projects** — For each project:
   - Is there a defined next action?
   - Any blockers?
   - Still a priority?

5. **Review Waiting For** — For each waiting item:
   - Any follow-up needed?
   - Has it been resolved (should it be moved to completed or next)?

6. **Review Someday/Maybe** — For each item:
   - Promote to next actions this week?
   - Still relevant or archive?
   - Developer augmentation: surface items with "learn", "study", "investigate" that are older than 30 days.

7. **Review upcoming deadlines** — List any due dates in the next 14 days.

### Phase 3: Get Creative (Be Innovative)

8. **Brain dump** — Ask: "Is there anything else on your mind? Take 2 minutes and dump everything you've been thinking about." Capture all responses to inbox.

9. **Next week planning** — Ask: "What are your top 3 next actions for this week?" Ensure these are in the Next Actions list with appropriate priority.

10. **Review goals** — Ask: "Are you making progress toward your larger goals? Any new projects to add?"

### Phase 4: Developer-Specific Augmentations

11. **PR and code review queue** — Ask: "Any pending code reviews, open PRs, or CI/CD issues in your Waiting For list?"

12. **Tech debt audit** — Surface Someday/Maybe items tagged or named with "refactor", "debt", "cleanup", "migrate" that are older than 30 days. Ask whether to promote or archive.

## Execution

When running the review:

1. Load GTD store:
```bash
cat "${CWD}/.claude/gtd/tasks.json"
```

2. Generate and present each section with counts and ANSI colors via Bash echo.

3. For sections requiring user decisions, ask one question at a time. Wait for response before proceeding.

4. After all sections, update `lastReview`:
```bash
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP="${CWD}/.claude/gtd/tasks.json.tmp.$$"
jq --arg now "$NOW" '.lastReview = $now' "${CWD}/.claude/gtd/tasks.json" > "$TMP" && mv "$TMP" "${CWD}/.claude/gtd/tasks.json"
```

5. Optionally save review report:
```bash
WEEK=$(date +"%Y-W%V")
mkdir -p "${CWD}/.claude/gtd/reviews"
# Write markdown summary to .claude/gtd/reviews/${WEEK}.md
```

## Quick Review Mode (--quick flag)

When running in quick mode, only cover:
1. Inbox items (process any that exist)
2. Waiting For items older than 7 days (prompt for follow-up)
3. Brain dump (quick capture round)
4. Update lastReview timestamp

Skip: full next actions review, projects review, someday review, and planning questions.

## Output Style

- Use ANSI colors via Bash echo (green = healthy, yellow = needs attention, red = overdue)
- Present one section at a time — don't dump everything at once
- Use checkboxes or numbered lists for actionable items
- End with a positive summary and next review date
