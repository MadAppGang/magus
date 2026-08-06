# Bypass 1 — a mixed snippet hiding inside a blockquoted fence

The fence line is `> ```tsx`, so the old per-block extractor never opened a block, and the old
file-scope pass blanked every `>` line before scanning. Invisible to both.
EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

> Here is a "helpful aside" that quietly mixes the two surfaces:
>
> ```tsx
> import { Box } from "@opentui/core"
>
> export function Panel() {
>   return <box flexDirection="row">{Box({ gap: 1 })}</box>
> }
> ```

Nested two levels deep must also flag:

> > ```tsx
> > const row = Text({ content: "x" })
> > const jsx = <text>x</text>
> > ```
