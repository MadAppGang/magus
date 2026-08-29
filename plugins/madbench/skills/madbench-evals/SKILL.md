---
name: madbench-evals
description: Authors, runs, and debugs madbench evals — bench YAML, checks, red-state testdata, the two controls (check / grade), expectation tuning. Use when writing or reviewing a madbench.yaml or Eval file, choosing checks, or debugging a failing bench.
user-invocable: false
---

# madbench Evals — author, run, debug

madbench is a Go harness that benchmarks agentic coding tools (Claude Code, etc.). You write a
**bench file** (`madbench.yaml` / `*.madbench.yaml`), point it at a harness and model, give it
scenarios with seeded testdata, and grade the agent's work with checks.

**These files mirror madbench v0.23.0.** Reference files, read on demand:

- `schema.md` — every bench and Eval key: scenarios, `repo:` · `setup:` · `generate:` ·
  `image:` · `cwd:`, the sandbox block, `metrics:`, params and placeholders, `control:`
- `checks-catalog.md` — all 92 check types by family, incl. the `environment:*` family, the
  13 `session:*` types, thread/outcome scoping, matchers, `readout:`
- `runners-and-sandbox.md` — `harness_config`'s nine keys, `interactive:` and permission
  modes, sandbox levels, the environment probe, the whole CLI
- `debugging.md` — error→cause map, the two controls, report-JSON analysis, tuning

## Step 0 — check what you actually have

```bash
madbench version          # there is no --version flag
```

**A conclusion drawn from source you did not build is a conclusion about a different
program.** Reading `main` in the madbench checkout tells you what the *next* release does, not
what the binary on your PATH does. If the binary is older than a feature you are relying on,
`madbench update`, or rebuild from the repo and use that binary.

## Vocabulary (use these words)

**Eval** (runs the same Bench across a list of param sets) → **Bench** = `madbench.BenchSpec`
→ **Scenario** = `madbench.ScenarioSpec` → **Check** = `check.Spec` graded by a `check.Check`.
A **Harness** (syn. Target) + **Model** run the scenario, producing a **Session** made of
**Action**s. An **Expectation** is a `threshold:`; a **Result** carries
`{Pass, Score, Reason, Evidence}`.

Two more that carry weight:

- **Control** — what an Eval's runs are ALLOWED to differ by. An undeclared difference stops
  the Eval before any spend.
- **Environment** — what the agent was **GIVEN**, not what it did. It splits in two:
  **Expected** (what madbench staged, its own claim) and **Reported** (what the tool said it
  loaded, the evidence). That split is the whole point — see the `environment:*` family.

`…Spec` = the declarative YAML form; the bare word is the live configured component.
`Suite`, `Case`, `Runner` and `Event` are **not madbench types** — don't grep for them.

Say **testdata**, never "fixture" (`fixture:` is an accepted alias only). Write `session:`,
never `trajectory:`. The environment prefix is `environment:`, **never** `env:` — `env`
already means environment *variables*.

Check kinds by what powers them: **Logic** (builtin matchers), **AI** (LLM judge), **Code**
(your script in a sandbox), **Service** (external API).

## The scoring contract

Every check returns `Score` in **[0,1] where higher is always better** — even for
lower-is-better metrics. Raw values belong in `Evidence`, never in the primary score. Name a
score with `metric:` (defaults to the check `type`).

At the Scenario level there is **no partial credit**: a Scenario passes iff every top-level
check passes (a composite counts as one — put partial credit INSIDE an `assert-set`).
Scenario-level `threshold:` is parsed but **never evaluated**.

**`readout: true` measures without grading.** The check runs, scores, and reports, and its
named score reaches `metrics:` — it just cannot fail the Scenario. Use it when the answer
changes how *good* the result was rather than what you would *do*. An **erroring** readout
still fails the Scenario: a check that could not run measured nothing.

---

## Workflow: creating a bench

### 1. Design — copy the nearest example

Don't start from a blank file. In the madbench repo, `examples/` has one template per task
shape — copy the closest and adapt.

### 2. Scaffold testdata in red state

`testdata:` is a directory copied fresh into the sandbox for each scenario. Seed it **red**: a
failing test, a missing symbol, a bug — so the agent must do real work and a no-op run fails.
Keep it small (<10 files). Verify the red state manually before wiring checks; a
green-from-the-start bench proves nothing.

Four keys stage a workspace, and they compose in this order:

| Key | Stages |
|---|---|
| `repo:` | a third-party checkout, pinned at a ref — the base |
| `testdata:` | copied **over** the checkout, so a bench can add its own files to code it does not own |
| `setup:` | a program that builds testdata and keeps **no** expectation |
| `generate:` | a program that builds testdata **and computes the answer**, which madbench then refuses to run if it is findable in the tree |

`setup:` and `generate:` are mutually exclusive on one scenario. Details: `schema.md` §5.

### 3. Choose checks — deterministic first

1. **Deterministic** — `exec` (run the tests!), `session:*` (did it use Write/Edit? read that
   file? invoke that skill? stay inside a tool fence?), `environment:*` (did the plugin
   actually load?), string/structured matchers. Free and fast.
2. **AI** (`llm-rubric`, `factuality`, …) — only for genuine judgment calls. Needs a judge;
   default threshold 0.7.
3. **Code** (`ts`/`js`/`python`, `custom:gosrc`, `custom:wasm`, `custom:exec`).
4. **Service** (`custom:http`, `model:current`).

Always add **anti-cheat guards**: an agent can pass `go test` by deleting the test.

```yaml
- type: exec
  args: { cmd: [go, test, ./...], expected_exit: 0 }
- type: exec        # anti-cheat: the test file still contains its cases
  args: { cmd: [sh, -c, 'test "$(grep -c "\"FizzBuzz\"" fizzbuzz_test.go)" -ge 4'] }
- type: any-of      # the agent actually edited, didn't just talk
  checks:
    - { type: session:tool-used, value: "Write" }
    - { type: session:tool-used, value: "Edit" }
```

**Prefer an allowlist to a denylist.** `session:tools-only` names what the run *may* do in one
line and cannot rot; a `not-any-of` over `session:tool-used` has to be extended by hand every
time the tool surface grows. Pair either with a check that asserts activity — a fence alone
keeps passing if the agent regresses to doing nothing.

### 4. Drive mode and permissions — the #1 gotcha

**`interactive: true` is the DEFAULT.** The agent runs in a real terminal hosted by magmux,
many turns, steerable. `interactive: false` is the one-shot `--print` pipe.

**`--print` ignores `--permission-mode` entirely** (measured against CLI 2.1.234) — every tool
is allowed, because there is nobody to ask. Interactively the mode is real:

| mode | `--print` | interactive *(default)* |
|---|---|---|
| `default` / `acceptEdits` | everything runs | Write/Edit run; **Bash parks at an approval menu nobody can answer** |
| `bypassPermissions` | everything runs | everything runs |

```yaml
harness_config:
  model: <a current model id>
  args: ["--permission-mode", "bypassPermissions"]   # what an interactive bench needs
```

**On the default interactive path, `acceptEdits` hangs the first Bash call until the
timeout.** A bench carrying `acceptEdits` from the `--print` era was never getting anything
from it; `bypassPermissions` is not a widening of access, it is the access it already had.

Interactive needs **magmux ≥ 0.8.0** on this machine. Preflight checks for it only when some
Scenario is interactive, and names `interactive: false` as a way out.

Use `harness: mock` for offline YAML development.

### 5. Validate, then run

```bash
madbench list bench.yaml            # proves it PARSES — not that it runs
madbench preflight bench.yaml       # proves it COULD RUN
madbench check bench.yaml           # NEGATIVE control: every gradable cell must fail
madbench demo                       # offline emulated bench: no keys, no spend
madbench bench.yaml --harness mock  # dry-run your YAML offline
madbench bench.yaml --report-json out.json
madbench bench.yaml --report-dir .reports   # versioned history for `madbench report`
madbench bench.yaml --ui            # live TUI dashboard
madbench grade out.json             # POSITIVE control: re-grade offline
madbench bench.yaml --repeat 5      # flake detection
madbench my-models.eval.yaml        # Eval file: one bench run per runs: entry
```

**Preflight is automatic** — every run preflights first and refuses to start if anything
blocks. **Never use `list` as your gate**: it gives a confident exit 0 on a bench that cannot
start. The full `list` vs `preflight` vs run table is in `runners-and-sandbox.md` §9.

**The two controls.** Preflight asks *can this run*; the controls ask *does this bench measure
anything*:

- **`madbench check`** runs under the mock harness and requires **every gradable cell to
  fail**, with a per-cell tally. Exit 0 = the control holds, 1 = a cell wrongly passed or
  could not be graded, 3 = nothing gradable. `latency` and `cost` are reported NOT APPLICABLE
  and left out of the verdict; an ERRORED cell gets its own bucket rather than counting as a
  failure.
- **`madbench grade <report.json>`** re-grades a recorded Session offline and checks every
  verdict reproduces. It re-runs the evaluators, so non-deterministic grading shows as DIVERGED.

### 6. Tune expectations from data, not vibes

Cost and latency vary run to run. Start generous, run 2–3 times, then tighten to ~1.5–2× the
observed max. If a healthy run crosses the bar, raise the Expectation — don't re-roll.

Read `results[].checks[].result.{pass,score,evidence,reason}` and
`results[].session.{metrics,actions,calls}` from the report JSON. **`actions` is the
authoritative event stream; `calls` its lossy tool-call view.** Full key map in `debugging.md`.

---

## Workflow: reviewing an existing bench

1. **Runs at all?** `madbench preflight` (not `list`), then `madbench check`.
2. **Drive mode declared?** An interactive bench (the default) carrying `acceptEdits` will
   hang on its first Bash call. It wants `bypassPermissions`, or `interactive: false`.
3. **Timeout declared?** The fallback is 300s. A cold-start interactive turn can approach it.
4. **Red-state testdata** — would a no-op agent fail? `madbench check` answers per cell; do
   not eyeball it.
5. **Deterministic core** — at least one Logic check. A bench graded only by `llm-rubric` is
   flaky and expensive.
6. **Anti-cheat guards** present for exec-graded work, and every fence paired with an
   activity check.
7. **Aliases** → canonical. `runner:`/`runner_config:`/`cases:`/`tests:`/`assert:`/`fixture:`/
   `defaultCase:`/`defaultTest:` all still load. So does `trajectory:*` — rewrite to `session:*`.
8. **Sandbox level** is `none | workspace | home | container` (default `home`). A bench still
   saying `sandbox: process` does not load at all.
9. **Expectations** neither vacuous nor overfit to one run.

---

## Gotchas that bite

- **`interactive: true` is the default, and permission mode means different things on the two
  paths.** See step 4 — this is the one that silently costs you a timeout.
- **The default scenario timeout is 300s**, raised from 120s because 120 was calibrated for
  `--print`. Declare your own.
- **Sandbox levels are `none | workspace | home | container`, default `home`.** They answer
  one question: *what does the run get its own copy of?* The retired spellings `process`
  (→ `home`), `machine` and `docker` (both → `container`) are **REFUSED, not aliased**, as a
  **load** error every command rejects identically. Only `container` confines a process.
- **`sandbox: none` is gated twice** — the bench asks by name, and the operator passes
  `--allow-host-writes`. It cannot run concurrently, and `madbench check` still needs the flag
  because the **checks run for real** in your actual directory.
- **The three counting checks share one bound grammar**: `args.lte` / `args.gte` / `args.eq`,
  with `min`/`max` accepted. Both ends of a range bind. A `session:step-count` with no bound
  at all is refused at construction.
- **`session:tool-used` counts per named tool, never aggregate.** `value: [Read, Grep]` with
  `gte: 2` means *each* at least twice.
- **`session:*` checks do not all read the same thing.** `session:tool-used` reads the
  authoritative `Actions` and unions `Calls`; `session:tool-sequence` and
  `session:tool-args-match` read only `Calls`, so neither sees a subagent spawn or a skill.
- **`session:step-count` counts the MAIN thread only.** A subagent's work is in
  `Session.Subagents`; scope a `session:tool-used` with `args.thread:` to count it.
- **`args.outcome` grades whether the call worked** — `any` (default) · `ok` · `error`.
  **Unknown satisfies neither `ok` nor `error`**, and unknown is the majority state: a
  perfectly successful `Read` records no outcome at all.
- **`latency` and `cost` ERROR when the harness reported no metrics**, and are exempt from
  `madbench check`. A count ceiling is **not** exempt — fix `lte`-only guards with a floor.
- **`environment:*` checks ERROR rather than fail when nothing was captured.** `probe: false`
  leaves Reported absent and every one of them errors — the correct loud outcome for a run
  that measured nothing.
- **`harness_config.environment.require: true` refuses the run before any spend** when a
  staged plugin did not load. The scenario is an ERROR, not a FAIL: it never ran.
  `probe: false` with `require: true` is refused at load.
- **An `image:` bench cannot be negative-controlled** — the mock is not `ImageCapable`.
- `assert-set` threshold defaults to **1.0**; set e.g. `0.66` for 2-of-3.
- `exec` has no shell: `value:` is whitespace-split argv. Use `cmd: [sh, -c, '…']` for pipes.
- `latency` threshold is **milliseconds**, `cost` is **USD**, `levenshtein` is max edit distance.
- `budget:` and `token_estimate:` are informational gauges — **not enforced**.
- **`cwd:` moves the agent, not `Session.WorkDir`.** Checks still resolve against the root.
- **No judge provider** (no `judges:` block AND no `ANTHROPIC_API_KEY`) → AI check types fail
  at construction with a message naming the fix. Check judge config before your spelling.
- String checks (`contains`, `regex`, …) grade ONLY the agent's final message, never files on
  disk — grade files with `exec`. There is **no `file:*` check family**.
- **`Session.FinalOutput` follows a delegation.** If the parent ended its turn without
  receiving a subagent's result, the final output is the answering thread's last message, not
  the parent's "I've launched a search agent…".
- `file://` script checks resolve relative to the YAML's directory; managed runtimes pin via
  `defaults.bun:` / `defaults.python:`.
- A scenario can also be a **case directory** (`assert.yaml` + optional `input.md`, `setup.sh`,
  `expected/`) — discovered when a directory is passed to `madbench`.

When debugging a failing or misbehaving bench, read `debugging.md`.
