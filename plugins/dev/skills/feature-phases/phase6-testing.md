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
- each path in `context.agent_loadouts.qa-engineer.read` → `sandbox/loadout/<plugin>/<path>`,
  keeping each source's tree, never flattened, by qa.md Phase 0's rule (these are testing
  guidance, never implementation)

Then build what `/dev:qa` Phase 1 needs, as qa.md Phase 0 does:
- copy `${CLAUDE_PLUGIN_ROOT}/agents/qa-engineer.md` to `sandbox/.claude/agents/qa-engineer.md`;
- snapshot `sandbox/tests/` to `${SESSION_PATH}/qa/tests.before`, and keep the pristine
  copy qa.md Phase 0 names.

No implementation file is copied. Write `${SESSION_PATH}/qa/inputs.json` listing exactly
what went in; the final report prints it.

### Step 6.4: Resolve the writer and write plan + tests
Follow `/dev:qa` Phase 1 (`plugins/dev/commands/qa.md`), which is the one place the
writer-resolution procedure lives. Use the Step 6.3 sandbox and the prompt fields below.

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
Write the three-line record to `${SESSION_PATH}/qa/writer.txt` — `writer:` as `/dev:qa`
reports it, then `analyst: not run` and `fixer: not run` (Step 6.6 fills them) — and say
the `writer:` line in the transcript.

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

Expected failures: copy the `## Expected test failures` section of
`${SESSION_PATH}/implementation-log.md` to `${SESSION_PATH}/tests/expected-failures.md`.
Keep each test's name, its assertion message and the test-file file:line, by qa.md's copy
rule, plus the requirement that changed it. Step 6.6 hands this file to every analyst
call. The analyst, on the writer's model, updates those tests from the spec.

### Step 6.6: TDD loop
TDD Loop (max tdd_limit iterations):

If tests fail (an expected failure from Phase 4 goes to the analyst like any other
failure):

  a. Analyse the failures in a `/dev:qa` Phase 1 Phase session (same model, same sandbox):
     the writer's model from `writer.txt`, in the Step 6.3 sandbox, `STOP_AT: analyse`.
     Build `<sandbox>/qa/test-results.md` fresh for each call: the latest
     `${SESSION_PATH}/tests/test-results.md` filtered by qa.md's copy rule, then the
     contents of `${SESSION_PATH}/tests/expected-failures.md` when it exists.
     That one call classifies the failures and fixes the TEST_ISSUE tests. Read
     `<sandbox>/qa/failure-analysis.md` and copy it to
     `${SESSION_PATH}/tests/failure-analysis.md`. Write the `analyst:` line in `writer.txt`.

  b. For TEST_ISSUE failures:
     - Bring home the tests that call fixed, as in Step 6.5. Write the `fixer:` line in
       `writer.txt`; it names the same model as `analyst:`.

  c. For IMPLEMENTATION_ISSUE failures:
     - Launch `dev:developer` to fix the implementation. Its prompt says: edit no test
       files.

  d. Re-run tests, and save the output to `${SESSION_PATH}/tests/test-results.md`, which
     the next analyst call reads

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
