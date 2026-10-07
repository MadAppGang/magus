## Madbench

Benches are madbench evals over this project's own instruction text: real harness, real
plugins, one variable changed. madbench is the harness — docs at <https://madbench.web.app>,
source at <https://github.com/MadAppGang/madbench>. **`/madbench` is the entry point** for creating
and running a bench (`/madbench:madbench` when only the magus plugin provides it).

**Never reimplement madbench's own tooling or logic** — running, grading, checks, report
parsing, run status, bench validation, hooks around a run, version checks. Missing in madbench:
a feature request to `MadAppGang/madbench`. Broken: a bug report there. Locally, at most a
stand-in marked `TEMPORARY — stands in for MadAppGang/madbench#<n>`, recorded with the issue,
and deleted when madbench ships the real one.

**Run `/madbench:doctor` before quoting a number.** It runs the layout check, the index
check and the staleness check, and prints their output verbatim. Exit 2 from any of them
means it could not measure — that is red, not a pass.

### Layout — one root, one directory per experiment

```
benches/
  MADBENCH.md              GENERATED index — id · question · status · last_run. Never hand-edit.
  README.md                the conventions and how to read a result
  lib/                     shared TypeScript, exempt from the per-bench rules
  <name>/
    madbench.yaml          REQUIRED   the bench (or <name>.madbench.yaml)
    <name>.experiment.yaml optional   variants and params — one Bench per harness: block
    README.md              REQUIRED   frontmatter id, question, status, last_run, binary; then the
                                      question and the measured answer
    testdata/              optional   seeded RED — a no-op run must fail
    module/                optional   arithmetic — index.ts; every export binds in every metrics: expression
    results/               optional   archived reports, committed the same session they were paid for
```

The layout checker (`scripts/check-bench-layout.ts` in the madbench plugin; `--self-test`
proves each rule can fire) enforces four rules: one root; every directory has a Bench or
Experiment file; every bench has the README frontmatter above; no loose `.ts` at a bench root
unless a check names it as a `file://` target. Keys are madbench's job: `madbench list`
refuses an old or unknown key.

### Testdata — composed in this order

| Key | Stages |
|---|---|
| `repo:` | a third-party checkout, pinned at a ref — the base |
| `testdata:` | copied **over** the checkout, so a bench can add files to code it does not own |
| `setup:` | a program that builds testdata and keeps **no** expectation |
| `generate:` | a program that builds testdata **and computes the answer**; madbench refuses to run if the answer is findable in the tree |

`setup:` and `generate:` are mutually exclusive on one Scenario. Seed red: a bench that is
green from the start proves nothing.

### Arithmetic lives in `module/`

A statistic belongs to the bench's own `module/index.ts`, bound into `metrics:`
expressions — never in a sibling script that runs outside madbench. A cross-run statistic is
a post-hoc module over `--report-json`; madbench's aggregation stops at the run by design.

### Vocabulary

madbench's Glossary is the authority: `skills/madbench-evals/glossary.md` in the madbench
plugin, the same file `madbench skills` installs. Write its Terms — Bench, Experiment,
variant, run, trial, Scenario, Check, Session, testdata — in YAML, comments and
documentation alike, and translate another tool's word (suite, test case, grader) into
madbench's rather than echoing it.
