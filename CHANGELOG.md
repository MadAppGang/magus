# Changelog

> Filtered view. This lists only the plugins published to the `magus` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

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

## [Statusline 2.5.0] - 2026-08-04

### Changed

- **`RAM` now reports the whole Claude Code process tree, not just the entrypoint.** The segment ran `ps -o rss= -p "$CLAUDE_PID"` — the resident set of one process — but Claude Code forks helpers, and MCP servers and tools run as its children. Measured on the same machine at the same moment: an interactive session read **1300144 KB** for the entrypoint against **1587984 KB** for its tree, and an agent-SDK session read **320880 KB** against **870832 KB** — understated **2.7×**. The gap is not a fixed ratio; it depends on how many helpers and MCP servers a session is running, which is why it cannot be corrected with a multiplier and has to be measured. Expect the displayed figure to go up, in some cases to roughly double: that is the correction, not a regression.
- **The walk recurses to arbitrary depth, which is load-bearing.** In one measured tree the processes were `claude` → `bg-pty-host` → `bg-spare`; the deepest process held 293 MB of the 850 MB total, so summing only direct children would have missed a third of it.
- **One `ps -eo pid,ppid,rss` snapshot, walked breadth-first inside a single `awk`.** Not a `ps` per process: this renders on every prompt, and a fork per descendant is not a cost worth paying for a status line. `CLAUDE_PID` itself is included, and a `seen[]` set guards against cycles and against a process reparenting mid-snapshot, so no PID is counted twice and the walk cannot run away. Verified against an independently written ancestor-chasing implementation over the same snapshot — both return 1587984 KB — and against a hand-summed three-process tree, exact to the kilobyte.
- **Fails soft, in two steps.** If the tree walk yields nothing — unknown PID, `ps` unavailable — the segment falls back to the entrypoint's own RSS, exactly as before. If that is empty too, nothing renders. A memory reading is never worth breaking the status line over.
- **The figure is a slight overestimate, deliberately.** Summing RSS double-counts memory shared between the processes, mapped shared libraries most of all; a true proportional-set-size measurement needs per-process page-table introspection that macOS does not expose cheaply to a shell script running on every prompt. The trade-off is accepted because the segment answers *"what is Claude Code costing me in RAM"*, where the whole tree is the honest answer, rather than *"how big is one process"*, where it is not. It is documented in the script so the overcount is not later mistaken for a bug.
- **Unchanged:** `fmt_mem` and the `find_claude_pid` entrypoint matcher, both fixed in 2.3.0 and correct; the `RAM` label; the `sections.memory` config key; the `icons.nerd_font` glyph; the colour and placement. A minor bump rather than a patch because the number on screen changes meaning.

---

## [Statusline 2.4.0] - 2026-08-04

### Added

- **`icons.nerd_font` — opt-in Nerd Font glyphs.** A new top-level config group, parsed exactly like `sections` with the same `d(v; fallback)` helper, and **`false` by default**: `{ "sections": { … }, "icons": { "nerd_font": false } }`. When on, the RAM segment renders `󰍛 1.1G` (U+F035B, nf-md-memory) instead of `RAM 1.1G`. Exactly one space separates glyph from value either way, so the two forms are spaced identically and nothing else about the segment moves.
- **The plugin's no-Nerd-Font stance is unchanged by default.** Powerline and PUA codepoints need a patched font and render as tofu otherwise, which is why `⎇` (U+2387), `↻`, `🤖`, `⟳` and `⚡` were chosen: they are plain Unicode or emoji, render in any modern font, and are **not** governed by this key. No other segment converts in this release.
- **`/statusline:install` now probes for a patched font and asks.** It scans `~/Library/Fonts`, `/Library/Fonts` and `/System/Library/Fonts` for filenames matching `nerd|NF-|powerline` — ~17 ms, no dependencies, and deliberately not `fc-list`, which is usually absent on macOS. No match means the question is skipped entirely and `false` is written. A match means the sample line is printed **containing the real glyph** and the user is asked to confirm they see an icon rather than a box or a gap. The answer is merged into `~/.claude/statusline-config.json`, never written over it.
- **Why the font inventory alone cannot decide it:** Nerd Font coverage is **partial and varies by font**. Measured on a machine with 0xProto Nerd Font installed, `U+F035B` (nf-md-memory) renders while `U+F2DB` (nf-fa-microchip) and `U+F4BC` (nf-oct-cpu) come out as **blank space** — not tofu, which is worse, because a segment that silently vanishes looks like a bug rather than a missing glyph. Only Material Design (`nf-md-*`) glyphs are used, as the best-covered set, and "blank space" is offered as an explicit answer in the prompt so a user skimming for a box does not answer yes to an empty gap.
- The glyph is declared in an icon table with an `icon_or "$ICON_X" "TEXT"` helper rather than an inline branch, so a future segment opts in through the same key without duplicating the fallback rule.

### Changed

- **In a linked worktree, only the worktree chip renders — the branch chip is suppressed.** A worktree directory is conventionally named after its branch, so both chips printed essentially the same string twice: `* Opus | worktree-mcp-failed-auth | wt:mcp-failed-auth | …`. In the main worktree nothing changes: `WORKTREE_NAME` is empty there, so the branch chip renders as it always has.
- The suppression is gated on whether the worktree chip is **actually rendered** (`sections.worktree` on **and** a worktree name present), not merely on being inside a worktree. That distinction is the point: a user with `sections.worktree: false` still gets their branch chip, instead of losing both and seeing no git context at all. Both `sections.branch` and `sections.worktree` are honoured exactly as before, and neither chip's colour or formatting changed.
- **Known trade-off:** when a worktree's directory name differs from its branch — worktree `mcp-failed-auth` checked out on `feature/xyz` — only the directory name is shown and the branch name is hidden. `sections.worktree: false` brings the branch back.

---

## [Statusline 2.3.1] - 2026-08-04

### Changed

- **The memory segment is now labelled `RAM`, not `MEM:`** — it renders `RAM 1.1G`. In this product's context "memory" reads as LLM/agentic memory (MEMORY.md, mnemex) rather than the Claude Code process's resident set, which is what the number has always measured. The label is the whole fix: no emoji or glyph, because a brain would deepen the ambiguity and a neutral glyph reintroduces the "what does this mean" question an explicit word answers. Value, colour, and placement are unchanged.
- **The Claude-edits chip is now `🤖 +N/-M`** (U+1F916 ROBOT FACE) instead of `✨ +N/-M`. The two diff chips now pair semantically — 🤖 is what the agent wrote, `⎇` is what is uncommitted in git — where the sparkle was decorative and carried no meaning. Both glyphs are East Asian Wide, so column alignment is unchanged; colour, `+N/-M` formatting, and the hide-when-zero behaviour are untouched.
- The config key stays **`.sections.memory`** despite the `RAM` label. Renaming it to `ram` would silently break every existing `~/.claude/statusline-config.json`, and the key is not what the user reads on screen.

---

## [Statusline 2.3.0] - 2026-08-04

### Fixed

- **`MEM:` measured the statusline script instead of Claude Code.** `find_claude_pid()` walked up the process tree matching any command containing `claude`, and the statusline is invoked as `bash ~/.claude/statusline-command.sh` — that path contains "claude", so it matched at depth 0 and returned the script's own shell. The segment reported ~2–3 MB and had never once shown Claude Code's memory. Measured on the same machine, same moment: `MEM:2M` before, `MEM:1.0G` after.
- The matcher now identifies the Claude Code **entrypoint** from `argv[0]`, not from a substring of the whole command line: basename exactly `claude` (covers `claude`, `/usr/local/bin/claude`, `ClaudeCode.app/Contents/MacOS/claude`, and the agent-SDK binary), any command containing `@anthropic-ai/claude-code` (npm install, where `argv[0]` is the interpreter), or the native installer's versioned launcher `.../share/claude/versions/<version>`. Paths that merely contain "claude" — `~/.claude/shell-snapshots/…`, `statusline-command.sh` — are rejected, as is `op run … -- claude …`, which is a launcher rather than Claude itself. The walk continues upward past every rejection, keeping the existing 10-level depth cap.
- **When no Claude Code process is an ancestor, the segment is omitted** rather than falling back to whatever process happens to be nearby.
- **The PID cache self-heals.** `~/.claude/.statusline-pid-cache-<session>` entries written by earlier versions hold the wrong PID, and PIDs get recycled; the cached value is now re-validated against the entrypoint test on every render, not merely checked for liveness.
- **`fmt_mem` printed `1.10G`** for the top ~6 KB of every gigabyte — the tenths digit was `remainder / 104857`, which reaches 10. It is now `remainder * 10 / 1GB`.
- **Walking more than one level exposed a zsh bug** that would have blanked the segment outright: a bare `local ppid` re-declared on the second loop iteration makes zsh echo `ppid=<value>` to stdout, concatenating it into the function's result. Declared-and-assigned in one statement; verified identical output under both `bash` and `zsh`.

### Changed

- **The uncommitted-changes chip is now `⎇ +N/-M`** (U+2387 BRANCHING) instead of `● +N/-M`, so it reads as git rather than as a generic dot. Plain Unicode — deliberately not the Powerline branch glyph (U+E0A0), which is a private-use codepoint requiring a Nerd Font. Colour and `+N/-M` formatting are unchanged, and the `✨` Claude-edits chip is untouched so the two stay visually distinct.

---

## [Statusline 2.2.0] - 2026-08-03

### Added

- **claudish-routed session detection** — `CLAUDISH_ACTIVE_MODEL_NAME` or `CLAUDISH_TOKEN_FILE` in the environment is sufficient proof that the session is proxied to a non-Anthropic provider; either variable alone flips the statusline into claudish mode.
- **Provider plan usage segment** — when `CLAUDISH_TOKEN_FILE` exposes a `plan` block, the active provider's own windows render in place of the Anthropic ones, in the same visual style: one bar coloured by the most-consumed window, per-window `id:pct%` labels, `↻` reset countdowns, and the same ≥80% critical highlight. The window list is arbitrary-length with arbitrary ids — nothing assumes `5h`/`7d`. No provider ships the block today, so the segment renders **nothing** in the common case: no placeholder, no dangling separator.
- **`.sections.claudish_plan` config key** (default `true`) to hide the new segment on its own. The existing `.sections.plan_limits` still suppresses plan output entirely, claudish or not.

### Changed

- **Anthropic plan limits are suppressed on claudish-routed sessions** — those percentages describe an Anthropic account the session is not spending. Both sources are cut: the native `.rate_limits` fields are blanked, and the `api.anthropic.com/api/oauth/usage` fallback poll is gated *independently*, because blanking the fields alone would have been read as "data missing" and triggered the poll. Skipping the poll also stops it writing `.statusline-usage-cache.json`, which would otherwise leave a stale cache for the user's real Anthropic sessions to read.
- Non-claudish sessions are byte-identical against all 9 shipped fixtures — the routing check is the only new branch on that path.

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
