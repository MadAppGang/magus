// Bypass 5 — a construct call whose argument is a VARIABLE, not an inline object literal.
// The old regex required `Name(\s*\{`, so hoisting the options out defeated it. EXPECT rule 4.
import { Box, Text } from "@opentui/core"

const varOpts = { flexDirection: "row" as const, gap: 1 }
const rowOpts = { content: "hello" }

const row = Box(varOpts, Text(rowOpts))
const empty = Box()

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([row, empty].length)}</text>
    </box>
  )
}
