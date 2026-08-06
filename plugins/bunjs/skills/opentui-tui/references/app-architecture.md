# App architecture
> **Surface: `@opentui/react` (JSX).** Every snippet is React. Lowercase intrinsics only —
> `<text>`, `<box>`, `<span>`. Never `Text({…})`, never `<Box>`.

A good TUI needs two things: a sound architecture and a strong visual look — this file is the first, and
`aesthetics-and-color.md` is the second. The discipline that makes a TUI debuggable is the one React already
pushes you toward — **render is a function of state** — and it holds only if async work never happens in render.

## The shape of an app

```text
src/index.tsx    bootstrap: createCliRenderer → createRoot → render → installShutdown  (bridge B1)
src/App.tsx      screen router; one guarded keyboard handler per screen
src/screens/     one component per screen, each owning its own state
src/store/       imperative stores — async producers write here, React never awaits
src/theme/       tokens, colour math, widgets   ← copied from the skill's assets/theme
src/runtime/     shutdown.ts, opentui-env.d.ts  ← copied from the skill's assets/runtime
```

`src/index.tsx` is **bridge B1**, the one place both packages meet: `createCliRenderer` from core plus
`createRoot` from the React binding — function calls, never constructs (`core-api.md`).

## Async I/O lives outside render

Never `await` in a component body and never start a fetch during render. Two routes, chosen by event rate:

- **Few events, one screen:** `useEffect` + `setState` with an ignore flag on unmount — a form, a one-shot
  request, a file read.
- **Many events, or a stream:** an **imperative store** the producer writes to and React *polls*. This is
  what production does, and the reason is rate rather than taste: an indexer firing hundreds of progress
  callbacks a second causes hundreds of renders, whereas one poll tick renders once regardless of volume.

```tsx
// store.ts is plain TypeScript — no React, no OpenTUI. The producer calls store.update().
export function Progress({ store }: { store: ProgressStore }) {
  const [snap, setSnap] = useState(() => store.getSnapshot())
  useEffect(() => {
    const id = setInterval(() => setSnap(store.getSnapshot()), 100)
    return () => clearInterval(id)
  }, [store])
  return <text fg={tokens.text}>{snap.line}</text>
}
```

Working model: mnemex's `src/output/tui-output.tsx` creates the renderer, mounts one component, and hands its caller
a handle that forwards every update into the store rather than into React (`:101-123`); the 100 ms poll is
`src/tui/components/command/IndexProgress.tsx:186-200`, with the intent stated at `:14-16`.

**Scope the interval deliberately.** 100 ms suits a progress readout; it is wasteful for a form and too
coarse for animation (use `useTimeline`, or `requestLive()`/`dropLive()`). Poll when events outnumber
frames — otherwise `setState` per event is simpler and correct.

## `screenMode`: inline or full screen

| Your app | `screenMode` | Why |
|---|---|---|
| Full-screen dashboard, monitor or editor — panels, tabs, its own viewport | `"alternate-screen"` (default) | Scrollback is preserved and restored on exit. |
| A CLI whose output should stay in the scrollback — installer, indexer, probe, one-shot command | `"main-screen"` | Nothing is swapped away, so the final frame survives `destroy()`. |
| A live footer beneath streaming log output | `"split-footer"` | Rows above the footer stay free for ordinary writes. |

Mode semantics and the full option list belong to `core-api.md`. **Inline (`main-screen`) is not read-only
and not "no animation":** production animates a multi-phase progress bar with a moving gradient through
OpenTUI React in exactly that mode at a 100 ms tick (mnemex `src/output/tui-output.tsx:42-46` with
`IndexProgress.tsx:186-200`; claudish's probe TUI independently does the same). Inline mode *does* demand
a **stable row footprint**:

- Wrap a block whose content varies in a box with an explicit `height`, so the next element's first frame
  cannot bleed up into its last line (claudish `probe-tui-app.tsx:1473-1483`).
- When the tree changes **shape** — a live phase flipping to a results phase — force a remount with
  `key={phase}`. In-place reconciliation tore the panel otherwise (`:1455-1462`).
- Expect focus-based key delivery to be unreliable, and scroll from a ref (`react-patterns.md`).

**All three are inline-mode constraints, not universal advice.** In alternate-screen mode, fixed heights everywhere
clip content and defeat `flexGrow` on a narrow terminal — let flex grow, pin a height only where a row overprints.

## Multi-screen structure

One component per screen, each owning its own state, with the parent holding `activeScreen` and whatever is
genuinely shared.

- **One `useKeyboard` per screen, with a guard** that bails while a modal or child owns the keys — the
  hook broadcasts to every mounted subscriber (`react-patterns.md`).
- **Thread size, do not re-derive it.** Pass a computed content height down, or size children
  `height="100%"`. Three screens each subtracting chrome differently is three ways to be wrong.
- **No `SetSize(w, h)` methods.** That is Bubble Tea's answer to having no layout engine; Yoga is one.
- A screen that must survive being hidden keeps its state in the parent or a store; otherwise unmounting
  is the cheapest reset there is.

## Avoiding whole-tree re-renders

- **Keep state where it is used.** Root state re-renders every screen; screen state re-renders one screen.
- **Precompute at module scope.** `blend1D(24, …)` called per frame allocates a 24-colour ramp for a value
  that never changes. Hoist ramps and parsed colours out of render, and out of per-cell loops.
- **`React.memo` list rows** whose props are primitives — a 200-row list re-rendered on every keystroke is
  the usual cost. Relatedly, a key handler that calls `setState` unconditionally repaints on every key,
  including the ones it ignores; return early.

## The shutdown contract

**OpenTUI does not clean up on `process.exit` or on an unhandled error** — deliberately, so that you own the order.
Skip teardown and you leave a live SIGINT listener, a running render loop, native memory, an unreclaimable stdio
stream, and a terminal in raw mode inside the alternate screen; the next shell prompt looks dead, and recovery is
`reset` or `stty sane`.

**The implementation ships.** `assets/runtime/shutdown.ts` exports `installShutdown(renderer, root)`. Copy
it, wire it into the bootstrap (SKILL.md §5), write `process.exit()` nowhere else. Its contract, in order:

1. **Idempotent** — a module-level guard flag, because SIGINT can arrive *during* teardown.
2. **Remove `SIGINT` from `exitSignals` before cleanup.** `exitOnCtrlC: false` alone does not stop
   Ctrl+C: SIGINT stays in `exitSignals`, and that handler calls `destroy()` behind you (`core-api.md`).
3. `root.unmount()` — React first, so no component can render into a dead renderer.
4. `renderer.destroy()` — restores the terminal, drops OpenTUI's listeners, frees native resources.
5. `process.exit(code)` **only on the signal path.** A normal completion should let the process end.

Five paths must all land there: the app's own quit key, `SIGINT`, `SIGTERM`, normal completion, and
`uncaughtException` / `unhandledRejection`. Two situational refinements. A **~50 ms delay** before teardown lets the
final frame paint, which matters when that frame is the result the user came for (mnemex waits 50 ms after its
finish tick, `IndexProgress.tsx:194-197`) — not a default, since it is latency on every exit. And **anything
writing to the terminal behind the renderer leaves ghost cells it cannot invalidate**: silence library stderr while
the TUI owns the screen, or route the renderer's own output to stderr so stdout stays clean for piping.
