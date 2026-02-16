---
name: db-branching
description: "Automatic database branching for isolated schema development with git worktrees. Supports Neon (recommended), Turso, and Supabase. Creates branch-per-worktree isolation so schema changes never hit production. Use when creating worktrees that involve database schema modifications."
keywords:
  - neon
  - turso
  - supabase
  - database
  - branching
  - worktree
  - prisma
  - drizzle
  - schema
  - isolation
  - postgresql
  - sqlite
  - copy-on-write
  - database-branch
plugin: dev
type: backend
difficulty: intermediate
created: 2026-02-16
updated: 2026-02-16
---

# Database Branching for Worktrees

**Purpose:** Automatically create and manage database branches when working with git worktrees that involve schema changes. Each worktree gets its own isolated database fork, preventing schema modifications from hitting production.

## Supported Providers

| Provider | Database | Branch Speed | ORM Support | Integration |
|----------|----------|-------------|-------------|-------------|
| **Neon** (recommended) | PostgreSQL | Instant (ms) | Prisma, Drizzle, TypeORM, Django | MCP tools (native) |
| **Turso** | libSQL/SQLite | Near-instant | Drizzle, libSQL clients | CLI (`turso`) |
| **Supabase** | PostgreSQL | Seconds | Prisma, Drizzle, TypeORM, Django | CLI (`supabase`) |

## When to Use

- Creating a worktree that will modify schema files (Prisma, Drizzle, raw SQL migrations)
- Adding new database models, columns, or indexes in a feature branch
- Testing migrations in isolation before applying to production
- Running multiple feature branches that each need different schemas
- Any `/dev:worktree create` where schema changes are anticipated

## When NOT to Use

- Worktrees that only modify application code (no schema changes)
- Quick bug fixes that don't touch the database
- Read-only database work (queries, reports)
- Projects using databases without branching support

---

## Provider Detection

Auto-detect the provider from the project's `.env` file:

| Pattern in `*_DATABASE_URL` | Provider | Action |
|-----------------------------|----------|--------|
| `neon.tech` | **Neon** | Use MCP tools (preferred) |
| `turso.io` or `libsql://` | **Turso** | Use `turso` CLI |
| `supabase.co` | **Supabase** | Use `supabase` CLI |
| Other hosts | None | Skip branching, warn user |

```bash
# Detection logic
if grep -q "neon.tech" .env 2>/dev/null; then
  PROVIDER="neon"
elif grep -q "turso.io\|libsql://" .env 2>/dev/null; then
  PROVIDER="turso"
elif grep -q "supabase.co" .env 2>/dev/null; then
  PROVIDER="supabase"
else
  PROVIDER="none"
fi
```

### Schema Tool Detection

| File/Config | Schema Tool | Push Command Pattern |
|-------------|-------------|---------------------|
| `prisma/*/schema.prisma` | Prisma | `{name}:push` or `prisma db push` |
| `drizzle.config.ts` | Drizzle | `drizzle-kit push` |
| `migrations/` + `knexfile.*` | Knex | `knex migrate:latest` |
| `alembic/` | Alembic (Python) | `alembic upgrade head` |
| Raw `.sql` files | Manual | Apply with `psql` or MCP `run_sql` |

---

## Integration with worktree-lifecycle

This skill extends the existing `dev:worktree-lifecycle` 6-phase approach:

| Phase | Standard Behavior | With DB Branching |
|-------|------------------|-------------------|
| Phase 1: Pre-flight | Git checks only | + Detect provider, check availability |
| Phase 3: Creation | Git worktree + .gitignore | + Create DB branch, inject `.env` |
| Phase 4: Setup | Install deps, run tests | + Run schema push against branch |
| Phase 5: Handoff | Report worktree info | + Include DB branch ID in metadata |
| Phase 6: Cleanup | Remove worktree + branch | + Delete DB branch |

---

## Phase 1 Extension: Pre-flight

After standard git checks pass:

1. **Detect provider** from `.env` (see Provider Detection above)
2. **Verify provider tools** are available:

| Provider | Check |
|----------|-------|
| Neon | Try `mcp__Neon__list_projects` — if MCP tools not available, warn |
| Turso | Run `which turso` — if CLI not installed, warn |
| Supabase | Run `which supabase` — if CLI not installed, warn |

If provider tools are not available:
```
[WARN] {Provider} tools not available.
       Worktree will use the production database URL.
       Schema changes will NOT be isolated.

       To enable database branching:
         Neon:     Configure @neondatabase/mcp-server-neon MCP server
         Turso:    brew install tursodatabase/tap/turso
         Supabase: brew install supabase/tap/supabase
```

---

## Phase 3 Extension: Create Database Branch

**Trigger:** User confirmed schema changes will be made, OR task description mentions schema/model/migration work.

Insert after `git worktree add` succeeds, before dependency installation:

### Step 1: Ask About Schema Changes

```yaml
AskUserQuestion:
  question: "Will this branch involve database schema changes (new tables, columns, indexes)?"
  header: "Schema"
  options:
    - label: "Yes - create database branch (Recommended)"
      description: "Isolates schema changes from production via {PROVIDER}"
    - label: "No - use production database"
      description: "Faster setup, but schema changes would hit production"
    - label: "Not sure - create branch anyway"
      description: "Safe default, can delete later if unused"
```

### Step 2: Create Branch (Provider-Specific)

#### Neon (MCP — preferred)

```
mcp__Neon__create_branch(
  projectId: "{PROJECT_ID}",
  branchName: "{BRANCH_NAME}"
)
// Returns: { id: "br-xxx-yyy", ... }

mcp__Neon__get_connection_string(
  projectId: "{PROJECT_ID}",
  branchId: "{BRANCH_ID}"
)
// Returns: connection string for the new branch endpoint
```

#### Turso (CLI)

```bash
turso db create "{DB_NAME}-{BRANCH_SLUG}" --from-db "{DB_NAME}"
# Get the new database URL
turso db show "{DB_NAME}-{BRANCH_SLUG}" --url
# Get auth token
turso db tokens create "{DB_NAME}-{BRANCH_SLUG}"
```

The connection string is: `libsql://{DB_NAME}-{BRANCH_SLUG}-{org}.turso.io` with the auth token.

#### Supabase (CLI)

```bash
supabase branches create "{BRANCH_NAME}" --project-ref "{PROJECT_REF}"
# Returns branch ID and connection details
```

### Step 3: Copy and Patch .env

```bash
# Copy .env from main worktree to new worktree
cp "${ORIGINAL_CWD}/.env" "${WORKTREE_PATH}/.env"

# Replace the DATABASE_URL with branch connection string
# Only swap URLs matching the detected provider - leave other database URLs unchanged
sed -i '' "s|{ENV_VAR_NAME}=.*|{ENV_VAR_NAME}=\"${BRANCH_CONNECTION_STRING}\"|" \
  "${WORKTREE_PATH}/.env"

# For Turso: also update auth token if separate env var
# sed -i '' "s|{TOKEN_VAR}=.*|{TOKEN_VAR}=\"${BRANCH_AUTH_TOKEN}\"|" "${WORKTREE_PATH}/.env"
```

### Step 4: Store Branch Metadata

Write `.db-branch.json` in the worktree root:

```json
{
  "provider": "neon",
  "projectId": "{PROJECT_ID}",
  "branchId": "{BRANCH_ID}",
  "branchName": "{BRANCH_NAME}",
  "parentBranch": "{PARENT_BRANCH_NAME}",
  "parentBranchId": "{PARENT_BRANCH_ID}",
  "connectionString": "{BRANCH_CONNECTION_STRING}",
  "envVar": "{ENV_VAR_NAME}",
  "createdAt": "2026-02-16T10:30:00Z",
  "createdBy": "dev:worktree"
}
```

**Important:** Add `.db-branch.json` to `.gitignore` (contains connection string with credentials).

---

## Phase 4 Extension: Apply Schema

After dependency installation, if database branch was created:

### Push Schema to Branch

Use the detected schema tool:

| Schema Tool | Command |
|-------------|---------|
| Prisma | `bun run {name}:push` or `npx prisma db push` |
| Drizzle | `npx drizzle-kit push` |
| Knex | `npx knex migrate:latest` |
| Alembic | `alembic upgrade head` |

### Verify Schema Applied

#### Neon (MCP)

```
mcp__Neon__run_sql(
  projectId: "{PROJECT_ID}",
  branchId: "{BRANCH_ID}",
  sql: "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
)
```

#### Turso (CLI)

```bash
turso db shell "{DB_NAME}-{BRANCH_SLUG}" "SELECT count(*) FROM sqlite_master WHERE type='table'"
```

#### Supabase

```bash
# Use the branch connection string directly with psql or via Supabase CLI
supabase db execute --project-ref "{PROJECT_REF}" --branch "{BRANCH_NAME}" \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
```

---

## Phase 5 Extension: Enhanced Handoff

Update the worktree metadata to include database branch info:

```json
{
  "worktreePath": ".worktrees/feature-auth",
  "branchName": "feature/auth",
  "originalCwd": "/path/to/project",
  "stacks": ["nodejs"],
  "baselineTests": { "passing": 47, "failing": 7 },
  "status": "active",
  "database": {
    "provider": "neon",
    "projectId": "{PROJECT_ID}",
    "branchId": "br-xxx-yyy",
    "branchName": "feature/auth",
    "parentBranchId": "{PARENT_BRANCH_ID}",
    "envVar": "{ENV_VAR_NAME}"
  }
}
```

### Output

```
Worktree ready:
  Path: .worktrees/feature-auth
  Branch: feature/auth
  Stacks: nodejs
  Dependencies: installed
  Tests: 47 passing, 7 failing (pre-existing)
  DB Provider: Neon (PostgreSQL)
  DB Branch: br-xxx-yyy (from production)
  Database: Isolated (branch-specific connection)
  Status: READY

Safe to run schema commands:
  bun run circl:push       # Push schema changes (isolated)
  bun run circl:generate   # Regenerate Prisma client
```

---

## Phase 6 Extension: Cleanup

### Step 1: Check for Branch Metadata

```bash
DB_META="${WORKTREE_PATH}/.db-branch.json"
if [ -f "$DB_META" ]; then
  PROVIDER=$(jq -r .provider "$DB_META")
  BRANCH_ID=$(jq -r .branchId "$DB_META")
  PROJECT_ID=$(jq -r .projectId "$DB_META")
fi
```

### Step 2: Ask About Schema Migration

```yaml
AskUserQuestion:
  question: "This worktree has a {PROVIDER} database branch. Apply schema changes to production?"
  header: "DB cleanup"
  options:
    - label: "Apply schema to production first, then delete branch (Recommended)"
      description: "Merges code + pushes schema to production"
    - label: "Delete branch (discard schema changes)"
      description: "Only the code gets merged, schema changes are lost"
    - label: "Keep branch for now"
      description: "Worktree is removed but database branch stays (manual cleanup later)"
```

### Step 3: Apply Schema to Production (if chosen)

```bash
cd "${ORIGINAL_CWD}"
# Use the project's schema push command against production
```

### Step 4: Delete Database Branch (Provider-Specific)

#### Neon (MCP)

```
mcp__Neon__delete_branch(
  projectId: "{PROJECT_ID}",
  branchId: "{BRANCH_ID}"
)
```

#### Turso (CLI)

```bash
turso db destroy "{DB_NAME}-{BRANCH_SLUG}" --yes
```

#### Supabase (CLI)

```bash
supabase branches delete "{BRANCH_NAME}" --project-ref "{PROJECT_REF}"
```

---

## Provider Reference: Neon (Recommended)

Neon is the recommended provider due to:
- **Instant copy-on-write branching** — milliseconds, not seconds
- **Native MCP integration** — no CLI shelling, direct tool calls
- **Free tier includes 3 branches** — sufficient for most development
- **Full PostgreSQL** — works with every PostgreSQL ORM
- **Unique endpoints per branch** — clean connection string isolation

### Available Neon MCP Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `mcp__Neon__create_branch` | Create branch | projectId, branchName |
| `mcp__Neon__get_connection_string` | Get branch endpoint | projectId, branchId |
| `mcp__Neon__delete_branch` | Delete branch | projectId, branchId |
| `mcp__Neon__describe_project` | List all branches | projectId |
| `mcp__Neon__run_sql` | Run SQL on branch | projectId, branchId, sql |
| `mcp__Neon__compare_database_schema` | Diff branch vs parent | projectId, branchId, databaseName |

### Neon-Specific Configuration in CLAUDE.md

```markdown
## Neon Database

- Project ID: `{project-id}`
- Main Branch: `production`
- Main Branch ID: `{branch-id}`
- Database: `neondb`
- Env Variable: `{ENV_VAR_NAME}`
- Schema: `prisma/{name}/schema.prisma`
- Push Command: `bun run {name}:push`
```

---

## Provider Reference: Turso

### Prerequisites

```bash
brew install tursodatabase/tap/turso
turso auth login
```

### Key Differences from Neon

- Uses **libSQL** (SQLite fork), not PostgreSQL
- Connection strings use `libsql://` protocol
- Separate auth token per database (stored in different env var)
- ORM support limited to Drizzle and raw libSQL clients
- No MCP server — uses CLI via Bash tool

### Turso-Specific `.db-branch.json`

```json
{
  "provider": "turso",
  "dbName": "{DB_NAME}-{BRANCH_SLUG}",
  "branchName": "{BRANCH_NAME}",
  "parentDb": "{DB_NAME}",
  "connectionString": "libsql://{DB_NAME}-{BRANCH_SLUG}-{org}.turso.io",
  "authToken": "{TOKEN}",
  "envVar": "{ENV_VAR_NAME}",
  "tokenVar": "{TOKEN_VAR_NAME}",
  "createdAt": "2026-02-16T10:30:00Z",
  "createdBy": "dev:worktree"
}
```

---

## Provider Reference: Supabase

### Prerequisites

```bash
brew install supabase/tap/supabase
supabase login
```

### Key Differences from Neon

- Branch creation takes **seconds** (not instant)
- Tightly coupled with **GitHub PR workflow** (preview branches)
- Includes **additional services** per branch (Auth, Storage, Edge Functions)
- Uses `supabase` CLI for branch management
- No MCP server — uses CLI via Bash tool

### Supabase-Specific `.db-branch.json`

```json
{
  "provider": "supabase",
  "projectRef": "{PROJECT_REF}",
  "branchName": "{BRANCH_NAME}",
  "branchId": "{BRANCH_ID}",
  "connectionString": "postgresql://postgres:{password}@db.{branch-ref}.supabase.co:5432/postgres",
  "envVar": "{ENV_VAR_NAME}",
  "createdAt": "2026-02-16T10:30:00Z",
  "createdBy": "dev:worktree"
}
```

---

## Configuration Discovery

### Detecting Provider

Scan in this priority order:

1. **`.db-branch.json`** in any existing worktree — provider already known
2. **`CLAUDE.md`** — look for Neon project ID, Turso DB name, or Supabase project ref
3. **`.env` file** — match URL patterns against provider table
4. **Ask user** — if multiple providers detected or none matched

### Multiple Database URLs

If a project has multiple `*_DATABASE_URL` values:

| URL Pattern | Action |
|-------------|--------|
| Contains `neon.tech` | Branch with Neon |
| Contains `turso.io` | Branch with Turso |
| Contains `supabase.co` | Branch with Supabase |
| Other hosts (MySQL, external PG) | Leave unchanged |

Only swap URLs matching a supported provider. All other database URLs stay the same.

---

## Edge Cases

### Provider Tools Not Available

```
[WARN] {Provider} tools not available.
       Worktree will use the production database URL.
       Schema changes will NOT be isolated.
```

### Branch Creation Fails

```
[ERROR] Failed to create {Provider} database branch: {error}

Options:
  1. Continue without database branch (use production DB)
  2. Retry branch creation
  3. Abort worktree creation
```

### Orphaned Database Branches

When `list` or `status` detects worktrees were removed manually:

```
[WARN] Orphaned database branches detected:

Provider   Branch/DB                       Git Branch              Status
Neon       br-dark-sky-a8xyz123            feature/old-thing       Worktree removed
Turso      mydb-fix-auth                   fix/auth-bug            Worktree removed

Clean up with: /dev:worktree cleanup-orphans
```

### Multiple Providers in One Project

If a project uses both Neon (PostgreSQL) and Turso (SQLite), create branches for both:

```json
{
  "provider": "multi",
  "branches": [
    { "provider": "neon", "branchId": "br-xxx", "envVar": "PG_DATABASE_URL" },
    { "provider": "turso", "dbName": "mydb-feature", "envVar": "TURSO_DATABASE_URL" }
  ]
}
```

---

## Decision Matrix

| Question | How to Check | Action |
|----------|-------------|--------|
| Which provider? | Match `*_DATABASE_URL` against provider patterns | Auto-detect, prefer Neon |
| Provider tools available? | MCP check (Neon) or `which` (Turso/Supabase) | Warn if unavailable |
| Schema changes? | Ask user or detect from task description | Create branch if yes |
| Which env var to swap? | Find `*_DATABASE_URL` matching provider | Only swap matching URLs |
| Schema push command? | Check `package.json` scripts, drizzle config, etc. | Use push, not migrate |
| Cleanup timing? | After git merge or explicit cleanup | Delete branch after schema applied |

---

## List Command Extension

When `/dev:worktree list` runs, show database branch status:

```
Active Worktrees:

Path                              Branch                    DB Branch (Provider)
──────────────────────────────────────────────────────────────────────────────────
/project                          main                      production (Neon)
.worktrees/add-audit-log          feature/add-audit-log     br-dark-sky-a8xyz123 (Neon)
.worktrees/edge-cache             feature/edge-cache        mydb-edge-cache (Turso)
.worktrees/fix-sync-bug           fix/sync-bug              (none)
```

---

## Integration with Other Skills

- **worktree-lifecycle:** Primary integration — extends all 6 phases
- **database-patterns:** Schema design patterns used in branched development
- **context-detection:** Detects database provider from env vars and config files
- **verification-before-completion:** Verify schema applied to production before cleanup
