# Plugin Design: agent-development

**Version:** 1.0.0
**Author:** MadAppGang
**Date:** 2025-11-26
**Status:** Design Phase

## Executive Summary

This plugin packages the existing agent development infrastructure (agent-architect, agent-developer, agent-reviewer, and /develop-agent command) into a reusable plugin that can be installed in any project requiring custom Claude Code agent creation.

**Key Benefits:**
- **Reusability** - Use proven agent development patterns across projects
- **Dependency on Orchestration** - Leverage shared multi-model validation and quality gates
- **Reduced Duplication** - Extract common patterns into skills
- **Consistent Updates** - Single source of truth for agent development tooling

---

## Current State Analysis

### Existing Assets (Total: ~3,555 lines)

| Asset | Location | Lines | Purpose |
|-------|----------|-------|---------|
| agent-architect | `.claude/agents/agent-architect.md` | ~890 | Design agents with comprehensive planning |
| agent-developer | `.claude/agents/agent-developer.md` | ~779 | Implement agents with perfect XML/YAML |
| agent-reviewer | `.claude/agents/agent-reviewer.md` | ~887 | Review agents for quality compliance |
| /develop-agent | `.claude/commands/develop-agent.md` | ~999 | Full-cycle orchestration command |

### Key Features Already Implemented
- ✅ Multi-model validation via Claudish
- ✅ Parallel execution support
- ✅ Quality gates and iteration loops
- ✅ TodoWrite integration
- ✅ Proxy mode for external LLM reviews
- ✅ Comprehensive templates and patterns
- ✅ XML tag standards compliance

### Problems with Current Approach
1. **Duplication** - Proxy mode code duplicated in all 3 agents (~150 lines each)
2. **No Skill Extraction** - XML standards, patterns embedded inline (not reusable)
3. **Hardcoded Costs** - Model pricing hardcoded in command (should reference shared data)
4. **Local Only** - Can't use in other projects without copy-paste

---

## Plugin Structure

```
plugins/agent-development/
├── plugin.json                      # Plugin manifest
├── README.md                        # User documentation
├── DEPENDENCIES.md                  # Dependency documentation
│
├── agents/
│   ├── architect.md                 # Agent designer (refactored)
│   ├── developer.md                 # Agent implementer (refactored)
│   └── reviewer.md                  # Agent reviewer (refactored)
│
├── commands/
│   └── develop.md                   # /develop command (refactored)
│
└── skills/
    ├── xml-tag-standards/           # Extracted XML patterns
    │   └── SKILL.md
    ├── agent-patterns/              # Common agent patterns
    │   └── SKILL.md
    └── frontmatter-schemas/         # YAML frontmatter schemas
        └── SKILL.md
```

---

## Dependencies

### Required: orchestration@magus

```json
{
  "dependencies": {
    "orchestration@magus": "^0.1.1"
  }
}
```

**Skills Used from Orchestration:**

| Skill | Usage in agent-development |
|-------|---------------------------|
| `multi-model-validation` | Plan review (PHASE 1.5), Implementation review (PHASE 3) |
| `quality-gates` | Iteration loops, approval gates, severity classification |
| `todowrite-orchestration` | Phase tracking in /develop command |
| `error-recovery` | Claudish failures, review disagreements |
| `multi-agent-coordination` | Agent delegation patterns |

**Benefits of Dependency:**
- Reduces `/develop` command from ~999 lines to ~600 lines
- Ensures orchestration patterns stay in sync
- Automatic updates when orchestration improves

---

## Improvements & Refactoring

### 1. Extract XML Tag Standards into Skill

**Current:** Duplicated in agent-architect, agent-developer, agent-reviewer
**Proposed:** New skill `xml-tag-standards`

```markdown
# XML Tag Standards Skill

## Core Tags (ALL agents/commands)
- `<role>` - Identity, expertise, mission
- `<instructions>` - Constraints, principles, workflow
- `<knowledge>` - Best practices, templates
- `<examples>` - Concrete scenarios
- `<formatting>` - Communication style

## Specialized Tags by Type
### Orchestrators
- `<orchestration>`, `<phases>`, `<delegation_rules>`, `<error_recovery>`

### Planners
- `<planning_methodology>`, `<gap_analysis>`, `<output_structure>`

### Implementers
- `<implementation_standards>`, `<quality_checks>`

### Reviewers
- `<review_criteria>`, `<focus_areas>`, `<feedback_format>`

### Testers
- `<testing_strategy>`, `<test_types>`, `<coverage_requirements>`
```

**Impact:** -300 lines from agents (100 lines each × 3)

### 2. Extract Proxy Mode into Skill

**Current:** ~150 lines duplicated in each agent
**Proposed:** New skill `proxy-mode` OR reference `orchestration:multi-model-validation`

**Decision:** Reference orchestration skill instead of creating new one.

Agents will include in frontmatter:
```yaml
---
skills: orchestration:multi-model-validation
---
```

**Impact:** -400 lines from agents (~130 lines each × 3)

### 3. Extract Frontmatter Schemas into Skill

**Current:** YAML schemas duplicated in agent-architect and agent-developer
**Proposed:** New skill `frontmatter-schemas`

```markdown
# Frontmatter Schemas Skill

## Agent Frontmatter
```yaml
---
name: agent-name               # lowercase-with-hyphens
description: |                 # Detailed with 3-5 examples
  Use this agent when...
  Examples: (1) ... (2) ... (3) ...
model: sonnet                  # sonnet | opus | haiku
color: purple                  # purple | cyan | green | orange | blue | red
tools: TodoWrite, Read, Write  # Comma-separated, space after comma
skills: skill1, skill2         # Optional skill references
---
```

## Command Frontmatter
```yaml
---
description: |                 # Detailed workflow description
  Command description...
  Workflow: PHASE 1 → PHASE 2 → ...
allowed-tools: Task, Bash      # Comma-separated, space after comma
skills: skill1, skill2         # Optional skill references
---
```
```

**Impact:** -100 lines from agents

### 4. Reference Orchestration Skills in /develop Command

**Current:** 999 lines with inline orchestration logic
**Proposed:** Reference skills, reduce to ~600 lines

```yaml
---
description: Full-cycle agent development with multi-model validation...
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: |
  orchestration:multi-model-validation,
  orchestration:quality-gates,
  orchestration:todowrite-orchestration,
  orchestration:error-recovery,
  agent-development:xml-tag-standards
---
```

**Impact:** -400 lines from command

### 5. Add Agent Templates in Skill

**Proposed:** New skill `agent-patterns` with templates

```markdown
# Agent Patterns Skill

## Templates

### Orchestrator Template
[Complete template for orchestrator commands]

### Planner Template
[Complete template for planning agents]

### Implementer Template
[Complete template for implementation agents]

### Reviewer Template
[Complete template for review agents]

### Tester Template
[Complete template for testing agents]
```

**Impact:** +200 lines (new content, high value)

---

## Estimated Line Counts After Refactoring

| Asset | Current | After Refactor | Change |
|-------|---------|----------------|--------|
| architect.md | 890 | 550 | -340 |
| developer.md | 779 | 480 | -299 |
| reviewer.md | 887 | 550 | -337 |
| develop.md | 999 | 600 | -399 |
| xml-tag-standards/SKILL.md | 0 | 200 | +200 |
| agent-patterns/SKILL.md | 0 | 300 | +300 |
| frontmatter-schemas/SKILL.md | 0 | 100 | +100 |
| **TOTAL** | **3,555** | **2,780** | **-775** |

**Net Result:** 22% reduction in total lines while improving modularity and reusability.

---

## Plugin Manifest (plugin.json)

```json
{
  "name": "agent-development",
  "version": "1.0.0",
  "description": "Create, implement, and review Claude Code agents and commands with multi-model validation. Includes specialized agents for design, implementation, and quality review, plus a full-cycle orchestration command.",
  "author": "MadAppGang",
  "license": "MIT",
  "homepage": "https://github.com/MadAppGang/magus",

  "tags": [
    "agent-development",
    "agents",
    "commands",
    "multi-model",
    "claudish",
    "quality-review",
    "xml-standards",
    "orchestration"
  ],

  "agents": [
    "architect",
    "developer",
    "reviewer"
  ],

  "commands": [
    "develop"
  ],

  "skills": [
    "xml-tag-standards",
    "agent-patterns",
    "frontmatter-schemas"
  ],

  "dependencies": {
    "orchestration@magus": "^0.1.1"
  },

  "compatibility": {
    "claudeCode": ">=0.1.0"
  }
}
```

---

## Usage in This Project

### Option A: Replace Local Agents with Plugin (RECOMMENDED)

**Steps:**
1. Complete plugin implementation
2. Add to marketplace.json
3. Install plugin: `/plugin install agent-development@magus`
4. Remove local files:
   - `.claude/agents/agent-architect.md`
   - `.claude/agents/agent-developer.md`
   - `.claude/agents/agent-reviewer.md`
   - `.claude/commands/develop-agent.md`
5. Update CLAUDE.md to reference plugin

**Benefits:**
- ✅ Single source of truth
- ✅ Automatic updates when plugin improves
- ✅ Consistent with other projects using the plugin
- ✅ Proves plugin works in production

**Trade-offs:**
- ⚠️ Slight indirection (plugin vs local)
- ⚠️ Need to release plugin version to get fixes

### Option B: Keep Local as Development, Plugin for Distribution

**Steps:**
1. Keep local agents for development/testing
2. Create plugin from local agents
3. Use plugin in other projects

**Benefits:**
- ✅ Fast iteration on local agents
- ✅ Plugin for stable distribution

**Trade-offs:**
- ⚠️ Risk of divergence (local vs plugin)
- ⚠️ Double maintenance burden
- ⚠️ Confusing to have both

### Recommendation: Option A

Use the plugin in this project. If changes are needed:
1. Make changes to plugin source (in `plugins/agent-development/`)
2. Bump version
3. Reinstall plugin
4. Test

This keeps a single source of truth and proves the plugin works.

---

## Implementation Plan

### Phase 1: Create Plugin Structure (30 min)
- [ ] Create `plugins/agent-development/` directory
- [ ] Create `plugin.json`
- [ ] Create `README.md`
- [ ] Create `DEPENDENCIES.md`

### Phase 2: Create Skills (1 hour)
- [ ] Create `skills/xml-tag-standards/SKILL.md`
- [ ] Create `skills/agent-patterns/SKILL.md`
- [ ] Create `skills/frontmatter-schemas/SKILL.md`

### Phase 3: Refactor Agents (1.5 hours)
- [ ] Refactor `agent-architect.md` → `agents/architect.md`
- [ ] Refactor `agent-developer.md` → `agents/developer.md`
- [ ] Refactor `agent-reviewer.md` → `agents/reviewer.md`

### Phase 4: Refactor Command (1 hour)
- [ ] Refactor `develop-agent.md` → `commands/develop.md`
- [ ] Add skill references
- [ ] Reduce duplication

### Phase 5: Update Marketplace (15 min)
- [ ] Add plugin to `marketplace.json`
- [ ] Update CLAUDE.md

### Phase 6: Replace Local Agents (15 min)
- [ ] Remove `.claude/agents/agent-*.md`
- [ ] Remove `.claude/commands/develop-agent.md`
- [ ] Test plugin installation

### Phase 7: Review & Release (30 min)
- [ ] Run agent-reviewer on plugin agents
- [ ] Fix any issues
- [ ] Create release commit and tags

**Total Estimated Time:** ~5 hours

---

## Questions for User

1. **Plugin Name:** `agent-development` or `agent-builder` or `claude-agents`?
2. **Skill Granularity:** 3 separate skills (as proposed) or 1 combined skill?
3. **Replace Local:** Proceed with Option A (replace local agents)?
4. **Model Selection:** Should we add a model selection skill or reference shared/recommended-models.md?

---

## Appendix: File Mappings

| Current Location | Plugin Location | Notes |
|------------------|-----------------|-------|
| `.claude/agents/agent-architect.md` | `plugins/agent-development/agents/architect.md` | Rename, refactor |
| `.claude/agents/agent-developer.md` | `plugins/agent-development/agents/developer.md` | Rename, refactor |
| `.claude/agents/agent-reviewer.md` | `plugins/agent-development/agents/reviewer.md` | Rename, refactor |
| `.claude/commands/develop-agent.md` | `plugins/agent-development/commands/develop.md` | Rename, refactor |
| `ai-docs/XML_TAG_STANDARDS.md` | `plugins/agent-development/skills/xml-tag-standards/SKILL.md` | Extract to skill |
| (inline in agents) | `plugins/agent-development/skills/agent-patterns/SKILL.md` | New skill |
| (inline in agents) | `plugins/agent-development/skills/frontmatter-schemas/SKILL.md` | New skill |

---

*Design document created: 2025-11-26*
*Status: Ready for review and implementation*
