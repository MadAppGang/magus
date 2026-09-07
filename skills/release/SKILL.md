---
name: release
description: Release one or more Magus plugins. Infers the version bump from git history, bumps plugin.json and marketplace.json, commits, and after the PR merges tags the merge commit with one explicit ref per tag; CI gates the PR and publishes the dist repos. Use whenever the user says "release kanban", "release the dev plugin", "cut a new version of gtd", "bump kanban to 1.7", or hands you a batch like "release kanban and gtd". Also use to check what a release would contain before committing.
---

# Magus Plugin Release

Cut a new version of one or more plugins. Merging the bump to `main` is what publishes
them; nothing on a workstation ever pushes to a dist repo.

## Repo layout and why it matters

- `magus-src` is the **source** repo. It carries `ai-docs/`, `autotest/`, `tools/`,
  `.claude/`, and other developer-only state. Users never install from here.
- `magus`, `magus-alpha`, `magus-marketing` are the **lean dist repos**. They contain
  only what users need at install time: `plugins/`, `shared/`, `skills/`, and a
  transformed `marketplace.json` with string `source` paths.
- **CI is the only publisher.** `.github/workflows/publish-dist.yml` fires on every
  merge to `main` that changes a version in `marketplace.json`, clones both sides
  fresh, and rebuilds each channel's dist repo with `.github/scripts/publish-dist.sh`.
  That script exits unless it is running inside GitHub Actions and has no override.
  To publish by hand: `gh workflow run publish-dist.yml`.
- **CI is also the only gate runner.** The `release-gates` job in
  `.github/workflows/test-plugins.yml` runs every release gate on the PR; there is no
  local release script.

So the only surface this skill handles is **magus-src**: the version commit, the PR, and
the tags on the merge commit.

## The pipeline

Three scripts, three phases. `infer.ts` proposes (read-only), `apply.ts` commits the
bump (local, reversible), `tag.ts` tags the merge (after CI has validated it).

```
infer.ts ─┐
          ├→ JSON proposal ─→ [you + user review/edit] ─→ apply.ts ─→ bump + commit
 git log ─┘                                                              │
                                                    git push branch, PR ┘
                                                                         │
                                CI: release-gates (test-plugins.yml) ◄──┤
                                                                         │
                                                          merge to main ┘
                                                                         │
                                       CI: publish-dist.yml publishes ◄──┤
                                                                         │
                                 tag.ts <proposal> <merge-sha> ◄─────────┘
                                   one annotated tag per plugin, pushed as an
                                   explicit ref — never `git push --tags`
```

## When the user says "release X"

### Step 1 — propose

Run the inference script with the plugin names. Always from the magus-src root.

```bash
bun run skills/release/scripts/infer.ts <plugin> [<plugin> ...]
```

The output is a single JSON object on stdout. It contains, for each plugin:
- `currentVersion` / `proposedVersion` / `bump` — bump kind is inferred from
  conventional commits since the last `plugins/<name>/vX.Y.Z` tag. `feat!` or
  `BREAKING` in body → major. `feat:` → minor. Everything else → patch.
- `description` — synthesized from commit subjects, breaking-first then feats
  then fixes. Short and scannable.
- `targets` — which dist repos list this plugin. Read from the `distTargets`
  array on the plugin's entry in `magus-src/.claude-plugin/marketplace.json`.
  A plugin with `targets: ["magus"]` publishes there only; `targets: []` means
  magus-src-only (metadata update, no dist effect).
- `commits` — raw commits since last tag, so you can sanity-check the inference.
- `warnings` — reasons to pause (dirty tree, no commits at all).

The feature work must already be committed. Inference reads commits, so an uncommitted
feature produces "no commits since last tag" and a patch bump for a minor change.

### Step 2 — review with the user

Show the user the proposal in a readable form. Don't just dump the JSON. The
decisions they might want to override:

- **The version bump.** Inference is conservative (patch by default) but sometimes
  commits don't follow conventions and a real feat was tagged `chore:`. Ask if the
  bump kind looks right.
- **The description.** Synthesized descriptions get the facts right but are dry.
  The user may want to rewrite for the commit subject and tag message.
- **Whether to proceed at all.** Zero commits since last tag is usually not worth
  releasing. Surface it and let them decide.

A good summary format:

```
Releasing:
  kanban  1.6.0 → 1.6.1 (patch, no commits since last tag)
  dev     2.7.0 → 2.8.0 (minor, 9 commits — FEAT: extend preset schema; FEAT: preset-file bypass; ...)

Warnings:
  - working tree has uncommitted changes — apply will refuse to run until clean

Does this look right? Any versions or descriptions to change?
```

If the user edits anything, rewrite the JSON to disk (e.g. `/tmp/release-proposal.json`)
with their changes applied. The JSON is the contract between `infer.ts`, `apply.ts`
and `tag.ts`.

### Step 3 — apply: bump and commit

```bash
bun run skills/release/scripts/apply.ts /tmp/release-proposal.json
```

The apply script is strict: it validates up front that the working tree is clean, that
every plugin is present in `.claude-plugin/marketplace.json`, that origin is reachable,
and that no proposed tag exists locally **or on origin**. It refuses rather than
patching around any of those.

If validation passes, it:
1. Updates `plugins/<name>/plugin.json` version for each plugin
2. Updates `marketplace.json` entry **version** for each plugin — never the
   `description`. That field says what the plugin *is* and is written by a human;
   the proposal's `description` is the release *note* and goes to the commit
   subject, the tag message, and CHANGELOG.md. Release notes reach the marketplace
   through `bun scripts/generate-releases.ts`, which fills the separate `releases`
   field from CHANGELOG.md.
3. Creates one commit for the whole batch on the current branch
   (`release(<name>): vX.Y.Z` for a single plugin, `release: <name> vX.Y.Z, <other> vA.B.C`
   for a batch)

Then it stops and prints the next two steps. Nothing has left the machine.

Before that commit, write the CHANGELOG entry (`## [<plugin> X.Y.Z] - YYYY-MM-DD`) and
run the generators (`bun scripts/generate-releases.ts`, `bun scripts/generate-plugin-catalog.ts`,
`./scripts/sync-shared-deps.sh`) so their output is in the tree the PR carries — CI only
checks, never regenerates. `apply.ts` requires a clean tree, so commit those first or
fold the bump into that commit by hand.

### Step 4 — push, PR, merge

```bash
git push -u origin <branch>
gh pr create --base main --title "release: <name> vX.Y.Z" --body-file <changelog-entry>
gh pr checks <n> --watch
gh pr merge <n> --merge
```

The `release-gates` job in `.github/workflows/test-plugins.yml` runs every release gate
on the PR: manifest parity, skill budget, `generate-releases.ts --check`, the
duplicated-file checks, doc references, the plugin rule catalog, the terminal contract
(`scripts/check-terminal-contract.ts`), the unit suites, catalog and diagram freshness.
A red job means a generator was not run or a check failed — fix it on the branch.

The merge is the release: `publish-dist.yml` sees the version change and publishes
every channel the plugins target. Watch it with `gh run list --workflow publish-dist.yml`;
every `publish (<target>)` job must be green, and a missing token fails the job rather
than skipping.

### Step 5 — tag the merge commit

```bash
bun run skills/release/scripts/tag.ts /tmp/release-proposal.json \
  "$(gh pr view <n> --json mergeCommit -q .mergeCommit.oid)"
```

One annotated tag per plugin, `plugins/<name>/v<X.Y.Z>`, at the merge commit, each
pushed as `refs/tags/<tag>`. Every push is a predicate: a tag already on origin at the
merge commit is skipped, one at any other commit stops the run — that version number
is taken, and a pushed tag is never deleted or moved. Bump and release again instead.

### Useful flags

- `apply.ts --dry-run` — validate and print every step without writing anything.
- `tag.ts --dry-run` — show which tags would be created and pushed.

## Adding a new distribution target

Distribution targets are declared per-plugin in the `distTargets` array on each
plugin's entry in `magus-src/.claude-plugin/marketplace.json`. To publish a plugin
to a new dist repo, add its name to that plugin's `distTargets` array, create the
dist repo, and add a row to the `matrix.target` list in
`.github/workflows/publish-dist.yml`. The inference picks the target up automatically.

## Failure modes and recovery

`apply.ts` has no auto-rollback. When it fails partway, it stops and leaves everything
in the state it reached. Everything it does is local:

- Files written but no commit: `git checkout -- plugins/ .claude-plugin/marketplace.json`
- Commit created: `git reset --hard HEAD~1` (nothing was pushed)

**After the merge** the commit is on `main` and CI may have published. Don't rewrite
history. Fix forward: make another commit with the correction and release the next
patch version. `v1.6.1` is always safer than undoing `v1.6.0`.

**A tag push failed partway**: rerun `tag.ts` with the same arguments. Tags already on
origin at the merge commit are skipped; the missing ones are pushed.

**A publish job failed**: read the run (`gh run view <id>`), fix the cause in a new
commit, and either merge that (if it changes a version) or dispatch the workflow by
hand: `gh workflow run publish-dist.yml`.

## Example invocations

Single plugin, let inference decide everything:
```bash
bun run skills/release/scripts/infer.ts kanban > /tmp/prop.json
# review with user, maybe edit /tmp/prop.json
bun run skills/release/scripts/apply.ts /tmp/prop.json
# push, PR, merge …
bun run skills/release/scripts/tag.ts /tmp/prop.json <merge-sha>
```

Batch release, pipe directly without intermediate file (only when the user has
already approved the inference output verbatim):
```bash
bun run skills/release/scripts/infer.ts kanban gtd dev | \
  bun run skills/release/scripts/apply.ts -
```

Dry run the bump to show the user what would happen:
```bash
bun run skills/release/scripts/infer.ts kanban | \
  bun run skills/release/scripts/apply.ts - --dry-run
```

## Common pitfalls

- **Conventional commits matter.** If a feat was committed as `chore:` the inference
  undercalls the bump. Read the proposed `commits` array before confirming — if you
  see a `fix(kanban): rewrote half the schema`, it's probably a minor or major.
- **Don't bypass the validation.** If apply.ts refuses because the tree is dirty,
  don't `git stash && apply && git stash pop` — the stash stack is shared across
  every worktree and the stashed changes can collide with the release commit.
  Finish or revert the work first.
- **Tag the merge, not the branch.** `tag.ts` refuses a commit that is not on
  `origin/main`. The branch head is what you tested; the merge commit is what shipped.
- **A plugin missing from marketplace.json** is a legitimate state — plugins can be
  magus-src-only during early development. `infer.ts` reports `targets: []` and
  everything still works; CI just has nothing to publish for it.

## What this skill explicitly does not do

- Run tests or gates locally. The user is responsible for verifying the plugin works
  before releasing; `bun run check:all` and pre-commit cover the cheap gates, and the
  `release-gates` CI job runs all of them on the PR.
- Update CHANGELOG.md or RELEASES.md. Those files are written by hand, not generated
  from commits.
- Publish. CI does, on the merge. Nothing here can reach a dist repo.
- Roll back a merged release. Use fix-forward (new patch version).
- Edit plugin manifests beyond `version`. Descriptions go in `marketplace.json`,
  not `plugin.json`.
