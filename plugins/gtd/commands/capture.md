---
name: capture
description: "Quickly capture an item to your GTD inbox. Usage: /gtd:capture \"<text>\" [--someday]"
---

# GTD Capture

You are implementing the GTD capture command. The user wants to add an item to their GTD inbox immediately.

## Parse the Input

The user invoked `/gtd:capture` with optional text arguments. Extract:
- **text**: The main capture text (everything after `/gtd:capture`, removing quotes and flags)
- **--someday**: Flag to capture directly to Someday/Maybe list instead of inbox
- **--context @tag**: Optional context tag (e.g., `@code`, `@review`, `@research`)

If no text was provided, ask: "What do you want to capture? (e.g., `/gtd:capture \"Investigate Redis clustering\"`)"

## Execute

Run this Bash command to add the item to GTD:

```bash
# Set variables from parsed input
TEXT="<captured text>"
LIST="inbox"  # or "someday" if --someday flag present
CONTEXT_TAG=""  # e.g. "@code" if --context provided

CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
GTD_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/gtd-lib.sh"

# Ensure GTD store exists
bash -c "source \"${GTD_LIB}\" && CWD=\"${CWD}\" gtd_init"

# Generate ID and append task
ID=$(bash -c "source \"${GTD_LIB}\" && CWD=\"${CWD}\" gtd_new_id")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

TASK=$(jq -n \
  --arg id "$ID" \
  --arg subject "$TEXT" \
  --arg list "$LIST" \
  --arg created "$NOW" \
  --arg context "$CONTEXT_TAG" \
  '{
    id: $id,
    subject: $subject,
    list: $list,
    context: (if $context != "" then [$context] else [] end),
    parentId: null,
    energy: null,
    timeEstimate: null,
    waitingOn: null,
    dueDate: null,
    created: $created,
    modified: $created,
    completed: null,
    notes: ""
  }')

# Atomic append
TMP="${GTD_FILE}.tmp.$$"
jq --argjson task "$TASK" '.tasks += [$task]' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

# Confirmation output
if [ "$LIST" = "inbox" ]; then
  echo -e "\033[95mInbox\033[0m \033[90m+\033[0m \"${TEXT}\" \033[90m[${ID}]\033[0m"
else
  echo -e "\033[96mSomeday/Maybe\033[0m \033[90m+\033[0m \"${TEXT}\" \033[90m[${ID}]\033[0m"
fi
```

## After Capture

Tell the user:
- The item was captured with its ID
- If it went to inbox: "Run `/gtd:process` to clarify it when ready."
- If it went to Someday/Maybe: "Review during your weekly `/gtd:review`."

Do NOT ask clarifying questions during capture — the GTD principle is to capture fast and clarify later in `/gtd:process`.
