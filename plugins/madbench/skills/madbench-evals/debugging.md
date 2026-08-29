# Debugging madbench benches

Reference for `madbench:madbench-evals`. Error→cause map, the two controls, report analysis,
expectation tuning. Mirrors madbench **v0.23.0**.

## Before you debug anything

**`list` proves a file parses; `preflight` proves it could run.** `madbench list` on a bench
whose `testdata:` directory is gone, whose harness binary is not installed, or whose check
`type:` does not exist prints the bench and exits 0 — a confident all-clear on a file that
cannot start. Never use `list` as the pre-run gate.

What `list` *does* catch is anything that makes the file **malformed** — an unknown key, a bad
metric declaration, a retired `sandbox:` level. Those are load errors, so every command
refuses them identically. Machine-specific problems are preflight's alone.

**Preflight runs automatically** before every run and blocks it, printing `preflight: nothing
was run, no spend`. `--skip-preflight` opts out. Running it by hand while authoring is still
the fastest way to see the whole dependency picture: it resolves every harness binary, API
key, runtime, daemon, sandbox level, `testdata:` path, `file://` grader, **unknown check
type**, `image:`, and — when any Scenario is interactive — **magmux**.

**Then run `madbench check <bench>`.** Preflight asks *can this run*; `check` asks *does this
bench measure anything*. They catch disjoint problems, and a green preflight says nothing
about the second question.

**`madbench demo` exists.** A built-in bench against an offline harness that emulates a real
agent: no network, no API keys, no spend. Use it to see what a healthy report looks like, and
to sanity-check your tooling (jq recipes, report parsing) before pointing it at a real run.

**Check which binary you are running before trusting any source you read:**

```bash
madbench version          # there is no --version flag
```

A conclusion drawn from source you did not build is a conclusion about a different program.

## Error message → cause map

| Message | Cause / fix |
|---|---|
| `loading <path>: parsing <path>: yaml: line N: …` | YAML syntax/type error — fix at the line shown |
| `field <key> not found in type madbench.BenchSpec` / `.ScenarioSpec` / `.sandboxYAML` | Strict decoding: an unknown key at that level. Common: `input:`→`prompt:`, top-level `name:`→`description:`, `sandbox: {mode:}`→`{level:}`. Check the alias table in `schema.md` before assuming the key is wrong |
| `sandbox: level "process" was renamed to "home"` | A retired level. `process`→`home`, `machine`/`docker`→`container`. **Refused, not aliased**, as a load error |
| `unknown check type "<name>"` from **preflight** | typo'd `type:`, caught before any spend |
| `unknown assertion type: "llm-rubric"` (or any AI check name) | **Missing judge provider, not a typo.** With no `judges:` block and no `ANTHROPIC_API_KEY`, judge registration is skipped, so AI types fail exactly like misspelled ones. The message names the fix |
| run-start error about the default judge | `judges.default:` names a provider whose `api_key_env` is unset. Available providers are silently skipped, but an unavailable **explicit** default is an error |
| `grader ts: stat …: no such file or directory` | a check's `value: file://…` grader is missing; a relative `file://` resolves against the **bench file's** directory |
| `harness "mock" cannot deliver an image …` | only `claude-code` is `ImageCapable`. You cannot run — or `madbench check` — an `image:` bench under mock |
| `effort "hgih" is not a level the CLI accepts` | `harness_config.effort` is the one key checked by **value**. Use `low`·`medium`·`high`·`xhigh`·`max` |
| `follow_ups` rejected at load | `follow_ups:` with `interactive: false`. A `--print` run is a single pipe with no way back in |
| `generate:` refusal naming a value | the generated secret was findable in the workspace, prompt, or report. The expectation must be **derived** (sums, counts, checksums), not planted. If the answer IS a path, use `setup:` instead |
| both `setup:` and `generate:` declared | refused — both own the staged tree and both run before the workspace exists |
| `probe: false` with `require: true` | refused at load, naming both keys: "do not look" and "verify before spending" cannot both be true |
| `CONFOUNDED` / an Eval stopped before spend | `control:` found a run differing by a path not in `varies:`. Read the printed diff — the undeclared file is your confound |
| a `varies:` entry that matched nothing | reported as the shape of a typo: `varies: [plugin]` loads clean and matches nothing |
| `no madbench.yaml or madbench.yml in <dir>` | bare `madbench` with no discoverable file — pass a path |
| `assert-set: child "<type>": <err>` | error inside a composite child — fix the child |
| `exec: 'cmd' (string slice) or 'value' (string) is required` | exec check missing its command |
| exec errors about missing WorkDir | scenario has no workspace and the check has no absolute `cwd:` |
| `case dir <name>: …` | malformed case directory. Case dirs get the SAME `--param` substitution and model canonicalization as bench files |
| `param "x" is null — give it a value or remove the declaration` | a `params:` default is YAML null, or a caller sent null |
| `--param x= and null are not allowed` | CLI param without a value. Note `--param flag=on` stays the STRING `"on"` |
| claude-code: binary not found | `claude` not on PATH — checked at run and in preflight, never at load |
| magmux not found | some Scenario is interactive (**the default**) and magmux ≥ 0.8.0 is not on PATH. Set `harness_config.magmux_binary`, `$MADBENCH_MAGMUX`, or declare `interactive: false` |
| `claude CLI failed: exit status 1: <API message> (api_error_status NNN)` | the CLI's real API/auth error, surfaced from its stream-json stdout. "belongs to a disabled organization" = the key's org is disabled; billing, not madbench. A fast fail (~2s) is auth, not a model problem |
| a Scenario ERRORs naming a thread and when it spawned | a subagent was still running when the settle window timed out. The Session is an incomplete capture, so it does not grade |

## Behavioral symptoms

| Symptom | Diagnosis |
|---|---|
| The run hangs and reports only a timeout; nothing in the transcript after the first Bash call | **Permission mode on the interactive path.** `interactive: true` is the default, and there `acceptEdits` parks Bash at an approval menu nobody can answer. Use `bypassPermissions`. A `--print`-era bench carrying `acceptEdits` was never getting anything from it — `--print` ignores `--permission-mode` entirely |
| The run hangs before the agent does anything at all | One of the four interactive dialogs was not seeded — theme picker, trust prompt, custom-API-key prompt, bypass disclaimer. madbench seeds all four after the environment probe; a custom HOME or a hand-built sandbox can defeat that |
| Everything is much cheaper and thinner than expected | `interactive: false`. Measured on one greeting Scenario: $0.0114 / 127 tokens against $0.0316 / 25.4k interactive. A `--print` turn strips the system prompt and context a real session carries |
| The Scenario times out just past the bar | The default is **300s**, raised from 120s because 120 was calibrated for `--print`. A cold-start interactive turn can approach it. Declare your own `timeout:` |
| Bench passes even when the agent does nothing | Testdata not red. Run the exec command manually in the testdata dir — it must FAIL pre-run |
| Exec test check passes but the work looks wrong | Agent cheated (deleted or weakened the test). Add anti-cheat greps and `session:*` guards |
| `contains`/`regex` fails though the code is correct and on disk | String and structured checks read ONLY `Session.FinalOutput`, never files or tool output. Grade files with `exec` |
| Text checks grade a status line like "I've launched a search agent…" | The run delegated. `Session.FinalOutput` now follows the answering thread when the parent ended its turn without receiving the result — if you still see this, the parent *did* receive it and chose to say that |
| `latency`/`cost` fail intermittently on healthy runs | Expectation too tight. Tighten only to 1.5–2× observed max |
| `session:step-count` refused at construction | It now **requires** a bound. `args.lte` / `args.gte` / `args.eq`; a range binds both ends. It also counts the **main thread only** — a subagent's work is in `Session.Subagents` |
| A `session:tool-used` bound fails though the totals look right | Counting is **per named tool, never aggregate**. `value: [Read, Grep]` with `gte: 2` means *each* at least twice |
| `session:tool-used` with `outcome: ok` fails on a call that plainly worked | **Unknown satisfies neither `ok` nor `error`**, and unknown is the majority state — a successful `Read` records no outcome at all. The reason says so: *"Read was called 3 time(s), none with a recorded outcome"*. Use `outcome: ok` only where the answer is knowable (Bash, Edit/Write) |
| `session:tool-used` with `value: Task` and `thread: main` is always false | A spawn row carries the **subagent's** thread, not the spawner's. Use `session:subagent-used` to ask who delegated |
| `session:tool-sequence` or `session:tool-args-match` never sees a skill or a spawn | Both read only `Calls`, which excludes `ActionSkill` and `ActionSubagent`. `session:tool-used` reads `Actions` and unions `Calls`, so it does see them |
| `session:skill-used` never passes | If the bench sets `harness_config.agent_env`, it **cannot**: `--bare` stops advertising skills, so an agent never invokes one spontaneously. Use `plugins:` instead, or drop the check. Also note it grades the **result** — an errored invocation fails and says so, rather than reporting "was not invoked" |
| `session:tools-only` passes on a run that did nothing | A fence is a constraint, not a claim that anything happened. An empty scope satisfies it, and `madbench check` flags it under WRONGLY PASSED. Pair it with a `session:tool-used` carrying `gte:` |
| A `session:*` check fails on a path that is obviously right | The WorkDir is a per-run tmpdir, and macOS reports `/private/var/…` where the sandbox stored `/var/…`. Use `session:file-read` (which compares through `internal/hostpath`) or a `glob:`/`suffix:` matcher — never a hand-built absolute literal |
| A literal that starts with `glob:` / `suffix:` / `contains:` is misread | Those prefixes are now matchers. Write `exact:` in front to get the literal back |
| Every `environment:*` check ERRORs | Nothing was captured. `harness_config.environment.probe` is false, or the harness reports no environment. That is the correct loud outcome for a run that measured nothing — a pass would report success for the exact incident the family exists to end |
| `environment:mcp-connected` errors rather than failing | Only `system:init` reports a status, and only the `--print` drive path carries one. On the default interactive path the run never asked |
| `environment:command-registered` errors | `claude plugin details` prints no command heading — it folds `commands/*.md` into its own `Skills (N)` count. It needs a source other than `plugin-cli` |
| A staged plugin is missing and the scenario ERRORed before the agent ran | `harness_config.environment.require: true` refused it. That is a gate, not a grade: it did not score badly, it never ran |
| `assert-set` fails though most children pass | Its threshold defaults to 1.0 (all) — set a ratio like 0.66 |
| exec with pipes or quotes behaves oddly | No shell — `value:` is whitespace-split argv. Use `cmd: [sh, -c, '…']` |
| ts/js/python check cannot find deps | Deps resolve from the nearest `package.json`/`pyproject.toml` root; add a lockfile or set `defaults.bun`/`defaults.python` |
| Score looks inverted (high toxicity = high score?) | Contract: Score is normalized [0,1], higher-is-better. Raw risk is in `Evidence` under `raw_toxicity` and friends |
| A check you meant as a measurement is failing the Scenario | Give it `readout: true`. It still runs, scores and reports, and its named score still reaches `metrics:` — it just cannot fail the Scenario. An **erroring** readout still fails |

## The two controls

A bench that passes tells you nothing until you know it *can* fail, and that its verdicts are
reproducible.

### `madbench check` — the negative control

```bash
madbench check bench.yaml
```

The mock harness echoes the prompt and does nothing else, so every gradable cell must fail.
**The exit code was never the control — the per-cell tally is.** A process exit is non-zero if
*any* cell fails, so the obvious wrapper ("run under mock, assert non-zero exit") reports a
healthy control while any number of cells sail through: 9-fail-1-pass and 10-fail give the
identical exit code.

Three buckets, deliberately kept apart:

| Bucket | Meaning |
|---|---|
| **failed as required** | the cell graded, and it failed — the control holding |
| **WRONGLY PASSED** | the cell graded and passed against a harness that did nothing. It is grading nothing |
| **ERRORED** | the cell graded nothing at all, so it demonstrated neither soundness nor rot |
| **NOT APPLICABLE UNDER MOCK** | `latency` and `cost` — excluded from the verdict entirely |

**Errored ≠ failed**, and folding the two together is how a broken control looks healthy.

Exit codes: **0** = the control holds (every gradable cell was graded, and every one failed) ·
**1** = a cell wrongly passed, or a cell or scenario could not be graded at all · **3** =
nothing gradable was found.

**Two benches it cannot control.** An `image:` bench — the mock is not `ImageCapable`, so
`check` refuses with *harness "mock" cannot deliver an image*. And any bench at `sandbox:
none` unless you pass `--allow-host-writes`: the mock writes nothing, but the **checks run for
real**, and at level `none` an `exec` check is a command executed in the directory you are
sitting in.

### `latency` and `cost` are exempt, and a count ceiling is not

`latency` and `cost` guard the **budget**, not the behavior. A run that did nothing spent
nothing and took no time, so `cost $0.00 ≤ $0.04` is the *correct* verdict under mock. They
are reported NOT APPLICABLE and left out. A bench declaring nothing else exits **3**
(`0 gradable cells`) rather than reporting a holding control.

Prove one by **falsification** instead — set an impossible threshold and make one real run,
then a generous one. Both halves matter: a guard hardwired to fail would look identical to a
working guard if you only ever saw it say no.

```
# impossible bounds — both FAIL against real measured values
  Logic   cost ≤ $0.                       0.00      ← measured $0.0116
  Logic   latency ≤ 1ms                    0.00      ← measured 8.35s

# generous bounds, same bench and model — both PASS
  Logic   cost ≤ $5.00                     1.00      ← measured $0.0118
  Logic   latency ≤ 120s                   0.98      ← measured 4.57s
```

**A count ceiling is NOT exempt, and the distinction is the point.** `session:step-count` with
`lte:` is also satisfied by an agent that did nothing, so it looks like it belongs with the
budget guards. It does not: cost and latency are measured *by the provider*, and a harness
reporting neither leaves the check no input. A step count is derived from the Session's **own
action trace**, and the mock produces that trace — an honest, empty one. Zero steps is a real
measurement, so `0 ≤ 10` passing is evidence that the guard cannot fail. Fix it with a floor
(`gte`) or an exact count.

### `madbench grade` — the positive control

```bash
madbench bench.yaml --report-json out.json   # the paid run, once
madbench grade out.json                      # re-grade it, free, forever
```

Re-grades the recorded Session offline and checks every verdict reproduces. It **re-runs the
evaluators**; it does not replay stored verdicts — so a non-deterministic grader shows up as
**DIVERGED** rather than quietly agreeing with itself.

This is the cheapest thing in the workflow: one paid capture becomes a permanent offline
regression test for your *grading*.

Two categories are **SKIPPED with a stated reason**, never silently passed: WorkDir-reading
checks (`exec`, `custom:exec`, file-loading script graders — the sandbox tree is deleted when
the run ends) and judge-backed checks (re-grading spends on a live judge, and a
non-deterministic verdict cannot be a control). A cell whose re-grade errors is reported as
"could not re-grade", never as reproduced.

### A discovery prompt cannot prove a capability claim

To prove a check is broken you need a prompt that **orders** the action. If the prompt merely
invites the agent to do something ("explore the repo and use whatever tools help"), an agent
that was free not to invoke a skill — and didn't — produces an **inconclusive** run, not a
failing check. You cannot distinguish "the check is broken" from "the agent chose otherwise".
Write the prompt so the only compliant behavior is the one you are checking for.

## Reading the report JSON

`madbench bench.yaml --report-json out.json`, then inspect. Read the key names off this table
rather than guessing — several are not what you would predict.

| What you want | Path |
|---|---|
| per-scenario outcome | `.results[].status` — the string `"pass"`/`"fail"`, not a bool |
| scenario name | `.results[].scenario_id` |
| per-check outcome | `.results[].checks[].result` → `{pass, score, reason, evidence}` |
| check type / its YAML | `.results[].checks[].type` · `.results[].checks[].spec` |
| observed cost/latency | `.results[].session.metrics` |
| what the tool had loaded | `.results[].session.environment.reported` |
| what madbench staged | `.results[].session.environment.expected` |
| per-thread subagent rollup | `.results[].session.subagents` |
| run tally | `.summary` → `{total, passed, failed, errors, skipped}` |
| per-run control diff (Eval with `control:`) | `.control` → changed paths + size deltas per run |

**`actions` is the authoritative event stream** — everything the agent did, in order,
including subagent lifecycle rows. **`calls` is the lossy derived view**: only `tool_call` and
`mcp_call` kinds survive it, and skill invocations, subagent spawns and attachments are all
excluded. Reach for `actions` when you need the whole picture; a question that comes back
empty from `calls` is usually a question that should have been asked of `actions`.

Both carry the recorded outcome per call: `tool_call_id`, `result_ok` (**tri-state — absent
means the capture said nothing, never failure**), `result_tag`.

`reason` on exec failures embeds the tail of the combined output — read it first.

```bash
jq -c '.results[].checks[] | select(.result.pass==false) | {type, reason: .result.reason}' out.json
jq -c '.results[].session.metrics' out.json                 # observed cost/latency for tuning
jq -c '[.results[].session.calls[]?.name] | group_by(.) | map({tool: .[0], n: length})' out.json
jq -c '.results[].session.actions[]? | select(.kind=="skill")' out.json      # skill invokes
jq -c '.results[].session.actions[]? | select(.kind=="subagent")' out.json   # spawns
jq -c '.results[].session.environment.reported.plugins[]?' out.json          # what loaded
jq -c '.results[].checks[] | select(.result.evidence.outcome_census)' out.json
```

Verify the agent took the path you think it took before blaming a check. If a query returns
null, dump the shape with `jq 'keys' out.json` and adapt.

## Expectation-tuning procedure

1. Run 2–3 times: `madbench bench.yaml --report-json run$N.json` (or `--repeat 3`).
2. Collect observed `cost`/`latency` from `session.metrics`.
3. Set thresholds at ~1.5–2× the observed max — bound pathological behavior, don't fit one sample.
4. A crossing on a healthy run means raise the Expectation; never re-roll to green.

Keep a versioned history with `--report-dir .reports`, then `madbench report trend` and
`madbench report compare a b` instead of hand-diffing JSON.

## Flake hunting

`madbench bench.yaml --repeat 5` repeats every bench. Any scenario that flips pass/fail across
runs is under-determined: judge-only grading, too-tight thresholds, or racy testdata. Fix by
adding deterministic checks or loosening Expectations.

For an Eval, `--run` selects **which** runs execute and `--repeat` sets **how many times** each
one does; they compose.

## Improving a weak bench — checklist

- Drive mode declared deliberately, and permissions matched to it (`bypassPermissions` for an
  interactive bench that runs commands).
- A `timeout:` you chose, not the 300s fallback.
- Deterministic core (exec / session / environment / string) before any AI judge; one focused
  `llm-rubric` beats several vague ones.
- Anti-cheat guards on every exec-graded bench, and an activity check beside every fence.
- Red-state testdata verified manually.
- Canonical field names — `harness`/`harness_config`/`scenarios`/`checks`/`testdata`/
  `defaultScenario`, and `session:*` check types. The old spellings all still load; rewrite
  them anyway (table in `schema.md`).
- A valid sandbox level, spelled under `level:`.
- Expectations backed by observed runs.
- A negative control run as `madbench check` — per cell, not by exit code. `latency`/`cost`
  cells land in NOT APPLICABLE, which is correct and expected.
- The verdicts reproduce: `madbench grade` on a stored report from a real run.
- Session checks asking the **narrowest true question**: `args.thread: main` where the claim is
  about the agent under test, `args.outcome: ok` where success is knowable and matters,
  `session:file-read` instead of a sentinel token injected into the thing being measured.
- Measurements marked `readout: true` rather than gating the Scenario.
- `metric:` names for scores used in `derivedMetrics:` and `metrics:`.
- Don't rely on Scenario-level `threshold:` as a gate — it is parsed for promptfoo
  compatibility and **never evaluated**. Gate with per-check `threshold:` or an `assert-set`.
