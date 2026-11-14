---
name: magus
description: Explains magus - profiles, install/update/upgrade, doctor, model routing, TUI tabs, git, the alias, styles. Use when the user asks how magus works or what a magus command or tab does.
allowed-tools: Bash, Read
---

# Teaching magus

magus keeps a project's Claude Code setup — plugins, skills, MCP servers, CLI tools,
settings — declared once, committed, and the same on every teammate's machine. Your job
is to explain it in the user's terms and give the exact command or key, checked against
the reference files here, never from memory.

## The model in five lines

1. **A profile** is a saved set of plugins, skills, MCP servers, CLI tools and settings for
   one project, kept in `.claude/profiles.json`. That file is committed; it is the team's
   source of truth.
2. **The active profile** is per person. magus renders it into Claude Code's own files
   (`.claude/settings.json`, `.mcp.json`, `.claude/models.json`), which are generated and
   gitignored.
3. **Changes Claude Code makes** (a plugin installed, a setting changed) are changes to the
   active profile: the next magus command records them into `profiles.json`.
4. **Scopes** are USER (every project on this machine), PROJECT (this project, shared) and
   LOCAL (this project, only this person). A plugin is installed or not installed at a
   scope; magus has no enable/disable.
5. **Three verbs:** `magus install` sets up the pinned versions, `magus update` moves the
   active profile forward, `magus upgrade` updates magus itself.

## Where the answer is

Read the file for the question before answering. Each is short; read the whole file.

| The question is about | Read |
|---|---|
| profiles, the active profile, scopes, adopting a repo, subfolders, `magus profile …` | `references/profiles.md` |
| `install`, `update`, `upgrade`, `doctor`, installing magus, env values, CI checks | `references/commands.md` |
| per-subagent models, presets, effort, `magus models …`, tab 0 | `references/models.md` |
| the TUI: opening it, its startup questions, tabs 1–6, global keys | `references/tui.md` |
| what to commit, gitignore, the Git State tab, worktrees, a committed settings.json | `references/git.md` |
| the Alias tab (a shell alias that launches claude with flags) or the Styles tab | `references/alias-and-styles.md` |
| the company plugin marketplace, `magus edit`, `magus market …`, publishing a skill edit | `../market/SKILL.md` |

## Rules

- **Run only commands that read.** Safe to run for the user: `magus --version`,
  `magus profile list`, `magus profile show <name>`, `magus update --dry-run`,
  `magus update --check`, `magus install --check`, `magus doctor` (no `--fix`),
  `magus doctor --json`, `magus models status`, `magus models list`. Anything else changes
  their setup: show the command and let them run it, or run it only after an explicit yes.
- **`magus update` applies without asking.** Say so before suggesting it, and offer
  `--dry-run` first.
- **A yes approves only the command you showed.** "Update my plugins" is `magus update`;
  a yes to its plan runs `magus update` and nothing else. `magus upgrade` replaces the
  magus tool itself: run it only when the user asks to update magus, never bundled into a
  plugin update. Mention a newer magus in one line instead.
- **The TUI needs their terminal.** Bare `magus` and `magus edit` are interactive; never
  run them yourself. Give the key instead (`?` in the TUI lists every key).
- **Do not hand-edit generated files** (`.claude/settings.json`, `.mcp.json`,
  `.claude/models.json`, `.claude/profiles/`) in a project with profiles to change what
  the team gets: that change is personal until magus records it. Change the profile —
  install from the Plugins tab or edit `.claude/profiles.json` and run `magus update`.
- **Speak in states, not mechanisms.** "This project has no profile yet", not "the
  manifest is missing". Name a file only when the user must act on it.
- **Version check.** If a command or flag here is unknown to their magus, run
  `magus --version`; older than this skill → `magus upgrade`.
- If the reference files do not answer it, say so and run `magus <command> --help`
  rather than guessing.
