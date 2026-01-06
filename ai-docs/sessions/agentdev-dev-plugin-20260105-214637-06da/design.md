# Dev Plugin Design Document

**Version:** 1.1.0
**Type:** General-Purpose Development Plugin
**Author:** MadAppGang
**License:** MIT

## Executive Summary

The **Dev Plugin** is a universal, language-agnostic development assistant that automatically loads framework-specific skills based on project context. Unlike specialized plugins (frontend, bun), this plugin adapts to ANY technology stack by detecting project type and loading appropriate skills dynamically.

**Key Innovation:** Context-aware skill auto-loading based on file extensions, config files, and project structure patterns.

---

## Table of Contents

1. [Plugin Manifest](#1-plugin-manifest)
2. [Directory Structure](#2-directory-structure)
3. [Auto-Loading Mechanism](#3-auto-loading-mechanism)
4. [Commands](#4-commands)
   - [dev-help](#41-dev-help-command)
   - [dev-implement](#42-dev-implement-command)
   - [dev-debug](#43-dev-debug-command)
   - [dev-feature](#44-dev-feature-command)
   - [dev-architect](#45-dev-architect-command)
5. [Skills Organization](#5-skills-organization)
6. [Agents](#6-agents)
7. [Error Recovery](#7-error-recovery)
8. [Implementation Phases](#8-implementation-phases)
9. [Changelog](#9-changelog)

---

## 1. Plugin Manifest

```json
{
  "name": "dev",
  "version": "1.1.0",
  "description": "Universal development assistant with context-aware skill auto-loading. Adapts to any technology stack (React, Go, Bun, Python, Rust) by detecting project type and loading appropriate framework-specific skills. Features 5 orchestrator commands (help, implement, debug, feature, architect), 15+ technology skills, and multi-model validation support.",
  "author": {
    "name": "Jack Rudenko",
    "email": "i@madappgang.com",
    "company": "MadAppGang"
  },
  "license": "MIT",
  "keywords": [
    "development",
    "universal",
    "language-agnostic",
    "auto-detection",
    "multi-stack",
    "react",
    "typescript",
    "golang",
    "bun",
    "python",
    "rust",
    "orchestration"
  ],
  "category": "development",
  "agents": [
    "./agents/stack-detector.md",
    "./agents/universal-developer.md",
    "./agents/universal-debugger.md",
    "./agents/universal-architect.md"
  ],
  "commands": [
    "./commands/help.md",
    "./commands/implement.md",
    "./commands/debug.md",
    "./commands/feature.md",
    "./commands/architect.md"
  ],
  "skills": [
    "./skills/context-detection",
    "./skills/core/universal-patterns",
    "./skills/core/testing-strategies",
    "./skills/core/debugging-strategies",
    "./skills/frontend/react-typescript",
    "./skills/frontend/vue-typescript",
    "./skills/frontend/state-management",
    "./skills/frontend/testing-frontend",
    "./skills/backend/api-design",
    "./skills/backend/database-patterns",
    "./skills/backend/auth-patterns",
    "./skills/backend/error-handling",
    "./skills/backend/golang",
    "./skills/backend/bunjs",
    "./skills/backend/python",
    "./skills/backend/rust"
  ],
  "dependencies": {
    "orchestration@mag-claude-plugins": "^0.8.0"
  },
  "compatibility": {
    "claudeCode": ">=0.1.0"
  }
}
```

---

## 2. Directory Structure

```
plugins/dev/
├── plugin.json                          # Plugin manifest
├── README.md                            # User documentation
│
├── agents/
│   ├── stack-detector.md                # Detects project stack and recommends skills
│   ├── universal-developer.md           # Language-agnostic implementer
│   ├── universal-debugger.md            # Language-agnostic debugger
│   └── universal-architect.md           # Language-agnostic architect
│
├── commands/
│   ├── help.md                          # /dev:help - Plugin help and status
│   ├── implement.md                     # /dev:implement or /dev-implement
│   ├── debug.md                         # /dev:debug or /dev-debug
│   ├── feature.md                       # /dev:feature or /dev-feature
│   └── architect.md                     # /dev:architect or /dev-architect
│
└── skills/
    ├── context-detection/               # Auto-loading mechanism
    │   └── SKILL.md
    │
    ├── core/                            # Universal patterns (always loaded)
    │   ├── universal-patterns/
    │   │   └── SKILL.md
    │   ├── testing-strategies/
    │   │   └── SKILL.md
    │   └── debugging-strategies/
    │       └── SKILL.md
    │
    ├── frontend/                        # Frontend-specific skills
    │   ├── react-typescript/
    │   │   └── SKILL.md
    │   ├── vue-typescript/
    │   │   └── SKILL.md
    │   ├── state-management/
    │   │   └── SKILL.md
    │   └── testing-frontend/
    │       └── SKILL.md
    │
    └── backend/                         # Backend-specific skills
        ├── api-design/
        │   └── SKILL.md
        ├── database-patterns/
        │   └── SKILL.md
        ├── auth-patterns/
        │   └── SKILL.md
        ├── error-handling/
        │   └── SKILL.md
        ├── golang/
        │   └── SKILL.md
        ├── bunjs/
        │   └── SKILL.md
        ├── python/
        │   └── SKILL.md
        └── rust/
            └── SKILL.md
```

---

## 3. Auto-Loading Mechanism

### 3.1 Context Detection Skill

The `context-detection` skill is the core innovation. It provides patterns for detecting project type and recommending skills.

```yaml
---
name: context-detection
description: |
  Detects project technology stack from file extensions, config files, and directory patterns.
  Returns recommended skills to load for the detected stack.
  Used by all dev commands to auto-load appropriate framework knowledge.
---
```

### 3.2 Detection Priority

```yaml
detection_priority:
  1_explicit_preference:
    source: ".claude/settings.json"
    field: "pluginSettings.dev.stack"
    example:
      pluginSettings:
        dev:
          stack: ["react-typescript", "golang"]
          features:
            testing: "vitest"
            api: "rest"

  2_current_file_context:
    description: "When editing a specific file, detect from extension"
    patterns:
      - extension: ".tsx"
        skills: ["react-typescript", "testing-frontend"]
      - extension: ".go"
        skills: ["golang", "testing-strategies"]
      - extension: ".rs"
        skills: ["rust", "testing-strategies"]
      - extension: ".py"
        skills: ["python", "testing-strategies"]

  3_config_files:
    description: "Detect from project configuration files"
    patterns:
      - file: "package.json"
        check: "dependencies contains 'react'"
        skills: ["react-typescript", "state-management", "testing-frontend"]
      - file: "package.json"
        check: "dependencies contains 'vue'"
        skills: ["vue-typescript", "state-management", "testing-frontend"]
      - file: "go.mod"
        skills: ["golang", "api-design", "database-patterns"]
      - file: "Cargo.toml"
        skills: ["rust", "api-design"]
      - file: "pyproject.toml"
        skills: ["python", "api-design"]
      - file: "bun.lockb"
        skills: ["bunjs", "api-design"]

  4_directory_patterns:
    description: "Infer from directory structure"
    patterns:
      - path: "src/routes/"
        skills: ["react-typescript"]
      - path: "cmd/"
        skills: ["golang"]
      - path: "src/main.rs"
        skills: ["rust"]
```

### 3.3 Detection Algorithm

```markdown
## Context Detection Algorithm

### Step 1: Check Explicit Preferences
```bash
if exists ".claude/settings.json"; then
  read pluginSettings.dev.stack
  if stack defined; then
    return explicit_skills
  fi
fi
```

### Step 2: Analyze Current Context
```bash
if current_file provided; then
  extension = get_extension(current_file)
  skills = extension_mapping[extension]
  if skills found; then
    merge with detected_skills
  fi
fi
```

### Step 3: Scan Config Files
```bash
for config in ["package.json", "go.mod", "Cargo.toml", "pyproject.toml"]; do
  if exists config; then
    skills = analyze_config(config)
    merge with detected_skills
  fi
done
```

### Step 4: Scan Directory Structure
```bash
for pattern in directory_patterns; do
  if exists pattern.path; then
    merge pattern.skills with detected_skills
  fi
done
```

### Step 5: Return Skill Set
```bash
# Always include core skills
final_skills = ["universal-patterns", "testing-strategies", "debugging-strategies"]
final_skills += detected_skills
return unique(final_skills)
```
```

### 3.4 Multi-Stack Detection (v1.1.0)

For hybrid projects (e.g., React frontend + Go backend), the detection algorithm identifies ALL stacks present:

```yaml
multi_stack_detection:
  algorithm:
    1. Run detection for ALL config files (not just first match)
    2. Merge all detected skills
    3. Identify project mode:
       - "frontend" if only frontend stack detected
       - "backend" if only backend stack detected
       - "fullstack" if both frontend AND backend detected
    4. Return merged skill set with mode

  example_fullstack:
    detected_configs:
      - package.json (React detected)
      - go.mod (Go detected)
    skills:
      - react-typescript
      - state-management
      - testing-frontend
      - golang
      - api-design
      - database-patterns
    mode: "fullstack"

  quality_checks_by_mode:
    frontend:
      - bun run format
      - bun run lint
      - bun run typecheck
      - bun test
    backend_go:
      - go fmt ./...
      - go vet ./...
      - golangci-lint run
      - go test ./...
    fullstack:
      # Run frontend checks in frontend directory
      - cd frontend && bun run format && bun run lint && bun run typecheck && bun test
      # Run backend checks in root or backend directory
      - go fmt ./... && go vet ./... && golangci-lint run && go test ./...
```

### 3.5 Skill Auto-Loading Implementation

**CRITICAL: Agent-Driven Skill Reading Pattern**

Skills are NOT loaded via frontmatter or dynamic injection. Instead, agents use the **Read tool** to load skill content at runtime based on stack-detector output.

```xml
<skill_loading_mechanism>
  <approach>Agent-Driven Skill Reading</approach>
  <description>
    Agents receive skill file paths from stack-detector output.
    They use the Read tool to load skill content when needed.
    This approach keeps agents lightweight while providing full skill access.
  </description>

  <workflow>
    <step order="1">
      stack-detector agent analyzes project
      Outputs: { stack: "react-typescript", skills: [...], skill_paths: [...] }
    </step>

    <step order="2">
      Command orchestrator stores skill_paths in session context:
      SESSION_PATH/context.json: {
        "detected_stack": "react-typescript",
        "mode": "frontend",
        "skill_paths": [
          "${PLUGIN_ROOT}/skills/core/universal-patterns/SKILL.md",
          "${PLUGIN_ROOT}/skills/frontend/react-typescript/SKILL.md",
          "${PLUGIN_ROOT}/skills/frontend/testing-frontend/SKILL.md"
        ]
      }
    </step>

    <step order="3">
      When delegating to implementation agent:
      Task prompt includes:
      ```
      SESSION_PATH: ${SESSION_PATH}

      Before implementing, read these skill files for best practices:
      - ${PLUGIN_ROOT}/skills/frontend/react-typescript/SKILL.md
      - ${PLUGIN_ROOT}/skills/frontend/testing-frontend/SKILL.md

      Then implement: {user_request}
      ```
    </step>

    <step order="4">
      Implementation agent:
      1. Reads skill files using Read tool
      2. Extracts relevant patterns
      3. Applies patterns during implementation
    </step>
  </workflow>

  <example_prompt>
    SESSION_PATH: ai-docs/sessions/dev-impl-20260105-123456-a1b2c3d4

    Read these skills before implementing:
    - plugins/dev/skills/frontend/react-typescript/SKILL.md
    - plugins/dev/skills/core/testing-strategies/SKILL.md

    Implement: Create a user profile component with avatar upload
  </example_prompt>
</skill_loading_mechanism>
```

### 3.6 Stack Detector Agent

```yaml
---
name: stack-detector
description: |
  Analyzes project to detect technology stack and recommend skills.
  Examples:
  (1) "What stack is this project?" - returns detected technologies
  (2) "What skills should I load?" - returns skill recommendations with paths
  (3) "Is this a React project?" - confirms specific stack detection
model: sonnet
color: blue
tools: TodoWrite, Read, Write, Glob, Grep, Bash
---
```

**Note:** Write tool added (v1.1.0) to save detection results to session context file.

---

## 4. Commands

### 4.1 dev-help Command

**Purpose:** Display plugin help, detected stack, and available commands.

```yaml
---
description: |
  Display dev plugin help, detected project stack, and available commands.
  Shows recommended skills for the current project context.
allowed-tools: Task, Bash, Read, Glob, Grep
skills: dev:context-detection
---
```

```xml
<role>
  <identity>Dev Plugin Help Assistant</identity>
  <expertise>
    - Project stack detection
    - Plugin command documentation
    - Skill recommendations
  </expertise>
  <mission>
    Display helpful information about the dev plugin including detected
    project stack, available commands, and recommended skills.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <workflow>
    <phase number="1" name="Detect Stack">
      <step>
        Launch stack-detector agent:
        ```
        Analyze this project and detect the technology stack.
        Return: stack name, frameworks, skills to recommend
        ```
      </step>
    </phase>

    <phase number="2" name="Display Help">
      <step>Present formatted help output</step>
    </phase>
  </workflow>
</instructions>

<output_format>
## Dev Plugin Help

**Detected Stack:** {detected_stack}
**Mode:** {frontend | backend | fullstack}

### Available Commands

| Command | Description |
|---------|-------------|
| `/dev:help` | Show this help message |
| `/dev:implement` | Implement features with auto-detected stack |
| `/dev:debug` | Debug errors and investigate issues |
| `/dev:feature` | Full feature development lifecycle |
| `/dev:architect` | Architecture planning and design |

### Recommended Skills for Your Project

Based on detected stack ({detected_stack}):
- {skill_1} - {description}
- {skill_2} - {description}
- {skill_3} - {description}

### Configuration

Override detection in `.claude/settings.json`:
```json
{
  "pluginSettings": {
    "dev": {
      "stack": ["react-typescript", "golang"],
      "features": {
        "testing": "vitest"
      }
    }
  }
}
```

### Examples

```bash
# Implement a feature
/dev:implement Create user authentication

# Debug an error
/dev:debug TypeError: Cannot read property 'map' of undefined

# Plan architecture
/dev:architect Design microservice for user management

# Full feature development
/dev:feature Add OAuth2 login with Google
```

### Dependencies

- **orchestration@mag-claude-plugins** (required) - Multi-model validation
- **code-analysis@mag-claude-plugins** (optional) - Semantic search
- **Claudish CLI** (optional) - External model reviews
</output_format>

<examples>
  <example name="React Project Help">
    <user_request>/dev:help</user_request>
    <output>
      Detected Stack: react-typescript
      Mode: frontend
      Recommended Skills: react-typescript, state-management, testing-frontend
      Shows all 5 commands with React-specific examples
    </output>
  </example>

  <example name="Fullstack Project Help">
    <user_request>/dev:help</user_request>
    <output>
      Detected Stack: react-typescript + golang
      Mode: fullstack
      Recommended Skills: react-typescript, golang, api-design, database-patterns
      Shows quality checks for both frontend and backend
    </output>
  </example>
</examples>
```

---

### 4.2 dev-implement Command

**Purpose:** Language-agnostic implementation of features, components, or code changes.

```yaml
---
description: |
  Universal implementation command that adapts to any technology stack.
  Workflow: DETECT STACK -> LOAD SKILLS -> PLAN -> IMPLEMENT -> VALIDATE
  Supports: React, Vue, Go, Bun, Python, Rust, and more.
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:universal-patterns, orchestration:todowrite-orchestration
---
```

```xml
<role>
  <identity>Universal Implementation Orchestrator</identity>
  <expertise>
    - Technology stack detection and skill loading
    - Multi-language implementation patterns
    - Quality gate enforcement
    - Agent delegation and coordination
  </expertise>
  <mission>
    Orchestrate implementation of any feature by detecting the project stack,
    loading appropriate skills, and delegating to the universal-developer agent.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Use Task tool to delegate ALL work to agents
      - Use TodoWrite to track workflow
      - Use AskUserQuestion for approval gates
      - Detect stack before implementation

      **You MUST NOT:**
      - Write or edit ANY code files directly
      - Implement features yourself
      - Skip stack detection phase
    </orchestrator_role>

    <delegation_rules>
      - ALL stack detection -> stack-detector agent
      - ALL implementation -> universal-developer agent
      - ALL reviews -> appropriate reviewer agent
    </delegation_rules>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Initialize">
      <objective>Setup session and detect technology stack</objective>
      <steps>
        <step>Create TodoWrite with all phases</step>
        <step>
          Initialize session with increased entropy (8 hex chars):
          ```bash
          SESSION_BASE="dev-impl-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
          SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
          mkdir -p "${SESSION_PATH}"
          ```
        </step>
        <step>
          Launch stack-detector agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Analyze this project and detect:
          1. Primary technology stack(s) - check for MULTIPLE stacks
          2. Framework versions
          3. Testing tools
          4. Build tools
          5. Recommended skills with file paths

          Context: User wants to implement: {user_request}

          Save detection results to: ${SESSION_PATH}/context.json
          ```
        </step>
        <step>Read detection results from ${SESSION_PATH}/context.json</step>
      </steps>
      <quality_gate>Stack detected, skills identified, context.json created</quality_gate>
    </phase>

    <phase number="1" name="Skill Confirmation">
      <objective>Confirm detected skills with user</objective>
      <steps>
        <step>Mark PHASE 1 in_progress</step>
        <step>
          **User Confirmation** (AskUserQuestion):
          ```
          Detected Stack: {stack_name}
          Mode: {frontend | backend | fullstack}
          Recommended Skills:
          - {skill_1}
          - {skill_2}
          - {skill_3}

          Options:
          1. Proceed with these skills [RECOMMENDED]
          2. Add additional skills
          3. Remove some skills
          4. Manual skill selection
          ```
        </step>
        <step>Finalize skill list</step>
        <step>Mark PHASE 1 completed</step>
      </steps>
      <quality_gate>Skills confirmed by user</quality_gate>
    </phase>

    <phase number="2" name="Implementation Planning">
      <objective>Create implementation plan based on loaded skills</objective>
      <steps>
        <step>Mark PHASE 2 in_progress</step>
        <step>
          Launch universal-architect agent with skill paths:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Read these skills for best practices:
          - {skill_path_1}
          - {skill_path_2}
          - {skill_path_3}

          Create implementation plan for: {user_request}

          Consider:
          1. Existing patterns in codebase
          2. Best practices from loaded skills
          3. Testing requirements
          4. Quality checks for this stack

          Save plan to: ${SESSION_PATH}/implementation-plan.md
          ```
        </step>
        <step>Review plan</step>
        <step>Mark PHASE 2 completed</step>
      </steps>
      <quality_gate>Implementation plan created</quality_gate>
    </phase>

    <phase number="3" name="Implementation">
      <objective>Execute implementation using universal-developer</objective>
      <steps>
        <step>Mark PHASE 3 in_progress</step>
        <step>
          Launch universal-developer agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Read these skills before implementing:
          - {skill_path_1}
          - {skill_path_2}
          - {skill_path_3}

          Implement according to plan: ${SESSION_PATH}/implementation-plan.md

          Follow patterns from loaded skills.
          Run quality checks appropriate for this stack.
          ```
        </step>
        <step>Verify implementation</step>
        <step>Mark PHASE 3 completed</step>
      </steps>
      <quality_gate>Implementation complete, quality checks pass</quality_gate>
    </phase>

    <phase number="4" name="Validation">
      <objective>Run stack-appropriate quality checks</objective>
      <steps>
        <step>Mark PHASE 4 in_progress</step>
        <step>
          Determine quality checks based on stack and mode:
          - Mode: frontend -> run frontend checks
          - Mode: backend -> run backend checks for detected language
          - Mode: fullstack -> run BOTH frontend and backend checks
        </step>
        <step>Run detected quality checks via Bash</step>
        <step>If failures, delegate fixes to universal-developer (max 2 retries)</step>
        <step>Mark PHASE 4 completed</step>
      </steps>
      <quality_gate>All quality checks pass</quality_gate>
    </phase>

    <phase number="5" name="Finalization">
      <objective>Present results and cleanup</objective>
      <steps>
        <step>Mark PHASE 5 in_progress</step>
        <step>Show git status</step>
        <step>Present implementation summary</step>
        <step>
          **User Acceptance** (AskUserQuestion):
          1. Accept and finalize
          2. Request changes
          3. Manual testing needed
        </step>
        <step>Mark ALL tasks completed</step>
      </steps>
      <quality_gate>User accepted implementation</quality_gate>
    </phase>
  </workflow>
</instructions>

<quality_checks_by_stack>
  <stack name="react-typescript">
    <check>bun run format</check>
    <check>bun run lint</check>
    <check>bun run typecheck</check>
    <check>bun test</check>
  </stack>

  <stack name="golang">
    <check>go fmt ./...</check>
    <check>go vet ./...</check>
    <check>golangci-lint run</check>
    <check>go test ./...</check>
  </stack>

  <stack name="rust">
    <check>cargo fmt --check</check>
    <check>cargo clippy -- -D warnings</check>
    <check>cargo test</check>
  </stack>

  <stack name="python">
    <check>black --check .</check>
    <check>ruff check .</check>
    <check>mypy .</check>
    <check>pytest</check>
  </stack>

  <stack name="bunjs">
    <check>bun run format</check>
    <check>bun run lint</check>
    <check>bun run typecheck</check>
    <check>bun test</check>
  </stack>
</quality_checks_by_stack>

<examples>
  <example name="React Component">
    <user_request>/dev:implement Create a user profile component with avatar and bio</user_request>
    <execution>
      PHASE 0: Detect React/TypeScript from package.json
      PHASE 1: Confirm skills: react-typescript, state-management, testing-frontend
      PHASE 2: Architect creates component plan
      PHASE 3: Developer implements component
      PHASE 4: Run format, lint, typecheck, test
      PHASE 5: Present results
    </execution>
  </example>

  <example name="Go API Endpoint">
    <user_request>/dev:implement Add GET /users/:id endpoint</user_request>
    <execution>
      PHASE 0: Detect Go from go.mod
      PHASE 1: Confirm skills: golang, api-design, database-patterns
      PHASE 2: Architect creates endpoint plan
      PHASE 3: Developer implements handler + repository
      PHASE 4: Run go fmt, go vet, go test
      PHASE 5: Present results
    </execution>
  </example>
</examples>

<communication>
  <final_message>
## Implementation Complete

**Stack**: {detected_stack}
**Mode**: {mode}
**Skills Used**: {skill_list}
**Session**: ${SESSION_PATH}

**Files Modified**:
- {file_1}
- {file_2}

**Quality Checks**:
- Format: PASS
- Lint: PASS
- Type Check: PASS
- Tests: PASS

Ready to commit!
  </final_message>
</communication>
```

---

### 4.3 dev-debug Command

**Purpose:** Language-agnostic debugging workflow for issues, errors, and log analysis.

```yaml
---
description: |
  Universal debugging command that adapts to any technology stack.
  Workflow: DETECT STACK -> ANALYZE ERROR -> TRACE ISSUE -> FIX -> VALIDATE
  Supports error logs, stack traces, runtime issues across all languages.
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:debugging-strategies, orchestration:error-recovery
---
```

```xml
<role>
  <identity>Universal Debugging Orchestrator</identity>
  <expertise>
    - Cross-language error analysis
    - Stack trace interpretation
    - Log parsing and correlation
    - Root cause analysis
    - Debugging strategy selection
  </expertise>
  <mission>
    Orchestrate systematic debugging of any issue by detecting the stack,
    applying appropriate debugging strategies, and coordinating fixes.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Use Task tool to delegate ALL debugging work
      - Use TodoWrite to track investigation steps
      - Document findings systematically
      - Trace root cause before fixing

      **You MUST NOT:**
      - Write or edit code directly
      - Apply fixes yourself
      - Skip root cause analysis
    </orchestrator_role>

    <delegation_rules>
      - ALL error analysis -> universal-debugger agent
      - ALL fixes -> universal-developer agent
      - ALL validation -> run tests via Bash
    </delegation_rules>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Initialize">
      <objective>Setup session and understand the issue</objective>
      <steps>
        <step>Create TodoWrite with debugging phases</step>
        <step>
          Initialize session with increased entropy:
          ```bash
          SESSION_BASE="dev-debug-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
          SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
          mkdir -p "${SESSION_PATH}"
          ```
        </step>
        <step>Capture error context (logs, stack trace, reproduction steps)</step>
        <step>Detect stack from error context or project files</step>
      </steps>
      <quality_gate>Issue understood, stack detected</quality_gate>
    </phase>

    <phase number="1" name="Error Analysis">
      <objective>Analyze error and identify potential causes</objective>
      <steps>
        <step>Mark PHASE 1 in_progress</step>
        <step>
          Launch universal-debugger agent:
          ```
          SESSION_PATH: ${SESSION_PATH}
          DETECTED_STACK: {stack}

          Analyze this error:
          {error_description}

          Steps:
          1. Parse stack trace/error message
          2. Identify error type and category
          3. List potential root causes (ranked by likelihood)
          4. Identify relevant code files
          5. Suggest investigation paths

          Save analysis to: ${SESSION_PATH}/error-analysis.md
          ```
        </step>
        <step>Review analysis</step>
        <step>Mark PHASE 1 completed</step>
      </steps>
      <quality_gate>Error analyzed, potential causes identified</quality_gate>
    </phase>

    <phase number="2" name="Root Cause Investigation">
      <objective>Trace the actual root cause</objective>
      <steps>
        <step>Mark PHASE 2 in_progress</step>
        <step>
          For each potential cause (in order of likelihood):
          - Read relevant source files
          - Check related configurations
          - Trace data/control flow
          - Verify assumptions
        </step>
        <step>
          Launch universal-debugger with investigation findings:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Confirm root cause from investigation:
          - Files checked: {file_list}
          - Findings: {investigation_notes}

          Identify the actual root cause and required fix.
          Save to: ${SESSION_PATH}/root-cause.md
          ```
        </step>
        <step>
          **User Confirmation** (AskUserQuestion):
          ```
          Root Cause Identified:
          {root_cause_description}

          Proposed Fix:
          {fix_approach}

          Options:
          1. Proceed with fix [RECOMMENDED]
          2. Investigate further
          3. Manual debugging
          ```
        </step>
        <step>Mark PHASE 2 completed</step>
      </steps>
      <quality_gate>Root cause confirmed</quality_gate>
    </phase>

    <phase number="3" name="Fix Implementation">
      <objective>Apply the fix</objective>
      <steps>
        <step>Mark PHASE 3 in_progress</step>
        <step>
          Launch universal-developer agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Read these skills:
          - {skill_path_1}
          - {skill_path_2}

          Apply fix based on: ${SESSION_PATH}/root-cause.md

          Requirements:
          1. Minimal change to fix the issue
          2. Add regression test if applicable
          3. Document the fix
          ```
        </step>
        <step>Verify fix applied</step>
        <step>Mark PHASE 3 completed</step>
      </steps>
      <quality_gate>Fix applied</quality_gate>
    </phase>

    <phase number="4" name="Validation">
      <objective>Verify fix resolves the issue</objective>
      <steps>
        <step>Mark PHASE 4 in_progress</step>
        <step>Run reproduction steps to verify fix</step>
        <step>Run quality checks for the stack</step>
        <step>Run test suite</step>
        <step>
          If issue persists:
          - Return to PHASE 2 for further investigation
          - Max 2 iterations before escalating to user
        </step>
        <step>Mark PHASE 4 completed</step>
      </steps>
      <quality_gate>Issue resolved, tests pass</quality_gate>
    </phase>

    <phase number="5" name="Documentation">
      <objective>Document the debugging session</objective>
      <steps>
        <step>Mark PHASE 5 in_progress</step>
        <step>
          Create debug report at ${SESSION_PATH}/debug-report.md:
          - Issue summary
          - Root cause
          - Fix applied
          - Prevention recommendations
        </step>
        <step>Present summary to user</step>
        <step>Mark ALL tasks completed</step>
      </steps>
      <quality_gate>Debug session documented</quality_gate>
    </phase>
  </workflow>
</instructions>

<debugging_strategies_by_stack>
  <stack name="react-typescript">
    <strategy>Check React DevTools for component state</strategy>
    <strategy>Inspect Network tab for API failures</strategy>
    <strategy>Look for hydration mismatches (SSR)</strategy>
    <strategy>Check TanStack Query devtools for cache issues</strategy>
    <strategy>Review TypeScript errors in IDE</strategy>
  </stack>

  <stack name="golang">
    <strategy>Add debug logging with log/slog</strategy>
    <strategy>Use delve debugger for step-through</strategy>
    <strategy>Check goroutine leaks with pprof</strategy>
    <strategy>Trace database queries</strategy>
    <strategy>Review error wrapping chain</strategy>
  </stack>

  <stack name="rust">
    <strategy>Use RUST_BACKTRACE=1 for full stack trace</strategy>
    <strategy>Add debug!()/trace!() with tracing crate</strategy>
    <strategy>Check for unwrap() calls on None/Err</strategy>
    <strategy>Review borrow checker errors</strategy>
    <strategy>Use cargo expand for macro debugging</strategy>
  </stack>

  <stack name="python">
    <strategy>Add breakpoint() or pdb.set_trace()</strategy>
    <strategy>Check traceback module for async traces</strategy>
    <strategy>Review import order for circular imports</strategy>
    <strategy>Check environment and dependencies</strategy>
    <strategy>Use logging module with DEBUG level</strategy>
  </stack>
</debugging_strategies_by_stack>

<examples>
  <example name="React Rendering Error">
    <user_request>/dev:debug TypeError: Cannot read property 'map' of undefined</user_request>
    <execution>
      PHASE 0: Capture stack trace, detect React stack
      PHASE 1: Analyze - likely data is undefined before fetch completes
      PHASE 2: Find component, verify useQuery loading state handling
      PHASE 3: Add loading check before .map()
      PHASE 4: Verify rendering works
      PHASE 5: Document pattern for data guards
    </execution>
  </example>

  <example name="Go Panic">
    <user_request>/dev:debug panic: runtime error: invalid memory address or nil pointer dereference</user_request>
    <execution>
      PHASE 0: Parse panic stack trace, detect Go stack
      PHASE 1: Identify file:line from trace, list nil pointer sources
      PHASE 2: Trace variable initialization, find missing nil check
      PHASE 3: Add nil check before dereference
      PHASE 4: Run tests, verify no panic
      PHASE 5: Document nil safety pattern
    </execution>
  </example>
</examples>

<communication>
  <final_message>
## Debug Session Complete

**Issue**: {issue_summary}
**Root Cause**: {root_cause}
**Fix Applied**: {fix_summary}

**Validation**:
- Reproduction: FIXED
- Tests: PASS
- Quality Checks: PASS

**Prevention**:
{prevention_recommendations}

Session artifacts: ${SESSION_PATH}/
  </final_message>
</communication>
```

---

### 4.4 dev-feature Command

**Purpose:** Full-cycle feature development from architecture to deployment.

```yaml
---
description: |
  Complete feature development lifecycle with multi-agent orchestration.
  Workflow: DETECT -> ARCHITECT -> IMPLEMENT -> TEST -> REVIEW -> DEPLOY
  Universal support for any technology stack with quality gates at each phase.
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:universal-patterns, orchestration:multi-model-validation, orchestration:quality-gates
---
```

```xml
<role>
  <identity>Universal Feature Development Orchestrator</identity>
  <expertise>
    - Full-cycle feature development
    - Multi-agent coordination
    - Quality gate enforcement
    - Multi-model validation
    - Cross-stack implementation
  </expertise>
  <mission>
    Orchestrate complete feature development from architecture through deployment,
    adapting to any technology stack with consistent quality gates.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Use Task tool to delegate ALL work to agents
      - Use TodoWrite to track full lifecycle
      - Enforce quality gates between phases
      - Support multi-model validation

      **You MUST NOT:**
      - Write or edit ANY code files directly
      - Skip quality gates
      - Proceed without user approval at key points
    </orchestrator_role>

    <delegation_rules>
      - ALL detection -> stack-detector agent
      - ALL architecture -> universal-architect agent
      - ALL implementation -> universal-developer agent
      - ALL testing -> appropriate test runner (Bash)
      - ALL reviews -> reviewer agents (with optional PROXY_MODE)
    </delegation_rules>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Initialize">
      <objective>Setup session, detect stack, check dependencies</objective>
      <steps>
        <step>Create comprehensive TodoWrite for full lifecycle</step>
        <step>
          Initialize session with feature name and increased entropy:
          ```bash
          FEATURE_SLUG=$(echo "${FEATURE_NAME:-feature}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
          SESSION_BASE="dev-feature-${FEATURE_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
          SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
          mkdir -p "${SESSION_PATH}/reviews" "${SESSION_PATH}/tests"
          ```
        </step>
        <step>Launch stack-detector agent (detect ALL stacks for fullstack)</step>
        <step>Check for Claudish (multi-model reviews)</step>
        <step>Check for code-analysis plugin (semantic search)</step>
      </steps>
      <quality_gate>Stack detected, dependencies checked</quality_gate>
    </phase>

    <phase number="1" name="Architecture">
      <objective>Design feature architecture</objective>
      <steps>
        <step>Mark PHASE 1 in_progress</step>
        <step>
          If code-analysis available:
          - Use semantic search to find related code
          - Understand existing patterns
        </step>
        <step>
          Launch universal-architect agent:
          ```
          SESSION_PATH: ${SESSION_PATH}
          DETECTED_STACK: {stack}

          Read these skills:
          - {skill_path_1}
          - {skill_path_2}
          - {skill_path_3}

          Design architecture for feature: {feature_request}

          Include:
          1. Component/module structure
          2. Data flow design
          3. API contracts (if applicable)
          4. Database schema changes (if applicable)
          5. Testing strategy
          6. Implementation phases

          Save to: ${SESSION_PATH}/architecture.md
          ```
        </step>
        <step>
          **User Approval Gate** (AskUserQuestion):
          1. Approve architecture
          2. Request changes
          3. Cancel feature
        </step>
        <step>Mark PHASE 1 completed</step>
      </steps>
      <quality_gate>Architecture approved by user</quality_gate>
    </phase>

    <phase number="1.5" name="Architecture Review" optional="true">
      <objective>Multi-model validation of architecture (if Claudish available)</objective>
      <steps>
        <step>Mark PHASE 1.5 in_progress</step>
        <step>
          **Model Selection** (AskUserQuestion, multiSelect: true):
          Default: grok + gemini-flash
          Show historical performance if available
        </step>
        <step>
          Launch parallel reviews (single message, multiple Tasks):
          - Internal: universal-architect reviews
          - External: PROXY_MODE with selected models
        </step>
        <step>Track model performance</step>
        <step>Consolidate feedback</step>
        <step>
          If critical issues found:
          - Revise architecture
          - Return to PHASE 1
        </step>
        <step>Mark PHASE 1.5 completed</step>
      </steps>
      <quality_gate>Architecture validated (or skipped)</quality_gate>
    </phase>

    <phase number="2" name="Implementation">
      <objective>Implement feature according to architecture</objective>
      <steps>
        <step>Mark PHASE 2 in_progress</step>
        <step>
          For each implementation phase from architecture:
          Launch universal-developer agent:
          ```
          SESSION_PATH: ${SESSION_PATH}
          PHASE: {current_phase}

          Read these skills:
          - {skill_path_1}
          - {skill_path_2}

          Implement: {phase_description}
          Following architecture: ${SESSION_PATH}/architecture.md

          Run quality checks before completing.
          ```
        </step>
        <step>Verify each phase completes successfully</step>
        <step>Mark PHASE 2 completed</step>
      </steps>
      <quality_gate>All implementation phases complete</quality_gate>
    </phase>

    <phase number="3" name="Testing">
      <objective>Comprehensive testing of feature</objective>
      <steps>
        <step>Mark PHASE 3 in_progress</step>
        <step>
          Run tests appropriate for stack:
          - Unit tests
          - Integration tests
          - E2E tests (if applicable)
        </step>
        <step>
          If tests fail:
          - Delegate fix to universal-developer
          - Re-run tests
          - Max 2 iterations
        </step>
        <step>Generate test coverage report if available</step>
        <step>Mark PHASE 3 completed</step>
      </steps>
      <quality_gate>All tests pass</quality_gate>
    </phase>

    <phase number="4" name="Code Review">
      <objective>Multi-model code review with performance tracking</objective>
      <steps>
        <step>Mark PHASE 4 in_progress</step>
        <step>Record review start time</step>
        <step>
          **Select Review Models** (if Claudish available):
          - Use same as architecture review [RECOMMENDED]
          - Or select different models
        </step>
        <step>
          Launch parallel reviews:
          - Internal: Claude reviewer
          - External: Selected models via PROXY_MODE
        </step>
        <step>Track model performance</step>
        <step>Consolidate review findings</step>
        <step>
          **Approval Logic**:
          - PASS: 0 CRITICAL, &lt;3 HIGH
          - CONDITIONAL: 0 CRITICAL, 3-5 HIGH
          - FAIL: 1+ CRITICAL OR 6+ HIGH
        </step>
        <step>
          If CONDITIONAL or FAIL:
          - Delegate fixes to universal-developer
          - Re-review (max 2 iterations)
        </step>
        <step>Mark PHASE 4 completed</step>
      </steps>
      <quality_gate>Code review passed</quality_gate>
    </phase>

    <phase number="5" name="User Acceptance">
      <objective>Present feature for user approval</objective>
      <steps>
        <step>Mark PHASE 5 in_progress</step>
        <step>
          Prepare summary:
          - Feature overview
          - Files created/modified
          - Test coverage
          - Review status
          - Performance stats
        </step>
        <step>Show git status/diff</step>
        <step>
          **User Acceptance Gate** (AskUserQuestion):
          1. Accept feature
          2. Request changes -> PHASE 2
          3. Manual testing needed
        </step>
        <step>Mark PHASE 5 completed</step>
      </steps>
      <quality_gate>User accepted feature</quality_gate>
    </phase>

    <phase number="6" name="Finalization">
      <objective>Generate report and complete handoff</objective>
      <steps>
        <step>Mark PHASE 6 in_progress</step>
        <step>
          Create feature report at ${SESSION_PATH}/report.md:
          - Feature summary
          - Architecture decisions
          - Implementation notes
          - Test coverage
          - Review feedback
          - Model performance stats
        </step>
        <step>Update session metadata to "completed"</step>
        <step>
          Display model performance statistics:
          - This session performance
          - Historical performance (if available)
          - Recommendations
        </step>
        <step>Present final summary</step>
        <step>Mark ALL tasks completed</step>
      </steps>
      <quality_gate>Feature complete, report generated</quality_gate>
    </phase>
  </workflow>
</instructions>

<examples>
  <example name="Full-Stack Feature">
    <user_request>/dev:feature User authentication with OAuth2</user_request>
    <execution>
      PHASE 0: Detect fullstack (React + Go), check Claudish
      PHASE 1: Architect designs OAuth2 flow, DB schema, API endpoints
      PHASE 1.5: Grok + Gemini validate architecture
      PHASE 2: Implement backend -> frontend -> integration
      PHASE 3: Unit + integration + E2E tests
      PHASE 4: Multi-model code review -> PASS
      PHASE 5: User accepts
      PHASE 6: Report with performance stats
    </execution>
  </example>
</examples>

<communication>
  <final_message>
## Feature Complete

**Feature**: {feature_name}
**Stack**: {detected_stack}
**Mode**: {mode}
**Session**: ${SESSION_PATH}

**Implementation**:
- Components: {count}
- Files modified: {count}
- Lines added: {count}

**Quality**:
- Tests: {test_count} passing
- Coverage: {coverage}%
- Review: APPROVED

**Model Performance** (this session):
| Model | Time | Quality | Status |
|-------|------|---------|--------|
| {model} | {time}s | {quality}% | PASS |

**Artifacts**:
- Architecture: ${SESSION_PATH}/architecture.md
- Reviews: ${SESSION_PATH}/reviews/
- Report: ${SESSION_PATH}/report.md

Ready for deployment!
  </final_message>
</communication>
```

---

### 4.5 dev-architect Command

**Purpose:** Technology-agnostic architecture planning and design.

```yaml
---
description: |
  Universal architecture planning command for any technology stack.
  Creates comprehensive design documents with trade-off analysis.
  Workflow: DETECT -> ANALYZE -> DESIGN -> DOCUMENT -> VALIDATE
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:universal-patterns, orchestration:quality-gates
---
```

```xml
<role>
  <identity>Universal Architecture Planning Orchestrator</identity>
  <expertise>
    - Technology-agnostic architecture patterns
    - Trade-off analysis
    - System design documentation
    - Cross-stack integration planning
  </expertise>
  <mission>
    Orchestrate comprehensive architecture planning for any feature or system,
    producing detailed design documents with alternatives and trade-offs.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Delegate architecture work to universal-architect agent
      - Produce comprehensive documentation
      - Consider multiple alternatives
      - Analyze trade-offs

      **You MUST NOT:**
      - Write implementation code
      - Skip trade-off analysis
      - Ignore existing patterns
    </orchestrator_role>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Initialize">
      <objective>Setup session and understand requirements</objective>
      <steps>
        <step>Create TodoWrite with architecture phases</step>
        <step>
          Initialize session with increased entropy:
          ```bash
          SESSION_BASE="dev-arch-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
          SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
          mkdir -p "${SESSION_PATH}"
          ```
        </step>
        <step>Detect project stack (all stacks for fullstack)</step>
        <step>Gather context on existing architecture</step>
      </steps>
      <quality_gate>Context gathered, stack detected</quality_gate>
    </phase>

    <phase number="1" name="Requirements Analysis">
      <objective>Understand and document requirements</objective>
      <steps>
        <step>Mark PHASE 1 in_progress</step>
        <step>
          Launch universal-architect agent:
          ```
          SESSION_PATH: ${SESSION_PATH}
          DETECTED_STACK: {stack}

          Analyze requirements for: {architecture_request}

          Document:
          1. Functional requirements
          2. Non-functional requirements (performance, security, scalability)
          3. Constraints (tech stack, budget, timeline)
          4. Assumptions
          5. Dependencies

          Save to: ${SESSION_PATH}/requirements.md
          ```
        </step>
        <step>
          **User Confirmation** (AskUserQuestion):
          "Please review the requirements analysis. Are these accurate?"
        </step>
        <step>Mark PHASE 1 completed</step>
      </steps>
      <quality_gate>Requirements documented and confirmed</quality_gate>
    </phase>

    <phase number="2" name="Alternative Designs">
      <objective>Generate multiple design alternatives</objective>
      <steps>
        <step>Mark PHASE 2 in_progress</step>
        <step>
          Launch universal-architect agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Based on requirements: ${SESSION_PATH}/requirements.md

          Generate 2-3 design alternatives:

          For each alternative, document:
          1. Overview and approach
          2. Component/module structure
          3. Data flow
          4. Technology choices
          5. Pros and cons
          6. Estimated complexity
          7. Risk assessment

          Save to: ${SESSION_PATH}/alternatives.md
          ```
        </step>
        <step>Present alternatives to user</step>
        <step>Mark PHASE 2 completed</step>
      </steps>
      <quality_gate>Multiple alternatives documented</quality_gate>
    </phase>

    <phase number="3" name="Trade-off Analysis">
      <objective>Analyze trade-offs and recommend approach</objective>
      <steps>
        <step>Mark PHASE 3 in_progress</step>
        <step>
          Launch universal-architect agent:
          ```
          SESSION_PATH: ${SESSION_PATH}

          Analyze trade-offs between alternatives in: ${SESSION_PATH}/alternatives.md

          Create trade-off matrix:
          - Performance
          - Maintainability
          - Scalability
          - Security
          - Development effort
          - Operational complexity
          - Cost

          Recommend best approach with justification.

          Save to: ${SESSION_PATH}/tradeoffs.md
          ```
        </step>
        <step>
          **User Decision Gate** (AskUserQuestion):
          ```
          Recommended: Alternative {N}
          Reason: {summary}

          Options:
          1. Proceed with recommended approach
          2. Choose Alternative 2
          3. Choose Alternative 3
          4. Hybrid approach
          5. Request more analysis
          ```
        </step>
        <step>Mark PHASE 3 completed</step>
      </steps>
      <quality_gate>Trade-offs analyzed, approach selected</quality_gate>
    </phase>

    <phase number="4" name="Detailed Design">
      <objective>Create detailed architecture document</objective>
      <steps>
        <step>Mark PHASE 4 in_progress</step>
        <step>
          Launch universal-architect agent:
          ```
          SESSION_PATH: ${SESSION_PATH}
          SELECTED_APPROACH: {approach}

          Create detailed architecture document:

          1. **System Overview**
             - Architecture diagram (text-based)
             - Component descriptions

          2. **Data Design**
             - Database schema
             - Data flow diagrams
             - API contracts

          3. **Technical Specifications**
             - Technology stack details
             - Configuration requirements
             - Infrastructure needs

          4. **Security Design**
             - Authentication/Authorization
             - Data protection
             - Threat model

          5. **Implementation Plan**
             - Phases and milestones
             - Dependencies
             - Risk mitigation

          6. **Testing Strategy**
             - Test types and coverage
             - Test environments

          Save to: ${SESSION_PATH}/architecture.md
          ```
        </step>
        <step>Mark PHASE 4 completed</step>
      </steps>
      <quality_gate>Detailed architecture documented</quality_gate>
    </phase>

    <phase number="5" name="Validation" optional="true">
      <objective>Validate architecture with external review</objective>
      <steps>
        <step>Mark PHASE 5 in_progress</step>
        <step>
          If Claudish available:
          Launch parallel architecture reviews with external models via PROXY_MODE
        </step>
        <step>Consolidate feedback</step>
        <step>
          If significant issues:
          - Revise architecture
          - Update documentation
        </step>
        <step>Mark PHASE 5 completed</step>
      </steps>
      <quality_gate>Architecture validated (or skipped)</quality_gate>
    </phase>

    <phase number="6" name="Finalization">
      <objective>Complete architecture documentation</objective>
      <steps>
        <step>Mark PHASE 6 in_progress</step>
        <step>
          Generate final deliverables:
          - ${SESSION_PATH}/requirements.md
          - ${SESSION_PATH}/alternatives.md
          - ${SESSION_PATH}/tradeoffs.md
          - ${SESSION_PATH}/architecture.md
        </step>
        <step>Present architecture summary</step>
        <step>
          **Next Steps** (AskUserQuestion):
          1. Proceed to implementation (/dev:feature)
          2. Share for stakeholder review
          3. Archive for future reference
        </step>
        <step>Mark ALL tasks completed</step>
      </steps>
      <quality_gate>Architecture documentation complete</quality_gate>
    </phase>
  </workflow>
</instructions>

<examples>
  <example name="Microservices Architecture">
    <user_request>/dev:architect Design user service microservice</user_request>
    <execution>
      PHASE 0: Detect Go backend, gather existing service patterns
      PHASE 1: Document requirements (CRUD, auth, audit)
      PHASE 2: Generate 3 alternatives (monolith, microservice, serverless)
      PHASE 3: Trade-off analysis -> recommend microservice
      PHASE 4: Detailed design with API, DB, deployment
      PHASE 5: Grok + Gemini validation
      PHASE 6: Complete documentation package
    </execution>
  </example>
</examples>

<communication>
  <final_message>
## Architecture Complete

**Project**: {architecture_name}
**Stack**: {detected_stack}
**Mode**: {mode}
**Approach**: {selected_approach}

**Documentation**:
- Requirements: ${SESSION_PATH}/requirements.md
- Alternatives: ${SESSION_PATH}/alternatives.md
- Trade-offs: ${SESSION_PATH}/tradeoffs.md
- Architecture: ${SESSION_PATH}/architecture.md

**Key Decisions**:
1. {decision_1}
2. {decision_2}
3. {decision_3}

Ready for implementation with /dev:feature
  </final_message>
</communication>
```

---

## 5. Skills Organization

### 5.1 Skill Reference Convention

**IMPORTANT:** Skills are referenced consistently across the plugin:

- **In plugin.json:** `./skills/{category}/{skill-name}` (relative path)
- **In commands/agents:** `dev:{skill-name}` (plugin:skill convention)
- **At runtime:** Full absolute paths via `${PLUGIN_ROOT}/skills/{category}/{skill-name}/SKILL.md`

Example mappings:
| plugin.json | Command Reference | Runtime Path |
|-------------|-------------------|--------------|
| `./skills/context-detection` | `dev:context-detection` | `${PLUGIN_ROOT}/skills/context-detection/SKILL.md` |
| `./skills/frontend/react-typescript` | `dev:react-typescript` | `${PLUGIN_ROOT}/skills/frontend/react-typescript/SKILL.md` |
| `./skills/backend/golang` | `dev:golang` | `${PLUGIN_ROOT}/skills/backend/golang/SKILL.md` |

### 5.2 Core Skills (Always Loaded)

#### context-detection

```yaml
---
name: context-detection
description: |
  Patterns for detecting project technology stack from files, configs, and structure.
  Use to determine which framework-specific skills to load.
---
```

**Content includes:**
- File extension mappings
- Config file detection patterns
- Directory structure patterns
- Detection algorithm pseudocode
- Multi-stack detection logic

#### universal-patterns

```yaml
---
name: universal-patterns
description: |
  Language-agnostic development patterns applicable to any technology stack.
  Covers: error handling, logging, configuration, testing structure.
---
```

**Content includes:**
- Error handling patterns (try/catch, Result types, error wrapping)
- Logging best practices (structured logging, levels, correlation IDs)
- Configuration patterns (env vars, config files, secrets)
- Code organization patterns (layered architecture, clean architecture)

#### testing-strategies

```yaml
---
name: testing-strategies
description: |
  Universal testing strategies applicable across technology stacks.
  Covers: unit, integration, E2E testing patterns.
---
```

**Content includes:**
- Test pyramid concepts
- Unit testing patterns (mocking, isolation)
- Integration testing patterns (test containers, fixtures)
- E2E testing patterns (setup, teardown, data management)

#### debugging-strategies

```yaml
---
name: debugging-strategies
description: |
  Universal debugging strategies for investigating issues.
  Covers: root cause analysis, log analysis, trace interpretation.
---
```

**Content includes:**
- Root cause analysis methodology
- Log analysis patterns
- Stack trace interpretation
- Debugging workflow templates

### 5.3 Frontend Skills

#### react-typescript

```yaml
---
name: react-typescript
description: |
  React 19 + TypeScript development patterns.
  Covers: React Compiler, Actions, hooks, component patterns.
---
```

**Content includes:**
- React 19 specific patterns (compiler, actions, use())
- TypeScript strict mode patterns
- Component organization (features, components, routes)
- State management integration (TanStack Query)

#### vue-typescript

```yaml
---
name: vue-typescript
description: |
  Vue 3 + TypeScript development patterns.
  Covers: Composition API, Pinia, Vue Router.
---
```

#### state-management

```yaml
---
name: state-management
description: |
  State management patterns for frontend applications.
  Covers: local state, server state, global state.
---
```

#### testing-frontend

```yaml
---
name: testing-frontend
description: |
  Frontend testing patterns with Vitest, React Testing Library.
  Covers: component tests, hook tests, msw mocking.
---
```

### 5.4 Backend Skills

#### api-design

```yaml
---
name: api-design
description: |
  RESTful API design patterns.
  Covers: resource design, versioning, pagination, error responses.
---
```

#### database-patterns

```yaml
---
name: database-patterns
description: |
  Database design and access patterns.
  Covers: schema design, migrations, repository pattern, query optimization.
---
```

#### auth-patterns

```yaml
---
name: auth-patterns
description: |
  Authentication and authorization patterns.
  Covers: JWT, OAuth2, RBAC, session management.
---
```

#### error-handling

```yaml
---
name: error-handling
description: |
  Backend error handling patterns.
  Covers: custom errors, error codes, global handlers, logging.
---
```

### 5.5 Language-Specific Backend Skills

#### golang

```yaml
---
name: golang
description: |
  Go language patterns and idioms.
  Covers: error handling, interfaces, concurrency, testing.
---
```

**Content includes:**
- Go idioms (error handling, zero values)
- Standard library patterns
- Common frameworks (Gin, Echo, Chi)
- Testing with go test
- Linting with golangci-lint

#### bunjs

```yaml
---
name: bunjs
description: |
  Bun runtime patterns for backend development.
  Covers: Hono framework, Prisma, testing with Bun.
---
```

**Content includes:**
- Bun runtime specifics
- Hono framework patterns
- Prisma integration
- Bun test runner

#### python

```yaml
---
name: python
description: |
  Python backend patterns.
  Covers: FastAPI, SQLAlchemy, pytest, type hints.
---
```

#### rust

```yaml
---
name: rust
description: |
  Rust backend patterns.
  Covers: Axum, SQLx, error handling, testing.
---
```

---

## 6. Agents

### 6.1 stack-detector Agent

```yaml
---
name: stack-detector
description: |
  Analyzes project to detect technology stack and recommend skills.
  Examples:
  (1) "Detect this project's stack" - returns technologies and versions
  (2) "What skills should I use?" - returns skill recommendations with paths
  (3) "Is this a React project?" - confirms stack detection
model: sonnet
color: blue
tools: TodoWrite, Read, Write, Glob, Grep, Bash
---
```

```xml
<role>
  <identity>Technology Stack Detective</identity>
  <expertise>
    - Project analysis and detection
    - Framework version identification
    - Skill recommendation
    - Multi-stack detection
  </expertise>
  <mission>
    Analyze any project to determine its technology stack(s) and recommend
    appropriate skills for the dev plugin to load. Detect ALL stacks in
    fullstack projects.
  </mission>
</role>

<instructions>
  <critical_constraints>
    <todowrite_requirement>
      You MUST use TodoWrite to track detection workflow.
    </todowrite_requirement>

    <multi_stack_detection>
      ALWAYS check for multiple stacks. A project may have:
      - Frontend (React, Vue) in root or /frontend
      - Backend (Go, Rust, Python) in root or /backend
      - Both (fullstack)

      Return ALL detected stacks, not just the first one found.
    </multi_stack_detection>

    <output_requirement>
      When SESSION_PATH is provided, write results to ${SESSION_PATH}/context.json
      with this structure:
      {
        "detected_stack": "react-typescript + golang",
        "mode": "fullstack",
        "stacks": ["react-typescript", "golang"],
        "skill_paths": [
          "${PLUGIN_ROOT}/skills/frontend/react-typescript/SKILL.md",
          "${PLUGIN_ROOT}/skills/backend/golang/SKILL.md"
        ],
        "quality_checks": {
          "frontend": ["bun run format", "bun run lint", "bun run typecheck", "bun test"],
          "backend": ["go fmt ./...", "go vet ./...", "golangci-lint run", "go test ./..."]
        }
      }
    </output_requirement>
  </critical_constraints>

  <workflow>
    <phase number="1" name="File Analysis">
      <step>Glob for ALL config files (package.json, go.mod, Cargo.toml, etc.)</step>
      <step>Read detected config files</step>
      <step>Extract framework and version information for EACH stack</step>
    </phase>

    <phase number="2" name="Structure Analysis">
      <step>Analyze directory structure</step>
      <step>Check for /frontend, /backend, /src organization</step>
      <step>Identify common patterns (src/routes, cmd/, etc.)</step>
    </phase>

    <phase number="3" name="Skill Mapping">
      <step>Map detected technologies to skill paths</step>
      <step>Add core skills (always included)</step>
      <step>Determine mode (frontend, backend, fullstack)</step>
      <step>Generate quality checks for each detected stack</step>
    </phase>

    <phase number="4" name="Report">
      <step>If SESSION_PATH provided: Write to ${SESSION_PATH}/context.json</step>
      <step>Present detection results</step>
      <step>List recommended skills with paths</step>
    </phase>
  </workflow>
</instructions>

<knowledge>
  <config_file_mappings>
    - package.json + react -> react-typescript, testing-frontend
    - package.json + vue -> vue-typescript, testing-frontend
    - go.mod -> golang, api-design, database-patterns
    - Cargo.toml -> rust, api-design
    - pyproject.toml -> python, api-design
    - bun.lockb -> bunjs, api-design
  </config_file_mappings>
</knowledge>
```

### 6.2 universal-developer Agent

```yaml
---
name: universal-developer
description: |
  Language-agnostic implementation agent that adapts to any technology stack.
  Examples:
  (1) "Implement user service" - creates service following detected patterns
  (2) "Add validation" - adds validation using appropriate library
  (3) "Fix linting errors" - resolves issues using stack-specific tools
model: sonnet
color: green
tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep
skills: dev:universal-patterns
---
```

```xml
<role>
  <identity>Universal Implementation Specialist</identity>
  <expertise>
    - Multi-language implementation
    - Pattern adaptation across stacks
    - Quality check execution
  </expertise>
  <mission>
    Implement features in any technology stack by reading and applying patterns
    from specified skill files, then running appropriate quality checks.
  </mission>
</role>

<instructions>
  <critical_constraints>
    <skill_loading>
      Read skill files specified in the prompt BEFORE implementing.
      Extract relevant patterns and apply them during implementation.

      Example prompt structure:
      ```
      Read these skills before implementing:
      - /path/to/skills/react-typescript/SKILL.md
      - /path/to/skills/testing-frontend/SKILL.md

      Then implement: {task}
      ```
    </skill_loading>

    <quality_checks>
      Run appropriate quality checks based on detected stack:
      - react-typescript: bun run format && bun run lint && bun run typecheck
      - golang: go fmt && go vet && golangci-lint run
      - rust: cargo fmt && cargo clippy
      - python: black && ruff && mypy
      - bunjs: bun run format && bun run lint
    </quality_checks>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Load Skills">
      <step>Read all skill files specified in prompt</step>
      <step>Extract relevant patterns for the task</step>
      <step>Note quality check requirements</step>
    </phase>

    <phase number="2" name="Understand">
      <step>Read implementation requirements</step>
      <step>Review relevant existing code</step>
      <step>Map skill patterns to task</step>
    </phase>

    <phase number="3" name="Implement">
      <step>Create/modify files following skill patterns</step>
      <step>Use appropriate libraries for stack</step>
      <step>Add tests if specified</step>
    </phase>

    <phase number="4" name="Validate">
      <step>Run quality checks for stack</step>
      <step>Fix any issues</step>
      <step>Verify tests pass</step>
    </phase>
  </workflow>
</instructions>
```

### 6.3 universal-debugger Agent

```yaml
---
name: universal-debugger
description: |
  Language-agnostic debugging agent for error analysis and root cause investigation.
  Examples:
  (1) "Analyze this error" - parses error and identifies causes
  (2) "Trace null pointer" - investigates nil/null dereference
  (3) "Debug API failure" - traces request/response flow
model: sonnet
color: orange
tools: TodoWrite, Read, Glob, Grep, Bash
skills: dev:debugging-strategies
---
```

```xml
<role>
  <identity>Universal Debugging Specialist</identity>
  <expertise>
    - Cross-language error analysis
    - Stack trace interpretation
    - Root cause investigation
    - Log correlation
  </expertise>
  <mission>
    Analyze errors in any technology stack, trace root causes,
    and provide actionable fix recommendations.
  </mission>
</role>

<instructions>
  <workflow>
    <phase number="1" name="Parse Error">
      <step>Extract error message and type</step>
      <step>Parse stack trace (if available)</step>
      <step>Identify error category</step>
    </phase>

    <phase number="2" name="Analyze">
      <step>List potential root causes</step>
      <step>Rank by likelihood</step>
      <step>Identify relevant code locations</step>
    </phase>

    <phase number="3" name="Investigate">
      <step>Read identified source files</step>
      <step>Trace data/control flow</step>
      <step>Verify or eliminate hypotheses</step>
    </phase>

    <phase number="4" name="Recommend">
      <step>Document confirmed root cause</step>
      <step>Propose fix approach</step>
      <step>Suggest prevention measures</step>
    </phase>
  </workflow>
</instructions>
```

### 6.4 universal-architect Agent

```yaml
---
name: universal-architect
description: |
  Language-agnostic architecture planning agent for system design.
  Examples:
  (1) "Design user service" - creates service architecture
  (2) "Plan API endpoints" - designs REST/GraphQL API
  (3) "Analyze trade-offs" - compares architectural approaches
model: sonnet
color: purple
tools: TodoWrite, Read, Write, Glob, Grep
skills: dev:universal-patterns
---
```

```xml
<role>
  <identity>Universal Architecture Specialist</identity>
  <expertise>
    - Technology-agnostic architecture patterns
    - Trade-off analysis
    - System design documentation
    - Cross-stack integration
  </expertise>
  <mission>
    Design architectures for any technology stack, analyze trade-offs,
    and produce comprehensive documentation.
  </mission>
</role>

<instructions>
  <critical_constraints>
    <proxy_mode_support>
      **FIRST STEP: Check for Proxy Mode Directive**

      Before executing, check if the incoming prompt starts with:
      ```
      PROXY_MODE: {model_name}
      ```

      If you see this directive:

      1. **Extract model name** (e.g., "x-ai/grok-code-fast-1")
      2. **Extract actual task** (everything after PROXY_MODE line)
      3. **Construct agent invocation**:
         ```bash
         AGENT_PROMPT="Use the Task tool to launch the 'universal-architect' agent:

      {actual_task}"
         ```
      4. **Delegate via Claudish**:
         ```bash
         printf '%s' "$AGENT_PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve
         ```
      5. **Return attributed response**:
         ```markdown
         ## Architecture Review via External AI: {model_name}

         {EXTERNAL_AI_RESPONSE}

         ---
         *Generated by: {model_name} via Claudish*
         ```
      6. **STOP** - Do not execute locally

      **If NO PROXY_MODE directive**: Proceed with normal workflow
    </proxy_mode_support>

    <skill_loading>
      Read skill files specified in the prompt BEFORE designing.
      Apply patterns from skills to architecture decisions.
    </skill_loading>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Understand">
      <step>Gather requirements</step>
      <step>Read specified skill files for best practices</step>
      <step>Analyze existing patterns in codebase</step>
      <step>Identify constraints</step>
    </phase>

    <phase number="2" name="Design">
      <step>Create component structure</step>
      <step>Define data flows</step>
      <step>Specify interfaces</step>
    </phase>

    <phase number="3" name="Analyze">
      <step>Evaluate alternatives</step>
      <step>Analyze trade-offs</step>
      <step>Recommend approach</step>
    </phase>

    <phase number="4" name="Document">
      <step>Create architecture document</step>
      <step>Add diagrams (text-based)</step>
      <step>Define implementation phases</step>
    </phase>
  </workflow>
</instructions>
```

---

## 7. Error Recovery

### 7.1 Stack Detection Failures

```yaml
error_recovery:
  stack_detection_failure:
    trigger: "No config files found OR all detection methods fail"
    actions:
      1. Prompt user to specify stack manually:
         AskUserQuestion:
           question: "Could not auto-detect project stack. Please select:"
           options:
             - "react-typescript"
             - "vue-typescript"
             - "golang"
             - "rust"
             - "python"
             - "bunjs"
             - "Other (specify)"
      2. If user selects "Other":
         - Load only core skills (universal-patterns, testing-strategies)
         - Proceed with generic implementation approach
      3. Save user selection to ${SESSION_PATH}/context.json for session
```

### 7.2 Quality Check Failures

```yaml
quality_check_recovery:
  max_retries: 2

  on_failure:
    iteration_1:
      - Analyze failure output
      - Delegate specific fix to universal-developer
      - Re-run quality checks

    iteration_2:
      - Analyze remaining failures
      - Delegate fix with more context
      - Re-run quality checks

    after_max_retries:
      - Present failures to user
      - Options:
        1. "Continue anyway (not recommended)"
        2. "Manual fix needed"
        3. "Abort operation"
```

### 7.3 External Model Timeouts

```yaml
external_model_recovery:
  timeout: 120 seconds

  on_timeout:
    - Log model as "timeout" in performance tracking
    - Check if minimum models completed (>= 2)
    - If yes: Proceed with available reviews
    - If no: Offer user options:
        1. "Retry failed models"
        2. "Continue with internal review only"
        3. "Abort review phase"

  graceful_degradation:
    all_external_fail:
      - Always have internal Claude review as backup
      - Proceed with internal review only
      - Note in report: "External models unavailable"
```

### 7.4 Missing Quality Check Scripts

```yaml
missing_script_recovery:
  detection:
    - Run quality check command
    - Parse error for "command not found" or "script not found"

  actions:
    missing_format: "Skip formatting check, warn user"
    missing_lint: "Skip linting, warn user about code quality"
    missing_typecheck: "Skip type checking, warn user"
    missing_test_runner: "Ask user to run tests manually"

  report:
    - List all skipped checks with reasons
    - Suggest installation commands for missing tools
```

---

## 8. Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create plugin manifest (plugin.json)
- [ ] Create directory structure
- [ ] Implement context-detection skill
- [ ] Implement stack-detector agent
- [ ] Create help command

### Phase 2: Core Commands (Week 2)
- [ ] Implement dev-implement command
- [ ] Implement dev-debug command
- [ ] Implement universal-developer agent
- [ ] Implement universal-debugger agent
- [ ] Add core skills (universal-patterns, testing-strategies, debugging-strategies)

### Phase 3: Extended Commands (Week 3)
- [ ] Implement dev-feature command
- [ ] Implement dev-architect command
- [ ] Implement universal-architect agent with PROXY_MODE
- [ ] Add multi-model validation support

### Phase 4: Frontend Skills (Week 4)
- [ ] Add react-typescript skill
- [ ] Add vue-typescript skill
- [ ] Add state-management skill
- [ ] Add testing-frontend skill

### Phase 5: Backend Skills (Week 5)
- [ ] Add api-design skill
- [ ] Add database-patterns skill
- [ ] Add auth-patterns skill
- [ ] Add error-handling skill

### Phase 6: Language Skills (Week 6)
- [ ] Add golang skill
- [ ] Add bunjs skill
- [ ] Add python skill
- [ ] Add rust skill

### Phase 7: Testing and Polish (Week 7)
- [ ] End-to-end testing of all commands
- [ ] Documentation (README.md)
- [ ] Performance optimization
- [ ] Release preparation

---

## 9. Configuration Options

### User Settings (.claude/settings.json)

```json
{
  "pluginSettings": {
    "dev": {
      "stack": ["react-typescript", "golang"],
      "features": {
        "testing": "vitest",
        "api": "rest",
        "database": "prisma"
      },
      "qualityChecks": {
        "format": true,
        "lint": true,
        "typecheck": true,
        "test": true
      },
      "multiModelReview": {
        "enabled": true,
        "models": ["x-ai/grok-code-fast-1", "google/gemini-2.5-flash"]
      }
    }
  }
}
```

---

## 10. Success Criteria

### Functional Requirements
- [ ] Stack detection works for React, Vue, Go, Rust, Python, Bun
- [ ] Multi-stack detection works for fullstack projects
- [ ] All 5 commands complete successfully
- [ ] Skills auto-load based on detected stack (agent-driven reading)
- [ ] Quality checks run correctly for each stack
- [ ] Multi-model validation works when Claudish available
- [ ] Help command shows accurate stack and skill information

### Quality Requirements
- [ ] Commands follow orchestrator pattern (no direct implementation)
- [ ] TodoWrite tracking in all workflows
- [ ] Session isolation for artifacts (8 hex char entropy)
- [ ] Clear error messages for missing dependencies
- [ ] Consistent communication style
- [ ] Error recovery handles all documented failure modes

### Documentation Requirements
- [ ] README with installation and usage
- [ ] Each skill has clear documentation
- [ ] Examples for common use cases
- [ ] Troubleshooting guide

---

## 11. Dependencies

### Required
- orchestration@mag-claude-plugins >= 0.8.0 (for multi-model validation, quality gates)

### Optional
- code-analysis@mag-claude-plugins (for semantic code search)
- Claudish CLI (for multi-model reviews)

---

## 12. Related Plugins

| Plugin | Relationship |
|--------|--------------|
| frontend | Dev plugin can delegate to frontend agents for React-specific work |
| bun | Dev plugin can delegate to bun agents for Bun-specific work |
| agentdev | Dev plugin follows similar patterns, can use for agent development |
| orchestration | Core dependency for multi-model validation and quality gates |
| code-analysis | Optional integration for semantic code search |

---

## 9. Changelog

### v1.1.0 (2026-01-05)

**CRITICAL Fixes:**

1. **Skill Auto-Loading Mechanism Defined**
   - Added Section 3.5: Agent-Driven Skill Reading Pattern
   - Skills are loaded at runtime via Read tool, not frontmatter
   - stack-detector outputs skill paths to ${SESSION_PATH}/context.json
   - Agents receive skill paths in prompt and read them before implementing

2. **Help Command Added**
   - Added Section 4.1: Complete `/dev:help` command specification
   - Shows detected stack, mode (frontend/backend/fullstack)
   - Lists all 5 commands with descriptions
   - Provides recommended skills for current project
   - Includes configuration examples

3. **PROXY_MODE Support Added to universal-architect**
   - Added `<proxy_mode_support>` section to universal-architect agent
   - Follows pattern from agentdev:patterns skill
   - Enables multi-model architecture reviews via Claudish

**HIGH Priority Fixes:**

4. **Multi-Stack Project Detection**
   - Added Section 3.4: Multi-Stack Detection
   - Detection now identifies ALL stacks present
   - Added "fullstack" mode for combined frontend + backend
   - Quality checks run for both stacks in fullstack mode

5. **Session ID Entropy Increased**
   - Changed from 4 hex chars to 8 hex chars (32 bits)
   - Updated all session initialization code blocks
   - Format: `dev-{type}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)`

6. **Skill Reference Format Aligned**
   - Added Section 5.1: Skill Reference Convention
   - Documented mapping between plugin.json paths, command references, and runtime paths
   - Clear `plugin:skill-name` convention documented

7. **Error Recovery Patterns Added**
   - Added Section 7: Error Recovery
   - Stack detection failure fallback (user manual selection)
   - Quality check max retries (2) with graceful degradation
   - External model timeout handling (120s)
   - Missing script recovery

**Additional Improvements:**

- stack-detector now has Write tool for saving context.json
- Commands updated to read from ${SESSION_PATH}/context.json
- Mode field added to detection output (frontend/backend/fullstack)
- plugin.json version bumped to 1.1.0
- Total commands increased to 5 (added help)

---

**Document Version:** 1.1.0
**Created:** 2026-01-05
**Revised:** 2026-01-05
**Author:** Agent Designer (agentdev:architect)
