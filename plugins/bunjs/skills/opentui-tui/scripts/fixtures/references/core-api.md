# CLEAN — a fixture, not the real reference

This file exists at the path `references/core-api.md` **relative to the fixtures root**, which is
what `ALLOW_MIX` keys on, so scanning it exercises the allowlist itself rather than a claim about it.
The real core-surface reference pairs a construct call with its React equivalent in one table on
purpose — that is the file's whole job — so rule 4 must not fire here. EXPECT clean.

```tsx
import { Box, Text } from "@opentui/core"

const chrome = Box({ flexDirection: "row", gap: 1 }, Text({ content: "Name:" }))
const equivalent = <box flexDirection="row" gap={1}><text>Name:</text></box>
```

| core | react |
|---|---|
| `Text({ content: "x" })` | `<text>x</text>` |
| `Box({ gap: 1 }, child)` | `<box gap={1}>{child}</box>` |
