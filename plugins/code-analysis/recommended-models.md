# Recommended AI Models for Code Development

**Version:** 1.1.1
**Last Updated:** 2025-11-14
**Pricing Last Verified:** 2025-11-14
**Purpose:** Curated OpenRouter model recommendations for code development tasks
**Maintained By:** MadAppGang Claude Code Team

---

## How to Use This Guide

### For AI Agents

This file provides curated model recommendations for different code development tasks. When a user needs to select an AI model for plan review, code review, or other multi-model workflows:

1. **Read the relevant section** based on task type (coding, reasoning, vision, budget)
2. **Extract recommended models** (marked with ⭐)
3. **Present options to user** with context from "Best For" and "Trade-offs" sections
4. **Use OpenRouter IDs** exactly as shown in code blocks

### For Human Users

Browse categories to find models that match your needs:
- **Fast Coding Models** ⚡ - Quick iterations, code generation, reviews
- **Advanced Reasoning Models** 🧠 - Architecture, complex problem-solving
- **Vision & Multimodal Models** 👁️ - UI analysis, screenshot reviews
- **Budget-Friendly Models** 💰 - High-volume tasks, simple operations

Each model includes:
- OpenRouter ID (for use with Claudish CLI)
- Context window and pricing information
- Best use cases and trade-offs
- Guidance on when to use or avoid

---

## Quick Reference Table

| Model | Category | Speed | Quality | Cost | Context | Recommended For |
|-------|----------|-------|---------|------|---------|----------------|
| x-ai/grok-code-fast-1 | Coding ⚡ | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 256K | Ultra-fast coding, budget-friendly |
| google/gemini-2.5-flash | Coding ⚡ | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 1049K | Fast coding, huge context |
| deepseek/deepseek-v3-0324 | Coding ⚡ | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 64K | Fast affordable coding |
| z-ai/glm-4.6 | Reasoning 🧠 | ⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰 | 128K | Architecture planning |
| qwen/qwen3-vl-235b | Vision 👁️ | ⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰💰 | 32K | Vision-language tasks |
| minimax/minimax-m2 | Budget 💰 | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Free | 128K | Free coding tasks |

**Legend:**
- Speed: ⚡ (1-5, more = faster)
- Quality: ⭐ (1-5, more = better)
- Cost: 💰 (1-5, more = expensive)
- Context: Token window size

---

## Category 1: Fast Coding Models ⚡

**Use When:** You need quick code generation, reviews, or iterations. Speed is priority.

### x-ai/grok-code-fast-1 (⭐ RECOMMENDED)

- **Provider:** xAI
- **OpenRouter ID:** `x-ai/grok-code-fast-1`
- **Model Version:** Grok Code Fast 1 (2025-11-14)
- **Context Window:** 256,000 tokens
- **Pricing:** $0.20/1M input, $1.50/1M output (Verified: 2025-11-14)
- **Response Time:** Ultra-fast (<2s typical)

**Best For:**
- Ultra-fast code reviews
- Quick syntax and logic checks
- Rapid prototyping
- Agentic coding workflows
- Visible reasoning traces
- Budget-conscious fast development

**Trade-offs:**
- Less sophisticated than premium models for complex architecture
- Smaller context than Gemini (256K vs 1049K)
- May miss subtle edge cases in complex systems

**When to Use:**
- ✅ **Budget-conscious fast coding** ($0.85/1M avg!)
- ✅ Inner dev loop (test-fix-test cycles)
- ✅ Quick feedback on code changes
- ✅ Large codebases needing fast turnaround
- ✅ Reasoning traces for debugging
- ✅ High-volume code reviews

**Avoid For:**
- ❌ Complex architectural decisions (use advanced reasoning models)
- ❌ Security-critical code review (use premium models)
- ❌ Performance optimization requiring deep analysis
- ❌ Tasks requiring >256K context

---

### google/gemini-2.5-flash (⭐ RECOMMENDED)

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-flash`
- **Model Version:** Gemini 2.5 Flash (2025-11-14)
- **Context Window:** 1,049,000 tokens
- **Pricing:** $0.075/1M input, $0.30/1M output (Verified: 2025-11-14)
- **Response Time:** Very fast (<2s typical)

**Best For:**
- **Ultra-cheap massive context** (1M+ tokens!)
- Fast code generation across entire codebases
- Multi-file refactoring
- Large repository analysis
- Quick comprehension of complex systems
- High-volume simple coding tasks

**Trade-offs:**
- Lower quality than Gemini Pro for complex reasoning
- Less specialized than coding-focused models
- Better for breadth than depth

**When to Use:**
- ✅ **Massive context at ultra-low cost** (1M tokens at $0.19/1M avg!)
- ✅ Whole codebase analysis
- ✅ Multi-file architectural planning
- ✅ Large-scale refactoring
- ✅ High-volume tasks (thousands of reviews)
- ✅ Quick iterations on large projects

**Avoid For:**
- ❌ Critical code paths requiring highest quality
- ❌ Complex architectural decisions (use reasoning models)
- ❌ Security-critical reviews
- ❌ Production releases requiring maximum accuracy

---

### deepseek/deepseek-v3-0324

- **Provider:** DeepSeek
- **OpenRouter ID:** `deepseek/deepseek-v3-0324`
- **Model Version:** DeepSeek V3 (2025-03-24)
- **Context Window:** 64,000 tokens
- **Pricing:** $0.14/1M input, $0.28/1M output (Verified: 2025-11-14)
- **Response Time:** Fast (~3s typical)

**Best For:**
- Fast affordable code generation
- Algorithm implementation
- Mathematical problem-solving
- Code optimization
- Programming challenges
- Budget-friendly quick iterations

**Trade-offs:**
- Smaller context (64K)
- Less sophisticated for complex systems
- May require more guidance for edge cases

**When to Use:**
- ✅ **Ultra-affordable fast coding** ($0.21/1M avg!)
- ✅ Algorithm development
- ✅ Math and programming tasks
- ✅ Quick prototyping
- ✅ High-volume simple tasks
- ✅ Learning and experimentation

**Avoid For:**
- ❌ Large files or projects (64K limit)
- ❌ Complex architectural planning
- ❌ Multi-file system design
- ❌ Production-critical implementations

---

## Category 2: Advanced Reasoning Models 🧠

**Use When:** You need deep analysis, architectural planning, or complex problem-solving.

### z-ai/glm-4.6 (⭐ RECOMMENDED)

- **Provider:** Zhipu AI
- **OpenRouter ID:** `z-ai/glm-4.6`
- **Model Version:** GLM-4.6 (2025-11-14)
- **Context Window:** 128,000 tokens
- **Pricing:** $0.50/1M input, $1.00/1M output (Verified: 2025-11-14)
- **Response Time:** Moderate (~5s typical)

**Best For:**
- **Architectural planning and design**
- Complex system design decisions
- Multi-component integration planning
- Code review with reasoning
- Large-scale refactoring plans
- Advanced problem-solving

**Trade-offs:**
- Moderate pricing ($0.75/1M avg)
- Smaller context than premium models (128K)
- Slower than fast coding models

**When to Use:**
- ✅ **Architecture planning** (PHASE 1 in /implement)
- ✅ **Plan reviews** (PHASE 1.5 multi-model review)
- ✅ Complex integration scenarios
- ✅ System design decisions
- ✅ Mid-range budget projects
- ✅ Projects requiring reasoning quality

**Avoid For:**
- ❌ Simple CRUD operations
- ❌ Quick syntax fixes
- ❌ Ultra-large context needs (>128K)
- ❌ When ultra-fast response is critical

---

## Category 3: Vision & Multimodal Models 👁️

**Use When:** You need UI/UX analysis, screenshot reviews, or diagram interpretation.

### qwen/qwen3-vl-235b (⭐ RECOMMENDED)

- **Provider:** Qwen (Alibaba Cloud)
- **OpenRouter ID:** `qwen/qwen3-vl-235b`
- **Model Version:** Qwen3 VL 235B (2025-11-14)
- **Context Window:** 32,000 tokens
- **Pricing:** $3.00/1M input, $7.00/1M output (Verified: 2025-11-14)
- **Vision:** Vision-language model
- **Response Time:** Moderate (~5s typical)

**Best For:**
- **Premium vision-language tasks**
- UI/UX design analysis
- Screenshot-based debugging
- Design fidelity validation
- Component recognition
- Visual accessibility audits

**Trade-offs:**
- Premium pricing for vision ($5.00/1M avg)
- Smaller context than text models (32K)
- Slower than fast coding models

**When to Use:**
- ✅ **Design fidelity validation** (PHASE 2.5 in /implement)
- ✅ Screenshot-based UI reviews
- ✅ Figma design to code comparison
- ✅ Accessibility visual audits
- ✅ Design system consistency checks
- ✅ High-quality vision analysis

**Avoid For:**
- ❌ Pure code review (use coding models)
- ❌ Simple layout checks (use budget vision)
- ❌ Ultra-large design systems (>32K context)
- ❌ Budget-critical projects

---

## Category 4: Budget-Friendly Models 💰

**Use When:** You need to minimize costs for high-volume or simple tasks.

### minimax/minimax-m2 (⭐ RECOMMENDED)

- **Provider:** MiniMax
- **OpenRouter ID:** `minimax/minimax-m2`
- **Model Version:** MiniMax M2 (2025-11-14)
- **Context Window:** 128,000 tokens
- **Pricing:** **FREE** (Verified: 2025-11-14)
- **Response Time:** Fast (~3s typical)

**Best For:**
- **Free coding tasks**
- Learning and experimentation
- High-volume simple operations
- Quick prototyping
- Code comprehension
- Educational projects

**Trade-offs:**
- Rate limits on free tier
- May have availability issues during peak times
- No SLA guarantees
- Quality may vary with load

**When to Use:**
- ✅ **Zero budget** (completely free!)
- ✅ Learning and experimentation
- ✅ High-volume simple tasks
- ✅ Quick iterations
- ✅ Personal projects
- ✅ 128K context needs

**Avoid For:**
- ❌ Production-critical tasks (no SLA)
- ❌ Time-sensitive workflows (potential rate limits)
- ❌ When reliability is critical
- ❌ Complex architectural decisions

---

## Model Selection Decision Tree

Use this flowchart to choose the right model:

```
START: What is your primary need?

┌─ Architecture Planning or Complex Reasoning?
│  ├─ Budget < $1/1M → deepseek/deepseek-v3-0324 ($0.21/1M)
│  ├─ Need massive context (>128K) → google/gemini-2.5-flash ($0.19/1M, 1M context)
│  └─ Recommended → z-ai/glm-4.6 ⭐ ($0.75/1M, 128K context)

┌─ Fast Code Review or Generation?
│  ├─ Budget < $0.25/1M → google/gemini-2.5-flash ($0.19/1M)
│  ├─ Need huge context (>256K) → google/gemini-2.5-flash ($0.19/1M, 1M)
│  └─ Recommended → x-ai/grok-code-fast-1 ⭐ ($0.85/1M, ultra-fast)

┌─ UI/Design Analysis (Screenshots)?
│  └─ Recommended → qwen/qwen3-vl-235b ⭐ ($5.00/1M, 32K)

┌─ Budget is Top Priority?
│  ├─ Completely free → minimax/minimax-m2 (FREE, 128K context)
│  ├─ Ultra-cheap + massive context → google/gemini-2.5-flash ($0.19/1M, 1M)
│  └─ Recommended → minimax/minimax-m2 ⭐ (FREE!)

┌─ High-Volume Simple Tasks?
│  ├─ Free tier → minimax/minimax-m2 (FREE)
│  └─ Recommended → google/gemini-2.5-flash ⭐ ($0.19/1M, 1M context)

└─ Not sure? → Start with x-ai/grok-code-fast-1 (fast + affordable)
```

---

## Performance Benchmarks

### Speed Comparison (Typical Response Times)

| Model | Simple Task | Complex Task | Large Context |
|-------|-------------|--------------|---------------|
| google/gemini-2.5-flash | <2s | 3-4s | 5s |
| x-ai/grok-code-fast-1 | <2s | 4-5s | 6s |
| minimax/minimax-m2 | 3s | 5-6s | 7s |
| deepseek/deepseek-v3-0324 | 3s | 5-6s | 7s |
| z-ai/glm-4.6 | 4-5s | 8-10s | 12s |
| qwen/qwen3-vl-235b | 4-5s | 8-10s | N/A (32K max) |

**Notes:**
- Times are approximate and vary based on load
- "Large Context" = >100K tokens
- Reasoning models may be slower for chain-of-thought
- Vision models (qwen3-vl-235b) have smaller context limits

### Cost Comparison (Per 1M Tokens)

| Model | Input | Output | Total (1:1 ratio) |
|-------|-------|--------|-------------------|
| minimax/minimax-m2 | FREE | FREE | FREE |
| google/gemini-2.5-flash | $0.075 | $0.30 | $0.19 |
| deepseek/deepseek-v3-0324 | $0.14 | $0.28 | $0.21 |
| z-ai/glm-4.6 | $0.50 | $1.00 | $0.75 |
| x-ai/grok-code-fast-1 | $0.20 | $1.50 | $0.85 |
| qwen/qwen3-vl-235b | $3.00 | $7.00 | $5.00 |

**Notes:**
- Prices from OpenRouter (subject to change)
- "Total" assumes equal input/output tokens
- Typical code review is ~70% input, 30% output

### Quality vs Cost Analysis

**Best Value for Code Review:**
1. **minimax/minimax-m2** - FREE with 128K context (unbeatable value!)
2. **google/gemini-2.5-flash** - Massive context at ultra-low cost ($0.19/1M)
3. **x-ai/grok-code-fast-1** - Great quality + speed at $0.85/1M

**Best Quality (Cost No Object):**
1. **qwen/qwen3-vl-235b** - Premium vision-language ($5.00/1M)
2. **z-ai/glm-4.6** - Advanced reasoning ($0.75/1M)
3. **x-ai/grok-code-fast-1** - Strong coding quality ($0.85/1M)

**Best for Massive Context:**
1. **google/gemini-2.5-flash** - 1M tokens at $0.19/1M (!)
2. **x-ai/grok-code-fast-1** - 256K tokens at $0.85/1M
3. **minimax/minimax-m2** - 128K tokens FREE

---

## Integration Examples

### Example 1: Multi-Model Plan Review (PHASE 1.5)

**In /implement command:**

```markdown
## PHASE 1.5: Multi-Model Plan Review

**Step 1:** Read model recommendations

Use Read tool to load: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md

**Step 2:** Extract recommended reasoning models

From section "Advanced Reasoning Models 🧠", extract models marked with ⭐:
- z-ai/glm-4.6 (primary recommendation - $0.75/1M)
- Alternative: x-ai/grok-code-fast-1 (fast + affordable - $0.85/1M)

**Step 3:** Present options to user

AskUserQuestion with these options:

"Select AI models for architecture plan review:

**Recommended (Advanced Reasoning):**
• z-ai/glm-4.6 - Best for architectural decisions ($0.75/1M)

**Fast & Affordable:**
• x-ai/grok-code-fast-1 - Quick architectural feedback ($0.85/1M)
• google/gemini-2.5-flash - Massive context analysis ($0.19/1M)

**Custom:**
• Enter any OpenRouter model ID

**Skip:**
• Continue without multi-model review

Which models would you like to use? (select 1-3 or skip)"
```

### Example 2: Budget-Optimized Code Review

**In code review workflow:**

```markdown
## Budget-Optimized Multi-Model Review

**Read recommendations:**
${CLAUDE_PLUGIN_ROOT}/recommended-models.md → "Budget-Friendly Models"

**Extract budget models:**
- minimax/minimax-m2 (FREE) - Zero cost!
- google/gemini-2.5-flash ($0.19/1M) - Ultra-cheap
- deepseek/deepseek-v3-0324 ($0.21/1M) - Affordable reasoning

**Run 3 parallel reviews:**
1. Claude Sonnet (internal, comprehensive)
2. MiniMax M2 (external, FREE!)
3. Gemini Flash (external, ultra-cheap)

**Total cost for 100K token review:**
- Claude Sonnet: ~$1.80
- MiniMax M2: FREE (!)
- Gemini Flash: ~$0.019
- **Grand Total: ~$1.82** (vs $9.00 for 3x Sonnet)
```

### Example 3: Vision Task Model Selection

**In UI validation workflow:**

```markdown
## UI Design Validation

**Read recommendations:**
${CLAUDE_PLUGIN_ROOT}/recommended-models.md → "Vision & Multimodal Models"

**Task:** Compare Figma design screenshot to implemented UI

**Recommended model:**
qwen/qwen3-vl-235b
- Vision-language model (235B parameters)
- 32K token context
- Premium vision quality ($5.00/1M)
- Strong UI analysis capabilities

**Run with Claudish:**
npx claudish --model qwen/qwen3-vl-235b --stdin --quiet < prompt.txt
```

---

## Maintenance and Updates

### How to Update This File

**Step 1: Edit Source**
```bash
# Edit the source file (ONLY place to edit!)
vim shared/recommended-models.md
```

**Step 2: Sync to Plugins**
```bash
# Distribute updates to all plugins
bun run sync-shared
```

**Step 3: Verify**
```bash
# Check files were updated
cat plugins/frontend/recommended-models.md | head -20
cat plugins/bun/recommended-models.md | head -20
cat plugins/code-analysis/recommended-models.md | head -20
```

### Update Checklist

When adding a new model:
- [ ] Add to appropriate category section
- [ ] Include all required fields (Provider, ID, Context, Pricing, etc.)
- [ ] Write "Best For", "Trade-offs", "When to Use", "Avoid For"
- [ ] Update Quick Reference Table
- [ ] Update Decision Tree if needed
- [ ] Update Performance Benchmarks
- [ ] Run sync script
- [ ] Test in a command (verify AI can extract the model)

When removing a model:
- [ ] Remove from category section
- [ ] Remove from Quick Reference Table
- [ ] Update Decision Tree if needed
- [ ] Update Performance Benchmarks
- [ ] Run sync script
- [ ] Update any commands that hardcoded the model

When updating pricing:
- [ ] Update in model entry
- [ ] Update in Quick Reference Table
- [ ] Update in Cost Comparison table
- [ ] Update last-updated date at top
- [ ] Run sync script

---

## Questions and Support

**For model recommendations:**
- See category sections and decision tree above
- Ask in project discussions or issues

**For technical issues:**
- Check `shared/README.md` for sync pattern
- See `CLAUDE.md` for project overview
- Contact: Jack Rudenko (i@madappgang.com)

**To suggest new models:**
- Open an issue with model details
- Include: Provider, ID, pricing, use cases
- Maintainers will evaluate and add

---

**Maintained By:** MadAppGang Claude Code Team
**Repository:** https://github.com/MadAppGang/claude-code
**License:** MIT
