# XML Knowledge Structure for Go Plugin

## Overview

This document defines the XML tag structure for all knowledge base files in the Go plugin. Following these standards ensures agents can efficiently consume and apply Go patterns from production codebases.

---

## Knowledge File Types

### 1. Atomic Reference Files (`references/*.md`)

These files contain production code examples for specific implementation patterns.

**Structure:**
```xml
<knowledge type="implementation_patterns" category="Interface Design">
  <overview>
    Brief description of this implementation category and why it matters.
  </overview>

  <source_projects>
    <project name="Go Standard Library">database/sql, context, testing</project>
    <project name="Docker/Moby">Containerization platform</project>
    <project name="CockroachDB">Distributed SQL database</project>
    <project name="Terraform">Infrastructure as code</project>
    <project name="Hugo">Static site generator</project>
  </source_projects>

  <patterns>
    <pattern name="Small, Focused Interfaces" difficulty="beginner">
      <source>
        <project>Go Standard Library</project>
        <file>src/database/sql/driver/driver.go</file>
        <link>https://github.com/golang/go/blob/master/src/database/sql/driver/driver.go</link>
      </source>

      <description>
        Single-responsibility interfaces that compose into larger behaviors.
      </description>

      <code language="go">
```go
// Core database driver interfaces - each with a single responsibility

type Driver interface {
    Open(name string) (Conn, error)
}

type Connector interface {
    Connect(context.Context) (Conn, error)
    Driver() Driver
}

type Conn interface {
    Prepare(query string) (Stmt, error)
    Close() error
    Begin() (Tx, error)
}
```
      </code>

      <analysis>
        <strengths>
          - Each interface has a single, clear purpose
          - Easy to implement incrementally
          - Supports optional enhancement through additional interfaces
          - Minimal coupling between components
          - Testable in isolation
        </strengths>

        <when_to_use>
          - Designing package APIs
          - Defining service contracts
          - Creating testable code
          - Building plugin systems
        </when_to_use>

        <best_practices>
          - Keep interfaces small (1-5 methods)
          - Accept interfaces, return structs
          - Define interfaces where used, not where implemented
        </best_practices>
      </analysis>
    </pattern>

    <pattern name="Request-Response Interface" difficulty="intermediate">
      <!-- Additional patterns -->
    </pattern>
  </patterns>

  <anti_patterns>
    <anti_pattern name="Large Interfaces" severity="high">
      <description>Interfaces with more than 7 methods violate single responsibility</description>
      <why_bad>
        - Hard to implement
        - Hard to test
        - Hard to maintain
        - Violates Interface Segregation Principle
      </why_bad>
      <instead_use>Split into multiple focused interfaces</instead_use>
    </anti_pattern>
  </anti_patterns>

  <summary>
    <key_principles>
      - Keep interfaces small (1-5 methods)
      - Single responsibility per interface
      - Composition over large interfaces
    </key_principles>

    <learning_path>
      <step level="beginner">Study small, focused interfaces from database/sql</step>
      <step level="intermediate">Review request-response patterns from Terraform</step>
      <step level="advanced">Design your own composable interface hierarchies</step>
    </learning_path>
  </summary>
</knowledge>
```

---

### 2. Best Practices Files (`roles/*/best-practices.md`)

These files contain role-specific guidelines, principles, and practices.

**Structure:**
```xml
<role>
  <identity>Go Developer</identity>
  <expertise>
    - Production Go development
    - Idiomatic Go patterns
    - Clean architecture
    - Testing and quality assurance
  </expertise>
  <mission>
    Write production-quality Go code following industry best practices and
    idiomatic patterns from real-world projects.
  </mission>
</role>

<knowledge type="best_practices" role="developer">
  <best_practices>
    <category name="Error Handling" priority="critical">
      <principles>
        <principle name="Always Check Errors">
          Never ignore errors returned from functions.

          ```go
          // ❌ BAD
          _ = doSomething()

          // ✅ GOOD
          if err := doSomething(); err != nil {
              return fmt.Errorf("failed to do something: %w", err)
          }
          ```
        </principle>

        <principle name="Wrap Errors with Context">
          Use fmt.Errorf with %w to preserve error chain.

          ```go
          // ✅ GOOD
          if err := db.Query(sql); err != nil {
              return fmt.Errorf("query failed for user %s: %w", userID, err)
          }
          ```
        </principle>
      </principles>

      <patterns>
        <pattern name="Sentinel Errors" reference="../../references/error-handling.md#sentinel-errors">
          Define package-level error constants for well-known conditions.
        </pattern>

        <pattern name="Error Classification" reference="../../references/error-handling.md#retry-with-error-classification">
          Distinguish transient errors (retry) from permanent errors (fail fast).
        </pattern>
      </patterns>

      <anti_patterns>
        <anti_pattern name="String Comparison" severity="high">
          Never compare error strings - use errors.Is() or errors.As()
        </anti_pattern>

        <anti_pattern name="Panic in Libraries" severity="critical">
          Reserve panic for programmer errors only, not runtime errors
        </anti_pattern>
      </anti_patterns>

      <code_examples>
        <example name="Sentinel Error Check">
```go
// Check for specific error
err := db.QueryRow("SELECT ...").Scan(&id)
if errors.Is(err, sql.ErrNoRows) {
    // Handle missing row case
    return nil, ErrUserNotFound
}
if err != nil {
    return nil, fmt.Errorf("query failed: %w", err)
}
```
        </example>
      </code_examples>

      <reference_implementations>
        <reference project="Go Standard Library" file="database/sql">
          Sentinel errors, retry logic, error wrapping
        </reference>
        <reference project="CockroachDB" file="pkg/util/retry">
          Exponential backoff with error classification
        </reference>
      </reference_implementations>
    </category>

    <category name="Concurrency" priority="critical">
      <!-- Similar structure -->
    </category>

    <category name="Interface Design" priority="high">
      <!-- Similar structure -->
    </category>
  </best_practices>

  <naming_conventions>
    <convention scope="functions">
      <exported format="PascalCase">CalculateTotal(), GetUser()</exported>
      <unexported format="camelCase">calculateTax(), validateInput()</unexported>
      <constructors format="NewX">NewClient(), NewServer()</constructors>
    </convention>

    <convention scope="interfaces">
      <naming>Describe behavior, not implementation (Reader, not FileReader)</naming>
      <size>Keep small (1-5 methods preferred)</size>
      <location>Define where used, not where implemented</location>
    </convention>
  </naming_conventions>

  <project_structure>
    <layout type="standard">
      <directory name="cmd/">Main applications for this project</directory>
      <directory name="internal/">Private application and library code</directory>
      <directory name="pkg/">Library code that's ok to use by external applications (optional)</directory>
      <directory name="api/">API contract files (OpenAPI/Swagger specs, JSON schemas)</directory>
    </layout>

    <organization_strategy type="domain-driven">
      Organize by domain/feature rather than technical layer.
      Reference: Hugo project structure
    </organization_strategy>
  </project_structure>
</knowledge>

<examples>
  <example>
    <scenario>User requests a new HTTP API endpoint</scenario>
    <correct_approach>
      <step number="1">Define interface for the handler</step>
      <step number="2">Implement handler with proper error handling</step>
      <step number="3">Add input validation with request types</step>
      <step number="4">Write table-driven tests</step>
      <step number="5">Add integration test for the endpoint</step>
    </correct_approach>
    <anti_pattern>
      Directly writing code without thinking about interfaces and testability
    </anti_pattern>
  </example>

  <example>
    <scenario>User asks to optimize a slow database query</scenario>
    <correct_approach>
      <step number="1">Profile first - measure before optimizing</step>
      <step number="2">Check if proper indexes exist</step>
      <step number="3">Review if SELECT * can be replaced with specific fields</step>
      <step number="4">Consider connection pooling settings</step>
      <step number="5">Benchmark before and after changes</step>
    </correct_approach>
    <anti_pattern>
      Premature optimization without profiling or measurement
    </anti_pattern>
  </example>
</examples>

<formatting>
  <communication_style>
    - Be concise and technical
    - Reference production examples from the knowledge base
    - Always explain the "why" behind recommendations
    - Point to specific reference files for detailed examples
  </communication_style>

  <code_style>
    <formatting>
      - Use gofmt/goimports (no exceptions)
      - Follow Go standard library conventions
      - Use golangci-lint for quality checks
    </formatting>

    <documentation>
      - Add package comments for all packages
      - Document exported functions, types, and constants
      - Use complete sentences in comments
      - Start comments with the name being documented
    </documentation>
  </code_style>
</formatting>
```

---

### 3. Role-Based Implementation Reference Indices

These files link to atomic references with role-specific context.

**Structure:**
```xml
<navigation type="implementation_references" role="developer">
  <overview>
    Quick access to production-quality Go code examples curated for daily development work.
  </overview>

  <core_patterns>
    <pattern_group name="Fundamentals" priority="high">
      <pattern name="Interface Design">
        <reference>../../references/interface-design.md</reference>
        <relevance_to_role>
          Essential for designing clean, composable APIs that are fundamental to Go development.
        </relevance_to_role>
        <key_focus_areas>
          - Small, focused interfaces (database/sql/driver pattern)
          - Request-response patterns (Terraform providers)
          - Context interface pattern
        </key_focus_areas>
        <when_to_reference>
          - Designing package APIs
          - Defining service contracts
          - Creating testable code
        </when_to_reference>
      </pattern>

      <pattern name="Constructor Patterns">
        <reference>../../references/constructor-patterns.md</reference>
        <relevance_to_role>
          Proper initialization prevents bugs and makes code maintainable.
        </relevance_to_role>
        <key_focus_areas>
          - Functional options pattern (Docker client)
          - Resource management in constructors (database/sql)
          - Multi-stage initialization (Hugo)
        </key_focus_areas>
      </pattern>
    </pattern_group>

    <pattern_group name="Production Quality" priority="critical">
      <pattern name="Error Handling">
        <reference>../../references/error-handling.md</reference>
        <!-- ... -->
      </pattern>

      <pattern name="Context Usage">
        <reference>../../references/context-usage.md</reference>
        <!-- ... -->
      </pattern>
    </pattern_group>
  </core_patterns>

  <learning_path>
    <phase name="New Go Developers">
      <step number="1">Start with Interface Design and Constructor Patterns</step>
      <step number="2">Master Error Handling and Context Usage</step>
      <step number="3">Study Testing Patterns thoroughly</step>
      <step number="4">Then move to Concurrency Patterns</step>
    </phase>

    <phase name="Experienced Developers">
      <step number="1">Focus on Concurrency Patterns for production-ready code</step>
      <step number="2">Study Performance Optimization for high-scale systems</step>
      <step number="3">Review HTTP/API Patterns for service development</step>
    </phase>
  </learning_path>

  <additional_resources>
    <resource type="best_practices" path="./best-practices.md">
      Developer role-specific guidelines and principles
    </resource>
    <resource type="reference_collection" path="../../references/README.md">
      Master index of all implementation patterns
    </resource>
  </additional_resources>
</navigation>
```

---

## Benefits of XML Structure

### For Agents

**1. Clear Content Boundaries**
```xml
<!-- Agent knows this is a pattern, not a best practice -->
<pattern name="Small Focused Interfaces">
  <!-- Pattern content -->
</pattern>

<!-- Agent knows these are anti-patterns to avoid -->
<anti_patterns>
  <anti_pattern name="Large Interfaces" severity="high">
    <!-- What not to do -->
  </anti_pattern>
</anti_patterns>
```

**2. Semantic Indicators**
```xml
<!-- Agent understands severity and priority -->
<category name="Error Handling" priority="critical">
  <anti_pattern name="Ignoring Errors" severity="high">
    <!-- Agent knows this is critical to avoid -->
  </anti_pattern>
</category>
```

**3. Modular Loading**
```xml
<!-- Agent can extract just the patterns, or just the anti-patterns -->
<knowledge>
  <patterns><!-- Load only if needed --></patterns>
  <anti_patterns><!-- Load only if needed --></anti_patterns>
  <best_practices><!-- Load only if needed --></best_practices>
</knowledge>
```

**4. Cross-References**
```xml
<!-- Agent can follow references to related content -->
<pattern name="Error Classification" reference="../../references/error-handling.md#retry">
  Detailed implementation in atomic reference file
</pattern>
```

### For Humans

**1. Easier Navigation**
- XML tags create clear visual hierarchy
- Easy to scan and find specific sections
- Attributes provide metadata at a glance

**2. Consistent Structure**
- Same tags across all knowledge files
- Predictable organization
- Easy to update and maintain

**3. Better Validation**
- Can validate XML structure programmatically
- Ensure all required sections present
- Check for proper nesting

---

## Implementation Checklist

### For Atomic Reference Files (`references/*.md`)

- [ ] Add `<knowledge type="implementation_patterns" category="...">` wrapper
- [ ] Add `<overview>` section
- [ ] Add `<source_projects>` with attribution
- [ ] Wrap patterns in `<patterns>` with individual `<pattern>` tags
- [ ] Include `<source>`, `<code>`, `<analysis>` in each pattern
- [ ] Add `<when_to_use>` and `<best_practices>` to each pattern
- [ ] Add `<anti_patterns>` section
- [ ] Add `<summary>` with key principles and learning path

### For Best Practices Files (`roles/*/best-practices.md`)

- [ ] Add `<role>` section (identity, expertise, mission)
- [ ] Add `<knowledge type="best_practices" role="...">` wrapper
- [ ] Organize into `<category>` tags with priority attributes
- [ ] Include `<principles>`, `<patterns>`, `<anti_patterns>` per category
- [ ] Add `<code_examples>` with working code
- [ ] Add `<reference_implementations>` linking to production code
- [ ] Add `<naming_conventions>` section
- [ ] Add `<project_structure>` guidance
- [ ] Add `<examples>` for scenario-based learning
- [ ] Add `<formatting>` for code style and documentation

### For Implementation Reference Indices (`roles/*/implementation-references.md`)

- [ ] Add `<navigation type="implementation_references" role="...">` wrapper
- [ ] Add `<overview>` section
- [ ] Group patterns into `<pattern_group>` with priority
- [ ] For each pattern, include:
  - [ ] `<reference>` path to atomic file
  - [ ] `<relevance_to_role>` explanation
  - [ ] `<key_focus_areas>` bulleted list
  - [ ] `<when_to_reference>` guidance
- [ ] Add `<learning_path>` with phases
- [ ] Add `<additional_resources>` links

---

## Migration Priority

### Phase 1: Core References (High Impact)
1. `references/interface-design.md` - Most fundamental pattern
2. `references/error-handling.md` - Critical for production code
3. `references/context-usage.md` - Essential Go idiom

### Phase 2: Developer-Focused
4. `references/constructor-patterns.md`
5. `references/testing-patterns.md`
6. `references/concurrency-patterns.md`

### Phase 3: Specialized Patterns
7. Remaining reference files
8. Best practices files
9. Implementation indices

---

**Version**: 1.0.0
**Last Updated**: 2025-11-14
**Maintained by**: MadAppGang Go Plugin Team
