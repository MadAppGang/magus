// CLEAN — a construct call spelled inside a COMMENT or a STRING is not a call. Never write
// Box({ gap: 1 }) in a React module; that sentence is documentation, and documentation that cannot
// name the thing it forbids is useless. This is the same property the mandated surface banner needs,
// generalised: the parser only sees code, so prose is safe everywhere. EXPECT clean.
import { useState } from "react"

const BANNED = "Text({ content: 'x' })"
const ALSO_BANNED = `Box({ gap: 1 }, child)`
const HINT = ["new BoxRenderable(ctx, opts)", "core.Box({})"].join(" · ")

export function Panel() {
  const [n] = useState(0)
  /* Nor here: Box({ border: true }) beside <box> is exactly what this file must NOT report. */
  return (
    <box flexDirection="column">
      <text>{BANNED}</text>
      <text>{ALSO_BANNED}</text>
      <span>{HINT}</span>
      <text>{n}</text>
    </box>
  )
}
