## Madbench

Benches are madbench evals over this project's own instruction text: real harness, real
plugins, one variable changed. madbench is the harness — docs at <https://madbench.web.app>,
source at <https://github.com/MadAppGang/madbench>. Use it natively; a wrapper around it
is a gap that should have been drafted as an upstream issue instead.

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
    <name>.eval.yaml       optional   runs and params — one bench per harness_config
    README.md              REQUIRED   frontmatter id, question, status, last_run, binary; then the
                                      question and the measured answer
    testdata/              optional   seeded RED — a no-op run must fail
    module/                optional   arithmetic — index.ts; every export binds in every metrics: expression
    results/               optional   archived reports, committed the same session they were paid for
```

The layout checker (`scripts/check-bench-layout.ts` in the madbench plugin; `--self-test`
proves each rule can fire) enforces five rules: one root; every directory has a bench or
Eval file; every bench has the README frontmatter above; no loose `.ts` at a bench root
unless a check names it as a `file://` target; no alias key in any bench file.

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

YAML keys are canonical: `harness:`, `scenarios:`, `checks:`, `testdata:`, `session:*`.
The accepted aliases (`runner:`, `cases:`, `assert:`, `fixture:`, `tests:`, `defaultCase:`,
`matrix:`) still load, which is exactly why the checker rejects them. Say *run*, *testdata*
and *Session* in documentation too; *cell* is `madbench check`'s own word for one graded
(Scenario, Check) pair and is not general vocabulary.
