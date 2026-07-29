# Runners (harnesses), permission modes, sandbox

## Runners

Set via top-level `runner:`; per-run override with `madbench run --runner <name>`.

### `claude-code` — the real thing

```yaml
runner: claude-code
runner_config:
  binary: claude                      # default "claude" (must be on PATH)
  model: LATEST_HAIKU_MODEL    # → --model
  system_prompt: "..."                # → --system-prompt (optional)
  args: ["--permission-mode", "acceptEdits"]   # appended verbatim
```

madbench always adds `--print --verbose --output-format stream-json --input-format text
--session-id <uuid>` and pipes the prompt via stdin. Fails at run time (not load time)
if `claude` isn't on PATH.

The runner reads ONLY `binary`, `model`, `system_prompt`, and `args` from
`runner_config` — **every other key is silently ignored**. There is no `temperature`
key (pass CLI flags via `args:`, and only if the installed `claude` build accepts
them), and the `repo`/`k`/`temp`/`max-tok` keys seen in `examples/tui-demo` are
mock-runner dashboard chips, not real claude-code config. Don't promise a model/param axis on a
knob the runner never reads.

**HOME is load-bearing for metrics.** The process sandbox sets `HOME=<workDir>`; the
runner reads the child's session telemetry JSONL from
`<HOME>/.claude/projects/<slug>/<sessionID>.jsonl` (that's where structured Edit/Write
diffs and subagent timelines come from, with stream-json as fallback). Overriding
`HOME` via `sandbox.env:` breaks that enrichment — leave it alone.

#### Permission modes — the #1 source of confusing failures

In `--print` mode there is no human to approve tool calls, so **un-approved tools
silently no-op**. The agent will claim success while nothing changed on disk; the
transcript typically ends with "please approve `go test ./...`" or similar.

| Scenario needs | Required `args:` |
|---|---|
| Read-only (Q&A, analysis) | none (default mode) |
| Write/edit files | `["--permission-mode", "acceptEdits"]` |
| Run commands too (go test, npm…) | `["--permission-mode", "bypassPermissions"]` |

Restrict tools with e.g. `["--disallowedTools", "Agent,Workflow"]` when benching
single-agent behavior.

### `mock` — offline, deterministic

`runner: mock`, no config. Echoes the prompt as output (promptfoo `echo` parity);
a `providers:` entry `mock:<payload>` returns `<payload>` verbatim, and `!ERROR!`
anywhere in the prompt forces a runner error — enough to test failure rows and
per-provider outputs offline. Use for developing/testing bench YAML without API keys
or cost: string/structured/numeric/composite checks and `exec` (against seeded
testdata) all run for zero tokens. `MADBENCH_MOCK_RICH=1` additionally swaps in
offline `llm-rubric`/`exec`/`custom:http` demo evaluators so `--ui` renders every
check kind with no network or key.

### `magmux` — multi-agent side-by-side

```yaml
runner: magmux
runner_config:
  mode: interactive
  providers:
    haiku:  { runner: claude-code, config: { model: LATEST_HAIKU_MODEL } }
    sonnet: { runner: claude-code, config: { model: LATEST_SONNET_MODEL } }
cases:
  - name: compare
    providers: [haiku, sonnet]      # fan out; composites (compare/select-best) see all sessions
```

Needs `claude` on PATH, a real TTY, and `--concurrency=1`. magmux is an
independently installed CLI tool (no build-time coupling): resolved as
`runner_config.binary` > `$MADBENCH_MAGMUX` > PATH.

**The providers map is a magmux feature.** Under `runner: claude-code`, a case-level
`providers:` list still fans out one run per label, but the runner ignores the label
and any `runner_config.providers` map — every row runs the identical `model` config.
A multi-model eval written that way loads cleanly via `madbench list` and then silently runs
the same model N times. To vary model/config: an **Eval file** with explicit `runs:`
entries (see schema.md / docs/eval-file.md) — or `runner: magmux`.

## CLI

```bash
madbench                      # discover madbench.yaml in cwd and run
madbench run <paths...>       # explicit run
madbench list <paths...>      # parse-check + list benches/scenarios (author's smoke test)
madbench init [dir]           # scaffold a starter madbench.yaml (mock runner)
```

Flags: `--report-json <f>` · `--report-junit <f>` (skipped when `--repeat`>1) ·
`--concurrency <n>` (default 4) · `--runner <name>` (override all benches) ·
`--repeat <n>` (repeat for flake detection; >1 bypasses `--ui`; `--runs` deprecated alias) · `--ui` (live TUI,
single-run only — report flags are still honored and written on quit). Exit code
non-zero if any scenario failed or errored. `madbench init` refuses to overwrite an
existing file (prints "<path> already exists" and exits cleanly — not an error).

Env: `MADBENCH_MOCK_RICH=1` · `MADBENCH_LOCKFILE_REQUIRED=1` (CI lockfile enforcement).

## Sandbox

Per-case `sandbox:` (or `defaults.sandbox:` for the mode string):

- **`process`** (default) — fresh tmpdir per scenario + scrubbed env. **This is NOT
  filesystem isolation**: no chroot/namespace/jail, host PATH, and `network: none`
  is not enforceable here. A `bypassPermissions` agent (or a malicious `go test`)
  can read and write outside the WorkDir. "The tmpdir is disposable" ≠ "safe" — for
  untrusted or adversarial benches use `container` mode.
- **`container`** — opt-in Docker; requires `image:`. `network: default|none|allow`
  (`none` only enforced in container mode).

`testdata:` is copied into the sandbox WorkDir fresh for each scenario; the agent's
edits are visible to subsequent `exec` checks, then discarded.

Env handling: host vars are scrubbed by default. `EnvAllowlist` forwards named vars;
`SecretEnv` forwards but redacts from capture; per-case `sandbox.env:` adds extra
vars. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` are injected by the **engine** (into both
the allowlist and the redaction list), not by the sandbox layer.

## Testdata conventions

Canonical bench layout:

```
your-bench/
├── madbench.yaml
├── README.md
└── testdata/repo/        # <10 files, seeded RED
    ├── go.mod
    └── ...
```

Seed red (failing test / missing symbol / real bug), verify red manually by running the
exec command in the testdata dir before trusting the bench. Each scenario gets a fresh
copy, so scenarios can't contaminate each other.
