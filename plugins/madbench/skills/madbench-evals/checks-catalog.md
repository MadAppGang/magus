# madbench checks catalog

Every check returns `Result{Pass, Score ∈ [0,1] higher-is-better, Reason, Evidence}`.
Raw metric values (ms, USD, risk) live in `Evidence`. Source: `pkg/check/builtin/*`
(one file per family), `pkg/check/{llmjudge,script,http,wasm,subprocess,gosrc}/`.

**Availability in a default build**: only the Logic builtins and `exec` are
unconditionally available. AI checks register only when `ANTHROPIC_API_KEY` resolves
(otherwise they fail as `unknown assertion type`); `ts`/`js` need `bun`, `python`
needs `uv`, `custom:gosrc` needs `go` on PATH, `model:current` needs the `claudish`
CLI; `container` sandbox needs Docker. **`madbench preflight` now resolves an unknown
check `type:` and a missing `file://` grader**, so a typo'd type no longer survives
until evaluate time.

**Registry mechanics**: type lookup is exact match, then longest registered prefix —
that's why `custom:wasm:./m.wasm` and `custom:gosrc:./foo.go` work (prefix resolves,
suffix carries the path). Unknown types fail at evaluate time with a FAIL verdict.

## Logic — builtin, deterministic

### String (`value:` is a string; `-any`/`-all` also accept comma-split scalars)

String and structured checks grade **`Session.FinalOutput` only** — the agent's last
user-visible message. Code written to disk but not quoted in the final message will
NOT match `contains`; grade files with `exec` (grep/test) instead.

`equals` · `not-equals` · `contains` · `not-contains` · `icontains` · `starts-with` ·
`ends-with` · `regex` · `not-regex` · `contains-any` · `contains-all` ·
`icontains-any` · `icontains-all`

### Numeric (`threshold:` is the bar; scores normalized high-is-good)

| Type | Threshold means | Notes |
|---|---|---|
| `latency` | max **milliseconds** | `Score = 1 - actual/threshold` |
| `cost` | max **USD** | |
| `levenshtein` | max edit distance vs `value:` | default 10 |
| `is-refusal` | — | refusal phrases; empty output counts as refusal |

**`latency` and `cost` ERROR when the session reported no metrics** (v0.10.0). They used
to read the raw field and score a perfect **1.00** on data that was never reported —
so under `--harness mock` both passed every time while the metrics block printed
`cost n/a`, and a negative control showed green ticks that meant nothing. Now:

```
errored  latency   0.00  latency: not reported by this session; the ≤60000ms bound graded nothing
errored  cost      0.00  cost: not reported by this session; the ≤$0.1000 bound graded nothing
```

Error rather than fail is the deliberate call: missing evidence is not "too expensive".
These remain *runaway guards* for real runs — never evidence that a bench measures its
task.

### Structured

`is-json` / `contains-json` (optional `value:` = JSON Schema map) ·
`is-xml` / `contains-xml` · `is-html` / `contains-html` (optional
`value: {rootTag, hasElement, attrHas}`) · `is-sql` / `contains-sql` ·
`is-valid-function-call` · `is-valid-openai-tools-call`

`is-html` without `value:` uses a tokenizer, not a lenient parser, on purpose: it
requires an explicit start/self-closing tag, so bare plaintext doesn't spuriously
pass (a lenient parser would wrap any text in implicit `<html><body>`).

### NLP (`value:` = reference text, `threshold:` default 0.5)

`bleu` · `rouge-n` (`args.n`) · `gleu`. (`meteor`, `perplexity`, `perplexity-score`
are stubs that error, pointing to the subprocess transport.)

### Session (grades what the agent DID)

Canonical prefix is **`session:`**. The pre-rename `trajectory:` spelling is still
registered as an accepted alias so old bench files keep loading — **never write it in
a new file.**

**What each one reads is the whole game.** A `Session` carries two views of the run,
and they are not interchangeable:

- **`Session.Actions`** — the **authoritative** event stream. Everything the agent
  did, in order, including subagent lifecycle rows.
- **`Session.Calls`** — a **lossy derived view** built by `DeriveCalls`. Only
  `tool_call` and `mcp_call` kinds survive; subagent lifecycle rows and assistant
  messages are deliberately excluded.

Nine canonical types. All 0/1.

| Type | Reads | Usage |
|---|---|---|
| `session:tool-used` | `Calls` | `value:` = tool name (string or list) · `args.thread:` |
| `session:tool-args-match` | `Calls` | `value:` = tool name, `args.args:` = expected args map (subset match; values exact or a matcher) · `args.thread:` |
| `session:tool-sequence` | `Calls` | `value:` = ordered tool list (subsequence match) · `args.thread:` |
| `session:file-read` | `Actions`, then `Calls` | `value:` = path **relative to `Session.WorkDir`** (absolute and matchers also accepted) · `args.tools:` = reading tool names (default `Read`/`NotebookRead`/`View`/`read_file`) |
| `session:step-count` | `Metrics.StepCount` | **main thread only** · **`args.lte: N` / `args.gte: N`** — bare `threshold`/numeric `value` is EXACT match |
| `session:subagent-used` | **`Actions`** | passes if any subagent spawn row was captured · `args.agent:` |
| `session:subagent-count` | **`Actions`** | `value:` = minimum spawn count (positive integer) · `args.agent:` |
| `session:skill-used` | **`Actions`** | `value:` = skill name (case-insensitive) |
| `session:image-sent` | **`Actions`** | the Scenario's `image:` reached the model — `value:` = minimum attachment count (whole number ≥ 1, default 1) |

**Four things measured on a v0.10.0 binary that the table cannot show.**

**`session:step-count` takes ONE bound.** Given both, `lte` is read first and `gte` is
silently dropped (`parseStepCount` returns on the first key it finds), so
`args: {gte: 1, lte: 20}` is just `lte: 20`. Write a range as two checks. An `lte`-only
check is inherently vacuous — 0 steps satisfies it — so `madbench check` will always
name it; the companion `gte:` is the one carrying evidence.

**`session:file-read` counts every Read CALL, not every successful read.**
`collectFileReads` skips `tool_result` rows but never consults them, so a Read of a path
that did not exist still counts. For a ROUTING question that is usually what you want —
reaching for a file is the routing signal — but the check then means "went looking for",
not "read the contents of". State which one your bench means.

**The skill name is not stable, so do not gate on `session:skill-used` alone.** Within
one `--repeat 8` run the same PROJECT skill was recorded as both `security` and
`bun:security`; a PLUGIN skill recorded as `bunjs:errors` with bare `errors` scoring
0.00. There is no always-qualify or never-qualify rule. Read `session.actions` for a
`kind: "skill"` row and copy `tool_args.skill` verbatim — or better, use a disjunction
over the routes a skill can be consumed by:

```yaml
- type: any-of                      # "was this skill consumed", robustly
  metric: Recall
  checks:
    - { type: session:file-read, value: "glob:**/skills/security/**" }
    - { type: session:skill-used, value: "security" }
    - { type: session:tool-args-match, value: Bash,
        args: { args: { command: "contains:skills/security/" } } }
```

Bash is in there because it is not hypothetical: a measured session consumed a skill via
`cp -r .claude/skills/security/…` with no `Read` call at all.

**Composites do not nest.** A composite inside another composite loses its children:
`child "any-of": no child assertions ('checks' field is empty)`. Verified with plain
YAML and no anchors. Write the routes FLAT inside one `any-of`/`not-any-of` — exact for
those two operators, but NOT safe for `assert-set`, whose weights depend on grouping.


`session:subagent-used` / `session:subagent-count` read `Actions` precisely *because*
subagent rows are excluded from `Calls`. They already answer "did this agent delegate,
and how much?" — reach for them before writing a probe to discover it yourself.

**`session:skill-used` works as of v0.10.0** — and the way it was broken is the single
best illustration of why the `Actions`/`Calls` distinction is the whole game. It used to
scan `Session.Calls` for a call named `Skill`. The claude-code parser turns a `Skill`
tool_use into an **`ActionSkill`** event, and `DeriveCalls` collects only `ActionToolCall`
and `ActionMCPCall` — so `ActionSkill` never reached `Calls` and the loop found nothing,
**no matter what the agent did**. It now reads `Actions`. Two things follow:

- A bench that worked around this by grepping `session.actions[]` from the report JSON
  can be replaced by the check.
- Under `harness_config.agent_env`, `--bare` stops advertising skills altogether, so only
  an explicit `/<skill>` in the prompt resolves and an agent will never invoke one
  spontaneously. **Do not write `session:skill-used` in an `agent_env` bench** — it cannot
  fire. Under `plugins:` (no `--bare`) skills are advertised normally and it can.

`session:goal-success` is registered but **always errors by design** — its constructor
returns the error rather than a check. It exists to tell you to route the question
through `llm-rubric` instead.

#### Scoping to a thread or a named agent

A Session interleaves the main thread with every subagent it spawned, so *"was `Write`
used"* and *"did the agent under test use `Write`"* are different questions.

| `args.thread` | Grades |
|---|---|
| `main` | the top-level agent only (`Action.Thread == ""`) |
| a subagent's name | that subagent only — its display name (`subagent_type`) or its stable agent id |
| *(omitted)* | any thread — the behavior every pre-v0.10.0 bench has |

```yaml
checks:
  # the agent under test must write, not just delegate the writing
  - { type: session:tool-used, value: "Write", args: { thread: main } }
  # ...and it must have delegated to this specific agent
  - { type: session:subagent-used, args: { agent: general-purpose } }
```

`args.agent` on the `subagent:*` pair is the same idea for spawns.

#### Asserting on a path you cannot know: matchers

The WorkDir is a per-run tmpdir, so no literal a bench author can type will equal the
absolute path the agent reports. `session:file-read` resolves its `value:` relative to
the WorkDir; matchers cover the rest. The prefix picks the kind:

| prefix | matches |
|---|---|
| *(none)* | exact — the default, unchanged from before matchers existed |
| `exact:` | exact — escape hatch for a literal that itself starts with a prefix |
| `glob:` | path glob: `*`, `?`, `[…]` within a segment; `**` across segments; anchored both ends |
| `suffix:` | tail of the string |
| `contains:` | anywhere in the string |

```yaml
checks:
  - type: session:file-read
    value: .claude/skills/security/SKILL.md
  - type: session:tool-args-match
    value: Read
    args:
      args: { file_path: "glob:**/skills/security/SKILL.md" }
```

Available on `session:tool-args-match` expectations and `session:file-read`'s `value`.
Exact stays the default, so no existing bench changes meaning — with one exception: a
literal that itself opens with `glob:`/`suffix:`/`contains:`/`exact:` is now read as a
matcher. Write `exact:` in front of it to get the literal back. Non-string expectations
(numbers, maps, lists) are always exact.

**The macOS `/private` divergence is handled.** The sandbox stores `os.MkdirTemp`'s raw
return (`/var/folders/…`) while Claude Code reports the resolved spelling
(`/private/var/folders/…`); `session:file-read` compares through `internal/hostpath`,
which knows those name one file. Evidence carries `work_dir`, `expected_resolved` and
every `paths_read`, so a failure shows which spelling arrived. **A naive prefix compare
gets this wrong — that bug has already shipped once.**

**This retires the sentinel-token workaround.** Benches used to inject a unique token
into every `SKILL.md` and grep the output for it — a bench that measures *modified*
skills, where a compliance failure is indistinguishable from a routing failure.

#### `session:image-sent`

Asserts the Scenario's `image:` actually **reached the model**, by counting attachment
events with an `image/…` media type in `Actions`. Pair it with whatever grades the
answer — on its own it proves delivery, not comprehension.

```yaml
scenarios:
  - name: reads-the-chart
    prompt: "Which quarter had the steepest drop?"
    image: ./revenue.png
    checks:
      - { type: session:image-sent }          # the picture was delivered
      - { type: icontains, value: "Q3" }      # ...and it answered from it
```

Only `claude-code` can carry an image (`harness.ImageCapable`), so an `image:` bench
**cannot be negative-controlled** — `madbench check` refuses with *harness "mock" cannot
deliver an image*.

### Composites (children under nested `checks:`; `assert:` is the legacy alias)

| Type | Semantics |
|---|---|
| `assert-set` | weighted pass ratio; `threshold:` defaults **1.0** (all). Score = passedWeight/totalWeight |
| `any-of` | passes if any child passes; Score = max child |
| `not-any-of` | passes if NO child passes; Score = 1 − max |
| `select-best` | best child (single session) or best provider session (multi); optional `args.weights` map |
| `max-score` | max child/session score; `args.method: sum\|average`, `args.threshold` |
| `compare` | A/B — passes only if FIRST provider strictly beats all others |

`weight:` on a child (default 1.0) scales its contribution.

### Mastra-parity scorers (deterministic)

`completeness` · `keyword-coverage` · `tone` · `content-similarity` ·
`textual-difference` · `code-tool-call-accuracy`

## AI — LLM judge

Registered **only when a judge provider resolves at run start** — either a `judges:`
block in the bench file, or (legacy fallback) `ANTHROPIC_API_KEY` in the env. With
neither, these types don't exist and fail as `unknown assertion type` — same error as
a typo. `value:` holds the rubric/criteria text; default semantic threshold 0.7.
Judge returns `{"pass": bool, "score": 0–1, "reason": "..."}`.

### Multi-provider judges (`judges:` top-level block, modelspec notation)

Judge entries are **model specs** (`pkg/modelspec`) — a SHORT string or a LONG map:

```yaml
judges:
  default: opus-4.8              # bare short form → anthropic (canonicalized LATEST_OPUS_MODEL)
  providers:
    fast: haiku-4.5              # short: provider inferred by model prefix
    ds:   deepseek/deepseek-chat # short: explicit provider/model (separator is /)
    or-qwen:                     # long form: full control (gateways, params)
      transport: openai          # wire format: anthropic | openai (`type:` alias ok)
      endpoint: https://openrouter.ai/api/v1   # (`base_url:` alias ok)
      model: qwen/LATEST_QWEN_MODEL     # literal — long-form model is never split or canonicalized
      api_key_env: OPENROUTER_API_KEY
      params: { temperature: 0.0, max_tokens: 1024 }  # sent on the wire; unknown keys stored-not-sent
```

- Twelve built-in providers with default endpoint + conventional key env + cheap
  default model: `anthropic`(ANTHROPIC_API_KEY) · `openai`(OPENAI_API_KEY) ·
  `gemini`(GEMINI_API_KEY, OpenAI-compat endpoint) · `grok`(XAI_API_KEY) ·
  `glm`(ZAI_API_KEY) · `minimax`(MINIMAX_API_KEY) · `kimi`(MOONSHOT_API_KEY) ·
  `deepseek`(DEEPSEEK_API_KEY) · `mistral`(MISTRAL_API_KEY) · `qwen`(DASHSCOPE_API_KEY)
  plus two gateways: `openrouter`(OPENROUTER_API_KEY, default `openrouter/auto`) ·
  `ollama`(OLLAMA_API_KEY, ollama.com cloud, default `LOCAL_MODEL`).
  Aliases work (`google/…`, `moonshot/…`, `xai/…`); only anthropic uses the anthropic
  wire — everything else is OpenAI-compatible.
- Gateways have no prefix inference — reach them explicitly
  (`openrouter/anthropic/LATEST_SONNET_MODEL`, `ollama/LOCAL_MODEL`; after the
  first `/` the model is literal, slashes/`:tags` included). A bare provider key is
  also valid short form (`default: openrouter` → the auto-router). Local Ollama: long
  form with `endpoint: http://localhost:11434/v1`.
- Bare short form infers the provider from the model prefix (opus/sonnet/haiku→anthropic,
  gpt-→openai, gemini-, grok-, glm-, minimax-, kimi-, deepseek-, mistral-, qwen-…);
  no match is an ERROR (never guessed) — use `provider/model` or long form.
  Anthropic short ids canonicalize: `opus-4.8` → `LATEST_OPUS_MODEL`.
- Key VALUES never go in YAML — only env var names; unset env → provider silently
  skipped (run-start error if it was the explicit `default:`). Named env vars are
  forwarded to the sandbox redacted-from-capture.
- `judges.default:` may name a declared id OR be a bare spec (auto-declared).
- Per-check overrides on any AI check (each falls back to suite default → provider
  default): `args: { judge: or-qwen, model: LATEST_OPUS_MODEL, temperature: 0.0, max_tokens: 512 }`.

The judge grades **FinalOutput + rubric only** (a correct-but-terse answer fails a
rubric demanding explanation — write rubrics about the answer, not the working). It's
injection-hardened: agent-controlled text is XML-wrapped with closing-tags stripped,
and the parser takes the last balanced JSON object, so an agent can't smuggle a
`{"pass":true}` through its output.

`llm-rubric` · `factuality` · `answer-relevance`/`answer-relevancy` ·
`model-graded-closedqa` · `g-eval` · `context-faithfulness`/`faithfulness` ·
`context-recall` · `context-relevance` · `context-precision` · `prompt-alignment` ·
`llm-tool-call-accuracy` · `noise-sensitivity` · `toxicity` · `bias` · `hallucination`

Risk metrics (`toxicity`/`bias`/`hallucination`) are inverted to high-is-good; raw risk
goes in Evidence.

## Code — your program, sandboxed

### exec — run a command against the post-run workspace

Code-kind in the vocabulary (docs/vocabulary.md) even though it's implemented as a
builtin (`pkg/check/builtin/exec.go`) — the grader is *your command*, not a matcher.
Deterministic, and the workhorse outcome check for coding benches.

```yaml
- type: exec
  args:
    cmd: [go, test, ./...]   # canonical form. Or value: "go test ./..." — whitespace-split, NO shell
    expected_exit: 0         # default 0
    cwd: subdir              # optional, joined onto the sandbox WorkDir
    timeout: 30s             # default 60s
```

Failure `Reason` embeds the last 2KB of combined output. Needs a workspace: errors if
the session has no WorkDir and no `cwd`. For pipes/quoting use `cmd: [sh, -c, '…']`.

### Managed runtimes: `ts` / `js` (Bun) · `python` (uv)

```yaml
- type: ts
  value: output.includes(vars.requiredWord)      # inline expression
- type: python
  value: file://evals/check_output.py            # file evaluator
  config: { min_length: 20 }
```

Script scope: `output` (final output), `vars`, `config`, `session`, `assertion`,
`context`. File evaluators must export `evaluate(output, context)`. Boolean return →
pass/fail with score 1|0; object return passes through. Deps resolve from the nearest
project root (`package.json`+`bun.lock` / `pyproject.toml`+`uv.lock`); madbench
installs to its own cache, never mutates the repo. Pin via `defaults.bun`/`defaults.python`;
enforce locks with `defaults.lockfile_required: true` or `MADBENCH_LOCKFILE_REQUIRED=1`.

### `custom:gosrc` — JIT-compiled Go evaluator

Source via `inline:`, path via `value:`, or type suffix `custom:gosrc:./foo.go`.
Runs `go build` (needs `go` on PATH), binary cached by SHA256 of source + GOOS/GOARCH
+ Go version; 30s timeout. The compiled program speaks the same stdin/stdout envelope
as `custom:exec`.

### `custom:wasm`

Wazero (pure Go, WASI enabled — Go `wasip1` modules load). Path via `value:` or type
suffix `custom:wasm:./module.wasm`. Module exports `evaluate`, `alloc`, `free`,
`memory`; result returned as a packed `(ptr<<32)|len`. Default 5s timeout, 64MiB
(1024 pages).

### `custom:exec` — any CLI as evaluator

`args.command: [...]` or `value:` (shlex-split). Reads envelope
`{version:"madbench/v1", session, assertion, vars}` on stdin, writes a `Result` JSON
to stdout. Runs with a scrubbed env — only PATH/HOME/LANG/LC_ALL/TMPDIR plus
`MADBENCH=1` — and a 30s timeout.

## Service — `custom:http` · `model:current`

### `custom:http`

```yaml
- type: custom:http
  args:
    url: https://grader.example.com/score   # or value: "<url>"
    headers: { Authorization: "Bearer …" }  # optional
    timeout: 30s                            # default 30s
```

POSTs the same `madbench/v1` envelope; expects a `Result` JSON back.

### `model:current` — is that model real, and is it still the one?

The only Check whose expected answer is **fetched, not stored**. It asks the live
catalog at grading time through the `claudish` CLI. Nothing is pinned, deliberately: a
grader with a model id compiled into it *becomes* the stale snapshot it exists to
detect — madbench shipped exactly that bug in its own `pkg/modelspec/providers.go`.

```yaml
- type: model:current
  metric: SelectionIsRoutable
  args:
    file: .dev-session/iteration-config.json  # optional; default source = final output
    path: selectedModels.models               # optional dotted path within that JSON
    ignore: [internal]                        # sentinel values that are not model ids
    require: current                          # current (default) | superseded | retired
    allow_routes: false                       # default false
    min_count: 1                              # identities that must be found
    timeout: 60s
```

**Four verdicts**, because "not in the catalog" collapses two different agent mistakes:

| Verdict | Means |
|---|---|
| hallucinated | no such model has ever existed |
| retired | it existed and is gone |
| superseded | real and listed, but no longer the current one |
| a routing address where an identity belongs | an id containing `@` or `/` — set `allow_routes: true` if that is what you wanted |

`require:` names the **worst standing tolerated**, so the default is the strict question
("is it the current flagship?"). A bench that deliberately picks a lightweight model can
relax to `superseded` ("must still be listed") or `retired` ("must be a real model")
without giving up hallucination detection.

Two sources: `args.file` (+ optional `args.path`) when the agent was asked to **store** a
selection — the stored value is the artifact under test — or, by default, the Session's
final output when the agent was asked to **name** one. Candidates are tokens that look
like a model id (a known provider prefix plus at least one digit), so prose about "the
latest Kimi" is not mistaken for an identity claim.

## Choosing well

- Grade **outcomes** with exec (tests pass), **process** with Session checks (used
  Edit, ≤N steps, read that file, invoked that skill), **content** with
  string/structured, **judgment** with one focused `llm-rubric` — not five overlapping
  ones.
- Every exec-graded bench needs anti-cheat guards (grep that the test file survived,
  plus a Session check proving the agent edited).
- **Ask the narrowest true question.** `session:tool-used` with `args.thread: main` is a
  different and usually better claim than the unscoped version; `session:file-read` beats
  a `contains` on a sentinel you had to inject into the thing under test.
- **Prove the bench can fail before you trust it passing**: `madbench check` per cell,
  then `madbench grade` on the resulting report to confirm the verdicts reproduce.
- Prefer `metric:` names for anything referenced in `derivedMetrics`.
