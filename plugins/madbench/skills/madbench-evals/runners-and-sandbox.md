# Harness, sandbox and CLI

Reference for the `madbench-evals` skill, reached by path. How the agent is configured and
driven, how much of the machine a run may touch, and the whole command line. The madbench
release these files mirror is declared **once**, in `plugins/madbench/mirrors.json`, which
lists this file as stable. `docs/<file>.md:<line>` citations point into the madbench
checkout's `docs/` directory — never into `pkg/`, because the checkout builds `dev`.

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
| `Driver` | the Scenario's resolved `driver:`, or **nil** when it is not driven — §3 (`docs/harness.md:56`) |

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
  use_subscription: optional                      # bill against this machine's login — §2b
  args: ["--permission-mode", "bypassPermissions"] # appended last
```

**These are the keys upstream documents. Do not trust any count, including one here.**
`docs/harness.md:80` says "Eight keys. That is the entire schema" above a table with ten
rows (`docs/harness.md:82-93`), and that table omits two keys documented elsewhere in the
same file: `environment` (`docs/harness.md:1210`) and `marketplace` (`docs/harness.md:1019`).
The list below is every key with a citation; a key you cannot cite is a key the adapter
silently ignores (see *Error behaviour*).

| Key | Type | Default | Effect |
|---|---|---|---|
| `binary` | string | `claude` | the executable, `LookPath`'d at run time. A bare name is looked up on `PATH`; anything with a `/` is a **path relative to the bench file**, made absolute at load, and refused at `sandbox: container`. Empty string is an error — omit the key (`docs/harness.md:84`) |
| `magmux_binary` | string | *(unset)* | the magmux build hosting an **interactive** run. Precedence: this > `$MADBENCH_MAGMUX` > PATH. Ignored by a non-interactive Scenario |
| `model` | string, a model block, or a `models:` name | *(unset)* | `--model <value>`. A block or a name is split into `model`, `effort` and `provider` for the adapter; a key written beside `model` wins (`docs/eval-file.md:127`) |
| `provider` | string | *(unset)* | set by madbench when `model:` is a block or a `models:` name — rarely written by hand. `claude-code` and `anthropic` run directly; any other is **refused** unless `binary: claudish`, because the agent IS the `claude` CLI (`docs/harness.md:87`) |
| `effort` | string | *(unset)* | `--effort <value>`. **The one key checked by value**: `low`, `medium`, `high`, `xhigh`, `max`, exact and case-sensitive. Empty string is an error; write `~` for "the CLI's default". A `models:` entry's `effort:` reaches this key too |
| `system_prompt` | string | *(unset)* | `--system-prompt <value>` |
| `agent_env` | string | *(unset)* | a directory shaped like a `.claude` folder; the CLI then runs `--setting-sources ""` with only that folder added back — §5 |
| `plugins` | []{id, path, marketplace} **or** []string names | *(none)* | a staged plugin registry — §6 (`docs/harness.md:91`, `:1015-1035`) |
| `marketplace` | string | *(unset)* | the checkout every short-form `plugins:` name resolves against — §6 (`docs/harness.md:1019-1035`) |
| `environment` | {probe, details, require} | probe true | how hard madbench looks at what loaded — §7 (`docs/harness.md:1210-1221`) |
| `use_subscription` | string | `optional` | whether the run bills **this machine's** Claude Code login: `optional` · `required` · `api_usage`, checked by value like `effort`. Empty string is an error — §2b (`docs/harness.md:92`, `:1338`) |
| `args` | []string | *(none)* | extra argv, appended after everything madbench adds (`docs/harness.md:93`) |

### Error behaviour

- An **unrecognized key is silently ignored** — the documented contract, so adapters can
  evolve independently. A typo like `permission_mode:` therefore does *nothing*, quietly.
- A **recognized key with the wrong type is a hard error**, naming key, expected type and
  actual: `claude-code harness_config: model must be a string, got int`.
- **`effort` and `use_subscription` are additionally checked by VALUE** — the two keys whose
  vocabulary is closed (`docs/harness.md:103-105`) — and `effort` because the CLI will not
  check it for us. A misspelt level does **not** fail the CLI — it warns and runs at the default, exit 0, so
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
       [--setting-sources "" --plugin-dir … --mcp-config … --strict-mcp-config --settings …] \
       [--model <model>] \
       [--system-prompt <system_prompt>] \
       [--effort <effort>] \
       <args...>
```

The bracketed `--setting-sources` block appears **only when `agent_env` is set**; `--bare` is
no longer part of it (`docs/harness.md:152-163`). The first five flags are always present and
never configurable:

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

### 2b. `use_subscription:` — who pays for the run

Sandbox levels `home` and `container` give the run its own HOME, so the Claude Code login in
your `~/.claude` is not visible inside them. madbench reads that login's token live, per run,
and forwards it as `CLAUDE_CODE_OAUTH_TOKEN`; nothing is written to disk
(`docs/harness.md:1345-1352`).

| Value | What it does |
|---|---|
| `optional` *(default)* | **Prefer the host login; fall back to a key.** When the login is usable the run bills it, and an `ANTHROPIC_API_KEY` that is also set is **masked** — preflight says it is not used. When the login is missing or expired and a key is set, the key bills the run, and preflight says so |
| `required` | bill the host login or do not run; a missing or expired login is a blocking preflight finding |
| `api_usage` | never read the host login — no keychain call, no dialog. **The way to bill a key on purpose** |

(`docs/harness.md:1354-1358`.) **`optional` changed meaning on 2026-09-19.** It used to stand
down whenever a key was set, so a key kept in the keychain silently took every run off the
subscription until its credit ran out; the login now wins by default
(`docs/harness.md:1401-1404`). Measured on 0.37.0 with both present, preflight's header reads
*"billed to your Claude <plan> subscription — the ANTHROPIC_API_KEY that is also set is not
used (use_subscription: api_usage bills the key instead)"*. `--use-subscription <value>` (and
`MADBENCH_USE_SUBSCRIPTION`) overrides it for every claude-code bench in one invocation, since
the answer is often a property of the machine (`docs/harness.md:1360-1362`).

The same rule holds for the Driver and every judge on the `claude-code` provider: that
provider means "this machine's login", so it removes `ANTHROPIC_API_KEY` from the CLI it
starts (`docs/harness.md:1406-1409`).

**`required` beside `agent_env` now works.** It used to be refused, because `agent_env` ran
the CLI `--bare`, which never reads OAuth. `--bare` is gone from `agent_env`
(`docs/harness.md:887-895`), and measured on 0.37.0 a bench declaring both preflights clean
and bills the subscription. Upstream's `docs/harness.md:1411-1416` still says the pairing is
refused; the binary no longer does. Do not put the OAuth token in `madbench key` or `.env` —
it expires in hours and a stale copy fails as an unrelated-looking auth error
(`docs/harness.md:1391-1394`).

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

**Interactive needs magmux on THIS machine**, at every sandbox level, on PATH (or
`harness_config.magmux_binary`, or `$MADBENCH_MAGMUX`). `madbench preflight` checks for it
only when some Scenario is interactive, and the finding names `interactive: false` as a way
out (`docs/harness.md:1553`).

**magmux is checked by capability, never by version number.** Preflight runs `magmux
--help` under a short timeout and looks for the flags madbench actually passes
(`--headless`, `--sock-dir`); a missing flag **blocks**, naming the flag and the version the
binary reported. A version bound could not have verified it — 0.9.0 was cut from a branch
that never contained 0.8.0's flags, and magmux ignores an unknown flag rather than refusing
it, so against 0.9.0 the version read as satisfied and every interactive run waited out a
twenty-second socket timeout. A `--help` that fails or times out is **advisory only**, and
there is deliberately no upper bound (`docs/harness.md:1554`, `:1634-1650`).

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

### `driver:` — somebody answers the agent's questions

Those four prompts are the CLI's own. The **agent** can ask too: Claude Code's
`AskUserQuestion` paints a picker and waits for a keypress. Before the Driver existed that
Scenario waited out its `timeout:` and died with `turn 1 never ended: context deadline
exceeded`, and fencing the tool off with `--disallowedTools AskUserQuestion` changed what was
under test (`docs/driving-a-session.md:8-23`). The Driver answers instead.

**With no YAML at all, an interactive claude-code Scenario gets one.** It runs the `claude`
on this machine, headless, on the login it already has — no API key — and it only
**answers**: it never writes a prompt of its own, so the conversation stays exactly the
prompts the bench declared (`docs/driving-a-session.md:49-66`, `:115-127`). Measured on 0.37.0:
`madbench preflight -v` on an interactive claude-code bench with no `driver:` block lists a
`Driver driver` component. `driver: false` turns it off; a question then fails the Scenario
**at once and by name** rather than being waited out (`docs/driving-a-session.md:67-79`):

```
claudecode: turn 1 blocked on AskUserQuestion, unanswered
  question: "Deploy target"
  options:  staging | production
  fix:      declare a driver:, or answer it with driver.answers:
```

Upstream's `docs/vocabulary.md:658-669` still describes the older rule — an answering Driver
only "whenever `ANTHROPIC_API_KEY` resolves", and none without a key. `driving-a-session.md`
is the newer statement and the one the binary matches.

```yaml
driver:
  # model: omitted — the default is the local `claude` on its own login. Name one to bill a key.
  instructions: |
    You are the engineer who owns this service. Prefer the safest option.
  answers:                     # consulted BEFORE the model; first match wins
    - match: "Deploy target"   # matched against the question's header, then its text
      choose: staging          # by label, or a 1-based index
  steer: false                 # true: the Driver may write the next prompt itself
  max_turns: 8                 # default: declared prompts + 3
  max_blocked_wait: 120s       # total wait on questions, ADDED to timeout:
  allow_free_text: false       # true: may type prose into the picker's free-text row
```

(`docs/driving-a-session.md:85-111`.) A bench-level block is inherited by every Scenario; a
Scenario's own overrides it (`:284-285`).

- **Answering vs steering.** Answering unblocks a turn already in flight and cannot change a
  bench that passes today, because the alternative is a timeout. `steer: true` writes further
  prompts after the declared ones run out — which changes `FinalOutput`, which every
  `contains` reads, so it is opt-in (`docs/driving-a-session.md:295-318`).
- **`answers:` buys determinism back.** A model's answer is a sample — for an A/B, a second
  variable nobody declared. A `match: "*"` catch-all makes the Driver a lookup table: no key,
  no network, the same answer every repeat (`docs/driving-a-session.md:332-365`). Prove it
  from the Session with `session:driver-source: scripted`.
- **The guard audits it.** Every declared field of the block is hashed into
  `guard_changes:`, so two runs whose Drivers differ are `CONFOUNDED` unless `allow:` names
  `driver` or `driver/instructions` (`docs/driving-a-session.md:367-382`).
- **The worst case is stated in the file**: `timeout + max_blocked_wait`. Blocked time is
  counted apart from working time (`docs/driving-a-session.md:527-541`).
- **The question is untrusted input.** The Driver *chooses* an offered option as a single
  keystroke rather than typing text; `allow_free_text` opens a single-line, 200-character
  path that refuses a leading `!`, `/` or `#` (`docs/driving-a-session.md:392-408`).
- **A subagent cannot ask.** Claude Code removes `AskUserQuestion` from every subagent, so a
  bench cannot depend on a delegated agent asking (`docs/driving-a-session.md:708-733`).

**Refused — each measured on 0.37.0, each at `preflight`, none at `list`:**

| Combination | Why |
|---|---|
| `driver:` on any harness but `claude-code` | only claude-code reads a Driver; `harness: mock` "cannot be driven" (`docs/driving-a-session.md:31-35`) |
| `driver:` with `interactive: false` | `claude -p` disables every tool that needs terminal input, so the agent never asks (`docs/driving-a-session.md:287-291`) |
| `driver:` with `--manual` | a person holds that keyboard (`docs/harness.md:777`) |
| `driver:` beside `harness_config.agent_env` | the binary says `agent_env` loads no hooks and the Driver learns of a question from a hook (`docs/driving-a-session.md:640-642`). Upstream's release notes say hooks now load under `agent_env`; for this pairing the 0.37.0 binary still refuses |

Only a **declared** `driver:` is refused; the baseline Driver is simply not built where it
cannot run (`docs/harness.md:779-781`). Grade a driven run with the four Driver checks —
`session:question-asked`, `session:answer-verified`, `session:end-reason`,
`session:driver-source` — in `checks-catalog.md` §8.

### `--watch` — seeing every driven session

`--watch` draws each agent's own screen live inside the progress region, one slot per
`--concurrency`. The run is graded exactly as without it and the Session is byte-identical;
a frame is a picture, never evidence. It needs a terminal on stderr and is refused with
`--manual`, `--ui`, `--plain`, and on a run whose Scenarios are all `--print`
(`docs/driving-a-session.md:545-581`).

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
| reclaimed | `projects/` | the run's **own** transcript directory, named after its workspace, is deleted; nothing else there is touched |
| left alone | `todos/`, `shell-snapshots/`, `statsig/` | not deleted from: their entries are named by session id or timestamp, so a run cannot tell its own from another Claude Code session's |
| reported | `plugins/` | stamped and compared; a change is **reported**, not undone |
| out of scope | caches, logs, telemetry, downloads, session data, the agent's own dotenv | not examined |

(`docs/sandbox-levels.md:86-92`.) The CLI re-creates the transcript directory as it shuts
down, after the run removed it, so madbench clears that backlog at the **start of the next
run** and reports what it removed (`docs/sandbox-levels.md:99-109`).

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

A directory shaped like a `.claude` folder — `plugins/`, `.mcp.json`, `settings.json`. When
set, it is copied into the sandbox workspace and the CLI runs with `--setting-sources ""`: no
user, project or local `settings.json` scope is consulted, and only what the folder declares
is added back — `--plugin-dir` per plugin, `--mcp-config … --strict-mcp-config`, `--settings`
(`docs/harness.md:881-885`, `:925-934`). Unset changes nothing: isolation is opt-in.

**`--bare` was removed from this path on 2026-09-23.** It closed no leak `--setting-sources ""`
does not, and it took the run's credential: bare reads only `ANTHROPIC_API_KEY` or an
`apiKeyHelper`, never OAuth, so every `agent_env` bench was forced onto a funded API key
(`docs/harness.md:887-895`). Such a bench now bills like any other, subscription included, and
hooks load in it (upstream's v0.37.0 release notes). Measured on 0.37.0: `agent_env` beside
`use_subscription: required` preflights clean.

Upstream's `harness.md` was only partly rewritten, so several statements beside the removal
note still reason from `--bare`. Treat each as **unverified on 0.37.0** rather than as fact:

| Upstream still says | Where | Status on 0.37.0 |
|---|---|---|
| a top-level `skills/` in the env is a hard error | `docs/harness.md:934`, `:975-983` | still the rule — skills ride inside a plugin: `<env>/plugins/<p>/skills/<s>/SKILL.md` |
| `settings.local.json` in the env is a hard error | `docs/harness.md:932` | the stated reason is `--setting-sources`, not `--bare`, so it stands |
| skills are not advertised, so `session:skill-used` can never fire | `docs/harness.md:995-998` | premise (`--bare`) removed; **not measured** |
| `CLAUDE.md` is inert — no auto-discovery | `docs/harness.md:1451` | premise (`--bare`) removed; **not measured** |
| a `driver:` cannot be combined with `agent_env` | `docs/driving-a-session.md:640-642` | **still refused by the binary** (measured) — §3 |
| `use_subscription: required` cannot be combined with `agent_env` | `docs/harness.md:1411-1416` | **no longer refused** (measured) — §2b |

`agent_env` governs what the CLI **loads**, not what the agent can **read**: an agent that
greps the filesystem still finds trees on disk. Filesystem isolation needs a container
(`docs/harness.md:958-973`).

---

## 6. `plugins:` — staging a registry

```yaml
harness_config:
  plugins:
    - id: dev@magus                                   # <plugin>@<marketplace>
      path: <plugin cache dir>/dev/3.3.0              # the plugin FOLDER
    - id: benchproof@madbench-proof
      path: ./marketplace/plugins/benchproof
      marketplace: ./marketplace                      # only when path is not inside a registry
```

```yaml
harness_config:
  marketplace: ../../..                               # the checkout, named once
  plugins: [code-search, claudish]                  # plugin NAMES — the short form
```

Both spellings stage the same registry and a bench may mix them: an entry is either a plugin
name or the full mapping, and `marketplace:` beside `plugins:` is the checkout every name
falls back to. The short form is not sugar — both halves of `code-search@magus` are facts
of the checkout's own `marketplace.json` (`docs/harness.md:1015-1038`).

Stages plugin folders into the run's `~/.claude` as an installed, **user-scoped, enabled**
registry the CLI discovers on its own, instead of hand-writing `known_marketplaces.json`. It
**composes with `agent_env`** rather than replacing it, and applies on both drive paths
(`docs/harness.md:1074`). This is the native answer to "stage a plugin tree for a run" —
never a registry-writing script beside the bench.

It needs sandbox level **`home` or higher**: the registry is only the run's `~/.claude` when
HOME is the workspace, so at `none`/`workspace` madbench refuses rather than writing a file
nothing reads. Everything checkable — the folder, its `plugin.json`, declared dependencies,
the marketplace — is checked by `preflight` before any spend (`docs/harness.md:1133-1148`).

Use `plugins:` when the bench measures the plugin as a user meets it; `agent_env`'s
`--plugin-dir` route is the declared-environment alternative. A with/without-plugin
comparison is a param spent on `plugins:` — `plugins: []` in one run stages no registry at
all — plus `allow: [plugins]` on the Eval (`docs/comparing-runs.md:115-157`). Upstream's
worked example there still writes the Eval's block as `control:`
(`docs/comparing-runs.md:133-137`), which 0.37.0 refuses; write `guard_changes:`.

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

- **`probe:`** asks the environment what it has, before the agent launches. Two channels
  answer to it (`docs/harness.md:1223-1232`): `claude plugin list --json` (and, within
  `details:`, `claude plugin details <id>`) through the SAME sandbox, and therefore the same
  HOME, the agent will run under — a probe launched any other way reads the host's registry
  and reports a plugin set that has nothing to do with the run; and the **MCP preflight**
  (§7a), one `initialize` + `tools/list` handshake per declared server. The plugin channel is
  skipped when the bench declares neither `plugins:` nor `agent_env`. **`probe: false` leaves
  Reported absent and launches no new process, MCP included**; upstream's `harness.md` says
  every `environment:*` Check then ERRORS (`docs/harness.md:1234-1236`), while `madbench
  check` now lands an unprobeable check **outside the verdict** rather than in the error
  bucket (`docs/checks.md:903-905`). Either way it is loud and never a pass — read the bucket
  the control prints rather than predicting it.
- **`details:`** adds one exec per plugin for the per-kind breakdown, capped at 8, so a bench
  staging a large registry cannot turn one run into forty process launches. At the default a
  typical run pays two execs of roughly 0.2s each (`docs/harness.md:1238-1241`).
- **`require:`** is the gate. It runs after staging and after the probe, and **before the agent
  is launched** — the only step that spends anything. Under `require: true`, a staged plugin the
  CLI does not list, a staged plugin listed with errors, a probe that could not run, **and a
  declared MCP server that did not answer** are all refusals. The scenario is recorded as an
  **ERROR, not a FAIL**: it did not score badly, it never ran. Leave it false for a bench whose
  subject IS the degraded environment (`docs/harness.md:1242-1248`). **Only a `failed` server
  refuses; an UNPROBED one never does** — a gap in madbench's knowledge is not a fact about
  the server, so an UNPROBED row is loud in the report and silent at the gate
  (`docs/harness.md:1256-1264`).

**`probe: false` with `require: true` is refused when the bench loads**, naming both keys
(`docs/harness.md:1266-1268`).

## 7a. The MCP preflight — two halves, neither replaces the other

A bench that declares MCP servers gets one extra step before the agent launches: madbench
**starts each declared server itself, from inside this run's sandbox, and speaks MCP to it.**
Servers are found on all three routes the CLI accepts — a `--mcp-config` value in `args:`
(JSON or file), a staged plugin's own `.mcp.json`, and `agent_env`'s `.mcp.json`
(`docs/harness.md:1274-1277`). It exists because the alternative is a silent absence
discovered after a full run has been paid for — one reported grid was 264 scenarios and
about $32, and it measured a tool that had never existed (`docs/harness.md:1279-1284`).
**Before grading whether an agent used a capability, prove the capability was present.**

| Outcome | Means | Under `require: true` |
|---|---|---|
| **connected** | answered `initialize`, and `tools/list` where it declared the capability; tool count recorded, zero is a real answer | proceeds |
| **failed** | launched and did not complete; the row carries the server's own words — JSON-RPC error, **stderr tail**, exit status | **refuses, before any spend** |
| **UNPROBED** | madbench could not construct a launch at all: remote `type: http`/`sse`, a `${…}` it does not own, a relative `command`, a `cwd` outside the sandbox | proceeds |

(`docs/harness.md:1292-1298`.) Grade it with `environment:mcp-reachable` — see
`checks-catalog.md` §9 for how that differs from `environment:mcp-connected`.

**The static half runs at `madbench preflight` time, with no sandbox and no launch.** It
takes the `Config` alone, reads the declarations from the same three routes, and asks *is the
declared setup complete?* — the document opened and declared something, the entry can be
launched as a stdio server at all, `command` resolves on this machine, every absolute
`$`-free arg and `cwd` exists — with severity mirroring `environment.require` so preflight
and the run-time gate can never disagree (`docs/harness.md:1581-1603`). It also pairs every
top-level `environment:mcp-reachable` value against that list and refuses a name nothing
declares (`docs/harness.md:1561`, `:1629-1632`). At `sandbox: container` none of it is
asked, because the filesystem is the image's (`docs/harness.md:1618-1620`).

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

Beyond the keys in §2, a knob is one of three things: a CLI flag through `args:`, a file the
declared environment carries, or a file seeded into `testdata:`.

| Knob | Mechanism | How |
|---|---|---|
| Model | **dedicated key** | `harness_config.model:` |
| Effort | **dedicated key** | `harness_config.effort:` — refused at load if not one of the five levels |
| System prompt (replace) | **dedicated key** | `harness_config.system_prompt:` |
| CLI binary / wrapper | **dedicated key** | `harness_config.binary:` — point at a shim or absolute path |
| Plugin tree | **`plugins:`** *(preferred)* · `agent_env` | §6 |
| Skills | **`agent_env`** *(preferred)* | `<env>/plugins/<p>/skills/<s>/SKILL.md` — a top-level `skills/` is an error. Without `agent_env`: `<testdata>/.claude/skills/<name>/` **carrying a `.claude-plugin/plugin.json`**, which the CLI adopts as `<name>@skills-dir`; a bare `SKILL.md` with no manifest is not adopted (`docs/harness.md:1442`) |
| MCP servers | **`agent_env`** *(preferred)* · `args:` · testdata | `<env>/.mcp.json`; or `args: ["--mcp-config", …]`; or seed `.mcp.json` |
| `settings.json` | **`agent_env`** *(preferred)* · testdata | `<env>/settings.json` → `--settings` |
| Hooks | **via whichever `settings.json` is in force** | under `agent_env`, `--setting-sources ""` consults none of the host's scopes; the env's own `settings.json` declares them |
| Permission mode | **via `args:`** | `args: ["--permission-mode", "bypassPermissions"]` — **read §3 first** |
| Allowed tools | **via `args:`** | `args: ["--allowedTools", "Read,Grep"]` |
| Denied tools | **via `args:`** | `args: ["--disallowedTools", "Agent,Workflow"]` |
| System prompt (append) | **via `args:`** | `args: ["--append-system-prompt", "…"]` |
| Extra readable dirs | **via `args:`** | `args: ["--add-dir", "/abs/path"]` — must exist on the host |
| `CLAUDE.md` | **testdata seeding** | `<testdata>/CLAUDE.md` or `<testdata>/.claude/CLAUDE.md`. Upstream still calls it inert under `agent_env` because of `--bare` (`docs/harness.md:1451`); `--bare` is gone, so that is **unverified on 0.37.0** — §5 |
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
| `init` | write a starter bench. **Measured on 0.37.0, the file it writes uses `runner:`, `cases:` and `assert:`, which the same binary refuses to load** — rename them, or copy an example instead |
| `report` | read stored reports: `ls`, `show`, `compare`, `history` (`madbench help report`) — there is no `list` or `trend` subcommand |
| `grade` | **positive control** — re-grade a recorded Session offline and compare to the recorded verdicts |
| `check` | **negative control** — run under the mock harness and require every graded check to fail |
| `key` | store madbench's API keys in the macOS login keychain instead of a file: `set`, `list`, `get`, `rm`. The old `keychain` command is gone — the CLI now reads that word as a path |
| `update` | upgrade madbench to the latest release (`--notes` prints what changed) |
| `version` | print version — **there is no `--version` flag** |
| `completion` | generate a shell autocompletion script |

### Flags

Read off `madbench --help` on the installed binary; the table is a map, not the source.

| Group | Flag | Effect |
|---|---|---|
| What runs | `--run <name>` | run only these Eval runs by name (repeatable). Selects **which** runs; `--repeat` sets how many times each executes |
| | `--scenario <string>` | run only this Scenario by name (or description, when it has no name) — a different axis from `--run` |
| | `--param key=value` | override a declared bench param (repeatable; typed int/float/bool, else string) |
| | `--repeat <n>` | repeat each bench N times for flake detection (default 1). The old `--runs` spelling is refused: `unknown flag: --runs` |
| | `--harness <string>` | override harness for all benches |
| | `--sandbox <string>` | override sandbox level: `none`·`workspace`·`home`·`container` |
| | `--concurrency <n>` | max scenarios at once within one bench (default 4); benches run one after another |
| Watch | `--ui` | open the live run dashboard (TUI) instead of plain stdout |
| | `--plain` | append-only progress lines — **the CI shape**, implied when stderr is not a terminal, or under `NO_COLOR`/`TERM=dumb`. Choosing it in a terminal throws away the coloured live region |
| | `--theme <string>` | `auto`·`light`·`dark` (auto reads the terminal background) |
| | `--watch` | show every agent's screen live in the progress region while the Driver drives it; graded as usual. Needs a terminal; refused with `--ui`, `--plain` and `--manual` — §3 |
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
| | `--use-subscription <string>` | override how claude-code benches bill: `optional` (prefer this machine's login, even over an `ANTHROPIC_API_KEY`) · `required` · `api_usage` (never read the login; bill the key) — §2b |

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
runner does not report `exit 1` as a crash (`docs/README.md:111-112`).

Env vars: `MADBENCH_MOCK_RICH=1` · `MADBENCH_LOCKFILE_REQUIRED=1` (CI lockfile enforcement) ·
`MADBENCH_ALLOW_HOST_WRITES=1` · `MADBENCH_MAGMUX` · `MADBENCH_CLAUDISH` ·
`MADBENCH_USE_SUBSCRIPTION` (`docs/harness.md:1360`).

### `list` vs `preflight` vs a real run

**`list` proves a file parses; `preflight` proves it could run.** Never use `list` as a gate —
it gives a confident exit 0 on a bench that cannot start.

| | `list` | `preflight` | real run |
|---|---|---|---|
| YAML parses, unknown keys, bench + scenario names | yes | yes | yes |
| Retired key spelling — `runner:`, `cases:`, `assert:`, `fixture:`, `agg:`, an Eval's `control:`/`varies:`, a model block's `type:`/`base_url:` | yes | yes | yes |
| `experiment:` declared | yes | yes | yes |
| Retired `sandbox:` level | yes | yes | yes |
| Missing `testdata:` directory | **no** | yes | yes |
| Harness binary / API key present | **no** | yes | yes |
| magmux present, when a Scenario is interactive | **no** | yes | yes |
| Unknown check `type:` — including a retired `trajectory:*` or bare `skill-used` | **no** | **yes** | yes |
| A check's own arguments — `session:match` keys, an `exec` `value:` with shell syntax, an even `votes:`, `args.envelope` | **no** | **yes** | yes |
| A `driver:` the harness or drive mode cannot take; an interactive `image:` Scenario | **no** | **yes** | yes |
| Missing `file://` grader file | **no** | **yes** | yes |
| `image:` missing / wrong format / harness can't carry it | **no** | **yes** | yes |
| A declared MCP server's `command` resolves; an `mcp-reachable` value names a declared server | **no** | **yes** | yes |
| A `module/` has `bun` and a `package.json` | **no** | **yes** | yes |
| A `metrics:` expression that will not parse | yes | yes | yes |
| A check that grades nothing | no | no | no — use `madbench check` |

**Where the line falls.** Anything that makes a bench file **malformed** — an unknown key, a
retired key spelling, a bad metric declaration, a retired `sandbox:` level — is a **load**
error, and every command refuses it identically. Anything decided when a **check or component
is constructed**, and anything about **this machine** — binaries, keys, images — is
preflight's job alone, because `list` constructs neither. The retired-spelling, check-argument,
`driver:` and `image:` rows were measured on 0.37.0: `list` exit 0, `preflight` exit 1 for
each "no"; `list` exit 1 for each retired key and for `experiment:`.

**Preflight is automatic.** Every run preflights first and refuses to start if anything blocks
(`nothing was run, no spend`). `--skip-preflight` opts out.

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
