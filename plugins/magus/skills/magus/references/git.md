# magus and git

## What to commit

| Commit | Do not commit (generated or personal) |
|---|---|
| `.claude/profiles.json` | `.claude/settings.json` |
| `.claude/style.json` | `.mcp.json` |
| `.claude/output-styles/composed*.md` | `.claude/models.json` |
| skill folders you wrote yourself in `.claude/skills/` | `.claude/profiles/` (who has which profile active) |
| | skill folders magus installed for a profile |
| | `.claude/settings.local.json` |

`magus install` and `magus profile switch` add the ignore lines.

**Teammates get changes by pulling `profiles.json`.** The next magus command regenerates
their live files; `magus update` also installs what is new.

## settings.json was committed before magus

magus still writes it, and every command prints one warning per tracked generated file
with the fix: `git rm --cached .claude/settings.json` (and the like), then commit. magus
never runs git itself. The TUI asks on every open; `magus doctor` notes it.

## 7 Git State tab

Ignore rules and repo hygiene, grouped by where each rule comes from: Project
(`.claude/gitignore.json`), Global (`~/.claude/gitignore.json`), Profile (the generated
files and managed skills), Default (built into magus). It finds files tracked that should
be ignored, ignored that should be tracked, untracked that should be tracked, and lines
missing from `.gitignore`.

`f` fixes the row, `F` fixes all, `e` opens `.claude/gitignore.json`, `t` merges the
common-dev template (node_modules, .env, .DS_Store …), `r` reloads. Fixing a tracked file
runs `git rm --cached` and stages it for the user to commit.

## Worktrees

Generated files are ignored, so a new git worktree has `profiles.json` but no active
profile: Claude Code started there loads only USER plugins. The setup plugin's start-up
hook says so and names `magus update` in that folder.

- `magus update` in the worktree sets it up.
- magus keeps a block in `.worktreeinclude`, so worktrees Claude Code creates itself
  (`claude -w`) get the generated files copied.
- `magus update` and the TUI also set up the repo's other worktrees automatically when the
  project declares a `default` and the worktree has nothing to replace; the rest are listed.
  `magus doctor` reports them.
