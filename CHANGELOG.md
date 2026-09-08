# Changelog

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [dev 7.2.0] - 2026-09-08

### Added

- `/dev:dev` survives a cleared or compacted context. Claude Code's plan-approval dialog
  can offer **"Yes, clear context …"** (settings key `showClearContextOnPlanAccept`); it
  denies the `ExitPlanMode` call, clears the conversation and re-submits the plan text
  alone, so the `PostToolUse:ExitPlanMode` resume hint never fired and the fresh context
  implemented the plan as an ordinary request — Phases 4 to 8 and their gates gone. Three
  pieces close it: the plan-mode protocol ends the plan file with a `<dev-flow>` footer
  naming the run, its session, depth and automation; a `SessionStart` hook on
  `clear|compact` (`hooks/resume-after-clear.ts`) reads the run's state from disk, derives
  the next phase from the artifacts on disk, and orders `Skill(dev:dev, --resume <id>)`;
  and a `<resume_protocol>` in `dev.md`, before Step 0, restores depth and automation from
  `session-meta.json`, materialises an approved plan that never reached disk (Step 3.9 done
  late) and continues at the first phase whose artifacts are incomplete. The same path
  brings a run back after `/compact` and after auto-compaction.
- `/dev:dev --resume [session-id]` is a real invocation: the protocol hook answers it with a
  resume block instead of the plan-mode protocol, and the command never re-plans an
  approved design.
- `benches/dev-resume-after-clear/` (DRC-1) measures the handoff: the exact
  auto-continuation Claude Code submits after a clear, against a session directory seeded
  the way the clear leaves it. Sonnet 5, two runs × `--repeat 2`: the pinned pre-fix tree
  4/4 ad hoc, the new tree without the footer 4/4 ad hoc (the control), the new tree with
  it resumes and writes `architecture.md` before touching `src/`. The dialog itself is
  outside madbench's reach (a follow-up is sent only after a turn ends); it was verified by
  hand in an interactive session across one clear and one compaction.

### Changed

- Phase 0 records `depth` and `automation` in `session-meta.json`, and every "Phase N —
  complete" updates the checkpoint, so a resumed run restores its selections instead of
  asking again and reports where it stopped.
- The user guide (`userdocs/guides/dev-build.md`) documents the clean-context option and
  how to turn it on; this repository's `.claude/settings.json` turns it on.

### Why

- The mechanism, verified against the 2.1.263 binary and a live transcript, is written up
  in `ai-docs/claude-code-clear-context-plan-approval.md`: `SessionStart` with source
  `clear` is the one event that runs inside the clear, before the plan arrives, and the
  plan text is the only user-visible thing that crosses. Hence a hook for the state and a
  footer for the plan — belt and braces, because plan mode adopted before Phase 0 has no
  session directory for the hook to read.
- Re-invoking the command through the Skill tool, rather than "continuing" in place, is
  deliberate: it re-expands the 46 KB of orchestrator rules that a clear or a compaction
  destroys. The hook carries state, never rules.
- The `compact|resume` hook that `/dev:status` added in 7.1.0 and this `clear|compact`
  hook both fire on a compaction and do not overlap: one carries what the session decided
  and verified, the other which `/dev:dev` phase to continue at, and each is silent when it
  has nothing to say.

---

## [setup 1.2.1] - 2026-09-08

### Fixed

- **`/setup:statusline-install` closed by naming a command that has never existed.** Its
  final hint read `/statusline:customize-statusline`, a transposition of two different
  command names. It now names `/setup:statusline-customize`. This was wrong under both the
  old and the new plugin, and with `statusline@magus` removed at Marketplace 11.0.0 it no
  longer resolves to anything at all.
- Two stale `/statusline:install` references inside this plugin — a comment in
  `scripts/statusline.sh` and a line in the `statusline-customization` skill — now name
  `/setup:statusline-install`.

---

## [Marketplace 11.0.0] - 2026-09-08

### Removed

- **`statusline@magus` is deleted.** The statusline ships from `setup@magus` and only from
  there: `/setup:statusline-install`, `/setup:statusline-uninstall`,
  `/setup:statusline-customize`. The `/statusline:*` command names no longer resolve, and
  `"statusline@magus": true` in an `enabledPlugins` block is now an entry pointing at
  nothing. The magus channel ships 15 plugins.

### Changed

- Two plugins ship alongside this removal and are required by it, not optional:
  **`setup` 1.2.1** carries the command-name corrections, and **claudeup 6.3.1** repoints
  every predefined profile. Each has its own entry below.

### Why

- The shim was introduced to hold the old command names for one release and was then carried
  for twelve. A redirect that outlives its window stops being a migration aid and becomes a
  second answer to "where does the statusline come from", which is the drift the move was
  meant to end. Deleting it leaves one answer.
- The profile bug is why this could not simply be deleted on its own. It predates the
  removal and was shipping to every new claudeup user: the profiles installed a redirect and
  never installed the plugin the redirect points at.

---

## [dev 7.1.0] - 2026-09-08

### Added

- `/dev:status` reconstructs where a session stands from evidence rather than memory: the
  opening prompt, every AskUserQuestion decision with its rejected options, plan approvals
  and edits, compaction points, each test/typecheck/build/commit/push that ran and whether it
  passed, tool friction, commit-body `Decisions:/Remaining:/Tried:` trailers, the session's
  task list, git state, and the pull request via `gh` (number taken from the transcript's own
  `pr-link` record). The report separates done-and-verified (a pointer per claim) from
  done-not-verified and not-done-with-a-reason, hoists blockers, and ends with a six-check
  worktree gate — clean tree, pushed, PR merged, commits on the default branch, squash-merge
  detection, no other live session — whose SAFE verdict offers removal through
  `ExitWorktree` with no `discard_changes`, so nothing can be lost by construction.
  `--handoff "<goal>"` appends a paste-ready resume prompt.
- A `SessionStart` hook on `compact|resume` re-injects the same facts (decisions,
  verification, blockers, git and PR truth, plus the head of the last `/dev:status` report)
  into the fresh context, capped at 4,000 characters and silent when there is nothing to
  report. Facts only, no `git fetch`, `gh` capped at 2 s, inside the 5 s hook budget.

### Why

- Compaction keeps "accomplished / in progress / files / next steps / constraints" and has
  no slot for decisions, verified-vs-unverified, blocked-on or plan changes, so those are
  exactly what a long session loses, and it happens without the user asking. The transcript
  on disk is not compacted — Claude Code appends an `isCompactSummary` record and keeps every
  earlier line — so the facts are recoverable, and `SessionStart(compact)` is the one event
  that runs right after with its output injected. No `PreCompact` hook for that reason: a
  snapshot before compaction would duplicate what the file already holds.
- The popular alternatives cover one half each: handoff skills (REMvisual, agentops, Amp's
  `/handoff`) capture narrative without git or PR truth; worktree-cleanup skills
  (superpowers `finishing-a-development-branch`) read git without the session. gstack's
  `Decisions/Remaining/Tried` trailers exist only in its continuous-checkpoint mode; the
  collector reads them when present so those sessions get them for free.
- Measured, not asserted: `benches/dev-status` (DST-1) starts every session with
  `claude --worktree` so the command runs in a real Claude-managed worktree, and grades one
  holistic metric. Run 2 on Sonnet 5, `--repeat 3`: 9/9 sessions ran the collector, stated
  the verdict the seeded state implied (`SAFE` for a fresh worktree, `NOT_SAFE` for an
  untracked file and for an unpushed commit), kept all eight report headings, and removed
  nothing. Run 1 found and fixed two defects first: an empty worktree scored `UNKNOWN`
  when `gh` was unavailable, and the plugin's own `.claude/.coaching/` state counted as a
  dirty tree in a repository that does not gitignore it. The unit tests cover the
  transcript-derived half over record shapes measured on Claude Code 2.1.263.

---

## [terminal 5.0.1] - 2026-09-08

### Fixed

- The `PreToolUse:Bash` hook no longer dies when the project's `.env` is a symlink to a
  FIFO. Bun auto-loads `.env` from the cwd, follows the link, fails the read and exits 1
  with nothing on stderr, which Claude Code reported as
  `Failed with non-blocking status code: No stderr output` on every Bash call and left
  the tmux guard silently off. The hook command now passes `--env-file=/dev/null`; a hook
  never needs the project's env. `scripts/check-hook-commands.test.ts` gates every
  bun-launched hook on that flag.

---

## [dev 7.0.1] - 2026-09-08

### Fixed

- Every bun launch in the plugin's hooks no longer exits 1 silently when the project's
  `.env` is a symlink to a FIFO: the `Stop` phase-completion gate, the `UserPromptSubmit`
  plan-mode protocol, the `PostToolUse:ExitPlanMode` resume, and the two launches inside
  the `Stop` coaching wrapper (analyzer and learning daemon), which the wrapper's
  `|| true` had been hiding. Same cause and same fix as `terminal 5.0.1`:
  `--env-file=/dev/null` on every launch. The gate also reads shell wrappers, and CI's
  `release-gates` job and `bun run check:all` run it.

---

## [multimodel 4.0.3] - 2026-09-08

### Fixed

- `enforce-team-rules.sh` printed `line 39: 3: Bad file descriptor` to stderr on every
  Bash and Agent call. It tried to write its decision to fd 3 first, which Claude Code
  never opens, and the `2>/dev/null` came too late to hide the failed redirect. The hook
  now writes the decision to stdout only; the outcome was already `allow` on stdout, so
  behaviour is unchanged and the noise is gone.

---

## [setup 1.2.0] - 2026-09-07

### Changed

- **Statusline resolves appearance in one order: config → `STATUSLINE_APPEARANCE` →
  `TERM_THEME` → `COLORFGBG` → dark.** `resolve_appearance` in `scripts/statusline.sh` is
  a flat six-step list: the config `appearance` value, then the two environment variables,
  then no probe (the statusline has no tty), then `COLORFGBG` — read from the tmux session
  environment when inside `$TMUX`, else from the process environment, parsed as
  `fg;bg` with the last field as the background and at least one `;` required — then
  dark. Only the exact lowercase words `light` and `dark` count at any step. Removed the
  `~/.config/tmux/theme` pin and the macOS `AppleInterfaceStyle` step; the cache file is
  now `~/.claude/.statusline-tmux-colorfgbg` (30 s, user-wide, so two sessions with
  different themes can mask each other for up to 30 s). The `resolve_appearance` block is
  unit-tested in isolation by `scripts/test-statusline.ts`, whose fixture sweep no longer
  inherits the developer's environment (a claudish-routed shell's `CLAUDISH_*` variables
  used to fail the plan-section fixtures); the `statusline-customization` skill's
  Appearance section documents the six steps.
- **`tools/tmux-setup`: tmux answers panes' OSC 10/11 consistently with `TERM_THEME`**
  and exports it; new `scripts/term-theme.sh` hook. `tmux.conf` sets `window-style` to the
  Catppuccin Latte pair (`fg=#4c4f69,bg=#eff1f5`) or Mocha pair (`fg=#cdd6f4,bg=#1e1e2e`)
  from `TERM_THEME` at config load and publishes the value with `set-environment -g`;
  `update-environment[50] TERM_THEME` and `[51] COLORFGBG` forward both from the
  attaching client, and a `client-attached[50]` hook runs `term-theme.sh` to re-apply,
  reset (client without the variable) or leave the server untouched (session never had
  it). The hook passes `'#{session_id}'` single-quoted: unquoted, tmux expands it to `$0`,
  which `run-shell`'s `sh -c` reads as the shell's own name, so the script silently
  targeted a session called `sh`. Indexed options keep a `prefix + r` re-source
  idempotent. `install.sh` copies the script; `scripts/verify-term-theme.ts` prints
  `osc10= osc11= luminance= verdict=` from inside a pane. tmux-setup carries no version;
  it ships from this entry.

### Why

Measured on tmux 3.7c: with the default `window-style` a pane's OSC 10/11 query gets no
reply at all (0 bytes), so nothing inside tmux could learn the terminal's colours. Setting
only a background is not enough: OpenTUI needs both OSC 10 (foreground) and OSC 11
(background) answered to pick a palette, so both `fg` and `bg` are set in the pair. With
the pair set, a pane reads `luminance=0.879 verdict=light` or `luminance=0.014
verdict=dark`, and the exported `TERM_THEME` lets claudeup 6.3.0 and the statusline skip
the probe entirely.

### Migration notes

- If the statusline turned dark on a light terminal, set `appearance: light` in the
  statusline config, or `export TERM_THEME=light` in your shell. Only the exact words
  `light` and `dark` count.
- `~/.config/tmux/theme` is no longer read; delete it. The macOS appearance is no longer
  consulted either.
- `~/.claude/.statusline-appearance` is unused now (the cache moved to
  `~/.claude/.statusline-tmux-colorfgbg`) and can be removed.

---

## [terminal 5.0.0] - 2026-09-07

### Changed

- Every tool is addressed by `slot` and nothing else. tmux-mcp v2.0.0 serves one 13-tool surface; no request carries a pane, window or session id and no response returns one. The pin is `github.com/MadAppGang/tmux-mcp/v2@v2.0.0` and `.mcp.json` no longer passes `-scope` (the flag is gone from the binary).
- `split-pane` is now `open-pane` (no `direction`, no `size`; `{slot, isolated}` → `{slot, created, isolated}`), and `display-message` is now `notify`.
- Isolated work is a slot too: `isolated: true` on the call that first opens slot N replaces `create-headless` + `headless:%N`. It needs an explicit slot on every tool except the ephemeral `execute-command`, and a slot's kind is fixed until it is closed.
- `created` is always present on the six creating tools and never on the four reading tools; `exited` and `timedOut` are always present. Reading tools error on a slot that was never opened instead of creating one.
- The MCP server key is `mux`, so tools read `mcp__plugin_terminal_mux__*`; every `allowed-tools` and the agent's `tools` use that spelling, which is also the first time they match the runtime's names.
- `/terminal:session` is now `/terminal:slots` (`list`, `close N`, `close all`); `/terminal:send`, `/terminal:observe` and `/terminal:snapshot` take a slot number (default 1).
- `terminal-interaction` loses the explicit-`paneId` path and Example D; `tui-navigator` loses Pattern 3; `tui-navigation-patterns`' 71 id sites become slot calls; `workspace-setup` §1 and §4 become Bash hand-offs where they called session tools.
- The Bash safety hook's advice names `open-pane` and `close-pane`; its blocking rules are unchanged.

### Removed

- Eight tools: `create-session`, `kill-session`, `list-sessions`, `list-windows`, `list-panes`, `create-headless`, `kill-headless-server`, `kill-pane`. `list-slots` replaces the only legitimate use of `list-panes`; `close-pane({slot})` replaces `kill-pane` and `kill-session`; `close-pane({slot:"all"})` replaces `kill-headless-server`.
- Observing a pane the user is actively using. It needed an id the contract does not have. Run the process in a slot, or read its log from a file; adopting an *idle* user shell into a slot is unchanged.

### Fixed

- `scripts/check-terminal-contract.ts` (replaces `check-tmux-tool-table.ts`) fails the release on any id, `headless`, `-scope` or removed-tool mention in `plugins/terminal` or `autotest/terminal`, on any tool name outside the 13, and on a live `tools/list` that differs from them. It fails on the 4.2.0 tree. Wired into `release.sh` step 1b3 and `pre-commit` (static).
- `tmux-mcp-bump.yml` writes `/vN` module paths for major ≥ 2 and refuses a major bump, which is a manual release.
- The autotest suite exercised 19 cases on tools that no longer exist; rewritten on isolated slots.

### Why

v1.7.1 returned `paneId` on every call and told the model to reuse it; measured, the model learned `%73` from its first response and addressed it directly for the rest of the session. Decision record: `docs/plans/2026-09-03-terminal-slots-only-contract.md`; delivered contract and evidence: `docs/plans/2026-09-04-tmux-mcp-v2-evidence/`.

### Migration notes

- There is no compatibility path. A `paneId`, `windowId`, `sessionId` or `headless` argument is rejected with `paneId is not accepted; address the pane by slot`; a removed tool name is unknown.
- Requires tmux-mcp v2.0.0; claudeup reinstalls the binary from the new pin. Run `bun scripts/install-hooks.ts` after pulling: `pre-commit` gained the contract check.

---

## [go 0.1.3] - 2026-09-07

### Fixed

- **`go-tui`'s screenshot loop taught tools the terminal plugin no longer has.**
  `skills/go-tui/SKILL.md` and `references/screenshot-workflow.md` launched the app through
  a headless-session tool and a pane id, then captured from Bash on the MCP server's own
  socket by that id — none of which exists in the terminal plugin's slots-only contract
  (tmux-mcp v2.0.0 rejects any id and has no such tool). The Bash route now runs the app on
  a private per-run tmux socket (`-f /dev/null -L "$SOCK"`, torn down with `kill-window`),
  and the MCP route is `mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true,
  command, pattern })` → `screenshot-pane({ slot: 2 })` → `close-pane({ slot: 2 })`. The two
  files are now scanned by `scripts/check-terminal-contract.ts`, so they cannot drift again.

---

## [bunjs 0.4.4] - 2026-09-07

### Fixed

- **`tui`'s screenshot Route B named tools the terminal plugin no longer has.**
  `skills/tui/SKILL.md` and `references/screenshot-workflow.md` described the MCP route
  through a headless-session tool, a pane id and a Bash resize on the MCP server's own
  socket — none of which exists in the terminal plugin's slots-only contract (tmux-mcp
  v2.0.0 rejects any id and has no such tool). Route B is now
  `mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command, pattern })`
  → `screenshot-pane({ slot: 2 })` → `close-pane({ slot: 2 })`, and states that the slot
  tools set no geometry, so the two mandated sizes are Route A's job. Route A's teardown is
  `kill-window` on the private socket (its only window, so the session and server end with
  it — measured), and its positionals are written `${1}`/`${2}`/`${3}` so the contract gate,
  which now scans both files, can tell a shell positional from a tmux id.

---

## [browser-use 1.7.4] - 2026-09-07

### Fixed

- **The MCP server crashed on construction against mcp 2.x, so every fresh install got no
  browser tools at all.** `browser-use 0.13.10` hard-pins `mcp==2.1.1`, and the 2.x
  lowlevel `Server` removed the two things `MagusBrowserServer._extend_list_tools()` used
  to graft the ten Magus tools onto upstream's list: the public `request_handlers` dict
  (now private, keyed by method name instead of request type) and the `@list_tools()`
  decorator. The first line of `__init__` therefore raised
  `AttributeError: 'Server' object has no attribute 'request_handlers'`, the process died
  before it had answered `initialize`, and Claude Code saw a server that closed stdout.
  Existing installs were unaffected only because they still had mcp 1.x on disk; the
  `Test Plugins` workflow, which installs `browser-use>=0.13.1` fresh, had been red on
  `main` since the pin landed.

  The wrapper now serves both SDK majors from the same file, choosing by capability —
  `hasattr(server, "add_request_handler")` — never by version string. On 2.x it reads the
  parent entry back with `get_request_handler("tools/list")` and re-registers the method
  with the parent's own params type and a `(ctx, params) -> ListToolsResult` handler; on
  1.x it keeps the decorator path unchanged. The oneOf/allOf/anyOf sanitiser follows the
  field rename (`inputSchema` on 1.x, `input_schema` on 2.x) so the schema fix still lands
  on fresh installs. Verified on mcp 1.26.0 and 2.1.1: the unit, protocol, stdio and
  real-Chromium lifecycle suites all pass on both, and the pre-fix file still crashes on
  2.1.1 under the same tests. The stdio harness also no longer hangs a CI job when an
  assertion fails on 2.x — its two context managers are properly nested, so the server
  subprocess is reaped even when the session exit raises.

---

## [dev 7.0.0] - 2026-09-07

### Removed

- **BREAKING — `context.json` no longer carries `bundled_skill_paths`.** The field is
  deleted, not deprecated: `dev:stack-detector` never emits it, and it does not co-exist
  with what replaces it. Anything reading that key now reads nothing. It was one flat
  `string[]` fanned out identically to every dispatched agent; it is replaced by
  `agent_loadouts.<agent>.read` — ordered, mandatory-first, capped at five paths, and
  derived per agent and per task rather than per repo.
- **BREAKING — 24 reference manuals left `plugins/dev/skills/` for `plugins/dev/knowledge/`;
  the manifest went from 42 declared skills to 18.** Their old paths no longer resolve. The
  Go, Python, Rust, Bun, React, Vue, Tailwind and shadcn/ui manuals, and the API-design,
  auth, database, error-handling, MCP, optimisation and security-audit references, now sit
  at `plugins/dev/knowledge/<category>/<topic>.md`. Anything naming an old
  `plugins/dev/skills/{backend,frontend,discipline}/…/SKILL.md` path must be repointed, and
  the slash routes those manifest entries carried — `/dev:security-audit`, `/dev:optimize`,
  `/dev:mcp-standards` and the rest — went with them. `knowledge/` is reached by path,
  carries no manifest entry and registers nothing — the arrangement `plugins/go/knowledge/`
  has shipped under for several releases. Two of the moved files carry 6.1.0's content, not
  6.0.2's: `knowledge/security-audit.md` is the rewritten procedures file (dependency-CVE
  commands per package manager, committed-secret patterns, the compliance checklist — no
  taxonomy and no severity scale, the reviewer owns those), which `dev:reviewer` now reads
  at the new path under `FOCUS: security`; and `knowledge/frontend/browser-use-integration.md`
  probes the MCP tool only, its `claude /plugin list` fallback gone. `designer-integration`
  is not among the 24: 6.1.0 deleted that skill outright when the review surface was
  decoupled, and nothing replaces it under `knowledge/` — the `designer@magus` presence
  check lives in `dev:frontend` and `/dev:audit`, the two places that act on the answer.
- The hardcoded stack→skill mapping is gone from both of the places that carried it: the
  `<bundled_skill_path_mapping>` block in the `dev:stack-detector` agent and the
  `generate_skill_paths()` bash function in `dev:context-detection`. Loadouts are now
  derived from the filesystem, with the ten category→agent judgement calls in one file,
  `plugins/dev/skills/context-detection/references/loadout-rules.md`.

### Added

- **`context.json` v2, with a schema and a gate.** The shape is specified at
  `plugins/dev/skills/context-detection/references/context-schema.md` and enforced by
  `bun scripts/check-context-schema.ts`, whose `--self-test` proves all 17 rules can fire
  against 21 deliberately invalid documents. v2 adds task intent (`task.kind`,
  `task.surfaces`, `task.confidence`), an MCP server inventory with provenance, and the
  per-agent `agent_loadouts`. A v1 document is rejected. Phase 3 now lists `context.json`
  in `PHASE_ARTIFACTS`, so an empty or missing one fails where the pipeline actually runs.
- **`bun scripts/check-plugin-paths.ts`** — every `${CLAUDE_PLUGIN_ROOT}/…` and
  `plugins/<p>/…` path named in plugin instruction text must exist on disk. It skips
  fenced config examples, template placeholders and globs, but still reads live bash
  fences, which is where the dead path below had been hiding. Wired into `pre-commit`
  scoped to staged files and run repo-wide at release; `--self-test` proves all 6 rules
  can fail. It scans `knowledge/` alongside `agents/`, `commands/` and `skills/` — a tree
  reached by path only is exactly the one with no other gate. Relative links (the `./x.md` form,
  a backticked `references/x.md`) are deliberately not checked: a rule resolving them
  against the file's own directory was measured over the whole tree and produced 165
  findings of which 3 were real, because the base of a relative path is not recoverable
  from the text — agents write from the plugin root, a skill's sub-references from the
  skill root, and a documentation skill teaches README layout with links that name nothing.
- **`bun scripts/classify-skill-shape.ts`** — scores a directory as SKILL, KNOWLEDGE or
  AMBIGUOUS by shape. Advisory: it proposes, a human moves the file. Deliberately not a
  blocking gate while the ambiguous residue is untriaged.
- `ai-docs/best-practices/` — a repo-internal curated shortlist of cross-cutting
  approaches, each with its cost and a pointer into the shipping knowledge tree. Holds no
  bodies and never publishes.
- `repo.stacks: ["unknown"]` for a repo outside the detector's recognised set (Java, .NET,
  …), stated in the schema and the agent, with a positive testdata document.
  `commands.*` still come from the repo's own tooling in that case.

### Changed

- **Files under `plugins/dev/knowledge/` carry no skill frontmatter.** Each keeps a
  `description:` line and nothing else; `name`, `disable-model-invocation`,
  `user-invocable` and every other skill-only key are gone. Nothing had read them — the
  skill loader never sees this directory — and a flag that reads as behaviour but is not
  is worse than none. A knowledge file's name is its path. `classify-skill-shape.ts`
  strips frontmatter before scoring, so no file changed bucket.
- Loadout rules are R1–R9; the `design/` rule went with the category (6.1.0 deleted
  `design/designer-integration`, the category's only member). `docs` is recorded as
  preloading `documentation-standards` and is no longer handed it a second time.
- Knowledge files no longer describe themselves as skills ("This skill covers…" is now
  reference language), and the three frontmatter-less sub-references carry a
  `description:`.

### Fixed

- **`dev:stack-detector` emitted cross-plugin paths as `plugins/<p>/…`, the layout of the
  magus source tree** — on every customer install they failed `stat`, every MCP server got
  `usage: null`, and a clean run produced 4+ warnings. Another plugin's file is now emitted
  absolute under its installed root, resolved from `~/.claude/plugins/installed_plugins.json`
  (`loadout-rules.md` → "Resolving another plugin's installed root"; never
  `installedPluginVersions`). `context-schema.md` states the two legal path forms and
  `check-context-schema.ts` rejects a repo-relative one (rule `PATH`).
- **Project-local skills were never handed to any agent.** Phases 3 and 4 filtered
  `discovered_skills` on an `auto_loaded` flag that neither the schema nor
  `discover-skills.js` ever set, so the loop was always empty. They now list every
  project-local skill the detector found; the schema item is
  `{ name, description, path, source, categories }` and has no relevance flag.
- `check-plugin-paths.ts` exempted whole json/yaml/toml fences, so a dead path in the
  detector's own worked examples produced zero findings. Config fences now still check
  tails under `/skills/`, `/knowledge/`, `/agents/`, `/commands/` (rule PP-07); server and
  hook illustrations stay exempt.
- `release.sh` runs `check-context-schema.ts --self-test` (step 1de2) and the
  `check-context-schema` and `classify-skill-shape` unit suites (step 1dg). Before this,
  no gate ran the validator this entry says enforces the schema.
- `/dev:fix` dispatched the detector without a `TASK:` block, so an honest run classified
  every bug as `unknown`. It now uses the `session-setup.md` template verbatim (the
  template's only home), and the detector maps `task.source: command` to a kind —
  `/dev:fix` → `bug_fix`, `/dev:doc` → `docs` — at low confidence.
- The `frontend`, `test-architect`, `reviewer` and `debugger` loadouts are now read — phase 4
  routes frontend-surface phases to `dev:frontend` with its own loadout, phase 5 hands the
  reviewer its loadout beside the contract lines, phase 6 hands the test-architect its
  loadout in both dispatches, `/dev:fix` hands the debugger its loadout.
- `classify-skill-shape.ts --check` treated a non-numeric ceiling override as NaN and
  passed; it now exits 2 naming the variable.
- **A reference to a skill directory that does not exist shipped in four places.**
  `core/debugging-strategies` was named by the `dev:stack-detector` agent and by
  `dev:context-detection`, both of which load on nearly every `dev` entry point. It now
  points at `discipline/systematic-debugging`. `/dev:help` also read
  `${CLAUDE_PLUGIN_ROOT}/plugin.json`, which is not where a manifest lives; it reads
  `.claude-plugin/plugin.json`.

### Why

The mapping had two hand-maintained homes that had to be edited together, so one stale
entry went stale in two always-loaded files at once, and no gate could see a bare path
inside a bash fence. The fix is structural rather than a correction: one home for the
judgement, derivation for everything else, and a gate that reads the fences.

### Migration notes

**The skill-listing budget is unchanged — 9,967 eligible chars before and after, with
`dev` at 1,941 both times.** Moving 24 files out of `skills/` freed nothing, because all
24 already carried `disable-model-invocation: true` and so contributed zero to the listing.
What changed is the count of files charged nothing (59 disabled before, 35 after); the
eligible set is the same 61 skills. Verified by running `bun scripts/skill-budget-check.ts`
against dev 6.1.1's tree and against this one. No budget win is claimed here.

Consumers reading `bundled_skill_paths` must move to `agent_loadouts.<agent>.read`. There
is no compatibility path and no fallback: the old field is absent, not empty.

---

## [claudish 2.0.3] - 2026-09-07

### Changed

- **Route probing is no longer offered to the agent.** Routing is claudish's job: the
  agent resolves a bare model name from the live catalog and hands it over, and never
  needs to know which provider would serve it. The skill drops `preflight()` from its MCP
  tool catalog, drops the `claudish --probe` row from the diagnostics table — so "exactly
  four CLI invocations remain permitted" is now three — and rewrites "A model will not
  route" to report through `report_error` and pick another model instead of inspecting
  the routing chain.
- The line banning "retry, probe, or fallback logic" in this repo is kept deliberately.
  It pushes the same way.

### Why

A list of permitted-but-discouraged commands reads as a menu, not a fence. The same
failure produced the upstream bug this change documents: claudish's own MCP tool
descriptions instruct the agent to call `preflight` before `team`, and a tool description
sits in the agent's context on every turn, so it functions as a standing instruction.
Measured from transcripts (`tool_use` blocks only, tool listings excluded, re-measured
2026-09-07): 13 real `preflight` invocations across 5 project directories, four of them
ordinary work and one the session that implemented the upstream fix. Zero in magus — the
magus skill was never the cause, and could not have been, since it only loads here. One
`models-index` session spent ten claudish calls to choose a single model. The upstream fix is
specced in `docs/plans/2026-09-04-claudish-preflight-not-the-agents-job.md` and belongs
in the claudish repo; this release is the magus half.

---

## [dev 6.1.1] - 2026-09-07

### Changed

- The claudish coaching rule and `/dev:setup`'s routing table drop `--probe` from the
  permitted read-only CLI diagnostics, leaving `--help`, `--version` and `--models`.

---

## [multimodel 4.0.2] - 2026-09-07

### Changed

- The README's permitted-CLI list drops `--probe`, matching `claudish:claudish-usage`.

---

## [dev 6.1.0] - 2026-09-03

### Added

- **One capture script for every review diff.** `scripts/capture-review-surfaces.ts`
  is now the only place a review range is computed. It emits three separate surfaces
  (committed + staged since the baseline, unstaged, untracked) because any single
  `git diff <range>` collapses endpoints — three successive hand-rolled forms each
  produced a 0-byte capture over a mid-session commit. It never touches the index.
  Modes: session (`--baseline`), branch (`--base`, auto-resolved), `--stat`,
  `--name-only`, `--exclude-from`; an empty value flag exits 2. Every hand-rolled diff
  range under `plugins/` now calls it.
- **`/dev:audit` guide** at `userdocs/guides/dev-audit.md`: the six scopes, `--models`,
  and what the consolidated report looks like whether one reviewer ran or four.
- **The Phase 5 gate sees the capture.** `code-changes.diff` must be at least 1 byte; a
  PASS over an empty diff is now reported by name instead of passing silently. The hook
  stays advisory in Claude Code.
- `scripts/check-review-contracts.test.ts` (30 ratchets over all of `plugins/`) and
  `scripts/check-diff-ranges.test.ts` (32 scratch-repo tests), both in `check:all`, and
  `benches/review-contract/`, a madbench bench that measures the reviewer contract on a
  real model: treatment 8/8 + 8/8, control 1/8 + 0/8.

### Changed

- **`dev:reviewer` owns judgement and is dispatched by contract.** Dispatchers pass
  `TARGET:` / `FOCUS:` / `OUTPUT:` / `MODELS:` and never restate its rules; the OWASP
  list, severity scale and verdict thresholds live in `reviewer.md` alone (a contract
  test fails on any second copy). CAPTURE mode reads the script's output, states which
  surfaces it saw, and refuses a verdict over an empty capture.
- **`dev:synthesizer` consolidates everywhere** — Phase 5, Phase 3, every `/dev:audit`
  route, `/dev:fix` Phase B, the multimodel review skills. It reads reviews, never code;
  accepts a severity-graded report, a design report by percentage, or a vote file;
  applies whatever `THRESHOLDS:` rule it is handed in that rule's own vocabulary; and
  passes a single review through unchanged plus its verdict line.
- **Multimodel when available.** `MODELS:` is owned by the dispatcher. The internal
  reviewer always runs; externals are additive when `which claudish` succeeds. Where
  claudish is optional the reviewer is a separate `Agent(dev:reviewer)` beside the
  `claudish team()` call.
- `/dev:audit` is a pure router with six scopes on the menu; `/dev:help` lists them.
- `/dev:fix` Phase B votes with `dev:reviewer` (the debugger no longer grades its own
  patch); its verdict is mapped to a vote in the tally step, and the tally rule now
  covers every panel size with three terminal words (STRONG / REJECT / DIVERGENT).
- `dev:docs` reports open with `**Total Score**: N/52 (P%)` and a `**Verdict**:` line
  under severity headings — the fields the synthesizer keys on.
- `security-audit` skill cut from 581 to 141 lines: CVE commands, secret patterns by
  value, the compliance checklist, and a reachability procedure; the judgement moved to
  the reviewer.
- `code-roast`, `db-branching` and `browser-debugging` keep `disable-model-invocation`
  and drop `user-invocable: false`; the autotest and integration cases that expected the
  Skill tool to reach them now assert the slash-only truth.

### Fixed

- `/dev:fix` staged pre-session dirty work and committed pre-staged paths with the fix.
  Step 1a now snapshots the dirty set and tells the user; the commit step captures
  `--name-only --exclude-from` that list and uses the same `--pathspec-from-file` list
  for both `git add` and `git commit`. Reproduced and tested against a scratch repo.
- `/dev:fix` Step 1a edited a `session-meta.json` nothing had created.
- `dev:frontend` dispatched `Agent(` without the tool; its Gemini provider steps and the
  designer-integration references are gone, and `designer-integration/` is deleted.
- `/dev:design-system --changed` fell back to `HEAD~1` when the base could not resolve.
- The designer presence check used a `claude plugin` form that does not exist.
- `/review` → `/code-review` in the phase-5 skill and the audit command.
- A dozen sentences that described code that no longer existed.

---

## [multimodel 4.0.1] - 2026-09-03

### Fixed

- **Both review skills consolidate through `dev:synthesizer`** and quote the reviewer's
  thresholds by path instead of carrying six copies; `multi-model-validation` no longer
  has the reviewer merge a set containing its own review, and Pattern 5 synthesizes at
  N = 1 too.
- `multi-agent-coordination`'s design panel pins `require_pattern` on the
  `Diff Percentage` row every design review returns, not on `Overall Score`, which only a
  run with a vision key writes; the sketch carries `THRESHOLDS:`; the `claude-internal`
  output directory is created before the review runs.
- Bare `git diff` captures in `multi-model-validation` and `model-tracking-protocol`
  replaced by the `dev` capture script.
- `agent-enforcement`'s Review row no longer names a detective as an alternative to the
  reviewer.

---

## [designer 0.6.2] - 2026-09-03

### Changed

- **`designer:design-review` opens its returned text with the `Severity` and
  `Diff Percentage` rows** from `summary.md`, so a caller's `require_pattern` has a line
  every run writes, with or without a vision key.
- `designer:ui` reviews only: `Edit` is removed from its tools and design-system integrity
  is routed to `/dev:design-system`. `/designer:ui` inspects the tree with
  `git status --short`; the browser-use-integration skill drops a stale reference.

---

## [claudish 2.0.2] - 2026-09-03

### Changed

- **The `claudish-usage` Review row names `dev:reviewer` only**; the detective is no
  longer offered as an alternative reviewer.

---

## [dev 6.0.2] - 2026-08-31

### Fixed

The phase-artifact gate fired on correctly-completed runs, and could not be acknowledged
when it did. All three defects were found by running it, not by reading it.

- **A Standard-depth run reported as abandoned.** `phase3` is named "Multi-Model Planning"
  and required `architecture.md` *plus* both `reviews/plan-review/*` files. The
  "never started" guard is `present === 0`, so on a Standard run `architecture.md` existed,
  the guard missed, and the hook demanded two artifacts that Standard is *specified* never
  to produce — it is single-model by definition. The hook could not tell "ran at a shallower
  depth" from "gave up". Artifacts can now declare a `group`, required only when at least one
  member already exists: no plan-review file means the depth was never run, one means the
  other is genuinely missing. Derived from the files rather than a stored depth, because a
  run that died before writing its config would otherwise be checked against nothing.
- **`skip-reason.md` was advice the hook did not read.** The message told the reader to write
  it; the string appeared exactly once in the file — inside that message. Writing it changed
  nothing and the identical advisory returned next turn. On a `Stop` hook that means an
  unsilenceable warning, which trains people to ignore the ones that matter. It is now
  honoured, and a test pins the message and the behaviour together so they cannot drift apart
  again.
- **The implementation-log check rewarded vocabulary over substance.** It required one of
  `Phase|Step|Started|Completed|Created|Modified`, and scored a real 15KB log — measured
  baseline, per-item changes, pasted command output, disclosed deviations — at **zero**,
  because it was organised by item number and said "Landed in its stated order". A shorter,
  emptier log containing the word "Step" passed. The pattern is gone; `minSize` and the
  existing `implementationProducedChanges` evidence check already answer "did this phase do
  anything", and they answer it from the working tree.

### Why

Three tests in the existing suite used `phase3` as their "phase with several required
artifacts" example and supplied only the first — which is precisely the shape that is now
legitimate. They were retargeted onto `phase5`, whose two artifacts are ungrouped and so
still express "begun and abandoned", rather than weakened. Five new tests cover the fixes,
and each fails when its own fix is reverted.

---

## [Marketplace 10.3.0] - 2026-08-29

### Changed

- **`madbench` v0.3.0**: the evals skill is rewritten from madbench v0.10.0 to **v0.23.0**,
  thirteen releases of drift. Adds the `environment:*` family — eight checks that grade
  whether a plugin actually loaded, its skills registered and its MCP server connected — plus
  the full thirteen `session:*` types, `readout:`, `args.outcome`, `args.thread`, the matcher
  prefixes, `repo:`/`setup:`/`follow_ups:`, and the current CLI.
- **`madbench` v0.3.0**: the drive-mode guidance was wrong in a way that hung real runs. It
  said benches run `claude --print` and to pass `--permission-mode acceptEdits`. `interactive:
  true` has been the default since madbench v0.11.0, and `--print` **ignores
  `--permission-mode` entirely**, so that flag never did anything on the path it was
  recommended for. Interactively, `acceptEdits` parks Bash at an approval menu nobody can
  answer.
- **`dev` v6.0.1**: version archaeology removed from 18 files — fourteen notes explaining that
  a skill had been folded into its owner on a given date, two `## Version History` sections, a
  50-line v1.0-vs-v2.0 table, and two passages describing what a file "used to teach". A
  cold-starting agent can neither reach nor act on any of it.
- **`designer` v0.6.1**: the two dated correction blocks in `ui-analyse` and `compare` are now
  present-tense rules. The constraint they carry is unchanged and load-bearing — `claudish`
  has no `--image` flag, and an `[Image: …]` reference typed into a prompt is plain text, so
  either route returns a fluent review of a screen the model never saw.
- **`claudish` v2.0.1**: `claudish-usage` no longer narrates what earlier versions of the
  skill contained. The prohibition survives as a present-tense rule — never document a
  provider/prefix/env-var table or a routing troubleshooting guide in this repo, because
  ownership sits with claudish and anything restated here drifts.
- **`bunjs` v0.4.3**: the README's discovery table and the `bun` index state their measured
  findings directly instead of narrating which earlier claim was retracted. The rule is
  unchanged: relative paths in a `SKILL.md` resolve against that file's own directory.

### Fixed

- **The `MCP_SCHEMAS` snapshot in `scripts/lib/plugin-rules.ts` mirrored claudish 7.65.0**,
  listing a `timeout` that 8.0.0 dropped and missing the `input_file` and `slot` it gained.
  That produced **30 false `MC-01` errors** against correct instructions and blocked
  `release.sh`. The rule's own note anticipated it: *"A failure here means the call is wrong OR
  the table is stale — check the live tool definition before believing it."* The live
  definition said the table.
- A `Task tool` heading in `/dev:dev` that meant the **task-list** tools, not the Agent tool —
  the one real finding among the 31.

### Why

`validate-plugins` reported 31 errors both at `HEAD` and after these changes, verified against
a clean tree extracted with `git archive`, so none was introduced here. It now reports zero,
and its self-test still confirms all 14 rules can fail.

---

## [madbench 0.3.0] - 2026-08-29

### Changed

- **The skill now mirrors madbench v0.23.0. It documented v0.10.0 — thirteen releases behind.**
  All five reference files were rewritten against the `v0.23.0` tag and the constructor maps in
  `pkg/check/builtin/`, not against the working tree of the madbench checkout, which was mid-branch
  with uncommitted edits.
- **The drive-mode guidance was wrong in a way that hangs a real run.** The skill said benches run
  `claude --print` and told you to pass `--permission-mode acceptEdits` so the agent could write
  files. Two things falsify that: `interactive: true` has been the default since v0.11.0, and
  `--print` **ignores `--permission-mode` entirely** — so the flag never did anything on the path it
  was recommended for. On the interactive path `acceptEdits` lets Write/Edit through but parks Bash
  at an approval menu nobody can answer, so a bench written to the old text hits its first `go test`
  and hangs to timeout. The correct interactive translation is `bypassPermissions`.
- **The default scenario timeout is 300s, not 120s** — raised upstream on 2026-08-27 because 120s
  was calibrated for `--print` and a cold-start interactive turn exceeds it.
- The check catalog went from a partial listing to all **92 registered types** across twelve
  families, with the per-family counts taken from source.

### Added

- **The `environment:*` family — 8 checks that grade what the agent was GIVEN**, not what it did:
  `plugin-loaded`, `skill-registered`, `command-registered`, `agent-registered`, `mcp-connected`,
  `tool-available`, `plugin-inventory`, `matches-expected`. This family did not exist when the skill
  was written, and it answers the question this marketplace keeps getting wrong by hand — *did the
  plugin actually load, are its skills registered, did its MCP server connect*. Documented with the
  Expected-vs-Reported split that makes it trustworthy, and the `harness_config.environment` probe.
- The Session family's full 13 types, including `tools-only` (allowlist fences), `tool-sequence`,
  `turn-count`, `turn-step-count` and `image-sent`; the shared bound grammar (`lte`/`gte`/`eq`); and
  the two scoping dimensions `args.thread` and `args.outcome`.
- `readout:` (measure without gating), `transform:` (JS rewrite before one check), `inline:`, and
  the `exact:`/`glob:`/`suffix:`/`contains:` matcher prefixes.
- Scenario keys `repo:` (pinned third-party checkout), `setup:` vs `generate:`, `follow_ups:`,
  `cwd:` and `staging_timeout:`; the Eval `control:` block and the `metrics:` source catalog.
- The current CLI: the `report`, `keychain`, `update` and `version` commands, and ten flags
  including `--report-dir`, `--concurrency`, `--theme`, `--env-file` and `--no-keychain`.
- A sixth skill eval, `verify-the-plugin-actually-loaded`, covering the `environment:*` family.

### Fixed

- **The skill's own evals encoded the falsified model and would have graded the corrected skill as
  wrong.** Eval 1 asserted that "in `--print` mode un-approved Write/Edit tool calls silently
  no-op". It is now `debug-interactive-hang`, and carries an explicit assertion that an answer
  resting on the silent-no-op story **fails**.
- `madbench check` reports `latency` and `cost` as **NOT APPLICABLE UNDER MOCK** and excludes them
  from its verdict; the skill said they land in a "could not grade" bucket. It now also explains
  falsification as the way to prove a budget guard, and why a count ceiling is *not* exempt.
- `madbench version` replaces the `go version -m` incantation for identifying the binary. There is
  no `--version` flag.

### Why

Where upstream's own docs contradict themselves, this skill follows the source. `docs/checks.md`
gives three different totals for the catalog, lists Session at 8 in a table whose body enumerates
13, and lists Environment at 7 where the constructor map registers 8; `harness.md` says
"eight keys. That is the entire schema" for a struct with nine. Every count here was counted from
the constructor maps, and the disagreement is noted in the file so the next person does not
"correct" it back.

---

## [dev 6.0.1] - 2026-08-29

### Removed

- **Version archaeology across 18 files.** Fourteen carried a note explaining that a skill had been
  folded into its owner on a particular date; two `## Version History` sections and a 50-line
  v1.0-vs-v2.0 comparison table sat at the end of skill files; two more explained what the file
  "used to teach". None of it told a fresh context anything it could act on — the line above each
  note already said what the file was for.
- The `task-management` skill description no longer explains "why the task-list tools are gone". It
  states what is true now: current models have no task-list tools. The verified control block that
  proves it stays.

### Why

An agent starts every session cold and loads only the current text. A note about what a previous
version said is unreachable context that costs listing budget and reading time, and it invites the
reader to reason about a state that no longer exists.

---

## [designer 0.6.1] - 2026-08-29

### Changed

- The two dated `Correction (2026-08-14)` blocks in `ui-analyse` and `compare` are now present-tense
  rules. The constraint they protect is unchanged and load-bearing: **`claudish` has no `--image`
  flag**, unknown flags pass through to `claude` which has none either, and an `[Image: …]`
  reference typed into a prompt is plain text. Either route returns a fluent review of a screen the
  model never saw, and reports no error while doing it.

---

## [claudish 2.0.1] - 2026-08-29

### Changed

- `claudish-usage` no longer narrates what earlier versions of the skill contained. The prohibitions
  survive as present-tense rules — never document a provider/prefix/env-var table or a routing
  troubleshooting guide here, because ownership sits with claudish and anything restated drifts.

---

## [bunjs 0.4.3] - 2026-08-29

### Changed

- The README's discovery table and the `bun` index skill state their measured findings directly
  instead of narrating which earlier claim was retracted. The rule that matters is unchanged:
  relative paths in a `SKILL.md` resolve against **that file's own directory**, so `../<name>/` is
  the only spelling that lands.

---

## [code-analysis 7.1.0] - 2026-08-28

### Changed
- Requires `claudish ^2.0` (was `^1.0`). `claudish` 2.0.0 rewrote its `team` contract for
  the non-blocking claudish 8.x runtime, and the marketplace ships one `claudish` at a
  time — leaving the range at `^1.0` would have made this plugin unresolvable and
  therefore uninstallable. Nothing in `code-analysis` itself changed.

---

## [designer 0.6.0] - 2026-08-28

### Changed
- Requires `claudish ^2.0` (was `^1.0`), for the same reason as `code-analysis` 7.1.0: the
  marketplace ships a single `claudish`, now 2.0.0, and a `^1.0` range no longer resolves.
  Nothing in `designer` itself changed.

---

## [multimodel 4.0.0] - 2026-08-28

### Changed
- **BREAKING — `/multimodel:team` polls instead of waiting, and needs claudish >= 8.0.0.**
  `team(mode:"run")` no longer blocks: it starts the panel and returns a slot map. The
  command gained Step 2b, which polls `team(mode:"status")` until no slot has
  `state === "RUNNING"`, and Step 3 now reads each vote from `response-<slot>.md` instead
  of from the `run` response. Against 8.x the old shape parsed a response with no votes in
  it and reported INCONCLUSIVE on every run.
- The vote prompt is written to `input.md` and passed as `input_file`. A vote prompt is
  100+ lines, and an inline `input` echoed all of it verbatim in the user's terminal,
  burying the model list, the agent and the shape check inside the tool call.
- `timeout` removed from every call. It was dropped from the tool schema, and because the
  schema does not set `additionalProperties: false` a leftover one is **silently ignored**
  rather than rejected — the call still read as though it set a deadline.
- Step 2c is new: decide about a quiet slot from `idle_seconds_by_slot` read together with
  `activity_by_slot`. The panel deliberately does **not** auto-cancel. It reports a slot as
  still running at the 30-minute poll ceiling and lets the user decide.
- `agents/deep-analyst.md` and the `proxy-mode-reference`, `task-external-models`,
  `multi-model-validation` and `error-recovery` skills updated to the same contract.

### Added
- `skills/hooks-system/SKILL.md` documents the `ExitPlanMode` gate — the
  `PostToolUse:ExitPlanMode` hook that resumes a pipeline once the user approves a plan.
  Written alongside `dev` 5.0.0 but never shipped, because `multimodel` was not bumped
  for it at the time.

### Why
A `team` slot is a full Claude Code session and can legitimately work for a long time. The
old shape held the MCP call open for the whole run, and a real run was aborted at exactly
1800s of client idle timeout. The deadline meant to bound it was worse: its only progress
signal was token flow, which stops during a local tool call, so a model running a test
suite looked identical to a hung one and three of five actively-working slots were killed.
Nothing terminates a slot on a timer now — the caller polls, looks at the evidence, and
decides.

### Migration notes
Requires **claudish >= 8.0.0** (`bun add -g claudish`). This version does not work against
7.67.x: `input_file` does not exist there and `run` still blocks. `mode:"run-and-judge"`
still blocks and remains a drop-in for a vote panel that would rather not poll, at the cost
of the 1800s idle abort.

---

## [claudish 2.0.0] - 2026-08-28

### Changed
- **BREAKING — the `team` contract in `claudish:claudish-usage` is rewritten for claudish
  8.0.0.** The skill now documents `run` as non-blocking and carries "The three-step
  lifecycle" — start, poll `status` until settled, read `response-<slot>.md` — as the one
  place that procedure is written. Every other plugin's `team` call site points here rather
  than repeating it.
- Parameter table corrected: `timeout` removed, `input_file` and `slot` added, `mode` gains
  `"cancel"`. A note records that a leftover `timeout` is silently ignored, not rejected,
  because the schema does not set `additionalProperties: false`.
- New guidance on telling a stuck slot from a busy one: `idle_seconds_by_slot` and
  `activity_by_slot` are only meaningful read together. 90s idle in `tool_executing` is a
  build; 90s idle in `running` is a model that stopped mid-answer.
- Failure table gains `cancelled` (your decision, not a crash) and `RUNNING` at the poll
  ceiling (not a failure), alongside `shape_mismatch` and `nonzero_exit`.
- Three new best practices: poll to completion, never read results from the `run` response,
  and pass long prompts as `input_file`.

### Migration notes
Requires **claudish >= 8.0.0**. The skill states that as a hard floor, because a workflow
written to it starts a run and reads nothing on 7.x.

---

## [dev 6.0.0] - 2026-08-28

### Changed
- **BREAKING — every `team` call in `dev` polls for completion and needs claudish >= 8.0.0.**
  `/dev:fix` (both multimodel vote gates), `feature-phases/phase3-planning`,
  `feature-phases/phase5-review` and `task-management/references/agent-coordination` all
  called `team(mode:"run")` and then read results the call no longer returns. Each now
  polls `team(mode:"status")` until no slot is `RUNNING` and reads answers from
  `response-<slot>.md`.
- `/dev:fix` passes `input_file` pointing at the vote-prompt file it already wrote, instead
  of inlining that file's contents. Its ABSTAIN rule now covers a slot still `RUNNING` at
  the poll ceiling, which must be reported as still running rather than crashed.
- Phase 3 and Phase 5 pass `input_file` and name the review files explicitly as
  `response-<slot>.md` at consolidation time.

### Fixed
- `phase5-review.md` referenced a `prompt.md` that no step ever wrote. The inline `input`
  hid the gap; naming the path via `input_file` would have turned it into a hard error, so
  Step 5.5 now writes that file first.

### Migration notes
Requires **claudish >= 8.0.0**. `timeout` is gone from all four call sites — it is silently
ignored by the 8.x schema rather than rejected, so leaving it in would have read as a
deadline that nothing enforced.

---

## [dev 5.0.0] - 2026-08-28

### Fixed
- The phase-artifact gate could not fire at all. It was registered as `PreToolUse` on
  `TaskUpdate`, and that tool was removed from Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5
  and newer in Claude Code 2.1.233 — verified with a control (`--model claude-sonnet-5`
  reports no, `claude-sonnet-4-6` reports yes), not read from the changelog. The gate
  moves to `Stop`, which does fire, and is **advisory** rather than blocking: the first
  version exited 2, which on `Stop` means "refuse to stop" and spun a session that was
  idle-waiting on a background agent.
- 147 dead tool entries removed from 37 files across 10 plugins. `allowed-tools` is a
  permission grant, so they did nothing — but they told every reader that these commands
  use a workflow they cannot use, and `/dev:dev` carried "You MUST use Tasks" against an
  absent tool.

### Added
- `/dev:dev` drives plan mode across both of its moments, via two hooks.
  `UserPromptSubmit` carries the enter/adopt protocol when `/dev:dev` is invoked;
  `PostToolUse` matched on `ExitPlanMode` resumes the pipeline at Phase 4 once the user
  approves. Measured interactive, no tool fence: **0/5 without the hooks vs 5/5 with**,
  Fisher one-sided p = 0.004, flake 0.
- Validated live end to end: `Entered plan mode` at Phase 3, then after "Yes, and use
  auto mode", `Phase 3 — complete. Artifacts: architecture.md.` / `Phase 4 — starting.`
  with no further prompting.

### Changed
- Phase progress is reported in one line of text (`**Phase N — starting.**` /
  `**Phase N — complete.**` naming artifacts) instead of task-tool calls. The artifacts
  are now the record: a task marked completed was a claim, a file on disk is evidence.
- `skills/discipline/task-management/SKILL.md` rewritten — it taught the removed API.

### Why
An earlier attempt put the same protocol text inside `dev.md` and it reached the model
**zero times in five sessions**. Plan mode re-injects its reminder on every turn while a
slash command is expanded once, so by the architecture phase the reminder has been
repeated five times and the command file zero. Plan mode did not out-rank the command; it
out-lasted it. Placement, not wording, is what changed the result.

### Migration notes
The `PreToolUse:TaskUpdate` registration is deleted rather than kept as a fallback. Any
tooling that matched on it, or that parsed the old `TaskUpdate(...)` progress lines, needs
updating. Plan mode applies at Standard and Full depth only — Quick is `0 → 4 → done` with
no Phase 3.

---

## [code-analysis 7.0.0] - 2026-08-27

### Removed

- **Four of the six engines, because four of them had never been run.** `claudectx`,
  `cocoindex`, `codegraph` and `graphify` are no longer valid values for
  `"code-analysis".engine`. No binary for any of them existed on the machines that
  built them, so their tool names, argument shapes, result shapes and line bases came
  from upstream documentation and nothing had ever checked them against a running
  server. v6.0.0 advertised six switchable engines when two had been exercised; a user
  who selected one of the four would have got a plausible-looking adapter failing in a
  way nobody had ever seen. Selecting one now returns a `backend_unavailable` note
  naming the engines this build does ship, and tier 0 keeps working. Deleted rather
  than disabled — a disabled adapter is code that rots, and the whole cost of re-adding
  one is the verification.

### Changed

- **The two that remain are verified against live servers.** `mcp/live-engines.test.ts`
  spawns the real server and points it at a real `serena` (1.7.0) and a real `mnemex`
  (0.31.2). serena lists `code_search`, `find_dependents`, `find_implementations` and
  answers `withFileLock` in 5.4s with `src/lock.ts:2-4`; mnemex lists `code_search`,
  `find_dependencies`, `find_dependents`, `call_tree`, `impact`. The two lists overlap
  rather than nest, which is what distinguishes a capability gate that reads from one
  that counts. **mnemex ships knowing it is broken without an embedding credential and
  an index run** — measured, it indexed 0 files from a 2-file corpus and had produced
  no output on a 217-file corpus after 20 minutes — and the facade's job in that state
  is to say so rather than return an empty list that reads as "this codebase has no
  matches". Skips are announced on stderr naming what went unverified.

### Added

- **A bad `engine` id now names the engines this build ships.** It was the only place a
  user could learn what to type instead: the settings file has no schema, the tool list
  looks identical to a correct tier-0 configuration, and the typo is silent everywhere
  else. It never guesses a near match — resolving "serana" to "serena" by string
  distance is the same class of error as picking a model by name similarity.
- **`engines.<id>.callTimeoutMs`**, a per-engine MCP request deadline defaulting to
  30 000 ms. One constant cannot serve both: serena answers a symbol lookup in ~6s, so
  a 30s wait there means something is broken and must fail loudly, while mnemex
  cold-starts and embeds over the network before it can answer at all. Rejected above
  its ceiling rather than clamped, so the number in the settings file is always the
  number in the timeout note.

### Fixed

- **An index built elsewhere reported every hit under the tree that built it.** mnemex
  bakes absolute paths into `index.db`. `repairForeignPath` takes the longest trailing
  run of segments that resolves under the project directory and declines otherwise,
  leaving the honest `../` answer standing.
- **The mnemex empty-index check fired on healthy indexes.** It read `lastIndexed`
  alone, and mnemex reports that as `null` while carrying a real timestamp in
  `indexDbLastIndexed`, so a fully indexed 216-file corpus was reported as never
  indexed.
- **The engine's child process inherited an empty environment.** `spec.env` now merges
  over `process.env` instead of replacing it.

### Migration notes

Anyone with `"engine": "codegraph"` (or `claudectx`, `cocoindex`, `graphify`) in
`.claude/settings.json` will see `code_search` alone plus a note naming `"mnemex"` and
`"serena"`. Switch to one of those, or remove the `engine` key — tier 0 with no engine
is a supported configuration.

---

## [terminal 4.2.0] - 2026-08-27

### Changed

- Agents no longer manage panes. `tmux-mcp` v1.7.1 reads the pane it was launched in and keeps a numbered helper pane per window, so "run this beside me" is one call with no pane argument: `send-keys({keys, enter:true})`. Eleven tools accept an optional `slot` (1–64) or explicit `paneId`, defaulting to slot 1.
- Rewrote the pane-management rules in `terminal-interaction` — §1b, §1c, §3, §4 and Example F. Removes all nine raw-`tmux` prescriptions, the `claude-helper` label convention, the split-ordering diagrams and the layout-preset block. 711 lines to 651.
- Rebuilt the four `workspace-setup` dashboard archetypes on slots. Each slot is a distinct pane by construction, so the "fill each pane before the next split or reuse collapses your grid" choreography is gone — Archetype C drops from 11 ordered steps to 4 independent calls.
- Converted `tdd-workflow` and the `tui-navigator` agent to slots; teardown now uses `close-pane`, which kills panes the server created and only interrupts panes it adopted from the user.
- Plugin description now states what the safety property actually is: helper panes are placed and owned by the server, so an agent never targets the user's own session.
- Applied `dev` v4.0.0's "group skills by how they are reached" principle: `workspace-setup` is hidden (`disable-model-invocation`) and reached by a read-row in `terminal-interaction` and the `tui-navigator` agent. Terminal's listing cost drops 751 → 567 chars. `tdd-workflow` stays listed — it is a discipline — and the two skills `tui-navigator` preloads stay listed, since hiding a preloaded skill silently starves its consumer.

### Fixed

- `workspace-setup`'s session sequence called `mcp__tmux__create-window` three times — a tool not reachable at the `-scope agentic` this plugin ships, so that workflow could not run. Window creation now routes to the startup script the skill already generated.
- `§3` claimed `start-and-watch` and `watch-pane` return `-32601: requires task augmentation` on Claude Code. Both were verified working; they are synchronous blocking calls, and §1's decision table named them as the primary tool for three of its eight rows.
- `§4`'s tool table was titled "20 Tools", listed 22, and the shipped scope exposed 19 — documenting four tools unreachable at that scope while omitting `screenshot-pane`. Regenerated from a live `tools/list` probe; now 20, verified against published v1.7.1.
- `commands/tui.md` and `commands/session.md` granted `resize-pane` and `rename-session` in `allowed-tools`; neither is reachable at this scope.
- The occupancy rule listed `split-pane` among its guarded verbs, so an agent obeying it had to refuse "split this window" — the source pane's foreground is `claude` — while Example F performed that split anyway.

### Why

Documentation drift had made the skill unfollowable: its own rules required two capabilities the server did not expose (pane self-location, pane labeling), so an agent following them correctly could not stay on MCP tools and fell back to raw `tmux`. Moving pane management into the server removes the need rather than documenting around it. Design note: `docs/plans/2026-08-13-tmux-mcp-intent-level-panes.md`.

### Migration notes

- Requires `tmux-mcp` v1.7.1; the pin in `plugin.json` is updated and the binary upgrades with the plugin.
- Explicit `paneId` keeps working on every tool and answers exactly as before, so nothing existing breaks.
- A helper pane may be one the user left idle rather than a fresh split. It inherits their environment, and unsubmitted input in that pane concatenates with the first command sent. No slot number avoids this; `headless: true` is the only clean-context guarantee.

---

## [Marketplace 10.2.0] - 2026-08-26

### Fixed

- **`multimodel` v3.10.0**: the run monitor mis-counted every turn that straddled a
  poll, and could report a healthy model STALLED. It fed the parser each newly-read
  slice of the debug log, but a turn is a request line plus a later completion line —
  claudish writes lines as they happen and the monitor polls every 3s, so a split is
  the normal case. The request half counted as a retry forever, the completion half
  was discarded, and three phantom retries trip `RETRY_STALL_COUNT`. It now derives
  from the whole log rather than accumulating per slice, so split-vs-whole equality
  holds by construction. Measured ~9.5ms/MB, linear.
- **`multimodel` v3.10.0**: eight further parser and monitor bugs. An unclosed JSON
  block swallowed the rest of the log; multi-line JSON joining stopped at the first
  *nested* `}`, silently dropping every field after it; a second `Tool calls:` line
  overwrote the first; `time_to_first_tool_ms` reported the containing turn's
  duration rather than elapsed-from-start; clock skew summed negative durations into
  the totals; `--models ","` monitored nothing and exited 0 with
  `"all_completed": true`; a rotated or truncated log was skipped forever; and a
  model reconnecting to a second log file was read from the first file's offset.
- **`dev` v4.6.1**: the `claudish-in-main-bash` coaching rule advised running
  claudish inside a sub-agent via the Agent tool — coaching a banned pattern at the
  moment someone hit it. `/dev:setup` carried the same stale routing row and *writes
  it into a user's CLAUDE.md*, so it would have reseeded the rule into every
  provisioned repo. The `architecture` skill never routed to
  `references/adr.md`, leaving 926 lines off the listing by design and off every
  read path by accident.

### Changed

- **`claudish` v1.1.0**: ships the `claudish-usage` skill and the model resolver.
  Both moved out of `multimodel`, which repairs a dead reference: `seo` publishes to
  `magus-marketing` and cites the skill, but `multimodel` publishes only to `magus`,
  so on that channel `seo` pointed at a skill that was not installed. The resolver
  had to move with it — the documented command is
  `bun "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-models.ts"`, and `CLAUDE_PLUGIN_ROOT`
  expands to the owning plugin's root.
- **`claudish` v1.1.0**: `claudish-usage` is rewritten MCP-only, 1518 → 812 lines.
  The CLI is no longer a supported way to run a model anywhere in the marketplace.
  Seven CLI references remain, all four read-only diagnostics — `--probe`, `--help`,
  `--version`, `--models`.
- **`multimodel` v3.10.0**: `claudish-usage` and `resolve-models.ts` now come from
  the `claudish` plugin. Its dependency floor moves from `^1.0` to `^1.1`, because
  claudish 1.0.2 does not carry them. Six skills that still described the old
  "internal → Agent, external → team MCP" split were corrected.
- **`code-analysis` v5.4.3**, **`seo` v2.1.2**: references updated to
  `claudish:claudish-usage`.

### Why

Two parsers read the same claudish debug log — one drives a live `/team` run's stall
detection, the other reports a bench's metrics — and nothing kept them in step. A
parse fix landed in one copy only would make them disagree about the same file.
`scripts/check-parser-sync.ts` fences the shared logic with markers and requires that
region byte-identical; whole-file comparison is impossible because one copy has a
CLI the other must not have. Wired into pre-commit and `release.sh` step 1dc.

`tests/integration/skills/` imported `yaml`, which was absent from `package.json`.
Four of five files died at import and 113 of 147 tests stopped being *counted* — not
failed, absent. Behind that the suite had rotted to 21 failures. `plugins/multimodel/`
had zero test files; `autotest/monitor/` was 28 pass / 28 fail against a hardcoded
path to a checkout that does not exist. Now 147, 89 and 67 respectively, with
`.github/workflows/test-skills.yml` enforcing size floors — the historic failure was
a suite that got smaller while staying green, and `bun test` exits 0 for that.

### Migration notes

Run `bun scripts/install-hooks.ts` after pulling: `pre-commit` gained the parser-sync
check. `core.hooksPath` lives in the shared `.git/config` and applies to every
worktree at once.

---

## [Marketplace 10.1.0] - 2026-08-26

### Fixed

- **`dev` v4.6.0**: registered skills go from 9 to 43 — the 34 nested under
  `skills/<category>/<name>/` had been unreachable for eight months, answering `Unknown skill`,
  the same string a skill that was never written returns. Agents (13) and commands (15) unchanged.

- **`code-analysis` v5.4.2, `multimodel` v3.9.1, `seo` v2.1.1, `designer` v0.5.3,
  `terminal` v4.1.7, `gtd` v2.1.1, `kanban` v1.6.2, `browser-use` v1.7.3**: plugin manifest moved
  to `.claude-plugin/plugin.json`, the only location Claude Code's runtime loader reads. Component
  counts are unchanged — none of these nested their skills — but the manifest is now actually read.

- **`setup` v1.1.1, `statusline` v3.0.1, `go` v0.1.2, `dingo` v1.0.2, `madbench` v0.2.4,
  `image-generate` v3.1.1, `video-editing` v1.2.2, `instantly` v2.0.2, `autolinear` v0.4.2,
  `claudish` v1.0.2**: the same manifest move, with no change to what each registers.

- **`bunjs` v0.4.2**: the same manifest move, and additionally dropped a `["./commands"]`
  declaration — the default directory by another spelling, which would have registered zero
  commands once the manifest was actually read.

- **The manifest location was the whole bug.** Every plugin kept `plugin.json` at the plugin root,
  which is read at install time only. With no manifest at the location the runtime reads, the
  loader falls back to a convention scan that reaches exactly one level under `skills/`. An
  enumerated nested path in the root manifest was real and simply never seen.

- **Moving the file was only half of it — the move alone silently broke agents**, taking `dev` from
  13 to 0. Once a manifest is actually read, a field naming a **default** location REPLACES the
  auto-scan instead of adding to it: `agents`, `commands` and `hooks` each register zero (`hooks`
  also reports `Duplicate hooks file detected`). `skills` is the documented exception and is
  additive, which is the only reason nested paths can work at all. 18 manifests were trimmed of
  declarations naming default paths.

- **`tools/magus-harness` would have shipped a Claude manifest inside every Codex plugin.**
  `codex-dist.ts` excluded the old manifest path from the output copy — a check that fails
  silently. Fixed, plus a guard in `codex-plugin-spec.ts` that rejects a `.claude-plugin/` directory
  in Codex output. Its own test fixture still wrote the pre-move shape, so the build threw `ENOENT`
  the first time it ran; fixture corrected, and the silent half now has an assertion.

- **`skills/release/scripts/apply.ts` overwrote the marketplace `description` with the release
  note.** CLAUDE.md documented this as already fixed; it was not. Preparing this release, it
  proposed replacing dev's description with `"FIX: move every manifest to .claude-plugin/…"`. It
  also drifts `marketplace.json` out of parity with `plugin.json`, which `validate-versions.js`
  fails. Versions only now — release notes keep their three legitimate homes: the commit subject,
  the tag message, and this file.

- **`scripts/check-skill-reachability.ts` encoded a rule this release disproves.** It treated every
  `depth > 1` skill as unregistered, stating the failure happens "even when plugin.json enumerates
  the nested path explicitly" — true only while the enumerating manifest sat where the runtime never
  reads it. The rule is now what the loader does: depth 1 registers by auto-scan, deeper registers
  **iff** `.claude-plugin/plugin.json` enumerates the path. `UNREGISTERED` drops 34 to 0, which
  makes `--strict` gateable for the first time.

### Added

- `scripts/check-plugin-registration.ts` — installs this repo as a real local marketplace into an
  isolated `CLAUDE_CONFIG_DIR` and compares registered components against disk, per plugin. 20/20
  pass. It takes counts from `claude plugin details` but gates the verdict on `claude plugin list`,
  because those two answer different questions.

### Why

  This was documented, not discovered. Anthropic's plugins reference carries a warning naming the
  exact mistake, and CLAUDE.md has said the same since January. The rule was written down twice and
  shipped against for eight months, because everything kept working: every routing row in CLAUDE.md
  names a **file to read**, and reading a file needs no skill registry. Those rows survived
  precisely the failure they pointed into.

  The trap that cost three retractions on the `dependencies` question alone: `claude plugin details`
  reports what a manifest **declares** and will list every component of a plugin that failed to
  load, while `claude plugin list` reports what actually **loaded**. Never verify loading with
  `details`.

### Migration notes

  **The real per-turn skill listing cost went up, and that was predicted.** Those 34 skills were
  already charged to `skill-budget-check.ts` while never reaching a listing; registering them turned
  1,530 theoretical chars into real ones. The corpus now costs **10,329 chars** against a runtime
  budget of 8,000 at 200k context — over by 2,329, so descriptions are shortened to fit until the
  corpus is trimmed. A larger context window raises the budget (`context × 4 × 0.01`), so it fits
  from 259k tokens up.

  Nothing to do on upgrade. `dev` depends on `claudish`, `mnemex` and `multimodel` — an unsatisfied
  dependency makes the **whole plugin** fail to load, so ship them together.

  `mnemex` is deliberately absent from this release: v1.0.2 is already claimed by in-flight work on
  another branch. It has no components (README and manifest only), so the move is cosmetic for it
  and nothing is withheld by waiting.

---

## [dev 4.6.0] - 2026-08-26

### Changed

- **`/dev:dev` Phase 3 now designs the architecture under plan mode, behind an
  `ExitPlanMode` gate.** Stack detection and the architect return their work in
  context instead of writing it, the orchestrator stages the design in the session's
  plan file, and you approve it before any file exists. `dev:architect` gained an
  explicit output contract: write to a caller-supplied path, or return the document
  when no path is given.

- **Everything file-bound moved after that gate, because it cannot run before it.**
  `claudish team` requires a `path` and writes each model's output into it, so
  multi-model review has no file-free form; `dev:test-architect` may read
  `architecture.md` and nothing else, which is the boundary keeping tests black-box;
  and `phase-completion-validator.ts` still demands all three Phase 3 artifacts.
  `context.json` and `architecture.md` are materialised from the approved design, then
  review runs as before. Phases 4-8, the validator and test isolation are untouched.

- **After approval, Phase 3 offers to raise the permission mode rather than raising
  it.** A plugin cannot: `setMode: "bypassPermissions"` is rejected unless the session
  was launched with `--allow-dangerously-skip-permissions`, and `auto` depends on gates
  a command cannot see. The user gets a one-line shift+tab hint and keeps the decision.

### Why

Planning that can write to the repo is not planning. The gate that mattered — approve
the design before code exists — was a convention Phase 3 asked the orchestrator to
follow; it is now enforced by the harness.

---

## [multimodel 3.9.1] - 2026-08-26

### Fixed

- **`hooks-system` described `PermissionRequest` as read-only.** It is the only hook
  event that can change the session's permission mode, via `updatedPermissions`, and
  it can also allow or deny the call and rewrite tool input. The table row, the two
  "PreToolUse is the only hook that can block" claims, and a "7 Hook Types" heading
  above eight entries are all corrected.

- **Added the `setMode` payload and its four constraints**, each measured against a
  live session: `updatedPermissions` is read only on the `allow` branch; the trigger
  must genuinely require permission (`echo` is auto-approved, so the hook never runs);
  an entry in `permissions.allow` silently disables the hook; and `bypassPermissions`
  cannot be granted this way. Clearing plan mode via `setMode: "default"` bypasses the
  `ExitPlanMode` approval gate entirely, which the section now says plainly.

---

## [code-analysis 6.0.0] - 2026-08-22

### Changed

- **The plugin now owns its search interface instead of borrowing one.** A new MCP server
  (key `ca`) exposes one always-present tool, `code_search`, plus five structural tools —
  `find_dependencies`, `find_dependents`, `call_tree`, `find_implementations`, `impact` —
  that appear **only when the configured engine genuinely supports them**. Absence means the
  engine cannot answer that class of question, not that it would be approximate. Six engines
  are supported behind one port; the engine is named in project settings and is swappable.

  Measured on the live server: **1 tool and ~237 tokens per turn with no engine configured,
  5 tools and ~835 with a graph engine**, against **33 tools and ~5,061 tokens** for the
  surface this replaces. A 21x reduction in what enters every turn.

- **Skills go 4 to 3** — `code-search`, `investigate`, `deep-analysis`. The listing budget
  this plugin spends drops from 771 to 575 characters.

- **The `detective` agent is read-only, and now says so.** It previously walked the user
  through a rename mutation while being dispatched as read-only investigation.

### Removed

- **The `mnemex` dependency.** The plugin no longer requires any particular search engine.
  `mnemex` remains installable on its own for anyone who wants its full tool surface.
- **All mutation.** No rename, no edit, no index management, no persisted opinion.
- **`mnemex-search` and `mnemex-orchestration`**, whose premises died with the coupling: one
  manualled 33 tools with version gates, the other worked around expensive CLI invocation
  that a resident server makes free.

### Fixed

- **An empty result no longer reads as "no matches".** The engine could report a healthy
  index while holding zero files and return `{"results":[],"totalMatches":0}` with no error.
  Four separate protections routed past that state. The adapter now checks indexed-file
  count and last-indexed time, and attaches a machine-readable note to the answer.
- **Guidance that authorised deleting code.** One rule read "low PageRank + dead = safe to
  remove", on a signal that the same corpus elsewhere says has three meanings — entry point,
  dead code, or a dynamic call. Replaced with the three-reading rule plus the export check.
- **Fallback protocols that ended in a question no one could answer.** Three skills
  terminated in an interactive prompt using a tool that does not exist inside a subagent,
  which is where those skills run. They now return a BLOCKED result for the orchestrator.
- **Documentation naming eight tools that never existed**, two wrong install commands, and
  four contradictory rules about whether text search was permitted.

---

## [mnemex 1.0.2] - 2026-08-22

### Changed

- **Description corrected.** It claimed to be required by `code-analysis` and `dev`; neither
  depends on it now. It is an optional engine behind the `code-analysis` facade, and remains
  directly installable for its full tool surface.

---

## [designer 0.5.2] - 2026-08-24

### Fixed

- **An external design review was verified by reading a file claudish never writes.**
  `agents/ui.md` and `skills/design-references/SKILL.md` both instructed "Read result
  file and .exit file to verify success". `.exit` files belong to a pre-MCP claudish;
  the current source writes none anywhere, so that half of the check could never fire
  and a failed review was distinguishable only by the result file being absent. Both now
  verify from `create_session`'s `completed`/`failed` channel events plus `get_output`,
  then confirm the review file exists.

---

## [dev 4.5.0] - 2026-08-24

### Fixed

- **Phase 5 wrote an internal review that nothing checked.** Step 5.5 persists
  `reviews/code-review/claude-internal.md` exactly as phase 3 does, but only phase 3
  listed it in `PHASE_ARTIFACTS`. A `dev:reviewer` that returned without persisting left
  the phase passing on `consolidated.md` alone — and the consolidation is written by a
  different agent, which cannot distinguish an absent review from an empty one. Phase 5
  now requires it at the same `minSize` and `patterns` as phase 3.

  **This tightens a gate.** A phase-5 session that genuinely produced no internal review
  will now be blocked where it previously completed. The guard was mutation-tested:
  removing the requirement turns the new test red, so it is checking what it claims to.

- **`/dev:fix`'s two vote panels accepted a vote that was never cast.** Both `team` calls
  now pass `require_pattern="VERDICT:"`, so a model that finished without emitting the
  vote schema is reported FAILED rather than handing prose to the parse step. The parse
  step's "malformed → ABSTAIN" rule was the only guard, and it depended on the
  orchestrator remembering to apply it.

  The internal vote is an `Agent` and is still not covered by `require_pattern` — both
  read-results steps now say so explicitly, because an absent internal vote must fall
  through to ABSTAIN and must never be counted as agreement.

- **Phase 3 and phase 5 `team` calls now pass `min_output_bytes=400`.** A slot that
  exited 0 having produced nothing previously entered the consensus count as a reviewer
  that found no issues — which reads as agreement.

- **The `agent-coordination` reference snippet taught the unguarded call.** It showed a
  bare `team(...)` with no shape check and no native slot; both fixed, since a reference
  is what the unguarded form gets copied from.

---

## [multimodel 3.9.0] - 2026-08-24

### Fixed

- **The internal reviewer's vote was never validated.** `/team` dispatched it as a
  background `Agent` writing `{SESSION_DIR}/internal-result.md`, and nothing checked that
  file. A reviewer that answered without producing a vote block was counted as having
  voted — so the one slot on the panel that could fail silently was the slot this plugin
  calls "your safety net". It now runs as a slot inside the `team` call, covered by
  `require_pattern`. Measured both directions: a native slot that votes reports
  `1 done, COMPLETED`; one that does not reports `1 failed, EMPTY, reason shape_mismatch`.

- **"`internal` is NOT a real model — never pass it to claudish" was right about the
  symptom and wrong about the cause.** `internal` and `default` are Claude Code
  *selectors*, not model IDs: Claude Code rejects them while accepting the tier they
  select. claudish never translated the selector, so `--model internal` failed, and `/team`
  grew a CRITICAL rule to turn a cryptic failure into a clear one. That guard also rejected
  `opus`, which works, and threw for the WHOLE models array, so one native name killed an
  entire run. claudish 7.65.0 normalises the selector at its `--model` boundary. Verified
  against the published binary: `claudish --model internal -y --stdin --quiet` exits 0,
  where before 7.65.0 it exited 1 with `[claude-code:unrecognized_model]`.

### Changed

- **One `team` call instead of two dispatches.** Step 2 no longer issues an `Agent`
  alongside the tool — the tool parallelises every model internally. The
  `internal-result.md` handoff is gone, and with it the ceremony that existed only to
  coordinate two mechanisms.

- **`agent` and `require_pattern` travel as tool arguments.** Since claudish 7.65.0 both
  `team` and `create_session` take a first-class `agent`, plus a `claude_flags`
  passthrough. `/delegate` passes `agent` directly instead of appending `--agent` to
  `claude_flags`. `agent` applies to EVERY child in a run; there is no per-model form,
  which for a blind panel is the correct shape — every voter reviews by the same method,
  so a vote difference reflects the model rather than the prompt.

- **`/delegate` still skips `internal` when choosing an UNNAMED default, for a different
  reason.** Not "it cannot run": it can, and `/multimodel:delegate internal <task>` works.
  `defaultModels` is the `/team` panel roster, so honouring its `internal` here would send
  a bare `/multimodel:delegate <task>` to the model the caller is already running. The
  behaviour is unchanged; only its stated rationale was wrong.

- **The session layout in `session-isolation` matched no released version.** It showed
  `grok-result.md` / `gemini-result.md`; `team` writes `response-{ID}.md` named by
  ANONYMOUS id, with `manifest.json` holding the mapping. Naming a response after its model
  de-anonymises the panel before the verdict, so that diagram was not merely stale.

- **`MCP_SCHEMAS` in `scripts/lib/plugin-rules.ts` was four parameters behind claudish.**
  Rule MC-01 pins the `team` / `create_session` / `run_prompt` parameter sets, and its copy
  stopped at claudish 7.48.0 — so it rejected `require_pattern` and `agent` as invented and
  failed correct instructions. Updated to 7.65.0, with a note that a failure there may be
  the table's fault rather than the call's. MC-01's self-test changed too: it used
  `claude_flags` as its example of an invalid `team` parameter, which `team` now accepts,
  so the rule would have quietly stopped firing.

- **`deep-analyst` hand-validated each returned slot because the parameter did not exist.**
  3.7.1 removed `require_pattern` from its `team` call for exactly that reason. Restored.

- **Two skill examples still showed an unguarded call.** `proxy-mode-reference`'s
  "✅ CORRECT" line and `error-recovery`'s retry snippet both passed no shape check —
  and a snippet labelled CORRECT is exactly what gets copied. Both now pass
  `require_pattern`, and the error-recovery note says a slot reported EMPTY with reason
  `shape_mismatch` is a failure to recover from, not a short answer to accept.

### Why

Reported from a live `/team` run that announced it was dispatching "the internal reviewer,
which claudish can't run and so goes as a parallel agent" — in a session whose
`require_pattern` demanded a vote block, which the internal slot was structurally exempt
from. Exit code 0 is not a success oracle: it is 0 on API errors and on a child that simply
never followed the format, which is why the shape check has to reach every slot rather than
all-but-one.

Evidence, measured commands and the git archaeology on the claudish guard are in the
claudish repo at `ai-docs/reports/native-team-slots.md`, shipped in v7.65.0.

---

## [madbench 0.2.3] - 2026-08-22

### Fixed

- **`madbench list` catches a retired `sandbox:` level now, and the skill said it did not.**
  Level validation moved upstream out of the configurator and into the loader
  (`validateSandboxLevels`, called from `finishBenchSpec`), so every command that reads a bench
  file refuses `process`, `machine`, `docker` and any unknown spelling identically — `list`
  included. The `list` vs `preflight` capability table still marked that row **no** for `list`,
  advising the opposite of what the tool does. The surrounding rule is unchanged and still
  correct: `list` is not your gate, because it misses everything else in that table.
- **`debugging.md` opened on the same invalidated example** — "`madbench list` on a bench with a
  retired `sandbox: process` level prints the bench and exits 0". It now names failures `list`
  genuinely misses: a `testdata:` directory that is gone, a harness binary that is not
  installed, a check `type:` that does not exist.
- **The skill's eval suite named a path that exists on one machine.** Eval 0's prompt sent the
  agent to `repo at /Users/jack/mag/madbench`, so the scenario was unreproducible for every
  other user, and it told them to run the deprecated `madbench run` rather than the bare
  command. Both corrected.

### Added

- **The load-vs-machine boundary, stated once under the table** so it survives the next upstream
  change. Anything that makes a bench file malformed — an unknown key, a bad metric declaration,
  a retired `sandbox:` level — is a load error every command refuses. Anything about this
  machine — binaries, keys, images — is preflight's job alone.

---

## [browser-use 1.7.2] - 2026-08-22

### Fixed

- **Shutdown left the profile directory behind on Linux.** Cleanup terminated the browser
  process and waited only for that one PID, but Chrome's network service is forked from the
  zygote and is a *grandchild* of the browser, so it outlives it by milliseconds — still
  flushing `Default/Trust Tokens`, `Default/Shared Dictionary/db` and `Network/Cookies` into
  the directory being deleted. `rmtree` walks bottom-up, so a file written back into a
  directory it had already scanned made the closing `rmdir` fail with `ENOTEMPTY`, which
  `ignore_errors=True` swallowed, and `os._exit` followed immediately with nothing left to
  retry. A one-millisecond race became a permanent ~50MB leak. macOS never showed it, because
  there the browser process does not exit until its children have.

  Shutdown now snapshots the browser's whole process tree *before* anything kills it — upstream
  clears the subprocess handle on kill, so the snapshot has to come first — then waits, with a
  bound, for the tree to be gone. Removal verifies the directory is actually gone and retries
  within its own bounded window instead of trusting a silent `rmtree`. Every wait ends on its
  condition; measured shutdown cost went from 13-37ms to 22-110ms.

  Measured on Linux before the fix: a helper was still alive in 4 of 6 shutdowns, and in 3 of 6
  a live process held files inside the directory when removal began — every one of them the
  network service. On macOS, 0 of 5. The full suite failed 2 runs in 13 before the fix and 0 in
  36 after.

---

## [browser-use 1.7.1] - 2026-08-22

### Fixed

- **The server survived SIGTERM.** Its signal handler ran cleanup and then called `sys.exit(0)`,
  which raises `SystemExit` on the main thread and waits for every non-daemon thread — and the
  MCP stdio reader is parked in a blocking `read()` that a signal does not interrupt. Chrome
  died, the profile directory went, and the server itself stayed resident forever. Under Claude
  Code the stdin pipe usually closes at the same moment, which hid it; a bare SIGTERM stranded
  one server per session. Found by the new lifecycle suite, which had to force-kill every server
  it started.
- **The reaper no longer follows a symlink out of the profiles directory.** Ownership is decided
  by resolved-path equality, so a symlink planted in the profiles directory and named
  `<prefix><dead-pid>` made a browser running on the link's *target* compare equal — the user's
  real Chrome included. The directory contents were safe, because `rmtree` refuses a top-level
  symlink, but the process would have been terminated. Symlinked entries are now skipped.
- **Profile ownership is decided by full path equality alone.** The matcher also accepted a
  value whose last three segments were `browseruse/profiles/<name>`, which matched a browser
  under a different `$HOME` — another account, a container mount — running the same profile
  name. That rule existed only so the test fixtures could sweep a temp directory while building
  command lines under `$HOME`; the fixtures now use the directory they actually sweep, which is
  what production looks like.

### Added

- **A browser lifecycle test suite that uses a real browser.** Everything guarding cleanup was
  mocked — `psutil.process_iter` patched, PIDs invented, no browser ever launched. The new
  suite starts real MCP servers and real Chromium processes and asserts the binary is
  Playwright's rather than the user's Chrome, the profile directory is created and named
  correctly, closing a session and terminating a server both reclaim it, the reaper kills a
  genuinely orphaned browser, and it spares one belonging to a live server — including the
  PID-prefix collision, with real processes rather than a patched process table. 11 tests, ~55
  seconds, and it fails the run if it leaks a process. It runs in CI against a real Chromium,
  and a skipped run is treated as a failure.

---

## [dev 4.4.2] - 2026-08-22

### Changed

- **`/dev:release` settles authorization once, up front — never mid-run.** If the request
  says "release yourself" (or `--auto`), the run goes to completion with every
  irreversible step reported; otherwise the command asks one question before starting
  and then runs on that answer. Mid-run stops are now only failed gates and consistency
  incidents, never permission. The PR remains the durable record, not a second approval.
  Replaces the 4.4.1 pre-authorization wording, which still allowed a merge-time gate.

---

## [dev 4.4.1] - 2026-08-22

### Added

- **`/dev:release` learned the two rules its first live run exposed.** Tag collision:
  when a local tag of the release name already exists pointing elsewhere (tags are shared
  across worktrees, so a sibling session's prepared batch collides), origin decides — if
  origin lacks the tag, push the correct annotated tag via a temp ref without touching the
  sibling's local tag and report the retarget command; if origin holds it at a different
  SHA, the number is burned: renumber to the next free version and re-release, never
  force-retag. Version-collision rule stated generally: first-to-origin wins the number.
  Pre-authorization: "release yourself" / "--auto" at invocation now counts as batch
  approval for the merge and publish gates — each irreversible step is still reported,
  and consistency incidents still hard-stop; the authorization covers that run only.

---

## [dev 4.4.0] - 2026-08-22

### Added

- **`/dev:release` — a phased release command for any project.** Takes finished work from
  "code is written" to "version live and verified": read-only preflight (worktree residue,
  three-way dependency check, credential rehearsal, blast radius), version + changelog on a
  release PR, merge as the approval boundary, explicit-ref tagging on the merge SHA,
  CI-owned publishing, then verification against the public registry rather than local
  state. Detects the project's own release machinery first (documented process,
  release-please/changesets/goreleaser/cargo-release, release CI) and drives it instead of
  reimplementing it. Built for worktree-based work: promotes gitignored session knowledge
  into `docs/` and `ai-docs/` before the worktree is reaped, and ends every run with a
  "safe to remove this worktree" verdict. Resume after partial failure recomputes state
  from the remotes — every side effect is a predicate + action pair, so a re-run skips
  what exists, does what is missing, and hard-stops on anything that exists but differs.

### Why

- Designed from a three-reviewer research pass (unanimous REJECT of the naive
  commit→test→push→merge→release sketch) over release-please, changesets,
  semantic-release, cargo-release, npm staged/trusted publishing, SLSA and Keep a
  Changelog; the full design record is `docs/plans/2026-08-22-release-skill-redesign.md`.

---

## [browser-use 1.7.0] - 2026-08-22

### Fixed

- **The orphan reaper could terminate the wrong browser.** It decided what to kill with a
  substring test against the process cmdline, and profile directory names end in a PID, so one
  name is a string prefix of another's: sweeping a dead server at PID `123` matched — and
  terminated — the live browser of PID `1234`. Both naming conventions were affected. It now
  extracts the `--user-data-dir` argument and compares normalised paths for equality, handling
  both `--user-data-dir=<path>` and `--user-data-dir <path>`, trailing slashes and `..`
  segments, and ignoring non-absolute values. This hazard predates v1.6.0, but moving the
  reaper onto a 120-second cadence turned a rare collision into a recurring one.

### Added

- **The reaper sweeps profile directories created before v1.5.0.** v1.5.0 renamed the
  convention to `browser-use-user-data-dir-session-<pid>`, so a `session-<pid>` directory left
  by an older server that was killed before it could clean up after itself had nothing left
  that would ever remove it — roughly 50MB stranded permanently. The reaper is now generalised
  over both names in a single pass, with the same guards: dead owner only, `default` never
  touched, non-numeric suffixes skipped.
- **CI now runs the browser-use test suites.** `test-plugins.yml` validated shared deps, the
  marketplace format and the multimodel resolver, but never executed a single browser-use test
  — the suite that guards which browser binary gets launched. Blocking the `browser_use` import
  locally produces 13 errors and a failure, so the new job installs the dependency for real. It
  skips `playwright install`: every binary-resolution test builds a fake Playwright cache in a
  temp directory.

---

## [browser-use 1.6.0] - 2026-08-22

### Fixed

- **The idle-cleanup loop was never running.** `browser_use`'s MCP server starts it from
  `BrowserUseServer.run()`, and this plugin's `main()` bypasses `run()` to own its stdio
  wiring — so `_start_cleanup_task` was never called. Sessions never expired, browsers were
  never closed after going idle, and a `session_id` stayed valid for the multi-day life of the
  server. `main()` now starts the loop, so the upstream 10-minute idle timeout takes effect.
- **Profile directories are freed when the browser dies, not only at process exit.** Removal
  used to live solely in `_shutdown_sync`, so a browser closed mid-session left its profile
  behind — around 50MB each — until the Claude Code session ended, which can be days. The
  directory is now released as soon as the last browser session for that server is closed, and
  never while a session is still live.
- **The orphan reaper runs periodically, not only at startup.** On a machine where no new
  server launches, nothing was ever swept. It now runs on the same 120-second cleanup cadence,
  still matching only the exact `--user-data-dir` of a dead owner and still sparing live PIDs
  and the `default` profile.

### Added

- **The server exits when its parent process dies.** A `claude` session killed with SIGKILL
  used to strand its MCP server, which then never ran shutdown, so its browser and profile
  directory survived indefinitely. The server compares `os.getppid()` against the value
  captured at startup and, on reparenting, runs the full shutdown path before exiting.

### Changed

- **Cookies and login state in an idle browser are now discarded after 10 idle minutes**,
  rather than persisting for the life of the session. Call `browser_export_session` when a
  login completes rather than at the end of a workflow.

---

## [browser-use 1.5.0] - 2026-08-22

### Fixed

- **The plugin no longer launches your real Chrome.** It resolves Playwright's Chromium
  itself and pins it as `executable_path`, which upstream honours ahead of its own binary
  search. Previously the plugin only expressed the preference as `channel="chromium"`, which
  upstream treats as a soft hint: its macOS patterns still glob for the `Chromium.app`
  bundle Playwright renamed to `Google Chrome for Testing.app`, so every candidate missed and
  the search fell through to `/Applications/Google Chrome.app`. On macOS that takes over the
  `com.google.Chrome` single-instance slot, so clicking your own Chrome icon reopened the
  automation window instead of your profile. The fall-through was latent on Linux and Windows
  too, for any machine without Playwright's Chromium installed.
- **A browser is never chosen implicitly.** With no Chromium installed the server now raises
  an error naming `python3 -m playwright install chromium` instead of silently substituting
  whatever browser it can find.
- **`browser_doctor` and the launcher can no longer disagree.** The doctor reports the
  resolver's own output plus its provenance (`chromium_source`: `env` / `playwright` /
  `error`). Its previous search ranked your explicit `CHROME_EXECUTABLE_PATH` last, behind
  four `PATH` lookups, then fell back to `/Applications/Google Chrome.app`.
- Newest Chromium is selected by integer revision, so `chromium-1234` beats `chromium-999`.

### Changed

- **`CHROME_EXECUTABLE_PATH` is now the launch override, not a hint.** Set it and that exact
  binary is launched. It must name an existing file — a path that does not exist, or a
  directory such as `/Applications/Google Chrome.app` rather than the binary inside the
  bundle, is an error rather than a silent fall-back. An override outside Playwright's cache
  logs a stderr advisory, so automation driving your real browser is never invisible.
  `.env.example` previously offered the real-Chrome path as its example value.
- **Session profile directories are now named
  `~/.config/browseruse/profiles/browser-use-user-data-dir-session-<pid>`.** Pinning
  `executable_path` makes upstream copy the profile into a temp directory, which would blind
  the orphan reaper that cleans up browsers left by dead sessions; the new name suppresses
  that copy. Profile directories left by an earlier version are not reaped.

---

## [setup 1.1.0] - 2026-08-22

### Fixed

- The plan-limits section reappears, along with both reset countdowns and the token
  count. Three separate breakages, all from Claude Code's status JSON changing shape
  under a script that still assumed the old one:
  - `rate_limits.*.used_percentage` is now a float (`56.99999999999999`). Every
    downstream `[ -ge ]` and `$(( ))` is integer-only, so each one failed with
    "integer expression expected" — **and the script still exited 0**, so the entire
    allowance window simply stopped rendering with no visible error. Rounded at the
    jq boundary now.
  - `context_window.current_usage` is now an object of token buckets, not a number.
    `tostring` turned it into `{input_tokens:2,…}`, which reached arithmetic and
    killed the `797k/1M` display. Summed from the three input buckets now; output
    tokens are excluded because they are not resident in the window.
  - `rate_limits.*.resets_at` is now a Unix epoch integer, not ISO 8601. Parsing it as
    ISO returned nothing, silently dropping both `↻` countdowns. Both forms accepted.
- The statusline stops wrapping terminals that had room. The wide-glyph count used a
  bracket expression, `${s//[🤖⚡]/}`, which looks like a character class and is a
  **byte** class: it deletes any byte occurring in either glyph's UTF-8 encoding. 🤖 is
  `F0 9F A4 96` and ⚡ is `E2 9A A1`, and `█` `░` `▀` all begin `E2` — so every block
  character in a bar was eaten and counted as double-width. The context bar measured 43
  columns instead of 30 and the plan bar 59 instead of 48, splitting lines on
  180-column terminals. Each wide glyph is now removed with its own full-string
  pattern.
- Statusline chips are readable on light terminals again. Every chip paired a fixed
  256-cube background with `\033[97m`, a base-16 palette slot the terminal profile is
  free to redefine — iTerm2's light profile maps it to `#3C3835`, a near-black. The
  worktree chip rendered near-black on `#AF5F00` (2.1:1) and the branch chip near-black
  on `#005F00` (**1.04:1, invisible**). Every colour in the script is now a 256-cube
  index, fixed on both halves of every pair, and all of them clear WCAG AA.
- A `%` in a branch or worktree name no longer corrupts the line. Output went through
  `printf "$OUT"`, so the string was its own format spec and `feat/100%-cov` rendered
  as `feat/100 ov`. Output is now `printf '%b'`, and the percentage segments write a
  literal `%` instead of escaping it.

### Added

- Light/dark appearance detection, resolved per render: `appearance` config →
  `$STATUSLINE_APPEARANCE` → `~/.config/tmux/theme` → tmux session-scope `COLORFGBG` →
  macOS `AppleInterfaceStyle` → dark. The forking probes are cached 30s.
- Wrapping to the terminal width, splitting on section boundaries. `$COLUMNS` carries
  the live width, and Claude Code prints every line the command emits. `wrap: "off"`
  keeps one line; `max_lines` caps the rows, default 0 for no cap.
- `plugins/setup/scripts/test-statusline.ts` runs every fixture through the script in
  both appearances at three widths and asserts each fixture's `expected_sections`.
  The fixtures already existed and nothing executed them, which is how the three
  parsing bugs above shipped together. It fails on non-empty stderr specifically,
  because all three exited 0 while printing errors. It also unit-tests `display_width`
  against known strings, because over-measuring breaks nothing visibly — the
  bracket-set bug passed a full render sweep untouched.
- `layout` config key: `auto` (default) keeps the line count minimal and uses the
  labelled gutter only when it costs no extra row, `aligned` always uses it once
  wrapping starts, `compact` never does.
- The worktree chip is tinted from its own name, out of an 18-colour palette per
  appearance. It was one fixed brown for every session since v2.0.0, which made the
  field naming the session the least distinguishable thing on screen with 20 worktrees
  open. The colour is stable across panes and restarts. Names can still collide: 18
  buckets is a palette, not a hash space.

### Changed

- The light palette is muted rather than near-black. The first cut used 22/23/94/124/90
  at 6-13:1 on cream and read as harsh; the segments now sit near 3.5-4.8:1, with cost
  and critical red held at the top of that band because they carry the numbers that
  matter.
- Bar fills use a separate vivid ramp from the text around them. Context runs
  green → amber → orange → red, plan bars keep a cool teal → blue → orange → red so the
  two stay distinguishable at a glance. A `█` run is a wide solid block, so saturation
  reads there without the glare it causes on thin text strokes — the percentage label
  beside each bar keeps the muted colour, since that is the part you read rather than
  scan.

### Why

An OSC 11 background query cannot work here: the statusline child has no controlling
terminal. stdin, stdout and stderr are all pipes and `/dev/tty` reports "Device not
configured", so there is nowhere to send the query and nothing to read back. Detection
is out-of-band instead.

The `$COLORFGBG` environment variable is deliberately never read. Claude Code inherits
it once at launch and freezes it — measured stuck at `15;0` (dark) through an entire
light session. tmux refreshes its own copy on each client attach, so tmux is asked.

---

## [Marketplace 10.0.0] - 2026-08-22

### Removed

- **BREAKING** — Retired the `style` plugin. Its ten communication style presets moved into
  claudeup (`tools/claudeup/src/data/styles/*.md`), where they are compiled into the binary
  and always present. The marketplace entry and `plugins/style/` are deleted; `/style:apply`
  and `/style:list` no longer exist. Remove `style@magus` from `enabledPlugins` and use the
  claudeup Styles tab (`9`) instead.

- **BREAKING** — Three composer capabilities go with it, and have no replacement:

  | Gone | What it did |
  |---|---|
  | `--global` | wrote the generated style and `outputStyle` under `~/.claude` instead of the project |
  | `--dry-run` | printed the composition without writing anything |
  | `--list --json`, apply `--json` | machine-readable output for scripting a composition |

  The Styles tab covers the interactive path and nothing else — `claudeup` has no `style` CLI verb,
  so there is no headless or agent-invocable way to author a composition any more. Composing for
  user scope, previewing before writing, and driving composition from a script are all unavailable;
  if you scripted against the `--json` interfaces, that automation stops working and no flag
  restores it. Headless *use* is unaffected: the committed `.claude/style.json` and the profile
  manifest's `outputStyle` still apply a style that was authored interactively.

### Why

  claudeup never shipped presets of its own: it discovered the plugin's `styles/*.md` on
  disk, so the Styles tab was empty for anyone without the plugin installed, and the same
  composition algorithm existed twice — `plugins/style/scripts/compose-style.ts` and
  `tools/claudeup/src/services/styles-manager.ts`. The split also had a failure mode with
  no owner: `/style:apply` wrote `outputStyle` live into `settings.json` and recorded it
  nowhere else, while `claudeup install` rebuilds that file from the profile manifest —
  so with a profile active, a style applied through the plugin was erased on the next
  install. One implementation, one copy of the presets, one place that records the choice.

---

## [multimodel 3.8.0] - 2026-08-19

### Fixed

- **`/multimodel:delegate` broke on an ordinary preferences file.** Step 1c took
  `defaultModels[0]` with no `internal` filter, and `internal` — the host Claude model — is
  never dispatchable. `/team` has carried that filter as a CRITICAL rule all along; this
  command did not. Any configuration listing `internal` first, including this repository's
  own, resolved the model to `internal` and handed it to claudish, which cannot run it. Now
  takes the first entry that is not `internal`. Found by a repo-reading reviewer on a
  six-model panel; no bench had caught it, because the bench stages a workspace with no
  preferences file at all.

### Added

- **A deterministic model fallback for non-interactive sessions.** With no model named and
  no usable preference, Step 1c ended at an `AskUserQuestion` that does not exist under
  `claude -p`, so the command stalled. New Step 1c.4 takes the first non-`internal` entry
  from the live `list_models` catalogue, **announces it with the override syntax**, and
  proceeds; Step 1c.5 fails legibly when the catalogue is unreachable.

  Ordered **after** the interactive question, not before — a single delegation has no other
  votes to balance a wrong pick, so an interactive user is still asked. The announcement is
  what makes this a documented default rather than a silent substitution.

- **`input_required` handles the same dead end.** Phase 3 forwarded it through
  AskUserQuestion too, so a delegated session that asks a question under `-p` would hang on
  an answer that cannot arrive. Fixing only Step 1c would have converted a free
  pre-dispatch stall into a **paid session stranded mid-flight**. It now cancels the session
  and reports the question.

- **One rule line separating the two concepts**: *resolution may default when nothing was
  named; recovery never substitutes a named model.* `NO AUTO-RECOVERY` is unchanged for the
  case it was written for.

### Why

Measured, not assumed. An 80-session benchmark (`benches/claudish-agent-routing`, two plugin
versions, `--repeat 20`) had `/team` dispatch **40/40** and `/delegate` **2/40**. The
asymmetry turned out to be provenance drift — `/team`'s fallback predates the live-catalogue
migration and `/delegate` never had an equivalent, with no design note defending the
difference.

The decisive detail is what the stalled agents did: two of them **invented a model argument**,
both recording `Model resolved: gemini → gemini-3.6-flash` against a prompt containing no
such word. An unspecified dead end produced fabrication, not caution.

Re-measured after the change, same 80-session design: `new` dispatched **20/20** against
`stale` **0/20** (Fisher p = 7.3 × 10⁻¹²), with 15 of 20 taking the strongest route — the
real agent definition rather than its name — against 1 in 40 before. Mean routing score
0.02 → 0.85.

---

## [Marketplace 9.3.1] - 2026-08-19

Housekeeping release shipping metadata and documentation drift for five plugins whose
content moved on main without a version bump — dist repos are force-rebuilt from the
whole tree on every publish, so this content already sat in them at the old version
numbers, invisible to updaters, which only react to a version change. Two more plugins
(`multimodel`, `madbench`) join with fixes the release gates themselves demanded.

### Fixed

- **`multimodel` v3.7.1**: `deep-analyst` no longer instructs a `team` call with
  `require_pattern` — the claudish tool has no such parameter (accepts mode, path, input,
  models, judges, timeout), so the call as written would be rejected. The output-shape
  mandate moves into the `input` prompt and the agent validates returned slots itself;
  caught by the new plugin rule catalog gate (MC-01) in release.sh Step 1df.
- **`browser-use` v1.4.1**: concrete model IDs purged from context-injected skill docs —
  `agent-model` now names placeholder roles (`LATEST_SONNET_MODEL` etc.) and defers live
  IDs to the `claude-api` skill instead of hardcoding names that go stale in context.

### Changed

- **`claudish` v1.0.1**: durable plugin description separated from release notes; stale
  `agentdev` references purged from README and description (that plugin was retired).
- **`mnemex` v1.0.1**: description rewritten as a durable capability statement instead of
  release-note phrasing.
- **`dingo` v1.0.1**: description rewritten; `dingo-developer` skill frontmatter slimmed
  to matcher-read fields only (unread `keywords:`, `version`, `plugin`, `updated` dropped).
- **`browser-use` v1.4.1**: new README — install, `browser_doctor` preflight, the ten
  Magus tools and six skills tabulated; trailing keyword lists dropped from five skills'
  frontmatter (the matcher never read them).
- **`kanban` v1.6.1**: new README — five columns, cycle-safe dependencies, WIP limits,
  priority indicators, install and command reference.
- **`madbench` v0.2.2**: the `--runs` deprecated-alias claim in the runners-and-sandbox
  reference now carries a dated live verification against `madbench --help` (2026-08-19),
  closing the EX-01 unverified-CLI-claim warning.

---

## [Marketplace 9.3.0] - 2026-08-19

Marketplace-wide agent-dispatch integrity release. A 5-member team panel
(4 external flagships + the internal reviewer) rejected the first cut and its
findings drove the final round; every fix below was re-verified after remediation.

### Added

- **`multimodel` v3.7.0**: new `deep-analyst` agent — multi-source deep investigation
  running parallel web, local-repo and delegated lanes (subagents + external models via
  claudish), consolidating into one source-cited report with agreements and conflicts
  marked. Also: the team-rules hook enforces again (its guard still tested the retired
  `Task` tool name after the matcher moved to `Agent`, so it fired and matched nothing),
  its whitelist now lists the 13 real dev agents (`dev:ui` removed), and the /tmp rule is
  scoped to vote-shaped prompts instead of denying every dispatch that names the harness
  scratchpad. New marketplace gate: `scripts/check-agent-dispatch.ts` (release.sh Step
  1b2) resolves every `Agent:` spec and `subagent_type` literal against declared agent
  names — hardened against bullets, bold, `Agent A:` forms, trailing tails and CamelCase
  fakes after the panel's fixture attack.

### Fixed

- **`dev` v4.3.0**: reproduction exit codes corrected in `/dev:fix` AND the
  systematic-debugging skill it loads (non-zero = reproduced; exit 127 = broken runner —
  branch restored); `run_in_background` restored on the k=3 vote fan-out (it is a
  documented Agent parameter; removing it would have serialized the votes); the debugger
  persists via Bash heredoc (it has no Write grant, and backgrounded agents return launch
  receipts); `/dev:doc` auto-fix now honours its own approval gate; `/dev:investigate`
  passes mode strings the target skill actually accepts (`bug`, `test`); `/dev:setup`'s
  routing table gains dev:reviewer/docs/frontend/test-architect; `/dev:help` stops
  hardcoding a stale version; the Strategy C name collision in systematic-debugging is
  resolved (workflow's becomes D); `check-index.sh` scans fence-aware (tracks fence
  character and length, reports unclosed fences instead of silently swallowing the rest
  of the file); the coaching no-background rule fires only on explicit
  `run_in_background: false` (omitted means background since Claude Code 2.1.198 —
  TEST-17b added, proven to be the only test that catches the regression); dispatch
  guidance in task-management relabelled so prose stops looking dispatch-shaped.
- **`code-analysis` v5.4.1**: four skill-as-agent dispatches corrected in
  mnemex-orchestration — `investigate` and `deep-analysis` are skills; the dispatches now
  target `code-analysis:detective` (with the skill named in the prompt) and
  `dev:synthesizer` for consolidation.
- **`designer` v0.5.1**: dispatch specs namespaced (`Agent: designer:ui`,
  `designer:design-review`) in commands and the design-references skill.
- **`seo` v2.0.1**: dispatch specs in alternatives/performance/review namespaced to
  `seo:analyst`, `seo:writer`, `seo:editor`, `seo:data-analyst`.
- **`video-editing` v1.2.1**: six dead `Task:` dispatch specs across
  transcribe/create-fcp-project/video-edit migrated to namespaced `Agent:` form
  (`video-editing:transcriber`, `video-editing:timeline-builder`,
  `video-editing:video-processor`).
- **`instantly` v2.0.1**: sequence and ab-test dispatch prose migrated from the retired
  `Task` tool name to `Agent`.
- **`autolinear` v0.4.1**: run command dispatch specs namespaced
  (`autolinear:task-executor`, `autolinear:proof-generator`).

### Why

96+ dispatch sites used bare agent names, 18 named agents that do not exist anywhere,
and one dispatched a skill as an agent. Bare names resolve by search across every
installed plugin — one `~/.claude/skills/` auto-load away from running the wrong agent —
and dead names fail only at runtime, in someone else's session. The panel also caught
the remediation's own regression (a blanket `analyst` remap put the SEO SERP analyst on
four codebase-analysis call sites; now `code-analysis:detective`) and a userdocs leak:
the catalog generator walked `.claude/.coaching` and `node_modules`, publishing links to
untracked local state. The generator now excludes local dirt, and the regenerated
catalog dropped the dirt-derived page (never in git).

---

## [dev 4.2.0] - 2026-08-19

### Added

- **Every one of the 88 entries in the architecture tree now cites real code** — 22 GoF
  patterns and 66 refactoring techniques, each mapped to a merged pull request or a
  maintainer's own words, in the new `references/real-world-examples.md`. Each was verified
  by opening the artifact: merge status from the API, diff read, licence decoded from the
  actual file rather than trusted from metadata.
- Sources are marked for reuse. GitHub's licence field was wrong on 4 of 11 repositories
  checked, and two projects relicensed *after* the commit cited, so licences are read at the
  merge ref. Anything we can cite but not copy is flagged.
- Method notes for extending the set: search the code shape *after* a change, never the
  catalogue name. Eight refactoring names have had their vocabulary captured by other
  domains — "flag" by command-line arguments, "push down" by database optimisation, "hydrate"
  by server-side rendering, and five more — so searching them returns noise, not absence.

### Fixed

- **`memento.md` described how Redux time-travel works, and was wrong.** It replays the
  action log through the reducer; it does not store snapshots. Redux's own undo guide cites
  Command, and never uses the word "memento".
- **`mediator.md` asserted Redux and Zustand as mediators with no source.** Redux's docs use
  "middleware" 31 times and "mediator" zero; for Zustand there is no source at all.
- **`decorator.md` and `chain-of-responsibility.md` gave the same example two verdicts.**
  Both now agree, and both record that middleware is arguably its own pattern, descended from
  Intercepting Filter. The claim that Wikipedia and refactoring.guru use incompatible tests
  does not survive reading either page — each concedes the other's position.
- **`decorator.md` called TypeScript's `@decorator` "unrelated to the GoF pattern".** TC39's
  proposal explicitly claims it; Python's PEP 318, where the syntax originated, explicitly
  disclaims it; TypeScript takes no position. Softened to reflect the disagreement.
- **`refactoring.md` contradicted itself on catalogue edition**, citing the 1999 book in one
  section and the 2018 book in another. Fowler published a fate table for all 68
  first-edition refactorings — 29 kept, 28 replaced, 11 absent. Ten of our names are ones he
  dropped; three more carry server-side redirects to their successors. Recorded, with the
  caveat that he never explained why, so any causal story is inference.

### Why

Every worked example in this tree was one we invented. That is correct for teaching a single
technique in isolation and wrong for teaching judgement: a reader learns the mechanics but
never sees the technique in code they recognise. Real examples also proved the text wrong in
four places, which invented ones never would have.

Worth recording: seven techniques were declared "verified absent" by agents that had genuinely
searched — Bridge, Abstract Factory, Memento, Hide Method, Replace Parameter with Query,
Remove Control Flag, Replace Delegation with Inheritance. All seven were later found. Bridge
sat in Java's AWT the whole time, unlabelled: `"Bridge pattern"` appears zero times in all of
OpenJDK. An absence verdict is a hypothesis about vocabulary, not about the world.

---

## [Marketplace 9.2.0] - 2026-08-18

Agent-tooling correctness, and the first results from benching our own instruction text
against a real harness. Every behavioural claim below was measured on a madbench v0.10.0
binary, not inferred.

### Changed

- **`seo` v2.0.0**: BREAKING — five agents lost their plugin-name prefix, so their
  addresses changed (`seo:seo-writer` → `seo:writer`, and four more). Anything naming an
  old address stops resolving.
- **`instantly` v2.0.0**: BREAKING — three agents lost their plugin-name prefix
  (`instantly:instantly-campaign-analyst` → `instantly:campaign-analyst`, and two more).
- **`designer` v0.5.0**: BREAKING — `ui-design-review` is gone, merged into `ui-analyse`,
  which absorbed its POUR-organised WCAG pass, design-system consistency check and depth
  tiers. Two skills differing mainly in name were two chances to pick the wrong one.
- **`dev` v4.1.0**: agents no longer request tools the runtime removes from them, and the
  instruction blocks ordering them to use those tools are gone. An agent told to use a
  tool it cannot see does not fail loudly — it improvises.
- **`multimodel` v3.6.0**: same tool-and-instruction correction across its agents.
- **`code-analysis` v5.4.0**: same tool-and-instruction correction across its agents.
- **`video-editing` v1.2.0**: same tool-and-instruction correction across its agents.
- **`autolinear` v0.4.0**: same tool-and-instruction correction across its agents.
- **`gtd` v2.1.0**: same tool-and-instruction correction for `gtd-reviewer`.
- **`image-generate` v3.1.0**: the style command dispatches its subagent explicitly and
  passes a `CONFIRMED: <op> <path>` token, closing a confirmation loop that could
  silently skip the confirm step.

### Fixed

- **`bunjs` v0.4.1**: the index's own paths sent agents to files that do not exist.
  `skills/bun/SKILL.md` routed with `skills/<name>/SKILL.md`, described as resolving
  against the plugin root. Agents resolve a relative path in a SKILL.md against the
  directory holding that file — measured across 74 reads with zero counterexamples —
  which yields `skills/bun/skills/<name>/SKILL.md`, a path in no layout. In
  `benches/skill-router/` (RTR-1, `--repeat 8`, Sonnet 5) **13 of 18 graded sessions
  followed it into a dead end**; nine recovered by searching, four gave up, and those
  four were every routing failure in the run. Now `../<name>/SKILL.md`, correct in both
  the plugin and project-skill layouts. Re-measured after the fix: dead-path reads
  **25 → 0**, correct-path reads **49 → 99**, Recall **14/18 → 24/24**, flake rate 0.
- **`madbench` v0.2.1**: four skill corrections that only a run reveals —
  `session:step-count` takes one bound and silently drops `gte` when given both;
  `session:file-read` counts every Read *call*, failed ones included; a skill's recorded
  name is not stable (the same project skill appeared as `security` **and** `bun:security`
  within one run), so never gate on `session:skill-used` alone; and composites do not nest.

### Why

`benches/` asks whether the wording we ship produces the behaviour we intended. Two
entries above are cases where it did not, and neither was visible to review — the `bunjs`
sentence is unambiguous to a human reader and was ambiguous to 72% of actual readers. For
an instruction, that second number is the only one that counts.

### Migration notes

The three BREAKING entries change addresses, not behaviour. If a `CLAUDE.md`, workflow or
script of yours names `seo:seo-*`, `instantly:instantly-*`, or `designer:ui-design-review`,
update it to the new address. Nothing inside this repository referenced the old ones.

---

## [Marketplace 9.1.1] - 2026-08-18

### Changed

- Republished so the catalogue carries `multimodel` 3.5.0. The plugin bump alone does not
  move an installed copy — the marketplace version is the only signal claudeup has that a
  catalogue changed at all, so the corrected skills would otherwise reach nobody.

---

## [multimodel 3.5.0] - 2026-08-18

### Removed

- Deleted every provider/prefix/API-key routing table from the plugin's skills. Routing,
  credentials and backend fallback belong to claudish; this repo restating them produced
  two contradictory copies and no way to tell which was stale.
- `claudish-usage`: dropped the backend routing table, prefix-collision warning, "safe
  model IDs" list, the `--probe` pre-flight procedure, the failure-signature table, and the
  environment-variable section.
- `multi-model-validation`: dropped a second, independently drifted copy of the same
  prefix → backend → key table.

### Fixed

- Both skills taught the wrong separator: `or/`, `g/`, `oai/` where claudish uses `@`
  (`or@`, `g@`, `oai@`). Nothing in the repo caught it because the tables were hand-written
  from a snapshot.
- `claudish-usage` claimed `deepseek/` and `mistralai/` were not provider prefixes; both are
  providers now, so the "safe without a prefix" advice was wrong for them.
- `multi-model-validation` listed alias environment variables as canonical
  (`KIMI_API_KEY`, `GLM_API_KEY` — actually `MOONSHOT_API_KEY` and `ZHIPU_API_KEY`) and
  covered roughly a third of the available providers.
- `Requirements` claimed an OpenRouter key was required. It is not — many models route
  through other providers entirely.

### Why

A `/team` run lost 3 of 10 slots to provisioning failures. Investigating them showed the
routing documentation here had drifted far enough to misdirect the diagnosis, and that the
correct fix for each failure lived in claudish, not in this repo. Rather than refresh the
tables — which is what let them rot in the first place — they are removed and replaced with
the ownership rule plus a pointer to `claudish --help`, which reads live state and cannot
go stale.

Provider-side defects found during the investigation were reported upstream to claudish
separately; none of them are fixable here.

---

## [Marketplace 9.1.0] - 2026-08-18

### Changed

- Catalogue bump carrying **`style` v2.0.0**, which composes communication presets into a
  native Claude Code output style instead of a managed `CLAUDE.md` block, and ships
  `capture-builtin.ts` for pulling the built-in styles out of the harness so they compose
  too.

### Why

- The marketplace version is the only signal claudeup has that a catalogue changed. A plugin
  bump alone does not move an installed copy — shipping `style` 2.0.0 under 9.0.3 would have
  been invisible to every installation, which is the same-version content drift 9.0.3 itself
  was published to correct.

---

## [Marketplace 9.0.3] - 2026-08-16

### Changed

- Republished so the catalogue carries the corrected `madbench` skill. A plugin bump alone
  does not move an installed copy: the marketplace version is the only signal claudeup has
  that a catalogue changed at all, so shipping different content under 9.0.2 would have been
  invisible to every installed copy — the same-version content drift this repo already
  documents as un-updatable.

---

## [madbench 0.1.2] - 2026-08-16

### Fixed

- **The skill taught identifiers a current madbench rejects**, and several benches were
  written against it before anyone noticed. Session checks were renamed `session:*` on
  2026-08-07; the skill still said `trajectory:*` in 13 places and `session:` in none. The
  alias still loads, which is exactly why this survived: an old file runs on a new binary,
  so nothing screams. Only the reverse breaks.
- **Sandbox levels were documented as `process (default) | container`.** The real set is
  `none | workspace | home | container`, default `home`, and the pre-2026-08 spellings are
  *refused* rather than aliased — so a bench copied from this skill did not merely misbehave,
  it failed to load.
- `session:subagent-used` and `session:subagent-count` went unmentioned, so someone wrote a
  72-line probe to discover what they already answer.

### Added

- **A "before you write YAML" checklist**, naming the four mistakes that cost whole sessions
  rather than seconds: `prompt:` not `input:` (there is no `input:` alias, and a bench file is
  decoded leniently, so the agent runs with an *empty* prompt and you are billed); `config:`
  not `args:` for ts/js/python checks; `timeout:` takes a duration string; a bench's name IS
  its `description:`.
- **The check registry documented by what each check reads** — `Calls` is a lossy derived
  view, `Actions` is authoritative. That distinction is the root cause of the skill-used bug.
- The `list` / `preflight` split: `list` proves a file parses, `preflight` proves it could
  run. Using `list` as a pre-run check gives a false all-clear on exactly the errors above.
- Both shipped example benches now pass preflight against genuinely red testdata, and
  `madbench demo` is documented as the offline path — no keys, no spend.
- Guidance that a discovery prompt cannot prove a capability claim: showing a check is broken
  needs a prompt that *orders* the action, and a conclusion drawn from source you did not
  build is a conclusion about a different binary (`go version -m "$(command -v madbench)"`).

### Why

Without the version bump the corrected skill reaches nobody: the installed cache already
holds 0.1.1, so it considers itself current and the fix sits in git.

---

## [Marketplace 9.0.2] - 2026-08-15

### Changed

- Republished so the catalogue carries `dev` v4.0.1 alongside the skill
  reorganisation from v4.0.0, the four other dependency-range fixes from 9.0.1,
  and the `skill-authoring` routing documentation that landed on main after that
  publish. The 21 plugin pages under `userdocs/plugins/` are regenerated from the
  manifest, so they name the shipped versions rather than the previous ones.

  Version bumped rather than republished in place: the marketplace version is the
  only signal claudeup has that a catalogue changed, so re-pushing different
  content under 9.0.1 would have been invisible to every installed copy.

---

## [Marketplace 9.0.1] - 2026-08-15

### Fixed

- **`dev` v4.0.1**: could not be installed, at 4.0.0 or at 3.3.0. It required
  `multimodel "~3.3"` — which means `>=3.3.0 <3.4.0` — so multimodel's routine
  3.3 → 3.4 minor bump made the constraint unsatisfiable, and installing produced
  `Dependency "multimodel@magus" is installed at 3.4.0, which does not satisfy:
  ~3.3`. claudeup was right to refuse; the declared range was wrong. The 4.0.0
  release did not touch it, so the break survived a major version.
- **`multimodel` v3.4.1**: dependency range on `claudish` widened from `~1.0` to
  `^1.0`. Preventive — every inter-plugin dependency used a tilde range, so each
  was one minor release away from the break above; `dev` was simply the first to
  trip. Caret ranges allow minor bumps and break only on a major.
- **`code-analysis` v5.3.2**: same widening, on `mnemex` and `claudish`.
- **`designer` v0.4.3**: same widening, on `claudish`.
- **`seo` v1.8.2**: same widening, on `claudish`.
- The unlisted `stats` plugin got the same treatment on `mnemex`.

### Added

- `scripts/validate-versions.js` now checks every declared dependency range
  against the version the marketplace actually ships, and fails the release when
  one cannot be satisfied. Nothing checked this before, which is why a plugin
  that could not be installed passed every gate and reached users — twice, since
  it also survived the `dev` 4.0.0 release. Verified by restoring the broken
  range and confirming the gate reproduces the exact user-facing error.

---

## [dev 4.0.0] - 2026-08-15

### Changed

- **The skill library is organised by how a skill is reached, not by subject matter.**
  49 skills became 43, and 22 model-discoverable ones became 9. `dev` now emits **1,941
  listing characters instead of 3,270**, taking the marketplace from 11,756 to 10,427 and
  its headroom from 144 characters to 1,573. Listing budget is charged globally, on every
  turn, in every project, while relevance is local — so `backend/` and `frontend/` grouped
  by the one property with no relationship to cost.
- **The nine that stay listed are the ones whose absence changes what you get** rather than
  how fast: `context-detection`, `universal-patterns`, `design-system-guardrails`,
  `systematic-debugging`, `testing-strategies`, `test-driven-development`,
  `verification-before-completion`, `worktree-lifecycle`, `documentation-standards`. Every
  description rewritten capability-first, since truncation eats the tail.
- **Twelve skills are now `disable-model-invocation: true`**, and every consumer that
  preloaded one was converted in the same change. That flag blocks subagent preloading as
  well as listing, so hiding a preloaded skill silently starves its consumer while every
  gate stays green. The acceptance test is `bun scripts/dev-skill-inventory.ts dev`: no
  hidden skill may remain in `dev`'s own obligation list. It does not.
- **The `frontend` agent stopped preloading four stack playbooks.** It was injecting ~2,700
  lines — react 703, tailwind 586, shadcn 931, frontend-implement 332 — into *every* run,
  so on a Vue or plain-CSS task three quarters was dead context. They are now a read-table
  in the agent body, with `design-system-guardrails` still preloaded as the safety net.

### Removed

- **`debugging-strategies`** → `systematic-debugging/references/techniques.md`. It restated
  the same four-phase method in different words, and `/dev:debug` preloaded **both**, so
  one idea arrived twice under two vocabularies.
- **`test-coverage`** → `testing-strategies/references/coverage.md`; that skill already
  claimed coverage gates in its own description.
- **`golang-performance`** → `golang/references/performance.md`; a per-language performance
  split is accidental — every language would need one.
- **`tanstack-query`** → `state-management/references/tanstack-query.md`. Server cache is
  state, and three skills were claiming it.
- **`agent-coordination-discipline`** → `task-management/references/agent-coordination.md`.
- **`adr-documentation`** → `architecture/references/adr.md`; nobody asks for an ADR cold.

**Breaking:** `/dev:debugging-strategies`, `/dev:test-coverage`, `/dev:golang-performance`,
`/dev:tanstack-query`, `/dev:agent-coordination-discipline` and `/dev:adr-documentation` no
longer resolve. Their content survives at the paths above. The twelve newly-hidden skills
remain invocable by name.

### Why

Grew incrementally, organised by nothing in particular. A seven-way multi-model panel was
run to design the replacement; the reasoning, the alternatives and what was deliberately
not done are in `docs/plans/2026-08-15-dev-skill-reorganisation.md`.

Two things that panel exposed are worth recording. The inventory handed to the models had a
parser bug — it read the frontmatter's closing `---` as a skill named `--` and stripped
namespaces, filing five `multimodel:` skills under `dev`. Only the two participants that
read the repository caught it; the other five reasoned correctly from a false premise and
the judges ranked them on how gracefully they accommodated it. Convergence across six
providers did not detect a defect in their shared input.

Not done, deliberately: retiring `dev`'s `bunjs*` and `dingo` copies to the sibling plugins
that own that knowledge. The panel recommends it, but `ROADMAP.md:321` records it as an
already-considered deferral, and it needs a cross-plugin dependency decision. The folder
restructure is also deferred — 49 enumerated paths plus 188 references is churn better done
as one scripted, gate-verified change.

### Added

- `skills/skill-authoring/` — the repo's own standard for writing and reviewing skills,
  synthesised from two authoring guidelines, with `references/visibility.md`,
  `references/routing-eval.md` and `scripts/check-skill.ts`. The script validates what a
  machine can decide: description ceiling, third person, dead frontmatter keys
  (`triggers:`, `tags:`, `keywords:` are silently ignored by the matcher), unreferenced
  `references/`, unreachable skills. It passes its own checks.
- `scripts/dev-skill-inventory.ts` — every skill with its listing cost, reachability and
  preload consumers, which is the graph any reorganisation has to respect.

### Fixed

- `scripts/check-doc-references.ts` no longer scans `ai-docs/sessions/`. That directory is
  git-ignored per-run scratch which routinely names skills a run *proposed*, so it failed
  the build over files nobody will read again. The deliberate `ai-docs/` policy is unchanged.
- `plugins/dev/README.md` claimed 48 skills, advertised `/dev:tanstack-query`, and restated
  the 8,000-character figure as a hard cap. The budget is `context × 4 × 0.01`; 8,000 is its
  value at the 200k fallback, not a ceiling.

---

## [dev 3.3.0] - 2026-08-09

### Added

- **The refactoring catalogue is complete: all 66 techniques across six groups**, 9,032 lines.
  v3.2.0 shipped the smell index plus one group; this adds the other five — Moving Features
  (8), Simplifying Conditionals (8), Organizing Data (15), Simplifying Method Calls (14),
  Dealing with Generalization (12).
- Every technique carries the smell it resolves, **preconditions stated as checkable
  conditions** rather than advice, numbered mechanics, TypeScript before/after, a stated
  postcondition, a gain/cost table, and a "when NOT to".
- **Blast radius is made falsifiable in Simplifying Method Calls.** Each technique is
  classified compiler-enumerated or silent, with the actual TypeScript diagnostic code —
  and every code was confirmed by compiling a probe against tsc 6.0.2. The sharp case is
  `Add Parameter` *with a default*: it compiles at every existing call site unchanged, so
  the compiler will not tell you where the new behaviour now applies.

### Changed

- `check-index.sh` gains two rules, both negative-control proven: every written group's
  entry count must match its status row, and **no technique heading may appear in two group
  files**. The second exists because a double-assignment was invisible to every prior check.

### Fixed

- **Two phantom technique references shipped in v3.2.0.** `organizing-data.md`'s tables
  numbered *sixteen* techniques including a `Replace Record with Data Class` that has no
  section, so every table reference from slot 6 onward pointed one position off the real
  headings; ~30 in-text references renumbered. `dealing-with-generalization.md` carried
  eight references to a technique 13 belonging to the other file. `check-index.sh` could not
  see either — it counts headings, not the references that point at them.

### Why

`dev:architect` could choose an architecture and a design pattern but had nothing for
changing code that already exists. Written by ten in-repo agents and ten external models
across five providers, working blind, then merged with verification.

### Migration notes

**Licensing.** refactoring.guru is CC BY-NC-ND 4.0 (NonCommercial, NoDerivatives) and this
repo is MIT and published publicly, so only Fowler's technique and smell *names* are used —
standard terminology — with all text and examples original and attributed. Measured, not
asserted: every one of the ten external drafts was grepped for canonical specimens before
being read as a source, and all six shipped files return zero.

**A cross-provider judge panel ranked confidently and ranked wrong.** It rated one draft's
blast-radius table the standout of the field; compiling its claims showed it cites `TS2341`
for a private constructor (probe: `TS2673`) and `TS2551`/`TS2339` for a deleted free
function (probe: `TS2304`). It was rejected. Two other comparisons returned "nothing worth
taking" — `simplifying-conditionals.md` already beat the judge-preferred draft on the axis
it was praised for, and `moving-features.md` took nothing from three independent drafts.

Costs zero skill-listing budget; `SKILL.md` sits at 140 lines against a 140 ceiling, so the
next addition must buy its space.

---

## [dev 3.2.0] - 2026-08-08

### Added

- **A refactoring altitude in `dev:architecture`, behind a behaviour-preservation contract.**
  Styles answer "how is the system shaped", patterns answer "how do these classes
  collaborate", and this answers "how do I change existing code without changing what it
  does". `references/refactoring.md` indexes all **22 code smells** smell-first, plus
  `techniques/composing-methods.md` covering 9 techniques.
- **Smells are keyed to checkable signals, not adjectives** — arity ≥ 4, ≥ 4 locals live
  across the intended cut point, `git log` co-change sets, bidirectional import, accessor
  chain depth ≥ 3. This is what stops "every codebase matches some smell" from generating
  unrequested work.
- **A counterweight: three gates and nine hard stops.** Including one that the specification
  missed entirely — the catalogue contains its own inverses (Middle Man ⇄ Message Chains,
  Lazy Class ⇄ Large Class, Data Class ⇄ Feature Envy are duals), so applying one produces
  the other and the code oscillates across successive refactors.
- **A paradigm-fit section.** Fowler's catalogue assumes mutable OO; much TypeScript is not.
  **Data Class is usually the target state**, not a smell. An exhaustive `switch` over a
  discriminated union closed by `assertNever` is not the Switch Statements smell — the
  exhaustiveness check already buys what polymorphism was for. Temporary Field does not apply
  to `readonly` data constructed once.

### Changed

- `check-index.sh` gains section 4b: asserts all 22 smells are present, and that each
  technique group's advertised status matches disk — a group marked *written* must exist, one
  marked *not yet written* must not. A stale status line is worse than none.
- `SKILL.md` gains the refactoring altitude in its Step 1 routing table (139/140 lines).

### Fixed

- **`check-index.sh` reported false MISSINGs for any nested reference.** The regex hard-coded
  `styles/|patterns/`, so `refactoring/techniques/composing-methods.md` was truncated to a
  bare filename and resolved against the wrong directory. Found by the `dev:docs` agent
  during authoring and verified by direct test.

### Why

`dev:architect` gained a pattern catalogue in 3.1.0 but still had nothing for changing code
that already exists — the most common engineering task. Built by seven independent producers
working blind (five external models via claudish, plus `dev:architect` and `dev:docs`) and
merged: structure and smell table from the architect, gates and postconditions from docs.

### Migration notes

**Licensing is why every word is original.** refactoring.guru is licensed CC BY-NC-ND 4.0
(NonCommercial, NoDerivatives); this repo is MIT and publishes to public marketplaces, so its
prose and examples cannot ship here. Only Fowler's technique and smell *names* are used, as
standard terminology, with attribution. This was not a theoretical concern: **measured across
the seven producers, three of five external models reproduced canonical catalogue examples
despite an explicit binding instruction not to** (28, 15 and 6 fingerprint hits for
`printOwing`, Don/John/Kent, `basePrice`). Both merged candidates scored zero.

Coverage is deliberately honest: the smell index is complete, **1 of 6 technique groups is
written** (9 of 68 techniques). The router states this and section 4b enforces that the status
lines match disk, so it cannot rot silently. Costs zero listing budget — 11,984/12,000
unchanged.

---

## [dev 3.1.0] - 2026-08-07

### Added

- **An architecture knowledge base for `dev:architect`, which had none.** New
  `dev:architecture` skill: a 125-line router over 7 architectural styles (layered,
  hexagonal, clean, modular monolith, microservices, event-driven, CQRS + event sourcing)
  and all 22 GoF design patterns, plus three tested TypeScript modules with 25 tests.
- Each pattern file carries intent, the force it answers, structure, TypeScript, trade-offs,
  a **"Does TypeScript already do this"** section, when NOT to use it, and its relations.
  Several GoF patterns are 1994 workarounds the language now provides outright.
- `references/selection.md` — choosing by force rather than by name, the overuse smells,
  and the standard criticism of pattern-driven design.

### Changed

- `dev:universal-patterns` now routes to the deep tree instead of competing with it. It is
  what `dev:architect` preloads, which is how the catalog reaches the agent at all.
- `/dev:architect` gained an `agent_dispatch` contract. All five "Launch architect agent"
  sites named a prompt but no tool, so they read as an instruction to work inline — the
  behaviour the command's own `orchestrator_role` forbids. Each is now an explicit `Task`
  call with `subagent_type: dev:architect`.
- `CLAUDE.md` gained four routing rows phrased as **read this file**, the form
  `benches/skill-index/` IDX-1 measured as working for skills that carry
  `disable-model-invocation`.

### Fixed

- **CQS was being mistaken for CQRS.** `universal-patterns` taught Command Query Separation
  (a method either mutates or returns) while nothing in the repo covered Command Query
  Responsibility Segregation (separate read and write models, often separate stores). An
  architect holding only the first will report that a system already does the second.
- **`UNI-02` and `UNI-09` contradicted each other in practice.** The sin registry says use
  Strategy for a 5+ branch switch, and calls Strategy with 1-2 implementations overkill.
  Both are right; neither stated the threshold. `selection.md` now does, and notes the count
  is only a proxy for the real question: does adding the next case edit existing code.

### Why

An audit of 379 markdown files found nothing at all on hexagonal, modular monolith, or
CQRS, and 17 of the 22 GoF patterns unmentioned anywhere. The remaining five appeared only
as failure modes in `code-roast`'s sin registry — the repo documented how five patterns
break and taught none of them. Meanwhile `dev:architect` ran on roughly seven informally
described patterns and no worked code.

### Migration notes

Costs **zero** skill-listing budget: the skill carries `disable-model-invocation`, so
listing-eligible skills stay at 77 and eligible chars stay at 11,984/12,000. That flag also
blocks *agent preloading*, which is why the catalog is reached by reading a path rather than
by a `skills:` frontmatter entry — the latter would fail silently.

Overlap was reconciled, not duplicated: `dev:bunjs-architecture` keeps Bun-specific
layering, and `code-roast`'s `sin-registry.md` remains the single maintained failure
inventory, cited as `UNI-01`…`UNI-15` rather than restated.

---

## [bunjs 0.4.0] - 2026-08-07

### Added

- **The five backend exit doors, from [nodejs-testing-best-practices](https://github.com/goldbergyoni/nodejs-testing-best-practices).** *"Assert on outcomes, not interactions"* is good advice that never tells you when you are done; this does. A request can affect the world through exactly five doors — response, state change, external calls, message queue, observability — so for any feature you ask which it opens and assert each. Most suites assert the response and stop, while doors 2 and 3 are where the expensive bugs live: a handler returning `201` while writing nothing, or charging a customer twice. It also makes the inverse a test — *"this must not send an email"* is an assertion that a door stayed **shut**.
- **`denyOutgoing({ allow })` in the shipped harness — fail-closed network isolation, with 7 tests.** Stubbing dependencies as you find them fails **open**: the call you forgot is the one nobody stubbed, and it reaches a real API from CI. This throws on anything not allow-listed, naming the URL. One test exists specifically because the naive implementation inspects only string inputs and a `Request` object slips past silently.
- **`references/external-services.md`** — exit doors 3 and 4: asserting the request you sent rather than only the reply, corner cases over a happy default, why a real fake server beats an HTTP interceptor, provider contracts and schema drift, and message queues (fake broker by default, await instead of poll, and testing **acknowledgement** — nack/redelivery, idempotency on duplicate, dead-letter routing — since those are the paths that lose or duplicate messages).
- **Assert the whole response object**, not field by field — one assertion that also catches an *unexpected extra field*, such as a leaked `passwordHash`, which per-field checks never will.
- **Infrastructure guidance**: real engine over a fake, Docker Compose in global setup, left running locally and torn down only in CI, with the data directory on a RAM disk and durability disabled — test databases do not need to survive a power cut, and disk sync is most of the wall time.
- **Cover features, not functions**, and **write the tests during coding, not after** — "after" reliably becomes "never", and tests written afterwards are shaped by the implementation, so they assert what the code *does* rather than what it *should*.

### Changed

- **Two places this plugin disagreed with that guide are now stated as trades rather than silently resolved.** Clean-up: after-all is faster and usually right *provided each test acts on its own records*, after-each is stricter — with the advice to start strict and relax once stable. Reading state back: the public API keeps tests decoupled from schema but shares a bug between read and write paths, while a direct query catches a handler that builds its response from its input rather than from what was stored. Use the API by default, query directly where the write itself is the risk.
- **Pre-seed only metadata and context** — never the records a test acts on. A shared `user_1` couples every test to a row none of them own, and the first test to modify it breaks the rest in a way that looks like flakiness.

---

## [bunjs 0.3.1] - 2026-08-07

### Changed

- **The discovery bench moved out of the plugin to `benches/skill-index/` (IDX-1), where every madbench eval in this repo belongs.** It was shipped inside `plugins/bunjs/evals/skill-discovery/`, which put a measurement harness into the distributed plugin and left it out of the one index that answers "what do we measure, and at which revision". Benches are versioned so a result can be cited later — bench prompts and graders change, and *"IDX-1 said the routing row failed"* is meaningless without the version that produced it. The plugin now ships only the plugin; `benches/README.md` carries the index row.
- **The bench README now records results and a changelog**, per the same convention: what each cell isolates, what it returned, on which date and model, and what changed between bench versions.

### Added

- **The `--harness mock` negative control the `benches/` rules require**, now run and recorded: **0 passed, 3 failed**. Every setup must fail against a no-op agent, or the bench is not measuring the agent. This should be re-run after any check edit.

---

## [bunjs 0.3.0] - 2026-08-07

### Added

- **`/bunjs:bun` — an index skill that knows the other eight without loading them.** One entry point, and the only listed skill the plugin has: it names which one or two files a task needs and nothing else. Opening all eight is roughly 4,000 lines, which defeats the purpose of an index; two is normal, five means the task should be split. It routes on **what the task will make you write**, not on the words used — "add login" resolves to `security`, "it's slow" to `performance`, though neither names a skill.
- **Chains that stop where the task stops.** A fresh app is `project-setup` → `http-service` → `errors`; `testing` waits until there is something to test and `production` until it is being shipped. Reading the whole set upfront buys guidance that cannot be acted on yet.

### Changed

- **The index is deliberately the plugin's only listed skill.** The other eight keep `disable-model-invocation`, so the plugin's entire listing cost is the index's **187-character** description instead of the ~1,400 that nine visible skills would take. This is the shape the discovery work in 0.2.2 pointed at: one cheap, findable entry rather than eight invisible ones reachable only by a routing row.

### Notes

- **The marketplace listing is now at 11,984 of its 12,000-character ceiling — 16 characters spare.** The index consumed nearly all remaining headroom, so **no further listed skill can be added anywhere in the marketplace** until existing descriptions are shortened. `bun scripts/skill-budget-check.ts` fails the build if one is. The real Claude Code runtime cap is 8,000, which this total has exceeded for some time; over it, descriptions are dropped silently, least-invoked first.

---

## [bunjs 0.2.2] - 2026-08-06

### Fixed

- **The skill-discovery claim shipped in 0.2.0 was wrong, and a bench now proves it.** The plugin README and the repo `CLAUDE.md` routing table both said a routing row plus the `/bunjs:<name>` commands were how these skills get found. Measured (`plugins/bunjs/evals/skill-discovery/`, claude-sonnet-5, cells differing by exactly one file): a row phrased *"invoke it with the Skill tool"* → **not reached**; the identical row phrased *"read the file"* → **reached**; the skill listed with the flag removed → **reached**. The row failed because it prescribed an action that cannot be taken — the Skill tool never fires for these skills, even when a prompt orders it by name. A canary probe confirms `CLAUDE.md` **is** loaded under `claude -p`, so this was a phrasing failure and not an unread file.
- **All eight routing rows now name a file to read** (`plugins/bunjs/skills/<name>/SKILL.md`) instead of `/bunjs:<name>`. A model cannot invoke a slash command, so the commands are documented as the **human** path — which is all they ever were. This is the difference between guidance an agent can act on and guidance it silently ignores.

### Added

- **`plugins/bunjs/evals/skill-discovery/` — a madbench suite that measures discovery rather than assuming it.** Testdata is seeded red (`bun test` exits 1 until real work happens) and asserts behaviour only, never naming argon2id, so the measurement is not handed its own answer. `sync-testdata.sh` regenerates every variant from the real skill and **refuses to build unless each differs from the baseline by exactly the one intended file**; the variants are gitignored because a committed copy would drift from the skill it is meant to test.
- **Two controls that stopped the bench reporting a confident wrong answer.** `instrument-probe.yaml` shows madbench's `skill-used` check counts Skill-tool calls only — even when *explicitly ordered* to invoke the skill by name it returned 0, while the transcript showed the skill fully consumed via `Read` and `Bash` (assets copied into `src/`, `makeDummyHash`/`authenticate` imported, the skill's own acceptance greps run). A check that cannot pass is not evidence. Separately, the obvious code fingerprints (`Bun.password`, `timingSafeEqual`) scored **0.75 / 0.75 / 0.50** across cells — identical with and without the skill, and *lowest* in the cell that actually reached it — so they are kept as instrumentation and must never be read as proof of skill influence.

### Notes

- Incidental madbench finding: `threshold: 0.0` is indistinguishable from unset and falls back to the `1.0` default, silently gating an `assert-set` intended as pure instrumentation. Use `0.01`.
- **n=1 per cell.** The contrasts are large and mechanistically explained, but `madbench madbench.yaml --repeat 5` before treating any of it as settled. The bench installs the skill as a **project** skill, so whether `Skill(bunjs:<name>)` fires for a **plugin** skill carrying the same flag remains untested.

---

## [bunjs 0.2.1] - 2026-08-06

### Fixed

- **Nine false claims in the `tui` skill, found by six models each building its eval #1
  dashboard for real and screenshotting it.** The code was never the problem — every gate
  passed in all six builds. The prose was wrong.
- `bun add @opentui/core @opentui/react react` resolves **0.5.1** today, not the 0.4.x the
  skill taught. `versions-and-builds.md` claimed "`latest` is 0.4.5". Run-from-source is now
  measured clean on both; the `--compile` rows are marked **unverified at 0.5.x** rather than
  silently extended to a version nobody tested.
- A `<span>` outside a `<text>` does not crash — it **renders an error page while the process
  stays alive, exits 0 and writes nothing to stderr**, so `tsc`, `bun test` and `check-surface`
  all stay green on a dead UI. Two of six models hit it independently. SKILL.md now says so.
- SKILL.md contradicted its own reference on sibling `<text>`: it stated they overprint
  unconditionally, while `react-patterns.md:73` — a section titled "Overprint is height
  starvation — NOT sibling count" — says they are legal. The router carried the myth.
- `Meter`'s `pct` is 0–100; the visual-mapping table said "%, ratio, 0–100", and "ratio"
  invited 0–1. One model lost a capture round to it.
- The bootstrap never said to overwrite the `tsconfig.json` that `bun init` writes — its
  defaults carry no `jsxImportSource`, so nothing renders.
- Route B needs no upstream change to hit the mandated capture sizes: its pane lives on the
  `mcp-headless` socket the doc already reaches, so one `resize-window` call does it.
  **`resize-window`, not `resize-pane`** — the latter is a silent no-op on a lone pane
  (measured), returning success while the pane stays 200×50.
- Oversize PNG padding renders opaque black, not transparent as claimed, and must not be read
  as an unpainted hole.
- The stale `63/63 pass` measurement is now `119/119`, the real count.

### Why

The skill's whole premise is MEASURED-not-remembered. Claims that decay silently cost more
here than in a skill that never made the promise.

---

## [Marketplace 9.0.0] - 2026-08-06

### Added

- **`setup` v1.0.0**: one plugin for project setup jobs. `/setup:project` investigates a
  repository — stack, package manager, the exact test and lint commands, CI, what is
  already configured — then provisions it behind an approval gate: plugins through the
  `claude plugin` CLI, MCP servers, framework references, and a seeded knowledge base. It
  invokes `/dev:setup` and `/code-analysis:setup` rather than reimplementing them, and
  never hand-edits Claude Code-owned plugin state.
  `/setup:index-skills` walks every skill reachable from a project and writes a markdown
  index carrying each one's per-turn listing cost. Scope is detected from the directory,
  not its name: a plugin-source repo indexes `plugins/*/skills/**`; anything else indexes
  `.claude/skills`, the `~/.claude/skills` autodiscovery directory, and every installed
  plugin, counting cached-but-not-enabled plugins as zero because they cost nothing.
  It emits two indexes with different jobs. The full `SKILLS.md` is a reference document
  read on demand. `--claude-md` splices a ~4.5 KB block into CLAUDE.md between
  `<!-- skill-index:begin -->` markers, naming every skill the model cannot reliably
  discover on its own. The budget it measures against is `context_tokens x 4 x
  skillListingBudgetFraction`, verified against the 2.1.223 binary — there is no 8,000 hard
  cap, and it is global across every installed skill rather than per-plugin. 8,000 is only
  what the formula yields at the 200,000-token fallback, so `--context` and `--fraction`
  let the corpus be measured against a specific model: this marketplace's 13,022 chars
  overflow at 200k (about 47 of 77 descriptions survive) and fit at 1M. That portability
  gap is the argument for the block — it reads identically on every model, and 74 of these
  skills also carry `user-invocable: false`, so a shortened description leaves them with no
  fallback at all. Re-running replaces the block; a file with one marker and not the other
  is refused rather than guessed at.
  `--tiered` splits it into two levels: CLAUDE.md gets one row per topic group naming what
  it covers, and `.claude/skill-index/<group>.md` holds that group's invocation strings and
  full descriptions. The grouping unit is the `skills/` subdirectory where a plugin uses
  one, because `dev`'s 48 skills span `frontend/` and `backend/` and one row cannot route
  to both. Measured here: 2,825 chars always-loaded against the flat index's 4,455, plus
  44,430 chars of descriptions that were previously in no index. `--topic-max` is what makes
  it pay — enumerating every skill at level 1 costs 3,986, a 10% saving that would not
  justify the extra read. Groups below `--threshold` stay inline, since for a one-skill
  plugin the pointer costs more than the name.
  Each skill is marked by how it can be reached — listed, `*` slash-only, `^` preloaded,
  or `!` unreachable. The last is a defect detector: a skill carrying both
  `disable-model-invocation` and `user-invocable: false` while no command or agent names
  it cannot be invoked at all, and a manifest entry does not count, because registering a
  skill is not routing to it.
- **`style` v1.0.0**: nine composable communication style presets — `direct`,
  `explanatory`, `terse`, `evidence-first`, `plain-language`, `no-slop`, `structured`,
  `calibrated`, `terminology`. They sit on two axes: pick exactly one verbosity preset,
  combine modifiers freely. `/style:apply` writes the chosen set into CLAUDE.md between
  `<!-- style:begin -->` markers, so re-applying replaces the block rather than appending
  a second, contradictory voice section.

### Changed

- **`statusline` v3.0.0**: now a deprecation shim. The statusline moved into `setup@magus`
  as `/setup:statusline-install`, `-uninstall` and `-customize`. The `/statusline:*`
  commands still resolve for this release — install and customize locate the setup plugin
  root across both the cache and directory marketplace layouts and delegate to it, and
  uninstall works standalone because it only touches `.claude/statusline-command.sh` and
  the `statusLine` settings key. `statusline.sh` now exists in exactly one place;
  duplicating a thousand-line script across two plugins guarantees drift.
- `statusline-customization` gained `disable-model-invocation: true`, returning 125 chars
  to the shared skill listing budget. It previously carried only `user-invocable: false`,
  which frees nothing — that flag hides a skill from the `/` menu and leaves it in the
  per-turn listing.

### Migration notes

An already-installed statusline is unaffected by the move. `/setup:statusline-install`
copies the script to `.claude/statusline-command.sh` and points `settings.json` at that
copy, so nothing in a working install references the plugin cache. What changes is the
plugin id: install `setup@magus`, switch to the `/setup:statusline-*` commands, and drop
`"statusline@magus": true` from `enabledPlugins` once the shim is removed next release.

---

## [Multimodel 3.4.0] - 2026-08-06

### Added

- **`scripts/resolve-models.ts` — preference resolution is now code, not prose.** It verifies every model-bearing field against the live catalog, drops dead IDs individually, computes provenance, and prints a receipt the command emits verbatim. `scripts/lib/preferences.ts` holds the pure logic under 26 unit tests covering all-live, all-dead, mixed, missing dates, conflicting dates, absent file, corrupt file, and unreachable catalog. Call `list_models` first and pass the IDs in — routing stays claudish's job.
- `benchmarks/multimodel-model-staleness/` — a madbench bench over five stale-preference scenarios, run against the plugin's real procedure at `HEAD` versus the working tree. `build-instructions.ts` extracts both variants from the actual skill files, so the comparison measures the plugin rather than a paraphrase of it.

### Fixed

- **Saved model preferences are verified on every path, not just `customAliases`.** `multi-model-validation` routed a non-empty `contextPreferences[context]` straight to "Use those models directly → DO NOT ask user", and called `list_models` **only** in the `IF EMPTY` branch. `claudish-usage` did require catalog-verification — but only for `customAliases`. A preferences file found in the wild had `customAliases: {}` and six decommissioned IDs sitting in `defaultModels`, which no path checked. Dead IDs are now dropped and named; the run continues on the survivors, and stops only when nothing survives.
- **The disclosure is the measured count, not a timestamp.** The plugin now reports `9 of 10 saved model IDs are no longer in the live catalog — …`, derived from the comparison it just performed, so it cannot be silently wrong. Any age claim is sourced from filesystem `mtime` and labelled as such; when `lastUpdated` disagrees with the newest `history[].date` both are named as `freshness metadata inconsistent`.
- **An unreachable catalog is reported as unverified, never as "all live".** Passing no catalog previously rendered "all N saved model IDs are still in the live catalog" — asserting a check that had not run.
- **A dead entry invalidates that entry, never the request.** A stale `kimi3 → kimi-k2.5` alias still resolves to `kimi-k3` when the catalog lists it.

### Why

Age and validity are different properties, and no timestamp on this file supports a TTL. The real file that motivated this reports **three mutually contradictory freshness signals**: `lastUpdated` says 157 days, its own `history[0].date` says 8 days, and filesystem `mtime` says 7 days. A TTL on any of them passes the file — while 9 of its 10 model IDs are decommissioned. Only the catalog comparison gets it right.

The benchmark pins the pair a TTL cannot straddle: `fresh-timestamp-dead-models` (recently written, every ID dead) passes any age gate, and `old-timestamp-live-models` (157 days old, every ID live) fails one.

**Why the resolver rather than more prose.** Over 30 benchmark runs at Sonnet class, the shipped instructions disclosed staleness **0 of 15 times**; the best rewritten prose managed **14 of 15**. Successive rewrites also traded one failure for another — an emphatic "untrusted" framing induced the agent to abandon runs with live models available, and a clause meant to prevent that suppressed the disclosure instead. "Always report this" is an output invariant, not a judgement call, and no finite sample of a stochastic process can establish "every time". The prose remains as explanation and as the fallback for paths the resolver does not cover.

---

## [multimodel 3.3.2] - 2026-08-06

### Fixed

- **A routing address is not a model identity.** Agents were storing `moonshotai/kimi-k3`
  as the model ID while stating, in their own summaries, that it was "bare, unprefixed (no
  `kc@`/`kimi@` backend selector)". That is the catalog record's `openrouterId`, sitting
  directly beside `id` in the same object. The old rule — *"NEVER invent provider prefixes
  — only pass through ones the catalog reports"* — permitted it, because the catalog does
  report `openrouterId`; and its `@`-only examples taught the pattern, so a `/` never
  registered as a prefix at all. Storing either form pins the provider and bypasses the
  subscription-aware routing and fallback the user asked for.
- "Backend selectors (`provider@model`)" becomes "Identity vs routing address", tabling
  `id` / `openrouterId` / Access line side by side. Bare now means no `@` **and** no `/`,
  stated with the concrete pair: `z-ai/glm-5.2` is as wrong as `gc@glm-5.2`.
- The permission clause is closed: "the catalog reports it" is explicitly not a licence to
  send it, since the catalog reports every address alongside the identity.

### Why

Measured, not assumed. `benches/model-selection` runs real Claude Code against a real
plugin tree and varies only which copy is installed. Five runs per setup on
claude-sonnet-5: the published plugin stored a routing address in 4/5 runs; with this
wording, 5/5 stored the identity (Fisher exact, one-sided p ~= 0.02).

A single pair of runs did not show the effect — one post-fix run had treatment *and*
control passing, which reads as success and is not, since the control carries none of the
fix. Only repeated trials separated it from run-to-run variance.

---

## [dev 3.0.2] - 2026-08-06

### Fixed

- **Phase 1 Step 1f stores the catalog's `id`, never a routing address.** A stored model ID
  must contain no `@` and no `/`: `kimi-k3`, not `moonshotai/kimi-k3`. Storing an address
  pins the provider and bypasses subscription-aware routing — and Step 1f's selection is
  reused in Phases 3 and 5, so one bad entry propagates through every later review.
- Dropped a dangling reference to `ALIAS_TABLE` in the same note. That concept was deleted
  when model resolution moved to the live catalog; the instruction still named it.
- **`internal` is the current host session model.** `dev.md` hard-coded "Internal Claude
  (embedded, FREE)", conflating execution location, vendor, and billing. During the
  incident that produced this work the host was GPT-5.6 Sol, so the summary was reporting a
  vendor and a price that were both wrong.

### Why

See `multimodel 3.3.2` — same defect, measured by the same bench. Both plugins had to
change: the skill defines the rule, Step 1f is where the value gets written down.

---

## [Marketplace 8.2.0] - 2026-08-06

### Added

- **Session artifacts are now defined, and agents are told to stop citing them.** `CLAUDE.md`
  gains a "Session Artifacts vs Durable Docs" section naming three session-scoped paths —
  `.mnemex/` (rebuildable semantic index, routinely 500 MB+), `ai-docs/sessions/` (per-run
  scratch from `/team`, `/multimodel:delegate`, `/dev:dev`, autotest), and
  `**/.claude/.coaching/` (dev-plugin learning queue and circuit-breaker state). All three
  were already git-ignored; ignoring a path stops it being committed but does nothing to
  stop an agent reading it and quoting it as settled fact. The rules close that gap: never
  cite a session artifact as authority, never mine another session's artifacts for context,
  never `git add` them, and never let them block worktree cleanup.
- **A promotion rule with a destination table.** Output worth surviving must be moved out
  *during* the session that produced it — a decision or trade-off a human revisits goes to
  `docs/` (`docs/plans/` for design docs), a mechanism or gotcha an agent needs later goes
  to `ai-docs/` root, and a run that only confirmed what was already known goes nowhere.
  Promotion is rewriting, not `mv`: a raw dump carries the session's stale model IDs and
  dead paths, which is the exact rot the existing ai-docs caveat warns about.
- Mirrored into `AGENTS.md` for Codex, annotated in both directory trees, and cross-linked
  from Learned Preferences rather than restated there.

### Why

Uncommitted session output is invisible by construction: it lives only in ignored paths, so
nobody discovers it later and nobody promotes it. The failure mode is the reverse of losing
it — an agent *finds* week-old scratch, reads one model's mid-investigation opinion, and
launders it into a durable doc as a decision the project never made.

No plugin versions bumped: `CLAUDE.md` and `AGENTS.md` are consumed by agents working in
magus-src and are shipped by no `distTargets`, so nothing published to any channel changed.

---

## [bunjs 0.2.0] - 2026-08-06

### Added

- **Seven new skills, split by the problem an agent is in rather than by book chapter** — `project-setup`, `http-service`, `errors`, `testing`, `security`, `production`, `performance`. The split is deliberate: a book's table of contents is organised for sequential reading, while a skill set is accessed at random under a specific failure, so mirroring [nodebestpractices](https://github.com/goldbergyoni/nodebestpractices)' eight chapters would have produced a "Code Style" skill nobody loads and buried "I'm writing a Dockerfile" in chapter 8. That repository is the reference, credited in the plugin README with a chapter→skill mapping; its chapters 1 and 3 both land in `project-setup`, and 5 and 8 both in `production`.
- **Every non-obvious claim was measured against Bun 1.3.10, not recalled**, and where a measurement contradicted the folklore the measurement is what shipped. `Bun.file().text()` was **not** faster than `node:fs/promises readFile` for 1 MiB whole-file reads in either of two runs (0.124/0.133 vs 0.112/0.097 ms/op); the repeatable win is `.bytes()` skipping UTF-8 decode. `performance` reports this rather than the usual "Bun natives are faster" claim.
- **Eight silent-failure traps found by probing, documented where each bites.** The worst is `bunfig.toml`'s `coverageThreshold`: the keys are **plural only**, so `{ line = 0.99 }`, `{ function = 0.99 }` and `{ statement = 0.99 }` are silently ignored — no error, no warning, `exit 0` against 33% actual coverage, and CI green with the gate dead. Also: `bun:sqlite` without `{ strict: true }` returns `[]` for a misspelled parameter instead of throwing; a `{ GET, POST }` route map falls through to `fetch()` rather than answering 405; `server.reload({ routes })` replaces the entire route table; a `"/*"` wildcard populates no params; an unhandled rejection does not terminate the process; `spyOn` calls through to the original by default; and `JSON.stringify(new Error("x"))` is `{}`.
- **Copyable, tested assets in every skill.** `errors` ships the `AppError` hierarchy, centralized handler and `withTimeout`/`retry`/`CircuitBreaker`; `security` ships enumeration-safe login, token handling and a rate limiter whose key cannot be forged; `http-service` ships middleware, `AsyncLocalStorage` request context and response helpers; `testing` ships a component-test harness and controllable fake upstream; `production` ships a JSON logger, health checks, shutdown ordering and a multi-stage Dockerfile; `project-setup` ships a typed env parser; `performance` ships a benchmark harness that calibrates against the measured ~42 ns clock granularity and refuses to call a difference inside the noise band a win. **362 tests pass across the eight skill packages with `tsc --noEmit` clean in each.**
- **All eight skills carry `disable-model-invocation: true` and one `/bunjs:<name>` command each.** The marketplace-wide skill listing was already at 11,797 of its 12,000-char ceiling against Claude Code's real 8,000-char runtime cap, so a listing-eligible description here would have broken the budget gate. The plugin spends zero listing characters; the commands and a CLAUDE.md routing row are how the skills are found.

### Changed

- **BREAKING: the `opentui-tui` skill is renamed to `tui`**, so the command is now **`/bunjs:tui`** and `/bunjs:opentui-tui` no longer resolves. Its 119 tests still pass unchanged. The rename makes the naming consistent across the eight skills — inside a plugin already called `bunjs`, a product prefix on each folder is redundant.

---

## [dev 3.0.1] - 2026-08-02

Housekeeping pass (R11 from the 2026-07-29 review) plus everything a first sweep of it
missed — every fix below was checked against the live repo and, where relevant, live
Claude Code docs, not just read off the diff that introduced it.

### Fixed

- `${PLUGIN_ROOT}` → `${CLAUDE_PLUGIN_ROOT}` across `agents/stack-detector.md` and
  `skills/context-detection/SKILL.md` (105 lines). Confirmed against
  `code.claude.com/docs/en/plugins-reference` that substitution is documented to resolve
  "anywhere the placeholder appears" in skill and agent content, so this was a real
  path-resolution bug, not cosmetic. A first pass caught one instance in `developer.md`
  and left the rest — including a line in context-detection that told agents to use the
  wrong token and called it CRITICAL.
- `plugin.json` `dependencies` was missing `multimodel`, even though `architect.md` and
  `interview.md` reference `multimodel:quality-gates` — install-time dependency
  resolution now matches what the bundled skills actually use.
- `/dev:feature`, `/dev:implement`, `designer:review` (agent-delegation contexts),
  `mcp__plugin_claudish__*`, and stray HTML entities (`&amp;`, `&lt;`, `&gt;`) cleaned up
  across agents, commands, hooks and skills — all renamed or removed in the v3.0.0 merge
  but left behind as stale text in prose, examples and coaching strings.
- `docs.md`'s own scoring checklist said "42-Point" while listing 52 points (42 base + 10
  anti-slop); `help.md`'s version, command count and dependency list had drifted from
  `plugin.json`; `worktree.md` checked for `.neon-branch.json` when
  `db-branching/SKILL.md` has used the provider-agnostic `.db-branch.json` throughout.
- `CLAUDE.md`'s plugin table and `docs/dev-plugin-consolidation.md` (a pre-implementation
  planning doc, version-drifted since v1.4x) still cited pre-rename terminology and stale
  versions; the latter is now marked historical.

### Known gaps (not in this release)

`agents/frontend.md` still contains real Tailwind arbitrary-value examples beyond the
now-corrected rule statement — the full rewrite is a separate, larger item.
`tools/autopilot-server`'s Linear tag→command mapping still routes `@test`/`@refactor`/
`@implement` to commands removed in the v3.0.0 rename, and `@ui`/`@frontend` to a
`frontend` plugin that no longer exists — pre-existing, not touched here.

---

## [terminal 4.1.4] - 2026-07-30

### Changed

- Tracks `github.com/MadAppGang/tmux-mcp@v1.6.3`, up from `v1.6.2`.

---

## [designer 0.4.2] - 2026-07-30

### Changed

- **Description rewritten to say what the plugin is, not what a release did.** It read
  "UI design validation, review, and style management. Pixel-diff comparison, AI semantic
  analysis, and design system workflows." — a feature list. It now states the actual
  behaviour: compares a rendered screen against its reference by pixel diff, then reviews
  the result for spacing, hierarchy and design-system consistency.

---

## [bunjs 0.1.0] - 2026-07-30

### Added

- New plugin `bunjs`, shipping the `opentui-tui` skill for OpenTUI terminal UIs in Bun and
  TypeScript — the Bun counterpart to `go-tui`, holding the same aesthetic bar.
- The aesthetic contract lives in SKILL.md, not a reference: a default-visual mapping table
  (bounded value → gradient meter, series → sparkline, status → badge), three rules, and a
  negative control — a single-colour bar or bare numbers on the first screenshot is a failure.
- `assets/theme/` and `assets/runtime/` ship as tested, copyable code because OpenTUI has no
  colour interpolation, no `darken`/`lighten` and no string-width helper at all: 10 colour and
  cell-width shims, five single-row widgets, and one idempotent `installShutdown`. 119 tests.
- A version and build matrix keyed by the **artifact** you ship, measured rather than recalled:
  0.4.x to run from source, 0.1.107 with no `--external` for a standalone `--compile` binary.
- `scripts/check-surface.ts` lints the shipped prose as well as the code, so a snippet mixing
  the core construct DSL with React intrinsics cannot ship. `scripts/ansi-to-png.ts` is a
  byte-identical copy of `go-tui`'s, held there by a pre-commit `diff -q`.
- Discovery without listing cost: the skill carries `disable-model-invocation: true` and
  contributes 0 chars to the skill listing budget, with `/bunjs:opentui-tui` as its entry point.

---

## [dev 3.0.0] - 2026-07-30

### Changed

- **Hooks now run and are tested, and per-turn context is cut 15,143 → 5,568 chars.**
  `/dev:review` removed; three doc agents merged into `dev:docs`; the shell-injection
  and silent-directive bugs below are fixed.

**Breaking.** `/dev:review` removed (it self-deprecated with "removed in v3.0.0").
`doc-writer`, `doc-analyzer` and `doc-fixer` are replaced by `dev:docs` with a
`mode` parameter. Three debug skills are folded into `dev:systematic-debugging`.
The skill named `audit` is now `security-audit` — it collided with the
`/dev:audit` command, which is why it had zero consumers.

### Hooks now run, and are tested

`phase-completion-validator.js` read `process.env.CLAUDE_TOOL_INPUT`, a variable
Claude Code does not set, so it exited 0 without validating on every `TaskUpdate`
since it shipped. It also blocked with `exit 1` — a hook *error*, which lets the
tool through — so it could not have blocked even had it parsed its input. Ported
to bun/TypeScript reading stdin, blocking with exit 2, with 29 tests. Its unescaped
`sessionPath` → `execSync` is gone. `outer-loop-enforcer.js` became
`scripts/outer-loop.ts` with the same exit codes and 16 tests, clearing the last
`.js` from the plugin.

### Coaching repaired

The learning parser matched `type: "human"`; real transcripts use `"user"`, so it
had never seen a single user message — and every fixture used `"human"`, so the
suite was green while the feature had never run. `Stop` was treated as
end-of-session when it fires per response, so a long session was only ever
analysed as its own opening prefix. MEDIUM-confidence classifier output became a
silent behavioural directive with no approval step; it now goes to the visible
channel. Classifier output is validated instead of cast, so an out-of-range
`line_cost` can no longer poison the CLAUDE.md budget. The daemon lock is
`O_CREAT|O_EXCL` rather than check-then-act.

### Always-on context: 15,143 → 5,568 chars per turn

Cut from metadata, not knowledge — skill and agent bodies load on demand and cost
nothing at rest. Agent descriptions 6,905 → 2,589 (three of fifteen agents held
71% of it in `<example>` XML). Skill listing 8,238 → 3,811. Seven skills carried
`disable-model-invocation` while an agent preloaded them; that flag also blocks
preloading, so those preloads were dead. 190 inert frontmatter keys removed.

### Guardrails

Budget gate rewritten in bun/TypeScript with a per-plugin ceiling — it previously
passed at 2.06× the real cap. New `autotest/skill-discovery` suite: of 542
pre-existing eval cases, none asserted a skill is *reachable*. A written
agent-vs-command-vs-skill rule in `CONTRIBUTING.md`.

Full review: `ai-docs/dev-plugin-team-review-2026-07-29.md`.

---

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

## [terminal 4.1.3] - 2026-07-29

### Fixed

- **`framework-signals` was unreachable by any path.** It carried both
  `disable-model-invocation: true` and `user-invocable: false`. The first removes
  auto-matching *and* subagent preloading; the second removes it from the `/` menu —
  together they leave no way to invoke the skill at all. Dropping `user-invocable: false`
  restores `/terminal:framework-signals` and costs nothing in listing budget, since
  `disable-model-invocation` already keeps it out.

---

## [go 0.1.1] - 2026-07-29

### Changed

- **`go-tui` description rewritten to the compliant form.** Leads with the capability and
  covers review and debugging alongside building, rather than opening with a tool list.

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

## [kanban 1.6.0] - 2026-04-24

### Changed
- **BREAKING — kanban decouples from GTD.** Independent store at `.claude/kanban/tasks.json`
  with a kanban-only schema (a `status` field, no GTD overlay).

### Migration notes
Legacy tasks in `.claude/gtd/tasks.json` are **not** auto-migrated. Re-add them with
`/kanban:add`.

---

## [Multimodel 3.1.2] - 2026-04-06

### Fixed
- **"internal" sentinel leaked to claudish** — added CRITICAL instruction to filter "internal" from the model list before passing to claudish `team()`. Previously, "internal" was sent as a real model ID, causing "model unavailable" failures.

---

## [Multimodel 3.1.1] - 2026-04-04

### Fixed
- **delegate/team commands inherit parent tools and model** — removed hardcoded `allowed-tools` and `model: opus` from both commands. Previously, delegate couldn't load the `claudish-usage` skill for alias resolution, causing heuristic file searches instead of deterministic lookups.

---

## [gtd 2.0.1] - 2026-03-29

### Changed

- **`gtd-capture` and `gtd-review` no longer appear in the `/` menu.** Both are triggered
  by the workflow rather than typed by a user, so they were taking up slash-palette space
  for nothing. Part of a marketplace-wide pass that set `user-invocable: false` on 125
  such skills. Note this does **not** reduce the skill listing budget — only
  `disable-model-invocation: true` does that — and pairing the two flags makes a skill
  unreachable entirely, which is what `terminal 4.1.3` and `agentdev 1.7.1` later repaired.

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
