# Madbench

Toolkit for [madbench](https://github.com/MadAppGang/madbench), MadAppGang's Go harness for
benchmarking agentic coding tools. Website: <https://madbench.web.app>.

The plugin carries a copy of madbench's own skills, a `/madbench` entry point for creating and
running benches, an operator agent that runs a bench in a visible terminal pane, and checks that the
skills still match the madbench you have installed.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "madbench@magus": true } }
```

You also need the madbench harness itself on your PATH, and the `terminal@magus` plugin,
which the operator uses to open the pane a real run happens in. The manifest declares that
dependency.

## What ships

| Component | Address | What it is for |
|---|---|---|
| Skill | `/madbench:madbench` | **The entry point.** Checks your madbench against the skills, then creates, runs, debugs, reviews or migrates a bench. Slash-only: it is not in the skill listing. |
| Skill | `/madbench:migrate` | Brings a Bench or Experiment written for an older madbench to the installed one, fixing each refusal exactly as the loader names it. Slash-only; the entry point routes to it. |
| Skill | `skills/madbench-evals/` | The reference: schema, checks, harness and sandbox, debugging, and madbench's Glossary (`glossary.md`). Read by path from the entry point and the agent; not a slash command. |
| Command | `/madbench:doctor` | Three mechanical checks: the skills against your madbench, bench layout, generated index. No agent, output printed verbatim. |
| Agent | `madbench:bench` | Loads the reference by path, writes or fixes the bench, runs the two controls, then runs the bench in a split pane with madbench's own colour output. |
| Hook | `Stop` | Refuses to end a turn while a dispatched `madbench:bench` agent has not reported back. Silent in every other session. |

**Why the entry point is `/madbench:madbench` here, and `/madbench` in a project.** Claude
Code names a plugin's commands and skills `/<plugin>:<name>`; measured on 2.1.283, a bare
`/madbench` is not registered for a plugin at all, while a skill in a project's
`.claude/skills/` answers to its bare name. To get `/madbench` in a project, let madbench
install its skills there:

```bash
madbench skills            # into ./.claude/skills — madbench 0.38.0 or later
```

**The operator runs in the background, and nothing waits for it.** Every `Agent` call in
current Claude Code returns at once and the operator keeps working. The parent says it
dispatched the operator and ends its turn; when the operator finishes, Claude Code delivers
a task notification that starts the parent's next turn, and the parent reports from the
operator's result. Nothing blocks the session, so nothing can hang it. This plugin used to
carry a Stop hook that held the parent's turn open with `TaskOutput`; Claude Code removed
`TaskOutput` in 2.1.277, and the hook was deleted on 2026-10-08.

## Who owns what

**The skills belong to madbench.** `skills/madbench/`, `skills/madbench-evals/` and
`skills/migrate/` are written in the madbench repository and ship with the release they
describe; this plugin carries a copy. A mistake in them is fixed upstream and synced back,
never edited here.

**This plugin owns only the Claude Code setup around madbench**: the operator agent,
`/madbench:doctor`, and the bench-layout conventions of this marketplace.

**Nothing here reimplements madbench.** Running, grading, checks, report parsing, run status,
bench validation, hooks around a run and version checks are madbench's. Something missing is
a feature request to `MadAppGang/madbench`; something broken is a bug report there. A local
stand-in is allowed only while the issue is open, marked `TEMPORARY` with the issue number,
and deleted when madbench ships the real one. The last two — a skills installer and a version
compare — were deleted when madbench 0.38.0 shipped `madbench skills`.

## Which madbench the skills were written for

Every skill directory carries `MADBENCH_VERSION`: one line, `x.y.z`, written by
`madbench skills` at install. Nothing else restates it.

- **When you use madbench** — `/madbench:madbench` and the operator ask madbench first
  (`madbench skills --check`) and say so when the skills and the binary differ: *"You're
  using madbench 0.38.1, but your madbench skills were written for 0.38.0."* On a difference,
  the entry point asks whether to run `madbench update --check`.
- **`/madbench:doctor`** check 1 is the same `madbench skills --check`, verbatim.
- **CI** runs it weekly against the latest release; a stale copy turns the job red.
- **A pinned set is current.** `madbench skills --pin` writes `MADBENCH_PINNED` beside each
  stamp to hold a set at one release on purpose; a plain `madbench skills` then installs
  nothing, and `--check` reports `pinned`.

## Where the skills come from

A maintainer syncs the plugin's copy from a madbench release, in the same PR as the plugin
version bump:

```bash
madbench skills --dir plugins/madbench/skills
madbench skills --check --dir plugins/madbench/skills    # must say: current
```

madbench leaves out each skill's `evals/` (authoring material it keeps upstream) and refuses
to overwrite a directory it did not install.

## The rule worth knowing up front

**Never conclude from a single pair of runs.** These tasks are nondeterministic. Run with
`--trials` and read rates, not anecdotes. A treatment-and-control pair that both pass reads
as success and is not, since the control carries none of the change under test.

Run the negative control first: `madbench check <bench>` runs it under the mock harness
and requires **every check** to fail. If something passes there, the check is not testing
what you think, and a plain run's exit code will not tell you — a graded miss exits 0, and
`--fail-on-failure` goes nonzero once *any* Scenario fails. Read the tally line, which counts
them.

## Bench layout

One bench root at the project root, one directory per bench, a `README.md` with `id`,
`question`, `status`, `last_run` and `binary` frontmatter, no loose TypeScript at a bench
root, no alias YAML key. `/madbench:doctor` check 2 enforces it;
`templates/claude-md-conventions.md` is the paragraph to paste into a project's `CLAUDE.md`.
