# OpenTUI core API
> **Surface: `@opentui/core` (imperative).** Every snippet is a construct or class call.
> No JSX appears in this file.

React is the canonical surface for this skill (`react-patterns.md`); core is reached directly at the four bridge sites — bootstrap,
theme math, test harness, custom renderable — and in a non-React app. Importing core is never a violation; calling its construct DSL beside JSX is.

## `createCliRenderer(config)`

Async factory: loads the native Zig library, configures the terminal (mouse, keyboard protocol, screen mode), returns a live `CliRenderer`.

| Option | Default | Why you'd set it |
|---|---|---|
| `exitOnCtrlC` / `exitSignals` | `true` / `SIGINT SIGTERM SIGQUIT SIGABRT SIGHUP SIGBREAK SIGPIPE SIGBUS` | Which events call `destroy()` for you. `exitSignals: []` disables signal-based cleanup entirely. These two interact — see the trap below. |
| `screenMode` / `footerHeight` | `"alternate-screen"` / `12` | Terminal real estate; see the modes below. Both assignable at runtime through the matching `renderer` property. |
| `stdin` / `stdout` / `width` / `height` | process streams; `80x24` | SSH, pty, xterm.js. Size resolves `stdout.columns` → `width` → `80x24`, and `SIGWINCH` is registered only for `process.stdout` — call `renderer.resize(cols, rows)` on external resize. |

**That table is a subset, and upstream says so outright.** `CliRendererConfig` also carries `clock`, `postProcessFns`, `prependInputHandlers`,
`bufferedOutput`, `useThread` and stats options — **named upstream and never described**: no types, no defaults, no semantics (lone exception:
`bufferedOutput: "memory"`, which suppresses the `NativeSpanFeed` made for a custom `stdout`). Read the installed `.d.ts`; never invent behaviour.

**`screenMode` is the one config decision every app makes**, React or core:
- **`"alternate-screen"` (default)** — switches to the terminal's alternate buffer; the original scrollback is preserved and restored on exit. Full-screen apps.
- **`"main-screen"`** — reserves a region on the main screen by scrolling content. Not a scrollback-native inline renderer. Short-lived tools, benchmarks, tests.
- **`"split-footer"`** — pins rendering to a `footerHeight`-row footer; the area above stays free for program output, which `externalOutputMode` replays there rather than overlapping. Still the same buffered renderer.

## `destroy()` — and exactly what leaks without it

> **OpenTUI does not automatically clean up on `process.exit` or unhandled errors.** Deliberate: you may want to survive an error, or own the shutdown order.

The highest-stakes documented behaviour in the library. `destroy()` removes the signal and process listeners OpenTUI added, clears timers and render
loops, destroys every renderable in the tree, restores stdin raw mode, resets terminal state (cursor, alternate screen), flushes pending split-footer
output, and frees native resources. It also **releases `stdin`/`stdout` ownership and restores `stdout.write`** — a stream can be owned by only one
renderer at a time, so a server that skips it blocks the next session from taking that stream at all. Skip it and each of those is a leak: a live SIGINT
listener, a running loop, native memory, an unreclaimable stream, and a terminal stuck in raw mode inside the alternate screen (`reset` or `stty sane`).

Keep teardown in the same control flow as startup — `try { await app(renderer) } finally { renderer.destroy() }` — and with a custom transport, allow one
`queueMicrotask` turn after `destroy()` before closing the socket, so feed-backed shutdown bytes flush. **Do not hand-roll the complete version:**
`assets/runtime/shutdown.ts` exports `installShutdown(renderer, root)`, one idempotent shutdown covering all five exit paths, wired in SKILL.md's
bootstrap. Never `process.exit()` in its place.

**The `exitOnCtrlC` trap.** Setting it `false` does **not** stop Ctrl+C: `SIGINT` stays in `exitSignals`, whose handler calls `destroy()` anyway. Remove it separately:

```ts
const renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: ["SIGTERM", "SIGQUIT", "SIGABRT", "SIGHUP", "SIGBREAK", "SIGPIPE", "SIGBUS"] })
renderer.keyInput.on("keypress", (key) => { if (key.ctrl && key.name === "c") void shutdown() }) // shutdown = installShutdown(...)
```

## Renderables vs constructs

`new BoxRenderable(ctx, opts)` builds a live object immediately, so it needs a `RenderContext` (the renderer is one). `Box(opts, ...children)` is a factory
returning an inert **VNode** — a description that needs no context, instantiated into a real renderable at `add()` time; property writes and method calls
made on a VNode beforehand are **queued and replayed**. **Decision rule: use a construct by default; reach for a renderable class only when you need the
live instance in your hand** — immediate method access, lifecycle control, a custom low-level component. Children are **positional args**, never a prop:

```ts
renderer.root.add(Box({ flexDirection: "row", gap: 1 }, Text({ content: "Name:" }), Input({ placeholder: "Name…" }))) // all from "@opentui/core"
```

## Core → React translation

Read a row across, never down into an editor. **Lowercase is an OpenTUI host intrinsic; Capitalized is your own React component or a core construct/class — never a JSX tag.**

| Core construct or class | React intrinsic (flat props) |
|---|---|
| `Text({ content: "x", fg: tokens.ok })` | `<text fg={tokens.ok}>x</text>` |
| `Box({ flexDirection: "row", gap: 1 }, child)` | `<box flexDirection="row" gap={1}>{child}</box>` |
| `new InputRenderable(ctx, opts)` then `.focus()` | `<input focused={isActive} />`, driven by state |
| `renderer.on("resize", cb)` | `useOnResize(cb)` |
| `renderer.root.add(node)` | `createRoot(renderer)` then `root.render(…)` — bridge B1, see `app-architecture.md` |
| `class X extends FrameBufferRenderable` | `extend({ x: X })`, then the `<x />` intrinsic — bridge B4, see `components-and-charts.md` |

**Not documented — do not fabricate.** No published `CliRendererConfig` interface, no `Renderable` constructor signature, no `RenderableOptions`;
`RenderContext`, `ScreenMode`, `ColorInput` and `VChild` are referenced by name only; `requestRender()`, `getSchedulerState()`, dirty-marking and
`renderer.off` have no documented shape; and which of the 17 renderable classes have construct functions is unstated — 8 shown, docs say "most".
