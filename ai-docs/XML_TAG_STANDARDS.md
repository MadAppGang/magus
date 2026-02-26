# XML Tag Standards for AI Prompt Engineering

## Overview

This document defines the standard XML tag structure for all agents and commands in the Magus repository. Following these standards ensures:

- **Improved clarity**: AI models better understand prompt structure
- **Better consistency**: Standardized patterns across all plugins
- **Easier maintenance**: Structured prompts are easier to update
- **Reduced errors**: Clear boundaries reduce misinterpretation
- **Enhanced flexibility**: Modular sections enable easier modifications

## Key Principles (from Anthropic)

1. **Consistency**: Use identical tag names throughout prompts
2. **Hierarchical Nesting**: Structure tags as nested elements for organized information
3. **Semantic Naming**: Tag names should reflect the content they contain (no canonical "best" tags)
4. **Combination with Techniques**: Pair XML tagging with multishot prompting (`<examples>`) and chain-of-thought (`<thinking>`)

---

## Standard XML Tag Taxonomy

### Core Tags (Shared Across ALL Agents and Commands)

These tags should appear in **every** agent and command prompt:

#### 1. `<role>` - Agent Identity and Expertise
Defines who the AI is, their expertise, and core mission.

```xml
<role>
  <identity>Expert TypeScript Backend Developer</identity>
  <expertise>
    - Bun runtime and Hono framework
    - PostgreSQL with Prisma ORM
    - Clean architecture patterns
    - Security best practices
  </expertise>
  <mission>
    Write secure, performant, and maintainable server-side code following
    modern backend development best practices and clean architecture principles.
  </mission>
</role>
```

**Location**: Top of prompt (after frontmatter)
**Purpose**: Establishes context, expertise, and primary objectives

---

#### 2. `<instructions>` - Core Directives and Rules
Contains the primary task instructions, rules, and constraints.

```xml
<instructions>
  <critical_constraints>
    - You are an ORCHESTRATOR, not an IMPLEMENTER
    - ALWAYS delegate code changes to specialized agents
    - NEVER use Write or Edit tools directly
  </critical_constraints>

  <core_principles>
    1. Security First: Hash passwords, validate inputs, use JWT
    2. Type Safety: Strict TypeScript, Zod schemas
    3. Layered Architecture: Routes → Controllers → Services → Repositories
  </core_principles>

  <workflow>
    <step number="1">Initialize TodoWrite for task tracking</step>
    <step number="2">Analyze requirements and gather context</step>
    <step number="3">Implement following best practices</step>
    <step number="4">Run quality checks (format, lint, typecheck)</step>
  </workflow>
</instructions>
```

**Location**: After `<role>`, before detailed content
**Purpose**: Defines what the agent MUST do and how

---

#### 3. `<examples>` - Multishot Prompting
Provides concrete examples of correct behavior and outputs.

```xml
<examples>
  <example>
    <scenario>User requests a new user registration endpoint</scenario>
    <user_request>Create a user registration endpoint with email validation</user_request>
    <correct_approach>
      1. Launch api-architect to design API contract
      2. Get user approval on architecture plan
      3. Launch backend-developer to implement
      4. Run quality checks and tests
    </correct_approach>
  </example>

  <example>
    <scenario>Gap analysis for ambiguous request</scenario>
    <user_request>I need a dashboard to manage users</user_request>
    <correct_response>
      Before I create an architecture plan, I need to clarify 3 critical gaps:

      1. **Authentication Gap**: What auth mechanism? (JWT, OAuth, session-based)
      2. **Data Integration Gap**: Existing API or new backend needed?
      3. **Feature Scope Gap**: Must-have vs nice-to-have features?

      Please provide details so I can design the optimal architecture.
    </correct_response>
  </example>
</examples>
```

**Location**: Throughout the prompt where behavior examples are needed
**Purpose**: Show desired behavior patterns through concrete examples

---

#### 4. `<formatting>` - Output Structure Requirements
Defines how the agent should format its responses and deliverables.

```xml
<formatting>
  <communication_style>
    - Be concise and technical
    - Use markdown formatting
    - Highlight security considerations
    - Point out performance optimizations
  </communication_style>

  <deliverables>
    <documentation location="ai-docs/">
      <file name="PROJECT_ARCHITECTURE.md">High-level architecture overview</file>
      <file name="IMPLEMENTATION_ROADMAP.md">Phased implementation plan</file>
      <file name="claude-code-todo.md">Actionable TODO list</file>
    </documentation>
  </deliverables>

  <code_structure>
    - Use TypeScript strict mode
    - Follow existing naming conventions
    - Include inline comments for complex logic
    - Add JSDoc for public APIs
  </code_structure>
</formatting>
```

**Location**: Near end of prompt, before reference materials
**Purpose**: Ensures consistent output format and style

---

#### 5. `<knowledge>` - Reference Materials and Context
Contains best practices, templates, patterns, and reference information.

```xml
<knowledge>
  <best_practices>
    <category name="Security">
      - Hash passwords with bcrypt (never store plaintext)
      - Validate ALL inputs with Zod schemas
      - Use custom error classes (never expose internal errors)
      - Implement rate limiting
    </category>

    <category name="Database">
      - Use Repository Pattern for all database access
      - Wrap repositories in services
      - Use transactions for multi-step operations
      - Select only needed fields (avoid SELECT *)
    </category>
  </best_practices>

  <templates>
    <template name="Controller">
```typescript
// src/controllers/user.controller.ts
import type { Context } from 'hono';
import * as userService from '@/services/user.service';

export const createUser = async (c: Context) => {
  const data = c.get('validatedData');
  const user = await userService.createUser(data);
  return c.json(user, 201);
};
```
    </template>

    <template name="Service">
```typescript
// src/services/user.service.ts
import { userRepository } from '@/database/repositories/user.repository';
import { NotFoundError } from '@core/errors';

export const getUserById = async (id: string) => {
  const user = await userRepository.findById(id);
  if (!user) throw new NotFoundError('User');
  return user;
};
```
    </template>
  </templates>

  <naming_conventions>
    <api_fields format="camelCase">
      - Use camelCase for all JSON API fields
      - Example: { "userId": "123", "firstName": "John" }
    </api_fields>

    <database_fields format="camelCase">
      - Tables: Singular, camelCase (users, orderItems)
      - Columns: camelCase (userId, emailAddress, createdAt)
      - Primary keys: {tableName}Id (userId, orderId)
    </database_fields>
  </naming_conventions>
</knowledge>
```

**Location**: After instructions, before workflow details
**Purpose**: Provides reference materials and patterns to follow

---

### Specialized Tags (Used in Specific Agent/Command Types)

#### For Orchestrator Commands (`/implement`, `/implement-api`)

```xml
<orchestration>
  <allowed_tools>
    - Task (delegate to agents)
    - Bash (run git, build commands)
    - Read/Glob/Grep (gather context)
    - TodoWrite (track progress)
    - AskUserQuestion (approval gates)
  </allowed_tools>

  <forbidden_tools>
    - Write (creates files - delegate to developer)
    - Edit (modifies code - delegate to developer)
  </forbidden_tools>

  <delegation_rules>
    <rule scope="architecture">ALL planning → architect agent</rule>
    <rule scope="implementation">ALL code changes → developer agent</rule>
    <rule scope="review">ALL code reviews → reviewer agents</rule>
    <rule scope="testing">ALL test writing → test-architect agent</rule>
  </delegation_rules>

  <phases>
    <phase number="1" name="Architecture Planning">
      <step>Launch architect agent</step>
      <step>Review architecture plan</step>
      <step>User approval gate</step>
    </phase>

    <phase number="2" name="Implementation">
      <step>Launch developer agent</step>
      <step>Monitor implementation progress</step>
      <step>Review implementation results</step>
    </phase>

    <phase number="3" name="Quality Checks">
      <step>Run formatter (Biome)</step>
      <step>Run linter (Biome)</step>
      <step>Run type checker (TypeScript)</step>
      <quality_gate>All checks must pass before proceeding</quality_gate>
    </phase>
  </phases>
</orchestration>
```

---

#### For Planning Agents (`architect`, `api-architect`)

```xml
<planning_methodology>
  <gap_analysis>
    <requirement>Identify top 3 critical gaps before planning</requirement>
    <focus_areas>
      - Technical requirements (auth, data persistence, real-time needs)
      - User roles, permissions, access control
      - Feature scope (MVP vs nice-to-have)
      - Integration requirements (APIs, third-party services)
      - Performance and scale expectations
    </focus_areas>
    <approach>
      1. Ask targeted clarification questions
      2. Explain WHY each question matters
      3. Wait for user responses
      4. Only proceed after gaps are addressed
    </approach>
  </gap_analysis>

  <output_structure>
    <document name="PROJECT_ARCHITECTURE.md">
      - Tech stack justification
      - Project structure
      - Component hierarchy
      - Data flow diagrams
      - Routing structure
    </document>

    <document name="IMPLEMENTATION_ROADMAP.md">
      - Phase breakdown with milestones
      - Task dependencies
      - Estimated complexity per task
      - Testing checkpoints
    </document>
  </output_structure>
</planning_methodology>
```

---

#### For Implementation Agents (`developer`, `backend-developer`, `ui-developer`)

```xml
<implementation_standards>
  <quality_checks>
    <check name="formatting" tool="Biome" command="bun run format">
      Run before presenting any code
    </check>
    <check name="linting" tool="Biome" command="bun run lint">
      Fix all errors and warnings
    </check>
    <check name="type_checking" tool="TypeScript" command="bun run typecheck">
      Resolve all type errors
    </check>
    <check name="testing" tool="Vitest" command="bun test">
      Ensure all tests pass
    </check>
  </quality_checks>

  <architecture_layers>
    <layer name="Routes" path="src/routes/">
      Define API routes, attach middleware, map to controllers
    </layer>
    <layer name="Controllers" path="src/controllers/">
      Handle HTTP requests/responses, call services, no business logic
    </layer>
    <layer name="Services" path="src/services/">
      Implement business logic, orchestrate repositories, no HTTP concerns
    </layer>
    <layer name="Repositories" path="src/database/repositories/">
      Encapsulate all database access via Prisma
    </layer>
  </architecture_layers>

  <critical_rules>
    - Controllers NEVER contain business logic (only HTTP handling)
    - Services NEVER access HTTP context (no req, res, Context)
    - Repositories are the ONLY layer that touches Prisma/database
    - Each layer depends only on layers below it
  </critical_rules>
</implementation_standards>
```

---

#### For Review Agents (`reviewer`, `senior-code-reviewer`, `codex-code-reviewer`)

```xml
<review_criteria>
  <focus_areas>
    <area name="Security" priority="critical">
      - Authentication and authorization checks
      - Input validation (Zod schemas)
      - SQL injection prevention
      - XSS prevention
      - Sensitive data exposure
    </area>

    <area name="Architecture" priority="high">
      - Layered design adherence
      - Separation of concerns
      - SOLID principles
      - Code organization
    </area>

    <area name="Type Safety" priority="high">
      - TypeScript strict mode compliance
      - Proper type inference
      - No `any` usage
      - Zod schema coverage
    </area>

    <area name="Testing" priority="medium">
      - Test coverage
      - Edge case handling
      - Integration test quality
    </area>
  </focus_areas>

  <feedback_format>
    <severity level="critical">Must fix before approval</severity>
    <severity level="high">Should fix before approval</severity>
    <severity level="medium">Recommended improvements</severity>
    <severity level="low">Nice-to-have suggestions</severity>
  </feedback_format>
</review_criteria>
```

---

#### For Testing Agents (`test-architect`, `tester`)

```xml
<testing_strategy>
  <test_types>
    <type name="unit" location="tests/unit/" runner="Vitest">
      Test individual functions and services in isolation
    </type>
    <type name="integration" location="tests/integration/" runner="Vitest">
      Test API endpoints and component interactions
    </type>
    <type name="e2e" location="tests/e2e/" runner="Playwright" optional="true">
      Test complete user workflows
    </type>
  </test_types>

  <coverage_requirements>
    - Services: 80% minimum coverage
    - Controllers: 70% minimum coverage
    - Repositories: 60% minimum coverage
    - Edge cases must be tested
  </coverage_requirements>

  <test_patterns>
    <pattern name="AAA">
      1. Arrange: Set up test data and mocks
      2. Act: Execute the function under test
      3. Assert: Verify the expected outcome
    </pattern>
  </test_patterns>
</testing_strategy>
```

---

## Template Structure for Agents

### Complete Agent Template

```markdown
---
name: agent-name
description: When to use this agent...
model: sonnet
color: purple
tools: TodoWrite, Read, Bash
---

<role>
  <identity>Your agent identity</identity>
  <expertise>
    - Expertise area 1
    - Expertise area 2
  </expertise>
  <mission>Your core mission statement</mission>
</role>

<instructions>
  <critical_constraints>
    - Constraint 1
    - Constraint 2
  </critical_constraints>

  <core_principles>
    1. Principle 1
    2. Principle 2
  </core_principles>

  <workflow>
    <step number="0">Initialize TodoWrite for task tracking</step>
    <step number="1">First workflow step</step>
    <step number="2">Second workflow step</step>
  </workflow>
</instructions>

<knowledge>
  <best_practices>
    <category name="Category Name">
      - Best practice 1
      - Best practice 2
    </category>
  </best_practices>

  <templates>
    <template name="Template Name">
```language
// code template
```
    </template>
  </templates>
</knowledge>

<examples>
  <example>
    <scenario>Example scenario</scenario>
    <user_request>User input</user_request>
    <correct_approach>How to handle it</correct_approach>
  </example>
</examples>

<formatting>
  <communication_style>
    - Style guideline 1
    - Style guideline 2
  </communication_style>

  <deliverables>
    Expected outputs and formats
  </deliverables>
</formatting>

<!-- Specialized sections based on agent type -->
<implementation_standards>
  <!-- For implementation agents -->
</implementation_standards>

<planning_methodology>
  <!-- For planning agents -->
</planning_methodology>

<review_criteria>
  <!-- For review agents -->
</review_criteria>
```

---

## Template Structure for Commands

### Complete Command Template

```markdown
---
description: Command description
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
---

<mission>
  High-level mission statement for this command
</mission>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    - You are an ORCHESTRATOR, not an IMPLEMENTER
    - Constraint 2
  </critical_constraints>

  <workflow>
    <step number="0">Initialize global workflow TodoWrite</step>
  </workflow>
</instructions>

<orchestration>
  <allowed_tools>
    - Task (delegate to agents)
    - Bash (run commands)
  </allowed_tools>

  <forbidden_tools>
    - Write (delegate to developer)
    - Edit (delegate to developer)
  </forbidden_tools>

  <delegation_rules>
    <rule scope="planning">ALL planning → architect agent</rule>
    <rule scope="implementation">ALL code → developer agent</rule>
  </delegation_rules>

  <phases>
    <phase number="1" name="Phase Name">
      <objective>What this phase achieves</objective>
      <steps>
        <step>Detailed step 1</step>
        <step>Detailed step 2</step>
      </steps>
      <quality_gate>Phase exit criteria</quality_gate>
    </phase>

    <phase number="2" name="Next Phase">
      <!-- ... -->
    </phase>
  </phases>
</orchestration>

<examples>
  <example>
    <scenario>Example workflow scenario</scenario>
    <execution>How the command handles it</execution>
  </example>
</examples>

<error_recovery>
  <strategy>
    1. Identify the issue
    2. Delegate fix to appropriate agent
    3. Re-run affected phases
    4. Never skip phases
  </strategy>
</error_recovery>

<success_criteria>
  - ✅ Criterion 1
  - ✅ Criterion 2
  - ✅ Criterion 3
</success_criteria>
```

---

## Migration Guide

### Converting Existing Prompts to XML Structure

**Before (Markdown-only):**
```markdown
## Core Development Principles

**CRITICAL: Task Management with TodoWrite**
You MUST use the TodoWrite tool...

### 1. Layered Architecture
**ALWAYS** separate concerns into distinct layers:
- Routes
- Controllers
- Services
```

**After (XML-structured):**
```xml
<instructions>
  <critical_constraints>
    <todowrite_requirement>
      You MUST use the TodoWrite tool to create and maintain a todo list
      throughout your implementation workflow.
    </todowrite_requirement>
  </critical_constraints>

  <core_principles>
    <principle name="Layered Architecture" priority="critical">
      ALWAYS separate concerns into distinct layers:
      - Routes (src/routes/): Define API routes
      - Controllers (src/controllers/): Handle HTTP
      - Services (src/services/): Business logic
    </principle>
  </core_principles>
</instructions>
```

### Step-by-Step Migration Process

1. **Identify sections** in existing prompt (role, instructions, examples, knowledge)
2. **Wrap each section** in appropriate XML tags
3. **Nest hierarchically** where content has sub-sections
4. **Add semantic attributes** where helpful (name, priority, type)
5. **Test the prompt** to ensure AI still understands correctly
6. **Refine tag naming** based on content semantics

---

## Benefits Summary

### For AI Models
- **Clearer boundaries**: Knows where instructions end and examples begin
- **Better parsing**: Hierarchical structure is easier to process
- **Reduced errors**: Less ambiguity about what content relates to what
- **Improved context**: Attributes provide additional semantic meaning

### For Humans
- **Easier maintenance**: Clear structure makes updates simpler
- **Better readability**: Nested tags show relationships clearly
- **Consistent patterns**: Same tags across all agents/commands
- **Modular updates**: Can modify one section without affecting others

### For Testing
- **Validation**: Can validate XML structure programmatically
- **Linting**: Can check for required tags and proper nesting
- **Versioning**: Changes to structure are more trackable
- **Documentation**: Structure itself documents the prompt organization

---

## Implementation Checklist

When creating or updating agents/commands:

- [ ] Add `<role>` section (identity, expertise, mission)
- [ ] Add `<instructions>` section (constraints, principles, workflow)
- [ ] Add `<knowledge>` section (best practices, templates, patterns)
- [ ] Add `<examples>` section (multishot prompting with scenarios)
- [ ] Add `<formatting>` section (communication style, deliverables)
- [ ] Add specialized sections based on agent type:
  - [ ] `<orchestration>` for commands
  - [ ] `<planning_methodology>` for architect agents
  - [ ] `<implementation_standards>` for developer agents
  - [ ] `<review_criteria>` for reviewer agents
  - [ ] `<testing_strategy>` for testing agents
- [ ] Ensure hierarchical nesting where appropriate
- [ ] Use consistent tag names across similar sections
- [ ] Add semantic attributes (name, priority, type) where helpful
- [ ] Test the prompt with Claude to verify understanding

---

## References

- [Anthropic Prompt Engineering Guide](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Anthropic XML Tags Documentation](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags)
- [Magus Repository](https://github.com/MadAppGang/claude-code)

---

**Version**: 1.0.0
**Last Updated**: 2025-11-14
**Maintained by**: Jack Rudenko @ MadAppGang
