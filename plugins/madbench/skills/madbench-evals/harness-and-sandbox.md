# Harness, sandbox and CLI

Reference for the `madbench-evals` skill, reached by path. How the agent is configured and
driven, how much of the machine a run may touch, and the whole command line. The madbench
release these files were written for is in `MADBENCH_VERSION` beside `SKILL.md`. `docs/<file>.md:<line>` citations point into the madbench
checkout's `docs/` directory — never into `pkg/`, because the checkout builds `dev`.

---

## 1. The Harness interface

A **Harness** is the agent under test: the thing madbench launches, watches, and turns into a
**Session**. One YAML block declares it — `harness:`, with its `type:` and its settings.
`harness: mock` (a bare string) is the same as `harness: {type: mock}`; anything beyond the
type needs the block.

```go
type Harness interface {
    Name() string                                              // the YAML discriminator
    Run(ctx context.Context, req RunRequest) (*Session, error) // execute, return ground truth
}
```

Two **optional** extensions, detected from the adapter's Go type — no adapter must implement either:

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
| `Config` | the `harness:` block, after `{{param}}` substitution |
| `Provider` | the current `providers:` entry, `""` for a single-provider run |

> **The default timeout is 300s.** A `--print` turn fits in 120s; a cold-start
> **interactive** turn can exceed that. Declare your own;
> the fallback is deliberately generous so the common failure is a real one rather than a
> stopwatch.

---

## 2. `claude-code` — the whole configuration surface

```yaml
harness:
  type: claude-code                               # claude-code · mock · demo
  binary: claude                                  # default "claude"
  model: claude-sonnet-5                          # "" omits --model
  effort: high                                    # low·medium·high·xhigh·max
  use_subscription: optional                      # bill against this machine's login — §2b
  config:                                         # what the tool is GIVEN before it starts
    dirs:                                         # composed into the tool's `.claude` — §5
      - ./config/base
      - "{{overlay}}"                             # "" is skipped
    plugins:                                      # plugin FOLDERS, staged as a registry — §6
      - ./marketplace/plugins/benchproof          # tests/plugin-staging
    system_prompt: "You are terse."               # "" omits --system-prompt
  args: ["--permission-mode", "bypassPermissions"] # appended last
  probe:                                          # ask the tool what actually loaded — §7
    enabled: true
    details: 8
    require: false
```

Every key the block accepts is in the table below. **Keys are strict**: an unknown key
anywhere under `harness:` — `harness.efort`, `harness.config.dir` — is a load error that
names the full key path. Nothing is silently ignored.

| Key | Type | Default | Effect |
|---|---|---|---|
| `type` | string | *(required)* | `claude-code`, `mock` or `demo`. Missing or unknown is an error listing the known types. `--harness <type>` overrides it for every bench |
| `binary` | string | `claude` | the executable, `LookPath`'d at run time. A bare name is looked up on `PATH`; anything with a `/` is a **path relative to the bench file**, made absolute at load, and refused at `sandbox: container`. Empty string is an error — omit the key |
| `magmux_binary` | string | *(unset)* | the magmux build hosting an **interactive** run. Precedence: this > `$MADBENCH_MAGMUX` > PATH. Ignored by a non-interactive Scenario |
| `model` | string · model block · `models:` name | *(unset)* | `--model <value>` |
| `provider` | string | *(unset)* | set by madbench when `model:` is a model block or a `models:` name — rarely written by hand. `claude-code` and `anthropic` run directly; any other provider is **refused unless `binary: claudish`**, because the agent IS the `claude` CLI |
| `effort` | string | *(unset)* | `--effort <value>`. **Checked by value**: `low`, `medium`, `high`, `xhigh`, `max`, exact and case-sensitive. Empty string is an error; write `~` for "the CLI's default" |
| `use_subscription` | string | `optional` | whether the run may bill against **this machine's** Claude Code login: `optional` · `required` · `api_usage`, checked by value like `effort`. Empty string is an error |
| `config.dirs` | []string | *(none)* | directories composed, in order, into the tool's `.claude` — §5 |
| `config.plugins` | []string | *(none)* | plugin folders, staged as a registry — §6 |
| `config.system_prompt` | string | *(unset)* | `--system-prompt <value>` |
| `args` | []string | *(none)* | extra argv, appended after everything madbench adds |
| `probe` | {enabled, details, require} | `{true, 8, false}` | how hard madbench looks at what loaded — §7 |

`type: mock` accepts only `type` and `model`; `type: demo` accepts only `type`. Any other key
on a mock or demo bench is a load error. `{{param}}` placeholders work anywhere under
`harness:` — a whole-string placeholder keeps the param's type, and one that substitutes to
null omits the key.

### Error behaviour

- An **unknown key is a hard error**, naming the full key path. A typo like
  `harness.permission_mode:` stops the bench at load, before any spend.
- A **known key with the wrong type is a hard error**, naming key, expected type and actual.
- **`effort` and `use_subscription` are additionally checked by VALUE** — the two keys whose
  vocabulary is closed — and `effort` because the CLI will not check it for us. A misspelt
  level does **not** fail the CLI — it warns and runs at the default, exit 0, so an A/B meaning
  to compare `high` against `low` would compare the default against itself and report the
  pair as a finding. The refusal lands at configure time, before a sandbox exists and before
  any model is billed.
- `probe: {enabled: false, require: true}` is an error: nothing can be required that is not
  probed.
- Binary existence is checked in `Preflight` or at run time, never at load.

### The argv madbench builds — non-interactive only

This describes `interactive: false`. An interactive Scenario builds a different command line
entirely (no `--print`, no `--output-format`) and runs it inside a magmux pane — §3.

```
claude --print \
       --verbose \
       --output-format stream-json \
       --input-format text \
       --session-id <fresh-uuid> \
       [--setting-sources user --plugin-dir … --mcp-config … --strict-mcp-config] \
       [--model <model>] \
       [--system-prompt <config.system_prompt>] \
       [--effort <effort>] \
       <args...>
```

The bracketed config block appears **only when `config.dirs` is declared** — §5
(`agentEnv.args`, `pkg/harness/claudecode/agentenv.go`).
The first five flags are always present and never configurable:

| Flag | Why |
|---|---|
| `--print` | non-interactive; there is no human to answer prompts |
| `--verbose` | required by `--output-format stream-json` |
| `--output-format stream-json` | one JSON event per stdout line — the Session source |
| `--input-format text` | prompt on stdin as plain text — **flips to `stream-json` when the Scenario declares `image:`**, which is why `image:` is a `--print`-only key |
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

**It is sweepable.** `interactive: "{{drive}}"` resolves from a variant's `params:` value, so one
Experiment can run the same bench both ways and compare. The field is a small type rather than
a `bool` precisely so a placeholder survives YAML parsing.

Resolution follows the same precedence as `sandbox:` — bench `defaults:`, then
`defaultScenario:`, then the Scenario's own value. Unset anywhere means **true**. The field is
a `*bool` so "said nothing" and "said false" stay distinguishable.

**Every prompt is typed, and `image:` is pasted.** The interactive driver types each prompt
as keystrokes (never a paste, which Claude Code may hand its model as `<pasted_content>`),
and pastes a Scenario's `image:` into turn 1 by its file path. A turn written as a list of
parts (`- type:` · `- paste:` · `- image:`, `clipboard: true`) pastes on purpose. An
unrequested `<pasted_content>` ends the run as ERROR (`docs/harness.md`, "A turn written as
parts"). Interactive runs need a magmux with typed send; preflight refuses one without it.

**An interactive agent can stop and ask** (`AskUserQuestion`). The **Driver** answers it:
every interactive claude-code bench gets the default answering Driver with no `driver:`
block, `driver: false` turns it off, and `driver.answers:` scripts it
(`docs/harness.md:743`, `docs/driving-a-session.md`).

**Interactive needs magmux on THIS machine**, at every sandbox level, on PATH (or
`harness.magmux_binary`, or `$MADBENCH_MAGMUX`). `madbench preflight` checks for it
only when some Scenario is interactive, and the finding names `interactive: false` as a way
out (`docs/harness.md:610-613`, `:1553`).

**magmux is checked by capability, never by version number.** Preflight runs `magmux
--help` under a short timeout and looks for the flags madbench actually passes
(`--headless`, `--sock-dir`); a missing flag **blocks**, naming the flag and the version the
binary reported. A version bound could not have verified it — 0.9.0 was cut from a branch
that never contained 0.8.0's flags, and magmux ignores an unknown flag rather than refusing
it, so against 0.9.0 the version read as satisfied and every interactive run waited out a
twenty-second socket timeout. A `--help` that fails or times out is **advisory only**, and
there is deliberately no upper bound (`docs/harness.md:1554`, `:1634-1660`).

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
An `acceptEdits` does nothing under `--print`, and on the default interactive path it hangs
the first Bash call until the timeout.

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

The job answered; the answer was in the session, one Event after the sentence every text
check was grading. The parent never follows up, so waiting longer does not help. It is
deliberately narrow and changes nothing for a run that never delegated, or one whose parent
received the result and spoke last.

**Handing off is still visible**: `session.steps.main` is 0 on exactly these runs, the
per-thread breakdown is in `Session.Subagents`, and `session:turn-count` still counts one turn.

### When a delegating run is finished

The Stop hook ends a **turn**, and a turn ends when the MAIN thread stops. An agent that
delegates hands the work off and stops, so the hook fires while the subagent is still writing
its own log. madbench therefore waits on the whole **job**. It is finished when all three hold:

1. the parent's session file (Claude Code's "transcript") has been quiet for the settle window;
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

| Level | Gets its own copy of | Real files safe? | Confines file **reads**? | Enforces `network: none` / `access: ro`? |
|---|---|---|---|---|
| `none` | nothing — your real project directory, HOME, settings, environment | ❌ the agent edits your actual files | ❌ | ❌ |
| `workspace` | the working tree | ✅ project; `~/.claude` restored afterwards | ❌ | ❌ |
| `home` *(default)* | the working tree **and HOME** | ✅ | ✅ **on macOS** | ❌ |
| `container` | the whole machine | ✅ | ✅ | ✅ |

(`docs/sandbox-levels.md:10-15`.) **`home` is a read boundary on macOS and nothing more**:
every in-sandbox launch runs behind a Seatbelt profile whose file reads are **denied by
default** and re-opened only for a derived allow-set, so the run cannot read the machine
around it. Writes are not denied at any local level and the network is not blocked. Linux
has no such mechanism, so there `home` arranges state only (`docs/sandbox-levels.md:17-22`,
`docs/glossary.md#sandbox`). A file the run needs from outside its tree — a hook script, an
MCP server's script — is unreadable at `home` on macOS until it is shared in or moved into
the tree; preflight names the hook case, and the MCP preflight (§7a) catches the server case.

Any other value is refused: `sandbox: unknown level "<value>" (want none, workspace, home,
container)` (`internal/sandbox/level.go`); `docker`, the container runtime, gets its own
message pointing at `level: container` with `engine: docker`. It is a **load** error, so every command refuses it
identically. Only `container` confines a process; `none` and `workspace` arrange state, and
`home` arranges state and confines reads.

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
      user: root             # container, Linux only; enables a cleanup ownership sweep
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
and share one Claude Code "transcript" directory. madbench refuses rather than quietly dropping to one
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
| `env.CLAUDE_CODE_CHILD_SESSION` | the CLI writes no "transcript" file, and that file is what madbench builds the Session from | **always overridden** |
| `env.CLAUDE_CODE_PLAN_MODE_REQUIRED` | the agent plans, then waits at "Would you like to proceed?" | **overridden only when the bench declared a `--permission-mode`** |
| `env.CLAUDE_CODE_SKIP_PROMPT_HISTORY` | the CLI writes no "transcript" file | left alone |

madbench sets `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` on every path and at every level:
which shell you launched madbench from is not a property of the agent under test.

### `home` — the default

The working tree **and** HOME. **The sandbox sets `HOME = WorkDir`, so the testdata tree IS
the run's `~/.claude`.** That single fact is what makes testdata seeding work for settings,
skills, agents and `CLAUDE.md`.

### `container`

The whole machine. The only level that enforces `network: none` and `access: ro`.

---

## 5. `config.dirs` — composing the tool's `.claude`

```yaml
harness:
  type: claude-code
  config:
    dirs:                     # each relative to the bench file
      - ./config/base         # the shared configuration
      - "{{overlay}}"         # a variant's overlay; "" is skipped
```

Each entry is a directory shaped like a `.claude` folder — `CLAUDE.md`, `settings.json`
(hooks), `.mcp.json`, `skills/<name>/SKILL.md`, `agents/`, `commands/`, `plugins/`. The
entries are copied **in order** into the run's configuration directory (`~/.claude` in the
run's own home): a file at the same relative path in a later entry **replaces** the earlier
one, and directories merge. The CLI runs with `--setting-sources user`, and the user scope is
that composed tree, so `CLAUDE.md`, `skills/`, `agents/`, `commands/` and `settings.json` load
natively, once; `plugins/<name>/` folders get `--plugin-dir` and `.mcp.json` gets
`--mcp-config` (measured on CLI 2.1.289). A `settings.local.json` is the local scope's file
and is refused.

- **An empty entry is skipped.** A `{{param}}` that substituted to `""` is how a variant runs
  on the base alone.
- **A non-empty entry that does not exist, or is not a directory, is an error** naming the
  entry and its index (`harness.config.dirs[1]`). A path that is a file in one entry and a
  directory in another cannot be composed and is an error naming both.
- **`.git`, `node_modules` and `.DS_Store` are left out.** A symlink to a file contributes the
  file it points at; a symlink to a directory, or a dangling one, contributes nothing.
- **When `config.dirs` is declared, the composed directory is the WHOLE configuration.**
  Nothing from the host's own `~/.claude` — user, project or local settings — is loaded, and
  the files placed in the dirs are honoured by Claude Code exactly as they would be in a real
  `~/.claude`. Undeclared, nothing changes: isolation is opt-in.
- **Plugins compose into it.** `config.plugins` (§6) is staged INTO the directory the dirs
  produced.

What follows from a declared configuration:

- **Hooks load.** The composed `settings.json` hooks, and madbench's own `Stop` hook that
  marks turn boundaries, fire like on any other run. The host's hooks do not.
- **No API key is forced.** The run bills the same way as any other claude-code run (§2,
  `use_subscription`), and `use_subscription: required` beside `config.dirs` is accepted.
- **Still not filesystem isolation.** The composition controls what the CLI **loads**, not
  what the agent can **read**; an agent that greps the host's `~/.claude` still finds trees
  on disk. Only the sandbox level confines reads (§4).
- **Prove what a bench relies on.** Grade a skill with `session:skill-used`, and a
  `CLAUDE.md` with a marker the agent can only have from that file, graded with
  `session:match` or `contains`.

**The guard compares the composed tree file by file**, as `harness/config/files/<relative
path>` (§5a). Two variants whose `dirs:` lists differ but compose to identical trees have no
delta.

### 5a. The harness under `guard_changes:`

The harness is one compared source of an Experiment's guard, labelled `harness`, and every
path is the YAML path under `harness/`:

| Path | Compared value |
|---|---|
| `harness/type` · `harness/binary` · `harness/model` · `harness/provider` · `harness/effort` · `harness/use_subscription` | the resolved value (the model canonicalised) |
| `harness/args/<i>` | one argv element by position |
| `harness/config/system_prompt` | the text |
| `harness/config/files/<relative path>` | each file of the tree `config.dirs` composes, by content, before plugins are staged into it |
| `harness/config/plugins/<id>/…` | each staged plugin |
| `harness/probe/…` | the probe settings |

```yaml
guard_changes:
  allow: [harness/model, harness/effort]          # a model × effort sweep
  # allow: [harness/config/files/CLAUDE.md]       # only that composed file may differ
  # allow: [harness/config]                       # the whole composed config
```

A variant whose model differs without `harness/model` in `allow:` is **CONFOUNDED**. The
directory rule applies: `allow: [harness]` covers everything under it.

---

## 6. `config.plugins` — staging a registry

```yaml
harness:
  type: claude-code
  config:
    plugins:                                          # tests/plugin-staging/madbench.yaml
      - ./marketplace/plugins/benchproof              # the plugin FOLDER
```

Each entry is the path to a **plugin folder** — a directory carrying `plugin.json` at its
root or under `.claude-plugin/` — relative to the bench file. Nothing else is written: the
plugin's identity `<name>@<marketplace>` is **derived**. `<name>` comes from its
`plugin.json`; `<marketplace>` from the marketplace checkout that contains the folder (the
nearest enclosing `.claude-plugin/marketplace.json` whose entries source it), or from the
registry cache the folder sits in. A folder that belongs to no marketplace gets one madbench
writes for it. Two entries resolving to the same identity are an error. A runnable worked
example is `tests/plugin-staging/` in the madbench repository: its folder derives
`benchproof@madbench-proof`.

madbench stages the folders into the run's `~/.claude` as an installed, **user-scoped,
enabled** registry the CLI discovers through its own plugin discovery, instead of
hand-writing `known_marketplaces.json`. It **composes with `config.dirs`** — the plugins are
staged into the directory the dirs produced — and applies on both drive paths. This is the
native answer to "stage a plugin tree for a run" — never a registry-writing script beside
the bench.

Use `config.plugins` alone when the bench measures the plugin as a user meets it; add
`config.dirs` when it measures a declared, confined `.claude`. Plugin staging needs sandbox
level `home` or higher.

---

## 7. `probe:` — how hard madbench looks

```yaml
harness:
  type: claude-code
  probe:
    enabled: true    # default true — `claude plugin list --json`, one exec
    details: 8       # per-plugin `claude plugin details` budget; 0 disables it
    require: false   # default false — when true, a staged plugin the tool did not
                     # load ERRORS before the agent is launched, so nothing is spent
```

What the probe captures is the Session's **Environment** — what the tool reported it loaded —
and the `environment:*` Checks grade it.

- **`enabled:`** asks the tool what it has, before the agent launches. Two channels answer to
  it: `claude plugin list --json` (and, within `details:`, `claude plugin details <id>`)
  through the SAME sandbox, and therefore the same HOME, the agent will run under — a probe
  launched any other way reads the host's registry and reports a plugin set that has nothing
  to do with the run; and the **MCP preflight** (§7a), one `initialize` + `tools/list`
  handshake per declared server. The plugin channel is skipped when the bench declares
  neither `config.plugins` nor `config.dirs`. **`enabled: false` leaves Reported absent and
  launches no new process, MCP included**; upstream's `harness.md` says every
  `environment:*` Check then ERRORS, while `madbench check` lands an unprobeable check
  **outside the verdict** rather than in the error bucket (`docs/checks.md`). Either way it
  is loud and never a pass — read the bucket the control prints rather than predicting it.
- **`details:`** adds one exec per plugin for the per-kind breakdown, capped at 8, so a bench
  staging a large registry cannot turn one run into forty process launches. At the default a
  typical run pays two execs of roughly 0.2s each.
- **`require:`** is the gate. It runs after staging and after the probe, and **before the agent
  is launched** — the only step that spends anything. Under `require: true`, a staged plugin the
  CLI does not list, a staged plugin listed with errors, a probe that could not run, **and a
  declared MCP server that did not answer** are all refusals. The scenario is recorded as an
  **ERROR, not a FAIL**: it did not score badly, it never ran. Leave it false for a bench whose
  subject IS the degraded environment. **Only a `failed` server refuses; an UNPROBED one never
  does** — a gap in madbench's knowledge is not a fact about the server, so an UNPROBED row is
  loud in the report and silent at the gate.

**`probe: {enabled: false, require: true}` is refused when the bench loads** — nothing can be
required that is not probed.

## 7a. The MCP preflight — two halves, neither replaces the other

A bench that declares MCP servers gets one extra step before the agent launches: madbench
**starts each declared server itself, from inside this run's sandbox, and speaks MCP to it.**
Servers are found on all three routes the CLI accepts — a `--mcp-config` value in `args:`
(JSON or file), a staged plugin's own `.mcp.json`, and the `.mcp.json` `config.dirs` composes
(`docs/harness.md:1276-1277`). It exists because the alternative is a silent absence
discovered after a full run has been paid for — one reported grid was 264 scenarios and
about $32, and it measured a tool that had never existed (`docs/harness.md:1279-1284`).
**Before grading whether an agent used a capability, prove the capability was present.**

| Outcome | Means | Under `require: true` |
|---|---|---|
| **connected** | answered `initialize`, and `tools/list` where it declared the capability; tool count recorded, zero is a real answer | proceeds |
| **failed** | launched and did not complete; the row carries the server's own words — JSON-RPC error, **stderr tail**, exit status | **refuses, before any spend** |
| **UNPROBED** | madbench could not construct a launch at all: remote `type: http`/`sse`, a `${…}` it does not own, a relative `command`, a `cwd` outside the sandbox | proceeds |

(`docs/harness.md:1294-1298`.) Grade it with `environment:mcp-reachable` — see
`checks-catalog.md` §9 for how that differs from `environment:mcp-connected`.

**The static half runs at `madbench preflight` time, with no sandbox and no launch.** It
takes the `Config` alone, reads the declarations from the same three routes, and asks *is the
declared setup complete?* — the document opened and declared something, the entry can be
launched as a stdio server at all, `command` resolves on this machine, every absolute
`$`-free arg and `cwd` exists — with severity mirroring `probe.require` so preflight
and the run-time gate can never disagree (`docs/harness.md:1583-1603`). It also pairs every
top-level `environment:mcp-reachable` value against that list and refuses a name nothing
declares (`docs/harness.md:1561`, `:1629-1632`). At `sandbox: container` none of it is
asked, because the filesystem is the image's (`docs/harness.md:1618-1620`).

When the staged and reported families disagree, the console prints one warning block:

```
    ! ENVIRONMENT  staged 1 plugin, claude reports 0
        benchproof@madbench-proof   staged, not listed by claude
        <plugin>@<marketplace>      failed to load: Dependency "<dep>@<marketplace>" is not installed
```

That warning never changes a status — it is a reading aid. The graded verdict belongs to the
`environment:*` Checks; the refusal to launch belongs to `probe.require`.

---

## 8. Where every other knob lives

Beyond the keys in §2, a knob is one of three things: a CLI flag through `args:`, a file the
composed configuration (`config.dirs`) carries, or a file seeded into `testdata:`.

| Knob | Mechanism | How |
|---|---|---|
| Model | **dedicated key** | `harness.model:` |
| Effort | **dedicated key** | `harness.effort:` — refused at preflight (`list` passes it) if not one of the five levels |
| System prompt (replace) | **dedicated key** | `harness.config.system_prompt:` |
| CLI binary / wrapper | **dedicated key** | `harness.binary:` — point at a shim or absolute path |
| Plugin tree | **`config.plugins`** | §6 |
| Skills | **`config.plugins`** · `config.dirs` | a plugin's `skills/<s>/SKILL.md`, staged by §6; or `skills/<s>/SKILL.md` in a composed dir (§5) |
| MCP servers | **`config.dirs`** *(preferred)* · `args:` · testdata | `.mcp.json` in a composed dir; or `args: ["--mcp-config", …]`; or seed `.mcp.json` |
| `settings.json` | **`config.dirs`** *(preferred)* · testdata | `settings.json` in a composed dir |
| Hooks | **via whichever `settings.json` is in force** | under `config.dirs` the composed one, and never the host's; without it, the seeded one |
| Permission mode | **via `args:`** | `args: ["--permission-mode", "bypassPermissions"]` — **read §3 first** |
| Allowed tools | **via `args:`** | `args: ["--allowedTools", "Read,Grep"]` |
| Denied tools | **via `args:`** | `args: ["--disallowedTools", "Agent,Workflow"]` |
| System prompt (append) | **via `args:`** | `args: ["--append-system-prompt", "…"]` |
| Extra readable dirs | **via `args:`** | `args: ["--add-dir", "/abs/path"]` — must exist on the host |
| `CLAUDE.md` | **testdata seeding** · `config.dirs` | `<testdata>/CLAUDE.md` or `<testdata>/.claude/CLAUDE.md`; or `CLAUDE.md` in a composed dir (§5) |
| Subagents | **testdata** *or* **`args:`** | `<testdata>/.claude/agents/<name>.md`; or `args: ["--agents", "<json>"]` |
| cwd | **Scenario key** | `cwd: packages/api` — relative to the workspace root |
| Environment variables | **`sandbox.env:`** | per-Scenario map; the forwarded-secret list is fixed in Go |
| Session resumption | **not supported** | `--session-id` is a fresh UUID every run |
| Timeout | **YAML, not `harness:`** | Scenario `timeout:` / `defaults.timeout:` |

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
| `madbench <path...>` | run these bench or Experiment files, or every bench in these directories |
| `demo` | run an offline emulated bench — no network, no API keys, no spend |
| `list` | list discovered benches and scenarios |
| `preflight` | check every Harness binary, API key, runtime and daemon a run needs, before any spend |
| `init` | write a starter bench you can run immediately |
| `report` | read stored reports: `ls`, `show`, `compare`, `history` (`cmd/madbench/report_cmd.go`) |
| `grade` | **positive control** — re-grade a recorded Session offline and compare to the recorded verdicts |
| `check` | **negative control** — run under the mock harness and require every graded check to fail |
| `key` | store madbench's API keys in the macOS login keychain instead of a file: `set`, `get`, `list`, `rm` |
| `skills` | install this release's madbench skills into `./.claude/skills` (`--dir` to choose; `--force` replaces a same-named directory madbench did not install). `--check` compares the installed set's `MADBENCH_VERSION` with the binary; `--version X` installs release X's set; `--pin` holds a set (a `MADBENCH_PINNED` marker) and `--unpin` lets it follow madbench again. An unpinned set follows the binary |
| `update` | upgrade madbench to the latest release (`--notes` prints what changed) |
| `version` | print version — **there is no `--version` flag** |
| `completion` | generate a shell autocompletion script |

### Flags

Read off `madbench --help` on the installed binary; the table is a map, not the source.

| Group | Flag | Effect |
|---|---|---|
| What runs | `--variant <name>` | run only these variants, by name (repeatable), in every Experiment that declares the name. Selects **which** variants run; `--trials` sets how many times each runs. The guard still audits every declared variant |
| | `--scenario <string>` | run only this Scenario by name (or description, when it has no name) — a different axis from `--variant`, which selects an Experiment's variants. Narrows what runs, never what the guard audits |
| | `--param key=value` | override a declared bench param (repeatable; typed int/float/bool, else string) |
| | `--trials <n>` | run each bench N times — N trials — to measure flake and spread (default 1) |
| | `--harness <string>` | override `harness.type` for every bench |
| | `--sandbox <string>` | override sandbox level: `none`·`workspace`·`home`·`container` |
| | `--concurrency <n>` | max scenarios at once within one bench (default 4); benches run one after another |
| Watch | `--ui` | open the live run dashboard (TUI) instead of plain stdout |
| | `--plain` | append-only progress lines — **the CI shape**, implied when stderr is not a terminal, or under `NO_COLOR`/`TERM=dumb`. Choosing it in a terminal throws away the coloured live region |
| | `--theme <string>` | `auto`·`light`·`dark` (auto reads the terminal background) |
| | `--watch` | show every agent's screen live while madbench drives it, one slot per concurrent session. Graded as usual — the Driver answers and every check runs. Needs a terminal; refused with `--ui`, `--plain` and `--manual` |
| Drive it yourself | `--manual` | provision the sandbox exactly as a graded run does, then attach your terminal and hand over. The prompt is printed for you to paste; no checks run; the workspace is kept |
| Results | `--report-dir <dir>` | persist a versioned report per invocation, enabling `madbench report` history. Written **incrementally**, so a run that dies mid-flight leaves a readable partial |
| | `--report-json <file>` | write a JSON report — **the evidence channel**; read numbers from here, never off the terminal |
| | `--report-junit <file>` | write a JUnit XML report |
| | `--report <name>` | open a stored report read-only in the dashboard (requires `--ui`); runs nothing |
| Exit | `--fail-on-failure` | exit 1 when scenarios **FAIL** their checks. Without it a graded miss exits 0 — see *Exit codes* below |
| Safety | `--allow-host-writes` | consent to `sandbox: none` |
| | `--skip-preflight` | skip the dependency check (not recommended) |
| Settings | `--env-file <file>` | read settings from this dotenv instead of `./.env` (a missing file is an error) |
| | `--no-env` | ignore `./.env` entirely |
| | `--no-keychain` | ignore the macOS login keychain |
| | `--no-update-check` | do not check for a newer release |
| | `--use-subscription <string>` | override how claude-code benches bill: `optional` · `required` · `api_usage` |
| `check` | `--verbose` | list every check, not only the ones that wrongly passed (`grade --verbose` lists every one, not only the diverged; `preflight -v` shows ok rows) |

### Exit codes — a graded miss is 0

One rule, applied everywhere: **nonzero when madbench itself is in question, zero when a
measurement came out low.** A graded miss is a result; a session that never graded is a
fault (`docs/README.md:88-112`).

| Code | Means | When |
|---|---|---|
| `0` | the run happened | **including a run whose checks failed** |
| `1` | something is wrong with the run or with madbench | a scenario **errored** (it ran, it spent, and it never graded); a bad config; `--fail-on-failure` with a failed scenario; `madbench check` / `grade` finding madbench unsound |
| `3` | nothing ran, no spend | a blocking preflight finding, a failed preparation, or a declared metric that never produced |
| `130` | the operator stopped it | SIGINT/SIGTERM, or quitting the `--ui` dashboard mid-run |

Observed on the installed binary, madbench's own closing line after `madbench demo`:

```
exit 0: 1 scenario failed — scenario outcomes, not a harness crash
```

`--fail-on-failure` is opt-in because every CI reads nonzero as a broken job, and a bench
exists to measure *how often* an agent gets it right — a control run that is supposed to
fail is a working control. It governs **failed** scenarios only: an **errored** one exits 1
either way, and no flag turns that off (`docs/README.md:105-108`). A CI job that treats
nonzero as its failure signal without the flag reads a bench whose every scenario failed as
green. Every nonzero exit closes with a line saying which of these it was, so a wrapping
CI job does not report `exit 1` as a crash (`docs/README.md:111-112`).

Env vars: `MADBENCH_MOCK_RICH=1` · `MADBENCH_LOCKFILE_REQUIRED=1` (CI lockfile enforcement) ·
`MADBENCH_ALLOW_HOST_WRITES=1` · `MADBENCH_MAGMUX` · `MADBENCH_CLAUDISH`.

### `list` vs `preflight` vs a real run

**`list` proves a file parses; `preflight` proves it could run.** Never use `list` as a gate —
it gives a confident exit 0 on a bench that cannot start.

| | `list` | `preflight` | real run |
|---|---|---|---|
| YAML parses, unknown keys, bench + scenario names | yes | yes | yes |
| Unknown `sandbox:` level | yes | yes | yes |
| Missing `testdata:` directory | **no** | yes | yes |
| Harness binary / API key present | **no** | yes | yes |
| magmux present, when a Scenario is interactive | **no** | yes | yes |
| Unknown check `type:` | **no** | **yes** | yes |
| Missing `file://` Check script | **no** | **yes** | yes |
| `image:` missing / wrong format / harness can't carry it | **no** | **yes** | yes |
| A declared MCP server's `command` resolves; an `mcp-reachable` value names a declared server | **no** | **yes** | yes |
| A `module/` has `bun` and a `package.json` | **no** | **yes** | yes |
| A `metrics:` expression that will not parse | yes | yes | yes |
| A check that grades nothing | no | no | no — use `madbench check` |

**Where the line falls.** Anything that makes a bench file **malformed** — an unknown key, a
bad metric declaration, an unknown `sandbox:` level — is a **load** error, and every command
refuses it identically. Anything about **this machine** — binaries, keys, images — is
preflight's job alone. That is why the sandbox row reads yes across the board.

**Preflight is automatic.** Every run preflights first and refuses to start if anything blocks
(`preflight: nothing was run, no spend`). `--skip-preflight` opts out.

### The two controls

Preflight asks *can this run*; the controls ask *does this bench measure anything*.

- **`madbench check`** runs under the mock harness and requires **every graded check to
  fail**, reporting a **per-check tally** — one line per (Scenario, Check) pair, plus by name
  every check that wrongly passed. Exit 0 = the control holds, 1 = a check wrongly passed or
  a check or Scenario could not be graded, 3 = nothing gradable was found. `latency` and
  `cost` are reported as **NOT APPLICABLE** and left out of the verdict. A check that ERRORED
  is reported in its own bucket, never folded into the failures — it demonstrated neither
  soundness nor rot (`madbench help check`). A bench declaring `sandbox: none` still needs
  `--allow-host-writes`: the mock writes nothing, but the **checks run for real**, and at
  level `none` an `exec` check is a command executed in the directory you are sitting in.
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
