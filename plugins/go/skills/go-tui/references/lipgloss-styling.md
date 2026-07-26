# Lip Gloss Styling, Color & Layout

Lip Gloss is the styling and measurement layer. Bubble Tea decides *what* to show; Lip
Gloss decides *how it looks and where it sits*. Styles are immutable values you build by
chaining and reuse by rendering.

All API below is from `charm.land/lipgloss/v2` (v2.0.x) and verified by compilation.

## Colors are `image/color` values now (the #1 v2 gotcha)

In v2, `lipgloss.Color` returns a standard-library `color.Color`:

```go
import "charm.land/lipgloss/v2"

red := lipgloss.Color("#E74C3C")   // truecolor hex -> color.Color
blue := lipgloss.Color("33")        // ANSI-256 index as string
```

This matters because the color helpers below take and return `color.Color`, and you can
pass any `image/color` value (including ones from `go-colorful`) straight into a style.
Downsampling to the terminal's real capability happens automatically at render time — you
always author in truecolor.

## Style basics

```go
style := lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("#FFFFFF")).
	Background(lipgloss.Color("#1E1E2E")).
	Padding(0, 1).                              // v,h  (or t,r,b,l / single)
	Border(lipgloss.RoundedBorder()).           // takes a Border VALUE, not a string
	BorderForeground(lipgloss.Color("#585B70")).
	Width(40)

out := style.Render("hello")
```

Text attributes: `Bold`, `Italic`, `Faint`, `Underline`, `Strikethrough`, `Reverse`,
`Blink`. Box model: `Padding`, `Margin`, `Width`, `Height`, `MaxWidth`, `MaxHeight`,
`Align`, `AlignVertical`, `Inline`.

Borders are values from constructors: `NormalBorder()`, `RoundedBorder()`, `ThickBorder()`,
`DoubleBorder()`, `BlockBorder()`, `HiddenBorder()`, `ASCIIBorder()`, the half-block
borders, and `MarkdownBorder()`. `Border(b, sides...)` can enable specific sides.

> There is **no** `Style.Title()` / `TitleAlign()` method. To put a title in a border,
> render the panel then overwrite the top border row, or compose a header line above the
> box with `JoinVertical`. Don't reach for a Title method — it doesn't exist.

## Color helpers — these are real (verified) and are how you get the colorful look

```go
// Gradient: N evenly-spaced colors between stops. THE tool for gradient bars/meters.
stops := lipgloss.Blend1D(steps int, stops ...color.Color) []color.Color
//   greenToRed := lipgloss.Blend1D(30, lipgloss.Color("#2ECC71"), lipgloss.Color("#E74C3C"))

// 2D gradient field (width*height colors at an angle) — for heat fills / backgrounds.
lipgloss.Blend2D(width, height int, angle float64, stops ...color.Color) []color.Color

lipgloss.Darken(c color.Color, percent float64) color.Color   // dim a color
lipgloss.Lighten(c color.Color, percent float64) color.Color
lipgloss.Alpha(c color.Color, alpha float64) color.Color      // blend toward transparent
lipgloss.Complementary(c color.Color) color.Color

// Light/dark adaptive color. Detect once, then pick per value.
dark := lipgloss.HasDarkBackground(os.Stdin, os.Stdout)
ld := lipgloss.LightDark(dark)
fg := ld(lipgloss.Color("#1a1a1a"), lipgloss.Color("#eeeeee")) // (lightChoice, darkChoice)
```

A gradient meter, end to end:

```go
func gradientBar(pct float64, width int, from, to color.Color) string {
	cols := lipgloss.Blend1D(width, from, to)
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
```

## Layout — join and place, never concatenate

```go
lipgloss.JoinHorizontal(pos Position, strs ...string) string  // side by side
lipgloss.JoinVertical(pos Position, strs ...string) string    // stacked
lipgloss.Place(w, h int, hPos, vPos Position, str string, opts ...WhitespaceOption) string
lipgloss.PlaceHorizontal(...) / lipgloss.PlaceVertical(...)
```

`Position` constants: `Left`, `Center`, `Right`, `Top`, `Bottom` (and fractional values
0.0–1.0). Build rows of panels with `JoinHorizontal(lipgloss.Top, left, " ", right)`,
stack rows with `JoinVertical(lipgloss.Left, header, body, footer)`. See
`layout-patterns.md` for the full multi-panel approach.

## Measurement

```go
lipgloss.Width(s) / lipgloss.Height(s) / lipgloss.Size(s)
style.GetFrameSize()              // total border+padding (w, h) to subtract for inner size
style.GetHorizontalFrameSize() / style.GetVerticalFrameSize()
```

## Background-fill artifacts (why panels get black gaps)

When a styled block is taller/wider than its content, the empty cells often render with no
background and you get visible holes. Fix by letting Lip Gloss own the whitespace:

```go
func panel(style lipgloss.Style, w, h int, content string, bg color.Color) string {
	fw, fh := style.GetFrameSize()
	inner := lipgloss.Place(
		max(1, w-fw), max(1, h-fh),
		lipgloss.Left, lipgloss.Top,
		content,
		lipgloss.WithWhitespaceStyle(lipgloss.NewStyle().Background(bg)),
	)
	return style.Width(w).Height(h).Render(inner)
}
```

Use `Background` on the content-owning style; use `WithWhitespaceStyle` for the padding
Lip Gloss generates around content. `WithWhitespaceChars` sets the fill rune.

## Structured static renderers (sub-packages)

- `charm.land/lipgloss/v2/table` — styled static tables (use Bubbles `table` if navigable).
- `charm.land/lipgloss/v2/list` — static / nested lists.
- `charm.land/lipgloss/v2/tree` — static hierarchies.
- The v2 compositor/canvas (`NewCanvas`, `NewCompositor`, `NewLayer`) handles overlays,
  modals, and popovers — use it for floating dialogs over a dashboard.

## Style best practices

- For any app with more than one screen or theme, centralize palette tokens and styles in
  a **theme struct**, not scattered literals. See `color-and-aesthetics.md`.
- Set stable `Width`/`Height` on fixed-format panels and tables so content changes don't
  reflow the whole layout.
- Truncate or clip dynamic content (`MaxWidth`, or measure then slice) before it can
  resize a control.

## Source

https://github.com/charmbracelet/lipgloss
