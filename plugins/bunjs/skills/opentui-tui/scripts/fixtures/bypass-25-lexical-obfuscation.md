# Bypass 25 (found here, not reported) — the name and the tag are not spelled the way they read

Four forms where the source characters do not equal the identifier. A pattern matcher compares
characters; a parser compares the names the language actually binds, which is why these cost nothing
to cover. EXPECT rule 4. EXPECT 4 violations. EXPECT 4 blocks.

A unicode escape in an identifier — `Box` IS `Box` to every JS engine:

```tsx
const chrome = \u0042ox({ border: true })
const jsx = <box>{String(chrome)}</box>
```

Whitespace inside the JSX tag — `< box >` is `<box>`, and no `<box` pattern sees it:

```tsx
import { Box } from "@opentui/core"

const chrome = Box({ gap: 1 })
const jsx = < box >{String(chrome)}</ box >
```

A computed member whose key is a const, not a literal:

```tsx
import * as core from "@opentui/core"

const k = "Box"
const chrome = core[k]({ border: true })
const jsx = <box>{String(chrome)}</box>
```

A construct plucked off an awaited import in one expression, so there is no namespace binding:

```tsx
const B = (await import("@opentui/core")).Box

const chrome = B({ gap: 1 })
const jsx = <box>{String(chrome)}</box>
```
