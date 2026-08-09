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

- **Bench YAML** — structure of a `madbench.yaml`, what each field controls
- **Checks** — designing assertions that fail for the right reason
- **Red-state testdata** — scaffolding a starting state where the check genuinely fails, so
  a passing run means something
- **Running and validating** — including the mock harness as a negative control
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

Run the mock harness first as a negative control: with `--harness mock`, every check must
FAIL. If something passes there, the check is not testing what you think.
