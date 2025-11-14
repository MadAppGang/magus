# AI Model Recommendations - File Format Guide

**Version:** 2.0.0
**Updated:** 2025-11-14
**Breaking Change:** Simplified from complex XML schema to Quick Reference approach

---

## Overview

We maintain **two files** for AI model recommendations:

| File | Format | Purpose | Best For |
|------|--------|---------|----------|
| `recommended-models.md` | Markdown | Comprehensive guide with Quick Reference section | AI agents + humans |
| `recommended-models.xml` | Minimal XML | Machine-readable quick reference only | Programmatic parsing |

**Primary file:** `recommended-models.md` - Contains Quick Reference + comprehensive guidance

---

## Quick Reference Format (Both Files)

Both files now include a **Quick Reference** section at the top with just model slugs and essential metadata.

### Markdown Format

See `/Users/jack/mag/claude-code/shared/QUICK_REFERENCE_SPEC.md` for complete specification.

**Example:**
```markdown
## Quick Reference - Model IDs Only

**Coding (Fast):**
- `x-ai/grok-code-fast-1` - Ultra-fast coding, $0.85/1M, 256K ⭐
- `google/gemini-2.5-flash` - Massive context, $0.19/1M, 1M ⭐

**Reasoning (Architecture):**
- `z-ai/glm-4.6` - Best for planning, $0.75/1M, 128K ⭐
```

### XML Format (Minimal)

**Schema:**
```xml
<models version="1.1.1" updated="2025-11-14">
  <coding>
    <model slug="provider/model-id" price="0.85" context="256K" recommended="true" />
  </coding>
  <reasoning>...</reasoning>
  <vision>...</vision>
  <budget>...</budget>
</models>
```

**Attributes:**
- `slug` (string) - OpenRouter model ID
- `price` (decimal) - Average cost per 1M tokens (0.00 for free models)
- `context` (string) - Context window shorthand (e.g., "256K", "1M")
- `recommended` (boolean) - Optional, only present if `true`
- `free` (boolean) - Optional, only present if `true`

**Complete Example:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<models version="1.1.1" updated="2025-11-14">

  <coding>
    <model slug="x-ai/grok-code-fast-1" price="0.85" context="256K" recommended="true" />
    <model slug="google/gemini-2.5-flash" price="0.19" context="1M" recommended="true" />
    <model slug="deepseek/deepseek-v3-0324" price="0.21" context="64K" />
  </coding>

  <reasoning>
    <model slug="z-ai/glm-4.6" price="0.75" context="128K" recommended="true" />
  </reasoning>

  <vision>
    <model slug="qwen/qwen3-vl-235b" price="5.00" context="32K" recommended="true" />
  </vision>

  <budget>
    <model slug="minimax/minimax-m2" price="0.00" context="128K" free="true" recommended="true" />
  </budget>

</models>
```

---

## When to Use Each Format

### Use Markdown (`recommended-models.md`)

**Best for:**
- ✅ AI agents extracting model recommendations with context
- ✅ Human users browsing options
- ✅ Understanding use cases, trade-offs, decision trees
- ✅ Integration examples and guidance

**Advantages:**
- Quick Reference section at top for fast extraction
- Comprehensive guidance for smart decision-making
- Searchable descriptions and use cases
- No parsing libraries needed (LLMs read markdown natively)

### Use XML (`recommended-models.xml`)

**Best for:**
- ✅ External tools requiring structured data
- ✅ XPath queries in non-LLM contexts
- ✅ Language-agnostic programmatic access

**Advantages:**
- Standard XML parsers available in all languages
- Type-safe attribute access
- XPath query support

**Note:** Most AI agents should use the markdown file's Quick Reference section instead.

---

## Usage Examples

### AI Agent: Extract Coding Models (Markdown)

**Prompt:**
```
Read shared/recommended-models.md and extract all model slugs
from the "Coding (Fast)" section of the Quick Reference.
```

**Implementation:**
```typescript
const md = await readFile('shared/recommended-models.md');

// Extract Quick Reference section
const quickRefSection = md.match(/## Quick Reference.*?\n---/s)[0];

// Extract coding models (simple regex)
const codingSection = quickRefSection.match(/\*\*Coding \(Fast\):\*\*(.*?)\*\*/s)[1];
const models = [...codingSection.matchAll(/`([^`]+)`/g)].map(m => m[1]);

console.log(models);
// ["x-ai/grok-code-fast-1", "google/gemini-2.5-flash", "deepseek/deepseek-v3-0324"]
```

### External Tool: Parse XML (XPath)

**Query:**
```xpath
//coding/model[@recommended='true']/@slug
```

**Result:**
```
x-ai/grok-code-fast-1
google/gemini-2.5-flash
```

**Python Example:**
```python
import xml.etree.ElementTree as ET

tree = ET.parse('shared/recommended-models.xml')
coding_models = tree.findall('.//coding/model[@recommended="true"]')

for model in coding_models:
    print(f"{model.get('slug')}: ${model.get('price')}/1M")

# Output:
# x-ai/grok-code-fast-1: $0.85/1M
# google/gemini-2.5-flash: $0.19/1M
```

---

## Maintenance

### Update Process

**Single source of truth:** `recommended-models.md`

1. **Update markdown file:**
   - Edit Quick Reference section (top)
   - Update detailed sections (if needed)
   - Use `/update-models` command for automated updates

2. **Sync XML file:**
   - Manually update `recommended-models.xml` to match Quick Reference
   - OR use automated script (future enhancement)

3. **Sync to plugins:**
   ```bash
   bun run scripts/sync-shared.ts
   ```

### Validation Checklist

Before committing:

- [ ] Quick Reference in markdown matches XML content
- [ ] Version numbers match in both files (`version="1.1.1"`)
- [ ] Updated dates match (`updated="2025-11-14"`)
- [ ] ⭐ recommended markers consistent across files
- [ ] Model slugs identical in both files
- [ ] Prices match (markdown shows `$0.85/1M`, XML shows `price="0.85"`)

---

## Migration Notes (v1.0 → v2.0)

**What Changed:**

❌ **Removed (v1.0):**
- Complex XML schema with nested elements
- Detailed metadata in XML (provider, name, capabilities, best_for, avoid_for)
- 215-line verbose XML file

✅ **Added (v2.0):**
- Quick Reference section in markdown (top of file)
- Minimal XML with just slugs + essential attributes
- 37-line concise XML file
- Single source of truth (markdown)

**Migration Path:**

Old code using complex XML:
```typescript
// OLD: Complex parsing
const provider = model.querySelector('provider').textContent;
const bestFor = model.querySelectorAll('best_for use_case');
```

New code using Quick Reference (markdown):
```typescript
// NEW: Simple regex on Quick Reference section
const quickRef = md.match(/## Quick Reference.*?\n---/s)[0];
const models = [...quickRef.matchAll(/`([^`]+)`/g)].map(m => m[1]);
```

Or minimal XML:
```typescript
// NEW: Simple attributes only
const slug = model.getAttribute('slug');
const price = model.getAttribute('price');
const recommended = model.getAttribute('recommended') === 'true';
```

---

## Questions and Support

**For specification details:**
- See `shared/QUICK_REFERENCE_SPEC.md` for markdown format rules

**For technical issues:**
- Contact: Jack Rudenko (i@madappgang.com)
- Repository: https://github.com/MadAppGang/claude-code

---

**Maintained By:** MadAppGang Claude Code Team
**Repository:** https://github.com/MadAppGang/claude-code
**License:** MIT
