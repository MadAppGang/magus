# Review: SEO Plugin Design Plan (ai-docs/agent-design-seo-plugin.md)

Overall assessment: **CONDITIONAL**

`★ Insight ─────────────────────────────────────`
- The plan’s *four-agent pipeline* is coherent, but the *commands* currently assume more “orchestrator logic” than is actually specified in an implementation-ready way (session path, artifact contracts, and handoff formats need tightening).
- Tooling choices in agent frontmatter (Glob/Grep/Bash) conflict with this repository’s **code-analysis enforcement posture** (claudemem-first) and will create friction / hook warnings in real use.
- Several SEO “best practice” numbers are over-specified (density/readability targets) and should be positioned as heuristics, with explicit exceptions and verification steps.
`─────────────────────────────────────────────────`

## 1) Architecture Quality (Analyst → Researcher → Writer → Editor)

**Strengths**
- Clear separation of concerns:
  - Analyst: SERP + intent + competitors
  - Researcher: expansion + clustering + funnel mapping
  - Writer: content generation from brief
  - Editor: final gate with severity rubric
- Pipeline includes **user gates** in the right places (after SERP analysis and after research summary).

**Issues**
- The design mixes two “modes” without clarifying boundaries:
  1) **Content creation** pipeline (research → brief → write → edit)
  2) **Content optimization** pipeline (/seo-optimize)

  These share agents but need explicit artifact contracts (what exact outputs feed into subsequent tasks).

- Commands are specified mostly as narrative workflows. For implementation, you’ll need consistent, machine-readable “handoff” structure (JSON or strict Markdown section headings) so downstream agents can rely on fields rather than free-form text.

## 2) Component Completeness (agents/skills/commands)

**PASS for coverage**, **CONDITIONAL for precision**.

### Agents
- All four agents are specified with YAML + XML sections and role/workflow guidance.
- However, the agent tool lists include **Glob and Grep** and sometimes **Bash**, which may not be desirable for the typical SEO workflows and may conflict with repository hooks.

**Blocking-adjacent gap**: No explicit “artifact schema” per agent.
- e.g., seo-analyst writes `${SESSION_PATH}/serp-analysis-{keyword}.md`, but:
  - Where does `SESSION_PATH` come from (env var? orchestrator variable? shared convention)?
  - How are spaces/special chars in `{keyword}` slugged?

### Commands
- Four commands are defined: /seo-research, /seo-optimize, /seo-brief, /seo-audit.
- The orchestrator responsibilities are clear, but implementation requires:
  - session directory creation rules
  - file naming conventions
  - how to pass the session path into agents (prompt prefix? environment variables?).

**Important**: /seo-audit is positioned as technical audit but is currently mostly “content/page HTML inspection”. Real technical SEO auditing (robots, sitemaps, canonicalization, headers, renderability, JS hydration, structured data validation) requires deeper tool integration or explicit scope limitation.

### Skills
- Seven skills are listed; the document includes substantial content for:
  - keyword-cluster-builder
  - content-optimizer
  - schema-markup
  - link-strategy

But for:
- content-brief
- technical-audit
- serp-analysis

…the plan says “content similar to … shown above”. That’s **not implementation-ready** for a plugin repo where skills are first-class assets. (You can still implement by duplicating, but the design doc should be explicit.)

## 3) Model Selection

**Overall: PASS with minor caveats.**

- **Analyst = Sonnet**: reasonable for nuanced SERP interpretation and competitive reasoning.
- **Researcher = Haiku**: reasonable for high-volume structured keyword expansion.
- **Writer = Sonnet**: reasonable; needs stronger guardrails against hallucinated claims and citations.
- **Editor = Opus**: justified for judgment-heavy E-E-A-T review and severity classification.

Caveat: If the writer is expected to “cite authoritative sources” and the system relies on WebFetch/WebSearch evidence, the writer needs either:
- explicit access to WebFetch/WebSearch, or
- an upstream “evidence pack” artifact produced by analyst/researcher.

Right now, seo-writer tools list: `TodoWrite, Read, Write, Glob, Grep` (no WebFetch/WebSearch). That makes “cite sources” hard to do faithfully.

## 4) Workflow Design (quality gates + handoffs)

**CONDITIONAL**

**What’s good**
- Quality gate rubric in seo-editor is explicit (PASS/CONDITIONAL/FAIL).
- /seo-research includes a user review phase and iteration path.

**Critical missing detail (blocking for implementation quality)**
- No defined **handoff contract** between phases.

Examples:
- Analyst output should include structured fields the researcher can reuse (intent, SERP features, PAA list, competitor outlines, recommended content format).
- Researcher output should include the cluster list in a parseable table and the “top 10–20 targets” with rationale.
- Brief should reference exact cluster IDs / keywords and define required headings/questions.

**Suggested fix**: Standardize each artifact with a “frontmatter” block:
- YAML frontmatter at the top of each report file (`keyword`, `intent`, `seed_keywords`, `timestamp`, `sources[]`).

## 5) SEO Best Practices Coverage

**Mostly PASS**, but with a few “best practice realism” issues.

### Covered well
- Intent classification
- SERP feature identification (featured snippet / PAA)
- Competitor page structure analysis
- On-page fundamentals (titles/descriptions/headings)
- Internal linking and basic structured data patterns
- E-E-A-T framing and review rubric

### High-priority corrections
1) **Keyword density 1–2%** is an oversimplification.
   - It’s a heuristic, not a requirement. For many queries/pages, optimal copy is better expressed via topical coverage and entity/semantic relevance.
   - If you keep a density target, document it as “guideline” + include an explicit “exceptions” section.

2) **Flesch 60–70** as a universal target is not always correct.
   - B2B, legal, medical, and technical topics often require lower readability scores.
   - Better: “optimize readability for the target audience” with thresholds by audience type.

3) Technical audit scope is currently incomplete.
   - No mention of: robots directives, canonical duplicates, hreflang, sitemap checks, redirects, status codes, JS renderability, indexing checks.
   - If the plugin’s audit is *page-level* only, explicitly rename/position it as “On-page audit” and call out limitations.

## 6) Integration Points (WebSearch/WebFetch/Chrome DevTools MCP/Claudish)

**CONDITIONAL**

- WebSearch/WebFetch integration is planned and appropriate.
- Chrome DevTools MCP integration is noted for CWV.
- Claudish “multi-model validation” is mentioned, but no actual command/agent spec uses orchestration’s multi-model-validation or model-tracking-protocol skills.

### Blocking concern: tool + hook compatibility
This repository’s ecosystem emphasizes claudemem-first investigation, and hooks intercept Grep/Glob patterns and sequential reads.

Yet agent frontmatter includes `Grep` and `Glob` broadly across agents.

If this plugin is intended for this repo’s marketplace, that’s likely to:
- trigger hook warnings
- encourage non-standard usage patterns
- complicate maintenance and user experience

## Critical issues (blocking implementation)

1) **Undefined session artifact contract**
   - `SESSION_PATH` is referenced but not defined as an actual mechanism.
   - File naming/slugging rules aren’t specified.

2) **Skills are not fully specified**
   - Three skills are placeholders (“content similar to…”). For a plugin design doc, skills should be fully written or explicitly scoped as “copy from command section verbatim”.

3) **/seo-audit scope mismatch**
   - Labeled “technical SEO audit” but mostly describes on-page checks + optional CWV.
   - Either expand scope/tools or rename scope to avoid misleading users.

## High priority issues (should fix before implementation)

1) **seo-writer lacks evidence tooling but requires citations**
   - Either allow WebSearch/WebFetch for writer, or add an “evidence pack” artifact created upstream.

2) **Over-specified numeric heuristics**
   - Density + readability thresholds should be guidelines with audience-specific exceptions.

3) **Tool lists include Grep/Glob/Bash without clear need**
   - Consider minimizing tools to what’s essential for each role and aligning with the repo’s preferred investigation patterns.

4) **Claudish integration is aspirational only**
   - If multi-model validation is a selling point, specify at least one command (/seo-optimize or /seo-audit) that can optionally run multi-model review via orchestration skill patterns.

## Medium priority suggestions (nice to have)

1) Add a dedicated “SEO scoring rubric” artifact for audits (weights per category) rather than a single “0-100” number.
2) Add optional “schema suggestions” based on content type (FAQ/HowTo/Product/Article) with guardrails to avoid invalid markup.
3) Add “cannibalization check” workflow (the editor mentions it, but commands don’t expose it).
4) Add explicit guidance for non-English locales (hreflang, locale SERPs) or explicitly state “English-only”.

## Strengths of the design

- Strong, understandable four-agent mental model.
- Good separation of responsibilities and output expectations.
- Practical command set matching common SEO workflows.
- Clear severity + approval rubric for the editor role.
- Includes key SEO domains: SERP analysis, content briefs, on-page optimization, internal linking, schema basics.
