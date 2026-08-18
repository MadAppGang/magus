# Madbench

Toolkit for [madbench](https://github.com/MadAppGang/madbench), MadAppGang's Go harness for
benchmarking agentic coding tools.

The plugin does not run benchmarks itself. It is the authoring knowledge: how to write a
bench that measures what you think it measures, and how to tell a real regression from a
noisy one.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "madbench@magus": true } }
```

You also need the madbench harness itself on your PATH. This plugin teaches Claude Code how
to author and debug benches for it.

## The skill

`madbench:madbench-evals` covers the whole authoring loop:

- **Bench YAML** — structure of a `madbench.yaml`, what each field controls, and what
  strict decoding does and does not catch
- **Checks** — designing assertions that fail for the right reason, including thread- and
  agent-scoped Session checks, path matchers, and `model:current`
- **Red-state testdata** — scaffolding a starting state where the check genuinely fails, so
  a passing run means something; and `generate:` for when the answer must be unguessable
- **Running and validating** — the two controls, `madbench check` (negative, per cell) and
  `madbench grade` (positive, offline)
- **Tuning expectations** — when a bench is too strict, too loose, or measuring the wrong thing
- **Debugging failing checks** — separating harness problems from subject problems

Invoke it by name:

```
/madbench:madbench-evals
```

## The rule worth knowing up front

**Never conclude from a single pair of runs.** These tasks are nondeterministic. Run with
`--repeat` and read rates, not anecdotes. A treatment-and-control pair that both pass reads
as success and is not, since the control carries none of the change under test.

Run the negative control first: `madbench check <bench>` runs it under the mock harness
and requires **every cell** to fail. If something passes there, the check is not testing
what you think — and the exit code alone will not tell you, because it is non-zero if
*any* cell fails. Count cells, which is what `check` does.
