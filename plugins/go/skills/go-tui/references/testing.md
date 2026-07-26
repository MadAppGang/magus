# Testing Go TUIs

A TUI has two testable surfaces: **logic** (does `Update` fold messages into the right
state?) and **appearance** (does `View` render correctly?). Test logic with ordinary Go
tests; test appearance with golden snapshots and the screenshot workflow.

## Logic tests — drive Update directly

`Update` is a pure-ish function: feed it a message, assert on the returned model. No
terminal needed.

```go
func TestQuitOnQ(t *testing.T) {
	m := newModel()
	_, cmd := m.Update(tea.KeyPressMsg{/* "q" */})
	// assert cmd is tea.Quit (compare behavior, not the func pointer)
}

func TestResizePropagates(t *testing.T) {
	m := newModel()
	m2, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	got := m2.(model)
	if got.width != 120 || got.height != 40 {
		t.Fatalf("size not stored: %dx%d", got.width, got.height)
	}
}
```

Test the behaviors that actually break: filtering, selection movement at list edges,
resize propagation to children, and state transitions (loading → loaded → error). Test
`Update` separately from `View` where you can — most bugs live in the fold, not the render.

## teatest — full-program harness

`charm.land/x/exp/teatest` runs a real program against an in-memory terminal: send
messages/keys, wait for output to contain text, assert on the final model and the final
frame. Use it for end-to-end flows (start → interact → reach a screen) and for golden
snapshots of the final render. Check the package's current API in the module you pull
(`go doc charm.land/x/exp/teatest`) since x/exp packages evolve.

## Golden snapshots — lock down complex layouts

Render a view at a **fixed** size with **fixed** data and compare to a committed file.
Determinism is everything: pin terminal width/height, freeze any timestamps, use a stable
sample dataset, and disable spinners/blink. Store under `testdata/`.

```go
func TestDashboardGolden(t *testing.T) {
	m := newModel()
	m, _ = m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	m, _ = m.Update(sampleDataMsg(fixtureRows))

	got := m.(model).render() // the plain string the View wraps

	golden := filepath.Join("testdata", "dashboard.golden")
	if *update { // go test -run TestDashboardGolden -update
		os.WriteFile(golden, []byte(got), 0o644)
	}
	want, _ := os.ReadFile(golden)
	if got != string(want) {
		t.Errorf("dashboard render changed:\n%s", got)
	}
}
```

`charm.land/x/exp/golden` provides this `-update` pattern ready-made. Snapshots include
ANSI escapes, so a color change is a diff — exactly what you want.

## Visual QA — screenshot and look

Golden tests catch *regressions* but can't tell you the design is *good*. For that, render
to a color PNG and inspect it (full procedure in `screenshot-workflow.md`):

1. Run the TUI in a headless tmux pane.
2. `tmux -L mcp-headless capture-pane -p -e -t %0 > /tmp/tui.ansi`
3. `bun run scripts/ansi-to-png.ts /tmp/tui.ansi /tmp/tui.png 900x600`
4. `Read` the PNG and judge color, alignment, density, empty space.

Do this at **one narrow (80×24) and one wide** size — responsive breakage hides at the
edges. Re-screenshot after any layout or color change.

## Acceptance checklist

Run before declaring a TUI change done:

- `go build ./...` — the entrypoint compiles.
- `go test ./...` — logic + golden tests pass.
- `go vet ./...` — no obvious mistakes.
- **Screenshot confirmation** for any visual change — code passing tests can still look
  wrong; you must see it.
- A real-terminal check when mouse, alt-screen, or keyboard-enhancement behavior changed
  (some of that doesn't reproduce in capture).
