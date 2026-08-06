// KNOWN GAP — the namespace is returned by a function, so seeing it needs dataflow ACROSS a call
// boundary, which this linter deliberately does not do. Binding resolution is per-declaration:
// `const c = core` resolves, `const c = getCore()` does not.
//
// Left open on purpose. Every closure for it is shape-specific (`() => core` today, `() => { const
// c = core; return c }` tomorrow), and a rule that covers one shape reads like it covers the class.
// Nothing in the skill's docs or assets is written this way.
//
// Note what is NOT here: passing the construct itself to a helper — `pick(core.Text)({…})` — IS
// caught, by the rule that treats a construct handed to any call as a construct use. Keeping that
// form out of this file is the point; a gap fixture that flags for a neighbouring reason reports a
// hole as closed. EXPECT known gap.
import * as core from "@opentui/core"

const getCore = () => core

const chrome = getCore().Box({ border: true })
const label = getCore().Text({ content: "hello" })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String([chrome, label].length)}</text>
    </box>
  )
}
