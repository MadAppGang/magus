# Understanding code

`/dev:investigate` traces code and explains it. **It never writes.**

## Step 1. Ask your question in plain words

```
/dev:investigate how does session expiry actually work
```

You don't pick a mode. It reads how you asked.

## Step 2. It routes to the right kind of investigation

![Flow diagram: a question is sorted into a mode, routed to one of two investigation skills, run by the read-only detective agent over search, file reading and whichever structural tools the configured engine supports, and returned as findings with file and line evidence](./images/dev-investigate-flow.svg)

| You ask about | Mode |
|---|---|
| "how does X work", "explain", "trace" | implementation |
| "architecture", "components", "structure" | architecture |
| why something breaks | debugging |
| what is and isn't tested | testing |
| "everything", "full", an audit | comprehensive |

## Step 3. Read the report

Findings with file and line evidence for each claim.

The work happens in a subagent, so a forty-file trace fills that agent's context instead of
yours. You get the conclusion.

## If `code-analysis` isn't installed

It tells you, and offers text search instead. It doesn't pretend the AST tools are there and
quietly give you a worse answer.

Install it through [claudeup](./install.md) to get semantic search, the call graph, and
"what breaks if I change this" — none of which you can grep for. See
[code-analysis](./code-analysis.md).

## Not what you wanted?

| You want | Guide |
|---|---|
| The same thing, without going through `dev` | [code-analysis](./code-analysis.md) |
| To find *and fix* a bug | [Fixing a bug](./dev-debug.md) |
| To change code you already understand | just ask |
