# SEO Plugin Design Review

**Reviewer**: Mistral Small Creative (via Claudish)
**Document**: agent-design-seo-plugin.md
**Date**: 2025-12-26
**Status**: Design Review Complete

---

## Overall Assessment

**VERDICT: CONDITIONAL PASS**

The SEO plugin design demonstrates solid architectural thinking with a well-structured four-agent pipeline and comprehensive skill coverage. However, several high-priority issues must be addressed before implementation to ensure practical feasibility and alignment with the plugin ecosystem.

---

## Critical Issues (Blocking Implementation)

**None identified.** The design does not contain fundamental architectural flaws that would prevent implementation.

---

## High Priority Issues (Must Fix Before Implementation)

### 1. **Model Cost/Performance Tradeoff Not Justified for Haiku**

**Issue**: The SEO Researcher is assigned Haiku model with rationale only being "High volume, structured output, speed-optimized."

**Problem**:
- Keyword research requires semantic understanding and expansion patterns
- Haiku may struggle with complex expansions (50-100 keywords with semantic clustering)
- Cost savings are minimal (Haiku ~$0.40/1M vs Sonnet ~$1.50/1M) but quality risk is high
- No evidence provided that Haiku can handle sophisticated funnel stage mapping

**Recommendation**:
- Change seo-researcher model to **Sonnet** (same as analyst/writer)
- Justification: Quality of semantic clustering outweighs cost savings
- Alternative: Keep Haiku but reduce researcher scope (only expansion, not clustering)
- Cost: Negligible impact (researcher runs once per research cycle)

**Severity**: HIGH - Production use will reveal keyword quality issues

---

### 2. **Lack of Input Validation and Error Handling**

**Issue**: Commands specify workflows but no error handling for common failures:
- WebSearch fails (network/API down)
- WebFetch returns no content (404, blocked)
- Circular reference between researcher and analyst (both needed for brief)
- Invalid keywords (ambiguous, non-English, etc.)

**Problem**:
- Workflows will break silently with no recovery
- Orchestrator has no fallback strategy
- User experience degrades badly on first failure

**Recommendation**:
- Add error-recovery section to each command
- Define retry logic for WebSearch/WebFetch
- Add validation gates: "If analyst fails, offer manual SERP input"
- Implement graceful degradation: "If WebFetch fails, use WebSearch + snippet"

**Severity**: HIGH - Critical for production reliability

---

### 3. **Circular Dependency: /seo-brief Requires Both Analyst AND Researcher**

**Issue**: Command 4.3 requires:
- seo-analyst to provide SERP insights
- seo-researcher to provide keywords
- But researcher task (4.3, Phase 2) calls BOTH in parallel

**Problem**:
- Orchestration overhead: 2 agents for single brief
- Phase 2 step says "Task → seo-analyst: SERP analysis" AND "Task → seo-researcher: Related keywords"
- But researcher agent USES analyst findings (circular)
- No clear input/output specification for handoff

**Recommendation**:
- Sequence explicitly: Analyst first → Researcher second → Compile brief
- OR separate responsibilities: Analyst for intent only, skip in brief workflow
- Update Phase 2 to be sequential (Phase 2a → 2b), not parallel

**Severity**: HIGH - Affects 2 of 4 commands (/seo-research and /seo-brief)

---

### 4. **Researcher Agent Underpowered for Haiku**

**Issue**: Agent 3.2 responsibilities (even at Sonnet level) are heavy:
- Phase 1: Keyword expansion (50-100 terms)
- Phase 2: Intent classification for ALL terms
- Phase 3: Semantic clustering with 5-15 clusters
- Phase 4: Funnel mapping per keyword
- Phase 5: Gap analysis vs existing content
- Phase 6: Report compilation

**Problem**:
- This is 6 full analysis phases
- Haiku context window may struggle with 50+ keywords + classification data
- No mention of chunking or batch processing
- Single agent doing work of multiple agents

**Recommendation**:
- Break researcher into Sub-phases with explicit outputs
- Consider splitting: Phase 1-2 (expansion) vs Phase 3-5 (clustering/mapping)
- OR increase model to Sonnet for full scope
- Add explicit token budget guidance: "Expect 4-6k tokens output"

**Severity**: HIGH - Feasibility concern for Haiku

---

## Medium Priority Issues (Should Fix Before Implementation)

### 1. **Chrome DevTools MCP Marked Optional But Recommended**

**Issue**: Section 6.2 and command 4.4 mention Chrome DevTools MCP for Core Web Vitals, but:
- Marked as "optional"
- No fallback if MCP unavailable
- Audit command still runs without it (incomplete results)

**Recommendation**:
- Add MCP availability check at session start
- If available: Include Core Web Vitals in audit
- If unavailable: Skip that section, note in report
- Document minimum audit score without MCP (e.g., "78/100 without CWV data")

**Severity**: MEDIUM - Affects audit completeness, not blocking

---

### 2. **Multi-Model Validation Mentioned But Not Designed**

**Issue**:
- Skill list includes "Claudish (multi-model)" in diagram
- No pattern described for multi-model code review
- Section 6.1 lists as optional but not documented

**Recommendation**:
- Either remove from design (not MVP feature)
- OR add Pattern 7: "How to use Claudish for multi-expert validation" (optional future)
- Document: When to use (e.g., critical content), cost estimate, UX flow

**Severity**: MEDIUM - Doesn't block MVP, but avoid confusion

---

### 3. **Approval Criteria for Research Vague**

**Issue**: Section 7.2 defines approval for content (PASS/CONDITIONAL/FAIL) but research approval is vague:
- "Minimum 50 keywords expanded" (arbitrary number?)
- "Intent classified for all keywords" (no quality bar)
- No rejection criteria
- No E-E-A-T assessment for research itself

**Recommendation**:
- Define what "good" keyword expansion looks like
- Add quality gates: "Every cluster must have 3+ keywords"
- Define intent confidence threshold: "Intent confidence >70%"
- Add semantic diversity check: "No cluster >70% same intent"

**Severity**: MEDIUM - Affects research quality consistency

---

### 4. **Workflow Handoff Files Not Standardized**

**Issue**: Each agent writes to custom paths:
- analyst: `${SESSION_PATH}/serp-analysis-{keyword}.md`
- researcher: `${SESSION_PATH}/keyword-research-{seed}.md`
- writer: `${SESSION_PATH}/content-draft-{keyword}.md`
- editor: `${SESSION_PATH}/editorial-review-{content_id}.md`

**Problem**:
- No standard naming convention
- Orchestrators must know exact filenames
- Difficult to compose multi-command workflows
- No metadata files (session manifest)

**Recommendation**:
- Add session manifest: `${SESSION_PATH}/manifest.json`
- Include: session_id, phase, artifacts, metadata
- Standardize paths: `${SESSION_PATH}/{phase}-{artifact-id}.md`
- Update orchestrator to read manifest, not hard-code paths

**Severity**: MEDIUM - Impacts workflow composability

---

### 5. **Editor Agent Should Flag Insufficient Content Depth**

**Issue**: E-E-A-T section includes "Expertise" dimension but:
- No word count guidance in brief
- No requirement for cited sources
- Article could be 500 words of generic advice

**Problem**:
- Google's E-E-A-T guidance emphasizes depth
- Thin content will not rank despite perfect SEO
- Editor's E-E-A-T scorecard allows 5-6/10 (mediocre) as acceptable

**Recommendation**:
- Add to writer brief: Minimum word count by intent (informational 2000+, commercial 1500+)
- Editor should flag if Expertise score <7/10
- Add "Content Depth" as quality dimension: sources cited, examples provided, etc.

**Severity**: MEDIUM - Content quality, not architecture

---

## Strengths of the Design

### 1. **Excellent Separation of Concerns**

The four-agent pipeline cleanly separates:
- **Analysis** (Analyst): Understanding the SERP landscape
- **Research** (Researcher): Expanding keyword opportunities
- **Creation** (Writer): Converting brief to content
- **Validation** (Editor): Final quality gate

This is a proven pattern and aligns with content marketing best practices.

### 2. **Comprehensive Skill Coverage**

Seven focused skills cover the SEO domain well:
- keyword-cluster-builder (semantic grouping)
- content-optimizer (on-page SEO)
- content-brief (templating)
- technical-audit (crawlability)
- serp-analysis (intent + features)
- schema-markup (structured data)
- link-strategy (internal/external)

No major SEO capability is missing. Skills are appropriately scoped.

### 3. **Quality Gates Are Well-Defined**

Editor agent has clear approval criteria:
- PASS: 0 critical, 0-2 high issues
- CONDITIONAL: 0 critical, 3-5 high issues
- FAIL: 1+ critical or 6+ high issues

This prevents low-quality content from being marked ready. Well-designed.

### 4. **Tool Integration Strategy Is Sound**

- WebSearch for SERP analysis (essential)
- WebFetch for competitive content (essential)
- Chrome DevTools MCP optional but useful
- Claudish future-ready for multi-model validation

No missing tools. Integration is practical and vendor-neutral.

### 5. **Documentation and Examples Are Thorough**

Each agent includes:
- Complete XML specification
- Example workflows (not just abstracts)
- Concrete completion templates
- Knowledge sections with reference tables

This is publication-ready documentation. Implementation team has clear guidance.

### 6. **Dependency on Orchestration Is Appropriate**

Plugin correctly identifies dependency:
- Uses multi-agent-coordination skill (essential)
- Uses quality-gates skill (for approval flow)
- Uses todowrite-orchestration skill (for progress tracking)

Reuses proven patterns rather than reinventing.

---

## Minor Suggestions (Can Address Post-MVP)

1. **Add Cost Tracking** - Document estimated costs for each workflow (research, brief, full content creation)
2. **Add Analytics Integration** - Future: track which keywords actually drive traffic post-publication
3. **Add Competitive Benchmarking** - Suggest: run audit on top 3 competitors for comparison
4. **Add Content Calendar** - /seo-calendar command: map keywords to publication dates
5. **Add External Link Library** - Persistent list of authoritative sources per topic

---

## Implementation Readiness Assessment

### What's Ready Now ✅
- Agent specifications: Complete and implementable
- Command workflows: Clear orchestration patterns
- Skill definitions: Sufficient detail for implementation
- Quality gates: Well-defined approval criteria
- Tool integrations: Practical and documented

### What Needs Refinement Before Code 🟡
- Model selection (Haiku → Sonnet for researcher)
- Error handling and recovery patterns
- Workflow sequencing (circular dependency fix)
- Input validation and constraints
- Session artifact standardization

### Estimated Implementation Effort
- Estimated lines of code: 3,500-4,500 (4 agents + 4 commands + skill documentation)
- Estimated development time: 3-4 weeks (assuming experienced developer)
- Estimated testing cycles: 2-3 cycles (keyword quality validation, content quality validation)
- Risk level: **MEDIUM** (Haiku performance concern, error handling gaps)

---

## Recommended Next Steps

### Before Implementation
1. **Resolve Haiku vs Sonnet** - Test keyword expansion quality with Haiku on 10 seed keywords
2. **Design Error Recovery** - Add explicit failure scenarios to each command
3. **Fix Workflow Sequencing** - Clarify analyst→researcher dependency
4. **Add Session Manifest** - Standardize artifact handoff

### During Implementation
1. **Implement in Order**: Editor (easiest, pure validation) → Writer (creation) → Researcher (expansion) → Analyst (SERP)
2. **Test Each Agent Independently** Before integration
3. **Add Integration Tests** For each command workflow
4. **Performance Test** Researcher on 50-100 keywords

### Post-MVP
1. **Collect Usage Data** - Which commands get used most?
2. **Monitor E-E-A-T Scores** - Are published articles achieving 7+/10?
3. **Track Keyword Rankings** - Do generated keywords actually rank?
4. **Optimize Model Selection** - Validate Sonnet vs Haiku choice with real data

---

## Final Recommendation

**CONDITIONAL PASS - Approved for Implementation with Conditions**

### Conditions:
1. ✋ **Change Researcher to Sonnet** before implementation (from Haiku)
2. ✋ **Add error-recovery section** to each command
3. ✋ **Fix orchestrator handoff** in /seo-research and /seo-brief (sequential not parallel)
4. ✋ **Add session manifest** for artifact tracking

### Authority:
Design team may begin implementation once these 4 conditions are addressed. No architectural redesign needed—these are refinements within existing structure.

### Risk Assessment:
- **Without fixes**: MEDIUM risk of production issues (Haiku fails, workflows break on errors)
- **With fixes**: LOW risk, design is sound

---

## Questions for Design Author

1. **Haiku Performance**: Have you tested keyword expansion with Haiku? What's the quality baseline?
2. **Researcher Load**: Can you split researcher into two smaller agents (expansion vs clustering)?
3. **Session Isolation**: How should concurrent research sessions share keyword data (if at all)?
4. **SERP Freshness**: How often should SERP analysis be refreshed? Cache strategy?
5. **Cannibalization**: Any detection for keywords targeting same search intent across content?

---

## Conclusion

This is a well-structured, implementable SEO plugin design with clear value for content teams. The four-agent pipeline is elegant, the skills are comprehensive, and the documentation is thorough.

With the four high-priority issues addressed, this design is ready for a capable development team to execute. The plugin will provide real value for SEO-focused content creation workflows.

**Estimated time to full feature parity with commercial SEO tools**: 2-3 quarters post-MVP (depending on feature prioritization)

---

**Review Complete**
Generated via Mistral Small Creative analysis
Ready for implementation planning
