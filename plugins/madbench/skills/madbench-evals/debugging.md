# Debugging madbench benches

Reference for the `madbench-evals` skill, reached by path. Error→cause map, the two controls,
report analysis, expectation tuning. The madbench release these files mirror is declared
**once**, in `plugins/madbench/mirrors.json`, which lists this file as stable.
`docs/<file>.md:<line>` citations point into the madbench checkout's `docs/` directory.

## Before you debug anything

**`list` proves a file parses; `preflight` proves it could run.** `madbench list` on a bench
whose `testdata:` directory is gone, whose harness binary is not installed, or whose check
`type:` does not exist prints the bench and exits 0 — a confident all-clear on a file that
cannot start. Never use `list` as the pre-run gate.

What `list` *does* catch is anything that makes the file **malformed** — an unknown key, a
retired key spelling (`runner:`, `fixture:`, `control:` …), a bad metric declaration, a
retired `sandbox:` level, an `experiment:` declaration. Those are load errors, so every
command refuses them identically. Machine-specific problems are preflight's alone.

**`list` does not construct checks**, so everything decided when a check is built is also
preflight's: an unknown or retired check type (`trajectory:*`, bare `skill-used`), a bad
`session:match` argument, an `exec` `value:` carrying shell syntax, an even `votes:`, an
`args.envelope`, and a `driver:` the harness or drive mode cannot take — all measured on
0.37.0 as `list` exit 0, `preflight` exit 1.

**Preflight runs automatically** before every run and blocks it, printing `nothing was run,
no spend`. `--skip-preflight` opts out. Running it by hand while authoring is still the
fastest way to see the whole dependency picture: it resolves every harness binary, API key,
runtime, daemon, sandbox level, `testdata:` path, `file://` grader, **unknown check type**,
`image:`, the Driver, and — when any Scenario is interactive — **magmux**. Its header also
states who the run bills: *"billed to your Claude <plan> subscription — the
ANTHROPIC_API_KEY that is also set is not used"* is a fact, not a warning (measured on 0.37.0).

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
| `field <key> not found in type madbench.BenchSpec` / `.ScenarioSpec` / `.sandboxYAML` | Strict decoding: an unknown key at that level. Common: `input:`→`prompt:`, top-level `name:`→`description:`, `sandbox: {mode:}`→`{level:}`, **the retired derived-metrics key→a `metrics:` expression** (`schema.md` §8). A key you meant only as a YAML anchor's home can be spelled `x-…` (`docs/eval-file.md:295-326`) |
| `` `runner:` was renamed `harness:` on 2026-09-22 and the old spelling is no longer accepted `` (and the same shape for `runner_config:`, `cases:`, `tests:`, `assert:`, `defaultCase:`, `defaultTest:`, `fixture:`, `disableDefaultAsserts:`, `agg:`, an Eval's `control:`/`varies:`, a model block's `type:`/`base_url:`) | A retired spelling, **refused at load** since 0.37.0, naming the line and the replacement. Rename it; there is no alias to fall back on. Full table: `schema.md` §1 |
| `unknown aggregate "avg"` / `unknown source "action.duration"` | Retired metric spellings: `add`/`total` → `sum`, `avg`/`average` → `mean`, `action.duration`/`action.tokens` → `event.duration`/`event.tokens`. The error lists the known values |
| `declares experiment: — its premise is not established, so it does not run` | The bench says its own premise is broken. Every command refuses it, printing the bench's text. Fix the premise, prove it with a measurement, then delete `experiment:` (`docs/README.md:153-163`) |
| `unknown flag: --runs` | `--runs` was removed; `--repeat N` counts, `--run <name>` selects |
| `loading run: stat run: no such file or directory` (or `… keychain …`) | `madbench run <file>` and `madbench keychain …` are gone; the CLI reads the word as a path. Write `madbench <file>` and `madbench key …` |
| `metrics[2]` / `scenarios[0].checks[1].metrics[0]` will not parse | An expression-form `metrics:` entry with a syntax error, named by index. Compiled at load, so nothing was spent (`docs/metrics.md:729-732`) |
| a `metrics:` entry reported as a YAML mapping | An unquoted ternary: a bare scalar containing `": "` is a key-value pair. Quote the whole entry (`docs/metrics.md:215-227`, `:733-734`) |
| a `metrics:` block "mixing expressions and declarations" | One key, two shapes, told apart by the first entry; a block is all expressions or all mappings (`docs/metrics.md:314-317`, `:735`) |
| `metric_error` on a report row naming two keys | A name written as both a group and a value (`f1` beside `f1.locate`). Refused at the **write**, after the Scenario ran and was billed, so that Scenario reports no metrics (`docs/metrics.md:120-127`) |
| `mcp check subject "…"` from preflight, exit 3 | An `environment:mcp-reachable` check naming a server the run declares nowhere. Correct `value:` to the declaration's document key, or declare the server (`docs/harness.md:1561`) |
| `binary "magmux" capabilities` from preflight | An interactive bench whose magmux `--help` does not list `--headless` or `--sock-dir`. Checked by capability, never by version (`docs/harness.md:1554`, `:1634-1650`) |
| `sandbox: level "process" was renamed to "home"` | A retired level. `process`→`home`, `machine`/`docker`→`container`. **Refused, not aliased**, as a load error |
| `unknown check type "<name>"` from **preflight** | typo'd `type:`, caught before any spend — **or a retired check spelling**: `trajectory:<verb>` and the bare `skill-used` now answer exactly this (measured on 0.37.0). Write `session:<verb>`. `list` does not construct checks, so it lists such a bench with exit 0 |
| `session:match: args.raw_type addresses one harness's own records, so the check must say which` | `raw_type`/`raw` without `args.harness:`. Add `harness: claude-code` — and the bench must run that harness, or preflight refuses with *declares harness "claude-code", but this bench runs "mock"* |
| `session:match: args.type "…" is not a madbench event type; the types are …` | A portable filter outside the closed vocabulary. The error lists the valid values; `checks-catalog.md` §8 has them too |
| `exec: 'value' is split on whitespace, not parsed by a shell, so quotes in it cannot work` | Shell syntax in an `exec` `value:`. Write `args: { cmd: [sh, -c, '<your command>'] }` (`docs/checks.md:1160-1182`) |
| `args.votes must be a positive odd integer, got 2` | A majority needs an odd count; `votes: 1` is the single call |
| `args.envelope was removed on 2026-09-22 — there is one envelope, madbench/v2` | Delete the argument, and make the grader read `session.events`, not `session.actions` (`docs/checks.md:1545-1554`) |
| `declares a driver: but harness "mock" cannot be driven` | Only `claude-code` reads a Driver. Remove the block, or run that Scenario on claude-code (`docs/driving-a-session.md:31-35`) |
| `declares a driver: but interactive: false` | `claude -p` disables every tool that needs terminal input, so the agent never asks. Remove `driver:` or set `interactive: true` |
| `declares both a driver: and harness_config.agent_env` | The binary still refuses this pairing on 0.37.0, saying `agent_env` loads no hooks and the Driver learns of a question from a hook. Drop one of the two. (Upstream's release notes say hooks now load under `agent_env`; for the Driver the binary has not followed) |
| `an interactive session is driven by typing into a terminal, and a picture cannot be typed` | An `image:` Scenario left interactive. Set `interactive: false` on it (`docs/harness.md:245-258`) |
| `claudecode: turn 1 blocked on AskUserQuestion, unanswered` | The agent asked and nothing answered — the Scenario declares `driver: false`, or no Driver could be built. Declare one, or answer it with `driver.answers:` (`docs/driving-a-session.md:67-79`) |
| `CONFOUNDED: runs differ in more than their instructions` | `guard_changes:` found a run differing by a path not in `allow:`. Read the printed diff — the undeclared file is your confound. Nothing ran, nothing was spent; exit 1 |
| an `allow:` entry that matched nothing | reported as the shape of a typo: `allow: [plugin]` loads clean and matches nothing |
| a stored report refused on read | written by a madbench before `schema_version: 2`. It is refused rather than decoded into a report with no Events (`docs/vocabulary.md:284-287`); re-run to regenerate it |
| `unknown assertion type: "llm-rubric"` (or any AI check name) | **Missing judge provider, not a typo.** With no `judges:` block and no `ANTHROPIC_API_KEY`, judge registration is skipped, so AI types fail exactly like misspelled ones. The message names the fix |
| run-start error about the default judge | `judges.default:` names a provider whose `api_key_env` is unset. Available providers are silently skipped, but an unavailable **explicit** default is an error |
| `grader ts: stat …: no such file or directory` | a check's `value: file://…` grader is missing; a relative `file://` resolves against the **bench file's** directory |
| `harness "mock" cannot deliver an image …` | only `claude-code` is `ImageCapable`. You cannot run — or `madbench check` — an `image:` bench under mock |
| `effort "hgih" is not a level the CLI accepts` | `harness_config.effort` is the one key checked by **value**. Use `low`·`medium`·`high`·`xhigh`·`max` |
| `follow_ups` rejected at load | `follow_ups:` with `interactive: false`. A `--print` run is a single pipe with no way back in |
| `generate:` refusal naming a value | the generated secret was findable in the workspace, prompt, or report. The expectation must be **derived** (sums, counts, checksums), not planted. If the answer IS a path, use `setup:` instead |
| both `setup:` and `generate:` declared | refused — both own the staged tree and both run before the workspace exists |
| `probe: false` with `require: true` | refused at load, naming both keys: "do not look" and "verify before spending" cannot both be true |
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
| The agent stopped to ask, and the Scenario errored at once | Not a hang: an `AskUserQuestion` with no Driver fails **by name** within seconds (`turn 1 blocked on AskUserQuestion, unanswered`). The default Driver answers it; `driver: false` is what switched it off. `runners-and-sandbox.md` §3 |
| Two runs of an A/B differ though the YAML is byte-identical | A model-answered question is a sampled second variable. Declare `driver.answers:` — a `match: "*"` catch-all makes the Driver a lookup table with no model — and assert it with `session:driver-source: scripted` (`docs/driving-a-session.md:334-388`) |
| A driven run "passed" but stopped early | It hit `max_turns`, which reads like a finished run. Add `session:end-reason` with `value: [script-complete, driver-done]` (`docs/checks.md:1792-1796`) |
| Every run bills the subscription though `ANTHROPIC_API_KEY` is set | By design: `use_subscription: optional`, the default, prefers this machine's Claude Code login and masks the key; preflight's header says so. Set `use_subscription: api_usage` (or `--use-subscription api_usage`) to bill the key (`docs/harness.md:1356`, `:1401-1404`) |
| Everything is much cheaper and thinner than expected | `interactive: false`. Measured on one greeting Scenario: $0.0114 / 127 tokens against $0.0316 / 25.4k interactive. A `--print` turn strips the system prompt and context a real session carries |
| The Scenario times out just past the bar | The default is **300s**, raised from 120s because 120 was calibrated for `--print`. A cold-start interactive turn can approach it. Declare your own `timeout:` |
| Bench passes even when the agent does nothing | Testdata not red. Run the exec command manually in the testdata dir — it must FAIL pre-run |
| Exec test check passes but the work looks wrong | Agent cheated (deleted or weakened the test). Add anti-cheat greps and `session:*` guards |
| `contains`/`regex` fails though the code is correct and on disk | String and structured checks read ONLY `Session.FinalOutput`, never files or tool output. Grade files with `exec` |
| `contains` fails though the marker plainly reached the agent — a hook's output, an injected file | `contains` grades whether the agent **repeated** it. Delivery is `session:match` on the Events (`docs/checks.md:318-323`); keep `contains` as a `readout:` if the echo matters |
| Text checks grade a status line like "I've launched a search agent…" | The run delegated. `Session.FinalOutput` now follows the answering thread when the parent ended its turn without receiving the result — if you still see this, the parent *did* receive it and chose to say that |
| `latency`/`cost` fail intermittently on healthy runs | Expectation too tight. Tighten only to 1.5–2× observed max |
| `session:step-count` refused at construction | It now **requires** a bound. `args.lte` / `args.gte` / `args.eq`; a range binds both ends. It also counts the **main thread only** — a subagent's work is in `Session.Subagents` |
| A `session:tool-used` bound fails though the totals look right | Counting is **per named tool, never aggregate**. `value: [Read, Grep]` with `gte: 2` means *each* at least twice |
| `session:tool-used` with `outcome: ok` fails on a call that plainly worked | **Unknown satisfies neither `ok` nor `error`**, and unknown is the majority state — a successful `Read` records no outcome at all. The reason says so: *"Read was called 3 time(s), none with a recorded outcome"*. Use `outcome: ok` only where the answer is knowable (Bash, Edit/Write) |
| `session:tool-used` with `value: Task` and `thread: main` is always false | A spawn row carries the **subagent's** thread, not the spawner's. Use `session:subagent-used` to ask who delegated |
| `session:tool-sequence` or `session:tool-args-match` never sees a skill or a spawn | Both read only `Calls`, which excludes `skill` and `subagent` Events. `session:tool-used` reads `Events` and unions `Calls`, so it does see them |
| `session:tool-args-match` on `AskUserQuestion` never matches, whatever you write | It cannot: the labels are nested under `questions[i].options[j]` and the matcher refuses a non-string value. Use `session:question-asked` (`docs/checks.md:1733-1744`) |
| `session:skill-used` never passes | It grades the **result** — an errored invocation fails and says so, rather than reporting "was not invoked". Under `harness_config.agent_env` upstream still says it can never fire, because `--bare` stopped advertising skills (`docs/harness.md:995-998`); but `--bare` was removed from `agent_env` on 2026-09-23 (`docs/harness.md:887-895`), and whether skills are now advertised there is **not verified on 0.37.0**. Measure it with one real run before relying on either answer; `plugins:` is the route that is known to advertise them |
| `session:tools-only` passes on a run that did nothing | A fence is a constraint, not a claim that anything happened. An empty scope satisfies it, and `madbench check` flags it under WRONGLY PASSED. Pair it with a `session:tool-used` carrying `gte:` — every check must be a positive assertion |
| CI stays green on a bench whose scenarios all failed | **A graded miss exits 0.** Add `--fail-on-failure` to exit 1 on a failed scenario; an errored scenario exits 1 either way (`docs/README.md:88-108`). The run's own last line says which: `exit 0: 1 scenario failed — scenario outcomes, not a harness crash` |
| A `--repeat` rate looks clean but some passes ran only seconds | Look at `.summary.errors` and the per-pass rows before believing the rate. A pass whose agent was refused (credit exhausted, revoked token) **never graded**, and a session that never graded is a fault, not a `fail` (`docs/README.md:90-96`). If refused passes appear as failures, that is a defect to draft upstream — never a number to publish |
| A `session:*` check fails on a path that is obviously right | The WorkDir is a per-run tmpdir, and macOS reports `/private/var/…` where the sandbox stored `/var/…`. Use `session:file-read` (which compares through `internal/hostpath`) or a `glob:`/`suffix:` matcher — never a hand-built absolute literal |
| A literal that starts with `glob:` / `suffix:` / `contains:` is misread | Those prefixes are now matchers. Write `exact:` in front to get the literal back |
| Every `environment:*` check ERRORs, or lands in NOT APPLICABLE | Nothing was captured. `harness_config.environment.probe` is false, or the harness reports no environment. Loud either way and never a pass: upstream's `harness.md` says ERROR (`docs/harness.md:1234-1236`); `madbench check` lands an unprobeable check outside the verdict (`docs/checks.md:903-905`). A pass would report success for the exact incident the family exists to end |
| `environment:mcp-reachable` errors on a name that is plainly declared | The check takes the **bench's** document key (`probe`), not the tool's `plugin:…:…` spelling; and it errors, never fails, on a name the preflight never recorded or recorded UNPROBED (`docs/checks.md:773-784`). A typo is caught at preflight, exit 3 (`docs/checks.md:786-792`) |
| `environment:mcp-connected` errors rather than failing | Only `system:init` reports a status, and only the `--print` drive path carries one. On the default interactive path the run never asked |
| `environment:command-registered` errors | `claude plugin details` prints no command heading — it folds `commands/*.md` into its own `Skills (N)` count. It needs a source other than `plugin-cli` |
| A staged plugin is missing and the scenario ERRORed before the agent ran | `harness_config.environment.require: true` refused it. That is a gate, not a grade: it did not score badly, it never ran |
| `assert-set` fails though most children pass | Its threshold defaults to 1.0 (all) — set a ratio like 0.66 |
| exec with pipes behaves oddly | No shell — `value:` is whitespace-split argv. Use `cmd: [sh, -c, '…']`. Quotes in `value:` are now refused at preflight rather than misbehaving |
| A judge-graded check flips between runs on the same output | One judge call is noisy. `args.votes: 3` takes the majority; the Score becomes the passing fraction (`docs/checks.md:1399-1427`) |
| ts/js/python check cannot find deps | Deps resolve from the nearest `package.json`/`pyproject.toml` root; add a lockfile or set `defaults.bun`/`defaults.python` |
| Score looks inverted (high toxicity = high score?) | Contract: Score is normalized [0,1], higher-is-better. Raw risk is in `Evidence` under `raw_toxicity` and friends |
| A check you meant as a measurement is failing the Scenario | Give it `readout: true`. It still runs, scores and reports, and its named score still reaches `metrics:` — it just cannot fail the Scenario. An **erroring** readout still stops it, as an error rather than a fail |
| A bench written from `madbench init` does not load | Measured on 0.37.0: `init` still scaffolds `runner:`, `cases:` and `assert:`, which the same binary refuses. Rename them, or start from `examples/` |

## The two controls

A bench that passes tells you nothing until you know it *can* fail, and that its verdicts are
reproducible.

### `madbench check` — the negative control

```bash
madbench check bench.yaml
```

The mock harness echoes the prompt and does nothing else, so every graded check must fail.
**The exit code was never the control — the per-check tally is.** A bare run under mock
exits 0 on a graded miss, and even with `--fail-on-failure` it goes nonzero once *any*
Scenario fails, so the obvious wrapper ("run under mock, assert non-zero exit") reports a
healthy control while any number of checks sail through: 9-fail-1-pass and 10-fail give the
identical exit code. `madbench check` is the tool that counts per (Scenario, Check) pair;
do not write a tally parser beside it.

Four buckets, deliberately kept apart (`madbench help check`):

| Bucket | Meaning |
|---|---|
| **failed as required** | the check graded, and it failed — the control holding |
| **WRONGLY PASSED** | the check graded and passed against a harness that did nothing. It is grading nothing |
| **ERRORED** / **COULD NOT GRADE** | the check graded nothing at all, so it demonstrated neither soundness nor rot |
| **NOT APPLICABLE UNDER MOCK** | `latency`, `cost`, and `environment:mcp-reachable` — excluded from the verdict entirely |

**Errored ≠ failed**, and folding the two together is how a broken control looks healthy.

Exit codes: **0** = the control holds (every gradable check was graded, and every one
failed) · **1** = a check wrongly passed, or a check or Scenario could not be graded at all ·
**3** = nothing gradable was found. Measured on the installed binary, a holding control:

```
  2/2 checks failed as required · 0 errored (could not grade) · 0 wrongly passed

  control holds: every check was graded, and none passed against a harness that did nothing.
```

and a fence with no activity partner, exit 1:

```
  0/1 checks failed as required · 0 errored (could not grade) · 1 wrongly passed

  WRONGLY PASSED (1) — these checks grade nothing:
    fence-only · session:tools-only
      score 1.00 · session:tools-only: no tool call in scope — nothing to check
```

**Every check is a positive assertion.** A fence, an absence assertion (`not-any-of`) or an
anti-cheat invariant passes against a do-nothing mock by construction, and the control names
it `WRONGLY PASSED`. Only `latency` and `cost` are exempt. Express every intent as the
presence of the wanted behaviour and pair every fence with an activity check. That
absence-assertion gap is a real limitation and is drafted in
`docs/madbench-issues/2026-08-22-negative-control-vs-absence-checks.md`; until it lands
upstream, the shape of the bench bends, not the control.

**Two benches it cannot control.** An `image:` bench — the mock is not `ImageCapable`, so
`check` refuses with *harness "mock" cannot deliver an image*. And any bench at `sandbox:
none` unless you pass `--allow-host-writes`: the mock writes nothing, but the **checks run for
real**, and at level `none` an `exec` check is a command executed in the directory you are
sitting in.

### `latency` and `cost` are exempt, and a count ceiling is not

`latency` and `cost` guard the **budget**, not the behavior. A run that did nothing spent
nothing and took no time, so `cost $0.00 ≤ $0.04` is the *correct* verdict under mock. They
are reported NOT APPLICABLE and left out. A bench declaring nothing else exits **3**
(`0 gradable checks`) rather than reporting a holding control (`docs/checks.md:229-237`).

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
Event stream**, and the mock produces that stream — an honest, empty one. Zero steps is a real
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
non-deterministic verdict cannot be a control). A check whose re-grade errors is reported as
"could not re-grade", never as reproduced.

It takes both on-disk shapes — the bare `--report-json` file, and the stored envelope from
`--report-dir` by path or by run id (`madbench help grade`); a stored envelope's Sessions are
read back from the bench logs beside it (`docs/comparing-runs.md:428-431`). A report written
by a madbench older than `schema_version: 2` is refused rather than re-graded against an empty
Session (`docs/vocabulary.md:284-287`).

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
| run tally | `.summary` → `{total, passed, failed, errors, skipped}` — **read `errors` before `failed`**: an errored row never graded |
| the guard's per-run diff (Eval with `guard_changes:`) | `.guard_changes` → `{baseline, allow, declared, runs[]}`, each run with `files[]` (`path`, `change`, `delta`, `declared`) — measured on 0.37.0 |
| the report's format version | `.schema_version` — `2` on 0.37.0; an older report is refused on read |
| the metric declaration, echoed | `.metric_specs` and `.schema_version` — a stored report is self-describing (`docs/metrics.md:716-718`) |
| a metric expression that threw at run time | `metric_error` on the row and on the report; the run is not failed by it (`docs/metrics.md:737-739`) |
| per-Scenario and per-run metric values | the `metrics` map on each Scenario row and each run; `value: null` means nothing reported, never `0` (`docs/metrics.md:582-599`) |
| `--repeat` passes | the `MultiRunReport` envelope carries every pass's rows plus `aggregate.chosenPass`; the kept pass is the medoid, never a synthesized median (`docs/metrics.md:557-580`) |

**`events` is the authoritative stream** — every message, tool call, hook, reminder, setting
and subagent lifecycle row, in order, each with `seq`, `category`, `type`, `source` and
`text`, plus the harness's `raw_type` and whole `raw` record. It was `actions`, with `kind`
and `message`, before 0.37.0; a query still reading those keys returns nothing, silently.
**`calls` is the lossy derived view**: only `tool_call` and `mcp_call` Events survive it, and
skill invocations, subagent spawns and attachments are all excluded. Reach for `events` when
you need the whole picture; a question that comes back empty from `calls` is usually a
question that should have been asked of `events`.

Both carry the recorded outcome per call: `tool_call_id`, `result_ok` (**tri-state — absent
means the capture said nothing, never failure**), `result_tag`.

`reason` on exec failures embeds the tail of the combined output — read it first.

```bash
jq -c '.results[].checks[] | select(.result.pass==false) | {type, reason: .result.reason}' out.json
jq -c '.results[].session.metrics' out.json                 # observed cost/latency for tuning
jq -c '[.results[].session.calls[]?.name] | group_by(.) | map({tool: .[0], n: length})' out.json
jq -c '.results[].session.events[]? | select(.type=="skill")' out.json      # skill invokes
jq -c '.results[].session.events[]? | select(.type=="subagent")' out.json   # spawns
jq -c '[.results[].session.events[]?.type] | group_by(.) | map({type: .[0], n: length})' out.json
jq -c '.results[].session.environment.reported.plugins[]?' out.json          # what loaded
jq -c '.results[].checks[] | select(.result.evidence.outcome_census)' out.json
```

### Under `--report-dir`: the report and its bench logs

`--report-dir <dir>` writes **two kinds of file** per invocation, flat, beside each other:
the report `<run-id>.json`, and one **bench log** per bench,
`<run-id>-bench-<slug>.log.json`, which holds every Session that bench produced, entire. The
stored report carries scores, checks and metrics but **no Session**: each row names its log in
`session_log` and its key in `session_ref`. Measured on 0.37.0 with `madbench demo
--report-dir`:

```bash
jq -c '.report.results[] | {scenario_id, session_ref, session_log}' <dir>/<run-id>.json
jq -c '.sessions | keys' <dir>/<run-id>-bench-<slug>.log.json
jq -c '.sessions["<session_ref>"].events[] | {seq, type, text}' <dir>/<run-id>-bench-<slug>.log.json
```

The stored file is an envelope — the report itself is under `.report`, beside `run_id` and
`complete`. A plain `--report-json` file keeps the Session inline under
`.results[].session`, as above. Upstream documents the split only in passing — "the stored
bench log" (`docs/vocabulary.md:723`) and reports restored "from the bench logs beside it"
(`docs/comparing-runs.md:428-431`) — so read the keys off a real file with `jq 'keys'`
before scripting against them. `madbench report show` and `madbench grade` put the Sessions
back for you.

Verify the agent took the path you think it took before blaming a check. If a query returns
null, dump the shape with `jq 'keys' out.json` and adapt.

## Expectation-tuning procedure

1. Run 2–3 times: `madbench bench.yaml --report-json run$N.json` (or `--repeat 3`).
2. Collect observed `cost`/`latency` from `session.metrics`.
3. Set thresholds at ~1.5–2× the observed max — bound pathological behavior, don't fit one sample.
4. A crossing on a healthy run means raise the Expectation; never re-roll to green.

Keep a versioned history with `--report-dir .reports`, then `madbench report ls`,
`madbench report show <run-id>`, `madbench report compare a b` and `madbench report history`
(each metric's trend across invocations) instead of hand-diffing JSON (`madbench help
report`). There is no `report trend` or `report list` subcommand.

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
  `defaultScenario`, `session:*` check types, `guard_changes:`/`allow:` on an Eval. The old
  spellings no longer load at all: keys are refused at load, check types at preflight
  (table in `schema.md` §1).
- A driven Scenario's answers declared with `driver.answers:` when the answer is not the
  thing under test, and `session:end-reason` beside any `max_turns` that matters.
- "Did it reach the model" graded with `session:match`, not `contains`.
- A valid sandbox level, spelled under `level:`.
- Expectations backed by observed runs.
- A negative control run as `madbench check` — per check, not by exit code. `latency`/`cost`
  land in NOT APPLICABLE, which is correct and expected. Every other check is a positive
  assertion, and every fence has an activity partner.
- The verdicts reproduce: `madbench grade` on a stored report from a real run.
- Session checks asking the **narrowest true question**: `args.thread: main` where the claim is
  about the agent under test, `args.outcome: ok` where success is knowable and matters,
  `session:file-read` instead of a sentinel token injected into the thing being measured.
- Measurements marked `readout: true` rather than gating the Scenario.
- `metric:` names on every check whose score a `metrics:` expression reads, and arithmetic
  that outgrew one line living in the bench's `module/` — not in a sibling script that reads
  the report (`schema.md` §8).
- **If a reader needs a comment to trust a number, that comment is a check you have not
  written yet.** A code comment saying "the plumbing was verified out of band" is a
  `environment:mcp-reachable` or `environment:matches-expected` row that should be in the
  bench, asserted before any spend.
- CI invoked with `--fail-on-failure` if a miss is meant to go red; otherwise a graded miss
  exits 0 by design.
- Don't rely on Scenario-level `threshold:` as a gate — it is parsed for promptfoo
  compatibility and **never evaluated**. Gate with per-check `threshold:` or an `assert-set`.
