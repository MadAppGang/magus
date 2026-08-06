// Bypass 10 — a PARENTHESIZED callee. `(Text)({…})` calls the identical function, but the
// character before the name is `(`, and the old rule keyed on the name being immediately followed
// by `(`. Parens, a comma sequence and a non-null assertion all peel away. EXPECT rule 4.
import { Box, Text } from "@opentui/core"

const label = (Text)({ content: "x" })
const chrome = ((Box))({ border: true })
const indirect = (0, Box)({ gap: 1 })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([label, chrome, indirect].length)}</text>
    </box>
  )
}
