# Madbench

Toolkit for [madbench](https://github.com/MadAppGang/madbench), MadAppGang's Go harness for
benchmarking agentic coding tools. Website: <https://madbench.web.app>.

The plugin does three things: it teaches Claude Code how to author a bench that measures
what you think it measures, it runs benches for you through an operator agent in a visible
terminal pane, and it checks that the skill still matches the madbench you have installed.

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
| Command | `/madbench:bench` | Author, run, or debug a bench. Dispatches the operator with your request. |
| Command | `/madbench:doctor` | Three mechanical checks: skill staleness, bench layout, generated index. No agent, output printed verbatim. |
| Agent | `madbench:operator` | Loads the skill by path, writes or fixes the bench, runs the two controls, then runs the bench in a split pane with madbench's own colour output. Never a wrapper, never `--plain`, never a background job. |
| Skill | `skills/madbench-evals/` | The authoring reference. Read by the operator by path; it is not in the skill listing and not a slash command. |
| Hook | `Stop` | Refuses to end a turn while a dispatched operator has not reported back. Silent in every other session. |

**Why the hook exists.** Every `Agent` call in current Claude Code is asynchronous: it
returns a task id at once and the operator keeps working, so a parent that replies closes
the session and kills the run mid-flight. `/madbench:bench` says three times to block on
`TaskOutput` instead; measured on the MBN-1 bench with `--repeat 5` twice, parents that
actually waited were 3/5 and then 2/5. The hook replaces that coin flip with a mechanism —
and gives up, letting the turn end, on an unreadable transcript, a dispatch older than 45
minutes, or after six consecutive blocks for one task id, because a Stop hook that can trap
a session is worse than none.

The skill carries `disable-model-invocation: true` and `user-invocable: false` on purpose:
it costs nothing in the per-turn skill budget, and the operator is its only consumer. To use
it, run `/madbench:bench`.

## The skill covers

- **Bench YAML** — structure of a `madbench.yaml`, what each field controls, and what
  strict decoding does and does not catch
- **Checks** — every registered type by family, designing assertions that fail for the right
  reason: thread- and outcome-scoped Session checks, path matchers, `readout:`, the
  `environment:*` family, and `model:current`
- **Metrics** — the `metrics:` block, sample-stage pushes, and a bench-local `module/`
  for anything the expression form cannot say
- **Drive mode** — `interactive:` is the default, and permission modes mean different things
  on the two paths. This is the single most expensive thing to get wrong
- **Red-state testdata** — scaffolding a starting state where the check genuinely fails, so
  a passing run means something; `repo:` for a pinned third-party checkout, `setup:` for
  staging, and `generate:` for when the answer must be unguessable
- **Running and validating** — the two controls, `madbench check` (negative, per check)
  and `madbench grade` (positive, offline), and what each exit code means
- **Tuning expectations** — when a bench is too strict, too loose, or measuring the wrong thing
- **Debugging failing checks** — separating harness problems from subject problems
- **When madbench is missing something** — draft an upstream issue, never a workaround

## Which madbench release the skill mirrors

`mirrors.json` is the one place that says. No other file in this plugin restates the
version. `/madbench:doctor` check 1 compares it against `madbench version` and, as the
real gate, loads every example bench with the installed binary; a bench the skill teaches
that your madbench refuses is the finding.

## The rule worth knowing up front

**Never conclude from a single pair of runs.** These tasks are nondeterministic. Run with
`--repeat` and read rates, not anecdotes. A treatment-and-control pair that both pass reads
as success and is not, since the control carries none of the change under test.

Run the negative control first: `madbench check <bench>` runs it under the mock harness
and requires **every check** to fail. If something passes there, the check is not testing
what you think, and the exit code alone will not tell you, because it is non-zero if
*any* check fails. Read the tally line, which counts them.

## Bench layout

One bench root at the project root, one directory per bench, a `README.md` with `id`,
`question`, `status`, `last_run` and `binary` frontmatter, no loose TypeScript at a bench
root, no alias YAML key. `/madbench:doctor` check 2 enforces it;
`templates/claude-md-conventions.md` is the paragraph to paste into a project's `CLAUDE.md`.
