# Reference Apps — study these, steal these patterns

The fastest way to build a beautiful TUI is to copy what already works. These are the
best-in-class references for colorful, dense, graph-heavy terminal UIs. For each: what to
look at, and the specific technique worth lifting. When designing, name the reference
you're drawing from ("gonzo-style severity heatmap") so the intent is explicit.

## gonzo — log analysis dashboard (Go, Bubble Tea + ntcharts)

https://github.com/control-theory/gonzo

The closest match to the "colorful dashboard" target, and it's **Go on the exact stack
this skill teaches** (Bubble Tea, Lip Gloss, Bubbles, ntcharts). Study its screenshots.

Steal:
- **Severity-over-time heatmap**: rows = FATAL/ERROR/WARN/INFO/DEBUG/TRACE, columns = time
  buckets, cell shade = volume. Each row colored by its severity. (See `HeatRow` in
  `color-and-aesthetics.md`.)
- **2×2 dashboard grid** (k9s-inspired): log stream, top-patterns, severity distribution,
  per-service counts — each an independent panel.
- **Top-N lists with colored count bars** and a severity-colored header per group.
- **Severity distribution as a single stacked bar** (mostly-blue INFO with red/orange
  slivers) — magnitude at a glance.
- 11+ named themes (Dracula, Nord, Monokai…) selected from a theme struct.

## btop — system monitor (C++) — the density gold standard

https://github.com/aristocratos/btop

Nothing beats btop for packing color and signal into a terminal. Study it live
(`btop` in a headless pane, then screenshot it — see `screenshot-workflow.md`).

Steal:
- **Braille meters** (`⣀⣤⣶⣿`, U+2800–U+28FF) for 2×4-resolution-per-cell time series.
  Block characters (`▁▂▃▄▅▆▇█`) where braille fonts may be missing.
- **Three-point gradient meters** — CPU yellow→orange→red, memory dark-red→bright,
  temperature blue→pink. Color encodes load *in addition to* fill length.
- **Boxed panels with inline titles** in the top border, numbered for quick jumping.
- Right-aligned numeric columns; dim units; tight padding everywhere.

## lazygit — git TUI (Go) — the multi-panel focus model

https://github.com/jesseduffield/lazygit

The reference for keyboard-driven, focus-based navigation across many panels.

Steal:
- **Focus model**: the active panel gets a bright/bold border, others recede to dim gray.
  One accent color marks "where you are." (See `Panel` in `color-and-aesthetics.md`.)
- **Context-driven layout**: panels appear/resize based on the current operation; modals
  pop over the dashboard for confirmations.
- **Consistent keymap across panels** + a generated shortcut footer. Tab/arrow to move
  focus, same keys mean the same thing everywhere.
- Viewport that preserves scroll position on resize.

## posting — HTTP client (Python/Textual) — modern color theming

https://github.com/darrenburns/posting

Not Go, but the cleanest modern color/badge aesthetic to emulate.

Steal:
- **HTTP-method badges**: GET green, POST teal/green, PUT orange, PATCH cyan, DELETE red —
  dark ink on a saturated chip. (Palette in `color-and-aesthetics.md` → `Methods`.)
- **Colored status codes**: 2xx green, 3xx yellow, 4xx red, 5xx dark red.
- **Request/response split layout** with tabbed sub-panels (Headers/Body/Query…).
- Command palette (Ctrl+K) and jump-mode for fast field navigation.
- A coherent dark theme where chrome is muted and content pops.

## rustnet — network monitor (Rust) — dense table + inline trends

https://github.com/domcyrus/rustnet

Rust, but the layout and visual density translate directly.

Steal:
- **Per-row inline sparklines** for bandwidth — a trend in one cell, no separate chart.
- **Staleness color ramp**: white (active) → yellow (timing out) → red (dead). State as a
  smooth color transition, not a discrete flip.
- Tabbed views (Overview / Details / Graph / Help) over a connection-centric table.
- Toggle keys to swap column sets and collapse/expand grouping (density control).

## Claude Code's own TUI — restraint + a strong status line

The CLI you're running in. Study its splash (model/effort/cwd header), its **status line**
(branch · cost · context % · reset countdowns, color-coded), and its restrained palette:
mostly muted, with color reserved for state that matters (permission mode, branch, limits).
A reminder that "colorful" means *meaningful* color, not maximal color — a calm base with
saturated accents on the few things you must not miss.

## How to use this gallery

1. Pick the 1–2 references closest to the app you're building (dashboard → gonzo/btop;
   tool with panels → lazygit; request/response → posting; live table → rustnet).
2. Run it (or open its screenshots), screenshot it with the workflow, and name the
   specific techniques you'll adopt.
3. Implement them with the patterns in `color-and-aesthetics.md` and `layout-patterns.md`.
4. Screenshot your result and compare side by side.
