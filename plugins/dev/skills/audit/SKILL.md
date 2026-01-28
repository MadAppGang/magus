---
name: audit
description: On-demand security and code quality audit. Use when checking for vulnerabilities, security issues, code smells, or compliance problems. Trigger keywords - "audit", "security check", "vulnerability scan", "code quality", "compliance", "security audit".
version: 0.1.0
tags: [dev, audit, security, quality, compliance]
keywords: [audit, security, vulnerability, code-quality, compliance, scan, check]
plugin: dev
updated: 2026-01-28
---

# Audit Skill

## Overview

The audit skill provides comprehensive on-demand security and code quality audits for your codebase. It identifies vulnerabilities, security issues, code smells, outdated dependencies, exposed secrets, and compliance problems across all supported technology stacks.

**When to Use**:
- Security audits and vulnerability scans
- Pre-deployment security checks
- Compliance verification (GDPR, HIPAA, SOC2)
- Code quality assessment
- Dependency vulnerability scanning
- Secret exposure detection
- Third-party license compliance

**Technology Coverage**:
- React/TypeScript/JavaScript projects
- Go applications
- Rust projects
- Python codebases
- Full-stack applications
- Monorepos and microservices

## Audit Categories

### 1. Security Vulnerabilities (OWASP Top 10)

**What Gets Checked**:
- SQL injection vulnerabilities
- Cross-site scripting (XSS)
- Authentication and session management flaws
- Security misconfigurations
- Sensitive data exposure
- XML external entities (XXE)
- Broken access control
- Cross-site request forgery (CSRF)
- Using components with known vulnerabilities
- Insufficient logging and monitoring

**Detection Methods**:
- Static code analysis
- Pattern matching for common vulnerabilities
- Framework-specific security checks
- API endpoint security validation
- Input validation analysis

### 2. Dependency Vulnerabilities

**What Gets Checked**:
- Outdated packages with known CVEs
- Unmaintained dependencies
- License compatibility issues
- Transitive dependency risks
- Version conflicts

**Package Managers Supported**:
- npm/yarn/pnpm (JavaScript/TypeScript)
- go.mod (Go)
- Cargo.toml (Rust)
- requirements.txt/pyproject.toml (Python)
- Gemfile (Ruby)

**Tools Used**:
- `npm audit` / `yarn audit` / `pnpm audit`
- `go mod verify` + vulnerability databases
- `cargo audit`
- `pip-audit` / `safety`

### 3. Exposed Secrets and Credentials

**What Gets Detected**:
- Hardcoded API keys and tokens
- Database credentials
- Private keys and certificates
- OAuth tokens and secrets
- AWS/GCP/Azure credentials
- JWT secrets
- Encryption keys

**Detection Patterns**:
- Regex patterns for common secret formats
- Environment variable misuse
- Configuration file analysis
- Git history scanning (if requested)
- Common secret naming patterns

**False Positive Reduction**:
- Ignore test fixtures and mocks
- Respect `.gitignore` patterns
- Check for proper environment variable usage
- Validate against `.env.example` templates

### 4. Code Quality Issues

**What Gets Analyzed**:
- Code complexity (cyclomatic complexity)
- Code duplication
- Dead code and unused exports
- Large functions and files
- Naming convention violations
- Magic numbers and hardcoded values
- Lack of error handling
- Poor separation of concerns

**Metrics Calculated**:
- Cyclomatic complexity per function
- Duplication percentage
- Lines of code (LOC) per file/function
- Comment-to-code ratio
- Test-to-code ratio

## Running Audits

### Full Audit

Run all audit categories:

```
Please run a full security and quality audit of this codebase
```

The audit will:
1. Scan all source files for vulnerabilities
2. Check dependencies for known CVEs
3. Search for exposed secrets
4. Analyze code quality metrics
5. Generate comprehensive report

### Category-Specific Audits

**Security Only**:
```
Run a security audit focusing on OWASP top 10 vulnerabilities
```

**Dependencies Only**:
```
Audit all dependencies for vulnerabilities and outdated packages
```

**Secrets Only**:
```
Scan for exposed secrets and credentials
```

**Code Quality Only**:
```
Analyze code quality and identify code smells
```

### Targeted Audits

**Specific Directory**:
```
Audit the /src/auth directory for security issues
```

**Specific Files**:
```
Audit UserController.ts and AuthService.ts for vulnerabilities
```

**Pre-Deployment**:
```
Run pre-deployment audit checklist
```

## Audit Report Format

### Severity Levels

Reports classify findings by severity:

- **CRITICAL**: Immediate security risk, exploitable vulnerability
- **HIGH**: Significant security or quality issue
- **MEDIUM**: Moderate issue that should be addressed
- **LOW**: Minor issue or code smell
- **INFO**: Informational finding, best practice suggestion

### Report Structure

```markdown
# Security and Quality Audit Report

**Generated**: 2026-01-28 14:32:00
**Scope**: Full codebase audit
**Files Scanned**: 247
**Duration**: 8.3 seconds

## Executive Summary

- CRITICAL: 2 findings
- HIGH: 5 findings
- MEDIUM: 12 findings
- LOW: 23 findings
- INFO: 8 findings

**Risk Score**: 7.2/10 (HIGH)

## Critical Findings

### [CRITICAL-001] SQL Injection Vulnerability
**File**: src/database/queries.ts:42
**Severity**: CRITICAL
**Category**: Security - SQL Injection

**Issue**: User input concatenated directly into SQL query without sanitization.

**Code**:
```typescript
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

**Impact**: Attacker can execute arbitrary SQL commands.

**Recommendation**: Use parameterized queries or ORM.

**Fix**:
```typescript
const query = db.prepare('SELECT * FROM users WHERE email = ?').bind(email);
```

---

### [CRITICAL-002] Exposed API Key
**File**: src/config/api.ts:15
**Severity**: CRITICAL
**Category**: Security - Exposed Secret

**Issue**: Hardcoded API key found in source code.

**Code**:
```typescript
const STRIPE_SECRET_KEY = "sk_live_abc123xyz789";
```

**Impact**: Unauthorized access to Stripe account.

**Recommendation**: Move to environment variable.

**Fix**:
```typescript
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
```

## High Priority Findings

### [HIGH-001] Outdated Dependency with Known CVE
**File**: package.json:23
**Severity**: HIGH
**Category**: Dependencies

**Issue**: lodash@4.17.15 has known vulnerability (CVE-2021-23337)

**CVE Details**:
- CVE-2021-23337: Command injection in template
- Published: 2021-02-15
- CVSS Score: 7.2

**Recommendation**: Upgrade to lodash@4.17.21 or higher

**Fix**:
```bash
npm install lodash@latest
```

[... additional findings ...]

## Compliance Checks

### OWASP Top 10 Coverage
- [FAIL] A1: Injection - 2 SQL injection vulnerabilities found
- [PASS] A2: Broken Authentication
- [FAIL] A3: Sensitive Data Exposure - 1 exposed secret
- [PASS] A4: XML External Entities
- [PASS] A5: Broken Access Control
- [FAIL] A6: Security Misconfiguration - CORS too permissive
- [PASS] A7: Cross-Site Scripting
- [PASS] A8: Insecure Deserialization
- [FAIL] A9: Using Components with Known Vulnerabilities - 3 outdated deps
- [WARN] A10: Insufficient Logging - Limited audit logging

**Overall**: 6/10 passing (60%)

## Recommendations

1. **Immediate Actions** (CRITICAL/HIGH):
   - Fix SQL injection in queries.ts
   - Remove hardcoded API key
   - Upgrade vulnerable dependencies

2. **Short Term** (MEDIUM):
   - Improve error handling consistency
   - Add input validation to all API endpoints
   - Configure stricter CORS policy

3. **Long Term** (LOW/INFO):
   - Reduce code duplication (12% current)
   - Refactor complex functions (8 functions >15 complexity)
   - Improve test coverage (currently 67%)
```

## Integration with Dev Plugin

### With Code Analysis Agent

Use code-analysis enrichment before audit:

```
First enrich the codebase with claudemem, then run security audit
```

This provides:
- Context-aware vulnerability detection
- Better false positive filtering
- Dependency graph analysis

### With Test Architect Agent

Combine audit with test coverage:

```
Run audit and identify untested critical code paths
```

### With Optimize Skill

Security-performance trade-offs:

```
Audit security implications of performance optimizations
```

## Best Practices

### 1. Regular Audits

**Recommended Schedule**:
- Daily: Dependency vulnerability scans (CI/CD)
- Weekly: Full security audit
- Pre-deployment: Comprehensive audit
- Post-incident: Targeted security review

### 2. Incremental Audits

For large codebases:

```
Audit files changed in the last 7 days
```

This focuses on recent changes and reduces noise.

### 3. Baseline and Track

**First Audit**:
```
Run full audit and establish security baseline
```

**Subsequent Audits**:
```
Run audit and compare against baseline
```

Track improvements over time.

### 4. Prioritize by Risk

Focus on:
1. User-facing authentication code
2. Payment processing
3. Data storage and retrieval
4. API endpoints with PII
5. Third-party integrations

### 5. Automate in CI/CD

**GitHub Actions Example**:
```yaml
- name: Security Audit
  run: |
    npm audit --audit-level=high
    # Run custom audit script
```

**Pre-commit Hook**:
```bash
#!/bin/bash
# Scan staged files for secrets
git diff --cached --name-only | xargs grep -E "(api_key|secret|password)"
```

## Examples

### Example 1: Pre-Deployment Security Audit

**Request**:
```
We're deploying to production tomorrow. Run a comprehensive security audit.
```

**Audit Process**:
1. Scan all source files for OWASP top 10
2. Check all dependencies for CVEs
3. Search for exposed secrets
4. Verify CORS and authentication config
5. Check logging and monitoring setup

**Report Highlights**:
- 1 CRITICAL: Exposed database password
- 2 HIGH: Outdated dependencies with CVEs
- 5 MEDIUM: Missing input validation
- Compliance: 8/10 OWASP categories passing

**Outcome**: Deployment blocked until CRITICAL/HIGH fixed

### Example 2: Dependency Vulnerability Scan

**Request**:
```
Check all npm dependencies for known vulnerabilities
```

**Process**:
1. Run `npm audit --json`
2. Parse vulnerability reports
3. Check for available fixes
4. Identify breaking changes

**Report**:
```
Found 3 vulnerabilities (1 high, 2 moderate)

HIGH: axios@0.21.1 (CVE-2021-3749)
- Fix available: axios@0.21.4
- Breaking: No
- Run: npm install axios@0.21.4

MODERATE: glob-parent@5.1.1 (CVE-2020-28469)
- Fix available: glob-parent@6.0.2
- Breaking: Yes (ESM only)
- Review: Migration guide needed
```

### Example 3: Compliance Check (GDPR)

**Request**:
```
Audit for GDPR compliance issues
```

**Checks**:
- Data retention policies
- User consent mechanisms
- Right to erasure implementation
- Data export functionality
- Encryption at rest and in transit
- Privacy policy references
- Third-party data sharing

**Report**:
```
GDPR Compliance Audit

[PASS] Data encryption at rest
[FAIL] Missing data retention policy
[FAIL] No user data export endpoint
[PASS] Consent management implemented
[WARN] Privacy policy link outdated
[PASS] TLS 1.3 enforced
```

### Example 4: Code Quality Audit

**Request**:
```
Identify code quality issues and technical debt
```

**Analysis**:
- Complexity: 8 functions exceed threshold
- Duplication: 15% code duplication
- Dead code: 23 unused exports
- Large files: 4 files over 500 lines
- Magic numbers: 47 instances

**Top Issues**:
```
1. UserService.ts - Complexity 28 (threshold: 15)
   Recommendation: Extract validation logic

2. utils/helpers.ts - 234 lines duplicated in 3 files
   Recommendation: Create shared utility module

3. api/routes.ts - 847 lines (threshold: 500)
   Recommendation: Split into feature-based modules
```

## Stack-Specific Audit Patterns

### React/TypeScript

**Security Focus**:
- XSS via dangerouslySetInnerHTML
- Insecure refs and DOM manipulation
- Exposed environment variables in client code
- CORS misconfigurations

**Quality Focus**:
- Prop types and TypeScript coverage
- Component complexity
- Hook dependencies
- Re-render performance

### Go

**Security Focus**:
- SQL injection in database/sql
- Command injection in exec
- Path traversal
- Goroutine leaks

**Quality Focus**:
- Error handling consistency
- Context propagation
- Resource cleanup (defer)
- Race conditions

### Rust

**Security Focus**:
- Unsafe blocks
- Integer overflow
- Memory leaks in FFI
- Dependency vulnerabilities

**Quality Focus**:
- Error propagation patterns
- Clippy warnings
- Documentation coverage
- Panic usage

## Audit Workflow Integration

```
[Developer] → Request audit
    ↓
[Audit Skill] → Scan codebase
    ↓
[Generate Report] → Categorize findings
    ↓
[Prioritize] → CRITICAL → HIGH → MEDIUM → LOW
    ↓
[Fix Critical] → Apply fixes
    ↓
[Re-audit] → Verify fixes
    ↓
[Update Baseline] → Track progress
```

## Conclusion

The audit skill provides comprehensive security and quality analysis on-demand. Use it regularly to maintain code health, catch vulnerabilities early, and ensure compliance with industry standards.

**Key Takeaways**:
- Run audits frequently (daily in CI/CD)
- Prioritize CRITICAL and HIGH findings
- Establish baselines and track progress
- Integrate with other dev skills for comprehensive analysis
- Automate where possible

For performance analysis, see the `optimize` skill. For test coverage gaps, see the `test-coverage` skill.
