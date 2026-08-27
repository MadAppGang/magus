---
name: analyze
description: Investigate a codebase read-only — understand architecture, trace how a feature works, locate an implementation, or track a bug to its origin
allowed-tools: Agent, AskUserQuestion, Bash, Read, Glob, Grep
---

## Mission

Dispatch the `code-analysis:detective` agent at one question about this codebase. The answer
comes back as file:line locations and the flow between them. Nothing is modified.

## Analysis request

$ARGUMENTS

## When to use it

- **Architecture** — how is authentication implemented, what does the data layer look like
- **Location** — where is the user registration logic, which file handles payments
- **Flow** — follow a request from endpoint to database
- **Bugs** — why login fails, where an error originates
- **Patterns** — where API calls are made, which components use a given store
- **Dependencies** — what uses this service, what breaks if it changes

## Step 1 — read the request

Parse three things out of `$ARGUMENTS` before dispatching:

1. **What do they want to understand?**
2. **Which functionality** does it concern?
3. **What is the context** — debugging, learning, or refactoring? The same question wants a
   different answer in each.

**A specific question beats a broad one.** "Analyze the codebase" buys a tour; "where is the
email validation logic" buys a file and a line number. If the request is broad enough that the
investigation would be spent on orientation, narrow it first — ask which part matters, or state
the narrower question you are about to answer and why.

## Step 2 — dispatch the detective

```
Agent(
  subagent_type: "code-analysis:detective",
  run_in_background: false,
  description: "Investigate [brief description]",
  prompt: `
    Investigate the following in the codebase:

    [the request, restated as one specific question]

    Context: [debugging | learning | refactoring]
    Working directory: [current working directory]

    Return:
    1. Exact file:line locations
    2. The code at those locations, quoted
    3. How the mechanism works
    4. Related files and dependencies, inbound and outbound
    5. A flow diagram when the path crosses more than two or three hops

    Name the method behind each finding, and say what the configured engine could not answer.
  `
)
```

**Do not tell the agent which retrieval tool to use.** It reads the tool list itself and routes
per question — structural tools when the engine offers them, text search when the question is
genuinely about an exact literal or a filename pattern. Prescribing a tool from here is how the
command and the agent ended up contradicting each other.

## Step 3 — close the loop

1. **Summarise** the key files and the main implementation site.
2. **Show the relationships** — how the pieces connect, not just where they are.
3. **Propose next steps** for what to do with the finding.
4. **Offer to go deeper** on any one part.

## Examples

### Finding authentication

```
/code-analysis:analyze Where is user authentication handled?
```

Comes back as: the login handler, the middleware that validates the token, the service that
issues it — each with a file and a line range, plus the order they run in.

### Tracing a bug

```
/code-analysis:analyze The profile page shows "undefined" for the email field
```

Comes back as: where the field is rendered, where the data is fetched, and the point between
them where the shape stops matching — a file:line, not a theory.

### Understanding a flow

```
/code-analysis:analyze How does payment processing work?
```

Comes back as: entry point, validation, gateway call, persistence, failure handling — the files
involved and what each contributes.

## Output shape

```
Location report: <what was investigated>

Method            <which tools answered, and anything the engine could not do>
Primary files     path/to/file.ts:45-67   <what happens there>
Flow              entry -> processing -> result, a file:line per hop
Related           <component or service> — <what it contributes>
Caveats           <anything static analysis cannot see>
Next steps        <what this makes possible>
```

## Done when

1. The question is answered with exact locations.
2. The relationships and flow are explained, not just listed.
3. Every finding names the method that produced it.
4. The user can open the code and recognise what they were told.
5. The obvious follow-up is already offered.
