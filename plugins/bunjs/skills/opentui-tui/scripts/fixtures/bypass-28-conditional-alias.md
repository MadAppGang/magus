# Bypass 28 (found here, not reported) — one expression naming two values

Alias resolution walked a single initializer, so putting the construct behind a choice meant nothing
resolved and the call site read as a plain local. Both operators get a block: kept in one file they
covered for each other, since only the first construct use in a unit is reported.
EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

A ternary, where the construct is one of two branches:

```tsx
import { Box, Text } from "@opentui/core"

const B = process.env.WIDE === "1" ? Box : Text
const chrome = B({ gap: 1 })
const jsx = <box>{String(chrome)}</box>
```

A nullish fallback, where the construct is the default:

```tsx
import { Box } from "@opentui/core"

declare const custom: ((o: object) => unknown) | undefined

const C = custom ?? Box
const chrome = C({ border: true })
const jsx = <box>{String(chrome)}</box>
```
