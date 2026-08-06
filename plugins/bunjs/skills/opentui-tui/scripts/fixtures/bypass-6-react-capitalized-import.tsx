// Bypass 6 — baseline coverage that must not regress. `@opentui/react` exports NO capitalized
// renderable: only lowercase intrinsics, hooks, createRoot and extend. EXPECT rules 1, 2.
import { Box, Text, ScrollBox } from "@opentui/react"

export function Panel() {
  return (
    <Box>
      <Text>hello</Text>
      <ScrollBox />
    </Box>
  )
}
