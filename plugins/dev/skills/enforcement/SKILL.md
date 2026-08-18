---
name: phase-enforcement
description: Evidence-based phase completion for /dev:dev — artifacts, validation criteria, outer loops. Use when orchestrating phased feature work with gates.
user-invocable: false
disable-model-invocation: true
---

# Phase Completion Enforcement

Prevents a phase being marked done with nothing behind it.

There are two mechanisms, and the difference between them matters:

| | Enforced by | Runs |
|---|---|---|
| **Artifact gate** | `hooks/phase-completion-validator.ts` | The runtime, on every `TaskUpdate` |
| **Outer loop** | `scripts/outer-loop.ts` | The orchestrator, between phases |

The first is real enforcement — Claude Code invokes it whether or not anyone
remembers to. The second is bookkeeping the command drives itself.

## 1. Artifact gate (automatic)

Registered as `PreToolUse` on `TaskUpdate` in `hooks/hooks.json`. It receives the
payload on stdin and exits **2** to block, with the reason on stdout.

It checks three things:

1. **The phase's required artifacts exist**, at a minimum size.
2. **They contain what they claim to** — `architecture.md` has to read like
   architecture, not be 500 bytes of placeholder.
3. **Evidence, where presence proves nothing.** Phase 4 requires the working tree
   to have actually changed. Phase 6 requires a test file among those changes —
   not merely that some test exists somewhere in the repo. Phase 5 requires the
   review to state `PASS`, `FAIL` or `CONDITIONAL`, not just to contain a heading
   with the word "verdict" in it.

| Phase | Required artifacts | Evidence check |
|-------|-------------------|----------------|
| 1 | requirements.md, validation-criteria.md, iteration-config.json | — |
| 3 | architecture.md, plan-review consolidated + claude-internal | — |
| 4 | implementation-log.md | working tree changed |
| 5 | reviews/code-review/consolidated.md | verdict is PASS/FAIL/CONDITIONAL |
| 6 | tests/test-plan.md | a test file was added or modified |
| 7 | validation/result.md | records a PASS/FAIL status |
| 8 | report.md | — |

It also blocks *starting* a phase whose predecessor is incomplete: 4 needs 3, 5
and 6 need 4, 7 needs 6.

**It allows whenever it is unsure** — no session directory, several sessions open
at once, an unparseable payload, any internal error. It exists to catch a phase
marked done with nothing behind it, not to police ambiguity.

## 2. Outer loop (orchestrator-driven)

`scripts/outer-loop.ts` tracks iteration count, Phase 7 results, and the resume
checkpoint in `<session>/session-meta.json`.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/outer-loop.ts start-iteration    ${SESSION_PATH}
bun ${CLAUDE_PLUGIN_ROOT}/scripts/outer-loop.ts record-result      ${SESSION_PATH} PASS "all checks passed" 95
bun ${CLAUDE_PLUGIN_ROOT}/scripts/outer-loop.ts check-can-complete ${SESSION_PATH}
bun ${CLAUDE_PLUGIN_ROOT}/scripts/outer-loop.ts get-status         ${SESSION_PATH}
```

Exit codes: `0` proceed · `1` blocked (Phase 8 without a passing Phase 7) ·
`2` escalate (iteration budget exhausted).

It reports a regression when a score falls between iterations, and in infinite
mode notifies every `notifyEvery` iterations. `iteration-config.json` from Phase 1
sets `maxIterations` (a number, or `"infinite"`) and `notifyEvery`.

## Integration with /dev:dev

Before Phase 3, call `start-iteration` and check for exit 2. After Phase 7, call
`record-result`. Before Phase 8, call `check-can-complete` and require exit 0.
Marking phases complete needs no manual verification step — the hook does it.


### Show-Your-Work Requirement

**Anti-pattern (BLOCKED):**

```markdown
I'll run the tests now.
[Agent tool call to run tests]
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

## Removed in v3.0.0

`checkpoint-verifier.sh` checked the same artifacts the hook now checks, but only
when the orchestrator remembered to run it. `validation-criteria-enforcer.js` and
`failure-report-generator.js` had no callers at all. An enforcement mechanism the
enforced party has to opt into is a suggestion with an exit code attached; the
hook is the real thing.
