# Bypass 27 (found here, not reported) — a markdown file with CRLF line endings

This file is stored with Windows line endings. A fence rule anchored with `$` cannot match a line
that ends in a carriage return, so NO fence opened and the whole file was invisible — not one
block, not one violation, and nothing in the output said so. Line endings are normalised before
anything is matched. EXPECT rule 4. EXPECT 1 violation. EXPECT 1 block. EXPECT no warning
— the independent fence probe reads the raw bytes, so it catches this even when extraction cannot.

```tsx
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
```
