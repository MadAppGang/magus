# PROXY_MODE Implementation Review (gpt-5.2)

Scope:
- `plugins/dev/agents/architect.md`
- `plugins/dev/agents/test-architect.md`

Review criteria:
1. YAML frontmatter validity
2. XML structure validity
3. PROXY_MODE block completeness
4. Tool list correctness
5. Consistency with other agents

---

## Summary
- ✅ `test-architect.md` PROXY_MODE block is complete and matches the “good” pattern used elsewhere (agentdev architect).
- ⚠️ `architect.md` PROXY_MODE block is **inconsistent** and likely **functionally incorrect** (it constructs an `AGENT_PROMPT` that instructs running the *architect agent again* via Task tool, which defeats the point of using the external model).

---

## 1) YAML frontmatter validity
### `plugins/dev/agents/architect.md`
- ✅ Valid YAML frontmatter block present (`---` … `---`).
- ✅ Tool list now includes `Bash` (`plugins/dev/agents/architect.md:1-7`).
- ✅ Keys appear consistent with repo conventions: `name`, `description`, `model`, `color`, `tools`, `skills`.

### `plugins/dev/agents/test-architect.md`
- ✅ Valid YAML frontmatter block present (`plugins/dev/agents/test-architect.md:1-6`).
- ✅ Tools include `Bash` and typical authoring tools (`Read`, `Write`, `Edit`).

---

## 2) XML structure validity
### `plugins/dev/agents/architect.md`
- ✅ Top-level structure is well-formed: `<role>` and `<instructions>` blocks are properly opened/closed (`plugins/dev/agents/architect.md:9-248`).
- ✅ Nested tags inside `<critical_constraints>` appear properly nested and terminated (e.g. `<proxy_mode_support>…</proxy_mode_support>`).

### `plugins/dev/agents/test-architect.md`
- ✅ Well-formed XML-like structure throughout: `<role>`, `<instructions>`, `<critical_constraints>`, `<proxy_mode_support>`, `<error_handling>`, `<prefix_collision_awareness>` are all properly closed (`plugins/dev/agents/test-architect.md:8-378`).

---

## 3) PROXY_MODE block completeness
### `plugins/dev/agents/test-architect.md`
- ✅ **Directive detection**: clearly checks for `PROXY_MODE: {model_name}` (`plugins/dev/agents/test-architect.md:66-73`).
- ✅ **Delegation mechanism**: calls Claudish via Bash in a single-shot mode (`plugins/dev/agents/test-architect.md:69-72`).
- ✅ **Hard stop**: explicitly instructs “Return … and STOP” (`plugins/dev/agents/test-architect.md:71-73`).
- ✅ **Error handling**: includes “Never Silently Substitute Models” + required reporting + “Task NOT Completed” (`plugins/dev/agents/test-architect.md:75-108`).
- ✅ **Prefix collision awareness**: documents colliding prefixes and suggests `or/` to force OpenRouter routing (`plugins/dev/agents/test-architect.md:110-123`).

Overall: **Pass**.

### `plugins/dev/agents/architect.md`
- ✅ **Directive detection** exists and is prominent (`plugins/dev/agents/architect.md:40-46`).
- ✅ Includes “Never Silently Substitute Models” and “STOP” guidance (`plugins/dev/agents/architect.md:70-82`).

However, there are two high-impact gaps:

1) **Likely incorrect delegation strategy (Major)**
- The block constructs an `AGENT_PROMPT` that says: “Use the Task tool to launch the 'architect' agent…” (`plugins/dev/agents/architect.md:51-60`).
- This pattern is risky because it can cause the external model session to spawn a new `architect` agent that runs with its configured model (here: `sonnet`) rather than continuing with the requested external model.
- Net effect: PROXY_MODE may **not** actually produce “external model output”; it may instead route back to local agent execution.

2) **Missing prefix collision awareness + backend reporting (Completeness gap)**
- Unlike the stronger standard used in `plugins/agentdev/agents/architect.md` and `plugins/dev/agents/test-architect.md`, `plugins/dev/agents/architect.md` does **not** include:
  - Detected backend reporting (OpenRouter vs direct providers)
  - Explicit prefix collision list / mitigation guidance (`or/`)

Overall: **Partial pass (needs changes)**.

---

## 4) Tool list correctness
### `plugins/dev/agents/architect.md`
- ✅ Adding `Bash` is necessary because PROXY_MODE delegation requires `npx claudish ...`.
- ✅ Tool list includes `TodoWrite, Read, Write, Bash, Glob, Grep` (`plugins/dev/agents/architect.md:5`).

### `plugins/dev/agents/test-architect.md`
- ✅ Tool list includes `Bash`, consistent with PROXY_MODE execution requirements (`plugins/dev/agents/test-architect.md:5`).

---

## 5) Consistency with other agents that have PROXY_MODE
Reference patterns observed in this repo:
- `plugins/agentdev/agents/architect.md` has a **complete** PROXY_MODE block with:
  - direct Claudish delegation using the full prompt
  - explicit backend + prefix collision awareness
  - no “re-launch the same agent” indirection
  (`plugins/agentdev/agents/architect.md:29-88`)

Consistency check:
- ✅ `plugins/dev/agents/test-architect.md` matches the agentdev pattern closely.
- ⚠️ `plugins/dev/agents/architect.md` diverges materially (AGENT_PROMPT → Task tool re-launch) and omits prefix collision handling.

---

## Recommendations
1) **Align `plugins/dev/agents/architect.md` to the “direct delegation” pattern** used by:
   - `plugins/agentdev/agents/architect.md`
   - `plugins/dev/agents/test-architect.md`

   Concretely: delegate `printf '%s' "$PROMPT" | npx claudish ...` (or a clearly scoped variant) and return the external output without spawning a new architect agent.

2) Add parity features to dev architect PROXY_MODE block:
   - backend detection + reporting in failure format
   - prefix collision awareness section (google/openai/g/oai and `or/` mitigation)

---

## Verdict
- `plugins/dev/agents/test-architect.md`: **PASS**
- `plugins/dev/agents/architect.md`: **NEEDS REVISION** (PROXY_MODE likely won’t reliably deliver external-model output; missing parity sections)
