# Bypass 17 (found here, not reported) — reaching the construct without naming it in call position

Every form below invokes the same factory while the callee position holds something else entirely.
One block each, so a regression in any one of the six is visible on its own rather than being
masked by its neighbours. EXPECT rule 4. EXPECT 6 violations. EXPECT 6 blocks.

Handed to a helper, which is the general case the rest are variations of:

```tsx
import { Box } from "@opentui/core"

const chrome = mount(Box, { gap: 1 })
const jsx = <box>{String(chrome)}</box>
```

`Reflect.apply` — the callee is `Reflect.apply`, and the construct is cargo:

```tsx
import { Box } from "@opentui/core"

const chrome = Reflect.apply(Box, null, [{ border: true }])
const jsx = <box>{String(chrome)}</box>
```

`Function.prototype.call` — the callee is a method OF the construct:

```tsx
import { Text } from "@opentui/core"

const label = Text.call(null, { content: "x" })
const jsx = <text>{String(label)}</text>
```

Held in an array and invoked through a parameter, so the call site names nothing:

```tsx
import { Box, Text } from "@opentui/core"

const made = [Box, Text].map((f) => f({}))
const jsx = <box>{made.length}</box>
```

Held on an object and invoked through a property, which no name-keyed rule can follow:

```tsx
import { Box } from "@opentui/core"

const registry = { make: Box }
const chrome = registry.make({ gap: 1 })
const jsx = <box>{String(chrome)}</box>
```

Escaped onto a global, where the call site is no longer even in this file:

```tsx
import { Box } from "@opentui/core"

;(globalThis as Record<string, unknown>).Box = Box
const jsx = <box />
```
