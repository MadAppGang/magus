# code-analysis: step by step

For code you didn't write. Or wrote long enough ago that it counts.

What the plugin ships is on the
[code-analysis plugin page](../plugins/magus/code-analysis.md).

---

## `/code-analysis:analyze` — find out how something works

### Step 1. Ask a specific question

```
/code-analysis:analyze Where is user authentication handled?
```

Be specific. "Analyze the codebase" gets you a tour. "Where is the email validation logic"
gets you a file and a line number.

Mention why you're asking, too. Debugging, refactoring and learning need different answers
to the same question.

### Step 2. It picks its tools

![Flow diagram: a question goes to the detective agent, which searches structurally where the configured engine supports it and by text where the question is about an exact string, then returns a location report](./images/code-analysis-flow.svg)

The detective runs in its own context window and cannot write. An investigation can't turn
into a refactor you didn't ask for.

### Step 3. Read the location report

```
Location report: [what was investigated]

Method            which tools answered, and anything the engine couldn't do
Primary files     path/to/file.ts:45-67    what happens there
Flow              entry -> processing -> result, a file:line per hop
Related           component or service — what it contributes
Caveats           anything static analysis can't see
```

File paths and line numbers, not descriptions. That's the difference between a tour and
something you can act on.

The **Method** line is worth reading. A location found by matching text and a location found
by looking up a symbol carry different confidence, and the report says which you got.

### Step 4. Drill in

Ask a follow-up about one file. The first answer is meant to orient you, not to be the last
word.

---

## Option: configure a search engine

You don't have to. It works either way — text search, file globs and reading are always
available. But the two paths don't answer equally well.

| You ask | Text search gives you | A search engine gives you |
|---|---|---|
| where is `createUser` defined | every file with that string in it | the definition, and how central it is |
| what calls this | call sites, plus comments, plus the docs | the call graph |
| what breaks if I change this | nothing — you can't grep for that | the blast radius |
| where is auth handled | files with "auth" in them | files that *do* authentication, whatever they're called |

That last row is the interesting one. A file called `session-guard.ts` with no occurrence of
the word "auth" is invisible to grep and obvious to a search by meaning.

**Only the operations an engine can genuinely do show up as tools.** If the one you configured
has no call graph, the call-graph tools are simply absent rather than answering with a guess.
So a missing tool tells you something true, and every tool present is one you can trust.

### To set it up

```
/code-analysis:setup
```

It reports which engine your project settings name, whether it answered, and what to do when
it didn't. It also installs the search shim that lets the plugin improve ordinary text search,
and offers to write the tool rules into your project's `CLAUDE.md`.

The engine is named in `.claude/settings.json`, one at a time, so swapping it is a one-line
change and nothing else in the plugin moves. Engines document their own installation — the
plugin never installs one behind your back.

With none configured, you still get search by query. That's a supported setup, not a broken
one.

Local index directories are specific to your machine and can be rebuilt any time, so put them
in `.gitignore` and never commit them.

---

## Which command to use

| You want | Use |
|---|---|
| To understand code | `/code-analysis:analyze` |
| The same thing, with modes, through `dev` | [Understanding code](./dev-investigate.md) |
| To find *and fix* a bug | [Fixing a bug](./dev-debug.md) |
| To change code you already understand | just ask |

`/dev:investigate` is a thin wrapper over this same detective. Use whichever name you
remember. Both are read-only, so neither will change anything while you're still working out
what to change.
