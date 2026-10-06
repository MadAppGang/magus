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

## Plugin dependencies

Besides the project's own stack, `/setup:project` checks what your installed plugins need
on the machine, such as the binaries behind their MCP servers. It does this in every
repository, because a plugin with a missing binary is broken whatever the stack. The list
comes from magus-cli (`magus doctor --json`), which reads each plugin's own declaration;
the command keeps no copy of it. When magus-cli is missing, `/setup:project` says so and
offers `bun add -g magus-cli` (`npm i -g magus-cli` without Bun). It then shows every
missing dependency with its fix, asks once, and on yes runs `magus doctor --fix --yes --json`,
which installs the dependencies and changes nothing else. An install that outlasts the
10-minute tool limit finishes in your terminal with the same command plus
`--project <repo>`, which resumes where it stopped. Restart Claude Code afterwards so
the MCP servers connect.

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

