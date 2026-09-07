---
name: context-detection
description: "Detects the project stack from its config files, then names the one or two dev skill files to read for this task — it loads none of them. Use at the start of any coding task, or on an unfamiliar or multi-stack repo."
allowed-tools: Bash(node *)
user-invocable: false
---

# Context Detection Skill

## Scope: this skill maps EVIDENCE to STACK. It does not map stack to skill

The line matters, and it is the whole reason this file was rewritten.

| Question | Answered in |
|---|---|
| Which stacks is this repo built from, and what proves it? | **here** |
| Which paths should agent X read for task Y? | [`references/loadout-rules.md`](references/loadout-rules.md) |
| What shape does the emitted artifact take? | [`references/context-schema.md`](references/context-schema.md) |

This file used to answer all three. It carried a bash `generate_skill_paths()` and a
`map_stacks_to_skills()` table, and `plugins/dev/agents/stack-detector.md` carried the same
mapping again in XML. Two hand-maintained copies, both loaded on nearly every `dev` entry
point — this skill is preloaded by ten commands — so when one went stale, it went stale
twice. A skill path that had never existed shipped in both.

**Both copies are gone.** Stack→skill mapping now has exactly one home,
`references/loadout-rules.md`, and skill paths are derived from the filesystem at detection
time rather than recalled from a table. Do not reintroduce a table here, in any language,
in any fence.

## Quick Start: Skill Discovery Script

Run the helper script to discover ALL skills available to a project:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/context-detection/scripts/discover-skills.js" "$(pwd)"
```

This searches all 7 official Claude Code skill locations:
1. Personal: `~/.claude/skills/`
2. Project: `.claude/skills/`
3. Nested (monorepos): `**/.claude/skills/`
4. Legacy commands: `.claude/commands/`
5. Marketplace plugins: `~/.claude/plugins/marketplaces/{m}/plugins/{p}/skills/`
6. Local plugins: `.claude-plugin/skills/`, `plugins/*/skills/`
7. Enterprise (managed settings)

**Output:** JSON with summary stats and full skill metadata.

For detailed documentation on the script, see [scripts/discover-skills.js](scripts/discover-skills.js).

---

## Overview

The context detection skill provides systematic patterns for analyzing any project to determine its technology stack(s). It enables the dev plugin to auto-load appropriate framework-specific skills based on what's actually in the project.

**Key Innovation:** Multi-stack detection for fullstack projects (e.g., React + Go).

---

## Detection Priority

Detection follows a priority order from most explicit to most inferred:

### 1. Explicit User Preference (Highest Priority)

**Source:** `.claude/settings.json`

```json
{
  "pluginSettings": {
    "dev": {
      "stack": ["react-typescript", "golang"],
      "features": {
        "testing": "vitest",
        "api": "rest"
      }
    }
  }
}
```

**When to use:**
- User wants to override auto-detection
- Project has ambiguous structure
- Custom stack combinations

### 2. Current File Context

**Source:** File extension of current editing context

```yaml
# extension -> stack id. Stack ids only; which SKILL a stack implies is not decided here.
extension_mappings:
  ".tsx": ["react-typescript"]
  ".vue": ["vue-typescript"]
  ".go": ["golang"]
  ".dingo": ["dingo", "golang"]   # Dingo transpiles to Go, so both
  ".rs": ["rust"]
  ".py": ["python"]
```

**When to use:**
- User is editing a specific file
- Immediate context for implementation
- Quick detection without full project scan

### 3. Configuration Files (Primary Detection)

**Source:** Project configuration files

```yaml
# config file -> stack id + mode. No skill names: see references/loadout-rules.md.
config_file_patterns:
  package.json (react):
    check: "dependencies.react or devDependencies.react exists"
    stacks: ["react-typescript"]
    mode: "frontend"

  package.json (vue):
    check: "dependencies.vue exists"
    stacks: ["vue-typescript"]
    mode: "frontend"

  go.mod:
    check: "file exists"
    stacks: ["golang"]
    mode: "backend"

  go.mod + *.dingo:
    check: "go.mod exists AND any .dingo file present"
    stacks: ["dingo", "golang"]
    mode: "backend"
    note: "Dingo transpiles to Go, so a Dingo repo is also a Go repo"

  Cargo.toml:
    check: "file exists"
    stacks: ["rust"]
    mode: "backend"

  pyproject.toml:
    check: "file exists"
    stacks: ["python"]
    mode: "backend"

  bun.lockb:
    check: "file exists AND no react/vue in package.json"
    stacks: ["bunjs"]
    mode: "backend"
```

**When to use:**
- First time analyzing a project
- Most reliable detection method
- Determine versions and dependencies

### 4. Directory Structure Patterns (Supporting Evidence)

**Source:** Common directory layouts

```yaml
directory_patterns:
  "src/routes/":
    indicator: "React Router structure"
    stacks: ["react-typescript"]

  "src/components/":
    indicator: "Component-based frontend"
    stacks: ["react-typescript", "vue-typescript"]

  "cmd/":
    indicator: "Go standard project layout"
    stacks: ["golang"]

  "src/main.rs":
    indicator: "Rust binary crate"
    stacks: ["rust"]

  "frontend/":
    indicator: "Separate frontend directory (fullstack)"
    note: "Check for backend/ as well"

  "backend/":
    indicator: "Separate backend directory (fullstack)"
    note: "Check for frontend/ as well"
```

**When to use:**
- Confirming config file detection
- Identifying fullstack projects
- Disambiguating multi-purpose projects

---

## Multi-Stack Detection Algorithm

**CRITICAL:** Always check for MULTIPLE stacks. Projects can be fullstack.

```bash
# Step 1: Find ALL config files (not just first match)
find_all_configs() {
  configs=()
  [ -f "package.json" ] && configs+=("package.json")
  [ -f "go.mod" ] && configs+=("go.mod")
  [ -f "Cargo.toml" ] && configs+=("Cargo.toml")
  [ -f "pyproject.toml" ] && configs+=("pyproject.toml")
  [ -f "bun.lockb" ] && configs+=("bun.lockb")

  # Check for Dingo files (go.mod must also exist)
  # Note: "dingo" is a detection indicator, not an actual config file name
  if [ -f "go.mod" ] && find . -name "*.dingo" -type f ! -path "./.git/*" ! -path "./node_modules/*" ! -path "./vendor/*" -print -quit | grep -q .; then
    configs+=("dingo")
  fi

  echo "${configs[@]}"
}

# Step 2: Analyze EACH config file
analyze_all_configs() {
  local detected_stacks=()

  # Check package.json
  if [ -f "package.json" ]; then
    if grep -q '"react"' package.json; then
      detected_stacks+=("react-typescript")
    elif grep -q '"vue"' package.json; then
      detected_stacks+=("vue-typescript")
    fi
  fi

  # Check go.mod (and optionally Dingo)
  if [ -f "go.mod" ]; then
    # Check if this is a Dingo project
    if find . -name "*.dingo" -type f ! -path "./.git/*" ! -path "./node_modules/*" ! -path "./vendor/*" -print -quit | grep -q .; then
      detected_stacks+=("dingo")
      # Dingo always co-loads golang
      detected_stacks+=("golang")
    else
      detected_stacks+=("golang")
    fi
  fi

  # Check Cargo.toml
  if [ -f "Cargo.toml" ]; then
    detected_stacks+=("rust")
  fi

  # Check pyproject.toml
  if [ -f "pyproject.toml" ]; then
    detected_stacks+=("python")
  fi

  # Check bun.lockb (only if NOT frontend)
  if [ -f "bun.lockb" ] && ! grep -q '"react"\|"vue"' package.json 2>/dev/null; then
    detected_stacks+=("bunjs")
  fi

  echo "${detected_stacks[@]}"
}

# Step 3: Determine mode
determine_mode() {
  local stacks=("$@")
  local has_frontend=false
  local has_backend=false

  for stack in "${stacks[@]}"; do
    case "$stack" in
      react-typescript|vue-typescript)
        has_frontend=true
        ;;
      golang|rust|python|bunjs|dingo)
        has_backend=true
        ;;
    esac
  done

  if [ "$has_frontend" = true ] && [ "$has_backend" = true ]; then
    echo "fullstack"
  elif [ "$has_frontend" = true ]; then
    echo "frontend"
  elif [ "$has_backend" = true ]; then
    echo "backend"
  else
    echo "unknown"
  fi
}

# Step 4: Complete detection
#
# NOTE: there is deliberately no `map_stacks_to_skills` step here. Turning a stack list
# into a reading list is NOT this file's job — see references/loadout-rules.md. A copy of
# that mapping used to live right here, and a second copy lived in the stack-detector
# agent; keeping them in sync failed, and a dead skill path shipped in both.
detect_project_stack() {
  # Check explicit preference first
  local explicit_stack=$(jq -r '.pluginSettings.dev.stack // empty' .claude/settings.json 2>/dev/null)
  if [ -n "$explicit_stack" ]; then
    echo "Using explicit stack from .claude/settings.json"
    return
  fi

  # Auto-detect all stacks
  local detected_stacks=($(analyze_all_configs))

  if [ ${#detected_stacks[@]} -eq 0 ]; then
    echo "ERROR: No stack detected"
    return 1
  fi

  local mode=$(determine_mode "${detected_stacks[@]}")

  echo "Detected: ${detected_stacks[*]}"
  echo "Mode: $mode"
}
```

---

## Framework-Specific Detection

### React Detection

```bash
detect_react() {
  # Check package.json
  if [ -f "package.json" ]; then
    # React in dependencies or devDependencies
    if jq -e '.dependencies.react // .devDependencies.react' package.json >/dev/null 2>&1; then
      # Check for TypeScript
      local has_typescript=false
      if jq -e '.dependencies["@types/react"] // .devDependencies["@types/react"]' package.json >/dev/null 2>&1; then
        has_typescript=true
      fi

      # Get version
      local react_version=$(jq -r '.dependencies.react // .devDependencies.react' package.json | sed 's/[^0-9.]//g')

      echo "react-typescript"
      echo "version: $react_version"
      echo "typescript: $has_typescript"
      return 0
    fi
  fi

  return 1
}
```

### Vue Detection

```bash
detect_vue() {
  if [ -f "package.json" ]; then
    if jq -e '.dependencies.vue' package.json >/dev/null 2>&1; then
      local vue_version=$(jq -r '.dependencies.vue' package.json | sed 's/[^0-9.]//g')
      echo "vue-typescript"
      echo "version: $vue_version"
      return 0
    fi
  fi

  return 1
}
```

### Go Detection

```bash
detect_go() {
  if [ -f "go.mod" ]; then
    local go_version=$(grep '^go ' go.mod | awk '{print $2}')
    local module_name=$(grep '^module ' go.mod | awk '{print $2}')

    echo "golang"
    echo "version: $go_version"
    echo "module: $module_name"
    return 0
  fi

  return 1
}
```

### Rust Detection

```bash
detect_rust() {
  if [ -f "Cargo.toml" ]; then
    local package_name=$(grep '^\[package\]' -A 5 Cargo.toml | grep '^name' | cut -d'"' -f2)
    local edition=$(grep '^\[package\]' -A 5 Cargo.toml | grep '^edition' | cut -d'"' -f2)

    echo "rust"
    echo "edition: $edition"
    echo "package: $package_name"
    return 0
  fi

  return 1
}
```

### Python Detection

```bash
detect_python() {
  if [ -f "pyproject.toml" ]; then
    local has_fastapi=$(grep -i 'fastapi' pyproject.toml)
    local has_django=$(grep -i 'django' pyproject.toml)

    echo "python"
    [ -n "$has_fastapi" ] && echo "framework: fastapi"
    [ -n "$has_django" ] && echo "framework: django"
    return 0
  fi

  return 1
}
```

### Bun Detection

```bash
detect_bun() {
  # Bun backend (NOT frontend with Bun runtime)
  if [ -f "bun.lockb" ]; then
    # Check if this is a frontend project
    if [ -f "package.json" ]; then
      if jq -e '.dependencies.react // .dependencies.vue' package.json >/dev/null 2>&1; then
        # This is frontend using Bun runtime, not Bun backend
        return 1
      fi
    fi

    # This is a Bun backend project
    echo "bunjs"
    return 0
  fi

  return 1
}
```

---

## Quality Checks by Stack

Quality checks are automatically determined based on detected stack(s):

### Frontend Quality Checks

```yaml
react-typescript:
  - command: "bun run format"
    tool: "Biome"
    purpose: "Code formatting"
  - command: "bun run lint"
    tool: "Biome"
    purpose: "Linting"
  - command: "bun run typecheck"
    tool: "TypeScript"
    purpose: "Type checking"
  - command: "bun test"
    tool: "Vitest"
    purpose: "Unit tests"

vue-typescript:
  - command: "bun run format"
    tool: "Biome"
  - command: "bun run lint"
    tool: "Biome"
  - command: "bun run typecheck"
    tool: "TypeScript"
  - command: "bun test"
    tool: "Vitest"
```

### Backend Quality Checks

```yaml
golang:
  - command: "go fmt ./..."
    purpose: "Format Go code"
  - command: "go vet ./..."
    purpose: "Static analysis"
  - command: "golangci-lint run"
    purpose: "Comprehensive linting"
  - command: "go test ./..."
    purpose: "Run tests"

dingo:
  - command: "dingo fmt"
    purpose: "Format Dingo source files"
  - command: "dingo go"
    purpose: "Transpile Dingo to Go"
  - command: "go vet ./.dingo/..."
    purpose: "Static analysis on generated Go"
  - command: "golangci-lint run ./.dingo/..."
    purpose: "Comprehensive linting on generated Go"
  - command: "go test ./.dingo/..."
    purpose: "Run tests on generated Go"

rust:
  - command: "cargo fmt --check"
    purpose: "Check formatting"
  - command: "cargo clippy -- -D warnings"
    purpose: "Linting"
  - command: "cargo test"
    purpose: "Run tests"

python:
  - command: "black --check ."
    purpose: "Check formatting"
  - command: "ruff check ."
    purpose: "Linting"
  - command: "mypy ."
    purpose: "Type checking"
  - command: "pytest"
    purpose: "Run tests"

bunjs:
  - command: "bun run format"
    tool: "Biome"
  - command: "bun run lint"
    tool: "Biome"
  - command: "bun run typecheck"
    tool: "TypeScript"
  - command: "bun test"
    tool: "Bun test runner"
```

### Fullstack Quality Checks

For fullstack projects, run checks for BOTH stacks:

```yaml
fullstack (react + go):
  frontend:
    directory: "./frontend"
    checks:
      - "cd frontend && bun run format"
      - "cd frontend && bun run lint"
      - "cd frontend && bun run typecheck"
      - "cd frontend && bun test"
  backend:
    directory: "."
    checks:
      - "go fmt ./..."
      - "go vet ./..."
      - "golangci-lint run"
      - "go test ./..."
```

---

## Skill path generation — not here

**There is no `generate_skill_paths()` in this file, and adding one back is a regression.**

Turning a stack list into a reading list happens in one place:
[`references/loadout-rules.md`](references/loadout-rules.md). It holds the category→agent
rules (R1-R9), the stack-gating-by-name rule, the task gates, and the per-agent cap. Paths
are then **derived from the filesystem** — a directory with `SKILL.md` is a skill, one
without is a category — rather than recalled from a table.

**Two trees, one rule set.** A plugin's reference manuals live in `knowledge/`, not
`skills/`: `${CLAUDE_PLUGIN_ROOT}/knowledge/backend/golang.md`,
`${CLAUDE_PLUGIN_ROOT}/knowledge/frontend/react-typescript.md`, and so on. The category
names mirror `skills/` exactly, so R1-R9 apply to both without a second clause. Enumerate
both when building a loadout — a stack-gated rule that only walks `skills/` now finds
almost nothing, because most of what it used to name is knowledge.

Why the function is gone rather than merely moved:

- It duplicated an XML block in `plugins/dev/agents/stack-detector.md`. Two hand-maintained
  copies of one table is the shape that put a nonexistent skill path in both.
- It was a hardcoded list of ~16 paths against a much larger tree, so every new skill was
  invisible to it until someone remembered to edit two files.
- It produced ONE flat list handed identically to every agent, which is precisely what
  `agent_loadouts` replaces. A reviewer and a test architect should not be reading the same
  five files.

Two rules that survive it, and still bind:

- **Always use the `${CLAUDE_PLUGIN_ROOT}` placeholder, never a hardcoded absolute path.** It
  is expanded at runtime to the installed plugin directory, which differs per machine and
  per version.
- **`stat` every path before emitting it.** `bun scripts/check-plugin-paths.ts` gates the
  paths written in plugin markdown; nothing gates a path a running agent invents, so the
  detector verifies its own output and records each drop in `warnings`.

---

## Error Handling

### No Stack Detected

```yaml
error: "no_stack_detected"
trigger: "No config files found AND no recognizable directory structure"
recovery:
  1. Prompt user for manual stack selection
  2. Offer generic "unknown" stack with only core skills
  3. Save user choice to ${SESSION_PATH}/context.json
  4. Proceed with core skills only
```

### Ambiguous Detection

```yaml
error: "ambiguous_stack"
trigger: "Multiple possible interpretations"
recovery:
  1. Present all possibilities to user
  2. Ask for confirmation
  3. Save confirmed stack to context
```

### Incomplete Detection

```yaml
error: "incomplete_detection"
trigger: "Found some indicators but missing key files"
recovery:
  1. Report partial detection
  2. Load available skills
  3. Warn user about potential missing skills
```

---

## Detection Examples

Each example shows only what THIS skill produces: the `repo` block of `context.json` v2.
None of them lists skill paths — that is `references/loadout-rules.md`'s output, derived
per agent and per task, and a copy of it here is exactly the duplication this file shed.

### Example 1: React frontend

```
project/
├── package.json (with react: "^19.0.0")
├── src/routes/
├── src/components/
└── *.tsx
```

```json
{
  "detected_stack": "react-typescript",
  "mode": "frontend",
  "stacks": ["react-typescript"],
  "frameworks": { "react": "19.0.0" },
  "shape": "single",
  "evidence": [{ "claim": "react-typescript", "file": "package.json", "line": 12 }]
}
```

### Example 2: Go backend

```
project/
├── go.mod
├── cmd/server/
└── internal/
```

```json
{
  "detected_stack": "golang",
  "mode": "backend",
  "stacks": ["golang"],
  "frameworks": { "go": "1.21" },
  "shape": "single",
  "evidence": [{ "claim": "golang", "file": "go.mod", "line": 3 }]
}
```

### Example 3: Fullstack (React + Go)

```
project/
├── frontend/package.json (with react)
├── go.mod
├── cmd/
└── internal/
```

```json
{
  "detected_stack": "react-typescript + golang",
  "mode": "fullstack",
  "stacks": ["react-typescript", "golang"],
  "frameworks": { "react": "19.0.0", "go": "1.21" },
  "shape": "monorepo",
  "evidence": [
    { "claim": "react-typescript", "file": "frontend/package.json", "line": 14 },
    { "claim": "golang", "file": "go.mod", "line": 3 }
  ]
}
```

### Example 4: Dingo backend

```
project/
├── go.mod
├── cmd/api/main.dingo
├── internal/handlers/user.dingo
└── .dingo/                  # generated .go files, gitignored
```

```json
{
  "detected_stack": "dingo + golang",
  "mode": "backend",
  "stacks": ["dingo", "golang"],
  "frameworks": { "go": "1.21" },
  "shape": "single",
  "evidence": [
    { "claim": "golang", "file": "go.mod", "line": 3 },
    { "claim": "dingo", "file": "cmd/api/main.dingo", "line": 1 }
  ]
}
```

`dingo` and `golang` appear together because Dingo transpiles to Go. That is a detection
fact, so it belongs here; which SKILL each of them implies does not.

**Every claim carries a citation.** A classification with no `evidence` entry cannot be
argued with by the agent that receives it, and an unarguable wrong answer is the expensive
kind.

---

## Integration with agents

### `dev:stack-detector`

The detector consumes this file for detection patterns, and two others for everything else:

| Reads | For |
|---|---|
| this file | evidence → stack, mode, shape, quality-check defaults |
| [`references/loadout-rules.md`](references/loadout-rules.md) | category → agent, stack gating, task gates, the per-agent cap |
| [`references/context-schema.md`](references/context-schema.md) | the exact shape of the artifact it writes |

It then writes `${SESSION_PATH}/context.json` and returns a summary. Under plan mode it
writes nothing and returns the JSON instead.

### Orchestrator commands

Commands read `context.json` and pass **that agent's own loadout** — never one flat list to
everybody:

```
Agent: dev:developer
Prompt: |
  SESSION_PATH: ${SESSION_PATH}

  Read before implementing (from context.json -> agent_loadouts.developer.read;
  entries marked MANDATORY are not optional):
  {for each path in agent_loadouts.developer.read}
  - {path}{if mandatory} (MANDATORY){end}
  {end}

  Then implement: {task}
```

Handing every agent the same list is what `agent_loadouts` exists to stop. A reviewer and a
test architect need different files, and a flat list guarantees at least one of them is
reading the wrong thing.

### Implementation agents

1. Read the paths given in the prompt, mandatory ones first.
2. Apply the patterns while implementing.
3. A path that fails to open is a bug in the detector, not a reason to guess a replacement —
   report it.
