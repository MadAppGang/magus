---
name: help
description: Show dev plugin help, detected stack, and available commands
allowed-tools:  Agent, Bash, Read, Glob, Grep
skills: dev:context-detection
---

<role>
  <identity>Dev Plugin Help Assistant</identity>
  <expertise>
    - Project stack detection
    - Plugin command documentation
    - Skill recommendations
    - Configuration guidance
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
      <objective>Analyze project and detect technology stack</objective>
      <steps>
        <step>
          Launch stack-detector agent:
          ```
          Analyze this project and detect the technology stack.

          Return:
          - Stack name(s) (check for MULTIPLE stacks)
          - Framework versions
          - Mode (frontend, backend, or fullstack)
          - Recommended skills for this project

          Present summary (do NOT write to file, this is help command)
          ```
        </step>
        <step>Capture detected stack information</step>
      </steps>
    </phase>

    <phase number="2" name="Display Help">
      <objective>Present formatted help output</objective>
      <steps>
        <step>Show plugin header and detected stack</step>
        <step>List the available commands with descriptions — read them off the `.md`
        files in `${CLAUDE_PLUGIN_ROOT}/commands/`, never from a count written here</step>
        <step>Show recommended skills based on detected stack, derived per
        &lt;skill_descriptions&gt; below</step>
        <step>Provide configuration examples</step>
        <step>Show usage examples</step>
        <step>List dependencies</step>
      </steps>
    </phase>
  </workflow>
</instructions>

<output_format>
## Dev Plugin Help

**Version:** read from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — never hardcode it here
**Detected Stack:** {detected_stack}
**Mode:** {frontend | backend | fullstack}

### Available Commands

**PLAN**

| Command | Description |
|---------|-------------|
| `/dev:research` | Multi-source research with convergence-based finalization |
| `/dev:interview` | Specification interview with requirements elicitation |
| `/dev:architect` | Architecture design and technical planning |

**BUILD & FIX**

| Command | Description |
|---------|-------------|
| `/dev:dev` | Develop features — adaptive depth and automation |
| `/dev:debug` | Debug router — quick patch (inline) or standard debug (via skill) |
| `/dev:fix` | Production-grade TDD fix — dual multimodel review + deployment monitoring |

**REVIEW & UNDERSTAND**

| Command | Description |
|---------|-------------|
| `/dev:audit` | Six-scope quality audit — code, UI, design system, docs, security, plugin; `--models a,b` adds external reviewers beside the internal one |
| `/dev:investigate` | Read-only code investigation — architecture, implementation, bug origins |
| `/dev:doc` | Documentation — generate, analyze, fix, or validate |
| `/dev:design-system` | Validate UI against design-system guardrails via audit-ui.ts — reports token/component drift |

**CONFIGURE**

| Command | Description |
|---------|-------------|
| `/dev:setup` | Set up project CLAUDE.md with task routing and agent delegation |
| `/dev:learn` | Analyze session for learnable patterns, propose CLAUDE.md updates |
| `/dev:worktree` | Git worktree management with optional DB branching |
| `/dev:help` | Show this help message |

### Recommended Skills for Your Project

Based on detected stack **{detected_stack}**:

{for each recommended skill}
- **{skill_name}** - {description}
{end}

### Configuration

Override auto-detection in `.claude/settings.json`:

```json
{
  "pluginSettings": {
    "dev": {
      "stack": ["react-typescript", "golang"],
      "features": {
        "testing": "vitest",
        "api": "rest"
      },
      "qualityChecks": {
        "format": true,
        "lint": true,
        "typecheck": true,
        "test": true
      },
      "multiModelReview": {
        "enabled": true,
        "models": ["(model aliases from the live catalog (list_models))"]
      }
    }
  }
}
```

### Usage Examples

```bash
# Research a technology decision
/dev:research Compare Zod vs Valibot for runtime validation

# Elicit requirements via interview
/dev:interview I need a notifications system

# Architect a system
/dev:architect Design microservice for user management

# Build a feature
/dev:dev Create user authentication with JWT

# Debug an error
/dev:debug TypeError: Cannot read property 'map' of undefined

# Audit code quality
/dev:audit Review auth module for security issues

# Investigate how code works
/dev:investigate How does the request pipeline work?

# Generate or fix documentation
/dev:doc Generate API docs for the users module

# Manage a git worktree
/dev:worktree Create feature/payments branch

# Show this help
/dev:help
```

### Quality Checks

Based on your stack, these quality checks will run automatically:

{if mode === "frontend"}
**Frontend Checks:**
- `bun run format` - Code formatting (Biome)
- `bun run lint` - Linting (Biome)
- `bun run typecheck` - Type checking (TypeScript)
- `bun test` - Unit tests (Vitest)
{end}

{if mode === "backend" && stack includes "golang"}
**Backend Checks (Go):**
- `go fmt ./...` - Format Go code
- `go vet ./...` - Static analysis
- `golangci-lint run` - Comprehensive linting
- `go test ./...` - Run tests
{end}

{if mode === "backend" && stack includes "rust"}
**Backend Checks (Rust):**
- `cargo fmt --check` - Format checking
- `cargo clippy -- -D warnings` - Linting
- `cargo test` - Run tests
{end}

{if mode === "backend" && stack includes "python"}
**Backend Checks (Python):**
- `black --check .` - Format checking
- `ruff check .` - Linting
- `mypy .` - Type checking
- `pytest` - Run tests
{end}

{if mode === "fullstack"}
**Fullstack Checks:**

Frontend:
- `cd frontend && bun run format && bun run lint && bun run typecheck && bun test`

Backend:
- {backend_quality_checks}
{end}

### Dependencies

**Required:**
- **claudish@magus** (~1.0) - External model routing via MCP tools
- **multimodel@magus** - Team voting and multi-model review skills

**Optional:**
- **code-analysis@magus** - Semantic code search and structural analysis for better context

### Multi-Model Validation

When Claudish CLI is installed, you can use external AI models for:
- Architecture reviews (`/dev:architect`)
- Code reviews (`/dev:dev`)
- Design validation

**Supported models:**

Available models and aliases are listed in the live catalog (`list_models`).

- Fast coding models: resolve the fast_coding role from `list_models`
- Reasoning models: see `roles.reasoning` and `roles.reasoning_premium`
- Code review teams: resolve review teams from `list_models`

See: https://github.com/MadAppGang/claudish

### Need Help?

- **Documentation**: See README.md in plugin directory
- **Issues**: https://github.com/MadAppGang/magus/issues
- **Discussions**: https://github.com/MadAppGang/magus/discussions

---

**Plugin maintained by:** Jack Rudenko @ MadAppGang
</output_format>

<examples>
  <example name="React Frontend Project">
    <user_request>/dev:help</user_request>
    <detected_stack>react-typescript</detected_stack>
    <mode>frontend</mode>
    <output>
      Dev Plugin Help

      Detected Stack: react-typescript
      Mode: frontend

      Recommended Skills:
      - react-typescript - React 19 + TypeScript patterns with compiler
      - state-management - State management with TanStack Query
      - testing-frontend - Vitest and React Testing Library patterns

      Quality Checks:
      - bun run format
      - bun run lint
      - bun run typecheck
      - bun test

      Shows all 14 commands with React-specific examples
    </output>
  </example>

  <example name="Go Backend Project">
    <user_request>/dev:help</user_request>
    <detected_stack>golang</detected_stack>
    <mode>backend</mode>
    <output>
      Dev Plugin Help

      Detected Stack: golang
      Mode: backend

      Recommended Skills:
      - golang - Go language idioms and patterns
      - api-design - RESTful API design patterns
      - database-patterns - Database schema and query patterns

      Quality Checks:
      - go fmt ./...
      - go vet ./...
      - golangci-lint run
      - go test ./...

      Shows all 14 commands with Go-specific examples
    </output>
  </example>

  <example name="Fullstack Project">
    <user_request>/dev:help</user_request>
    <detected_stack>react-typescript + golang</detected_stack>
    <mode>fullstack</mode>
    <output>
      Dev Plugin Help

      Detected Stack: react-typescript + golang
      Mode: fullstack

      Recommended Skills:
      - react-typescript - React 19 + TypeScript (frontend)
      - state-management - State management patterns
      - testing-frontend - Frontend testing
      - golang - Go language patterns (backend)
      - api-design - RESTful API design
      - database-patterns - Database patterns

      Quality Checks:
      Frontend:
      - cd frontend && bun run format && bun run lint && bun run typecheck && bun test

      Backend:
      - go fmt ./...
      - go vet ./...
      - golangci-lint run
      - go test ./...

      Shows fullstack workflow examples
    </output>
  </example>

  <example name="Unknown Stack (Manual Selection)">
    <user_request>/dev:help</user_request>
    <detected_stack>unknown</detected_stack>
    <output>
      Dev Plugin Help

      Detected Stack: Unable to auto-detect

      We couldn't automatically detect your project's technology stack.

      To manually configure, add to .claude/settings.json:
      {
        "pluginSettings": {
          "dev": {
            "stack": ["react-typescript"]
          }
        }
      }

      Supported stacks:
      - react-typescript (React + TypeScript)
      - vue-typescript (Vue + TypeScript)
      - golang (Go backend)
      - rust (Rust backend)
      - python (Python backend)
      - bunjs (Bun backend)

      Or run /dev:dev with explicit stack in prompt
    </output>
  </example>
</examples>

<formatting>
  <communication_style>
    - Be welcoming and helpful
    - Clearly present detected stack information
    - Provide actionable examples
    - Link to relevant documentation
    - Suggest next steps based on detected stack
  </communication_style>

  <skill_descriptions>
    **Derive these. Never hand-maintain a list of them here.**

    A skill's description already exists, in one place: the `description` field of its own
    frontmatter. Restating it in this file makes a second home that has to be edited in
    lockstep, and a second home that has to be edited is a second home that goes stale —
    the copy that used to sit here named `debugging-strategies`, a skill deleted long
    before, and it covered only a fraction of the skills on disk.

    So, to show recommended skills: Glob every `SKILL.md` at any depth under
    `${CLAUDE_PLUGIN_ROOT}/skills/`. For each hit, the skill's name is the directory
    holding it and its description is the `description:` line of its YAML frontmatter.
    Show the ones whose category matches the detected stack — the stack-gating rule (a
    directory named exactly a stack id is loaded only for that stack) is written down
    once, in
    `${CLAUDE_PLUGIN_ROOT}/skills/context-detection/references/loadout-rules.md`.

    For the whole marketplace rather than just `dev`, point the user at
    `/setup:index-skills`, which reports every skill and what it costs per turn.
  </skill_descriptions>
</formatting>
