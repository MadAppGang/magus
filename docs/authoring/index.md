# Building Plugins

For people writing plugins. If you just want to use them, see
[Guides](../guides/index.md).

- **[Plugin Development Guide](./development-guide.md)** — manifest layout, agents,
  commands, skills, and MCP servers
- **[Local Development](./local-development.md)** — run a plugin from a local marketplace
  and debug it before publishing
- **[Marketplace Reference](./marketplace-reference.md)** — every field in
  `marketplace.json` and `plugin.json`, and what reads it
- **[Contributing a Plugin](./contributing.md)** — proposing and submitting your plugin
- **[Version Validation](./validation.md)** — the automated version-agreement check

## The short version

A plugin is a directory with a `.claude-plugin/plugin.json` manifest and any of
`agents/`, `commands/`, `skills/`, and a `.mcp.json`. Paths inside the manifest use
`${CLAUDE_PLUGIN_ROOT}` so they resolve wherever the plugin is installed.

Start with the [Development Guide](./development-guide.md), test it via
[Local Development](./local-development.md), then [submit it](./contributing.md).
