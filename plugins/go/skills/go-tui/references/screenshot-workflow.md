# Screenshot Workflow — see your TUI in color

You cannot judge a TUI from source, and a plain text `capture-pane` strips the color that
*is the point*. This workflow turns a **live, running TUI into a color-accurate PNG** that
you can `Read` and visually critique — closing the build → look → fix loop. Every step
below was verified end-to-end against a live `btop` in a headless tmux pane.

## The pipeline

```
running TUI in tmux pane
   │  tmux capture-pane -p -e   (-e KEEPS the color escapes)
   ▼
ANSI text file (.ansi, with SGR escapes)
   │  scripts/ansi-to-png.ts   (aha → headless Chrome)
   ▼
PNG  →  Read it  →  judge colors/density/alignment
```

The rendering half is bundled and verified: `scripts/ansi-to-png.ts` (Bun + TypeScript).
It detects `aha` and a Chromium-family browser cross-platform and renders at 2× scale.
The **capture** half is session-specific — that's the part below.

## Step 1 — run the TUI in a headless tmux pane (terminal MCP)

The terminal MCP runs apps in an isolated, invisible tmux server. Build, then launch:

```
mcp__tmux__create-headless({ name: "tuidev" })
  → { paneId: "headless:%0", sessionName: "tuidev" }

mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "./mytui",          // or: go run .
  pattern: "<text that proves it rendered>",  // a panel title, a header, a prompt
  timeout: 15,
})
```

Pick a `pattern` that only appears once the first frame is drawn (a panel title, a status
bar label). Give it a beat to settle before capturing.

## Step 2 — capture WITH colors

Two routes. The Bash route is the most reliable because it's one atomic command on the
correct tmux socket.

### Route A — Bash on the headless socket (recommended)

The terminal MCP's headless server uses socket **`mcp-headless`**. Critically, the
`headless:` in `headless:%0` is **MCP routing sugar, not the tmux name** — from Bash you
target the bare pane id (`%0`) or the real session name on that socket:

```bash
# -p print to stdout, -e KEEP color escapes. Target the bare pane id %0.
tmux -L mcp-headless capture-pane -p -e -t %0 > /tmp/tui.ansi

# verify you actually got color (non-empty, contains ESC):
wc -c /tmp/tui.ansi          # should be thousands of bytes, not 0
```

> **0-byte trap.** If you write `-t headless:%0` you get `can't find session: headless`
> and an empty file — `headless:` is not part of the real name. Confirm the pane:
> `tmux -L mcp-headless list-panes -a -F "#{session_name}:#{pane_id} #{pane_current_command}"`
> and target by the `%N` shown there.

Then render:

```bash
bun run /path/to/go-tui/scripts/ansi-to-png.ts /tmp/tui.ansi /tmp/tui.png 900x600
```

### Route B — capture through the MCP tool

`mcp__tmux__capture-pane({ paneId: "headless:%0", colors: true })` returns the ANSI text
(escapes preserved) directly in the tool result. Useful when you only have MCP access. To
turn it into a PNG you must get those bytes into a file with their ESC bytes intact — the
Bash route avoids that round-trip, so prefer Route A when you can run Bash.

## Step 3 — Read the PNG and judge

```
Read("/tmp/tui.png")
```

Now you can actually *see* it. Check, in order:
- **Color is semantic and correct** — error red, info blue, the gradient bar goes
  green→red, badges legible (dark ink on bright bg).
- **Alignment** — columns line up; no panel text bleeds past its border; wide/braille
  glyphs didn't shift the grid.
- **Density** — bars/sparklines/heatmaps present where numbers would be dull; not a wall
  of plain text.
- **Empty space** — no black holes in colored panels (the background-fill artifact; fix
  per `lipgloss-styling.md`).

Iterate: fix the code, rebuild, re-capture, re-Read.

## Step 4 — clean up

```
mcp__tmux__kill-session({ sessionId: "headless:$0" })   // note: $0 form for kill
```

## Sizing the window

`ansi-to-png.ts` takes an optional `WIDTHxHEIGHT` in CSS pixels. Rough rule: a default
monospace cell is ~9×20px, so an 80×24 pane ≈ `720x480`. Oversize is harmless — the extra
area renders transparent. For a wide dashboard (e.g. 145×51 like gonzo), try `1300x1040`.

## Two screenshots that matter

Always capture **one narrow (80×24)** and **one wide** size. Responsive breakage —
truncated panels, wrapped headers, meters that overflow — only shows at the edges. Set the
pane size when creating it, or resize and re-capture.

## Notes & gotchas

- **`-e` is mandatory.** Without it you get plain text and lose all color — defeats the
  purpose.
- **Alt-screen apps** (most full-screen TUIs, btop, lazygit) capture fine via Route A; the
  capture reads the visible alt-screen buffer.
- **Braille (`⣿`) and block (`█▓▒░`) glyphs** render correctly because Chrome has Unicode
  font fallback — a reason this HTML route beats naive terminal screenshotters that miss
  those glyphs.
- **Local Bash sessions** (not the MCP headless server) live on the default socket — just
  use `tmux capture-pane -p -e -t <pane>` without `-L`.
- `aha` install: `brew install aha` / `apt-get install aha`. A Chromium-family browser
  (Chrome/Chromium/Brave/Edge) must be present for the headless render.
