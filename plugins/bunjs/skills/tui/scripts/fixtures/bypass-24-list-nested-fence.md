# Bypass 24 (found here, not reported) — a fence indented under a list item

CommonMark indents a fence inside a list item to the item's content column, so the fence line starts
with four or more spaces. A `^ {0,3}```` ``` ````` rule — the indent CommonMark allows for a
top-level fence — stops seeing it, and the four-space rule for indented code cannot read it either
because the fence lines themselves are not TypeScript. Fences are matched at any indent.
EXPECT rule 4. EXPECT 2 violations. EXPECT 2 blocks.

- A checklist item with an example under it:

      ```tsx
      import { Box } from "@opentui/core"

      export function Panel() {
        return <box flexDirection="row">{Box({ gap: 1 })}</box>
      }
      ```

- And one nested two levels deep, blockquoted for good measure:

  > ~~~tsx
  > import * as core from "@opentui/core"
  >
  > const label = core.Text({ content: "x" })
  > const jsx = <text>{String(label)}</text>
  > ~~~
