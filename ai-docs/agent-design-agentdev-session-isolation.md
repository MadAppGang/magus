# Agent Design: Session Isolation for Agentdev Plugin

**Date:** 2026-01-05
**Version:** 1.0.0
**Type:** Enhancement
**Priority:** HIGH

---

## Problem Statement

### Current Issue

The agentdev plugin writes all artifacts to a flat `ai-docs/` directory:
- `ai-docs/agent-design-{name}.md`
- `ai-docs/plan-review-grok.md`
- `ai-docs/plan-review-gemini.md`
- `ai-docs/implementation-review-*.md`
- `ai-docs/agent-development-report-*.md`

When multiple agentdev workflows run in parallel or sequence (different agents, same model reviewers), files collide and overwrite each other:

```
Session 1 (SEO agents): writes ai-docs/plan-review-grok.md
Session 2 (Nanobanana):  writes ai-docs/plan-review-grok.md  <-- OVERWRITES!
```

**Observed Impact:**
- Plan reviews from one project mixed with another
- External model reviewers (Claudish) given wrong project context
- Report consolidation includes foreign reviews
- No traceability between sessions

### Reference Implementation

The SEO and Frontend plugins solved this with session-based isolation:

```bash
# Session initialization (frontend/commands/review.md, line 312-335)
SESSION_BASE="review-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
mkdir -p "${SESSION_PATH}/reviews"
```

All artifacts then use `${SESSION_PATH}` prefix:
- `${SESSION_PATH}/code-review-context.md`
- `${SESSION_PATH}/reviews/claude-review.md`
- `${SESSION_PATH}/reviews/grok-review.md`
- `${SESSION_PATH}/reviews/consolidated.md`

---

## Proposed Solution

### 1. Session Initialization in `/agentdev:develop`

Add session initialization at Phase 0 (Init):

```bash
# Generate unique session path
AGENT_SLUG=$(echo "${AGENT_NAME:-agent}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
SESSION_BASE="agentdev-${AGENT_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"

# Create directory structure
mkdir -p "${SESSION_PATH}/reviews/plan-review" \
         "${SESSION_PATH}/reviews/impl-review" || {
  echo "Warning: Cannot create session directory, using legacy mode"
  SESSION_PATH="ai-docs"
}

# Export for sub-agents
export SESSION_PATH
```

### 2. Updated Artifact Paths

| Artifact | Current Path | New Path |
|----------|--------------|----------|
| Design plan | `ai-docs/agent-design-{name}.md` | `${SESSION_PATH}/design.md` |
| Plan review (internal) | `ai-docs/plan-review-internal.md` | `${SESSION_PATH}/reviews/plan-review/internal.md` |
| Plan review (external) | `ai-docs/plan-review-{model}.md` | `${SESSION_PATH}/reviews/plan-review/{model}.md` |
| Plan consolidated | `ai-docs/plan-review-consolidated.md` | `${SESSION_PATH}/reviews/plan-review/consolidated.md` |
| Impl review (internal) | `ai-docs/implementation-review-internal.md` | `${SESSION_PATH}/reviews/impl-review/internal.md` |
| Impl review (external) | `ai-docs/implementation-review-{model}.md` | `${SESSION_PATH}/reviews/impl-review/{model}.md` |
| Impl consolidated | `ai-docs/implementation-review-consolidated.md` | `${SESSION_PATH}/reviews/impl-review/consolidated.md` |
| Final report | `ai-docs/agent-development-report-{name}.md` | `${SESSION_PATH}/report.md` |

### 3. Session Metadata

Create `${SESSION_PATH}/session-meta.json`:

```json
{
  "session_id": "agentdev-seo-20260105-143022-a3f2",
  "type": "agentdev",
  "target": "seo agent improvements",
  "started_at": "2026-01-05T14:30:22Z",
  "status": "in_progress",
  "phases_completed": ["init", "design"],
  "models_used": ["claude-embedded", "x-ai/grok-code-fast-1"],
  "artifacts": {
    "design": "design.md",
    "plan_reviews": ["reviews/plan-review/internal.md", "reviews/plan-review/grok.md"],
    "impl_reviews": [],
    "report": null
  }
}
```

### 4. Sub-Agent Prompts

Pass SESSION_PATH to all sub-agents:

**To architect:**
```
SESSION_PATH: ${SESSION_PATH}

Design agent for: {user_request}

Save design plan to: ${SESSION_PATH}/design.md
```

**To reviewer (plan review):**
```
PROXY_MODE: {model_id}
SESSION_PATH: ${SESSION_PATH}

Review design at: ${SESSION_PATH}/design.md
Save review to: ${SESSION_PATH}/reviews/plan-review/{model_sanitized}.md
```

**To reviewer (impl review):**
```
PROXY_MODE: {model_id}
SESSION_PATH: ${SESSION_PATH}

Review agent at: {agent_file_path}
Save review to: ${SESSION_PATH}/reviews/impl-review/{model_sanitized}.md
```

### 5. Sub-Agent Updates

#### `architect.md` Changes

```diff
<output_requirement>
-  Create design document: `ai-docs/agent-design-{name}.md`
+  Create design document at SESSION_PATH (if provided) or `ai-docs/`:
+  - With SESSION_PATH: `${SESSION_PATH}/design.md`
+  - Without SESSION_PATH: `ai-docs/agent-design-{name}.md` (legacy)
+
+  **SESSION_PATH Detection:**
+  1. Check if prompt contains `SESSION_PATH: {path}`
+  2. Extract and use that path for output
+  3. If not provided, use legacy ai-docs/ path
</output_requirement>
```

#### `reviewer.md` Changes

```diff
<output_requirement>
-  Create review document: `ai-docs/review-{name}-{timestamp}.md`
+  Create review document at SESSION_PATH (if provided) or `ai-docs/`:
+  - With SESSION_PATH: `${SESSION_PATH}/reviews/{review_type}/{model}.md`
+  - Without SESSION_PATH: `ai-docs/review-{name}-{timestamp}.md` (legacy)
</output_requirement>
```

### 6. Backward Compatibility

**Legacy Mode Triggers:**
1. SESSION_PATH not provided in prompt
2. Directory creation fails
3. Explicit `LEGACY_MODE: true` in prompt

**Behavior:**
- Fall back to current `ai-docs/` paths
- Log warning about legacy mode
- All features still work, just without isolation

---

## Files to Modify

### Commands (1)

| File | Changes |
|------|---------|
| `plugins/agentdev/commands/develop.md` | Add session initialization, update all artifact paths |

### Agents (3)

| File | Changes |
|------|---------|
| `plugins/agentdev/agents/architect.md` | Accept SESSION_PATH, update output path |
| `plugins/agentdev/agents/developer.md` | Accept SESSION_PATH, use for design input path |
| `plugins/agentdev/agents/reviewer.md` | Accept SESSION_PATH, update output path |

### Plugin Manifest (1)

| File | Changes |
|------|---------|
| `plugins/agentdev/plugin.json` | Version bump to 1.2.0 |

---

## Detailed Changes

### `commands/develop.md`

#### Add to Phase 0 (Init)

```xml
<phase number="0" name="Init">
  <objective>Setup workflow and validate prerequisites</objective>
  <steps>
    <step>Create TodoWrite with all phases</step>
    <step>Check Claudish: `npx claudish --version`</step>
    <step>If unavailable, notify user (will skip external reviews)</step>
    <step>
      **Session Initialization:**
      ```bash
      # Extract target name from user request for folder naming
      AGENT_SLUG=$(echo "${TARGET_NAME:-agent}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
      SESSION_BASE="agentdev-${AGENT_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
      SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"

      # Create directory structure
      mkdir -p "${SESSION_PATH}/reviews/plan-review" \
               "${SESSION_PATH}/reviews/impl-review" || {
        echo "Warning: Cannot create session directory, using legacy mode"
        SESSION_PATH="ai-docs"
      }

      # Create session metadata
      cat > "${SESSION_PATH}/session-meta.json" << 'EOF'
      {
        "session_id": "${SESSION_BASE}",
        "type": "agentdev",
        "target": "${USER_REQUEST}",
        "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
        "status": "in_progress"
      }
      EOF
      ```
    </step>
  </steps>
  <quality_gate>Session initialized, SESSION_PATH set</quality_gate>
</phase>
```

#### Update Phase 1 (Design)

```xml
<phase number="1" name="Design">
  <objective>Create comprehensive agent design plan</objective>
  <steps>
    <step>Mark PHASE 1 in_progress</step>
    <step>Gather context (existing agents, patterns)</step>
    <step>
      Launch `agentdev:architect` with:
      ```
      SESSION_PATH: ${SESSION_PATH}

      {user_request}

      Save design to: ${SESSION_PATH}/design.md
      ```
    </step>
    <step>Verify design document created at ${SESSION_PATH}/design.md</step>
    <step>Mark PHASE 1 completed</step>
  </steps>
  <quality_gate>Design document exists at ${SESSION_PATH}/design.md</quality_gate>
</phase>
```

#### Update Phase 1.5 (Plan Review)

```xml
<step>
  **Run Reviews IN PARALLEL** (single message, multiple Task calls):

  For each model, launch `agentdev:architect` with:
  ```typescript
  Task({
    subagent_type: "agentdev:architect",
    description: "Grok plan review",
    run_in_background: true,
    prompt: `PROXY_MODE: x-ai/grok-code-fast-1
SESSION_PATH: ${SESSION_PATH}

Review the design plan at ${SESSION_PATH}/design.md

Evaluate:
1. Design completeness
2. XML/YAML structure validity
3. TodoWrite integration
4. Proxy mode support
5. Example quality

Save findings to: ${SESSION_PATH}/reviews/plan-review/grok.md`
  })
  ```
</step>
<step>Consolidate feedback → ${SESSION_PATH}/reviews/plan-review/consolidated.md</step>
```

#### Update Phase 3 (Quality Review)

```xml
<step>
  **Reviews 2..N: External IN PARALLEL** (single message):
  For each model, launch `agentdev:reviewer` with:
  ```
  PROXY_MODE: {model_id}
  SESSION_PATH: ${SESSION_PATH}

  Review agent at {file_path}
  Save to: ${SESSION_PATH}/reviews/impl-review/{model-sanitized}.md
  ```
</step>
<step>Consolidate → ${SESSION_PATH}/reviews/impl-review/consolidated.md</step>
```

#### Update Phase 5 (Finalization)

```xml
<phase number="5" name="Finalization">
  <steps>
    <step>Create ${SESSION_PATH}/report.md</step>
    <step>
      Update session metadata:
      ```bash
      jq '.status = "completed" | .completed_at = now | todate' \
        "${SESSION_PATH}/session-meta.json" > "${SESSION_PATH}/session-meta.json.tmp"
      mv "${SESSION_PATH}/session-meta.json.tmp" "${SESSION_PATH}/session-meta.json"
      ```
    </step>
  </steps>
</phase>
```

#### Update Final Message

```markdown
## Development Complete

**Agent**: {name}
**Location**: {path}
**Session**: ${SESSION_PATH}

**Artifacts**:
- Design: ${SESSION_PATH}/design.md
- Plan Reviews: ${SESSION_PATH}/reviews/plan-review/
- Impl Reviews: ${SESSION_PATH}/reviews/impl-review/
- Report: ${SESSION_PATH}/report.md
```

---

## Alternative Considered: Skill-Based Approach

**Option:** Create `orchestration:session-management` skill

**Pros:**
- Reusable across plugins
- Centralized session logic
- Consistent patterns

**Cons:**
- Skills are documentation-only (no code execution)
- Session initialization needs bash execution
- Would still require command-level changes

**Decision:** Direct command modification is more effective for this use case. Skills can document the pattern for reference.

---

## New Skill: `orchestration:session-isolation`

Create a documentation skill to ensure other plugins follow the same pattern:

```markdown
# Session Isolation Skill

## Pattern

All multi-artifact workflows SHOULD use session isolation:

1. **Initialize at workflow start:**
   - Generate unique SESSION_PATH
   - Create directory structure
   - Write session-meta.json

2. **Pass to all sub-agents:**
   - Include `SESSION_PATH: ${path}` in prompts
   - Agents detect and use this path

3. **Fallback to legacy:**
   - If directory creation fails
   - If SESSION_PATH not in prompt
   - Log warning but continue

## Directory Structure

ai-docs/sessions/{workflow}-{target}-{timestamp}-{random}/
├── session-meta.json
├── design.md (or context.md)
├── reviews/
│   ├── plan-review/
│   │   ├── internal.md
│   │   ├── grok.md
│   │   └── consolidated.md
│   └── impl-review/
│       ├── internal.md
│       ├── gemini.md
│       └── consolidated.md
└── report.md
```

---

## Implementation Checklist

### Phase 1: Command Update
- [ ] Add session initialization to `develop.md` Phase 0
- [ ] Update all artifact paths to use `${SESSION_PATH}`
- [ ] Add session metadata creation
- [ ] Update final message with session folder

### Phase 2: Agent Updates
- [ ] Update `architect.md` to accept SESSION_PATH
- [ ] Update `developer.md` to read from SESSION_PATH
- [ ] Update `reviewer.md` to write to SESSION_PATH

### Phase 3: New Skill
- [ ] Create `orchestration:session-isolation` skill
- [ ] Document pattern for other plugins

### Phase 4: Version & Test
- [ ] Bump `plugins/agentdev/plugin.json` to 1.2.0
- [ ] Update `plugins/agentdev/README.md`
- [ ] Update `.claude-plugin/marketplace.json`
- [ ] Test with sample workflow

---

## Validation

### Pre-Implementation Verification
```bash
# Current state - files in flat ai-docs/
ls ai-docs/plan-review-*.md
ls ai-docs/implementation-review-*.md
```

### Post-Implementation Verification
```bash
# Session folders created
ls ai-docs/sessions/

# Artifacts in session folder
ls ai-docs/sessions/agentdev-seo-*/
ls ai-docs/sessions/agentdev-seo-*/reviews/

# No more flat files for new sessions
ls ai-docs/plan-review-*.md  # Should only have legacy files
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Legacy mode fallback hides issues | Low | Medium | Log warnings clearly |
| Sub-agents ignore SESSION_PATH | Medium | High | Clear prompt format |
| Directory permissions | Low | Medium | Fallback to legacy |
| Breaking existing workflows | Low | Low | Backward compatible |

---

## Summary

This enhancement adds session-based isolation to the agentdev plugin, preventing file collisions when running multiple agent development workflows. The solution:

1. **Initializes unique session folders** at workflow start
2. **Passes SESSION_PATH** to all sub-agents
3. **Updates all artifact paths** to use session prefix
4. **Falls back gracefully** to legacy mode if needed
5. **Documents the pattern** for other plugins

**Files Changed:** 5 (develop.md, architect.md, developer.md, reviewer.md, plugin.json)
**New Files:** 1 (orchestration:session-isolation skill)
**Backward Compatible:** Yes

---

*Generated by: Claude Opus 4.5*
*Date: 2026-01-05*
