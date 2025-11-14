# AI Model XML Format Guide

**Version:** 1.0.0
**Created:** 2025-11-14
**Purpose:** Standard XML format for AI-readable model recommendations

---

## Overview

This guide defines the **standard XML format** for AI model recommendations. AI agents should parse the XML file (`recommended-models.xml`) instead of the markdown file for programmatic access to model metadata.

**Files:**
- **Data:** `shared/recommended-models.xml` (machine-readable, structured)
- **Docs:** `shared/recommended-models.md` (human-readable, comprehensive)
- **Guide:** `shared/XML_FORMAT_GUIDE.md` (this file)

---

## Why XML Format?

### Benefits for AI Agents

✅ **Simple Parsing** - No markdown parsing, regex, or fuzzy matching needed
✅ **Structured Data** - Clear hierarchy with predictable paths
✅ **Type Safety** - Explicit field types (numbers, booleans, strings)
✅ **Extensible** - Easy to add new fields without breaking parsers
✅ **Standard** - Universal XML parsers available in all languages

### When to Use Each Format

| Format | Use Case | Best For |
|--------|----------|----------|
| **XML** (`recommended-models.xml`) | AI agents extracting model metadata | Programmatic access, structured queries |
| **Markdown** (`recommended-models.md`) | Human users reading recommendations | Comprehensive guidance, decision trees, examples |

---

## XML Schema

### Root Element

```xml
<models version="1.1.1" updated="2025-11-14">
  <!-- Categories and models here -->
</models>
```

**Attributes:**
- `version` (string) - File version (semver)
- `updated` (YYYY-MM-DD) - Last update date

### Category Element

```xml
<category name="coding" icon="⚡" description="Fast code generation and review">
  <!-- Models here -->
</category>
```

**Attributes:**
- `name` (string) - Category ID: `coding`, `reasoning`, `vision`, `budget`
- `icon` (string) - Display emoji
- `description` (string) - Category purpose

**Categories:**
- **coding** - Fast coding models (speed priority)
- **reasoning** - Advanced reasoning models (quality priority)
- **vision** - Vision/multimodal models (UI analysis)
- **budget** - Budget-friendly models (cost priority)

### Model Element

```xml
<model rank="1">
  <slug>x-ai/grok-code-fast-1</slug>
  <provider>xAI</provider>
  <name>Grok Code Fast 1</name>
  <context_window>256000</context_window>

  <pricing>
    <input>0.20</input>
    <output>1.50</output>
    <average>0.85</average>
    <currency>USD</currency>
    <unit>per_million_tokens</unit>
    <free>false</free> <!-- Optional, only present if true -->
  </pricing>

  <performance>
    <speed>ultra_fast</speed> <!-- ultra_fast | very_fast | fast | moderate | slow -->
    <response_time>2</response_time>
    <response_unit>seconds</response_unit>
  </performance>

  <capabilities> <!-- Optional -->
    <vision>true</vision>
    <multimodal>true</multimodal>
  </capabilities>

  <best_for>
    <use_case>Ultra-fast code reviews</use_case>
    <use_case>Quick syntax and logic checks</use_case>
  </best_for>

  <avoid_for>
    <scenario>Complex architectural decisions</scenario>
  </avoid_for>

  <recommended>true</recommended>
</model>
```

**Model Attributes:**
- `rank` (integer) - OpenRouter popularity rank (1 = most popular)

**Model Fields:**
- `slug` (string) - OpenRouter model ID (provider/model-name)
- `provider` (string) - Provider name
- `name` (string) - Human-readable model name
- `context_window` (integer) - Max tokens
- `pricing/input` (decimal) - Input cost per 1M tokens
- `pricing/output` (decimal) - Output cost per 1M tokens
- `pricing/average` (decimal) - Average cost (assumes 1:1 ratio)
- `pricing/free` (boolean) - Optional, only present if true
- `performance/speed` (enum) - Speed tier
- `performance/response_time` (integer) - Typical response seconds
- `capabilities/vision` (boolean) - Optional, multimodal support
- `best_for/use_case` (list) - Recommended use cases
- `avoid_for/scenario` (list) - Not recommended scenarios
- `recommended` (boolean) - Top pick in category

---

## Usage Examples

### Example 1: Extract All Coding Models

**XPath Query:**
```xpath
//category[@name='coding']/model
```

**Python Example:**
```python
import xml.etree.ElementTree as ET

tree = ET.parse('shared/recommended-models.xml')
root = tree.getroot()

coding_models = root.findall(".//category[@name='coding']/model")

for model in coding_models:
    slug = model.find('slug').text
    price = model.find('pricing/average').text
    print(f"{slug}: ${price}/1M")
```

**Output:**
```
x-ai/grok-code-fast-1: $0.85/1M
google/gemini-2.5-flash: $0.19/1M
deepseek/deepseek-v3-0324: $0.21/1M
```

### Example 2: Find Budget Models Under $1/1M

**XPath Query:**
```xpath
//model[pricing/average < 1.0]
```

**JavaScript Example:**
```javascript
const fs = require('fs');
const { DOMParser } = require('xmldom');
const xpath = require('xpath');

const xml = fs.readFileSync('shared/recommended-models.xml', 'utf8');
const doc = new DOMParser().parseFromString(xml);

const budgetModels = xpath.select("//model[pricing/average < 1.0]", doc);

budgetModels.forEach(model => {
  const slug = xpath.select("string(slug)", model);
  const price = xpath.select("number(pricing/average)", model);
  console.log(`${slug}: $${price}/1M`);
});
```

### Example 3: Get Recommended Reasoning Models

**XPath Query:**
```xpath
//category[@name='reasoning']/model[@recommended='true']
```

**TypeScript Example:**
```typescript
import * as fs from 'fs';
import { parseString } from 'xml2js';

const xml = fs.readFileSync('shared/recommended-models.xml', 'utf8');

parseString(xml, (err, result) => {
  const reasoningCategory = result.models.category.find(
    cat => cat.$.name === 'reasoning'
  );

  const recommended = reasoningCategory.model.filter(
    m => m.$.recommended === 'true'
  );

  recommended.forEach(model => {
    console.log(model.slug[0]); // z-ai/glm-4.6
  });
});
```

### Example 4: AI Agent Model Selection

**Prompt for AI Agent:**
```markdown
Read ${CLAUDE_PLUGIN_ROOT}/recommended-models.xml and extract all models
in the "coding" category with average pricing < $1.00/1M.

Return the slug of the fastest model (lowest response_time).
```

**Agent Implementation:**
```typescript
// AI agent reads XML
const xml = await readFile(`${CLAUDE_PLUGIN_ROOT}/recommended-models.xml`);
const doc = parseXML(xml);

// Query: coding models under $1/1M
const models = doc.querySelectorAll(
  'category[name="coding"] model'
).filter(m =>
  parseFloat(m.querySelector('pricing average').textContent) < 1.0
);

// Sort by response_time (ascending)
const sorted = models.sort((a, b) => {
  const timeA = parseInt(a.querySelector('performance response_time').textContent);
  const timeB = parseInt(b.querySelector('performance response_time').textContent);
  return timeA - timeB;
});

// Return fastest
const fastest = sorted[0].querySelector('slug').textContent;
console.log(fastest); // "google/gemini-2.5-flash" (2s, $0.19/1M)
```

---

## Best Practices for AI Agents

### 1. Always Use XML for Programmatic Access

❌ **Bad - Parsing Markdown:**
```typescript
// Don't do this!
const md = await readFile('recommended-models.md');
const priceMatch = md.match(/Pricing: \$(\d+\.\d+)/);
const price = parseFloat(priceMatch[1]); // Fragile, error-prone
```

✅ **Good - Parsing XML:**
```typescript
const xml = await readFile('recommended-models.xml');
const doc = parseXML(xml);
const price = parseFloat(doc.querySelector('pricing average').textContent);
```

### 2. Use XPath for Complex Queries

✅ **Efficient:**
```xpath
//model[pricing/average < 1.0 and performance/speed = 'ultra_fast']
```

❌ **Inefficient:**
```typescript
// Looping through all models manually
const allModels = doc.querySelectorAll('model');
const filtered = [];
for (const model of allModels) {
  const price = parseFloat(model.querySelector('pricing average').textContent);
  const speed = model.querySelector('performance speed').textContent;
  if (price < 1.0 && speed === 'ultra_fast') {
    filtered.push(model);
  }
}
```

### 3. Handle Missing Optional Fields

```typescript
// Check if vision capability exists
const visionSupport = model.querySelector('capabilities vision')?.textContent === 'true';

// Check if model is free
const isFree = model.querySelector('pricing free')?.textContent === 'true' || false;
```

### 4. Cache Parsed XML

```typescript
// Parse once, reuse many times
let cachedModels: Document | null = null;

async function getModels(): Promise<Document> {
  if (!cachedModels) {
    const xml = await readFile('recommended-models.xml');
    cachedModels = parseXML(xml);
  }
  return cachedModels;
}
```

---

## Maintenance

### Updating the XML File

**IMPORTANT:** The XML file is auto-generated from the markdown file. Do NOT edit manually.

**Update Process:**
1. Run `/update-models` command (scrapes OpenRouter, filters, updates)
2. XML file is regenerated automatically
3. Synced to all plugins via `bun run scripts/sync-shared.ts`

**Manual Update (if needed):**
```bash
# Edit source markdown (only edit this!)
vim shared/recommended-models.md

# Regenerate XML (future: automated script)
# TODO: Create script to parse MD → XML

# Sync to plugins
bun run scripts/sync-shared.ts
```

### Version Updates

**Semver Rules:**
- **Patch (1.1.1 → 1.1.2):** Pricing updates, minor metadata changes
- **Minor (1.1.0 → 1.2.0):** New models added, models removed
- **Major (1.0.0 → 2.0.0):** Schema changes (breaking)

**Update Checklist:**
- [ ] Increment version in XML root element
- [ ] Update `updated` attribute (YYYY-MM-DD)
- [ ] Verify all pricing is current
- [ ] Test with sample XPath queries
- [ ] Sync to plugins

---

## Schema Validation

### XML Schema (XSD) - Future

For strict validation, we can define an XSD schema:

```xml
<!-- Future: recommended-models.xsd -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="models">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="category" maxOccurs="unbounded">
          <!-- Full schema definition -->
        </xs:element>
      </xs:sequence>
      <xs:attribute name="version" type="xs:string" use="required"/>
      <xs:attribute name="updated" type="xs:date" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>
```

**Validation:**
```bash
xmllint --schema recommended-models.xsd recommended-models.xml
```

---

## Questions and Support

**For AI agent developers:**
- See examples above for common queries
- Use XPath reference: https://www.w3.org/TR/xpath/
- Ask in project discussions for help

**To suggest schema improvements:**
- Open an issue with proposed changes
- Include use case and example

**For technical issues:**
- Contact: Jack Rudenko (i@madappgang.com)
- Repository: https://github.com/MadAppGang/claude-code

---

**Maintained By:** MadAppGang Claude Code Team
**Repository:** https://github.com/MadAppGang/claude-code
**License:** MIT
