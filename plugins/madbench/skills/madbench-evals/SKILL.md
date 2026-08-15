---
name: madbench-evals
description: Authors, runs, and debugs madbench evals — bench YAML, checks, red-state testdata, expectation tuning. Use when creating or reviewing a madbench.yaml, choosing checks, or debugging a failing bench.
user-invocable: false
---

# madbench Evals — author, run, debug

madbench is a Go harness that benchmarks agentic coding tools (Claude Code, etc.).
You write a **bench file** (`madbench.yaml` / `*.madbench.yaml`), point it at a harness
and model, give it scenarios with seeded testdata, and grade the agent's work with checks.

Reference files (read on demand, not upfront):
- `schema.md` — full bench YAML schema, every field, aliases, case-directory format
- `checks-catalog.md` — every check type by family with params and examples
- `runners-and-sandbox.md` — harness configs, permission modes, sandbox, env
- `debugging.md` — error→cause map, report-JSON analysis, expectation tuning

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

## Before you write YAML — the five silent killers

Bench files are decoded **leniently**: an unknown key is dropped without a word,
and `madbench list` validates almost nothing (it checks YAML shape and the bench/
scenario names — not check types, not sandbox levels, not testdata paths). So a
typo does not fail loudly; it changes what runs. These five cost whole sessions:

| Write this | Not this | What actually happens |
|---|---|---|
| `prompt:` | `input:` | There is **no `input:` alias**. It is silently dropped and the agent runs with an **EMPTY prompt — and you get billed.** This caused 4 errored sessions in one audit. |
| `config:` | `args:` (on `ts`/`js`/`python`) | Those script shims bind `config` as a parameter (`config = assertion.get("config")`). `args` is only reachable as `assertion.args` — your config silently never arrives. |
| `timeout: 600s` | `timeout: 600` or `"600"` | `timeout:` is a **duration string**. Both bare-int and quoted-int decode to `"600"`, `time.ParseDuration` rejects it, and the timeout **silently falls back to the 120s default** — no error either way. |
| `description:` | `name:` (at bench top level) | A bench has **no top-level `name:` key** — the bench's name *is* its `description:`. A stray `name:` is dropped silently. (`name:` **is** valid one level down, on a scenario.) |
| `sandbox: {level: …}` | `sandbox: {mode: …}` | There is **no `mode:` key**. `sandbox: {mode: container}` is dropped, **passes `preflight` clean**, and runs at the default `home` level — you believe you are containerized and you are not. A silent *isolation downgrade*. |

Verify with `madbench preflight` (see Step 5) — it catches far more than `list` does.
But note the last row: preflight cannot flag a key that does not exist, so lenient
decoding is still your problem. Grep your own file for these five before you spend.

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
`runs:` entries. Details + bench-side `params:`/`{{name}}`
placeholders: `schema.md`.

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
   `session:*` (did it use Write/Edit?), string/structured Logic matchers.
   Deterministic, free, fast.
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
  assert:
    - { type: session:tool-used, value: "Write" }
    - { type: session:tool-used, value: "Edit" }
```

Combine with composites (`assert-set` weighted ratio, `any-of`, `select-best`,
`compare`) — children nest under `assert:`, `weight:` defaults to 1.0. Full catalog
and params: `checks-catalog.md`.

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
madbench preflight bench.yaml                   # proves it COULD RUN — always do this
madbench demo                                   # offline emulated bench: no keys, no spend
madbench bench.yaml --harness mock              # dry-run your YAML offline
madbench run bench.yaml --report-json out.json  # the real run
madbench run bench.yaml --ui                    # live TUI dashboard
madbench bench.yaml --repeat 5                  # flake detection (bypasses --ui)
madbench bench.yaml --param model=opus-4.8      # override a declared bench param
madbench my-models.eval.yaml                    # Eval file: runs the bench per runs: entry
```

**`list` proves a file parses; `preflight` proves it could run.** Do not use `list` as
your pre-run check — it gives a confident exit 0 on a bench that cannot start, which is
a false all-clear on exactly the errors you most want caught. A file with a retired
`sandbox: process` level lists happily and then refuses to run.

**So: `madbench preflight` before every real run.** It checks every harness binary, API
key, runtime and daemon the run needs, *and* resolves sandbox levels and `testdata:`
paths — so it catches a stale testdata directory or a retired sandbox level before
you spend a cent. `list` catches none of that:

| | `list` | `preflight` | real run |
|---|---|---|---|
| YAML parses, bench + scenario names | yes | yes | yes |
| Retired `sandbox:` level | **no** | yes | yes |
| Missing `testdata:` directory | **no** | yes | yes |
| Harness binary / API key present | **no** | yes | yes |
| Unknown check `type:` | **no** | **no** | yes (at evaluate time) |

An unknown check `type` still fails only at **run** time
(`unknown string assertion: <name>`), so do one real run — or one `--harness mock`
run — before shipping. Exit code is non-zero if anything failed or errored.

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
1. **Runs at all?** `madbench list`, then one real run.
2. **Permission mode** matches what scenarios require (write → `acceptEdits`+).
3. **Red-state testdata** — would a no-op agent fail this bench?
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
- **`session:*` checks do not all read the same thing**, and picking the wrong one is
  why `skill-used` can never pass today. See the table in `checks-catalog.md` before
  choosing one.
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
