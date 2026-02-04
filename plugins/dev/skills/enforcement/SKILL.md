---
name: phase-enforcement
description: Evidence-based phase completion enforcement for /dev:feature. Use when orchestrating 8-phase feature development to ensure artifacts exist before phase completion, validation criteria are addressed, outer loops are enforced, and show-your-work requirements are met.
version: 1.0.0
tags: [orchestration, enforcement, validation, quality-gates, evidence]
keywords: [phase-completion, artifacts, evidence, validation-criteria, outer-loop, checkpoint, enforcement, quality-gate]
plugin: dev
updated: 2026-02-04
---

# Phase Completion Enforcement

**Version:** 1.0.0
**Purpose:** Mechanical enforcement of phase completion requirements for /dev:feature
**Status:** Production Ready

## Overview

This skill provides **mechanical enforcement** (not just prompt-based instructions) for the 8-phase feature development workflow. It prevents:

1. **Claiming completion without proof** - Artifacts must exist
2. **Skipping documentation** - Required files per phase
3. **Ignoring validation criteria** - Phase 1 criteria must map to Phase 7 results
4. **Bypassing retry logic** - Outer loop enforced with state tracking
5. **Shipping without tests** - Phase 6 requires test files
6. **Faking completion when blocked** - Graceful degradation with honest status
7. **Hiding actual results** - Show-your-work requirement
8. **Missing automated checks** - Checkpoint verification at boundaries

## Enforcement Components

### 1. Phase Completion Validator

**Script:** `scripts/phase-completion-validator.js`

**How it works:**
- Runs as PreToolUse hook on TaskUpdate
- Detects phase from task subject (e.g., "Phase 3: Planning")
- Checks required artifacts exist for that phase
- Blocks completion if artifacts missing or empty

**Required Artifacts per Phase:**

| Phase | Required Artifacts | Custom Checks |
|-------|-------------------|---------------|
| 1 | requirements.md, validation-criteria.md, iteration-config.json | Config has required fields |
| 3 | architecture.md | Plan reviews exist |
| 4 | implementation-log.md | Git changes detected |
| 5 | reviews/code-review/consolidated.md | Has PASS/FAIL verdict |
| 6 | tests/test-plan.md | Test files created |
| 7 | validation/result.md | Has PASS/FAIL status + evidence |
| 8 | report.md | Phase 7 PASSED |

**Usage in orchestrator:**

```markdown
Before marking any phase complete:

1. Run checkpoint verification:
   ```bash
   ${PLUGIN_PATH}/scripts/checkpoint-verifier.sh phase{N} ${SESSION_PATH}
   ```

2. If check passes, mark task complete:
   ```
   TaskUpdate(taskId: X, status: "completed")
   ```

3. If check fails, DO NOT mark complete. Fix missing artifacts first.
```

---

### 2. Outer Loop Enforcer

**Script:** `scripts/outer-loop-enforcer.js`

**How it works:**
- Tracks iteration state in session-meta.json
- Blocks Phase 8 unless Phase 7 PASSED
- Detects regression (score getting worse)
- Handles escalation when max iterations reached

**Commands:**

```bash
# Start new iteration (call before Phase 3)
node outer-loop-enforcer.js start-iteration ${SESSION_PATH}

# Record Phase 7 result
node outer-loop-enforcer.js record-result ${SESSION_PATH} PASS "All checks passed" 95

# Check if Phase 8 can proceed
node outer-loop-enforcer.js check-can-complete ${SESSION_PATH}

# Get current status
node outer-loop-enforcer.js get-status ${SESSION_PATH}
```

**Session state tracking:**

```json
{
  "outerLoop": {
    "currentIteration": 2,
    "maxIterations": 3,
    "mode": "limited",
    "phase7Results": [
      {"iteration": 1, "status": "FAIL", "reason": "Button color mismatch", "score": 78},
      {"iteration": 2, "status": "PASS", "reason": "All checks passed", "score": 94}
    ]
  }
}
```

**Usage in orchestrator:**

```markdown
OUTER LOOP: Before starting Phase 3

1. Start iteration:
   ```bash
   node ${PLUGIN_PATH}/scripts/outer-loop-enforcer.js start-iteration ${SESSION_PATH}
   ```

2. Check exit code:
   - 0: Proceed with iteration
   - 2: Max iterations reached, escalate to user

OUTER LOOP: After Phase 7 completes

1. Record result:
   ```bash
   node ${PLUGIN_PATH}/scripts/outer-loop-enforcer.js record-result ${SESSION_PATH} <PASS|FAIL> "reason" [score]
   ```

2. If PASS: Proceed to Phase 8
3. If FAIL: Loop back to Phase 3 (start-iteration will be called again)

OUTER LOOP: Before Phase 8

1. Verify Phase 7 passed:
   ```bash
   node ${PLUGIN_PATH}/scripts/outer-loop-enforcer.js check-can-complete ${SESSION_PATH}
   ```

2. If exit code 1: BLOCKED - cannot proceed to Phase 8
```

---

### 3. Validation Criteria Enforcer

**Script:** `scripts/validation-criteria-enforcer.js`

**How it works:**
- Parses validation-criteria.md from Phase 1
- Parses validation/result.md from Phase 7
- Matches criteria to results using fuzzy matching
- Blocks if >20% criteria unaddressed

**Usage in orchestrator:**

```markdown
PHASE 7: After creating result.md

1. Run criteria enforcer:
   ```bash
   node ${PLUGIN_PATH}/scripts/validation-criteria-enforcer.js ${SESSION_PATH}
   ```

2. Review generated report:
   ${SESSION_PATH}/validation/criteria-mapping.md

3. If unaddressed criteria found:
   - Update result.md to address them
   - Or document why they couldn't be tested
```

**Output format:**

```markdown
# Validation Criteria Mapping Report

## Summary
- Total Criteria: 5
- Matched: 4
- Unmatched: 1
- Coverage: 80%

## Criteria Mapping
| Line | Criterion | Result | Evidence |
|------|-----------|--------|----------|
| 12 | "Navigate to test URL" | PASS | screenshot-before.png |
| 13 | "Fill email field" | PASS | action-log.md line 5 |
| 14 | "Click login button" | PASS | action-log.md line 8 |
| 15 | "Redirect to dashboard" | PASS | screenshot-after.png |

## ⚠️ Unaddressed Criteria
- Line 16: "Show error for invalid password"
```

---

### 4. Checkpoint Verifier

**Script:** `scripts/checkpoint-verifier.sh`

**How it works:**
- Bash script for fast automated checks
- Runs at phase boundaries
- Verifies files exist and have content
- Checks git state for implementation phase

**Usage:**

```bash
# Before completing Phase 4
./checkpoint-verifier.sh phase4 ${SESSION_PATH}

# Before completing Phase 7
./checkpoint-verifier.sh phase7 ${SESSION_PATH}
```

**Example output:**

```
📋 Checkpoint Verification: phase4
─────────────────────────────────────
Session: ai-docs/sessions/dev-feature-login-20260204-143022

✅ Implementation Log: implementation-log.md (1234 bytes)
✅ Code Changes: 8 files with changes
✅ Implementation Log: Has structured progress

─────────────────────────────────────
✅ Checkpoint passed
```

---

## Integration with /dev:feature

### Phase Transition Protocol

**MANDATORY: Before marking ANY phase as completed:**

```markdown
<phase_completion_protocol>
  **Step 1: Run Checkpoint Verification**

  ```bash
  ${PLUGIN_PATH}/scripts/checkpoint-verifier.sh phase{N} ${SESSION_PATH}
  ```

  If exit code != 0: STOP. Fix missing artifacts first.

  **Step 2: Show Evidence Summary**

  Display 3-5 lines of actual results:
  ```
  ## Phase {N} Evidence
  - Artifact: ${SESSION_PATH}/{artifact}.md (exists, 1234 bytes)
  - Key result: {actual output from phase}
  - Evidence: {file paths to screenshots, logs, etc.}
  ```

  **Step 3: Map to Original Criteria** (for Phase 7)

  ```
  From validation-criteria.md:
  - [x] Criterion 1 → Verified (evidence file)
  - [x] Criterion 2 → Verified (screenshot)
  - [ ] Criterion 3 → Skipped (reason documented)
  ```

  **Step 4: Mark Task Complete**

  Only if Steps 1-3 pass:
  ```
  TaskUpdate(taskId: X, status: "completed")
  ```
</phase_completion_protocol>
```

### Show-Your-Work Requirement

**Anti-pattern (BLOCKED):**

```markdown
I'll run the tests now.
[Task tool call to run tests]
Tests passed! Moving to next phase.
```

**Required pattern:**

```markdown
Running tests:

$ bun test
✓ auth.test.ts (5 tests)
  ✓ should authenticate valid user (12ms)
  ✓ should reject invalid password (8ms)
  ✓ should expire session after timeout (15ms)
  ✓ should refresh token correctly (10ms)
  ✓ should logout user (5ms)

✗ payment.test.ts (3 tests)
  ✓ should process valid payment (20ms)
  ✓ should reject invalid card (12ms)
  ✗ should handle timeout (FAILED)
    Error: Expected timeout after 30s, got success

Results: 7 passed, 1 failed

The payment timeout test failure needs investigation before Phase 6 can complete.
```

---

## Graceful Degradation

### Three Completion Statuses

**COMPLETE**: All validation criteria passed
- All artifacts created
- All tests pass
- Full validation executed

**PARTIAL**: Some validation done, gaps documented
- Core functionality verified
- Some criteria couldn't be tested (documented why)
- Known limitations listed

**INCOMPLETE**: Blocked, needs user action
- Critical blocker encountered
- Cannot proceed without external input
- Clear description of what's needed

### Session Status in session-meta.json

```json
{
  "status": "partial",
  "completedCriteria": ["builds", "type-checks", "login-flow"],
  "skippedCriteria": [
    {"criterion": "full-auth-flow", "reason": "requires running server"},
    {"criterion": "token-storage", "reason": "depends on auth flow"}
  ],
  "blockers": []
}
```

### Final Report for PARTIAL Status

```markdown
## Feature Status: PARTIAL

### Completed ✓
- SDK implementation
- Type safety
- Build verification

### Not Verified ⚠️
- End-to-end authentication (requires running server)
- Token storage persistence (depends on auth)

### Recommended Before Production
1. Run integration tests with real server
2. Verify token encryption roundtrip
```

---

---

### 5. Failure Report Generator

**Script:** `scripts/failure-report-generator.js`

**How it works:**
- Auto-generated when phase completion is blocked
- Documents what was expected vs what happened
- Lists all attempted approaches and their errors
- Provides manual testing steps as fallback
- Includes workarounds and suggestions

**When generated:**
- Phase completion validator blocks a phase
- Validation criteria enforcer finds gaps
- Outer loop reaches max iterations
- Any enforcement script fails

**Report structure:**

```markdown
# {Phase Name} - Failure Report

**Generated:** 2026-02-04T10:30:00Z
**Session:** ai-docs/sessions/dev-feature-login-20260204
**Phase:** phase7

## Expected Artifacts
- ❌ `validation/result.md`
- ❌ `validation/screenshot-before.png`
- ❌ `validation/screenshot-after.png`

## Attempted Approaches

### Attempt 1: browser_test
**What was tried:** Chrome MCP navigation to localhost:3000
**Error:** Tool mcp__chrome-devtools__navigate_page not available
**Timestamp:** 2026-02-04T10:25:00Z

## Failure Analysis

### Common Failure Reasons
- **chrome_mcp_unavailable**: Chrome MCP tools not available or not responding
- **server_not_starting**: Dev server fails to start
- **page_not_loading**: Test URL not accessible

## Suggestions for Resolution
1. Verify Chrome MCP is properly configured in .claude/settings.json
2. Check if dev server is running: curl http://localhost:3000
3. Try using different browser automation: mcp__claude-in-chrome instead
4. Consider unit tests + manual verification as fallback

## Manual Testing Steps
1. Start dev server: npm run dev (or bun run dev)
2. Open browser to test URL (e.g., http://localhost:3000)
3. Take screenshot of initial state
4. Perform test actions (fill forms, click buttons)
5. Take screenshot of result state
6. Verify expected behavior occurred
7. Document results in validation/result.md

## Workarounds

### If Browser Automation Unavailable
1. Run validation manually in browser
2. Take screenshots with system screenshot tool
3. Save screenshots to `validation/` directory
4. Create `validation/result.md` with manual observations

### Minimal result.md Template
[template provided]

## Next Steps
1. **Fix and Retry**: Address the issues above and re-run the phase
2. **Manual Completion**: Follow manual steps and create artifacts manually
3. **Skip with Justification**: Create `phase7-skip-reason.md` explaining why
4. **Escalate to User**: Ask user for guidance via AskUserQuestion
```

**Usage in orchestrator:**

When phase completion is blocked:

```markdown
1. Failure report auto-generated at:
   ${SESSION_PATH}/failures/phase{N}-failure-report.md

2. Read report and either:
   a. Fix issues and retry
   b. Follow manual testing steps
   c. Create skip-reason.md with justification
   d. Escalate to user with AskUserQuestion

3. If manually completing:
   - Create required artifacts following templates in report
   - Re-run phase completion validator
```

---

## Summary Table

| Enforcement | What It Prevents |
|-------------|-----------------|
| Phase completion validator | Claiming "done" without proof |
| Mandatory artifacts | Skipping documentation |
| Validation criteria enforcer | Collecting criteria but ignoring them |
| Outer loop enforcer | Skipping retry logic |
| Phase 6 test check | Shipping without tests |
| Graceful degradation | Faking completion when blocked |
| Show-your-work | Hiding actual results |
| Checkpoint verification | Automated sanity checks |
| **Failure report generator** | **Silent failures without guidance** |

---

## Implementation Priority

1. **HIGH**: Evidence-based completion + Show-your-work (fixes core trust problem)
2. **HIGH**: Validation criteria enforcement (ensures Phase 1 work is used)
3. **MEDIUM**: Phase 6 test enforcement (ensures quality)
4. **MEDIUM**: Graceful degradation (enables honest status)
5. **LOW**: Checkpoint verification (nice automation, but manual review works)

---

**Scripts Location:** `${PLUGIN_ROOT}/plugins/dev/scripts/`
**Hooks Config:** `${PLUGIN_ROOT}/plugins/dev/hooks/feature-enforcement.json`
