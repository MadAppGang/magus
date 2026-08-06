// Bypass 9 — a COMMENT between the callee and its paren. `Name\s*\(` sees `Box /* gap */ (` as
// two unrelated tokens, so the whole construct call vanished. To the parser it is one call
// expression with trivia in the middle, which is what makes this the parser's problem. EXPECT rule 4.
import { Box, Text } from "@opentui/core"

const chrome = Box /* gap */ ({ border: true })
const label = Text // a line comment is trivia too
  ({ content: "hello" })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
