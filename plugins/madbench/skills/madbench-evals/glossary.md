# madbench Glossary — the one table

Read this before any other madbench work. Every madbench skill does, at its Step 0.

The tables are parsed by a checker: the word is in the first column, one word or phrase per
row, and the replacement is in the second. The long-form rationale is `docs/glossary.md` in
the madbench repository.

## Terms

| Word | Meaning |
|---|---|
| Eval | The evaluation system madbench builds: every Experiment, its runs, and the work of extending and re-running them as models and hypotheses change. |
| Experiment | A file, `*.experiment.yaml`, that tests one hypothesis: it names a Bench (`bench:`) and lists its variants (`variants:`). No cross-product. |
| variant | One named entry of an Experiment's `variants:` list: a `name:` and the params it overrides, e.g. "opus-max". `--variant` selects variants by name. |
| baseline | The first variant declared in an Experiment. The Guard diffs every other variant against it. |
| run | The execution of one variant's Bench, made of N trials and named by its variant. A Bench run on its own is one run. |
| trial | One execution of the Bench for one variant. `--trials N` runs N of them; each trial produces one Session per Scenario. Never called a pass or a run. |
| Bench | One configured setup: a Harness, a Model and a list of Scenarios, loaded from `madbench.yaml` or `*.madbench.yaml` (`BenchSpec`). |
| Scenario | One thing you ask the agent to do: a prompt, its testdata and its Checks (`ScenarioSpec`, an entry under `scenarios:`). |
| Check | One graded question about a Scenario (`checks:`): it returns a Result whose score is in [0,1], higher always better. Four kinds by what powers it: Logic, AI, Code, Service. |
| child | A Check a composite Check holds as one of its own, e.g. one listed under an `assert-set`'s `checks:`. Which children each composite scores, and how, is per composite: `docs/checks.md`, Composites. |
| Expectation | The bar a Check's score must clear: `threshold:` on the Check. A Scenario-level `threshold:` is never read. |
| Harness | The agent under test, e.g. `claude-code` — the `harness:` block, its `type:` and its settings. Synonym: Target. |
| Model | Which LLM the Harness runs (`harness.model`). |
| Sandbox | What each Scenario gets its own copy of: `none` · `workspace` · `home` (default) · `container`. Only `container` confines a process; `home` also confines file reads on macOS. |
| Workspace | The directory the agent works in: `Session.WorkDir` on the host, `/workspace` inside a `container`. |
| Session | What happened when the agent ran one Scenario: its Events, final output, cost and timing. Graded by the `session:*` Checks. |
| transcript | The Harness's own stored file of a Session, e.g. Claude Code's JSONL. madbench reads it to build the Session. |
| Event | One thing that happened in a Session — a message, a tool call, a hook, a reminder — with madbench's Category, Type and Source beside the harness's own RawType, RawSource and Raw. |
| Environment | What the agent was given, not what it did: Expected (what madbench staged) and Reported (what the tool said it loaded), captured on the Session; `harness.probe` controls the capture. Graded by the `environment:*` Checks. |
| Result | What a Check returned: `Pass`, `Score`, `Reason`, `Evidence`. |
| Guard | What an Experiment's variants may differ by: `guard_changes:` with its list under `allow:`. Every declared variant is diffed against the baseline, the first declared variant, whichever variants `--variant` selects to run. An undeclared difference stops the Experiment before any spend as `CONFOUNDED`. |
| Driver | Who answers the agent's questions mid-run (`driver:`), and with `steer: true` decides what to say next. It speaks inside a Session; a Judge grades one from outside. |
| Judge | The model behind an AI Check (`judges:`). It reads a finished Session and never touches it. |
| Preflight | The pre-run checklist of binaries, keys, runtimes and daemons (`madbench preflight`, exit 3 = blocked). Every run preflights first. |
| turn | One prompt → work → stop cycle: the `prompt:` and each `follow_ups:` entry (`Metrics.Turns`). |
| params | A Bench's declared inputs with defaults (`params:`), substituted into `{{name}}` placeholders; a variant overrides them. |
| testdata | The directory copied fresh into the Sandbox for each Scenario (`testdata:`). Seed it red. |
| MetricValue | One number in the report: a named metric's value with its `n`, `missing` and aggregate. |
| unproven | A Bench whose premise is not established: `unproven:` states why, and every command refuses to load it. It lives in `unproven/`. |

## Deprecated and renamed terms

madbench's own words that a better word replaced. Never write them for a madbench concept.

| Word | Replacement | Note |
|---|---|---|
| arm | variant | clinical-study jargon for an Experiment's variant |
| fixture | testdata | |
| trajectory | Session | the Check family is `session:*` |
| matrix | variants / params | there is no cross-product |
| cell | Check / MetricValue | a graded (Scenario, Check) pair is a Check; one report number is a MetricValue. A character cell in a rendered terminal grid is the terminal's noun |
| Action | Event | as a Session's unit. English "action" naming another concept (GitHub Actions, a UI step) is not ours |
| round | turn | "3 rounds" also reads as `--trials 3`, which is three trials |
| eval file | Experiment | the file is an Experiment; the Eval is the whole system |

## Other tools' terms

Other tools' words for concepts madbench already names. When the user says one, translate
it; never echo it back as a madbench word.

| Word | Replacement | Note |
|---|---|---|
| suite | Bench | |
| test suite | Bench | |
| eval set | Bench | |
| golden set | Bench | a curated list of Scenarios with their Expectations |
| dataset | Bench | the seeded files are testdata |
| dataset row | Scenario | |
| test case | Scenario | |
| testcase | Scenario | |
| assertion | Check | a Check inside an `assert-set` is a child; `assert-set` and `assert.yaml` are madbench names and stay |
| grader | Check | the verb "graded" is ours |
| scorer | Check | |
| runner | Harness | `runner:` is not a key |
| SUT | Harness | |
| system under test | Harness | |
| completion function | Harness | |
| pass criteria | Expectation | |
| trace | Session | one step of one is an Event |
| span | Event | |
| variation | variant | `variations:` is not an Experiment key |
| treatment | variant | A/B testing's word; the reference variant is the baseline |
| epoch | trial | Inspect AI's word |
| simulated user | Driver | |
| user simulator | Driver | |
| persona | Driver | the Driver's `instructions:` hold the persona text |

**Not on the list, on purpose.** These look foreign but are madbench's own words or plain
English, so a checker must never flag them: `sample` (the metrics sample
stage), `metric` / `metrics` (`metric:` and `metrics:`), `threshold` (the Expectation's key),
`provider` / `providers` (`judges.providers`, the Scenario's `providers:`, claude-code's
`provider`), `model`, `eval` (the Eval), `evaluator` (madbench's `Evaluator` interface),
`baseline` (a Term, the first variant), `pass` (a Scenario's verdict, which is why a
repetition is never called a pass), `judge`, `target` (the Harness synonym), `score`,
`grade` (`madbench grade`), `outcome` (`args.outcome`), `example` (`examples/`), `tool call`
(the `tool_call` Event type), and `test`, `task`, `result`, `feedback` and `requirement`
(plain English; `Task` is also a Claude Code tool).

## The rule

Write only these words for madbench concepts. Translate the user's words, never echo them
back: "a test suite with two arms" becomes "a Bench, and an Experiment with two variants".

The one carve-out is **whose concept the word names**. A deprecated word or another tool's
word may name that tool's own feature: "promptfoo builds a matrix" is a quotation;
"madbench's matrix" is a violation. Ours is a violation, theirs is a quotation.

**What counts as a quotation** is decided by where the word stands, so a checker can apply
the rule without guessing at intent. A word is quoted, and never flagged, when it stands:

- in Markdown, in inline code or a fenced block, in a "double-quoted" phrase, or in a link
  target; and, in this file only, in a row of one of the tables above (a `Word`-headed table
  in any other file is that author's prose);
- in code, inside a string literal whose whole content, as written between the quotes, is
  one lower-case key matching `^[a-z_][a-z0-9_.-]*$` — `"assertion"`, `'test_cases'` —
  because that is a name on the wire, such as the `madbench/v2` envelope's `assertion`, not
  a sentence.

Everything else is a use. In code that means every comment and every other string literal:
a capitalised or punctuated word (`"Suite"`, `"Assertions:"`, `"./grader.ts"`), a message,
and every line of a Python `"""…"""` or `'''…'''` literal. Identifiers belong to the
language and are not read. YAML is read whole: a Bench is the madbench concept itself, so a
quoted YAML scalar is still a use.
