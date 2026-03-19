# Dev Plugin Command Consolidation

**Status:** Implemented in worktree, pending merge to main
**Target version:** v1.42.0
**Architecture plan:** `ai-docs/sessions/dev-arch-command-consolidation-20260317-203539-e07f12f2/architecture.md`

---

## 1. Problem Statement

The dev plugin grew to 17 commands over time, creating three distinct clusters of overlapping functionality:

- **debug / fix / quick-fix** — three commands for fixing bugs, no clear guidance on which to use
- **implement / feature** — two commands for building things, distinguished only by scope
- **architect / brainstorm** — two commands for planning, one structured and one generative

In blind voting by 6 independent AI models, naming confusion was rated **6.9/10**. Users arriving at the plugin had no reliable way to select the right command without reading documentation first.

---

## 2. Solution: Progressive Disclosure

Rather than maintaining separate commands per workflow depth, the consolidation reduces each intent cluster to a single command that asks the user how deep to go — or infers depth automatically from context.

**`/dev:debug`** (absorbs fix + quick-fix)
- Quick patch — fast inline fix, auto-escalates if needed
- Standard debug — reproduce, localize, root cause, TDD patch, validate
- Production-grade — full 9-phase TDD state machine, dual multimodel review, deployment monitoring

**`/dev:build`** (absorbs implement + feature)
- Focused implementation — detect stack, plan, implement, tests
- Full lifecycle — requirements, multi-model planning, implement, review, browser validation

**`/dev:plan`** (absorbs architect + brainstorm)
- Architecture design — structured design with trade-off analysis
- Brainstorm first — multi-model parallel ideation, then converge

**`/dev:research`** (rename of deep-research)
- No scope question needed; single workflow retained as-is

Auto-inference rules skip the scope question when intent is unambiguous. A stack trace in the request signals quick patch. A feature spec signals full lifecycle. When inference is uncertain, the command asks once.

---

## 3. Before / After

**Before — 17 commands:**

| Command | Role |
|---|---|
| help | List commands |
| debug | Debug with TDD |
| fix | Fix a bug |
| quick-fix | Minimal fix |
| implement | Implement a feature |
| feature | Full feature lifecycle |
| architect | Architecture design |
| brainstorm | Open ideation |
| deep-research | Research a topic |
| interview | Gather requirements |
| delegate | Delegate to subagent |
| doc | Write documentation |
| learn | Learn from session |
| setup | Configure project |
| worktree | Isolate work |
| (investigate) | — |
| (review) | — |

**After — 12 commands:**

| Command | Absorbs / Source |
|---|---|
| help | help |
| debug | debug + fix + quick-fix |
| build | implement + feature |
| plan | architect + brainstorm |
| research | deep-research |
| interview | interview |
| investigate | new — routes to code-analysis:detective |
| review | new — routes to right reviewer agent |
| doc | doc |
| learn | learn |
| setup | setup |
| worktree | worktree |

**Removed without replacement:** delegate (passive CLAUDE.md routing table handles subagent selection; an explicit command added no value)

---

## 4. User Mental Model

```
"I have a bug"         /dev:debug       quick patch / standard / production-grade
"Build something"      /dev:build       focused / full lifecycle
"Plan or design"       /dev:plan        architecture / brainstorm
"Research a topic"     /dev:research
"Gather requirements"  /dev:interview
"How does X work"      /dev:investigate
"Review my code"       /dev:review
"Write or fix docs"    /dev:doc
"Configure project"    /dev:setup
"Isolate this work"    /dev:worktree
"Learn from session"   /dev:learn
"What is available"    /dev:help
```

Each entry point maps to exactly one command. Users no longer need to distinguish between similar alternatives.

---

## 5. Validation

Five AI models reviewed the consolidation plan independently and returned unanimous approval:

| Model | Decision |
|---|---|
| Claude (internal) | APPROVE |
| GLM-5 | APPROVE |
| Gemini 3.1 Pro | APPROVE |
| GPT-5.4 | APPROVE |
| Qwen 3.5 Plus | APPROVE |

Naming votes: `debug` won 3-2 over `fix`, `build` won 3-2 over `implement`, `plan` won 4-1 over `design`.

---

## 6. Implementation Status

All 10 implementation steps are complete in the worktree at `.worktrees/universal-commands/`.

- Worktree version: **v1.43.0** with 16 commands (12 real + 4 deprecation redirect stubs)
- Main branch version: **v1.41.0** with original 15 commands
- The deprecation stubs exist only for testing in the worktree — they will be deleted before merge
- There is no backward compatibility period; this is a clean cut

---

## 7. Additional Cleanup on Merge

The following issues will be resolved as part of the merge commit:

- Delete the `skill-discovery` agent (redundant with stack-detector)
- Remove broken `dev:design-references` skill reference in interview.md
- Remove the `task-routing` skill (the delegate command that used it is deleted)
- Update help.md to reflect all 12 commands at the correct version

---

## 8. Version Plan

| Version | Change |
|---|---|
| v1.42.0 | Merge consolidation + cleanup; no stubs; clean removal |
| v1.43.0+ | Add `/dev:test` and `/dev:roast` commands |
| Future | Comprehensive E2E testing across all commands |
