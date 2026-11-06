# Multimodel

Multi-model collaboration and orchestration. Run one task across several AI models under a
task type, each type with its own result, or hand it to one model running a full Claude
Code session.

The value is independence: several models that cannot see each other's answers disagree in
useful ways, and a finding that survives three sceptics is worth more than one that survives
none. A vote is one of those shapes, not the only one.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "multimodel@magus": true } }
```

Multimodel declares `claudish` as a dependency, so the MCP runtime that does the actual
provider routing installs alongside it.

## Commands

| Command | What it does |
|---|---|
| `/multimodel:team` | Run one task across several models under a task type (below). Each type has its own slot format and report |
| `/multimodel:delegate` | Hand a task to one external model running a full Claude Code session, with all plugins and skills loaded. Interactive: its questions come back to you |

```
/multimodel:team Review the auth implementation
/multimodel:team --type research How do sessions expire?
/multimodel:team Implement token revocation
/multimodel:delegate grok implement rate limiting
/multimodel:delegate gemini /dev:architect design the payment service
```

### `/multimodel:team` task types

The type comes from `--type`, else from keywords in the task, else the command asks.

| Type | What each model does | Result |
|---|---|---|
| `judge` | Reviews the task blind and votes APPROVE, REJECT or ABSTAIN | An aggregated verdict against a threshold |
| `research` | Reports findings with sources | Agreements, conflicts and single-model findings |
| `plan` | Proposes the one approach it would build | The proposals side by side, no consensus claimed |
| `debug` | States one falsifiable root-cause hypothesis with evidence | Hypotheses ranked by how many models hold them |
| `brainstorm` | Lists ideas; in a shared run, responds to the others' in a second round | Ideas with who proposed, supported and challenged each |
| `implement` | Builds it in its own git worktree | Each diff with its test result; you pick one or none to apply |
| `test` | Writes tests from `--spec` and `--contract` in a sandbox without the implementation | Each test set with its result and a blindness check; you pick one or none |
| `collaborate` | Takes a turn in your folder, continuing the previous model's work | The edits stay uncommitted, with a printed undo |

Read-only types run `isolated` (no model sees another's output) or, with
`--workspace shared`, in two rounds where round 2 sees round 1. `--test-cmd` and
`--test-dir` set how the writing types are tested. Every flag is listed in
[`commands/team.md`](./commands/team.md).

## Model selection

**Model IDs resolve against claudish's live catalog at call time**, via the `list_models`
and `search_models` MCP tools. Pass a bare model ID and let claudish route it to the right
provider. Never add a provider prefix, and never resolve an ID from memory or a committed
file: a snapshot in this repo once went four months stale and silently resolved dead IDs.

Name a family like `grok`, `gemini`, or `gpt` and claudish resolves the current model.

Read `claudish:claudish-usage` before any claudish work. It is the single place the
resolution procedure lives. It ships with the **claudish** plugin, not this one, because
claudish is published to both `magus` and `magus-marketing` while this plugin is
`magus`-only — a consumer on the marketing channel could not otherwise reach it.

## Skills

Two skills covering orchestration, plus the claudish skill they build on:

| Skill | Covers |
|---|---|
| `claudish:claudish-usage` | Model routing and provider backends. Read before ANY claudish command. Ships with the claudish plugin |
| `multimodel:multi-model-validation` | Running a task across models and comparing findings |
| `multimodel:error-recovery` | Timeouts, API failures, partial success, graceful degradation |

## In agent and command workflows

Use the claudish **MCP tools** (`team`, `create_session`, `run_prompt`), not `Bash` plus the
claudish CLI. The only CLI references that belong anywhere are diagnostics with no MCP
equivalent — `claudish --help`, `--version`, `--models` — and they live in
`claudish:claudish-usage`. Never shell out to run a model.
