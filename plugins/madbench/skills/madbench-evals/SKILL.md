---
name: madbench-evals
description: Authors, runs and debugs madbench benches natively — bench YAML, checks, metrics with module/, red-state testdata, the two controls, exit codes; drafts an upstream issue instead of a wrapper. Use when writing, reviewing or debugging any bench.
user-invocable: false
disable-model-invocation: true
---
<!-- Hidden on purpose: it costs no listing budget and cannot be preloaded. Its consumer,
     the madbench:operator agent, reads this file BY PATH, so the preload block starves nothing. -->

# madbench Evals — author, run, debug

madbench is a Go harness that benchmarks agentic coding tools (Claude Code, etc.). You write a
**bench file** (`madbench.yaml` / `*.madbench.yaml`), point it at a harness and model, give it
scenarios with seeded testdata, and grade the agent's work with checks.

**The madbench release these files mirror is declared once, in `plugins/madbench/mirrors.json`.**
No file here restates a version number — five files each asserting one is how a removed key
stayed documented in five places. Reference files, read on demand:

- `schema.md` — every bench and Eval key: scenarios, `repo:` · `setup:` · `generate:` ·
  `image:` · `cwd:`, the sandbox block, **`metrics:` expressions and the bench's `module/`**,
  params and placeholders, `control:`
- `checks-catalog.md` — every check family, incl. the `environment:*` family (nine types),
  the 13 `session:*` types, thread/outcome scoping, matchers, `readout:`
- `runners-and-sandbox.md` — `harness_config`'s keys, `interactive:` and permission modes,
  sandbox levels, the environment probe and MCP preflight, the whole CLI, **exit codes**
- `debugging.md` — error→cause map, the two controls, report-JSON analysis, tuning

Every madbench capability claim in these files carries a `docs/<file>.md:<line>` citation
into the madbench checkout's `docs/`. Never `pkg/**/*.go`: the checkout builds `dev`.

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
`{Pass, Score, Reason, Evidence}`. One `--repeat` execution is a **Pass**.

Two more that carry weight:

- **Control** — what an Eval's runs are ALLOWED to differ by. An undeclared difference stops
  the Eval before any spend.
- **Environment** — what the agent was **GIVEN**, not what it did. It splits in two:
  **Expected** (what madbench staged, its own claim) and **Reported** (what the tool said it
  loaded, the evidence). That split is the whole point — see the `environment:*` family.

`…Spec` = the declarative YAML form; the bare word is the live configured component.
`Suite`, `Case`, `Runner` and `Event` are **not madbench types** — don't grep for them.

### Banned words

madbench retired these because each had a correct word already (`docs/vocabulary.md:738-751`).
The ban covers documentation, YAML keys and values, examples, READMEs and CLI output.

| Never write | Write | Why |
|---|---|---|
| **arm** | **run** | clinical-trial jargon; an Eval's `runs:` list has one entry per run |
| **fixture** | **testdata** | `fixture:` survives only as an accepted YAML alias |
| **trajectory** | **Session** | `trajectory:*` checks are `session:*`; old spelling loads, never written |
| **matrix** | **runs** / **params** | there is no cross-product; the loader rejects `matrix:` outright |
| **cell** | **Check** / **MetricValue** | one graded (Scenario, Check) pair is a **Check**; one number in the report is a **MetricValue**. Retired upstream 2026-09-08 — `madbench check` now prints *"2/2 checks failed as required"*, never "cells" |
| **round** | **turn** | one prompt→work→stop cycle; "3 rounds" collides with `--repeat` |

The environment prefix is `environment:`, **never** `env:` — `env` already means environment
*variables*.

**The carve-out, stated so nobody over-applies it:** a banned word may name **another
tool's** feature. "Promptfoo builds a matrix" is a quotation; "madbench's matrix" is a
violation. The test is whose concept the word names (`docs/vocabulary.md:759-771`). A
mechanical checker can inspect YAML keys, not intent — so banned words in hand-written
documentation stay a review responsibility.

Check kinds by what powers them: **Logic** (builtin matchers), **AI** (LLM judge), **Code**
(your script in a sandbox), **Service** (external API).

## Native first — a wrapper is a defect

Start with the incident, because no wrapper would have caught it; a wrapper reads the same
wrong numbers. Recorded in the madbench commit that fixed it:

> A `--repeat 20` run completed 12 real passes, the account's API credit ran out, and the
> last 8 passes started an agent, were refused, and exited in ~8 seconds having done nothing.
> All 8 graded as scenario FAILURES, so the run reported 10/20 for a condition whose real
> data was 10/12 — a clean, plausible, publishable number for eight passes that never
> happened.

The rule that resolved it: **a `fail` row is a claim about the agent, so madbench must not
make one when it never obtained a measurement.** madbench now states it as its exit-code
rule — *a graded miss is a result; a session that never graded is a fault*
(`docs/README.md:90-96`). That fix lives in the harness. A tally script beside the bench
would have summed the eight fake failures with a straight face.

So: **madbench's own mechanism, or a drafted issue. Never a script around it.** Upstream
wrote the policy down when it refused Eval-level metrics:

> "the statistic belongs to the bench's own `module/`, and `--report-json` is the path.
> Adding a stage would turn a structural guarantee into a sentence in the docs."

| If you are about to hand-roll | Use instead | Where |
|---|---|---|
| arithmetic in a sibling script | `module/index.ts` — every export binds in every `metrics:` expression | `docs/metrics.md:229-243`; `schema.md` §8 |
| a stats post-process over the report | `metrics:` with `mean`/`p50`/`p95`/`sum`/`count` | `docs/metrics.md:160` |
| a cross-run statistic | a **post-hoc module over `--report-json`** — aggregation stops at the run by design, and that is not a gap | `docs/metrics.md:456-461` |
| a "did every check fail under mock" tally parser | `madbench check` — the per-check tally is the product | `madbench help check`; `debugging.md` |
| a re-grader over a stored report | `madbench grade <report.json>` | `runners-and-sandbox.md` §9 |
| a script that writes `known_marketplaces.json` | `harness_config.plugins:` (+ `marketplace:` for the short form) | `docs/harness.md:911-931` |
| a "these runs differ only by X" guard | `control: {baseline, varies}` on the Eval | `docs/eval-file.md:143`; `schema.md` §9 |
| a sentinel token planted to prove a file was read | `session:file-read` | `docs/checks.md:299` |
| a "did the MCP server come up" probe script | `environment:mcp-reachable`, asserted before any spend | `docs/checks.md:611` |
| a PNG pipeline feeding the prompt | `image: generated:<name>` + `$MADBENCH_IMAGE_DIR` | `docs/harness.md:284-308` |
| a CI wrapper mapping exit codes | `--fail-on-failure` | `docs/README.md:100-108` |
| a version-string gate on the skill | `madbench version` + `mirrors.json`, and `madbench list` over a shipped example bench — a bench the skill teaches that the binary refuses to load is the finding | Step 0 |
| a terminal scraper for the numbers | `--report-json` / `--report-dir` | below |

**If a reader needs a comment to trust a number, that comment is a check you have not
written yet.** "The plumbing was verified out of band" is an `environment:mcp-reachable` or
`environment:matches-expected` row that belongs in the bench.

## Runs are visible

A real bench run happens in a **visible split pane, in colour**. Measured on the installed
binary: colour is the default and survives a pipe — `madbench demo` redirected to `tail`
still emitted 24-bit truecolor. Nothing needs building.

- `--ui` is the live dashboard. Plain coloured stdout is the default and is right for most runs.
- **`--plain` is the CI shape.** It is implied when stderr is not a terminal or under
  `NO_COLOR`/`TERM=dumb` (`madbench --help`). Choosing it interactively throws away the thing
  the user asked to watch.
- **Never background a run.** Backgrounding hides it, which is the opposite of the request.
  One run at a time.
- **Evidence comes from `--report-json` / `--report-dir`, never from scraping the terminal.**
  Reading numbers off a pane capture was always the wrapper-shaped answer; the report carries
  the graded verdicts, the metrics and the Session, and `--report-dir` writes incrementally
  so a run that dies mid-flight still leaves a readable partial.

`list`, `preflight`, `check` and `grade` are different: their text output *is* the result
and is quoted verbatim, so they run through plain Bash.

## Exit codes — a graded miss is 0

**Undocumented in older copies of this skill, and it fails in the safe-looking direction.**
A scenario that fails its checks exits **0**; `--fail-on-failure` opts back in; an errored
scenario exits 1 unconditionally (`docs/README.md:88-112`). Observed live, madbench's own
last line after `madbench demo`:

```
exit 0: 1 scenario failed — scenario outcomes, not a harness crash
```

A CI job that treats nonzero as its failure signal reads a bench whose every scenario failed
as green. Full table in `runners-and-sandbox.md` §9.

## The scoring contract

Every check returns `Score` in **[0,1] where higher is always better** — even for
lower-is-better metrics. Raw values belong in `Evidence`, never in the primary score. Name a
score with `metric:` (defaults to the check `type`); that name is what the top-level
`metrics:` expressions read (`mean(accuracy)`).

At the Scenario level there is **no partial credit**: a Scenario passes iff every top-level
check passes (a composite counts as one — put partial credit INSIDE an `assert-set`).
Scenario-level `threshold:` is parsed but **never evaluated**.

**`readout: true` measures without grading.** The check runs, scores, and reports, and its
named score reaches `metrics:` — it just cannot fail the Scenario. Use it when the answer
changes how *good* the result was rather than what you would *do*. An **erroring** readout
still fails the Scenario: a check that could not run measured nothing.

**Every check is a POSITIVE assertion.** `madbench check` runs the bench under a mock that
does nothing and requires every graded check to fail. A fence (`session:tools-only`), an
absence assertion (`not-any-of`) or an anti-cheat invariant passes against that mock by
construction, so the control reports it as `WRONGLY PASSED` and exits 1. Only `latency` and
`cost` are exempt (`madbench help check`). Express every intent as the presence of the
wanted behaviour, and pair every fence with an activity check.

---

## Workflow: creating a bench

### 1. Design — copy the nearest example

Don't start from a blank file. `examples/` beside this file holds one loadable bench per
version-sensitive surface the skill teaches; the madbench repo's `examples/` has one template
per task shape. Copy the closest and adapt.

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

`setup:` and `generate:` are mutually exclusive on one scenario, and each runs **once per
bench**, not once per Scenario. Every staged path resolves against the bench file's
directory, so a bench runs from any cwd. Details: `schema.md` §5.

### 3. Choose checks — deterministic first

1. **Deterministic** — `exec` (run the tests!), `session:*` (did it use Write/Edit? read that
   file? invoke that skill? stay inside a tool fence?), `environment:*` (did the plugin
   actually load? did the MCP server answer?), string/structured matchers. Free and fast.
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

**Measure with `metrics:`, not with a script.** A check pushes what it contributes
(`metrics: ["metrics.wins += score > 0.6 ? 1 : 0"]`), the top-level block aggregates
(`metrics.passRate = mean(passed)`), and arithmetic that outgrows one line is an export from
the bench's own `module/index.ts`. `schema.md` §8.

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

Interactive needs magmux on this machine, **checked by capability, never by version** —
preflight runs `magmux --help` and looks for the flags madbench passes (`docs/harness.md:1520-1536`).
It checks only when some Scenario is interactive, and names `interactive: false` as a way out.

Use `harness: mock` for offline YAML development.

### 5. Validate, then run

```bash
madbench list bench.yaml            # proves it PARSES — not that it runs
madbench preflight bench.yaml       # proves it COULD RUN (binaries, keys, magmux, MCP declarations, module/)
madbench check bench.yaml           # NEGATIVE control: every graded check must fail
madbench demo                       # offline emulated bench: no keys, no spend
madbench bench.yaml --harness mock  # dry-run your YAML offline
madbench bench.yaml --report-json out.json  # a real run: in a visible pane, default renderer, never --plain or --ui
madbench bench.yaml --report-dir .reports   # versioned, incrementally written history
madbench bench.yaml --fail-on-failure       # CI: exit 1 on a failed scenario
madbench grade out.json             # POSITIVE control: re-grade offline
madbench bench.yaml --repeat 5      # flake detection — rates, not anecdotes
madbench my-models.eval.yaml        # Eval file: one bench run per runs: entry
```

**Preflight is automatic** — every run preflights first and refuses to start if anything
blocks. **Never use `list` as your gate**: it gives a confident exit 0 on a bench that cannot
start. The full `list` vs `preflight` vs run table is in `runners-and-sandbox.md` §9.

**The two controls.** Preflight asks *can this run*; the controls ask *does this bench measure
anything*:

- **`madbench check`** runs under the mock harness and requires **every graded check to
  fail**, with a per-check tally. Exit 0 = the control holds, 1 = a check wrongly passed or
  could not be graded, 3 = nothing gradable. `latency`, `cost` and `environment:mcp-reachable`
  are reported NOT APPLICABLE and left out of the verdict; an ERRORED check gets its own
  bucket rather than counting as a failure.
- **`madbench grade <report.json>`** re-grades a recorded Session offline and checks every
  verdict reproduces. It re-runs the evaluators, so non-deterministic grading shows as DIVERGED.

### 6. Tune expectations from data, not vibes

Cost and latency vary run to run. Start generous, run 2–3 times, then tighten to ~1.5–2× the
observed max. If a healthy run crosses the bar, raise the Expectation — don't re-roll.

Read `results[].checks[].result.{pass,score,evidence,reason}` and
`results[].session.{metrics,actions,calls}` from the report JSON. **`actions` is the
authoritative event stream; `calls` its lossy tool-call view.** Read `.summary.errors`
before `.summary.failed`. Full key map in `debugging.md`.

---

## Workflow: reviewing an existing bench

1. **Runs at all?** `madbench preflight` (not `list`), then `madbench check`.
2. **Drive mode declared?** An interactive bench (the default) carrying `acceptEdits` will
   hang on its first Bash call. It wants `bypassPermissions`, or `interactive: false`.
3. **Timeout declared?** The fallback is 300s. A cold-start interactive turn can approach it.
4. **Red-state testdata** — would a no-op agent fail? `madbench check` answers per check; do
   not eyeball it.
5. **Deterministic core** — at least one Logic check. A bench graded only by `llm-rubric` is
   flaky and expensive.
6. **Anti-cheat guards** present for exec-graded work, every fence paired with an activity
   check, and every check a positive assertion.
7. **Aliases** → canonical. `runner:`/`runner_config:`/`cases:`/`tests:`/`assert:`/`fixture:`/
   `defaultCase:`/`defaultTest:` all still load. So does `trajectory:*` — rewrite to `session:*`.
   `matrix:`, top-level `name:` and the retired derived-metrics key do **not** load.
8. **Sandbox level** is `none | workspace | home | container` (default `home`). A bench still
   saying `sandbox: process` does not load at all.
9. **Expectations** neither vacuous nor overfit to one run.
10. **Arithmetic in `module/`**, not in a sibling script; no `.ts` loose at the bench root
    unless a check names it as a `file://` target.
11. **CI invocation** carries `--fail-on-failure` if a miss is meant to go red.

---

## A gap: look, classify, draft — never a workaround

A gap becomes a **drafted issue**, never a script around madbench. But drafting comes second.

**Step 1 — LOOK. Mandatory; skipping it is the defect this rule exists to prevent.**
Consult, in order:

1. `madbench --help`, then `madbench help <command>` — the installed binary's own surface.
2. `docs/checks.md`, `docs/metrics.md`, `docs/harness.md`, `docs/vocabulary.md` in the
   madbench checkout (`docs/README.md` for exit codes; `docs/sandbox-and-testdata.md` for
   staging; `docs/eval-file.md` for Evals).
3. The closed issues on the madbench repository.

Three times in one session "madbench is missing X" turned out to be "X exists and was not
findable": derived metrics (upstream's own commit records an author drafting a request for
something `metrics:` expressions already did), image support (`image:` and `image: generated:` both
exist), and cross-run arithmetic (a post-hoc module over `--report-json`, by design).

**Step 2 — classify.**

| Finding | It is | Do |
|---|---|---|
| present and broken — reproduce command, real output, real exit code | a **bug** | draft a bug report |
| absent after the lookup | a **feature** | draft a feature request, stating why the workaround is unacceptable as a permanent answer |
| present but unfindable | **neither** — a documentation defect *here* | fix the skill file; nothing goes upstream |

**Step 3 — draft, do not file.** Drafts go to `docs/madbench-issues/` in this repo, dated,
one file per issue. The worked example is
`docs/madbench-issues/2026-08-22-negative-control-vs-absence-checks.md`: it carries the
`madbench version` and build revision, the reproduce command with its real output, a
severity table, and the distinction between the bug and the feature that would close it.
Every draft carries `madbench version`, a reproduce command with its real output and exit
code, and — for a feature — why the workaround is unacceptable. Filing is the user's call.

---

## Gotchas that bite

- **`interactive: true` is the default, and permission mode means different things on the two
  paths.** See step 4 — this is the one that silently costs you a timeout.
- **A graded miss exits 0.** `--fail-on-failure` for CI; errors are nonzero regardless.
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
- **`latency` and `cost` are NOT APPLICABLE when the harness reported no metrics**, and are
  exempt from `madbench check`. A count ceiling is **not** exempt — fix `lte`-only guards
  with a floor.
- **An unprobed `environment:*` check is loud, never a pass.** `probe: false` leaves Reported
  absent; upstream's `harness.md:1130` says every `environment:*` check then ERRORS, and
  `madbench check` lands an unprobeable check outside the verdict (`docs/checks.md:838-840`).
  Read the bucket the control prints. `checks-catalog.md` §9 has the per-type table.
- **`environment:mcp-reachable` takes the bench's document key**, never the tool's
  `plugin:…:…` spelling; a typo is caught at preflight, exit 3.
- **`harness_config.environment.require: true` refuses the run before any spend** when a
  staged plugin did not load or a declared MCP server did not answer. The scenario is an
  ERROR, not a FAIL: it never ran. `probe: false` with `require: true` is refused at load.
- **An `image:` bench cannot be negative-controlled** — the mock is not `ImageCapable`.
- **Missing is not zero in `metrics:`.** `mean` of nothing is `n/a`; `sum` and `count` of
  nothing are a real `0`; a run-time throw is a `metric_error`, never a silent hole.
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
