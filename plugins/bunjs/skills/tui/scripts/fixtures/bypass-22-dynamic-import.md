# Bypass 22 (found here, not reported) — the binding arrives at runtime

There is no import STATEMENT to read: `await import(…)`, `require(…)` and a `.then(m => …)` callback
each hand back the same namespace object, and the local that catches it is the construct's new name.
Three different code paths reach the module specifier, so they get a block each — the count is what
stops one of them silently covering for another. EXPECT rule 4. EXPECT 3 violations. EXPECT 3 blocks.

Destructured off an awaited dynamic import:

```tsx
const { Box: B } = await import("@opentui/core")

const chrome = B({ border: true })
const jsx = <box>{String(chrome)}</box>
```

CommonJS, where the namespace is a plain local:

```tsx
const later = require("@opentui/core")

const label = later.Text({ content: "hello" })
const jsx = <text>{String(label)}</text>
```

And the promise callback, where the namespace is a function parameter:

```tsx
const pane = import("@opentui/core").then((m) => m.ScrollBox({ stickyScroll: true }))
const jsx = <scrollbox>{String(pane)}</scrollbox>
```
