# TypeScript configuration

## What `bun init -y` generates — MEASURED

```jsonc
{
  "compilerOptions": {
    "lib": ["ESNext"], "target": "ESNext", "module": "Preserve", "moduleDetection": "force",
    "jsx": "react-jsx", "allowJs": true,
    "moduleResolution": "bundler", "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true, "noEmit": true,
    "strict": true, "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "noUnusedLocals": false, "noUnusedParameters": false, "noPropertyAccessFromIndexSignature": false
  }
}
```

It also writes `devDependencies: { "@types/bun": "latest" }` and no `scripts` block.

Notably it does **not** set `"types": ["bun"]` — and does not need to. MEASURED: `bunx tsc --noEmit`
exits 0 regardless, because TypeScript auto-includes every `@types/*` package it finds. Set `types`
explicitly only when you want to *restrict* what leaks in, which mostly matters for libraries.

## The flags that matter

### `strict: true`

Non-negotiable. It is a bundle; the two that do the most work are `strictNullChecks` (the entire
null-safety story) and `noImplicitAny` (which stops `any` spreading silently).

### `noUncheckedIndexedAccess` — on by default, keep it

```ts
const first = items[0];        // T | undefined, not T
const value = record[key];     // V | undefined
```

This is *correct*: `items[0]` on an empty array really is `undefined`, and JavaScript will hand it
to you happily. It is also the flag people disable first when it gets noisy. Resist that — the
noise is a real bug class surfacing.

Handle it honestly rather than with `!`:

```ts
const first = items[0];
if (!first) throw new Bug("expected at least one item");   // an invariant, stated
```

A `!` is a claim the compiler cannot verify. Where you genuinely know better, say so with a check
that throws, so a violated assumption produces a clear error instead of `undefined is not a function`
three frames later.

### `verbatimModuleSyntax`

Requires `import type` for type-only imports, so what is erased is explicit. It prevents the subtle
case where an import that exists only for a type still pulls the module in at runtime — which
matters when that module has side effects or is expensive to load.

```ts
import type { User } from "./user";        // erased
import { createUser } from "./user";       // kept
```

### Worth adding beyond the defaults

```jsonc
{
  "noUnusedLocals": true,             // dead code hides mistakes and creates merge conflicts
  "noUnusedParameters": true,         // prefix intentionally-unused with _
  "noImplicitReturns": true,          // catches a branch that forgot to return
  "exactOptionalPropertyTypes": true, // distinguishes absent from present-and-undefined
  "noPropertyAccessFromIndexSignature": true   // forces obj["dynamic"] for index-signature access
}
```

`exactOptionalPropertyTypes` is the subtle one: without it, `{ name?: string }` accepts
`{ name: undefined }`, so "not provided" and "explicitly cleared" are indistinguishable — which is
exactly the distinction a PATCH endpoint needs.

### `skipLibCheck: true`

Keep it. It skips type-checking `.d.ts` files in dependencies, which is a large speed win and
avoids being blocked by someone else's broken types. Your own code is still fully checked.

## `bun run` does not typecheck

Bun strips types without checking them. A type error therefore never surfaces at runtime — the
code just does something you did not intend. **`tsc --noEmit` is a separate, mandatory step**, in
your `test` script and in CI.

This is the single most common gap in a Bun project: a green `bun test` with a broken build.

## Path aliases

```jsonc
{ "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }
```

Bun honours these at runtime, so `import { x } from "@/orders"` works. Two caveats before you reach
for them:

1. **They do not survive publishing.** A library shipping `@/` imports breaks for consumers unless
   the bundler rewrites them. For a library, use relative imports.
2. **They mask structure.** `../../../shared/logger` is ugly *and informative* — it tells you the
   import crosses three boundaries. `@/shared/logger` hides that, so drift is invisible.

The pragmatic middle: relative imports within a component, an alias only for genuinely global
things. Note the measured precedent from the `tui` skill in this plugin: keeping copied assets'
relative imports untouched typechecks clean, while rewriting them to `@/theme/…` produced 9 ×
TS2307.

## Library vs application

| | Application | Library |
|---|---|---|
| `noEmit` | `true` | `false` — you ship `.js` and `.d.ts` |
| `declaration` | n/a | `true` |
| `moduleResolution` | `bundler` | `bundler` for modern consumers; `node16` for broad compat |
| `types` | leave implicit | **restrict explicitly** — a stray `@types/node` becomes a consumer requirement |
| path aliases | fine | avoid |

For a library, also set `"lib"` to the lowest target you support. `lib: ["ESNext"]` silently allows
APIs your consumers may not have.

## Project references

For a monorepo, `composite: true` plus `references` gives incremental builds and enforces the
dependency graph at the type level. The cost is real — every package needs its own tsconfig and the
build order becomes explicit — so reach for it when `tsc` time actually hurts, not before.

Bun's isolated install layout already prevents the related runtime problem (importing an undeclared
dependency), so references are a build-speed and type-boundary tool here, not a correctness one.
