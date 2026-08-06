// Bypass 12 — a LOCAL alias, distinct from the aliased import of bypass 2: the import is plain and
// the rename happens in the module body, so reading import specifiers is not enough. The alias of an
// alias must fall out too, which is why binding resolution runs to a fixpoint. EXPECT rule 4.
import { Box, Text } from "@opentui/core"

const B = Box
const C = B
const T = Text

const chrome = C({ border: true })
const label = T({ content: "hello" })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
