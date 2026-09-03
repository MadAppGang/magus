---
name: security-audit
description: Procedures dev:reviewer runs under a security focus — dependency-CVE audit commands per package manager, committed-secret grep patterns, GDPR/HIPAA/SOC 2 checklists. Use when auditing dependencies, hunting secrets, or checking compliance.
disable-model-invocation: true
---

# Security Audit Procedures

Procedures `dev:reviewer` runs under `FOCUS: security`, and a user reaches with
`/dev:security-audit`. This file supplies what the reviewer lacks: the commands that
query dependency vulnerability databases, the patterns that find committed secrets, and
the compliance checklist. It carries no vulnerability taxonomy, no severity scale and no
report format — the reviewer owns those (`agents/reviewer.md`, Phase 2 and Phase 5), and
findings from these procedures are rated and reported with the reviewer's criteria like
any other.

Run every procedure over the review target — a capture, a branch, or named files — and
report each finding with the file and line it came from.

## 1. Dependency vulnerabilities

**What to check:** packages with published CVEs, unmaintained dependencies, license
conflicts, transitive risk, version conflicts.

Run the auditor for each package manager present in the target:

| Manifest | Command |
|---|---|
| `package.json` + `bun.lock` | `bun audit` |
| `package.json` + `package-lock.json` | `npm audit --json` |
| `package.json` + `yarn.lock` | `yarn npm audit --json` (Yarn 2+) or `yarn audit --json` |
| `package.json` + `pnpm-lock.yaml` | `pnpm audit --json` |
| `go.mod` | `go mod verify && govulncheck ./...` (`go install golang.org/x/vuln/cmd/govulncheck@latest`) |
| `Cargo.toml` | `cargo audit` (`cargo install cargo-audit`) |
| `requirements.txt` / `pyproject.toml` | `pip-audit` or `safety check` |
| `Gemfile` | `bundle audit check --update` |

If the tool is not installed, say so and name the install line. Do not guess at CVEs
from memory, and do not report the dependency as clean.

For each vulnerability the tool reports, record:

- package and installed version, the CVE or advisory id, and its CVSS score
- whether a fixed version exists, and whether upgrading to it is breaking
- whether the vulnerable code path is reachable from the target — a transitive
  dependency the target never calls is a lower-priority finding than a direct one.
  Establish it with Grep, which is a tool you have. Search the package name at its
  import sites across the target's source, in the forms the stack uses:
  JS/TS `from ['"]<pkg>|require\(['"]<pkg>`, Go `"<module>(/|")`, Rust
  `<crate>::`, Python `^\s*(from|import)\s+<pkg>\b`. A direct import is reachable.
  No import means the package arrives transitively — then grep the lockfile for the
  direct dependency that pulls it in and name that one. Record the patterns you ran,
  so the rating can be checked.

A recorded finding looks like:

```
HIGH: axios@0.21.1 (CVE-2021-3749)
- Fix available: axios@0.21.4
- Breaking: No
- Run: npm install axios@0.21.4
```

## 2. Exposed secrets and credentials

**What to detect:** hardcoded API keys and tokens, database credentials, private keys
and certificates, OAuth secrets, cloud-provider credentials (AWS, GCP, Azure), JWT
secrets, encryption keys.

Search every tracked text file with these patterns. `git grep -I` walks the whole index
and skips binaries; it respects `.gitignore`, so an ignored `.env` never appears — the
correct result for a file that is not committed. No directory is out of scope: a
credential under `testdata/`, `__mocks__/`, `examples/` or in a `.example` file is
compromised exactly like one under `src/`, so nothing here excludes a path. Suppression
is by **value** only, as the last stage of a pipeline.

```bash
# Values that are placeholders wherever they sit — the only suppression allowed
PLACEHOLDER='example|changeme|xxx+|dummy|placeholder|test-key|<[^>]*>'

# Well-known secret formats — a match here is almost never a false positive
git grep -nIE 'AKIA[0-9A-Z]{16}|sk_(live|test)_[0-9A-Za-z]{20,}|ghp_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'

# Assignment-shaped secrets — needs a human read; the name is the signal, the value decides
git grep -nIEi "(api[_-]?key|secret|passw(or)?d|token|private[_-]?key)[[:space:]]*[:=][[:space:]]*['\"][^'\"\$]{8,}['\"]" \
  | grep -viE "['\"][^'\"]*(${PLACEHOLDER})[^'\"]*['\"]"

# JWTs pasted into source
git grep -nIE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'

# Environment files that were committed anyway
git ls-files | grep -E '(^|/)\.env(\.[a-z]+)?$' | grep -vE '\.(example|sample|template)$'
```

Also check:

- **Environment variable misuse** — a secret read from `process.env` / `os.Getenv` and
  then logged, returned in a response, or baked into a client bundle (`VITE_`,
  `NEXT_PUBLIC_` and `REACT_APP_` prefixes ship to the browser).
- **Configuration files** — `config/*.{json,yaml,toml}`, CI workflow files and
  Dockerfiles, for inline credentials.
- **Git history, when asked** — a secret removed in a later commit is still in the
  repository: `git log -p --all -S'<the secret or its prefix>' -- . | head`. Report it as
  exposed; rotation is the fix, not deletion.

**False-positive reduction — by value, never by path:**

- A value that is itself a placeholder — `example`, `changeme`, `xxx`, `dummy`,
  `placeholder`, `test-key`, anything in angle brackets like `<your-key>` — is not a
  finding, whichever file it sits in. That is the `PLACEHOLDER` stage above.
- A real-looking value is a finding whichever file it sits in: a live key in a test, a
  mock, testdata or a `.example` file is as exposed as one in `src/`. A directory
  exclusion is how it stays exposed — do not add one.
- Validate against `.env.example`: a variable named there and read from the environment
  in code is the correct pattern — report only the places a literal was used instead.
- Confirm the match is inside code or config, not a comment explaining what a key looks
  like.

## 3. Compliance checklist

Run when the request names a regime, or when the target handles personal data.

**GDPR** — check that the target has, or does not undermine:

- a data retention policy, with deletion actually implemented, not just documented
- user consent recorded before personal data is processed
- right to erasure: an endpoint or job that removes a user's data on request
- data export: a way for a user to obtain their data in a portable format
- encryption at rest and in transit for personal data (TLS 1.2 or later; no plaintext
  PII in logs or backups)
- privacy policy references that point at the current policy
- third-party data sharing that is disclosed and, where required, consented to

Record the result per item, so the report reads:

```
GDPR
[PASS] Data encryption at rest
[FAIL] Missing data retention policy
[FAIL] No user data export endpoint
[PASS] Consent management implemented
[WARN] Privacy policy link outdated
[PASS] TLS 1.3 enforced
```

**HIPAA** and **SOC 2** requests: apply the same shape — access control, audit logging,
encryption, retention, and breach-notification paths — and say plainly which controls
you could verify from the code and which need evidence outside the repository.

## Reporting

Report through the reviewer's own format and severity criteria. This file adds
procedures, not a scale: a committed live credential is rated by the reviewer's
CRITICAL definition, an unpatched CVE by the reachability established above, and a
compliance gap by the impact of the missing control.
