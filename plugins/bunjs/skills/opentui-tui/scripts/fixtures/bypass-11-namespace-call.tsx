// Bypass 11 — a NAMESPACE call. The old rule deliberately excused any name preceded by a dot, so
// that `shim.Box(1)` on a user's own object stayed clean — and `core.Box({…})` rode out on the same
// excuse. Resolving the namespace binding tells the two apart. EXPECT rule 4.
import * as core from "@opentui/core"

const chrome = core.Box({ border: true })
const label = core.Text({ content: "hello" })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
