# CLEAN — the mandated surface banner must not self-trigger

Every React-surface reference file opens with this banner. It names both surfaces **in order to
forbid one of them**, so it necessarily contains a construct call and a JSX intrinsic on adjacent
lines. Prose is never code — only fenced and indented blocks are parsed — and that must stay true
even now that a blockquoted *fence* IS extracted and scanned. EXPECT clean.

> **Surface: `@opentui/react` (JSX).** Every snippet is React. Lowercase intrinsics only —
> `<text>`, `<box>`, `<span>`. Never `Text({…})`, never `<Box>`.

A gate callout is the same shape:

> **⚠ You are leaving the React surface.** Everything below defines a core `Renderable` subclass in
> its own module. It reaches your JSX only through `extend()`. Do not put a construct call such as
> `Box({ gap: 1 })` and a JSX tag like `<box>` in the same file.

And an ordinary React fence alongside them stays clean:

```tsx
export function Badges() {
  return (
    <box flexDirection="row" gap={1}>
      <text fg="#22c55e">GET</text>
      <text fg="#eab308">POST</text>
      <text fg="#ef4444">DELETE</text>
    </box>
  )
}
```
