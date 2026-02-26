# Tiered Pricing Handling Specification

**Version:** 1.0.0
**Created:** 2025-11-14
**Purpose:** Standard approach for handling models with conditional/tiered pricing

---

## Problem Statement

Some AI models have **tiered pricing** based on context usage, where the cost per token increases dramatically at higher context windows.

### Example: Claude Sonnet 4.5

**OpenRouter Pricing:**
```
Context Window: 1,000,000 tokens
Pricing Tiers:
  • 0-200K tokens:   $3/1M input,  $15/1M output   → avg $9/1M
  • 200K-1M tokens: $30/1M input, $150/1M output  → avg $90/1M (10x more!)
```

**Problem:**
If we record this as `$49.50/1M, 1M context` (simple average), users will expect cheap 1M context - but reality is:
- First 200K tokens: $9/1M (reasonable)
- Beyond 200K: $90/1M (extremely expensive!)

**This is misleading** and can cause budget surprises.

---

## Solution: Use Cheapest Tier Pricing

### Core Principle

**Always represent the model at its MOST AFFORDABLE pricing tier.**

For tiered pricing models:
1. ✅ **Use the lowest-priced tier** (usually the smallest context range)
2. ✅ **Set context window to that tier's maximum** (e.g., 200K, not 1M)
3. ✅ **Record the price for that tier only** (don't average across tiers)
4. ✅ **Add metadata note** about tiered pricing

### Why This Approach?

✅ **Accurate expectations** - Users know the real cost for typical usage
✅ **Budget-friendly** - Encourages staying within cheap tier
✅ **Honest representation** - No hidden cost surprises
✅ **Comparable** - Can fairly compare models on price

Most users won't use >200K context regularly, so showing the affordable tier is more representative.

---

## Detection Algorithm

### Step 1: Detect Tiered Pricing

When scraping OpenRouter, check if pricing has multiple tiers:

```typescript
interface PricingTier {
  minTokens: number;      // 0, 200000, etc
  maxTokens: number;      // 200000, 1000000, etc
  inputPrice: number;     // per 1M tokens
  outputPrice: number;    // per 1M tokens
  avgPrice: number;       // (input + output) / 2
}

function hasTieredPricing(model: OpenRouterModel): boolean {
  // Check if model.pricing is array with multiple entries
  return Array.isArray(model.pricing) && model.pricing.length > 1;
}
```

**Common Patterns:**

✅ **Tiered Pricing:**
```json
{
  "pricing": [
    { "range": "0-200K", "input": 3, "output": 15 },
    { "range": "200K-1M", "input": 30, "output": 150 }
  ]
}
```

✅ **Single Flat Pricing:**
```json
{
  "pricing": { "input": 0.85, "output": 1.50 }
}
```

### Step 2: Select Cheapest Tier

```typescript
function selectCheapestTier(tiers: PricingTier[]): PricingTier {
  // Sort tiers by average price (ascending)
  const sorted = tiers.sort((a, b) => a.avgPrice - b.avgPrice);

  // Return cheapest tier
  return sorted[0];
}
```

**Example:**
```typescript
const tiers = [
  { range: "0-200K",   input: 3,  output: 15,  avg: 9   },
  { range: "200K-1M",  input: 30, output: 150, avg: 90  }
];

const cheapest = selectCheapestTier(tiers);
// Returns: { range: "0-200K", input: 3, output: 15, avg: 9 }
```

### Step 3: Extract Context Window for Tier

```typescript
function getContextForTier(tier: PricingTier): number {
  // Use the MAX tokens for this tier
  return tier.maxTokens;
}
```

**Example:**
```typescript
const tier = { range: "0-200K", minTokens: 0, maxTokens: 200000 };
const context = getContextForTier(tier);
// Returns: 200000 (record as "200K" in file)
```

---

## Recording in Files

### Quick Reference Format (Markdown)

**Format:**
```markdown
- `model/slug` - Description, $X.XX/1M*, XXK context
```

**Add asterisk (*)** to price if tiered pricing exists.

**Example:**
```markdown
**Coding (Fast):**
- `anthropic/claude-sonnet-4-5` - Premium coding, $9.00/1M*, 200K ⭐

*Tiered pricing - price shown is for 0-200K tokens. Higher context costs more.
```

### Quick Reference XML

**Format:**
```xml
<model slug="model/slug" price="9.00" context="200K" tiered="true" recommended="true" />
```

**Add `tiered="true"`** attribute if model has tiered pricing.

**Example:**
```xml
<coding>
  <model slug="anthropic/claude-sonnet-4-5" price="9.00" context="200K" tiered="true" recommended="true" />
</coding>
```

### Detailed Section (Markdown)

**Add pricing tier information:**

```markdown
### anthropic/claude-sonnet-4-5 (⭐ RECOMMENDED)

- **Provider:** Anthropic
- **OpenRouter ID:** `anthropic/claude-sonnet-4-5`
- **Model Version:** Claude Sonnet 4.5 (2025-11-14)
- **Context Window:** 200,000 tokens (cheapest tier)
- **Full Context:** 1,000,000 tokens (tiered pricing)
- **Pricing:** $3/1M input, $15/1M output (0-200K tokens)
- **Pricing Note:** ⚠️ **Tiered pricing** - $30/$150 per 1M beyond 200K tokens (10x more expensive)
- **Response Time:** Fast (~3s typical)

**Best For:**
- Premium code generation (within 200K context)
- Complex reasoning tasks
- Production-critical implementations

**Trade-offs:**
- ⚠️ **Expensive beyond 200K** - Stay within first tier for cost efficiency
- Premium pricing even at base tier ($9/1M avg)
- 10x price increase beyond 200K tokens

**When to Use:**
- ✅ **Premium quality needed** (best-in-class coding)
- ✅ **Budget allows** $9/1M for top-tier results
- ✅ **Context < 200K** (avoid expensive tier)
- ✅ Production code, critical systems

**Avoid For:**
- ❌ **Large context needs** (>200K) - use Gemini Flash (1M at $0.19/1M flat)
- ❌ **Budget projects** - use free/cheap alternatives
- ❌ **High-volume tasks** - costs add up quickly
```

---

## Examples

### Example 1: Claude Sonnet 4.5 (Tiered)

**OpenRouter Data:**
```json
{
  "id": "anthropic/claude-sonnet-4-5",
  "context_length": 1000000,
  "pricing": [
    { "range": "0-200000", "prompt": 3, "completion": 15 },
    { "range": "200000-1000000", "prompt": 30, "completion": 150 }
  ]
}
```

**Processing:**
1. Detect tiered pricing: ✅ Yes (2 tiers)
2. Calculate averages:
   - Tier 1: ($3 + $15) / 2 = **$9/1M** (0-200K)
   - Tier 2: ($30 + $150) / 2 = **$90/1M** (200K-1M)
3. Select cheapest: Tier 1 ($9/1M)
4. Set context: 200K (tier 1 max)

**Record in Quick Reference:**
```markdown
- `anthropic/claude-sonnet-4-5` - Premium coding, $9.00/1M*, 200K ⭐

*Tiered pricing - price shown is for 0-200K tokens.
```

**Record in XML:**
```xml
<model slug="anthropic/claude-sonnet-4-5" price="9.00" context="200K" tiered="true" recommended="true" />
```

### Example 2: Gemini 2.5 Flash (Flat Pricing)

**OpenRouter Data:**
```json
{
  "id": "google/gemini-2.5-flash",
  "context_length": 1049000,
  "pricing": {
    "prompt": 0.075,
    "completion": 0.30
  }
}
```

**Processing:**
1. Detect tiered pricing: ❌ No (single tier)
2. Calculate average: ($0.075 + $0.30) / 2 = **$0.1875/1M**
3. Round for display: **$0.19/1M**
4. Set context: 1M (full context window)

**Record in Quick Reference:**
```markdown
- `google/gemini-2.5-flash` - Massive context, $0.19/1M, 1M ⭐
```

**Record in XML:**
```xml
<model slug="google/gemini-2.5-flash" price="0.19" context="1M" recommended="true" />
```

### Example 3: GPT-4 Turbo (Tiered)

**OpenRouter Data:**
```json
{
  "id": "openai/gpt-4-turbo",
  "context_length": 128000,
  "pricing": [
    { "range": "0-64000", "prompt": 10, "completion": 30 },
    { "range": "64000-128000", "prompt": 20, "completion": 60 }
  ]
}
```

**Processing:**
1. Detect tiered pricing: ✅ Yes (2 tiers)
2. Calculate averages:
   - Tier 1: ($10 + $30) / 2 = **$20/1M** (0-64K)
   - Tier 2: ($20 + $60) / 2 = **$40/1M** (64K-128K)
3. Select cheapest: Tier 1 ($20/1M)
4. Set context: 64K (tier 1 max)

**Record in Quick Reference:**
```markdown
- `openai/gpt-4-turbo` - Advanced reasoning, $20.00/1M*, 64K
```

---

## Model-Scraper Agent Instructions

Update `.claude/agents/model-scraper.md` with these instructions:

```markdown
## CRITICAL: Tiered Pricing Handling

When scraping models from OpenRouter, ALWAYS check for tiered/conditional pricing:

### Detection

**Check if pricing structure has multiple tiers:**
- Single object: `{ "prompt": 0.85, "completion": 1.50 }` → Flat pricing
- Array of objects: `[{ "range": "0-200K", ... }, ...]` → Tiered pricing

### Selection Logic (Tiered Pricing)

**IF model has tiered pricing:**

1. **Calculate average for each tier:**
   ```
   avgPrice = (promptPrice + completionPrice) / 2
   ```

2. **Select cheapest tier:**
   ```
   selectedTier = tier with lowest avgPrice
   ```

3. **Set context window to tier maximum:**
   ```
   context = selectedTier.maxTokens
   ```

4. **Record tier metadata:**
   ```
   tiered: true
   tierNote: "Tiered pricing - price shown is for 0-XXK tokens"
   ```

### Example Code

```typescript
// Detect tiered pricing
const tiers = Array.isArray(model.pricing) ? model.pricing : [model.pricing];

if (tiers.length > 1) {
  // Tiered pricing detected
  const tiersWithAvg = tiers.map(tier => ({
    ...tier,
    avgPrice: (tier.prompt + tier.completion) / 2,
    maxTokens: parseRange(tier.range).max  // e.g., "0-200K" → 200000
  }));

  // Select cheapest tier
  const cheapest = tiersWithAvg.sort((a, b) => a.avgPrice - b.avgPrice)[0];

  return {
    slug: model.id,
    price: cheapest.avgPrice,
    context: formatContext(cheapest.maxTokens),  // "200K"
    tiered: true,
    tierNote: `Tiered pricing - price shown is for ${tier.range}`,
    fullContext: model.context_length  // Keep for reference
  };
} else {
  // Flat pricing
  const tier = tiers[0];
  return {
    slug: model.id,
    price: (tier.prompt + tier.completion) / 2,
    context: formatContext(model.context_length),
    tiered: false
  };
}
```

### Validation

**Before recording model, verify:**
- [ ] If tiered pricing detected, cheapest tier selected
- [ ] Context matches selected tier maximum (not full context)
- [ ] Price matches selected tier average
- [ ] Metadata includes `tiered: true` flag
- [ ] Detailed section includes pricing warning
```

---

## Update Command Integration

Update `/update-models` command to handle tiered pricing:

```markdown
## PHASE 2: Scrape and Filter Models

**Step 4: Parse pricing for each model**

```typescript
for (const model of topModels) {
  // Detect tiered pricing
  const hasTiers = Array.isArray(model.pricing) && model.pricing.length > 1;

  if (hasTiers) {
    console.log(`⚠️  Tiered pricing detected: ${model.id}`);

    // Calculate averages for all tiers
    const tiers = model.pricing.map(tier => ({
      range: tier.range,
      avg: (tier.prompt + tier.completion) / 2
    }));

    // Select cheapest
    const cheapest = tiers.sort((a, b) => a.avg - b.avg)[0];

    console.log(`   Selected tier: ${cheapest.range} ($${cheapest.avg}/1M)`);
    console.log(`   Full context: ${model.context_length} (not advertised)`);

    // Record with tier context
    processedModel = {
      ...model,
      price: cheapest.avg,
      context: parseRange(cheapest.range).max,
      tiered: true
    };
  } else {
    // Flat pricing
    processedModel = {
      ...model,
      price: (model.pricing.prompt + model.pricing.completion) / 2,
      context: model.context_length,
      tiered: false
    };
  }
}
```
```

---

## Validation Checklist

When reviewing scraped models:

**For EACH model with tiered pricing:**
- [ ] Price reflects cheapest tier (not averaged across all tiers)
- [ ] Context window matches tier maximum (e.g., 200K, not 1M)
- [ ] Quick Reference includes asterisk: `$9.00/1M*`
- [ ] XML includes `tiered="true"` attribute
- [ ] Detailed section has pricing warning with ⚠️ emoji
- [ ] Detailed section explains tier structure
- [ ] "Avoid For" section mentions expensive higher tiers

**For models with flat pricing:**
- [ ] Price is simple average of input/output
- [ ] Context window is full model capacity
- [ ] No asterisk or tiered metadata

---

## Common Models with Tiered Pricing

**Known models to watch for:**
- `anthropic/claude-sonnet-4-5` (200K/$9 → 1M/$90)
- `anthropic/claude-opus-4` (similar tiering)
- `openai/gpt-4-turbo` (64K/$20 → 128K/$40)
- `openai/o1-preview` (tiered at 32K boundary)

**Models with flat pricing:**
- `x-ai/grok-code-fast-1` (flat $0.85/1M, 256K)
- `google/gemini-2.5-flash` (flat $0.19/1M, 1M)
- `deepseek/deepseek-v3-0324` (flat $0.21/1M, 64K)

---

## Future Enhancements

### Option 1: Show Both Tiers

For advanced users, show both pricing tiers:

```markdown
- `anthropic/claude-sonnet-4-5` - Premium coding, $9/1M (0-200K) or $90/1M (200K-1M) ⭐
```

**Pros:** Full transparency
**Cons:** Cluttered, confusing

### Option 2: Tier Selector in UI

Future CLI could ask user:

```
Select pricing tier for claude-sonnet-4-5:
  1. Budget ($9/1M, 200K context) - Recommended
  2. Extended ($90/1M, 1M context)
```

### Option 3: Auto-Tier Based on Task

Detect task context needs and auto-select tier:

```typescript
if (estimatedTokens < 200000) {
  useTier = "budget";  // $9/1M
} else {
  warnUser("This task may use >200K tokens, costs will increase 10x");
  useTier = "extended";  // $90/1M
}
```

---

## Questions and Support

**For tiered pricing detection issues:**
- Check OpenRouter API response format
- Verify tier boundaries are correctly parsed
- Ensure cheapest tier is selected (not first tier!)

**For technical issues:**
- Contact: Jack Rudenko (i@madappgang.com)
- Repository: https://github.com/MadAppGang/magus

---

**Maintained By:** MadAppGang Claude Code Team
**Repository:** https://github.com/MadAppGang/magus
**License:** MIT
