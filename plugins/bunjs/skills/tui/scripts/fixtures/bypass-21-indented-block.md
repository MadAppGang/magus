# Bypass 21 (found here, not reported) — markdown's other code block

A four-space indent is a code block in CommonMark with no fence at all, and it renders as code.
A fence-only extractor never sees it. Indented candidates are parsed strictly — they are scanned
only when the whole run is valid TS/TSX — so indented prose cannot invent a violation.
EXPECT rule 4. EXPECT 1 violation. EXPECT 0 blocks — there is no fence here to count.

    import { Box } from "@opentui/core"

    export function Panel() {
      const chrome = Box({ border: true })
      return <box flexDirection="row">{String(chrome)}</box>
    }

This paragraph is not indented, so the block above ends here. The indented lines that follow are
prose, not code — they do not parse, and they must not be reported:

    the linter must never flag this paragraph, which merely mentions Box({ gap: 1 }) and <box>
    in the same breath while being ordinary English rather than TypeScript
