# SEO Plugin

**Version:** 1.0.0
**Category:** Content
**License:** MIT

Comprehensive SEO toolkit with keyword research, content optimization, technical audits, and multi-agent content workflows.

## Features

- **SERP Analysis** - Search engine results page analysis with intent classification
- **Keyword Research** - Semantic clustering and content gap analysis
- **Content Optimization** - On-page SEO improvements with readability scoring
- **Content Brief Generation** - Structured briefs for SEO-optimized content
- **Technical SEO Audits** - Schema markup, internal linking, and technical health checks
- **E-E-A-T Validation** - Experience, Expertise, Authoritativeness, Trustworthiness scoring
- **Multi-Agent Workflows** - Coordinated execution across 4 specialized agents

## Architecture

```
+-------------------------------------------------------------+
|                      SEO PLUGIN (v1.0.0)                    |
+-------------------------------------------------------------+
|                                                             |
|  COMMANDS (4)                    AGENTS (4)                 |
|  +-- /seo-research              +-- seo-analyst (Sonnet)    |
|  +-- /seo-optimize              +-- seo-researcher (Sonnet) |
|  +-- /seo-brief                 +-- seo-writer (Sonnet)     |
|  +-- /seo-audit                 +-- seo-editor (Opus)       |
|                                                             |
|  SKILLS (7)                      TOOL INTEGRATIONS          |
|  +-- keyword-cluster-builder     +-- WebFetch               |
|  +-- content-optimizer           +-- WebSearch              |
|  +-- content-brief               +-- Chrome DevTools MCP    |
|  +-- technical-audit             +-- Claudish (multi-model) |
|  +-- serp-analysis                                          |
|  +-- schema-markup               DEPENDENCIES               |
|  +-- link-strategy               +-- orchestration plugin   |
|                                                             |
+-------------------------------------------------------------+
```

## Agents

### SEO Analyst (Sonnet, Purple)
SERP analysis, search intent extraction, and competitive intelligence.

**Use cases:**
- Analyze SERP for target keywords
- Classify search intent (informational, commercial, transactional, navigational)
- Competitive content analysis
- Featured snippet opportunity identification

### SEO Researcher (Sonnet, Blue)
Keyword research, content gap analysis, and data gathering.

**Use cases:**
- Expand seed keywords to 50-100 related terms
- Semantic clustering by topic and intent
- Funnel stage mapping (awareness, consideration, decision)
- Content gap identification

### SEO Writer (Sonnet, Green)
SEO-optimized content generation from structured briefs.

**Use cases:**
- Generate content from briefs
- Optimize meta tags (title, description)
- Integrate keywords naturally
- Add internal/external links
- Optimize for featured snippets

### SEO Editor (Opus, Cyan)
Quality review, SEO compliance, and E-E-A-T validation.

**Use cases:**
- Review content for SEO compliance
- Validate E-E-A-T signals
- Check keyword optimization
- Verify readability scores
- Validate schema markup

## Commands

### `/seo-research <keyword>`
Comprehensive keyword research workflow with multi-agent orchestration.

**Workflow:** SESSION INIT → ANALYST → RESEARCHER → REPORT

**Deliverables:**
- SERP analysis with intent classification
- 50-100 keyword cluster
- Funnel stage mapping
- Content gap analysis
- Priority recommendations

### `/seo-optimize <file>`
Optimize existing content for target keywords.

**Workflow:** SESSION INIT → ANALYZE → RECOMMEND → APPLY → VERIFY

**Improvements:**
- Keyword density optimization
- Meta tag refinement
- Heading structure
- Readability improvements
- Internal linking suggestions

**Optional:** Multi-model validation for critical content

### `/seo-brief <keyword>`
Generate comprehensive content brief for target keyword.

**Workflow:** SESSION INIT → ANALYST → RESEARCHER → WRITER → BRIEF

**Deliverables:**
- Target keyword and secondaries
- Search intent classification
- Competitor analysis
- Outline with keyword mapping
- Word count target
- E-E-A-T requirements

### `/seo-audit <url>`
Technical SEO audit with Chrome DevTools MCP integration.

**Workflow:** SESSION INIT → FETCH → ANALYZE → REPORT

**Checks:**
- Schema markup validation
- Internal link analysis
- Meta tag compliance
- Readability scoring
- Mobile-friendliness
- Page speed indicators

## Skills

### keyword-cluster-builder
Semantic keyword clustering and topic modeling patterns.

### content-optimizer
On-page SEO optimization techniques and readability formulas.

### content-brief
Structured content brief generation with competitive analysis.

### technical-audit
Technical SEO checklist and validation patterns.

### serp-analysis
SERP feature identification and intent classification.

### schema-markup
Schema.org implementation and validation patterns.

### link-strategy
Internal linking strategy and anchor text optimization.

## Multi-Agent Workflow

```
Sequential Pipeline with Quality Gates:

+------------------+     +------------------+     +------------------+     +------------------+
|   SEO ANALYST    |---->|   RESEARCHER     |---->|   SEO WRITER     |---->|   SEO EDITOR     |
|     (Sonnet)     |     |     (Sonnet)     |     |     (Sonnet)     |     |     (Opus)       |
+------------------+     +------------------+     +------------------+     +------------------+
        |                        |                        |                        |
        v                        v                        v                        v
   SERP Analysis            Keyword Cluster           Content Draft           Final Review
   Intent Mapping           Content Gaps              Optimized Copy          E-E-A-T Check
   Competitor Intel         Supporting Data           Internal Links          SEO Compliance
        |                        |                        |                        |
        v                        v                        v                        v
   [USER GATE]              [AUTO GATE]              [USER GATE]           [FINAL APPROVE]
```

## Installation

### Option 1: From Marketplace

```bash
/plugin marketplace add MadAppGang/claude-code
/plugin install seo@mag-claude-plugins
```

### Option 2: Per-Project (Recommended for Teams)

Add to `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "seo@mag-claude-plugins": true
  }
}
```

Commit this file and team members get automatic setup.

## Dependencies

This plugin requires the orchestration plugin for multi-agent coordination patterns:

```json
{
  "dependencies": {
    "orchestration@mag-claude-plugins": "^0.5.0"
  }
}
```

The orchestration plugin installs automatically when you install the SEO plugin.

## Session-Based Workflows

All commands use session-based artifact management:

```
Session Path: /tmp/seo-{timestamp}-{keyword-slug}/

Artifacts:
- serp-analysis-{keyword}.md
- keyword-research.md
- content-brief.md
- content-draft.md
- editorial-review.md
- final-report.md
```

**Session Retention:** 7 days (copy important artifacts to `ai-docs/` for permanence)

## Tool Integrations

- **WebSearch** - SERP data retrieval
- **WebFetch** - Competitor page analysis
- **Chrome DevTools MCP** - Technical SEO validation (optional)
- **Claudish** - Multi-model validation (optional)

## Example Usage

### Keyword Research
```
/seo-research "content marketing"
```

**Result:** 75 keywords across 8 clusters with priority recommendations

### Content Optimization
```
/seo-optimize docs/blog/content-marketing-guide.md
```

**Result:** Optimized content with improved keyword density, meta tags, and readability

### Content Brief
```
/seo-brief "best project management software"
```

**Result:** Comprehensive brief with outline, keyword mapping, and competitor insights

### Technical Audit
```
/seo-audit https://example.com/blog/post
```

**Result:** Technical SEO report with schema, internal links, and compliance checks

## E-E-A-T Scoring

The seo-editor agent uses a quantified E-E-A-T rubric (0-100 scale):

| Factor | Weight | Score Range | Signals |
|--------|--------|-------------|---------|
| Experience | 30% | 0-30 | First-hand examples, case studies, original research |
| Expertise | 30% | 0-30 | Depth of coverage, technical accuracy, sources cited |
| Authoritativeness | 20% | 0-20 | Author credentials, backlinks, brand mentions |
| Trustworthiness | 20% | 0-20 | Fact-checking, transparency, contact info, HTTPS |

**Scoring:**
- 90-100: Excellent (publish-ready)
- 75-89: Good (minor improvements)
- 60-74: Fair (needs work)
- <60: Poor (major revisions required)

## Best Practices

1. **Start with Research** - Always run `/seo-research` before content creation
2. **Follow the Pipeline** - ANALYST → RESEARCHER → WRITER → EDITOR
3. **Use Session Artifacts** - Review intermediate outputs for quality
4. **Copy Final Reports** - Move session artifacts to permanent storage
5. **Validate E-E-A-T** - Let seo-editor review before publishing
6. **Test Technical SEO** - Run `/seo-audit` before going live

## Troubleshooting

### WebSearch/WebFetch Failures
- Retry with simplified queries
- Fall back to pattern-based keyword expansion
- Note data limitations in reports

### Session Cleanup
- Sessions older than 7 days may be deleted
- Copy important artifacts to `ai-docs/` directory
- Use session metadata to track artifacts

### Chrome DevTools MCP
- Required for `/seo-audit` command
- Falls back to WebFetch if MCP unavailable
- See orchestration plugin for MCP setup

## Contributing

Issues and feature requests: https://github.com/MadAppGang/claude-code/issues

## License

MIT License - see LICENSE file for details

## Author

Jack Rudenko (i@madappgang.com) @ MadAppGang
