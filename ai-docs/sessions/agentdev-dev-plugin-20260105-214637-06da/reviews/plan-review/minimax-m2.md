# Dev Plugin Design Plan Review

**Reviewer:** minimax/minimax-m2.1
**Date:** 2026-01-05
**Status:** CONDITIONAL

## Review Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 3 |
| MEDIUM | 3 |

---

## CRITICAL Issues

### 1. Missing Write tool for stack-detector agent

**Location:** Line 304 (agent definition)

**Description:** The `stack-detector` agent has tools: `TodoWrite, Read, Glob, Grep, Bash` but needs `Write` to save detection results to session files. This breaks the "Report" phase workflow at lines 1824-1827.

**Impact:** Stack detection results cannot be persisted to session files, breaking the workflow chain.

**Fix:** Add `Write` to stack-detector agent tools list:
```yaml
tools: TodoWrite, Read, Write, Glob, Grep, Bash
```

---

### 2. Inconsistent skill path references in plugin.json

**Location:** Lines 73-90 (plugin.json skills array)

**Description:** The skills array mixes directory paths (`./skills/context-detection`) with file paths (`./skills/core/universal-patterns`). Skills should consistently reference directories that contain `SKILL.md` files, not mixed formats. This will cause auto-loading failures.

**Impact:** Plugin skill loading will fail unpredictably.

**Fix:** Ensure all skill paths use consistent format - either all directories or all explicit SKILL.md paths.

---

### 3. Skills array count mismatch

**Location:** Lines 73-90 vs Lines 1607-1762

**Description:** The plugin.json lists 16 skills but the skills organization section documents 17 skills. The `bunjs` skill is referenced at line 87 but the directory structure shows `bunjs/` at line 155 with inconsistent mapping.

**Impact:** Missing skills in manifest means they won't be available to agents.

**Fix:** Audit and reconcile skill list between plugin.json and directory structure. Ensure 1:1 mapping.

---

## HIGH Issues

### 4. Missing state-management and testing-frontend from skills array

**Location:** Lines 81-82 (plugin.json)

**Description:** Lines 81 and 82 reference `state-management` and `testing-frontend` skills in the directory structure but these are listed as subdirectories, not in the main skills array, causing auto-loader to miss them.

**Impact:** Frontend-specific skills won't be loaded even when React/Vue detected.

**Fix:** Add all frontend skills explicitly to the skills array:
```json
"./skills/frontend/state-management",
"./skills/frontend/testing-frontend"
```

---

### 5. Detection algorithm lacks multi-stack fallback

**Location:** Lines 237-289 (Detection Algorithm)

**Description:** The detection algorithm doesn't handle hybrid projects (e.g., React frontend + Go backend). It returns a single skill set. Projects with both `package.json` and `go.mod` will have undefined behavior.

**Impact:** Full-stack projects will only get partial skill loading, missing either frontend or backend patterns.

**Fix:** Modify detection algorithm to:
1. Detect ALL stacks present in project
2. Merge skill sets from all detected stacks
3. Add explicit "fullstack" mode when both frontend and backend detected

---

### 6. Phase 1 skips plugin structure validation

**Location:** Week 1, Lines 2042-2047 (Implementation Phases)

**Description:** Implementing the manifest and agents without first validating the plugin structure means bugs in manifest syntax won't be caught until Phase 7 testing.

**Impact:** Structural issues will compound through 6 weeks of development before being discovered.

**Fix:** Add validation step to Phase 1:
- [ ] Validate plugin.json schema
- [ ] Test plugin loading before implementing agents
- [ ] Add basic smoke tests for skill loading

---

## MEDIUM Issues

### 7. Universal-developer agent tool inconsistency

**Location:** Line 1856 (agent definition)

**Description:** The agent definition shows `tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep` which IS correct and includes Bash. However, the agent runs quality checks (lines 1883-1888) which require Bash execution. The documentation should clarify this is intentional.

**Impact:** Low - tools are correct, but documentation clarity could prevent confusion.

**Fix:** Add comment in agent definition clarifying Bash is for quality checks.

---

### 8. dev-debug command tool scope

**Location:** Line 611 (command definition)

**Description:** The command is an orchestrator with `allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep`. While it's correctly defined as an orchestrator (no Write/Edit), the error analysis workflow (lines 713-718) describes reading source files. This is handled via Read tool which IS included.

**Impact:** Low - design is correct, but workflow description could be clearer.

**Fix:** Clarify in workflow that source file analysis uses Read tool, implementation delegates to universal-developer.

---

### 9. Frontend/Backend skills organization split

**Location:** Lines 1607-1657 vs Lines 1659-1762

**Description:** The design document lists 4 frontend skills and shows backend skills split between generic patterns (api-design, database-patterns, auth-patterns, error-handling) and language-specific skills (golang, bunjs, python, rust). The rationale for this split isn't clearly documented.

**Impact:** Implementation may be unclear about when to use generic vs language-specific skills.

**Fix:** Add documentation section explaining:
1. Generic backend skills apply to ALL backend languages
2. Language-specific skills add idiomatic patterns
3. Detection should load both generic + language-specific

---

## LOW Issues

### 10. Missing skill dependency documentation

**Description:** Skills reference other skills but dependencies aren't formally documented. For example, `react-typescript` likely depends on `state-management` for TanStack Query patterns.

**Fix:** Add `dependencies` field to skill YAML frontmatter.

---

### 11. Session path generation inconsistency

**Description:** Different commands use slightly different session path patterns:
- dev-implement: `dev-impl-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)`
- dev-debug: `dev-debug-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)`
- dev-feature: Uses FEATURE_SLUG

**Fix:** Standardize session path generation pattern across all commands.

---

### 12. No versioning strategy for skills

**Description:** Skills are versioned only at the plugin level (1.0.0). Individual skills may evolve independently.

**Fix:** Consider skill-level versioning for independent updates.

---

## Recommendations

1. **Before Implementation:** Run plugin.json through Claude Code's plugin validator
2. **Week 1 Addition:** Add integration test for skill auto-loading
3. **Documentation:** Add troubleshooting section for skill loading failures
4. **Future Enhancement:** Consider skill marketplace for community contributions

---

## Approval Decision

**Status:** CONDITIONAL

**Rationale:**
- 3 CRITICAL issues must be fixed before implementation
- 3 HIGH issues should be addressed in Phase 1
- Design is otherwise sound with good structure

**Required Actions:**
1. Fix stack-detector Write tool issue
2. Reconcile skill paths and counts
3. Add multi-stack detection support
4. Add plugin validation to Phase 1

---

*Generated by: minimax/minimax-m2.1 via Claudish*
