# madbench bench file schema (`BenchSpec`)

The runnable unit. Files named `madbench.yaml` / `madbench.yml` are auto-discovered in
cwd; any `*.yaml` path can be passed explicitly. Source of truth:
`pkg/madbench/benchspec.go`, loader in `internal/loader/loader.go`.

**Bench files are strictly decoded (v0.10.0).** An unknown key is a load error naming
the file, line and Go type — the treatment Eval files always had. See *Loading &
validation behavior* below for exactly where strictness stops.

## Top level

```yaml
description: "MB-1 my bench"     # the Bench name shown in reports/UI
runner: claude-code              # harness: claude-code | mock | magmux
runner_config: {...}             # runner-specific map — see runners-and-sandbox.md
defaults: {...}                  # CaseDefaults inherited by every case
defaultCase: {...}               # a Case merged into every case (alias: defaultTest)
judges: {...}                    # AI-judge providers (multi-provider) — see checks-catalog.md
derivedMetrics:                  # JS exprs over named check scores, post-run (goja)
  - { name: Adjusted, value: "Consistency * 2" }
budget: 10                       # USD gauge — informational only, NOT enforced
token_estimate: 4000000          # tokens gauge — informational only
cases: [...]                     # the Scenarios (alias: tests)
```

### Canonical keys vs. accepted aliases

The dictionary rename made several familiar keys into **aliases**. Everything in the
right column still loads — nothing here is broken — but **emit the canonical name in
new files**, and flag aliases in review:

| Canonical (write this) | Accepted alias (still loads) |
|---|---|
| `harness:` | `runner:` |
| `harness_config:` | `runner_config:` |
| `scenarios:` | `cases:` · `tests:` |
| `checks:` | `assert:` |
| `defaultScenario:` | `defaultCase:` · `defaultTest:` |
| `testdata:` | `fixture:` |
| `session:*` check types | `trajectory:*` |

> **Note:** the YAML examples in these reference files still show the alias spellings
> in places. Both load identically; prefer the canonical column when authoring.

**Sandbox levels are the exception — those retired spellings are REFUSED, not
aliased.** `sandbox: process` / `machine` / `docker` are hard load errors. See
`runners-and-sandbox.md`.

## `defaults:` (CaseDefaults)

```yaml
defaults:
  sandbox: home              # none | workspace | home | container — default home
  timeout: 120s              # duration STRING — `120` and `"120"` both silently
                             # fall back to the 120s default (ParseDuration rejects
                             # a bare number; nothing errors). Always write a unit.
  capture: log               # "log" | "proxy" | "log+proxy"
  bun: "1.3.4"               # pin Bun version for ts/js checks
  python: "3.12"             # pin Python for python checks
  lockfile_required: false   # require bun.lock / uv.lock for managed deps
```

## `cases:` entries (Case / Scenario)

```yaml
cases:
  - name: write-fizzbuzz          # ID (falls back to description)
    description: "..."
    prompt: |                      # the request sent to the Harness
      ...
    vars: { requiredWord: managed }  # interpolated + visible to Code checks
    testdata: ./testdata/repo      # dir copied fresh into sandbox WorkDir per run
    generate: ./generate.sh        # program run ONCE PER RUN before the workspace exists
    image: ./chart.png             # picture(s) delivered WITH the prompt; or a list
    sandbox: { level: container, image: "...", network: none, env: {...} }  # per-case override
    # ^ the key is `level:`. There is NO `mode:` key — since v0.10.0 strict decoding
    #   makes `sandbox: {mode: container}` a LOAD ERROR. It used to be dropped
    #   silently, pass preflight, and run at the default `home` level.
    timeout: 120s
    capture: log
    bun: "1.3.4"
    python: "3.12"
    providers: [claude-haiku, gpt] # run once per provider → composites see all sessions
    transform: "output.trim()"     # JS rewrite of output before checks (goja)
    metadata: { any: tags }
    threshold: 0.8                 # promptfoo compat — PARSED but NOT enforced by the engine (v1)
    lockfile_required: true
    options:
      transform: "..."
      disableDefaultChecks: false  # skip defaultScenario checks (alias: disableDefaultAsserts)
    assert: [...]                  # the Checks — see below
```

`defaultCase` merge semantics (promptfoo): scalars — case wins; `vars`/`metadata`/
`options` deep-merge; `assert` lists concatenate default-first.

## `assert:` entries (AssertionSpec / Check)

```yaml
- type: contains          # required — check type (see checks-catalog.md)
  value: "func FizzBuzz"  # main argument: string / list / schema map / number
  args: { cmd: [...] }    # structured params (exec cmd, session:step-count bounds, …)
  config: { ... }         # extra config (http url, script config object)
  weight: 2.0             # contribution in weighted composites (default 1.0)
  threshold: 0.7          # this check's pass bar — the Expectation
  metric: Consistency     # named score key (defaults to type)
  assert: [...]           # CHILDREN — only for composite types
  inline: "..."           # inline source for gosrc evaluators
  transform: "..."        # per-assertion output rewrite (overrides case-level)
```

## `image:` — asking about a picture

```yaml
scenarios:
  - name: reads-the-chart
    prompt: "Which quarter had the steepest drop?"
    image: ./revenue.png                     # or: image: [./before.png, ./after.png]
```

- The key is **singular `image:`** in both shapes. There is no `images:` — under strict
  decoding it is a load error rather than a sibling that parses to nothing.
- Paths resolve against the bench file, exactly as `testdata:` does.
- **An image is not testdata.** `testdata:` seeds the working tree, so the agent must
  open a file to see it — that grades whether it read a file. `image:` is in the message
  the model is answering, so it is seen before the agent does anything. Declare both if
  you want both.
- `media_type` is **sniffed from the bytes, never the extension** — a `.png` that is
  really a JPEG is the ordinary result of renaming, and declaring it wrong is an API
  rejection mid-run. Accepted: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- Two gates fire before any spend: `preflight` (missing, a directory, or an unaccepted
  format) and `harness.ImageCapable` at Configure (a harness that cannot carry one).
  **Only `claude-code` is ImageCapable**, so an `image:` bench cannot be run under
  `--harness mock` or negative-controlled with `madbench check`.
- Transport detail worth knowing: `image:` flips the CLI to `--input-format stream-json`
  for that Scenario only. A Scenario with no `image:` keeps the raw-text stdin it always
  had, byte for byte.

## `generate:` — testdata whose answer is held out of the workspace

`testdata:` is copied **verbatim**, which is fine until the answer must be unguessable:
anything you want the agent to find is also something it can grep for, so a bench whose
expectation ships beside its data measures searching, not solving.

```yaml
scenarios:
  - testdata: ./testdata      # optional static base, copied in first
    generate: ./generate.sh   # runs with the staged tree as its cwd
```

| | |
|---|---|
| When | before seeding, before the run clock starts |
| cwd | a fresh tree under `$TMPDIR/madbench-generated-*`, pre-populated with `testdata:` |
| Environment | `MADBENCH=1`, `MADBENCH_TESTDATA_DIR`, `MADBENCH_IMAGE_DIR`, plus `PATH`/`HOME`/`LANG`/`TMPDIR` from the injected snapshot — **not** your shell |
| stdout | the **secret channel**: `NAME=VALUE` lines, parsed strictly (a stray `echo` is an error, never a skip) |
| stderr | diagnostics, **redacted first** — a debug line quoting the answer prints `[REDACTED]` |
| Result | the staged tree **replaces** `testdata:` as the seed source |

Where a printed value goes is the whole point:

- **The grader gets it**, as a check `Var` under that name — readable by `custom:gosrc`,
  `ts`/`js`/`python`, `custom:exec`, `custom:http`, `custom:wasm`.
- **The workspace does not.** madbench refuses the run if the value is findable as file
  content or as a path, walking the staged tree the way the seeding copy will —
  **symlink targets included**, since a link is just another name for content the copy
  resolves and stages.
- **The sandbox environment does not.** Unlike `share.secret_env`, a generated value is
  never forwarded — an agent that can read its own environment would not have to do the
  task.
- **The prompt may not carry it either**, and **the report does not**.

Two consequences: the expectation must be **derived, not planted** (a "find the row
where…" bench fails the leak assertion; sums, counts and checksums pass, because
computing them is the task), and **per-run means per Eval `runs:` entry** — `--repeat N`
reuses one staged tree on purpose, so a repeat re-measures the *same* task.

**`image: generated:<name>`** composes the two: the generator writes the picture into
`$MADBENCH_IMAGE_DIR` — a sibling directory that is **never seeded** — and the Scenario
names it with the `generated:` prefix. The two directories must stay apart: the leak
assertion compares bytes, and the answer to "what colour is this?" is pixels, so a
swatch sitting in the working tree would pass every leak check ever written while
handing the answer to any agent whose `Read` tool renders images.

## Case-directory format

Instead of YAML entries, a directory containing `assert.yaml` is loaded as one case:

```
my-case/
├── assert.yaml    # a FULL Suite document (required) — not a bare assert: list
├── input.md       # the prompt (optional)
├── setup.sh       # listed in loader docs but NOT executed (comment-only, unwired)
└── expected/      # likewise documented but not implemented
```

`assert.yaml` unmarshals into a complete `Suite` (`internal/loader/loader.go`
`loadCaseDir`) — write it with the same top-level shape as a bench file. Don't rely
on `setup.sh`/`expected/`: the loader mentions them but no code runs them yet.
Passing a directory to `madbench` walks `.yaml`/`.yml` files and detects case dirs.

## Loading & validation behavior

- Parse: **strict decode (`KnownFields`)** → `NormalizeAliases()` → `testdata` resolved
  relative to the YAML file's dir → `file://` values resolved → `defaultCase` merged
  into each case.
- **Unknown keys are load errors**, naming file, line and Go type:

  ```
  Error: loading bench.yaml: parsing bench.yaml: yaml: unmarshal errors:
    line 5: field input not found in type madbench.ScenarioSpec
  ```

  Every accepted alias (`runner:`, `cases:`, `assert:`, `fixture:`, …) is a real struct
  field with a yaml tag, so strict decoding does not break them.

- **Where strictness stops — three real gaps:**

  | Gap | Why | What still bites |
  |---|---|---|
  | `harness_config:` | an untyped map handed to the harness | `temperature: 0.2` loads clean, preflights clean, is never read |
  | value *semantics* | strict decoding checks key **names**, not values | `timeout: 600` is a valid string; `ParseDuration` then rejects it and the timeout silently falls back to 120s |
  | `vars:` / `metadata:` / check `args:` | open by design | a typo'd key inside them reaches your grader as a missing lookup |

- **`x-` keys are the one exception — since v0.10.2.** A key whose name begins with
  `x-` is accepted and ignored at every level, in bench files and Eval files alike.
  On **v0.10.0 / v0.10.1** it is still a load error, so check your binary (Step 0)
  before relying on it:

  ```yaml
  x-shared:                     # ← line 3: field x-shared not found in type madbench.BenchSpec
    prompt: &build_auth |
      ...
  ```

  `x-` is the extension-key convention — a key the consuming tool ignores by contract,
  so anchors have somewhere to live (HTTP `X-` headers, OpenAPI "Specification
  Extensions", Docker Compose `x-` fields, which document it for exactly this purpose).
  `shared` is just a label; `x-` is the whole contract. The exemption is a **prefix, not
  a substring** — `max-tokens:` is still an unknown-field error — and an `x-` key beside
  a real typo still fails, naming only the typo.

  This matters because anchors are the only way to guarantee two scenarios get a
  **byte-identical** prompt, which is exactly what a controlled comparison needs. The
  alternative is copy-paste, where one edited copy silently confounds the experiment —
  an A/B measuring two variables and reporting one. An anchor cannot be declared
  free-standing, so without an ignored key the definition has to live inside the first
  scenario that uses it, making that scenario the master copy.

  **The portable answer, correct on every version: declare the anchor on its first
  real use** and alias it afterwards — YAML allows `&name` on any node:

  ```yaml
  scenarios:
    - name: bare
      prompt: &task |
        Write src/auth.ts so that `bun test` passes.
      checks: &grading
        - { type: exec, args: { cmd: [bun, test] } }
    - name: routed
      prompt: *task        # byte-identical, guaranteed by the parser
      checks: *grading
  ```

- Unknown check `type:` and a missing `file://` grader are **caught by `preflight`**
  now, not deferred to evaluate time.
- No file argument: discovers `madbench.yaml` then `madbench.yml` in cwd, else
  `no madbench.yaml or madbench.yml in <dir>`.

## Bench params + models (the bench's interface)

Benches run standalone with defaults; callers override only what changes:

```yaml
models:                # optional: named model definitions (modelspec union, same as judges:)
  fast: haiku-4.5
params:                # optional: declared incoming params WITH defaults
  model: fast          # default may reference a models: name or inline modelspec
  temp: 0.0
runner_config:
  model: "{{model}}"   # {{name}} substitution works in any string value in the file
  args: ["--temperature", "{{temp}}"]
```

- Effective value: incoming (Eval run entry / CLI `--param key=value`) > `params:` default.
- Whole-string placeholder keeps the value's native type (`"{{temp}}"` → `0.0` float);
  embedded placeholders stringify.
- Strict both ways: placeholder without a declared param → load error; incoming param
  not declared → load error. A null param value (YAML `null` default or empty) is a
  load error too — params must carry values.
- CLI `--param` typing is explicit, not YAML-1.1: strict int → int64, float →
  float64, exactly `true`/`false` → bool, `on`/`off`/`yes`/`no` stay STRINGS,
  empty/`null`/`~` → error.
- `runner_config.model` always accepts modelspec notation (`opus-4.8` →
  `LATEST_OPUS_MODEL`; unparseable strings pass verbatim).

## The Eval file (RUNNABLE — `docs/eval-file.md`)

Runs the same Bench across an explicit list of param sets. Detected by content
(top-level `bench:`/`runs:`), any `.yaml` name works; `madbench <file>` runs it
directly (no subcommand).

```yaml
description: "haiku vs opus"
bench: ./mybench/madbench.yaml   # relative to this file; nesting an Eval → error
models:                          # merged with the bench's models: (Eval wins)
  smart: opus-4.8
control:                         # optional — what these runs may differ by
  baseline: bare                 # defaults to the FIRST runs: entry
  varies: [CLAUDE.md]            # the ONLY paths allowed to differ
runs:                            # each entry = one full bench run
  - name: smart
    params: { model: smart }     # override ONLY what changes
  - {}                           # bench as-is (defaults); name auto-derived
```

- Expanded bench names: `"<eval description> · <run name>"` — these appear as TUI
  bench rows (model badge + param chips) and as `── <name>` group headers in Console
  output; JSON rows carry `bench:`.
- Strict decoding: ONLY `description`/`bench`/`models`/`control`/`runs` are legal
  top-level keys. **There is no cross-product** — a `matrix:` key (or any typo) is an
  unknown-field error. To run across several models/params, write explicit `runs:`
  entries.
- `--repeat N` repeats all runs (flake detection; the old `--runs` flag is a
  deprecated alias). `--run <name>` (repeatable) selects WHICH runs execute.

### `control:` — making the comparison auditable

An A/B is only a measurement if the runs differ by the thing you meant. `control:`
declares that axis, and madbench enforces it **before it provisions a sandbox or bills a
model**: it walks every run's staged inputs (each scenario's `testdata:` root,
`harness_config.agent_env`, `harness_config.system_prompt`), hashes them, and diffs each
run against the baseline.

```
── CONTROL ── 1 run(s) vs baseline `bare` · declared to vary: CLAUDE.md

  routed controlled  1 file(s), +107 B
    ~ CLAUDE.md  132 → 239 bytes  +107 B
```

The diff and size delta land in the console and under a `control` key in
`--report-json`. **An undeclared difference stops the Eval before any spend** — which is
the point: benches used to hand-roll `diff -rq A B | grep -v CLAUDE.md → "CONFOUNDED"`,
and a hand-rolled guard is one someone can forget to run.

Why the size delta matters as much as the diff: a base file can move underneath you
mid-session (one real case went 4,834 → 4,839 chars because a skill description was
edited elsewhere). A statically-copied variant would have desynchronised in silence, and
**that drift is the confound**.
