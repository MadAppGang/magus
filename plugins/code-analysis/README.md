# Code Analysis Plugin

Codebase investigation with mnemex MCP for semantic code search and AST analysis.

## Model Configuration

External model selection uses the centralized `shared/model-aliases.json` system.
Run `/update-models` to sync from the curated Firebase database.

See `multimodel:claudish-usage` skill → "Model Alias Resolution" for the resolution procedure.

## Channel notifications (optional)

Claudish (bundled as an MCP server in this plugin) emits real-time channel
notifications during long-running model sessions. When enabled, Claude Code
surfaces them as `<channel source="claudish">` blocks in the agent's context
so the agent can react to session progress without polling.

### Launch command

```bash
claude --dangerously-load-development-channels plugin:code-analysis@magus
```

The flag triggers a one-time confirmation prompt at startup. Once accepted,
the banner reads `Listening for channel messages from: plugin:code-analysis@magus`.

### Requirements

- Claude Code **v2.1.80 or later**
- Anthropic auth via **claude.ai** or a **Console API key**. Bedrock, Vertex,
  and Foundry are not supported by the channels feature.
- **Interactive mode**. Channels do not register in `-p` / `--print` mode —
  frames are sent but silently dropped client-side.
- Team/Enterprise: an admin must enable `channelsEnabled` in managed settings.

### What you'll see

During a `team` or `create_session` invocation, channel events arrive as the
underlying model session progresses:

```
← claudish: Read package.json
← claudish: Running build
← claudish: Editing src/auth.ts
← claudish: Mock session finished. All 6 events emitted.
```

The agent receives the same events as full `<channel ...>` tags in its
context, allowing it to react to progress, tool execution, and completion
events without calling `list_sessions` / `get_output` on a timer.

### Troubleshooting

- **Banner says `no MCP server configured with that name`**: the channel
  resolver only reads project-level `.mcp.json` and `~/.claude.json`. It does
  not consult `--mcp-config`. The plugin's `.mcp.json` is loaded automatically
  when the plugin is installed, so this typically means the plugin install
  didn't complete or the marketplace entry is stale. Run
  `/plugin marketplace update magus` and reinstall.
- **No `<channel>` blocks render but tools still work**: you're likely in
  `-p` mode. Channels require an interactive session.
- **Want to verify the wire-level traffic**: see Claudish's "Diagnostic
  tracing" section in its `CLAUDE.md` for `CLAUDISH_CHANNEL_TRACE=1` and the
  three-checkpoint trace.

### Related docs

- [Anthropic Channels reference](https://code.claude.com/docs/en/channels-reference) — protocol contract, gating, capability declaration
- [Claudish CLAUDE.md → Channel Mode](https://github.com/MadAppGang/claudish/blob/main/CLAUDE.md#channel-mode-v640) — implementation, wire-format tests, diagnostic harness
