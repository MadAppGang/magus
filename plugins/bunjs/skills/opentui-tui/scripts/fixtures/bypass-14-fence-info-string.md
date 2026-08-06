EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks — an info string must not demote a `tsx` fence
to the unlabelled path that scans it anyway; the language is still `tsx`.

# Bypass 14 — an info string after the language

The old fence regex ended at `\s*$` right after the language word, so any attribute — the
`title=` that documentation themes take, a twoslash marker, a highlight range — closed the door.
The language is the first word of the info string; everything after it is metadata.

```tsx title=demo.tsx
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
```

Braced and comma-separated info strings are the same shape:

```{tsx} showLineNumbers {2-4}
import { Text } from "@opentui/core"

const label = Text({ content: "x" })
const jsx = <text>{String(label)}</text>
```
