# Bun Skills Migration Design Document

**Session ID**: agentdev-bun-skills-migration-20260106-003411-f2b4
**Date**: 2026-01-06
**Objective**: Migrate valuable content from `bun` plugin to `dev` plugin as specialized skills

---

## Executive Summary

This design document outlines the migration strategy for consolidating all Bun/TypeScript backend knowledge from the `bun` plugin into the `dev` plugin's skill system. After analyzing the source content (3 agents, 1 skill totaling ~2,800 lines), the recommendation is **Option B: Role-Specific Skills** with a hybrid enhancement.

---

## Source Analysis

### Content Inventory

| Source File | Lines | Type | Primary Value |
|------------|-------|------|---------------|
| `backend-developer.md` | ~535 | Agent | Implementation patterns, code templates, quality checks |
| `api-architect.md` | ~510 | Agent | Architecture planning, database design, implementation roadmap |
| `apidog.md` | ~546 | Agent | OpenAPI spec creation, Apidog integration |
| `best-practices.md` | ~1,224 | Skill | Comprehensive stack guide, production patterns |
| **Existing** `bunjs/SKILL.md` | ~478 | Skill | Basic Bun patterns (router, middleware, database) |

**Total Source Content**: ~3,293 lines (including existing bunjs skill)

### Content Categories

1. **Core Runtime Patterns** (~500 lines)
   - HTTP server, router, middleware
   - WebSocket, file uploads
   - Configuration management

2. **Framework Integration** (~600 lines)
   - Hono framework patterns
   - Prisma ORM with camelCase conventions
   - Zod validation schemas

3. **Architecture Patterns** (~700 lines)
   - Layered architecture (routes -> controllers -> services -> repositories)
   - Clean architecture principles
   - Error handling hierarchy

4. **Production Patterns** (~800 lines)
   - Docker multi-stage builds
   - AWS ECS deployment
   - CI/CD with GitHub Actions
   - Redis caching
   - Security headers, CORS, rate limiting

5. **API Documentation** (~500 lines)
   - OpenAPI spec creation
   - Apidog integration
   - Schema reuse strategies

---

## Skill Structure Decision

### Option Analysis

| Option | Structure | Pros | Cons |
|--------|-----------|------|------|
| **A** | Single enhanced `bunjs` | Simple, one file | Too large (~2,500+ lines), hard to navigate |
| **B** | Role-specific skills | Targeted loading, modular | More files, potential overlap |
| **C** | Hybrid | Balanced | Medium complexity |

### Recommendation: Option B (Modified)

Create **4 specialized skills** under `plugins/dev/skills/backend/bunjs/`:

```
plugins/dev/skills/backend/bunjs/
├── SKILL.md              # Core runtime patterns (ENHANCED)
├── architecture.md       # Layered architecture, clean code
├── production.md         # Docker, AWS, CI/CD, caching
└── apidog.md             # OpenAPI, Apidog integration
```

**Why Option B:**

1. **Context-Detection Integration**: Skills can be selectively loaded based on project needs
2. **Maintainability**: Smaller, focused files are easier to update
3. **Reusability**: Architecture patterns apply to other TypeScript backends
4. **Progressive Loading**: Load only what's needed (core vs production vs apidog)

---

## Detailed Skill Specifications

### Skill 1: `bunjs/SKILL.md` (ENHANCED)

**Purpose**: Core Bun runtime patterns for TypeScript backend development
**Estimated Size**: ~800 lines (up from 478)
**Auto-Load**: When `bun.lockb` detected without frontend framework

**Content Sections**:

```markdown
# Bun.js Backend Patterns

## Overview
- Why Bun (native TS, speed, unified toolkit)
- Stack overview (Bun 1.x, Hono 4.6, Prisma 6.2, Biome 2.3)

## Project Structure
- Standard directory layout
- File naming conventions

## HTTP Server
- Basic server with Bun.serve
- Hono framework integration
- Route handlers with type safety

## Middleware Patterns
- Logging middleware
- CORS middleware
- Auth middleware (basic)
- Request validation

## Database Access
- SQLite with Bun
- PostgreSQL with connection pool
- Prisma client setup

## Validation with Zod
- Schema definitions
- Type inference
- Middleware integration

## Error Handling
- Custom error classes
- Error handler middleware
- Consistent response format

## Testing
- Bun test runner
- Unit test examples
- Integration test patterns

## Configuration
- Environment variables
- Config loader pattern

## File Operations
- File uploads
- WebSocket support

## Quality Checks
- bun run format (Biome)
- bun run lint (Biome)
- bun run typecheck (TypeScript)
- bun test
```

**Source Mapping**:
- Existing `bunjs/SKILL.md` -> Enhance all sections
- `backend-developer.md` -> Code templates (routes, controllers)
- `best-practices.md` -> Quick start, stack overview, configuration

---

### Skill 2: `bunjs/architecture.md` (NEW)

**Purpose**: Layered architecture and clean code patterns for Bun backends
**Estimated Size**: ~600 lines
**Auto-Load**: Optional, when complex project structure detected

**Content Sections**:

```markdown
# Bun Backend Architecture

## Clean Architecture Principles
- Layer separation (routes -> controllers -> services -> repositories)
- Dependency inversion
- Single responsibility

## Layer Templates

### Routes Layer
- Route organization
- Middleware attachment
- Controller mapping

### Controllers Layer
- HTTP request/response handling
- Extracting validated data
- NO business logic rule

### Services Layer
- Business logic implementation
- Repository orchestration
- Transaction handling
- NO HTTP concerns rule

### Repositories Layer
- Database access encapsulation
- Type-safe queries with Prisma
- CRUD patterns

## Naming Conventions

### camelCase (CRITICAL)
- API field names
- Database columns
- TypeScript interfaces
- Zod schemas

### Database Naming
- Tables: singular, camelCase
- Primary keys: {tableName}Id
- Foreign keys: match referenced key
- Booleans: is/has/can prefix
- Timestamps: createdAt, updatedAt, deletedAt

## Prisma Schema Design
- Model definitions with camelCase
- Index strategies
- Relation patterns
- @map() for legacy databases

## Implementation Workflow
- Phase 1: Analysis & Planning
- Phase 2: Database Layer
- Phase 3: Validation Layer
- Phase 4: Business Logic Layer
- Phase 5: HTTP Layer
- Phase 6: Routing Layer
- Phase 7: Middleware
- Phase 8: Testing
- Phase 9: Quality Assurance
```

**Source Mapping**:
- `backend-developer.md` -> Layered architecture, code templates
- `api-architect.md` -> Architecture design, database schema design
- `best-practices.md` -> Database naming, API naming conventions

---

### Skill 3: `bunjs/production.md` (NEW)

**Purpose**: Production deployment patterns for Bun backends
**Estimated Size**: ~700 lines
**Auto-Load**: Optional, when Docker/AWS context detected

**Content Sections**:

```markdown
# Bun Production Patterns

## Docker Containerization

### Multi-Stage Dockerfile
- Base stage
- Dependencies stage
- Build stage
- Runner stage
- Non-root user
- Health checks

## Graceful Shutdown
- Signal handling (SIGTERM, SIGINT)
- Database connection cleanup
- Server shutdown with timeout

## AWS ECS Deployment
- Task definition patterns
- Health check configuration
- Secrets management (AWS Secrets Manager)
- Auto-scaling strategies
- CloudWatch integration

## Caching with Redis
- Redis client setup
- Cache utilities (get, set, cached)
- TTL strategies
- Cache invalidation patterns

## Security
- Security headers middleware
- CORS configuration
- Rate limiting
- Password hashing (bcrypt)
- JWT token management
- Least-privilege DB users

## Logging with Pino
- Logger setup
- Request logging middleware
- Structured logging patterns

## CI/CD with GitHub Actions
- Bun setup
- Biome checks
- TypeScript type checking
- Test with coverage
- Docker build & push

## Production Readiness Checklist
- Security checklist
- Performance checklist
- Reliability checklist
- Quality checklist
- Deployment checklist

## Environment Variables
- Development config
- Test config
- Production config (Secrets Manager)
```

**Source Mapping**:
- `best-practices.md` -> Docker, AWS ECS, caching, security, logging, CI/CD
- `backend-developer.md` -> Security practices, quality checks

---

### Skill 4: `bunjs/apidog.md` (NEW)

**Purpose**: OpenAPI specification and Apidog integration patterns
**Estimated Size**: ~500 lines
**Auto-Load**: Optional, when APIDOG_PROJECT_ID detected in environment

**Content Sections**:

```markdown
# Apidog Integration

## Overview
- Why Apidog for API documentation
- Environment variables (APIDOG_PROJECT_ID, APIDOG_API_TOKEN)

## OpenAPI Spec Creation

### Spec Structure
- OpenAPI 3.0 format
- Info section
- Servers configuration
- Components (schemas, parameters, responses)
- Paths definition

### Field Naming Convention
- ALWAYS camelCase
- Never snake_case or PascalCase

### Schema Design
- Reusing existing schemas ($ref)
- Extending schemas (allOf)
- Type definitions

## Apidog-Specific Extensions
- x-apidog-folder: Folder organization
- x-apidog-status: Endpoint lifecycle
- x-apidog-maintainer: Owner assignment

## Import Process

### REST API Import
- Endpoint: POST /v1/projects/{id}/import-openapi
- Headers (Authorization, X-Apidog-Api-Version)
- Request body format
- Import options (AUTO_MERGE, OVERWRITE_EXISTING)

### Response Handling
- Success counters
- Error handling
- Validation URL generation

## Workflow
1. Environment validation
2. Fetch current specification
3. Schema analysis & reuse strategy
4. Create OpenAPI specification
5. Save to temporary file
6. Import to Apidog
7. Validation & summary

## Error Scenarios
- Missing environment variables
- Schema conflicts
- Import failures
- Invalid OpenAPI spec
```

**Source Mapping**:
- `apidog.md` -> Complete agent content (environment validation, workflow, import process)

---

## Content Deduplication Analysis

### Overlapping Content

| Topic | Source Files | Resolution |
|-------|--------------|------------|
| Project structure | backend-developer, best-practices, existing bunjs | Consolidate in `SKILL.md` |
| Error handling | backend-developer, best-practices, existing bunjs | Consolidate in `SKILL.md`, detail in `architecture.md` |
| Prisma patterns | backend-developer, api-architect, best-practices | Database in `SKILL.md`, schema design in `architecture.md` |
| Validation (Zod) | backend-developer, best-practices, existing bunjs | Consolidate in `SKILL.md` |
| Testing | backend-developer, best-practices, existing bunjs | Consolidate in `SKILL.md` |
| Docker | best-practices | Move to `production.md` |
| camelCase conventions | backend-developer, api-architect, best-practices | Single source in `architecture.md`, reference elsewhere |

### Deduplication Strategy

1. **Single Source of Truth**: Each concept defined in ONE skill only
2. **Cross-References**: Other skills reference the authoritative section
3. **Layered Detail**: Core skill has basics, specialized skills have depth

---

## Context-Detection Integration

### Detection Updates

Update `plugins/dev/skills/context-detection/SKILL.md`:

```yaml
# Add to bunjs detection section
bunjs:
  primary_skills:
    - bunjs                    # Core patterns (ALWAYS)
  optional_skills:
    - bunjs-architecture       # When complex structure detected
    - bunjs-production         # When Dockerfile/AWS detected
    - bunjs-apidog             # When APIDOG_PROJECT_ID in env
  quality_checks:
    - "bun run format"
    - "bun run lint"
    - "bun run typecheck"
    - "bun test"
```

### Skill Loading Logic

```bash
# Core skill (always loaded for Bun projects)
if [ -f "bun.lockb" ] && ! has_frontend_framework; then
  skills+=("${PLUGIN_ROOT}/skills/backend/bunjs/SKILL.md")
fi

# Architecture skill (when layered structure detected)
if [ -d "src/controllers" ] || [ -d "src/services" ] || [ -d "src/repositories" ]; then
  skills+=("${PLUGIN_ROOT}/skills/backend/bunjs/architecture.md")
fi

# Production skill (when deployment files detected)
if [ -f "Dockerfile" ] || [ -f "docker-compose.yml" ] || [ -d ".github/workflows" ]; then
  skills+=("${PLUGIN_ROOT}/skills/backend/bunjs/production.md")
fi

# Apidog skill (when Apidog configured)
if [ -n "$APIDOG_PROJECT_ID" ]; then
  skills+=("${PLUGIN_ROOT}/skills/backend/bunjs/apidog.md")
fi
```

---

## Plugin.json Updates

### Files to Modify

**`plugins/dev/plugin.json`**:

```json
{
  "skills": [
    // ... existing skills ...
    "./skills/backend/bunjs",           // Enhanced (directory with SKILL.md)
    "./skills/backend/bunjs-architecture",  // NEW
    "./skills/backend/bunjs-production",    // NEW
    "./skills/backend/bunjs-apidog"         // NEW
  ]
}
```

**Alternative**: If skills are directories, create proper structure:

```
plugins/dev/skills/backend/
├── bunjs/
│   └── SKILL.md           # Core patterns (enhanced)
├── bunjs-architecture/
│   └── SKILL.md           # Architecture patterns
├── bunjs-production/
│   └── SKILL.md           # Production patterns
└── bunjs-apidog/
    └── SKILL.md           # Apidog integration
```

---

## Migration Checklist

### Phase 1: Preparation

- [ ] Create backup of existing `bunjs/SKILL.md`
- [ ] Create new skill directories:
  - [ ] `bunjs-architecture/`
  - [ ] `bunjs-production/`
  - [ ] `bunjs-apidog/`

### Phase 2: Core Skill Enhancement

- [ ] Read existing `bunjs/SKILL.md`
- [ ] Merge content from `backend-developer.md`:
  - [ ] Layered architecture references
  - [ ] Code templates (basic)
  - [ ] Quality checks
- [ ] Merge content from `best-practices.md`:
  - [ ] Stack overview (Bun 1.x, Hono 4.6, etc.)
  - [ ] Quick start section
  - [ ] Configuration patterns
- [ ] Update version to 2.0.0
- [ ] Add cross-references to other bunjs skills

### Phase 3: Architecture Skill Creation

- [ ] Create `bunjs-architecture/SKILL.md`
- [ ] Extract from `backend-developer.md`:
  - [ ] Layered architecture principles
  - [ ] Layer templates (routes, controllers, services, repositories)
  - [ ] Implementation workflow
- [ ] Extract from `api-architect.md`:
  - [ ] Database schema design
  - [ ] API endpoint design
  - [ ] Authentication architecture
- [ ] Extract from `best-practices.md`:
  - [ ] camelCase conventions (API and database)
  - [ ] Prisma schema patterns
  - [ ] Error handling architecture

### Phase 4: Production Skill Creation

- [ ] Create `bunjs-production/SKILL.md`
- [ ] Extract from `best-practices.md`:
  - [ ] Docker multi-stage build
  - [ ] AWS ECS deployment
  - [ ] Redis caching
  - [ ] Security patterns
  - [ ] Logging with Pino
  - [ ] CI/CD with GitHub Actions
  - [ ] Production readiness checklist

### Phase 5: Apidog Skill Creation

- [ ] Create `bunjs-apidog/SKILL.md`
- [ ] Extract from `apidog.md`:
  - [ ] Environment validation
  - [ ] OpenAPI spec creation
  - [ ] Apidog-specific extensions
  - [ ] Import workflow
  - [ ] Error scenarios

### Phase 6: Plugin Integration

- [ ] Update `plugins/dev/plugin.json`:
  - [ ] Add new skill paths
- [ ] Update `plugins/dev/skills/context-detection/SKILL.md`:
  - [ ] Add optional skill loading logic
  - [ ] Update bunjs detection section

### Phase 7: Validation

- [ ] Run Biome format on all new files
- [ ] Verify skill file structure matches plugin conventions
- [ ] Test context-detection with sample Bun project
- [ ] Verify skill loading in dev plugin agents

### Phase 8: Cleanup (Optional)

- [ ] Document migration in CHANGELOG
- [ ] Consider deprecation notice for bun plugin
- [ ] Update documentation references

---

## Size Estimates

| Skill | Estimated Lines | Status |
|-------|----------------|--------|
| `bunjs/SKILL.md` | ~800 | Enhanced |
| `bunjs-architecture/SKILL.md` | ~600 | New |
| `bunjs-production/SKILL.md` | ~700 | New |
| `bunjs-apidog/SKILL.md` | ~500 | New |
| **Total** | ~2,600 | |

**Comparison**:
- Source content: ~3,293 lines
- Target content: ~2,600 lines
- **Reduction**: ~21% (deduplication and consolidation)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Content loss during migration | Backup all source files, checklist verification |
| Breaking context-detection | Test with sample projects before deployment |
| Skill loading order issues | Document dependencies, test combinations |
| Inconsistent cross-references | Use relative paths, automated link checking |

---

## Implementation Order

**Recommended sequence:**

1. **bunjs/SKILL.md** (core) - Foundational, required by all others
2. **bunjs-architecture/SKILL.md** - Most unique content from agents
3. **bunjs-production/SKILL.md** - Standalone production patterns
4. **bunjs-apidog/SKILL.md** - Independent, optional feature
5. **Plugin integration** - Update plugin.json and context-detection
6. **Testing** - Validate all skills load correctly

---

## Success Criteria

1. All valuable content from bun plugin is preserved in dev plugin
2. Skills are modular and can be loaded independently
3. Context-detection correctly identifies when to load each skill
4. No duplicate content across skills (single source of truth)
5. File sizes are reasonable (<1,000 lines per skill)
6. Cross-references work correctly
7. Quality checks pass on all new files

---

## Appendix: Source File Summary

### backend-developer.md (535 lines)
- Technology stack definition
- Core development principles
- TodoWrite integration
- Layered architecture rules
- Security practices
- Database naming (camelCase)
- API naming (camelCase)
- Quality checks (format, lint, typecheck, test)
- Implementation workflow (9 phases)
- Code templates (route, controller, service, repository, schema)

### api-architect.md (510 lines)
- Architecture specialist role
- TodoWrite workflow
- Discovery & requirements analysis
- Database schema design (camelCase)
- API endpoint design
- Authentication & authorization
- Validation strategy
- Error handling architecture
- Implementation roadmap (8 phases)
- Documentation generation

### apidog.md (546 lines)
- API documentation synchronization
- Environment validation
- Fetch current specification
- Schema analysis & reuse
- OpenAPI spec creation
- Apidog-specific extensions
- REST API import
- Validation & summary

### best-practices.md (1,224 lines)
- Stack overview (versions)
- Project structure
- Quick start commands
- TypeScript configuration
- Biome configuration
- Error handling architecture
- Request validation (Zod)
- API naming (camelCase)
- Database naming (camelCase)
- Database with Prisma
- Authentication & security
- Logging with Pino
- Testing with Bun
- Caching with Redis
- Docker & production
- Production readiness checklist
- Environment variables
- CI/CD with GitHub Actions
- AWS ECS deployment

### bunjs/SKILL.md (478 lines)
- Basic project structure
- HTTP server
- Router pattern
- Route handlers
- Middleware pattern
- Database access (SQLite, PostgreSQL)
- Validation with Zod
- Error handling
- Testing
- Configuration
- File uploads
- WebSocket

---

*Design document generated by agentdev:designer*
*Ready for implementation with agentdev:developer*
