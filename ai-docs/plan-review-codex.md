# SEO Plugin Design Review

**Reviewer**: GPT-5.1 Codex Max (via Claudish Proxy)
**Design Document**: `/Users/jack/mag/claude-code/ai-docs/agent-design-seo-plugin.md`
**Review Date**: 2025-12-26
**Overall Assessment**: **CONDITIONAL PASS** ⚠️

---

## Executive Summary

The SEO plugin design demonstrates strong architectural thinking with a clear four-agent pipeline (Analyst→Researcher→Writer→Editor) that naturally mirrors human SEO workflows. The plugin includes all required components, proper model selection with clear rationale, and comprehensive SEO best practice coverage. However, three critical gaps prevent immediate implementation:

1. **Incomplete Skill Content** - Three skills (`content-brief`, `technical-audit`, `serp-analysis`) are marked as "content similar to…" without full Markdown bodies
2. **Missing Audit Methodology** - Technical audit workflow lacks Core Web Vitals collection details and schema validation specifics
3. **Orchestration Integration** - Commands need explicit guidance on proxy mode patterns and artifact file contracts

With these addressed, the design would earn **PASS** status. Current score: **7.6/10.0**

---

## Critical Issues (Blocking Implementation)

### 1. Incomplete Skill Files (CRITICAL - Section 1638-1854)

**Issue**: Three skills are referenced as stub implementations:
- Line 1838: `content-brief` → "Content similar to the brief template shown in /seo-brief command"
- Line 1853: `technical-audit` → "Content similar to audit checklist shown in /seo-audit command"
- Line 1868: `serp-analysis` → "Content similar to SERP features table shown in seo-analyst"

**Why It Blocks**: If these SKILL.md files don't exist as full Markdown documents, users won't be able to reference them via skill loading. The plugin ships with incomplete knowledge base.

**Fix Required**:
- Create `/plugins/seo/skills/content-brief/SKILL.md` with full brief template and creation methodology
- Create `/plugins/seo/skills/technical-audit/SKILL.md` with complete audit checklist and step-by-step methodology
- Create `/plugins/seo/skills/serp-analysis/SKILL.md` with intent classification tables and SERP feature strategies

**Suggested Approach**:
Extract the content from the respective sections and expand:
- Brief: Use template from lines 1462-1516 as base, add creation process
- Audit: Use checklist from lines 1610-1633, add step-by-step workflow
- SERP: Use intent table from lines 245-268, add feature strategy details

---

### 2. Missing Core Web Vitals Collection Methodology (CRITICAL - Section 1578-1606)

**Issue**: `/seo-audit` command includes "Core Web Vitals evaluation" (line 1542) and references Chrome DevTools MCP as optional (lines 1580-1581), but provides NO fallback methodology.

**Workflow Gap**:
```
Phase 3, Line 1580: "If Chrome DevTools MCP available: Check Core Web Vitals"
Problem: No "else" clause for when MCP is unavailable
Result: Users run audit, get no CWV data even though it's listed as audit requirement
```

**Fix Required**:
- Add explicit CWV analysis steps without MCP (page speed insights, GTmetrix screenshots, manual inspection heuristics)
- Define fallback: "If Chrome DevTools MCP not available, analyze HTML/CSS/JS patterns that indicate performance issues"
- Provide heuristic checks: Large images, unoptimized resources, render-blocking scripts

**Suggested Addition**:
```xml
<phase number="3" name="Technical Analysis">
  <steps>
    <step>If Chrome DevTools MCP available: Use MCP to collect Core Web Vitals</step>
    <step>If MCP unavailable: Use heuristic analysis:
      - Image sizes (>100KB unoptimized = performance risk)
      - CSS/JS concatenation (multiple files = higher overhead)
      - Hero element positioning (defer below-fold images)
      - Render-blocking scripts (move to async/defer)
    </step>
    <step>Recommend specific CWV optimizations based on findings</step>
  </steps>
</phase>
```

---

### 3. Schema Markup Validation Not Specified (CRITICAL - Section 1616-1620)

**Issue**: Audit checklist includes "Schema Markup: Article, FAQ, or relevant type - MEDIUM" but workflow doesn't specify HOW to validate.

**Missing Steps**:
- How to detect missing schema
- How to validate JSON-LD syntax
- How to check required vs. optional properties
- How to recommend schema type

**Fix Required**: Add explicit validation step in Phase 3:
```
<step>Validate schema markup:
  - Detect presence of JSON-LD markup
  - Validate syntax (no malformed JSON)
  - Check required properties per schema type
  - Use Google Rich Results Test methodology
  - Recommend missing schema if content type supports it
</step>
```

---

## High Priority Issues (Should Fix Before Implementation)

### 1. Proxy Mode Pattern Missing from Commands (High - Multiple Sections)

**Issue**: Agents (analyst, researcher, writer, editor) all include proxy-mode-support sections, but none of the 4 COMMANDS specify how to handle proxy directives.

**Problem**: If user wants to run `/seo-research` with external models (multi-model validation), how does the command pass through the proxy directives to the delegated agents?

**Location**: Lines 1142-1295 (/seo-research), 1299-1383 (/seo-optimize), 1387-1519 (/seo-brief), 1523-1607 (/seo-audit)

**Fix Required**: Add orchestration notes to each command explaining proxy mode:
```yaml
---
description: |
  ... (existing description)

  **Multi-Model Validation (Optional):**
  Commands support external model validation via Claudish proxy.
  Example: /seo-research "keyword" --proxy "x-ai/grok-code-fast-1"
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: orchestration:multi-model-validation, orchestration:quality-gates
---
```

Add to each command's workflow a phase for "parallel model execution" if requested.

---

### 2. /seo-optimize Missing File Safety Contract (High - Section 1345-1381)

**Issue**: Optimization workflow describes plan/apply/verify phases (lines 1346-1379) but doesn't specify:
- Where optimized files are written
- Whether original is backed up
- How to handle conflicts/rollback

**Problem**: User runs `/seo-optimize` → apply phase modifies content → no artifact contract means unclear what happened to the original.

**Location**: Phase 3, line 1365-1371

**Fix Required**: Add explicit artifact contract:
```xml
<phase number="3" name="Apply Optimizations">
  <objective>Apply optimizations with file safety</objective>
  <steps>
    <step>Create backup: {original_file}.bak</step>
    <step>Apply optimizations to {original_file}</step>
    <step>Create diff report: {session_dir}/optimization-diff.md</step>
    <step>Write optimized artifact to session: {session_dir}/optimized-content.md</step>
    <step>Return file paths to user for review</step>
  </steps>
  <quality_gate>User confirms optimizations before replacing original</quality_gate>
</phase>
```

---

### 3. Technical Audit Missing Indexability Checks (High - Section 1588-1606)

**Issue**: Checklist includes critical items (line 1619-1620):
- "Robots Meta: No noindex on important pages - CRITICAL"
- "Canonical Tag: Present, self-referencing - HIGH"

But workflow doesn't include steps to CHECK for these.

**Missing Workflow Steps**:
- Detect `<meta name="robots" content="noindex">`
- Extract and validate canonical tag
- Check for conflicting canonical (multiple canonical tags, pointing elsewhere)
- Flag if page is noindexed but should be indexed

**Location**: Phase 2 or 3, needs expansion

**Fix Required**: Add explicit detection steps:
```xml
<step>Indexability Check:
  - Scan for robots meta tag (flag if noindex on important pages)
  - Extract canonical tag (verify self-referencing)
  - Check for robots.txt blocks (run robots.txt check)
  - Flag: Conflicting canonicals, cross-domain canonicals
</step>
```

---

### 4. /seo-brief Missing Acceptance Criteria (High - Section 1421-1458)

**Issue**: Brief command includes "User Review" phase (line 1451-1457) with "Ask if adjustments needed" but no explicit acceptance criteria.

**Problem**: What makes a brief "good"? What should user evaluate?

**Location**: Phase 4, line 1451-1456

**Fix Required**: Add explicit acceptance criteria:
```xml
<quality_gate>
  Brief meets criteria:
  - All PAA questions identified and covered
  - Recommended word count justified by competitor analysis
  - Featured snippet opportunity identified (if applicable)
  - Competitor outline differences noted
  - E-E-A-T requirements specified
</quality_gate>
```

---

## Medium Priority Suggestions (Nice to Have)

### 1. Writer Workflow Should Surface E-E-A-T Evidence Targets

**Location**: Section 3.3, lines 637-683

**Current**: Writer workflow mentions "E-E-A-T signaling" in role (line 579) but doesn't specify HOW to build it into writing process.

**Suggestion**: Add output checklist:
- Cite-count target (minimum 3 authoritative sources)
- Experience evidence checklist (personal examples, case studies)
- Author credential placement (about author section or bio)

This reduces editor rework for E-E-A-T deficiencies.

---

### 2. Unify Severity Classification Across Audit and Editor

**Current**: Two different severity systems:
- Audit (lines 2044-2058): CRITICAL, HIGH, MEDIUM, LOW
- Editor (lines 946-951): Same categories BUT different definitions

**Issue**: Editor says "CRITICAL: Factual errors, keyword stuffing, missing meta tags" but audit says "CRITICAL: Missing title, broken structure, no indexability"

**Suggestion**: Create single shared severity taxonomy:
```yaml
skills: seo:quality-severity-standards
```

Then both audit and editor reference it, avoiding inconsistent decisions.

---

### 3. Specify Artifact Output Contracts for All Commands

**Location**: All 4 command sections

**Current**: Only `/seo-research` and `/seo-brief` specify output files (research-report.md, brief.md)

**Suggestion**: Add "Deliverables" to each command summary:
```
/seo-research:
  - ai-docs/sessions/{id}/serp-analysis-{keyword}.md
  - ai-docs/sessions/{id}/keyword-research-{seed}.md
  - ai-docs/sessions/{id}/research-report.md

/seo-optimize:
  - ai-docs/sessions/{id}/optimization-plan.md
  - ai-docs/sessions/{id}/optimized-content.md
  - ai-docs/sessions/{id}/optimization-diff.md

/seo-brief:
  - ai-docs/sessions/{id}/content-brief-{keyword}.md

/seo-audit:
  - ai-docs/sessions/{id}/audit-report-{url}.md
```

This makes pipeline operability clear upfront.

---

## Strengths (Top 5)

### 1. Clear Four-Agent Separation Aligned to SEO Lifecycle
The Analyst→Researcher→Writer→Editor pipeline mirrors real SEO teams. Each agent has distinct responsibilities, reducing context switching and enabling quality gates at natural handoff points. Well-designed.

### 2. Strong Checklists and Templates
- SEO Technical Compliance Checklist (lines 983-998)
- E-E-A-T Evaluation Checklist (lines 965-981)
- Brief Template (lines 1462-1516)
- Keyword Expansion Patterns (lines 458-475)

These are comprehensive, actionable, and reduce interpretation variance.

### 3. Built-In Quality Gates with Severity Definitions
Commands include explicit approval criteria:
- Editor: PASS/CONDITIONAL/FAIL (lines 875-881)
- Research: Minimum 50 keywords (line 1244)
- Brief: User confirmation (line 1451)

Quality gates drive process discipline.

### 4. Model-to-Task Alignment with Clear Rationale
Model selection is justified:
- Analyst: Sonnet (nuanced SERP interpretation)
- Researcher: Haiku (fast, structured keyword expansion)
- Writer: Sonnet (creative + technical constraints)
- Editor: Opus (final judgment, E-E-A-T assessment)

No arbitrary choices; each serves a specific purpose.

### 5. Comprehensive SEO Best Practice Coverage
- Intent classification (6 types with signals)
- SERP features (5 optimization strategies)
- E-E-A-T framework (4 dimensions + scoring)
- Link strategy (pillar + cluster structure)
- Schema markup (3 common types with JSON examples)

The design reflects modern SEO knowledge (2025).

---

## Scoring Breakdown (0-10 Scale)

| Category | Score | Notes |
|----------|-------|-------|
| **Architecture & Handoffs** | 8.5 | Clear separation, natural gates; proxy mode orchestration needed |
| **Component Completeness** | 7.0 | Agents ✅, skills incomplete ⚠️, commands need artifact contracts ⚠️ |
| **Workflow Quality Gates** | 7.5 | Editor gate strong; /seo-brief and /seo-optimize gates need tightening |
| **SEO Best-Practice Coverage** | 8.0 | Comprehensive; E-E-A-T could surface earlier in writer workflow |
| **Integration Clarity** | 7.0 | WebSearch/WebFetch clear; proxy mode + MCP fallback need work |
| **Model Selection & Rationale** | 9.0 | Excellent justification; aligns to task complexity |
| **Documentation Clarity** | 7.5 | Well-structured; some sections need concrete examples |
| **Operability** | 6.5 | Commands need explicit file contracts and backup strategies |
| | | |
| **OVERALL** | **7.6** | **CONDITIONAL** - Strong design, fixable gaps |

---

## Implementation Readiness Assessment

| Aspect | Status | Details |
|--------|--------|---------|
| **Design Completeness** | 90% | Comprehensive architecture; 3 skills + command details need tightening |
| **Plugin Manifest** | ✅ Complete | plugin.json fully specified |
| **Agent Specifications** | ✅ Complete | All 4 agents have full XML, workflows, examples |
| **Command Workflows** | ⚠️ Needs Work | 4 commands defined; artifact contracts missing; quality gates inconsistent |
| **Skill Documentation** | ❌ Incomplete | 3 of 7 skills are stubs; need full SKILL.md files |
| **SEO Methodology** | ✅ Sound | Intent classification, E-E-A-T, technical audit methodology solid |
| **Tool Integration** | ⚠️ Partial | WebSearch/WebFetch clear; proxy mode + MCP fallback need spec |
| **Quality Gates** | ⚠️ Inconsistent | Editor gate strong; /seo-brief, /seo-optimize, /seo-audit need tightening |

---

## Recommended Path to PASS Status

### Phase 1: Critical Fixes (1-2 hours)
1. **Complete Skill Files** (Highest Priority)
   - Expand `content-brief/SKILL.md` from template + process
   - Expand `technical-audit/SKILL.md` from checklist + methodology
   - Expand `serp-analysis/SKILL.md` from intent table + feature strategies

2. **Core Web Vitals Fallback** (Critical Path)
   - Add heuristic CWV analysis steps to `/seo-audit` Phase 3
   - Define fallback metrics when MCP unavailable

3. **Schema Validation Workflow** (Critical Path)
   - Add explicit validation steps for JSON-LD syntax and required properties

### Phase 2: High Priority Fixes (2-3 hours)
1. Add proxy mode guidance to each command's frontmatter
2. Add file safety contracts to `/seo-optimize` (backup, diff, artifact paths)
3. Add indexability checks to `/seo-audit` (robots meta, canonical validation)
4. Add acceptance criteria to `/seo-brief` brief output

### Phase 3: Medium Priority Enhancements (1-2 hours)
1. Surface E-E-A-T evidence targets in writer workflow
2. Unify severity classification across audit and editor
3. Specify artifact contracts for all 4 commands

---

## Specific References & Locations to Fix

| Issue | File | Section | Lines | Priority |
|-------|------|---------|-------|----------|
| Incomplete skill stubs | agent-design-seo-plugin.md | Section 5 (Skills) | 1638-1854 | CRITICAL |
| Missing CWV methodology | agent-design-seo-plugin.md | /seo-audit Phase 3 | 1578-1606 | CRITICAL |
| Missing schema validation | agent-design-seo-plugin.md | /seo-audit checklist | 1625 | CRITICAL |
| No proxy mode in commands | agent-design-seo-plugin.md | Sections 4.1-4.4 | 1142-1607 | HIGH |
| No file safety in /optimize | agent-design-seo-plugin.md | /seo-optimize Phase 3 | 1365-1371 | HIGH |
| Missing indexability checks | agent-design-seo-plugin.md | /seo-audit Phase 2 | 1567-1576 | HIGH |
| No brief acceptance criteria | agent-design-seo-plugin.md | /seo-brief Phase 4 | 1451-1458 | HIGH |
| E-E-A-T not in writer workflow | agent-design-seo-plugin.md | seo-writer workflow | 637-683 | MEDIUM |
| Inconsistent severity taxonomy | agent-design-seo-plugin.md | Audit vs Editor | 2044-2058 vs 946-951 | MEDIUM |
| Missing artifact contracts | agent-design-seo-plugin.md | All 4 commands | 1142-1607 | MEDIUM |

---

## Questions for Design Author

1. **Skill Priority**: Which 3 incomplete skills should we prioritize? (Recommend: technical-audit > serp-analysis > content-brief)
2. **CWV Fallback**: Should audit degrade gracefully to heuristic analysis, or should MCP be required?
3. **Artifact Storage**: Should all session artifacts go to `ai-docs/sessions/{id}/` or would you prefer a different structure?
4. **Proxy Mode**: Should commands support optional proxy directives (e.g., `--proxy "model-name"`) or only agents?
5. **Multi-Model Validation**: Is multi-model review in-scope for Phase 1 or Phase 2?

---

## Conclusion

The SEO plugin design demonstrates **solid architectural thinking** with a natural four-agent pipeline, comprehensive SEO methodology, and strong quality gates. The 3 critical issues are all addressable with localized fixes:

- Complete the 3 skill files (copy+expand existing content)
- Add CWV heuristic fallback (5-10 lines)
- Add schema/robots/canonical validation steps (5-10 lines)

**Recommendation**:
- **Current Status**: CONDITIONAL PASS (7.6/10)
- **With Critical Fixes**: PASS (8.5+/10)
- **Timeline**: 2-3 hours to move from CONDITIONAL → PASS
- **Risk Level**: Low - all issues are content/methodology gaps, no architectural problems

The design is **implementation-ready with the critical fixes applied**. I recommend prioritizing skill file completion and CWV fallback methodology before handing off to `agentdev:developer` for implementation.

---

**Generated by**: GPT-5.1 Codex Max (via Claudish Proxy)
**Review Methodology**: Comprehensive architectural analysis + SEO best practice validation
**Confidence Level**: High (expert review by specialized model)

