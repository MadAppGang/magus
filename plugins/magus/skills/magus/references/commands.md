# install, update, upgrade, doctor — and magus itself

## Which one

| The user wants to | Run |
|---|---|
| set up a fresh clone, or get exactly the versions the profile pins | `magus install` |
| bring the active profile up to date | `magus update` (applies without asking) |
| see what update would do | `magus update --dry-run` |
| fail CI when the setup is behind | `magus update --check` |
| update the magus tool itself | `magus upgrade` |
| find out what is wrong | `magus doctor`, then `magus doctor --fix` |

## `magus install [profile] [--check] [--yes]`

- No argument: installs what ALL profiles need, keeps the active profile (or asks which
  one). With a name: that profile.
- Shows the plan and asks `Install this plan?` (`--yes` skips the question). Then it adds
  the marketplaces, activates the profile, installs plugins at PROJECT scope, installs CLI
  tools (asks once), and asks for required env values, saved to LOCAL settings.
- Two profiles pinning different versions: the higher pin wins.
- `--check` reports version drift and writes nothing; it fails only when the project sets
  `strictVersions`.
- Needs the `claude` command on PATH.

## `magus update [profile] [--dry-run] [--check]`

- Works on the ACTIVE profile: installs what it declares but this machine lacks, and moves
  everything behind to the version its marketplace publishes. Removes deprecated plugins.
- **Applies without asking, forward only** — no downgrade, no delete. That includes running
  CLI-tool installers (brew, bun). The only question it asks is adoption, in a project with
  no profiles.
- A pin naming an older version is reported, not chased: only the newest version is
  installable.
- `--dry-run` prints the plan, writes nothing, always exits 0.
- `--check` writes nothing and exits 1 if anything is missing or behind — the CI gate.
- Afterwards it sets up the repo's other worktrees (see `git.md`).

## `magus upgrade`

Updates magus itself to the latest `magus-cli`, with whichever of bun or npm owns the
`magus` on PATH; it warns about a second, shadowed install. `magus --version` (or `-v`)
prints the version and says when a newer one exists; the TUI shows an UPDATE banner.

**Installing magus:** `bun add -g magus-cli` (or `npm install -g magus-cli`). The package is
`magus-cli`; the command is `magus`. The `magus` package on npm is unrelated.

## `magus doctor [--fix] [--yes] [--json] [--project <dir>]`

Checks, in order: global settings readable · plugin dependencies (the CLI tools each loaded
plugin `requires`, plus the profile's) · profile state · conventions (gitignore lines and
CLAUDE.md blocks plugins declare) · model routing · which plugin version Claude Code will
actually load · other worktrees with no profile.

- `--fix` repairs what it can: installs missing dependencies (lists them and asks once;
  `--yes` skips), applies profile and convention fixes, registers the model-routing hook.
- It does NOT fix a stale plugin load — `magus update` or `a` in the Plugins tab does.
- Exit 1 when something is unfixable, or fixable but `--fix` was not given. Clean prints
  "✓ No problems found."
- `--json` is the dependency section only, as one JSON document.

## Env values

A profile names the env variables it needs; values are personal. `magus install` asks for
missing required ones and saves them to `.claude/settings.local.json`. A plugin's MCP
server variables are set with `e` in the Plugins tab. magus itself reads `.env` and
`.env.local` from the current folder.

## Other flags and variables

- `--theme light|dark` forces the palette; otherwise `MAGUS_THEME`, then `TERM_THEME`, then a
  terminal query, then `COLORFGBG`, then dark.
- `--no-refresh` skips adding marketplaces the project needs but this machine lacks when the
  TUI starts.
- `GITHUB_TOKEN` avoids GitHub rate limits when skills download.
- An unknown word opens the TUI (`magus updte` is not an error), so check spelling when the
  TUI opens unexpectedly.
- Ctrl+C at a prompt exits 130.
