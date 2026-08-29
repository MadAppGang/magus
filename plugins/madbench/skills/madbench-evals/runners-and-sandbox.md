# Harness, sandbox and CLI

Reference for `madbench:madbench-evals`. How the agent is configured and driven, how much of
the machine a run may touch, and the whole command line. Mirrors madbench **v0.23.0**.

---

## 1. The Harness interface

A **Harness** is the agent under test: the thing madbench launches, watches, and turns into a
**Session**. One YAML key names it (`harness:`), one map configures it (`harness_config:`).

```go
type Harness interface {
    Name() string                                              // the YAML discriminator
    Run(ctx context.Context, req RunRequest) (*Session, error) // execute, return ground truth
}
```

Two **optional** extensions, detected by type assertion — no adapter must implement either:

| Interface | Method | Engine picks it up when |
|---|---|---|
| `MultiProviderHarness` | `RunProviders(ctx, req, providers)` | the Scenario declares `providers:` |
| `StreamingHarness` | `RunStream(ctx, req, emit)` | always, when implemented and no `providers:` |

`RunStream`'s streamed events are **advisory** — the returned `*Session` is the single source
of truth, and the engine forwards emitted events only as cosmetic progress for the dashboard.

### `RunRequest` — what a Scenario becomes

| Field | Comes from |
|---|---|
| `Prompt` | the Scenario's `prompt:`, after `{{param}}` substitution |
| `Images` | the Scenario's `image:`, as host paths resolved against the bench file |
| `Vars` | the Scenario's `vars:` |
| `WorkDir` | `sandbox.WorkDir()` — the seeded tmpdir, **and the agent's `HOME`** |
| `Env` | `sandbox.Env()` — the scrubbed environment |
| `Timeout` | Scenario `timeout:` > bench `defaults.timeout:` > **300s** |
| `Capture` | Scenario `capture:` > `defaults.capture:` > `log` |
| `Config` | `harness_config:`, verbatim |
| `Provider` | the current `providers:` entry, `""` for a single-provider run |

> **The default timeout is 300s, not 120s.** It was raised on 2026-08-27 because 120s was
> calibrated for `--print`, and a cold-start **interactive** turn exceeds it. Declare your own;
> the fallback is deliberately generous so the common failure is a real one rather than a
> stopwatch.

---

## 2. `claude-code` — the whole configuration surface

```yaml
harness: claude-code
harness_config:
  binary: claude                                  # default "claude"
  model: claude-haiku-4-5-20251001                # "" omits --model
  effort: high                                    # low·medium·high·xhigh·max
  system_prompt: "You are terse."                 # "" omits --system-prompt
  agent_env: ./envs/fixed                         # a declared `.claude` — §5
  plugins:                                        # a staged plugin registry — §6
    - id: dev@magus
      path: <plugin cache dir>/dev/3.3.0
  environment:                                    # how hard to look — §7
    probe: true
  args: ["--permission-mode", "bypassPermissions"] # appended last
```

**Nine keys. That is the entire schema** (`Config`, `pkg/harness/claudecode/harness.go`).
Upstream's `harness.md` says "eight keys" and omits `environment` from its table; the struct
has nine.

| Key | Type | Default | Effect |
|---|---|---|---|
| `binary` | string | `claude` | the executable, `LookPath`'d at run time. Empty string is an error — omit the key |
| `magmux_binary` | string | *(unset)* | the magmux build hosting an **interactive** run. Precedence: this > `$MADBENCH_MAGMUX` > PATH. Ignored by a non-interactive Scenario |
| `model` | string | *(unset)* | `--model <value>` |
| `effort` | string | *(unset)* | `--effort <value>`. **The one key checked by value**: `low`, `medium`, `high`, `xhigh`, `max`, exact and case-sensitive. Empty string is an error; write `~` for "the CLI's default" |
| `system_prompt` | string | *(unset)* | `--system-prompt <value>` |
| `agent_env` | string | *(unset)* | a directory shaped like a `.claude` folder — §5 |
| `plugins` | []{id, path, marketplace} | *(none)* | a staged plugin registry — §6 |
| `environment` | {probe, details, require} | probe true | how hard madbench looks at what loaded — §7 |
| `args` | []string | *(none)* | extra argv, appended after everything madbench adds |

### Error behaviour

- An **unrecognized key is silently ignored** — the documented contract, so adapters can
  evolve independently. A typo like `permission_mode:` therefore does *nothing*, quietly.
- A **recognized key with the wrong type is a hard error**, naming key, expected type and
  actual: `claude-code harness_config: model must be a string, got int`.
- **`effort` is additionally checked by VALUE**, because the CLI will not check it for us.
  A misspelt level does **not** fail the CLI — it warns and runs at the default, exit 0, so
  an A/B meaning to compare `high` against `low` would compare the default against itself and
  report the pair as a finding. The refusal lands at configure time, before a sandbox exists
  and before any model is billed.
- `ParseConfig` does **no I/O** — binary existence is checked in `Preflight` or at run time.

### The argv madbench builds — non-interactive only

This describes `interactive: false`. An interactive Scenario builds a different command line
entirely (no `--print`, no `--output-format`) and runs it inside a magmux pane — §3.

```
claude --print \
       --verbose \
       --output-format stream-json \
       --input-format text \
       --session-id <fresh-uuid> \
       [--bare --setting-sources "" --plugin-dir … --mcp-config … --strict-mcp-config --settings …] \
       [--model <model>] \
       [--system-prompt <system_prompt>] \
       [--effort <effort>] \
       <args...>
```

The bracketed `--bare` block appears **only when `agent_env` is set**. The first five flags
are always present and never configurable:

| Flag | Why |
|---|---|
| `--print` | non-interactive; there is no human to answer prompts |
| `--verbose` | required by `--output-format stream-json` |
| `--output-format stream-json` | one JSON event per stdout line — the Session source |
| `--input-format text` | prompt on stdin as plain text — **flips to `stream-json` when the Scenario declares `image:`** |
| `--session-id <uuid>` | a **fresh** UUID per run, correlating the on-disk session file |

> **`args:` is appended last, so it can collide.** Nothing stops you writing
> `args: ["--output-format", "json"]`; the CLI honours the later flag and madbench's parser
> then fails on output it cannot read. Do not re-specify the five flags above in `args:`.
>
> **A repeated flag resolves to its LAST occurrence** — measured, not assumed — so
> `effort: high` plus `args: ["--effort", "low"]` runs at `low`. That makes overriding
> `--model`, `--effort` and `--system-prompt` a supported escape hatch rather than a
> collision. But `args:` is shape-checked only, so an `--effort` typo *there* is back to a
> warning and a default-effort run. Prefer the key.

---

## 3. `interactive:` — how the agent is DRIVEN

```yaml
defaults:
  interactive: true      # THE DEFAULT; false runs one non-interactive turn
scenarios:
  - description: "…"
    interactive: false   # per-Scenario override
```

This is not a formatting flag. The two values are two different behaviours.

| | `interactive: true` *(default)* | `interactive: false` |
|---|---|---|
| how it runs | `claude` in a real terminal, hosted by magmux | `claude --print`, a pipe |
| the prompt | typed into the session over magmux's socket | piped to stdin |
| turns | many; the session can be steered | exactly one |
| ends when | the agent stops working | the process exits |
| Session from | the on-disk session JSONL, tailed live | the stdout `stream-json` |
| cost + tokens from | the `statusLine` channel | the `result` envelope |

**Interactive is the default because it is how these tools are used.** A one-shot `--print`
turn is the degenerate case. Measured on one greeting Scenario, same prompt and model:

| | `interactive: true` | `interactive: false` |
|---|---|---|
| cost | $0.0316 | $0.0114 |
| tokens | 25.4k | 127 |

The gap is the point: a real session carries the system prompt and context a `--print` turn
strips, so a bench that measures `--print` measures something substantially cheaper and
thinner than what anyone actually uses.

**It is sweepable.** `interactive: "{{drive}}"` resolves from an Eval `params:` value, so one
Eval file can run the same bench both ways and compare. The field is a small type rather than
a `bool` precisely so a placeholder survives YAML parsing.

Resolution follows the same precedence as `sandbox:` — bench `defaults:`, then
`defaultScenario:`, then the Scenario's own value. Unset anywhere means **true**. The field is
a `*bool` so "said nothing" and "said false" stay distinguishable.

**Interactive needs magmux ≥ 0.8.0 on THIS machine**, at every sandbox level, on PATH (or
`harness_config.magmux_binary`, or `$MADBENCH_MAGMUX`). `madbench preflight` checks for it
only when some Scenario is interactive, and the finding names `interactive: false` as a way out.

> **`sandbox: container` + `interactive: true` works on macOS and Linux alike.** madbench runs
> magmux on the host and the pane command enters the sandbox (`docker exec -t -i`), so both
> ends of the control socket live in one kernel. Nothing runs magmux inside the container.

### `follow_ups:` — steering the session

```yaml
scenarios:
  - prompt: "Remember the number 7. Just say OK."
    follow_ups:
      - "Now add 5 to the number you remembered. Reply with only the total."
      - "Multiply that total by 2. Reply with only the result."
```

Each follow-up is typed **only after the previous turn has ended**, so the exchange is a
conversation rather than a batch. One send, one turn, one entry in `Session.Turns`.

This is the only way `Session.Turns` is ever longer than one entry. **`follow_ups` with
`interactive: false` is rejected at load**: a `--print` run is a single pipe with no way back
in, and grading a shorter conversation than the bench declared is worse than refusing to run.

### Permission mode means different things on the two paths

**`--print` ignores `--permission-mode` entirely.** Measured against CLI 2.1.234: a `--print`
run with `default` executed a Bash call without approval, exactly as `acceptEdits` did. Every
tool is allowed, because there is nobody to ask.

Interactively the mode is real and enforced:

| mode | `--print` | interactive |
|---|---|---|
| `default` / `acceptEdits` | everything runs | Write/Edit run; **Bash parks at an approval menu nobody can answer** |
| `bypassPermissions` | everything runs | everything runs — after the disclaimer, which madbench pre-accepts |

**So the faithful interactive translation of a bench that ran `--print` with `acceptEdits` is
`bypassPermissions`.** That is not a widening of its access; it is the access it already had.
An `acceptEdits` carried over from a `--print`-era bench had never done anything, and on the
now-default interactive path it hangs the first Bash call until the timeout.

### The prompts only an interactive run ever sees

A `--print` turn answers no questions. A real session asks up to four before it will work,
each waiting on a keypress in a terminal nobody is watching — so an unseeded run does not
fail, it *hangs*, and reports only a timeout.

| Prompt | Why it fires | Seeded as |
|---|---|---|
| theme picker / "Let's get started" | every sandbox above `none` replaces HOME, so the CLI sees a first run | `hasCompletedOnboarding` |
| "Is this a project you trust?" | the workspace is a directory that never existed | `projects[<workdir>].hasTrustDialogAccepted` |
| "Detected a custom API key… use this?" (defaults to **No**) | madbench put `ANTHROPIC_API_KEY` in the environment | `customApiKeyResponses.approved` |
| "You accept all responsibility…" (defaults to **No, exit**) | the bench asked for `bypassPermissions` | `bypassPermissionsModeAccepted` **and** `skipDangerousModePermissionPrompt` |

madbench writes these into the sandbox's `~/.claude.json` **after the environment probe and
before launching**, merging rather than overwriting — the probe runs a real `claude` one step
earlier and that launch rewrites the file, consuming `bypassPermissionsModeAccepted`.

### Delegation: whose last word the run ends on

`Session.FinalOutput` is what every `contains`, `not-contains` and `llm-rubric` check reads.
It is the parent's last assistant message — **unless the parent ended its turn with a
delegation whose result it never received**, in which case it is the last assistant message of
the thread that answered.

```
[main   ] assistant_message  "The search is running. I'll let you know the results…"
[Explore] assistant_message  "## HandleLogin Search Results ### Definition - **File**: …"
```

The job answered; the answer was in the session, one action after the sentence every text
check was grading. The parent never follows up, so waiting longer does not help. It is
deliberately narrow and changes nothing for a run that never delegated, or one whose parent
received the result and spoke last.

**Handing off is still visible**: `session.steps.main` is 0 on exactly these runs, the
per-thread breakdown is in `Session.Subagents`, and `session:turn-count` still counts one turn.

### When a delegating run is finished

The Stop hook ends a **turn**, and a turn ends when the MAIN thread stops. An agent that
delegates hands the work off and stops, so the hook fires while the subagent is still writing
its own log. madbench therefore waits on the whole **job**. It is finished when all three hold:

1. the parent transcript has been quiet for the settle window;
2. every subagent sidecar has been quiet for that window — each on its own clock;
3. **no spawn is outstanding** — every `Agent`/`Task` call has its result.

(3) is not redundant: a sidecar not yet **created** is not quiet, it is pending, and file-size
polling alone would call that settled.

A subagent's conversation streams as it is written; its events carry `AgentID` and a `Thread`.
They do **not** count toward `Metrics.StepCount`.

**If a subagent is still running when the settle window times out, the Scenario ERRORs**,
naming the thread and when it spawned. It does not grade — a Session missing a thread's work
would score like a bad agent rather than reading like the incomplete capture it is.

---

## 4. Sandbox levels

Every Scenario runs in a **Sandbox**. Its level answers one question: **what does the run get
its own copy of?**

| Level | Gets its own copy of | Real files safe? | Enforces `network: none` / `access: ro`? |
|---|---|---|---|
| `none` | nothing — your real project directory, HOME, settings, environment | ❌ the agent edits your actual files | ❌ |
| `workspace` | the working tree | ✅ project; `~/.claude` restored afterwards | ❌ |
| `home` *(default)* | the working tree **and HOME** | ✅ | ❌ |
| `container` | the whole machine | ✅ | ✅ |

The retired spellings `process` (→ `home`), `machine` and `docker` (both → `container`) are
**REFUSED, not aliased**: `sandbox: level "process" was renamed to "home"`. It is a **load**
error, so every command refuses it identically. Only `container` confines a process; the three
local levels arrange state.

```yaml
defaults:
  sandbox: home              # shorthand: a bare level

scenarios:
  - name: hermetic
    testdata: ./code
    sandbox:                 # long form: a level plus everything else
      level: container
      # Declare ONE of these, or neither and get madbench's own image:
      #   image: node:22            # an existing image (pulled if absent)
      #   dockerfile: ./Dockerfile  # a recipe madbench builds and reuses
      dockerfile: ./Dockerfile
      network: none          # container only
      user: root             # container, Linux only; arms a cleanup ownership sweep
      share:
        env: [GITHUB_TOKEN]          # forwarded BY NAME from your resolved settings
        secret_env: [MY_VENDOR_KEY]  # forwarded AND redacted from the captured Session
        paths:
          - {from: ~/.cache/uv, to: ~/.cache/uv, access: rw}
          - {from: ./golden,    to: /opt/golden, access: copy}
          - {from: /srv/corpus, to: /srv/corpus, access: ro}  # container only
      env:
        CI: "1"              # literal values, checked into git — never secrets
```

### `none` — no sandbox

Runs in your real project directory, with your HOME, settings and whole environment. The only
level that can destroy uncommitted work, so it is gated **twice**: the bench must ask for it by
name, **and** whoever runs madbench must pass `--allow-host-writes` (or set
`MADBENCH_ALLOW_HOST_WRITES=1`). The configuration belongs with the bench; the consent belongs
with the person whose machine is at risk.

It **cannot run concurrently** — two scenarios editing one directory interleave their changes
and share one transcript directory. madbench refuses rather than quietly dropping to one
worker, because changing concurrency changes measured latency, and latency is a result.

`testdata:` is meaningless here and is refused. `workdir:` belongs to this level and no other —
it names the real directory to run in; above `none` it is **rejected**, not ignored.

### `workspace` — your setup, a disposable project

A fresh working tree seeded from `testdata:`, but your real HOME. The agent keeps the settings,
plugins and **login** it would have in a normal session — which is what lets a subscription
work without an API key.

Because your real configuration directory is in play, writes to it are snapshotted and put
back. The boundary is stated rather than implied:

| Tier | What | Behavior |
|---|---|---|
| restored | `settings.json`, `settings.local.json`, `remote-settings.json`, `policy-limits.json`, `.mcp.json`, `CLAUDE.md`, `statusline-command.sh`, `agents/`, `commands/`, `skills/`, `hooks/` | copied before, put back after |
| reclaimed | `projects/`, `todos/`, `shell-snapshots/`, `statsig/` | entries the run **created** are deleted; yours are left alone |
| reported | `plugins/` | stamped and compared; a change is **reported**, not undone |
| out of scope | caches, logs, telemetry, downloads, session data, the agent's own dotenv | not examined |

The agent's dotenv is deliberately out of scope: copying a credentials file into a backup
directory would spread secrets to a second place on disk in the name of protecting them. A
bench that cannot tolerate the agent reaching a credentials file wants `home` or `container`.

**Your settings reach the agent — including the ones that stop it.** `~/.claude/settings.json`
is loaded and its `env` block is applied **over** the environment madbench hands the agent, so
a setting there wins even against a command-line flag:

| Setting | What it does to the run | madbench |
|---|---|---|
| `env.CLAUDE_CODE_CHILD_SESSION` | the CLI writes no transcript, and the transcript is what madbench grades | **always overridden** |
| `env.CLAUDE_CODE_PLAN_MODE_REQUIRED` | the agent plans, then waits at "Would you like to proceed?" | **overridden only when the bench declared a `--permission-mode`** |
| `env.CLAUDE_CODE_SKIP_PROMPT_HISTORY` | the CLI writes no transcript | left alone |

madbench sets `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` on every path and at every level:
which shell you launched madbench from is not a property of the agent under test.

### `home` — the default

The working tree **and** HOME. **The sandbox sets `HOME = WorkDir`, so the testdata tree IS
the run's `~/.claude`.** That single fact is what makes testdata seeding work for settings,
skills, agents and `CLAUDE.md`.

### `container`

The whole machine. The only level that enforces `network: none` and `access: ro`.

---

## 5. `agent_env` — running against a declared environment

A directory shaped like a `.claude` folder — `plugins/`, `skills/`, `.mcp.json`,
`settings.json`. When set, it is copied into the sandbox workspace and the CLI runs `--bare`
with **only** that environment added back, so the host machine's plugins, hooks and MCP
servers cannot influence the run. Unset changes nothing: isolation is opt-in.

A top-level `skills/` inside the env is an **error** — skills live under
`<env>/plugins/<p>/skills/<s>/SKILL.md`.

**`CLAUDE.md` is inert under `agent_env`** — `--bare` does no `CLAUDE.md` auto-discovery at all.

---

## 6. `plugins:` — staging a registry

```yaml
harness_config:
  plugins:
    - id: dev@magus
      path: <plugin cache dir>/dev/3.3.0
```

Stages plugin folders into the run's `~/.claude` as an installed, **user-scoped, enabled**
registry the CLI discovers on its own, instead of hand-writing `known_marketplaces.json`. It
**composes with `agent_env`** rather than replacing it.

Use `plugins:` when the bench measures the plugin as a user meets it; `agent_env`'s
`--plugin-dir` route is the `--bare` alternative.

---

## 7. `environment:` — how hard madbench looks

```yaml
harness_config:
  environment:
    probe: true      # default true — `claude plugin list --json`, one exec
    details: 8       # per-plugin `claude plugin details` budget; 0 disables it
    require: false   # default false — when true, a staged plugin the tool did not
                     # load ERRORS before the agent is launched, so nothing is spent
```

- **`probe:`** runs `claude plugin list --json` through the SAME sandbox, and therefore the
  same HOME, the agent will run under. A probe launched any other way reads the host's registry
  and reports a plugin set that has nothing to do with the run. It is skipped entirely when the
  bench declares neither `plugins:` nor `agent_env`. **`probe: false` leaves Reported absent,
  and every `environment:*` Check then ERRORS** rather than passing — the correct loud outcome
  for a run that measured nothing.
- **`details:`** adds one exec per plugin for the per-kind breakdown, capped at 8, so a bench
  staging a large registry cannot turn one run into forty process launches. At the default a
  typical run pays two execs of roughly 0.2s each.
- **`require:`** is the gate. It runs after staging and after the probe, and **before the agent
  is launched** — the only step that spends anything. Under `require: true`, a staged plugin the
  CLI does not list, a staged plugin listed with errors, and a probe that could not run are all
  refusals. The scenario is recorded as an **ERROR, not a FAIL**: it did not score badly, it
  never ran. Leave it false for a bench whose subject IS the degraded environment.

**`probe: false` with `require: true` is refused when the bench loads**, naming both keys.

When the staged and reported families disagree, the console prints one warning block:

```
    ! ENVIRONMENT  staged 1 plugin, claude reports 0
        benchproof@madbench-proof   staged, not listed by claude
        dev@magus                   failed to load: Dependency "claudish@magus" is not installed
```

That warning never changes a status — it is a reading aid. The graded verdict belongs to the
`environment:*` Checks; the refusal to launch belongs to `require:`.

---

## 8. Where every other knob lives

Beyond the nine keys, a knob is one of three things: a CLI flag through `args:`, a file the
declared environment carries, or a file seeded into `testdata:`.

| Knob | Mechanism | How |
|---|---|---|
| Model | **dedicated key** | `harness_config.model:` |
| Effort | **dedicated key** | `harness_config.effort:` — refused at load if not one of the five levels |
| System prompt (replace) | **dedicated key** | `harness_config.system_prompt:` |
| CLI binary / wrapper | **dedicated key** | `harness_config.binary:` — point at a shim or absolute path |
| Plugin tree | **`plugins:`** *(preferred)* · `agent_env` | §6 |
| Skills | **`agent_env`** *(preferred)* | `<env>/plugins/<p>/skills/<s>/SKILL.md`. Without it: `<testdata>/.claude/skills/<name>/SKILL.md` |
| MCP servers | **`agent_env`** *(preferred)* · `args:` · testdata | `<env>/.mcp.json`; or `args: ["--mcp-config", …]`; or seed `.mcp.json` |
| `settings.json` | **`agent_env`** *(preferred)* · testdata | `<env>/settings.json` → `--settings` |
| Hooks | **via whichever `settings.json` is in force** | `--bare` loads none of the host's |
| Permission mode | **via `args:`** | `args: ["--permission-mode", "bypassPermissions"]` — **read §3 first** |
| Allowed tools | **via `args:`** | `args: ["--allowedTools", "Read,Grep"]` |
| Denied tools | **via `args:`** | `args: ["--disallowedTools", "Agent,Workflow"]` |
| System prompt (append) | **via `args:`** | `args: ["--append-system-prompt", "…"]` |
| Extra readable dirs | **via `args:`** | `args: ["--add-dir", "/abs/path"]` — must exist on the host |
| `CLAUDE.md` | **testdata seeding** | `<testdata>/CLAUDE.md` or `<testdata>/.claude/CLAUDE.md`. **Inert under `agent_env`** |
| Subagents | **testdata** *or* **`args:`** | `<testdata>/.claude/agents/<name>.md`; or `args: ["--agents", "<json>"]` |
| cwd | **Scenario key** | `cwd: packages/api` — relative to the workspace root |
| Environment variables | **`sandbox.env:`** | per-Scenario map; the forwarded-secret list is fixed in Go |
| Session resumption | **not supported** | `--session-id` is a fresh UUID every run |
| Timeout | **YAML, not harness_config** | Scenario `timeout:` / `defaults.timeout:` |

> **`cwd:` moves the agent. It does NOT move `Session.WorkDir`.** The Scenario's `cwd:` decides
> what the agent's relative Reads resolve against, what its shell commands run in, and which
> `CLAUDE.md` the CLI discovers. Everything madbench does *after* the run still resolves against
> the workspace **root** — so `session:file-read` compares against the root, and the `exec`
> check's `args.cwd` joins onto the root.

---

## 9. The CLI

### Commands

| Command | Does |
|---|---|
| *(bare)* | run `madbench.yaml` / `madbench.yml` in the current directory |
| `madbench <path...>` | run these bench or Eval files, or every bench in these directories |
| `demo` | run an offline emulated bench — no network, no API keys, no spend |
| `list` | list discovered benches and scenarios |
| `preflight` | check every Harness binary, API key, runtime and daemon a run needs, before any spend |
| `init` | write a starter bench you can run immediately |
| `report` | read stored reports: `list`, `show`, `compare`, `trend` |
| `grade` | **positive control** — re-grade a recorded Session offline and compare to the recorded verdicts |
| `check` | **negative control** — run under the mock harness and require every cell to fail |
| `keychain` | store madbench's API keys in the macOS login keychain instead of a file |
| `update` | upgrade madbench to the latest release (`--notes` prints what changed) |
| `version` | print version — **there is no `--version` flag** |
| `completion` | generate a shell autocompletion script |

### Flags

| Group | Flag | Effect |
|---|---|---|
| What runs | `--run <name>` | run only these Eval runs by name (repeatable) |
| | `--param key=value` | override a declared bench param (repeatable; typed int/float/bool, else string) |
| | `--repeat <n>` | repeat each bench N times for flake detection (default 1) |
| | `--harness <string>` | override harness for all benches |
| | `--sandbox <string>` | override sandbox level: `none`·`workspace`·`home`·`container` |
| | `--concurrency <n>` | max scenarios at once within one bench (default 4); benches run one after another |
| Watch | `--ui` | open the live run dashboard instead of plain stdout |
| | `--plain` | append-only progress lines (implied when stderr is not a terminal, or under `NO_COLOR`/`TERM=dumb`) |
| | `--theme <string>` | `auto`·`light`·`dark` (auto reads the terminal background) |
| Results | `--report-dir <dir>` | persist a versioned report per invocation, enabling `madbench report` history |
| | `--report-json <file>` | write a JSON report |
| | `--report-junit <file>` | write a JUnit XML report |
| | `--report <name>` | open a stored report read-only in the dashboard (requires `--ui`); runs nothing |
| Safety | `--allow-host-writes` | consent to `sandbox: none` |
| | `--skip-preflight` | skip the dependency check (not recommended) |
| Settings | `--env-file <file>` | read settings from this dotenv instead of `./.env` (a missing file is an error) |
| | `--no-env` | ignore `./.env` entirely |
| | `--no-keychain` | ignore the macOS login keychain |
| | `--no-update-check` | do not check for a newer release |

Env vars: `MADBENCH_MOCK_RICH=1` · `MADBENCH_LOCKFILE_REQUIRED=1` (CI lockfile enforcement) ·
`MADBENCH_ALLOW_HOST_WRITES=1` · `MADBENCH_MAGMUX` · `MADBENCH_CLAUDISH`.

### `list` vs `preflight` vs a real run

**`list` proves a file parses; `preflight` proves it could run.** Never use `list` as a gate —
it gives a confident exit 0 on a bench that cannot start.

| | `list` | `preflight` | real run |
|---|---|---|---|
| YAML parses, unknown keys, bench + scenario names | yes | yes | yes |
| Retired `sandbox:` level | yes | yes | yes |
| Missing `testdata:` directory | **no** | yes | yes |
| Harness binary / API key present | **no** | yes | yes |
| magmux present, when a Scenario is interactive | **no** | yes | yes |
| Unknown check `type:` | **no** | **yes** | yes |
| Missing `file://` grader file | **no** | **yes** | yes |
| `image:` missing / wrong format / harness can't carry it | **no** | **yes** | yes |
| A check that grades nothing | no | no | no — use `madbench check` |

**Where the line falls.** Anything that makes a bench file **malformed** — an unknown key, a
bad metric declaration, a retired `sandbox:` level — is a **load** error, and every command
refuses it identically. Anything about **this machine** — binaries, keys, images — is
preflight's job alone. That is why the sandbox row reads yes across the board.

**Preflight is automatic.** Every run preflights first and refuses to start if anything blocks
(`preflight: nothing was run, no spend`). `--skip-preflight` opts out.

### The two controls

Preflight asks *can this run*; the controls ask *does this bench measure anything*.

- **`madbench check`** runs under the mock harness and requires **every gradable cell to fail**,
  reporting a **per-cell tally**. Exit 0 = the control holds, 1 = a cell wrongly passed or could
  not be graded, 3 = nothing gradable was found. `latency` and `cost` are reported as **NOT
  APPLICABLE** and left out of the verdict. A cell that ERRORED is reported in its own bucket,
  never folded into the failures — it demonstrated neither soundness nor rot.
  A bench declaring `sandbox: none` still needs `--allow-host-writes`: the mock writes nothing,
  but the **checks run for real**, and at level `none` an `exec` check is a command executed in
  the directory you are sitting in.
- **`madbench grade <report.json>`** re-grades a recorded Session offline — no harness, no
  sandbox, no spend — and checks every verdict reproduces. It re-runs the evaluators against the
  stored Session; it does not replay stored verdicts, so non-deterministic grading shows up as
  DIVERGED.

`madbench demo` runs a built-in bench against an offline harness that emulates a real agent.
Use it to see what a healthy report looks like before trusting your own.

---

## 10. Step 0 — check what you actually have

madbench's identifiers change. Before trusting anything here:

```bash
madbench version
```

**A conclusion drawn from source you did not build is a conclusion about a different program.**
Reading `main` in the madbench checkout tells you what the *next* release does, not what the
binary on your PATH does. If the binary is older than a feature you are relying on, rebuild
from the repo and use that binary, or run `madbench update`.
