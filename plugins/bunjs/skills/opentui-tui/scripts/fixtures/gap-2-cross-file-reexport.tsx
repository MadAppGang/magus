// KNOWN GAP — the construct arrives through the user's own module, which re-exports it. Deciding
// that `./barrel` leads to "@opentui/core" means resolving and reading another file; the linter is
// one file (or one fenced block) at a time, and a fenced block has no filesystem at all.
//
// This is the same rule that makes `clean-foreign-box-import.tsx` clean, seen from the other side:
// a binding imported from a non-core module is treated as the user's. Trading that away would flag
// every project that happens to export a component named `Box`, which is the common case, to catch
// a re-export, which is not. EXPECT known gap.
import { Box } from "./barrel" // barrel.ts: export { Box } from "@opentui/core"

const chrome = Box({ border: true })

export function Panel() {
  return (
    <box flexDirection="column">
      <text>{String(chrome)}</text>
    </box>
  )
}
