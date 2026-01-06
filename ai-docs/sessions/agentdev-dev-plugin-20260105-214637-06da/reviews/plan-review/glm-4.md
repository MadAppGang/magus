# Dev Plugin Design Review

**Reviewer**: GLM-4.7 (z-ai/glm-4.7)
**Date**: 2026-01-05
**Status**: CONDITIONAL APPROVAL

---

## CRITICAL Issues

### 1. Help Command Not Specified
- **Issue**: The `help.md` command is referenced in directory structure and plugin.json, but has **NO specifications** in the design
- **Impact**: Users won't have documentation or guidance on how to use the plugin
- **Fix**: Add complete help command specification with examples for all 4 commands

### 2. Skill Auto-Loading Implementation Undefined
- **Issue**: The design specifies a sophisticated context-detection algorithm (sections 3.1-3.4) but **NEVER explains HOW skills are actually loaded into agent context**
- **Gap Analysis**:
  - Detection: Clearly defined (explicit preference -> file context -> config files -> directory patterns)
  - Action: Not specified - how does `{DETECTED_SKILLS}` become part of agent prompts?

- **Critical Questions**:
  - Are detected skills concatenated into agent prompts?
  - Are skills dynamically added via some mechanism?
  - How do agents "read" `DETECTED_SKILLS` parameter?
  - Are framework-specific skills loaded inline or via Skill tool?
  - What's the difference between `plugin.json` skills (always loaded) and dynamically loaded skills?

- **Recommended Approach**: Check orchestration plugin patterns for skill injection, or design a skill-loading protocol (e.g., agent reads skill files and concatenates content into prompt)

---

## HIGH Issues

### 3. Skill Content Not Specified
- **Issue**: All 14 skills have YAML frontmatter descriptions but **NO actual content defined** - only bullet points of what "content includes"
- **Impact**: Implementation will require substantial creative work not captured in design
- **Examples**:
  - `react-typescript`: "Content includes: React 19 specific patterns..." - but what ARE those patterns?
  - `universal-patterns`: "Covers: error handling, logging..." - but what are the actual patterns?
- **Fix**: Either specify core content or explicitly state "content to be written during implementation"

### 4. Quality Check Commands May Fail
- **Issue**: Phase 4 of commands lists quality checks like:
  ```
  - React/TypeScript: bun run format && bun run lint && bun run typecheck && bun test
  - Go: go fmt && go vet && go test ./...
  ```
- **Problem**: These assume specific package.json scripts, which may not exist in all projects
- **Impact**: Commands will fail silently or with confusing errors when scripts don't exist
- **Fix**: Add fallback logic:
  1. Check if script exists in package.json
  2. If not, run tool directly (e.g., `bun run --bun tsc --noEmit`)
  3. Provide clear error if tool not installed

### 5. Session ID Collision Risk
- **Issue**: Session initialization uses timestamp + 4-character random suffix:
  ```bash
  SESSION_BASE="dev-impl-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p | head -c4)"
  ```
- **Problem**: With rapid sequential command execution, collisions could occur (low probability but possible)
- **Fix**: Use longer random suffix or PID to ensure uniqueness

---

## MEDIUM Issues

### 6. Multi-Model Review Performance Tracking Not Implemented
- **Issue**: Section 4.3 mentions "Track model performance" and "Model performance stats" but **doesn't specify HOW**:
  - Where is performance data stored? (`ai-docs/sessions/.../performance.json`?)
  - What metrics are tracked? (time, token count, quality score?)
  - How is "historical performance" retrieved? (global file or per-project?)
- **Impact**: Performance tracking feature can't be implemented as designed
- **Fix**: Add specification for performance tracking mechanism

### 7. Claudish Dependency Handling Unclear
- **Issue**: Commands check "if Claudish available" but:
  - How do they check? (command exists in PATH?)
  - What if Claudish is installed but not configured?
  - How to handle PROXY_MODE failures?
- **Fix**: Add dependency checking procedure and graceful degradation

### 8. Error Recovery Paths Missing
- **Issue**: Workflow sections don't specify what happens when:
  - Stack detection fails completely
  - Skill loading finds no applicable skills
  - Quality checks fail with no fix possible
  - Multi-model review times out
- **Fix**: Add error handling scenarios for each phase

### 9. Skill Loading Conflict with Plugin.json
- **Issue**: `plugin.json` lists 15 skills under `"skills"`:
  ```json
  "skills": [
    "./skills/context-detection",
    "./skills/core/universal-patterns",
    ...
  ]
  ```
  **Question**: Are these always loaded (as standard plugin behavior), or should only core skills be listed and framework skills loaded dynamically?
  - **If always loaded**: Why have auto-loading mechanism?
  - **If dynamic**: Why list them in plugin.json?
- **Fix**: Clarify plugin.json skills vs. dynamic skills distinction

---

## LOW Issues

### 10. Missing Skill: Bun for React
- **Issue**: Quality checks list "bun run format" for React/TypeScript but don't specify Bun runtime skill
- **Impact**: May work via bun being available in PATH, but inconsistent with having skills for other runtimes (golang, python, rust)
- **Suggestion**: Consider adding `runtime/bun` skill or explicitly document that Bun is assumed available

### 11. No Specification for User Preferences Storage
- **Issue**: Section 8.1 shows `.claude/settings.json` structure but doesn't specify:
  - Who creates this structure? (setup command?)
  - What if user deletes it manually?
  - Migration strategy when adding new options?
- **Fix**: Add user configuration management specification

### 12. Implementation Phase Timings Unrealistic
- **Issue**: Phases specify "Week 1", "Week 2", etc., which suggests full-time development
- **Reality**: This is likely a side project or part-time work
- **Fix**: Remove specific timeframes or clarify they're estimates

### 13. Directory Structure Inconsistency
- **Issue**: Skills in directory structure have `SKILL.md` subdirectory:
  ```
  ./skills/core/universal-patterns/
      SKILL.md
  ```
  But `plugin.json` references `./skills/core/universal-patterns` (no `/SKILL.md`)
- **Fix**: Clarify whether paths should include `/SKILL.md` suffix

---

## Strengths

1. **Comprehensive command specifications** - 4 commands fully detailed with workflows, phases, quality gates
2. **Excellent orchestration pattern** - Clear separation of concerns (orchestrator vs. implementer)
3. **Well-designed detection algorithm** - 4-tier detection priority system is thoughtful
4. **Smart session isolation** - Each command gets unique session directory for artifacts
5. **Multi-model validation integration** - Clever use of Claudish for code reviews
6. **Quality-focused design** - Quality checks and user approval gates at every phase
7. **Technology-agnostic approach** - Universal agents that adapt to any stack

---

## Issue Summary

| Severity | Count | Issues |
|----------|-------|--------|
| CRITICAL | 2 | Help command missing, skill loading undefined |
| HIGH | 3 | Skill content missing, quality checks may fail, session ID collision |
| MEDIUM | 4 | Performance tracking, Claudish handling, error recovery, skill loading conflict |
| LOW | 4 | Bun skill, preferences storage, timings, directory structure |

---

## Recommended Next Steps

### For Critical Issues:
1. **Immediately**: Add help command specification
2. **Immediately**: Clarify skill loading mechanism (this is the biggest blocker)

### For High Issues:
3. Specify skill content or explicitly defer to implementation phase
4. Add quality check fallback logic
5. Improve session ID generation

### For Implementation:
6. Review orchestration plugin for skill patterns
7. Create specification for performance tracking
8. Design dependency checking procedures

---

## Approval Decision

**Status**: CONDITIONAL

**Rationale**: The design is **85% complete** with strong architectural foundations and comprehensive command specifications. The **primary blocker** is the undefined skill loading mechanism - without this, the core innovation (context-aware skill auto-loading) cannot be implemented.

**Conditions for PASS**:
1. Resolve skill loading mechanism (CRITICAL)
2. Add help command specification (CRITICAL)
3. Design performance tracking (HIGH)

Once these architectural questions are answered, the design is ready for implementation.

---

*Generated by: z-ai/glm-4.7 via Claudish*
