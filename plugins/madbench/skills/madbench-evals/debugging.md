# Debugging madbench benches

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
| Exec test check passes but work looks wrong | Agent cheated (deleted/weakened the test). Add anti-cheat greps + trajectory guards. |
| `contains`/`regex` fails though the code is correct and on disk | String/structured checks read ONLY the agent's final message (`Session.FinalOutput`), never files or tool output. Grade files with `exec` (grep/test), not `contains`. |
| `latency`/`cost` fail intermittently on healthy runs | Expectation too tight — ~2.6× run-to-run cost variance is normal. Tighten only to 1.5–2× observed max. |
| `trajectory:step-count` fails unexpectedly | It defaults to EXACT match — use `args.lte:`/`args.gte:` |
| `assert-set` fails though most children pass | Its threshold defaults to 1.0 (all) — set a ratio like 0.66 |
| exec with pipes/quotes behaves oddly | No shell — `value:` is whitespace-split. Use `cmd: [sh, -c, '…']` |
| ts/js/python check can't find deps | Deps resolve from nearest `package.json`/`pyproject.toml` project root; add lockfile or set `defaults.bun`/`defaults.python` |
| `--ui` didn't open with `--repeat 3` | By design: multi-run bypasses the TUI (`--runs` is the deprecated alias) |
| Score looks inverted (high toxicity = high score?) | Contract: Score is normalized [0,1] higher-is-better; raw risk is in `Evidence` |

## Reading the report JSON

`madbench run bench.yaml --report-json out.json`, then inspect:

- `results[].assertions[]` → `{pass, score, reason, evidence}` per check.
  `reason` on exec failures embeds the last 2KB of command output — read it first.
- `results[].session.metrics` → tokens, cost, latency actually observed.
- `results[].session.trajectory` → the Action list (tool calls) — verify the agent
  took the path you think it took before blaming a check.

Assertion rows nest the outcome under `result` (`AssertionResult{type, spec,
result{pass, score, reason, evidence}, error}` — `pkg/madbench/report.go`):

```bash
jq '.results[].assertions[] | select(.result.pass==false) | {type, reason: .result.reason}' out.json
jq '.results[].session.metrics' out.json                    # observed cost/latency for tuning
jq '[.results[].session.trajectory[].name] | group_by(.) | map({tool: .[0], n: length})' out.json
```

(If a query returns null, dump the shape with `jq 'keys' out.json` /
`jq '.results[0].assertions[0]' out.json` and adapt.)

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

- Deterministic core (exec/trajectory/string) before any AI judge; one focused
  `llm-rubric` beats several vague ones.
- Anti-cheat guards on every exec-graded bench.
- Red-state testdata verified manually.
- Canonical field names (`cases`/`testdata`/`defaultCase` — not `tests`/`fixture`/`defaultTest`).
- Expectations backed by observed runs.
- `metric:` names for scores used in `derivedMetrics`.
- Don't rely on case-level `threshold:` as a gate — it's parsed for promptfoo
  compatibility but NOT enforced by the engine (v1). Gate with per-check
  `threshold:` or an `assert-set`.
