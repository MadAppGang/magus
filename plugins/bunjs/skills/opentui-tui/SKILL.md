---
name: opentui-tui
description: Build, review, or debug OpenTUI terminal UIs — React JSX or core constructs, Yoga flexbox, gradient meters, colour screenshots. Any Bun/TypeScript TUI. Only Bun is tested; Node/Deno at own risk.
disable-model-invocation: true
---

# OpenTUI TUI

Build Bun/TypeScript terminal UIs that look like **btop, gonzo, posting and lazygit** — colourful, dense,
graph-and-badge-heavy — not like `cat` output. OpenTUI hands you a real layout engine (Yoga flexbox) and a React
renderer, and **no** meter, chart, badge or colour maths, so under-baked is the *default* outcome — which the contract
below and the shipped `assets/` prevent. You cannot judge a look from source: **build → screenshot in colour → look → fix**.

## The aesthetic this skill is for

The bar is **more colour, more graphs, less text**; the failure mode is not ugliness but *under-baking* — printing
`CPU 78%` where the row could carry a meter, a percentage and a sparkline. Reach for the rich form mechanically.

| You have… | Default to… | Not… |
|---|---|---|
| a bounded value (%, ratio, 0–100) | a **gradient meter** — one colour per cell across the fill | a bare number, or a flat one-colour bar |
| a time series / recent history | a **sparkline** (`▁▂▃▄▅▆▇█`) | the latest number alone |
| a category distribution | a **bar chart** or stacked bar, coloured per category | a list of `name: count` lines |
| counts over time × category | a **heat row** per category, brightness = magnitude | a table of numbers |
| a discrete status / level / method | a **badge** — dark ink on a saturated fill | plain coloured text alone |
| genuine free narrative (logs, detail) | text — **and only inside a log or detail panel** | text as the main surface |

Three rules keep it from tipping into noise. **Colour is semantic, never decorative** — one colour means one thing
app-wide; red as "error" here and "selected" there kills glanceability. **Make gradients smooth** — one blended colour
per column at the widget's real width, never four `░▒▓█` glyphs sharing one. **Dim the chrome, saturate the signal.**

**Negative control: if your first screenshot shows a single-colour bar or bare numbers, you failed** — as is a non-log
panel over about half prose or numerals. Then run that count a **second time over the WHOLE frame, not per panel**
(graphics body rows vs text rows across the capture): every panel can pass the table while the screen still reads as
prose — one build's first wide capture was 28 of 38 rows text, every panel compliant. Under half, add a graphics panel.

## What OpenTUI does not ship — and how to get it

No meter, gauge, progress bar, sparkline, chart, heatmap or badge exists in the library, nor the colour maths they need —
no `lerp`/`mix`/`blend`/`gradient`/`darken`/`rgbToHsv` anywhere in `packages/core/src`, **no string-width helper at
all**, and `setCellWithAlphaBlending` is *compositing*, not interpolation. That layer ships here as tested code. **Copy
it in; never retype it** — the 0.80 heat floor, 24 ramp steps and `>128` ink threshold degrade silently.

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/opentui-tui}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste. `:?` would ABORT the block and copy nothing
bun init -y                              # FROM EMPTY this is step 1: package.json, tsconfig, typescript + @types/bun — `tsc` and `"types": ["bun"]` below need both. Creates NO src/
bun add @opentui/core @opentui/react react && bun add -d @types/react   # the shims import from core
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/theme" src/theme && cp -r "$SKILL/assets/runtime" src/runtime  # `cp -r` needs src/; copy BOTH — theme = tokens/color/text/widgets + 2 tests, runtime = shutdown + test + env.d.ts
else echo "SKILL is still the placeholder — paste the real dir above, re-run these 2 lines; the install already ran"; fi
```

Three test files ship — two under `theme/`, `shutdown.test.ts` under `runtime/` — so copying only `theme/` leaves the
teardown suite behind; `color.ts` imports `./tokens`, `widgets.tsx` imports both, the tests all four, and `opentui-env.d.ts`
must fall inside your `tsconfig.json` `include`. **Leave the relative imports as they are** — in `src/theme/` they
resolve untouched (MEASURED in a bare `bun init`: `diff -qr` identical, `tsc` clean, 63/63 pass); `@/theme/…` is 9×TS2307.

## Two API surfaces — never blend them

> **INVARIANT.** Never mix the core **construct DSL** (`Text({…})`, `Box({…}, child)`, `new XRenderable(ctx, opts)`)
> with **React intrinsic rendering** (`<text>`, `<box>`, `<span>`) in the same snippet, file or fenced block — such
> code compiles under neither. **Importing from `@opentui/core` is not a violation.** Calling its DSL beside JSX is.

**React JSX is the canonical surface**: lowercase intrinsics, flat props, children as children — **zero** capitalised
renderables across three shipping apps. Capitalised in JSX means *your own* component; multi-word intrinsics are
**kebab-case** (`<tab-select>`, `<ascii-font>`, `<line-number>`), `scrollbox` is one word, and Solid's underscore
spellings **do not compile in React.** An invented kebab tag typechecks clean against a string index signature, so the
compiler cannot catch a surface error — run the linter (**Acceptance**).

## Bootstrap: zero to first frame

`bun create tui --template react` scaffolds this; by hand it is two files, meeting in `src/index.tsx` as function calls,
never constructs. Call `process.exit()` nowhere else — a crash that skipped `destroy()` leaves the terminal in raw mode
inside the alternate screen, recovered with `reset` or `stty sane`.

```tsx
import { createCliRenderer } from "@opentui/core"; import { createRoot } from "@opentui/react"
import { installShutdown } from "./runtime/shutdown"; import { App } from "./App"   // never `OWNED_SIGNALS`
const renderer = await createCliRenderer({
  screenMode: "alternate-screen", // full-screen app; "main-screen" stays in the scrollback
  exitSignals: [],                // BOTH, so the renderer registers NOTHING and installShutdown is the sole owner.
  exitOnCtrlC: false,             // MEASURED under a real SIGTERM — `[]`: disposer→unmount→destroy, ONE destroy;
})                                // `["SIGTERM"]`: destroy→disposer→unmount→destroy, TWO, the tree torn down last
const root = createRoot(renderer); const shutdown = installShutdown(renderer, root) // disposers → unmount → destroy → stderr → 50ms flush → exit(128+signum); 0 only on a clean quit
// Ctrl+C IS NOT A SIGNAL HERE: raw mode clears ISIG, so the tty hands you 0x03 and SIGINT is never raised. Deleting
renderer.keyInput.on("keypress", (k) => { if (k.ctrl && k.name === "c") void shutdown() })   // this makes Ctrl+C INERT, not redundant
root.render(<App onQuit={shutdown} />)   // installShutdown's own SIGINT handler still catches `kill -INT` from outside the tty
```

```jsonc
// tsconfig.json — complete and copy-pasteable, the keys the tested skill root uses. BOTH jsx keys or nothing renders;
// "target"+"module" are REQUIRED beside moduleResolution "bundler" (omit either → TS5095, not a UI); no "DOM" in lib
// (span/b/i/u/a collide with HTML tags); skipLibCheck else 16x bun:ffi TS2307.
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@opentui/react", "target": "ESNext",
    "module": "ESNext", "moduleResolution": "bundler", "lib": ["ESNext"], "types": ["bun"],
    "strict": true, "noEmit": true, "skipLibCheck": true }, "include": ["src/**/*"] }
```

## Filling the terminal: header / body / footer

The React root does **not** inherit the terminal's height — omit `height` and the tree collapses to content, floating
the footer. Pin it from `useTerminalDimensions()`; one region claims the leftover with `flexGrow={1} minHeight={0}`:

```tsx
const { width, height } = useTerminalDimensions(); return (
  <box flexDirection="column" height={height}>              {/* root: pin height; nothing else grows */}
    <box height={1} paddingLeft={1}><text>{`svcmon  ${width}x${height}`}</text></box>
    <box flexDirection="row" flexGrow={1} minHeight={0}>    {/* body: every row the chrome left over */}
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        <Panel title="Load" flexShrink={0}>{/* content-sized: flexShrink={0} or the grower below starves it */}</Panel>
        <Panel title="Errors/min" flexGrow={1} flexBasis={0} minHeight={0}>{/* eats the leftover; scrollbox inside */}</Panel>
      </box>
      <box width={22}><Panel title="Services" flexShrink={0}>{/* fixed-width side column */}</Panel></box>
    </box>
    <box height={1} paddingLeft={1}><text>q quit · tab focus</text></box>
  </box>
)
```

**Sizing is a call-site concern, chrome is not.** `<Panel>` accepts every layout prop a parent legitimately owns
(`PanelLayout`: growth, size, `min`/`max`, `alignSelf`, `margin*`) and nothing that changes appearance — a shipped test
asserts a call site cannot override `borderStyle` or the colours. MEASURED at 80×24: `flexGrow={1} minHeight={0}` paints
18 rows and the footer holds row 24 — **but only while the grower's own child is content-sized.**

**A grower holding a `<scrollbox>` starves its SIBLINGS**, because a scrollbox's intrinsic height is its entire content:
the panel asks for 40 rows of a 22-row body, and Yoga's default `flexShrink: 1` spreads that shortfall across *every*
sibling. MEASURED on this snippet at 80×24, 40 lines in `Errors/min`: `Load` collapsed from five rows to one, its five
`<text>` children overprinting into `iot` — which reads as a broken widget, not a layout mistake. Cure it with props
`PanelLayout` already exposes: **`flexShrink={0}` on every content-sized panel, `flexBasis={0}` on the grower** (either
alone fixed the measured case; write both). This is `react-patterns.md`'s height starvation one level up — the same
last-wins collapse, inflicted by a sibling rather than by the box's own `height`.

**The leftover-eating panel must be a `<scrollbox>` stocked deeper than the tallest viewport it will ever occupy.**
`flexGrow={1}` grants rows, it does not fill them — a grower holding five rows paints five and leaves the rest black, the
unpainted hole a screenshot fails you for. MEASURED: 30 rows filled that side panel at 80×24 and still left a gap at
145×45, so stock for the WIDE capture — which is also what keeps the screen-wide density count passing at 40 rows.

## Core workflow

1. **New project → the bootstrap above; existing project → follow its pin** — read the installed `.d.ts`, not the docs
   site (which names no version), and do not migrate 0.1.x ↔ 0.4.x unless asked.
2. **Choose one surface and stay on it**: React unless the app has none (`core-api.md` owns the imperative surface).
3. **Flexbox for boxes, arithmetic for widget widths.** Yoga accounts for border and padding, so *heights*, panel
   placement and growth need no size budget — `gap`, `minWidth`, `flexWrap`, `flexGrow`, `flexBasis` all work
   (undocumented). But the data widgets take a **numeric `width`** that cannot `flexGrow`, so a full-width visual IS a
   column budget: **`Panel` costs 4 columns of chrome, a `<scrollbox>` inside it 1 more** (both MEASURED; the probe and
   the resample rule: `react-patterns.md`). Narrower than the Bubble Tea reflex, not a return to it — heights are
   flexbox, widths of data widgets are arithmetic.
4. **Build each visual as one row of styled text**, imported rather than retyped with hex literals: `Meter`,
   `Sparkline`, `HeatRow`, `StackedBar`, `Panel`, `Badge` and `BadgeSpan` (the span form, for a badge sharing a
   `<text>`) all ship in `assets/theme/widgets.tsx`. Never reimplement them; 2D only → `components-and-charts.md`.
5. **Screenshot in colour and look** (below), then **test behaviour and appearance** with `testRender`:
   `captureCharFrame()` for text, `captureSpans()` for colour — no args, and `renderOnce()` first or every cell is filler.

## Shipping it: pick your pin by artifact

**Run from source, or a plain npm package → 0.4.x**, what the docs describe and `bun create tui` installs. **A standalone
`bun build --compile` binary → 0.1.107, and no `--external`** — it leaves the binary unable to resolve the module. The
costliest mistake is `bun add @opentui/core@latest` then `--compile`, so **re-test 0.4.x `--compile` before accepting
that downgrade**: MEASURED 2026-07-30, 0.4.5 compiles fine and the *binary* exits 1 resolving its native library inside
`/$bunfs/root/` — upstream bug, not design, and 0.1.x is abandoned. Nothing cross-compiles. **Only Bun is tested**;
Node/Deno, the matrix and the `--external` trap: `versions-and-builds.md`.

## Seeing your UI: the screenshot loop

A plain text capture strips the colour that *is* the point; this turns a **running app into a colour-accurate PNG** you
can `Read`. **Prerequisites: `aha` (`brew install aha` / `apt-get install aha`), a Chromium-family browser and tmux.**

```bash
OUT=$(mktemp -d); SOCK=otui-$$; SESS=tui-$$   # unique per run: a fixed dir, socket or session collides with a parallel capture
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/opentui-tui}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"   # as above
shot() { local A="$OUT/${1}x${2}.ansi"   # ${1}x${2} cells → a $3-pixel PNG. `-f /dev/null` on EVERY invocation, never just
  tmux -f /dev/null -L "$SOCK" new-session -d -s "$SESS" -x "$1" -y "$2" "bun run src/index.tsx"   # new-session: a .tmux.conf
  for _ in $(seq 40); do sleep 0.25; tmux -f /dev/null -L "$SOCK" capture-pane -p -e -t "$SESS" >"$A" 2>/dev/null && grep -q $'\x1b' "$A" && break; done   # that auto-creates sessions spawns ALL of them,
  tmux -f /dev/null -L "$SOCK" kill-session -t "$SESS" 2>/dev/null   # and a client whose server died starts one that reads it. Poll for a COLOURED frame — a fixed sleep races the recreate
  grep -q $'\x1b' "$A" || { echo "NO ESC BYTES in $A — no -e, or it never drew. STOP: render nothing, conclude nothing"; return 1; }   # a gate EXITS; an echo does not
  bun run "$SKILL/scripts/ansi-to-png.ts" "$A" "$OUT/${1}x${2}.png" "$3"   # colour census (`grep -o … | sort -u`): screenshot-workflow.md
}
shot 80 24 720x480 && shot 145 45 1300x900 && ls -l "$OUT"/*.png   # BOTH sizes in one command — the wide one is not optional
```

`Read` both PNGs `ls` just printed and judge semantic colour, alignment, density and black gaps; then fix and re-capture at
**both** sizes — responsive breakage only shows at the edges, and a heat row of coloured *spaces* is invisible to a char frame.

**`-e` is mandatory** — no `ESC` bytes means the capture failed, so draw no conclusions; gate with `grep -q`, never
`grep -c`. Both routes in full, that gate's measured control, and the MCP `headless:%0` empty-file trap: `screenshot-workflow.md`.

## Best practices

- **One `<text>` per row, or `<span>`s inside ONE `<text>`** — sibling `<text>`s in a box paint over each other at (0,0), five sightings across three apps (`react-patterns.md`).
- **Pin `height` only on rows that overprint, in `main-screen` mode**; fixed heights everywhere clip content and defeat `flexGrow`. Use `key={phase}` when the tree changes *shape* — in-place reconciliation tears the panel.
- **Poll a mutable store on an interval** instead of `setState` per event once a producer outpaces the frame rate, and hoist ramps and parsed colours out of render and out of per-cell loops (`app-architecture.md`). **Theme by plain module import** — zero `ThemeProvider`/`useTheme` hits across three apps, one theme per process.
- **Acceptance:** `bun test`, `bunx tsc --noEmit` (the local `typescript` `bun init` installs), `bun run "$SKILL/scripts/check-surface.ts" .`, **plus a colour screenshot** for any visual change. Both scripts need that absolute prefix — the skill lives in a read-only plugin cache, never your cwd — and `${CLAUDE_PLUGIN_ROOT}` is **unset inside a Bash tool call** (MEASURED `CLAUDE_PLUGIN_ROOT=[<UNSET>]`), so paste that directory over the placeholder the blocks above carry. Never `${VAR:?…}` in a recipe: it aborts, it does not warn.

## When to read what

- `references/aesthetics-and-color.md` — the visual core: palette hexes, six rules, smooth ramp vs buckets, every pattern, anti-patterns, what to steal.
- `references/react-patterns.md` — the 20 intrinsics, flat props, **Yoga layout**, the overprint rule, hooks per version, focus, breakpoints, refs.
- `references/app-architecture.md` — app shape, async I/O and stores, `screenMode`, multi-screen structure, re-render cost, the shutdown contract.
- `references/core-api.md` — `createCliRenderer` options, what `destroy()` frees, renderables vs constructs, the one core↔React translation table.
- `references/components-and-charts.md` — what exists, what has no built-in, then genuine 2D: the `extend()` mount recipe, `setCell`, braille packing.
- `references/versions-and-builds.md` — the measured matrix, the `--external` trap, the native library and cross-compiling, the re-pin checklist.
- `references/testing.md` — the two harnesses, `captureCharFrame` vs `captureSpans`, asserting a gradient really is one, mock input and time.
- `references/screenshot-workflow.md` — both capture routes in full, the 0-byte trap, the no-tmux fallbacks, how to size the PNG.
- `assets/theme/` + `assets/runtime/` — the shipped code: colour and cell-width shims, six widgets, `installShutdown`, the React 19 type shim, all tested. `package.json` + `tsconfig.json` at the skill root are its package boundary; `bun install && bun test && bun run typecheck` run there. `scripts/ansi-to-png.ts` is ANSI→PNG, a byte-identical copy of `go-tui`'s (a pre-commit `diff -q` keeps it so), and `scripts/check-surface.ts` is the surface linter.
- **Upstream:** docs https://opentui.com · source and upstream agent skill https://github.com/anomalyco/opentui · community skill https://github.com/msmps/opentui-skill — both cited, neither depended on. The aesthetic bar, worth studying directly: btop, gonzo, posting, lazygit.
