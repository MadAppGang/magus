---
name: go-tui
description: Build, review, or debug Go terminal UIs with the Charm stack — Bubble Tea, Lip Gloss, Bubbles, ntcharts. Use for any Go TUI, dashboard, or full-screen CLI, including colour-accurate screenshots.
disable-model-invocation: true
---

# Go TUI

Build Go terminal UIs that look like **gonzo, btop, lazygit, and posting** — colorful,
dense, graph-and-badge-heavy — not like `cat` output. The Charm stack (Bubble Tea +
Lip Gloss + Bubbles) is the foundation; ntcharts adds real charts; a verified screenshot
workflow lets you *see your UI in color* and fix what's wrong.

Two things make a TUI good, and this skill is organized around both:
1. **Sound architecture** — clean Elm-style state/update/view, correct sizing, the right
   component for each job.
2. **A strong visual look** — semantic color, data shown as shapes (bars/sparklines/
   heatmaps), status as colored badges, dense panels over prose.

You cannot judge the second from source code. So the core loop is: **build → screenshot
in color → look → fix.**

## The aesthetic this skill is for (the through-line)

When the user wants a TUI, they almost always want it to look *good and modern* — and the
bar this skill aims for is **more colour, more graphs, less text**. The failure mode to
design against is not ugliness; it's *under-baking* — rendering a plain number or a flat
one-color bar when the same five lines could render a smooth gradient meter or a sparkline.
Reach for the rich representation by default; the plain one is the draft you didn't finish.

**The default-visual contract.** Don't decide case-by-case whether to visualize — map the
data type to its visual and follow it:

| You have… | Default to… | Not… |
|---|---|---|
| a bounded value (%, ratio, 0–100) | a **gradient meter** (`Blend1D`, green→red across the fill) | a bare number, or a flat single-color bar |
| a time series / recent history | a **sparkline** (braille `⣀⣤⣶⣿` or `▁▂▃▄▅▆▇█`) | a single latest number |
| a category distribution | a **bar chart** or stacked bar, colored per category | a list of "name: count" lines |
| counts over time × category | a **heatmap row** per category, brightness = magnitude | a table of numbers |
| a discrete status/level/method | a **colored badge** (dark ink on saturated bg) | plain colored text alone |
| genuine free narrative (logs, detail) | text — **and only inside a log/detail panel** | text as the main surface |

Three rules that keep this from tipping into noise:

- **Color is semantic, never decorative.** One color = one meaning everywhere (red =
  error/critical, blue = info/normal, green = ok). The moment a hue means two things,
  glanceability dies. "More colour" means more *meaningful* color, not a rainbow.
- **Make gradients smooth.** A gradient meter should blend across many steps
  (`Blend1D(width, …)` — one color per cell), and a heatmap cell should pick from a
  ~24-step ramp, so the color reads as continuous, not as 4 chunky `░▒▓█` blocks. Finer is
  better here.
- **Dim the chrome, saturate the signal.** Borders, labels, inactive panels recede in
  gray; data and the focused panel are bright. Contrast is what makes density legible.

**The "less text" check (do this on the screenshot):** look at any non-log panel. If it's
more than about half prose/plain numbers, it's under-visualized — there's a meter, bar,
sparkline, or badge waiting to replace those characters. A dashboard's first frame should
read as *mostly graphs and badges*, with sentences confined to a log/detail viewport.

```
under-baked            →   the bar this skill aims for
CPU: 78%                   CPU  ███████████▓▒░░  78%     (gradient green→red)
errors: 89                 ERR  ▁▂▄▆█▇▅▃▂  peak 89       (sparkline + peak badge)
status: running            [ RUNNING ]                   (badge, dark ink on green)
```

`references/color-and-aesthetics.md` has the verified palette and copy-paste patterns for
gradient meters, sparklines, intensity heatmaps, badges, and focused panels.
`references/reference-apps.md` says exactly what to steal from each best-in-class TUI.

## Core workflow

1. **Inspect before importing.** For an existing repo, follow `go.mod` and current
   imports; do not migrate v1↔v2 unless asked. For a new app, default to v2:
   `charm.land/bubbletea/v2`, `charm.land/lipgloss/v2`, `charm.land/bubbles/v2/...`,
   `github.com/lrstanley/bubblezone/v2`, and `github.com/NimbleMarkets/ntcharts/v2` for
   charts. (These paths are verified to resolve.)

2. **Design state first, then render.** Model owns state; `Init` starts commands; `Update`
   folds `tea.Msg` → new state + `tea.Cmd`; `View` renders. Keep all I/O in commands. See
   `references/bubbletea-architecture.md`.

3. **Reuse components; don't reinvent.** Tables, lists, viewports, inputs, spinners,
   progress, help/key — all in Bubbles. Charts/sparklines/heatmaps in ntcharts. Mouse
   regions via BubbleZone. The full map and verified snippets are in
   `references/components-and-charts.md`.

4. **Lay out with a size budget.** Capture `tea.WindowSizeMsg`, subtract chrome, split into
   fixed panel boxes, render inner content, then `JoinHorizontal`/`JoinVertical`. Never
   concatenate strings. Never `len()` for width — use `lipgloss.Width`. See
   `references/layout-patterns.md`.

5. **Style with Lip Gloss.** Colors are `image/color` values in v2. Use `Blend1D` for
   gradients, `Darken`/`Lighten`/`Alpha` for tints, a centralized theme struct for tokens.
   See `references/lipgloss-styling.md`.

6. **Screenshot it in color and look.** This is non-negotiable for any visual work — you
   can't see color or alignment from code. Procedure below; full detail in
   `references/screenshot-workflow.md`.

7. **Test logic + lock layouts.** Drive `Update` in unit tests; golden-snapshot complex
   renders; screenshot for design. See `references/testing.md`.

## Seeing your UI: the screenshot loop

A plain text capture strips the color that *is the point*. This pipeline turns a **running
TUI into a color-accurate PNG** you can `Read`. Verified end-to-end.

```
run TUI on a private tmux socket  →  capture WITH colors (-e)  →  ansi-to-png.ts  →  Read PNG  →  fix
```

```bash
# 1. run the app on a private tmux socket, at the size you want to judge:
OUT=$(mktemp -d); SOCK=gotui-$$; SESS=tui-$$   # unique per run: a fixed name collides with a parallel capture
tmux -f /dev/null -L "$SOCK" new-session -d -s "$SESS" -x 80 -y 24 "go run ."

# 2. capture WITH color escapes once the first frame is drawn (poll — a fixed sleep races the draw):
for _ in $(seq 40); do sleep 0.25; tmux -f /dev/null -L "$SOCK" capture-pane -p -e -t "$SESS" >"$OUT/tui.ansi" 2>/dev/null && grep -q $'\x1b' "$OUT/tui.ansi" && break; done
tmux -f /dev/null -L "$SOCK" kill-window -t "$SESS"   # its only window: the session and the private server end with it

# 3. render to a 2x color PNG (Bun + aha + a Chromium-family browser, offscreen):
bun run scripts/ansi-to-png.ts "$OUT/tui.ansi" "$OUT/tui.png" 900x600

# 4. Read("$OUT/tui.png") and judge: semantic color, alignment, density, no black gaps.
#    Then fix the code and repeat. Capture one narrow (80x24) AND one wide size.
```

Key gotchas (the rest are in `references/screenshot-workflow.md`):
- **`-e` is mandatory** — it keeps the color; without it you get plain text. No `ESC` byte
  in the file means the capture failed: render nothing from it, conclude nothing.
- **`-f /dev/null` and `-L "$SOCK"` on every invocation.** A bare `tmux` reaches your
  interactive server, and a `~/.tmux.conf` that auto-creates sessions would spawn them all.
- Through the terminal MCP instead: `mcp__plugin_terminal_mux__start-and-watch({ slot: 2,
  isolated: true, command: "go run .", pattern: "<a panel title>" })`, then
  `mcp__plugin_terminal_mux__screenshot-pane({ slot: 2 })` returns a viewable PNG directly;
  `mcp__plugin_terminal_mux__close-pane({ slot: 2 })` when done. The slot tools set no
  geometry, so the Bash route above is the one for the two mandated sizes.
- `scripts/ansi-to-png.ts` needs `aha` (`brew install aha`) and a Chromium-family browser;
  it detects both cross-platform and renders at 2× for crisp blocks/braille/gradients.

## Best practices

- Centralize palette + styles in a **theme struct** once the app has more than one screen.
- Give complex screens explicit `SetSize(w, h)` methods; children never read global size.
- Prefer `key.Binding` + `help.Model` for the shortcut bar over hardcoded footer text.
- The **gradient meter** is the canonical bar — `Blend1D` across the fill is ~5 lines and
  is the *default*, not an upgrade. A flat single-color `███░░░` bar is the under-baked
  version; only drop to it if a gradient genuinely doesn't fit. Badges and heatmap rows are
  the same: a few lines of Lip Gloss, used by default. Use ntcharts for genuine charts
  (multi-bar, time series, 2D heatmaps).
- Fix background-fill "black gaps" with `Place` + `WithWhitespaceStyle` (see
  `lipgloss-styling.md`).
- Don't `fmt.Println` from a running TUI — use `tea.LogToFile`.
- Acceptance: `go build ./...`, `go test ./...`, `go vet ./...`, **plus a color screenshot**
  for any visual change.

## When to read what

- `references/bubbletea-architecture.md` — app shape, commands/messages, sizing, keyboard,
  mouse, v1↔v2, debugging.
- `references/lipgloss-styling.md` — styles, the `image/color` v2 model, verified color
  helpers (`Blend1D`, `Darken`…), layout joins, background-fill fixes.
- `references/components-and-charts.md` — Bubbles component map, key/help, BubbleZone, and
  verified ntcharts (sparkline/barchart/heatmap) snippets.
- `references/color-and-aesthetics.md` — the visual core: semantic palette + patterns for
  badges, gradient meters, heatmap rows, sparklines, focused panels; anti-patterns.
- `references/layout-patterns.md` — size-budget method, common arrangements, responsive
  rules, splitting into child models.
- `references/reference-apps.md` — gonzo/btop/lazygit/posting/rustnet/Claude Code: what to
  study and steal from each.
- `references/screenshot-workflow.md` — full color-screenshot procedure and gotchas.
- `references/testing.md` — Update unit tests, teatest, golden snapshots, visual QA.
- `scripts/ansi-to-png.ts` — bundled, verified ANSI→PNG converter.

## Source links

- Bubble Tea: https://github.com/charmbracelet/bubbletea
- Lip Gloss: https://github.com/charmbracelet/lipgloss
- Bubbles: https://github.com/charmbracelet/bubbles
- BubbleZone: https://github.com/lrstanley/bubblezone
- ntcharts: https://github.com/NimbleMarkets/ntcharts
