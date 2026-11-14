# Profiles and scopes

## What a profile is

"A saved set of plugins, skills and MCP servers for one project. Commit it, and everyone
on the team gets the same ones." A profile can also carry CLI tools, settings, model
routing and the names of env variables the project needs.

All profiles of a project live in `.claude/profiles.json` (committed). Its parts:

| Field | Meaning |
|---|---|
| `default` | the profile a fresh clone activates without asking |
| `strictVersions` | makes `magus install --check` fail on version drift |
| `profiles.<id>.plugins` | `{"name@marketplace": "<version>" or "latest"}` |
| `profiles.<id>.marketplaces` | where non-default marketplaces live, so teammates get them |
| `profiles.<id>.extends` | a built-in profile to start from |
| `profiles.<id>.mcpServers`, `skills`, `cliTools`, `settings`, `models` | the rest of the setup |
| `profiles.<id>.env` | env variable NAMES only; values are personal (LOCAL) |

Built-in profiles to extend: `must-have`, `developer-essentials`, `frontend-pro`,
`backend-forge`, `infra-ops`, `growth-marketer`, `team-lead`.

## The active profile

Each person has one active profile per project, recorded in `.claude/profiles/active.json`
(gitignored). magus renders it into `.claude/settings.json`, `.mcp.json` and
`.claude/models.json` and installs its skills. Switching is exclusive: plugins the profile
does not list are off in this project.

magus does not run in a project with profiles until one is active. The states it reports:

| State shown | What to do |
|---|---|
| "magus uses profiles" (no profiles yet) | save what is installed now as the first profile |
| "No profile selected" | pick one (or save the current setup as a new one) |
| "Active profile no longer exists" | pick another |
| "This project uses an old magus profile format" | "Update it now" converts it |
| a file magus cannot read | fix that JSON by hand; magus never overwrites it |

A fresh clone with a `default` and nothing of the person's own to replace is activated
without asking ("✓ Active profile: X (declared by this project)").

## Changes flow both ways

- **Claude Code → profile.** Every `install`, `update`, `profile`, `models` command and
  every TUI open first records what changed in the live files into the ACTIVE profile,
  one line each, e.g. `Added code-search@magus to profile "frontend"`. Plugins, project
  settings, MCP servers and model routing are recorded. A magus-installed skill that was
  edited becomes a custom skill (commit it).
- **Profile → Claude Code.** When a pull changes `profiles.json`, the next magus command
  regenerates the live files. If both changed, local edits merge in; on the same key the
  local edit wins.
- `settings.local.json` (LOCAL) is personal and not part of the profile.

## Scopes

| Scope | File | Who it affects |
|---|---|---|
| USER | `~/.claude/settings.json` | every project on this machine |
| PROJECT | `.claude/settings.json` | this project, everyone (through the profile) |
| LOCAL | `.claude/settings.local.json` | this project, only this person |

Profile plugins install at PROJECT scope, so one repo never turns plugins on everywhere.
A plugin a profile plugin depends on is installed with it ("Also installing what those
plugins depend on: …").

## Commands

| Command | Does |
|---|---|
| `magus profile list` | every profile; ● marks the active one |
| `magus profile show <name>` | everything the profile resolves to |
| `magus profile switch <name>` | records edits into the profile being left, then activates `<name>`: settings, MCP servers, models, skills. It does not install plugins; it says `Run magus install <name>` when something is missing |
| `magus profile init [--yes]` | create `.claude/profiles.json` from what this project has installed now; refuses when profiles exist |

## A project with no profiles

`magus install` or `magus update` there shows "No profiles in this project yet", lists the
plugins (PROJECT) and MCP servers it would save, warns about anything a teammate will not
have (a plugin from no marketplace, a setting pointing at a folder on this computer), and
asks `Save as profile "<id>"?`. Saying yes saves and activates it. Without a terminal it
stops and names `magus profile init`.

## Subfolders

Claude Code treats each folder it is started in as its own project. Run magus in a
subfolder of a project with profiles and it says "Inside another Claude Code project":
run magus in the project folder, or `magus profile init` to give the subfolder a setup of
its own on purpose.

## USER profiles

The Profiles tab can also save a profile at USER scope (`~/.claude/profiles.json`), a
personal template. Applying one REPLACES the installed plugin list for every project on
the machine — warn before suggesting it.
