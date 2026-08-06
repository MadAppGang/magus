// Bypass 29 (found here, not reported) — a rest element captures the whole namespace under a new
// name. Destructuring resolution read named elements only, so `{ ...rest }` renamed every construct
// at once and none of them were tracked. A rest binding IS the namespace. EXPECT rule 4.
import * as core from "@opentui/core"

const { RGBA, ...rest } = core

const chrome = rest.Box({ border: true })
const label = rest.Text({ content: "hello" })

export function Panel() {
  void RGBA
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
