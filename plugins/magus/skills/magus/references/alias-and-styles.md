# The Alias and Styles tabs

## 8 Alias — a shell alias that launches claude with flags

Not a model alias. magus manages one shell alias, by default `c`, so plain `claude` keeps
working, that starts Claude Code with the flags ticked here.

- It lives in a managed block (`# >>> magus managed alias >>>` … `# <<< magus managed alias <<<`)
  in the rc file of the current shell: `~/.zshrc`, `~/.bashrc` or
  `~/.config/fish/config.fish`. With no rc file it fails and says to create one.
- The alias name is kept in USER settings; the flags live only in the rc block.
- Flag groups: permissions (`--dangerously-skip-permissions` …), session (`--remote-control`,
  `--ide`, `--chrome`, `--effort`), context (system prompt, autocompact), development
  channels, debug, integrations, worktree (`--worktree`, `--tmux`), agent teams
  (`--teammate-mode`).
- Keys: Space or Enter toggles a flag, `e` edits a value, `r` resets the row, **`w` writes
  the rc file** — nothing changes until `w`, and the alias works in a new shell.
- A hand-written claude alias is found and offered for adoption; one with flags magus does
  not manage is copied under a different name and the original line left alone.

## 9 Styles — one output style composed from presets

Builds ONE Claude Code output style for the project from one verbosity preset (`direct`,
`explanatory` or `terse`) plus any modifiers (`no-slop`, `asd-ste100`, `evidence-first`,
`calibrated`, `plain-language`, `structured`, `terminology`). Two verbosity presets
contradict each other: pick one.

| Key | Does |
|---|---|
| Space | tick or untick |
| `a` | apply |
| `c` | turn the output style off |
| Enter / `e` | open the style file |
| `t` | fill the `terminology` template from the codebase (takes minutes) |
| `n` | new team style in `.claude/output-styles/` |
| `f` / `u` / `U` | fetch a community style / check one / check all for updates |
| `x` / `r` | reset ticks / re-read |

[x] live, [+] ticked not applied, [~] live but unticked, [ ] off.

It writes `.claude/output-styles/composed.md` (or `composed-<profile>.md`), `.claude/style.json`
(the declaration — commit both) and `outputStyle` in project settings, recorded into the
profile. Personal styles in `~/.claude/output-styles/` are listed too.
