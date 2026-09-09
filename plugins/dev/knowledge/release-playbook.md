---
description: The per-project release playbook at ai-docs/release.md — its section schema, what belongs in each section, and the evidence-to-proposal tables that author one. Use when reading, writing, or drift-checking a project's playbook.
---

# The release playbook

A project's release playbook lives at `ai-docs/release.md`. It is the answer to everything
a release needs to know that **no file in the repo states**: who authorises, what order
things happen in, what counts as done, and what to do when it goes wrong.

Without it, every release re-derives the same answers, and the ones the repo cannot state
about itself get re-asked or guessed. The playbook is written once, followed thereafter,
and corrected when a release learns something new.

## The governing rule

**The playbook records judgement. It never copies facts.**

Versions, script names, gate lists, secret names and workflow steps live in manifests and
CI config. Those files are authority. The playbook **points at them** — by path, by
workflow name, by manifest field — and stops there.

This is not a style preference. A copied fact is a fact with two homes, and the copy is
the one that goes stale silently:

- The Magus marketplace repo's own `CLAUDE.md` keeps version numbers out of its plugin
  tables **deliberately**, and says so in the file: versions live in
  `.claude-plugin/marketplace.json`, which is the authority and is gated by a script. "A
  hand-copied version here drifts silently, and regenerating one is stale the moment the
  next release lands."
- The same repo deleted its committed model-aliases file outright. It had gone four months
  stale and was silently resolving dead model IDs — a copy of a catalog that nobody
  noticed had stopped matching the catalog. Model IDs are now resolved live, at call time,
  from the catalog itself.

Both are the same failure: a second copy of something that has an owner. A playbook that
lists this release's version, or enumerates the seven gates a CI job runs, has recreated
it. Point at the manifest. Point at the workflow. Record only the judgement.

The test to apply to any line before writing it: **is this stated anywhere else in the
repo?** If yes, replace the line with a pointer. If no, it belongs here.

## The template

Two sections are required. The rest are written when they apply and left out when they do
not — an empty heading is noise the next reader has to rule out.

The exception is a section where *nothing* is the decision. `Stages`, `Deploy monitoring`
and `Rollback` record an explicit `none` **with its reason**, because to the next agent an
omitted section and a decided-`none` section read identically, and only one of them means
"we thought about this".

```markdown
# Release playbook — <project>

## Authority
<one line per pointer: which existing document owns which part of the procedure>

## Artifacts
<what ships, to which registries or channels, and what "released" means here>

## Stages
<none, with reason | the promotion path in order, each hop with its gate>

## Dependencies
<this project's answers to the three preflight dependency checks>

## CI/CD
<which workflow publishes, its trigger, and what a soft-fail looks like HERE>

## Deploy monitoring
<none, with reason | what to watch, for how long, what counts as healthy>

## Verification
<the public surfaces to check, and what checks each one>

## Rollback
<per artifact class: the recovery path>

## Decisions
<who authorises; what may run autonomously>

verified: YYYY-MM-DD @ <sha>
```

The footer is the baseline the drift check compares against: the date the playbook was
last reconciled against the repo, and the commit it was reconciled at. A release that
finds no drift refreshes it; a release that finds drift reports it and does not.

## Section by section

### `Authority` — required

One line per pointer, naming what each existing document owns. This is the section that
keeps the playbook a pointer layer instead of a competing authority.

Write it as `<path> — <what it owns>`. If a project already has a release document, a
release skill and a checklist in its agent instructions, all three go here with their
scope, and the playbook adds nothing they already say.

If this section is hard to write because two documents claim the same step, that is a
finding about the project, not about the playbook. Record which one wins.

### `Artifacts` — required

What ships, where it lands, and what "released" means for this project. Publishing to a
registry, pushing to another repo, cutting a GitHub release and deploying a service are
four different meanings, and a project can have more than one.

Name the manifest that decides which artifact goes where. Do not restate its contents.

### `Stages`

The promotion path. `none` when a release is a single-shot publish — which is most
libraries, most plugins, and most CLIs.

When there are stages, write them in order with the gate on each hop: what must be true
before the release moves from one to the next, and who or what decides it.

### `Dependencies`

This project's answers to the three dependency checks the preflight phase runs:

1. **Lockfile in sync with the manifest** — which command proves it here.
2. **Internal lockstep** — in a workspace or monorepo, which packages must move together,
   and what pins them.
3. **External prerequisites** — whether this project's releases routinely wait on
   something outside it (an unmerged PR, a sibling repo, an unpublished dependency).

A project with no workspace and no cross-repo coupling answers 2 and 3 in one line each.
That is still worth recording: it is the difference between "checked, nothing" and "never
considered".

### `CI/CD`

Which workflow publishes, what triggers it, and — the part only judgement supplies —
**what a soft-fail looks like here**. A soft-fail is a run that goes green without having
published: a guard that decided nothing changed, a job skipped by an `if:`, a step with
`continue-on-error`, a matrix entry that never scheduled.

Name the specific shape this project can produce, and the command that distinguishes it
from a real publish. "Check CI is green" is not an answer — green is exactly what a
soft-fail looks like.

### `Deploy monitoring`

Whatever the user chose. `none` is a valid, explicit answer — record it with its reason
(a project that publishes a package does not deploy a service, so there is nothing to
watch). When it is not `none`, record what to watch, for how long, and what counts as
healthy, in terms concrete enough to execute without re-deciding.

### `Verification`

The **public** surfaces — what an outside user would see. Not "the tests passed": the
registry serves the new version, the dist repo carries the commit, the release page
exists, the deployed service reports the new build.

One line per surface, each with the check that confirms it.

### `Rollback`

Per artifact class, because they differ sharply. An immutable registry and a pushed tag
cannot be rolled back at all and the honest answer is forward-fix; a mutable channel
pointer or a running service usually can.

Say which class each artifact is in. "Forward fix only" is a real answer and worth
writing down, because the alternative is someone discovering it mid-incident.

### `Decisions`

Who authorises a release, and what the release command may do without asking. This is
pure judgement — nothing in the repo states it — so it is the section most worth having.

## Evidence to proposal

The command **analyses, proposes, the user decides, the answer is recorded**. It never
opens a blank interview, and it never invents a release model.

The rule that makes this safe: **propose only what there is evidence for.** Evidence means
a file that was actually read — a workflow, a manifest key, a platform config. Anything
else is a guess, and a guessed release procedure is worse than an absent one because it
reads as decided.

That trap is why this work sat parked. `plugins/terminal/skills/workspace-setup/SKILL.md`
defers CI and deploy monitoring at line 251 "pending live verification of platform output
strings" — the blocker was never the design, it was that nobody could responsibly hardcode
what each platform's output looks like. Reading it out of the repo in front of you avoids
the guess entirely.

Every table below ends with the same last row, always offered: **something else — describe
it**, free text, recorded verbatim. A user who knows something the scan cannot see must
have somewhere to put it.

**`unknown` plus a TODO is available in every mode, not only the autonomous one.** A row's
trigger can fire on evidence that is genuinely there while the answer it asks for is not
knowable from this repo — a platform config with no CLI installed to read its rollback
verb, a deployed URL in a repo carrying no source that would say what version it reports,
a monitoring SDK whose query only the user knows. Write `unknown` and the TODO naming what
would settle it. That is a recorded finding: the evidence fired, the answer is pending. It
is the honest alternative to the two bad options — inventing an answer, or leaving the
section blank so the next reader cannot tell it was ever considered.

### Stages

| Evidence in repo | Proposed to user |
|---|---|
| a workflow with an `environment:` key on more than one job | those environments in job order; gate = the previous job green |
| more than one deploy target in a platform config (a second `*.toml`, multiple named environments) | one stage per target; gate = manual promotion |
| release workflows triggered on distinct branches | one stage per branch; gate = the merge between them |
| a prerelease channel in the publish path (a dist-tag, a `next`/`beta` label) | prerelease then stable; gate = moving the channel pointer |
| a job that deploys, gated on the publishing job by `needs:` | publish then deploy, as two hops; gate = the upstream job green |
| one publish job on one trigger | `none` — single-shot publish |
| — | something else — describe it |

### CI/CD

| Evidence in repo | Proposed to user |
|---|---|
| a workflow job that publishes or pushes outward (registry publish, container push, release creation, a push to another repo) | that workflow and its `on:` trigger |
| a release-tooling config committed at the root (release-please, changesets, semantic-release, goreleaser, cargo-release) | the tool, plus the workflow that runs it |
| a `secrets.*` reference in the publishing job | that secret's name, and whether its absence fails the job or skips it — read the job and say which |
| `continue-on-error`, a conditional `if:`, or a guard job that can decide "nothing to publish" | that exact shape, named, as this project's soft-fail |
| a publish script in the manifest and no workflow that runs it | "no CI publisher" plus the script's name |
| nothing publishes anywhere | `none` |
| — | something else — describe it |

### Verification

| Evidence in repo | Proposed to user |
|---|---|
| a package manifest naming a public registry (npm, crates, PyPI, Go module path) | query that registry for the new version |
| a workflow that pushes to another repository | check that repo's default branch carries the release |
| a release-creation step in a workflow | check the release page exists and its assets attached |
| a container image name in a Dockerfile or workflow | check the tag resolves in that registry |
| a deployed URL in the README or a platform config | fetch it and read the version it reports |
| nothing public ships | record what "released" means instead, and how to see it |
| — | something else — describe it |

### Rollback

| Evidence in repo | Proposed to user |
|---|---|
| an immutable registry, or version tags pushed to origin | forward fix with a new version; never unpublish, never move a pushed tag |
| a mutable channel pointer (a dist-tag, a `latest` branch or ref) | move the pointer back to the last good version |
| a platform config for a host with a rollback verb | run that verb; record the exact command ONLY if the repo or an installed CLI states it — otherwise `unknown` plus what would settle it. A rollback command recalled from memory is executed during an incident |
| schema migrations touched by releases | the migration's own reverse path, or an explicit "no automated rollback" |
| nothing found | forward fix only — recorded explicitly, not left blank |
| — | something else — describe it |

### Deploy monitoring

| Evidence in repo | Proposed to user |
|---|---|
| a deploy job in a workflow | watch the run to completion, read annotations |
| a health endpoint in code, http checks in a platform config, container probes | poll that URL for a bounded window |
| an error-monitoring SDK in the manifest | check error rate after deploy — the user supplies the query |
| nothing found | propose `none`, confirm |
| — | something else — describe it |

## The honest cost

A playbook is a document about other documents, and documents about documents drift. Three
things hold it honest, and none of them is automatic:

- the pointer-not-copy rule, which leaves little that *can* go stale;
- the `verified:` footer, which dates the last reconciliation;
- the drift check on every release, which compares the playbook's claims against the repo
  and reports a mismatch instead of following it.

A drift check that always fires is not a check. When a playbook's claim is contradicted,
the fix is to correct the playbook in that release — not to loosen the check.
