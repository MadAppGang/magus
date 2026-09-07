# Visibility: the decision that breaks things

Read this before setting `disable-model-invocation` on any skill.

## The listing budget, correctly stated

```
budget = context_tokens × 4 × skillListingBudgetFraction     (fraction defaults to 0.01)
```

**There is no 8,000-character hard cap.** 8,000 is what the formula yields at the
200,000-token *fallback*, so it is the conservative floor, not a ceiling — a 1M-context
model gets 40,000. Verified against the 2.1.223 binary: `tBt()` reads
`(contextTokens ?? 200000) * 4 * fraction` and floors it, with no `Math.min`.

Over budget, Claude Code does **not** error and does **not** drop skills. It **shortens
descriptions**, and the matcher can only match what survived. So the failure mode of an
oversized corpus is not "my skill disappeared" — it is "my skill's trigger words were
quietly truncated away", which looks identical to a badly-written description.

The budget is **global across every installed skill** — all plugins, all marketplaces,
plus `~/.claude/skills`. It is not per-plugin. A plugin that behaves badly degrades
matching for every other plugin the user has installed.

## The three states

| | listed | hidden | slash-only |
|---|---|---|---|
| frontmatter | *(nothing)* | `disable-model-invocation: true` | `user-invocable: false` |
| in the per-turn listing | yes | no | **yes** |
| costs budget | yes | no | **yes — saves nothing** |
| model can choose it | yes | no | yes |
| in the `/` menu | yes | yes | no |
| can be preloaded into a subagent | yes | **no** | yes |

`user-invocable: false` is the one people reach for expecting a saving. It only hides the
skill from the `/` menu. It does not reduce listing cost by a single character.

## The preload hazard

An agent or command declares dependencies in frontmatter:

```yaml
skills: dev:context-detection, dev:universal-patterns
```

Claude Code injects those skills' content into that subagent automatically. It is a
**guarantee**: the content is present whether or not the agent thinks to look.

`disable-model-invocation: true` blocks that injection as well as the listing. So hiding
a preloaded skill:

- removes its budget cost — the thing you wanted,
- and silently starves every consumer that declared it,
- while every test, gate and lint stays green, because nothing checks that an agent
  received the guidance it asked for.

**Always check first:**

```bash
bun scripts/dev-skill-inventory.ts <plugin>
```

The `preloaded by` column is the dependency graph. `(a)` is an agent, `(c)` a command.
Cross-plugin preloads print separately — those are real dependencies but another
plugin's budget and another plugin's decision.

## Choosing

**Keep listed** when the skill is small, applies to most tasks in its domain, and its
absence changes *what you produce* rather than how fast. Disciplines qualify:
verification, TDD, design-system rules. Their cost is trivial and their presence is the
point.

**Hide** when the content is large and only conditionally relevant — a stack playbook, a
provider-specific procedure, a technique catalogue. Hidden content is one `Read` away and
costs nothing until then.

**Never hide** to save budget while leaving a consumer declaring it. Convert the consumer
in the same change, or leave the skill listed.

## Converting a preload into a read

Sometimes right, sometimes not.

```
preload   guaranteed present · costs the full payload on every run · no compliance risk
read-row  present only if the consumer complies · costs nothing until opened
```

**Convert when** the payload is large *and* selectively relevant. The clearest case in
this repo: the `frontend` agent preloaded four stack playbooks — react (703 lines),
tailwind (586), shadcn (931), frontend-implement (332) — into **every** run, so on a Vue
or plain-CSS task three quarters of ~2,700 lines was dead context.

**Do not convert** a small always-relevant discipline. `systematic-debugging` is 62
lines; guaranteeing it costs nothing worth reclaiming, and a debugging agent that skips
the method is the failure the skill exists to prevent.

**Never convert** anything mandatory for security or compliance. Probabilistic routing is
the wrong mechanism for a requirement — use a hook or a validation gate.

When you convert, write the replacement as a table of files with the condition for each,
in the consumer's own body:

```markdown
| Read this file | When the task involves |
|---|---|
| ${CLAUDE_PLUGIN_ROOT}/skills/architecture/SKILL.md | choosing an architectural style or a design pattern |
```

Say "read this file", never "invoke this skill" — see IDX-1 in `benches/skill-index/`.

## Acceptance

After any visibility change:

```bash
bun scripts/dev-skill-inventory.ts <plugin>
```

**No skill that is now hidden may still appear in that plugin's own obligation list.** If
one does, a consumer is starved and nothing else will tell you.
