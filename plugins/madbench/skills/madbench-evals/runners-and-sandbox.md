# Runners (harnesses), permission modes, sandbox

## Runners

Set via top-level `harness:` (`runner:` still loads as an alias); override every bench
with `madbench <paths...> --harness <name>`.

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
madbench preflight <paths...> # binaries, keys, runtimes, sandbox levels, testdata paths
madbench demo                 # built-in offline emulated bench: no keys, no spend
madbench list <paths...>      # proves it PARSES only — never the pre-run gate
madbench init [dir]           # scaffold a starter madbench.yaml (mock harness)
madbench report               # read stored reports: list, show, compare, trend
```

`madbench run <paths...>` still works but is **deprecated** — it prints a deprecation
notice on every invocation. Use the bare command.

Flags: `--report-json <f>` · `--report-junit <f>` (skipped when `--repeat`>1) ·
`--concurrency <n>` (default 4) · **`--harness <name>`** (override all benches) ·
`--param key=value` (override a declared bench param, repeatable) ·
`--repeat <n>` (repeat for flake detection; >1 bypasses `--ui`; `--runs` deprecated alias) ·
`--ui` (live TUI, single-run only — report flags are still honored and written on
quit) · `--plain` (append-only progress lines) · `--allow-host-writes` (consent for
sandbox level `none`) · `--env-file <f>` / `--no-env`. Exit code non-zero if any
scenario failed or errored. `madbench init` refuses to overwrite an existing file
(prints "<path> already exists" and exits cleanly — not an error).

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

Seed red (failing test / missing symbol / real bug), verify red manually by running the
exec command in the testdata dir before trusting the bench. Each scenario gets a fresh
copy, so scenarios can't contaminate each other.
