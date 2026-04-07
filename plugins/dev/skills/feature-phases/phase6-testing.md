# Phase 6: Black Box Unit Testing

**Objective:** Test architect creates tests from requirements only

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 5)

## Steps

### Step 6.1: Mark phase as in_progress
TaskUpdate(taskId: {phase6_task_id}, status: "in_progress")

### Step 6.2: Read iteration config
```bash
tdd_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.unitTestTDD')
```

### Step 6.3: Launch test-architect for test plan (STRICT isolation)
Prompt: "SESSION_PATH: ${SESSION_PATH}

         **BLACK BOX TESTING: You have NO access to implementation.**

         INPUT ALLOWED:
         - ${SESSION_PATH}/requirements.md
         - ${SESSION_PATH}/architecture.md (API contracts only)
         - Public types/interfaces

         INPUT FORBIDDEN:
         - Implementation source code
         - Internal function details
         - Implementation patterns

         Create comprehensive test plan based on requirements and API contracts.

         Write to ${SESSION_PATH}/tests/test-plan.md
         Return brief summary"

### Step 6.4: Launch test-architect to implement tests
Prompt: "SESSION_PATH: ${SESSION_PATH}

         Read test plan: ${SESSION_PATH}/tests/test-plan.md

         Implement tests for all scenarios in the plan.
         Tests must validate behavior from requirements, not implementation.

         Return brief summary"

### Step 6.5: Run tests
Run tests using Bash:
- Execute test command from ${SESSION_PATH}/context.json quality_checks
- Capture output
- Save to ${SESSION_PATH}/tests/test-results.md

### Step 6.6: TDD loop
TDD Loop (max tdd_limit iterations):

If tests fail:

  a. Launch test-architect to analyze failure:
     Prompt: "Read test results: ${SESSION_PATH}/tests/test-results.md

              Analyze each failure and classify:
              - TEST_ISSUE: Test is wrong (fix test)
              - IMPLEMENTATION_ISSUE: Implementation is wrong (fix code)

              Write analysis to ${SESSION_PATH}/tests/failure-analysis.md"

  b. For TEST_ISSUE failures:
     - Launch test-architect to fix tests

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

### Step 6.8: Mark phase as completed
TaskUpdate(taskId: {phase6_task_id}, status: "completed")

## Quality Gate
All unit tests pass OR user approves with known failures.

**IMPORTANT:** Unit tests passing does NOT mean the feature works!
Real validation happens in Phase 7.
