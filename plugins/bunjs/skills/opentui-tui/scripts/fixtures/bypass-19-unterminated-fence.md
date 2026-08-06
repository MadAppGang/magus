# Bypass 19 (found here, not reported) — a fence with no closing fence

The extractor only emitted a block when it saw the closer, so deleting the last three backticks
deleted the block. CommonMark says an unclosed fence runs to the end of the document, and it still
renders as code everywhere, so the snippet is read by a human exactly as if it were closed.
EXPECT rule 4. EXPECT 1 violation. EXPECT 1 block.

```tsx
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
