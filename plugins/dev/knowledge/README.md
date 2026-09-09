# `dev` knowledge base

**Reference consulted at a decision point. Reading it changes what you *know*.** A skill is
an ordered procedure with a checkable end state — following it changes what you *do*. These
are not that. Jump to the section you need and leave.

## Location is the classification

There is no `kind:` field here and no registry.

| On disk | Classification |
|---|---|
| `plugins/dev/skills/<…>/SKILL.md` | SKILL — invoke, or read and follow |
| `plugins/dev/knowledge/**.md` | KNOWLEDGE — read the relevant part |

Moving a file is the only classification act that cannot drift from the thing it
classifies. A frontmatter field can be wrong about its own file, a generated index goes
stale, and a hand-written table is what put a reference to a deleted skill in two
always-loaded files at once.

**Nothing registers this directory.** It carries no manifest entry, it is not in
`.claude-plugin/plugin.json`, and it costs nothing against the skill-listing budget. It is
reached by path and only by path. `plugins/go/knowledge/` has shipped this way for
releases; `scripts/publish-dist.sh` copies the whole plugin directory and its ignore list
(`node_modules`, `.DS_Store`, `__pycache__`, `*.pyc`, `.build`, `DerivedData`, `.venv`,
`venv`, `.claude`, `.mnemex`) does not name `knowledge`.

The category layout **mirrors `skills/`** — `backend/`, `frontend/`, `discipline/` — so
the loadout rules in
[`../skills/context-detection/references/loadout-rules.md`](../skills/context-detection/references/loadout-rules.md)
apply to both trees unchanged. A topic with supporting references keeps them in a
same-named directory beside it: `backend/golang.md` and `backend/golang/performance.md`.

A loadout may name any file here. Reading a path needs no skill registry, which is why
knowledge works for every consumer including agents that hold no `Skill` tool.

## What each file answers

### `backend/` — gated by `repo.stacks`; never load `python` for a Go repo

| File | Answers |
|---|---|
| `api-design.md` | REST and GraphQL design — pagination, filtering, versioning, auth, rate limiting, OpenAPI |
| `auth-patterns.md` | JWT, sessions, OAuth, RBAC/ABAC, password hashing, MFA |
| `bunjs.md` | Bun/Hono — HTTP endpoints, Prisma/SQLite, Zod validation, `bun test` |
| `bunjs-apidog.md` | OpenAPI specs for Bun APIs and the Apidog import API |
| `database-patterns.md` | Schema design, repository pattern, query optimisation, migrations, indexes, transactions |
| `dingo.md` | Dingo meta-language for Go — optionals, results, generics shortcuts, transpiling to `.go` |
| `error-handling.md` | Custom error classes, error middleware, structured logging, retry, graceful shutdown |
| `golang.md` | Go idioms — goroutines and channels, error handling, testify, API and CLI patterns |
| `golang/performance.md` | Profiling Go, chasing allocations, tuning a hot path |
| `python.md` | FastAPI, async endpoints, Pydantic, SQLAlchemy, pytest |
| `rust.md` | Axum, type-safe handlers, SQLx, `thiserror` |

### `frontend/` — gated by framework

| File | Answers |
|---|---|
| `browser-use-integration.md` | Detecting `browser-use@magus` and driving headless automation from a frontend workflow |
| `css-modules.md` | CSS Modules with Lightning CSS, PostCSS, `*.module.css`, TypeScript, Vite |
| `react-typescript.md` | React 19 + TypeScript — components, hooks, TanStack Query, Zod forms, error boundaries |
| `shadcn-ui.md` | shadcn/ui — CLI install, CSS-variable theming, dark mode, React Hook Form + Zod |
| `state-management.md` | Choosing between Zustand, Pinia, TanStack Query and URL state |
| `state-management/tanstack-query.md` | Server cache specifically — fetching, caching, invalidation |
| `tailwindcss.md` | TailwindCSS v4 — CSS-first `@theme`, design tokens, container queries, dark mode |
| `tanstack-router.md` | File-based routes, typed params and search, layouts, loaders |
| `testing-frontend.md` | Component tests, user interactions, API mocking, Vitest / RTL / Vue Test Utils |
| `vue-typescript.md` | Vue 3 + TypeScript — Composition API, `script setup`, Pinia, Vue Router, composables |

The design-system rules are **not** here. They are a skill —
`../skills/frontend/design-system-guardrails/SKILL.md` — because they are mandatory on
every frontend task and you can fail them.

There is no `design/` category. The `designer@magus` presence check is not knowledge: it
lives in `dev:frontend` and `/dev:audit`, the two places that act on the answer, and the
skill that once carried it was deleted in dev 6.1.0.

### `discipline/`

| File | Answers |
|---|---|
| `task-management.md` | Tracking phases in text, since current models have no task-list tools |
| `task-management/agent-coordination.md` | Splitting work across parallel agents rather than sequential phases |

### Top level

| File | Answers |
|---|---|
| `enforcement.md` | How `/dev:dev` proves a phase is done — the artifact gate and the outer loop |
| `mcp-standards.md` | MCP server patterns — tool interfaces, transports, tool naming |
| `optimize.md` | Finding bottlenecks, build times, bundle size |
| `release-playbook.md` | The per-project release playbook at `ai-docs/release.md` — its section schema, what belongs in each section, and the evidence-to-proposal tables that author one |
| `security-audit.md` | The procedures `dev:reviewer` runs under `FOCUS: security` — dependency-CVE commands per package manager, committed-secret grep patterns, the GDPR/HIPAA/SOC 2 checklist. No taxonomy or severity scale: the reviewer owns those |

## Frontmatter here is `description` only

Each file keeps a `description:` line and nothing else in its frontmatter. The skill keys
the files carried in from `skills/` — `name`, `disable-model-invocation`, `user-invocable`
— were stripped on 2026-09-04, after the move had landed as a pure rename in the diff.
Nothing had read them: the skill loader never sees this directory, so a flag that reads as
behaviour but is not was dead weight. A file's name is its path.

## Adding a file

1. Put it in the category that matches `skills/`. Create a new category only when
   `skills/` gains one.
2. Add a row above. One line: what question it answers.
3. Check it is knowledge and not a workflow —
   `bun scripts/classify-skill-shape.ts --plugin dev`. That script PROPOSES; you decide.
   It scores by shape, and it has been wrong: a seven-phase procedure written with
   `## Phase N:` headings read as a catalogue until the signal was widened.
4. Do not add a manifest entry. There is nothing to register.
