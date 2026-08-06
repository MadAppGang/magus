# CLEAN — an ordinary app README, which must not set off the extraction alarm

`SKILL.md` tells consumer projects to run `check-surface` as an acceptance step. A `bun init` app has
a README and a CLAUDE.md holding prose, a shell fence and maybe some JSON — no TypeScript snippets at
all — and the old "0 fenced blocks found" warning fired there every single time. A warning that cries
wolf on the happy path teaches people to skip the one that matters.
EXPECT clean. EXPECT 0 blocks. EXPECT no warning.

Install it:

```bash
bun add @opentui/react @opentui/core
bun run src/index.tsx
```

Configure it:

```json
{ "jsx": "react-jsx", "jsxImportSource": "@opentui/react" }
```

And the layout it expects:

```text
src/
  index.tsx
  theme/tokens.ts
```

Prose may name both surfaces freely — `Box({ gap: 1 })` and `<box>` — because prose is not code.
