# Magus Documentation

Magus is a plugin marketplace for [Claude Code](https://docs.claude.com/en/docs/claude-code).
It ships on three channels: `magus` for core development plugins, `magus-marketing` for
content and outreach, and `magus-alpha` for experimental work.

## Start here

```bash
/plugin marketplace add MadAppGang/magus
```

Then enable the plugins you want in your project's `.claude/settings.json`. Plugin IDs
carry the marketplace, so a marketing plugin is `seo@magus-marketing`, not `seo@magus`.

## Using the plugins

- **[Plugin catalog](./plugins/index.md)** — every plugin, what it does, and which channel it ships on
- **[Advanced Usage](./guides/advanced-usage.md)** — global and project-scoped installs, version pinning, updates, custom configuration
- **[Troubleshooting](./guides/troubleshooting.md)** — plugins not loading, hooks not firing, missing marketplace, stale caches

## Building plugins

- **[Plugin Development Guide](./authoring/development-guide.md)** — manifest layout, agents, commands, skills, MCP servers
- **[Local Development](./authoring/local-development.md)** — run a plugin from a local marketplace and debug it before publishing
- **[Marketplace Reference](./authoring/marketplace-reference.md)** — every field in `marketplace.json` and `plugin.json`
- **[Contributing a Plugin](./authoring/contributing.md)** — how to submit to the marketplace
- **[Version Validation](./authoring/validation.md)** — the check that keeps versions in agreement

## Release history

Each channel ships a `CHANGELOG.md` and `RELEASES.md` scoped to the plugins you can
actually install from it.
