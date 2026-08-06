# bunjs skill discovery bench

Answers one question: **on a plain prompt with no slash command, does an agent reach a
skill that carries `disable-model-invocation: true`?**

```bash
./sync-testdata.sh          # rebuild the three variants from the real skill
madbench madbench.yaml      # the experiment
madbench instrument-probe.yaml   # the instrument control (see below)
madbench madbench.yaml --repeat 5   # n=1 is not a result; see "Confidence"
```

## Design

Three cells, one variable changed at a time. The prompt is byte-identical in all three,
names no skill, and uses no slash command. `sync-testdata.sh` diffs the variants and
refuses to build unless each differs from `bare` by exactly the one intended file.

| Cell | routing row | `disable-model-invocation` | isolates |
|---|---|---|---|
| `bare` | no | **on** | baseline — is it invisible? |
| `routed` | **yes** | on | does a CLAUDE.md row rescue discovery? |
| `listed` | no | **off** | is the flag what blocks it? |

Testdata is seeded **red**: `src/auth.ts` is absent and `auth.test.ts` imports it, so
`bun test` exits 1 until the agent does real work (verified by hand before wiring checks).
The seeded tests assert **behaviour only** — signup, login, wrong password, unknown user —
and deliberately say nothing about which hash or how to handle enumeration. Naming
argon2id in the test would hand the agent the answer and void the measurement.

## Result (2026-08-06, claude-sonnet-5, n=1 per cell)

| Cell | `SkillReached` | `bun test` |
|---|---|---|
| `bare` | 0 — not reached | pass |
| `routed` | **0 — not reached** | pass |
| `listed` | **1 — reached** | pass |

**Removing the flag made the skill get reached. The original CLAUDE.md routing row did not.**

### …but the row failed for a fixable reason (`claude-md-probe.yaml`)

| Probe | Result |
|---|---|
| `claude-md-canary` — CLAUDE.md orders a token in the reply | **1 — echoed** |
| `readrow-obeyable-instruction` — row says *"Read the file"* | **SkillReached: 1** |

CLAUDE.md **is** loaded into context under `claude -p` — the canary settles that, so the
first result cannot be blamed on an unread file. The row failed because of **how it was
phrased**:

| Row phrasing | Reached? |
|---|---|
| "invoke it with the **Skill tool**" | ✗ |
| "**Read** `.claude/skills/security/SKILL.md` with the Read tool" | ✓ |

The original row prescribed an action that is **impossible here** — `instrument-probe.yaml`
shows the Skill tool never fires for these skills even when explicitly ordered. An
instruction that cannot be obeyed proves nothing about one that can.

**Corrected conclusion: indexing skills in CLAUDE.md works, and the phrasing decides it.**
Point the row at a *file to read*, not at a tool that will not fire.

## Two traps this bench had to survive

**1. `skill-used` measures Skill-tool calls only, and the agent never uses it.**
`instrument-probe.yaml` is the control that caught this: even when the prompt *explicitly
ordered* "use the Skill tool to invoke the skill named `security`", `skill-used` returned
0 — while the transcript shows the agent copying `assets/security/` into the project,
importing `hashPassword`/`authenticate`/`makeDummyHash`, and running the skill's own
acceptance greps. It consumed the skill entirely via `Bash` + `Read`.

A check that cannot pass is not evidence. `SkillReached` is therefore an `any-of` over
the Skill tool **or** an artifact only this skill can produce — identifiers like
`makeDummyHash` and `LoginDeps` that exist nowhere but its assets.

**2. The obvious fingerprints do not discriminate.**

| Cell | `SkillFingerprints` |
|---|---|
| `bare` | 0.75 |
| `routed` | 0.75 |
| `listed` | 0.50 |

`Bun.password`, `timingSafeEqual` and a "timing" comment appear just as often *without*
the skill — sonnet writes them from general knowledge, and the cell that actually reached
the skill scored **lowest**. They are kept as instrumentation (`threshold: 0.01`) and
must never be read as proof of skill influence.

## madbench gotcha found here

`threshold: 0.0` is indistinguishable from unset and falls back to the default `1.0` —
an `assert-set` written with `threshold: 0.0` reported `threshold: 100%` and gated when it
was meant to be pure instrumentation. Use `0.01`.

## Confidence

**n=1 per cell.** Single runs of a stochastic agent. The `bare`/`listed` contrast is
large and mechanistically explained, but `routed` failing once is not proof it always
fails. Before acting on it, run `madbench madbench.yaml --repeat 5` and check whether
`SkillReached` for `routed` is consistently 0.

## Scope caveat

The skill is installed here as a **project skill** (`.claude/skills/`), not as the packaged
bunjs plugin. That keeps the bench self-contained and independent of whichever plugin
version happens to be installed globally — at the time of writing, the installed bunjs was
still **v0.1.0**, which contains none of these skills, so a plugin-based bench would have
been measuring an empty set. The discovery mechanism (listing budget, the flag) is the
same either way, but plugin packaging itself is untested here.
