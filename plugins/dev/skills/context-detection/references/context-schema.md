# `context.json` v2 — the normative schema

This file is the **single definition** of the session context object that
`dev:stack-detector` writes to `${SESSION_PATH}/context.json`. Every consumer links here;
none restates the shape.

Machine-checkable form: `bun scripts/check-context-schema.ts --file <path>`.

## Why the schema is written down at all

Under v1 it was not. `context.json` was read by **no code** — verified by searching the whole
repo for the filename and finding every reference in markdown, none in a `.ts`, `.js`, `.sh`
or `.py` file. It was also absent from `PHASE_ARTIFACTS` in
`plugins/dev/hooks/phase-completion-validator.ts`, so its absence, its emptiness and its
shape were all unchecked at runtime.

The result was a schema enforced by prose agreement between six markdown files, and it had
already forked — see "The six fields v1 promised nobody" below. v2 exists to close that
gap: one definition, one validator, one runtime artifact check.

## v2 replaces v1. There is no compatibility path

Per this repo's rule that replacing something means deleting the old one in the same change,
**v1 is gone**. There is no migration shim, no compatibility flag, no dual-read.

| Deleted from v1 | Where its meaning went |
|---|---|
| `bundled_skill_paths` | `agent_loadouts.<agent>.read` — per-agent, ordered, capped |
| top-level `detected_stack` | `repo.detected_stack` |
| top-level `mode` | `repo.mode` |
| top-level `stacks` | `repo.stacks` |
| top-level `frameworks` | `repo.frameworks` |
| top-level `quality_checks` | `commands.quality_checks` |
| the undeclared `stack` | `repo.detected_stack` — one concept, one name |

`bundled_skill_paths` is **deleted, not deprecated**, and it does not co-exist with
`agent_loadouts`. Two lists that can disagree about what to read is worse than either alone,
and a flat list is precisely what made every agent read the same thing regardless of its
role. The validator treats the presence of any deleted key as an error, so a v1 document
fails rather than half-validating.

## Design rules the shape encodes

1. **One schema, one home.** This file. A consumer that needs a field links to this table
   instead of copying it — a second copy of the mapping is what put the same dead skill path
   in two always-loaded files.
2. **No backward compatibility.** Above.
3. **Every path is verified before it is emitted.** The detector `stat`s each path it names
   and drops the ones that do not exist, recording the drop in `warnings`. This is a
   producer obligation, not a validator check — see "What the validator deliberately does
   not check".
4. **Provenance, never a silent fallback.** Where a fact has more than one possible source,
   the object names which source answered and what fidelity that source has. A `??` chain is
   where staleness hides.
5. **`read` lists are capped at 5 per agent.** A 20-path list is a list nobody reads.

---

## Top level

Every key below is **required**. An absent key is an error, not an implied default — a
consumer that has to distinguish "absent" from "empty" will eventually get it wrong.

| Key | Type | Notes |
|---|---|---|
| `schema` | number | Exactly `2`. Any other value is rejected. |
| `generated_at` | string | ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`. |
| `cwd` | string | Absolute path to the repo the detector classified. |
| `repo` | object | What the repository IS. |
| `commands` | object | How to check work in it. |
| `task` | object | What the WORK is. |
| `architecture` | object \| null | Which architecture file to read. `null` is a legitimate answer. |
| `mcp` | object | What tooling is actually reachable. |
| `agent_loadouts` | object | Who reads what. |
| `discovered_skills` | array | Project-local skills found in the target repo. |
| `warnings` | string[] | Everything the detector dropped or could not resolve. Empty array when clean. |

## `repo` — what the repository is

| Key | Type | Notes |
|---|---|---|
| `detected_stack` | string | Human-readable summary, e.g. `"react-typescript + golang"`. Non-empty. |
| `mode` | enum | `frontend` \| `backend` \| `fullstack` |
| `stacks` | string[] | Non-empty. Machine-readable stack ids; the filter for every stack-gated loadout rule. `["unknown"]` when nothing in the detector's set matched — a Java or .NET repo — never an empty list and never the nearest listed stack. |
| `frameworks` | object | `name → version`, both strings. May be empty. |
| `shape` | enum | `single` \| `monorepo` \| `multi-service` |
| `evidence` | array | `{ claim: string, file: string, line: number }`. May be empty; when non-empty each entry must name a real file and line the claim came from. |

`evidence` exists so a wrong classification is arguable. "This repo is Go" with no citation
cannot be checked by the agent that receives it; `go.mod:3` can.

## `commands` — how to check work

| Key | Type | Notes |
|---|---|---|
| `test_runner_command` | string \| null | `null` when the repo has no test runner. Never an empty string. |
| `full_suite_args` | string \| null | Appended for full-suite runs. |
| `test_file_patterns` | string[] | Globs. May be empty. |
| `lint_command` | string \| null | |
| `typecheck_command` | string \| null | |
| `quality_checks` | object | `surface → string[]`, e.g. `{"frontend": ["bun run lint"], "backend": ["go vet ./..."]}`. Values must be arrays of non-empty strings. |

`null` and `""` are not interchangeable. `null` means "this repo has no such command";
an empty string means the detector failed and did not say so.

### The six fields v1 promised nobody

Two live consumers ask `dev:stack-detector` for a schema its own declared output never
mentioned:

- `plugins/dev/commands/fix.md:176` — *"Include fields: stack, test_runner_command,
  full_suite_args, test_file_patterns, lint_command, typecheck_command"*
- `plugins/dev/skills/discipline/systematic-debugging/session-setup.md:44` — the same six,
  plus a field-reference table at `:51-63` documenting them as though they were the contract.

None of the six appeared in v1's declared output block. **v2 rules the consumers right and
the declaration wrong**, for three reasons:

1. **The detector already computes them.** v1 emitted `quality_checks.frontend` as
   `["bun run format", "bun run lint", "bun run typecheck", "bun test"]`. The lint command
   was in the file — buried at index 1 of an unlabelled array, where no consumer can address
   it without positional guessing. Naming the field is not new work; it is publishing work
   already done.
2. **The consumers are load-bearing.** `/dev:fix` runs `CI=true {test_runner_command}` in
   its REPRODUCE phase and reruns with `{full_suite_args}` in VALIDATE. These are not
   aspirational reads; the command's control flow depends on them.
3. **The alternative is worse.** Declaring the consumers wrong means deleting the field
   reads and leaving `/dev:fix` to re-derive the test runner itself, in prose, per
   invocation — which reintroduces the two-homed derivation that caused the original bug.

So **five of the six join v2 verbatim**, under `commands.*`, with their v1 names unchanged.

**The sixth, `stack`, is rejected as a name.** It is a synonym for `detected_stack`, and v1
carried both — one declared, one not. Two names for one concept is how a schema forks. The
consumers are retargeted to `repo.detected_stack`; `stack` at any level is an error.

## `task` — what the work is

The detector never invents a task. It resolves the brief from the first source that exists
and records which one answered.

| Key | Type | Notes |
|---|---|---|
| `brief` | string | Verbatim, first 400 chars of the source. Longer is an error, not a truncation the validator performs. |
| `source` | enum | `prompt` \| `requirements.md` \| `bug-report.md` \| `command` \| `none` |
| `kind` | enum | The closed set below. |
| `confidence` | enum | `high` \| `low` |
| `surfaces` | array | Zero or more of `backend`, `frontend`, `infra`, `docs`. Orthogonal to `kind` — a task is commonly `new_subsystem` on both backend and frontend. |
| `signals` | string[] | What matched, with a citation. May be empty only when `kind` is `unknown`. |

### `kind` is a closed set of seven

| `kind` | Drives |
|---|---|
| `new_subsystem` | an architectural style file |
| `bug_fix` | the systematic-debugging discipline; **no** architecture file |
| `ui_change` | the frontend design-system guardrails — always mandatory |
| `refactor` | the architecture refactoring reference |
| `docs` | documentation standards |
| `ops` | production and stack-specific ops guidance |
| `unknown` | nothing; loadouts fall back to repo-derived entries only |

Closed deliberately. An eighth intent should be an edit that fails a check somewhere, not a
free-text string nobody notices. `unknown` is a member of the set, not an escape from it.

## `architecture` — which file to read, or `null`

`null` is a first-class value and the correct one whenever no architectural style question
is being asked. Emitting a plausible-looking recommendation for a bug fix is an invented
opinion, which is worse than silence.

| Key | Type | Notes |
|---|---|---|
| `recommendation` | string | Non-empty. |
| `read` | string[] | 1 to 5 paths, ordered. |
| `why` | string | Non-empty. The reasoning, not a restatement of the recommendation. |
| `rejected` | array | `{ option: string, because: string }`. May be empty. |

## `mcp` — what tooling is reachable

| Key | Type | Notes |
|---|---|---|
| `source` | enum | `claude-cli` \| `static-files` |
| `checked_health` | boolean | See the provenance invariant below. |
| `servers` | array | `{ name, owner: string\|null, scope, status, usage: string\|null }` |
| `unavailable` | array | `{ name, status }` |

`servers[].scope` is one of `plugin`, `project`, `local`, `user`.
`servers[].status` is one of `connected`, `pending_approval`, `failed`, `unknown`.
`unavailable[].status` is one of `not_configured`, `failed`, `pending_approval`.

`owner` is the owning plugin, or `null` for a server configured outside any plugin.

`usage` names the owning plugin's usage skill **by path**, or is `null`. It is `null` and
never guessed: no disk mechanism yields the tool names a server exposes — that needs a live
`tools/list` call the detector must not make. A server whose usage document is unknown is
reported as available with no guidance, which is true. Inventing a plausible skill path
would recreate the dead-path bug in a new field.

## `agent_loadouts` — who reads what

An object keyed by **agent name**, holding only the agents this task will actually dispatch.

| Key | Type | Notes |
|---|---|---|
| `read` | string[] | Ordered, mandatory entries first. **1 to 5 paths.** |
| `mandatory` | string[] | A subset of `read`. The agent must not skip these. May be empty. |
| `mcp` | string[] | Server names, each of which must appear in `mcp.servers[].name`. May be empty. |
| `note` | string | Optional. One line. Omit rather than emit `""`. |

Three rules the validator enforces:

1. **The cap is 5.** More than five is rejected. The cap governs what is *pushed*; an agent
   may always read more on its own initiative.
2. **No empty entries.** An agent with nothing to read is omitted from the object entirely.
   An empty entry is noise a consumer has to filter, and a consumer that has to filter will
   eventually filter wrongly.
3. **`scribe`, `synthesizer` and `stack-detector` never get an entry.** `scribe` is a file
   writer, `synthesizer` consolidates other agents' output, and `stack-detector` produces
   the loadouts. This is stated so a future reader does not read the omission as an
   oversight. Every other key must name a real agent.

## Paths — what an emitted path may look like

Every path in `architecture.read`, `agent_loadouts.<a>.read`, `agent_loadouts.<a>.mandatory`
and `mcp.servers[].usage` takes exactly one of two forms:

| Form | Means | Example |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}/…` | a file inside the `dev` plugin itself | `${CLAUDE_PLUGIN_ROOT}/knowledge/backend/golang.md` |
| absolute (`/…`) | any other file on the machine the document describes — another plugin's file under its installed root, or a file in the target repo | `/home/u/.claude/plugins/cache/magus/go/0.1.2/knowledge/roles/developer/best-practices.md` |

A repo-relative `plugins/<p>/…` is **rejected** (rule `PATH`). It is the layout of the magus
source repository: a customer machine keeps plugins at
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and has no `plugins/` directory,
so such a path is dead on every install and resolves only for whoever wrote it. The 7.0.0
detector shipped fifteen of them in its own examples, which is why the rule exists. How the
installed root is found — `installed_plugins.json`, never `installedPluginVersions` — is
loadout-rules.md → "Resolving another plugin's installed root".

`${CLAUDE_PLUGIN_ROOT}` is normally already expanded in the detector's own instructions by
the time it runs, so an own-plugin path is usually emitted absolute as well. The literal
form is accepted so that a document produced from unexpanded instructions still validates;
it is left for the consumer to expand.

`discovered_skills[].path` is the one exception and stays relative to the target repo's
root, because that is the coordinate system the project's own skills live in.

## `discovered_skills` — project-local skills

Array of `{ name, description, path, source, categories: string[] }`, all strings. `path` is
relative to the repo root. May be empty; empty is the common case.

## `warnings`

Every path dropped for not existing, every probe that timed out, every field left `null`
because nothing answered. An empty array means the run was clean, which is a claim; it is
not the same as the key being absent.

---

## Cross-field invariants

These are the rules a per-field type check cannot express. Each one exists because breaking
it produces a document that reads as authoritative while being wrong.

| # | Invariant | Why |
|---|---|---|
| X1 | `task.kind == "unknown"` ⟹ `task.confidence == "low"` | A confidently unknown intent is a contradiction. Low confidence is reported, never smoothed over. |
| X2 | `task.source == "none"` ⟹ `task.kind == "unknown"` | No brief means no intent. Deriving one from the repo alone is invention. |
| X3 | `task.kind == "bug_fix"` ⟹ `architecture == null` | A bug fix drives the debugging discipline and no architectural style file. |
| X4 | `mcp.source == "claude-cli"` ⟺ `mcp.checked_health == true` | The CLI is the only source that health-checks. If it answered, health was checked. |
| X5 | `mcp.checked_health == false` ⟹ every `mcp.servers[].status == "unknown"` | Static files say what is *configured*. They cannot say what is *running*. A loadout built from them must be able to say "configured; I did not verify it is running". |
| X6 | `agent_loadouts.<a>.mandatory` ⊆ `agent_loadouts.<a>.read` | A mandatory path the agent was never given is unreachable. |
| X7 | `agent_loadouts.<a>.mcp[*]` ∈ `mcp.servers[].name` | Naming a server that is not in the inventory hands the agent a tool it does not have. |

X4 and X5 are the same rule as the repo's ban on silent `??` fallbacks, applied to
environment probing. The two probes return genuinely different fidelity; rather than hide
that behind a uniform return type, the schema surfaces it.

## What the validator deliberately does not check

**Path existence.** `check-context-schema.ts` validates shape and invariants, never whether
a path in `agent_loadouts.<a>.read` resolves on disk. It does check the path's **form**
(rule `PATH`, above) — form is decidable without a filesystem; existence is not. Two reasons
existence stays out:

- A `context.json` describes some *other* repo, at a `cwd` that may not exist on the machine
  running the validator, and `${CLAUDE_PLUGIN_ROOT}` is unexpanded at rest. An existence
  check would false-fail on correct documents.
- Existence is already covered twice, closer to where it can be fixed: design rule 3 makes
  the detector `stat` each path before emitting it, and `scripts/check-plugin-paths.ts`
  gates the paths named in plugin markdown.

A validator that false-fails gets suppressed, and a suppressed gate protects nothing.

---

## Worked example

Task: *"Add per-tenant rate limiting to the public API and surface remaining quota in the
account settings page."* Repo: React + Go fullstack.

```json
{
  "schema": 2,
  "generated_at": "2026-09-03T10:22:41Z",
  "cwd": "/repo",
  "repo": {
    "detected_stack": "react-typescript + golang",
    "mode": "fullstack",
    "stacks": ["react-typescript", "golang"],
    "frameworks": { "react": "19.0.0", "go": "1.21" },
    "shape": "monorepo",
    "evidence": [
      { "claim": "react-typescript", "file": "frontend/package.json", "line": 14 },
      { "claim": "golang", "file": "go.mod", "line": 3 }
    ]
  },
  "commands": {
    "test_runner_command": "go test ./...",
    "full_suite_args": "-race",
    "test_file_patterns": ["**/*_test.go", "frontend/**/*.test.tsx"],
    "lint_command": "golangci-lint run",
    "typecheck_command": "cd frontend && bun run typecheck",
    "quality_checks": {
      "frontend": ["cd frontend && bun run lint", "cd frontend && bun test"],
      "backend": ["go fmt ./...", "go vet ./...", "golangci-lint run", "go test ./..."]
    }
  },
  "task": {
    "brief": "Add per-tenant rate limiting to the public API and surface remaining quota in the account settings page.",
    "source": "requirements.md",
    "kind": "new_subsystem",
    "confidence": "high",
    "surfaces": ["backend", "frontend"],
    "signals": [
      "requirements.md:4 \"Add per-tenant rate limiting\" -> build verb + absent subsystem",
      "requirements.md:9 \"account settings page\" -> frontend surface"
    ]
  },
  "architecture": {
    "recommendation": "layered",
    "read": ["${CLAUDE_PLUGIN_ROOT}/skills/architecture/references/styles/layered.md"],
    "why": "middleware-shaped cross-cutting concern in an existing single deploy unit; no new boundary is being drawn",
    "rejected": [
      {
        "option": "microservices",
        "because": "no independent-scaling requirement stated; single deploy unit today"
      },
      {
        "option": "event-driven",
        "because": "quota must be enforced synchronously on the request path"
      }
    ]
  },
  "mcp": {
    "source": "claude-cli",
    "checked_health": true,
    "servers": [
      {
        "name": "ca",
        "owner": "code-analysis",
        "scope": "plugin",
        "status": "connected",
        "usage": "/home/u/.claude/plugins/cache/magus/code-analysis/7.1.0/skills/code-search/SKILL.md"
      },
      {
        "name": "tmux",
        "owner": "terminal",
        "scope": "plugin",
        "status": "connected",
        "usage": "/home/u/.claude/plugins/cache/magus/terminal/4.2.0/skills/terminal-interaction/SKILL.md"
      },
      {
        "name": "mnemex",
        "owner": "mnemex",
        "scope": "plugin",
        "status": "connected",
        "usage": null
      }
    ],
    "unavailable": [{ "name": "browser-use", "status": "not_configured" }]
  },
  "agent_loadouts": {
    "architect": {
      "read": [
        "${CLAUDE_PLUGIN_ROOT}/skills/architecture/references/styles/layered.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/backend/api-design.md",
        "${CLAUDE_PLUGIN_ROOT}/skills/core/universal-patterns/SKILL.md"
      ],
      "mandatory": [
        "${CLAUDE_PLUGIN_ROOT}/skills/architecture/references/styles/layered.md"
      ],
      "mcp": ["ca"]
    },
    "developer": {
      "read": [
        "${CLAUDE_PLUGIN_ROOT}/knowledge/backend/golang.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/backend/api-design.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/backend/error-handling.md",
        "/home/u/.claude/plugins/cache/magus/go/0.1.2/knowledge/roles/developer/best-practices.md"
      ],
      "mandatory": [],
      "mcp": ["ca", "tmux"]
    },
    "frontend": {
      "read": [
        "${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/SKILL.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/frontend/react-typescript.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/frontend/state-management.md"
      ],
      "mandatory": [
        "${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/SKILL.md"
      ],
      "mcp": [],
      "note": "browser-use is not configured; no browser validation available this session"
    },
    "test-architect": {
      "read": [
        "${CLAUDE_PLUGIN_ROOT}/skills/core/testing-strategies/SKILL.md",
        "/home/u/.claude/plugins/cache/magus/go/0.1.2/knowledge/roles/tester/best-practices.md"
      ],
      "mandatory": [],
      "mcp": []
    },
    "reviewer": {
      "read": [
        "${CLAUDE_PLUGIN_ROOT}/knowledge/security-audit.md",
        "${CLAUDE_PLUGIN_ROOT}/knowledge/backend/auth-patterns.md"
      ],
      "mandatory": [],
      "mcp": ["ca"]
    }
  },
  "discovered_skills": [],
  "warnings": []
}
```

Note what the example does **not** do. It lists five agents, not thirteen. `debugger`,
`docs`, `devops`, `researcher`, `spec-writer`, `scribe`, `synthesizer` and `stack-detector`
are all absent because this task dispatches none of them.

---

## Validation

```bash
bun scripts/check-context-schema.ts --file ${SESSION_PATH}/context.json
bun scripts/check-context-schema.ts --self-test
```

`--self-test` runs the validator over `scripts/testdata/context-schema/`, which covers every
`task.kind` value and both `mcp.source` values on the positive side — plus an unrecognised
stack (`["unknown"]`) and a command-derived intent (`source: command`) — and one document per
rejection rule on the negative side. It fails if any rule cannot fire, and it fails if the
positive testdata stops covering the full enum — a self-test that cannot fail is not
evidence.

At runtime the artifact itself is gated: `PHASE_ARTIFACTS.phase3` in
`plugins/dev/hooks/phase-completion-validator.ts` requires `context.json` at a minimum size,
so a Phase 3 that produced no context is caught where the pipeline actually runs.
