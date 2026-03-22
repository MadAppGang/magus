---
name: tdd-workflow
description: Red-Green-Refactor state machine for TDD with terminal test watchers. Use when running tests in watch mode, iterating on failing tests, or managing the edit-save-watch cycle. Trigger on "TDD", "watch mode", "failing test", "fix the test", "red green", "test loop", "bun test --watch", "jest --watch", "vitest", "cargo watch", "pytest-watch".
version: 1.0.0
tags: [terminal, tdd, testing, watch-mode, red-green-refactor, state-machine]
keywords: [TDD, test driven, red green refactor, watch mode, failing test, bun test, jest watch, vitest watch, cargo watch, pytest watch, fix test, test loop, watcher, test watcher]
plugin: terminal
---

# TDD Workflow — Red-Green-Refactor Protocol

This skill teaches the protocol Claude follows AFTER a test watcher is running. For watcher setup (starting the watcher pane and managing long-running processes), see `terminal:terminal-interaction`. For framework-specific pass/fail/running/idle signals, see `terminal:framework-signals`.

The TDD loop requires a dedicated pane topology: Claude edits code in one pane while a persistent test watcher runs in a second pane. Claude reads the watcher with `capture-pane` but never restarts it.

## Overview

### Pane Topology

```
┌──────────────────────┬────────────────────┐
│  Claude work pane    │  Test Watcher      │
│  (Bash / code edit)  │  (helper pane)     │
└──────────────────────┴────────────────────┘
```

The left (work) pane is where Claude runs file edits and any auxiliary commands. The right (watcher) pane runs the test framework in watch mode for the entire session. Claude only reads the watcher pane — it never sends keystrokes to it except at teardown.

## State Machine

The TDD protocol is a 5-state machine. Always know which state you are in before taking an action.

```
RED    → parse failure (file:line:test name from snapshot)
         → edit code → save → enter WAITING

WAITING → look for "change detected" marker (framework-specific)
         → if no change after 2 polls: re-save with touch
         → poll until RED or GREEN

GREEN  → report pass count → leave watcher running → ask user to continue

COMPILE_ERROR → fix compile error first → re-enter WAITING

IDLE   → Ctrl+C watcher pane → report summary: N tests fixed
```

### State Transitions

| From | Condition | To |
|------|-----------|----|
| RED | File saved, watcher picks up change | WAITING |
| WAITING | Framework shows pass signal | GREEN |
| WAITING | Framework shows fail signal | RED |
| WAITING | Compiler error signal appears | COMPILE_ERROR |
| COMPILE_ERROR | Compile error resolved, file saved | WAITING |
| GREEN | User asks to continue / next failing test | RED |
| GREEN | User asks to stop | IDLE |
| Any | User explicitly stops | IDLE |

### Priority Rule

COMPILE_ERROR takes priority over RED. If a snapshot shows both `error[E` and a test failure, fix the compile error first — the test failure may disappear once the code compiles.

## Critical Timing Rules

**After saving a file, treat snapshots still showing the old result as stale. Only read results AFTER the "change detected" signal appears.**

- Do not read the watcher snapshot immediately after a save. The watcher has not yet noticed the change.
- Poll for the framework's "running" or "change detected" signal first (e.g., `[Running`, `RUNS `, `Ding!`).
- Only after that signal appears is it safe to poll for the final RED or GREEN outcome.
- If the "change detected" signal does not appear after 2 polls (~4 seconds), re-trigger with `touch` on the saved file. The file system event may have been missed.

Violating this rule produces false RED readings — Claude thinks the test is still failing when the watcher simply has not rerun yet.

## Failure Extraction Regexes

Use these regexes against `capture-pane` snapshot content to extract the file, line, and test name from a RED state. Extract before editing so you know exactly where to make the change.

```
Jest/Vitest:  /at Object\.<anonymous> \((.+):(\d+):(\d+)\)/
              /FAIL (src\/[^\s]+\.test\.[tj]s)/
Cargo:        /panicked at '[^']+', (.+):(\d+):\d+/
Pytest:       /FAILED (tests\/[^\s]+)::([^\s]+)/
              /File "([^"]+)", line (\d+)/
```

Match group 1 is the file path, match group 2 is the line number. For Jest/Vitest's `FAIL` line, match group 1 is the test file path. For Pytest's `FAILED` line, match group 1 is the module path and group 2 is the test name.

## Watcher Management

**Never restart the watcher between iterations. One watcher per project.**

- The watcher pane is created once at the start of the TDD session and left running until the user is done.
- `mcp__tmux__capture-pane` reads the watcher non-destructively. The watcher keeps running.
- Do not send Ctrl+C to the watcher pane mid-session. This destroys watch mode and requires re-setup.
- If two Claude agents are working on the same project, they share the single existing watcher — neither creates a second one. Check for an existing watcher pane before creating a new one.
- At teardown (IDLE state), send Ctrl+C to the watcher pane, then kill the pane with `mcp__tmux__kill-pane`.

## Worked Example — Jest/Vitest End-to-End

This example shows the full loop from watcher start through a single RED-to-GREEN cycle.

### Step 1: Start the Watcher (enter WAITING/IDLE)

```
mcp__tmux__split-pane({ paneId: CURRENT_PANE, direction: "horizontal", size: "45%" })
→ returns: { paneId: "watcher_pane" }

mcp__tmux__send-keys({ paneId: "watcher_pane", keys: "bun test --watch\n" })
```

Wait for the idle signal before proceeding:

```
mcp__tmux__capture-pane({ paneId: "watcher_pane" })
→ look for: "press a to rerun" or "Waiting for file changes"
```

### Step 2: Read Failure (enter RED)

Once the user reports a failing test or the watcher shows a fail signal, capture the snapshot:

```
mcp__tmux__capture-pane({ paneId: "watcher_pane" })
→ snapshot contains:
    FAIL src/utils/format.test.ts
    ● formatDate › returns ISO string
      Expected: "2026-01-15"
      Received: "01/15/2026"
      at Object.<anonymous> (src/utils/format.test.ts:12:5)
```

Apply the Jest/Vitest regex: file = `src/utils/format.test.ts`, line = `12`.

### Step 3: Extract and Edit

Read the failing file at the extracted location:

```
Read({ file_path: "/absolute/path/src/utils/format.ts" })
```

Locate the `formatDate` function and correct the date format. Use `Edit` to apply the fix. Save (the file write is the save).

### Step 4: Enter WAITING — Poll for Change Detection

Do not read the watcher yet. Poll for the "change detected" marker:

```
mcp__tmux__capture-pane({ paneId: "watcher_pane" })
→ look for: "RUNS " or "Running"
```

If not seen after 2 polls, re-trigger:

```
Bash({ command: "touch /absolute/path/src/utils/format.ts" })
```

Poll again until the running signal appears.

### Step 5: Poll for Final Result (RED or GREEN)

```
mcp__tmux__capture-pane({ paneId: "watcher_pane" })
→ snapshot now contains: "Tests: 14 passed, 14 total"
→ and: "Waiting for file changes"
```

Pass signal matched (`Tests: \d+ passed`). Idle signal confirmed (`Waiting for file changes`). Enter GREEN.

### Step 6: Report and Continue

Report to the user:

```
"All 14 tests passing. formatDate now returns ISO strings. Watcher is still running.
Would you like to continue with another failing test, or stop here?"
```

Leave the watcher pane running. If the user is done, send `Ctrl+C` to the watcher pane and kill it:

```
mcp__tmux__send-keys({ paneId: "watcher_pane", keys: "C-c" })
mcp__tmux__kill-pane({ paneId: "watcher_pane" })
```

Report summary: "Session complete. 1 test fixed across 1 file."
