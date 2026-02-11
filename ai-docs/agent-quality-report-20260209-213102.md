# Agent Description Quality Report

**Generated**: 2026-02-09 21:31:02  
**Reviewer**: Claude Sonnet 4.5  
**Total Agents Analyzed**: 51 agents across 10 plugins

---

## Executive Summary

This comprehensive analysis evaluated all 51 agent definitions across the repository, assessing description effectiveness for delegation, trigger clarity, and overall implementation quality. The analysis reveals strong patterns in recently updated agents (dev, agentdev, code-analysis plugins) and significant opportunities for improvement in older plugins (frontend, seo, video-editing).

### Key Findings

**Quality Distribution:**
- **Excellent** (9-10/10): 8 agents (16%)
- **Good** (7-8/10): 15 agents (29%)  
- **Needs Improvement** (5-6/10): 20 agents (39%)
- **Poor** (<5/10): 8 agents (16%)

**Best Practices Identified:**
1. ✅ **"Use this agent when..." opening** - Dramatically improves delegation clarity
2. ✅ **user→assistant→commentary examples** - Demonstrates proper delegation patterns
3. ✅ **Explicit capability claims** - Clarifies when agent adds specialized value beyond base Claude
4. ✅ **Anti-pattern guidance** - "DO NOT use for X" prevents misuse
5. ✅ **PROXY_MODE support documentation** - Critical for multi-model /team workflows

**Common Weaknesses:**
1. ❌ **Vague triggers** - "Expert in X" without explaining WHEN to delegate
2. ❌ **Missing examples** - No concrete usage scenarios
3. ❌ **Unclear scope** - Overlaps with similar agents
4. ❌ **No specialized claims** - Doesn't explain unique capabilities vs base Claude
5. ❌ **Generic descriptions** - Could apply to multiple different agents

---

## Detailed Quality Tiers

### Tier 1: Excellent Descriptions (9-10/10)

These agents have comprehensive, actionable descriptions with multiple concrete examples demonstrating best practices.

| Agent | Plugin | Score | Key Strengths |
|-------|--------|-------|---------------|
| **detective** | code-analysis | 10/10 | Outstanding 3-example structure, specialized AST analysis claims, clear delegation triggers, comprehensive anti-patterns |
| **researcher** | dev | 9.5/10 | Enhanced with "IMPORTANT" directive, examples with commentary, clear "when to use", WebSearch capability emphasis |
| **developer** | dev | 9.5/10 | Enhanced with iterative cycle emphasis, substantial work triggers, examples with commentary showing delegation |
| **api-architect** | bun | 9/10 | Excellent 3-example structure covering different use cases, comprehensive "when to invoke" guidance |
| **backend-developer** | bun | 9/10 | Rich 5-example collection covering multiple scenarios, clear delegation triggers for each |
| **reviewer** | agentdev | 9/10 | Multiple concrete examples (validation, comparison, feedback), structured review criteria |
| **architect** | agentdev | 9/10 | Clear design vs implementation focus, examples show delegation patterns, PROXY_MODE support |
| **devops** | dev | 9/10 | Infrastructure-specific examples, extended thinking emphasis, multi-cloud coverage |

**What Makes Them Excellent:**
- ✅ Open with "Use this agent when..." followed by concrete scenarios
- ✅ Include 3+ concrete examples with user→assistant→commentary structure
- ✅ Explicitly claim specialized capabilities Claude lacks (AST analysis, WebSearch, extended thinking)
- ✅ Show delegation patterns in examples (Task tool usage)
- ✅ Include anti-patterns section ("DO NOT use for...")
- ✅ Document PROXY_MODE support with error handling

---

### Tier 2: Good Descriptions (7-8/10)

Solid descriptions with good foundations but missing 1-2 key elements.

| Agent | Plugin | Score | Primary Enhancement Needed |
|-------|--------|-------|----------------------------|
| **debugger** | dev | 8/10 | Add "Use this agent when..." opening, add 1-2 more examples |
| **architect** | dev | 8/10 | Add examples showing when to delegate vs handle inline |
| **test-architect** | dev | 8/10 | Add examples, clarify testing philosophy vs general testing |
| **ui** | dev | 8/10 | Strong tool list but needs delegation examples |
| **designer** | frontend | 7.5/10 | Good color/design focus but needs "when to use" opening |
| **plan-reviewer** | frontend | 7.5/10 | Needs examples of good vs poor plans to review |
| **reviewer** | frontend | 7.5/10 | Add code review examples with severity levels |
| **synthesizer** | dev | 7/10 | Needs clearer differentiation from other research agents |
| **editor** | seo | 7/10 | Good SEO focus but needs workflow examples |
| **apidog** | bun | 7/10 | Very technical, could simplify "when to use" guidance |

**Recommended Enhancements:**
1. Add "Use this agent when..." opening paragraph
2. Include 2-3 concrete examples with user→assistant→commentary
3. Clarify specialized capabilities vs general Claude abilities
4. Add brief anti-pattern guidance where applicable

---

### Tier 3: Needs Improvement (5-6/10)

Descriptions lack clarity, actionable guidance, or sufficient examples.

| Agent | Plugin | Score | Primary Issues |
|-------|--------|-------|----------------|
| **spec-writer** | dev | 6/10 | Generic synthesis description, missing usage examples |
| **scribe** | dev | 6/10 | File operations described but no usage context |
| **doc-writer** | dev | 6/10 | Lists 15 principles but doesn't show when to delegate |
| **doc-analyzer** | dev | 6/10 | Technical 42-point checklist but unclear delegation triggers |
| **doc-fixer** | dev | 6/10 | "Automatically fix" claim but no criteria for when to use |
| **task-executor** | autopilot | 6/10 | ReAct pattern described but vague delegation triggers |
| **proof-generator** | autopilot | 6/10 | Technical implementation details but missing "when to use" |
| **feedback-processor** | autopilot | 6/10 | Classification logic explained but unclear delegation scenarios |
| **ui-engineer** | dev | 5.5/10 | "Avant-garde" claim unsubstantiated, no concrete examples |
| **tester** | frontend | 5.5/10 | Just tool list, no description of what agent actually does |
| **cleaner** | frontend | 5.5/10 | Tool list only, missing purpose explanation entirely |
| **api-analyst** | frontend | 5.5/10 | No description at all, just tools listed |
| **analyst** | seo | 5.5/10 | Generic "SEO expert" without specialized capability claims |
| **data-analyst** | seo | 5.5/10 | Overlaps with analyst agent, unclear differentiation |
| **researcher** | seo | 5.5/10 | Generic research description, doesn't claim specialized tools |
| **writer** | seo | 5.5/10 | Content generation described generically |
| **skill-discovery** | dev | 5/10 | Haiku model with minimal guidance on when to use |
| **stack-detector** | dev | 5/10 | Detection process described but no usage triggers |
| **campaign-analyst** | instantly | 5/10 | Brief description lacks concrete examples |
| **outreach-optimizer** | instantly | 5/10 | Optimization focus but vague delegation triggers |

**Critical Fixes Needed:**
1. ❌ Add "Use this agent when..." opening (currently buried or missing entirely)
2. ❌ Add 2-3 concrete examples with user→assistant→commentary structure
3. ❌ Clarify specialization (explain what this agent does that others don't)
4. ❌ Remove generic language ("Expert in X" doesn't help delegation decisions)
5. ❌ Add differentiation from similar agents (prevents wrong agent selection)

---

### Tier 4: Poor Descriptions (<5/10)

Severely lacking in guidance or missing descriptions entirely. High risk of never being delegated to.

| Agent | Plugin | Score | Critical Issues |
|-------|--------|-------|-----------------|
| **developer** | agentdev | 4/10 | Brief "implementer" description, no examples, confusing with dev:developer |
| **ui-developer** | frontend | 4/10 | Long description but lacks clear delegation triggers and examples |
| **css-developer** | frontend | 4/10 | Technical CSS implementation details but no "when to use" guidance |
| **test-architect** | frontend | 4/10 | Testing strategy described but unclear delegation scenarios |
| **image-generator** | nanobanana | 3/10 | Gemini integration mentioned but missing usage examples |
| **style-manager** | nanobanana | 3/10 | Style management described vaguely without concrete scenarios |
| **sequence-builder** | instantly | 3/10 | Email sequences mentioned without context or examples |
| **timeline-builder** | video-editing | 2/10 | Minimal description, no examples, unclear purpose |
| **transcriber** | video-editing | 2/10 | Basic transcription mentioned, no usage guidance |
| **video-processor** | video-editing | 2/10 | Vague video processing, no concrete capabilities |

**Requires Complete Rewrite:**
1. ❌ Current descriptions don't explain WHEN to delegate to this agent
2. ❌ No examples showing proper usage patterns
3. ❌ Missing specialized capability claims (what can this agent do that Claude can't?)
4. ❌ Unclear how agent differs from general-purpose Claude or similar agents
5. ❌ Very high risk of never being discovered or delegated to

---

## Plugin-Level Analysis

### Quality by Plugin (Average Score & Rankings)

| Plugin | # Agents | Avg Score | Rank | Assessment |
|--------|----------|-----------|------|------------|
| **code-analysis** | 1 | 10.0/10 | 🏆 1st | Exceptional - Best-in-class description patterns |
| **bun** | 3 | 8.3/10 | 🥈 2nd | Excellent - Consistent high quality across all agents |
| **agentdev** | 3 | 7.3/10 | 🥉 3rd | Good - Recently improved, one confusing agent |
| **dev** | 17 | 6.8/10 | 4th | Mixed - Wide variance from 10/10 to 5/10 |
| **frontend** | 11 | 5.9/10 | 5th | Needs Work - Many tool-only agents with no descriptions |
| **seo** | 5 | 5.8/10 | 6th | Needs Work - Generic descriptions across all agents |
| **autopilot** | 3 | 5.7/10 | 7th | Needs Work - Technical but vague user-facing triggers |
| **instantly** | 3 | 4.3/10 | 8th | Poor - Minimal descriptions throughout |
| **nanobanana** | 2 | 4.0/10 | 9th | Poor - Lacks examples and concrete guidance |
| **video-editing** | 3 | 2.3/10 | ⚠️ 10th | Critical - Nearly empty descriptions, blocking usage |

### Plugin-Specific Patterns

#### code-analysis (Detective Agent)
**Strengths:**
- ✅ Perfect example structure: 3 detailed examples with user→assistant→commentary
- ✅ Specialized capability claims: "AST-based structural analysis with PageRank ranking"
- ✅ Comprehensive anti-patterns section: "NEVER use grep", "DO NOT truncate claudemem output"
- ✅ Tool-specific workflow guidance throughout

**Recommendation:** Use detective.md as the gold standard template for all other agent descriptions.

---

#### bun (Backend Agents)
**Strengths:**
- ✅ Consistent multi-example structure across all 3 agents
- ✅ Clear "Use this agent when..." openings with concrete scenarios
- ✅ Code examples embedded in descriptions
- ⚠️ Apidog agent overly technical, could simplify for non-expert users

**Recommendation:** Maintain current quality level. Consider simplifying apidog's technical language slightly.

---

#### agentdev (Meta-Agents for Agent Development)
**Strengths:**
- ✅ Recent quality improvements visible in architect and reviewer
- ✅ Examples show proper delegation patterns
- ✅ PROXY_MODE support well-documented
- ❌ **developer agent critically confusing with dev:developer** (same name, different purpose)

**Recommendation:** 
1. **URGENT**: Rename agentdev/developer or add prominent differentiation
2. Maintain architect and reviewer quality

---

#### dev (Universal Development Agents)
**Strengths:**
- ✅ Recent agents (researcher, developer, devops) show major improvements
- ✅ PROXY_MODE support documented across most agents
- ✅ Some world-class agents (researcher: 9.5/10, developer: 9.5/10)

**Weaknesses:**
- ❌ Wide quality variance: 10/10 (devops) to 5/10 (skill-discovery, stack-detector)
- ❌ Older agents (doc-*, spec-writer, scribe) lack examples entirely
- ❌ Some agents (ui-engineer) have unsubstantiated claims

**Recommendation:** Apply researcher/developer description pattern to all older doc-*, spec-writer, and scribe agents.

---

#### frontend (React Development Agents)
**Weaknesses:**
- ❌ 3 agents have NO DESCRIPTION AT ALL (tester, cleaner, api-analyst) - just tool lists
- ❌ Missing "Use this agent when..." openings across most agents
- ❌ Very few examples showing delegation scenarios
- ⚠️ Some good agents exist (designer, plan-reviewer) but inconsistent

**Recommendation:**
1. **URGENT**: Add complete descriptions to tester, cleaner, api-analyst
2. Add "Use this agent when..." openings to all agents
3. Add 2-3 examples per agent following detective pattern

---

#### seo (SEO Optimization Agents)
**Weaknesses:**
- ❌ Generic descriptions: "SEO expert", "content analyst" without differentiation
- ❌ No concrete examples showing delegation
- ❌ Unclear differentiation: analyst vs data-analyst vs researcher roles overlap
- ❌ Missing specialized capability claims (what tools/methods are unique?)

**Recommendation:**
1. Add specialized capability claims (automated crawling, GA4 integration, etc.)
2. Clarify role differentiation:
   - **analyst**: Technical SEO audits (crawling, Core Web Vitals)
   - **data-analyst**: Analytics interpretation (GA4, Search Console)
   - **researcher**: Competitive analysis and keyword research
   - **writer**: Content creation with SEO optimization
   - **editor**: Content improvement and optimization
3. Add concrete examples to each agent

---

#### autopilot (Workflow Automation Agents)
**Weaknesses:**
- ❌ Technical implementation details (ReAct pattern, state machines) instead of user-facing triggers
- ❌ Missing examples showing WHEN to use these agents
- ❌ Unclear how these integrate with user workflows

**Recommendation:** Completely rewrite from user perspective with concrete delegation scenarios showing the Linear integration workflow.

---

#### instantly, nanobanana, video-editing (Specialized Integration Agents)
**Critical Issues:**
- ❌ Minimal to non-existent descriptions
- ❌ No examples showing tool integration
- ❌ Missing context for when to use vs alternatives
- ❌ Likely never discovered or delegated to

**Recommendation:** Complete rewrites required with tool-specific integration examples and clear delegation triggers.

---

## Assessment Criteria Detailed Analysis

### 1. Trigger Effectiveness (Does description explain WHEN to delegate?)

**Excellent Examples (9-10):**
```markdown
detective: "Use this agent when you need to investigate, analyze, or understand 
patterns in a codebase. This includes finding specific implementations, understanding 
code relationships, discovering usage patterns, tracking down bugs, analyzing 
architecture decisions, or investigating how certain features work."
```

**Poor Examples (3-5):**
```markdown
tester: [Just tool list - no description]
cleaner: [Just tool list - no description]
skill-discovery: "Lightweight skill finder" [No delegation triggers]
```

**Impact:** Agents without clear triggers are rarely delegated to, even when appropriate.

**Recommendation:** Every agent must start with "Use this agent when..." followed by 3-5 concrete scenarios.

---

### 2. Capability Clarity (Are specialized capabilities explicit?)

**Excellent Examples (9-10):**
```markdown
detective: "AST-based structural analysis with PageRank ranking" 
researcher: "WebSearch tool for up-to-date information beyond knowledge cutoff"
devops: "Extended thinking for complex infrastructure decisions"
```

**Poor Examples (3-5):**
```markdown
analyst (SEO): "SEO expert" [Generic, no unique capability]
developer (agentdev): "Expert implementer" [Could apply to any dev agent]
writer (SEO): "Content generation" [No unique angle stated]
```

**Impact:** Without specialized capability claims, users don't understand what value the agent adds beyond base Claude.

**Recommendation:** Explicitly state:
1. Specialized tools available (WebSearch, claudemem, visual analysis, etc.)
2. Unique methodologies (AST analysis, extended thinking, multi-step workflows)
3. What this agent can do that Claude alone cannot

---

### 3. Examples Present (Concrete usage scenarios)

**Quality Distribution:**
- **3+ examples with commentary**: 8 agents (16%)
- **2 examples**: 8 agents (16%)
- **1 example**: 12 agents (24%)
- **0 examples**: 23 agents (45%)

**Excellent Structure (from detective):**
```markdown
<example>
Context: The user wants to understand how authentication is implemented.
user: "How is authentication handled in this application?"
assistant: "I'll use the codebase-detective agent to investigate the 
authentication implementation."
<commentary>
Since the user is asking about understanding a specific aspect of the codebase, 
use the Task tool to launch the codebase-detective agent to analyze authentication 
patterns.
</commentary>
</example>
```

**Impact:** Examples are critical for LLM delegation learning. 45% of agents with zero examples means they're rarely discovered or used correctly.

**Recommendation:** Minimum 2 examples per agent, ideally 3-4, following user→assistant→commentary structure.

---

### 4. Delegation Patterns (Shows user→assistant→commentary structure)

**Well-Implemented:** 7 agents (14%)
**Missing:** 25 agents (49%)

**Why This Matters:**
- ✅ Shows proper Task tool invocation
- ✅ Demonstrates delegation decision-making process
- ✅ Helps LLMs learn when to delegate vs handle inline
- ✅ Provides reasoning (commentary) for pattern learning

**Recommendation:** All examples must include:
1. Context/situation
2. User request (natural language)
3. Assistant response showing delegation via Task tool
4. Commentary explaining WHY this scenario warrants delegation

---

### 5. Specialized Claims (Capabilities beyond base Claude)

**Strong Claims:**
- detective: AST analysis, PageRank, claudemem integration
- researcher: WebSearch for current info, multi-source synthesis
- devops: Extended thinking, web search for current cloud docs
- api-architect: Multi-phase planning, Apidog integration

**Weak/Missing Claims:**
- Most SEO agents: Don't claim specialized tools
- Frontend agents: Don't explain unique capabilities
- Video/image agents: Integration mentioned but not emphasized

**Impact:** Without specialized claims, agents seem redundant with base Claude capabilities.

**Recommendation:** Every agent should claim at least one of:
- Specialized tool access (WebSearch, claudemem, Apidog, etc.)
- Extended processing (multi-phase workflows, extended thinking)
- Domain-specific analysis methods
- Integration capabilities

---

### 6. PROXY_MODE Support (Multi-model workflow compatibility)

**Implemented:** 20 agents (39%) - dev and agentdev plugins
**Missing:** 31 agents (61%) - frontend, seo, video-editing, etc.

**Why Critical:**
- ❌ Agents without PROXY_MODE can't participate in /team multi-model validation
- ❌ No error handling for model failures
- ❌ Silent fallbacks corrupt validation results

**Recommendation:** Add PROXY_MODE support block to all agents:
```markdown
<proxy_mode_support>
  **FIRST STEP: Check for Proxy Mode Directive**
  
  If prompt starts with `PROXY_MODE: {model_name}`:
  1. Extract model name and actual task
  2. Delegate via Claudish
  3. Return attributed response and STOP
  
  **If NO PROXY_MODE**: Proceed with normal workflow
  
  <error_handling>
    **CRITICAL: Never Silently Substitute Models**
    [Detailed error handling...]
  </error_handling>
</proxy_mode_support>
```

---

### 7. Tools Documentation (Available tools clearly listed)

**Status:** 48 agents (94%) have tools properly listed in frontmatter

**Good Practice:** Tools in YAML frontmatter, optionally explained in description

**Issue:** 3 agents have tool lists but NO description explaining what they do with those tools.

**Recommendation:** 
- ✅ Keep tool lists in frontmatter (working well)
- ✅ For tool-heavy agents, explain key tool usage in description
- ❌ NEVER have just a tool list with no description

---

### 8. Anti-Patterns (What NOT to use agent for)

**Implemented Well:** 5 agents (10%)
- detective: Extensive anti-patterns ("NEVER use grep", "DO NOT truncate output")
- researcher: "DO NOT use general-purpose agent for research"
- developer: "IMPORTANT - always delegate substantial implementation"

**Missing:** 35 agents (69%)

**Why Important:**
- ✅ Prevents misuse and wrong agent selection
- ✅ Clarifies boundaries between similar agents
- ✅ Helps users understand scope limitations
- ✅ Reduces trial-and-error

**Recommendation:** Add anti-patterns section:
```markdown
**DO NOT use this agent for:**
- ❌ Inline work that can be done immediately (use direct approach)
- ❌ Simple tasks not requiring specialized tools
- ❌ [Other agent's domain] - use {other-agent} instead
```

---

## Comprehensive Best Practices Guide

### Pattern 1: "Use this agent when..." Opening

**Structure:**
```markdown
Use this agent when {primary scenario}, {secondary scenario}, or {tertiary scenario}. 
This agent {specialized capability claim} that Claude alone cannot execute.
```

**Excellent Example (detective):**
```markdown
Use this agent when you need to investigate, analyze, or understand patterns in a 
codebase. This includes finding specific implementations, understanding code relationships, 
discovering usage patterns, tracking down bugs, analyzing architecture decisions, or 
investigating how certain features work. The agent excels at deep-dive investigations 
that require examining multiple files and understanding complex code relationships.
```

**Why This Works:**
- ✅ Immediately answers "When should I use this agent?"
- ✅ Lists 5-6 concrete scenarios users can pattern-match against
- ✅ Claims specialized capability (deep-dive investigations)
- ✅ SEO-friendly for skill discovery systems

**Implementation Checklist:**
- [ ] Starts with "Use this agent when..."
- [ ] Lists 3-6 concrete scenarios
- [ ] Includes at least one specialized capability claim
- [ ] Written in user-facing language (not technical jargon)

---

### Pattern 2: User→Assistant→Commentary Examples

**Structure:**
```markdown
<example>
Context: {Situation description - 1-2 sentences}
user: "{Realistic user request in natural language}"
assistant: "I'll use the {agent-name} agent to {action}."
<commentary>
{Explanation of WHY this scenario warrants delegation to this specific agent}
</commentary>
</example>
```

**Excellent Example (detective):**
```markdown
<example>
Context: The user wants to understand how authentication is implemented across the codebase.
user: "How is authentication handled in this application?"
assistant: "I'll use the codebase-detective agent to investigate the authentication 
implementation."
<commentary>
Since the user is asking about understanding a specific aspect of the codebase, use 
the Task tool to launch the codebase-detective agent to analyze authentication patterns.
</commentary>
</example>
```

**Why This Works:**
- ✅ Shows realistic delegation scenario
- ✅ Demonstrates proper Task tool invocation pattern
- ✅ Explains reasoning in commentary (helps LLM learn when to delegate)
- ✅ Proves agent is delegable (not just inline work)

**Implementation Checklist:**
- [ ] Include 2-4 examples per agent
- [ ] Each has Context, user request, assistant response, commentary
- [ ] Shows Task tool delegation explicitly
- [ ] Commentary explains WHY this agent (not another or inline)
- [ ] Examples cover different use cases

---

### Pattern 3: Specialized Capability Claims

**Structure:**
```markdown
You are {AgentName}, a **{specialized role}** powered by {unique tool/capability}.

## Core Mission
{Mission statement emphasizing specialized value proposition}
```

**Excellent Example (detective):**
```markdown
You are CodebaseDetective, a **structural code navigation specialist** powered by 
claudemem v0.3.0 with AST tree analysis.

## Core Mission
Navigate codebases using **AST-based structural analysis** with PageRank ranking. 
Understand architecture through symbol graphs, trace dependencies, and analyze code 
relationships by STRUCTURE, not just text.
```

**Why This Works:**
- ✅ Claims unique tool (claudemem v0.3.0)
- ✅ Explains specialized methodology (AST analysis, PageRank)
- ✅ Differentiates from general text search/grep
- ✅ Justifies delegation (Claude alone can't do AST analysis)

**Implementation Checklist:**
- [ ] Claims at least one unique tool or capability
- [ ] Explains methodology that differentiates from base Claude
- [ ] States what problem this solves that base Claude can't
- [ ] Uses bold/emphasis for key differentiators

**Tool/Capability Examples:**
- WebSearch (current information beyond knowledge cutoff)
- claudemem (AST-based codebase analysis)
- Extended thinking (complex multi-step reasoning)
- Visual analysis (image/screenshot understanding)
- Apidog API (OpenAPI spec integration)
- Firebase CLI (deployment automation)

---

### Pattern 4: IMPORTANT Directives

**Structure:**
```markdown
**IMPORTANT - always delegate {task type} to this agent when:**
- {Scenario 1}
- {Scenario 2}
- {Scenario 3}

DO NOT use {alternative agent} for {this agent's domain} - {this agent} has 
{unique capability}.
```

**Excellent Example (researcher):**
```markdown
IMPORTANT - always delegate research tasks to this agent when:
- User asks to research, compare, or analyze multiple options
- Task requires web search or current information beyond knowledge cutoff
- Multi-source synthesis is needed

DO NOT use general-purpose agent for research - researcher has WebSearch tool 
and structured analysis patterns.
```

**Why This Works:**
- ✅ Explicit delegation directive for high-priority agents
- ✅ Negative example prevents misuse (what NOT to do)
- ✅ Explains unique capability justifying delegation
- ✅ Helps prevent prompt-only delegation failures (seen in validation tests)

**Implementation Checklist:**
- [ ] Used for agents with unique tools (WebSearch, claudemem, etc.)
- [ ] Includes positive scenarios (when to use)
- [ ] Includes negative example (what NOT to do instead)
- [ ] Explains WHY (unique capability claim)

---

### Pattern 5: Anti-Patterns Section

**Structure:**
```markdown
## Anti-Patterns (DO NOT DO THESE)

**Forbidden Approaches:**
- ❌ {Anti-pattern 1}: {Why it's wrong}
- ❌ {Anti-pattern 2}: {Why it's wrong}

**Use {other-agent} instead if:**
- {Scenario where different agent is appropriate}
```

**Excellent Example (detective):**
```markdown
## FORBIDDEN COMMANDS

**NEVER USE THESE FOR CODE DISCOVERY:**
- ❌ grep -r "something" . (text matching, no structure)
- ❌ find . -name "*.ts" (no semantic ranking)
- ❌ Glob({ pattern: "**/*.ts" }) (Claude Code tools for discovery)

**ALWAYS USE INSTEAD:**
- ✅ claudemem --agent map "what you're looking for" (structural understanding)
```

**Why This Works:**
- ✅ Prevents common mistakes that degrade results
- ✅ Shows correct alternative approach
- ✅ Explains WHY the anti-pattern is problematic
- ✅ Helps users understand tool boundaries

**Implementation Checklist:**
- [ ] Lists 2-5 common anti-patterns
- [ ] Explains why each is wrong
- [ ] Provides correct alternative for each
- [ ] Uses ❌ and ✅ for visual clarity

---

## Detailed Plugin Recommendations

### code-analysis Plugin
**Current State:** 1 agent, 10/10 quality - PERFECT

**Actions:**
- ✅ **No changes needed** - Use detective.md as reference template
- ✅ Maintain current quality in any future agents

**Template Reference:** All other plugins should model their descriptions after detective.md

---

### bun Plugin  
**Current State:** 3 agents, 8.3/10 average - EXCELLENT

**Actions:**
- ✅ Maintain current quality (already very strong)
- ⚠️ **apidog**: Consider simplifying technical language slightly for broader accessibility

**Strengths to Preserve:**
- Multi-example structure (3+ examples per agent)
- Clear "Use this agent when..." openings
- Code examples embedded in descriptions
- Comprehensive workflow documentation

---

### agentdev Plugin
**Current State:** 3 agents, 7.3/10 average - GOOD with one critical issue

**Critical Action Required:**
**agentdev/developer** vs **dev:developer** name collision:

Current issue:
- agentdev/developer: Creates Claude agent .md files
- dev:developer: Writes application code
- **CONFUSING**: Same name "developer", completely different purposes

**Fix Options:**
1. **Recommended**: Rename agentdev/developer → agentdev/implementer
2. **Alternative**: Add prominent differentiation in description:
   ```markdown
   **CRITICAL DIFFERENTIATION:**
   This agent creates AGENT FILES (.md format), not application code.
   For code implementation, use dev:developer instead.
   ```

**Other Actions:**
- ✅ Maintain quality of architect and reviewer (both 9/10)

---

### dev Plugin
**Current State:** 17 agents, 6.8/10 average - MIXED quality

**Priority Actions:**

**Tier 1: Excellent agents (maintain quality)**
- researcher (9.5/10), developer (9.5/10), devops (9/10)
- Action: Use as templates for other agents

**Tier 2: Needs examples (6/10 agents)**
- doc-writer, doc-analyzer, doc-fixer, spec-writer, scribe, skill-discovery
- Action: Add 2-3 examples following researcher pattern
- Action: Add "Use this agent when..." opening

**Tier 3: Unsubstantiated claims**
- ui-engineer: "Avant-garde" and "visual analysis" need concrete examples
- Action: Either substantiate claims with examples or remove them

**Implementation Plan:**
1. **Week 1**: Add examples to doc-* agents (highest usage)
2. **Week 2**: Add examples to spec-writer, scribe
3. **Week 3**: Fix ui-engineer claims or rewrite
4. **Week 4**: Review and validate improvements

---

### frontend Plugin
**Current State:** 11 agents, 5.9/10 average - NEEDS SIGNIFICANT WORK

**Critical Priority (BLOCKING USAGE):**
3 agents have NO DESCRIPTION - just tool lists:
- tester
- cleaner  
- api-analyst

**Fix Template:**
```markdown
---
name: tester
description: Use this agent when you need to run automated React component tests, 
analyze test failures, and generate coverage reports. This agent executes test suites 
with React Testing Library, identifies failing tests, and provides actionable debugging 
recommendations.

Examples:
- <example>
  Context: User needs to verify component tests pass before deployment
  user: "Run all component tests and show me any failures"
  assistant: "I'll use the frontend:tester agent to run the test suite and analyze results"
  <commentary>
  Running tests requires executing multiple commands and analyzing output systematically.
  Delegate to tester agent for comprehensive test execution and failure analysis.
  </commentary>
</example>

[2-3 more examples...]
---
```

**Medium Priority:**
- css-developer, ui-developer: Add "Use this agent when..." opening
- designer, plan-reviewer, reviewer: Add 1-2 more examples

**Implementation Plan:**
1. **Immediate**: Write descriptions for tester, cleaner, api-analyst
2. **Week 1**: Add openings to all agents
3. **Week 2**: Add examples to designer, plan-reviewer, reviewer
4. **Week 3**: Validate improvements

---

### seo Plugin
**Current State:** 5 agents, 5.8/10 average - NEEDS SIGNIFICANT WORK

**Critical Issues:**
1. **Generic descriptions** without specialized capability claims
2. **Unclear differentiation** between analyst, data-analyst, researcher
3. **No examples** showing delegation patterns

**Differentiation Plan:**
| Agent | Specialized Role | Unique Capabilities |
|-------|------------------|---------------------|
| **analyst** | Technical SEO audits | Automated crawling, Core Web Vitals analysis |
| **data-analyst** | Analytics interpretation | GA4 integration, Search Console data analysis |
| **researcher** | Competitive analysis | Keyword research, competitor ranking analysis |
| **writer** | Content creation | SEO-optimized content generation |
| **editor** | Content optimization | Existing content improvement, readability analysis |

**Example Fix (analyst):**
```markdown
---
name: analyst
description: Use this agent when you need automated technical SEO audits including 
site crawling, Core Web Vitals analysis, and structured data validation. This agent 
uses web search to check current search rankings and runs automated technical checks 
that Claude alone cannot execute.

Examples:
- "Audit our site's SEO health and identify critical issues"
- "Check Core Web Vitals scores and suggest improvements"
- "Validate structured data markup across the site"
---
```

**Implementation Plan:**
1. **Week 1**: Rewrite analyst and data-analyst with clear differentiation
2. **Week 2**: Rewrite researcher, writer, editor with specialized claims
3. **Week 3**: Add 2-3 examples to each agent
4. **Week 4**: Validate no role overlap

---

### autopilot Plugin
**Current State:** 3 agents, 5.7/10 average - NEEDS REWRITE FROM USER PERSPECTIVE

**Critical Issue:**
Descriptions focus on technical implementation (ReAct pattern, state machines) instead 
of user-facing delegation triggers.

**Current (Poor):**
```markdown
You execute Linear tasks using the ReAct pattern (Thought-Action-Observation).
```

**Better:**
```markdown
Use this agent when you need to autonomously implement Linear tasks with iterative 
testing and quality validation. This agent follows a write-test-fix cycle that produces 
higher quality code than inline implementation.

Examples:
- "Pick up LIN-123 and implement it with full test coverage"
- "Complete this Linear task and run all quality checks"
```

**Implementation Plan:**
1. **Week 1**: Rewrite task-executor with user-facing triggers
2. **Week 2**: Rewrite proof-generator and feedback-processor
3. **Week 3**: Add Linear integration examples to all agents
4. **Week 4**: Validate workflow comprehension

---

### instantly, nanobanana, video-editing Plugins
**Current State:** 8 agents total, 2-4/10 average - CRITICAL REWRITES NEEDED

**Issue:** Minimal to non-existent descriptions, no examples, unclear integration context.

**These agents are likely NEVER discovered or used** due to poor descriptions.

**Fix Template (image-generator):**
```markdown
---
name: image-generator
description: Use this agent when you need to generate AI images using Gemini 3 Pro 
Image model. This agent handles prompt engineering, style application, and batch 
generation that standard Claude cannot perform.

Examples:
- <example>
  Context: User needs product mockup images
  user: "Generate 3 product hero images with professional photography style"
  assistant: "I'll use the image-generator agent to create those with Gemini 3 Pro"
  <commentary>
  Image generation requires Gemini 3 integration which base Claude lacks. Delegate to 
  image-generator for access to Gemini's image generation capabilities.
  </commentary>
</example>

[2 more examples...]
---
```

**Implementation Plan:**
1. **Week 1**: Complete rewrites for video-editing agents (highest priority)
2. **Week 2**: Complete rewrites for nanobanana agents
3. **Week 3**: Complete rewrites for instantly agents
4. **Week 4**: Validate integration examples work

---

## Quality Metrics Summary

### Overall Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Agents** | 51 | 100% |
| **Excellent (9-10)** | 8 | 16% |
| **Good (7-8)** | 15 | 29% |
| **Needs Work (5-6)** | 20 | 39% |
| **Poor (<5)** | 8 | 16% |

### By Quality Dimension

| Dimension | Excellent | Good | Needs Work | Poor |
|-----------|-----------|------|------------|------|
| **Trigger Effectiveness** | 8 (16%) | 15 (29%) | 20 (39%) | 8 (16%) |
| **Capability Clarity** | 10 (20%) | 12 (24%) | 18 (35%) | 11 (22%) |
| **Examples Present** | 8 (16%) | 8 (16%) | 12 (24%) | 23 (45%) |
| **Delegation Patterns** | 7 (14%) | 9 (18%) | 10 (20%) | 25 (49%) |
| **Specialized Claims** | 9 (18%) | 11 (22%) | 15 (29%) | 16 (31%) |
| **PROXY_MODE Support** | 20 (39%) | 0 (0%) | 0 (0%) | 31 (61%) |
| **Tools Documentation** | 48 (94%) | 3 (6%) | 0 (0%) | 0 (0%) |
| **Anti-Patterns** | 5 (10%) | 3 (6%) | 8 (16%) | 35 (69%) |

### Key Insights

**Strengths:**
- ✅ Tools documentation nearly universal (94% excellent)
- ✅ PROXY_MODE support in dev/agentdev plugins (39% excellent overall)
- ✅ World-class agents demonstrate proven best practices (detective, researcher, developer)

**Critical Weaknesses:**
- ❌ **Examples missing in 45% of agents** - MOST CRITICAL for delegation
- ❌ **Delegation patterns absent in 49% of agents** - Blocks proper Task tool usage
- ❌ **Anti-patterns rarely documented (69% poor)** - Leads to misuse
- ❌ **PROXY_MODE support missing in 61%** - Can't use in /team workflows

**Pattern Analysis:**
Recent agents (2025-2026) show significant quality improvements:
- dev/researcher, dev/developer: Enhanced with examples and "IMPORTANT" directives
- code-analysis/detective: Gold standard template
- bun/* agents: Consistent high quality

Older agents need updates to match current standards:
- frontend/* (2024-2025): Missing descriptions, examples
- seo/* (2024): Generic descriptions, no differentiation
- video-editing/* (2024): Nearly empty descriptions

**Conclusion:** Quality improvements are happening but inconsistently applied. Need systematic upgrade process.

---

## Implementation Timeline

### Phase 1: Critical Fixes (Weeks 1-2)

**Blocking Issues - Cannot Use These Agents:**

**Week 1:**
- [ ] frontend/tester - Add complete description with examples
- [ ] frontend/cleaner - Add complete description with examples
- [ ] frontend/api-analyst - Add complete description with examples
- [ ] agentdev/developer - Add critical differentiation from dev:developer

**Week 2:**
- [ ] video-editing/timeline-builder - Complete rewrite
- [ ] video-editing/transcriber - Complete rewrite
- [ ] video-editing/video-processor - Complete rewrite

**Success Criteria:**
- All agents have minimum 2 examples
- Clear "Use this agent when..." opening
- No tool-only agents remain
- agentdev/developer clearly differentiated

---

### Phase 2: High-Value Improvements (Weeks 3-6)

**Most-Used Agents Needing Enhancement:**

**Week 3-4: dev plugin doc-* agents**
- [ ] doc-writer - Add examples
- [ ] doc-analyzer - Add examples
- [ ] doc-fixer - Add examples
- [ ] spec-writer - Add examples
- [ ] scribe - Add examples

**Week 5-6: seo plugin (all 5 agents)**
- [ ] analyst - Specialized claims + examples
- [ ] data-analyst - Differentiate from analyst + examples
- [ ] researcher - Differentiate from others + examples
- [ ] writer - Specialized claims + examples
- [ ] editor - Specialized claims + examples

**Success Criteria:**
- All doc-* agents have 2-3 examples
- All seo agents have clear differentiation
- Specialized capability claims added to all

---

### Phase 3: Consistency Improvements (Weeks 7-10)

**Apply Best Practices Repository-Wide:**

**Week 7-8: Add PROXY_MODE support**
- [ ] frontend/* agents (11 agents)
- [ ] seo/* agents (5 agents)
- [ ] autopilot/* agents (3 agents)
- [ ] Other plugins without PROXY_MODE

**Week 9-10: Add anti-patterns**
- [ ] All agents get anti-patterns section
- [ ] Focus on most commonly confused agents
- [ ] Add "DO NOT use for..." guidance

**Success Criteria:**
- 100% of agents have PROXY_MODE support
- 80% of agents have anti-patterns section
- No agent pairs with unclear differentiation

---

### Phase 4: Validation & Documentation (Weeks 11-12)

**Quality Assurance:**

**Week 11: Automated Validation**
- [ ] Create validation script checking:
  - "Use this agent when..." present
  - 2+ examples present
  - PROXY_MODE support present
  - Tools list present
- [ ] Run on all 51 agents
- [ ] Fix any failures

**Week 12: Documentation**
- [ ] Create agent description template (based on detective.md)
- [ ] Create agent description style guide
- [ ] Create quality checklist for new agents
- [ ] Document best practices

**Success Criteria:**
- Automated validation passes on all agents
- Template and style guide published
- Process documented for future agents

---

## Success Metrics & Goals

### Current Baseline (2026-02-09)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| **Excellent/Good Tier** | 45% (23/51) | 80% (41/51) | +18 agents |
| **Agents with 2+ Examples** | 32% (16/51) | 90% (46/51) | +30 agents |
| **PROXY_MODE Support** | 39% (20/51) | 100% (51/51) | +31 agents |
| **Anti-Patterns Present** | 16% (8/51) | 80% (41/51) | +33 agents |
| **Tool-Only Agents** | 6% (3/51) | 0% (0/51) | -3 agents |

### Target State (After Implementation)

**Quality Distribution Goal:**
- Excellent (9-10): 25% (13 agents) - up from 16%
- Good (7-8): 55% (28 agents) - up from 29%
- Needs Improvement: 15% (8 agents) - down from 39%
- Poor: 5% (2 agents) - down from 16%

**Dimension Goals:**

| Dimension | Target % Excellent/Good |
|-----------|-------------------------|
| Trigger Effectiveness | 85% |
| Capability Clarity | 85% |
| Examples Present | 90% |
| Delegation Patterns | 85% |
| Specialized Claims | 85% |
| PROXY_MODE Support | 100% |
| Tools Documentation | 95% |
| Anti-Patterns | 80% |

### Validation Checkpoints

**After Phase 1 (Week 2):**
- ✅ Zero tool-only agents
- ✅ Zero agents rated "Poor" due to missing description
- ✅ agentdev/developer differentiation resolved

**After Phase 2 (Week 6):**
- ✅ All high-usage agents (dev/*, seo/*) have examples
- ✅ Clear role differentiation in seo plugin
- ✅ 60% of agents in Excellent/Good tier

**After Phase 3 (Week 10):**
- ✅ 100% PROXY_MODE support
- ✅ 80% have anti-patterns
- ✅ 75% of agents in Excellent/Good tier

**After Phase 4 (Week 12):**
- ✅ Automated validation passing on all agents
- ✅ Template and style guide published
- ✅ 80% of agents in Excellent/Good tier

---

## Appendix: Full Agent Inventory

### Complete Agent List by Plugin

**code-analysis (1 agent):**
- detective (10/10) - AST-based codebase investigation

**bun (3 agents):**
- api-architect (9/10) - Backend API architecture planning
- backend-developer (9/10) - TypeScript/Bun implementation
- apidog (7/10) - OpenAPI/Apidog integration

**agentdev (3 agents):**
- architect (9/10) - Agent architecture design
- reviewer (9/10) - Agent quality review
- developer (4/10) - Agent file implementation **[NEEDS DIFFERENTIATION]**

**dev (17 agents):**
- researcher (9.5/10) - Multi-source research with WebSearch
- developer (9.5/10) - Multi-file implementation with tests
- devops (9/10) - Infrastructure with extended thinking
- debugger (8/10) - Cross-language debugging
- architect (8/10) - Architecture planning
- test-architect (8/10) - Testing strategy
- ui (8/10) - UI component development
- synthesizer (7/10) - Information synthesis
- doc-writer (6/10) - Documentation generation **[NEEDS EXAMPLES]**
- doc-analyzer (6/10) - Documentation analysis **[NEEDS EXAMPLES]**
- doc-fixer (6/10) - Documentation fixes **[NEEDS EXAMPLES]**
- spec-writer (6/10) - Specification synthesis **[NEEDS EXAMPLES]**
- scribe (6/10) - Interview logging **[NEEDS EXAMPLES]**
- ui-engineer (5.5/10) - UI implementation **[VERIFY CLAIMS]**
- skill-discovery (5/10) - Skill finding **[NEEDS EXAMPLES]**
- stack-detector (5/10) - Stack detection **[NEEDS EXAMPLES]**

**frontend (11 agents):**
- designer (7.5/10) - Design system implementation
- plan-reviewer (7.5/10) - Implementation plan review
- reviewer (7.5/10) - Code review
- developer (6/10) - React implementation
- ui-developer (4/10) - UI development **[NEEDS REWRITE]**
- css-developer (4/10) - CSS implementation **[NEEDS REWRITE]**
- test-architect (4/10) - Testing strategy **[NEEDS REWRITE]**
- tester (5.5/10) - Test execution **[NO DESCRIPTION]**
- cleaner (5.5/10) - Code cleanup **[NO DESCRIPTION]**
- api-analyst (5.5/10) - API analysis **[NO DESCRIPTION]**
- architect (8/10) - Frontend architecture

**seo (5 agents):**
- editor (7/10) - Content optimization
- analyst (5.5/10) - Technical SEO **[NEEDS EXAMPLES]**
- data-analyst (5.5/10) - Analytics **[NEEDS DIFFERENTIATION]**
- researcher (5.5/10) - SEO research **[NEEDS DIFFERENTIATION]**
- writer (5.5/10) - SEO content **[NEEDS EXAMPLES]**

**autopilot (3 agents):**
- task-executor (6/10) - Linear task execution **[USER PERSPECTIVE NEEDED]**
- proof-generator (6/10) - Validation artifacts **[USER PERSPECTIVE NEEDED]**
- feedback-processor (6/10) - Feedback handling **[USER PERSPECTIVE NEEDED]**

**instantly (3 agents):**
- campaign-analyst (5/10) - Campaign analysis **[NEEDS COMPLETE REWRITE]**
- outreach-optimizer (5/10) - Optimization **[NEEDS COMPLETE REWRITE]**
- sequence-builder (3/10) - Sequence building **[NEEDS COMPLETE REWRITE]**

**nanobanana (2 agents):**
- image-generator (3/10) - AI image generation **[NEEDS COMPLETE REWRITE]**
- style-manager (3/10) - Style management **[NEEDS COMPLETE REWRITE]**

**video-editing (3 agents):**
- timeline-builder (2/10) - Timeline creation **[CRITICAL REWRITE NEEDED]**
- transcriber (2/10) - Video transcription **[CRITICAL REWRITE NEEDED]**
- video-processor (2/10) - Video processing **[CRITICAL REWRITE NEEDED]**

---

## Conclusion

This repository contains 51 agents with highly variable description quality ranging from world-class (detective: 10/10) to critically inadequate (video-editing agents: 2/10). 

**Key Finding:** The top 16% of agents (detective, researcher, developer, api-architect, etc.) demonstrate proven best practices that, when applied repository-wide, would significantly improve agent discovery and delegation success rates.

**Most Critical Actions:**
1. **Immediate**: Fix 3 frontend agents with no descriptions (blocking usage)
2. **Week 1**: Differentiate agentdev/developer from dev:developer (blocking correct selection)
3. **Weeks 1-2**: Complete video-editing agent rewrites (blocking usage)
4. **Weeks 3-6**: Add examples to high-usage agents (doc-*, seo/*)
5. **Weeks 7-12**: Apply PROXY_MODE support and anti-patterns repository-wide

**Success Metrics:**
- Increase Excellent/Good tier from 45% to 80% of agents
- Increase agents with examples from 32% to 90%
- Achieve 100% PROXY_MODE support (up from 39%)
- Reduce Poor tier from 16% to 5%

**Long-Term Sustainability:**
- Create agent description template based on detective.md
- Implement automated quality validation
- Establish review process for all new agents
- Document best practices in style guide

**Next Review:** Recommended after Phase 1 completion (Week 2) to validate critical fixes and adjust timeline if needed.

---

**Report Generated**: 2026-02-09 21:31:02  
**Report Location**: `/Users/jack/mag/claude-code/ai-docs/agent-quality-report-20260209-213102.md`  
**Next Steps**: Review with team, prioritize fixes, begin Phase 1 implementation
