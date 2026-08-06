// CLEAN — importing from "@opentui/core" is NOT a violation. The rules key on a construct CALL
// adjacent to JSX, never on an import. `new Map()` does not match the renderable-constructor
// pattern, a method reached through a dot is not the construct, and neither is `myBox(...)`.
// `shim.Box(1)` is a property of a local object, not a core namespace member. EXPECT clean.
import { RGBA, createTextAttributes, type KeyEvent } from "@opentui/core"
import { Renderable } from "@opentui/core"

const DIM = createTextAttributes({ dim: true })
const INK = RGBA.fromHex("#0b0f14")
const cache = new Map<string, RGBA>()
const shim = { Box: (n: number) => n, Text: (s: string) => s }

export function Row({ name, onKey }: { name: string; onKey: (k: KeyEvent) => void }) {
  const boxed = shim.Box(1)
  const labelled = shim.Text(name)
  const myBox = (v: string) => v
  void [INK, cache, Renderable, onKey, boxed, myBox(name)]
  return (
    <box flexDirection="row" gap={1}>
      <text attributes={DIM}>{labelled}</text>
      <span fg="#7dd3fc">{name}</span>
    </box>
  )
}
