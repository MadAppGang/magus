# Bench and Eval file schema

Reference for `madbench:madbench-evals`. Every key of a bench file and an Eval file, its type
and its default. Mirrors madbench **v0.23.0** (`pkg/madbench/benchspec.go`).

**Both file kinds are strictly decoded at every nesting level** — scenario, check and sandbox
block alike. An unknown key is a hard load error naming the file, line and type:

```
Error: loading bench.yaml: parsing bench.yaml: yaml: unmarshal errors:
  line 5: field input not found in type madbench.ScenarioSpec
```

---

## 1. Bench file — top level

```yaml
description: "what this bench measures"
harness: claude-code
harness_config: {…}          # see runners-and-sandbox.md
models: {fast: haiku-4.5}    # named model definitions (modelspec union)
params: {model: fast}        # the bench's interface — declared names + defaults
judges: {…}                  # judge providers for AI checks
metrics: [{…}]               # the report's numeric schema
derivedMetrics: [{…}]        # JS expressions over named scores
defaults: {…}                # scenario-level defaults
defaultScenario: {…}         # a whole ScenarioSpec merged into every scenario
budget: 1.50                 # informational gauge only — NOT enforced
token_estimate: 200000       # informational gauge only — NOT enforced
scenarios: [{…}]
```

| Key | Type | Notes |
|---|---|---|
| `description` | string | shown as the bench name in reports |
| `harness` | string | e.g. `claude-code`, `mock`, `magmux` |
| `harness_config` | map | handed to the adapter verbatim — **not validated by the loader** |
| `models` | map[string]modelspec | named model definitions; same union as `judges:` |
| `params` | map[string]any | declared names + defaults — **the bench's interface** |
| `judges` | {default, providers} | judge providers for the 17 AI check types |
| `metrics` | []MetricSpec | the report's numeric schema |
| `derivedMetrics` | [{name, value}] | JS expression over named scores, e.g. `"Consistency * 2"` |
| `defaults` | ScenarioDefaults | see §2 |
| `defaultScenario` | ScenarioSpec | a whole scenario merged into every entry |
| `budget` | float | **informational only, never enforced** |
| `token_estimate` | int | **informational only, never enforced** |
| `scenarios` | []ScenarioSpec | the work |

### Accepted aliases

All still load; the canonical spelling is on the left.

| Canonical | Alias |
|---|---|
| `harness:` | `runner:` |
| `harness_config:` | `runner_config:` |
| `scenarios:` | `cases:` · `tests:` |
| `defaultScenario:` | `defaultCase:` · `defaultTest:` |
| `checks:` | `assert:` |
| `testdata:` | `fixture:` |
| `session:*` check types | `trajectory:*`, and bare `skill-used` |
| `disableDefaultChecks:` | `disableDefaultAsserts:` |

Say **testdata**, never "fixture". Write `session:`, never `trajectory:`.

---

## 2. `defaults:` — scenario-level defaults

| Key | Type | Default | Effect |
|---|---|---|---|
| `sandbox` | SandboxConfig or string | `home` | bare level, or the long form |
| `interactive` | bool-ish | **true** | how the agent is driven — see runners-and-sandbox.md §3 |
| `cwd` | string | *(root)* | where inside the workspace the agent starts |
| `timeout` | string | `300s` | must carry a unit — see the gotcha below |
| `capture` | string | `log` | `log` · `proxy` · `log+proxy` |
| `staging_timeout` | string | | budget for `generate:`/`setup:` |
| `bun` | string | | pin the Bun version for `ts`/`js` checks |
| `python` | string | | pin the Python version for `python` checks |
| `lockfile_required` | bool | false | demand `bun.lock` / `uv.lock` |

---

## 3. Scenario keys

```yaml
scenarios:
  - description: "fix the failing test"
    name: bugfix-add                 # stable id for --run filtering and reports
    prompt: "The test fails. Fix it."
    follow_ups:                      # interactive only — rejected with interactive: false
      - "Now add a test for the negative case."
    testdata: ./testdata/repo        # copied fresh into the sandbox
    repo: {url: …, ref: …, path: …}  # third-party checkout, pinned
    setup: ./stage.sh                # build testdata; keeps NO expectation
    generate: ./gen.sh               # build testdata AND compute the answer
    image: ./shots/dashboard.png     # delivered with the prompt
    cwd: packages/api                # moves the AGENT only
    vars: {reference: "…"}
    sandbox: {level: container}
    interactive: false
    timeout: 600s
    capture: log
    staging_timeout: 120s
    bun: "1.3.10"
    python: "3.12"
    lockfile_required: true
    providers: [a, b]                # multi-provider fan-out
    transform: "output.trim()"       # JS rewriting output before checks
    metadata: {owner: platform}
    threshold: 0.8                   # PARSED BUT NEVER EVALUATED — see §9
    options:
      transform: "…"
      disableDefaultChecks: true
    checks: [{…}]
```

| Key | Type | Notes |
|---|---|---|
| `description` | string | |
| `name` | string | stable id |
| `prompt` | string | **required** — written here, inherited from `defaultScenario:`, or read from a case directory's `input.md`. An explicit `prompt: ""` is a choice and is kept; never writing one is a **load error**, because an empty prompt otherwise reaches the agent and spends a real run on nothing |
| `follow_ups` | []string | one send, one turn, one `Session.Turns` entry. **Rejected at load with `interactive: false`** |
| `testdata` | string | directory copied fresh into the sandbox per scenario |
| `repo` | {url, ref, path} | see §4 |
| `setup` | string | staging program that keeps no expectation — §5 |
| `generate` | string | staging program that computes the answer — §5 |
| `image` | string or []string | delivered in the same first user message as the prompt — §6 |
| `cwd` | string | relative only, no `..`; must exist after seeding. **Moves the agent only** |
| `vars` | map | reachable as check `Vars` |
| `sandbox` | SandboxConfig or string | overrides `defaults:` |
| `interactive` | bool-ish | overrides `defaults:` |
| `timeout` · `capture` · `staging_timeout` · `bun` · `python` · `lockfile_required` | | as `defaults:` |
| `providers` | []string | multi-provider fan-out; makes `Sessions`/`Providers` plural |
| `transform` | string | JS (goja) rewriting `output` before checks see it |
| `metadata` | map | free-form, carried into the report |
| `threshold` | float | **parsed, merged, and never read** — promptfoo compatibility |
| `options` | {transform, disableDefaultChecks} | |
| `checks` | []check.Spec | see `checks-catalog.md` |

---

## 4. `repo:` — a third-party checkout, pinned

```yaml
repo: {url: https://github.com/go-chi/chi, ref: v5.1.0, path: middleware}
```

The declarative form of "run the agent against somebody else's code". Vendoring that code
makes the subject drift silently and bloats the repository; a `setup:` script shelling out to
git works, but the pin then lives in a shell script nothing reads back, so the report cannot
say what the agent ran against. This key can.

**It COMPOSES with `testdata:` rather than replacing it**: the checkout is the base and
`testdata:` is copied over it, so a bench can add its own `CLAUDE.md`, its own broken test or
its own `.claude` tree to a repository it does not own. `generate:`/`setup:` stage on top of both.

The workspace gets **no `.git`**, submodules are **not** initialized, and Git-LFS content is
**not** fetched.

---

## 5. `setup:` vs `generate:` — two staging programs

Both run **once per run, before the workspace is seeded**, on the host, with the staged tree
as working directory, under the same `staging_timeout:`, with the same six environment names.
Relative paths resolve against the bench file. The tree each leaves behind replaces
`testdata:` as the seed source.

| | `setup:` | `generate:` |
|---|---|---|
| keeps an expectation | **no** | **yes** — stdout `NAME=VALUE` lines |
| stdout is | diagnostics | the run's **secrets**, read as check Vars |
| leak assertion | none | **madbench refuses the run** if a printed value is findable in the staged tree, the prompt, or the report |
| use for | a clone at a pinned SHA, an indexer, a per-run config, a code-navigation bench | a bench whose answer must be unguessable |

**Declaring both on one scenario is refused** — both own the staged tree and both run before
the workspace exists, so there is no order between them that is not a pipeline nobody asked for.

Two consequences before reaching for `generate:`:

- **The expectation must be derived, not planted.** "Find the row where…" fails the leak
  assertion, because the answer is literally in the file. Sums, counts and checksums pass —
  computing them *is* the task. An expected answer that IS a file path could never survive it;
  that is what `setup:` is for.
- **Per-run means per Eval `runs:` entry.** `--repeat N` deliberately reuses one staged tree,
  so a repeat re-measures the *same* task and the spread it reports is the agent's, not the data's.

---

## 6. `image:` — asking about a picture

Pictures delivered to the agent **alongside the prompt**, as part of the same first user
message. Relative paths resolve against the bench file. An image that is missing, is a
directory, or is not a format the model accepts **blocks at preflight**, before anything is spent.

**An image is NOT testdata.** `testdata:` seeds the working tree, so the agent has to open a
file to see it and could just as well ignore it; `image:` is in the message the model is
answering, so it is seen before the agent does anything at all. A bench that wants both
declares both.

Declaring `image:` flips `--input-format` from `text` to `stream-json`. Verify delivery with
`session:image-sent`, which grades transport, not comprehension.

> **An `image:` bench cannot be negative-controlled.** The mock harness is not `ImageCapable`:
> `madbench check` refuses with *harness "mock" cannot deliver an image*. Grade the rest of the
> bench under mock and keep the image cell's proof to a real run.

---

## 7. `sandbox:` block

```yaml
sandbox:
  level: container           # none | workspace | home | container (default home)
  workdir: ./repo            # level `none` ONLY — rejected above it
  image: node:22             # container only; XOR dockerfile
  dockerfile: ./Dockerfile   # container only
  network: none              # container only
  user: root                 # container, Linux only
  env: {CI: "1"}             # literal values — never secrets
  share:
    env: [GITHUB_TOKEN]           # forwarded BY NAME from resolved settings
    secret_env: [MY_VENDOR_KEY]   # forwarded AND redacted from the Session
    paths:
      - {from: ~/.cache/uv, to: ~/.cache/uv, access: rw}
      - {from: ./golden,    to: /opt/golden, access: copy}
      - {from: /srv/corpus, to: /srv/corpus, access: ro}   # container only
```

Levels, what each protects, and the retired spellings: `runners-and-sandbox.md` §4.

---

## 8. `metrics:` and `derivedMetrics:`

A check returns higher-is-better **utility** and *grades* a Scenario; a metric *measures* it
and never grades.

```yaml
metrics:
  - {name: cost,   source: session.cost,   aggregate: sum,  unit: usd,    better: lower}
  - {name: steps,  source: session.steps,  aggregate: mean, unit: steps,  better: lower}
```

| Source | Scope | Reads |
|---|---|---|
| `session.latency` | scenario | `Metrics.Latency` |
| `session.cost` | scenario | `Metrics.Cost` |
| `session.tokens` | scenario | prompt + output tokens |
| `session.prompt_tokens` / `session.output_tokens` | scenario | one side of the above |
| `session.steps` | scenario | `Metrics.StepCount` — **main-thread tool calls, not turns** |
| `session.turns` | scenario | one **exchange** — `prompt:` plus each `follow_ups:` entry |
| `session.model_requests` | scenario | one **request→response**. **No fallback** — nothing in the Action stream reconstructs it |
| `session.tool_calls` | scenario | `len(Session.Calls)` — **every** thread, so it exceeds `session.steps` when a subagent ran |
| `session.steps.main` | scenario | the same number as `session.steps`, named for the threads it counts |
| `session.steps.all` | scenario | the same as `session.tool_calls` — the whole job |
| `session.steps.agent` + `key:` | scenario | one subagent's `SubagentRollup.ToolCalls`. An agent that never spawned is **missing**, not `0` |
| `session.plugins_reported` | scenario | error-free entries in `Environment.Reported.Plugins` |
| `session.plugins_failed` | scenario | entries carrying `errors` |
| `session.skills_registered` | scenario | `len(Reported.Skills())`, loaded plugins only |
| `check.score` | check | each Check's normalized score |
| `check.pass_rate` | scenario | passed ÷ graded Checks |
| `check.evidence` + `key:` | check | `Result.Evidence[key]`, numeric values only |

`aggregate:` accepts `sum`, `mean`, `max`, `min`. Aliases: `add`/`total` → `sum`,
`average`/`avg` → `mean`, `agg:` → `aggregate:`.

**"How many steps" is three questions** — main thread, whole job, one named subagent. Pick the
one you mean; `session.steps` is the main thread.

---

## 9. Eval files

An **Eval** runs the same **Bench** many times with different inputs. **There is no
cross-product** — what you list is what runs.

```yaml
# my-models.eval.yaml (any .yaml works — detection is by keys, not filename)
description: "haiku vs opus"
bench: ./mybench/madbench.yaml       # relative to THIS file
models:
  fast: haiku-4.5
  smart: opus-4.8
metrics: [{name: cost, source: session.cost, aggregate: sum, unit: usd, better: lower}]
control:
  baseline: bare
  varies: [CLAUDE.md]
runs:
  - name: fast-greedy
    params: {model: fast, temp: 0.0}
  - name: smart
    params: {model: smart}
  - {}                               # the bench as-is
```

Known keys are exactly `description`, `bench`, `models`, `metrics`, `control`, `runs`.
**Anything else is an unknown-field error** — `matrix:` and `variations:` are not part of the
format.

| Error | Cause |
|---|---|
| unknown field | `matrix:`, `variations:`, or a typo |
| missing `bench:` | required |
| empty `runs:` | required |
| duplicate-name | two entries resolving to the same name |
| undeclared param | a run param the bench does not declare in `params:` |
| eval-runs-eval | a `bench:` pointing at another Eval file |
| unknown baseline | `control.baseline:` naming no declared run |
| bad varies pattern | empty, absolute, or escaping the staged root |

An Eval's `metrics:` **replaces** the bench's own for all runs rather than merging — one
declaration across the runs is what makes their numbers comparable.

### Params and placeholders

- **Effective value** per param: incoming override (Eval entry / CLI `--param`) > bench
  `params:` default.
- A param value that exactly matches a `models:` key resolves to that model's canonical id
  before substitution. The Eval's `models:` wins over the bench's own on a name collision.
- `harness_config.model` additionally accepts inline modelspec notation with zero declaration.

`{{name}}` (whitespace-tolerant) is substituted anywhere a string appears: `harness_config`
values including nested slices/maps, `prompt`, `testdata`, all three of `repo:`, `generate`,
`setup`, `cwd`, `staging_timeout`, every `sandbox:` value, `transform`, `vars` values, and
check `value:`/`inline:`/`transform:`/`args:`/`config:` recursively including nested children.

- A value that is **exactly** one placeholder keeps the param's **native type**
  (`temp: "{{temp}}"` → the float `0.0`).
- An **embedded** placeholder renders as text (`"at {{temp}}"` → `"at 0"`).
- Substitution runs **before** path resolution, so a param expanding to `./corpora/chi` still
  resolves against the bench file.

**Strictness both ways.** A placeholder naming a param that is neither declared nor supplied
is a load error; an incoming param the bench does not declare is also a load error. The
declaration IS the interface, so this catches typos on both sides.

### `control:` — what the runs may differ by

An Eval whose runs differ in their **instructions** is only interpretable if everything else
is identical. `control:` declares that claim so madbench can check it.

Before any sandbox is provisioned or any model billed, madbench walks each run's staged
inputs — every scenario's `testdata:` root, `harness_config.agent_env`,
`harness_config.system_prompt`, and for claude-code `harness_config.args` (one entry per argv
position) and `harness_config.plugins` (each plugin folder's whole tree plus marketplace and
registry metadata) — diffs them against the baseline, and:

- **reports** the changed paths and byte delta, in the console's `── CONTROL` section and
  under the report's `control` key;
- **stops the Eval** when a run differs somewhere `varies:` does not cover, naming the path.
  Nothing runs, nothing is spent;
- **names a declaration that covered nothing** while the runs plainly differed — the shape of
  a typo, since `varies: [plugin]` loads clean and matches nothing.

The diff is reported with or without the block; only the guard is opt-in. `baseline:` defaults
to the **first** `runs:` entry. Runs that stage the same root are not audited.

### CLI

```bash
madbench list my-models.eval.yaml         # lists each expanded bench + scenarios
madbench my-models.eval.yaml              # per-run results, then a side-by-side comparison
madbench my-models.eval.yaml --run smart  # execute only the named run(s), repeatable
madbench my-models.eval.yaml --repeat 5   # execute EACH run 5× to measure flake
madbench --param temp=0.0 ./mybench/      # override a declared param
```

`--run` selects **which** runs execute; `--repeat` sets **how many times** each one does. They
compose. `--param` splits on the FIRST `=`, so a value may contain `=`.

There is no separate `run` subcommand and no file-kind flag: the bare command auto-detects a
bench vs an Eval **by content**, and a directory expands every `*.yaml` in it.

---

## 10. Case directories

A scenario can also be a **case directory** — `assert.yaml` plus optional `input.md`,
`setup.sh`, `expected/` — discovered when a directory is passed to `madbench`.

---

## 11. Gotchas the loader cannot catch

Strict decoding checks key **names**, not value **semantics**. These load clean and misbehave:

| Write this | Not this | Why it slips through |
|---|---|---|
| `timeout: 600s` | `timeout: 600` or `"600"` | The field's **type is string**, so `600` decodes fine. `time.ParseDuration` then rejects `"600"` and the timeout **silently falls back to the default**. Always write a unit |
| `config:` | `args:` on `ts`/`js`/`python` | `args:` is a **real field** on a check spec — the right key for `exec`, `session:*` and most others. On the script shims it is the wrong one: they bind `config` as a parameter, so your config arrives as `assertion.args` and nothing reads it |

**And strict decoding stops at the `harness_config:` boundary.** That key is an untyped map
handed to the adapter, so the loader validates nothing inside it:

```yaml
harness_config:
  model: claude-haiku-4-5-20251001
  temperature: 0.2        # ← loads clean, preflights clean, is NEVER read
```

`claude-code` reads exactly nine keys and **silently ignores** everything else. There is no
`temperature` key — pass CLI flags through `args:`, and only if your installed `claude`
accepts them. A recognized key with the wrong *type* is a hard error; an unrecognized key is
silence. See `runners-and-sandbox.md` §2.
