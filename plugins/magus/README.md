# magus plugin

Teaches Claude Code how magus works, so it can answer "how do my teammates get the same
plugins?", "what does the Alias tab do?" or "should I run update or upgrade?" from the real
commands instead of guessing — and publish skill edits to a company marketplace for you.

## Skills

| Skill | Use |
|---|---|
| `magus` | Explains magus: profiles and scopes, `install` / `update` / `upgrade`, `doctor`, per-subagent model routing, every TUI tab, what to commit to git, worktrees, the shell alias and output styles. A short router; each area is a reference file it reads on demand. |
| `market` | Drives `magus market` for a company plugin marketplace: publish a skill edited in a project, add skills and plugin folders, create plugins. Plans first and asks before every change. |

Both need the magus CLI: `bun add -g magus-cli`. `market` needs magus 7.14.0 or later.
