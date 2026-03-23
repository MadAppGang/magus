---
name: clarify
description: "Walk through inbox items applying the GTD decision tree. Usage: /gtd:clarify [--id gtd-xxx]"
---

# GTD Clarify — Process Inbox Items

You are implementing the GTD clarify command. The user wants to clarify inbox items by walking through the GTD decision tree interactively.

## Parse the Input

- If `--id <gtd-id>` provided: process only that specific item
- Otherwise: process all inbox items sequentially

## Load Inbox Items

Run this Bash command:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"

if [ ! -f "$GTD_FILE" ]; then
  echo "No GTD store found. Run /gtd:capture to add your first item."
  exit 0
fi

# Get inbox items (or single item if --id provided)
ITEMS=$(jq '[.tasks[] | select(.list == "inbox" and .completed == null)]' "$GTD_FILE")
ITEM_COUNT=$(echo "$ITEMS" | jq 'length')
echo "Inbox items to process: $ITEM_COUNT"
echo "$ITEMS"
```

## Process Each Item — GTD Decision Tree

For EACH inbox item, walk the user through this decision tree using `ask_followup_question` / conversation:

### Step 1: Present the item

Show: `Processing: "<subject>" [<id>]`

### Step 2: Is it actionable?

Ask: "Is this actionable? [y / n / trash / reference / someday]"

- **trash**: Delete from GTD store. Move on.
- **reference**: Move to `reference` list. Ask for a reference label to add to notes.
- **someday**: Move to `someday` list.
- **n (not actionable, not trash)**: Ask "Move to reference or trash?" and handle.
- **y**: Continue to step 3.

### Step 3: Takes less than 2 minutes?

Ask: "Can you do this in under 2 minutes? [y/N]"

- **y**: Say "Do it now — I'll help you complete it. What do you need?" and assist completion. When done, mark completed.
- **n**: Continue to step 4.

### Step 4: Should you delegate?

Ask: "Should you delegate this to someone? [y/N]"

- **y**: Ask "Who are you delegating to?" → Move to `waiting` list, set `waitingOn` field.
- **n**: Continue to step 5.

### Step 5: Is this a project (multi-step)?

Ask: "Is this a multi-step project? [y/N]"

- **y**: Ask "What's the project name?" → Change list to `project`. Then ask "What's the very next physical action?" → Create a new `next` task with parentId pointing to this project.
- **n**: Continue to step 6.

### Step 6: Context and energy

Ask: "Context — where/how can you do this? [@code / @review / @test / @deploy / @research / @meeting / @offline / skip]"

Ask: "Energy level? [high / medium / low / skip]"

Ask: "Time estimate in minutes? [15 / 30 / 60 / 90 / skip]"

### Step 7: Move to Next Actions

After collecting all info, update the task in GTD store:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"

TASK_ID="<id>"
NEW_LIST="next"  # or project/waiting/someday/reference/completed
CONTEXT='["@code"]'  # JSON array
ENERGY="medium"
TIME_ESTIMATE=60
WAITING_ON=""  # if delegated

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP="${GTD_FILE}.tmp.$$"
jq \
  --arg id "$TASK_ID" \
  --arg list "$NEW_LIST" \
  --argjson context "$CONTEXT" \
  --arg energy "$ENERGY" \
  --argjson time "$TIME_ESTIMATE" \
  --arg waiting "$WAITING_ON" \
  --arg now "$NOW" \
  '(.tasks[] | select(.id == $id)) |= (
    .list = $list |
    .context = $context |
    .energy = $energy |
    .timeEstimate = $time |
    .waitingOn = (if $waiting != "" then $waiting else null end) |
    .modified = $now
  )' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

SUBJECT=$(jq -r --arg id "$TASK_ID" '.tasks[] | select(.id == $id) | .subject' "$GTD_FILE")
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" moved "$TASK_ID" "$NEW_LIST" "$SUBJECT"
```

## After Processing All Items

Show a summary:
```bash
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" clarify-done "$PROCESSED_COUNT"
```

Run `/gtd:status` output to show the updated dashboard.
