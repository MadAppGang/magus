// Bypass 3 — real core constructs the old regex never listed. It knew only Text|Box|Group
// (and `Group` does not exist in either pinned version). EXPECT rule 4.
import { Input, Select, ScrollBox } from "@opentui/core"

const field = Input({ placeholder: "name" })
const list = Select({ options: [] })
const pane = ScrollBox({ stickyScroll: true })

export function Form() {
  return (
    <box flexDirection="column" gap={1}>
      <text>{String([field, list, pane].length)}</text>
    </box>
  )
}
