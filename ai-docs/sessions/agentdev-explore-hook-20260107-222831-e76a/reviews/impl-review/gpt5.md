# Implementation Review (GPT-5.2): Explore→Detective Task Intercept

**Reviewer:** openai/gpt-5.2 (Claude Agent SDK)

**Scope (requested):**
- `plugins/code-analysis/plugin.json` — Task matcher
- `plugins/code-analysis/hooks/handler.ts` — `handleTaskIntercept()`

## Summary

Overall the change is conceptually correct and narrowly scoped:
- The new `PreToolUse` hook matcher for `Task` is present and points to the same unified handler.
- The handler routes `tool_name === "Task"` to `handleTaskIntercept()`.
- `handleTaskIntercept()` only denies when `subagent_type` resolves to the built-in Explore agent (case-insensitive, trim).

I did not find any correctness issues that would obviously break normal Task tool usage. Most remaining concerns are robustness/UX edge-cases.

## Review Notes

### 1) plugin.json: Task matcher looks correct

**File:** `plugins/code-analysis/plugin.json:37`

- Added a separate `PreToolUse` entry with `"matcher": "Task"` (lines ~47–55) that runs `bun "${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts"`.
- This is consistent with the dispatcher in `handler.ts` switching on `input.tool_name === "Task"`.

**Potential edge case:** If Claude Code’s hook matcher language is regex-like, `"Task"` is safe; if it’s exact-match only, it’s also safe. No obvious bug here.

### 2) handler.ts: Dispatch wiring for Task looks correct

**File:** `plugins/code-analysis/hooks/handler.ts:599`

- In the `PreToolUse` dispatcher, a new `case "Task": output = await handleTaskIntercept(input);` exists (lines ~619–621).

### 3) handleTaskIntercept(): behavior matches design

**File:** `plugins/code-analysis/hooks/handler.ts:365`

Good:
- Defensive presence check for `tool_input` before reading fields.
- Narrow interception condition: only when `subagent_type.trim().toLowerCase() === "explore"`.
- Graceful fallback when claudemem is not indexed: returns `permissionDecision: "allow"` with guidance (lines ~386–403).
- When indexed, denies Explore and provides a concrete alternative (`code-analysis:detective`) plus optional “map” preview.

### 4) Type-safety / runtime robustness edge cases

#### 4.1 `prompt`/`description` assumed to be strings

**File:** `plugins/code-analysis/hooks/handler.ts:405`

```ts
const prompt = toolInput.prompt || "";
const description = toolInput.description || "";
const searchContext = prompt || description;
```

This is safe given the Task tool schema (these should be strings). However, if malformed hook input ever occurs (or internal schema changes), `prompt`/`description` could be non-string truthy values.

**Impact:** If `searchContext` becomes a non-string object, downstream calls like `escapeForTemplate(searchContext)` will throw (`replace is not a function`) (see `escapeForTemplate()` at `plugins/code-analysis/hooks/handler.ts:488`).

**Severity:** Low (schema-controlled), but worth noting as a robustness edge case.

#### 4.2 “3s preview” comment doesn’t match implementation

**File:** `plugins/code-analysis/hooks/handler.ts:410`

Comment says “(with short timeout)” and “Use shorter timeout (3s) for preview”, but `runCommand()` hardcodes a 10s timeout (`plugins/code-analysis/hooks/handler.ts:46–52`).

**Impact:** When Explore is intercepted, you can still block the user on a potentially slow `claudemem map` call for up to 10s before denying. It’s not a correctness issue, but can be noticeable latency in the hook.

**Severity:** Medium (UX / responsiveness).

### 5) UX / workflow edge cases

#### 5.1 Potential “agent loop” risk (behavioral)

When the hook denies Explore, Claude (the assistant) may still attempt Explore again if it doesn’t incorporate the returned context. That can lead to repeated denials.

**Mitigation (already partially present):** The denial includes a full Task snippet showing `code-analysis:detective` usage and explains why.

**Severity:** Medium (depends on how often the orchestrator reaches for Explore automatically).

#### 5.2 Keyword extraction could over-strip useful terms

**File:** `plugins/code-analysis/hooks/handler.ts:466`

`extractSearchKeywords()` strips a fairly large set of common words; for some prompts, this can remove useful intent words (e.g., “how is X handled?” becomes mostly just X, which may be fine).

**Severity:** Low (best-effort preview only; doesn’t affect the actual redirect).

## Positive Observations

- Interception is tightly scoped: only Explore gets denied; all other `Task` subagents proceed untouched (`plugins/code-analysis/hooks/handler.ts:377–381`).
- Uses `spawnSync(cmd, args)` rather than shell execution, which avoids injection concerns when passing user-derived keywords (`plugins/code-analysis/hooks/handler.ts:46–52`).
- The fallback path is permissive when not indexed, avoiding breaking users who haven’t set up claudemem yet (`plugins/code-analysis/hooks/handler.ts:386–403`).

## Recommendations (non-blocking)

1. Consider guarding `prompt`/`description` with `typeof === "string"` before using them to build `searchContext` (robustness).
2. Consider reducing timeout for the “preview” claudemem call or skipping it entirely (hook responsiveness), since the hook is going to deny Explore regardless.
3. Consider newline sanitization in `escapeForTemplate()` for cleaner snippet rendering (formatting-only).

## Verdict

**APPROVE** (no major correctness/type issues found in the requested change scope).
