---
name: index-skills
description: Walks every skill reachable from this project and writes a browsable markdown index, plus a small deterministic index spliced into CLAUDE.md. Explicit invocation only — run /setup:index-skills.
disable-model-invocation: true
argument-hint: "[--scope repo|project] [--claude-md] [--out SKILLS.md]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# Index skills

Renders every skill reachable from the current project into one markdown file,
with the number that actually matters attached to each: its **listing cost**.

## Why the cost column exists

Claude Code injects the `description` of every model-invocable skill into
*every turn*, budgeted at:

```
context_tokens x 4 x skillListingBudgetFraction     (fraction defaults to 0.01)
```

**There is no 8,000 hard cap** — verified against the 2.1.223 binary, where
`tBt()` computes `(contextTokens ?? 200000) * 4 * fraction` with no `Math.min`.
8,000 is what that yields at the 200,000-token fallback, so it is a floor, not a
ceiling: a 1M-context model gets 40,000. `--context <tokens>` measures against a
specific model.

The budget is **global across every installed skill** — all plugins, all
marketplaces, plus `~/.claude/skills`. It is not per-plugin. The listing
function takes one flat array and compares one total.

When the corpus overflows, Claude Code does not error. It switches from `fits`
to `priority` mode and **shortens descriptions** — stripping exactly the
keywords the matcher needs to route a request. A skill that quietly stopped
firing usually did not break; it got crowded out. The index makes that visible
before it bites.

Because the budget scales with the window, a corpus can fit on the model you
develop against and overflow on the model a user runs. The default here is the
200,000-token floor for that reason: what fits at 200k fits everywhere.
`skillListingMaxDescChars` separately caps each description at 1536.

A skill carrying `disable-model-invocation: true` costs zero and stays fully
reachable by explicit `/plugin:name`. That is the lever for getting back under
budget, and the index shows exactly which skills to pull it on.

## Run it

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/index-skills/scripts/index-skills.ts
```

The scope is detected from the directory, not guessed from its name:

| Scope | Detected when | Indexes |
|---|---|---|
| `repo` | `.claude-plugin/marketplace.json`, or any `plugins/<x>/plugin.json` | `plugins/*/skills/**` and repo-level `skills/` — what this marketplace ships |
| `project` | anything else | `.claude/skills`, `~/.claude/skills` autodiscovery, and every installed plugin — what you can invoke from here |

Flags:

| Flag | Effect |
|---|---|
| `--scope repo\|project\|auto` | Override detection. Default `auto`. |
| `--root <dir>` | Index a different directory. Default: cwd. |
| `--out <path>` | Where to write. Default `SKILLS.md` at the root. |
| `--compact` | Render the small flat index instead of the full one. |
| `--claude-md [path]` | Splice the small index into CLAUDE.md between markers. |
| `--tiered` | Two-level index: topics in CLAUDE.md, detail in per-group files. |
| `--topic-max <n>` | Names per group shown at level 1 before `+N more`. Default 5, `0` = all. |
| `--threshold <n>` | Groups smaller than this are named inline, no level-2 file. Default 4. |
| `--index-dir <path>` | Where level-2 files go. Default `.claude/skill-index`. |
| `--all` | Include preloaded skills too. |
| `--slash-only` | Narrow to `disable-model-invocation` skills only. |
| `--max-per-plugin <n>` | Cap names per plugin in the flat index. `0` = no cap. |
| `--stdout` | Print instead of writing. |
| `--json` | Emit the parsed skill records — for piping into other checks. |

## Two indexes, two jobs

They are not long and short versions of each other.

| | Full (`SKILLS.md`) | Small (`--claude-md`) |
|---|---|---|
| Read | when you open it | injected on **every turn** |
| Size | ~43 KB, every skill with its description | ~4.5 KB, names only |
| For | auditing the corpus, finding budget hogs | guaranteeing the model can find a skill |

## Why the small index names everything

The intuitive rule is "a model-invocable skill advertises itself through the
per-turn listing, so the index need not name it." **That holds only while the
listing fits its budget — and whether it does depends on the model.**

This marketplace emits 13,022 chars. Against the 200,000-token floor that is a
budget of 8,000, so roughly **47 of 77** descriptions survive a turn and the
rest are shortened. On a 1M-context model the budget is 40,000 and all of them
survive. Same corpus, different outcome, and the corpus does not know which
model a user runs.

That is the argument for a deterministic index, and it is a portability
argument rather than an overflow one: this block reads the same on every model,
where the listing does not.

It also inverts the priority. A listed skill carrying `user-invocable: false`
has **no fallback at all** when its description is shortened — the matcher
cannot match on what was cut and nobody can type it. 74 skills here are in
exactly that position — they are the skills that go missing first, and they are
the reason the block earns its context.

The trade is names against descriptions: **4.5 KB names all 126 at-risk skills
on every model**, where 13 KB of listing delivers all 77 descriptions on a 1M
model and about 47 on a 200k one. A name is a weaker signal than a description.
A name that is always present beats a description that may be cut.

## Tiered mode

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/index-skills/scripts/index-skills.ts --tiered --claude-md
```

Two levels instead of one flat list:

- **Level 1**, in CLAUDE.md: one row per topic group, naming what the group
  covers and pointing at its file. No invocation strings, so it cannot be acted
  on directly.
- **Level 2**, `.claude/skill-index/<group>.md`: the invocation strings and full
  descriptions for that group, read when the work is in that area.

Measured on this repo: level 1 is **2,825 chars** against the flat index's
**4,455** (37% less always-loaded), and level 2 holds **44,430 chars** of
descriptions across 13 files that were previously in no index at all.

### The grouping unit is not the plugin

`dev` has 48 skills spanning `frontend/` (react, tailwind, tanstack) and
`backend/` (golang, rust, python). One routing row cannot serve both. The split
already exists on disk, so a `skills/` subdirectory that contains skill
directories becomes its own group: `dev/frontend`, `dev/backend`. A plugin that
puts skills directly under `skills/` stays one group.

### Why `--topic-max` decides whether this pays

Enumerating every skill name at level 1 costs almost exactly what the invocation
strings cost — **3,986 vs 4,455 chars measured here, a 10% saving that does not
justify the extra Read**. The saving comes from *not* listing. At `--topic-max 3`
level 1 drops to 2,825.

So level 1 is a routing hint, not a directory. If you find yourself raising
`--topic-max` toward `0`, use the flat `--compact` index instead — it is the
same information without the indirection.

### The failure mode to know about

Level 1 alone invokes nothing. It buys depth at the price of a Read the agent
must actually perform, and a skipped Read means the skill is not found. That is
a real risk, and it is the reason level 1 carries an explicit instruction
("Before doing work in one of these areas, read that group's file") rather than
a bare pointer.

Groups below `--threshold` skip level 2 and name their skills inline, because
for a one-skill plugin the pointer costs more than the name it replaces. Here
that leaves 12 small groups inline and 13 groups behind files.

**Choose flat when** the corpus is small, or the agent must be able to invoke
without a Read. **Choose tiered when** CLAUDE.md is already crowded and you want
descriptions available at all.

## Reach

Every skill lands in one of four states, and the mark in the index says which.

| Mark | Reach | Found by | Risk |
|---|---|---|---|
| *(none)* | `listed` | the matcher, from its description | dropped when the listing overflows |
| `*` | `slash` | typed as `/plugin:name` | invisible to the matcher, always |
| `^` | `preloaded` | a command or agent that names it | none — its consumer routes to it |
| `!` | `unreachable` | **nothing** | it cannot be invoked at all |

`unreachable` is a real defect, not a category. A skill carrying both
`disable-model-invocation` and `user-invocable: false` is reachable only if
something preloads it, and a manifest entry does **not** count — registering a
skill is not routing to it. The index scans each plugin's `commands/` and
`agents/` for the skill's name; finding none, it reports the skill and the fix.

Preloaded skills are excluded by default: their consumer already names them at
the point of use, so a routing line would duplicate a pointer that works.
`--all` includes them.

## Reading the output

Three sections, in the order you need them:

1. **Summary** — totals, and the listing cost against the budget for the
   context size in use (200k unless `--context` says otherwise). If it is
   over, the file states roughly how many skills keep their descriptions.
2. **Listing cost by group** — sorted by cost, so the plugin crowding out the
   others is the first row. In a source repo the group is the plugin
   directory; in a project it is the full `plugin@marketplace` id.
3. **Skills** — per group, each skill's invocation string, description,
   whether it is `auto` (in the listing), `explicit` (slash only), or
   `not enabled`, plus its file path.

In project scope, plugins present in the cache but absent from
`enabledPlugins` are listed as `not enabled` and counted as **zero** cost —
they are on disk but contribute nothing to the turn. That distinction is the
whole point of running this in a project rather than reading a repo listing.

## Replacing hand-written skill prose in CLAUDE.md

A project that has been maintained for a while accumulates hand-written skill
routing: a table someone wrote, a bullet list under "available skills", a
paragraph naming four plugins. All of it goes stale the moment a skill is
renamed, and nothing detects that. Replacing it with the generated block is
the point of `--claude-md`.

**The work splits cleanly, and the split is not arbitrary.** Generating the
block and swapping it between markers is deterministic — the script does it,
byte for byte, and `spliceBlock` refuses to write when only one marker is
present rather than guessing where the region ends. Deciding *which existing
prose the block supersedes* is a judgement call about the user's own writing.
A regex cannot make it, and a script that tried would eventually delete a
paragraph that only looked like a skill list.

So: script writes, you decide what it replaces.

1. **Generate and splice.**

   ```bash
   bun ${CLAUDE_PLUGIN_ROOT}/skills/index-skills/scripts/index-skills.ts --claude-md
   ```

   This is idempotent. Run it as often as you like; it replaces its own block
   and touches nothing else.

2. **Find what it supersedes.** Search CLAUDE.md *outside* the managed block
   for content the generated index now covers:

   ```bash
   grep -n '^|.*`/[a-z-]*:' CLAUDE.md
   grep -niE '^#+ .*(skill|routing)' CLAUDE.md
   ```

   Candidates: routing tables whose rows are `/plugin:name` invocations,
   sections headed "Skill routing" or "Available skills", bullet lists of
   plugin names.

3. **Check each candidate for content the index does not carry.** This is the
   step that matters, and skipping it loses information. The generated block
   holds *names and counts*. A hand-written row often holds a **trigger
   condition** — "Before writing or reviewing ANY Bun HTTP server" — and that
   is routing intent the index cannot derive from frontmatter. Anything
   carrying a genuine when-to-use clause is not superseded; it is doing a job
   the index does not do.

4. **Confirm before deleting.** Show the exact lines with AskUserQuestion:
   which to remove, which to keep. Removing a section the user wrote by hand
   is not reversible from their side of the conversation.

5. **Delete only what was confirmed**, then re-run step 1 and verify one
   marker pair survives:

   ```bash
   grep -c 'skill-index:begin' CLAUDE.md   # must print 1
   grep -c 'skill-index:end' CLAUDE.md     # must print 1
   ```

**Never delete a hand-written section without replacing it in the same edit.**
A CLAUDE.md that loses its routing table and gains nothing routes worse than
one with a stale table.

## Getting under the listing cap

1. Run it. Read the summary line first.
2. If over the cap, open the cost-by-group table and start at the top row.
3. For each expensive skill, ask: *is this ever matched from context, or do I
   always type `/name`?* If it is always typed, set
   `disable-model-invocation: true` — the slash invocation is unaffected.
4. Re-run and confirm the total moved.

Flipping that flag moves a skill from `listed` to `slash`. It leaves the
listing budget entirely, and the small index keeps it discoverable for the cost
of an invocation string instead of a full description. That is the trade the
two indexes exist to make: pay ~25 chars per skill, always, rather than ~170
chars per skill, sometimes.

**Before setting that flag, check no agent preloads the skill.** The flag also
blocks subagent preloading, so flagging a preloaded skill silently breaks its
consumer. Grep the skill's name across `agents/` and command frontmatter first.

## Committing the index

`SKILLS.md` is generated. Regenerate it rather than editing it — the next run
overwrites hand edits without asking. If it is committed, regenerate whenever a
skill is added, renamed, or has its description rewritten.
