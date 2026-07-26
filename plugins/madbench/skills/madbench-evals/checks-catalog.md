# madbench checks catalog

Every check returns `Result{Pass, Score ∈ [0,1] higher-is-better, Reason, Evidence}`.
Raw metric values (ms, USD, risk) live in `Evidence`. Source: `pkg/eval/builtin/*`
(one file per family), `pkg/eval/{llmjudge,script,http,wasm,subprocess,gosrc}/`.

**Availability in a default build**: only the Logic builtins and `exec` are
unconditionally available. AI checks register only when `ANTHROPIC_API_KEY` resolves
(otherwise they fail as `unknown assertion type`); `ts`/`js` need `bun`, `python`
needs `uv`, `custom:gosrc` needs `go` on PATH (checked at run time); `container`
sandbox needs Docker.

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

### Trajectory (inspects the agent's Actions)

| Type | Usage |
|---|---|
| `trajectory:tool-used` | `value:` = tool name (string or list) |
| `trajectory:tool-args-match` | `value:` = tool name, `args.args:` = expected args map |
| `trajectory:tool-sequence` | `value:` = ordered tool list (subsequence match) |
| `trajectory:step-count` | **`args.lte: N` / `args.gte: N`** — bare `threshold`/default is EXACT match |
| `skill-used` | `value:` = skill name (checks `Skill` tool calls) |

`trajectory:goal-success` errors by design — use `llm-rubric` instead.

### Composites (children under nested `assert:`)

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
  default: opus-4.8              # bare short form → anthropic (canonicalized claude-opus-4-8)
  providers:
    fast: haiku-4.5              # short: provider inferred by model prefix
    ds:   deepseek/deepseek-chat # short: explicit provider/model (separator is /)
    or-qwen:                     # long form: full control (gateways, params)
      transport: openai          # wire format: anthropic | openai (`type:` alias ok)
      endpoint: https://openrouter.ai/api/v1   # (`base_url:` alias ok)
      model: qwen/qwen3-235b     # literal — long-form model is never split or canonicalized
      api_key_env: OPENROUTER_API_KEY
      params: { temperature: 0.0, max_tokens: 1024 }  # sent on the wire; unknown keys stored-not-sent
```

- Twelve built-in providers with default endpoint + conventional key env + cheap
  default model: `anthropic`(ANTHROPIC_API_KEY) · `openai`(OPENAI_API_KEY) ·
  `gemini`(GEMINI_API_KEY, OpenAI-compat endpoint) · `grok`(XAI_API_KEY) ·
  `glm`(ZAI_API_KEY) · `minimax`(MINIMAX_API_KEY) · `kimi`(MOONSHOT_API_KEY) ·
  `deepseek`(DEEPSEEK_API_KEY) · `mistral`(MISTRAL_API_KEY) · `qwen`(DASHSCOPE_API_KEY)
  plus two gateways: `openrouter`(OPENROUTER_API_KEY, default `openrouter/auto`) ·
  `ollama`(OLLAMA_API_KEY, ollama.com cloud, default `gpt-oss:20b-cloud`).
  Aliases work (`google/…`, `moonshot/…`, `xai/…`); only anthropic uses the anthropic
  wire — everything else is OpenAI-compatible.
- Gateways have no prefix inference — reach them explicitly
  (`openrouter/anthropic/claude-sonnet-5`, `ollama/qwen3-coder:480b-cloud`; after the
  first `/` the model is literal, slashes/`:tags` included). A bare provider key is
  also valid short form (`default: openrouter` → the auto-router). Local Ollama: long
  form with `endpoint: http://localhost:11434/v1`.
- Bare short form infers the provider from the model prefix (opus/sonnet/haiku→anthropic,
  gpt-→openai, gemini-, grok-, glm-, minimax-, kimi-, deepseek-, mistral-, qwen-…);
  no match is an ERROR (never guessed) — use `provider/model` or long form.
  Anthropic short ids canonicalize: `opus-4.8` → `claude-opus-4-8`.
- Key VALUES never go in YAML — only env var names; unset env → provider silently
  skipped (run-start error if it was the explicit `default:`). Named env vars are
  forwarded to the sandbox redacted-from-capture.
- `judges.default:` may name a declared id OR be a bare spec (auto-declared).
- Per-check overrides on any AI check (each falls back to suite default → provider
  default): `args: { judge: or-qwen, model: claude-opus-4-8, temperature: 0.0, max_tokens: 512 }`.

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
builtin (`pkg/eval/builtin/exec.go`) — the grader is *your command*, not a matcher.
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

## Service — `custom:http`

```yaml
- type: custom:http
  args:
    url: https://grader.example.com/score   # or value: "<url>"
    headers: { Authorization: "Bearer …" }  # optional
    timeout: 30s                            # default 30s
```

POSTs the same `madbench/v1` envelope; expects a `Result` JSON back.

## Choosing well

- Grade **outcomes** with exec (tests pass), **process** with trajectory (used Edit,
  ≤N steps), **content** with string/structured, **judgment** with one focused
  `llm-rubric` — not five overlapping ones.
- Every exec-graded bench needs anti-cheat guards (grep that the test file survived,
  trajectory proof the agent edited).
- Prefer `metric:` names for anything referenced in `derivedMetrics`.
