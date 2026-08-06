# Bypass 13 — a tilde fence

CommonMark gives `~~~` exactly the same standing as ``` ``` ```. The old extractor matched backticks
only, so re-typing the fence with tildes made a mixed snippet invisible while still rendering as
code on GitHub and in every editor preview. EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

~~~tsx
import { Box } from "@opentui/core"

export function Panel() {
  return <box flexDirection="row">{Box({ gap: 1 })}</box>
}
~~~

A longer tilde run is still one fence, and the closer only has to be at least as long:

~~~~ts
const b = new BoxRenderable(ctx, { flexDirection: "row" })
const jsx = <box />
~~~~
