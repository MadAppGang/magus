# Phase 6: Black Box Unit Testing

**Objective:** Test architect creates tests from requirements only

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 5)

## Steps

### Step 6.1: Announce the phase
Say, in one line: **Phase 6 — starting.**

### Step 6.2: Read iteration config
```bash
tdd_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.unitTestTDD')
```

### Step 6.3: Build the writer sandbox (blindness by file system, not by prompt)
The writer sees one directory and nothing else. Create `${SESSION_PATH}/qa/sandbox/` and
copy into it:
- `${SESSION_PATH}/requirements.md` → `sandbox/spec.md`
- the API-contracts section of `${SESSION_PATH}/architecture.md` → `sandbox/contract/architecture-contracts.md`
- every public type / interface / story file that architecture.md names as the contract → `sandbox/contract/`
- the repo's existing test directory and test config (`bunfig.toml`, `vitest.config.*`,
  `playwright.config.*`, `go.mod`, `package.json`) → `sandbox/tests/` and `sandbox/`
- each path in `context.agent_loadouts.qa-engineer.read` → `sandbox/loadout/` (these are
  testing guidance, never implementation)

No implementation file is copied. Write `${SESSION_PATH}/qa/inputs.json` listing exactly
what went in; the final report prints it.

### Step 6.4: Resolve the writer and write plan + tests
Follow `/dev:qa` Phase 1 (`plugins/dev/commands/qa.md`), which is the one place the
writer-resolution procedure lives:
1. `list_models()`; unavailable → internal writer.
2. `search_models({ query: "gpt" })` → the top-tier model of that family from the live
   result; no such model → internal writer, and say so.
3. External: `create_session(model=<id>, agent="dev:qa-engineer",
   work_dir="${SESSION_PATH}/qa/sandbox", timeout_seconds=900, prompt=<below>)`, wait for
   `completed`, `get_output(session_id)`; `failed`/`timeout` → `get_diagnostics`, record,
   fall back to internal.
4. Internal: `Agent(subagent_type: "dev:qa-engineer", run_in_background: false, prompt=<below>)`.

Prompt (sandbox-relative paths only):
```
SPEC_PATH: <sandbox>/spec.md
CONTRACT_PATHS: <sandbox>/contract/*
TEST_DIR: <sandbox>/tests
STACK: {from context.repo.stacks: golang→go, bunjs→bun, react/vue→ui}
STOP_AT: implement
SESSION_PATH: <sandbox>
LOADOUT: <sandbox>/loadout/*   (mandatory first: {context.agent_loadouts.qa-engineer.mandatory})
Write the test plan and the tests. Do not read anything outside the paths above.
```
Write `writer: <model id> (external)` or `writer: internal (<reason>)` to
`${SESSION_PATH}/qa/writer.txt` and say the same line in the transcript.

### Step 6.5: Bring the tests home, run them, prove they can fail
Copy `sandbox/tests/**` into the repo's test directory and
`sandbox/qa/test-plan.md` (or `sandbox/tests/TEST-PLAN.md`) to
`${SESSION_PATH}/tests/test-plan.md`. Check the writer's `Files Read` section: any path
outside the sandbox is a blindness breach — record it in the report and mark the tests
"suspect".

Negative control (mandatory): mutate one expected value in one test, run that file,
paste the failure into `${SESSION_PATH}/tests/negative-control.md`, restore the test.
No pasted failure → the phase report says `not proven`.

Run tests using Bash:
- Execute `commands.test_runner_command` from ${SESSION_PATH}/context.json, then the
  `commands.quality_checks` entries for the surfaces this feature touched
- Capture output
- Save to ${SESSION_PATH}/tests/test-results.md

### Step 6.6: TDD loop
TDD Loop (max tdd_limit iterations):

If tests fail:

  a. Launch qa-engineer to analyze failure:
     Prompt: "Read test results: ${SESSION_PATH}/tests/test-results.md

              Analyze each failure and classify:
              - TEST_ISSUE: Test is wrong (fix test)
              - IMPLEMENTATION_ISSUE: Implementation is wrong (fix code)

              Write analysis to ${SESSION_PATH}/tests/failure-analysis.md"

  b. For TEST_ISSUE failures:
     - Launch qa-engineer to fix tests

  c. For IMPLEMENTATION_ISSUE failures:
     - Launch developer to fix implementation

  d. Re-run tests

  e. Iteration counter++

  f. If max iterations reached:
     Escalate to user (AskUserQuestion):
     "Testing has reached maximum iterations ({limit}).

      Failing Tests:
      {list of failures}

      Analysis: {summary from failure-analysis.md}

      Options:
      1. Continue anyway (document known failures)
      2. Allow {limit} more iterations
      3. Cancel feature development
      4. Take manual control"

### Step 6.7: Track iteration history
Track iteration history in ${SESSION_PATH}/tests/iteration-history.md:
- Iteration number
- Test results
- Failure analysis
- Fixes applied

### Step 6.8: Announce the phase complete
Say, in one line: **Phase 6 — complete**, naming the artifacts you wrote.
Do this only once those files exist; the Stop hook verifies them and will block
the turn if they do not.

## Quality Gate
All unit tests pass OR user approves with known failures.

**IMPORTANT:** Unit tests passing does NOT mean the feature works!
Real validation happens in Phase 7.
