# WARN — a fence that opens a tsx block and yields nothing

The other side of the alarm. This file means to show TypeScript: the line below reads as a `tsx`
fence to the author. It is not one — CommonMark forbids a backtick inside a backtick fence's info
string — so it opens no block, and the snippet renders as a paragraph on GitHub as well as being
invisible to the linter. The author wants to hear about that, and the check that tells them is an
INDEPENDENT probe of the raw text disagreeing with the extractor, not a global block counter.
Silencing the consumer-project case must not silence this one.
EXPECT clean. EXPECT 0 blocks. EXPECT warning.

```tsx `App.tsx`
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
```
