---
name: madbench-evals
description: Authors, runs and debugs madbench benches natively — bench YAML, checks, metrics with module/, red-state testdata, the two controls, exit codes; drafts an upstream issue instead of a wrapper. Use when writing, reviewing or debugging any bench.
user-invocable: false
disable-model-invocation: true
---
<!-- Hidden on purpose: it costs no listing budget and cannot be preloaded. Its consumers —
     the `madbench` entry skill (`/madbench`) and any operator agent — read this file BY PATH,
     so the preload block starves nothing. -->

# madbench Benches and Experiments — author, run, debug

madbench is a Go harness that benchmarks agentic coding tools (Claude Code, etc.). You write a
**bench file** (`madbench.yaml` / `*.madbench.yaml`), point it at a harness and model, give it
scenarios with seeded testdata, and grade the agent's work with checks.

**These skills belong to madbench.** They are written in the madbench repository and ship with
the release they describe; any other copy is a copy. A mistake here is fixed upstream, never
by editing a copy.

**The madbench release these files were written for is in `MADBENCH_VERSION` beside this
file** — one line, `x.y.z`. No file here restates a version number — five files each
asserting one are five places to fall out of step with the binary. Reference files:

- `glossary.md` — **read first, every time** (Step 0): the terms, the deprecated and renamed
  terms, other tools' terms and what madbench calls each
- `schema.md` — every bench and Experiment key: scenarios, `repo:` · `setup:` · `generate:` ·
  `image:` · `cwd:`, the sandbox block, `driver:`, `unproven:`, **`metrics:` expressions and
  the bench's `module/`**, params and placeholders, `guard_changes:`, how an unknown key fails
- `checks-catalog.md` — every Check family, incl. the `environment:*` family (nine types),
  the 18 `session:*` types (the Driver's four and `session:match` among them),
  thread/outcome scoping, matchers, `readout:`, judges and `args.votes`
- `harness-and-sandbox.md` — the `harness:` block's keys, `interactive:` and permission modes,
  sandbox levels, the environment probe and MCP preflight, the whole CLI, **exit codes**
- `debugging.md` — error→cause map, the two controls, report-JSON analysis, tuning

Every madbench capability claim in these files carries a `docs/<file>.md:<line>` citation
into the madbench checkout's `docs/`. Never `pkg/**/*.go`: the checkout builds `dev`.

## Step 0 — the Glossary, then check what you actually have

Read `glossary.md` beside this file before anything else. Write only its words for madbench
concepts; translate the user's words, never echo them.

```bash
madbench skills --check   # first: madbench compares the installed skills with itself
madbench version          # only if `skills` does not exist (before 0.38.0); there is no --version flag
```

`--check` prints the verdict itself. When you compare by hand instead, set `madbench version`
against `MADBENCH_VERSION` beside this file. If they differ, say so before
anything else, in these words: *"You're using madbench X, but your madbench skills were
written for Y."* Skills older than the binary may teach keys the binary refuses; skills
newer than the binary teach features it does not have yet (`madbench update`). A
`MADBENCH_PINNED` file beside `MADBENCH_VERSION` means the set was pinned on purpose: say
"skills pinned to Y" instead. `madbench update --check` reports whether a newer madbench
exists and changes nothing.

**A conclusion drawn from source you did not build is a conclusion about a different
program.** Reading `main` in the madbench checkout tells you what the *next* release does, not
what the binary on your PATH does. If the binary is older than a feature you are relying on,
`madbench update`, or rebuild from the repo and use that binary.

## Glossary

**One table: `glossary.md`, beside this file, read at Step 0.** It holds madbench's terms,
the deprecated and renamed terms with the word that replaced each, and other tools' terms
with the madbench word for each. This file keeps no second copy.

Two notes it does not carry:

- `…Spec` is the declarative YAML form (`BenchSpec`, `ScenarioSpec`, `check.Spec`); the bare
  word is the live configured component.
- The Environment prefix is `environment:`, **never** `env:` — `env` already means
  environment *variables*.

## Native first — a wrapper is a defect

Start with the incident, because no wrapper would have caught it; a wrapper reads the same
wrong numbers. In short, as madbench commit 3a27c9d tells it: a 20-trial run completed 12
real trials, then the account's API credit ran out. The last 8 trials started an agent, were
refused, and exited in about 8 seconds having done nothing. All 8 graded as Scenario
failures, so the run reported 10/20 for a condition whose real data was 10/12: a clean,
plausible, publishable number for eight trials that never happened.

The rule that resolved it: **a `fail` row is a claim about the agent, so madbench must not
make one when it never obtained a measurement.** madbench states it as its exit-code
rule — *a graded miss is a result; a session that never graded is a fault*
(`docs/README.md:90-91`). That fix lives in the harness. A tally script beside the bench
would have summed the eight fake failures with a straight face.

So: **madbench's own mechanism, or an issue sent upstream. Never a script around it.** Upstream
wrote the policy down when it refused Experiment-level metrics:

> "the statistic belongs to the bench's own `module/`, and `--report-json` is the path.
> Adding a stage would turn a structural guarantee into a sentence in the docs."

| If you are about to hand-roll | Use instead | Where |
|---|---|---|
| arithmetic in a sibling script | `module/index.ts` — every export binds in every `metrics:` expression | `docs/metrics.md:229-243`; `schema.md` §8 |
| a stats post-process over the report | `metrics:` with `mean`/`p50`/`p95`/`sum`/`count` | `docs/metrics.md:160` |
| a cross-run statistic | a **post-hoc module over `--report-json`** — aggregation stops at the run by design, and that is not a gap | `docs/metrics.md:460-465` |
| a "did every check fail under mock" tally parser | `madbench check` — the per-check tally is the product | `madbench help check`; `debugging.md` |
| a script that re-grades a stored report | `madbench grade <report.json>`; with a revised check, `madbench grade <report.json> --bench <file>` grades the stored Sessions with the bench's current checks, no spend | `harness-and-sandbox.md` §9 |
| a script that writes `known_marketplaces.json` | `harness.config.plugins:` — plugin folders; the identity is derived | `harness-and-sandbox.md` §6 |
| a "these variants differ only by X" guard | `guard_changes: {allow}` on the Experiment — the baseline is the first declared variant; every declared variant is audited, whichever `--variant` selects to run | `docs/experiment-file.md`; `schema.md` §9 |
| a sentinel token planted to prove a file was read | `session:file-read` | `docs/checks.md:299` |
| a grep of the Session for a marker that reached the agent (a hook's output, an injected reminder, a subagent's report) | `session:match` | `docs/checks.md:307`, `:318-379` |
| a "did the MCP server come up" probe script | `environment:mcp-reachable`, asserted before any spend | `docs/checks.md:676` |
| a PNG pipeline feeding the prompt | `image: generated:<name>` + `$MADBENCH_IMAGE_DIR` | `docs/harness.md:315-361` |
| a CI wrapper mapping exit codes | `--fail-on-failure` | `docs/README.md:100-108` |
| a version-string gate on the skill | `madbench version` against `MADBENCH_VERSION` (or `madbench skills --check`), and `madbench list` over a shipped example bench — a bench the skill teaches that the binary refuses to load is the finding | Step 0 |
| a terminal scraper for the numbers | `--report-json` / `--report-dir` | below |

**If a reader needs a comment to trust a number, that comment is a check you have not
written yet.** "The plumbing was verified out of band" is an `environment:mcp-reachable` or
`environment:matches-expected` row that belongs in the bench.

## Runs are visible

A real bench run happens **where the user can watch it: by default, a split pane beside the
conversation**. Nothing needs building. Take the first of these that works:

1. **A terminal-pane tool in your harness** (a tmux or terminal plugin that opens a pane the
   user can see). Open a visible pane beside the conversation and run the bench there.
2. **You are inside tmux** (`$TMUX_PANE` is set). Split your own window:

   ```bash
   tmux split-window -h -d -t "$TMUX_PANE" -c "<bench directory>" \
     'madbench <bench> --report-json <absolute path>; echo "madbench exit $?"; read -r _'
   ```

   `-d` keeps focus on the conversation. The trailing `echo` prints the exit code, and `read`
   holds the pane open so the user can read the final verdict; they close it with Enter. The
   report path is absolute, because the pane starts in the bench directory.
3. **Neither.** Give the user `madbench <bench> --ui --report-json <path>` to run in their
   own terminal, and wait for them to say it has finished.

In a pane you opened, use madbench's **default coloured output**, not `--ui`. It ends on its
own when the run does, while `--ui` waits for a key to quit. Add `--watch` to show every
agent's live screen as well; it is the view for a driven interactive run (refused beside
`--ui`, `--plain` and `--manual`). The run is over when the report JSON exists and the pane
shows `madbench exit <code>`. Wait for that line rather than guessing from elapsed time, and
tell the user where the pane is while it runs. `--ui` belongs in the user's own terminal:
it is the live dashboard, and on quit it still writes `--report-json`/`--report-dir` and
exits with the run's own code.
- **`--plain` is the CI shape.** It is implied when stderr is not a terminal or under
  `NO_COLOR`/`TERM=dumb` (`madbench --help`), so piping a run turns it on. Choosing it
  interactively throws away the thing the user asked to watch.
- **Never background a run, never pipe one.** Either hides it, which is the opposite of the
  request. One run at a time.
- **Evidence comes from `--report-json` / `--report-dir`, never from scraping the terminal.**
  Reading numbers off a pane capture was always the wrapper-shaped answer; the report carries
  the graded verdicts, the metrics and the Session, and `--report-dir` writes incrementally
  so a run that dies mid-flight still leaves a readable partial.

`list`, `preflight`, `check` and `grade` are different: their text output *is* the result
and is quoted verbatim, so they run through plain Bash.

## Exit codes — a graded miss is 0

**It fails in the safe-looking direction.**
A scenario that fails its checks exits **0**; `--fail-on-failure` opts back in; an errored
scenario exits 1 unconditionally (`docs/README.md:88-112`). Observed live, madbench's own
last line after `madbench demo`:

```
exit 0: 1 scenario failed — scenario outcomes, not a harness crash
```

A CI job that treats nonzero as its failure signal reads a bench whose every scenario failed
as green. Full table in `harness-and-sandbox.md` §9.

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

**Every Check is POSITIVE.** `madbench check` runs the bench under a mock that
does nothing and requires every graded Check to fail. A fence (`session:tools-only`), an
absence Check (`not-any-of`, `session:match` with `eq: 0`) or an anti-cheat invariant
passes against that mock by construction, so the control reports it as `WRONGLY PASSED` and
exits 1. Only `latency`, `cost` and `environment:mcp-reachable` are left out of its verdict
(`madbench help check`). Express every intent as the presence of the wanted behaviour, and
pair every fence with an activity Check.

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

Always add **anti-cheat Checks**: an agent can pass `go test` by deleting the test.

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
harness:
  type: claude-code
  model: <a current model id>
  args: ["--permission-mode", "bypassPermissions"]   # what an interactive bench needs
```

**On the default interactive path, `acceptEdits` hangs the first Bash call until the
timeout.** A bench carrying `acceptEdits` from the `--print` era was never getting anything
from it; `bypassPermissions` is not a widening of access, it is the access it already had.

Interactive needs magmux on this machine, **checked by capability, never by version** —
preflight runs `magmux --help` and looks for the flags madbench passes (`docs/harness.md:1634-1661`).
It checks only when some Scenario is interactive, and names `interactive: false` as a way out.

**An interactive agent can stop and ask, and a Driver answers.** With no `driver:` block an
interactive claude-code Scenario gets the default Driver: it answers `AskUserQuestion` and
nothing else, runs the `claude` on this machine on its own login, and needs no API key.
`driver: false` makes a question fail the Scenario at once, by name, instead of being waited
out; `answers:` scripts the replies, and a script with a `match: "*"` catch-all needs no model
at all — what an A/B wants, since a model-answered question is a variable. `steer: true` lets
the Driver write prompts of its own. A Driver speaks inside the Session, so what it says is
part of what the Checks read. `driver:` on any harness but claude-code passes `list` and is
refused at `preflight`. Grade it with `session:question-asked`, `session:driver-source`, `session:answer-verified`
and `session:end-reason` (`docs/driving-a-session.md:49-113`; `checks-catalog.md`).

Use `harness: mock` for offline YAML development.

### 5. Validate, then run

```bash
madbench list bench.yaml            # proves it PARSES — not that it runs
madbench preflight bench.yaml       # proves it COULD RUN (binaries, keys, magmux, MCP declarations, module/)
madbench check bench.yaml           # NEGATIVE control: every graded check must fail
madbench demo                       # offline emulated bench: no keys, no spend
madbench bench.yaml --harness mock  # dry-run your YAML offline
madbench bench.yaml --report-json out.json   # a real run: in a split pane beside the conversation ("Runs are visible")
madbench bench.yaml --ui --report-json out.json  # the same run in the user's own terminal, when no pane can be opened
madbench bench.yaml --report-dir .reports   # versioned, incrementally written history
madbench bench.yaml --fail-on-failure       # CI: exit 1 on a failed scenario
madbench grade out.json             # POSITIVE control: re-grade offline
madbench bench.yaml --trials 5      # flake detection — rates, not anecdotes
madbench my-models.experiment.yaml  # Experiment: one run of the bench per variants: entry
```

**Preflight is automatic** — every run preflights first and refuses to start if anything
blocks. **Never use `list` as your gate**: it gives a confident exit 0 on a bench that cannot
start. The full `list` vs `preflight` vs run table is in `harness-and-sandbox.md` §9.

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
`results[].session.{metrics,events,calls}` from the report JSON (its `schema_version` and full key
map are in `debugging.md`; each Event carries `type` and `text`). **`events` is the authoritative stream; `calls` its lossy
tool-call view.** Under `--report-dir` the Session lives in a bench log beside the report,
not inline. Read `.summary.errors` before `.summary.failed`. Full key map in `debugging.md`.

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
6. **Anti-cheat Checks** present for exec-graded work, every fence paired with an activity
   Check, and every Check positive.
7. **Unknown keys are refused.** `madbench list` fails on a key the schema does not declare
   with `field X not found in type …`, and names no replacement: look the key up in
   `schema.md`. Bringing a bench written for an earlier madbench forward is
   `../migrate/SKILL.md`. A check type that names no Check passes `list` and is refused at
   `preflight` as `unknown check type` — which is why step 1 is `preflight`. `matrix:` and
   top-level `name:` do not load either.
8. **Sandbox level** is `none | workspace | home | container` (default `home`). Any other
   value does not load at all: `sandbox: unknown level "…" (want none, workspace, home,
   container)`. `docker` gets its own message, because it is a container engine:
   - `sandbox: "docker" is an engine, not a level — write "level: container" with "engine: docker" (want none, workspace, home, container)`
9. **An `unproven:` key** makes the bench refuse to load on every path, printing its text:
   the premise is not established. That is deliberate, not a defect to route around — the
   bench belongs in `unproven/`, and the key goes only when a measurement shows the
   premise holds.
10. **Questions answered on purpose.** An interactive Scenario whose agent may ask has a
    Driver; an A/B declares `answers:` so the Driver is not the variable.
11. **Expectations** neither vacuous nor overfit to one run.
12. **Arithmetic in `module/`**, not in a sibling script; no `.ts` loose at the bench root
    unless a check names it as a `file://` target.
13. **CI invocation** carries `--fail-on-failure` if a miss is meant to go red.

---

## A gap: look, classify, report upstream — a local stand-in only while you wait

**Never reimplement madbench's own tooling or logic.** That covers running and grading,
checks, report parsing and tallies, run lifecycle and waiting, validation of bench files,
hooks around a run, and version checks. If madbench lacks one of these, madbench gets it: a
**feature request**. If one is broken, madbench fixes it: a **bug report**. This project gets
at most a **temporary stand-in** while the issue is open — never a permanent wrapper.
Looking comes first, though.

**Step 1 — LOOK. Mandatory; skipping it is the defect this rule exists to prevent.**
Consult, in order:

1. `madbench --help`, then `madbench help <command>` — the installed binary's own surface.
2. `docs/checks.md`, `docs/metrics.md`, `docs/harness.md`, `docs/glossary.md` in the
   madbench checkout (`docs/README.md` for exit codes; `docs/sandbox-and-testdata.md` for
   staging; `docs/experiment-file.md` for Experiments).
3. The closed issues on the madbench repository.

Three times in one session "madbench is missing X" turned out to be "X exists and was not
findable": derived metrics (upstream's own commit records an author drafting a request for
something `metrics:` expressions already did), image support (`image:` and `image: generated:` both
exist), and cross-run arithmetic (a post-hoc module over `--report-json`, by design).

**Step 2 — classify.**

| Finding | It is | Do |
|---|---|---|
| present and broken — reproduce command, real output, real exit code | a **bug** | a bug report |
| absent after the lookup | a **feature** | a feature request, stating why the workaround is unacceptable as a permanent answer |
| present but unfindable | **neither** — a documentation defect in these skills | report it upstream as a skills fix; nothing gets a stand-in |

**Step 3 — draft, show, send.** Write the issue, show it to the user, and send it to the
madbench repository once they approve: `gh issue create --repo MadAppGang/madbench --title
"…" --body-file <draft>`. Filing is outward-facing, so it waits for that yes. If the user
cannot file there, the draft goes to the madbench developer as it stands. Keep the draft
wherever the project records upstream gaps. Every issue carries the `madbench version`
output, a reproduce command with its real output and exit code, and — for a feature — why
the workaround is unacceptable as a permanent answer.

**Step 4 — a temporary stand-in, only when the work is blocked without one.**

- Build the smallest thing that unblocks this task. Nothing general, nothing reusable.
- Its first line says what it is: `TEMPORARY — stands in for MadAppGang/madbench#<n>
  (<title>). Delete when madbench ships it.`
- Record it next to the issue in the project's upstream-gap list, with its path.
- Delete it in the same change that adopts madbench's own version. A stand-in that outlives
  its issue has become the wrapper this rule forbids.

---

## Gotchas that bite

- **`interactive: true` is the default, and permission mode means different things on the two
  paths.** See step 4 — this is the one that silently costs you a timeout.
- **A graded miss exits 0.** `--fail-on-failure` for CI; errors are nonzero regardless.
- **The default scenario timeout is 300s**, because a cold-start interactive turn can exceed
  what a `--print` turn needs. Declare your own.
- **Sandbox levels are `none | workspace | home | container`, default `home`.** They answer
  one question: *what does each Scenario get its own copy of?* Any other value is a **load** error
  every command rejects identically. Only `container` confines a process.
- **`sandbox: none` is gated twice** — the bench asks by name, and the operator passes
  `--allow-host-writes`. It cannot run concurrently, and `madbench check` still needs the flag
  because the **checks run for real** in your actual directory.
- **The three counting checks share one bound grammar**: `args.lte` / `args.gte` / `args.eq`,
  with `min`/`max` accepted. Both ends of a range bind. A `session:step-count` with no bound
  at all is refused at construction.
- **`session:tool-used` counts per named tool, never aggregate.** `value: [Read, Grep]` with
  `gte: 2` means *each* at least twice.
- **`session:*` checks do not all read the same thing.** `session:tool-used` reads the
  authoritative `Events` and unions `Calls`; `session:tool-sequence` and
  `session:tool-args-match` read only `Calls`, so neither sees a subagent spawn or a skill.
- **`session:step-count` counts the MAIN thread only.** A subagent's work is in
  `Session.Subagents`; scope a `session:tool-used` with `args.thread:` to count it.
- **`args.outcome` grades whether the call worked** — `any` (default) · `ok` · `error`.
  **Unknown satisfies neither `ok` nor `error`**, and unknown is the majority state: a
  perfectly successful `Read` records no outcome at all.
- **`latency` and `cost` are NOT APPLICABLE when the harness reported no metrics**, and are
  exempt from `madbench check`. A count ceiling is **not** exempt — fix `lte`-only bounds
  with a floor.
- **An unprobed `environment:*` check is loud, never a pass.** `probe.enabled: false` leaves Reported
  absent, and every `environment:*` Check then ERRORS (`docs/harness.md:1234-1236`); `madbench
  check` lands an unprobeable Check outside the verdict (`docs/checks.md:904`).
  Read the bucket the control prints. `checks-catalog.md` §9 has the per-type table.
- **`environment:mcp-reachable` takes the bench's document key**, never the tool's
  `plugin:…:…` spelling; a typo is caught at preflight, exit 3.
- **`harness.probe.require: true` refuses the run before any spend** when a
  staged plugin did not load or a declared MCP server did not answer. The scenario is an
  ERROR, not a FAIL: it never ran. `probe: {enabled: false, require: true}` is an error.
- **An `image:` bench cannot be negative-controlled** — the mock is not `ImageCapable`. And an
  `image:` works on both drives: piped with the prompt on `--print`, pasted into turn 1 on an
  interactive run (`docs/harness.md`, "On both drives").
- **Missing is not zero in `metrics:`.** `mean` of nothing is `n/a`; `sum` and `count` of
  nothing are a real `0`; a run-time throw is a `metric_error`, never a silent hole.
- `assert-set` threshold defaults to **1.0**; set e.g. `0.66` for 2-of-3.
- `exec` has no shell: `value:` is whitespace-split argv. Use `cmd: [sh, -c, '…']` for pipes.
- `latency` threshold is **milliseconds**, `cost` is **USD**, `levenshtein` is max edit distance.
- `budget:` and `token_estimate:` are informational gauges — **not enforced**.
- **`cwd:` moves the agent, not `Session.WorkDir`.** Checks still resolve against the root.
- **No judge provider** (no `judges:` block AND no `ANTHROPIC_API_KEY`) → AI Check types fail
  at construction with a message naming the fix. Check judge config before your spelling. A
  judge declared with `provider: claude-code` needs no key: it runs the local `claude` on this
  machine's login (`docs/checks.md:1300-1330`).
- **A judge is a variable.** `args.votes: N` (a positive odd integer) asks it N times and takes
  the majority, so one noisy call cannot flip the verdict alone. An undecided vote is an ERROR,
  not a FAIL (`docs/checks.md:1399-1428`).
- String checks (`contains`, `regex`, …) grade ONLY the agent's final message, never files on
  disk — grade files with `exec`. There is **no `file:*` check family**.
- **`Session.FinalOutput` follows a delegation.** If the parent ended its turn without
  receiving a subagent's result, the final output is the answering thread's last message, not
  the parent's "I've launched a search agent…".
- `file://` script checks resolve relative to the YAML's directory; managed runtimes pin via
  `defaults.bun:` / `defaults.python:`.
- A Scenario can also be a **case directory** — `assert.yaml` plus an optional `input.md`,
  discovered when a directory is passed to `madbench`. Those two files are all it reads: a
  `setup.sh` or `expected/` beside them is inert (`docs/sandbox-and-testdata.md:765-766`).

When debugging a failing or misbehaving bench, read `debugging.md`.
