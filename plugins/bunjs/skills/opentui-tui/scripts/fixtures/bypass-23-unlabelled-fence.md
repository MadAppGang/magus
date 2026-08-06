# Bypass 23 (found here, not reported) — dropping the language tag

The extractor only kept fences tagged ts/tsx/jsx/js, so deleting `tsx` from the fence line deleted
the block while the snippet still renders as code. An unlabelled fence is scanned, but strictly: it
must parse as valid TS/TSX first, which is why the terminal transcripts and box-drawing diagrams
that fill the reference docs stay out of it.
EXPECT rule 4. EXPECT 1 violation. EXPECT 0 blocks — unlabelled fences are scanned but never counted.

```
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
```

A transcript in an unlabelled fence is not code and must stay silent, even though it names both
surfaces:

```
$ bun run demo.tsx
warn: Box({ gap: 1 }) rendered next to <box> — 2 diagnostics, 0 fixed
```
