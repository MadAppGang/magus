---
name: skill-authoring
description: "Writes and reviews SKILL.md files for this repo — a description that triggers, a body that fits, and a visibility choice that does not starve a preload consumer. Use when adding, editing or auditing any skill. Not for commands or agents."
---

# Authoring a skill in this repo

A skill exists to give an agent procedural knowledge it would not reliably reproduce on
its own. It has exactly two jobs, and they are separate:

| Part | Job | Read by |
|---|---|---|
| `description` | decide **whether** to load | every turn, for every installed skill |
| `SKILL.md` body | do the task **correctly** once loaded | only after it triggers |

The description is the only part with an always-on cost. Everything else is pay-as-you-go.

## The one path

1. Write the description (below). It is the highest-leverage text in the skill.
2. Write the body: objective, inputs and outputs, the ordered workflow, decision points,
   failure modes, verification. One recommended path, imperative voice.
3. Move conditional depth into `references/`, each with an explicit loading instruction.
4. Choose the visibility. Read `references/visibility.md` — this is where skills break.
5. Run `bun skills/skill-authoring/scripts/check-skill.ts <path>`. Fix what it reports.
6. If the skill must trigger reliably, run the routing evaluation in
   `references/routing-eval.md`.

## The description

**Capability first.** Over budget, Claude Code shortens descriptions rather than dropping
skills, so the tail is what disappears. Lead with what the skill does, not when.

```
<what it does, concretely>. Use when <intent, artifacts, phrasings a user actually types>.
Do not use for <the nearest sibling that competes>; use <that skill> instead.
```

The boundary clause is optional and costs characters. Add it **only** where a sibling
genuinely competes for the same words. Two in a plugin is normal; five means the skills
themselves overlap and the fix is a merge, not more prose.

**Be slightly pushy.** Models under-trigger. An "even if they only say X" clause catches
indirect phrasing, and it earns its characters on disciplines nobody names out loud —
nobody types "apply verification-before-completion".

**Ceiling: 250 characters.** This repo's limit, enforced by
`scripts/skill-budget-check.ts` in CI, and stricter than the portable 1,024. It is a
ratchet: lower it as descriptions improve, never raise it to make a build pass.

Never put in a description:

- **Workflow steps.** A description that summarises the procedure gets followed *instead
  of* the body. One skill in the wild performed one review instead of two because its
  description said "review between tasks" while its body specified two passes.
- Vague filler — "Helps with documents", "Processes data". The commonest reason a skill
  never fires.
- Keyword lists. The matcher is plain-text injection; words already in the sentence work,
  and a trailing list is pure cost.
- `<` or `>`. They fail validation.
- Anything the skill cannot actually do.

Only these frontmatter keys are read: `name`, `description`, `when_to_use`,
`argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`,
`allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`.
**`triggers:`, `tags:` and `keywords:` are silently ignored** — a skill relying on them
has no triggers at all.

## Visibility

Three states, and the choice is not about tidiness — it decides whether consumers keep
working.

| State | Frontmatter | Costs budget | Reachable by |
|---|---|---|---|
| listed | *(nothing)* | yes, every turn | the model, on its own judgement |
| hidden | `disable-model-invocation: true` | no | name, or a router that says *read this file* |
| slash-only | `user-invocable: false` | **yes — saves nothing** | the model; hidden from the `/` menu |

**`disable-model-invocation: true` does two things.** It removes the skill from the
listing *and blocks preloading into subagents*. An agent or command naming the skill in
its `skills:` frontmatter has that content injected automatically; hiding the skill
silently starves that consumer while every gate stays green.

**Before hiding anything, check who preloads it:**

```bash
bun scripts/dev-skill-inventory.ts <plugin>   # the `preloaded by` column
```

If it has consumers, the same change must give each of them the content another way.
Full decision table and the preload/read trade-off: `references/visibility.md`.

## Routers, not listings

A plugin with many skills lists one router and hides the rest. The router's body is a
table of files to open.

**Write "read this file", never "invoke this skill".** Measured in `benches/skill-index/`
(IDX-1): the Skill-tool phrasing was ignored — the tool never fired, even when a prompt
named the skill directly. The file-read phrasing produced the skill being used. A row
that prescribes an action the reader cannot take teaches nothing.

Working examples in this repo: `bunjs:bun` (9 skills, 8 hidden, 187 chars) and
`dev:context-detection`.

## The body

Carry what is needed on most invocations: objective and success criteria, required inputs
and outputs, the ordered workflow, decision points, safety boundaries, non-obvious
failure modes, verification checks, one short example, and a map of when to open each
reference.

Under 500 lines and ~5,000 tokens — ceilings, not targets. Cut anything the base model
already knows. Prefer one recommended path; offer alternatives only where the reader
genuinely must choose.

`references/` holds conditional depth, and **every reference needs an explicit loading
instruction**: "Read `references/aws.md` only when the target provider is AWS." A
reference nobody is told to open is maintenance with no reader. `scripts/` holds
deterministic work — validation, transformation, fragile command sequences — and runs
without its source entering context. `assets/` holds templates to copy.

Do not ship `README.md`, `CHANGELOG.md`, `QUICK_REFERENCE.md`, authoring notes or
evaluation workspaces inside a skill. They are not instructions.

## Fixing by symptom

| Symptom | Fix |
|---|---|
| never fires | lead with what it does; add the exact phrasings users type |
| fires for the wrong thing | add specificity, or one boundary clause naming the sibling |
| fires, output wrong | the **body** is wrong. Do not touch the description |
| fires only when named | it is hidden, or the listing is over budget and it got shortened |
| a subagent lost its guidance | something was hidden while that agent still preloaded it |

## Before reporting done

```bash
bun skills/skill-authoring/scripts/check-skill.ts <skill-dir>   # mechanical
bun scripts/skill-budget-check.ts                               # ceilings
bun scripts/dev-skill-inventory.ts <plugin>                     # nothing hidden is preloaded
```

A skill is not finished because it exists. It is finished when it triggers on the prompts
it should, stays quiet on the ones it should not, and no consumer lost anything.
