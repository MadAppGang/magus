# Multimodel

Multi-model collaboration and orchestration. Run a task across several AI models in
parallel and aggregate their independent verdicts, or hand it to one model running a full
Claude Code session.

The value is independence: several models that cannot see each other's answers disagree in
useful ways, and a finding that survives three sceptics is worth more than one that survives
none.

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
| `/multimodel:team` | Blind voting across models in parallel. Each votes APPROVE or REJECT without seeing the others, then verdicts are aggregated |
| `/multimodel:delegate` | Hand a task to one external model running a full Claude Code session, with all plugins and skills loaded. Interactive: its questions come back to you |

```
/multimodel:team Review the auth implementation
/multimodel:delegate grok implement rate limiting
/multimodel:delegate gemini /dev:architect design the payment service
```

## Model selection

**Model IDs resolve against claudish's live catalog at call time**, via the `list_models`
and `search_models` MCP tools. Pass a bare model ID and let claudish route it to the right
provider. Never add a provider prefix, and never resolve an ID from memory or a committed
file: a snapshot in this repo once went four months stale and silently resolved dead IDs.

Name a family like `grok`, `gemini`, or `gpt` and claudish resolves the current model.

Read `multimodel:claudish-usage` before any claudish work. It is the single place the
resolution procedure lives.

## Skills

Seventeen skills covering orchestration. The ones you are most likely to want:

| Skill | Covers |
|---|---|
| `multimodel:claudish-usage` | Model routing and provider backends. Read before ANY claudish command |
| `multimodel:multi-agent-coordination` | Parallel vs sequential execution, agent selection, delegation |
| `multimodel:multi-model-validation` | Running a task across models and comparing findings |
| `multimodel:task-complexity-router` | Matching task complexity to the right model tier |
| `multimodel:task-orchestration` | Phase tracking for multi-step workflows |
| `multimodel:quality-gates` | Approval gates, iteration loops, severity classification |
| `multimodel:error-recovery` | Timeouts, API failures, partial success, graceful degradation |

## In agent and command workflows

Use the claudish **MCP tools** (`team`, `create_session`, `run_prompt`), not `Bash` plus the
claudish CLI. CLI invocations belong only in the `claudish-usage` skill's own documentation.
