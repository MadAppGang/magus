# Magus Roadmap

> Living roadmap for the magus plugin marketplace. Per-plugin entries with known in-flight work, plus cross-cutting initiatives and explicit unresolved decisions. Backed by source citations — items without citations are owner-populate placeholders. Updated as work lands. **Last refreshed: 2026-05-28.**
>
> Reading order:
> 1. **Status legend** — what the badges mean
> 2. **Cross-cutting initiatives** — work spanning multiple plugins (read first; per-plugin sections refer back)
> 3. **Per-plugin roadmap** — 18 published plugins + 3 source-only + 2 tools
> 4. **Decisions needed** — conflicts and gaps the maintainer must resolve
>
> For backward-looking history, see [`CHANGELOG.md`](./CHANGELOG.md) and [`RELEASES.md`](./RELEASES.md). For per-feature design docs, see `docs/plans/`. (Note: `ai-docs/sessions/` is git-ignored session scratch — durable artifacts live under `docs/plans/` or `ai-docs/` root, not under `sessions/`.)

---

## Status legend

| Badge | Meaning |
|---|---|
| 🟢 **Designed** | Plan doc exists and is approved; implementation not yet started |
| 🟡 **In-progress** | Work has started (commits, partial implementation, R&D harness) |
| 🔴 **Blocked** | Work is gated on an external factor (upstream fix, missing harness, undecided trade-off) |
| ⚪ **Surfaced** | Possibility raised but no decision made (could go either way; may be dropped) |
| ➖ **No signal** | Plugin has no in-flight work in any plan doc or recent session — owner to populate |
| 🚫 **Anti-roadmap** | Explicitly deferred, declined, or out-of-scope (named here so it doesn't accidentally creep back) |

---

## Cross-cutting initiatives

Work that spans multiple plugins or affects the marketplace as a whole. Per-plugin sections below reference these by number.

### CC-1 · Cross-harness distribution (Codex + Antigravity) 🟡

Generate per-harness distribution manifests from the magus source marketplace so plugins ship to Codex and Antigravity, not just Claude Code. Codex generator + validator are working (17 plugins generated, install validated, hook trust gate validated on CLI, Desktop app-server, and live Desktop UI). Antigravity is blocked on local CLI availability.

- **Scope:** all 18 published plugins, claudeup, distribution pipeline
- **Open work:** KI-CODEX-005 (Codex task-management translation; generator must fail if Codex artifacts need Claude-only task tools), KI-CODEX-008 (commit Desktop/app-server smoke as a harness command, not R&D)
- **Sources:** `docs/plans/2026-05-27-harness-mapping.md`, `docs/plans/2026-05-27-cross-harness-known-issues.md`, `docs/plans/2026-05-26-hook-tool-conversion-map.md`, `docs/plans/2026-05-28-codex-plugin-distribution-spec.md`

### CC-2 · Cowork guided install lane 🟢

Build a guided plugin install flow in claudeup TUI: list available plugins with versions from GitHub Release manifests, search/filter, download to deterministic cache, checksum verification, deep-link generation. Update flow with cached-version comparison + re-verify. 6-phase plan; implementation unverified from sources.

- **Scope:** all plugins (artifact packaging), claudeup TUI, website, GitHub Releases pipeline
- **Source:** `docs/plans/2026-05-26-cowork-guided-plugin-install.md`

### CC-3 · Skill description budget remediation (T3 consolidation) 🟢

Remediate Claude Code 2.1.105+'s skill listing budget. T1, T2, T4, T5 shipped (44% char reduction; 25 skills flagged `disable-model-invocation: true`; `scripts/skill-budget-check.ts` enforces on release). **T3 (architectural consolidation)** identifies 5 router consolidations across dev, multimodel, terminal, code-analysis — ~17 listing entries → 5. Estimated 1-week design effort.

- **Scope:** dev, multimodel, terminal, code-analysis
- **Source:** `scripts/skill-budget-check.ts` (enforces on release). Detailed T3 plan lives in session scratch from the 2026-05-06 skill-budget research/build sessions — needs promotion to `docs/plans/` before further tracking.

### CC-4 · best-practice-gates plugin 🟢

New runtime plugin: rule-library + reranker + background validators. Rule library is loose YAML files curated by claudeup. Per-rule cross-model validators run as `async: true` hooks, deliver verdicts via `additionalContext` system reminders into actor's next turn. Bun + TypeScript end-to-end (no shell shims). Per-session state in `.claude/best-practice-gates/session.{session_id}.json` (no cross-session shared state by design). 8 design constants resolved; ready for implementation.

- **Scope:** new plugin `plugins/best-practice-gates/`; depends on claudish + mnemex + multimodel
- **Acceptance gate:** madbench trajectory-replay of the two evidenced failures (R1 fork-vs-extend; R2 mock-coverage-as-validation) — control variant (no bpg) reproduces failure, treatment variant (bpg installed) catches and fixes. Per-rule madbench suites land in v1.1 alongside the starter rule pack.
- **Claudeup integration:** plugin install via existing claudeup plugin flow; new "Rules" tab for browsing/toggling rule packs; static curated rule-pack manifest shipped with claudeup (real registry deferred to v1.1).
- **Rule sources:** wraps select existing magus skills (e.g., `dev:verification-before-completion`, `dev:enforcement`) as validator prompts; receives software-architecture gates being authored in the user's cowork project as a downstream supplier (no schema/naming forced now).
- **Source:** `docs/plans/2026-05-28-best-practice-gates-design.md`

### CC-5 · Tasks system migration (TodoWrite → TaskCreate/Update/List/Get) 🟡

Migrate all plugins from legacy `TodoWrite` to the new `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` task system. Approved 2026-01-30; originally scoped at ~115 files across 12 plugins (dev: 29 files HIGH priority; multimodel: 7; seo: 13; etc.). Scope shrank by conductor's 11 files when it was retired at magus v8.0.0. Completion status not verified by mining.

- **Conflict with CC-1** — see "Decisions needed" below.
- **Source:** `docs/plans/2026-01-30-tasks-migration-design.md`

### CC-6 · Multi-target distribution (magus / magus-alpha / magus-marketing) 🟡

Per-plugin `distTargets` field in marketplace.json routes plugins to distribution channels. magus-alpha live (autolinear shipped via it). magus-marketing target slot exists (v0.1.0) with zero plugins assigned.

- **Scope:** all plugins via opt-in distTargets
- **Sources:** `.claude-plugin/marketplace.json` `targetMetadata` block; CLAUDE.md "Alpha Marketplace" section

### CC-7 · Dependency-graph correctness (claudish + mnemex extraction) ✅ shipped 2026-05-09

Code-analysis, dev, multimodel, designer, seo now declare `claudish` / `mnemex` as `dependencies` per Anthropic's documented pattern (Claude Code v2.1.110+). Listed here for context, not for further work.

### CC-8 · Marketplace.json schema evolution + Claude `--strict` drift ⚪

Source marketplace.json uses Magus-only fields (`targetMetadata`, `distTargets`) that fail Claude `--strict` validation. Generated per-target distribution manifests strip them. No schema unification planned in sources; could be revisited.

- **Source:** `docs/plans/2026-05-27-cross-harness-known-issues.md` KI-CLAUDE-002

### CC-9 · Documentation drift (CLAUDE.md / AGENTS.md) ✅ DONE

First addressed at magus v8.0.0, then **regressed and fixed properly on 2026-08-08**.

The v8.0.0 pass restructured both files around the three distribution channels and
hand-corrected the versions. Because nothing gated them, they drifted again: 39 wrong
version numbers, three plugins that never existed (`Agent Development` in both files at two
different versions, `Nanobanana` in AGENTS.md), and `bunjs` missing from AGENTS.md entirely.

<!-- doc-refs: off -->
The v8.0.0 pass also fixed AGENTS.md's four broken skill references
(`code-analysis:claudemem-search` → `mnemex-search`, `claudemem-orchestration` →
`mnemex-orchestration`, the nonexistent `architect-detective` → `investigate`, and
`code-analysis:claudish-usage` → `multimodel:`), its `.Codex-plugin/` find-replace
artifacts, and its unrunnable `--model Codex-sonnet-4-6` examples.
<!-- doc-refs: on -->

The 2026-08-08 fix removed the version columns outright rather than regenerating them:
`marketplace.json` is the authority and `validate-versions.js` already gates it, so a second
copy could only ever be wrong. `scripts/check-doc-plugin-lists.ts` now enforces the plugin
names and rejects a version column growing back, and `scripts/check-doc-references.ts`
validates every plugin/agent/skill/command reference across the repo. Retired-plugin
mentions in `RELEASES.md`/`CHANGELOG.md` are left as historical record.

**Standing risk:** this drifts every release because nothing regenerates it. The plugin
tables are hand-maintained against `marketplace.json`. A `scripts/` check that diffs the
doc tables against the manifest would make it self-policing.

### CC-10 · Marketplace deletion bug — discovery still breaks 🔴

Plugin discovery in `/doctor` still breaks during Claude Code's `cacheMarketplaceFromGit()` delete-then-clone race. Hooks survive it, because the loader reads content from the immutable cache. Discovery needs an upstream Claude Code fix; not tracked.

**No workaround was ever shipped.** This item used to claim one ("git-subdir sources"). Magus uses plain string sources — all 20 of them — and `publish-dist.sh:306` converts `git-subdir` entries *away* on publish. Cache-reading is the loader's normal behaviour for every source type except `directory` marketplaces, so nothing was done to earn it. Corrected 2026-08-06.

- **Source:** CLAUDE.md "Marketplace directory deletion bug" section

---

## Per-plugin roadmap

Listed in `.claude-plugin/marketplace.json` order. Each section: in-flight items and
surfaced/undecided items.

**No version numbers here.** They belong in `.claude-plugin/marketplace.json`, which is the
authority and is gated by `scripts/validate-versions.js`. These headings used to carry a
`(current: vX.Y.Z)` label; 11 of 17 had drifted, `dev` by two minor versions, and this file
is published to users. `scripts/check-doc-plugin-lists.ts` now rejects the label.

### code-analysis

- 🟡 **CC-1** · `PreToolUse:^Bash$` hook ("Block accidental `git add` of private files") needs Bun adapter and Codex generated-plugin trust gate before shipping for Codex
- ⚪ **CC-3** · `mnemex-*` skill cluster consolidation (2 entries → 1 router) deferred to T3
- ⚪ **CC-1** · Desktop UI plugin browse path still needs validation; Codex marketplace already includes 17 plugins

### claudish (runtime plugin, new in v7.5.0)

- 🟡 **CC-1** · Codex MCP smoke harness: end-to-end claudish session polling + Codex-native MCP progress/elicitation/reporting must be recorded before claiming Codex parity (research complete, smoke not committed)
- ⚪ Backward-compat shim: `--channels plugin:code-analysis@magus` kept as alias for new canonical `--channels plugin:claudish@magus`. Long-term shim removal unscheduled.
- ⚪ Marketplace registration for non-magus consumers (Codex manifests have no `dependencies` field; `claudish@magus-codex` install must be driven explicitly)

### mnemex (runtime plugin, new in v7.5.0)

- 🟡 **CC-1** · System-wide `mnemex` executable must be installed/repaired by claudeup before installing/validating `mnemex@magus-codex` (KI-CODEX-009)

### multimodel

- 🟡 **CC-1** · `PreToolUse:Task` / `PreToolUse:Bash` hooks need Codex redesign — Codex has no `Task` hookable tool; switch to `SubagentStart` / `SubagentStop`
- ✅ `agent-enforcement`'s unrecognized `triggers:` frontmatter removed 2026-08-08, along with 8 other unread keys (`version`, `updated`, `plugin`, `keywords`, `tags`, `namespace`, `globs`, `skills`) across 56 skill files. Only keys the matcher actually reads remain
<!-- doc-refs: off -->
- ⚪ **CC-3** · Skill router consolidations deferred to T3 (names below are proposed, not yet created): `multimodel:orchestration` (delegate-patterns + hierarchical-coordinator + multi-agent-coordination + task-orchestration → 1); `multimodel:claudish` (3 → 1)
<!-- doc-refs: on -->

### seo

- 🟡 **CC-1** · `SessionStart` hook needs Antigravity first-run `PreInvocation` shim before shipping

### video-editing

- ➖ No in-flight signal found in plan docs or sessions — owner to populate

### image-generate

- ➖ No in-flight signal found in plan docs or sessions — owner to populate

### conductor — RETIRED

- ⚫ Removed at magus v8.0.0: outdated and unused. Marketplace entry and `plugins/conductor/`
  deleted; the `conductor-missing-for-multi-session-feature` coaching rule was dropped with it.
  Source recoverable from git history.

### dev

- 🟡 **CC-1** · `SessionStart`, `PreToolUse`, `Stop`, `TaskUpdate` hooks need cross-harness redesign (Codex has no TaskCreate/TaskUpdate hook parity)
- 🟡 **CC-1** · Transcript-based coaching hook: transcript field availability needs fixture validation for Codex + Antigravity before shipping
- 🟢 **CC-5** · TodoWrite → Tasks migration: **HIGH priority, 29 files** (12 commands + 14 agents + 3 discipline skills) — see Decisions Needed for the CC-1 conflict
<!-- doc-refs: off -->
- 🟢 E2E test suite for the feature-development loop — two-layer architecture (deterministic unit + claudish 6-model integration, 30 cases). Approved 2026-02-28 against the then-current `/dev:loop`, which v3.0.0 folded into `/dev:dev`; the plan needs retargeting before implementation. Status unverified
<!-- doc-refs: on -->
- 🟡 Phase instruction file loading enforcement in `/dev:dev` Full depth (commit `e030c2e`) — active development
<!-- doc-refs: off -->
- ⚪ **CC-3** · `dev:discipline` skill router consolidation (8 → 1) deferred to T3 — proposed name, not yet created
<!-- doc-refs: on -->

### bunjs

- 🔴 **Highest priority** · The six data widgets accept no layout props while `Panel` does. `Meter`, `Sparkline`, `HeatRow` and `StackedBar` take a numeric `width` and expose no `flexShrink` / `minWidth`; `Panel` got a `PanelLayout` forwarding pass and they did not. A row one column over budget inside the `flexDirection="row"` composition the aesthetics reference prescribes makes Yoga squeeze the FIRST child, rendering a badge as a single 1-column cell of coloured background. **That is invisible in `captureCharFrame()`** — a 1-column bg stub reads as a space — so every automated test the skill ships still passes; only a raw-ANSI dump reveals it. Fix shape: forward `flexShrink={0}` / `minWidth` on the data widgets exactly as `Panel` does, so an over-budget row fails loudly (overflow) instead of silently mangling its first child.
- 🔴 `scripts/check-surface.ts:118` warns on every ordinary app project: it prints `WARNING 0 fenced blocks found — extraction may be broken` over a normal `bun init` tree, whose `README.md`/`CLAUDE.md` carry no ts fences. SKILL.md lists the script under Acceptance for app projects, so the noise lands exactly where it is recommended. Fix shape: a `--docs` mode scoping the "scanned nothing" alarm to markdown expected to hold snippets, keeping exit-2 for the skill's own tree where it is the correct guard.
- 🔴 Vertically adjacent same-coloured badges merge: 24 green `UP` chips padded to a fixed label width fused into one solid green rectangle down the column. Per-cell output is correct, the visual is wrong. Fix shape: one line in `aesthetics-and-color.md` — pad with a plain filler span outside the chip so the background does not run between rows.
- ⚪ Right-aligning a group in a one-row header/footer is undocumented. The aesthetics reference prefers `gap` over spacer boxes but never says what pushes a group to the last column; the answer is `justifyContent="space-between"` over two row groups, which both fresh-consumer builds worked out independently.
- ⚪ `HeatRow`'s global-max mandate makes low-volume rows near-black. `widgets.tsx` mandates ONE max across all rows, so a 5xx row at ~10% of 2xx renders almost black — correct per the cross-row-comparability contract, but it reads as a dead panel. Options: an opt-in per-row max, or document the trade-off and suggest splitting scales when magnitudes differ by an order of magnitude.
- 🔴 CI job `test-bunjs-skill` written but not committed (~12 lines in `.github/workflows/test-plugins.yml`: `working-directory: plugins/bunjs/skills/opentui-tui`, then install / test / typecheck / check-surface). Withheld because the render tests drive the real native Zig renderer — green on macOS arm64, UNVERIFIED on `ubuntu-latest` — and committing it blind risks turning repo CI red. Add it when someone can watch one run.
- **Provenance:** all six found and confirmed during the v0.1.0 build (two fresh-consumer builds, three code reviews, one execution verifier) and consciously deferred; none blocks release. Whether `dev`'s four `bunjs*` skills migrate here is a separate open question — see **D-6**.

### statusline

- ➖ No in-flight signal found beyond shipped bugfixes (reset countdowns, diff chip split, memory display) — owner to populate

### browser-use

- 🟡 **CC-1** · Python/pip `browser-use` upstream runtime treated as external dep; validate install/doctor output

### designer

- ➖ No in-flight signal found beyond skill-budget T1.1 (already shipped) — owner to populate

### terminal

- 🟡 **CC-1** · `PreToolUse:^Bash$` destructive-tmux-kill-server hook needs Bun adapter and Codex generated-plugin trust gate
- ⚪ **CC-3** · `terminal:run` skill router consolidation (5 → 1) deferred to T3

### gtd

- 🟡 **CC-1** · GTD task workflow has no Codex parity — `TaskCreate`/`TaskUpdate` hooks must be redesigned; generator must fail if Codex artifacts require Claude-only task tools. Codex smoke for task-heavy workflow required.

### kanban

- ⚪ Legacy `.claude/gtd/tasks.json` migration helper — currently NOT auto-migrated by design (users re-add via `/kanban:add`). Auto-migration helper undecided.

### instantly

- 🟡 **CC-1** · `SessionStart` hook needs Antigravity first-run `PreInvocation` shim before shipping

### autolinear (magus-alpha)

- 🟡 Autonomous webhook-triggered pickup — receiver wired but queue → Claude Code dispatch is a TODO stub
- 🟡 **CC-1** · `SessionStart` hook (Linear/webhook readiness) + `PreToolUse:Task` (Linear state before delegation) need Codex redesign
- 🟡 Deferred from 2026-04-15 rename: landing-page marketing (D). The claudeup-core test fixture
  item (B) is moot — `tools/claudeup-core/` was deleted when claudeup collapsed to a single package.

---

### Source-only plugins (not in magus marketplace)

#### stats (source-only, current: v0.1.0)

- 🟡 **CC-1** · All-tool capture hook (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`) has Codex partial coverage
- 🔴 `stats/skills/stats-reading/SKILL.md` has no parseable description — open follow-up
- ⚪ Marketplace publication path undecided

#### dingo (source-only, current: v1.0.0)

- ➖ No in-flight signal; marketplace publication path undecided

#### go (source-only, current: unknown — no plugin.json)

- 🔴 Plugin scaffolding status unclear (only `knowledge/` subdir; no `plugin.json` or `.claude-plugin/`)

---

### Tools

#### claudeup (current: v4.17.0+, npm package)

- 🟢 **CC-2** · Cowork TUI screen (Phase 4) — plugin list from GitHub Release manifests, search/filter, deterministic cache, checksum verification, deep-link generation
- 🟢 **CC-2** · Cowork install update flow (Phase 5) — cached version comparison, redownload + re-verify, guided update prompt
- 🟡 **CC-1** · Mnemex repair before `mnemex@magus-codex` install (per KI-CODEX-009)
- 🟢 Raise the `@opentui/core` pin. `tools/claudeup` pins `^0.1.75` (published 2026-01-25) and **0.1.107 is verified compile-safe**: `bun build --compile`, no `--external`, binary launches, exit 0, 66,534,800 B — 32 patch versions of headroom inside the safe line. 0.4.x still breaks the compiled binary at launch (`resolveFallbackFilePath` → `normalizeLoadedFilePath`, native lib resolution inside `/$bunfs/root/`), so the 0.1.x ceiling stands, but the pin does not have to stay at 0.1.75. Surfaced by the bunjs v0.1.0 build.
- ⚪ **CC-2** · Optional helper command surface (`claudeup cowork list/install/update` non-interactive)
- ⚪ Trust action for Codex Desktop hooks — security trade-off: "may guide users to the Hooks screen or offer an explicit 'trust these installed hooks' action only if the user asks for it"

#### claude-desktop-profiles (separate tool, current: v1.2.2)

- 🟢 **Path 2** · Developer-ID broker daemon for cryptographic keychain isolation (~500-800 LOC, 1-2 weeks). Iteration-3 research determined ad-hoc partition lists do NOT enforce isolation; v1.2.0 shipped Path 1 (snapshot/restore). Path 2 user decision required before starting.

---

## Candidate plugins

Categories raised as worth covering, none of them designed or committed. Moved here from
README.md, which describes what ships today rather than what might. ⚪ **Surfaced** — each
could go either way, and none has an owner or a plan doc.

| Category | Shape |
|---|---|
| Testing tools | E2E testing, visual regression, performance testing |
| UI components | Design system tooling, component generators |
| Backend development | Node.js, API design, database tooling |
| DevOps | Docker, Kubernetes, CI/CD automation |
| Documentation | Generated docs, API reference, guides |

Community suggestions arrive as GitHub issues labelled `plugin-request`. A category earns a
row in "Per-plugin roadmap" only once it has a plan doc, per the maintenance protocol below.

---

## Decisions needed

Items where the maintainer must choose before downstream work can proceed. Not just "TBD" — these are real conflicts or blocking choices.

### D-1 · Tasks migration vs Codex distribution conflict

**CC-5** (TodoWrite → Tasks migration, approved 2026-01-30) targets the `dev` and `gtd` plugins. **CC-1** (cross-harness distribution) explicitly says Codex has no `TaskCreate` / `TaskUpdate` hookable tools, and the Codex generator must fail if artifacts require them (`docs/plans/2026-05-27-cross-harness-known-issues.md` KI-CODEX-005). The two plans are both approved; the reconciliation path is not stated in any source.

**The decision:** does dev/gtd ship the Tasks-migration changes as Claude-only features (with Codex distribution permanently lagging), or does the migration get rolled back / refactored to use a Codex-compatible mechanism?

### D-2 · Four plugins with no in-flight roadmap

`video-editing`, `image-generate`, `statusline`, `designer` have shipped bugfixes recently but have no forward-looking roadmap items in any plan doc or session. Either they're in steady-state (correct → mark "maintained, no active roadmap") or they have unwritten direction (owner must populate). `conductor` was the fifth — resolved by retiring it at magus v8.0.0.

### D-3 · claude-desktop-profiles Path 2 commitment

Iteration-3 research from the 2026-05-09 electron-keychain-isolation session (still in session scratch — needs promotion to `docs/plans/` before further tracking) explicitly posed the cryptographic isolation question as a maintainer decision. Path 1 (snapshot/restore) shipped in v1.2.0; Path 2 (broker daemon) is 1-2 weeks of work and needs an explicit go/no-go.

### D-4 · Source-only plugin marketplace publication

`stats`, `dingo`, `go` live in `plugins/` but don't ship via the marketplace. Each needs a yes/no on publication path. `go` additionally lacks any plugin scaffolding.

### D-5 · CLAUDE.md inventory drift

Trivial but high-impact: documentation says "12 published plugins"; reality is 18. Combined with stale AGENTS.md references (retired plugins, old versions, old names). One-shot maintainer pass to fix.

### D-6 · Do `dev`'s four `bunjs*` skills migrate into the `bunjs` plugin?

`plugins/dev/skills/backend/` holds `bunjs` (839), `bunjs-architecture` (840), `bunjs-production` (988) and `bunjs-apidog` (855) — 3,522 lines, all server-side, all `disable-model-invocation: true`. The new plugin was deliberately named `bunjs` and described Bun-broad so they COULD move without a rename. They were not moved in v0.1.0: 3,522 lines of unrequested churn, and it would change `dev`'s surface.

**The decision:** move them or leave them. The status quo is the awkward option — a `bunjs` *plugin* holding only a TUI skill while `dev` holds four `bunjs*` skills. This is a product call for the repo owner, not an engineering task; nothing downstream is blocked on it.

---

## Anti-roadmap (explicitly NOT planned)

Named here so they don't accidentally creep back as roadmap items in future planning.

- 🚫 **Cowork silent plugin install for individual users** — admin/org deployment only; explicit "Product Boundary" non-goal
- 🚫 **Public Cowork deep link that opens `Customize > Plugins` directly / clicks upload / bypasses trust**
- 🚫 **Claude Code `--scope project` as a Cowork install mechanism**
- 🚫 **Codex project-scoped plugin enablement** — `codex plugin add` is user-scoped only; don't promise project scope in docs
- 🚫 **Claude-style realtime/dev-channel parity in Codex** — `realtime_conversation` disabled; claudish in Codex runs through MCP only
- 🚫 **Generic conversation normalization layer (cross-harness V1)** — explicit V1 non-goal
- 🚫 **claude-desktop-profiles iter-2 helper-rename recipe** — superseded by iter-3 finding
- 🚫 **Auto-migration of legacy GTD tasks into kanban v1.6.0** — explicit non-goal in v1.6.0
- 🚫 **Tightening `SKILL_BUDGET_FAIL_TOTAL` from 16000 → 12000** — deferred until T3 makes it achievable
- 🚫 **claudeup writing trusted hook hashes for normal users (Codex Desktop)** — security rule; automation may write trust only in isolated smoke tests

---

## Maintenance protocol

This file is the **single source of truth for direction**. Updated as work lands.

- **When shipping a plugin update:** if it completes a roadmap item, move the item to CHANGELOG.md and remove it from here.
- **When approving a new design plan in `docs/plans/`:** add the corresponding roadmap entry (🟢 Designed) with a link to the plan doc.
- **When work starts:** flip 🟢 → 🟡.
- **When blocked:** flip to 🔴 with a one-line reason.
- **When deciding to drop something:** move it to the Anti-roadmap section with the reason.

Per-plugin entries without citations are placeholder slots for the plugin owner to populate.

**Provenance:** initial inventory mined from 8 plan docs, CHANGELOG, RELEASES, marketplace.json, recent session reports, and 90 days of git log on 2026-05-28.
