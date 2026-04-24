# Phase 1: Requirements + Validation Setup

**Objective:** Gather requirements, validation criteria, iteration limits, and validate tools

**Iteration limit:** 3 rounds of questions

**PRESET MODE:** Before each AskUserQuestion widget below, check whether `./dev-preset.json` exists. If you haven't already loaded it this session, Read it now. If the preset has the relevant key set, use that value and SKIP the widget. This lets automated runners (autotest, CI) bypass interactive gates so `claude -p` can complete Full depth end-to-end.

**SELF-SUFFICIENCY:** Each PRESET CHECK below must be able to proceed whether or not the preset was loaded earlier. If in doubt, Read `./dev-preset.json` at the top of the relevant step — the file is small and the cost is negligible compared to firing a widget that will cause auto-downgrade.

**SUB-WIDGET PRESET KEYS:** When `validation` is `"real-browser-test"` or `"screenshot-comparison"`, additional sub-widgets fire (Test URL, Dev Server, Expected Result, Design File). The preset schema covers them with these optional keys — all skip their widget when present:
- `test_url`: string (e.g. `"http://localhost:3000"`)
- `dev_server`: string (e.g. `"bun run dev"`)
- `expected_result`: string (e.g. `"Redirect to another page"`)
- `design_file`: string path (e.g. `"designs/feature.png"`) — only used when `validation: "screenshot-comparison"`

## Steps

### Step 1.1: Mark phase as in_progress
TaskUpdate(taskId: {phase1_task_id}, status: "in_progress")

### Step 1.2: Read user's initial feature request from $ARGUMENTS

### Step 1a: Functional Requirements

Analyze for gaps and ambiguities:
- Functional requirements (what it must do)
- Non-functional requirements (performance, scale, security)
- Edge cases and error handling
- User experience expectations
- Integration points
- Constraints (technology, time, budget)

Requirements Loop (max 3 rounds):
1. Generate clarifying questions (batched, max 5 per round)
2. Use AskUserQuestion to ask all questions at once
3. Incorporate answers into requirements document
4. If requirements complete: Exit loop
5. If max rounds reached: Proceed with best understanding

### Step 1b: Validation Criteria

**PRESET CHECK:** If preset `validation` is set (e.g. `"unit-tests-only"`), use that value and SKIP this widget. Also skip the conditional Test URL / Dev Server / Expected Result sub-widgets that follow if validation type is "unit-tests-only".

Ask how to verify this feature ACTUALLY works:

```yaml
AskUserQuestion:
  questions:
    - question: "How should I verify this feature ACTUALLY works?"
      header: "Validation"
      multiSelect: true
      options:
        - label: "Real browser test (Recommended)"
          description: "Deploy, navigate, interact, verify behavior"
        - label: "Screenshot comparison"
          description: "Compare rendered UI to design file"
        - label: "API endpoint test"
          description: "Call real endpoints, verify responses"
        - label: "Unit tests only"
          description: "No real validation, just isolated tests"
```

If user selects browser test or screenshot:

**PRESET CHECK:** For each of the three questions below, if the corresponding preset key is set (`test_url`, `dev_server`, `expected_result`), use that value and SKIP that question from the widget. If all three are preset, skip the widget entirely.

```yaml
AskUserQuestion:
  questions:
    - question: "What URL should I test?"
      header: "Test URL"
      options:
        - label: "http://localhost:3000"
          description: "Default dev server"
        - label: "http://localhost:5173"
          description: "Vite dev server"
        - label: "Other"
          description: "Custom URL"
    - question: "What command starts the dev server?"
      header: "Dev Server"
      options:
        - label: "bun run dev"
          description: "Bun development server"
        - label: "npm run dev"
          description: "npm development server"
        - label: "Other"
          description: "Custom command"
    - question: "What's the expected behavior after the main action?"
      header: "Expected Result"
      options:
        - label: "Redirect to another page"
          description: "URL changes after action"
        - label: "Content updates on page"
          description: "New elements appear/change"
        - label: "Other"
          description: "Custom expected behavior"
```

If user selects screenshot comparison:

**PRESET CHECK:** If preset `design_file` is set, use that value and SKIP the widget below.

```yaml
AskUserQuestion:
  questions:
    - question: "Path to reference design image?"
      header: "Design File"
      options:
        - label: "designs/feature.png"
          description: "Default design folder"
        - label: "figma/export.png"
          description: "Figma export folder"
        - label: "Other"
          description: "Custom path"
```

### Step 1c: Iteration Limits

**PRESET CHECK (Retry Limit):** If preset `retry_limit` is set (number or "infinite"), use that value and SKIP the Retry Limit widget below.

Ask user for preferred retry behavior:

```yaml
AskUserQuestion:
  questions:
    - question: "How many times should I retry if real validation fails?"
      header: "Retry Limit"
      multiSelect: false
      options:
        - label: "3 iterations (Recommended)"
          description: "Balanced - good for most features"
        - label: "5 iterations"
          description: "Thorough - for features needing more refinement"
        - label: "10 iterations"
          description: "Very persistent - for complex features"
        - label: "Infinite"
          description: "Keep going until it works! (Ctrl+C to stop)"
```

**PRESET CHECK (Advanced):** If preset `advanced` is set (e.g. `"defaults"`), use that value and SKIP the Advanced widget below.

Optional advanced question:
```yaml
AskUserQuestion:
  questions:
    - question: "Customize inner loop limits?"
      header: "Advanced"
      multiSelect: false
      options:
        - label: "Use defaults (Recommended)"
          description: "Plan: 2, Review: 3, TDD: 5"
        - label: "Custom settings"
          description: "Set your own limits for each loop"
```

If custom selected, ask for each:
- Plan revision limit (default: 2)
- Code review limit (default: 3)
- TDD loop limit (default: 5)

### Step 1d: Tool Validation

Before starting development, verify required tools exist:

If browser test or screenshot selected:
```
Checking required tools for real validation...

[✓] Chrome MCP: mcp__chrome-devtools__navigate_page
[✓] Screenshot: mcp__chrome-devtools__take_screenshot
[✓] Click: mcp__chrome-devtools__click
[✓] Fill: mcp__chrome-devtools__fill
[✓] Snapshot: mcp__chrome-devtools__take_snapshot
```

Smoke test (actually call the tools):
1. Call mcp__chrome-devtools__new_page with URL "about:blank"
2. Call mcp__chrome-devtools__take_screenshot
3. If both succeed: Tools validated

If any tool fails:

**PRESET CHECK:** If preset `tool_issue` is set (e.g. `"skip-real-validation"`), use that value and SKIP this widget.

```yaml
AskUserQuestion:
  questions:
    - question: "Validation tools not available. How to proceed?"
      header: "Tool Issue"
      multiSelect: false
      options:
        - label: "Skip real validation (unit tests only)"
          description: "Proceed without browser testing"
        - label: "Wait while I set up Chrome MCP"
          description: "Pause until tools are ready"
        - label: "Cancel"
          description: "Stop feature development"
```

### Step 1e: Save config files

Write comprehensive requirements to ${SESSION_PATH}/requirements.md

Write validation config to ${SESSION_PATH}/validation-criteria.md:
```markdown
# Validation Criteria

## Validation Type
- [x] Real browser test
- [ ] Screenshot comparison
- [ ] API endpoint test
- [ ] Unit tests only

## Browser Test Configuration
- Test URL: http://localhost:3000/login
- Deploy command: bun run dev
- Expected behavior: Redirect to /dashboard after login
- Reference design: designs/login.png (if applicable)

## Test Actions
1. Navigate to test URL
2. Fill email field with test@example.com
3. Fill password field with password123
4. Click login button
5. Verify redirect to /dashboard
```

Write iteration config to ${SESSION_PATH}/iteration-config.json:
```json
{
  "outerLoop": {
    "maxIterations": 3,
    "currentIteration": 0,
    "notifyEvery": 5
  },
  "innerLoops": {
    "planRevision": 2,
    "codeReview": 3,
    "unitTestTDD": 5
  },
  "validationType": "browser_test",
  "toolsValidated": true,
  "selectedModels": {
    "configured": false,
    "models": [],
    "includeInternal": true
  }
}
```

### Step 1f: Multi-Model Review Configuration (P1b — UPFRONT MODEL SELECTION)

**PRESET CHECK:** If preset `review_models` is set (array of alias strings, e.g. `["internal","grok","gemini"]`), use that list and SKIP the free-form prompt below. Resolve each alias exactly as documented in the parse step.

If claudish is available (check with `which claudish`):

**Read available aliases** from `shared/model-aliases.json` (`shortAliases` keys):
```bash
available=$(jq -r '.shortAliases | keys | join(", ")' shared/model-aliases.json)
```

**Ask the user** for a comma-separated list of models. AskUserQuestion is NOT used here because the options list often exceeds the widget's maxItems:4 cap. Instead ask as free-form:

```
Which models should review plan + code?

Available aliases (from shared/model-aliases.json):
  {available}
  (plus "internal" — always included)

Type a comma-separated list (e.g. "grok, gemini, qwen") or "internal" for no external review.
```

**Parse the response** using `multimodel:claudish-usage` skill's "Model Alias Resolution" procedure:
1. Split on comma, trim whitespace
2. For each name: resolve via ALIAS_TABLE (shortAliases first, then knownModels exact match, then fuzzy match)
3. Unknown names: warn and skip, do NOT guess
4. Always include "internal" (set `includeInternal: true`)

Store selection in ${SESSION_PATH}/iteration-config.json under `selectedModels`:
```json
{
  "selectedModels": {
    "configured": true,
    "models": ["grok-4.20-beta", "gemini-3.1-pro-preview", "qwen3-235b-a22b-2507"],
    "includeInternal": true
  }
}
```

Note: `models` array stores RESOLVED full model IDs (from ALIAS_TABLE), not the short aliases the user typed. This way Phases 3 and 5 pass IDs directly to `claudish team()` without re-resolving.

If claudish is NOT available:
  Set selectedModels.configured = true, selectedModels.models = [],
  selectedModels.includeInternal = true (internal only, no external)

### Step 1.7: User Approval Gate

**PRESET CHECK:** If `automation: "autonomous"` was set in the preset, skip this widget and auto-approve (autonomous mode implies upfront approval of all defaults). Still write the summary to the session log for auditability.

Use AskUserQuestion to present summary of:
- Requirements overview
- Validation method selected
- Iteration limits configured
- Tools validated status
- Models configured for reviews (from Step 1f)

Options:
1. Approve and proceed
2. Modify settings
3. Cancel feature development

### Step 1.8: Mark phase as completed
If approved: TaskUpdate(taskId: {phase1_task_id}, status: "completed")

## Quality Gate
User approves requirements.md, validation-criteria.md, and iteration-config.json
(with selectedModels field populated)
