# Loadout rules — the only hand-written part of the mapping

A **loadout** is the ordered, capped set of paths ONE agent should read for ONE task. It is
derived per session and never stored. `dev:stack-detector` builds one per dispatched agent
and emits them as `agent_loadouts` in
[`context.json` v2](./context-schema.md).

This file holds the nine judgement calls that no filesystem records: **which agent benefits
from which category.** Everything else in a loadout is read off disk at detection time.

---

## Why this file exists, and why nothing else may hold a second copy

The stack→skill mapping used to have **two homes that had to be edited together**:

- `plugins/dev/agents/stack-detector.md` — an XML `<bundled_skill_path_mapping>` block
- `plugins/dev/skills/context-detection/SKILL.md` — a bash `generate_skill_paths()` function
  carrying the same table, plus a second `map_stacks_to_skills()` carrying the core-skill
  half of it

`context-detection` is preloaded by ten `dev` commands (`bun scripts/dev-skill-inventory.ts dev`
→ `debug, fix, architect, investigate, dev, help, audit, release, research, interview`), so
both copies loaded on nearly every entry point. When one entry went stale, it went stale in
two always-loaded files at once — and it did: a reference to a skill directory that does not
exist shipped in four places before anything noticed, because no gate could see a bare path
inside a bash fence.

**That is the failure this file exists to make impossible.** The rule is:

> The stack→skill mapping has exactly ONE home. Category→agent judgement lives here, in
> prose. Everything else is derived from the filesystem at detection time. No second copy
> is permitted anywhere — not in an agent file, not in a skill body, not in a script.

A consumer that needs the mapping links to this file. It does not restate it. Restating it
is what produced the bug.

---

## Derivation: what is read off disk, and what is decided here

**The directory decides the classification. There is no `kind:` field and no registry.**

| On disk | Classification | How it is used |
|---|---|---|
| `<plugin>/skills/<…>/SKILL.md` | SKILL | a path an agent reads, or a skill it invokes |
| a directory under `skills/` with **no** `SKILL.md` | CATEGORY | the grouping the rules below key on |
| `<plugin>/knowledge/**.md` | KNOWLEDGE | a path an agent reads at a decision point |

Moving a file is the only classification act that cannot drift from the thing it classifies.
A frontmatter field can be wrong about its own file; a generated index goes stale; a
hand-written table is what produced the two-homed mapping above.

### `knowledge/` mirrors `skills/`, so R1-R9 cover both trees unchanged

`knowledge/` uses the same category names — `backend/`, `frontend/`, `discipline/` — and
depth-1 topics sit at its root exactly as depth-1 skills sit at the root of `skills/`. Every
rule below keys on the **category**, never on a tree, so `backend/**` means
`skills/backend/**` and `knowledge/backend/**` together and R3 needs no second clause. That
is the whole reason for mirroring rather than inventing a taxonomy: a second layout would
need a second rule set, and two rule sets is the two-homed shape again.

Two shapes to expect when enumerating `knowledge/`:

| Path | What it is |
|---|---|
| `knowledge/<cat>/<topic>.md` | the topic |
| `knowledge/<cat>/<topic>/<ref>.md` | that topic's supporting reference, in a same-named directory beside it |

`plugins/dev/knowledge/backend/golang.md` and `plugins/dev/knowledge/backend/golang/performance.md`
are the worked case. Push the topic; the topic points at its own references.

So the detector's procedure is:

1. **Enumerate.** List both trees. Under `skills/`: a category is a directory with no
   `SKILL.md`, a skill is a directory with one. Under `knowledge/`: the unit is the file,
   and its category is its parent directory. Never a hardcoded list of names.
2. **Gate by stack** (below).
3. **Gate by task** — `task.kind` and `task.surfaces` from §"Task gates".
4. **Map category → agents** — rules R1-R9 below. This step, and only this step, reads
   this file.
5. **Rank, cap, mark.** Mandatory entries first, then most-specific to least. Hard cap of
   **5** paths per agent. Drop any path that does not `stat`, and record the drop in
   `warnings`.
6. **Omit empty agents.** An agent with nothing to read gets no entry at all.

### Stack gating is by NAME, not by table

A skill directory whose name matches a stack id in `repo.stacks` is loaded only for that
stack. A directory whose name matches nothing is stack-neutral within its category.

| Directory name | Gate |
|---|---|
| exactly a stack id (`golang`, `rust`, `python`, `bunjs`, `dingo`, `react-typescript`, `vue-typescript`) | that id ∈ `repo.stacks` |
| a stack id followed by `-` (`bunjs-production`, `bunjs-apidog`, `bunjs-architecture`) | that id ∈ `repo.stacks` |
| a framework or library name (`tailwindcss`, `shadcn-ui`, `tanstack-router`, `css-modules`) | that name appears in `repo.frameworks`, or in the repo's dependency manifest |
| anything else (`api-design`, `error-handling`, `state-management`, …) | stack-neutral; category rule alone decides |

This is a rule over names, not a table of names, so adding
`plugins/dev/skills/backend/<new-stack>/SKILL.md` needs **no edit here**. That is the whole
point: a table would have to be edited, and a table that has to be edited is a table that
goes stale.

**`dingo` co-loads `golang`.** Dingo transpiles to Go, so a repo with `dingo` in
`repo.stacks` also carries `golang`, and both skills are eligible. This is the one
name-gating exception, and it is recorded in `repo.stacks` by the detector rather than
special-cased here.

**`["unknown"]` gates nothing in.** A Java, .NET or other repo outside the detector's set
carries `repo.stacks: ["unknown"]`, no directory is named `unknown`, so every stack-gated
row above and every language row of R9 contributes nothing. What such a repo still gets is
the stack-neutral material — R1, R2, the neutral files under R3 and R4 — and its `commands.*`
still come from its own tooling (a `pom.xml` names its test runner whether or not the
detector recognises the language).

---

## Preloading is not a loadout. Do not merge them

Two independent mechanisms exist, and conflating them breaks both.

| | `skills:` frontmatter preload | `agent_loadouts` |
|---|---|---|
| What it is | an authoring-time edge in an agent's or command's frontmatter | a per-session derived list of paths |
| Set at | authoring time, in the file | detection time, in `context.json` |
| Cost | every invocation of that agent, forever | this task only |
| Varies with the task | **no** | **yes** |
| Blocked by `disable-model-invocation` | **yes** — the flag blocks subagent preloading too | **no** — a loadout names a path, and reading a path needs no skill registry |

Consequences the detector must respect:

- **Never put a preloaded skill in that same agent's loadout.** Read the preloads off disk
  (`grep -A3 '^skills:' plugins/dev/agents/*.md`) rather than from memory; the 13-agent
  table below records them as of writing. `dev:debugger` preloads `dev:systematic-debugging`
  and `dev:docs` preloads `dev:documentation-standards`; naming either again spends a cap
  slot on a file the agent already has. The one exception is `frontend` +
  `design-system-guardrails`, listed anyway as `mandatory` because the marker is what a
  downstream reviewer checks.
- **A loadout may name a `disable-model-invocation` skill freely.** It is a path, not an
  invocation. Half the marketplace corpus carries that flag; excluding those files would
  throw away most of what is worth reading.
- **A loadout may name a `knowledge/` file.** Knowledge is never registered and never
  invocable, and it is reached the same way — by path.

---

## R1-R9 — category to agent

Nine rules. They are judgement, they can go stale, and nine rules in one file is a far
smaller surface than a row per skill in a generated one.

| # | Category | Agents | Notes |
|---|---|---|---|
| **R1** | `core/**` | architect, developer, frontend, test-architect, reviewer, debugger, devops | Universal and stack-independent. Lowest rank — it is what a spare cap slot gets, never what fills the first one. |
| **R2** | `architecture/**` | **architect** always; **reviewer** when `task.kind` is `refactor` or `new_subsystem` | The router at `SKILL.md` picks *which* file. Never push the router itself — push the leaf it routes to (a style file, a GoF category, `selection.md`, `refactoring.md`, `adr.md`). Pushing the index spends a slot on navigation. |
| **R3** | `backend/**` | developer, test-architect, reviewer, debugger; devops gets `bunjs-production` only | Filtered by `repo.stacks` per the name rule above. **Never load `python` for a Go repo** — a wrong-language skill is worse than none, because it reads as authoritative. |
| **R4** | `frontend/**` | frontend, developer, reviewer | Filtered by framework. `design-system-guardrails` is **mandatory** whenever `task.surfaces` includes `frontend`, whatever `kind` says. |
| **R5** | `discipline/**` — splits by file, never as a block | `systematic-debugging` → debugger. `test-driven-development` + `verification-before-completion` → test-architect, developer. `worktree-lifecycle` + `task-management` → **orchestrator only** | The two halves serve different readers. Handing an implementer the worktree lifecycle invites it to manage the workspace it is running inside. |
| **R6** | `planning/**` (`brainstorming`) | architect, spec-writer | |
| **R7** | depth-1 singletons, by name, in **either** tree | `security-audit` + `code-roast` → reviewer. `documentation-standards` → whichever agent writes documentation **other than `docs`**, which already preloads it (a developer handed a README task, for instance). `mcp-standards` + `plugin-sdk-patterns` → developer, **only when the target repo is itself a plugin or MCP project**. `optimize` → developer, devops | The plugin/MCP gate matters: these are excellent for a plugin repo and pure noise for a web app. Four of these six are knowledge (`security-audit.md`, `mcp-standards.md`, `optimize.md`, and `enforcement.md` under R8); `code-roast` and `plugin-sdk-patterns` are still skills. The rule does not care which — it names a path either way. |
| **R8** | **orchestrator-only — never in any loadout**: `skills/context-detection`, `knowledge/enforcement.md`, `skills/feature-phases/*` | none | These describe the pipeline itself. Handing an implementing agent the phase files invites it to re-run the orchestration it is a step inside. `feature-phases/` holds no `SKILL.md` at all — by the directory rule it is a category, and its contents are neither skill nor knowledge for an implementer. |
| **R9** | **other plugins map by plugin, not by category** | see the table below | Every path is emitted **absolute**, under the plugin's installed root — see "Resolving another plugin's installed root". |

### R9 — the other plugins

Every row is gated on the plugin being **enabled** in the target repo
(`.claude/settings.json` → `enabledPlugins`) and, for language plugins, on `repo.stacks`.
A disabled plugin's paths do not resolve for the user, so naming one is a dead path.

| Plugin | Agents | Gate |
|---|---|---|
| `bunjs` | developer, test-architect, devops | `bunjs` ∈ `repo.stacks` |
| `go` | developer, architect, test-architect, reviewer — each via its own `knowledge/roles/<role>/` directory | `golang` ∈ `repo.stacks` |
| `dingo` | developer | `dingo` ∈ `repo.stacks` |
| `code-analysis` | debugger, reviewer, architect | always — read-only investigation helps every one of them |
| `terminal` | developer, test-architect, devops | its MCP server appears in `mcp.servers` |
| `browser-use` | frontend | its server appears in `mcp.servers` **and** `task.surfaces` includes `frontend` |
| `designer` | frontend | `task.kind == "ui_change"` |
| `multimodel`, `claudish` | **orchestrator only** | never in an implementing loadout |
| `madbench` | developer | the target repo is a bench harness |
| `setup`, `gtd`, `kanban`, `stats`, `autolinear`, `statusline` | none | workflow tooling, not implementation guidance |
| `seo`, `instantly`, `image-generate`, `video-editing` | none | a different domain; excluded unless `task.brief` names them |

The `go` row is the shape to copy for any future language plugin: it already partitions its
own knowledge by role at `<go root>/knowledge/roles/{architect,developer,tester,code-reviewer}/`,
so the mapping is role→agent and needs no per-file judgement here. `tester` maps to
`test-architect` and `code-reviewer` to `reviewer`.

### Resolving another plugin's installed root

A path into another plugin is emitted **absolute**, under that plugin's installed root.
`plugins/<p>/…` is the layout of *this* source repository: a customer machine has no
`plugins/` directory at all, so a path written that way is dead everywhere except here —
and 7.0.0 shipped fifteen of them in the detector's own examples. Every R9 row, and the
MCP `usage` table in the detector, resolves through this procedure and no other:

1. **Plugin id.** `enabledPlugins` names `<plugin>@<marketplace>` — `code-analysis@magus`
   is plugin `code-analysis`, marketplace `magus`. A plugin not enabled in the target repo
   is not resolved: its row does not apply.
2. **Registry.** Read `~/.claude/plugins/installed_plugins.json` →
   `plugins["<plugin>@<marketplace>"]`. It is an **array**, one entry per `projectPath`,
   each carrying `installPath` and `version`. Take, in this order:
   - the entry whose `projectPath` equals `cwd` — for a git worktree, the main working
     tree's path, because a worktree has no rows of its own;
   - else an entry with `scope: "user"`;
   - else the entry with the highest `version` (compared as a version, not as a string).
     This is what the loader itself does: `enabledPlugins` is per-project but the registry
     lookup is not, so a project that enabled a plugin without installing it still loads
     it from another project's entry.
3. **Root.** `installPath` is the root, shaped
   `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>` — the same tree the detector
   lists to find each plugin's `.mcp.json`. `stat` it. An `installPath` that is not on disk
   is a dead root; every path under it is dropped, with one `warnings` entry naming it.
4. **No entry at all** means the plugin has never been installed on this machine. It cannot
   load, whatever `enabledPlugins` says; its row contributes nothing and the MCP `usage`
   for its server is `null`.

```bash
# The installed root of another plugin. The ONLY way an R9 path is built.
#   plugin_root <plugin> <marketplace> <main-working-tree>
plugin_root() {
  jq -r --arg k "$1@$2" --arg cwd "$3" '
    .plugins[$k] // []
    | ( map(select(.projectPath == $cwd))
      + map(select(.scope == "user"))
      + (sort_by(.version | split(".") | map(tonumber? // 0)) | reverse) )
    | .[0].installPath // empty' ~/.claude/plugins/installed_plugins.json
}
# The MAIN working tree, not the worktree: a linked worktree has no registry rows of its own.
main_tree="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
root="$(plugin_root code-analysis magus "$main_tree")"
[ -n "$root" ] && [ -e "$root/skills/code-search/SKILL.md" ] || echo "DROP code-analysis usage"
```

**Never read `settings.installedPluginVersions`.** It is not a Claude Code field — the
binary neither reads nor writes it, one external tool maintains it, and it has been
observed naming a version four minor releases behind the one actually installed.
`installed_plugins.json` is the registry Claude Code writes and the cache listing is the
ground truth for what exists; use those two and nothing else.

Two things this rule is **not**. It is not "the highest version directory in the cache" —
several versions coexist there and the newest is not necessarily the one this project
resolved to. And it is not a walk of `~/.claude/plugins/marketplaces/<mkt>/plugins/<p>/` —
the loader reads from the cache, never the clone, and the clone is deleted outright by a
failed auto-update.

---

## Task gates

`task.kind` and `task.surfaces` add to a loadout. Read with R1-R9, not instead of them.

| `task.kind` | Adds | Suppresses |
|---|---|---|
| `new_subsystem` | an architecture **style** leaf for architect (mandatory); R2 extends to reviewer | — |
| `bug_fix` | `discipline/systematic-debugging` for debugger — **unless the debugger already preloads it, which it does**, so in practice this adds the stack's own debugging knowledge instead | **the architecture block entirely.** `architecture` is `null` for a bug fix; this is invariant X3 in the schema |
| `ui_change` | `frontend/design-system-guardrails` **mandatory**; the `designer` plugin for frontend | — |
| `refactor` | `architecture/references/refactoring.md` for architect and reviewer | — |
| `docs` | `documentation-standards` for the writing agent — **unless it is `docs`, which already preloads it, and it usually is**, so in practice this adds the repo's own documentation conventions (a discovered project skill, `CONTRIBUTING.md`) or the knowledge the document describes (`api-design.md` for an API reference) instead | most stack skills — a docs task does not need `error-handling` |
| `ops` | `backend/bunjs-production` and stack-specific ops knowledge for devops | — |
| `unknown` | nothing | nothing — loadouts fall back to repo-derived entries only, and `task.confidence` is `low` |

**Two rules that keep this honest:**

1. **Low confidence is reported, never smoothed over.** A confidently wrong intent is worse
   than no intent, because it silently suppresses the right loadout while looking decided.
2. **Intent may ADD to a loadout. It may never remove a mandatory entry.**
   `design-system-guardrails` is mandatory whenever `surfaces` includes `frontend`,
   regardless of `kind` — the project's frontend rules bind *every* frontend task including
   a one-line tweak. A misclassified intent must not be able to switch a guardrail off.

---

## The 13 agents, and the three that get nothing

`plugins/dev/agents/` holds exactly 13. Read the roster off disk; this table records the
judgement, not the inventory.

| Agent | Loadout | Rules | What its own frontmatter constrains |
|---|---|---|---|
| `architect` | yes | R1 R2 R6 | Preloads `dev:universal-patterns`, so R1's `universal-patterns` is already held — do not spend a slot on it. **Has no `Skill` tool**, so every entry must be a readable path, never a `plugin:skill` address. |
| `developer` | yes | R1 R3 R4 R7 R9 | The only agent holding the `Skill` tool; it still receives paths, because paths work for flagged skills and skill addresses do not. Preloads `dev:universal-patterns`. |
| `frontend` | yes | R1 R4 R9 | Inherits all tools. Preloads `design-system-guardrails` — still list it as `mandatory` when `surfaces` includes `frontend`, because the mandatory marker is what a downstream reviewer checks. |
| `test-architect` | yes | R1 R3 R5 R9 | Declares no `skills:` at all, so its whole loadout is dynamic. Must not receive implementation detail that would let it write tests against the implementation rather than the contract. |
| `reviewer` | yes | R1 R2 R3 R4 R7 | Declares no `skills:` today. |
| `debugger` | yes | R1 R3 R5 R9 | Preloads `dev:systematic-debugging` — do not repeat it. |
| `devops` | yes | R1 R3 R7 R9 | Preloads `dev:bunjs-production` — do not repeat it. |
| `docs` | yes | R7 | Inherits all tools. Preloads `dev:documentation-standards` — do not repeat it. What R7 leaves it is the repo's own documentation conventions and the knowledge behind the document being written. |
| `researcher` | minimal | R1 | Web-facing. Repo skills rarely help; one or zero entries is the normal outcome. |
| `spec-writer` | minimal | R6 | Already reads `context.json` directly. |
| `scribe` | **no** | — | A file writer. A loadout is pure overhead. |
| `synthesizer` | **no** | — | Consolidates other agents' output; preloads `universal-patterns` and needs nothing else. |
| `stack-detector` | **no** | — | It produces the loadouts. |

The last three are **enforced**, not merely advised:
`scripts/check-context-schema.ts` rejects any `agent_loadouts` key naming `scribe`,
`synthesizer` or `stack-detector`, and rejects any key that is not an agent on disk. They
are listed here so a future reader does not read the omission as an oversight.

Ten of thirteen get an entry — and only the ones **this task actually dispatches**. A loadout
for an agent that will not run is noise a consumer has to filter, and a consumer that has to
filter will eventually filter wrongly.

Which dispatch sites read which entry today: `architect` in `feature-phases/phase3-planning.md`,
`developer` and `frontend` in `phase4-implementation.md`, `reviewer` in `phase5-review.md`,
`test-architect` in `phase6-testing.md`, `debugger` in `commands/fix.md`. `devops`, `docs`,
`researcher` and `spec-writer` are built for the entry points that dispatch those agents; no
`/dev:dev` phase passes them yet.

---

## The cap is 5, and it is a push limit

`read` holds **1 to 5** paths, ordered, mandatory first. The validator rejects six.

The cap governs what is *pushed* at an agent, not what it may read. An agent that needs a
sixth file can always open it. A 20-path list is a list nobody reads — the reason to cap is
that an uncapped list degrades into the flat `bundled_skill_paths` this design replaced,
where every agent got the same eight paths and none of them was chosen for that agent.

If five slots cannot hold what one agent needs, the task is really several tasks. Say so in
`warnings` rather than quietly truncating.

---

## Editing this file

- **Add a rule only when a category exists that no rule covers.** Rules key on categories;
  new *skills* inside a covered category need no edit here at all.
- **Never add a stack→skill table.** That is the two-homed shape this file replaced. Stack
  gating is by name (above) and derives from the tree.
- **Never name a path that does not exist.** `bun scripts/check-plugin-paths.ts` gates every
  `plugins/<p>/…` and `${CLAUDE_PLUGIN_ROOT}/…` path in this file, in pre-commit and again
  at release.
- **Never describe a `plugins/<p>/…` path as something the detector should emit.** That
  form is this repository's layout and resolves on no install; the validator rejects it in
  a `context.json` (rule `PATH`). Another plugin's file is emitted absolute, under the root
  "Resolving another plugin's installed root" produces; `dev`'s own files as
  `${CLAUDE_PLUGIN_ROOT}/…`.
- **Changing which agents exist means editing the table above** — the roster is read off
  disk, but the judgement column is not derivable and will silently miss a new agent.
