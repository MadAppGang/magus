# Screenshot Workflow — see your TUI in color

You cannot judge a TUI from source, and a plain text `capture-pane` strips the color that
*is the point*. This workflow turns a **live, running TUI into a color-accurate PNG** that
you can `Read` and visually critique — closing the build → look → fix loop. The render half
was verified end-to-end against a live `btop`; the private-socket capture below is the
recipe the `bunjs` `tui` skill measured, with only the launch command changed.

## The pipeline

```
running TUI in a tmux pane
   │  tmux capture-pane -p -e   (-e KEEPS the color escapes)
   ▼
ANSI text file (.ansi, with SGR escapes)
   │  scripts/ansi-to-png.ts   (aha → Chromium, offscreen)
   ▼
PNG  →  Read it  →  judge colors/density/alignment
```

The rendering half is bundled and verified: `scripts/ansi-to-png.ts` (Bun + TypeScript).
It detects `aha` and a Chromium-family browser cross-platform and renders at 2× scale.
The **capture** half is session-specific — that's the part below, in two routes.

## Route A — a private local tmux socket (recommended; Bash only, no MCP needed)

All Bash, on a per-run socket, so it never touches your interactive tmux and you control
the pane size. **`-f /dev/null` belongs on every invocation, not just `new-session`:** a
`~/.tmux.conf` that auto-creates sessions otherwise spawns your whole workspace, and a
client whose server has already exited starts a fresh one that does read that file.

```bash
OUT=$(mktemp -d); SOCK=gotui-$$; SESS=tui-$$   # never fixed names: a parallel run collides, and a reused dir hands back a stale PNG
shot() {                                    # ${1} cols × ${2} rows → a ${3}-pixel PNG. Non-zero if the capture is worthless.
  local A="$OUT/${1}x${2}.ansi"
  tmux -f /dev/null -L "$SOCK" new-session -d -s "$SESS" -x "${1}" -y "${2}" "go run ." || return 1
  # Poll for a COLOURED frame instead of a fixed sleep — covers "hasn't drawn yet" and a recreate racing
  # the window just killed. Bounded at 10s, so it can fail but never spin.
  for _ in $(seq 40); do sleep 0.25; tmux -f /dev/null -L "$SOCK" capture-pane -p -e -t "$SESS" >"$A" 2>/dev/null && grep -q $'\x1b' "$A" && break; done
  tmux -f /dev/null -L "$SOCK" kill-window -t "$SESS" 2>/dev/null   # its only window, so the session and the private server end with it
  grep -q $'\x1b' "$A" || { echo "NO ESC BYTES in $A — no -e, or it never drew"; return 1; }   # THE GATE: non-zero, so the chain below STOPS
  bun run /path/to/go-tui/scripts/ansi-to-png.ts "$A" "$OUT/${1}x${2}.png" "${3}"
}
shot 80 24 720x480 && shot 145 45 1300x900 && ls -l "$OUT"/*.png   # narrow AND wide in one command, so neither can be skipped
```

Pick the launch command that renders your app (`go run .` or the built binary). Give it a
beat: the poll returns as soon as a frame carries color.

## Route B — the terminal MCP's isolated slot

The terminal MCP runs apps in a numbered helper slot; `isolated: true` puts it where nobody
can see it. Build, then launch and wait for the first frame in one call:

```
mcp__plugin_terminal_mux__start-and-watch({
  slot: 2,
  isolated: true,
  command: "./mytui",          // or: go run .
  pattern: "<text that proves it rendered>",  // a panel title, a header, a prompt
  timeout: 15,
})
  → { slot: 2, created: true, event: "pattern:<…>", …, paneState: { isAlive: true, … } }
```

Pick a `pattern` that only appears once the first frame is drawn (a panel title, a status
bar label). Then either:

- `mcp__plugin_terminal_mux__screenshot-pane({ slot: 2 })` — returns a viewable PNG
  directly, rendered with full ANSI color. The nicer instrument when you only have MCP
  access: nothing to write to disk.
- `mcp__plugin_terminal_mux__capture-pane({ slot: 2, colors: true })` — returns the ANSI
  text with escapes preserved. To turn it into a PNG you must land those bytes in a file
  with their ESC bytes intact, then run `ansi-to-png.ts` on it; Route A avoids that
  round-trip.

When done: `mcp__plugin_terminal_mux__close-pane({ slot: 2 })`.

> **Route B sets no geometry.** The slot tools take no size, so an isolated pane comes up
> at the server's default. For the two mandated sizes (80×24 and a wide one) use Route A,
> where `-x`/`-y` are yours.

## Step 3 — Read the PNG and judge

```
Read("$OUT/80x24.png")
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

## Sizing the window

`ansi-to-png.ts` takes an optional `WIDTHxHEIGHT` in CSS pixels. Rough rule: a default
monospace cell is ~9×20px, so an 80×24 pane ≈ `720x480`. Oversize is harmless — the extra
area renders as a black band, not as part of your layout. For a wide dashboard (e.g.
145×51 like gonzo), try `1300x1040`.

## Two screenshots that matter

Always capture **one narrow (80×24)** and **one wide** size. Responsive breakage —
truncated panels, wrapped headers, meters that overflow — only shows at the edges. Set the
pane size when creating it (`-x`/`-y` in Route A), or resize and re-capture.

## Notes & gotchas

- **`-e` is mandatory.** Without it you get plain text and lose all color — defeats the
  purpose. Gate on `grep -q $'\x1b'`: no `ESC` byte means the capture failed, so render
  nothing and conclude nothing.
- **Alt-screen apps** (most full-screen TUIs, btop, lazygit) capture fine via Route A; the
  capture reads the visible alt-screen buffer.
- **Braille (`⣿`) and block (`█▓▒░`) glyphs** render correctly because Chromium has Unicode
  font fallback — a reason this HTML route beats naive terminal screenshotters that miss
  those glyphs.
- **Never run `kill-server`, and never drop `-L`/`-f /dev/null`.** Either reaches your
  interactive tmux; `kill-window -t "$SESS"` on the private socket is the only teardown
  this loop ever needs, and the terminal plugin's Bash hook blocks `kill-server` anyway.
- `aha` install: `brew install aha` / `apt-get install aha`. A Chromium-family browser
  (Chrome/Chromium/Brave/Edge) must be present for the offscreen render.
