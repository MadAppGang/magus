# Quick Reference Section Specification

**Version:** 1.0.0
**Created:** 2025-11-14
**Purpose:** Standard format for the "Quick Reference - Model IDs Only" section in recommended-models.md

---

## Overview

The **Quick Reference** section provides a concise, scannable list of recommended model IDs at the top of `recommended-models.md`. This section is optimized for:

- **AI agents** extracting model slugs programmatically
- **Human users** quickly finding OpenRouter model IDs
- **Copy-paste usage** in commands and configurations

---

## Section Location

**MUST** appear immediately after the document header (title, version, metadata) and **BEFORE** the "How to Use This Guide" section.

**Placement:**

```markdown
# Recommended AI Models for Code Development

**Version:** 1.1.1
**Last Updated:** 2025-11-14
**Pricing Last Verified:** 2025-11-14
**Purpose:** Curated OpenRouter model recommendations for code development tasks
**Maintained By:** MadAppGang Claude Code Team

---

## Quick Reference - Model IDs Only

[QUICK REFERENCE CONTENT HERE]

---

## How to Use This Guide

[Rest of document continues...]
```

---

## Format Specification

### Section Header

```markdown
## Quick Reference - Model IDs Only
```

**Rules:**
- Use H2 heading (`##`)
- Exact title: "Quick Reference - Model IDs Only"
- No additional description or subtitle

### Category Headers

```markdown
**Category Name (Purpose):**
```

**Format:**
- Bold text (double asterisks)
- Category name + purpose in parentheses
- Colon at end
- Blank line after

**Required Categories (in order):**
1. `**Coding (Fast):**` - Fast coding models
2. `**Reasoning (Architecture):**` - Advanced reasoning models
3. `**Vision (UI Analysis):**` - Vision/multimodal models
4. `**Budget (Free/Cheap):**` - Budget-friendly models

### Model Line Format

```markdown
- `slug` - Description, $X.XX/1M, XXK context ⭐
```

**Components:**
1. **List marker:** `-` (dash with space)
2. **Model slug:** Backtick-wrapped OpenRouter ID (e.g., `` `x-ai/grok-code-fast-1` ``)
3. **Separator:** ` - ` (space-dash-space)
4. **Description:** 3-7 word benefit/purpose (e.g., "Ultra-fast coding")
5. **Comma:** `, `
6. **Price:** `$X.XX/1M` format (2 decimal places, "/1M" suffix)
7. **Comma:** `, `
8. **Context:** Shorthand format (e.g., "256K", "1M", "128K")
9. **Recommended marker:** ` ⭐` (space + star emoji) - **ONLY for top pick in category**

**Examples:**

✅ **Correct:**
```markdown
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
- `google/gemini-2.5-flash` - Massive context, $0.19/1M, 1M ⭐
- `deepseek/deepseek-v3-0324` - Affordable coding, $0.21/1M, 64K
```

❌ **Incorrect:**
```markdown
- x-ai/grok-code-fast-1 - Ultra-fast coding, $0.85/1M, 256K ⭐  # Missing backticks
- `x-ai/grok-code-fast-1`: Ultra-fast coding ($0.85/1M), 256K ⭐  # Wrong separators
- `x-ai/grok-code-fast-1` - Very fast and affordable model for coding tasks, $0.85/1M, 256K ⭐  # Description too long
```

### Context Window Shorthand

**Rules:**
- Use "K" suffix for thousands (e.g., "32K", "64K", "128K", "256K")
- Use "M" suffix for millions (e.g., "1M", "1.049M")
- Round to nearest significant digit for clarity
- No spaces between number and suffix

**Examples:**
- 32,000 tokens → `32K`
- 64,000 tokens → `64K`
- 128,000 tokens → `128K`
- 256,000 tokens → `256K`
- 1,049,000 tokens → `1M` (rounded for readability)

### Price Format

**Rules:**
- Always use average price (assumes 1:1 input/output ratio)
- For tiered pricing models: use CHEAPEST tier price (see TIERED_PRICING_SPEC.md)
- Format: `$X.XX/1M` (dollar sign, 2 decimal places, "/1M" suffix)
- Add asterisk for tiered pricing: `$X.XX/1M*`
- No spaces
- FREE models: `FREE` (all caps, no "$" or "/1M")

**Examples:**
- $0.85 per million → `$0.85/1M`
- $0.19 per million → `$0.19/1M`
- Free model → `FREE`
- Tiered pricing (cheapest tier) → `$9.00/1M*`

### Tiered Pricing

**CRITICAL:** Some models have conditional pricing that increases dramatically at higher context windows.

**Format:**
```markdown
- `model/slug` - Description, $X.XX/1M*, XXK context
```

**Add asterisk (*)** to indicate tiered pricing. Add footnote at bottom of Quick Reference:
```markdown
*Tiered pricing - price shown is for lowest-cost tier. Higher context costs more.
```

**Context Window:** Use the cheapest tier's maximum context (NOT the full model capacity!)

**Example:**
```markdown
**Coding (Fast):**
- `anthropic/claude-sonnet-4-5` - Premium coding, $9.00/1M*, 200K ⭐

*Tiered pricing - price shown is for 0-200K tokens. Beyond 200K costs $90/1M (10x more).
```

**Reference:** See `shared/TIERED_PRICING_SPEC.md` (in repository root) for complete handling rules.

### Recommended Marker

**Rules:**
- Star emoji (⭐) indicates top recommendation in category
- Only 1-2 models per category should have star
- Space before emoji: ` ⭐`
- Must match models marked with `⭐ RECOMMENDED` in detailed sections

---

## Complete Example

```markdown
## Quick Reference - Model IDs Only

**Coding (Fast):**
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
- `google/gemini-2.5-flash` - Massive context, $0.19/1M, 1M ⭐
- `deepseek/deepseek-v3-0324` - Affordable coding, $0.21/1M, 64K

**Reasoning (Architecture):**
- `z-ai/glm-4.6` - Best for planning, $0.75/1M, 128K ⭐

**Vision (UI Analysis):**
- `qwen/qwen3-vl-235b` - Premium vision, $5.00/1M, 32K ⭐

**Budget (Free/Cheap):**
- `minimax/minimax-m2` - FREE, 128K ⭐
- `google/gemini-2.5-flash` - Ultra-cheap massive context, $0.19/1M, 1M
```

---

## Selection Criteria

### Which Models to Include

**Include if:**
- ✅ Model has `⭐ RECOMMENDED` status in detailed sections
- ✅ Model is top 1-3 in category by popularity/usefulness
- ✅ Model provides unique value (price, speed, context, capabilities)

**Exclude if:**
- ❌ Model is deprecated or outdated
- ❌ Model is redundant with better options
- ❌ Model is not in top 15 OpenRouter models (except special cases)

### Category Limits

**Maximum models per category:**
- **Coding:** 3 models (fast, cheap, balanced)
- **Reasoning:** 2 models (premium, mid-tier)
- **Vision:** 1-2 models (premium only)
- **Budget:** 2 models (free, ultra-cheap)

**Total:** 6-9 models maximum in Quick Reference

---

## Maintenance Rules

### When to Update Quick Reference

**Update when:**
- ✅ New model becomes top recommendation (gets ⭐ in detailed section)
- ✅ Pricing changes significantly (>20% change)
- ✅ Model is removed from OpenRouter
- ✅ Better alternative appears in category

**Don't update for:**
- ❌ Minor pricing adjustments (<10%)
- ❌ Models that aren't top recommendations
- ❌ Cosmetic description changes

### Update Process

1. **Update detailed sections first** (add ⭐ RECOMMENDED markers)
2. **Then update Quick Reference** to match
3. **Verify consistency:** Quick Reference ⭐ models must match detailed section ⭐ models
4. **Sync to plugins:** Run `bun run scripts/sync-shared.ts`

### Validation Checklist

Before committing changes:

- [ ] Quick Reference appears before "How to Use This Guide"
- [ ] All category headers present and in correct order
- [ ] Model slugs wrapped in backticks
- [ ] Price format is `$X.XX/1M` (or `FREE`)
- [ ] Context format is shorthand (e.g., "256K", "1M")
- [ ] ⭐ markers match detailed sections
- [ ] 6-9 models total (not too many, not too few)
- [ ] Descriptions are concise (3-7 words)
- [ ] No typos in model slugs (copy from OpenRouter exactly)

---

## AI Agent Instructions

When updating `recommended-models.md`, follow this algorithm:

```typescript
// Step 1: Extract recommended models from detailed sections
const recommendedModels = [];
for (const category of ['coding', 'reasoning', 'vision', 'budget']) {
  const models = extractModelsWithStar(category); // Find "⭐ RECOMMENDED"
  recommendedModels.push(...models.slice(0, 3)); // Max 3 per category
}

// Step 2: Build Quick Reference section
const quickRef = [
  "## Quick Reference - Model IDs Only",
  "",
  "**Coding (Fast):**",
  ...formatModelLines(recommendedModels.filter(m => m.category === 'coding')),
  "",
  "**Reasoning (Architecture):**",
  ...formatModelLines(recommendedModels.filter(m => m.category === 'reasoning')),
  "",
  "**Vision (UI Analysis):**",
  ...formatModelLines(recommendedModels.filter(m => m.category === 'vision')),
  "",
  "**Budget (Free/Cheap):**",
  ...formatModelLines(recommendedModels.filter(m => m.category === 'budget')),
];

// Step 3: Format each model line
function formatModelLine(model) {
  const context = formatContext(model.context_window); // "256K", "1M", etc
  const price = model.free ? "FREE" : `$${model.avgPrice.toFixed(2)}/1M`;
  const star = model.recommended ? " ⭐" : "";
  const desc = model.quickDescription; // Must be 3-7 words

  return `- \`${model.slug}\` - ${desc}, ${price}, ${context}${star}`;
}

// Step 4: Insert at correct location (after metadata, before "How to Use")
const sections = parseMarkdown(content);
const metadataEndIndex = findSectionEnd("metadata");
const howToUseIndex = findSectionStart("How to Use This Guide");

insertSection(quickRef, metadataEndIndex + 1);
```

---

## Examples from Real Models

### Coding Category

```markdown
**Coding (Fast):**
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
- `google/gemini-2.5-flash` - Massive context, $0.19/1M, 1M ⭐
- `deepseek/deepseek-v3-0324` - Affordable coding, $0.21/1M, 64K
```

**Description rules:**
- "Ultra-fast coding" - Emphasizes primary benefit (speed)
- "Massive context" - Highlights unique feature (1M tokens)
- "Affordable coding" - Focus on value proposition (price)

### Reasoning Category

```markdown
**Reasoning (Architecture):**
- `z-ai/glm-4.6` - Best for planning, $0.75/1M, 128K ⭐
```

**Description rules:**
- "Best for planning" - Clear use case
- Single model OK if it's dominant recommendation

### Vision Category

```markdown
**Vision (UI Analysis):**
- `qwen/qwen3-vl-235b` - Premium vision, $5.00/1M, 32K ⭐
```

**Description rules:**
- "Premium vision" - Quality indicator + capability
- Higher prices OK for specialized capabilities

### Budget Category

```markdown
**Budget (Free/Cheap):**
- `minimax/minimax-m2` - FREE, 128K ⭐
- `google/gemini-2.5-flash` - Ultra-cheap massive context, $0.19/1M, 1M
```

**Description rules:**
- "FREE" in price field (all caps, no "/1M")
- Can include same model in multiple categories if relevant
- "Ultra-cheap massive context" - Emphasizes value proposition

---

## Common Mistakes to Avoid

### ❌ Wrong Format

```markdown
# Quick Reference  # Wrong heading level (should be ##)

Coding Models:  # Missing bold, wrong format

x-ai/grok-code-fast-1 - Ultra-fast coding, $0.85/1M, 256K ⭐  # Missing backticks

- `x-ai/grok-code-fast-1` Ultra-fast coding $0.85/1M 256K ⭐  # Missing separators

- `x-ai/grok-code-fast-1` - This is an incredibly fast coding model that's great for rapid development, $0.85/1M, 256K ⭐  # Description too long
```

### ✅ Correct Format

```markdown
## Quick Reference - Model IDs Only

**Coding (Fast):**
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
```

---

## Version History

- **1.0.0** (2025-11-14) - Initial specification

---

**Maintained By:** MadAppGang Claude Code Team
**Repository:** https://github.com/MadAppGang/magus
**License:** MIT
