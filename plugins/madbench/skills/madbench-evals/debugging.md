# Debugging madbench benches

## Before you debug anything

**`list` proves a file parses; `preflight` proves it could run.** `madbench list` on a
bench with a retired `sandbox: process` level prints the bench and exits 0 — a
confident all-clear on a file that cannot start. Never use `list` as the pre-run gate.

**Run `madbench preflight <bench>` before every real run.** It resolves every harness
binary, API key, runtime, daemon, sandbox level and `testdata:` path the run needs —
so a stale testdata directory or a retired sandbox level costs you a second instead of
a billed run.

**`madbench demo` exists.** It runs a built-in four-scenario bench against an offline
harness that emulates a real agent over wall-clock time: no network, no API keys, no
spend. Use it to see what a healthy report looks like, and to sanity-check your
tooling (jq recipes, report parsing) before pointing any of it at a real run.

**Check which binary you are running before trusting any source you read:**

```bash
go version -m "$(command -v madbench)" | grep vcs.revision
```

A conclusion drawn from source you did not build is a conclusion about a different
program.

## Error message → cause map

| Message | Cause / fix |
|---|---|
| `loading <path>: parsing <path>: yaml: line N: …` | YAML syntax/type error — fix at the line:col shown |
| `no madbench.yaml or madbench.yml in <dir>` | bare `madbench` with no discoverable file — pass a path |
| `unknown string assertion: <name>` / `unknown assertion type: %q` (at RUN time) | check `type:` typo — `madbench list` does NOT catch this; see checks-catalog.md. CAUTION: an AI check without `ANTHROPIC_API_KEY` produces the SAME unknown-type error (see below) |
| `assert-set: child "<type>": <err>` | error inside a composite child — fix the child |
| `exec: 'cmd' (string slice) or 'value' (string) is required` | exec check missing its command |
| exec errors about missing WorkDir | scenario has no `testdata:`/workspace and check has no `cwd:` |
| `unknown assertion type: "llm-rubric"` (or any AI check name) | **Missing judge provider, not a typo.** With no `judges:` block and no `ANTHROPIC_API_KEY`, judge registration is skipped entirely, so AI check types fail exactly like misspelled ones. Add a `judges:` block or export the key. |
| run-start error about the default judge | `judges.default:` names a provider whose `api_key_env` is unset (available providers are silently skipped, but an unavailable explicit default is an error) — export that env var or change `default:` |
| `case dir <name>: …` | malformed case directory (bad `assert.yaml`) — note case dirs get the SAME `--param` substitution + model canonicalization as bench files |
| `param "x" is null — give it a value or remove the declaration` | a `params:` default is YAML null (`x:` with no value) or a caller sent null — params must carry values |
| `--param x= and null are not allowed` | CLI param without a value; also note `--param flag=on` stays the STRING "on" (explicit typing, not YAML 1.1) |
| claude-code runner: binary not found | `claude` not on PATH (checked at run, not load) |
| `runner failed: claude CLI failed: exit status 1: <API message> (api_error_status NNN)` | The CLI's real API/auth error, surfaced from its stream-json stdout (stderr is always empty in --print mode). E.g. "belongs to a disabled organization" = the key's Anthropic org is disabled — swap the key; billing, not madbench. Fast fail (~2s) = auth/org, not a model problem. |
| `runner failed: … exit status 1 (stderr: )` (empty) | Pre-fix madbench (< the stream-result-error patch) swallowing the above — upgrade, or run the claude CLI manually with the sandbox env to see the stream-json `result` event. |

## Behavioral symptoms

| Symptom | Diagnosis |
|---|---|
| Agent "succeeds" in its final message but files unchanged; exec checks fail; transcript ends "please approve …" | **Permission mode.** `--print` silently no-ops un-approved tools. Add `--permission-mode acceptEdits` (writes) or `bypassPermissions` (commands) to `runner_config.args`. The single most common failure. |
| Bench passes even when the agent does nothing | Testdata not red. Run the exec command manually in `testdata/` — it must FAIL pre-run. |
| Exec test check passes but work looks wrong | Agent cheated (deleted/weakened the test). Add anti-cheat greps + `session:*` guards. |
| `contains`/`regex` fails though the code is correct and on disk | String/structured checks read ONLY the agent's final message (`Session.FinalOutput`), never files or tool output. Grade files with `exec` (grep/test), not `contains`. |
| `latency`/`cost` fail intermittently on healthy runs | Expectation too tight — ~2.6× run-to-run cost variance is normal. Tighten only to 1.5–2× observed max. |
| `session:step-count` fails unexpectedly | It defaults to EXACT match — use `args.lte:`/`args.gte:` |
| `assert-set` fails though most children pass | Its threshold defaults to 1.0 (all) — set a ratio like 0.66 |
| exec with pipes/quotes behaves oddly | No shell — `value:` is whitespace-split. Use `cmd: [sh, -c, '…']` |
| ts/js/python check can't find deps | Deps resolve from nearest `package.json`/`pyproject.toml` project root; add lockfile or set `defaults.bun`/`defaults.python` |
| `--ui` didn't open with `--repeat 3` | By design: multi-run bypasses the TUI (`--runs` is the deprecated alias) |
| Score looks inverted (high toxicity = high score?) | Contract: Score is normalized [0,1] higher-is-better; raw risk is in `Evidence` |

## Negative controls — how they lie to you

Running the bench under `--harness mock` is the standard negative control: the mock
harness just echoes the prompt, so a bench that actually measures anything must fail
**every** cell. Two traps make a broken control look healthy.

### The exit code is not the control — the per-cell tally is

`--harness mock` must fail every cell. But the process exit code is non-zero if **any**
cell fails, so the obvious wrapper — "run under mock, assert non-zero exit" — reports a
healthy control while any number of cells sail through. A bench with 9 failing cells
and 1 passing one gives exactly the same exit code as one with 10 failing cells.

**Count the cells.** Take the tally from the report JSON, not from `$?`:

```bash
madbench bench.yaml --harness mock --report-json mock.json
jq -r '.results[] | "\(.scenario_id)\t\(.status)"' mock.json   # every row must say "fail"
jq '[.results[] | select(.status != "fail")] | length' mock.json  # MUST be 0
jq -r '.summary | "passed=\(.passed) failed=\(.failed) errors=\(.errors)"' mock.json
```

Then name every passing cell and explain it before you trust the bench.

### `latency` and `cost` necessarily pass under mock — they are not evidence

They read `Metrics.Latency` / `Metrics.Cost` raw, and under the mock harness both are
**0** — so both check types pass with a **perfect 1.00 score** every time, while the
metrics block prints `cost n/a`:

```
 latency-guard PASS  1.00 ###### 0.0s
   Logic   latency ≤ 60s        1.00 >= 0.00
   Logic   cost ≤ $0.10         1.00 >= 0.00
```

This is correct behavior, not a bug — **do not file it as one**. But it has two
consequences: a `latency`/`cost` pass under mock is not evidence of anything, so
**do not count those cells** in a negative control; and these checks are *runaway
guards*, there to bound pathological behavior on a real run, never to demonstrate
that the bench measures the task.

### A discovery prompt cannot prove a capability claim

To prove a check is broken you need a prompt that **orders** the action. If the prompt
merely invites the agent to do something ("explore the repo and use whatever tools
help"), an agent that was free not to invoke a skill — and didn't — produces an
**inconclusive** run, not a failing check. You cannot distinguish "the check is broken"
from "the agent chose otherwise". Write the prompt so the only compliant behavior is
the one you are checking for, then a failure means the check.

## Reading the report JSON

`madbench bench.yaml --report-json out.json`, then inspect. Read the key names off
this table rather than guessing — several are not what you would predict:

| What you want | Path |
|---|---|
| per-scenario outcome | `.results[].status` — the string `"pass"`/`"fail"`, not a bool |
| scenario name | `.results[].scenario_id` |
| per-check outcome | `.results[].checks[].result` → `{pass, score, reason, evidence}` |
| check type / its YAML | `.results[].checks[].type` · `.results[].checks[].spec` |
| observed cost/latency | `.results[].session.metrics` |
| run tally | `.summary` → `{total, passed, failed, errors, skipped}` |

A `session` object holds exactly these keys (`pkg/harness/harness.go`, `Session`):
`final_output` · **`actions`** · **`calls`** · `files_changed` · `metrics` ·
`work_dir` · `subagents` · `metadata` · `provider`.

**`actions` is the authoritative event stream** — everything the agent did, in order,
including subagent lifecycle rows. **`calls` is the lossy derived view**: only
`tool_call` and `mcp_call` kinds survive it. Reach for `actions` when you need the
whole picture and `calls` when you only want tool invocations; a question that comes
back empty from `calls` is usually a question that should have been asked of
`actions`.

`reason` on exec failures embeds the last 2KB of command output — read it first.
Check rows nest the outcome under `result` (`CheckResult{type, spec, result{pass,
score, reason, evidence}, error}` — `pkg/madbench/report.go`):

```bash
jq -c '.results[].checks[] | select(.result.pass==false) | {type, reason: .result.reason}' out.json
jq -c '.results[].session.metrics' out.json                 # observed cost/latency for tuning
jq -c '[.results[].session.calls[]?.name] | group_by(.) | map({tool: .[0], n: length})' out.json
jq -c '.results[].session.actions[]? | select(.kind=="skill")' out.json   # skill invokes
```

Verify the agent took the path you think it took before blaming a check. (If a query
returns null, dump the shape with `jq 'keys' out.json` /
`jq '.results[0].checks[0]' out.json` and adapt.)

## Expectation-tuning procedure

1. Run 2–3 times: `madbench bench.yaml --report-json run$N.json` (or `--repeat 3`).
2. Collect observed `cost`/`latency` from `session.metrics`.
3. Set thresholds at ~1.5–2× the observed max — bound pathological behavior, don't fit
   one sample.
4. A crossing on a healthy run means raise the Expectation; never re-roll to green.

## Flake hunting

`madbench bench.yaml --repeat 5` repeats every bench. Any scenario that flips
pass/fail across runs is under-determined: judge-only grading, too-tight thresholds,
or racy testdata. Fix by adding deterministic checks or loosening Expectations.

## Improving a weak bench — checklist

- Deterministic core (exec/session/string) before any AI judge; one focused
  `llm-rubric` beats several vague ones.
- Anti-cheat guards on every exec-graded bench.
- Red-state testdata verified manually.
- Canonical field names — `harness`/`harness_config`/`scenarios`/`checks`/`testdata`/
  `defaultScenario`, and `session:*` check types. The old spellings all still load as
  aliases; rewrite them anyway (table in `schema.md`).
- A valid sandbox level: `none`/`workspace`/`home`/`container`, spelled under `level:`.
- Expectations backed by observed runs.
- A negative control counted per cell, with `latency`/`cost` cells excluded.
- `metric:` names for scores used in `derivedMetrics`.
- Don't rely on case-level `threshold:` as a gate — it's parsed for promptfoo
  compatibility but NOT enforced by the engine (v1). Gate with per-check
  `threshold:` or an `assert-set`.
