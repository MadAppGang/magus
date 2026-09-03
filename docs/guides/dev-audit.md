# Auditing quality

`/dev:audit` is a read-only quality review. You describe what you want checked, it
picks a scope, and it hands the work to the specialist reviewer for that scope.

It never edits your code.

## Step 1. Say what you want reviewed

```
/dev:audit the new payment handler
/dev:audit check the login screen for accessibility problems
/dev:audit are there security holes in the auth middleware
```

You do not pick a scope from a list unless your wording is ambiguous. The command
reads how you asked and routes accordingly.

## Step 2. It picks one of six scopes

| Scope | What it looks for | Reaches |
|---|---|---|
| **Code quality** | correctness, patterns, maintainability | `dev:reviewer` |
| **UI / design** | implementation against a design spec | `designer:design-review`, or `dev:reviewer` if the designer plugin is not installed |
| **Design system** | token-only styling, one component library, variants over call-site restyling | the `/dev:design-system` command |
| **Documentation** | accuracy, completeness, clarity | `dev:docs` |
| **Security** | OWASP Top 10, auth bypass, injection, exposed data | `dev:reviewer` |
| **Plugin or agent** | description clarity, frontmatter, skill boundaries | `dev:reviewer` |

**All six appear on the menu.** If your wording is ambiguous the command offers the
six-option list above. A UI request that turns out to be about system integrity —
tokens, drift, duplicated components, missing variants — is re-routed to design
system.

Design system behaves differently from the other five: it hands off to the
`/dev:design-system` command instead of dispatching a reviewer, because it is
script-driven measurement rather than a subjective read.

## Step 3. Add external reviewers with `--models`

For the scopes that reach `dev:reviewer` — code, security, plugin, and UI without the
designer plugin — you can name external models:

```
/dev:audit --models grok,gemini the new payment handler
```

The internal reviewer always runs. Externals are additive: each named model runs the
same review brief through claudish, and `dev:synthesizer` merges every review —
internal and external — into one consolidated report, with a consensus level
(unanimous, strong, majority, divergent) on every finding and a verdict computed
from the merged counts.

Two things to know:

- Model names are resolved against claudish's live catalog. A version that is not
  in the catalog is reported, with the live alternatives; it is never quietly
  swapped for a lower one.
- If claudish is not installed, the command says so once and runs the internal
  reviewer alone. Nothing waits on an external that cannot start.

## Step 4. Read one report, whatever the scope

Every scope except design system ends the same way, whichever specialist it
reached. The specialist writes its review into a run directory under
`ai-docs/sessions/`, and `dev:synthesizer` writes the one file the command relays
to you: the findings, then a closing `VERDICT:` line. That is the shape on every
route — code, security, plugin, UI with or without the designer plugin, and
documentation — so you never need to know which agent did the reading. The
individual reviews stay beside the report as the evidence behind it.

With exactly one review, the synthesizer passes it through unchanged and appends
the verdict line. No consensus levels, because there is nothing to agree or
disagree with. That is always the case for the UI-with-designer and documentation
scopes, which take no `--models`, and for any other scope run without it.

The verdict is in the specialist's own vocabulary. A design review or a
documentation review is judged on its own reviewer's scale, not the code
reviewer's; the synthesizer computes the word from the review's own measure and
never substitutes one scale for another.

For the scopes that reach `dev:reviewer`, findings carry a severity — **CRITICAL**,
**HIGH**, **MEDIUM**, **LOW** — and every finding cites a file and a line.

## Which tool for which question

`/dev:audit` is one of four ways to get code looked at. They are not
interchangeable.

| You want | Use | Why |
|---|---|---|
| A scoped review of specific code, routed to a specialist | `/dev:audit` | One reviewer, one scope, structured findings |
| A whole-codebase health assessment | `code-analysis:deep-analysis` | Seven dimensions, centrality-driven, finds what you did not know to ask about |
| Independent opinions on one question | `/multimodel:team` | Several models vote separately; disagreement is the signal |
| Review of a pull request diff | the built-in `/code-review` | `/dev:audit` deliberately leaves PR diff review to the host |

The short version: **`/dev:audit` when you know what to look at, `deep-analysis`
when you do not, `/multimodel:team` when you want a second opinion rather than a
deeper one.**

## What it will not do

- It will not modify files. Every scope is read-only. If you want fixes applied,
  take the findings to `/dev:fix` or `/dev:dev`.
- It will not review a GitHub pull request by number. That is `/code-review`.
- It will not tell you a design system is healthy without measuring it — the
  design-system scope runs a bundled auditor rather than reading the code.

## Related

- [Fixing a bug](./dev-debug.md) — take audit findings and act on them
- [Building a feature](./dev-build.md) — `/dev:dev` runs a code review as one of its phases
- [Understanding code](./dev-investigate.md) — read-only tracing, not quality judgement
- [multimodel: step by step](./multimodel.md) — a blind vote across models, when you want disagreement rather than one consolidated report
