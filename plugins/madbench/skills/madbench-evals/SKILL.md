---
name: madbench-evals
description: Authors, runs, and debugs madbench evals — bench YAML, checks, red-state testdata, the two controls (check / grade), expectation tuning. Use when writing or reviewing a madbench.yaml or Eval file, choosing checks, or debugging a failing bench.
user-invocable: false
---

# madbench Evals — author, run, debug

madbench is a Go harness that benchmarks agentic coding tools (Claude Code, etc.).
You write a **bench file** (`madbench.yaml` / `*.madbench.yaml`), point it at a harness
and model, give it scenarios with seeded testdata, and grade the agent's work with checks.

Reference files (read on demand, not upfront):
- `schema.md` — full bench YAML schema, every field, aliases, case-directory format,
  plus `image:` · `generate:` · the Eval file and its `control:` block
- `checks-catalog.md` — every check type by family with params and examples, incl.
  thread/agent scoping, path matchers, and `model:current`
- `runners-and-sandbox.md` — harness configs, permission modes, sandbox, env,
  `agent_env:` vs `plugins:`, and the full CLI
- `debugging.md` — error→cause map, the two controls, report-JSON analysis,
  expectation tuning

## Step 0 — check what you actually have

madbench's identifiers change. Before you trust anything below, find out which
build you are about to run:

```bash
go version -m "$(command -v madbench)" | grep vcs.revision
```

**A conclusion drawn from source you did not build is a conclusion about a
different program.** Reading `main` in the madbench checkout tells you what the
*next* release does, not what the binary on your PATH does. This is not
hypothetical: an audit once read the renamed `session:*` checks in `main` while
running a binary built eight days before the rename, and every conclusion it
drew about check behavior was about a program that was not running.

If the revision is older than a rename you are relying on, rebuild:
`cd <madbench repo> && go build -o /tmp/mb ./cmd/madbench` and use `/tmp/mb`.

## Before you write YAML — what strict decoding catches, and the two it cannot

**Bench files are strictly decoded (since v0.10.0).** An unknown key is a hard load
error naming the file, line and type — the same treatment Eval files always had. Three
of the five typos that used to cost whole sessions now cost a second:

```
Error: loading bench.yaml: parsing bench.yaml: yaml: unmarshal errors:
  line 5: field input not found in type madbench.ScenarioSpec
```

| You wrote | Now |
|---|---|
| `input:` instead of `prompt:` | **load error** — `field input not found in type madbench.ScenarioSpec`. It used to be dropped silently and run the agent with an EMPTY prompt, billing you (4 errored sessions in one audit). |
| top-level `name:` instead of `description:` | **load error** — `field name not found in type madbench.BenchSpec`. (`name:` **is** valid one level down, on a scenario.) |
| `sandbox: {mode: …}` instead of `{level: …}` | **load error** — `field mode not found in type madbench.sandboxYAML`. It used to pass preflight clean and run at the default `home` level — a silent *isolation downgrade*. |

**Two are still silent, and knowing *why* tells you where else to look.**

| Write this | Not this | Why it still slips through |
|---|---|---|
| `timeout: 600s` | `timeout: 600` or `"600"` | The field's **type is `string`**, so `600` decodes fine — strict decoding checks key names, not value semantics. `time.ParseDuration` then rejects `"600"` and the timeout **silently falls back to 120s**. Always write a unit. |
| `config:` | `args:` (on `ts`/`js`/`python`) | `args:` is a **real field** on a check spec — it is the right key for `exec`, `session:*` and most others. On the script shims it is simply the wrong one: they bind `config` as a parameter, so your config arrives as `assertion.args` and nothing reads it. |

**And strict decoding stops at the `harness_config:` boundary.** That key is an untyped
map handed to the harness, so nothing validates inside it:

```yaml
harness_config:
  model: claude-haiku-4-5-20251001
  temperature: 0.2        # ← loads clean, preflights clean, is NEVER read
```

`claude-code` reads exactly six keys — `binary`, `model`, `system_prompt`, `args`,
`agent_env`, `plugins` — and ignores everything else without a word. There is no
`temperature` key (pass CLI flags through `args:`, and only if your installed `claude`
accepts them). So: trust the loader for the bench structure, and read
`runners-and-sandbox.md` for what the harness actually consumes.

## Vocabulary (use these words)

The code speaks the dictionary. **Eval** (eval file — runs the same Bench across a
list of param sets) → **Bench** = `madbench.BenchSpec` → **Scenario** =
`madbench.ScenarioSpec` → **Check** = `check.Spec` (declarative) graded by a
`check.Check`. A **Harness** (`harness.Harness`) + **Model** run the scenario,
producing a **Session** (`harness.Session`) made of **Action**s (`harness.Action`).
An **Expectation** is a `threshold:`; a **Result** (`check.Result`) carries
`{Pass, Score, Reason, Evidence}`.

`…Spec` = the declarative YAML form; the bare word is the live configured component.
The pre-rename type names `Suite`, `Case`, `Runner` and `Event` **no longer exist** —
don't grep for them.

Say **testdata**, never "fixture" (`fixture:` is a legacy alias only).
Check kinds by what powers them: **Logic** (builtin matchers), **AI** (LLM judge),
**Code** (your script in a sandbox), **Service** (external API).

**The `session:*` rename (2026-08-07).** The checks that grade what the agent DID
are spelled **`session:*`**. The old `trajectory:*` spelling is kept as an
accepted alias so existing bench files keep loading — which is exactly why the
staleness went unnoticed for so long: **the breakage is one-directional.** An old
file runs fine on a new binary, so nothing complains; only a human reading old
docs is misled. Say **Session**, write `session:` — never author `trajectory:` in
a new file.

**Eval files are RUNNABLE** (`docs/eval-file.md`): `bench:` + `models:` + `runs:` list —
each entry one full bench run overriding only the params it changes. **There is no
cross-product** — a `matrix:` key does not exist and strict decoding rejects it (as it
does any unknown top-level key). To run across several models/params, write explicit
`runs:` entries. Add **`control:`** to declare what those runs may differ by: madbench
diffs every run against the baseline before any spend and stops a confounded pair,
which is the difference between an A/B and two runs that happen to disagree. Details +
bench-side `params:`/`{{name}}` placeholders: `schema.md`.

## The scoring contract

Every check returns `Score` in **[0,1] where higher is always better** — even for
lower-is-better metrics (latency, cost, toxicity). Raw values belong in `Evidence`,
never in the primary score. Name a score with `metric:` (defaults to the check `type`).

At the case level there is **no partial credit**: a Scenario passes iff every
top-level check passes (composites count as one check — put partial credit INSIDE an
`assert-set`). Case-level `threshold:` is parsed but not enforced (v1).

## Workflow: creating a bench

### 1. Design — copy the nearest example

Don't start from a blank file. In the madbench repo, `examples/` has one template per
task shape — copy the closest and adapt:

| Task shape | Example |
|---|---|
| Write code from scratch | `codegen-fizzbuzz` |
| Fix a bug in place | `bugfix-add` |
| Multi-file refactor | `refactor-rename` |
| Read-only Q&A over code | `qa-callgraph` |
| Offline / no API key | `hello-claude` (mock runner) |
| Custom ts/js/python checks | `managed-runtimes` |
| Compare providers side-by-side | `magmux-compare` |

### 2. Scaffold testdata in red state

`testdata:` is a directory copied fresh into the sandbox for each scenario. Seed it
**red**: a failing test, a missing symbol, a bug — so the agent must do real work and a
no-op run fails. Keep it small (<10 files). Before wiring checks, verify the red state
manually (run the exec command yourself in the testdata dir and confirm it fails);
otherwise a green-from-the-start bench proves nothing.

### 3. Choose checks — deterministic first

Order of preference:
1. **Deterministic** — `exec` (run the tests! Code-kind, builtin-implemented),
   `session:*` (did it use Write/Edit? read that file? invoke that skill? spawn that
   subagent?), string/structured Logic matchers. Deterministic, free, fast.
2. **AI** (`llm-rubric`, `factuality`, …) — only for genuine judgment calls (explanation
   quality, tone). Needs `ANTHROPIC_API_KEY`; default threshold 0.7.
3. **Code** (`ts`/`js`/`python`, `custom:wasm`, `custom:exec`) — custom logic beyond
   builtins.
4. **Service** (`custom:http`) — external graders.

Always add **anti-cheat guards**: an agent can pass `go test` by deleting the test.
Pair the main exec with greps that pin down the honest path, e.g.

```yaml
- type: exec
  args: { cmd: [go, test, ./...], expected_exit: 0 }
- type: exec        # anti-cheat: test file still contains its cases
  args: { cmd: [sh, -c, 'test "$(grep -c "\"FizzBuzz\"" fizzbuzz_test.go)" -ge 4'] }
- type: any-of      # agent actually edited, didn't just talk
  checks:
    - { type: session:tool-used, value: "Write" }
    - { type: session:tool-used, value: "Edit" }
```

Combine with composites (`assert-set` weighted ratio, `any-of`, `select-best`,
`compare`) — children nest under `checks:` (`assert:` is the alias), `weight:`
defaults to 1.0. Full catalog
and params: `checks-catalog.md`.

### 3b. Four keys that widened what a bench can ask (v0.10.0)

Each one closes a gap benches used to hand-roll. Full shapes in `schema.md`;
`runners-and-sandbox.md` covers the harness half.

| Key | Where | Asks |
|---|---|---|
| `image:` | Scenario | *answer about this picture* — paths delivered in the same first user message as the prompt, so they are seen before the agent does anything. Not testdata: `testdata:` seeds the tree and grades whether the agent opened a file. `claude-code` only. |
| `generate:` | Scenario | *solve this, don't grep it* — a program run once per run, before the workspace exists. Its stdout `NAME=VALUE` lines reach the **grader** as check vars; madbench then **refuses the run** if any of those values is findable in the workspace, in the prompt, or in the report. |
| `plugins:` | `harness_config` | *run against this plugin registry* — stages a user-scoped registry the CLI discovers on its own, instead of hand-writing `known_marketplaces.json`. Composes with `agent_env:`. |
| `control:` | **Eval file** | *what may these runs differ by* — declares the varying paths; madbench diffs every run against the baseline before any spend and **stops a confounded pair**, reporting the per-run diff and size delta. |

Two consequences worth internalising before you reach for `generate:`:

- **The expectation must be derived, not planted.** "Find the row where…" fails the leak
  assertion, because the answer is literally in the file. Sums, counts and checksums pass
  — computing them *is* the task.
- **Per-run means per Eval `runs:` entry.** `--repeat N` deliberately reuses one staged
  tree, so a repeat re-measures the *same* task and the spread it reports is the agent's,
  not the data's.

### 4. Configure the runner — permission mode is the #1 gotcha

For `runner: claude-code`, the agent runs in `--print` (non-interactive) mode where
**un-approved tool calls silently no-op**. Match the permission mode to what the
scenario needs:

```yaml
runner_config:
  model: LATEST_HAIKU_MODEL
  args: ["--permission-mode", "acceptEdits"]   # agent writes/edits files
  # bypassPermissions — agent also runs commands (go test, npm…)
  # (omit) default    — read-only benches only
```

Symptom of a wrong mode: the transcript ends with "please approve…" and files never
change while the agent claims success. Use `runner: mock` for offline YAML development.
Details and magmux multi-provider config: `runners-and-sandbox.md`.

### 5. Validate, then run

```bash
madbench list bench.yaml                        # proves it PARSES — not that it runs
madbench preflight bench.yaml                   # proves it COULD RUN
madbench check bench.yaml                       # NEGATIVE control: every cell must fail
madbench demo                                   # offline emulated bench: no keys, no spend
madbench bench.yaml --harness mock              # dry-run your YAML offline
madbench bench.yaml --report-json out.json      # the real run (bare command IS run)
madbench bench.yaml --ui                        # live TUI dashboard
madbench grade out.json                         # POSITIVE control: re-grade offline
madbench bench.yaml --repeat 5                  # flake detection (bypasses --ui)
madbench bench.yaml --param model=opus-4.8      # override a declared bench param
madbench my-models.eval.yaml                    # Eval file: runs the bench per runs: entry
```

**Preflight is automatic.** Every run preflights first and refuses to start if anything
blocks (`preflight: nothing was run, no spend`). `--skip-preflight` opts out. Running
`madbench preflight` by hand is still worth it while authoring — it is the fastest way
to see the whole dependency picture without committing to a run.

**`list` proves a file parses; `preflight` proves it could run.** Never use `list` as
your gate — it gives a confident exit 0 on a bench that cannot start:

| | `list` | `preflight` | real run |
|---|---|---|---|
| YAML parses, unknown keys, bench + scenario names | yes | yes | yes |
| Retired `sandbox:` level | **no** | yes | yes |
| Missing `testdata:` directory | **no** | yes | yes |
| Harness binary / API key present | **no** | yes | yes |
| **Unknown check `type:`** | **no** | **yes** | yes |
| **Missing `file://` grader file** | **no** | **yes** | yes |
| **`image:` missing / wrong format / harness can't carry it** | **no** | **yes** | yes |
| A check that grades nothing | no | no | no — use `madbench check` |

The last two preflight rows are newer than most bench files. A check whose `value:
file://…` grader had been deleted used to preflight clean and fail at grading time, and
an unknown check `type:` used to survive until evaluate time — both are blocking now.

**The two controls.** Preflight asks *can this run*; the controls ask *does this bench
measure anything*:

- **`madbench check`** runs under the mock harness and requires **every cell to fail**,
  reporting a **per-cell tally** — a cell that passes against a harness that did nothing
  is grading nothing. Exit 0 = control holds, 1 = a cell wrongly passed or could not be
  graded, 3 = nothing graded.
- **`madbench grade <report.json>`** re-grades a recorded Session offline — no harness,
  no sandbox, no spend — and checks every verdict reproduces. It re-runs the evaluators
  against the stored Session; it does not replay stored verdicts, so a bench whose
  grading is non-deterministic shows up as DIVERGED.

`madbench demo` runs a built-in four-scenario bench against an offline harness that
emulates a real agent: no network, no API keys, no spend. Use it to see what a
healthy report looks like before trusting your own.

### 6. Tune expectations from data, not vibes

Cost/latency vary run to run (~2.6× cost variance observed). Start generous
(`cost` threshold 0.10 USD, `latency` 60000 ms), run 2–3 times, then tighten to
~1.5–2× the observed max. If a healthy run crosses the bar, raise the Expectation —
don't re-roll. Read `results[].checks[].result.{pass,score,evidence,reason}` and
`results[].session.{metrics,actions,calls}` from the report JSON — `actions` is the
authoritative event stream, `calls` its lossy tool-call view. Full key map in
`debugging.md`; read the names off it rather than guessing.

## Workflow: reviewing an existing bench

Check, in order:
1. **Runs at all?** `madbench preflight` (not `list`), then `madbench check`.
2. **Permission mode** matches what scenarios require (write → `acceptEdits`+).
3. **Red-state testdata** — would a no-op agent fail this bench? `madbench check`
   answers this per cell; do not eyeball it.
4. **Deterministic core** — at least one Logic check; AI judges only where judgment is
   genuinely needed (a bench graded only by `llm-rubric` is flaky and expensive).
5. **Anti-cheat guards** present for exec-graded work.
6. **Legacy aliases** → suggest the canonical spelling. Canonical is
   `harness:`/`harness_config:`/`scenarios:`/`checks:`/`testdata:`/`defaultScenario:`;
   `runner:`/`runner_config:`/`cases:`/`tests:`/`assert:`/`fixture:`/`defaultCase:`/
   `defaultTest:` all still load as aliases. So does `trajectory:*` — rewrite it to
   `session:*`.
7. **Sandbox level** is one of `none | workspace | home | container` (default `home`).
   A bench still saying `sandbox: process` does not load at all — see below.
8. **Expectations** neither vacuous (never fail) nor overfit to one run.

## Gotchas that bite

- **Sandbox levels are `none | workspace | home | container`, default `home`.** They
  answer one question: *what does the run get its own copy of?* The retired spellings
  `process` (→ `home`), `machine` and `docker` (both → `container`) are **REFUSED, not
  aliased** — `sandbox: level "process" was renamed to "home"`. Only `container`
  confines a process; the three local levels arrange state. Details:
  `runners-and-sandbox.md`.
- `session:step-count` bounds go in `args.lte:` / `args.gte:` — `threshold:` means
  exact match here.
- **`session:*` checks do not all read the same thing** — some read the authoritative
  `Actions` stream, some the lossy derived `Calls` view. See the table in
  `checks-catalog.md` before choosing one. (`session:skill-used` was broken by exactly
  this and **works as of v0.10.0** — it reads `Actions` now.)
- **`session:step-count` counts the MAIN thread only**, on both capture paths. Before
  v0.10.0 the on-disk path folded a subagent's calls in while stream-json did not, so
  the same bench meant different things depending on how it was captured. If you want a
  subagent's work counted, scope a `session:tool-used` with `args.thread:` instead.
- **`latency` and `cost` ERROR when the harness reported no metrics** — they no longer
  score a perfect 1.00 on absent data. Under `--harness mock` they error rather than
  pass, which is why `madbench check` reports them as "could not grade" instead of
  counting them.
- **An `image:` bench cannot be negative-controlled**, because the mock harness is not
  `ImageCapable`: `madbench check` refuses with *harness "mock" cannot deliver an image*.
  Grade the rest of the bench under mock and keep the image cell's proof to a real run.
- `assert-set` threshold defaults to **1.0** (all children must pass); set e.g. `0.66`
  for 2-of-3.
- `exec` has no shell: `value:` is whitespace-split. Use `cmd: [sh, -c, '…']` for
  pipes/quoting, `args.cwd:` for subdirs.
- `latency` threshold is **milliseconds**; `cost` is **USD**; `levenshtein` threshold is
  max edit distance (lower bar = stricter).
- `budget:` and `token_estimate:` are informational gauges only — **not enforced**.
- Running across models/configs: `providers:` fan-out only varies config under `runner: magmux`
  — under `claude-code` every provider row runs the same model. And `temperature` is
  not a claude-code `runner_config` key (CLI `args:` passthrough only). To vary model/config
  today: an Eval file with explicit `runs:` entries (schema.md).
- No judge provider (no `judges:` block AND no `ANTHROPIC_API_KEY`) → AI check types
  are never registered, so they fail as `unknown assertion type: "llm-rubric"` —
  indistinguishable from a typo. Check judge config before checking your spelling.
  Multi-provider judges via the `judges:` block in **modelspec notation** — short
  form (`opus-4.8`, `deepseek/deepseek-chat`; 10 providers with built-in endpoints +
  conventional key envs) or long form (`{transport, endpoint, model, api_key_env,
  params}`); per-check `args: {judge, model, temperature, max_tokens}`. See
  checks-catalog.md.
- String checks (`contains`, `regex`, …) grade ONLY the agent's final message, never
  files on disk — grade files with `exec`.
- `file://` script checks resolve relative to the YAML's directory; managed runtimes pin
  via `defaults.bun:` / `defaults.python:`.
- A scenario can also be a **case directory** (`assert.yaml` + optional `input.md`,
  `setup.sh`, `expected/`) — discovered when a dir is passed to `madbench`.

When debugging a failing or misbehaving bench, read `debugging.md` for the
error-message → cause map and report-analysis recipes.
