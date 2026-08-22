# Debugging madbench benches

## Before you debug anything

**`list` proves a file parses; `preflight` proves it could run.** `madbench list` on a
bench whose `testdata:` directory is gone, whose harness binary is not installed, or
whose check `type:` does not exist prints the bench and exits 0 — a confident all-clear
on a file that cannot start. Never use `list` as the pre-run gate.

What `list` *does* catch is anything that makes the file **malformed** — an unknown key,
a bad metric declaration, a retired `sandbox:` level. Those are load errors, so every
command refuses them identically. Machine-specific problems are preflight's alone.

**Preflight runs automatically** before every run and blocks it, printing `preflight:
nothing was run, no spend`. `--skip-preflight` opts out. Running it by hand while
authoring is still the fastest way to see the whole dependency picture: it resolves
every harness binary, API key, runtime, daemon, sandbox level, `testdata:` path,
`file://` grader, **unknown check type** and `image:` the run needs.

**Then run `madbench check <bench>`.** Preflight asks *can this run*; `check` asks *does
this bench measure anything*. They catch disjoint problems and a green preflight says
nothing about the second question.

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
| `field <key> not found in type madbench.BenchSpec` / `.ScenarioSpec` / `.sandboxYAML` | **Strict decoding (v0.10.0).** An unknown key at that level. Common: `input:`→`prompt:`, top-level `name:`→`description:`, `sandbox: {mode:}`→`{level:}`. Check the alias table in `schema.md` before assuming the key is wrong |
| `unknown check type "<name>"` from **preflight** | typo'd `type:` — now caught before any spend rather than at evaluate time |
| `grader ts: stat …: no such file or directory` | a check's `value: file://…` grader is missing; a relative `file://` resolves against the **bench file's** directory |
| `harness "mock" cannot deliver an image ...` | only `claude-code` is `ImageCapable`. You cannot run — or `madbench check` — an `image:` bench under mock |
| `generate:` refusals naming a value | the generated secret was findable in the workspace, the prompt, or the report. The expectation must be **derived** (sums, counts, checksums), not planted in a file |
| `CONFOUNDED` / an Eval stopped before spend | `control:` found a run differing by a path not in `varies:`. Read the printed diff — the undeclared file is your confound |
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
| `session:step-count` fails unexpectedly | It defaults to EXACT match — use `args.lte:`/`args.gte:`. Also: it counts the **main thread only** (v0.10.0, both capture paths). Before that the on-disk path folded a subagent's calls in while stream-json did not, so an old expectation tuned against a subagent-spawning bench will now read lower |
| `session:skill-used` never passes | If the bench sets `harness_config.agent_env`, it **cannot** pass: `--bare` stops advertising skills, so an agent never invokes one spontaneously. Use `plugins:` instead, or drop the check. (The check itself was broken before v0.10.0 — it scanned `Calls`, which never receives `ActionSkill`; it reads `Actions` now.) |
| a `session:*` check fails on a path that is obviously right | The WorkDir is a per-run tmpdir and macOS reports `/private/var/…` where the sandbox stored `/var/…`. Use `session:file-read` (which compares through `internal/hostpath`) or a `glob:`/`suffix:` matcher — never a hand-built absolute literal |
| `assert-set` fails though most children pass | Its threshold defaults to 1.0 (all) — set a ratio like 0.66 |
| exec with pipes/quotes behaves oddly | No shell — `value:` is whitespace-split. Use `cmd: [sh, -c, '…']` |
| ts/js/python check can't find deps | Deps resolve from nearest `package.json`/`pyproject.toml` project root; add lockfile or set `defaults.bun`/`defaults.python` |
| `--ui` didn't open with `--repeat 3` | By design: multi-run bypasses the TUI (`--runs` still works, warns; checked 2026-08-14) |
| Score looks inverted (high toxicity = high score?) | Contract: Score is normalized [0,1] higher-is-better; raw risk is in `Evidence` |

## The two controls

A bench that passes tells you nothing until you know it *can* fail, and that its
verdicts are reproducible. Both questions now have a command; neither needs jq.

### `madbench check` — the negative control

```bash
madbench check bench.yaml            # --verbose to list every cell
```

The mock harness echoes the prompt and does nothing else, so every graded cell must
fail. **The exit code was never the control — the per-cell tally is.** A process exit is
non-zero if *any* cell fails, so the obvious wrapper ("run under mock, assert non-zero
exit") reports a healthy control while any number of cells sail through: 9-fail-1-pass
and 10-fail give the identical exit code. `check` counts cells:

```
  1/3 cells failed as required · 2 errored (could not grade) · 0 wrongly passed

  COULD NOT GRADE (2) — these cells proved nothing either way:
    implement-add · cost
      cost: not reported by this session; the ≤$0.1000 bound graded nothing

  the control does NOT hold: 2 cells could not be graded, so they never showed they can fail.
```

**Errored ≠ failed**, and folding the two together is how a broken control looks
healthy. A cell that errored graded nothing, so it demonstrated neither soundness nor
rot; `check` gives it its own bucket and refuses to call the control held.

Exit: 0 = holds · 1 = a cell wrongly passed or could not be graded · 3 = nothing graded.

**Two benches it cannot control.** An `image:` bench — the mock is not `ImageCapable`, so
`check` refuses with *harness "mock" cannot deliver an image*. And any bench at
`sandbox: none`, unless you pass `--allow-host-writes`: the mock writes nothing, but the
checks run for real, and at level `none` an `exec` check is a command executed in the
directory you are sitting in.

### `madbench grade` — the positive control

```bash
madbench bench.yaml --report-json out.json   # the paid run, once
madbench grade out.json                      # re-grade it, free, forever
```

Re-grades the recorded Session offline and checks every verdict reproduces. It **re-runs
the evaluators**; it does not replay stored verdicts — so a non-deterministic grader
shows up as **DIVERGED** rather than quietly agreeing with itself.

This is the cheapest thing in the workflow: one paid capture becomes a permanent offline
regression test for your *grading*, replacing unit tests that hand-build approximate
Sessions.

Two categories are **SKIPPED with a stated reason**, never silently passed: WorkDir-reading
checks (`exec`, `custom:exec`, file-loading script graders — the sandbox tree is deleted
when the run ends) and judge-backed checks (re-grading spends on a live judge, and a
non-deterministic verdict cannot be a control). A cell whose re-grade errors is reported
as "could not re-grade", never as reproduced.

### `latency` and `cost` no longer pass on absent data

They used to read `Metrics.Latency`/`.Cost` raw and score a **perfect 1.00** under mock,
where both are 0, while the metrics block printed `cost n/a` — green ticks that meant
nothing. **Fixed in v0.10.0:** they now error when the session reported no metrics.

```
errored  latency   0.00  latency: not reported by this session; the ≤60000ms bound graded nothing
errored  cost      0.00  cost: not reported by this session; the ≤$0.1000 bound graded nothing
```

Error rather than fail is deliberate: missing evidence is not "too expensive". These are
still *runaway guards* for real runs, never evidence that a bench measures its task — so
`madbench check` reporting them under COULD NOT GRADE is the expected, correct outcome
for a bench that carries them, not a defect in your bench.

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
| per-run control diff (Eval with `control:`) | `.control` → changed paths + size deltas per run |

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
- A negative control run as `madbench check` — per cell, not by exit code. `latency`/
  `cost` cells land in COULD NOT GRADE, which is correct and expected.
- The verdicts reproduce: `madbench grade` on a stored report from a real run.
- Session checks asking the **narrowest true question**: `args.thread: main` where the
  claim is about the agent under test, `session:file-read` instead of a sentinel token
  injected into the thing being measured.
- `metric:` names for scores used in `derivedMetrics`.
- Don't rely on case-level `threshold:` as a gate — it's parsed for promptfoo
  compatibility but NOT enforced by the engine (v1). Gate with per-check
  `threshold:` or an `assert-set`.
