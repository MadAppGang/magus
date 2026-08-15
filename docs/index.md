# Magus Documentation

Magus is a plugin marketplace for [Claude Code](https://docs.claude.com/en/docs/claude-code).
It ships on three channels: `magus` for core development plugins, `magus-marketing` for
content and outreach, and `magus-alpha` for experimental work.

## Start here

```bash
bun add -g claudeup
claudeup
```

That is it. **[claudeup](./guides/install.md)** lists the Magus marketplaces, registers
whichever you pick, and installs the plugins along with the MCP servers, binaries, skills
and CLI tools they depend on.

## Guides

- **[Installing Magus](./guides/install.md)** — claudeup, marketplaces, enabling plugins
- **[Teams and profiles](./guides/teams.md)** — one committed manifest, one command per teammate
- **[Building a feature](./guides/dev-build.md)** — `/dev:dev`, depth, and presets
- **[Fixing a bug](./guides/dev-debug.md)** — `/dev:fix`, reproduced first, reviewed twice
- **[Designing before you build](./guides/dev-architect.md)** — `/dev:architect` and plan mode
- **[Understanding code](./guides/dev-investigate.md)** — `/dev:investigate`, read-only
- **[Documentation](./guides/dev-doc.md)** — `/dev:doc` and its four modes
- **[Isolated worktrees](./guides/dev-worktree.md)** — `/dev:worktree` with database branching
- **[multimodel](./guides/multimodel.md)** — a blind vote across models, or handing a whole
  task to one
- **[code-analysis](./guides/code-analysis.md)** — asking questions about code you didn't write
- **[bunjs](./guides/bunjs.md)** — one command, and the eight skills behind it
- **[Advanced Usage](./guides/advanced-usage.md)** — global and project-scoped installs, version
  pinning, updates, custom configuration
- **[Troubleshooting](./guides/troubleshooting.md)** — plugins not loading, hooks not firing,
  missing marketplace, stale caches

## What is available

- **[Plugins](./plugins/index.md)** — three marketplaces, and what each carries. Follow a
  plugin's name for its commands, subagents and skills.

## Release history

Each channel ships a `CHANGELOG.md` and `RELEASES.md` scoped to the plugins you can
actually install from it.

---

Writing a plugin rather than using one? That is a separate tutorial and does not live here.
