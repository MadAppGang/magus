# Supply chain

Your dependency tree runs with your process's full privileges. A typical service has a handful of
direct dependencies and hundreds of transitive ones, every one of which can read your environment,
your filesystem and your network.

## `bun audit`

```bash
bun audit                 # MEASURED to work standalone → "No vulnerabilities found"
bun audit --audit-level=high
```

Run it in CI on every PR and on a schedule — a dependency you have not touched becomes vulnerable
when someone publishes an advisory, so a PR-only gate goes stale on quiet repos.

Advisories are noisy. Triage on **reachability**: a prototype-pollution advisory in a package you
only use at build time is not the same as one in your request path. Record the reasoning when you
accept a finding, or the same triage gets redone every week and eventually rubber-stamped.

## Lockfiles

```bash
bun install --frozen-lockfile   # CI: fail rather than silently resolve something new
```

Commit `bun.lock`. Without `--frozen-lockfile`, CI can install a version nobody reviewed, so the
artifact you test is not the artifact you built. MEASURED: the flag succeeds against a committed
lockfile and is the correct CI default.

Bun 1.3 installs workspaces with an **isolated, pnpm-style layout** (MEASURED): packages live in
`node_modules/.bun/<name>@<version>/` and each member gets symlinks. Root `node_modules/` holds no
hoisted dependencies. This matters for security as well as correctness — **a package can only
import what it declares**, so a transitive dependency cannot be silently used (and cannot silently
become a direct dependency you never reviewed).

## Install scripts

`postinstall` runs arbitrary code at install time, on developer laptops and on CI runners that
usually hold more credentials than production does. This is the most-used vector in real npm
supply-chain attacks.

Bun does **not** run install scripts for arbitrary dependencies by default; packages must be listed
in `trustedDependencies` in `package.json`. Keep that list short and justified — every entry is
code you have agreed to execute.

```json
{ "trustedDependencies": ["some-native-module"] }
```

## Adding a dependency

The cheapest security decision available is **not** adding one. Before `bun add`:

- Is it a few lines you could write and own? `left-pad` is the joke; the pattern is not.
- Bun replaces a lot of the classic dependency set natively: `Bun.password` (bcrypt/argon2),
  `Bun.$` (execa), `bun:sqlite` (better-sqlite3), `Bun.serve` (express), `bun:test` (jest),
  `Bun.file`/`Bun.write` (fs-extra), `Bun.Glob` (glob), `Bun.YAML`/`Bun.TOML`, `Bun.semver`.
  Check the native surface first.
- **Prefer native JS over utility libraries.** `structuredClone`, `Object.groupBy`, `Array.at`,
  `toSorted`, `flatMap` and optional chaining cover most of what lodash was for.

When you do add one, look at: recent releases, open critical issues, maintainer count (a single
maintainer is a single point of compromise), install-script presence, and transitive count — a
package pulling 40 dependencies is 40 more trust decisions you did not make.

## Pin what executes in CI

Pin GitHub Actions **by commit SHA**, not tag — tags are mutable, so `@v4` is "whatever the
maintainer points it at today":

```yaml
- uses: oven-sh/setup-bun@4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5   # v2
```

Give `GITHUB_TOKEN` the minimum scope (`permissions: contents: read`), and never expose release
secrets to a workflow triggered by `pull_request_target` on a fork.

## Secrets in the repository and image

- **`.env` in `.gitignore`.** Bun auto-loads `.env`, which is convenient and exactly why it must
  never be committed or copied into a Docker layer. `COPY . .` with a stray `.env` ships production
  credentials inside the image — deleting it in a later layer does not remove it from the image.
- Use `.dockerignore` as well as `.gitignore`; they are separate lists and people update only one.
- **A committed secret is compromised** even after the commit is removed. Rotate it; history is
  cloned, cached and mirrored.
- Scan history (`gitleaks`, `trufflehog`) once, then keep a pre-commit or CI scan so it stays clean.
- MEASURED: `bun build --compile` **autoloads `.env` by default**. For a compiled binary, either
  pass `--no-compile-autoload-dotenv` or be certain no `.env` sits beside it in production.

## Reproducibility

Same lockfile plus same base image should produce the same artifact. Pin the Bun version explicitly
in CI and in your Dockerfile (`oven/bun:1.3.10-alpine`, not `oven/bun:latest`) — otherwise a runtime
upgrade lands in production without a code change, which is both a reliability and a security event.

Generate an SBOM if you ship to anyone who will ask for one; it turns "are we affected by this CVE"
from an investigation into a query.

## Least privilege at runtime

- Run as a **non-root** user in the container. A compromise then starts unprivileged.
- Read-only root filesystem where possible; mount only the paths that must be writable.
- Egress restrictions: a service that only talks to your database and one API should not be able to
  reach the whole internet. This is what turns a dependency compromise from exfiltration into a
  failed connection.
