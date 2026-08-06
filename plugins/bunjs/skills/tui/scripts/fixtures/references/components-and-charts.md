# Bypass 30 (reported as a disclosure, closed here) — a fixture, not the real reference

This file sits at the path `references/components-and-charts.md` **relative to the fixtures root**,
which is where `ALLOW_MIX` used to match. That entry switched rule 4 off for the whole file, so a
mixed snippet **above** the file's own gate was unchecked — the allowlist was broader than the thing
it was there to permit. The path is out of the list now; the GATE marker scopes the exemption
positionally instead, and a file with no marker is checked end to end rather than exempted.
EXPECT rule 4. EXPECT 1 violation. EXPECT 2 blocks.

Above the gate this file is React-surface like any other, and this must flag:

```tsx
import { Box } from "@opentui/core"

const chrome = Box({ border: true })
const jsx = <box flexDirection="row">{String(chrome)}</box>
```

> **⚠ You are leaving the React surface.** Everything below defines a core `Renderable` subclass in
> its own module. It reaches your JSX only through `extend()` + a module augmentation.

Below it, the same shape is the documented one and must stay silent:

```tsx
import { Box } from "@opentui/core"

const chrome = Box({ gap: 1 })
const jsx = <box flexDirection="row">{String(chrome)}</box>
```
