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

## Vocabulary (use these words)

User-facing terms map to Go types: **Eval** (eval file — runs the same Bench across a
list of param sets) → **Bench** = `Suite` → **Scenario** = `Case` → **Check** =
`Evaluator`. A **Harness** (`Runner`) + **Model** run the scenario; each **Action** is
an `Event`; an **Expectation** is a `threshold:`; a **Result** carries
`{Pass, Score, Reason, Evidence}`.

Say **testdata**, never "fixture" (`fixture:` is a legacy alias only).
Check kinds by what powers them: **Logic** (builtin matchers), **AI** (LLM judge),
**Code** (your script in a sandbox), **Service** (external API).

**Eval files are RUNNABLE** (`docs/eval-file.md`): `bench:` + `models:` + `runs:` list —
each entry one full bench run overriding only the params it changes. There is **no
matrix / cross-product** — never generate a `matrix:` key (strict decoding rejects it).
To run across several models/params, write explicit `runs:` entries. Details + bench-side `params:`/`{{name}}`
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
   `trajectory:*` (did it use Write/Edit?), string/structured Logic matchers.
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
    - { type: trajectory:tool-used, value: "Write" }
    - { type: trajectory:tool-used, value: "Edit" }
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
madbench list bench.yaml                        # parse check — does the YAML load?
madbench run bench.yaml --report-json out.json  # the real run
madbench run bench.yaml --ui                    # live TUI dashboard
madbench bench.yaml --repeat 5                  # flake detection (bypasses --ui)
madbench bench.yaml --param model=opus-4.8      # override a declared bench param
madbench my-models.eval.yaml                    # Eval file: runs the bench per runs: entry
```

`madbench list` only validates YAML shape — an unknown check `type` fails at **run**
time (`unknown string assertion: <name>`), so always do one real run before shipping.
Exit code is non-zero if anything failed or errored.

### 6. Tune expectations from data, not vibes

Cost/latency vary run to run (~2.6× cost variance observed). Start generous
(`cost` threshold 0.10 USD, `latency` 60000 ms), run 2–3 times, then tighten to
~1.5–2× the observed max. If a healthy run crosses the bar, raise the Expectation —
don't re-roll. Read `results[].assertions[].{pass,score,evidence,reason}` and
`results[].session.{metrics,trajectory}` from the report JSON.

## Workflow: reviewing an existing bench

Check, in order:
1. **Runs at all?** `madbench list`, then one real run.
2. **Permission mode** matches what scenarios require (write → `acceptEdits`+).
3. **Red-state testdata** — would a no-op agent fail this bench?
4. **Deterministic core** — at least one Logic check; AI judges only where judgment is
   genuinely needed (a bench graded only by `llm-rubric` is flaky and expensive).
5. **Anti-cheat guards** present for exec-graded work.
6. **Legacy aliases** (`tests:`, `fixture:`, `defaultTest:`) → suggest canonical
   `cases:`/`testdata:`/`defaultCase:`.
7. **Expectations** neither vacuous (never fail) nor overfit to one run.

## Gotchas that bite

- `trajectory:step-count` bounds go in `args.lte:` / `args.gte:` — `threshold:` means
  exact match here.
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
