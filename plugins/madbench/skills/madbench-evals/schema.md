# Bench and Experiment file schema

Reference for the `madbench-evals` skill, reached by path. Every key of a bench file and an
Experiment file, its type and its default. The madbench release these files were written for
is in `MADBENCH_VERSION` beside `SKILL.md`; no file here restates a version. `docs/<file>.md:<line>` citations point into the madbench
checkout's `docs/` directory.

**Both file kinds are strictly decoded at every nesting level** — scenario, check and sandbox
block alike. An unknown key is a hard load error naming the file, line and type:

```
Error: loading bench.yaml: parsing /abs/path/bench.yaml: yaml: unmarshal errors:
  line 5: field input not found in type madbench.ScenarioSpec
```

---

## 1. Bench file — top level

```yaml
description: "what this bench measures"
harness: {type: claude-code, …}  # the Harness block — §1a; harness-and-sandbox.md §2
models: {fast: sonnet-5}     # named model definitions (modelspec union)
params: {model: fast}        # the bench's interface — declared names + defaults
judges: {…}                  # judge providers for AI Checks
driver: {…}                  # who answers the agent's questions mid-run — §2a
metrics: [...]               # the report: aggregate expressions over sample names — §8
defaults: {…}                # scenario-level defaults
defaultScenario: {…}         # a whole ScenarioSpec merged into every scenario
budget: 1.50                 # informational gauge only — NOT enforced
token_estimate: 200000       # informational gauge only — NOT enforced
unproven: "…"                # the premise is not established — the bench refuses to load
scenarios: [{…}]
```

| Key | Type | Notes |
|---|---|---|
| `description` | string | shown as the bench name in reports |
| `harness` | block, or a bare type string | the Harness and its settings — §1a. Every key under it is validated |
| `models` | map[string]modelspec | named model definitions; same union as `judges:` |
| `params` | map[string]any | declared names + defaults — **the bench's interface** |
| `judges` | {default, providers} | judge providers for the 17 AI Check types |
| `driver` | DriverConfig, or `false` | who answers the agent's questions mid-run; claude-code only — §2a |
| `metrics` | []string expressions, **or** the older []mapping form — never mixed in one block (`docs/metrics.md:314-317`) | the report's numeric schema — §8 |
| `defaults` | ScenarioDefaults | see §2 |
| `defaultScenario` | ScenarioSpec | a whole scenario merged into every entry |
| `budget` | float | **informational only, never enforced** |
| `token_estimate` | int | **informational only, never enforced** |
| `unproven` | string | why this bench's premise is not established. **Every command refuses to load the bench** and prints the text — below |
| `scenarios` | []ScenarioSpec | the work |

**Two keys that look right and do not load.** Measured against the installed binary with a
minimal bench (`madbench list`, exit 1):

```
line 1: field name not found in type madbench.BenchSpec
```

and the identical `field … not found in type madbench.BenchSpec` refusal for any separate
key that declares derived metrics.

- **There is no top-level `name:`.** The bench's identifier is `description:`; `name:` is a
  *Scenario* key (§3). Strict decoding refuses it at the top level.
- **There is no separate derived-metrics key.** Every metric is declared in one `metrics:`
  key, and arithmetic over named scores is an *expression* in that key — §8. Look there
  before drafting a feature request for a metric (SKILL.md, "A gap").

And one key that loads and should not be written here: **`guard_changes:` belongs to the Experiment
file** (§9). A bench file that writes it still loads — nothing refuses it — but one run has
nothing to be compared against.

### 1a. `harness:` — the Harness block

```yaml
harness:
  type: claude-code            # REQUIRED: claude-code | mock | demo
  binary: claude               # the executable (default "claude"; e.g. claudish)
  magmux_binary: ./magmux      # the terminal host for interactive runs
  model: "{{model}}"           # string | model block {provider, model, effort} | a `models:` name
  effort: max                  # low | medium | high | xhigh | max
  provider: anthropic          # normally filled from a model block
  use_subscription: required   # optional (default) | required | api_usage
  config:                      # what the tool is GIVEN before it starts
    dirs: [./config/base, "{{overlay}}"]   # composed, in order, into the tool's ~/.claude
    plugins: [../../plugins/dev]           # plugin FOLDERS; identity is derived
    system_prompt: "…"
  args: ["--permission-mode", "bypassPermissions"]   # extra CLI flags, appended last
  probe: {enabled: true, details: 8, require: false}  # ask the tool what actually loaded
```

- **Bare string shorthand.** `harness: mock` is `harness: {type: mock}`. Only `type` may be
  given that way; anything else needs the block.
- **Strict keys.** An unknown key anywhere under `harness:` is a load error naming the full key
  path — `harness.config.dir`, `harness.efort`. `type` missing or unknown is an error listing
  the known types.
- **Per-type keys.** `type: mock` accepts only `type` and `model`; `type: demo` accepts only
  `type`. Every other key above is claude-code's.
- **`config.dirs`** — directories relative to the bench file, copied in order into the run's
  configuration directory; a later file at the same relative path replaces the earlier one, and
  an `""` entry is skipped. When declared, the composed tree is the user scope
  (`--setting-sources user`) and nothing from the host's own `~/.claude` loads.
- **`config.plugins`** — plugin folder paths (a folder carrying `plugin.json` at its root or
  under `.claude-plugin/`), relative to the bench file. `<name>@<marketplace>` is derived from
  the folder's `plugin.json` and its enclosing marketplace checkout; two entries resolving to
  the same identity are an error.
- **`probe`** — `enabled` (default true), `details` (default 8; 0 = off), `require` (default
  false). `{enabled: false, require: true}` is an error.
- **`{{param}}` placeholders** work anywhere under `harness:` (§9).
- **`--harness <type>`** overrides `harness.type` for every bench.

The keys' full effect is `harness-and-sandbox.md` §2 and §5–§7.

### Unknown keys are refused

madbench accepts exactly one spelling of each key. A key the schema does not declare fails at
load like any typo, with the strict decoder's message, every unknown key at that level in one
pass:

```
line 3: field scenarioz not found in type madbench.BenchSpec
```

Nothing names a replacement. Look the key up in this file, make the change, re-run
`madbench list`, repeat. Bringing a file written for an earlier madbench forward is
`../migrate/SKILL.md`, which applies the changes its `changes.md` records.

A check type is not a key, and `list` does not build Checks: a `type:` that names no Check
passes `madbench list` and fails at `preflight` as `unknown check type`. The family names are
in `checks-catalog.md`. The declarative metrics form is checked the same way: a key outside
`MetricSpec` fails as `field … not found in type madbench.MetricSpec`, and an aggregate
outside §8's list fails as an unknown aggregate, with the known list printed.

### `unproven:` — a bench that must not run yet

A bench whose premise is not established states why, in its own words, and the loader
refuses it on **every** path — a run, `--trials`, an Experiment naming it, `list` and `preflight`
alike — printing that text:

```
Error: loading e.yaml: …/e.yaml declares unproven: — its premise is not established, so it does not run.

premise unmeasured against CLI 2.1.259

Fix the premise, prove it with a measurement, then delete the `unproven:` key and move the bench to tests/. See unproven/README.md
```

It is not a disabled flag or a TODO. Write it only when a run would grade something other
than what the bench is named after, name the tool version the premise was measured
against, and delete it when a **measurement** — never an argument — shows the premise holds.
Such benches live in `unproven/`.

---

## 2. `defaults:` — scenario-level defaults

| Key | Type | Default | Effect |
|---|---|---|---|
| `sandbox` | SandboxConfig or string | `home` | bare level, or the long form |
| `interactive` | bool-ish | **true** | how the agent is driven — see harness-and-sandbox.md §3 |
| `driver` | DriverConfig, or `false` | the default Driver | who answers the agent's questions — §2a |
| `cwd` | string | *(root)* | where inside the workspace the agent starts |
| `timeout` | string | `300s` | must carry a unit — see the gotcha below |
| `capture` | string | `log` | `log` · `proxy` · `log+proxy` |
| `staging_timeout` | string | | budget for `generate:`/`setup:` |
| `bun` | string | | pin the Bun version for `ts`/`js` checks |
| `python` | string | | pin the Python version for `python` checks |
| `lockfile_required` | bool | false | demand `bun.lock` / `uv.lock` |

---

## 2a. `driver:` — who answers the agent's questions

Declared at the top level, under `defaults:`, or on one Scenario (the nearest wins). With no
block, an interactive claude-code Scenario gets the **default Driver**: it answers questions
and nothing else, and runs the `claude` on this machine on its own login — no API key
(`docs/driving-a-session.md:49-113`).

```yaml
driver:
  # model: omitted — the local claude CLI, no key. Name one to bill a key instead.
  instructions: |
    You are the engineer who owns this service. Prefer the safest option.
  answers:                    # tried in order, before the model; first match wins
    - match: "Deploy target"
      choose: staging         # an option label, or a 1-based index
    - match: "*"              # a catch-all closes the script: no model, no key, no network
      choose: 1
  steer: false                # true: the Driver may write prompts of its own
  max_turns: 8                # default: declared prompts + 3
  max_blocked_wait: 120s      # added to timeout:, so the worst case is stated
  allow_free_text: false
```

| Write | Means |
|---|---|
| no `driver:` | the default Driver answers; the conversation is exactly the declared prompts |
| `driver: false` | no Driver: a question fails the Scenario at once, by name |
| `answers:` with `match: "*"` | a closed script — deterministic, offline; `session:driver-source` proves it |
| `steer: true` | the Driver may add turns once the declared prompts run out |

A Driver speaks **inside** the Session, so what it says is part of what the Checks read; a
Judge grades a finished Session from outside. `driver:` on any harness but claude-code passes
`list` and is refused at `preflight`. In an Experiment, the Guard hashes the whole block, so
variants whose Drivers differ need a matching `allow:` entry (`driver`, or `driver/instructions`).

---

## 3. Scenario keys

```yaml
scenarios:
  - description: "fix the failing test"
    name: bugfix-add                 # stable id for --scenario filtering and reports
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
    driver: false                    # a question fails the Scenario at once — §2a
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
    metrics:                         # sample-stage entries belonging to no single check — §8
      - 'metrics.passed = status == "pass" ? 1 : 0'
```

| Key | Type | Notes |
|---|---|---|
| `description` | string | |
| `name` | string | stable id |
| `prompt` | string, or a list of parts | **required** — typed into an interactive session as keystrokes, never a paste. As a list, `- type:` · `- paste:` · `- image:` (+ `clipboard: true`) are delivered in order, interactive only (`docs/harness.md`, "A turn written as parts"). Written here, inherited from `defaultScenario:`, or read from a case directory's `input.md`. An explicit `prompt: ""` is a choice and is kept; never writing one is a **load error**, because an empty prompt otherwise reaches the agent and spends a real run on nothing |
| `follow_ups` | []string or lists of parts | each entry takes either shape `prompt:` does. One send, one turn, one `Session.Turns` entry. **Rejected at load with `interactive: false`** |
| `testdata` | string | directory copied fresh into the sandbox per scenario |
| `repo` | {url, ref, path} | see §4 |
| `setup` | string | staging program that keeps no expectation — §5 |
| `generate` | string | staging program that computes the answer — §5 |
| `image` | string or []string | delivered in the same first user message as the prompt — §6 |
| `cwd` | string | relative only, no `..`; must exist after seeding. **Moves the agent only** |
| `vars` | map | reachable as check `Vars` |
| `sandbox` | SandboxConfig or string | overrides `defaults:` |
| `interactive` | bool-ish | overrides `defaults:` |
| `driver` | DriverConfig, or `false` | overrides the bench's and `defaults:` — §2a |
| `timeout` · `capture` · `staging_timeout` · `bun` · `python` · `lockfile_required` | | as `defaults:` |
| `providers` | []string | multi-provider fan-out; makes `Sessions`/`Providers` plural |
| `transform` | string | JS (goja) rewriting `output` before checks see it |
| `metadata` | map | free-form, carried into the report |
| `threshold` | float | **parsed, merged, and never read** — promptfoo compatibility |
| `options` | {transform, disableDefaultChecks} | |
| `checks` | []check.Spec | see `checks-catalog.md` |
| `metrics` | []string | sample-stage expressions scoped to this Scenario's row; in scope: `status`, `duration`, `session` (`docs/metrics.md:32-33`, `:59-62`) — §8 |

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
**Once per run means once per bench** — every Scenario of the bench is seeded from the one
tree the program left, not one staging per Scenario (`docs/sandbox-and-testdata.md:347`, `:435`).
Relative paths resolve against the bench file. The tree each leaves behind replaces
`testdata:` as the seed source.

**Every staged path resolves against the bench file's directory, never the cwd** —
`testdata:`, `generate:`, `setup:`, a local `repo:`, `harness.config.dirs` and `harness.config.plugins` alike,
with `{{param}}` substitution applied first (`docs/sandbox-and-testdata.md:239-245`). That
includes a `testdata:` a Scenario *inherits* from `defaultScenario:`, so a bench runs
identically from its own folder, the repo root, or a multi-bench `madbench a/ b/` sweep.

| | `setup:` | `generate:` |
|---|---|---|
| keeps an expectation | **no** | **yes** — stdout `NAME=VALUE` lines |
| stdout is | diagnostics | the run's **secrets**, read as check Vars |
| leak refusal | none | **madbench refuses the run** if a printed value is findable in the staged tree, the prompt, or the report |
| use for | a clone at a pinned SHA, an indexer, a per-run config, a code-navigation bench | a bench whose answer must be unguessable |

**Declaring both on one scenario is refused** — both own the staged tree and both run before
the workspace exists, so there is no order between them that is not a pipeline nobody asked for.

Two consequences before reaching for `generate:`:

- **The expectation must be derived, not planted.** "Find the row where…" is refused as a
  leak, because the answer is literally in the file. Sums, counts and checksums pass —
  computing them *is* the task. An expected answer that IS a file path could never survive it;
  that is what `setup:` is for.
- **Per-run means per Experiment variant.** `--trials N` deliberately reuses one staged tree,
  so each trial re-measures the *same* task and the spread it reports is the agent's, not the data's.

---

## 6. `image:` — asking about a picture

Pictures delivered to the agent **alongside the prompt**, as part of the same first user
message. Relative paths resolve against the bench file. An image that is missing, is a
directory, or is not a format the model accepts **blocks at preflight**, before anything is spent.

**An image is NOT testdata.** `testdata:` seeds the working tree, so the agent has to open a
file to see it and could just as well ignore it; `image:` is in the message the model is
answering, so it is seen before the agent does anything at all. A bench that wants both
declares both.

**An `image:` Scenario must be `interactive: false`.** claude-code carries a picture only on the
`--print` path, where declaring `image:` flips `--input-format` from `text` to `stream-json`;
its interactive driver cannot, so an image on an interactive Scenario is refused at configure
(`docs/harness.md:245-266`). Verify delivery with `session:image-sent`, which grades
transport, not comprehension.

> **An `image:` bench cannot be negative-controlled.** The mock harness is not `ImageCapable`:
> `madbench check` refuses with *harness "mock" cannot deliver an image*. Grade the rest of the
> bench under mock and keep the image Scenario's proof to a real run.
>
> **`image: generated:<name>`** names a picture the Scenario's `generate:` program writes
> into `$MADBENCH_IMAGE_DIR` — a sibling of the workspace, never seeded into it, so the
> pixels that *are* the answer cannot be read off disk (`docs/harness.md:315-361`). That is
> the native home for any bench-owned image generator; do not wire one around madbench.

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

Levels and what each protects: `harness-and-sandbox.md` §4.

---

## 8. `metrics:` — expressions, and the bench's own `module/`

A check returns higher-is-better **utility** and *grades* a Scenario; a metric *measures* it
and never grades (`docs/metrics.md:8-11`). There is **one** declaration key, `metrics:`, and
it appears at three levels. Which stage an entry runs in is decided by **where it is
written**, never by inspecting the expression (`docs/metrics.md:64-65`).

```yaml
scenarios:
  - name: dev-under-plan-mode
    prompt: "…"
    checks:
      - type: ts
        metric: accuracy                     # the score, under a name you choose
        value: "file://./verify-transition.ts"
        metrics:                             # SAMPLE stage: this Check's own contribution
          - metrics.bytes = evidence.size_bytes
          - "metrics.wins += score > 0.6 ? 1 : 0"
    metrics:                                 # SAMPLE stage: belongs to no single Check
      - 'metrics.passed = status == "pass" ? 1 : 0'

metrics:                                     # AGGREGATE stage: the report — arrays in
  - metrics.accuracyMean = mean(accuracy)
  - metrics.accuracyP50  = p50(accuracy)
  - metrics.passRate     = mean(passed)
  - 'metrics.spend = { value: sum(cost), unit: "usd", better: "lower" }'
```

The language is JavaScript — property access, arithmetic, comparison and the ternary are
themselves. There is no `source:` catalog to learn and no `aggregate:` enum: a path is a
path and `mean` is a function (`docs/metrics.md:42-44`).

| Stage | Declared at | In scope | Lands in |
|---|---|---|---|
| sample | a Check's or a Scenario's `metrics:` | `score`, `pass`, `reason`, `evidence`; then `status`, `duration`, `session` | that Scenario's row |
| aggregate | the top-level `metrics:` | every sample name, as the **array** of its per-Scenario values | the run — what the charts read |

(`docs/metrics.md:57-62`.)

**A Check pushes; the report never reaches back by name.** A central `source: check.score,
check: accuracy` matches on a string, so renaming a Check silently empties its metric. The
push form has no name to get wrong (`docs/metrics.md:46-55`). That is why `metric:` on a
check matters: it is the name the check's own score binds under at aggregate stage.

Rules that decide what a number means:

- **`metrics` is one live object per Scenario, shared by its Checks** — that is what makes
  `+=` mean "across the Checks of this Scenario". An unset key reads `0`, so `+=` works on
  the first write (`docs/metrics.md:67-77`).
- **Missing is not zero.** Writing `undefined`, `null`, `NaN` or `Infinity` records the
  metric as *missing* and the report prints `n/a`; a genuine `0` prints `0`. An expression
  cannot launder "nothing happened" into "zero" (`docs/metrics.md:79-81`).
- **`mean`, `min`, `max`, `last` of nothing are missing; `sum` and `count` of nothing are a
  real `0`.** A percentile over fewer than 5 samples is missing rather than an interpolated
  guess (`docs/metrics.md:160-168`).
- **A dot in a name groups it.** Write `metrics["f1.locate"]` (bracket form); at aggregate
  stage `mean(f1.locate)` reads one leaf and `mean(f1)` folds every leaf. `metrics.f1.locate
  = …` throws by design (`docs/metrics.md:83-118`).
- **Built-ins need no declaration**: `cost`, `tokens`, `turns` bind at sample stage, plus
  `duration` at aggregate stage — as bindings, not writes, so they appear in the report only
  when an expression puts them there (`docs/metrics.md:142-156`).
- **Quote a ternary.** A bare scalar containing `": "` is a YAML mapping, and madbench says
  so rather than reporting a mystery about `MetricSpec` (`docs/metrics.md:215-227`).
- **Every expression compiles at load**, so a typo fails before a model is billed. A
  run-time throw is recorded on the report as `metric_error` and does **not** fail the run —
  a metric measures, it does not grade — and it is never silent (`docs/metrics.md:292-298`).

Aggregate functions: `sum` · `mean` · `min` · `max` · `count` · `last` · `p50` · `p90` ·
`p95` · `p99` (`docs/metrics.md:160`). Anything else is ordinary JavaScript — `filter`,
`reduce`, your own arithmetic — or an export from the module below.

### The bench's own `module/`

Arithmetic that outgrows one line belongs in code, **beside the bench, not around it**. Put
a `module/` directory next to the bench file and every export is in scope, by name, in every
one of that bench's expressions (`docs/metrics.md:229-243`):

```
benches/<name>/
  madbench.yaml
  module/
    index.ts          # exports become bindings in every metrics: expression
    package.json
    bun.lock          # only when the module has dependencies
```

```ts
// module/index.ts
export function scaleBytes(bytes: number, unit: "kb" | "mb" = "kb"): number {
  return bytes / (unit === "mb" ? 1024 * 1024 : 1024);
}
```

```yaml
checks:
  - type: ts
    metric: bundle
    value: "file://./measure.ts"
    metrics:
      - metrics.kb = scaleBytes(evidence.size_bytes)
metrics:
  - 'metrics.size = { value: mean(kb), unit: "kb", better: "lower" }'
```

**Convention, not configuration.** No YAML key selects it: the directory is `module/`, the
entry point is `index.ts` or `index.js`, and a `module/` holding neither is ignored. Its
dependencies are `bun install`ed into a content-hashed cache on first run
(`docs/metrics.md:265-269`).

**The module chooses the runtime.** Without one, expressions run in-process on goja, an
ES5.1+ interpreter that can neither import TypeScript nor resolve an npm package. With one,
madbench spawns `bun` — one subprocess per Scenario plus one per run — with the module
imported once and every entry evaluated in a shared scope. The expression source is
identical either way, so adding a module never means rewriting an expression
(`docs/metrics.md:271-287`). Two consequences: `await` is available on an async export only
with a module, and a **module-backed block stops at the first throwing entry** (the
in-process one keeps going), so put an entry that can throw last (`docs/metrics.md:198-210`).
A bench with a `module/` gets its runtime checked at **preflight** — a missing `bun` or a
module with no `package.json` is named before any spend (`docs/metrics.md:300-302`).

**Aggregation stops at the run, by design.** Nothing is summed or averaged across runs, and
there is no field in which a consumer could find cost summed across two different agent
setups (`docs/metrics.md:460-465`). A cross-run statistic is therefore a post-hoc module
over `--report-json` — not a feature request. Upstream refused Experiment-level metrics in
writing: *"the statistic belongs to the bench's own `module/`, and `--report-json` is the
path. Adding a stage would turn a structural guarantee into a sentence in the docs."*

### The declarative form still loads

The older shape is a list of mappings under the same key. One key, two shapes, told apart by
whether the first entry is a scalar or a mapping; a block is all expressions or all
mappings, never a mix. New benches should use expressions (`docs/metrics.md:306-317`).

```yaml
metrics:
  - {name: cost,   source: session.cost,   aggregate: sum,  unit: usd,    better: lower}
  - {name: steps,  source: session.steps,  aggregate: mean, unit: steps,  better: lower}
```

Its `source:` catalog is closed (`docs/metrics.md:357-384`). The same names are what an
expression's `session` binding exposes, so this table still tells you what is measurable:

| Source | Scope | Reads |
|---|---|---|
| `scenario.duration` | scenario | `ScenarioResult.Duration` — present even on an error row |
| `session.latency` | scenario | `Metrics.Latency` |
| `session.cost` | scenario | `Metrics.Cost` |
| `session.tokens` | scenario | prompt + output tokens |
| `session.prompt_tokens` / `session.output_tokens` | scenario | one side of the above |
| `session.steps` | scenario | `Metrics.StepCount` — **main-thread tool calls, not turns** |
| `session.turns` | scenario | one **exchange** — `prompt:` plus each `follow_ups:` entry |
| `session.model_requests` | scenario | one **request→response**. **No fallback** — nothing in the Event stream reconstructs it |
| `session.tool_calls` | scenario | `len(Session.Calls)` — **every** thread, so it exceeds `session.steps` when a subagent ran |
| `session.steps.main` | scenario | the same number as `session.steps`, named for the threads it counts |
| `session.steps.all` | scenario | the same as `session.tool_calls` — the whole job |
| `session.steps.agent` + `key:` | scenario | one subagent's `SubagentRollup.ToolCalls`. An agent that never spawned is **missing**, not `0` |
| `session.plugins_reported` | scenario | error-free entries in `Environment.Reported.Plugins` |
| `session.plugins_failed` | scenario | entries carrying `errors` |
| `session.skills_registered` | scenario | `len(Reported.Skills())`, loaded plugins only |
| `event.duration` | event | `Event.DurationMs`, one sample per Event that reported one |
| `event.tokens` | event | `Event.Tokens`, likewise |
| `check.score` | check | each Check's normalized score |
| `check.pass_rate` | scenario | passed ÷ graded Checks |
| `check.evidence` + `key:` | check | `Result.Evidence[key]`, numeric values only |

`aggregate:` accepts `sum`, `mean`, `min`, `max`, `count`, `last`, `p50`, `p90`, `p95`,
`p99` (`docs/metrics.md:428-437`), and nothing else: any other name is refused as an unknown
aggregate, with the known list printed. A `source:` outside the table above is refused as an
unknown source the same way, and a key outside `MetricSpec` as `field … not found in type
madbench.MetricSpec`.

**No `metrics:` block at all** reports a built-in schema — `cost`, `duration`, `tokens`,
`turns` — so every bench reports comparable numbers with no edit; declaring `metrics:`
replaces that schema entirely, and order is priority order for a narrow dashboard column
(`docs/metrics.md:320-337`).

**"How many steps" is three questions** — main thread, whole job, one named subagent. Pick the
one you mean; `session.steps` is the main thread.

---

## 9. Experiment files

An **Experiment** tests one hypothesis: it runs the same **Bench** once per **variant**, each
variant overriding only the params it names. **There is no cross-product** — what you list is
what runs.

```yaml
# my-models.experiment.yaml (any .yaml works — detection is by keys, not filename)
description: "sonnet vs opus"
bench: ./mybench/madbench.yaml       # relative to THIS file
models:
  fast: sonnet-5
  smart: opus-4.8
metrics: [{name: cost, source: session.cost, aggregate: sum, unit: usd, better: lower}]
guard_changes:
  allow: [harness/model]             # the variants sweep the model; anything else is CONFOUNDED
variants:
  - name: defaults                   # the bench as-is; the first variant is the baseline
  - name: fast-greedy
    params: {model: fast, temp: 0.0}
  - name: smart
    params: {model: smart}
```

Known keys are exactly `description`, `bench`, `models`, `metrics`, `guard_changes`,
`variants`. **Anything else is an unknown-field error** — `matrix:` and `variations:` are not
part of the format. Every variant has a `name:`; a run is named by its variant.

| Error | Cause |
|---|---|
| unknown field | `matrix:`, `variations:`, or a typo |
| missing `bench:` | required |
| empty `variants:` | required |
| unnamed variant | a `variants:` entry with no `name:` |
| duplicate variant name | two variants with the same `name:` |
| undeclared param | a variant param the bench does not declare in `params:` |
| experiment-runs-experiment | a `bench:` pointing at another Experiment file |
| bad `allow:` pattern | empty, absolute, or escaping the staged root |

An Experiment's `metrics:` **replaces** the bench's own for all variants rather than merging —
one declaration across the runs is what makes their numbers comparable.

### Params and placeholders

- **Effective value** per param: incoming override (variant / CLI `--param`) > bench
  `params:` default.
- A param value that exactly matches a `models:` key resolves to that model's canonical id
  before substitution. The Experiment's `models:` wins over the bench's own on a name
  collision.
- `harness.model` additionally accepts inline modelspec notation with zero declaration.

`{{name}}` (whitespace-tolerant) is substituted anywhere a string appears: `harness:`
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

### `guard_changes:` — what the variants may differ by

An Experiment whose variants differ in their **instructions** is only interpretable if
everything else is identical. `guard_changes:` declares that claim so madbench can check it.

The **baseline** is the first declared variant. Before any sandbox is provisioned or any model
billed, madbench walks each variant's staged inputs — every scenario's `testdata:` root and
the `harness` source, whose paths are the YAML paths under `harness/`: `harness/model`,
`harness/provider`, `harness/effort` and the other scalar keys by resolved value (the model
canonicalised), `harness/args/<i>` (one entry per argv position),
`harness/config/system_prompt`, `harness/config/files/<relative path>` (each file of the tree
`config.dirs` composes, by content) and `harness/config/plugins/<id>/…` (each staged plugin) —
diffs them against the baseline, and:

- **reports** the changed paths and byte delta, in the console's `── GUARD ──` section and
  under the report's `guard_changes` key;
- **stops the Experiment** when a variant differs somewhere `allow:` does not cover, naming the
  path. Nothing runs, nothing is spent;
- **names a declaration that covered nothing** while the variants plainly differed — the shape
  of a typo, since `allow: [plugin]` loads clean and matches nothing.

**Every declared variant is audited, whichever `--variant` selects to run.** The audit reads
staged inputs, never a Session, so it costs nothing: a subset without the first variant runs
and is diffed against it, and a confound in a variant that is not selected stops the run too.
Several Experiments in one invocation are audited one by one, each against its own first
variant. The diff is reported with or without the block; only the guard is opt-in. Variants
that stage the same root are not audited.

### CLI

```bash
madbench list my-models.experiment.yaml             # lists each expanded bench + scenarios
madbench my-models.experiment.yaml                  # per-run results, then a side-by-side comparison
madbench my-models.experiment.yaml --variant smart  # execute only the named variant(s), repeatable
madbench my-models.experiment.yaml --trials 5       # run 5 trials of EACH variant to measure flake
madbench --param temp=0.0 ./mybench/                # override a declared param
```

`--variant` selects **which** variants run; `--trials` sets **how many trials** each run has.
They compose. A `--variant` name selects that variant in every Experiment that declares it.
`--scenario` narrows what runs, never what the guard audits: the guard compares every
declared variant, whole. `--param` splits on the FIRST `=`, so a value may contain `=`.

There is no separate `run` subcommand and no file-kind flag: the bare command auto-detects a
bench vs an Experiment **by content**, and a directory expands every `*.yaml` in it.

---

## 10. Case directories

A Scenario can also be a **case directory** — discovered when a directory is passed to
`madbench`. Only two files in it are read: `assert.yaml` and an optional `input.md` (the
prompt). A `setup.sh` or an `expected/` beside them is inert (`docs/sandbox-and-testdata.md:765-766`).

---

## 11. Gotchas the loader cannot catch

Strict decoding checks key **names**, not value **semantics**. These load clean and misbehave:

| Write this | Not this | Why it slips through |
|---|---|---|
| `timeout: 600s` | `timeout: 600` or `"600"` | The field's **type is string**, so `600` decodes fine. `time.ParseDuration` then rejects `"600"` and the timeout **silently falls back to the default**. Always write a unit |
| `config:` | `args:` on `ts`/`js`/`python` | `args:` is a **real field** on a check spec — the right key for `exec`, `session:*` and most others. On the script shims it is the wrong one: they bind `config` as a parameter, so your config arrives as `assertion.args` and nothing reads it |

**Strict decoding covers the `harness:` block too.** An unknown key anywhere under it is a load
error naming the full key path:

```yaml
harness:
  type: claude-code
  model: claude-sonnet-5
  temperature: 0.2        # ← refused at load: harness.temperature
```

`claude-code` reads a closed set of keys (`harness-and-sandbox.md` §2 lists them). There is no
`temperature` key — pass CLI flags through `args:`, and only if your installed `claude`
accepts them. A known key with the wrong *type* is a hard error too. See
`harness-and-sandbox.md` §2.
