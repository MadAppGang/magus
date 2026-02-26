# Plugin Skills & Agents Catalog

Complete catalog of all plugins, agents, and skills in the Magus repository.

## Summary

| Plugin | Version | Agents | Skills |
|---|---|---|---|
| **dev** | v1.32.0 | 16 | 47 |
| **frontend** | v3.15.1 | 11 | 14 |
| **multimodel** | v2.4.1 | 0 | 15 |
| **code-analysis** | v3.2.2 | 1 | 13 |
| **seo** | v1.6.2 | 5 | 12 |
| **conductor** | v2.1.0 | 0 | 6 |
| **agentdev** | v1.5.2 | 3 | 5 |
| **autopilot** | v0.2.0 | 3 | 4 |
| **instantly** | v1.0.2 | 3 | 4 |
| **video-editing** | v1.1.0 | 3 | 3 |
| **bun** | v1.6.1 | 3 | 2 |
| **nanobanana** | v2.3.0 | 2 | 2 |
| **statusline** | v1.4.0 | 0 | 1 |
| **TOTAL** | | **50** | **128** |

---

## dev (v1.32.0) — 16 agents, 47 skills

### Agents

| Agent | Model | Description |
|---|---|---|
| `developer` | default | Substantial multi-file implementation with write-test-fix cycles |
| `architect` | default | Language-agnostic architecture planning and trade-off analysis |
| `debugger` | default | Error analysis and root cause investigation |
| `researcher` | default | Multi-source research with convergence-based finalization |
| `test-architect` | default | Black box test architect — creates tests from requirements only |
| `devops` | opus | Infrastructure/DevOps specialist with extended thinking |
| `ui-engineer` | default | React component generator with Gemini visual analysis |
| `ui` | default | UI design review, usability analysis, accessibility checks |
| `doc-writer` | default | Documentation generation (README, API docs, tutorials, ADRs) |
| `doc-analyzer` | default | 42-point documentation quality analysis |
| `doc-fixer` | default | Auto-fix doc issues (voice, structure, missing sections) |
| `synthesizer` | default | Research synthesis with consensus detection |
| `spec-writer` | default | Synthesizes specs from interview sessions |
| `scribe` | haiku | Lightweight file writer for interviews |
| `skill-discovery` | haiku | Discovers all skills in a project |
| `stack-detector` | default | Detects technology stack and available skills |

### Skills

#### Top-level (10)

| Skill | Description |
|---|---|
| `adr-documentation` | Architecture Decision Records documentation practice |
| `audit` | On-demand security and code quality audit |
| `context-detection` | Detect project technology stack from files/configs |
| `documentation-standards` | Google, Microsoft, GitLab style guide standards |
| `enforcement` | Evidence-based phase completion enforcement for /dev:feature |
| `mcp-standards` | MCP server standardization patterns for plugins |
| `optimize` | Performance and optimization analysis |
| `plugin-sdk-patterns` | Templates for creating consistent Claude Code plugins |
| `task-routing` | Routing table mapping task patterns to agents |
| `test-coverage` | Test coverage analysis and gap identification |

#### backend/ (14)

| Skill | Description |
|---|---|
| `api-design` | REST/GraphQL API design, endpoints, pagination, versioning |
| `auth-patterns` | JWT, sessions, OAuth, RBAC, ABAC, MFA |
| `bunjs` | Bun.js/Hono apps, Prisma/SQLite, Zod validation |
| `bunjs-apidog` | OpenAPI specs for Bun.js APIs, Apidog integration |
| `bunjs-architecture` | Clean architecture (routes/controllers/services/repos) |
| `bunjs-production` | Docker deployment, AWS ECS/Fargate, Redis caching |
| `database-patterns` | Schema design, repository patterns, query optimization |
| `db-branching` | Database branching for git worktrees (Neon, Turso, Supabase) |
| `dingo` | Dingo meta-language for Go, optionals/results, generics |
| `error-handling` | Custom error classes, middleware, logging, retry logic |
| `golang` | Go backend services, goroutines/channels, testify |
| `golang-performance` | Go profiling (pprof), benchmarks, memory/CPU optimization |
| `python` | FastAPI, async endpoints, Pydantic, SQLAlchemy, pytest |
| `rust` | Axum applications, SQLx, thiserror error handling |

#### frontend/ (10)

| Skill | Description |
|---|---|
| `browser-debugging` | Chrome Extension MCP-based UI testing and validation |
| `css-modules` | CSS Modules with Lightning CSS and PostCSS |
| `react-typescript` | React 19+ patterns with TypeScript, hooks, TanStack Query |
| `shadcn-ui` | shadcn/ui components, theming, React Hook Form + Zod |
| `state-management` | Zustand, Pinia, TanStack Query, URL state |
| `tailwindcss` | TailwindCSS v4 with CSS-first @theme configuration |
| `tanstack-query` | TanStack Query v5 patterns, mutations, optimistic updates |
| `tanstack-router` | Type-safe file-based routing, typed params/search |
| `testing-frontend` | Vitest, React Testing Library, Vue Test Utils |
| `vue-typescript` | Vue 3 Composition API, Pinia stores, Vue Router |

#### design/ (5)

| Skill | Description |
|---|---|
| `design-references` | Predefined design system references (Material Design 3, etc.) |
| `ui-analyse` | UI visual analysis with Gemini 3 Pro multimodal |
| `ui-design-review` | Prompting patterns for UI design analysis |
| `ui-implement` | Implement UI improvements based on design analysis |
| `ui-style-format` | UI design style file format with reference image support |

#### discipline/ (5)

| Skill | Description |
|---|---|
| `agent-coordination-discipline` | Agent launch decisions, delegation criteria, external-model patterns |
| `systematic-debugging` | Root cause investigation, hypothesis-driven debugging |
| `test-driven-development` | RED-GREEN-REFACTOR cycle enforcement |
| `verification-before-completion` | Completion evidence requirements, anti-rationalization patterns |
| `worktree-lifecycle` | Full worktree lifecycle from creation through cleanup |

#### core/ (3)

| Skill | Description |
|---|---|
| `debugging-strategies` | Systematic debugging methodology, stack traces, breakpoints |
| `testing-strategies` | Test frameworks, mocking, unit/integration/E2E patterns |
| `universal-patterns` | Layered architecture, DI, error handling, code organization |

#### planning/ (1)

| Skill | Description |
|---|---|
| `brainstorming` | Multi-model ideation with consensus scoring and adaptive validation |

---

## frontend (v3.15.1) — 11 agents, 14 skills

### Agents

| Agent | Model | Description |
|---|---|---|
| `architect` | opus | React frontend architecture planning and roadmaps |
| `developer` | default | TypeScript frontend feature implementation (Vite-based) |
| `ui-developer` | default | Pixel-perfect React/TypeScript/Tailwind component work |
| `css-developer` | default | CSS architecture guidance and pattern analysis |
| `designer` | default | Validates implemented UI against reference designs (DOM/CSS inspection) |
| `reviewer` | opus | Code review against simplicity, OWASP, production-readiness |
| `plan-reviewer` | opus | Reviews architecture plans with external AI models |
| `test-architect` | opus | Comprehensive test coverage analysis |
| `tester` | default | Manual UI testing via browser automation |
| `api-analyst` | default | API documentation understanding and verification |
| `cleaner` | default | Removes temporary files and artifacts after approval |

### Skills

| Skill | Description |
|---|---|
| `api-integration` | Apidog + OpenAPI with React: MCP setup, type gen, query layer |
| `api-spec-analyzer` | OpenAPI spec analysis for TypeScript interfaces |
| `browser-debugger` | Chrome DevTools MCP-based UI testing and design validation |
| `claudish-usage` | Claudish CLI guide for OpenRouter model access via sub-agents |
| `core-principles` | React 19 SPA stack overview, project organization, agent rules |
| `dependency-check` | Check required dependencies (Chrome DevTools MCP, OpenRouter) |
| `performance-security` | Code-splitting, React Compiler, asset optimization, a11y, security |
| `react-patterns` | React 19 features, Actions vs TanStack Query for mutations |
| `router-query-integration` | TanStack Router + TanStack Query route loader integration |
| `shadcn-ui` | shadcn/ui with Vite/TanStack Router configuration |
| `tanstack-query` | TanStack Query v5 server state management |
| `tanstack-router` | TanStack Router type-safe file-based routing |
| `tooling-setup` | Vite, TypeScript, Biome, Vitest configuration |
| `ui-implementer` | Design-to-code from Figma/screenshots with adaptive agent switching |

---

## multimodel (v2.4.1) — 0 agents, 15 skills

Pure orchestration knowledge — teaches Claude how to coordinate work across external AI models.

| Skill | Description |
|---|---|
| `agent-enforcement` | /team command orchestration enforcement, claudish CLI validation |
| `batching-patterns` | Batch operations into single messages for max parallelism |
| `error-recovery` | Handle errors, timeouts, failures in multi-agent workflows |
| `hierarchical-coordinator` | Prevent goal drift with coordinator agent validation |
| `hooks-system` | PreToolUse, PostToolUse, UserPromptSubmit, Stop hook patterns |
| `model-tracking-protocol` | Structured tracking tables for multi-model validation |
| `multi-agent-coordination` | Parallel and sequential agent workflow coordination |
| `multi-model-validation` | Run AI models in parallel (Grok, Gemini, GPT-5, DeepSeek, etc.) |
| `performance-tracking` | Agent, skill, and model performance metrics |
| `proxy-mode-reference` | External AI models via claudish CLI reference |
| `quality-gates` | Quality gates, user approval, iteration loops, TDD |
| `session-isolation` | Prevent file collisions across concurrent sessions |
| `task-complexity-router` | Complexity-based routing for optimal model selection |
| `task-external-models` | Quick-reference for external models in orchestration |
| `task-orchestration` | Multi-phase workflow progress tracking with Tasks system |

---

## code-analysis (v3.2.2) — 1 agent, 13 skills

### Agent

| Agent | Description |
|---|---|
| `codebase-detective` | Primary investigation agent using claudemem for semantic search and AST analysis |

### Skills

| Skill | Description |
|---|---|
| `architect-detective` | Architecture/system design analysis, PageRank-based abstraction mapping |
| `claudemem-orchestration` | Multi-agent claudemem orchestration (run once, share across agents) |
| `claudemem-search` | claudemem CLI expert — semantic search + AST navigation (map, symbol, callers, callees) |
| `claudish-usage` | Claudish CLI guide for OpenRouter model access via sub-agents |
| `code-search-selector` | Choose between semantic search (claudemem) vs native tools (Grep/Glob) |
| `cross-plugin-detective` | Map agent roles to appropriate detective skills across plugins |
| `debugger-detective` | Root cause analysis via claudemem AST context command |
| `deep-analysis` | Primary entry point for "how does X work" — launches detective with claudemem |
| `developer-detective` | Implementation tracing via claudemem AST |
| `investigate` | Unified entry point — auto-routes to specialized detective by keyword |
| `search-interceptor` | Bulk file read optimizer — suggests semantic search alternatives |
| `tester-detective` | Test coverage/quality analysis via claudemem AST |
| `ultrathink-detective` | Comprehensive multi-perspective analysis (Opus model) |

---

## seo (v1.6.2) — 5 agents, 12 skills

### Agents

| Agent | Model | Description |
|---|---|---|
| `seo-analyst` | default | SERP analysis, search intent, competitive intelligence |
| `seo-data-analyst` | default | GA4 and Google Search Console analytics |
| `seo-editor` | opus | Senior editor and quality gate with E-E-A-T scoring |
| `seo-researcher` | default | Keyword research, expansion, clustering, content gaps |
| `seo-writer` | default | SEO-optimized content creation from briefs |

### Skills

| Skill | Description |
|---|---|
| `analytics-interpretation` | GA4/GSC data interpretation with benchmarks and insights |
| `autonomous-keyword-research` | Fully autonomous keyword research with ~80% autonomy AUTO GATEs |
| `content-brief` | Content brief templates and methodology |
| `content-optimizer` | On-page SEO: keyword density, meta tags, headings, readability |
| `data-extraction-patterns` | GA4/GSC API data extraction patterns |
| `keyword-cluster-builder` | Keyword expansion and topic/intent clustering |
| `link-strategy` | Internal linking and anchor text optimization |
| `performance-correlation` | Correlate content attributes with GA4/GSC metrics |
| `quality-gate` | AUTO GATEs for automatic agent-to-agent progression |
| `schema-markup` | Schema.org markup for rich results |
| `serp-analysis` | Intent classification, feature identification, competitive intel |
| `technical-audit` | Crawlability, indexability, Core Web Vitals audit |

---

## conductor (v2.1.0) — 0 agents, 6 skills

| Skill | Description |
|---|---|
| `help` | Commands, usage examples, and best practices |
| `implement` | Execute tasks from track plan with TDD and git commit integration |
| `new-track` | Create development track with spec and hierarchical plan |
| `revert` | Git-aware logical undo at track, phase, or task level |
| `setup` | Initialize with product.md, tech-stack.md, workflow.md |
| `status` | Show active tracks, progress, current tasks, blockers |

---

## agentdev (v1.5.2) — 3 agents, 5 skills

### Agents

| Agent | Model | Description |
|---|---|---|
| `architect` | opus | Expert agent designer for Claude Code agents and commands |
| `developer` | default | Agent/command file implementer from approved designs |
| `reviewer` | opus | Agent quality reviewer for standards compliance |

### Skills

| Skill | Description |
|---|---|
| `debug-mode` | Enable/disable debug recording (JSONL tool invocation logs) |
| `patterns` | Common agent patterns and templates (Tasks integration, quality checks) |
| `schemas` | YAML frontmatter schemas for agent/command files |
| `xml-standards` | XML tag structure patterns for agents |
| `yaml-agent-format` | YAML alternative format for agent definitions |

---

## autopilot (v0.2.0) — 3 agents, 4 skills

### Agents

| Agent | Description |
|---|---|
| `feedback-processor` | Handles Linear comment feedback, triggers iterative refinement |
| `proof-generator` | Generates proof-of-work artifacts for task validation |
| `task-executor` | Executes Linear tasks using ReAct pattern |

### Skills

| Skill | Description |
|---|---|
| `linear-integration` | Linear API: auth, webhooks, CRUD, state transitions, attachments |
| `proof-of-work` | Proof artifact generation (screenshots, test results, deployments) |
| `state-machine` | Task lifecycle state transitions with validation gates |
| `tag-command-mapping` | Tag-to-command routing with precedence rules |

---

## instantly (v1.0.2) — 3 agents, 4 skills

### Agents

| Agent | Description |
|---|---|
| `campaign-analyst` | Cold outreach campaign performance metrics and insights |
| `outreach-optimizer` | A/B testing and performance improvement |
| `sequence-builder` | Email sequence architecture for cold outreach |

### Skills

| Skill | Description |
|---|---|
| `ab-testing-patterns` | A/B testing methodology for cold email |
| `campaign-metrics` | Cold email KPIs, benchmarks, diagnostics |
| `email-deliverability` | Deliverability best practices and troubleshooting |
| `sequence-best-practices` | Email sequence design and optimization |

---

## video-editing (v1.1.0) — 3 agents, 3 skills

### Agents

| Agent | Description |
|---|---|
| `timeline-builder` | Final Cut Pro projects, timelines, multicam sequences |
| `transcriber` | Whisper transcription to SRT, VTT, JSON, TXT |
| `video-processor` | FFmpeg video/audio processing (trim, concat, convert, extract) |

### Skills

| Skill | Description |
|---|---|
| `ffmpeg-core` | FFmpeg fundamentals: codecs, filter chains, performance |
| `final-cut-pro` | FCPXML format: projects, timelines, clips, effects, transitions |
| `transcription` | Whisper: models, formats, timing sync, speaker diarization |

---

## bun (v1.6.1) — 3 agents, 2 skills

### Agents

| Agent | Model | Description |
|---|---|---|
| `api-architect` | opus | TypeScript backend API architecture with Bun runtime |
| `apidog` | default | Apidog spec sync, endpoint creation, OpenAPI import |
| `backend-developer` | default | TypeScript backend implementation (endpoints, services, DB) |

### Skills

| Skill | Description |
|---|---|
| `best-practices` | Production-ready Bun: structure, performance, testing, deployment |
| `claudish-usage` | Claudish CLI guide for OpenRouter model access via sub-agents |

---

## nanobanana (v2.3.0) — 2 agents, 2 skills

### Agents

| Agent | Description |
|---|---|
| `image-generator` | Generate/edit images with Gemini, style templates, reference images |
| `style-manager` | Manage image generation style templates (CRUD) |

### Skills

| Skill | Description |
|---|---|
| `gemini-api` | Gemini 3 Pro Image API: text-to-image, editing, aspect ratios |
| `style-format` | Style template format spec (markdown artistic direction files) |

---

## statusline (v1.4.0) — 0 agents, 1 skill

| Skill | Description |
|---|---|
| `statusline-customization` | Configuration reference: sections, themes, bar widths, scripts |
