# Color & Aesthetics — building dense, colorful TUIs

This is the visual design core. The bar to hit (set by gonzo, btop, posting): **more
colour, more graphs, less text.** The failure mode to design against isn't ugliness — it's
*under-baking*: rendering a plain number or a flat one-color bar when the same few lines
could render a smooth gradient meter, a sparkline, or a heatmap. Reach for the rich
representation by default; the plain one is the draft you didn't finish.

All snippets use `charm.land/lipgloss/v2` and standard `image/color`.

## The default-visual contract (follow it mechanically)

Don't deliberate case-by-case about whether to visualize. Map the data type to its visual:

| You have… | Default to… | Not… |
|---|---|---|
| bounded value (%, ratio) | **gradient meter** (`Blend1D` across the fill) | bare number / flat one-color bar |
| time series / history | **sparkline** (braille or `▁▂▃▄▅▆▇█`) | the latest number alone |
| category distribution | **bar chart** / stacked bar, colored per category | "name: count" lines |
| counts over time × category | **heatmap row** per category, brightness = count | a table of numbers |
| discrete status / level / method | **colored badge** (dark ink on saturated bg) | plain colored text alone |
| genuine free narrative | text — **only inside a log/detail panel** | text as the main surface |

## The aesthetic rules (apply these by default)

1. **Color is semantic, never decorative.** A color means one thing across the whole app.
   Red = error/critical everywhere; blue = info/normal everywhere. The moment red means
   "error" in one panel and "selected" in another, glanceability dies. "More colour" means
   more *meaningful* color, never a rainbow.
2. **Default to the shape, not the number.** `CPU 78%` is the under-baked version of
   `CPU ███████████▓▒░ 78%`. The eye reads the bar first; the number is a label on it.
3. **Make gradients smooth.** A meter should blend across *many* steps — one color per cell
   via `Blend1D(width, …)` — and a heatmap cell should index a ~24-step ramp, so the color
   reads as continuous rather than as four chunky `░▒▓█` blocks. Finer is better; the
   smooth per-cell ramp is what makes these look good.
4. **Less text, checked on the screenshot.** Look at any non-log panel: if it's more than
   ~half prose or plain numbers, it's under-visualized — a meter/bar/sparkline/badge is
   waiting to replace those characters. The first frame should read as *mostly graphs and
   badges*, with sentences confined to a log/detail viewport. Abbreviate labels (`Mem`,
   `RX/TX`, `p99`); right-align numbers; let columns explain.
5. **One border style, one accent.** Pick rounded *or* double borders and a single accent
   color for focus/titles. Mixed border styles read as noise.
6. **Dim the chrome, saturate the signal.** Borders, labels, and inactive panels are
   low-contrast gray; the data and the focused panel are bright. Contrast directs the eye.

## A semantic palette (dark terminals)

Centralize these as tokens; never scatter hex literals. Tuned for contrast on dark
backgrounds and to survive 256-color downsampling.

> **Typing note (important):** `lipgloss.Color("#...")` is a *constructor function* that
> returns an `image/color.Color`. So a variable holding a color has type `color.Color`,
> and any function parameter, return, slice, or map that carries a color must be typed
> `color.Color` — **not** `lipgloss.Color` (that's the func, not a type, and won't
> compile). Import `image/color` wherever you pass colors around.

```go
package theme

import (
	"image/color"

	"charm.land/lipgloss/v2"
)

// Severity / status — fixed meanings across the app.
// (var initializers are color.Color values; the explicit type is optional here.)
var (
	Fatal   = lipgloss.Color("#FF5555") // catastrophic
	Error   = lipgloss.Color("#FF6B6B") // recoverable error
	Warn    = lipgloss.Color("#FFB454") // warning
	Info    = lipgloss.Color("#5AC8FF") // normal / informational
	Debug   = lipgloss.Color("#8A8FA0") // verbose
	Trace   = lipgloss.Color("#5C6070") // dimmest

	Success = lipgloss.Color("#2ECC71") // ok / passed
	Running = lipgloss.Color("#3498DB") // active / healthy
	Idle    = lipgloss.Color("#95A5A6") // waiting
	Dead    = lipgloss.Color("#6C7086") // offline

	// Chrome (low contrast — recede)
	Border  = lipgloss.Color("#45475A")
	Subtle  = lipgloss.Color("#6C7086")
	Text    = lipgloss.Color("#CDD6F4")
	Accent  = lipgloss.Color("#89B4FA") // focus / titles
	BgPanel = lipgloss.Color("#1E1E2E")
	Ink     = lipgloss.Color("#11111B") // text on bright badges
)

// HTTP methods (posting-style), if relevant. Map value is color.Color:
var Methods = map[string]color.Color{
	"GET":    lipgloss.Color("#61AFFE"),
	"POST":   lipgloss.Color("#49CC90"),
	"PUT":    lipgloss.Color("#FCA130"),
	"PATCH":  lipgloss.Color("#50E3C2"),
	"DELETE": lipgloss.Color("#F8615C"),
	"OPTIONS": lipgloss.Color("#9013FE"),
}
```

Gradient sequences for meters (feed to `lipgloss.Blend1D`):
- **Load/usage**: `#2ECC71 → #F1C40F → #E74C3C` (green→yellow→red)
- **Temperature**: `#3498DB → #2ECC71 → #FF8C00 → #E91E63`
- **Network**: `#2ECC71 → #F1C40F → #E74C3C`

Accessibility: differentiate by **brightness + shape**, not hue alone (red/green-blind
users). A badge's text label and a meter's fill ratio both carry the meaning even in
grayscale — keep them.

## Pattern: status badge / pill

Dark text on a saturated background reads as a "chip." This is posting's HTTP-method look
and the level badges in log viewers.

```go
func Badge(label string, bg color.Color) string { // import "image/color"
	return lipgloss.NewStyle().
		Bold(true).
		Foreground(theme.Ink).        // dark ink on bright bg
		Background(bg).
		Padding(0, 1).
		Render(label)
}

// row of badges
line := lipgloss.JoinHorizontal(lipgloss.Center,
	Badge("FATAL", theme.Fatal), " ", Badge("WARN", theme.Warn), " ",
	Badge("INFO", theme.Info), " ", Badge("OK", theme.Success),
)
```

For log-level *text* (not a chip), color the foreground instead:
`lipgloss.NewStyle().Foreground(theme.Error).Bold(true).Render("ERROR")`.

## Pattern: gradient meter / progress bar

Continuous values. The fill ratio AND the color both encode magnitude.

```go
func Meter(pct float64, width int, from, to color.Color) string {
	cols := lipgloss.Blend1D(width, from, to) // width colors across the gradient
	filled := int(pct * float64(width))
	var b strings.Builder
	for i := 0; i < width; i++ {
		ch := "░"
		if i < filled {
			ch = "█"
		}
		b.WriteString(lipgloss.NewStyle().Foreground(cols[i]).Render(ch))
	}
	return b.String()
}
// "CPU " + Meter(0.78, 24, theme.Success, theme.Error) + " 78%"
```

Half-block characters (`▌▐`) double horizontal resolution; `▁▂▃▄▅▆▇█` give 8 vertical
levels for a single-cell value bar.

## Pattern: intensity heatmap row (gonzo's severity-over-time)

This is the look that lands hardest — a smooth per-cell **color** ramp, not chunky shade
chars. Each cell is a solid `█` whose background is picked from a fine ramp running from a
dark-but-tinted floor up to the row's full severity hue. Keep the *hue* fixed per row (so
the row is scannable as one severity) and vary only *brightness* per column (so the row
reads as magnitude over time).

```go
func HeatRow(values []float64, max float64, hue color.Color) string {
	// ~24-step ramp: dark floor (keeps color identity at low counts) → full hue.
	ramp := lipgloss.Blend1D(24, lipgloss.Darken(hue, 0.80), hue)
	var b strings.Builder
	for _, v := range values {
		t := 0.0
		if max > 0 {
			t = v / max // normalize against the GLOBAL max across all rows → comparable
		}
		idx := int(t * float64(len(ramp)-1))
		if idx < 0 {
			idx = 0
		}
		if idx > len(ramp)-1 {
			idx = len(ramp) - 1
		}
		// solid block, color in the BACKGROUND → a filled, glowing tile
		b.WriteString(lipgloss.NewStyle().Background(ramp[idx]).Render(" "))
	}
	return b.String()
}
// ERROR row hue=red, WARN=amber, INFO=blue → stack with JoinVertical for the heatmap.
// Normalize every row against ONE global max so brightness is comparable across rows.
```

Why this beats a `░▒▓█` foreground ramp: 24 background colors read as a continuous heat
field (like the gonzo/severity heatmaps), where 5 shade glyphs read as steps. If you must
support 256-color-only terminals, add a redundant block glyph (`▁▂▄▆█`) tracking the same
`t` so it degrades gracefully — but prefer the smooth color ramp.

For a true color-mapped 2D heatmap (continuous x/y field), use `ntcharts/v2/heatmap` (see
`components-and-charts.md`).

## Pattern: sparkline inline with a label

Per-row trends (rustnet's per-connection bandwidth). Use `ntcharts/v2/sparkline` for a
real one, or this tiny braille/block helper for a single-line trend:

```go
var spark = []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}

func MiniSpark(values []float64) string {
	if len(values) == 0 {
		return ""
	}
	max := values[0]
	for _, v := range values {
		if v > max {
			max = v
		}
	}
	if max == 0 {
		max = 1
	}
	var b strings.Builder
	for _, v := range values {
		b.WriteString(string(spark[int(v/max*float64(len(spark)-1))]))
	}
	return b.String()
}
// "net " + MiniSpark(samples) + " 2.1MB/s"
```

## Pattern: focused vs unfocused panel

Bright accent border + bold title on the focused panel; dim border elsewhere. This is the
lazygit/btop focus model and it's what makes a multi-panel UI navigable.

```go
func Panel(title, body string, w, h int, focused bool) string {
	border := theme.Border
	if focused {
		border = theme.Accent
	}
	titleStyle := lipgloss.NewStyle().Foreground(theme.Accent).Bold(true)
	header := titleStyle.Render(title)
	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(border).
		Padding(0, 1).
		Width(w).Height(h)
	return box.Render(lipgloss.JoinVertical(lipgloss.Left, header, body))
}
```

## Anti-patterns (the "AI slop" tells to avoid)

- A wall of white text with no color, no bars, no borders — looks like `cat` output.
- Decorative rainbow color with no meaning — exhausting and unreadable.
- Numbers where a bar belongs; paragraphs where a table belongs.
- Emoji as the only status signal (inconsistent terminal width, breaks alignment). Use
  colored badges/glyphs and keep emoji optional.
- Mixed border styles and inconsistent padding between panels — reads as broken.

Verify the look by screenshotting it — see `screenshot-workflow.md`. You cannot judge
"colorful and dense" from code; render it and look.
