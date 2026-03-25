---
name: debug-shared-init
description: Shared initialization for debugging workflows — session setup, stack detection, reproduction, and bug report generation. Used by /dev:debug and /dev:fix.
---

# Debug Shared Initialization

Reference patterns for the initialization phase common to all debugging workflows in the
dev plugin. Calling commands set `${SESSION_PREFIX}` before this material applies.
`${SESSION_PATH}` is derived from the session directory creation step below.

---

## 1. Session Directory Creation

Create a uniquely-named session directory under `ai-docs/sessions/`. The prefix is
set by the calling command (e.g., `"dev-debug-quickfix"`, `"dev-debug"`,
`"dev-debug-prodfix"`).

```bash
SESSION_BASE="${SESSION_PREFIX}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
mkdir -p "${SESSION_PATH}"
echo "Session: ${SESSION_BASE}"
echo "Path: ${SESSION_PATH}"
```

The entropy suffix (`xxd -p` of 4 random bytes) prevents collisions between sessions
started within the same second. Always use this exact form — do not shorten or omit
the random component.

---

## 2. Stack Detection

Delegate to the `dev:stack-detector` agent to detect the project's technology stack,
test runner, and file patterns. Pass the session path and the bug description for
context. The agent saves its output to `${SESSION_PATH}/context.json`.

Agent prompt template:

```
SESSION_PATH: ${SESSION_PATH}

Detect technology stack, test runner, and test file patterns for this project.
Bug description for context: {BUG_DESCRIPTION}

Save results to: ${SESSION_PATH}/context.json
Include fields: stack, test_runner_command, full_suite_args, test_file_patterns,
lint_command, typecheck_command
```

After the agent completes, read `${SESSION_PATH}/context.json` to extract
`test_runner_command`, `full_suite_args`, and `stack` for use in subsequent phases.

### context.json field reference

| Field | Example | Usage |
|---|---|---|
| `stack` | `"react-typescript"` | Selects quality-check commands |
| `test_runner_command` | `"bun test"` | Prefixed with `CI=true` for reproduction |
| `full_suite_args` | `"--coverage"` | Appended for full-suite validation runs |
| `test_file_patterns` | `["**/*.test.ts"]` | Used to scope grep searches to test files |
| `lint_command` | `"bun run lint"` | Run during VALIDATE phase |
| `typecheck_command` | `"bun run typecheck"` | Run during VALIDATE phase |

---

## 3. Reproduction Attempt

If the bug description contains reproduction steps (a test path, command, or explicit
`reproduce:` block), attempt reproduction immediately after reading `context.json`:

```bash
CI=true {test_runner_command} {test_args_from_bug_description}
```

Interpretation rules:
- Exit code 0 with test failure output — bug confirmed reproducible
- Exit code non-zero (process error) — runner misconfigured; check `context.json`
- No matching test output — bug not yet covered by tests; proceed to localization

Do not block on failed reproduction. If no reproduction steps are present in the bug
description, skip this step and proceed directly to localization.

---

## 4. Bug Report Schema

Write `${SESSION_PATH}/bug-report.md` after reproduction attempt. This file serves
as the monitoring baseline (error signature) and handoff document for the debugger agent.

```markdown
# Bug Report

## Error Signature
{exact error message string — used for monitoring baseline; quote verbatim if available}

## Stack Trace
{paste verbatim if provided by user, else "Not provided"}

## Reproduction Path
{shell command or test path that triggers the bug, or "Confirmed via test: {path}",
or "Not reproducible via automated test — see description"}

## Affected File Candidates
{file paths from grep/stack trace scan, or "None found — proceeding to localization"}

## Existing Failing Test
{absolute path to test file if a matching failing test was found, else "None found"}

## Test Runner
{value of test_runner_command from context.json}

## Stack
{value of stack from context.json}
```

All sections are required. Use the exact literal strings shown above for absent data
(e.g., `"Not provided"`, `"None found"`). Downstream agents check for these sentinel
values to branch their logic.

---

## 5. Flag Parsing

Strip recognized flag tokens from `$ARGUMENTS` before passing the description to any
agent. The clean string is `BUG_DESCRIPTION`.

### Parsing rule

Flags are tokens that begin with `--`. Scan left-to-right and collect all `--token`
values. Everything that is not a flag token (or a bare `--` terminator) is literal
bug description text. After a bare `--`, all remaining tokens are literal text
regardless of leading dashes.

### Quick-patch flags

| Flag | Variable | Default |
|---|---|---|
| `--review` | `ENABLE_REVIEW=true` | `false` |
| `--tdd` | `ENABLE_TDD=true` | `false` |
| `--interactive` | `INTERACTIVE=true` | `false` |

### Production-grade flags

| Flag | Variable | Default |
|---|---|---|
| `--interactive` | `INTERACTIVE=true` | `false` |
| `--no-review` | `SKIP_REVIEW=true` | `false` |
| `--unanimous` | `CONSENSUS_MODE=unanimous` | `2/3 STRONG` |
| `--no-monitor` | `SKIP_MONITOR=true` | `false` |

### Save parsed state

After parsing, write `${SESSION_PATH}/config.json` with all resolved values and the
calling scope name:

Quick-patch example:
```json
{"review": false, "tdd": false, "interactive": false, "scope": "quick-patch"}
```

Production-grade example:
```json
{"interactive": false, "skip_review": false, "unanimous": false, "skip_monitor": false, "scope": "production-grade"}
```

`BUG_DESCRIPTION` is not saved to `config.json` — it lives only in the orchestrator's
working context and is injected inline into agent prompts.
