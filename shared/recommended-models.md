# Recommended AI Models for Code Development

**Version:** 1.1.5
**Last Updated:** 2025-11-16
**Pricing Last Verified:** 2025-11-16
**Purpose:** Curated OpenRouter model recommendations for code development tasks
**Maintained By:** MadAppGang Claude Code Team

---

## Quick Reference - Model IDs Only

**Coding (Fast):**
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
- `minimax/minimax-m2` - Compact high-efficiency, $0.64/1M, 205K ⭐

**Reasoning (Architecture):**
- `google/gemini-2.5-flash` - Advanced reasoning with built-in thinking, $1.40/1M, 1M ⭐
- `openai/gpt-5` - Most advanced reasoning, $5.63/1M, 400K ⭐
- `openai/gpt-5.1-codex` - Specialized for software engineering, $5.63/1M, 400K ⭐

**Vision (Multimodal):**
- `google/gemini-2.5-flash` - Advanced reasoning + vision, $1.40/1M, 1M ⭐
- `qwen/qwen3-vl-235b-a22b-instruct` - Multimodal with OCR, $0.55/1M, 262K ⭐

**Budget (Free/Cheap):**
- `openrouter/polaris-alpha` - FREE experimental (logs usage), FREE, 256K ⭐

---

## How to Use This Guide

### For AI Agents

This file provides curated model recommendations for different code development tasks. When a user needs to select an AI model for plan review, code review, or other multi-model workflows:

1. **Start with Quick Reference** - Extract model slugs from the top section (7 recommended models)
2. **Read detailed sections** for context on "Best For", "Trade-offs", and use cases
3. **Use ⭐ markers** to identify top recommendations in each category
4. **Present options to user** with pricing, context window, and use case guidance
5. **Copy OpenRouter IDs exactly** as shown in backticks (e.g., `x-ai/grok-code-fast-1`)

### For Human Users

Browse categories to find models that match your needs:
- **Fast Coding Models** ⚡ - Quick iterations, code generation, reviews
- **Advanced Reasoning Models** 🧠 - Architecture, complex problem-solving
- **Vision & Multimodal Models** 👁️ - UI analysis, screenshots, diagrams
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
| minimax/minimax-m2 | Coding ⚡ | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 205K | Compact high-efficiency coding |
| google/gemini-2.5-flash | Reasoning 🧠 | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰 | 1049K | Advanced reasoning, huge context |
| openai/gpt-5 | Reasoning 🧠 | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰 | 400K | Most advanced reasoning model |
| openai/gpt-5.1-codex | Reasoning 🧠 | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰 | 400K | Specialized software engineering |
| qwen/qwen3-vl-235b-a22b-instruct | Vision 👁️ | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 262K | Multimodal with OCR, chart extraction |
| openrouter/polaris-alpha | Budget 💰 | ⚡⚡⚡⚡ | ⭐⭐⭐ | FREE | 256K | FREE experimental (logs usage) |

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
- **Model Version:** Grok Code Fast 1 (2025-11-16)
- **Context Window:** 256,000 tokens
- **Pricing:** $0.20/1M input, $1.50/1M output (Verified: 2025-11-16)
- **Response Time:** Ultra-fast (<2s typical)

**Best For:**
- Ultra-fast code reviews with visible reasoning traces
- Quick syntax and logic checks
- Rapid prototyping and iteration
- Agentic coding workflows
- Budget-conscious fast development
- High-volume code reviews

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

### minimax/minimax-m2 (⭐ RECOMMENDED)

- **Provider:** MiniMax
- **OpenRouter ID:** `minimax/minimax-m2`
- **Model Version:** MiniMax M2 (2025-11-16)
- **Context Window:** 204,800 tokens
- **Pricing:** $0.255/1M input, $1.02/1M output (Verified: 2025-11-16)
- **Response Time:** Very fast (<2s typical)

**Best For:**
- Compact, high-efficiency end-to-end coding workflows (10B activated params, 230B total)
- Code generation and refactoring
- Quick prototyping
- Algorithm implementation
- Balanced speed and quality
- Mid-range budget projects

**Trade-offs:**
- Moderate pricing ($0.64/1M avg)
- Smaller context than Gemini models (205K vs 1049K)
- Less specialized than domain-specific models

**When to Use:**
- ✅ **High-efficiency coding** at affordable price ($0.64/1M)
- ✅ End-to-end development workflows
- ✅ Balanced speed and quality needs
- ✅ Quick iterations with good context (205K)
- ✅ Mid-range budget projects
- ✅ General-purpose coding tasks

**Avoid For:**
- ❌ Ultra-large context needs (>205K)
- ❌ Specialized software engineering (use premium models)
- ❌ When absolute lowest cost required
- ❌ Vision/UI tasks (use multimodal models)

---

## Category 2: Advanced Reasoning Models 🧠

**Use When:** You need deep analysis, architectural planning, or complex problem-solving.

### google/gemini-2.5-flash (⭐ RECOMMENDED)

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-flash`
- **Model Version:** Gemini 2.5 Flash (2025-11-16)
- **Context Window:** 1,048,576 tokens
- **Pricing:** $0.30/1M input, $2.50/1M output (Verified: 2025-11-16)
- **Response Time:** Very fast (<2s typical)

**Best For:**
- **State-of-the-art workhorse for advanced reasoning, coding, mathematics, and scientific tasks**
- Built-in thinking capabilities for complex problems
- Massive context analysis (1M+ tokens!)
- Multi-file refactoring
- Large repository analysis
- Complex system comprehension
- Architecture planning with extensive context
- Vision and multimodal tasks (text + images)

**Trade-offs:**
- Moderate pricing ($1.40/1M avg)
- Lower quality than specialized premium models for most complex reasoning
- Better for breadth than depth

**When to Use:**
- ✅ **Advanced reasoning with massive context** (1M tokens at $1.40/1M)
- ✅ Whole codebase analysis
- ✅ Multi-file architectural planning
- ✅ Large-scale refactoring
- ✅ Built-in thinking mode for complex problems
- ✅ Fast iterations on large projects
- ✅ Vision tasks requiring UI analysis

**Avoid For:**
- ❌ Tasks requiring absolute highest quality (use specialized premium models)
- ❌ When budget is primary constraint (use budget models)
- ❌ Simple coding tasks (use fast coding models)
- ❌ Small context tasks (<100K tokens)

---

### openai/gpt-5 (⭐ RECOMMENDED)

- **Provider:** OpenAI
- **OpenRouter ID:** `openai/gpt-5`
- **Model Version:** GPT-5 (2025-11-16)
- **Context Window:** 400,000 tokens
- **Pricing:** $1.25/1M input, $10.00/1M output (Verified: 2025-11-16)
- **Response Time:** Fast (~3s typical)

**Best For:**
- **OpenAI's most advanced model with major improvements in reasoning and code quality**
- Complex algorithmic problem-solving
- Step-by-step reasoning and planning
- Reduced hallucination for critical tasks
- High-quality code generation
- Advanced architectural decisions
- Performance-critical implementations

**Trade-offs:**
- Premium pricing ($5.63/1M avg)
- Smaller context window than Gemini (400K vs 1M)
- Slower than Flash models
- Not specialized for coding (vs GPT-5.1 Codex)

**When to Use:**
- ✅ **Most advanced reasoning** from OpenAI
- ✅ Complex algorithmic tasks
- ✅ Step-by-step reasoning needs
- ✅ When premium quality reasoning is needed
- ✅ Critical code with reduced hallucination
- ✅ Quality over speed or cost

**Avoid For:**
- ❌ Large context needs (>400K)
- ❌ Budget-constrained projects
- ❌ Simple coding tasks
- ❌ When specialized software engineering focus needed (use GPT-5.1 Codex)

---

### openai/gpt-5.1-codex (⭐ RECOMMENDED)

- **Provider:** OpenAI
- **OpenRouter ID:** `openai/gpt-5.1-codex`
- **Model Version:** GPT-5.1 Codex (2025-11-16)
- **Context Window:** 400,000 tokens
- **Pricing:** $1.25/1M input, $10.00/1M output (Verified: 2025-11-16)
- **Response Time:** Fast (~3s typical)

**Best For:**
- **Specialized version of GPT-5.1 optimized for software engineering and coding workflows**
- Building projects from scratch
- Feature implementation
- Debugging and troubleshooting
- Code review and quality analysis
- Technical documentation
- Refactoring and optimization
- Software architecture

**Trade-offs:**
- Premium pricing ($5.63/1M avg)
- Smaller context window than Gemini (400K vs 1M)
- Slower than Flash models
- Less general-purpose than GPT-5

**When to Use:**
- ✅ **Specialized software engineering** tasks
- ✅ Building projects from scratch
- ✅ Feature implementation and debugging
- ✅ Code review requiring deep understanding
- ✅ Technical documentation
- ✅ Software architecture planning
- ✅ Quality over speed or cost

**Avoid For:**
- ❌ Large context needs (>400K)
- ❌ Budget-constrained projects
- ❌ Simple coding tasks
- ❌ Non-coding reasoning tasks (use GPT-5)

---

## Category 3: Vision & Multimodal Models 👁️

**Use When:** You need to analyze screenshots, diagrams, UI designs, or combine text with images.

### google/gemini-2.5-flash (⭐ RECOMMENDED)

See "Category 2: Advanced Reasoning Models" for full details.

**Vision-Specific Use Cases:**
- UI design validation from screenshots
- Chart and diagram analysis
- OCR and text extraction from images
- Multimodal reasoning (combining text + visual context)
- Design-to-code workflows

---

### qwen/qwen3-vl-235b-a22b-instruct (⭐ RECOMMENDED)

- **Provider:** Qwen (Alibaba)
- **OpenRouter ID:** `qwen/qwen3-vl-235b-a22b-instruct`
- **Model Version:** Qwen3 VL 235B A22B Instruct (2025-11-16)
- **Context Window:** 262,144 tokens
- **Pricing:** $0.22/1M input, $0.88/1M output (Verified: 2025-11-16)
- **Response Time:** Fast (~3s typical)

**Best For:**
- **Open-weight multimodal model unifying strong text generation with visual understanding**
- Image and video analysis
- Multilingual OCR
- Chart and table extraction
- Visual question answering
- Design validation
- Screenshot analysis

**Trade-offs:**
- Moderate pricing ($0.55/1M avg)
- Smaller context than Gemini (262K vs 1M)
- Less specialized for pure coding tasks

**When to Use:**
- ✅ **Affordable multimodal** with strong vision capabilities ($0.55/1M)
- ✅ OCR and text extraction from images
- ✅ Chart and table analysis
- ✅ Video understanding
- ✅ Visual question answering
- ✅ Design validation and UI analysis

**Avoid For:**
- ❌ Pure text coding tasks (use fast coding models)
- ❌ Large context needs (>262K)
- ❌ When absolute highest vision quality needed
- ❌ Budget-constrained projects (use budget models)

---

## Category 4: Budget-Friendly Models 💰

**Use When:** You need to minimize costs for high-volume or experimental tasks.

### openrouter/polaris-alpha (⭐ RECOMMENDED)

- **Provider:** OpenRouter
- **OpenRouter ID:** `openrouter/polaris-alpha`
- **Model Version:** Polaris Alpha (2025-11-16)
- **Context Window:** 256,000 tokens
- **Pricing:** FREE (logs all usage for research) (Verified: 2025-11-16)
- **Response Time:** Fast (~3s typical)

**Best For:**
- **FREE experimental cloaked model (early GPT-5.1 snapshot)**
- Excels at coding, tool calling, instruction following
- High-volume testing and experimentation
- Learning and exploration
- Budget-constrained projects
- Simple code comprehension

**Trade-offs:**
- **All usage is logged for research purposes**
- Experimental model (may change or be discontinued)
- Lower quality than premium models
- Not suitable for sensitive/proprietary code

**When to Use:**
- ✅ **Completely free** (no cost!)
- ✅ Experimental tasks and learning
- ✅ High-volume testing
- ✅ Public/open-source code review
- ✅ Quick prototyping
- ✅ Non-sensitive coding tasks

**Avoid For:**
- ❌ **Proprietary or sensitive code** (usage is logged!)
- ❌ Production-critical applications
- ❌ When privacy is required
- ❌ Security-sensitive code review

---

## Model Selection Decision Tree

Use this flowchart to choose the right model:

```
START: What is your primary need?

┌─ Architecture Planning or Complex Reasoning?
│  ├─ Need massive context (>400K) + speed → google/gemini-2.5-flash ⭐ ($1.40/1M, 1M)
│  ├─ Need highest quality reasoning → openai/gpt-5 ⭐ ($5.63/1M, 400K)
│  └─ Need specialized software engineering → openai/gpt-5.1-codex ⭐ ($5.63/1M, 400K)

┌─ Fast Code Review or Generation?
│  ├─ Ultra-fast + reasoning traces → x-ai/grok-code-fast-1 ⭐ ($0.85/1M, 256K)
│  └─ High-efficiency balanced → minimax/minimax-m2 ⭐ ($0.64/1M, 205K)

┌─ Vision or Multimodal Tasks?
│  ├─ Advanced reasoning + vision → google/gemini-2.5-flash ⭐ ($1.40/1M, 1M)
│  └─ OCR, charts, multilingual → qwen/qwen3-vl-235b-a22b-instruct ⭐ ($0.55/1M, 262K)

┌─ Budget is Top Priority?
│  └─ Free (logs usage) → openrouter/polaris-alpha ⭐ (FREE, 256K)

┌─ Not sure? → Start with x-ai/grok-code-fast-1 (fast + affordable + reasoning)
```

---

## Performance Benchmarks

### Speed Comparison (Typical Response Times)

| Model | Simple Task | Complex Task | Large Context |
|-------|-------------|--------------|---------------|
| x-ai/grok-code-fast-1 | <2s | 4-5s | 6s |
| minimax/minimax-m2 | <2s | 4-5s | 6s |
| google/gemini-2.5-flash | <2s | 3-4s | 5s |
| openai/gpt-5 | 3s | 5-6s | 7s |
| openai/gpt-5.1-codex | 3s | 5-6s | 7s |
| qwen/qwen3-vl-235b-a22b-instruct | 3s | 5-6s | 7s |
| openrouter/polaris-alpha | 3s | 5-6s | 7s |

**Notes:**
- Times are approximate and vary based on load
- "Large Context" = >100K tokens
- Reasoning models may be slower for chain-of-thought
- Free models may have additional queuing time

### Cost Comparison (Per 1M Tokens)

| Model | Input | Output | Average (1:1 ratio) |
|-------|-------|--------|---------------------|
| openrouter/polaris-alpha | FREE | FREE | FREE |
| qwen/qwen3-vl-235b-a22b-instruct | $0.22 | $0.88 | $0.55 |
| minimax/minimax-m2 | $0.255 | $1.02 | $0.64 |
| x-ai/grok-code-fast-1 | $0.20 | $1.50 | $0.85 |
| google/gemini-2.5-flash | $0.30 | $2.50 | $1.40 |
| openai/gpt-5 | $1.25 | $10.00 | $5.63 |
| openai/gpt-5.1-codex | $1.25 | $10.00 | $5.63 |

**Notes:**
- Prices from OpenRouter (subject to change)
- "Average" assumes equal input/output tokens
- Typical code review is ~70% input, 30% output

### Quality vs Cost Analysis

**Best Value for Code Review:**
1. **openrouter/polaris-alpha** - FREE experimental model (logs usage)
2. **minimax/minimax-m2** - High-efficiency coding ($0.64/1M)
3. **x-ai/grok-code-fast-1** - Ultra-fast coding ($0.85/1M)

**Best Quality:**
1. **openai/gpt-5** - Most advanced reasoning ($5.63/1M)
2. **openai/gpt-5.1-codex** - Specialized software engineering ($5.63/1M)
3. **google/gemini-2.5-flash** - Advanced reasoning + massive context ($1.40/1M)

**Best for Massive Context:**
1. **google/gemini-2.5-flash** - 1M tokens at $1.40/1M (fast reasoning + vision)

**Best for Vision/Multimodal:**
1. **google/gemini-2.5-flash** - Advanced reasoning + vision ($1.40/1M, 1M context)
2. **qwen/qwen3-vl-235b-a22b-instruct** - Affordable multimodal with OCR ($0.55/1M, 262K)

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
- google/gemini-2.5-flash (advanced reasoning + massive context - $1.40/1M)
- openai/gpt-5 (most advanced reasoning - $5.63/1M)
- openai/gpt-5.1-codex (specialized software engineering - $5.63/1M)

**Step 3:** Present options to user

AskUserQuestion with these options:

"Select AI models for architecture plan review:

**Recommended (Advanced Reasoning):**
• google/gemini-2.5-flash - Advanced reasoning, 1M context ($1.40/1M)
• openai/gpt-5 - Most advanced reasoning ($5.63/1M)
• openai/gpt-5.1-codex - Specialized software engineering ($5.63/1M)

**Fast & Affordable:**
• x-ai/grok-code-fast-1 - Ultra-fast architectural feedback ($0.85/1M)
• minimax/minimax-m2 - High-efficiency planning ($0.64/1M)

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
- openrouter/polaris-alpha (FREE) - Experimental model (logs usage)

**Run 2 parallel reviews:**
1. Claude Sonnet (internal, comprehensive)
2. Polaris Alpha (external, free)

**Total cost for 100K token review:**
- Claude Sonnet: ~$1.80
- Polaris Alpha: FREE
- **Grand Total: ~$1.80** (vs $9.00 for 3x Sonnet)
```

### Example 3: Vision Task Model Selection

**In UI validation workflow:**

```markdown
## UI Design Validation

**Task:** Compare Figma design screenshot to implemented UI

**Recommended models:**
1. google/gemini-2.5-flash
   - Advanced reasoning + vision
   - 1M token context
   - $1.40/1M
   - Strong UI analysis capabilities

2. qwen/qwen3-vl-235b-a22b-instruct
   - Affordable multimodal with OCR
   - 262K token context
   - $0.55/1M
   - Chart and table extraction

**Run with Claudish:**
npx claudish --model google/gemini-2.5-flash --stdin --quiet < prompt.txt
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
- [ ] Update Quick Reference section
- [ ] Update Quick Reference Table
- [ ] Update Decision Tree if needed
- [ ] Update Performance Benchmarks
- [ ] Run sync script
- [ ] Test in a command (verify AI can extract the model)

When removing a model:
- [ ] Remove from category section
- [ ] Remove from Quick Reference section
- [ ] Remove from Quick Reference Table
- [ ] Update Decision Tree if needed
- [ ] Update Performance Benchmarks
- [ ] Run sync script
- [ ] Update any commands that hardcoded the model

When updating pricing:
- [ ] Update in model entry
- [ ] Update in Quick Reference section
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
**Repository:** https://github.com/MadAppGang/magus
**License:** MIT
