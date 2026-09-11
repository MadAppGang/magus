---
name: bench
description: Author, run, or debug a madbench bench through the operator agent — bench YAML, Eval files, red-state testdata, the two controls, and a real run in a visible pane
allowed-tools: Agent, TaskOutput, Bash, Read, Glob, Grep
---

## Mission

Dispatch the `madbench:operator` agent at one madbench request, **then wait for it**. The
operator authors the bench, runs the free gates, and runs the real bench in a split pane the
user can watch. It never writes a wrapper around madbench; a gap comes back as a drafted
issue.

**Two turns, not one.** Your reply is the operator's report. There is no earlier reply: not
"I've dispatched the operator", not "it's working in the background", not "I'll report
back". The Agent tool returns before the operator has done anything, and the moment you
reply, the session ends and the operator dies with it. Measured on `--repeat 5`: two of
five runs of this command replied early anyway, at 39 and 46 seconds, and both operators
were killed after reading their skill. Step 2b is how you wait.

## Request

$ARGUMENTS

## When to use it

- **Author** — write a `madbench.yaml` or an Eval file for a question about an agent's behaviour
- **Run** — run an existing bench, watchably, and read its report
- **Debug** — a bench fails `madbench check`, `preflight` refuses it, or a Check grades wrongly
- **Extend** — add a Check, a `metrics:` expression, a `control:` block, staged plugins
- **Review** — is this bench measuring anything, and is its testdata red

## Step 1 — read the request

Parse three things out of `$ARGUMENTS` before dispatching:

1. **Which bench** — a path under the project's bench root, or a new one to create
2. **What is wanted** — author, run, debug, extend, review
3. **What may be spent** — a real run costs money; the free gates cost nothing. If the request
   is ambiguous about whether a paid run is wanted, say the operator will stop after
   `madbench check` and report, and let the user ask for the run.

**A specific question beats a broad one.** "Bench the plugin" buys a tour; "does the new
routing row make the agent read the skill file" buys one Scenario with one positive check.
If the request is broad enough that the operator would spend its time on orientation, narrow
it first.

## Step 2 — dispatch the operator

```
Agent(
  subagent_type: "madbench:operator",
  run_in_background: false,
  description: "madbench: [brief description]",
  prompt: `
    [the request, restated as one specific task]

    Bench: [path, or "new — under the project's bench root"]
    Wanted: [author | run | debug | extend | review]
    Paid run: [yes | no — stop after the free gates and report]
    Working directory: [current working directory]

    Return the Operator report: the madbench version line, the files touched, the free
    gates' output verbatim, the run (slot, command, report path) or why not, the result
    read from the report JSON, and any drafted issue.
  `
)
```

**Do not run madbench from here.** The operator owns the split pane; a run started from the
command through `Bash` has no terminal on stderr, which implies `--plain` and hides the run
the user asked to watch. **`run_in_background` stays `false`** for the same reason — a
backgrounded operator is a hidden run.

## Step 2b — wait for the operator; never end your turn while it runs

The Agent tool returns at once with a task id, and the operator keeps working after that.
**Your turn ending ends the session, and with it the operator and the run the user asked
to watch.** Measured: a first run of this command replied "it's working in the background,
I'll report back" three seconds after dispatch, the session closed, and the operator died
after reading its skill and before opening a pane.

So, immediately after the dispatch, block on it:

```
TaskOutput(task_id: "<the id the Agent tool returned>", block: true, timeout: 600000)
```

Repeat that call until the result says the operator completed. Do not write a reply, a
status line, or a promise to report later in between. A real run is minutes long; waiting
is the work. The only reply you write is the one in Step 3, after the operator's report is
in your hands.

The tell that you are about to get this wrong: the words "in the background" or "I'll
report back" forming in your reply. If they are, you have not called `TaskOutput` yet.
Call it instead of replying.

This plugin's `Stop` hook enforces the wait: end your turn with the operator unreported and
it answers `The madbench operator you dispatched (task <id>) has not reported back…` and the
turn continues. That message is the gate working, not an error — do what it says.

## Step 3 — close the loop

1. **Quote the free gates** — `list`, `preflight`, `check` — as the operator returned them.
2. **Report the result from the JSON**, not from the pane: per-Scenario verdicts, the named
   metrics, rates if `--repeat` was used. Never conclude from a single pair of runs.
3. **Surface any drafted issue** with its classification — bug, feature, or a documentation
   defect that is fixed locally.
4. **If the operator returned `BLOCKED:`**, ask the user the question it could not, then
   dispatch again with the answer.

## Examples

```
/madbench:bench measure whether the new skill-index row makes the agent read the skill
```

Comes back as: a new bench directory with a red-state Scenario, a `session:file-read` Check,
the three free gates' output, and — if a paid run was wanted — the report's rates.

```
/madbench:bench benches/skill-index keeps failing madbench check
```

Comes back as: the tally line verbatim, which graded pair wrongly passed and why (a fence
with no paired activity check is the usual cause), and the edit that fixes it.

```
/madbench:bench add a cost metric to benches/model-selection
```

Comes back as: a `metrics:` expression in the Eval file, no sibling script, and `madbench
list` proving the file still loads.

## Done when

1. The free gates ran and their output is in the reply.
2. Any real run happened in the pane, and its numbers came from the report JSON.
3. No file was written that parses madbench output or re-implements a check.
4. Every gap is a drafted issue with a classification, or was found in the lookup and is now a local fix.
