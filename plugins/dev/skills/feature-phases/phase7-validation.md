# Phase 7: Real 3rd Party Validation

**Objective:** Verify feature ACTUALLY works using browser automation

## Steps

### Step 7.1: Mark phase as in_progress
TaskUpdate(taskId: {phase7_task_id}, status: "in_progress")

### Step 7.2: Read validation config
Read validation config from ${SESSION_PATH}/validation-criteria.md

### Step 7.3: Deploy Application

Read deploy command from validation config.
Execute in background:
```bash
# Start dev server
${deploy_command} &
DEV_SERVER_PID=$!

# Wait for server to be ready (max 30 seconds)
for i in {1..30}; do
  if curl -s ${test_url} > /dev/null 2>&1; then
    echo "Server ready"
    break
  fi
  sleep 1
done
```

If server doesn't start:
- Save error to ${SESSION_PATH}/validation/deploy-error.md
- Return FAIL with deploy error

### Step 7.4: Navigate to Test URL

Use Chrome MCP tools:
```
mcp__chrome-devtools__new_page(url: ${test_url})
// OR if page exists:
mcp__chrome-devtools__navigate_page(url: ${test_url})
```

Wait for page load (check for expected elements)

### Step 7.5: Take Screenshot (Before Action)

```
mcp__chrome-devtools__take_screenshot(
  filePath: "${SESSION_PATH}/validation/screenshot-before.png"
)
```

If reference design exists:
- Compare screenshots using vision analysis
- Calculate similarity percentage
- If below threshold (default 85%): Note in validation result

### Step 7.6: Perform Real User Actions

Read test actions from validation criteria.
Execute each action:

```
// Example: Login flow
mcp__chrome-devtools__take_snapshot()  // Get element UIDs

mcp__chrome-devtools__fill(
  uid: {email_field_uid},
  value: "test@example.com"
)

mcp__chrome-devtools__fill(
  uid: {password_field_uid},
  value: "password123"
)

mcp__chrome-devtools__click(
  uid: {login_button_uid}
)
```

Log each action result to ${SESSION_PATH}/validation/action-log.md

### Step 7.7: Verify Expected Behavior

Read expected behavior from validation criteria.
Verify each expectation:

If "Redirect to another page":
```
mcp__chrome-devtools__take_snapshot()
// Check current URL matches expected
```

If "Content updates on page":
```
mcp__chrome-devtools__take_snapshot()
// Check for expected elements
```

Take final screenshot:
```
mcp__chrome-devtools__take_screenshot(
  filePath: "${SESSION_PATH}/validation/screenshot-after.png"
)
```

### Step 7.8: Generate Validation Result

Write to ${SESSION_PATH}/validation/result-iteration-{N}.md:
```markdown
# Validation Result - Iteration {N}

## Summary
- **Status**: PASS / FAIL
- **Timestamp**: {timestamp}
- **Test URL**: {url}

## Checks
| Check | Result | Details |
|-------|--------|---------|
| Deploy | PASS/FAIL | Server started in {time}s |
| Navigation | PASS/FAIL | Page loaded successfully |
| Screenshot (before) | PASS/FAIL | {similarity}% match |
| User Actions | PASS/FAIL | {passed}/{total} actions |
| Expected Behavior | PASS/FAIL | {description} |
| Screenshot (after) | PASS/FAIL | {details} |

## Evidence
- Before: ${SESSION_PATH}/validation/screenshot-before.png
- After: ${SESSION_PATH}/validation/screenshot-after.png
- Action Log: ${SESSION_PATH}/validation/action-log.md

## Issues Found (if FAIL)
{detailed description of what went wrong}

## Rejection Rules Applied
- [x] No "should work" assumptions accepted
- [x] No "tests pass" as final proof
- [x] No "pre-existing issue" excuses
- [x] Screenshot evidence captured
```

Also write to ${SESSION_PATH}/validation/result.md (always overwrite with latest):
Same content as result-iteration-{N}.md (allows validator to find the latest result).

### Step 7.9: Handle Result

If PASS:
- Mark Phase 7 as completed
- Exit outer loop
- Proceed to Phase 8

If FAIL:
- Generate feedback for next iteration:

  Write to ${SESSION_PATH}/validation/feedback-iteration-{N}.md:
  ```markdown
  # Validation Feedback - Iteration {N}

  ## What Failed
  {specific failures with evidence}

  ## Required Fixes
  1. {fix 1 with exact details}
  2. {fix 2 with exact details}

  ## Evidence
  - Actual screenshot: {path}
  - Expected: {description or reference path}
  - Diff: {what's different}
  ```

  - Check if outer loop should continue (based on iteration-config.json)
  - If continuing: Return to Phase 3 with feedback
  - If limit reached: Escalate to user

### Step 7.10: Cleanup
```bash
# Stop dev server if running
if [ -n "$DEV_SERVER_PID" ]; then
  kill $DEV_SERVER_PID 2>/dev/null
fi
```

### Step 7.11: Mark phase as completed
TaskUpdate(taskId: {phase7_task_id}, status: "completed")

## Quality Gate
All validation checks pass with screenshot evidence.
Required artifact: ${SESSION_PATH}/validation/result.md (status: PASS)
