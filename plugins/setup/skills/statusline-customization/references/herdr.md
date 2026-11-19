# The status line under herdr

herdr reports no client theme, keeps no session copy of `COLORFGBG` and has no window
colour. So in a herdr pane outside tmux, appearance step 4 does not run, step 7 reads
`$COLORFGBG` exactly as it does outside tmux, and the worktree chip comes from
`$CLAUDE_WT_COLOUR`: it cannot follow a later `/color`.

## Which multiplexer owns the pane: the nearer one

Under herdr inside tmux, `TMUX` and `TMUX_PANE` are inherited from the outer tmux, whose
window belongs to herdr, not to this session. When both `TMUX_PANE` and `HERDR_PANE_ID`
are set, `tmux_owns_pane` in the script walks up from its own process (at most 32 steps)
and stops at the first that is either:

- the tmux pane's shell (`tmux display -p -t "$TMUX_PANE" '#{pane_pid}'`): tmux owns the
  pane;
- a process whose command is `herdr` (a herdr server or client): herdr owns it.

A walk that meets neither, or a failed read, counts as not tmux's. Under herdr inside
tmux the herdr server descends from the outer tmux pane, so that pane's shell is an
ancestor too, only farther away than herdr. A tmux server's parent is pid 1, so under
tmux inside herdr the walk meets the pane's shell first.

When tmux does not own the pane, the chip skips `@cc_colour` and takes
`$CLAUDE_WT_COLOUR`, else the name hash. The theme steps still read the outer tmux client,
because that client is the terminal herdr draws on. With only one of the two variables
set, nothing extra runs and plain tmux pays nothing new.

## `statusline.sh --sources`

It renders nothing and reads no input, so it never waits on a terminal. It prints which
source answered, one line each:

```
theme: the tmux client showing this pane (dark)
chip: CLAUDE_WT_COLOUR (blue)
```

Under herdr, when tmux does not own the pane, it adds one line, chosen by what answered
the theme:

- a tmux client, Claude Code's setting, or the script's own flag or variable:
  `Under herdr the worktree chip cannot follow /color; it comes from CLAUDE_WT_COLOUR.`
- `TERM_THEME`, `COLORFGBG` or the dark default:
  `Under herdr the status line cannot read a terminal theme or follow /color; the theme comes from TERM_THEME or COLORFGBG (else dark) and the worktree chip from CLAUDE_WT_COLOUR.`

`/setup:statusline-customize` runs it and shows the output, so the line appears once each
time the user asks about the status line, never on a render.

To make the chip follow a colour under herdr, set `CLAUDE_WT_COLOUR` before Claude Code
starts; the orchestrator's launcher already exports it for the sessions it opens.
