# Bypass 8 — baseline rule 4, must not regress

The original invariant: a construct call and a JSX intrinsic in the same fenced block. This one was
always caught; the fixture exists so a refactor cannot quietly drop the core case.
EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

```tsx
import { Box, Text } from "@opentui/core"

export function Panel() {
  const header = Text({ content: "Requests" })
  return (
    <box flexDirection="column">
      <text>{String(header)}</text>
      {Box({ gap: 1 })}
    </box>
  )
}
```

And once more with `new`, which reaches the same surface by a different spelling:

```ts
const b = new BoxRenderable(ctx, { flexDirection: "row" })
const jsx = <box />
```
