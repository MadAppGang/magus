# Components & Charts

Reach for an existing component before writing a custom widget. This file covers the
Bubbles component set, BubbleZone for mouse, and **ntcharts** for the graphs/sparklines/
heatmaps that make a dashboard feel alive. All chart API here is verified by compilation
against `ntcharts/v2 v2.2.0` on the `charm.land/...v2` stack.

## Bubbles components (`charm.land/bubbles/v2/<name>`)

Each is a Bubble Tea sub-model: `New(...)`, `Update(msg)`, `View()`. Drop them into your
model's fields and forward messages.

| Component | Import suffix | Use when | Key APIs |
|---|---|---|---|
| `spinner` | `/spinner` | background work / live process active | `New`, `Tick`, `WithSpinner`, `WithStyle` |
| `progress` | `/progress` | bounded progress, downloads, phases | `New`, `SetPercent`, width/gradient opts |
| `textinput` | `/textinput` | single-line search / command / field | `New`, `Focus`, `Blur`, `SetValue`, `Value` |
| `textarea` | `/textarea` | multi-line editor / comment box | `New`, `Focus`, `SetValue`, `Value` |
| `table` | `/table` | navigable rows + selection | `New`, `WithColumns`, `WithRows`, `WithStyles`, `SelectedRow` |
| `list` | `/list` | filterable / paginated item browser | `New`, `Item`, `ItemDelegate`, filtering |
| `viewport` | `/viewport` | scrollable logs / details / markdown | `New`, `SetContent`, `GotoTop`, `GotoBottom` |
| `paginator` | `/paginator` | pagination logic | `New`, `WithPerPage`, `WithTotalPages` |
| `help` | `/help` | shortcut footer from key bindings | `New`, `View`, `ShortHelp`, `FullHelp` |
| `key` | `/key` | key binding definitions + matching | `NewBinding`, `WithKeys`, `WithHelp`, `Matches` |
| `filepicker` | `/filepicker` | pick file/dir in-TUI | `New`, `DidSelectFile`, `SelectedFile` |
| `timer` | `/timer` | countdown to a deadline | `New`, `WithInterval`, `Start`, `Stop` |
| `stopwatch` | `/stopwatch` | count elapsed time | `New`, `WithInterval`, `Start`, `Stop`, `Reset` |
| `cursor` | `/cursor` | custom inputs / blink behavior | `New`, `Blink`, cursor modes |

> The `progress` component has its own gradient options; the exact option names vary by
> minor version. When you need a precise option (e.g. gradient colors, fill characters),
> check the installed version: `grep -rE "^func With" $(go env GOMODCACHE)/charm.land/bubbles/v2@*/progress/*.go`.
> Don't guess option names — confirm against the module you actually pulled.

### Key bindings + help footer (do this instead of hardcoding a footer)

```go
import (
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/help"
)

type keymap struct{ Up, Down, Quit key.Binding }

var keys = keymap{
	Up:   key.NewBinding(key.WithKeys("up", "k"), key.WithHelp("↑/k", "up")),
	Down: key.NewBinding(key.WithKeys("down", "j"), key.WithHelp("↓/j", "down")),
	Quit: key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
}

func (k keymap) ShortHelp() []key.Binding { return []key.Binding{k.Up, k.Down, k.Quit} }
func (k keymap) FullHelp() [][]key.Binding { return [][]key.Binding{{k.Up, k.Down}, {k.Quit}} }

// in Update: if key.Matches(msg, keys.Quit) { return m, tea.Quit }
// in View:   helpModel.View(keys)   // renders the colored shortcut bar
```

### Component choice rules

- Navigable/selectable table → Bubbles `table`. Static styled table → Lip Gloss `table`.
- Scrollable log/detail/output → Bubbles `viewport`.
- Search/filter/browse → Bubbles `list`.
- Form/search input → `textinput` / `textarea`.
- Shortcut footer → `key` + `help`.

## ntcharts — graphs, sparklines, heatmaps

```bash
go get github.com/NimbleMarkets/ntcharts/v2
```

Sub-packages: `barchart`, `sparkline`, `heatmap`, `linechart` (with
`streamlinechart`, `timeserieslinechart`, `wavelinechart`), `canvas`, `picture`.
Generic lifecycle: **`New(w, h, opts...)` → `Push`/`PushAll(data)` → `Draw()` → `View()`**.
Charts style via `charm.land/lipgloss/v2` styles, so they share your palette.

### Sparkline (compact time-series — the workhorse)

```go
import "github.com/NimbleMarkets/ntcharts/v2/sparkline"

sl := sparkline.New(20, 4) // width, height in cells
sl.PushAll([]float64{7, 3, 8, 2, 4, 4, 6, 2, 9, 1, 5, 7, 3, 8})
sl.Draw()
out := sl.View() // block-character sparkline; push new values as data streams in
```

### Bar chart (with per-bar color — verified field names)

```go
import (
	"github.com/NimbleMarkets/ntcharts/v2/barchart"
	"charm.land/lipgloss/v2"
)

green := lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
red := lipgloss.NewStyle().Foreground(lipgloss.Color("9"))

bc := barchart.New(20, 8)
bc.PushAll([]barchart.BarData{
	{Label: "ok",  Values: []barchart.BarValue{{Name: "v", Value: 21.2, Style: green}}},
	{Label: "err", Values: []barchart.BarValue{{Name: "v", Value: 9.5,  Style: red}}},
})
bc.Draw()
out := bc.View()
```

`BarData{Label string; Values []BarValue}` and
`BarValue{Name string; Value float64; Style lipgloss.Style}` — use the **named fields**,
not positional literals.

### Heatmap & line charts

`heatmap.New(w, h, opts...)` with `Push(heatmap.NewHeatPoint(x, y, val))` for
density-over-2D (severity-by-time grids like gonzo's). `timeserieslinechart` /
`streamlinechart` for live metric lines; both expose `Draw()` and a `DrawBraille()` for
higher-resolution output. When you need exact option/method names for a chart type, grep
the installed package:
`ls $(go env GOMODCACHE)/github.com/*/ntcharts/v2@*/<pkg>/` and read its `*.go`.

> **Build a custom meter when ntcharts is overkill.** A horizontal bar, a heatmap row of
> `░▒▓█`, or a colored badge is often 5 lines of Lip Gloss (see `color-and-aesthetics.md`)
> and gives you full control. Use ntcharts for genuine charts (time series, multi-bar,
> 2D heatmaps); hand-roll simple meters and intensity rows.

## BubbleZone — clickable regions

```bash
go get github.com/lrstanley/bubblezone/v2
```

```go
import zone "github.com/lrstanley/bubblezone/v2"

func main() {
	zone.NewGlobal()
	defer zone.Close()
	// tea.NewProgram(...).Run()
}

// Root view ONLY: scan once.
func (m model) View() tea.View {
	v := tea.NewView(zone.Scan(m.render()))
	v.MouseMode = tea.MouseModeCellMotion
	return v
}

// Mark child regions:
func button(id, label string) string { return zone.Mark(id, btnStyle.Render(label)) }

// Handle clicks in Update:
//   case tea.MouseClickMsg:
//       if zone.Get("confirm").InBounds(msg) { m.confirmed = true }
```

Rules: scan once at the root (never in children); unique IDs (use `zone.NewPrefix()` for
repeated rows); markers are zero printable width, so `lipgloss.Width` still measures
correctly; avoid hard `MaxWidth`/`MaxHeight` trims across a marker (it can break bounds).

## Official examples to mirror

Bubble Tea examples cover the common shapes — read the matching one before building:
`simple`, `window-size`, `composable-views`, `tabs`, `table`, `list-fancy`, `pager`,
`progress-animated`, `realtime`, `mouse`, `clickable`, `tui-daemon-combo`,
`glamour` (markdown). All under https://github.com/charmbracelet/bubbletea/tree/main/examples
