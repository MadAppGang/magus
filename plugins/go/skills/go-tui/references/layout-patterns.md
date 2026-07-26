# Layout Patterns — arranging panels that survive resize

Layout is where TUIs break: panels overflow, columns misalign, content wraps ugly at
narrow widths. The fix is a discipline — compute a size budget top-down, render each panel
to a fixed box, then join. Never concatenate strings and hope.

## The size-budget method

1. Store terminal size from `tea.WindowSizeMsg` (`m.width`, `m.height`).
2. Subtract fixed chrome (header line, status/help footer) from height.
3. Split the remaining area into panel boxes with explicit widths/heights.
4. Render each panel's content into its inner size (box minus `GetFrameSize()`).
5. `JoinHorizontal` panels into rows, `JoinVertical` rows + chrome into the frame.

```go
func (m model) View() tea.View {
	const headerH, footerH = 1, 1
	bodyH := m.height - headerH - footerH

	// Two columns: 40% / 60%, 1-col gap.
	gap := 1
	leftW := (m.width - gap) * 4 / 10
	rightW := m.width - gap - leftW

	left := Panel("Stats", m.statsView(leftW-2, bodyH-2), leftW, bodyH, m.focus == 0)
	right := Panel("Logs", m.logsView(rightW-2, bodyH-2), rightW, bodyH, m.focus == 1)

	body := lipgloss.JoinHorizontal(lipgloss.Top, left, strings.Repeat(" ", gap), right)
	return tea.NewView(lipgloss.JoinVertical(lipgloss.Left,
		m.headerView(), body, m.footerView()))
}
```

The `-2` accounts for the rounded-border frame (1 cell each side). Use the real
`GetFrameSize()` when padding varies. Pass inner sizes *into* each panel's render function
so the panel never reads the global terminal size.

## Common arrangements

**Single full-screen panel** — a log tail or editor. One viewport, header + footer.

**Sidebar + main** (lazygit, posting) — narrow fixed-width left column (lists/nav), wide
main area. Left ~30–40 cols or a percentage; main takes the rest.

**2×2 grid dashboard** (gonzo, btop) — four panels in two rows. Compute row heights and
column widths from the budget, render four boxes, join into two rows, stack the rows.

**Top bar + body + status line** — a one-line header (title/context badges), the body
(any of the above), and a one-line help/status footer. This is the standard frame; build
it once and put any body inside.

**Tabs** — a tab strip (active tab = bright badge, others dim) above a single body that
swaps content by `m.activeTab`. Cheaper than many panels when views are alternatives, not
simultaneous.

## Responsive rules

- **Define a minimum** (e.g. 80×24). Below it, drop to a single-column stack or show a
  "terminal too small" message rather than rendering garbage.
- **Collapse columns at narrow widths**: below ~100 cols, stack the sidebar above the main
  area instead of beside it. Branch on `m.width`.
- **Truncate, don't wrap, in fixed cells**: clip a long log line to the panel width
  (measure with `lipgloss.Width`, slice, add `…`) so it can't push the layout around.
- **Reserve space for chrome** before splitting the body — forgetting the footer is the
  classic "last row gets cut off" bug.
- Always test **one narrow and one wide** size by screenshotting both (see
  `screenshot-workflow.md`). Resize bugs only appear at the extremes.

## Splitting big TUIs into child models

When the app has multiple screens, give each its own model with `Init`, `Update`, `View`,
and an explicit `SetSize(w, h int)`. The parent routes messages to the active child and
calls `SetSize` on `WindowSizeMsg`. This keeps each screen's state and layout self-
contained and testable. See the Bubble Tea `composable-views` example.

```go
type pane interface {
	Update(tea.Msg) (pane, tea.Cmd)
	View() string
	SetSize(w, h int)
}
```

## Measurement reminders

- `lipgloss.Width/Height/Size` for content; `style.GetFrameSize()` for border+padding cost.
- Never `len()` for layout — it counts bytes, not display cells (breaks on Unicode/ANSI).
- BubbleZone markers are zero-width to Lip Gloss, so measurement stays correct even with
  click regions marked.
