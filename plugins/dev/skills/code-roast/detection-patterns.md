# Detection Patterns — Three-Tier Detection System

> Organized by tier (built-in → CLI → cloud) and severity (CAPITAL first).
> All patterns are grep/rg-compatible unless noted. Use `Grep` tool with these patterns.

---

## Tier 1: Built-in Detection (Grep/Rg)

**ALWAYS available. Zero dependencies. Use these first.**

### CAPITAL Offense Patterns

```
# C#: async void (non-event-handler) → CSHARP-01
Pattern: async\s+void\s+\w+\s*\((?!.*EventHandler)
Files: *.cs

# C#: Task.Result / .Wait() blocking → CSHARP-02
Pattern: \.(?:Result|Wait\(\))\s*[;,)]
Files: *.cs

# SQL: String concatenation injection → SQL-09
Pattern: (?:query|sql|stmt)\s*[+=]\s*["'].*\+.*(?:request|user|input|param)
Files: *.go, *.java, *.cs, *.py, *.ts, *.js

# Python: Mutable default arguments → PY-01
Pattern: def\s+\w+\s*\([^)]*\b\w+\s*=\s*(?:\[\]|\{\}|\(\))\s*[,)]
Files: *.py

# Microservice: Distributed monolith signal → UNI-11
Pattern: (?:shared[_-]?db|synchronized[_-]?deploy)
Files: *.yaml, *.yml, *.md, docker-compose*

# DevOps: Privileged containers → UNI-33
Pattern: privileged:\s*true
Files: *.yaml, *.yml

# Hardcoded secrets → UNI-44
Pattern: (?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9+/=]{16,}
Files: *.go, *.java, *.py, *.ts, *.js, *.cs, *.env, *.yaml
```

### FELONY Patterns

```
# Go: Error silently discarded → GO-01
Pattern: ,\s*_\s*(?::)?=\s*\w+\(
Files: *.go

# Go: Goroutine without lifecycle management → GO-02, GO-16
Pattern: go\s+func\s*\(
Files: *.go
# Follow-up: Check if context.Done, WaitGroup, cancel(), or errgroup are nearby

# Go: Context not propagated → GO-03
Pattern: context\.Background\(\)
Files: *.go
# Flag if inside a function that already receives ctx parameter

# Go: Panic in library code → GO-12
Pattern: panic\(
Files: *.go (exclude main package, test files)

# Python: Bare except → PY-02
Pattern: except\s*:\s*(?:pass)?$
Files: *.py

# Python: Blocking call in async → PY-07
Pattern: (?:requests\.(?:get|post|put|delete|patch)|time\.sleep|open\()
Files: *.py
# Flag only inside async def functions

# TypeScript: Floating promise → TS-05
# Best detected by eslint; grep approximation:
Pattern: ^\s+\w+\.\w+\([^)]*\)\s*;?\s*$
Files: *.ts, *.tsx (look for unhandled async calls)

# TypeScript: as unknown as T → TS-09
Pattern: as\s+unknown\s+as\s+[A-Z]\w+
Files: *.ts, *.tsx

# Java: Empty catch block → JAVA-03
# Use multiline grep:
Pattern: catch\s*\([^)]+\)\s*\{\s*\}
Files: *.java

# Java: Catching generic Exception → JAVA-13
Pattern: catch\s*\(\s*(?:Exception|Throwable)\s+\w+\s*\)
Files: *.java

# C#: IDisposable not in using → CSHARP-04
Pattern: new\s+(?:HttpClient|SqlConnection|StreamReader|StreamWriter|FileStream)\s*\(
Files: *.cs
# Flag if not inside using statement

# C#: Thread.Sleep in async → CSHARP-14
Pattern: Thread\.Sleep\(
Files: *.cs

# C#: lock(this) → CSHARP-18
Pattern: lock\s*\(\s*this\s*\)
Files: *.cs

# C#: new HttpClient() per request → CSHARP-20
Pattern: new\s+HttpClient\s*\(
Files: *.cs

# HTML: Missing alt on images → HTMLCSS-02
Pattern: <img\s+(?![^>]*alt=)[^>]*>
Files: *.html, *.htm, *.jsx, *.tsx

# HTML: Missing viewport meta → HTMLCSS-06
# Absence check: grep -L for viewport in HTML files
Pattern: name=["']viewport["']
Files: *.html (flag files WITHOUT this match)

# HTML: Missing focus styles → HTMLCSS-13
Pattern: outline:\s*(?:none|0)\s*;
Files: *.css, *.scss

# HTML: Forms without labels → HTMLCSS-15
Pattern: <input\s+(?![^>]*id=["'][^"']*["'][^>]*<label)
Files: *.html (simplified; axe-core is more accurate)

# Dependencies: Unpinned → UNI-36
Pattern: ["']\*["']|["']>=
Files: package.json, requirements.txt

# DevOps: :latest tag → UNI-34
Pattern: image:\s*\S+:latest
Files: *.yaml, *.yml, Dockerfile

# DevOps: No resource limits → UNI-32
# Absence check in k8s manifests
Pattern: resources:\s*$
Files: *.yaml (flag container specs WITHOUT resources)

# Hardcoded config → UNI-40
Pattern: (?:postgresql|mysql|mongodb):\/\/\w+:\w+@|sk_live_|sk_test_
Files: *.go, *.java, *.py, *.ts, *.js, *.cs, *.env
```

### CRIME Patterns

```
# Go: defer in loop → GO-04
# Use multiline grep:
Pattern: for\s+.*\{[\s\S]*?defer\s+
Files: *.go

# Go: Error wrapping with %v instead of %w → GO-15
Pattern: fmt\.Errorf\([^)]*%v[^)]*err
Files: *.go

# Go: init() for side effects → GO-07
Pattern: ^func\s+init\s*\(\s*\)
Files: *.go

# Go: interface{}/any in struct fields → GO-08, GO-17
Pattern: (?:interface\{\}|any)\s+
Files: *.go (in struct definitions and func signatures)

# Go: Type assertion without ok → GO-20
Pattern: \.\(\w+\)(?!\s*$)
Files: *.go (outside type switch)

# Go: Sentinel error misuse → GO-14
Pattern: \.Error\(\)\s*==
Files: *.go

# Go: Global variables → GO-19
Pattern: ^var\s+\w+\s+
Files: *.go (in non-test, non-main files)

# CSS: !important abuse → HTMLCSS-01
Pattern: !important\s*;
Files: *.css, *.scss
# Count occurrences; flag if >5 per file

# CSS: z-index chaos → HTMLCSS-03
Pattern: z-index:\s*(?:\d{4,}|9{3,})
Files: *.css, *.scss

# CSS: Specificity wars → HTMLCSS-10
# Count selector depth; flag deeply nested
Pattern: \S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\{
Files: *.css, *.scss

# CSS: Fixed pixel widths → HTMLCSS-11
Pattern: width:\s*\d{3,}px
Files: *.css, *.scss

# CSS: Render-blocking scripts → HTMLCSS-12
Pattern: <script\s+(?![^>]*(?:defer|async))[^>]*src=
Files: *.html

# TypeScript: any proliferation → TS-02
Pattern: :\s*any\b|as\s+any\b
Files: *.ts, *.tsx
# Count occurrences; flag if >3 per file

# TypeScript: Barrel file chains → TS-01
Pattern: export\s+\*\s+from
Files: index.ts, index.tsx

# TypeScript: Circular deps signal → TS-13
# Use madge for accurate detection; grep approximation:
Pattern: from\s+['"]\.\.\/
Files: *.ts, *.tsx (suspicious if mutual)

# SQL: SELECT * → SQL-01
Pattern: SELECT\s+\*\s+FROM
Files: *.sql, *.go, *.java, *.py, *.ts, *.cs

# SQL: OFFSET pagination → SQL-08
Pattern: OFFSET\s+\d+|LIMIT\s+\d+\s+OFFSET
Files: *.sql, *.go, *.java, *.py

# React: key={index} → REACT-05
Pattern: key=\{(?:index|i|idx|k)\}
Files: *.tsx, *.jsx

# React: Inline objects in JSX → REACT-03
Pattern: \w+=\{\{
Files: *.tsx, *.jsx
# Flag object literals passed as props

# Python: global keyword → PY-06
Pattern: ^\s*global\s+\w+
Files: *.py

# Python: os.system → PY-08
Pattern: os\.system\s*\(
Files: *.py

# Python: datetime.now() without tz → PY-10
Pattern: datetime\.now\(\s*\)
Files: *.py

# Python: import * → PY-12
Pattern: from\s+\w+\s+import\s+\*
Files: *.py

# Java: String == comparison → JAVA-11
Pattern: \w+\s*==\s*["']|["']\s*==\s*\w+
Files: *.java

# Java: String concat in loop → JAVA-07
# Flag += on String inside for/while loops
Pattern: \+=\s*["']
Files: *.java (inside loops)

# Java: java.util.Date → JAVA-20
Pattern: import\s+java\.util\.Date
Files: *.java

# Testing: Flaky test signals → UNI-22
Pattern: retryTimes|retry:|flaky|@Retry
Files: *.json, *.yaml, *.java, *.ts

# Testing: Test naming → UNI-27
Pattern: (?:def|func|it\(|test\()\s*["']?test\d+
Files: *.py, *.go, *.ts, *.js, *.java

# TODO cemetery → UNI-43
Pattern: (?:TODO|FIXME|HACK|TEMP).*20(?:1[0-9]|2[0-3])
Files: * (all source files)

# No lock file → UNI-38
# Absence check: look for package.json without package-lock.json in same dir
```

### SLOP Patterns (AI-Generated Code Detection)

```
# Narrative comments → SLOP-04
Pattern (Python): #\s+(?:This code|The function|We create|This method|This variable|Here we)
Pattern (JS/TS): \/\/\s+(?:This code|The function|We create|This method)
Files: *.py, *.ts, *.js, *.tsx, *.jsx, *.go, *.java, *.cs

# Forbidden comment phrases → SLOP-09
Pattern: (?i)(?:don't touch|magic number|not sure why|trust me|somehow works|I don't know why|works don't ask)
Files: * (all source files)

# Unnecessary await on sync value → SLOP-07
Pattern: await\s+\d+|await\s+["']
Files: *.ts, *.js, *.tsx, *.jsx

# Type gaslighting → TS-09 / SLOP overlap
Pattern: as\s+unknown\s+as\s+[A-Z]\w+
Files: *.ts, *.tsx

# Deprecated React patterns → SLOP-02
Pattern: componentWillMount|componentWillReceiveProps|componentWillUpdate
Files: *.tsx, *.jsx, *.ts, *.js

# Mixed async styles in same file → SLOP-08
# Check files containing BOTH patterns:
Pattern 1: await\s+
Pattern 2: \.then\s*\(
Files: *.ts, *.js, *.tsx, *.jsx
# Flag files matching BOTH patterns

# var in modern code → SLOP-10 (JS-specific)
Pattern: ^\s*var\s+
Files: *.ts, *.js, *.tsx, *.jsx

# print + logging mixed → SLOP-10 (Python-specific)
# Check files containing BOTH:
Pattern 1: print\s*\(
Pattern 2: logging\.\w+\(
Files: *.py
```

### MISDEMEANOR & PARKING TICKET Patterns

```
# Go: Naked returns → GO-05
# Use nakedret linter for accuracy

# Go: Package stutter → GO-06
# Use revive for accuracy; grep approximation:
Pattern: package\s+(\w+)[\s\S]*?type\s+\1
Files: *.go

# Go: String concat in loop → GO-10
Pattern: \+=\s*
Files: *.go (inside for loops)

# CSS: Inline styles → HTMLCSS-05
Pattern: style=["']
Files: *.html, *.htm, *.tsx, *.jsx

# CSS: ID selectors → HTMLCSS-17
Pattern: #[a-zA-Z]\w+\s*\{
Files: *.css, *.scss

# CSS: Float layout → HTMLCSS-16
Pattern: float:\s*(?:left|right)
Files: *.css, *.scss

# CSS: No custom properties → HTMLCSS-08
# Count repeated hex values
Pattern: #[0-9a-fA-F]{6}
Files: *.css, *.scss
# Flag if same hex appears 5+ times

# TypeScript: enum → TS-06
Pattern: ^\s*(?:export\s+)?enum\s+\w+
Files: *.ts, *.tsx

# SQL: CTE overkill → SQL-05
Pattern: WITH\s+\w+\s+AS\s*\(\s*SELECT[^)]{0,100}\)
Files: *.sql

# Magic numbers → UNI-41
Pattern: (?<![.\w])\d{2,}(?!\s*[;{}%)px"'rem])
Files: * (crude; use eslint no-magic-numbers for accuracy)

# Images without dimensions → HTMLCSS-18
Pattern: <img\s+(?![^>]*(?:width|height))[^>]*>
Files: *.html, *.htm
```

---

## Tier 2: CLI Tool Detection (Optional — No Sign-In Required)

**Check availability with `which`. Only use if installed. Do NOT ask user to install.**

### Multi-Language Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **semgrep** | `which semgrep` | `semgrep --config auto --json --output /tmp/semgrep.json .` | JSON | Custom rules across all languages |
| **lizard** | `which lizard` | `lizard . --output_file /dev/stdout -l json` | JSON | Cyclomatic complexity across all languages |
| **gitleaks** | `which gitleaks` | `gitleaks detect --report-format json --report-path /dev/stdout` | JSON | Secrets in git history (UNI-44) |
| **detect-secrets** | `which detect-secrets` | `detect-secrets scan --all-files .` | JSON | API keys, passwords, tokens |
| **trivy** | `which trivy` | `trivy fs --format json .` | JSON | Secrets, IaC misconfig, CVEs |
| **ast-grep** | `which sg` | `sg --pattern 'PATTERN' --lang LANG --json` | JSON | Structural AST patterns |

### Go Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **golangci-lint** | `which golangci-lint` | `golangci-lint run ./... --out-format json 2>/dev/null` | JSON | 100+ linters: GO-01 through GO-21 |
| **staticcheck** | `which staticcheck` | `staticcheck -f json ./...` | JSON | SA/S/ST/U checks: correctness, style |
| **go vet** | `which go` | `go vet ./... 2>&1` | Text | GO-09 (mutex copy), GO-21 (waitgroup), basics |
| **errcheck** | `which errcheck` | `errcheck -json ./...` | JSON | GO-01 (ignored errors) |
| **gosec** | `which gosec` | `gosec -fmt json ./...` | JSON | SQL injection, hardcoded creds, path traversal |
| **revive** | `which revive` | `revive -formatter json ./...` | JSON | GO-04 (defer), GO-06 (stutter), GO-12 (panic) |

### Java Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **spotbugs** | `which spotbugs` | `spotbugs -textui -xml:withMessages classes/` | XML | JAVA-02,03,04,08,10,11,13,15 |
| **pmd** | `which pmd` | `pmd check -d src/ -R category/java/design.xml -f json` | JSON | JAVA-05,07,12,16,18 |
| **checkstyle** | `which checkstyle` | `checkstyle -c /google_checks.xml -f xml src/` | XML | JAVA-01,03,11,16 |

### C# Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **dotnet (analyzers)** | `which dotnet` | `dotnet build /p:EnableNETAnalyzers=true /p:AnalysisMode=AllEnabledByDefault` | SARIF | CSHARP-01 through CSHARP-22 |
| **roslynator** | `which roslynator` | `roslynator analyze --format sarif solution.sln` | SARIF | 500+ analyzers |

### TypeScript/JavaScript Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **eslint** | `which eslint` or check node_modules | `npx eslint --format json src/` | JSON | TS-01 through TS-15, REACT-01 through REACT-10 |
| **biome** | `which biome` or check node_modules | `npx biome lint --reporter=json src/` | JSON | Correctness, suspicious, complexity |
| **oxlint** | `which oxlint` | `oxlint --format json src/` | JSON | 500+ ESLint-compatible rules |
| **knip** | check node_modules | `npx knip --reporter json` | JSON | TS-14 (unused deps), dead exports |
| **madge** | check node_modules | `npx madge --circular --json src/` | JSON | TS-13 (circular deps) |

### Python Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **ruff** | `which ruff` | `ruff check --output-format json .` | JSON | PY-01 through PY-15 (800+ rules) |
| **pylint** | `which pylint` | `pylint --output-format=json src/` | JSON | PY-01,02,03,04,06,12,13 |
| **mypy** | `which mypy` | `mypy --output json src/` | JSON | PY-03 (type hints) |
| **bandit** | `which bandit` | `bandit -r -f json src/` | JSON | PY-08 (os.system), SQL injection |

### HTML/CSS Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **stylelint** | check node_modules | `npx stylelint "**/*.css" --formatter json` | JSON | HTMLCSS-01,03,05,08,10,11,17 |
| **htmlhint** | check node_modules | `npx htmlhint --format json "**/*.html"` | JSON | HTMLCSS-02,04,06,15 |

### SQL Tools

| Tool | Check | Run Command | Output | Detects |
|------|-------|-------------|--------|---------|
| **sqlfluff** | `which sqlfluff` | `sqlfluff lint --format json queries/` | JSON | SQL-01,04,05,08 |

---

## Tier 3: Cloud API Detection (OPTIONAL — Sign-In Required)

**These require API keys or account setup. CLEARLY MARK AS OPTIONAL.**
**NEVER fail the roast if these are unavailable.**

### Cloud Services

| Service | Env Var Check | API Pattern | What It Adds | Sign-Up URL |
|---------|--------------|-------------|--------------|-------------|
| **SonarCloud** | `$SONAR_TOKEN` | `curl -u $SONAR_TOKEN: "https://sonarcloud.io/api/issues/search?componentKeys=PROJECT"` | 3000+ smell rules, complexity metrics, quality gates | sonarcloud.io |
| **GitHub Code Scanning** | `$GITHUB_TOKEN` or `gh auth status` | `gh api repos/{owner}/{repo}/code-scanning/alerts` | CodeQL results if enabled on repo | github.com/features/security |
| **Snyk Code** | `$SNYK_TOKEN` | `snyk code test --json` (CLI) | SAST security focus, SARIF output | snyk.io |
| **DeepSource** | `$DEEPSOURCE_TOKEN` | GraphQL API | Autofix suggestions | deepsource.com |
| **CodeClimate** | `$CODECLIMATE_TOKEN` | `curl "https://api.codeclimate.com/v1/repos/{id}/issues"` | Tech debt estimate in hours | codeclimate.com |
| **Codacy** | `$CODACY_TOKEN` | `curl "https://app.codacy.com/api/v3/..."` | File complexity, patterns | codacy.com |

### Integration Pattern

```
# Check for cloud service availability (run silently at start):

# SonarCloud
if [ -n "$SONAR_TOKEN" ]; then
  # Available — include in detection
fi

# GitHub Code Scanning (via gh CLI)
if gh auth status 2>/dev/null; then
  # Available — check for code scanning alerts
fi

# Snyk
if [ -n "$SNYK_TOKEN" ] && which snyk >/dev/null 2>&1; then
  # Available — run security scan
fi
```

### What Cloud Services Add Beyond Tier 1 + 2

- **Historical trend data** — SonarCloud/CodeClimate track debt over time
- **Cross-project benchmarks** — "Your complexity is worse than 80% of projects this size"
- **Autofix suggestions** — DeepSource can suggest specific code fixes
- **Security depth** — Snyk has the deepest vulnerability database
- **Tech debt quantification** — CodeClimate estimates hours to fix

---

## Detection Strategy Summary

```
Phase 1: Acquire target files (git diff, user path, or full project scan)
    ↓
Phase 2: Run Tier 1 (Grep) patterns — ALWAYS
    ↓ results[]
Phase 3: Check Tier 2 tools (which/npx) — run available ones
    ↓ results[] += tool findings
Phase 4: Check Tier 3 env vars — run if available (OPTIONAL)
    ↓ results[] += cloud findings
Phase 5: Deduplicate and merge by file:line
    ↓
Phase 6: Sort by severity (CAPITAL → PARKING TICKET)
    ↓
Phase 7: Map to sin-registry.md entries for roast lines
    ↓
Phase 8: Generate roast output with citations
```

### Severity-to-Priority Mapping from Tool Output

| Tool Severity | Sin Registry Severity |
|---------------|----------------------|
| error / blocker / critical | CAPITAL or FELONY |
| major / warning | CRIME |
| minor / info | MISDEMEANOR |
| note / style | PARKING TICKET |
| (AI pattern match) | SLOP |
