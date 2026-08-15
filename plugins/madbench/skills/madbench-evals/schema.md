# madbench bench file schema (`Suite`)

The runnable unit. Files named `madbench.yaml` / `madbench.yml` are auto-discovered in
cwd; any `*.yaml` path can be passed explicitly. Source of truth: `pkg/madbench/suite.go`,
loader in `internal/loader/loader.go`.

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
    sandbox: { level: container, image: "...", network: none, env: {...} }  # per-case override
    # ^ the key is `level:`. There is NO `mode:` key — `sandbox: {mode: container}`
    #   is silently dropped, passes preflight, and runs at the default `home` level.
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

- Parse: `yaml.Unmarshal` → `NormalizeAliases()` → `testdata` resolved relative to the
  YAML file's dir → `file://` values resolved → `defaultCase` merged into each case.
- **No schema validation pass.** Bad YAML fails with
  `loading <path>: parsing <path>: <yaml err line:col>`. Unknown check `type` only
  fails at RUN time.
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
runs:                            # each entry = one full bench run
  - name: smart
    params: { model: smart }     # override ONLY what changes
  - {}                           # bench as-is (defaults); name auto-derived
```

- Expanded bench names: `"<eval description> · <run name>"` — these appear as TUI
  bench rows (model badge + param chips) and as `── <name>` group headers in Console
  output; JSON rows carry `bench:`.
- Strict decoding: ONLY `description`/`bench`/`models`/`runs` are legal top-level
  keys. **There is no cross-product** — a `matrix:` key (or any typo) is an
  unknown-field error. To run across several models/params, write explicit `runs:`
  entries.
- `--repeat N` repeats all runs (flake detection; the old `--runs` flag is a
  deprecated alias).
