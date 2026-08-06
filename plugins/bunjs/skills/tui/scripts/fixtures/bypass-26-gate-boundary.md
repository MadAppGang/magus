# Bypass 26 (found here, not reported) — the gate must exempt what is below it and nothing above

A reference file that turns core-surface half way down marks the turn with a gate callout, and blocks
after it are deliberately core. Two failure modes, and this fixture fails on both: if the gate stops
being honoured the second block flags too, and if it over-applies the first block stops flagging.
EXPECT rule 4. EXPECT 1 violation. EXPECT 2 blocks.

Above the gate, this is the ordinary violation:

```tsx
import { Box } from "@opentui/core"

const chrome = Box({ border: true })
const jsx = <box>{String(chrome)}</box>
```

> **⚠ You are leaving the React surface.** Everything below defines a core `Renderable` subclass in
> its own module. It reaches your JSX only through `extend()`.

Below it, the identical shape is the documented, intended one and must stay silent:

```tsx
import { Box } from "@opentui/core"

const chrome = Box({ gap: 1 })
const jsx = <box>{String(chrome)}</box>
```
