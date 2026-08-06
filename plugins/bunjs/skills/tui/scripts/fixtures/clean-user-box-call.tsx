// CLEAN — the user's OWN `Box`, declared here and then CALLED directly. The previous pass blanked
// declaration names so `function Box(…)` itself would not match, but the call site still did, so
// perfectly good code failed. Scope is the answer: `Box` is bound in this file and its binding does
// not come from "@opentui/core", so it is the user's, call it however they like. EXPECT clean.
import { useState } from "react"

function Box({ children }: { children?: React.ReactNode }) {
  return <box border>{children}</box>
}

function Text({ label }: { label: string }) {
  return <text>{label}</text>
}

const Select = ({ options }: { options: string[] }) => <text>{options.length}</text>

export function Panel() {
  const [n] = useState(0)
  const header = Box({ children: Text({ label: `count ${n}` }) }) // calling their own components
  const picker = Select({ options: ["a", "b"] })
  return (
    <box flexDirection="column">
      {header}
      {picker}
      <text>GET</text>
    </box>
  )
}
