# Magus - Architecture Map

Generated: 2026-02-16
Total Plugins: 13

## Quick Statistics

| Metric | Total |
|--------|-------|
| Total Agents | 47 |
| Total Commands | 62 |
| Total Skills | 120 |
| Total Hooks | 17 |

## Plugin Overview

| Plugin | Version | Agents | Commands | Skills | Hooks | Purpose |
|--------|---------|--------|----------|--------|-------|---------|
| **dev** | v1.31.3 | 16 | 15 | 47 | 0 | Universal development assistant with real skill discovery |
| **frontend** | v3.15.1 | 11 | 8 | 14 | 0 | Comprehensive frontend development toolkit with TypeScript |
| **multimodel** | v2.4.1 | 0 | 1 | 15 | 1 | Multi-model collaboration and orchestration patterns |
| **code-analysis** | v3.2.2 | 1 | 3 | 13 | 8 | Deep code investigation with claudemem |
| **seo** | v1.6.2 | 5 | 9 | 10 | 1 | Highly autonomous SEO toolkit (~80% autonomy) |
| **conductor** | v2.1.0 | 0 | 6 | 6 | 0 | Context-Driven Development workflow management |
| **agentdev** | v1.5.2 | 3 | 5 | 5 | 3 | Create and review Claude Code agents and commands |
| **autopilot** | v0.2.0 | 3 | 5 | 4 | 3 | Autonomous task execution with Linear integration |
| **instantly** | v1.0.2 | 3 | 5 | 4 | 1 | Cold email outreach toolkit with Instantly.ai MCP |
| **bun** | v1.6.1 | 3 | 4 | 1 | 0 | TypeScript backend development with Bun runtime |
| **video-editing** | v1.1.0 | 3 | 3 | 3 | 0 | Professional video editing with FFmpeg and Whisper |
| **statusline** | v1.4.0 | 0 | 3 | 1 | 0 | Colorful statusline with worktree awareness |
| **nanobanana** | v2.3.0 | 2 | 3 | 2 | 0 | AI image generation with Google Gemini 3 Pro Image |

## Architecture Patterns

### Plugin Categories by Size

#### 🏢 Large Ecosystem Plugins (10+ components)
- **dev** - 78 total components (Universal swiss-army knife)
- **frontend** - 33 total components (Frontend specialization)
- **multimodel** - 17 total components (Multi-AI orchestration)
- **code-analysis** - 25 total components (Deep investigation)

#### 🏭 Medium Feature-Rich Plugins (5-10 components)
- **seo** - 25 total components (SEO automation)
- **conductor** - 12 total components (Workflow management)
- **agentdev** - 16 total components (Agent development)
- **autopilot** - 15 total components (Task automation)
- **instantly** - 13 total components (Email outreach)

#### 🏪 Focused Domain Plugins (< 10 components)
- **bun** - 8 total components (Backend specialization)
- **video-editing** - 9 total components (Video processing)
- **statusline** - 4 total components (UI enhancement)
- **nanobanana** - 7 total components (Image generation)

### Component Distribution Analysis

```
         Agents    Commands   Skills    Hooks
dev      ████████  ███████   ████████
frontend ██████    ████      ███████
seo      ███       █████     █████     █
code-an  █         ██        ██████    ████
multi    -         █         ███████   █
```

### Hook Usage Patterns

Plugins using hooks (enforcement and automation):
1. **code-analysis** - 8 hooks (enforcement-heavy architecture)
2. **agentdev** - 3 hooks (development workflow hooks)
3. **autopilot** - 3 hooks (task lifecycle hooks)
4. **multimodel** - 1 hook (team workflow enforcement)
5. **seo** - 1 hook (AUTO GATE quality enforcement)
6. **instantly** - 1 hook (email validation)

## Plugin Interaction Patterns

### Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    Core Infrastructure                       │
├─────────────────────────────────────────────────────────────┤
│  dev (universal assistant)                                   │
│  ├── Task routing table                                      │
│  ├── Skill discovery                                         │
│  └── Real validation loops                                   │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────┐   ┌────────▼─────┐   ┌────────▼─────┐
│  multimodel  │   │code-analysis │   │   conductor  │
│ Multi-model  │   │  claudemem   │   │     CDD      │
│ orchestration│   │ investigation │   │   workflow   │
└──────────────┘   └──────────────┘   └──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────┐   ┌────────▼─────┐   ┌────────▼─────┐
│   frontend   │   │   agentdev   │   │     seo      │
│  React/TS    │   │Agent builder │   │SEO automation│
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
┌───────▼──────┐   ┌────────▼─────┐   ┌────────▼─────┐
│ video-editing│   │   autopilot  │   │   instantly  │
│   FFmpeg     │   │ Task runner  │   │    Email     │
└──────────────┘   └──────────────┘   └──────────────┘
```

### Cross-Plugin Integration Points

1. **Task Routing** (CLAUDE.md routing table)
   - `dev:delegate` → Routes to specialized agents
   - All plugins register their agents in routing table
   - Example: "Research task" → `dev:researcher`

2. **Skill Discovery** (dev plugin)
   - Auto-discovers skills across all plugins
   - Skill namespace: `plugin:skill-name`
   - Example: `code-analysis:claudemem-search`

3. **Multi-Model Orchestration** (multimodel plugin)
   - `/team` command uses `dev:researcher` for internal models
   - Uses Bash+claudish for external models
   - Session isolation in `ai-docs/sessions/`

4. **Hook System** (cross-plugin enforcement)
   - PreToolUse hooks (validation before execution)
   - PostToolUse hooks (validation after execution)
   - Example: `code-analysis` hooks enforce claudemem usage

## Key Architectural Decisions

### 1. Agent-First Design
- Agents = Specialized AI personalities with sustained focus
- Commands = User-facing slash commands (e.g., `/dev:implement`)
- Skills = Reusable patterns loaded into context

### 2. Namespace Convention
- Format: `plugin-name:component-name`
- Examples:
  - Agent: `dev:researcher`, `code-analysis:detective`
  - Command: `/dev:implement`, `/frontend:review`
  - Skill: `multimodel:team-tracking`, `code-analysis:claudemem-search`

### 3. Hook Enforcement Architecture
- **code-analysis**: 8 hooks for claudemem enforcement
  - Blocks non-semantic searches when index available
  - Promotes structural understanding first
- **multimodel**: 1 hook for team workflow validation
  - Ensures correct model execution methods
- **agentdev**: 3 hooks for development workflow

### 4. Skill-Driven Development
- **dev** plugin: 47 skills (largest skill library)
- Skills loaded on-demand via `Skill` tool
- Namespace prevents collision: `dev:brainstorm` vs `multimodel:brainstorm`

### 5. Component Specialization

| Component Type | Purpose | Example |
|----------------|---------|---------|
| **Agents** | Sustained focus, multi-turn tasks | `dev:developer` (implementation) |
| **Commands** | Quick workflows, orchestration | `/dev:feature` (8-phase workflow) |
| **Skills** | Reusable patterns, guidelines | `dev:tdd` (TDD methodology) |
| **Hooks** | Enforcement, validation, automation | `enforce-claudemem.sh` |

## Plugin Maturity Levels

### Production (v2.0+)
- ✅ **multimodel** v2.4.1 - Battle-tested multi-model workflow
- ✅ **code-analysis** v3.2.2 - Proven investigation toolkit
- ✅ **frontend** v3.15.1 - Comprehensive frontend suite
- ✅ **nanobanana** v2.3.0 - Stable image generation
- ✅ **conductor** v2.1.0 - CDD workflow management

### Stable (v1.0+)
- ✅ **dev** v1.31.3 - Universal assistant, actively developed
- ✅ **bun** v1.6.1 - Backend development toolkit
- ✅ **agentdev** v1.5.2 - Agent creation tools
- ✅ **seo** v1.6.2 - SEO automation suite
- ✅ **statusline** v1.4.0 - UI enhancement
- ✅ **video-editing** v1.1.0 - Video processing toolkit
- ✅ **instantly** v1.0.2 - Email outreach

### Beta (v0.x)
- ⚠️ **autopilot** v0.2.0 - Active development, Linear integration

## Technology Stack by Plugin

### Languages & Runtimes
- **TypeScript/JavaScript**: frontend, bun, dev, agentdev, autopilot, instantly
- **Shell Scripts**: All plugins (hooks, utilities)
- **Markdown**: All plugins (documentation, agent definitions)

### External Services & APIs
- **OpenRouter**: multimodel (external AI models), code-analysis (embeddings)
- **Google Gemini**: nanobanana (image generation)
- **Instantly.ai**: instantly (email outreach)
- **Linear**: autopilot (task management)
- **Figma API**: frontend (design integration)
- **FFmpeg**: video-editing (video processing)
- **Whisper**: video-editing (transcription)

### MCP Servers
Plugins with MCP integration:
- **code-analysis**: claudish MCP server
- **frontend**: chrome-devtools MCP server
- **instantly**: instantly MCP server
- **bun**: apidog MCP server

## File Organization Patterns

### Standard Plugin Structure
```
plugins/{plugin-name}/
├── plugin.json              # Manifest (version, description, components)
├── README.md                # User documentation
├── DEPENDENCIES.md          # Optional: External dependencies
├── agents/                  # Agent definitions (*.md)
│   ├── agent-name/
│   │   └── AGENT.md        # Agent YAML frontmatter + instructions
├── commands/                # Slash commands (*.md)
│   └── command-name.md     # Command YAML frontmatter + instructions
├── skills/                  # Reusable skills
│   ├── skill-name/
│   │   └── SKILL.md        # Skill YAML frontmatter + guidelines
├── hooks/                   # Lifecycle hooks (*.sh, *.ts, *.js)
│   ├── PreToolUse/
│   ├── PostToolUse/
│   └── UserPromptSubmit/
├── mcp-servers/             # MCP server configurations
│   └── .mcp.json
└── scripts/                 # Utility scripts
    └── *.sh
```

### Variations by Plugin Type

#### Minimal Plugins (statusline, nanobanana)
- Commands only, no agents
- Few skills, no hooks
- Focused single-purpose

#### Full-Featured Plugins (dev, frontend)
- Many agents (10+), many commands (8+)
- Extensive skill libraries (14+)
- Complete documentation suite

#### Enforcement Plugins (code-analysis, multimodel)
- Heavy hook usage (8, 1)
- Focus on workflow validation
- Integration with external tools

## Performance Characteristics

### Computational Intensity

| Plugin | Intensity | Reason |
|--------|-----------|--------|
| **code-analysis** | High | AST parsing, vector embeddings, graph analysis |
| **multimodel** | High | Parallel model execution, 3-5x concurrent |
| **video-editing** | High | Video processing, FFmpeg operations |
| **nanobanana** | Medium | Image generation API calls |
| **frontend** | Medium | Chrome DevTools integration |
| **dev** | Low-Medium | Skill-based, varies by task |
| **statusline** | Low | UI rendering only |

### Token Usage Patterns

| Plugin | Usage | Strategy |
|--------|-------|----------|
| **code-analysis** | Low | Structural understanding → targeted reads (80% savings) |
| **dev** | Variable | Skill-driven, loads only needed context |
| **multimodel** | High | Parallel models, vote collection |
| **frontend** | Medium | Component analysis, selective reads |

## Evolution & Maintenance

### Recent Major Updates (2026 Feb)

1. **multimodel v2.4.1** - PROXY_MODE removed, Bash+claudish architecture
2. **code-analysis v3.2.2** - Hybrid hook approach, enrichment mode
3. **frontend v3.15.1** - Multi-model review improvements
4. **dev v1.31.3** - Enhanced skill discovery, task routing refinements
5. **statusline v1.4.0** - Session-pinned worktree marker survives compaction

### Maintenance Patterns

All plugins follow:
- **Semantic Versioning** (major.minor.patch)
- **Git Tags** Format: `plugins/{name}/vX.Y.Z`
- **Marketplace Sync** Update `.claude-plugin/marketplace.json`
- **CHANGELOG.md** Track all changes
- **RELEASES.md** Comprehensive release notes

## Usage Recommendations

### For New Users

Start with:
1. **dev** - Universal assistant, works for any project
2. **code-analysis** - Essential for understanding unfamiliar codebases
3. **statusline** - Nice-to-have UI enhancement

### For Frontend Developers

Install:
1. **dev** - Base toolkit
2. **frontend** - React/TypeScript specialization
3. **code-analysis** - Codebase investigation
4. **multimodel** - Multi-model code review

### For Backend Developers

Install:
1. **dev** - Base toolkit
2. **bun** - TypeScript backend with Bun
3. **code-analysis** - Codebase investigation

### For AI/Agent Developers

Install:
1. **dev** - Base toolkit
2. **agentdev** - Agent creation and review
3. **multimodel** - Multi-model orchestration patterns
4. **code-analysis** - Investigation patterns

### For Content Creators

Install:
1. **dev** - Base toolkit
2. **seo** - SEO optimization
3. **video-editing** - Video processing
4. **nanobanana** - Image generation

## Key Insights

### ★ Architectural Insights ─────────────────────────────────────

1. **Plugin Ecosystem Maturity**
   - 13 plugins covering broad use cases (dev, frontend, SEO, video, images)
   - Hierarchical architecture: core (dev) → specialized (frontend, bun) → domain (seo, video)
   - Hook system enables enforcement patterns (code-analysis: 8 hooks)

2. **Component Specialization**
   - Agents for sustained focus (47 total)
   - Commands for orchestration (62 total)
   - Skills for reusable patterns (120 total)
   - Hooks for enforcement (17 total)

3. **Cross-Plugin Synergy**
   - Task routing table enables plugin interop
   - Namespace convention prevents collisions
   - Skill discovery makes all patterns available
   - Multi-model orchestration spans external APIs

─────────────────────────────────────────────────────────────────

---

**Generated by:** Claude Code Architecture Analysis
**Date:** 2026-02-16
**Tool:** claudemem v0.16.6 + file system analysis
**Repository:** https://github.com/MadAppGang/magus
