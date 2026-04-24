---
name: release
description: Release one or more Magus plugins to the distribution repos (magus, magus-alpha, magus-marketing). Handles version inference from git history, marketplace.json updates, tagging, and force-push to lean dist repos. Use whenever the user says "release kanban", "release the dev plugin", "cut a new version of gtd", "bump kanban to 1.7", or hands you a batch like "release kanban and gtd". Also use for multi-plugin releases and for checking what a release would contain before committing.
---

# Magus Plugin Release

Cut a new version of one or more plugins and publish them to the distribution
repos that users install from.

## Repo layout and why it matters

- `magus-src` is the **source** repo. It carries `ai-docs/`, `autotest/`, `tools/`,
  `.claude/`, and other developer-only state. Users never install from here.
- `magus`, `magus-alpha`, `magus-marketing` are the **lean dist repos**. They
  contain only what users need at install time: `plugins/`, `shared/`, `skills/`,
  and a transformed `marketplace.json` with string `source` paths. `publish-dist.sh`
  force-rebuilds these from magus-src on every release — they have no independent
  history worth preserving.

Because dist repos are force-rebuilt, the skill never worries about their commit
history. The only surface that needs careful handling is **magus-src**: the commit,
the tag, the push.

## The pipeline

Release is a two-phase split between **propose** (read-only, produces JSON) and
**apply** (all side effects). The scripts do the mechanical work; your job is to
make the judgment calls in between.

```
infer.ts ─┐
          ├→  JSON proposal  ─→  [you + user review/edit]  ─→  apply.ts
 git log ─┘                                                         │
                                                                    ├→ git commit + tag
                                                                    ├→ git push
                                                                    ├→ scripts/release.sh
                                                                    └→ scripts/publish-dist.sh
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
- `warnings` — reasons to pause (dirty tree, missing dist repo, no commits at all).

### Step 2 — review with the user

Show the user the proposal in a readable form. Don't just dump the JSON. The
decisions they might want to override:

- **The version bump.** Inference is conservative (patch by default) but sometimes
  commits don't follow conventions and a real feat was tagged `chore:`. Ask if the
  bump kind looks right.
- **The description.** Synthesized descriptions get the facts right but are dry.
  The user may want to rewrite for marketplace readability.
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
with their changes applied. The JSON is the contract between `infer.ts` and `apply.ts`.

### Step 3 — apply

Once confirmed, pass the JSON to the apply script:

```bash
bun run skills/release/scripts/apply.ts /tmp/release-proposal.json
```

The apply script is strict: it validates up front that the working tree is clean,
proposed tags don't exist, every plugin is present in `.claude-plugin/marketplace.json`,
and the origin is reachable. **It will refuse to proceed if any of those are false**,
not patch around the problem.

If validation passes, it:
1. Updates `plugins/<name>/plugin.json` version for each plugin
2. Updates `marketplace.json` entry (version + description) for each plugin
3. Creates one commit for the whole batch (`release(<name>): vX.Y.Z` for a single
   plugin, `release: <name> vX.Y.Z, <other> vA.B.C` for a batch)
4. Creates one tag per plugin: `plugins/<name>/v<X.Y.Z>`
5. Pushes `main` and tags to origin
6. Runs `scripts/release.sh` (syncs shared deps, bumps magus-alpha SHAs if present)
7. Runs `scripts/publish-dist.sh` (force-pushes the lean build to `MadAppGang/magus`)

### Useful flags

- `--dry-run` — run validate + print every step without writing anything. Use when
  the user wants to see the full plan before committing.
- `--skip-push` — do the local commit + tag but don't push or publish. Useful if
  the user wants to inspect the commit before it hits origin.

## Adding a new distribution target

Distribution targets are declared per-plugin in the `distTargets` array on each
plugin's entry in `magus-src/.claude-plugin/marketplace.json`. To publish a plugin
to a new dist repo (e.g. `magus-marketing`), add its name to that plugin's
`distTargets` array. The inference picks it up automatically; no skill code needs
to change.

Of course, the dist repo itself must exist and `scripts/publish-dist.sh` must
know how to populate it — that's a separate concern handled in the publish-dist
script, not the release skill.

## Failure modes and recovery

The apply script has no auto-rollback. When it fails partway, it stops and leaves
everything in the state it reached. Recovery is driven by the user — two options
depending on where the failure lands:

**Failed before push** (file writes done, commit maybe done, tag maybe done, nothing
left the machine):
- If the commit wasn't created: `git checkout -- plugins/ .claude-plugin/marketplace.json`
- If the commit was created but tag wasn't: `git reset --hard HEAD~1`
- If commit + tag both created: `git tag -d plugins/<name>/v<X.Y.Z>` then
  `git reset --hard HEAD~1`

**Failed after push** (the commit and tag are on origin):
- Don't try to delete them. History rewriting is destructive and the dist repos
  may already be partially rebuilt.
- Instead, fix forward: make another commit with the correction and release a new
  patch version. `v1.6.1` is always safer than undoing `v1.6.0`.

Tell the user which state they're in (apply.ts prints clear markers before each
phase) and let them pick. Do not attempt rollback silently.

## Example invocations

Single plugin, let inference decide everything:
```bash
bun run skills/release/scripts/infer.ts kanban > /tmp/prop.json
# review with user, maybe edit /tmp/prop.json
bun run skills/release/scripts/apply.ts /tmp/prop.json
```

Batch release, pipe directly without intermediate file (only when the user has
already approved the inference output verbatim):
```bash
bun run skills/release/scripts/infer.ts kanban gtd dev | \
  bun run skills/release/scripts/apply.ts -
```

Dry run the whole pipeline to show the user what would happen:
```bash
bun run skills/release/scripts/infer.ts kanban | \
  bun run skills/release/scripts/apply.ts - --dry-run
```

## Common pitfalls

- **Conventional commits matter.** If a feat was committed as `chore:` the inference
  undercalls the bump. Read the proposed `commits` array before confirming — if you
  see a `fix(kanban): rewrote half the schema`, it's probably a minor or major.
- **Don't bypass the validation.** If apply.ts refuses because the tree is dirty,
  don't `git stash && apply && git stash pop` — the stashed changes can collide
  with the release commit. Finish or revert the work first.
- **A plugin missing from marketplace.json** (any dist repo's) is a legitimate state
  — plugins can be magus-src-only during early development. `infer.ts` reports
  `targets: []` and everything still works; `publish-dist.sh` just won't pick it up.

## What this skill explicitly does not do

- Run tests. The user is responsible for verifying the plugin works before releasing.
- Update CHANGELOG.md or RELEASES.md. Those files are manual prose, not generated
  from commits.
- Rollback a pushed release. Use fix-forward (new patch version).
- Edit plugin manifests beyond `version`. Descriptions go in `marketplace.json`,
  not `plugin.json`.
