// CLEAN — `Box` and `Text` imported from the user's OWN module. The name matches a core construct,
// but the binding does not come from "@opentui/core", so it is not the construct — the same scope
// question as a local `function Box`, asked at the import. A free (never bound) `Box` still counts,
// because doc snippets routinely omit their imports; a bound one belongs to whoever bound it.
// EXPECT clean.
import { Box, Text } from "./ui/primitives"
import { ScrollBox as Pane } from "../widgets/pane"
import { useKeyboard } from "@opentui/react"

const header = Text({ label: "Requests" })
const chrome = Box({ padded: true })
const pane = Pane({ sticky: true })

export function Panel() {
  useKeyboard((key) => key.name === "q")
  return (
    <box flexDirection="column">
      <text>{String([header, chrome, pane].length)}</text>
    </box>
  )
}
