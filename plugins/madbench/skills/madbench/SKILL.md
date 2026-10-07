---
name: madbench
description: Creates, runs, debugs and migrates madbench benches. Checks the installed madbench against these skills first, then routes the request. Use when the user types /madbench or asks to create, run, fix or migrate a bench.
argument-hint: "[create|run|debug|review|migrate|versions] <bench path or question>"
disable-model-invocation: true
---
<!-- Slash-only on purpose: `/madbench` is typed, never guessed. It costs no listing budget,
     and it cannot pull a request away from an operator agent a harness already routes to.
     Owned by the madbench repository and shipped by `madbench skills`; a copy anywhere
     else is a copy, fixed upstream. -->

# /madbench — create and run madbench benches

The one entry point for madbench work. It reads the vocabulary, checks versions, reads the
request, loads the reference, and does the work — in that order.

Request: $ARGUMENTS

## Step 0 — the Glossary and versions, before anything else

**Glossary first.** Read `../madbench-evals/glossary.md`, relative to this skill's
directory. Write only its words for madbench concepts; translate the user's words, never echo
them.

Then the versions. **First run `madbench skills --check` and quote its output.** It answers
the whole question: its first line is `skills <W> · madbench <I> · <state>`, the state one of
`current`, `stale`, `pinned`, `disagree` or `unmeasured`. Exit 0 means current or pinned,
1 means stale or disagreeing stamps, and 3 means there is nothing to compare. When it
answers, the version check is done; go to step 4.

Only when `madbench skills` does not exist (a madbench older than 0.38.0 answers
`unknown command` or tries to load `skills` as a bench), compare by hand:

1. Read `MADBENCH_VERSION` in this skill's directory. It holds the madbench release these
   skills were written for, one line, `x.y.z`. `madbench skills` wrote it; never write one
   yourself.
2. Run `madbench version`. It prints `madbench x.y.z`. There is no `--version` flag.
3. Compare the two numbers part by part (0.9.0 is lower than 0.33.1). With X the installed
   madbench and Y the value of `MADBENCH_VERSION`, say exactly one of these:

| When | Say, verbatim with the numbers filled in |
|---|---|
| Y equals X | `madbench X · skills for X` |
| `MADBENCH_PINNED` exists beside `MADBENCH_VERSION` and Y differs from X | `madbench X · skills pinned to Y` — a pin is deliberate, so it is not stale |
| Y is LOWER than X — the skills are behind | "You're using madbench X, but your madbench skills were written for Y. Update the skills: run `madbench skills` in this project, or update the plugin that installed them." |
| Y is HIGHER than X — madbench is behind | "Your madbench skills were written for Y, but madbench X is installed. Update madbench: `madbench update`." |
| `madbench dev`, no madbench on PATH, or no `MADBENCH_VERSION` | say which one, and that nothing was compared |

4. If the versions differ and the set is not pinned, ask the user whether to check for a
   newer madbench now. On yes, run `madbench update --check` and quote its output; it
   installs nothing. Continue with the request either way — a version delta is a warning,
   not a stop.

Both version sources belong to madbench; never compute them with a script of your own.

`madbench skills` is how the skills move:

| Command | Does |
|---|---|
| `madbench skills` | installs the set this madbench ships into `./.claude/skills` (`--dir` elsewhere); a pinned set is left alone |
| `madbench skills --check` | compares the installed stamps with the binary; changes nothing |
| `madbench skills --version X` | installs the set madbench X shipped |
| `madbench skills --pin` / `--unpin` | holds the set at its version with a `MADBENCH_PINNED` marker / drops the marker and installs the binary's set |

An unpinned set follows madbench: the next `madbench skills` replaces it with the binary's
own. A pin is the only thing that holds one.

## Step 1 — read the request

| The user wants | Intent |
|---|---|
| a new Bench or Experiment for a question about an agent's behaviour | **create** |
| an existing Bench run, watchably, with its report read | **run** |
| a Bench that fails `madbench check`, a `preflight` refusal, a Check grading wrongly | **debug** |
| to know whether a Bench measures anything, and whether its testdata is red | **review** |
| a Bench or Experiment written for an older madbench brought to this one | **migrate** — read `../migrate/SKILL.md` and follow it |
| only the version check | **versions** — stop after Step 0 |

With no request, ask which one. A specific question beats a broad one: "does the new routing
row make the agent read the skill file" buys one Scenario with one positive Check; "bench the
plugin" buys a tour. Narrow a broad request before writing anything.

**A real run costs money; the free gates cost nothing.** Never start a real run the user did
not ask for. If the request is unclear about it, stop after `madbench check` and ask.

## Step 2 — load the reference

Read `../madbench-evals/SKILL.md`, relative to this skill's directory, and follow it. It
names the reference file each job needs (`schema.md`, `checks-catalog.md`,
`harness-and-sandbox.md`, `debugging.md`) and carries the workflow and the gotchas. Do not
work from memory: madbench renames and refuses keys between releases.

## Step 3 — do the work

- **create** — the bench file, red-state testdata, positive Checks only. Then the free gates.
- **run** — the free gates first. Then the real run, **by default in a split pane beside
  this conversation**, so the user watches every Scenario as it happens. How to open that
  pane, and how to know when the run is over, is "Runs are visible" in
  `../madbench-evals/SKILL.md`; follow it. Only when no pane can be opened, give the user
  `madbench <bench> --ui --report-json <path>` for their own terminal. Never background a
  run and never pipe one; one run at a time. Numbers come from the report JSON, never from
  the terminal, and never from a single pair of runs — `--trials` is the instrument.
- **debug** — `debugging.md` open, the failing command re-run, its output quoted.
- **review** — the checklist in `madbench-evals`, answered item by item.

The free gates, in order, each quoted verbatim: `madbench list <bench>`,
`madbench preflight <bench>`, `madbench check <bench>`, `madbench <bench> --harness mock`.

## The rule: madbench's tooling is never reimplemented

Running, grading, Checks, report parsing, run status and waiting, bench validation, hooks
around a run, version checks — madbench does these, or madbench gets them.

- **Missing** in madbench → a **feature request** to `MadAppGang/madbench`.
- **Broken** in madbench → a **bug report** to `MadAppGang/madbench`.
- **Blocked until it lands** → a **temporary stand-in**, marked `TEMPORARY` with the issue
  number, recorded with the issue, deleted when madbench ships the real one.

The full procedure — look first, classify, draft, send on the user's yes, the stand-in's
limits — is the gap rule in `../madbench-evals/SKILL.md`. Follow it exactly.

## Report

```
madbench <version> · skills for <MADBENCH_VERSION>   (or: skills pinned to <MADBENCH_VERSION>)

Files       <path — written | modified | unchanged>, one per line
Free gates  list / preflight / check — exit and one line each, verbatim
Run         <command and report path — or "not run", with why>
Result      <from the report JSON: per-Scenario verdicts, named metrics, rates if --trials>
Gaps        <none | the issue (bug or feature), sent or awaiting approval, and any TEMPORARY stand-in>
```
