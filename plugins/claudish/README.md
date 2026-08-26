# Claudish Plugin

Provides the **Claudish MCP runtime** for the Magus marketplace. Claudish is an
external-model proxy that exposes tools (`team`, `create_session`, `list_models`,
etc.) for orchestrating multi-model workflows from Claude Code.

This plugin is a **runtime dependency**. Other plugins (`code-analysis`, `dev`,
`multimodel`, `designer`, `seo`) declare it via the `dependencies`
field in their `plugin.json` and consume its tools through standard MCP.

## Why this plugin exists

Before this plugin, multiple Magus plugins each declared an identical Claudish
MCP server entry in their own `.mcp.json`. Claude Code's plugin loader
deduplicates by endpoint (`command + args`), so only the first plugin's
registration survived; others were silently suppressed. This worked **by
accident** as long as all declarations remained byte-identical.

Extracting the runtime into a dedicated plugin makes the dependency explicit,
follows Anthropic's documented `dependencies`-field pattern (Claude Code
v2.1.110+), and removes the silent-suppression footgun.

See: [Anthropic plugin dependencies docs](https://code.claude.com/docs/en/plugin-dependencies)

## Requirements

- The `claudish` CLI tool must be on `$PATH`. Install via npm:
  ```bash
  npm install -g claudish
  ```
- `OPENROUTER_API_KEY` environment variable for external-model access.

## What it provides

Tools exposed via the `claudish` MCP server:

- **Low-level**: `run_prompt`, `list_models`, `search_models`, `compare_models`
- **Agentic**: `team`, `report_error`
- **Channel**: `create_session`, `send_input`, `get_output`, `cancel_session`,
  `list_sessions`

Tool gating via `CLAUDISH_MCP_TOOLS` env var: `all` (default), `low-level`,
`agentic`, `channel`.

## Skills

| Skill | Covers |
|---|---|
| `claudish:claudish-usage` | Which MCP tool fits which task, model alias resolution against the live catalog, identity versus routing address, and the preferences-file trust rules |

Read it before any claudish work. It is the single place the resolution procedure
lives — every consumer plugin points here rather than restating it, because a second
copy of claudish's routing rules guarantees two versions of the truth and no way to
tell which one is stale.

**Models are run through the MCP tools, never the CLI.** The skill teaches `team`,
`create_session` and `run_prompt`; the binary's only remaining role is as the runtime
the MCP server launches, plus four read-only diagnostics (`--probe`, `--help`,
`--version`, `--models`) for investigating that runtime. No workflow shells out.

The skill lives here rather than in `multimodel` because it documents the claudish
runtime, and because this plugin ships to both the `magus` and `magus-marketing`
marketplaces. `multimodel` ships only to `magus`, so a marketing-channel consumer
such as `seo` pointed at a skill that was never installed alongside it.

## Channel notifications (optional)

Claudish emits `notifications/claude/channel` events during long-running model
sessions. To enable them in Claude Code:

```bash
claude --dangerously-load-development-channels plugin:claudish@magus
```

See the [Channels reference](https://code.claude.com/docs/en/channels-reference)
for what channels do, and Claudish's own `CLAUDE.md` "Channel Mode" section
for implementation details.

Requirements:
- Claude Code v2.1.80 or later
- Anthropic auth via claude.ai or Console API key (not Bedrock/Vertex/Foundry)
- Interactive mode (channels do not register in `-p` mode)

## Used by

This is a runtime dependency of:

- `code-analysis` — semantic code search via mnemex; uses Claudish for
  multi-model team review
- `dev` — universal development assistant; uses Claudish for `/dev:research`,
  `/team`, model orchestration
- `multimodel` — `/team` and `/delegate` slash commands
- `designer` — UI review with multi-model validation
- `seo` — multi-model content review

If you are installing Magus, this plugin is auto-installed when any of the
above is enabled.
