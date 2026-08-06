---
name: project-setup
description: Start or restructure a Bun/TypeScript project — folder structure by business component, strict tsconfig, typed env config, workspaces and catalogs, bunfig, linting. Ships a tested config parser and measured install-layout facts.
disable-model-invocation: true
---

# Project setup and structure

The decisions here are cheap to make on day one and expensive to change on day two hundred. Two
of them account for most of the pain in a mature codebase: **how the folders are organised** and
**whether configuration is parsed or merely read**.

## Structure by business component, not by technical layer

```
✗ src/controllers/  src/services/  src/models/  src/utils/
✓ src/orders/  src/billing/  src/users/  src/shared/
```

The technical-layer split feels tidy and gets worse with every feature. Adding one field to orders
touches four directories; nothing tells you which files belong together; and `services/` becomes a
250-file drawer nobody can navigate. Worst of all it hides coupling — you cannot see that billing
reaches into the orders repository, because everything reaches into everything.

Grouping by component makes the dependency graph visible in the filesystem. Inside a component,
*then* layer:

```
src/orders/
  index.ts          # the public surface — the ONLY thing other components may import
  routes.ts         # HTTP: parse, authorise, delegate. No business logic.
  service.ts        # business logic. No SQL, no Request/Response.
  repository.ts     # data access. No business rules.
  orders.test.ts
```

**The three-layer rule that pays for itself:** a `Request` object must never reach `service.ts`,
and SQL must never appear outside `repository.ts`. When the service takes plain values instead of a
`Request`, it becomes callable from a queue consumer, a CLI and a test without a fake HTTP layer.

`shared/` is for genuinely cross-cutting code. When something there is used by exactly one
component, move it into that component — a `utils/` that accumulates is how coupling hides.

## Configuration: parse at boot, in one file

**24 tests ship with this parser and pass** (`tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/project-setup}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/config" src/config   # env parser + tests
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

```ts
export const config = parseEnv(appSchema);   // at import time — a bad value crashes at BOOT
```

Crashing at startup is the desired behaviour: an orchestrator will not route traffic to a container
that never became ready, so a bad config becomes a *failed deploy* instead of an incident an hour
later. `process.env` should appear in exactly one file in your codebase; grep for it as an
acceptance check.

Three traps the parser closes, each verified by a test:

| Trap | Why it bites |
|---|---|
| `Boolean("false") === true` | `DEBUG=false` silently enables debug mode |
| `Number("") === 0` | an unset `PORT=` becomes port 0 |
| `FOO=` counts as "set" | an empty `DATABASE_URL` reaches a connection call |

It also **collects every failure before throwing**, so a misconfigured deploy takes one restart
rather than one per mistake. A schema library (zod, valibot) is a perfectly good substitute — the
point is that something parses.

## tsconfig: what `bun init` gives you and what it leaves off

MEASURED — `bun init -y` generates a genuinely strict config:
`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax`, `moduleResolution: "bundler"`, `noEmit`.

It leaves these **off**, and they are worth turning on:

```jsonc
{
  "noUnusedLocals": true,        // dead code is a merge-conflict magnet and hides mistakes
  "noUnusedParameters": true,
  "exactOptionalPropertyTypes": true,   // distinguishes "absent" from "present and undefined"
  "noImplicitReturns": true
}
```

`noUncheckedIndexedAccess` being on by default is the notable one: `arr[0]` is `T | undefined`,
which is *correct* and catches a real bug class. It is also the flag people disable first when it
gets noisy — resist that; the noise is the point.

It does **not** set `"types": ["bun"]`, and does not need to: MEASURED, `bunx tsc --noEmit` exits 0
because `@types/*` packages are auto-included. Setting `types` explicitly is still worth doing in a
library, where you want to *restrict* what leaks in.

**`tsc --noEmit` is not optional.** `bun run` strips types without checking them, so a type error
never surfaces at runtime — it just silently means something you did not intend. Put `tsc --noEmit`
in your `test` script and in CI.

## Workspaces — MEASURED install behaviour

```jsonc
// root package.json
{ "workspaces": ["packages/*"], "catalog": { "zod": "^3.23.8" } }
// member
{ "dependencies": { "zod": "catalog:", "@ws/core": "workspace:*" } }
```

MEASURED on Bun 1.3.10:

- `catalog:` resolved every member to a **single zod 3.25.76** — one place to bump a shared range.
- Bun installs a workspace with an **isolated, pnpm-style layout**: real packages live in
  `node_modules/.bun/<name>@<version>/node_modules/<name>`, and each member gets a symlink. Root
  `node_modules/` held only `.bun` and `@types` — **dependencies are not hoisted.**
- `bun --filter '*' <script>` runs a script across every member, output prefixed per package.

The isolated layout matters beyond tidiness: **a package can only import what it declares.**
Phantom dependencies — importing something that happens to be hoisted — are structurally
impossible, so they cannot silently become load-bearing.

## bunfig.toml

```toml
[install]
exact = true              # pin exact versions; ranges are how "works on my machine" happens

[test]
coverage = true
coverageThreshold = { lines = 0.8, functions = 0.8, statements = 0.8 }
preload = ["./test/setup.ts"]
```

**The coverage keys are plural.** MEASURED: `{ line = … }`, `{ function = … }` and
`{ statement = … }` are silently ignored — no error, no warning, and CI goes green with the gate
dead. Full table in the `testing` skill.

## Scripts

`bun init` generates **no** `scripts` block (MEASURED). Add one — it is the discoverable interface
to the project:

```jsonc
{
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "check": "bun run typecheck && bun run lint && bun test"
  }
}
```

`bun run check` as the single pre-push command means nobody has to remember three.

## Linting

Biome is the pragmatic default for a Bun project: one binary, formatter and linter together, fast,
no plugin archaeology. ESLint with `typescript-eslint` remains the right choice when you need
type-aware rules — and **one of those rules is worth the whole setup**:
`@typescript-eslint/no-floating-promises` catches unawaited promises, which in Bun silently do not
happen (MEASURED: an unhandled rejection does not terminate the process).

## Acceptance — before reporting done

1. `bun run check` passes: `tsc --noEmit`, lint, `bun test`.
2. `process.env` / `Bun.env` appears in **one** file:
   ```bash
   grep -rn 'process\.env\|Bun\.env' src/ | grep -v 'src/config/'
   ```
3. No cross-component deep imports — components talk through `index.ts`:
   ```bash
   grep -rnE "from ['\"]\.\./[a-z-]+/(service|repository|routes)" src/
   ```
4. `bun.lock` is committed and CI uses `--frozen-lockfile`.
5. `.env` is in **both** `.gitignore` and `.dockerignore` — they are separate lists and people
   update only one.

## References

| File | Read it when |
|---|---|
| `references/structure-and-layering.md` | laying out components, dependency direction, where "shared" belongs, when to split a package |
| `references/typescript-config.md` | strictness flags explained, module resolution, path aliases and why they bite, library vs app config |
| `references/tooling.md` | workspaces and catalogs, bunfig, linting, formatting, git hooks, editor setup |
