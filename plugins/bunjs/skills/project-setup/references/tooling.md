# Tooling

## Workspaces — MEASURED on Bun 1.3.10

```jsonc
// root package.json
{
  "private": true,
  "workspaces": ["packages/*"],
  "catalog": { "zod": "^3.23.8" }
}
// packages/api/package.json
{ "dependencies": { "@ws/core": "workspace:*", "zod": "catalog:" } }
```

Verified behaviour after `bun install`:

- **`catalog:` centralises a version range.** Both members resolved to a single **zod 3.25.76**;
  bumping the range is a one-line edit at the root. Without it, upgrading a shared dependency means
  editing every member and inevitably missing one.
- **The layout is isolated (pnpm-style), not hoisted.** Real packages live at
  `node_modules/.bun/zod@3.25.76/node_modules/zod`, and each member gets a symlink
  (`packages/core/node_modules/zod -> ../../../node_modules/.bun/zod@3.25.76/node_modules/zod`).
  Root `node_modules/` contained only `.bun` and `@types`.
- **`workspace:*`** symlinks a sibling into the dependent's `node_modules`.
- **`bun --filter '*' <script>`** runs a script in every member, output prefixed per package:
  `@ws/core hello: core-ran`.

The isolated layout is the important one. **A package can only import what it declares** — phantom
dependencies are structurally impossible, so a transitive package cannot quietly become load-bearing
and then vanish when an unrelated upgrade drops it.

Run a script in one member with `bun --filter '@ws/api' test`, or across a pattern
(`bun --filter './packages/*' build`).

## bunfig.toml

```toml
[install]
exact = true                 # pin exact versions
registry = "https://registry.npmjs.org"

[install.cache]
disable = false

[test]
coverage = true
coverageThreshold = { lines = 0.8, functions = 0.8, statements = 0.8 }
coverageSkipTestFiles = true
preload = ["./test/setup.ts"]

[run]
bun = true                   # run package.json scripts with bun, not node
```

**`coverageThreshold` keys are plural.** MEASURED: the singular spellings (`line`, `function`,
`statement`) are silently ignored — no error, no warning, exit 0 against 33% coverage. Full table
in the `testing` skill.

`exact = true` is worth the noise. A caret range means CI can install a version nobody reviewed, so
the artifact you test is not the artifact you built. Pair it with `--frozen-lockfile` in CI.

## Linting and formatting

**Biome** is the pragmatic default: one binary, formatter plus linter, fast, no plugin archaeology.

```bash
bun add -d @biomejs/biome
bunx biome init
bunx biome check --write .
```

**ESLint + typescript-eslint** is still right when you need type-aware rules, and one of those rules
justifies the whole setup:

```js
// eslint.config.js
rules: {
  "@typescript-eslint/no-floating-promises": "error",   // the important one
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",
}
```

`no-floating-promises` catches unawaited promises. MEASURED: in Bun an unhandled rejection fires
the event and **does not terminate the process**, so a floating promise that rejects means the work
silently did not happen. This rule requires type information, so point it at your tsconfig.

You can run both — Biome for formatting and fast lints, ESLint restricted to the type-aware rules.

## Git hooks

Keep the hook fast; a slow pre-commit gets bypassed with `--no-verify` and then never runs.

```bash
# .git/hooks/pre-commit  (or a managed hooks dir — see below)
#!/bin/sh
bunx biome check --staged --no-errors-on-unmatched || exit 1
```

Leave `tsc --noEmit` and the full test run to pre-push or CI.

**Verify the hook is actually installed.** If the repo sets `core.hooksPath` to a tracked directory,
scripts in `.git/hooks/` never run — a mismatch that makes "enforced by pre-commit" aspirational:

```bash
git config core.hooksPath        # empty means .git/hooks is used
```

Point it at a tracked directory (`git config core.hooksPath scripts/hooks`) so the hook is shared
and reviewable, and confirm it fires once by making a deliberately failing commit.

## CI shape

```yaml
- uses: oven-sh/setup-bun@<commit-sha>     # pin by SHA; tags are mutable
  with: { bun-version: 1.3.10 }            # pin the runtime, never "latest"
- run: bun install --frozen-lockfile
- run: bun run typecheck
- run: bun run lint
- run: bun test --coverage
- run: bun audit
```

`--frozen-lockfile` fails rather than silently resolving something new (MEASURED: it succeeds
against a committed `bun.lock`). Pinning the Bun version matters — otherwise a runtime upgrade
lands in production without a code change.

## Editor

`.vscode/settings.json`, committed, so the team formats identically:

```jsonc
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "biomejs.biome",
  "typescript.tsdk": "node_modules/typescript/lib"   // use the project's tsc, not the editor's
}
```

The `tsdk` line prevents the common confusion where the editor reports different errors from CI
because it is using a bundled TypeScript of a different version.

## `.gitignore` and `.dockerignore`

They are **separate lists** and people update only one. At minimum both need:

```
node_modules/
.env
.env.*
!.env.example
coverage/
*.log
```

An `.env` reaching a Docker layer via `COPY . .` ships production credentials inside the image, and
deleting it in a later layer does not remove it from the image.
