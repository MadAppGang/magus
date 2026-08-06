# Versions and builds — MEASURED, not remembered
> **Surface: neutral.** This file describes process, tooling and measurement. Snippets are
> shell, JSON or a throwaway probe — no OpenTUI rendering code in either dialect.

**Measured 2026-07-30, bun 1.3.10, macOS arm64, clean scratch project.** Nothing here is recalled —
and nothing here keeps. Treat the stamp as an expiry date: re-run the recipe at the bottom (~2 min)
before trusting a row.

> **Re-measured 2026-08-06 — `latest` has moved to 0.5.1.** An unpinned
> `bun add @opentui/core @opentui/react react` now resolves **0.5.1** (react 19.2.8), not 0.4.5.
> The **run-from-source row still holds**: six independent clean-scratch builds on 0.5.1 gave
> 119/119 asset tests, `tsc --noEmit` clean, and a rendered colour frame at 80×24 and 145×45.
> The `--compile` rows below are **unverified at 0.5.x** — they were measured against 0.4.5 and
> 0.1.107 only, so treat the compiled-binary guidance as untested on the version you will install
> by default.

## Pick your pin by the artifact you are shipping

Read the row for the thing you ship — applying the "npm package" row to `--compile` is the mistake
this table exists to prevent.

| Artifact you ship | Pin | `--external`? | Measured evidence |
|---|---|---|---|
| **Run from source** — `bun run src/index.tsx`, or a plain npm package | 0.4.x or 0.5.x — an unpinned `bun add` gives **0.5.1** today | n/a | 0.4.5 runs, exit 0; 0.5.1 runs, exit 0 (2026-08-06, 6 builds) |
| **npm launcher / JS bundle**, deps resolved adjacently via `optionalDependencies` | 0.4.x | **yes** — but only because the platform packages ship alongside | external binary run *beside* its `node_modules`: exit 0 |
| **Standalone compiled binary** — `bun build --compile` | **0.1.107** | **NO** — externalising makes the binary unable to resolve the module | compiles **and launches**: exit 0, 66,534,800 B |

0.4.5 under `--compile`: **compile exit 0, 69,490,448 B — and the binary exits 1 at launch.** Sizes
track your entry file (a re-run measured 69,325,328 / 66,006,416 B) — match the shape, not the digits.

## "It compiled" is not "it works"

The old belief — *0.4.x does not compile* — is wrong in mechanism, and the mechanism tells you where to
look. Compilation **succeeds**; the binary then throws at startup inside `@opentui/core`'s native-library
path lookup, because a path that resolves on disk resolves to nothing inside `/$bunfs/root/`. That is a
**runtime** bug in native-library resolution, not a bundler problem — do not go hunting through build flags.

## The `--external` trap

`bun build --compile --external @opentui/core` builds clean and produces something that is **not a
standalone binary**. Run it in the project directory where `node_modules` resolves and it exits 0
— looks fine. Run it anywhere else and it is `error: Cannot find module '@opentui/core/testing'
from '/$bunfs/root/<bin>'`, exit 1. `--external` means *not bundled*, so the module must resolve
**on disk at runtime**. The external binary was also 8.4 MB smaller (60,953,744 vs 69,325,328 B) —
that gap is the native library you declined to embed. Use `--external` only when deliberately
shipping dependencies beside the binary; never as a fix for a compile error.

## The native library, and why nothing cross-compiles

`@opentui/core` is a native Zig core behind a C ABI. The library arrives in a platform package —
`node_modules/@opentui/core-<platform>-<arch>/libopentui.dylib` — declared by `@opentui/core` as
an `optionalDependency` **pinned to its own exact version** (0.4.5 declares 8: darwin/linux/win32
× arm64/x64 plus two linux-musl). Your package manager installs only the host's.

So you normally do **not** declare them yourself. If you do — to control a multi-platform
launcher's install — pin every platform package to the **exact same version** as `@opentui/core`.
A caret on the JS half beside exact pins on the native half lets the two drift, and it surfaces as
a native crash rather than a version error.

Because the install is host-filtered, `bun build --compile --target=bun-linux-x64` on a mac
**fails at build time**: `error: Could not resolve: "@opentui/core-linux-x64". Maybe you need to
"bun install"?` The loader imports the platform package by name and only the host's exists.
**Build each target on its own native runner** — a matrix job, not a flag.

## 0.1.x is an abandoned line — the trade-off, stated

Pointing you at 0.1.107 for a compiled binary costs something real. `latest` is **0.5.1** (2026-08-06;
it was 0.4.5 when the compile rows above were measured), and 0.2.0
shipped the *same day* as 0.1.107 — the line is terminal, not merely quiet, which also makes "re-test on
every bump" unactionable. **The docs site describes 0.4.x and states no version number anywhere**, so docs
and a 0.1.x pin disagree in silence: a copied example that "should work" may not exist in your pin, so check
the shipped types rather than trust the site. 0.1.107 also drags a far heavier install — it declares `three`,
`planck`, `bun-webgpu` and a physics package as optional deps: **97 packages installed vs 19 for 0.4.5.**
Consider, in this order: **re-test 0.4.x `--compile`** (one upstream native-path bug, the likeliest thing to
be fixed, and fixing it deletes the trade-off entirely); **don't ship a compiled binary** — `bun run` and a
plain npm package both work on 0.4.x; **ship 0.4.x with its dependencies alongside**, the `--external` row
above; and only then **accept a stale, abandoned pin — knowingly**, if a self-contained binary is a hard
product requirement.

## If you re-pin, three things can break

Re-pinning is a one-line edit *only* for code inside the intersection of the two lines. The shipped
`assets/` stay there by construction; yours are portable only under the same three constraints.

| Constraint | Why |
|---|---|
| **≤5 React hooks** — only `useKeyboard`, `useRenderer`, `useOnResize`, `useTerminalDimensions`, `useTimeline` exist in both | MEASURED 2026-07-30 by resolving `@opentui/react/src/hooks/index.d.ts`: **5 hooks at 0.1.107, 9 at 0.4.5.** The other four — `useFocus`, `useBlur`, `usePaste`, `useSelectionHandler` — **will not compile** on 0.1.x. Count the *barrel*, not the directory: `use-event.d.ts` ships `useEffectEvent` in **both** versions but is re-exported by neither, so a file listing says 10 and only 9 are importable. |
| **`screenMode`, never `useAlternateScreen`** | The key was renamed. Code passing the old one silently does nothing on a current pin. |
| **No 0.4-only test helper** — `flush`, `waitFor`, `waitForFrame`, `waitForVisualIdle`, `externalOutput`, `getNativeStats` on the setup object; `ManualClock`, `createTerminalCapabilities`, `setRendererCapabilities` from `@opentui/core/testing` | Measured export lists: `core/testing` exports **9** names at 0.1.107, **12** at 0.4.5. Tests written against 0.4.x do not run on 0.1.x. |

## Runtime support

Works for TypeScript generally. Support is an **FFI question**, not a JS-compatibility one — which
is why the list is this short.

- **Bun — the only runtime that is tested and used.** Everything here was measured on it.
- **Node.js** is *documented* as needing **26.4.0+ with `--experimental-ffi`**. That figure is
  **doc-sourced and NOT verified here**; the package declares no `engines` field, so nothing in the
  install attests or enforces it.
- **Deno is entirely unverified.** No claim is made that it works.
- Other runtimes: at your own risk.

## Re-measure recipe

Substitute the version you care about. Run this before trusting any row above.

```bash
P=$(mktemp -d) && AWAY=$(mktemp -d) && cd "$P" && bun init -y >/dev/null   # mktemp, never a fixed /tmp/<name>: a
bun add @opentui/core@0.4.5 @opentui/react@0.4.5 react   # reused dir carries stale node_modules into a "clean" measurement
printf 'import{createTestRenderer}from"@opentui/core/testing"\nconst s=await createTestRenderer({width:20,height:4})\ntry{await s.renderOnce();console.log("native-ok")}finally{s.renderer.destroy()}\n' > probe.ts
bun run probe.ts; echo "source=$?"
bun build --compile probe.ts --outfile probe-bin && cp probe-bin "$AWAY" && (cd "$AWAY" && ./probe-bin; echo "binary=$?")
```

`createTestRenderer` is the right probe: it builds the **real native renderer** while skipping
terminal setup, so it loads `libopentui.dylib` without needing a TTY — exactly the step that fails
inside `/$bunfs/root/`. The `cp` into a **second** `mktemp -d` is the negative control: it catches
an `--external` build that passes only because `node_modules` was next door. Both lines printing
`native-ok` at exit 0 is the whole result.
