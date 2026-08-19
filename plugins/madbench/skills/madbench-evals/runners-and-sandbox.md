# Runners (harnesses), permission modes, sandbox

## Runners

Set via top-level `harness:` (`runner:` still loads as an alias); override every bench
with `madbench <paths...> --harness <name>`.

### `claude-code` — the real thing

```yaml
runner: claude-code
runner_config:
  binary: claude                      # default "claude" (must be on PATH)
  model: LATEST_HAIKU_MODEL           # → --model
  system_prompt: "..."                # → --system-prompt (optional)
  args: ["--permission-mode", "acceptEdits"]   # appended verbatim
  agent_env: ./envs/fixed             # a whole .claude folder, copied → --bare
  plugins:                            # a plugin REGISTRY staged into ~/.claude
    - id: dev@magus
      path: ~/.claude/plugins/cache/magus/dev/3.3.0
```

madbench always adds `--print --verbose --output-format stream-json --session-id <uuid>`
and pipes the prompt via stdin. Fails at run time (not load time) if `claude` isn't on
PATH.

**`--input-format` is conditional.** It is `text` (raw prompt on stdin, byte for byte
what it always was) unless the Scenario declares `image:`, which flips that Scenario to
`--input-format stream-json` so the first user message can be a content-block array.
Undocumented in the CLI and worth knowing: **`--input-format stream-json` requires
`--output-format stream-json`** — madbench has always passed the output half, so the
coupling is satisfied for free.

The runner reads exactly **six** keys — `binary`, `model`, `system_prompt`, `args`,
`agent_env`, `plugins` — and **every other key is silently ignored**. Strict decoding
does not help here: `harness_config:` is an untyped map, so an unknown key inside it is
not a load error. There is no `temperature` key (pass CLI flags via `args:`, and only if
the installed `claude` build accepts them), and the `repo`/`k`/`temp`/`max-tok` keys seen
in `examples/tui-demo` are mock-runner dashboard chips, not real claude-code config.
Don't promise a model/param axis on a knob the runner never reads.

#### `agent_env:` and `plugins:` — two different questions

They **compose**; neither replaces the other. Declaring neither changes nothing —
isolation is opt-in.

| | asks | mechanism |
|---|---|---|
| `agent_env:` | what `.claude` **is** | a whole folder, copied verbatim, loaded via `--bare` + `--plugin-dir` |
| `plugins:` | what `.claude` **registers** | a user-scoped registry madbench owns the shape of, which the CLI discovers on its own |

```yaml
harness_config:
  plugins:
    - id:   benchproof@madbench-proof     # <plugin>@<marketplace>
      path: ./marketplace/plugins/benchproof   # the plugin FOLDER
      marketplace: ./marketplace          # only when path is not inside a registry
```

Three facts `plugins:` encodes so a bench never has to rediscover them: entries must be
**user-scoped**, `known_marketplaces.json` must be **copied, not synthesized**, and a
cache directory's **name is not its version**.

**Two consequences that decide which key you want:**

- **`plugins:` alone adds no flags at all** — no `--bare`, no `--plugin-dir`. That is the
  point: `--bare` turns plugin *discovery* off, and discovery reading the staged registry
  is exactly what the key exists to exercise. Passing `--plugin-dir` too would let a run
  pass even when the registry silently failed to resolve.
- **Skills behave differently under each.** Under `plugins:` they are advertised
  normally, so `session:skill-used` can fire. Under `agent_env:`, `--bare` stops
  advertising skills altogether — only an explicit `/<skill>` in the prompt resolves, an
  agent never invokes one spontaneously, and **`session:skill-used` can never fire, so do
  not write one**. A top-level `skills/` directory in an agent_env is never loaded at all;
  madbench hard-errors rather than run a bench whose skills were silently ignored (put
  them at `plugins/<plugin>/skills/<skill>/SKILL.md`).
- **Auth changes under `agent_env:`.** `--bare` reads `ANTHROPIC_API_KEY` or an
  `apiKeyHelper` in the env's own `settings.json`. It **never** reads OAuth or the
  keychain, so a `CLAUDE_CODE_OAUTH_TOKEN` that works for every other bench authenticates
  nothing here. Preflight has a dedicated blocking check for exactly this.

**HOME is load-bearing for metrics.** Sandbox level `home` (the default) sets
`HOME=<workDir>`; the harness reads the child's session telemetry JSONL from
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
madbench <paths...>           # explicit run — the bare command IS the run command
madbench preflight <paths...> # binaries, keys, runtimes, sandbox levels, testdata, graders
madbench check <paths...>     # NEGATIVE control: mock harness, every cell must FAIL
madbench grade <report|id>    # POSITIVE control: re-grade a recorded Session offline
madbench demo                 # built-in offline emulated bench: no keys, no spend
madbench list <paths...>      # proves it PARSES only — never the pre-run gate
madbench init [dir]           # scaffold a starter madbench.yaml (mock harness)
madbench report               # read stored reports: list, show, compare, trend
```

`madbench run <paths...>` still works but is **deprecated** — it prints a deprecation
notice on every invocation. Use the bare command.

**Preflight runs automatically** before every run and blocks it (`preflight: nothing was
run, no spend`); `--skip-preflight` opts out.

### `madbench check` — the negative control

Runs the bench under the mock harness and requires **every graded cell to fail**. The
mock echoes the prompt and does nothing else, so a check that still passes against it is
grading nothing — and would keep passing if the agent under test regressed to doing
nothing at all.

```
  1/3 cells failed as required · 2 errored (could not grade) · 0 wrongly passed

  COULD NOT GRADE (2) — these cells proved nothing either way:
    implement-add · cost
      cost: not reported by this session; the ≤$0.1000 bound graded nothing
```

The report is a **per-cell tally** — one line per (scenario, check) pair, which no other
surface counts — plus, by name, every cell that wrongly passed. `--verbose` lists all
cells. An **errored** cell is not counted as having failed as required: it graded
nothing, so it demonstrated neither soundness nor rot, and it gets its own bucket.

Exit: **0** = control holds · **1** = a cell wrongly passed, or could not be graded ·
**3** = nothing was graded. A bench declaring `sandbox: none` still needs
`--allow-host-writes` — the mock writes nothing, but the checks run for real, and at
level `none` an `exec` check is a command executed in the directory you are sitting in.

### `madbench grade` — the positive control

Re-grades the Sessions recorded in a report and checks every verdict reproduces: no
harness, no sandbox, no spend. Both on-disk shapes are accepted — the bare report from
`--report-json` and the stored envelope from `--report-dir` (by path or run id).

It **re-runs the evaluators** against the stored Session; it does not replay stored
verdicts. So a bench whose grading is non-deterministic reports **DIVERGED**, which is
the point.

Two things a stored report cannot replay are **SKIPPED with a stated reason** rather than
silently passed: checks that read the run's WorkDir (`exec`, `custom:exec`, file-loading
script graders — the sandbox tree was deleted when the run ended), and judge-backed
checks (re-grading means spending on a live judge, and a non-deterministic verdict cannot
be a control). A cell whose re-grade errors is reported as "could not re-grade", never as
reproduced.

Exit: **0** = every re-graded cell reproduced · **1** = at least one diverged or could
not be re-graded · **3** = nothing was re-graded.

### Flags

`--report-json <f>` · `--report-junit <f>` (skipped when `--repeat`>1) ·
`--report-dir <d>` (versioned report per invocation, enabling `madbench report` history) ·
`--report <id>` (open a stored report read-only in the dashboard; requires `--ui`, runs
nothing) · `--concurrency <n>` (default 4) · **`--harness <name>`** (override all
benches) · **`--sandbox <level>`** (override the sandbox level for all benches) ·
`--param key=value` (override a declared bench param, repeatable) ·
`--run <name>` (run only these Eval runs by name, repeatable — selects WHICH runs;
`--repeat` sets how many times each executes) ·
`--repeat <n>` (repeat for flake detection; >1 bypasses `--ui`; `--runs` deprecated alias — verified against `--help` 2026-08-19) ·
`--skip-preflight` · `--ui` (live TUI, single-run only — report flags are still honored
and written on quit) · `--plain` (append-only progress lines) · `--allow-host-writes`
(consent for sandbox level `none`) · `--no-update-check` · `--env-file <f>` / `--no-env`.
Exit code non-zero if any scenario failed or errored. `madbench init` refuses to
overwrite an existing file (prints "<path> already exists" and exits cleanly — not an
error).

**There is no `--runner` flag** — it was renamed to `--harness` and the old spelling is
a hard `unknown flag: --runner` error, not an alias.

Env: `MADBENCH_MOCK_RICH=1` · `MADBENCH_LOCKFILE_REQUIRED=1` (CI lockfile enforcement) ·
`MADBENCH_ALLOW_HOST_WRITES=1` (consent for sandbox level `none`, same as the flag).

## Sandbox

There are exactly **four** levels, and they answer one question:
**"what does the run get its own copy of?"** They nest strictly — each is the previous
plus one more thing sealed off.

| Level | Gets its own copy of | Notes |
|---|---|---|
| `none` | **nothing** — your real project dir, your HOME, your settings | needs `--allow-host-writes`; `workdir:` is only legal here |
| `workspace` | the working tree | |
| `home` | the working tree **and** HOME (agent settings, env) | **the default** |
| `container` | its own filesystem, processes and network | Docker; `image:` / `dockerfile:` / `user:` are container-only |

```yaml
defaults:
  sandbox: home              # bare string form
scenarios:
  - name: risky
    sandbox:                 # map form, per scenario
      level: container
      image: golang:1.25
      network: none
      share:
        env: [GH_TOKEN]
        secret_env: [MY_TOKEN]        # forwarded AND redacted from capture
        paths:
          - { from: /srv/corpus, to: /srv/corpus, access: ro }
```

**Retired spellings are REFUSED, not aliased.** Unlike the YAML key aliases
(`runner:`, `cases:`, …), a retired sandbox level is a hard load error:

```
sandbox: level "process" was renamed to "home" (want none, workspace, home, container)
```

`process` → `home`, and both `machine` and `docker` → `container`. A bench file
written before 2026-08 that still says `sandbox: process` **will not run at all**.

**Only `container` is a boundary.** The three local levels *arrange state*; they do
not confine a process. At `none`/`workspace`/`home` there is no chroot, namespace or
jail — the agent keeps the host PATH, can open any absolute host path, and can reach
the network. `network: none` is only enforceable under `container`. A
`bypassPermissions` agent (or a malicious `go test`) at level `home` can read and
write outside the WorkDir; "the tmpdir is disposable" is not the same as "safe". For
untrusted or adversarial benches, use `container`.

madbench rejects a config whose promises the level cannot keep (`network: none`,
`access: ro` shares, `image:`, `user:` below `container`) rather than accepting it and
quietly ignoring it — so the file never states a guarantee it does not have.

`testdata:` is copied into the sandbox WorkDir fresh for each scenario; the agent's
edits are visible to subsequent `exec` checks, then discarded.

Env handling: host vars are scrubbed by default. `share.env:` forwards named vars;
`share.secret_env:` forwards but redacts from capture; `sandbox.env:` sets literal
`name=value` pairs (never put a secret there — name it under `share.secret_env:` so
the value stays in your `.env`). `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` are injected by
the **engine** (into both the allowlist and the redaction list), not by the sandbox
layer.

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

Seed red (failing test / missing symbol / real bug), then **prove it with `madbench
check`** rather than by eye — it is the per-cell tally that tells you whether every check
can fail, and manual inspection routinely misses the one cell that cannot.

Each scenario gets a fresh copy, so scenarios can't contaminate each other.

**When the answer must be unguessable, use `generate:`** instead of committing it. A
generator runs once per run before the workspace exists, prints `NAME=VALUE` on stdout,
and madbench routes that value to the **grader only** — refusing the run if it is
findable in the workspace (symlink targets included), the prompt, or the report. Full
mechanics and the `image: generated:<name>` composition: `schema.md`.
