---
name: setup
description: "Sets up code-search in a project (search engine, index and settings) through its setup CLI, asking before every change. Use when code-search setup is incomplete, or the user asks to set up, reconfigure or upgrade code search."
disable-model-invocation: true
---

# Setting up code-search

Goal: the project ends in a state the user chose, and they know whether to restart.

| End state | Meaning |
|---|---|
| ready | an engine is installed, configured and indexed, and `verify` passed |
| none | no engine, by choice; `code_search` stays but says so, and Grep, Glob and Read work as they come |
| dismissed | "ignore for this project"; nothing prompts again until `/code-search:setup` is run |

Done when the step 10 report is printed.

**Every change goes through the setup CLI.** Never edit a settings file or type an install
command yourself. The CLI refuses the unsafe cases a hand edit walks into: a malformed
settings file, a value another settings layer overrides.

Setup does not touch ripgrep. `Grep` runs whatever ripgrep Claude Code chooses, and nothing
here installs a shim or sets `USE_BUILTIN_RIPGREP`.

## Names used below

- `<root>`: the plugin root, two directories above this file (this file is
  `<root>/skills/setup/SKILL.md`). Use the absolute path you read it from.
- `<project>`: the project root, the directory this Claude Code session was started in.
- `<cli>`: `bun --env-file=/dev/null --config=/dev/null "<root>/scripts/setup.ts"`

Every CLI call passes `--project "<project>"`. Steps that say `--json` read the fields they
name. Exit codes: 0 done, 1 failed or refused, 2 usage error or nothing measured.

**On exit 1:** show the user `failure.message` and `failure.remedy` verbatim, plus, for a
process failure, `failure.process` (command, exit code or signal, stderr tail). Stop that
step. Do not retry with other flags, work around a refusal, or run a remedy without asking.

## How to ask

- **Explain first, then ask.** Before every AskUserQuestion, say in text what is being
  decided, what each option does, and what it costs. The widget is not the explanation.
- One decision per question, with the options the step names.
- A step with nothing to decide (already installed, already indexed) gets one line in the
  conversation and no question.

## 1. Read the state

```
<cli> status --deep --check-updates --json --project "<project>"
```

Read `data.report`: `headline`, `findings[]` (`code`, `level`, `message`, `remedy`),
`engine`, `setup`, `enabledIn`, `engineReport`. It runs the engine's version probe and
looks up the latest releases, so allow about 30 seconds.

## 2. Decide where to start

| `headline` | Do |
|---|---|
| `settings_invalid` | Show each `settings_invalid` finding's path and message, and stop. The user fixes that file; the CLI will not write into it. |
| `dismissed` | Say the project is set to "ignore", and that finishing setup undoes it. Continue at step 3. |
| `none` | Say the project is set to "no engine" by choice, and that choosing an engine replaces it. Continue at step 3. |
| `ready` | Say so, then go to step 7, then 8. |
| anything else | Say in one or two sentences what is missing (the matching finding's message), then step 3. |

## 3. Choose the engine

Read `<root>/mcp/adapters/catalog.ts`. Each of its four entries (`codegraph`, `graphify`,
`mnemex`, `serena`) has `about.what`, `about.pros`, `about.cons`, `packageManager`, and a
`projectStep.cost` (serena has no project step). Quote those; do not describe an engine
from memory.

Find which are installed with `<cli> install <id> --dry-run --json --project "<project>"`
for each of the four. `data.installed: true` means installed. A dry run only reads PATH and
uv's tool receipt; it installs nothing.

Present every engine in text, one short block each: what it is, pros, cons, installs
through, installed or not. Then present the fifth choice, **No engine**: `code_search` stays
registered and answers "no engine configured, by choice"; nothing is installed or indexed;
Grep, Glob and Read work as they come; no prompt appears again.

Mark one engine **recommended**:

1. the engine `report.engine` already names, if it is one of the four;
2. otherwise an installed engine (nothing to install), preferring one with no paid step;
3. otherwise `codegraph`: free, offline, and it answers callers, callees and impact.

AskUserQuestion takes at most four options, so ask in two steps:

- First: `<recommended> (Recommended)` (or `Keep <engine>` when one is configured),
  `Another engine`, `No engine`.
- Only on `Another engine`: a second question with the other three engines.

On **No engine**, go to step 5 with `none` and skip steps 4 and 6.

## 4. Install the engine

If step 3 found it installed, say so in one line and go to step 5.

Otherwise run `<cli> install <id> --dry-run --json --project "<project>"`.

- `failure.code: prerequisite_missing` (exit 1): the package manager (bun, npm or uv) is not
  on PATH. Show the remedy; it links the manager's install page. Stop here: this plugin
  never pipes an installer into a shell, and the user installs the manager themselves.
- Otherwise `actions[0]` is the exact command.

Say in text: the command, that it installs a global package through `<packageManager>`
(machine-wide, not only this project), and that it can take a few minutes. Ask: `Install`
or `I'll install it myself`. On yes, run with a Bash timeout of 600000:

```
<cli> install <id> --json --project "<project>"
```

| `failure.code` | Tell the user |
|---|---|
| `install_failed` | the command, exit code and stderr tail from `failure.process` |
| `extras_missing` | the remedy (uninstall, then install); ask before running either |
| `not_on_path` | it installed, but the binary directory is not on PATH; the remedy names the directory to add. Stop: Claude Code must be restarted with the new PATH |

## 5. Choose where the setting is written, and configure

Settings are read from three files; the later one wins where both set the same key.

| Layer | File | Who it affects |
|---|---|---|
| `user` | `~/.claude/settings.json` | every project on this machine |
| `project` | `<project>/.claude/settings.json` | everyone who clones the project, once committed |
| `local` | `<project>/.claude/settings.local.json` | only you, only this project; normally not committed |

The default is the layer where the plugin is enabled (`report.enabledIn`, the most specific
of local, project, user), because the setting belongs next to the plugin it configures.
With the plugin enabled in no layer, the default is `local`.

If `<project>/.claude/profiles.json` exists, the project is managed by magus profiles, and
say so before asking: a `code-search` block written to `.claude/settings.json` is absorbed
into the active profile in `.claude/profiles.json`, which is committed and shared with the
team. Switching to a profile without it removes it from settings.json, and setup then reads
as incomplete for that profile. `settings.local.json` is never touched by magus.

Explain the three layers in text as above, then ask: `<default> (Recommended)` and the other
two. Then:

```
<cli> configure <id|none> --layer <layer> --json --project "<project>"
```

For an engine this writes `engine`, `"setup": "active"` and the catalog's `engines.<id>`
block in one write. For `none` it writes `engine: false` and `"setup": "active"`. Either
way it clears an earlier dismissal.

| `failure.code` | Do |
|---|---|
| `engine_block_differs` | The file already has a different `engines.<id>` block, probably a hand edit. Show both blocks from the message. Ask: `Keep mine` (stop, show the remedy) or `Use the catalog block` (run again with `--replace`). |
| `layer_shadowed` | Another settings file sets the same key and wins, so the write would have no effect, and nothing was written. Show which file. Ask whether to run again with the `--layer` the remedy names. |
| `settings_invalid` | A settings file (any of the three, not only the target) is not valid JSON or has a wrong-shaped `code-search` block, and nothing was written. Show `failure.message` and the remedy. Stop: the user repairs the file. |
| `settings_malformed`, `settings_not_regular_file`, `settings_unreadable` | Show the path. Stop: the user repairs the file. |
| `settings_changed_concurrently` | Something else wrote the file meanwhile, and nothing was written. Say so and ask before running it again. |

After a successful configure, refresh the state with the fast check (no `--deep`):

```
<cli> status --json --project "<project>"
```

## 6. Build the index

Skip with one line when `engineReport.indexMarker` is absent (serena has no project step)
or `engineReport.indexed` is true.

Run `<cli> index <id> --dry-run --json --project "<project>"`. `actions[0]` is the command,
`data.cost` what it costs, `data.gitignore` the directory it creates.

Say in text what indexing does and costs, quoting `data.cost`:

- **mnemex** embeds every file through a paid embedding provider: it needs an API key and
  spends money on each full index, and the index must be rebuilt as the code changes. If
  the index fails, mnemex's own stderr (shown in the failure) names what it is missing.
- **codegraph** and **graphify** parse the project locally, with no network and no key, and
  add a directory to the project.

Ask: `Index now` or `Later`. On yes, run with a Bash timeout of 600000:

```
<cli> index <id> --json --project "<project>"
```

`index_failed` and `index_marker_missing` carry the command and stderr tail; show them.

On success, if `data.gitignore` is not already in `<project>/.gitignore`, explain that it is
generated and machine-specific, and ask whether to add it. On yes, append that one line.

## 7. Verify

```
<cli> verify --json --project "<project>"
```

Use a Bash timeout of 300000: it starts this plugin's own MCP server with the settings now
on disk and asks `code_search` one question, and mnemex can take two minutes to answer
cold. The live session's server read its settings when it started, so this is the only way
to test them before a restart.

On `not_served`, show the notes from the message. The usual cause is a missing index.

## 8. Offer upgrades

For each `info` finding from step 1 (skip the rest):

| Code | Offer |
|---|---|
| `engine_behind` | `upgrade <id>` |

Run the dry run first (`<cli> upgrade <id> --dry-run --json --project "<project>"`)
and show `actions[0]`. Say what changes, ask, then run it without `--dry-run`, with a Bash
timeout of 600000. `installed_elsewhere` means the binary was installed some other way:
show the remedy and do not force it.

## 9. Project CLAUDE.md

Say in text: `<root>/templates/claude-md-rules.md` documents the code-search tools and the
routing rule for every session in this project; without it the tools still work, but
sessions get no routing guidance. Ask: `Add to CLAUDE.md` or `Skip`.

On yes, append the template to `<project>/CLAUDE.md`. If the template's first heading is
already in the file, replace that section instead of adding a second copy.

## 10. Report

```
Engine      <id> | none (by choice) | dismissed          layer: <layer>
            installed: <path> | already installed | skipped
Index       built | already present | not needed | skipped | failed: <code>
Verify      served by <id> | not served: <reason> | not run
Upgrades    <what was upgraded, or "none offered">
CLAUDE.md   added | replaced | already present | skipped
```

Then one line on what applies the change:

- the engine settings or the index changed: restart Claude Code, or reconnect the
  code-search `ca` server in `/mcp`. The running server read its settings at startup.
- nothing changed: nothing to do.

If setup began from the session-start prompt, go back to the user's original task. Until
the restart, `code_search` still answers with the old settings, so do that task with Grep,
Glob and Read.

## Dismissing instead

If the user says at any point to stop asking about setup in this project:

```
<cli> dismiss --json --project "<project>"
```

It writes `"setup": "dismissed"` to a project settings file, never the user file. Say that
`/code-search:setup` undoes it. On `settings_invalid` nothing was written: show the message
and remedy; the user repairs that file first.
