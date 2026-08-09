# Setup

Project setup jobs in one plugin. Investigates a repository and provisions it — plugins,
tools, MCP servers, framework references, and a seeded knowledge base — then installs the
adaptive statusline and indexes every skill reachable from the project.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "setup@magus": true } }
```

## Commands

| Command | What it does |
|---|---|
| `/setup:project` | Investigate this repo and provision it. `--dry-run` to see the plan first, `--scope user\|project` to choose where settings land |
| `/setup:statusline-install` | Install the adaptive statusline |
| `/setup:statusline-customize` | Pick sections, theme, and bar widths |
| `/setup:statusline-uninstall` | Remove it again |

Run `/setup:project --dry-run` first on an existing repo. It reports what it would change
before touching anything, which matters because provisioning writes settings files.

## Indexing skills

```
/setup:index-skills
```

Walks every skill reachable from the project and writes a browsable markdown index, plus a
small deterministic index spliced into `CLAUDE.md`. Each entry carries its **per-turn
listing cost**, which is the point: Claude Code injects skill descriptions into every turn
under a hard 8,000-character cap, so knowing what each one costs is how you decide what to
mark `disable-model-invocation`.

It is explicit-invocation only. Nothing runs it for you.

## The statusline moved here

`statusline@magus` used to own this. As of setup v1.0.0 the statusline ships from this
plugin and `statusline@magus` is a deprecated shim that keeps the old `/statusline:*`
commands resolving for one release. If you are installing fresh, use `/setup:statusline-install`
and do not enable `statusline@magus` at all.
