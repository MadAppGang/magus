# The magus TUI

Bare `magus` opens it in the user's terminal. Tabs: `1` Plugins, `2` Skills, `3` MCP,
`4` Settings, `5` Profiles, `6` CLI Tools, `7` Git State, `8` Alias, `9` Styles, `0` Models.
Tabs 7 and 8–9 are in `git.md` and `alias-and-styles.md`; tab 0 in `models.md`.

## Keys everywhere

`?` every key and every symbol · `q` quit (Ctrl+C quits even under a dialog) · Tab /
Shift+Tab or a number to change tab · Esc back · ↑↓ or j/k move · `/` filter where offered
· Ctrl+U/Ctrl+D or PgUp/PgDn scroll the detail panel.

## On opening

One question at a time: earlier failures → gitignore problems (fix now, open the Git State
tab, or dismiss) → plugins Claude Code would load at an old version (repair) → the profile
question (see `profiles.md`). Then it sets up the repo's other worktrees and adds
marketplaces the project needs but this machine lacks (`--no-refresh` skips that).

## 1 Plugins

Marketplaces and their plugins; company marketplaces are listed first, shown "by <company>".
■ installed at a scope, □ not, ✗ listed by no marketplace, ★ official.

| Key | Does |
|---|---|
| `u` / `p` / `l` | install or uninstall at USER / PROJECT / LOCAL; on an outdated scope it updates |
| Enter | pick a scope; on a marketplace, expand or collapse |
| ← → | expand or collapse a marketplace or a plugin's contents |
| `U` | update or repair the selected plugin |
| `a` | update or repair everything — the same plan as `magus update` |
| `d` | remove a deprecated plugin from every scope and every profile |
| `e` | set the env variables the plugin's MCP server needs (saved LOCAL) |
| `s` | save the project's installed plugins as a profile (USER or PROJECT) |
| `n` | add a marketplace |
| `r` | refresh the marketplaces |

In a project with profiles, a PROJECT install or uninstall changes the active profile.

## 2 Skills

A catalog of skills and skill sets; typing two or more characters also searches the
registry. `u` / `p` install or remove at USER (`~/.claude/skills/`) or PROJECT
(`.claude/skills/`); Enter installs in this project; `o` opens it on the web; `r` reloads.
A skill installed here is a plain folder in the project: commit it to share it. It is not
added to the profile's skill list.

## 3 MCP

A catalog of MCP servers. Enter adds or removes one for this project and asks for its
settings (an existing env variable can be reused as `${VAR}`). The server goes to
`.mcp.json`, recorded into the profile; its secret values go to LOCAL settings. `r` opens
the MCP registry: Enter install, `/` search, `d` remove, `l` back.

## 4 Settings

About 66 known Claude Code settings by category (recommended, agents, models, workflow,
performance, terminal, advanced) — effort level, default model, output style, language,
task tools and more. `u` sets one at USER; Enter or `p` at PROJECT (recorded into the
profile).

## 5 Profiles

Built-in profiles and the saved ones, PROJECT and USER.

| Key | Does |
|---|---|
| Enter / `a` on a PROJECT profile | switch to it, as `magus profile switch` |
| Enter / `a` on a USER profile | replace the plugin list of EVERY project on this machine |
| Enter / `a` on a built-in profile | add its plugins and settings to this project |
| `r` / `d` | rename / delete |
| `c` / `i` | copy the profile as JSON / import one from the clipboard |

## 6 CLI Tools

magus, Mnemex, Claudish, Claude Code, Codex, Gemini CLI, Qwen Code, Cline, OpenCode, Aider,
Crush. Enter installs or updates, `a` updates everything behind, `c` keeps one install of a
tool installed several ways, `r` re-checks. ● current, ○ missing, * update available,
? unknown, ! several installs. These are machine installs; to make a tool part of the
project, it goes in the profile's `cliTools`, which `install`, `update` and
`doctor --fix` install.
