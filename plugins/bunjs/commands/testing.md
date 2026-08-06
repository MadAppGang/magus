---
name: testing
description: "Write, fix or review Bun tests. Loads the testing skill, then works the task through its workflow."
argument-hint: "[what to test or fix]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/testing/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/testing/references/` your task actually needs. Read those too before writing code.

Use this for writing tests, fixing failing or flaky tests, setting up coverage, or deciding
what to test at which level.

2. **Copy `skills/testing/assets/testing/` into the project** for the component-test harness,
   fake upstream and builders. Prefer component tests over unit-mocking by default.
3. **Check the coverage gate actually gates.** MEASURED: `coverageThreshold = { line = 0.9 }` is
   **silently ignored** — the keys are plural. Lower a threshold, confirm `bun test` exits 1,
   then restore it.
4. **Before reporting done:** `bun test` green, `tsc --noEmit` clean, and every
   `expect(...).rejects` is awaited — without the outer `await` the assertion passes unconditionally.
