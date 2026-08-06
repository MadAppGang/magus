// CLEAN — a user's own capitalized React components beside lowercase intrinsics. `<Box>` here is
// a local component, not an intrinsic and not a construct. EXPECT clean.
import { useState } from "react"
import { useKeyboard } from "@opentui/react"

function Box({ children }: { children?: React.ReactNode }) {
  return <box border>{children}</box>
}

function Text({ label }: { label: string }) {
  return <text>{label}</text>
}

export function Panel() {
  const [n, setN] = useState(0)
  useKeyboard((key) => key.name === "j" && setN((v) => v + 1))
  const seen = new Map<string, number>()
  seen.set("n", n)
  return (
    <Box>
      <Text label={`count ${n}`} />
      <box flexDirection="row" gap={1}>
        <text>GET</text>
        <text>POST</text>
        <text>DELETE</text>
      </box>
    </Box>
  )
}
