// Bypass 2 — an ALIASED construct import. The local name is `B`, which no name-keyed
// regex can know about; only the import binding gives it away. EXPECT rule 4.
import { Box as B, Text as T } from "@opentui/core"

export function Panel() {
  const chrome = B({ flexDirection: "row", gap: 1 }, T({ content: "hello" }))
  return (
    <box flexDirection="column">
      <text>{String(chrome)}</text>
    </box>
  )
}
