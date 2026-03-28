---
name: debug-standard
description: Enhanced standard debug workflow — 6-phase orchestration with 3-strategy localization, self-critique, and agent delegation. Loaded by /dev:debug for the standard scope.
keywords: [debugging, root-cause, localization, fault-isolation, self-critique, regression, agent-delegation, standard-debug]
plugin: dev
type: discipline
user-invocable: false
---

# Standard Debug Workflow

The "middle path" — thorough systematic debugging with 3-strategy fault localization,
root cause confirmation with self-critique, minimal-change implementation, and full
validation. More rigorous than quick-patch; no multimodel review gates or deployment
monitoring (those belong to production-grade).

**Agent delegation rules for this workflow:**
- Stack detection → `dev:stack-detector`
- Error analysis and root cause → `dev:debugger`
- Fix implementation → `dev:developer`
- The orchestrator does NOT write or edit code directly

---

## Phase 0: Initialize

**Objective:** Establish session directory and detect stack.

```bash
SESSION_PREFIX="dev-debug"
SESSION_BASE="${SESSION_PREFIX}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
mkdir -p "${SESSION_PATH}"
echo "Session: ${SESSION_BASE}"
echo "Path: ${SESSION_PATH}"
```

Invoke the `dev:debug-shared-init` skill for:
1. Stack detection via `dev:stack-detector` agent — saves `${SESSION_PATH}/context.json`
2. Reproduction attempt (if bug description includes reproduction steps)
3. Bug report written to `${SESSION_PATH}/bug-report.md`

Read `${SESSION_PATH}/context.json` after the shared init completes. Extract:
- `stack` — used for quality checks in Phase 3 and 4
- `test_runner_command` and `full_suite_args` — used in Phase 4
- `lint_command` and `typecheck_command` — used in Phase 4

---

## Phase 1: Error Analysis

**Objective:** Parse the error, classify it, and identify candidate root causes ranked by likelihood.

Launch `dev:debugger` agent with the following prompt template:

```
SESSION_PATH: ${SESSION_PATH}

## Task: Error Analysis

Read the bug report at ${SESSION_PATH}/bug-report.md.

Perform error analysis:
1. Classify the error type (null/undefined, type error, logic error, async, network,
   environment, data corruption, performance, or other).
2. Parse the stack trace (if present) and identify the throw site and call chain.
3. List potential root causes ranked by likelihood (most likely first). For each:
   - State the hypothesis
   - Identify the supporting evidence from the error message or stack trace
   - List which code files are most likely involved
4. Identify 2–5 candidate files that are most likely to contain the bug.

Save your analysis to ${SESSION_PATH}/error-analysis.md using this structure:

## Error Type
{classification}

## Stack Trace Summary
{throw site and relevant call chain, or "Not provided"}

## Root Cause Hypotheses (ranked by likelihood)
1. {hypothesis} — Evidence: {evidence} — Files: {file list}
2. {hypothesis} — Evidence: {evidence} — Files: {file list}
...

## Candidate Files
- {file path} — {reason}
- {file path} — {reason}
```

After the agent completes, read `${SESSION_PATH}/error-analysis.md` before proceeding.

---

## Phase 2: Root Cause Investigation

**Objective:** Localize the fault using 3 strategies, then confirm the root cause with
self-critique.

### Step 2a — Fault Localization

Invoke the `dev:debug-localization` skill. This skill applies three complementary
strategies and produces `${SESSION_PATH}/localization.md`.

**Strategy A — Stack trace grep:**
Extract `file:line` references from the stack trace. Read those lines plus ±20 lines
of surrounding context. Produces high-confidence candidates when a stack trace is present.

**Strategy B — Keyword/symbol search:**
Extract error-related symbols (function names, identifiers, error strings) from the
error message and `error-analysis.md` hypotheses. Grep codebase for each symbol.
Produces candidates even when no stack trace is available.

**Strategy C — Git bisect / recent-change scan:**
Run `git log --oneline -20` and check whether any recent commits touch the candidate
files identified in Phase 1. If git history points to a specific change, include it
as a high-confidence candidate.

`${SESSION_PATH}/localization.md` output schema:

```markdown
# Localization Report

## Strategy A — Stack Trace Grep
{results or "No stack trace available"}

## Strategy B — Keyword Search
{symbol list searched, files matched}

## Strategy C — Recent Change Scan
{commits inspected, relevant changes found or "No recent changes to candidate files"}

## Combined Candidate List
| File | Lines | Confidence | Strategy | Reason |
|------|-------|------------|----------|--------|
| {path} | {range} | HIGH/MED/LOW | A/B/C | {reason} |

## Recommended Investigation Order
1. {file} — {why first}
2. {file} — {why second}
```

### Step 2b — Root Cause Confirmation

Launch `dev:debugger` agent with the following prompt template:

```
SESSION_PATH: ${SESSION_PATH}

## Task: Root Cause Confirmation

Read:
- ${SESSION_PATH}/bug-report.md
- ${SESSION_PATH}/error-analysis.md
- ${SESSION_PATH}/localization.md

Investigate the candidate files in the recommended order. Read the relevant code
sections (do not modify any files — read only).

Confirm the root cause by:
1. Stating the definitive root cause (one clear sentence)
2. Showing the exact code that is wrong (file, line range, snippet)
3. Explaining the causal chain from the wrong code to the observed error
4. Stating the minimal fix approach (what to change, not how to implement it)

Then perform a self-critique against these six criteria:

## Self-Critique
MINIMAL_CHANGE: {PASS|FAIL} — {reason the proposed fix is/isn't minimal}
ROOT_CAUSE_NOT_SYMPTOM: {PASS|FAIL} — {reason this addresses cause, not symptom}
REGRESSION_SAFETY: {PASS|FAIL} — {reason the fix is/isn't likely to cause regressions}
TEST_COVERAGE: {PASS|FAIL} — {reason a regression test is/isn't needed and feasible}
REGRESSION_RISK: {HIGH|MEDIUM|LOW} — {reason for the risk level}
COMPETING_HYPOTHESES: {YES|NO} — {if YES: list each competing hypothesis and why it was ruled out}

Save your complete analysis to ${SESSION_PATH}/root-cause.md.
```

After the agent completes, read `${SESSION_PATH}/root-cause.md`.

### Step 2c — User Confirmation Gate

Present the root cause summary to the user. Then invoke `AskUserQuestion`:

```yaml
AskUserQuestion:
  questions:
    - question: "Root cause identified: {one-sentence summary from root-cause.md}. How would you like to proceed?"
      header: "Root Cause Confirmed"
      multiSelect: false
      options:
        - label: "Proceed with fix"
          description: "Implement the fix and run full validation"
        - label: "Investigate further"
          description: "Dig deeper before implementing — describe what to investigate"
        - label: "I'll fix it manually"
          description: "Stop here — I have enough information"
```

If REGRESSION_RISK is HIGH in the self-critique, add a notice before the question:
"Note: The debugger assessed regression risk as HIGH. Consider whether a production-grade
fix with multimodel review would be more appropriate."

If the user selects "Investigate further", delegate another `dev:debugger` agent pass
with the user's additional context appended, then re-present the gate. Maximum one
additional investigation pass before escalating to user decision.

If the user selects "I'll fix it manually", present the root-cause.md summary and stop.

---

## Phase 3: Fix Implementation

**Objective:** Implement a minimal fix that addresses the root cause, with a regression test.

Launch `dev:developer` agent with the following prompt template:

```
SESSION_PATH: ${SESSION_PATH}

## Task: Fix Implementation

Read:
- ${SESSION_PATH}/root-cause.md
- ${SESSION_PATH}/context.json (for stack and quality check commands)

Implement the fix following these requirements:
1. MINIMAL CHANGE — modify only what is necessary to fix the root cause
2. ROOT CAUSE NOT SYMPTOM — fix the underlying issue, not the surface error
3. REGRESSION TEST — add a test that would have caught this bug if it existed before;
   the test must fail against the unfixed code and pass after the fix
4. FOLLOW PROJECT CONVENTIONS — match the existing code style and patterns in the file

After implementing:
- Run quality checks for stack: {stack from context.json}
  - react-typescript / bunjs: bun run format && bun run lint && bun run typecheck
  - golang: go fmt ./... && go vet ./...
  - rust: cargo fmt --check && cargo clippy -- -D warnings
  - python: black --check . && ruff check .
- Fix any quality check failures before finishing
- Save a summary of changes to ${SESSION_PATH}/fix-summary.md:

## Fix Summary
### Files Modified
- {file}: {what changed and why}

### Regression Test Added
{test file and test name, or "Not applicable — reason"}

### Quality Checks
{results of each check run}
```

---

## Phase 4: Validation

**Objective:** Confirm the fix resolves the original bug and introduces no regressions.

Read `${SESSION_PATH}/context.json` to get `test_runner_command` and `full_suite_args`.

**Step 4a — Reproduce the original bug (should now pass):**

If a failing test was identified in the bug report:
```bash
CI=true {test_runner_command} {specific_test_path}
```
Expected: PASS. If still failing, proceed to retry logic below.

**Step 4b — Full test suite:**

```bash
CI=true {test_runner_command} {full_suite_args}
```

**Step 4c — Quality checks:**

```bash
{lint_command}
{typecheck_command}
```

**Step 4d — Write validation report:**

Write `${SESSION_PATH}/validation-report.md`:

```markdown
# Validation Report

## Original Bug: {PASS|FAIL}
{test that reproduces the bug — result}

## Full Test Suite: {PASS|FAIL|PARTIAL}
{pass/fail counts, any new failures}

## Lint: {PASS|FAIL}
{output or "Clean"}

## Type Check: {PASS|FAIL}
{output or "Clean"}

## Verdict: {FIXED|REGRESSIONS_FOUND|BUG_PERSISTS}
```

**If bug persists or regressions found:**
- Return to Phase 2 with the new failure information appended to BUG_DESCRIPTION
- Maximum 2 retry iterations before escalating to the user with a summary of what was attempted

---

## Phase 5: Documentation

**Objective:** Produce a debug report, present results, and commit the fix.

**Step 5a — Write debug report:**

Write `${SESSION_PATH}/debug-report.md`:

```markdown
# Debug Report

## Issue Summary
{one-paragraph description of the bug and its impact}

## Root Cause
{exact root cause from root-cause.md — file, line, explanation}

## Fix Applied
{what was changed and why it addresses the root cause}

## Files Modified
{list from fix-summary.md}

## Regression Test
{test name and file, or "Not added — reason"}

## Prevention Recommendations
{1–3 actionable steps to prevent this class of bug in the future}
- {recommendation}
- {recommendation}
```

**Step 5b — Present summary:**

Show the user:
- The one-sentence root cause
- Files modified (from fix-summary.md)
- Test suite result
- Link to full debug report: `${SESSION_PATH}/debug-report.md`

Then run `git status` to show the working tree state.

**Step 5c — Git commit:**

Propose a commit message following the repository's convention. Create the commit:

```bash
git add {specific modified files — never use -A or .}
git commit -m "$(cat <<'EOF'
fix({scope}): {one-line description of what was fixed}

Root cause: {one-sentence root cause}
Regression test: {added|not applicable}

Session: ${SESSION_BASE}
EOF
)"
```

---

## Stack-Specific Debugging Tips

### React / TypeScript

- **Component not re-rendering:** Check whether state mutation is occurring instead of
  returning a new object/array. React uses referential equality for bailout decisions.
- **Hook ordering violations:** `Invalid hook call` means a hook is called conditionally
  or inside a nested function. Search for hooks inside `if` blocks or callbacks.
- **Stale closures:** If an event handler reads outdated state, use a ref or the
  functional updater form of `setState`. Check `useEffect` dependency arrays.
- **Type errors at runtime:** TypeScript types are erased. `as unknown as T` casts and
  missing runtime validation on API responses are common mismatch sources.
- **Test isolation:** `beforeEach` cleanup, `jest.resetAllMocks()`, and unmounting
  components between tests prevent state leakage between test cases.

### Go

- **Nil pointer dereference:** Print the full stack trace — `runtime/debug.PrintStack()`
  in a `recover()` gives the goroutine trace. Check whether an interface value is nil
  vs. a non-nil interface holding a nil pointer (these behave differently).
- **Race conditions:** Run `go test -race ./...` to surface data races. Common cause:
  goroutines sharing a map or slice without a mutex.
- **Error swallowing:** Grep for `if err != nil { _ = err }` or bare `err` assignments
  that are never checked.
- **Context cancellation:** A cancelled context silently stops HTTP requests and DB
  queries. Check whether the error is `context.Canceled` or `context.DeadlineExceeded`
  before assuming a network problem.
- **JSON field visibility:** Lowercase struct fields are not marshalled. Check that
  fields in API response structs are exported and have `json:` tags.

### Rust

- **Borrow checker errors:** When lifetime or borrow errors are unclear, try extracting
  the problematic expression to a local variable — the error message will be more
  specific. Use `cargo expand` to see macro-generated code.
- **Panics in production:** `unwrap()` and `expect()` are common panic sources. Grep for
  them in hot paths. Replace with `?` propagation or explicit `match`.
- **Async executor blocking:** `block_on` inside an async context deadlocks Tokio's
  single-threaded runtime. Use `tokio::task::spawn_blocking` for blocking work.
- **Feature flag mismatches:** Cargo features are additive. A dependency compiled
  without a feature does not gain it at link time. Check `Cargo.toml` and
  `Cargo.lock` for version pinning issues.

### Python

- **Import side effects:** Module-level code runs on import. If tests behave differently
  depending on import order, look for module-level I/O or global mutations.
- **Mutable default arguments:** `def f(x=[])` shares the list across calls. Use
  `def f(x=None): x = x or []` instead.
- **Async event loop conflicts:** `asyncio.run()` creates a new loop; calling it inside
  an already-running loop raises `RuntimeError`. In notebooks or FastAPI, use
  `await` directly or `asyncio.get_event_loop().run_until_complete()`.
- **Type annotation drift:** `mypy` strict mode catches unannotated callsites. Run
  `mypy --strict` against the module containing the bug before investigating further.
- **Pytest fixture scope:** A `session`-scoped fixture shared between tests can carry
  state across test functions. If a test passes in isolation but fails in a full run,
  check fixture teardown.

---

## Completion Message Template

Present this at the end of Phase 5:

```
## Debug Complete

**Root Cause:** {one sentence}

**Fix:** {what changed — files and nature of change}

**Validation:**
- Original bug: FIXED
- Test suite: {N} passed, {M} failed
- Lint: PASS
- Type check: PASS

**Regression test:** {added to {file} | not applicable}

**Full report:** {SESSION_PATH}/debug-report.md

Implementation ready for review.
```
