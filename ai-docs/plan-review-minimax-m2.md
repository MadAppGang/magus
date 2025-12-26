# SEO Plugin Design Document Review

**Reviewer:** minimax/minimax-m2.1
**Date:** 2025-12-26
**Review Type:** Design Validation
**Status:** CONDITIONAL PASS

---

## Overall Assessment: CONDITIONAL PASS

The design is well-structured with a solid four-agent architecture, but contains **3 critical issues** that will block implementation and **7 high-priority issues** that should be resolved before development begins.

---

## Critical Issues (Blocking Implementation)

### 1. Missing `Bash` Tool in seo-researcher Agent

**Location:** Line 341-342

```yaml
tools: TodoWrite, Read, Write, WebSearch, WebFetch, Glob, Grep
```

**Problem:** The seo-researcher agent lacks `Bash` access, yet the design references writing session files at lines 541:
```
**Full Research**: {session_path}/keyword-research-{seed}.md
```

All other agents (Analyst at line 137, Writer at line 563, Editor at line 824) include `Bash`. The researcher cannot write files to the filesystem without it.

**Impact:** Researcher cannot output keyword research reports - workflow breaks at Phase 6.

**Fix:** Add `Bash` to seo-researcher's tools list.

---

### 2. `SESSION_PATH` Variable Never Defined

**Location:** Lines 186, 317, 541, 800, 1131 (multiple occurrences)

**Problem:** The design uses `${SESSION_PATH}` and `{session_path}` throughout completion templates and instructions, but never defines:
- How the session path is constructed
- Where session files should be written
- The relationship between `SESSION_PATH` and `ai-docs/sessions/{SESSION_ID}/`

The `/seo-research` command (line 1207) creates `ai-docs/sessions/{SESSION_ID}/` but agents reference `SESSION_PATH` without understanding this mapping.

**Impact:** Agents cannot write output files correctly; orchestrators cannot read agent outputs.

**Fix:** Define `SESSION_PATH` in each agent's critical constraints section:
```yaml
<session_path_requirement>
  Session path is provided by orchestrator via context.
  Write outputs to: {session_path}/serp-analysis-{keyword}.md
  Never hardcode paths.
</session_path_requirement>
```

---

### 3. Missing Data Handoff Schema Between Agents

**Location:** Section 3 (Agent Specifications) and Section 4 (Commands)

**Problem:** The four-agent pipeline (Analyst → Researcher → Writer → Editor) lacks explicit data contracts:

- **Analyst output:** Creates `serp-analysis-{keyword}.md` but no structured JSON/YAML summary
- **Researcher input:** Should receive analyst findings but format is undefined
- **Writer input:** Content brief format is shown (lines 1463-1516) but not linked to researcher output
- **Editor input:** Should receive writer draft + original brief, but no unified structure

**Impact:** Orchestrators cannot reliably pass data between agents; each agent parses outputs differently or incompletely.

**Fix:** Define a `SeoAnalysisResult` schema that Analyst produces and subsequent agents consume:

```typescript
interface SeoAnalysisResult {
  keyword: string;
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  intentConfidence: number;
  serpFeatures: string[];
  competitors: Array<{url: string; wordCount: number; format: string}>;
  contentGaps: string[];
  recommendations: string[];
}
```

---

## High Priority Issues

### 4. seo-writer Cannot Perform Internal Linking

**Location:** Line 563-564

```yaml
tools: TodoWrite, Read, Write, Glob, Grep
```

**Problem:** The Writer is expected to "Add internal links to article" (line 560) with `seo:link-strategy` skill (line 564), but has no access to site content via WebSearch or WebFetch. Without fetching existing pages, internal linking becomes guesswork rather than strategic recommendation.

**Impact:** Internal links added will be placeholders ("link to related content") rather than actual URLs.

**Fix:** Add WebSearch to seo-writer's tools for discovering internal content, OR change internal linking to "recommend internal links" rather than "add internal links."

---

### 5. Chrome DevTools MCP Integration Too Vague

**Location:** Lines 1580-1581, 2024-2025, 2027-2038

**Problem:** The audit command references Chrome DevTools MCP for Core Web Vitals but:
- Doesn't show which MCP functions to call (`performance_start_trace`, `performance_analyze_inspect`)
- No conditional logic for MCP availability
- No fallback when MCP is unavailable

**Impact:** Core Web Vitals analysis cannot be implemented from this design.

**Fix:** Add explicit MCP function calls to `/seo-audit`:
```xml
<step>
  <decision>
    <if mcp_available="chrome-devtools">
      <action>performance_start_trace</action>
      <action>performance_stop_trace</action>
      <action>performance_analyze_inspect</action>
    </if>
    <else>
      <action>Skip Core Web Vitals, note limitation in report</action>
    </else>
  </decision>
</step>
```

---

### 6. Incomplete Skill Content (Placeholders)

**Location:** Lines 1838, 1853, 1868, 1827-1839

**Problem:** Multiple skills have placeholder content:
- `content-brief` skill (line 1838): "(Content similar to the brief template shown in /seo-brief command)"
- `technical-audit` skill (line 1853): "(Content similar to audit checklist shown in /seo-audit command)"
- `serp-analysis` skill (line 1868): "(Content similar to SERP features table shown in seo-analyst)"

**Impact:** Skills don't provide standalone value; agents must reference command documentation instead.

**Fix:** Provide complete, unique content for each skill that agents can reference independently.

---

### 7. WebSearch Doesn't Provide Search Volume Data

**Location:** Line 353 (seo-researcher expertise)

```yaml
- Search volume and difficulty estimation
```

**Problem:** WebSearch returns organic results only—not search volumes, difficulty scores, or trend data. The expertise claims "search volume and difficulty estimation" but the capability doesn't exist with available tools.

**Impact:** Researchers can only estimate, not provide actual metrics. Competitor tools (Ahrefs, SEMrush) provide real data.

**Fix:** Either:
- Add WebSearch volume data capability (verify it exists), OR
- Change expertise to "Search volume estimation based on SERP competition signals"

---

### 8. Claudish Multi-Model Validation Not Integrated

**Location:** Lines 38, 2025, 2107

**Problem:** Section 6 mentions Claudish for multi-model validation, and Section 8.3 shows Opus for Editor with rationale including "Final quality gate," but:
- No command shows Claudish usage
- No quality gate shows multi-model review trigger
- The "Claudish (multi-model)" entry in architecture diagram (line 38) has no implementation

**Impact:** Multi-model validation capability exists in architecture but cannot be used.

**Fix:** Add Claudish integration to seo-editor workflow as an optional phase:
```xml
<phase number="X" name="Multi-Model Validation (Optional)">
  <step>If user requests external review:</step>
  <step>claudish --model x-ai/grok-code-fast-1 --prompt "$CONTENT"</step>
  <step>Consolidate external feedback with internal review</step>
</phase>
```

---

### 9. Session Path Inconsistency Across Commands

**Location:** Line 1207 vs. template variables throughout

**Problem:** `/seo-research` creates `ai-docs/sessions/{SESSION_ID}/` (line 1207), but:
- Agent completion templates use `{session_path}` variable
- Some references use `ai-docs/sessions/{id}/` (line 1289)
- No global definition of session path structure

**Impact:** File paths written by agents may not match paths expected by orchestrators.

**Fix:** Define a single session path convention and use it consistently:
```yaml
# Standard session path format
SESSION_PATH: ai-docs/sessions/{SESSION_ID}
# Example: ai-docs/sessions/seo-research-20251226-143022-a3f2/
```

---

### 10. Proxy Mode Claudish Command Incomplete

**Location:** Lines 167-168, 371-372, 594-595, 856-857

**Problem:** All agents have proxy_mode_support with:
```bash
printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve
```

But this doesn't capture output. The pattern should:
1. Execute Claudish synchronously
2. Capture output to file
3. Return brief summary to orchestrator

**Fix:** Update proxy_mode_support pattern:
```bash
RESULT=$(printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet)
echo "$RESULT" > {session_path}/proxy-review.md
echo "External review complete. Full analysis: {session_path}/proxy-review.md"
```

---

## Medium Priority Suggestions

### 11. Add LLM Performance Tracking

**Location:** New section needed

**Suggestion:** Other plugins in this codebase track external model performance to `ai-docs/llm-performance.json`. The SEO plugin should similarly track:
- External model execution times (Claudish calls)
- Review quality scores
- Token usage

**Benefit:** Data-driven model selection over time.

---

### 12. Missing Error Handling Patterns

**Location:** Section 8 (Implementation Notes)

**Suggestion:** Add graceful degradation for:
- WebFetch failures (competitor pages unavailable)
- Chrome DevTools MCP not installed
- Claudish not available for proxy mode

**Current:** No error handling defined.

---

### 13. serp-analysis Skill is Redundant

**Location:** Lines 1857-1868

**Suggestion:** The skill contains "(Content similar to...)" and refers back to seo-analyst knowledge. Consider either:
- Removing the skill (consolidate into analyst agent)
- Making it a distinct reference with SERP feature deep-dive

---

### 14. Broken Markdown in keyword-cluster-builder

**Location:** Lines 1718-1723

**Suggestion:** The Intent Classification Rules table is not properly formatted in markdown. Fix syntax so table renders correctly.

---

### 15. Color Scheme Not in Plugin Manifest

**Location:** Section 2.1 (plugin.json) vs. Section 8.4

**Suggestion:** Agent colors are defined (purple/blue/green/cyan) but not included in the plugin manifest. Consider adding agent metadata to `plugin.json`.

---

## Strengths of the Design

### Well-Designed Four-Agent Architecture
The Analyst→Researcher→Writer→Editor pipeline (lines 48-63) follows natural SEO workflow:
- Analyst defines the landscape (intent, competitors)
- Researcher expands the universe (keywords, clusters)
- Writer creates the content (draft, optimize)
- Editor ensures quality (E-E-A-T, compliance)

This sequencing maximizes context efficiency: earlier agents gather intelligence that later agents use.

### Clear Model Selection Rationale
Section 8.3 provides explicit justification for each model choice:
- **Sonnet** for Analyst (nuanced SERP interpretation)
- **Haiku** for Researcher (speed for high-volume tasks)
- **Sonnet** for Writer (creative + technical balance)
- **Opus** for Editor (editorial judgment)

The choice of Haiku for the high-volume researcher role is particularly smart—maximizes throughput while maintaining quality.

### Comprehensive Skill Coverage
7 skills cover the full SEO domain:
- keyword-cluster-builder, content-optimizer, content-brief
- technical-audit, serp-analysis, schema-markup, link-strategy

Each skill has clear application and ownership.

### Quality Gate Framework Well-Defined
Section 7 defines severity classification (CRITICAL/HIGH/MEDIUM/LOW) with specific examples, and approval criteria for content (PASS/CONDITIONAL/FAIL).

The editor's approval matrix (line 1048-1055) prevents publication of substandard content.

### Proxy Mode Pattern Consistent
All agents implement the same proxy_mode_support pattern, enabling multi-model validation if needed. Shows awareness of external LLM capability.

### Comprehensive Documentation
The 2200+ line design document is thorough with examples, templates, and usage scenarios (Section 9). Good foundation for implementation.

---

## Summary Table

| Category | Count | Status |
|----------|-------|--------|
| Critical Issues | 3 | **MUST FIX** |
| High Priority Issues | 7 | **SHOULD FIX** |
| Medium Priority Suggestions | 5 | **NICE TO HAVE** |
| Strengths | 6+ | **BUILD ON** |

---

## Approval Recommendation

**Status:** CONDITIONAL PASS

**Prerequisites for Implementation:**
1. ✗ Fix 3 critical issues (Bash tool, SESSION_PATH definition, data schema)
2. ✗ Resolve 7 high-priority issues (internal linking, MCP details, skill placeholders, etc.)
3. ✓ Can proceed with implementation after fixes

**Estimated Effort to Fix:**
- Critical issues: 2-3 hours
- High-priority issues: 4-6 hours
- Medium suggestions: 2-3 hours (optional)

**Next Steps:**
1. Create revision addressing critical + high-priority issues
2. Re-validate design before implementation
3. Begin implementation with `agentdev:developer`

---

*Review completed by: minimax/minimax-m2.1 via Claudish proxy*
*Date: 2025-12-26*
