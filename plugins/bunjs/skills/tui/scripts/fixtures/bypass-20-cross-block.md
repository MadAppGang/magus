# Bypass 20 (found here, not reported) — the two surfaces split across two fences of one file

The invariant is per FILE as well as per block, and splitting the halves across two fences defeats
any check that only ever looks inside one block. Neither block below is a violation on its own; the
file is. EXPECT rule 4. EXPECT 1 violation. EXPECT 2 blocks.

```tsx
import { Box } from "@opentui/core"

export const chrome = Box({ border: true, gap: 1 })
```

Prose between them changes nothing — the reader is meant to put these in one module:

```tsx
export function Panel() {
  return (
    <box flexDirection="column">
      <text>hello</text>
    </box>
  )
}
```
