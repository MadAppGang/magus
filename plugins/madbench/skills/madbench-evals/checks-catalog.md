# Check catalog

Reference for the `madbench-evals` skill, reached by path. Every registered check type, the
keys it reads, and how it scores. The madbench release these files mirror is declared
**once**, in `plugins/madbench/mirrors.json`, which lists this file as version-sensitive.
`docs/<file>.md:<line>` citations point into the madbench checkout's `docs/` directory —
never into `pkg/`, because the checkout builds `dev`, not the release on your PATH.

A **Check** grades one **Session** — what the Harness produced when it ran one Scenario —
and returns a **Result**.

**Counts here follow the family headings and enumerated rows of upstream `docs/checks.md`**,
not its own totals table. That table disagrees with its body: it lists Session at 8 and
Environment at 7 (`docs/checks.md:1178-1179`) while the body enumerates 13 Session rows and
heads Environment with "9 types" (`docs/checks.md:591`). When they conflict, the enumerated
rows win, and this file does not restate a grand total.

---

## 1. The contract

A Check is a constructed component, not a function looked up at run time. There is **no
`check.Evaluator` interface**. The only interface is:

```go
type Check interface {
	component.Component // Kind() == component.KindCheck; Name() == the type string
	Evaluate(ctx context.Context, in Input) (*Result, error)
}
```

Configuration is decoded and validated **once**, at configure time. `Evaluate` never
re-parses YAML — a bad regex, a missing rubric, an unknown judge id all fail before the
Harness ever runs.

### Input — what every Check sees

| Field | Type | What it is |
|---|---|---|
| `Session` | `*harness.Session` | the primary Session (the only one, for single-provider Scenarios) |
| `Sessions` | `[]*harness.Session` | every sibling Session when the Scenario declares `providers:`; length ≥ 1 otherwise |
| `Providers` | `[]string` | provider labels aligned 1:1 with `Sessions` |
| `Spec` | `Spec` | this Check's own parsed YAML |
| `Vars` | `map[string]any` | the Scenario's `vars:`, for interpolation and reference text |

### Spec — every YAML key a check accepts

| yaml key | Purpose |
|---|---|
| `type` | the registered type string — **the only required key** |
| `value` | the type's primary payload (needle, reference text, rubric, command, path…) |
| `args` | per-type options map |
| `config` | free-form config map; **no in-tree check reads it** |
| `weight` | multiplier when this Check is a composite child; unset → 1.0 |
| `threshold` | the **Expectation** — the bar the score (or raw metric) must clear |
| `metric` | the name this Check's normalized score binds under in the top-level `metrics:` expressions (`mean(accuracy)`); defaults to `type` (`docs/metrics.md:27`, `:36`) |
| `metrics` | sample-stage expressions this Check **pushes** into the Scenario's row — `score`, `pass`, `reason`, `evidence` in scope (`docs/metrics.md:29-31`, `:59-61`); see `schema.md` §8 |
| `readout` | measure without grading — runs and scores, never fails the Scenario (§2.1) |
| `checks` | composite children (`assert:` is an accepted alias) |
| `inline` | inline source for `custom:gosrc` |
| `transform` | JS expression (goja) rewriting `output` before **this** Check sees it |

### Result — exactly four fields

| Field | json | Meaning |
|---|---|---|
| `Pass` | `pass` | the Expectation verdict |
| `Score` | `score` | normalized utility in `[0,1]`, higher always better |
| `Reason` | `reason` | human-readable, shown in the report and the dashboard row |
| `Evidence` | `evidence` | structured detail: raw metrics, child breakdowns, judge tokens |

### Catalog dispatch — exact, then longest prefix

1. **Exact match** on the registered type always wins.
2. Otherwise the **longest registered prefix** — this is how `custom:gosrc:./scoring.go`
   reaches the `custom:gosrc` constructor.

An unknown type is a **configure-time** error, never a run-time one: `unknown check type %q`.

---

## 2. Scoring

`Score` is **always** normalized to `[0,1]` and **higher is always better**, even when the
measurement is naturally lower-is-better. `latency` and `cost` score `1 − raw/threshold`;
risk-flavored judges score `1 − raw_risk`. The metric-native value is preserved in Evidence
(`raw_latency_ms`, `raw_cost_usd`, `raw_distance`, `raw_toxicity`, …).

This is what lets `assert-set`, `select-best`, `max-score` and `compare` combine child
scores without knowing what any of them measure.

> **`threshold:` is not one thing.** For most types it bars the normalized score. For
> `latency`, `cost` and `levenshtein` it is a **raw** SLO — milliseconds, USD, edit distance
> — and the score is derived from it. The dashboard renders those three as `latency ≤ 60s`
> rather than as a score bar.

At the Scenario level there is **no partial credit**: a Scenario passes iff every top-level
check passes (a composite counts as one check — put partial credit *inside* an `assert-set`).

### 2.1 `readout:` — measuring without grading

```yaml
- { type: session:step-count, metric: SearchWasBounded, args: { lte: 10 }, readout: true }
```

A readout **runs, scores, and reports**. It appears in the report labelled `(readout)`, its
named score reaches `NamedScores`, and a `metrics:` entry sourced from it sees the value.
The only thing it gives up is the power to declare the Scenario a failure.

It exists because *"did the run succeed?"* and *"how well did it go?"* are different
questions, and expressing the second as a gate answers the first wrongly. Bounding a search
with `session:step-count` turns a correct-but-slow answer into `FAIL`; as a readout the
Scenario passes and the number still reaches the comparison table.

**An ERRORING readout still fails the Scenario.** A Check that could not run measured
nothing. `readout:` is a statement about the verdict, not permission to ignore a broken
Check — a silently erroring readout is how an unwired measurement survives for months.

Rule of thumb: if the answer changes what you'd *do*, grade it; if it changes how good the
result was, make it a readout and give it a `metrics:` entry.

### The four kinds

Logic · AI · Code · Service is a **documentation and UI taxonomy**, not something encoded in
the component graph — every Check reports `component.KindCheck`. It answers "what powers
this Check?" and drives the dashboard badge.

| Kind | Powered by | Types |
|---|---|---|
| **Logic** | built-in deterministic matchers | String, Structured, Numeric, NLP, Session, Environment, Mastra, Composite |
| **AI** | an LLM judging the answer | the 17 judge-backed types (§5) |
| **Code** | your own program | `ts`, `js`, `python`, `exec`, `custom:exec`, `custom:gosrc`, `custom:wasm` |
| **Service** | an external API | `custom:http`, `model:current` |

---

## 3. Families

Per-family counts from the upstream family headings and enumerated rows (see the note at
the top). The grand total is deliberately not restated: it is the number that rots first.

| Family | Types | Notes |
|---|---:|---|
| String | 13 | |
| Structured | 10 | |
| Numeric | 4 | |
| NLP | 6 | 3 error-only |
| Session | 13 | 1 error-only; **+14 alias spellings** (13 `trajectory:*` + bare `skill-used`) |
| Environment | 9 | no alias spellings — the family is new (`docs/checks.md:591`) |
| Mastra | 6 | |
| Exec | 1 | |
| Model | 1 | `model:current` — the only Check whose expected answer is fetched, not stored |
| Script | 3 | `ts` · `js` · `python` |
| Composite | 6 | |
| Judge | 17 | always registered; each binds to the bench's judge set at construction |
| `custom:*` prefixes | 4 | `custom:exec`, `custom:http`, `custom:gosrc`, `custom:wasm` |

### Registered only to produce a helpful error

Four types exist so the message is a pointer instead of `unknown check type`. All four fail
at **construction**, so a bench using one never runs.

| type | Message |
|---|---|
| `session:goal-success` | route via `llm-rubric` with a rubric that describes success |
| `meteor` · `perplexity` · `perplexity-score` | not implemented natively; use `custom:exec` with a promptfoo shim |

---

## 4. String — 13 types

Every one reads `Session.FinalOutput` and grades 0/1. `value:` is the needle. A missing or
non-string `value` reads as `""`. The `-any`/`-all` variants accept a list, or one string
split on commas.

| type | Asserts |
|---|---|
| `equals` | output is exactly `value` |
| `not-equals` | output differs from `value` |
| `contains` | `value` appears in output |
| `not-contains` | `value` is absent |
| `icontains` | case-insensitive contains |
| `starts-with` | output has prefix `value` |
| `ends-with` | output has suffix `value` |
| `regex` | `value` (RE2) matches |
| `not-regex` | `value` does not match |
| `contains-any` | at least one needle present |
| `contains-all` | every needle present |
| `icontains-any` | case-insensitive any |
| `icontains-all` | case-insensitive all |

> Regex compiles at **construction** — an invalid pattern fails the whole bench before
> spending a token, rather than failing one Check mid-run.

## 5. Structured — 10 types

Syntax and schema validity of the final output. All 0/1.

| type | Asserts | Config |
|---|---|---|
| `is-json` | whole output parses as JSON; with `value:`, validates against that JSON Schema | `value` (optional schema) |
| `contains-json` | some `{`/`[` in the output starts a valid JSON value | — |
| `is-xml` | whole output is well-formed XML | — |
| `contains-xml` | output contains well-formed XML | — |
| `is-html` | output is HTML; with `value:`, validates against an HTML schema | `value` (optional) |
| `contains-html` | output contains HTML | `value` (optional) |
| `is-sql` | output parses as SQL | — |
| `contains-sql` | output contains SQL | — |
| `is-valid-function-call` | output is a well-formed function-call object | — |
| `is-valid-openai-tools-call` | output is a well-formed OpenAI tools-call array | — |

## 6. Numeric — 4 types

| type | Asserts | Config | Score |
|---|---|---|---|
| `latency` | `Session.Metrics.Latency` ≤ threshold | `threshold` (ms, > 0; falls back to numeric `value`) | continuous — `1 − ms/threshold`, `raw_latency_ms` in Evidence |
| `cost` | `Session.Metrics.Cost` ≤ threshold | `threshold` (USD, > 0; falls back to numeric `value`) | continuous — `1 − usd/threshold`, `raw_cost_usd` in Evidence |
| `levenshtein` | edit distance to `value` ≤ threshold | `value` (string, required), `threshold` (default `10`) | continuous — `1 − dist/threshold` |
| `is-refusal` | output is a refusal (empty/whitespace, or a built-in refusal phrase) | — | 0/1 |

> `is-refusal` **passes when the model refused.** Wrap it in `not-any-of` for the opposite.
> Empty output counts as a refusal.

**`latency` and `cost` cannot be negative-controlled.** They guard the budget, not the
behavior, and a run that did nothing spent nothing and took no time — so `cost $0.00 ≤
$0.04` is the *correct* verdict against the mock. `madbench check` reports them under
`NOT APPLICABLE UNDER MOCK` and leaves them out of its verdict; a bench declaring nothing
else exits **3** (`0 gradable checks`) (`docs/checks.md:229-237`; `madbench help check`).
Prove one by falsification instead: set an impossible threshold, make one real run, then a
generous one. Both halves matter — a guard hardwired to fail looks identical to a working
guard if you only ever see it say no.

The exemption also covers a composite whose children are **nothing but** these two. A
composite carrying even one behavior child stays graded (`docs/checks.md:262-264`). Any
*other* error on a `cost`/`latency` check — a `transform:` that will not parse, a recovered
panic — is a broken check, not an inapplicable one, and still fails the control.

Both are marked **not applicable** rather than failed when the harness reports no metric
(`not reported by this session`): a fail would assert "this run was too slow", a claim a
missing measurement does not support. That mark does **not** stop the Scenario — the checks
beside it grade normally. It is the one error class so exempted; every other erroring Check
still stops its Scenario, because every other error is a Check to repair
(`docs/checks.md:143-149`, `:254-260`).

> **A count ceiling is NOT exempt, and the distinction is the point.**
> `session:step-count` with `lte:` is also satisfied by an agent that did nothing, so it
> looks like it belongs with `cost` and `latency`. It does not. Cost and latency are measured
> **by the provider**; a harness reporting neither leaves the check no input. A step count is
> **derived from the Session's own action trace**, and the mock produces that trace — an
> honest, empty one. Zero steps is a real measurement, so `0 ≤ 10` passing is evidence that
> the guard cannot fail. `madbench check` reports it under `WRONGLY PASSED`, correctly. Fix
> it with a lower bound (`gte`) or an exact count.

## 7. NLP — 6 types (3 usable)

`value:` is the reference text. `threshold` defaults to `0.5`.

| type | Asserts | Config |
|---|---|---|
| `bleu` | corpus BLEU vs `value` ≥ threshold | `value`, `threshold` |
| `rouge-n` | ROUGE-N vs `value` ≥ threshold | `value`, `args.n` (positive int, default 1), `threshold` |
| `gleu` | GLEU vs `value` ≥ threshold | `value`, `threshold` |
| `meteor` · `perplexity` · `perplexity-score` | — | **error only** |

---

## 8. Session — 13 types

Grades *how the agent worked*, not what it said. All 0/1.

| type | Asserts | Config |
|---|---|---|
| `session:tool-used` | every named tool was **invoked** — present in `Session.Actions` under any invocation kind (`tool_call`, `mcp_call`, `skill`, `subagent`), or in derived `Session.Calls`. Each **at least once**, or inside a bound **per tool**. The attempt, not its result, unless `args.outcome` narrows it | `value` (string or list), `args.gte`/`args.lte`/`args.eq`, `args.thread`, `args.outcome` |
| `session:tool-args-match` | some call to `value` had args matching `args.args` (subset match on keys; each value exact by default, or a matcher) | `value` (tool name), `args.args` (map, required), `args.thread`, `args.outcome` |
| `session:tool-sequence` | the named tools appear **in order** — a subsequence, not necessarily consecutive | `value` (list), `args.thread` |
| `session:tools-only` | an **allowlist fence**: every call in scope was to one of the named tools | `value` (non-empty name or list), `args.thread`, `args.outcome` |
| `session:file-read` | the agent read `value`, a path **relative to `Session.WorkDir`** | `value` (path or matcher), `args.tools` (default `Read`/`NotebookRead`/`View`/`read_file`), `args.thread`, `args.outcome` |
| `session:step-count` | **main-thread** tool-call count is inside the bound | a bound is **required** |
| `session:turn-count` | how many exchanges the conversation took | a bound |
| `session:turn-step-count` | tool calls made by the **busiest** turn (the quietest, for a `gte`; a range tests each end against its own turn) | a bound |
| `session:subagent-used` | a subagent spawn was captured | `args.agent` |
| `session:subagent-count` | spawn count ≥ `value` | `value` (positive int), `args.agent` |
| `session:skill-used` | a skill invocation named `value` (case-insensitive) **that the tool did not answer with an error** | `value` (skill name) |
| `session:image-sent` | the Scenario's `image:` **reached the model** — at least `value` attachment events with an `image/…` media type | `value` (whole number ≥ 1, default 1) |
| `session:goal-success` | — | **error only** |

Every `session:<verb>` is also registered as `trajectory:<verb>`, derived so the two cannot
drift. `session:skill-used` additionally keeps the bare `skill-used` spelling. Both exist so
pre-rename files keep loading — **never write either.**

### One bound grammar for the three counting checks

`session:step-count`, `session:turn-count` and `session:turn-step-count` read the same
`args`, so there is one grammar. `session:tool-used` spells its bounds identically.

| written | means |
|---|---|
| `args: {lte: 20}` | a ceiling — at most 20 |
| `args: {gte: 1}` | a floor — at least 1 |
| `args: {gte: 1, lte: 20}` | a closed range — **both ends bind** |
| `args: {eq: 3}` | an exact count |
| `min` / `max` | accepted spellings of `gte` / `lte` |

On `session:turn-step-count` each end is tested against its OWN turn — a floor is broken by
the quietest exchange, a ceiling by the busiest — and the reason names which end broke and
which turn broke it.

Input with no single reading is refused at construction, before any model is billed:

- `{gte: 20, lte: 5}` — no count can satisfy both.
- `{lte: 3, max: 5}` — one bound spelled two ways, disagreeing. (`{lte: 3, max: 3}` is fine.)
- `{eq: 5, lte: 3}` — an exact count crossed with a bound.
- `{lte: "five"}` — a bound must be a number.
- A `session:step-count` with **no bound at all**.

### Counting is per tool, never aggregate

`value: [Read, Grep]` is all-of, so `gte: 2` reads *"each of Read and Grep at least twice"*.
Four Reads and no Grep does not satisfy it. **A check with no bound IS `gte: 1` per tool** —
presence is the degenerate case of the count, not a separate rule.

```yaml
- { type: session:tool-used, value: [Read, Grep] }                    # each at least once
- { type: session:tool-used, value: [Read, Grep], args: { gte: 2 } }  # each at least twice
- { type: session:tool-used, value: Bash, args: { lte: 0 } }          # never used
```

### Matchers — asserting on a path you cannot know

The WorkDir is a per-run tmpdir, so no literal a bench author types will equal the absolute
path the agent reports. `session:file-read` names the file **relative to the WorkDir** and
resolves it. Matchers let any `session:tool-args-match` expectation, and `session:file-read`'s
`value`, be a pattern:

| prefix | matches | note |
|---|---|---|
| *(none)* | exact | the default |
| `exact:` | exact | escape hatch for a literal that itself starts with a prefix |
| `glob:` | path glob | `*`, `?`, `[…]` inside one segment; `**` across segments; anchored both ends |
| `suffix:` | tail of the string | |
| `contains:` | anywhere in the string | |

```yaml
- type: session:tool-args-match
  value: Read
  args:
    args:
      file_path: "glob:**/skills/security/SKILL.md"
```

Non-string expectations (numbers, maps, lists) are always exact. A literal that itself opens
with `glob:`/`suffix:`/`contains:`/`exact:` is read as a matcher — write `exact:` in front to
get the literal back.

**The macOS `/private` divergence is handled.** The sandbox stores `os.MkdirTemp`'s raw
return (`/var/folders/…`) while Claude Code reports the resolved spelling
(`/private/var/folders/…`); `session:file-read` compares through `internal/hostpath`, which
knows those name one file. Evidence carries `work_dir`, `expected_resolved` and every
`paths_read`.

### Scoping to one thread — `args.thread`

A Session interleaves the main thread with every subagent it spawned, so *"was `Write`
used"* and *"did the agent under test use `Write`"* are different questions.

| `args.thread` | Grades |
|---|---|
| `main` | the top-level agent only (`Action.Thread == ""`) |
| *a subagent's name* | that subagent only — display name (`subagent_type`/`agentType`) or stable agent id |
| *omitted* | **any thread** — the default |

```yaml
# The main thread must delegate, not do the work itself.
- { type: session:tool-used, value: Write, args: { thread: main } }             # must FAIL
- { type: session:tool-used, value: Write, args: { thread: general-purpose } }
- { type: session:subagent-used, args: { agent: general-purpose } }
```

`args.agent` on the `subagent:*` pair matches whichever spelling landed on the spawn row.
`SubagentRollup.Tools` lists the distinct tools each subagent invoked in first-use order,
which is what makes a `tools:` fence checkable; spawn/done rows are excluded.

### Did the call actually succeed? — `args.outcome`

By default a `session:*` check grades an **attempt**. An MCP server that is installed but
unindexed issues the same call as one that works, so a bench comparing the two scores them
identically — a green check for a backend that answered nothing. `args.outcome` is how a
bench asks the other question.

| `args.outcome` | Grades |
|---|---|
| `any` | every call, whatever its recorded outcome — **the default** |
| `ok` | `result_ok == true` — a **recorded** success |
| `error` | `result_ok == false` — a **recorded** failure |

> **Unknown satisfies neither `ok` nor `error`. Only `any` admits it** — and unknown is the
> **majority** state. The claude-code parser upgrades a `tool_result`'s outcome only on a
> `structuredPatch` or a Bash `stdout`/`stderr`/`interrupted`, so **a perfectly successful
> `Read` records no outcome at all** — and `Read` is exactly what `session:file-read` grades.
> Admitting unknown into `ok` would reproduce the bug this key exists to end.

> **`ok` and `error` are NOT complements, deliberately.** `not-any-of` over `outcome: error`
> asks *"it did not visibly fail"*; `outcome: ok` asks *"it demonstrably worked"*. A run can
> satisfy the first and not the second.

| Family | Outcome | Why |
|---|---|---|
| `Bash` | usually known | non-zero exit, `stderr`, or an interrupt is read off the result |
| `Edit` / `Write` / `MultiEdit` | usually known | a `structuredPatch` means the edit landed |
| anything whose result carried `is_error` | known | the harness said so outright |
| `Read`, `Grep`, `Glob`, most MCP tools | usually **unknown** | nothing distinguishes success from absence |

Write `outcome: ok` where the answer is knowable and it changes the verdict — an MCP
engagement check, a Bash build step. Omitting it is never wrong.

Evidence on `session:tool-used` carries `counts` and `counts_attempted` side by side (their
difference is exactly what the filter removed), plus `calls_in_scope` and `outcome_census`
(`ok`/`error`/`unknown`). `outcome`, `thread`, `gte`, `lte`, `eq` appear only when declared,
so an absent key means "not narrowed" rather than "narrowed to the default".

### `session:tools-only` — the allowlist fence

A denylist (`not-any-of` over `session:tool-used`) names what must not happen, so it must be
extended by hand every time the tool surface grows. An allowlist names what may happen and
cannot rot:

```yaml
# Before — one child per forbidden tool name, 22 lines
- type: not-any-of
  checks:
    - { type: session:tool-used, value: mcp__serena__find_symbol }
    # …21 more

# After — three lines, and no list to maintain
- type: session:tools-only
  value: [Read, Grep, Glob, Bash, Edit, Write]
```

| Use | When |
|---|---|
| `session:tools-only` | you can name what the run **may** do — a read-only contract, an MCP-free control, a subagent's `tools:` fence |
| `not-any-of` over `session:tool-used` | you can only name what it **must not** do — a short, stable forbidden list inside an otherwise open surface |

> **Pair a fence with a check that asserts activity.** A fence is a constraint, not a claim
> that anything happened, so an empty scope satisfies it. `madbench check` flags exactly that
> — measured against the installed binary on a bench carrying only the fence, exit 1:
>
> ```
>   0/1 checks failed as required · 0 errored (could not grade) · 1 wrongly passed
>
>   WRONGLY PASSED (1) — these checks grade nothing:
>     fence-only · session:tools-only
>       score 1.00 · session:tools-only: no tool call in scope — nothing to check
>
>   the control does NOT hold: 1 check passed against a harness that did nothing.
> ```
>
> The answer is a partner — a `session:tool-used` with `gte:` beside the fence — so the pair
> says *"it did the work, and stayed inside the set"*. The general rule: **every check is a
> positive assertion.** Only `latency` and `cost` are exempt from the control
> (`madbench help check`); a fence, an absence assertion or an anti-cheat invariant on its
> own is `WRONGLY PASSED`.

Three shape rules:

- **An empty `value: []` is refused at construction** — far more likely an anchor that
  expanded to nothing than a deliberate "no tool at all". For that, write `session:step-count`
  with `args.eq: 0`.
- **An empty scope passes vacuously and says so** (`calls_seen: 0` in Evidence).
- **A subagent that ran but contributed no captured calls is a FAIL**, not a vacuous pass:
  *the subagent ran but this capture recorded none of its tool calls — the fence cannot be
  graded*. A green on an ungradeable fence is a lie.

The **verdict** is the first call outside the set (`Bash is not allowed (call 4 of 11)`);
the **Evidence names every one**. `args.outcome` is accepted for uniformity, but `any` — the
default — is what a fence wants: a `Write` that was attempted and blocked still violates
"this run may only read".

> **`session:step-count` counts MAIN-THREAD calls.** The two capture paths disagree about
> subagents — the on-disk path merges a subagent's calls into the Session before `Calls` is
> derived, while stream-json never receives child events — so main-thread-only is the one
> definition both can honor, and the one that matches the name: steps taken by the agent under
> test. A subagent's work is measured in `Session.Subagents`. `Session.Calls` holds every
> thread's calls, labeled with `thread`/`agent_id`.

---

## 9. Environment — 9 types

Grades what the agent was **given** rather than what it did: the plugins, skills, commands,
agents and MCP servers the tool had loaded. Every one reads `Session.Environment`
(`docs/checks.md:591-614`).

**The rule the family rests on: Expected may name the subject of a question; it may never be
the answer.** `Environment.Expected` is madbench's own bookkeeping about the tree it staged;
`Environment.Reported` is what the tool itself said, verbatim. A check that could pass
against an empty `Reported` would report success for the incident this family exists to end —
the registry was written, the plugin never loaded, the agent truthfully said it saw no such
skill, and the bench scored clean.

| type | Asserts | Config | Score |
|---|---|---|---|
| `environment:plugin-loaded` | the tool names `value` on **either** surface — `plugin list --json` or `system:init` — **and** it carries no errors | `value` (plugin id, `<plugin>@<marketplace>`) | 0/1 |
| `environment:skill-registered` | `Reported.Skills()` contains `value`, counting **loaded plugins only** — a superset of skills and commands on a details-only path | `value` (e.g. `dev:architecture`) | 0/1 |
| `environment:command-registered` | `Reported.Commands()` contains `value`; **errors** when `plugin-cli` is the only source | `value` (e.g. `dev:architect`) | 0/1 |
| `environment:agent-registered` | `Reported.Agents()` contains `value`, loaded plugins only | `value` (e.g. `dev:reviewer`) | 0/1 |
| `environment:mcp-connected` | `system:init` reports server `value` with status `connected`; a server declared only by a plugin that did **not** load counts as absent | `value` (bare `claudish`, or `plugin:claudish:claudish`) | 0/1 |
| `environment:mcp-reachable` | the server `value` answered **madbench's own** `initialize` + `tools/list`, spoken through this run's sandbox **before the agent launched**; optionally clears a tool-count floor (`docs/checks.md:611`) | `value` (the server name **as the bench declared it** — the document key, e.g. `probe`), optional `args.tools` (a floor: reported ≥ declared) | 0/1 |
| `environment:tool-available` | `init.tools` names `value` **exactly**; **errors** when no `system:init` was captured | `value` (as the tool spells it: `Skill`, `mcp__railway__deploy`) | 0/1 |
| `environment:plugin-inventory` | the plugin's `plugin details` breakdown clears every declared bound — the **staged tree**, read whether or not the plugin loaded | `value` (plugin id), `args.skills`/`agents`/`hooks`/`mcp_servers`/`lsp_servers` | **fraction of bounds met** |
| `environment:matches-expected` | every plugin the run staged is listed **and** loaded | — (`harness_config.plugins` already said which) | **fraction loaded** |

```yaml
checks:
  # The one-liner most benches want. It declares nothing.
  - type: environment:matches-expected

  - type: environment:plugin-loaded
    value: dev@magus

  # Namespaced exactly as the tool namespaces it.
  - type: environment:skill-registered
    value: dev:architecture

  - type: environment:mcp-connected
    value: claudish

  # A different question about the same server. The value is the DOCUMENT KEY the
  # bench declared (`probe` out of `--mcp-config '{"mcpServers":{"probe":{…}}}'`),
  # never the tool's `plugin:…:…` spelling, which the preflight has never seen.
  - type: environment:mcp-reachable
    value: probe
    args:
      tools: 1          # a floor; without args the check asks only whether it answered

  - type: environment:tool-available
    value: Skill

  - type: environment:plugin-inventory
    value: dev@magus
    args:
      skills: 20        # each bound is a floor: reported >= declared
      agents: 1
```

The prefix is `environment:`, **never** `env:` — `env` already means environment *variables*
(`sandbox.env:`, `RunRequest.Env`). The family carries **no alias spellings**: `session:`
derives its pre-rename names because it *was* renamed; inventing one here would be inventing
history.

### Two MCP checks, two questions

`mcp-connected` asks *did the **tool** register the server*, out of `system:init`.
`mcp-reachable` asks *did the **server** answer **madbench**, before the agent launched*, out
of madbench's own handshake. **Neither implies the other**, and declaring both is what turns
a silent absence into a diagnosis: reachable green with connected red means the server works
and the CLI did not register it (`docs/checks.md:616-622`, `:640-642`).

| | `environment:mcp-connected` | `environment:mcp-reachable` |
|---|---|---|
| asks | did the **tool** register the server | did the **server** answer madbench |
| reads | `init.mcp_servers` + each loaded plugin's declared names | `Reported.MCPServers`, madbench's own handshake |
| exists on | the `--print` path (status) / both (the name) | **every** drive path, including the default interactive one |
| value spelling | the tool's: `claudish` or `plugin:claudish:claudish` | the **bench's**: the document key, `probe` |
| absent name | **fail** — absent is an answer | **error** — the surface exists only when the preflight ran |

(`docs/checks.md:713-719`.)

Three more things about `mcp-reachable` worth knowing before writing it:

- **A typo'd `value:` is caught at preflight, before any spend — for `mcp-reachable` only.**
  `madbench preflight` pairs every top-level `mcp-reachable` value against the servers the
  harness declares and **refuses** (exit 3) on one nothing declares, naming the Scenario and
  the check (`docs/checks.md:721-727`; `docs/harness.md:1447`). `mcp-connected` is
  deliberately not cross-checked, because the tool's registry is wider than what a bench
  declares (`docs/checks.md:731-734`).
- **A connected server with zero tools is a pass.** A server may expose only resources or
  prompts. A bench that needs tools declares `args: {tools: N}` (`docs/checks.md:745-748`).
- **What green does NOT prove**: that the CLI registered the server, that the model could
  call its tools, or that the server stayed up past *t=0*. What it does prove is the one
  thing nothing else can — the server process starts under this run's confinement, in this
  run's sandbox, and speaks MCP, checked before the agent launches so `require: true` can
  refuse before the spend (`docs/checks.md:750-770`). The strongest configuration declares
  all three: `mcp-reachable`, `mcp-connected`, and a `session:tool-used` on an `mcp__…` tool
  — and the two take **different** names: the declared key for the first, the runtime name
  (`mcp__plugin_<plugin>_<server>__<tool>` for a plugin-shipped server) for the last
  (`docs/checks.md:657-668`).

### Nil is an error, never a fail

Every check here returns an **error** — a `StatusError` row, not a red one — when `Session`,
`Session.Environment` or `Environment.Reported` is nil:

```
environment:plugin-loaded: no environment was captured for this session
  (harness_config.environment.probe is false, or this harness does not report one)
```

A fail is a verdict about the plugin; an uncaptured environment is the *absence* of one.
Five more cases follow the same rule:

- **`environment:mcp-connected` on a server listed with no status.** Only `system:init`
  reports a status and only the `--print` drive path carries one, so on the default
  interactive path the run never asked. A server the tool does not list at all is still a
  fail — every drive path measures at least one surface, so "absent" is an answer.
- **`environment:mcp-reachable` on a name the preflight never recorded, or recorded as
  UNPROBED.** `probe: false`, a harness that is not `claude-code`, and a bench that declared
  no server all produce a record with no entry, and none of those is evidence that a server
  is unreachable. An UNPROBED entry — a remote `type: http` entry, a `command` carrying a
  `${…}` madbench does not own, a relative `command`, a `cwd` the sandbox will not contain —
  errors for the same reason and prints the recorded `probe_reason` rather than guessing
  (`docs/checks.md:708-711`, `:737-743`; `docs/harness.md:1194`).
- **`environment:tool-available` on a record with no tool roster.** `claude plugin details`
  prints no tool heading, so no source on the default interactive path supplies one. An
  **empty** record errors here too, unlike every other lookup: every session the tool starts
  registers a roster, so a record carrying none never stated it.
- **`environment:plugin-inventory` on a listed plugin with no breakdown.** The per-plugin
  probe was capped or switched off (`harness_config.environment.details`).
- **`environment:matches-expected` when the run staged nothing.** The check has no subject,
  and `plugins:` silently dropped is precisely the incident.
- **`environment:command-registered` when `plugin-cli` is the only source.** `claude plugin
  details` prints no command heading — it folds `commands/*.md` into its own `Skills (N)`
  count.

An unknown key under `environment:plugin-inventory`'s `args` is **refused at construction**,
as is an empty bounds block. A typo'd `skill: 20` that silently declared no bound would leave
the check grading nothing and passing every run.

### Which of them a bench under `madbench check` can carry

The mock reports a present-but-empty `Reported` record — it ran and registered nothing — so a
**named-subject** check is genuinely absent from a genuinely empty list and fails cleanly.
The nine split three ways (`docs/checks.md:797-826`):

| Check | Under the mock | Bench can still pass `madbench check`? |
|---|---|---|
| `plugin-loaded` · `skill-registered` · `command-registered` · `agent-registered` · `mcp-connected` · `plugin-inventory` | **fails cleanly** — counted as the control's evidence | **yes** |
| `mcp-reachable` | **not applicable** — listed under `NOT APPLICABLE UNDER MOCK`, left out of the verdict | **yes** |
| `matches-expected` · `tool-available` | **errors** — the mock stages nothing and captures no `init.tools` | **no** |

A bench declaring *nothing but* `mcp-reachable` exits 3 (`0 gradable checks`), the same as
one of nothing but `cost` and `latency` (`docs/checks.md:825-826`).

**An unprobeable check lands outside the verdict; a genuinely broken one is still named in
`COULD NOT GRADE`.** Since 2026-09-08, `madbench check` reads past any row that produced
checks at all and classifies each on its own merits (`docs/checks.md:838-840`). Note that
upstream's `harness.md` still carries the older sentence — *"`probe: false` … Every
`environment:*` Check then ERRORS rather than passing"* (`docs/harness.md:1130-1132`) — and
`checks.md:728-729` says the same opt-out makes the handshake checks *"report 'not
applicable' by design"*. Do not resolve that from memory: run `madbench check` and read which
bucket the check lands in. Either way the outcome is loud, and a run that measured nothing
never scores as a pass.

### The check and the gate are not the same thing

`harness_config.environment.require: staged` (the default) refuses to launch a run whose
staged plugins the tool does not list — before the agent is driven, so nothing is spent.

| | when | what it produces |
|---|---|---|
| the gate | before launch | refuses the run — a `StatusError` row, no spend |
| `environment:matches-expected` | after the run | a graded row in the report |

Under the default a bench never sees the check fail on a shortfall, because the run never
happened. The check earns its place in two cases the gate cannot cover: `require: none`,
where the degraded environment IS the subject, and a stored report, where the check's row is
the durable record that the environment was verified at all.

---

## 10. Mastra code-scorers — 6 types

Deterministic ports of Mastra's non-LLM scorers. Default `threshold` is `0.7` for the
continuous ones, `1.0` for the exact ones. Input/reference may come from `value:`, `args.*`,
or the Scenario's `vars:`.

| type | Asserts | Config | Score |
|---|---|---|---|
| `completeness` | output covers the input's elements | `value` \| `args.input` \| `Vars[prompt]`, `threshold` (0.7) | continuous |
| `keyword-coverage` | output contains the input's keywords | same, `threshold` (1.0) | continuous |
| `tone` | output sentiment matches the reference tone | `value` \| `args.referenceTone`, `threshold` (0.7) | continuous |
| `content-similarity` | Dice similarity to the reference | `value` \| `args.expected`/`reference`, `args.ignoreCase` (true), `args.ignoreWhitespace` (true) | continuous |
| `textual-difference` | LCS ratio against the reference | `value` \| `args.expected`/`reference` | continuous |
| `code-tool-call-accuracy` | the expected tool (or tool order) was used | `args.expectedTool` \| `args.expectedToolOrder`, `args.strictMode` (false), `threshold` (1.0) | 0/1 |

## 11. Exec — 1 type

| type | Asserts | Config |
|---|---|---|
| `exec` | a command run against the post-run workspace exits with the expected code | `args.cmd` (list) or `value` (string, whitespace-split — no shell); `args.cwd`; `args.expected_exit` (0); `args.timeout` (duration string, default `60s`) |

The command runs in `Session.WorkDir`; a relative `args.cwd` is joined onto it. An empty
`WorkDir` with no absolute `cwd` is an error, deliberately — falling through to the harness
process's cwd would run your test suite in the user's own repo. On failure the tail of the
combined output lands in `Reason`.

**No shell is involved**: `value: "go test ./..."` is argv, not a shell line — no pipes,
globs or `&&`. Use `cmd: [sh, -c, '…']` for those.

```yaml
- type: exec
  args:
    cmd: ["go", "test", "./..."]
    timeout: "120s"
```

## 12. Model — 1 type (Service)

Did the agent name a model that exists, and is it current? The expected answer is **not in
the repository and must not be**: `model:current` asks the live catalog at grading time
through the `claudish` CLI. A grader with a model id compiled into it becomes the stale
snapshot it exists to detect.

| type | Config |
|---|---|
| `model:current` | `args.file` (JSON path relative to `Session.WorkDir`; default source is the final output) + `args.path` (dotted path inside it); `args.ignore` (non-model sentinels); `args.require` (`current` · `superseded` · `retired`, default `current`); `args.allow_routes` (default false); `args.min_count` (default 1); `args.timeout` (default `60s`) |

| standing | meaning | utility |
|---|---|---:|
| `current` | the provider's current flagship | 1 |
| `superseded` | still listed, but a newer flagship exists | ⅔ |
| `retired` | a real model the curated catalog dropped | ⅓ |
| `unknown` | no such model — hallucinated | 0 |

A **routing address in an identity slot** (`kc@kimi-k3`, `moonshotai/kimi-k3`) halves the
identity's utility on its own: the model is right and the value is still wrong, because the
pin bypasses subscription-aware routing and every fallback behind it. `require:` names the
WORST standing tolerated.

**An unreachable catalog FAILS.** A Check that reads "I could not ask" as "the answer was
yes" is worse than no Check. `MADBENCH_CLAUDISH` overrides the binary; preflight blocks when
it is missing.

```yaml
- type: model:current
  metric: SelectionIsRoutable
  args:
    file: .dev-session/iteration-config.json
    path: selectedModels.models
    ignore: [internal]
```

## 13. Script — 3 types

Your own grading logic in a managed runtime: `ts`/`js` via **bun**, `python` via **uv**.
`value:` is inline source or a `file://` path. The runtime is located on PATH first, then
auto-installed into madbench's cache unless the install policy is `never`. Per-scenario
`bun:`/`python:` pin versions; `lockfile_required:` demands `bun.lock` / `uv.lock`.

| type | Runtime | Config |
|---|---|---|
| `ts` | bun | `value` (inline or `file://…`), `args.timeout` (default 30s) |
| `js` | bun | same |
| `python` | uv | same |

---

## 14. Judge checks — 17 types (AI)

All 17 are always registered, but each binds to the bench's judge set at **construction** —
so a bench with no usable judge fails before the Harness runs, naming the actual fix (*set
`ANTHROPIC_API_KEY` for the default Anthropic judge, or declare a `judges:` block*).

### Declaring judges

```yaml
judges:
  default: opus-4.8                   # a provider id, OR a bare modelspec short form
  providers:
    fast: haiku-4.5                   # short form: provider inferred, endpoint + key env implied
    ds: deepseek/deepseek-chat        # short form: explicit provider/model
    or-qwen:                          # long form: any OpenAI-compatible gateway
      transport: openai               # `type:` is an accepted alias
      endpoint: "https://openrouter.ai/api/v1"   # `base_url:` is an accepted alias
      model: "qwen/qwen3-235b"
      api_key_env: OPENROUTER_API_KEY
      params: { temperature: 0.0, max_tokens: 1024 }
```

`default:` is optional — with none, the sole (or first-declared) provider wins. Naming a
`default:` whose provider is unavailable is a run-start error. A `default:` that names no
declared provider but *is* a valid modelspec short form auto-declares a judge under that
literal string. **API keys never appear in YAML**: `api_key_env` names an environment variable.

### Per-check overrides

| key | Effect |
|---|---|
| `args.judge` | select a named provider; unset uses the default. An unknown id fails at **construction** |
| `args.model` | override the model for this Check |
| `args.temperature`, `args.max_tokens` | override the provider's sampling params |
| `args.rubric` | the rubric, when you would rather not put it in `value:` |
| `threshold` | must be within `[0,1]`, validated at construction; `0` means "use the type's default" |

### The 17 types

`value:` (or `args.rubric`) is **required** for the four rubric-taking types. For the rest,
`value:` is read as reference text. Every type is continuous.

| type | Judges | Default threshold |
|---|---|---:|
| `llm-rubric` | output against a free-form rubric | — |
| `factuality` | every claim in the rubric is supported | — |
| `model-graded-closedqa` | all criteria met (judge returns binary 1.0/0.0) | — |
| `g-eval` | chain-of-thought rating against criteria | — |
| `answer-relevance` | relevance of output to the question | — |
| `answer-relevancy` | same template, Mastra threshold | 0.7 |
| `context-faithfulness` | output supported by the given context | — |
| `faithfulness` | same template, Mastra threshold | 0.7 |
| `context-recall` | how much of the reference appears in the output | — |
| `context-relevance` | relevance of the retrieved context | 0.7 |
| `context-precision` | precision of the retrieved context | 0.7 |
| `prompt-alignment` | output follows the instructions | 0.7 |
| `llm-tool-call-accuracy` | tool choice judged against expectations | 0.7 |
| `toxicity` | **risk-inverted** | 0.7 |
| `bias` | **risk-inverted** | 0.7 |
| `hallucination` | **risk-inverted** | 0.7 |
| `noise-sensitivity` | **risk-inverted** | 0.7 |

A type with no default threshold passes on the judge's own `pass` verdict unless you set
`threshold:`.

**Risk-inverted types** measure risk, where the judge naturally returns high = bad. They are
inverted to satisfy the scoring contract: `Score = 1 − raw`, raw preserved in Evidence under
`raw_toxicity`, `raw_bias`, `raw_hallucination`, `raw_noise_sensitivity`. So `toxicity` with
`threshold: 0.7` means *"at least 0.7 safety"*, not *"at most 0.7 toxicity"*.

Every judge Result also carries `judge_model`, `judge_input_tokens`, `judge_output_tokens`
and (when a threshold applied) `threshold` in Evidence.

**Prompt-injection isolation.** Every user-supplied substitution the judge sees —
`{{OUTPUT}}`, `{{PROMPT}}`, `{{CONTEXT}}`, `{{REFERENCE}}`, `{{TOOLS}}` — is wrapped in an
XML tag (`<output_under_evaluation>…`) and has closing-tag-like sequences stripped, so an
agent under test cannot emit `{"pass": true}` and have the verdict parser mistake it for the
verdict. `{{RUBRIC}}` is **not** wrapped — it is authored by the bench, not the agent.

---

## 15. Composites — 6 types

Children go under `checks:` — the same canonical key a Scenario uses. A composite with no
children is a configure error in a single-provider Scenario; in a multi-provider Scenario it
borrows the Scenario's non-composite siblings.

| type | Pass when | Score |
|---|---|---|
| `assert-set` | weighted pass-ratio ≥ `threshold` (default `1.0` — all must pass) | `passedWeight / totalWeight` |
| `any-of` | at least one child passes | `max(child scores)` |
| `not-any-of` | **no** child passes | `1 − max(child scores)` |
| `select-best` | always (a scoring op, not a gate) | single-session: best child's score. Multi: winning session's `Σ(score×weight)/Σweight` |
| `max-score` | single-session: best child score > 0. Multi: winner's aggregate ≥ threshold | single: `max(child scores)`. Multi: weighted average, or raw sum when `args.method: sum` |
| `compare` | the **first** provider scores strictly higher than every other | first provider's normalized score |

Two weighting knobs, easy to confuse:

| | Where | Meaning |
|---|---|---|
| `weight:` | on each **child** spec | that child's multiplier — used by every composite |
| `weights:` | on the **composite**, under `args.weights` or a mapping `value:` | a `type → multiplier` map; overrides `weight:` for children of that type. Read by `select-best`, `max-score`, `compare` only |

```yaml
- type: assert-set
  threshold: 0.75                      # 75% of the weight must pass
  checks:
    - { type: contains, value: "PASS", weight: 2 }
    - { type: exec, args: { cmd: ["go", "vet", "./..."] } }
    - { type: session:tool-used, value: ["Read", "Edit"] }
```

Composites assume every child score is normalized high-is-good — which is why the scoring
contract exists.

---

## 16. External transports — 4 prefixes

Four register under a **prefix**, so a type suffix can carry a payload
(`custom:gosrc:./scoring.go`); the managed `ts`/`js`/`python` family registers exact types.

All receive the **same JSON envelope** on stdin (or as the POST body / WASM buffer):

```json
{
  "version": "madbench/v1",
  "session": {
    "final_output": "…",
    "actions": [],
    "calls": [
      { "name": "Bash", "args": {}, "tool_call_id": "toolu_01…",
        "result_ok": false, "result_tag": "exit 1 · 2 failed" },
      { "name": "Read", "args": {}, "tool_call_id": "toolu_02…" }
    ],
    "metrics": {}
  },
  "assertion": { "type": "custom:exec", "value": "…", "args": {} },
  "vars":      {}
}
```

…and must return a JSON `check.Result` — `{"pass": bool, "score": 0..1, "reason": "…",
"evidence": {}}`.

**`calls[]` carries the recorded outcome** under the names `actions[]` uses: `tool_call_id`
(the join key back to the authoritative stream), `result_ok`, `result_tag`. All three are
`omitempty` — **an absent `result_ok` means the capture recorded no outcome, and must never
be read as failure.**

| type | Transport | Config | Notes |
|---|---|---|---|
| `custom:exec` | spawn any CLI, envelope on stdin | `args.command` (list, preferred) or `value` (shlex-split), `args.timeout` (default 30s) | environment scrubbed to `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR` plus `MADBENCH=1` |
| `custom:http` | POST the envelope | `args.url` or `value` (http/https only), `args.timeout` (30s), `args.headers` | **Service** kind |
| `custom:gosrc` | compile Go source, cache by SHA256(source + Go version), run it | `inline:`, `value:` (path), or the type suffix; `args.timeout` (30s) | compiled at evaluation time |
| `custom:wasm` | Wazero, WASI preview1 | `value:` (module path) or the type suffix | 5s timeout, 64 MiB memory ceiling; must export `alloc` |

```yaml
- type: custom:exec
  args: { command: ["bun", "run", "./grade.ts"], timeout: "90s" }

- type: custom:http
  args:
    url: "https://grader.internal/score"
    headers: { X-Grader-Suite: "regression" }   # literal strings only — no env interpolation

- type: custom:gosrc:./checks/scoring.go

- type: custom:wasm
  value: ./checks/grade.wasm
```

`madbench preflight` reports a missing grader before any spend, and every finding is
**blocking** (exit 3, nothing run, nothing spent).

| What is verified | By whom |
|---|---|
| A `value: "file://…"` grader exists and is not a directory | the scenario, for `ts`, `js`, `python` |
| The managed runtime (`bun`, `uv`) is available | the script family — advisory when madbench may auto-install, blocking when not |
| `command[0]`/`command[1]` exist, when they contain a path separator | `custom:exec` |
| The `go` toolchain is on `PATH` | `custom:gosrc` |
| The `.wasm` module exists and is not a directory | `custom:wasm` |

Two source spellings are **not** covered, because they resolve against the process working
directory: a bare `value:`/type-suffix path on `custom:gosrc`, and a `custom:exec` command
with no path separator.

---

## 17. What a Session exposes

`Session.Actions` is the authoritative normalized event stream; `Session.Calls` is a
**derived, lossy** view. Both carry the recorded outcome of each call, tri-state, where
absent means the capture said nothing.

| Question | Where it lives | Reachable by |
|---|---|---|
| Was tool X called? | `Actions[].ToolName` on any invocation kind, unioned with `Calls[].Name` | `session:tool-used` |
| **Did it succeed?** | `Calls[].ResultOK` (tri-state) / `.ResultTag` | `args.outcome` — **absent means unknown** |
| How many times? | the same invocation set, counted | `session:tool-used` with `args.gte`/`lte`, **per named tool** |
| Did it stay inside a tool set? | `Calls[].Name` | `session:tools-only` (allowlist), or `not-any-of` (denylist) |
| With what arguments? | `Calls[].Args` | `session:tool-args-match` |
| Which files did it read? | the path arg of every `Read`-family call | `session:file-read` |
| In what order? | `Calls` order | `session:tool-sequence`, `code-tool-call-accuracy` |
| How many steps? | `Metrics.StepCount` | `session:step-count` |
| How many exchanges? | `Session.Turns` | `session:turn-count` |
| Did any ONE exchange thrash? | `Turns[].StepCount()` | `session:turn-step-count` |
| Was a subagent spawned? How many? | `Actions` with `Kind == subagent` | `session:subagent-used`, `session:subagent-count` |
| Was the `Skill` tool reached for? | `Actions` with `Kind == skill` | `session:tool-used` with `value: Skill` |
| Was an MCP tool used? | `Calls` under its `mcp__…` name | `session:tool-used` |
| Was a skill invoked? | `Actions` with `Kind == skill` | `session:skill-used` |
| Did the picture arrive? | `Actions` with `Kind == attachment` + a `media_type` | `session:image-sent` |
| What did it cost / how long? | `Metrics.Cost`, `.Latency`, `.PromptTokens`, `.OutputTokens` | `cost`, `latency` |
| What did it finally say? | `FinalOutput` | every String / Structured / NLP / judge check |
| Which files changed? | `FilesChanged` | **nothing** — see §18 |
| What is on disk now? | `WorkDir` | `exec`, and any transport reading the envelope's `work_dir` |
| What did the tool have LOADED? | `Environment.Reported` | the `environment:*` family |
| Did the declared MCP server answer madbench before launch? | `Environment.Reported.MCPServers` | `environment:mcp-reachable` |

**MCP calls do reach `session:tool-used`.** The parser emits an `mcp__`-prefixed tool as
`ActionMCPCall` rather than `ActionToolCall` so the UI can badge it differently, but
`DeriveCalls` folds both into `Calls` identically. Assert on the full name.

**Subagent spawns and skill invocations do NOT appear in `Calls` — and `session:tool-used`
sees them anyway.** A `Task`/`Agent` tool_use becomes `ActionSubagent` and a `Skill` tool_use
becomes `ActionSkill`, both deliberately excluded from `Calls`. `session:tool-used` reads
`Actions` and unions `Calls` on top.

```yaml
- { type: session:tool-used,  value: "Skill" }          # the Skill tool was invoked at all
- { type: session:skill-used, value: "beacon-align" }   # …and that named skill actually ran
```

Two things this does **not** change. `session:tool-sequence` and `session:tool-args-match`
still read `Calls`, so neither sees a spawn or a skill. And a spawn row carries the
**subagent's** `Thread`, so `session:tool-used` with `value: Task` and `args.thread: main` is
**false** — it selects the thread that was spawned, not the one that spawned it.
`session:subagent-used` is the check that asks who delegated.

**`session:skill-used` grades the RESULT; `session:tool-used: Skill` grades the ATTEMPT.**
Write them together — their disagreement is the diagnosis:

| tool-used | skill-used | Diagnosis |
|---|---|---|
| green | red | the agent reached for a skill and the tool refused it → check whether it is installed |
| red | red | the agent never reached → check the prompt |

Three readings inside `session:skill-used` are deliberate:

- **No result, or `ResultOK` nil, counts as invoked.** A *successful* skill result is exactly
  that shape — claude-code omits `is_error` on success. Only an explicit `false` denies an
  attempt, so a Session truncated mid-call is never reported as a failure nobody observed.
- **Several attempts pass if any one was not an error.** A retry that worked is a skill that ran.
- **An empty `ToolCallID` counts as invoked**, because it correlates to nothing.

One consequence: `not-any-of` over a decoy skill asks "did the wrong skill RUN", not "did the
agent reach for it".

**`session:image-sent` grades delivery, not comprehension.** Pair it with a check on the
output that is answerable only by looking: `image-sent` red means the plumbing broke;
`image-sent` green with the output check red means the agent was shown the picture and still
got it wrong. An `attachment` record cannot fake it — injected context records carry
`attachment_type` and **never** a `media_type`, and the check requires `image/…`.

---

## 18. What is not here yet

- **Scenario-level `threshold:` is parsed but never evaluated.** It loads and merges down
  from `defaultScenario:`, and then nothing reads it. It exists for promptfoo compatibility.
  Per-Check `threshold:` is the one that grades.
- **There is no `file:*` check family.** Nothing asserts "this file exists / matches / was
  created". `Session.FilesChanged` is defined with before/after SHAs and a unified diff but is
  populated **only by the demo harness**. Assert on the filesystem with `exec` against
  `Session.WorkDir`. (`session:file-read` is not that — it grades what the agent *read*.)
- **The per-criterion composite breakdown in the dashboard is demo-backed.** Only
  `MADBENCH_MOCK_RICH=1` emits `Result.Evidence["criteria"]`; a real `llm-rubric` returns a
  single score.
- **The dashboard's kind badges are wrong for most AI checks.** The badge tests for an `llm-`
  prefix, so only `llm-rubric` and `llm-tool-call-accuracy` badge as **AI** — `factuality`,
  `g-eval`, `toxicity`, `faithfulness` badge as **Logic**. `custom:gosrc` badges as Logic too.
- **`session:goal-success` is reserved, not implemented.**
