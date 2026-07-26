# Bubble Tea Architecture

Bubble Tea is The Elm Architecture for Go terminals: **model** holds state, **Init**
kicks off work, **Update** folds messages into new state, **View** renders a string.
Everything async — keystrokes, ticks, HTTP, subprocess output — arrives as a `tea.Msg`
in `Update`. This is the discipline that keeps TUIs sane: render is a pure function of
state, so if the screen looks wrong, the state is wrong, and you fix it in one place.

## Package policy (read this first)

- **Existing repo**: follow `go.mod` and the imports already in use. Do not migrate
  between `github.com/charmbracelet/...` (v1) and `charm.land/.../v2` (v2) unless asked.
- **New app**: default to v2. The canonical import paths are verified to resolve:
  - `charm.land/bubbletea/v2` (v2.0.x)
  - `charm.land/lipgloss/v2` (v2.0.x)
  - `charm.land/bubbles/v2/...` (v2.x)
  - `github.com/lrstanley/bubblezone/v2` for mouse hit-testing

The biggest v1→v2 trap: **colors are now `image/color` values, not strings.**
`lipgloss.Color("#ff0000")` returns a `color.Color`. v2 dropped the per-renderer color
profile; downsampling happens automatically at output time.

## New app skeleton (v2)

```go
package main

import (
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"
)

type model struct {
	width, height int
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
	case tea.KeyPressMsg: // v2: KeyPressMsg, not KeyMsg
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() tea.View {
	v := tea.NewView("hello")
	v.AltScreen = true // full-screen apps; omit for inline output
	return v
}

func main() {
	if _, err := tea.NewProgram(model{}).Run(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
```

**v1 difference**: v1 uses `View() string`, `tea.KeyMsg`, and program options like
`tea.WithAltScreen()` / `tea.WithMouseCellMotion()`. v2 moves alt-screen and mouse
config onto the `tea.View` struct (`v.AltScreen`, `v.MouseMode`). When editing a v1
repo, match its style — don't half-migrate.

## Commands and messages

- A `tea.Cmd` is `func() tea.Msg` — it does work off the Update goroutine and returns a
  message. **All I/O belongs in commands, never inline in `Update`.** Blocking in Update
  freezes the UI.
- `tea.Batch(cmds...)` runs commands concurrently; `tea.Sequence(cmds...)` runs them in
  order.
- `tea.Tick(d, fn)` fires once after `d`; re-issue it from Update for a repeating clock.
  `tea.Every(d, fn)` aligns to the wall clock.
- Define **typed messages** for domain events:

```go
type tickMsg time.Time
type dataLoadedMsg struct{ rows []Row }
type errMsg struct{ err error }

func loadData(url string) tea.Cmd {
	return func() tea.Msg {
		rows, err := fetch(url)
		if err != nil {
			return errMsg{err}
		}
		return dataLoadedMsg{rows}
	}
}
```

## Sizing — the rule that prevents 90% of layout bugs

- Capture size from `tea.WindowSizeMsg` and store it on the model.
- Pass **inner** dimensions to children after subtracting frame sizes
  (`style.GetFrameSize()` returns the border+padding cost).
- Give complex child models an explicit `SetSize(w, h int)` method and call it from the
  parent's `WindowSizeMsg` handler. Children should never read the global terminal size.
- Never derive layout from `len(string)` — multibyte runes, wide CJK glyphs, and ANSI
  escapes all break byte counting. Use `lipgloss.Width`, `lipgloss.Height`,
  `lipgloss.Size`.

## Keyboard

- v2: handle `tea.KeyPressMsg`. `msg.String()` gives `"q"`, `"ctrl+c"`, `"enter"`,
  `"space"`, `"up"`, etc.
- For anything remappable or user-facing, use Bubbles `key.Binding` + `key.Matches`, and
  generate the footer with `help.Model` instead of hardcoding shortcut text. See
  `components-and-charts.md`.

## Mouse

- v2: set `v.MouseMode = tea.MouseModeCellMotion` on the view for clicks + cell-level
  motion. Use `MouseModeAllMotion` only when you truly need pixel-ish hover (it's noisy).
- For component-level click targets (buttons, tabs, rows), use **BubbleZone** rather than
  hand-rolling coordinate math. See `components-and-charts.md` → BubbleZone.

## Debugging a running TUI

- **Never** `fmt.Println` from a running TUI — it corrupts the rendered frame. Use
  `tea.LogToFile("debug.log", "debug")` early in `main`, then `log.Printf` freely; tail
  the file in another pane.
- `tea.Printf` queues output to print *above* the TUI (useful for inline, non-alt-screen
  apps).
- For Delve, run the program headless and attach from another terminal — Bubble Tea owns
  stdin/stdout.

## Source

- Bubble Tea: https://github.com/charmbracelet/bubbletea
- v1→v2 upgrade guide: linked from the README (point an LLM at it for migrations).
