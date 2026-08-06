// Bypass 16 (found here, not reported) — COMPUTED member access on the namespace. `core.Box` was
// the reported form; `core["Box"]` and core[`Box`] reach the same export past any rule written for a
// dot, and a template literal with no substitution is a constant the parser hands over. EXPECT rule 4.
import * as core from "@opentui/core"

const chrome = core["Box"]({ border: true })
const label = core[`Text`]({ content: "hello" })
const { Box: Renamed } = core

export function Panel() {
  const third = Renamed({ gap: 1 })
  return (
    <box flexDirection="column">
      <text>{String([chrome, label, third].length)}</text>
    </box>
  )
}
