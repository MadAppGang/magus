---
name: migrate
description: Brings a madbench Bench or Experiment written for madbench v0.41.0 or later to the installed madbench, applying the changes `changes.md` records between the two versions. Use when a bench no longer loads after an upgrade.
argument-hint: "<bench or Experiment path>"
disable-model-invocation: true
---
<!-- Owned by the madbench repository and shipped by `madbench skills`; a copy anywhere else
     is a copy, fixed upstream. `changes.md` beside this file is the only record of key, flag
     and file changes since v0.41.0; this file carries no key map. -->

# Migrate a Bench or Experiment to the installed madbench

Target: $ARGUMENTS

With no path, ask for one. A directory means every `madbench.yaml`, `*.madbench.yaml` and
`*.experiment.yaml` in it, one file at a time.

## Step 0 — the Glossary and versions, before anything else

1. Read `../madbench-evals/glossary.md`, relative to this skill's directory. Write only its
   words for madbench concepts; translate the user's words, never echo them.
2. Run `madbench skills --check` and quote its output (Step 0 of `../madbench/SKILL.md`
   says how to read it). You migrate to the **installed** binary, and `changes.md` must
   cover it: an unpinned set older than the binary is updated first (`madbench skills`),
   with the user's yes.

## Step 1 — the two versions

- **Installed:** `madbench version`, quoted.
- **Written for:** the version the user says the file was written for. With no answer, take
  v0.41.0 **provisionally**: Step 3 can still find that the file is older.

This skill knows v0.41.0 and every release after it, and nothing earlier. A file written for
a madbench older than v0.41.0 is outside what it knows: say so, and rewrite the file against
`../madbench-evals/schema.md` as new authoring, showing the user every change. This is the
**rewrite path**. Do not reconstruct an older format from memory, and do not report such a
file upstream: an older format is not a madbench gap.

## Step 2 — apply `changes.md`

Read `changes.md` beside this file. A `## vX.Y.Z` section is what release X.Y.Z changed, so a
file written for v0.41.0 takes the `## v0.42.0` section. Take every section newer than the
file's version and not newer than the installed one, oldest first. Apply each old → new line in
those sections exactly as written, and nothing else. A section with no lines changed nothing
that a file spells.

## Step 3 — load it

```bash
madbench list <file>
```

Quote the output verbatim. Exit 0 means it parses; go to Step 4.

An unknown key fails like any typo: `field X not found in type …`, naming the key, the line
and the type it was read into, and nothing else. A key the applied sections did not cover is
not guessed from memory. Look it up in `../madbench-evals/schema.md` and
`../madbench-evals/glossary.md`, make the change, and run `madbench list` again.

A key that neither `schema.md`, `glossary.md` nor an applied `changes.md` section covers goes
one of two ways, decided by Step 1's version:

- **The version is provisional** (the user did not state one) **or older than v0.41.0:** the
  file predates v0.41.0. Tell the user, and take Step 1's rewrite
  path. No bug report.
- **The user stated v0.41.0 or later:** it is a gap, because `changes.md` should have
  recorded it. Follow the gap rule in `../madbench-evals/SKILL.md` (a bug report upstream,
  drafted and shown before it is sent).

**Loop until it loads.** The strict decoder names every unknown key it reads in one pass, but
it never reads beneath an unknown key, so fixing a parent can reveal unknown keys under it on
the next pass. Each pass: quote, fix the keys named, re-run. Never batch-rewrite keys the
loader has not named.

## Step 4 — the free gates, in order

`list` proves the file parses, not that it can run. Check types are built at preflight, so
an unknown check type passes `list` and fails here as `unknown check type`. Treat it the way
Step 3 treats an unknown key.

```bash
madbench preflight <file>    # exit 3 = blocked, each finding naming its fix; 1 = a Check could not be built
madbench check <file>        # the negative control: every graded Check must fail
```

Quote each verbatim, with its exit code. Fix a preflight finding exactly as it is named, then
re-run. A `madbench check` that reports `WRONGLY PASSED` is not a migration error: it is a
Bench that never measured anything, and it goes back to the user as a finding (the review
checklist in `../madbench-evals/SKILL.md`), not a silent fix.

An Experiment: run the gates on the Experiment file, which loads the Bench it names once per
variant.

## Step 5 — the words

With the file loading, rewrite what the loader cannot see: `description:` values, Scenario
descriptions, YAML comments, and any README beside the Bench. Every deprecated word or other
tool's word from `glossary.md` used for a madbench concept becomes the Glossary's word —
"test case" → Scenario, "fixture" → testdata, "arm" → variant. A word naming another tool's
own feature stays: that is a quotation.

## Step 6 — stored reports are re-run, never edited

A report or store whose `schema_version` is not the installed madbench's is refused by
`madbench report` and `madbench grade`. Do not hand-edit one into the current shape. Re-run
the Bench and keep the new report.

## Report

```
madbench <version> · skills for <MADBENCH_VERSION>

File             <path>
Written for      <version, and whether the user said it or it is the provisional v0.41.0 — or "older than v0.41.0: rewritten as new authoring">
Changes applied  <each changes.md line applied, with its section — or "none">
Load             <each `madbench list` line quoted, and the change made for it — or "loaded first time">
Free gates       list / preflight / check — exit and one line each, verbatim
Words            <each description or comment rewritten, old → new — or "none">
Reports          <reports of another schema_version found, and "re-run" — or "none">
Gaps             <none | in a file the user stated is v0.41.0 or later, an unknown key neither changes.md nor schema.md covers, and the bug report, sent or awaiting approval>
```
