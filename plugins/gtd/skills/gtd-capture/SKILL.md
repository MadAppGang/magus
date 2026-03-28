---
name: gtd-capture
description: Proactive capture trigger detection for GTD workflow. Detects "I need to", "we should", "remind me" signals and routes to inbox.
user-invocable: false
---

# GTD Capture Skill — Proactive Capture Trigger Detection

## When This Skill Applies

Apply this skill whenever you detect any of the following semantic signals in the user's messages or code:

### Explicit Capture Signals (→ Inbox)
- "I need to ___", "we need to ___", "you need to ___"
- "we should ___", "I should ___", "we ought to ___"
- "remind me to ___", "don't forget ___", "remember to ___"
- "TODO:", "FIXME:", "HACK:", "NOTE: action required"
- "must ___", "have to ___", "got to ___"

### Waiting For Signals (→ Waiting list)
- "waiting on ___", "waiting for ___", "blocked by ___"
- "once ___ is done", "after ___ finishes", "depends on ___"
- "need ___ to respond", "need ___ from ___"

### Deferral Signals (→ Someday/Maybe)
- "someday", "eventually", "later", "at some point"
- "when we have time", "would be nice to", "might want to"
- "tech debt", "backlog item", "refactor (not now)"
- "future improvement", "nice to have"

## Frequency Guard

**Maximum 2 capture suggestions per session.** After 2 suggestions, stop offering — do not suggest a third time.

Track mentally whether you have already offered capture in this session.

## How to Suggest

When you detect a capture signal, offer ONE of these phrasings (pick based on signal type):

**Inbox capture:**
```
Capture to GTD inbox? → "[detected text]" [y/N]
```

**Waiting For capture:**
```
Add to Waiting For: "[detected text]"? [y/N]
```

**Someday/Maybe capture:**
```
Add to Someday/Maybe: "[detected text]"? [y/N]
```

## Response to User's Answer

**If user says "y" or "yes":**
Run the Bash command to append to tasks.json:
```bash
CWD=$(pwd)
GTD_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/gtd-lib.sh"
source "$GTD_LIB"
gtd_init
ID=$(gtd_new_id)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TASK_JSON=$(jq -n --arg id "$ID" --arg subject "<detected text>" --arg list "<inbox|waiting|someday>" --arg created "$NOW" \
  '{id: $id, subject: $subject, list: $list, context: [], parentId: null, energy: null, timeEstimate: null, waitingOn: null, dueDate: null, created: $created, modified: $created, completed: null, notes: ""}')
echo "$TASK_JSON" | gtd_append_task
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" capture "$ID" "<detected text>" --list "<inbox|waiting|someday>"
```

**If user says "n", ignores it, or doesn't respond:** Drop it silently. Never repeat the suggestion for the same item.

## Opt-Out

Check `GTD_SUGGESTIONS` environment variable:
- `off` or `disabled`: Never suggest captures. Skip this skill entirely.
- `minimal`: Only suggest at session start via hook. Skip in-conversation suggestions.
- `on` (default): Full proactive capture enabled.

## Key Principles

1. **Never interrupt flow**: Offer capture as a one-line aside, not a multi-paragraph interruption.
2. **Default to no-action**: The [y/N] default is N — the user decides whether to capture.
3. **Be specific**: Always pre-fill the detected text so the user can confirm or edit, not retype.
4. **Stay quiet when healthy**: If the user is clearly in deep focus (long code changes, no conversation), suppress suggestions.
5. **Capture the intent, not the exact words**: Rephrase to start with an action verb if the detected text is not action-oriented. E.g., "Redis clustering" → "Investigate Redis clustering options".
