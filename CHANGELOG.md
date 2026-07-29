# Changelog

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [Marketplace 8.1.0] - 2026-07-29

### Changed
- **Plugin descriptions now describe the plugin, not the last release.** `description` was
  the only free-text field claudeup renders, so every release overwrote it with that
  release's notes — `multimodel` read "Declared claudish as a dependency" where its purpose
  belonged. All 19 descriptions rewritten in `marketplace.json` and each `plugin.json`.
  No plugin versions bumped: nothing functional changed, and claudeup reads the description
  straight from the manifest.

### Added
- **A `releases` array on every plugin entry** — the last 5 releases, each with version,
  date, change categories and a one-line summary. Generated from CHANGELOG.md by
  `scripts/generate-releases.ts`; never hand-edited. The generator resolves a release
  through a heading that names a plugin *or* a bullet inside a channel-wide entry that
  names one, so a multi-plugin release stays written up once.
- Backfilled CHANGELOG entries for 11 versions whose only record was the description field.
  `gtd` v2.0.1 is the one version still without an entry — the generator warns rather than
  inventing one.

### Fixed
- `validate-versions.js` (already in the pre-commit hook) now rejects descriptions shaped
  like release notes and enforces description parity between `marketplace.json` and
  `plugin.json`, which are read by claudeup and Claude Code respectively.

---

## [multimodel 3.3.0] - 2026-07-29

### Changed
- **Model resolution is now live.** `/team`, `/delegate` and every dependent command resolve IDs through claudish's `list_models` / `search_models` MCP tools instead of a committed snapshot. `shared/model-aliases.json` is deleted along with its two synced copies.
- **A version the user names is a hard constraint.** If `kimi3` or `gpt-5.6` is not in the catalog, the command says so and shows live alternatives. It must never fall back to a lower version because the name is a closer string match.
- `task-external-models` inverted: `list_models`/`search_models` are marked **authoritative**; they were previously demoted to "supplemental — prefer `shared/model-aliases.json`".
- Backend selectors (`cx@gpt-5.6-sol`) are passed through verbatim when the user asks for one and the catalog reports it.
- `/update-models` **deleted**. The catalog self-refreshes, so there was nothing left to sync.

### Fixed
- Concrete model IDs purged from every context-injected doc (112 occurrences across 26 files) and replaced with self-describing placeholders (`LATEST_GPT_MODEL`, `LATEST_IMAGE_MODEL`). A literal ID in an example is copyable — the model pattern-matches it instead of resolving live.

### Why
`shared/model-aliases.json` was a committed snapshot refreshed from a `queryPluginDefaults` endpoint that had been seeded once and never updated. It stamped every response with a fresh `generatedAt`, so it looked healthy for four months while serving dead IDs. Nine of twenty-three referenced models were decommissioned, including the `grok` alias itself. Fuzzy matching then converted a miss into a confident wrong answer: `kimi3` resolved to `kimi-k2.5`.

---

## [code-analysis 5.3.1] - 2026-07-29

### Changed
- Pointers to the deleted `shared/model-aliases.json` replaced with live-catalog resolution, and concrete model IDs in illustrative examples replaced with placeholders. Behaviour is otherwise unchanged; a patch release so claudeup actually ships the updated guidance.

---

## [designer 0.4.1] - 2026-07-29

### Changed
- Pointers to the deleted `shared/model-aliases.json` replaced with live-catalog resolution, and concrete model IDs in illustrative examples replaced with placeholders. Behaviour is otherwise unchanged; a patch release so claudeup actually ships the updated guidance.

---

## [madbench 0.1.1] - 2026-07-29

### Changed
- Pointers to the deleted `shared/model-aliases.json` replaced with live-catalog resolution, and concrete model IDs in illustrative examples replaced with placeholders. Behaviour is otherwise unchanged; a patch release so claudeup actually ships the updated guidance.

---

## [Marketplace 8.1.0] - 2026-07-29

### Removed

- **BREAKING** — Removed the `agentdev` plugin (agent/plugin authoring workflow: design →
  implement → review). Its marketplace entry and `plugins/agentdev/` are deleted. `agentdev`
  depended on `claudish`; nothing depended on `agentdev`, so the removal is dependency-safe.
  Users who had it enabled should drop `agentdev@magus` from `enabledPlugins`. Recoverable
  from git history.

---

## [Marketplace 8.0.0] - 2026-07-27

### Changed

- **BREAKING** — Split the marketing plugins out of `magus` into a new `magus-marketing`
  marketplace. `seo`, `nanobanana`, `video-editing`, and `instantly` no longer ship on
  `magus`. Users who want them must add the new marketplace and re-enable the plugins under
  their new IDs (`seo@magus-marketing`, not `seo@magus`).
- `claudish` is now dual-published to `magus` and `magus-marketing`, because `seo` declares
  it as a runtime dependency and a marketing-only install would otherwise be unsatisfiable.

### Added

- `dingo` v1.0.0 published to `magus`, marked **beta**. It had a complete manifest and skill
  but no marketplace entry, so it previously shipped nowhere.
- Sanitised per-channel `CHANGELOG.md` / `RELEASES.md` in every dist repo, generated by
  `scripts/filter-changelog.ts`.

### Removed

- **BREAKING** — Retired the `conductor` plugin (Context-Driven Development): outdated and
  unused. Marketplace entry and `plugins/conductor/` deleted, along with the
  `conductor-missing-for-multi-session-feature` coaching rule in `dev`. Recoverable from git
  history.

### Migration notes

```jsonc
// .claude/settings.json — before
{ "enabledPlugins": { "seo@magus": true, "nanobanana@magus": true } }

// after: add the marketplace, then re-enable under the new IDs
//   /plugin marketplace add MadAppGang/magus-marketing
{ "enabledPlugins": { "seo@magus-marketing": true, "nanobanana@magus-marketing": true } }
```

`conductor@magus` has no replacement — remove it from `enabledPlugins`.

---

## [dev 2.12.1] - 2026-07-27

### Removed
- **Dropped the `conductor-missing-for-multi-session-feature` coaching rule.** The `conductor`
  plugin was retired in Marketplace 8.0.0, so the suggestion pointed at commands that no longer
  ship.

---

## [browser-use 1.4.0] - 2026-07-26

### Added
- **Two disjoint feature sets merged into one release**: in-page JS eval, keyboard, focus and
  environment-doctor tools, alongside cloud sessions and a configurable agent LLM. 26 MCP tools
  (16 built-in + 10 custom) across 6 skills.

---

## [terminal 4.1.2] - 2026-07-26

### Changed
- Track `tmux-mcp` v1.6.2.

---

## [browser-use 1.3.0] - 2026-07-12

### Added
- **Configurable agent-brain LLM.** Explicit model selection replaces the hardcoded rule
  (`BROWSER_USE_API_KEY` → bu-latest, else config OpenAI key → gpt-4o-mini, else unassigned).
  Providers: Anthropic, OpenAI, OpenAI-compatible (via `base_url`), and Browser Use.
- Precedence: the `browser_set_agent_model` override beats `.claude/settings.json`
  (local > project > user), which beats the legacy BU3 path.

---

## [dev 2.12.0] - 2026-07-26

### Added
- **`/dev:design-system` command** — validates a project against the five design-system guardrails (token-only styling, one component library, appearance inside the component, parents own layout, screens compose). Modes: default read-only validate, `--changed` (diff-scoped, warnings blocking — the phased rollout from `references/enforcement.md`), `--fix`, `--setup`, `--strict`. Reports findings **per rule**, not per regex, and runs the structural checks static analysis can't (components defined outside the library, styled raw HTML in app code, missing variants API, baked-in outer margins, unquarantined one-offs).
- Reachable from `/dev:audit` too, via a new `design-system` scope with keyword inference.
- **`scripts/audit-ui.test.ts`** — 33 tests covering both false-positive classes and the CI contract (exit 1 on errors, 0 on warnings-only).
- **Frontend Task Rules** section in `CLAUDE.md` — the five rules stated as binding for every frontend task, plus a verify-before-done gate.

### Changed
- **`scripts/audit_ui.py` → `scripts/audit-ui.ts`** (bun/TS, per repo convention; the Python original is removed). Now accepts multiple paths so callers can audit a changed-file list directly.

### Fixed
- **Tailwind variant selectors were reported as arbitrary-value errors.** `data-[state=checked]:`, `aria-[…]:`, `has-[…]:`, `group-data-[…]:`, `supports-[…]:` and `[&_svg]:` are *conditions*, not styling values, but matched the same `prefix-[…]` shape as `w-[347px]`. A canonical shadcn/ui component produced **6 errors**; since the script exits non-zero and `enforcement.md` recommends wiring it into CI, the recommended gate was permanently red on any correct shadcn codebase. Classes are now parsed semantically — bracket-aware split on unbracketed `:`, then only the final utility is checked — so `data-[state=open]:bg-[#ff0000]` still errors on `bg-[#ff0000]` and `not-[:first-child]:mt-2` stays clean.
- **CSS id selectors were reported as hardcoded colors.** `#abc`, `#beef`, `#face` are valid selectors; hex colors only ever appear in value position. Hex is now matched only to the right of the first `:` in CSS-like files.
- **Icon components were reported as call-site appearance overrides.** For lucide, heroicons, tabler, phosphor and friends, `className` *is* the documented colour/size API. Components imported from known icon packages are now exempt from the `appearance-override` check. On a real app this cut that check from 32 findings to 6 — all 6 verified true positives.

### Why
The skill landed with strong prose but a script that made its own CI recommendation unusable, and noise levels that would have trained users to ignore the audit — the same drift the guardrails exist to prevent. All three defects shared one root cause: matching on **shape** instead of **role**. Each false-positive pair (`data-[x]` vs `w-[4px]`, `#abc` as selector vs value, `className` on `<Card>` vs `<ChevronDown>`) is lexically identical and semantically opposite.

**Note on versioning:** 2.11.0 was published to the `magus` dist repo carrying the Python auditor, but was never committed or tagged in `magus-src`. That version number is therefore burned; this release goes out as 2.12.0 so anyone already on 2.11.0 receives the fix.

---

## [dev 2.11.0] - 2026-07-26

_Published to the `magus` dist repo but never committed or tagged in `magus-src`; superseded by 2.12.0, which replaces the bundled Python auditor. Recorded here for accuracy._

### Added
- **`frontend/design-system-guardrails` skill**: enforces single-source-of-truth UI — design tokens as the only styling values (Tailwind v4 strict `@theme` with wiped defaults, shadcn semantic-token conventions), one Storybook-backed component library (Foundations / Components / Recipes / Snowflakes hierarchy) as the only place components are defined, variants encoded inside components instead of call-site restyling (layout-only `className` exception: parents own margin/placement, components own appearance), plus a mandatory discover-before-create decision tree and a definition-of-done checklist agents run before finishing UI work. Bundles `scripts/audit_ui.py` — zero-dependency drift audit (hardcoded colors, Tailwind arbitrary values, inline styles, appearance overrides on component call sites, primitive palette classes, library components missing stories; non-zero exit for CI) — and drop-in ESLint (`eslint-plugin-better-tailwindcss`, `react/forbid-component-props`, `forbid-elements`, `no-restricted-imports`) + Stylelint (`declaration-strict-value`) config templates, with four reference docs (design tokens, Storybook structure, component patterns, enforcement/governance).

### Why
Every call-site restyle or hardcoded value silently creates a second source of truth that humans and agents later copy — the root cause of N divergent implementations of the same button. Web research (Storybook/Chromatic CDD guidance, Brad Frost's components/recipes/snowflakes governance, W3C DTCG 2025.10, shadcn styling rules, Figma & Storybook MCP agent-rules guidance) converges on a three-layer fix: short imperative rules + machine-discoverable component inventory + hard lint/CI enforcement, because prose-only rules cap out around ~70% agent compliance. This skill packages that stack so every frontend project starts with (or migrates to) one theme, one component library, and composition-only screens.

---

## [terminal 4.1.0] - 2026-06-04

### Added
- **Pane-occupancy safety guard** in the PreToolUse:Bash hook. Beyond the existing `tmux kill-server` block, the hook now blocks raw `tmux send-keys` / `kill-pane` / `split-window -t <pane>` when the target pane's foreground process is **not** a bare shell (e.g. a sibling `claude` session, a REPL, or an editor). Foreground is resolved via `tmux display-message -p '#{pane_current_command}'` (honors `-L`/`-S` sockets); shell allowlist (not REPL denylist) so unknown programs default to blocked; **fail-open** on any resolution failure so legitimate flows are never broken.
- Hook rewritten from `block-tmux-kill.sh` to **`block-tmux-kill.ts`** (bun/TS, per repo convention) with 50 unit tests (`block-tmux-kill.test.ts`) over the pure parser/decision logic plus live-tmux E2E verification.

### Changed
- **`terminal-interaction` skill**: new §1b "Occupancy Safety" (mandatory `pane-state.foregroundCmd` check before send/kill/split; one-line failure mode; safe/off-limits table) and §1c documenting the `split-pane` idle-shell reuse contract (`"reused": true`). Added `start-and-watch` baseline-after-send and repainting-prompt timing gotchas.
- **`workspace-setup` skill**: CRITICAL note + reworked Archetype C recipe for the new `split-pane` reuse behavior (fill-before-split to avoid recycling a just-created idle pane and collapsing a grid).
- **`framework-signals` skill**: marked `disable-model-invocation: true` — it is a reference table invoked by other skills, not a natural-language entry point; this removes it from the skill-listing budget (restoring the budget check to PASS) while keeping `/terminal:framework-signals` working.

### Why
Incident 2026-06-03: an agent drove raw `tmux` and sent keystrokes into a pane whose foreground was `claude`, injecting a prompt into a sibling agent and then killing its pane. `send-keys` feeds the pane's **foreground process**, not "the shell" — the skill documented pane *ownership* (the `claude-helper` label) but not pane *occupancy* (the foreground process). This release closes that gap on both the raw-`tmux` path (the hook) and in agent guidance (the skills); the MCP `split-pane` path is covered by the tmux-mcp server's own idle-shell reuse gate.

---

## [go 0.1.0] - 2026-06-03

### Added
- **First release.** Ships the `go-tui` skill for building colourful, graph-and-badge-heavy
  terminal UIs on the Charm stack (Bubble Tea, Lip Gloss, Bubbles, ntcharts), plus a verified
  colour-accurate screenshot workflow (tmux capture → aha → headless Chrome → PNG) so a running
  TUI can be seen and critiqued.

---

## [Marketplace 7.5.0] - 2026-05-09

### Added
- **`claudish` plugin** (v1.0.0): dedicated runtime plugin for the Claudish MCP server. Owns the `command: "claudish", args: ["--mcp"]` registration. Required by `code-analysis`, `dev`, `multimodel`, `designer`, `agentdev`, `seo`.
- **`mnemex` plugin** (v1.0.0): dedicated runtime plugin for the Mnemex MCP server. Owns the `command: "mnemex", args: ["--mcp"]` registration. Required by `code-analysis`, `dev`, `stats`.

### Changed
- **`code-analysis` v5.3.0**: extracted `mnemex` + `claudish` from its `.mcp.json`. Now declares both as `dependencies` per Anthropic's documented pattern.
- **`dev` v2.9.0**: extracted `claudish` from its `.mcp.json` (previously the only entry). Now declares `claudish` + `mnemex` as `dependencies` (mnemex was an implicit dependency before).
- **`multimodel` v3.2.0, `designer` v0.4.0, `agentdev` v1.7.0, `seo` v1.8.0**: declared `claudish` as a `dependencies` entry (was an implicit dependency consumed via `mcp__claudish__*` tools without declaration).
- **`stats`** (source-only): declared `mnemex` as a `dependencies` entry.

### Why
Before this change, `code-analysis` and `dev` each declared an identical `claudish` MCP server entry in their own `.mcp.json`. Claude Code's plugin loader deduplicates by endpoint (`command + args`) — only the first plugin's registration survived; the other was silently suppressed. This worked **by accident** as long as both declarations stayed byte-identical.

Extracting `claudish` and `mnemex` into dedicated runtime plugins:
- Removes the silent-suppression footgun (`dev`'s claudish was being suppressed).
- Makes the dependency relationship explicit in each consumer plugin's manifest.
- Follows Anthropic's documented `dependencies`-field pattern (Claude Code v2.1.110+, see <https://code.claude.com/docs/en/plugin-dependencies>). The official docs use `secrets-vault` as the motivating example — structurally identical to Magus's case.
- Makes channel notifications attach to a deterministic plugin (`plugin:claudish@magus` instead of "whichever plugin happened to win the dedup race").

### Migration notes
- Users on Claude Code v2.1.110+ get the new plugins auto-installed when they update any of the consumer plugins (or the marketplace). Older Claude Code versions: upgrade first.
- `--channels plugin:code-analysis@magus` still works for backward compat (the channel listener attaches to whichever plugin owns the surviving claudish registration), but `--channels plugin:claudish@magus` is now the canonical form.
- For users running their own MCP config that previously referenced `code-analysis`'s or `dev`'s `.mcp.json`: update to point at `plugins/claudish/.mcp.json` or `plugins/mnemex/.mcp.json` directly.

### Research
Decision documented in `magus-src` and `claudish` repos. Research session: `claudish` repo, `ai-docs/sessions/dev-research-shared-mcp-plugins-20260509-225330-aa2a2582/` — including primary-source verification of the `dependencies` field, empirical observation of claude-cli-nodejs cache directories showing the dedup-by-endpoint behavior, and survey of `anthropics/claude-plugins-official` confirming the "one plugin = one server" convention.

---

## [statusline 2.1.2] - 2026-04-24

### Changed
- **Split the diff section into two chips** — session (`✨ +A/-D`, from Claude Code's cost
  telemetry) and git (`● +A/-D`, from `git diff --shortstat`). A stale session total on a clean
  worktree previously read as uncommitted work.

---

## [kanban 1.6.0] - 2026-04-24

### Changed
- **BREAKING — kanban decouples from GTD.** Independent store at `.claude/kanban/tasks.json`
  with a kanban-only schema (a `status` field, no GTD overlay).

### Migration notes
Legacy tasks in `.claude/gtd/tasks.json` are **not** auto-migrated. Re-add them with
`/kanban:add`.

---

## [Statusline 2.1.1] - 2026-04-16

### Fixed
- **Reset countdowns missing when rate-limited** — Claude Code's native `rate_limits` input supplies `used_percentage` but omits `resets_at`, so the OAuth API fallback (which provides both) was skipped and the `↻` countdown disappeared once limits climbed. Guard now triggers the fallback when reset timestamps are missing, and cache-backfill only fills empty fields so fresh native percentages aren't clobbered by stale cache values.
- **Hide ⟳×1 compaction indicator** — first compaction is expected and not worth showing; indicator now only appears at ⟳×2+.

---

## [Multimodel 3.1.2] - 2026-04-06

### Fixed
- **"internal" sentinel leaked to claudish** — added CRITICAL instruction to filter "internal" from the model list before passing to claudish `team()`. Previously, "internal" was sent as a real model ID, causing "model unavailable" failures.

---

## [Multimodel 3.1.1] - 2026-04-04

### Fixed
- **delegate/team commands inherit parent tools and model** — removed hardcoded `allowed-tools` and `model: opus` from both commands. Previously, delegate couldn't load the `claudish-usage` skill for alias resolution, causing heuristic file searches instead of deterministic lookups.

---

## [gtd 2.0.0] - 2026-03-23

### Changed
- **Canonical GTD terminology** — "Clarify" and "Engage" replace the previous stage names.
- Sequential task IDs (`#1`, `#2`) in place of opaque identifiers, plus a boxed terminal
  display, a reference list, and a Bun display tool.

---

## [Dev 1.35.1] - 2026-03-02

### Changed
- **Coaching box formatting** - Workflow coaching suggestions now use visual insight-style boxes (`★ Coaching ───`) matching the explanatory output style, making them clearly distinct from conversation content
- Removed `WORKFLOW_COACHING=off` disable line from coaching output for cleaner presentation

---

## [Marketplace 4.3.0] - 2025-11-28

### Changed
- **Claudish moved to separate repository** - Claudish CLI is now maintained at https://github.com/MadAppGang/claudish
  - Install: `npm install -g claudish`
  - Removed `mcp/claudish` directory from this repository
  - Updated all documentation and skills to reference new location
  - Historical changelog entries preserved as-is for reference

---

## [Marketplace 4.2.0] - 2025-11-26

### Added
- **NEW Plugin: Agent Development (agentdev)** - Create Claude Code agents with multi-model validation
- 5 plugins now available in marketplace

---

## [Marketplace 4.1.2] - 2025-11-26

### Fixed
- **Path Cleanup Release** - Eliminated all hardcoded `/Users/jack` paths across entire codebase
- Documentation now uses relative paths for better portability and team collaboration

---

## [Code Analysis 1.3.3] - 2025-11-26

### Fixed
- **Path Cleanup** - Removed all hardcoded absolute paths from skill documentation

---

## [Code Analysis 1.3.2] - 2025-11-25

### Changed

#### Default Model Inheritance
- **Removed hardcoded model settings** from `codebase-detective`.
- Agent now respects user's model preference.
