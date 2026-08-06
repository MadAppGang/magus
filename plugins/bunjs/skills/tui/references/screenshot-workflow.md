# Screenshot Workflow — see your TUI in colour

> **Surface: neutral.** This file describes process, tooling or measurement. Snippets are
> shell, JSON or config — no OpenTUI rendering code in either dialect.

You cannot judge a TUI from source, and a plain-text `capture-pane` strips the colour that
*is the point*. This turns a **live, running OpenTUI app into a colour-accurate PNG** you can
`Read` and critique, closing the build → look → fix loop. Verified end-to-end this session.

**Prerequisites:** `aha` (`brew install aha`, or `sudo apt-get install aha`), a
**Chromium-family browser** (Chrome/Chromium/Brave/Edge) for the headless render, plus `tmux`
and `bun`. `scripts/ansi-to-png.ts` finds `aha` and the browser cross-platform, renders at 2×
scale, and is a byte-identical copy of `go-tui`'s — never edit it locally. `${CLAUDE_PLUGIN_ROOT}`
is **unset inside a Bash tool call** (MEASURED), so paste the absolute dir this skill was read from over the placeholder below.

## The pipeline

App in a tmux pane → `capture-pane -p -e` (`-e` KEEPS the colour escapes) → `.ansi` file carrying SGR
escapes → `scripts/ansi-to-png.ts` (aha → headless Chromium) → PNG → `Read` it → judge colour, density,
alignment. The rendering half is bundled; the **capture** half is session-specific — the two routes below.

## Route A — a plain local tmux socket (how this was verified; no MCP needed)

All Bash, on a private socket, so it never touches your interactive tmux. **`-f /dev/null` belongs on every
invocation, not just `new-session`:** a `~/.tmux.conf` that auto-creates sessions otherwise spawns your whole
workspace (18 sessions on the machine this was written on), and a client whose server has already exited
starts a fresh one that does read that file.

```bash
OUT=$(mktemp -d); SOCK=otui-$$; SESS=tui-$$   # never fixed names: a parallel run collides, and a reused scratch dir hands back a stale PNG that looks fresh
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/tui}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_WAS_READ_FROM}"
shot() {                                   # $1 cols × $2 rows → a $3-pixel PNG. Non-zero if the capture is worthless.
  local A="$OUT/${1}x${2}.ansi"
  tmux -f /dev/null -L "$SOCK" new-session -d -s "$SESS" -x "$1" -y "$2" "bun run src/index.tsx" || return 1
  # Poll for a COLOURED frame instead of `sleep 2` — that covers both "hasn't drawn yet" and a recreate racing
  # the session just killed (one measured blank capture). Bounded at 10s, so it can fail but never spin.
  for _ in $(seq 40); do sleep 0.25; tmux -f /dev/null -L "$SOCK" capture-pane -p -e -t "$SESS" >"$A" 2>/dev/null && grep -q $'\x1b' "$A" && break; done
  tmux -f /dev/null -L "$SOCK" kill-session -t "$SESS" 2>/dev/null
  grep -q $'\x1b' "$A" || { echo "NO ESC BYTES in $A — no -e, or it never drew"; return 1; }   # THE GATE: non-zero, so the chain below STOPS
  bun run "$SKILL/scripts/ansi-to-png.ts" "$A" "$OUT/${1}x${2}.png" "$3"
}
shot 80 24 720x480 && shot 145 45 1300x900 && ls -l "$OUT"/*.png   # narrow AND wide in one command, so neither can be skipped
```

## Route B — the terminal MCP's headless server

If a headless pane already exists (`mcp__tmux__create-headless` → `mcp__tmux__start-and-watch`
with a `pattern` that only appears once the first frame is drawn), capture it from Bash on
**its** socket, `mcp-headless`:

```bash
OUT=$(mktemp -d); tmux -f /dev/null -L mcp-headless capture-pane -p -e -t %0 > "$OUT/mcp.ansi"   # -f /dev/null even
# here: if that server has exited, a bare client starts a replacement that reads your ~/.tmux.conf and auto-creates its sessions
```

> **0-byte trap.** The MCP hands you a pane id like `headless:%0`. The `headless:` prefix is
> **MCP routing sugar, not part of the tmux name** — `-t headless:%0` from Bash gives
> `can't find session: headless` and writes an **empty file**. Target the bare `%0`. Confirm
> what is actually there:
> `tmux -f /dev/null -L mcp-headless list-panes -a -F "#{session_name}:#{pane_id} #{pane_current_command}"`

`mcp__tmux__capture-pane({ paneId: "headless:%0", colors: true })` also returns ANSI with
escapes intact, but you then have to land those ESC bytes in a file unmangled — prefer Bash.

## `-e` is mandatory — the measured negative control

Without `-e` you get plain text and lose every colour, which defeats the whole exercise. No
`ESC` bytes means the capture failed — do not render it, and draw no conclusions. Two checks,
and **they answer different questions**:

```bash
# 1. THE GATE — did any colour survive at all? Zero/non-zero only, never a count, and it must END the run:
grep -q $'\x1b' "$A" || { echo "NO ESC BYTES — you forgot -e"; exit 1; }   # `return 1` inside shot(). A bare
# `|| echo` is NOT a gate: echo exits 0, so the render runs anyway on a capture you were just told is worthless.

# 2. THE COUNT — how much colour, and how varied. -o counts occurrences, not lines.
grep -o '[34]8;2;[0-9]*;[0-9]*;[0-9]*' "$A" | wc -l             # total truecolor SGRs
grep -o '[34]8;2;[0-9]*;[0-9]*;[0-9]*' "$A" | sort -u | wc -l   # distinct colours
```

**Do not use `grep -c` to count escapes.** It counts *lines containing* ESC, so on an 80×24
pane it can never exceed 24 no matter how colourful the frame is — a gate wearing a count's
clothing. MEASURED 2026-07-30, one 80×24 dashboard pane captured twice: **with `-e`**, `grep -c`
printed **24** while the file actually held **213 ESC bytes and 191 truecolor sequences across
39 distinct colours** (23 foreground, 16 background); **without `-e`, 0 escape bytes.**

## Read the PNG and judge

`Read` both PNGs the `ls` printed (`$OUT/80x24.png`, `$OUT/145x45.png`) — now you can actually
*see* it. Check, in order, then iterate: fix, re-run, re-capture, re-Read.

- **Colour is semantic** — one hue means one thing; error red, info blue; gradient meters ramp
  green→red; badges legible as dark ink on a bright background.
- **Alignment** — columns line up, no text bleeds past a border, wide and braille glyphs did
  not shift the grid.
- **Density** — meters, sparklines and badges where bare numbers would be dull, not prose.
- **No black gaps** — no unpainted holes inside a coloured panel. `flexGrow` only *grants* rows; the
  panel that eats the leftover must be a `<scrollbox>` stocked deeper than the viewport it can occupy
  (the rule, with the measurement, is in SKILL.md → "Filling the terminal").

## Two sizes, and how to size the PNG

Capture **one narrow (80×24) and one wide** — `shot 80 24 … && shot 145 45 …`, never the narrow
one alone. Responsive breakage — truncated panels, wrapped headers, meters that overflow — only
shows at the edges. `ansi-to-png.ts` takes an optional `WIDTHxHEIGHT` in CSS pixels; a monospace
cell is roughly 9×20 px, so 80×24 ≈ `720x480` and a 145×45 dashboard ≈ `1300x900`. **Oversize is
harmless** — the extra area renders transparent.

## Notes & gotchas

- **Alt-screen apps capture correctly.** OpenTUI apps take the alternate screen by default
  (the `screenMode` chooser is in `app-architecture.md`); `capture-pane` reads the visible
  alt-screen buffer, so a full-screen app comes out intact.
- **Braille (`⣿`) and block (`█▓▒░`) glyphs render** because Chromium has Unicode font
  fallback — the reason this HTML route beats naive terminal screenshotters.
- **Never `kill-server`, and never drop `-L`/`-f /dev/null`.** Either reaches your interactive tmux;
  `kill-session -t "$SESS"` on the private socket is the only teardown this loop ever needs.
- **No tmux at all?** Two fallbacks: run the app in your own terminal and look at it; or
  capture with `script -q "$OUT/tui.ansi" <cmd>` and feed that file to `ansi-to-png.ts`. The
  look-at-it loop is non-negotiable; the *instrument* is not.
