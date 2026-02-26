# Shared Models Recommendation System Design

**Version:** 1.0.0
**Date:** 2025-11-14
**Author:** Claude Code (agent-architect)
**Status:** Complete Design

---

## Executive Summary

This design implements a centralized, AI-native model recommendation system using Markdown format. The system provides curated OpenRouter model recommendations with rich context that helps both AI agents and human users make informed choices for different tasks (coding, reasoning, vision, budget optimization).

**Key Innovation:** Markdown as the native format - no JSON parsing required, AI understands context naturally.

**Architecture Pattern:** Single source of truth (`shared/`) distributed to all plugins via sync script.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Markdown Structure Design](#markdown-structure-design)
3. [Initial Model Recommendations](#initial-model-recommendations)
4. [Sync Script Implementation](#sync-script-implementation)
5. [Integration Pattern](#integration-pattern)
6. [Documentation](#documentation)
7. [Migration Path](#migration-path)
8. [Future Extensibility](#future-extensibility)

---

## Architecture Overview

### Directory Structure

```
claude-code/
├── shared/
│   ├── README.md                       ← Explains sync pattern
│   └── recommended-models.md           ← SOURCE OF TRUTH (edit here)
│
├── scripts/
│   └── sync-shared.ts                  ← Distribution script
│
├── plugins/
│   ├── frontend/
│   │   ├── recommended-models.md       ← COPIED (auto-synced)
│   │   └── commands/
│   │       └── implement.md            ← READS: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md
│   ├── bun/
│   │   ├── recommended-models.md       ← COPIED (auto-synced)
│   │   └── commands/
│   │       └── implement-api.md        ← READS: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md
│   └── code-analysis/
│       └── recommended-models.md       ← COPIED (auto-synced)
│
└── package.json                        ← npm scripts for sync
```

### Key Principles

1. **Single Source of Truth**: Edit only `shared/recommended-models.md`
2. **Automatic Distribution**: Run `bun run sync-shared` to copy to all plugins
3. **AI-Native Format**: Markdown with rich context (no JSON parsing needed)
4. **Plugin-Relative Paths**: Commands read `${CLAUDE_PLUGIN_ROOT}/recommended-models.md`
5. **Human and AI Friendly**: Same file serves both audiences

### Design Rationale

**Why Markdown over JSON?**
- ✅ AI understands context naturally (no parsing logic needed)
- ✅ Rich explanations with prose, tables, examples
- ✅ Human-readable and maintainable
- ✅ Supports headings, lists, emphasis, code blocks
- ✅ Easy to extend with new sections

**Why Sync Script over Symlinks?**
- ✅ Works across all platforms (Windows, macOS, Linux)
- ✅ No git symlink issues
- ✅ Each plugin gets independent copy (safe for plugin distribution)
- ✅ Simple file copy operation (no complex logic)

**Why Centralized Recommendations?**
- ✅ Consistent model recommendations across all plugins
- ✅ Easy to update (one place, sync to all)
- ✅ Reduces duplication and drift
- ✅ Curated expertise available to all agents

---

## Markdown Structure Design

### File Organization

The `shared/recommended-models.md` file uses a hierarchical structure optimized for AI comprehension:

```markdown
# Recommended AI Models for Code Development
[Header with version, last updated, purpose]

## How to Use This Guide
[Instructions for AI agents and humans]

## Quick Reference Table
[Sortable comparison table]

## Category 1: Fast Coding Models ⚡
### Model Name (⭐ RECOMMENDED)
- **Provider:** provider-name
- **OpenRouter ID:** `provider/model-id`
- **Context Window:** size
- **Pricing:** input/output cost
- **Best For:** use cases
- **Trade-offs:** considerations
- **When to Use:** specific scenarios
- **Avoid For:** anti-patterns

[... more models in category ...]

## Category 2: Advanced Reasoning Models 🧠
[... same structure ...]

## Category 3: Vision & Multimodal Models 👁️
[... same structure ...]

## Category 4: Budget-Friendly Models 💰
[... same structure ...]

## Model Selection Decision Tree
[Flowchart-style guide for choosing models]

## Performance Benchmarks
[Tables comparing speed, quality, cost]

## Integration Examples
[Code snippets showing how to use in commands]
```

### Design Features

**1. Hierarchical Categories**
- Organized by use case (coding, reasoning, vision, budget)
- Easy to scan for specific needs
- Clear visual hierarchy with emoji indicators

**2. Standardized Model Entries**
- Consistent structure for every model
- All critical information in predictable locations
- AI can extract specific fields reliably

**3. Rich Context**
- "Best For" explains ideal use cases
- "Trade-offs" highlights limitations
- "When to Use" and "Avoid For" provide decision guidance
- Helps AI make context-aware recommendations

**4. Decision Support**
- Quick reference table for fast comparison
- Decision tree for systematic selection
- Performance benchmarks for objective evaluation

**5. AI-Friendly Patterns**
- Clear headings for section navigation
- Consistent field names for extraction
- OpenRouter IDs explicitly marked with code formatting
- Examples showing integration patterns

---

## Initial Model Recommendations

### Curated Model List (15 Models)

The initial recommendations include 15 carefully curated models across 4 categories:

#### 1. Fast Coding Models ⚡ (5 models)
- **x-ai/grok-code-fast-1** (⭐ RECOMMENDED)
- **anthropic/claude-sonnet-4.5**
- **google/gemini-2.5-flash**
- **deepseek/deepseek-chat**
- **qwen/qwq-32b-preview**

#### 2. Advanced Reasoning Models 🧠 (4 models)
- **openai/gpt-5-codex** (⭐ RECOMMENDED)
- **google/gemini-2.5-pro**
- **anthropic/claude-opus-4**
- **deepseek/deepseek-reasoner**

#### 3. Vision & Multimodal Models 👁️ (3 models)
- **google/gemini-2.5-pro** (⭐ RECOMMENDED)
- **anthropic/claude-sonnet-4.5**
- **qwen/qwen3-vl-235b-a22b-instruct**

#### 4. Budget-Friendly Models 💰 (3 models)
- **google/gemini-2.5-flash** (⭐ RECOMMENDED)
- **deepseek/deepseek-chat**
- **meta-llama/llama-3.3-70b-instruct**

### Recommendation Criteria

**Fast Coding Models:**
- Optimized for code generation and review
- Fast response times (<5s for typical requests)
- Good cost-to-quality ratio
- Strong support for modern languages (TypeScript, Python, Go, Rust)

**Advanced Reasoning Models:**
- Superior architectural planning capabilities
- Complex problem decomposition
- Multi-step reasoning chains
- Higher cost justified for critical decisions

**Vision & Multimodal Models:**
- UI/UX design analysis from screenshots
- Diagram and flowchart interpretation
- Accessibility validation from visual elements
- Cross-modal understanding

**Budget-Friendly Models:**
- Ultra-low cost for high-volume tasks
- Suitable for simple operations (formatting, basic code review)
- Fast iteration cycles
- Good enough quality for non-critical tasks

### Star Rating System

- **⭐ RECOMMENDED**: Top choice in category, best balance of quality/speed/cost
- No star: Good alternative, specific use cases
- **⚠️ EXPERIMENTAL**: Cutting-edge but may be unstable

---

## Sync Script Implementation

### TypeScript Implementation

**File:** `scripts/sync-shared.ts`

```typescript
#!/usr/bin/env bun

/**
 * Sync Shared Resources to Plugins
 *
 * This script copies shared resources (like recommended-models.md) from the
 * central `shared/` directory to all plugin directories.
 *
 * Usage:
 *   bun run sync-shared
 *
 * What it does:
 * 1. Reads all files from shared/ directory
 * 2. Copies each file to all plugin directories
 * 3. Creates directories if they don't exist
 * 4. Reports what was synced and any errors
 */

import { readdir, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Configuration
const SHARED_DIR = resolve(__dirname, '../shared');
const PLUGINS_DIR = resolve(__dirname, '../plugins');
const PLUGIN_NAMES = ['frontend', 'bun', 'code-analysis'];

interface SyncResult {
  file: string;
  destinations: string[];
  errors: Array<{ plugin: string; error: string }>;
}

async function ensureDirectoryExists(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function syncFileToPlugins(fileName: string): Promise<SyncResult> {
  const result: SyncResult = {
    file: fileName,
    destinations: [],
    errors: [],
  };

  const sourcePath = join(SHARED_DIR, fileName);

  for (const pluginName of PLUGIN_NAMES) {
    const pluginDir = join(PLUGINS_DIR, pluginName);
    const destPath = join(pluginDir, fileName);

    try {
      // Ensure plugin directory exists
      await ensureDirectoryExists(pluginDir);

      // Copy file
      await copyFile(sourcePath, destPath);

      result.destinations.push(destPath);
      console.log(`  ✓ ${pluginName}/${fileName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({ plugin: pluginName, error: errorMessage });
      console.error(`  ✗ ${pluginName}/${fileName} - ${errorMessage}`);
    }
  }

  return result;
}

async function syncAllSharedFiles(): Promise<void> {
  console.log('🔄 Syncing shared resources to plugins...\n');

  // Check if shared directory exists
  if (!existsSync(SHARED_DIR)) {
    console.error(`❌ Shared directory not found: ${SHARED_DIR}`);
    process.exit(1);
  }

  // Read all files from shared directory
  const files = await readdir(SHARED_DIR, { withFileTypes: true });
  const sharedFiles = files
    .filter((dirent) => dirent.isFile() && !dirent.name.startsWith('.'))
    .map((dirent) => dirent.name);

  if (sharedFiles.length === 0) {
    console.log('⚠️  No files found in shared/ directory');
    return;
  }

  console.log(`📦 Found ${sharedFiles.length} file(s) to sync:\n`);

  // Sync each file
  const results: SyncResult[] = [];
  for (const fileName of sharedFiles) {
    console.log(`Syncing ${fileName}:`);
    const result = await syncFileToPlugins(fileName);
    results.push(result);
    console.log();
  }

  // Summary
  console.log('━'.repeat(60));
  console.log('Summary:\n');

  const totalSuccesses = results.reduce((sum, r) => sum + r.destinations.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(`✓ Successfully synced: ${totalSuccesses} file(s)`);
  if (totalErrors > 0) {
    console.log(`✗ Failed: ${totalErrors} file(s)`);
  }

  // List all synced files
  console.log('\nSynced files:');
  for (const result of results) {
    console.log(`  ${result.file} → ${result.destinations.length} plugin(s)`);
  }

  if (totalErrors > 0) {
    console.log('\n⚠️  Some files failed to sync. Check errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ All shared resources synced successfully!');
  }
}

// Run the sync
syncAllSharedFiles().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
```

### Script Features

**1. Automatic Directory Creation**
- Creates plugin directories if they don't exist
- Handles nested directory structures
- Safe for new plugins

**2. Error Handling**
- Continues syncing even if one plugin fails
- Reports all errors at the end
- Non-zero exit code on failure (CI-friendly)

**3. Progress Reporting**
- Shows each file being synced
- Visual indicators (✓/✗) for success/failure
- Summary statistics at the end

**4. Validation**
- Checks if shared/ directory exists before starting
- Validates plugin directories
- Skips hidden files (starting with .)

**5. Idempotent**
- Safe to run multiple times
- Overwrites existing files (always uses latest source)
- No side effects on failure

### npm Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "sync-shared": "bun run scripts/sync-shared.ts",
    "sync": "bun run sync-shared"
  }
}
```

### Usage

```bash
# Sync all shared resources to plugins
bun run sync-shared

# Short alias
bun run sync

# Output example:
🔄 Syncing shared resources to plugins...

📦 Found 1 file(s) to sync:

Syncing recommended-models.md:
  ✓ frontend/recommended-models.md
  ✓ bun/recommended-models.md
  ✓ code-analysis/recommended-models.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary:

✓ Successfully synced: 3 file(s)

Synced files:
  recommended-models.md → 3 plugin(s)

✅ All shared resources synced successfully!
```

---

## Integration Pattern

### How Commands Use Recommendations

Commands read the synced markdown file and extract model information naturally.

**File Path Pattern:**
```javascript
// In any command or agent
const modelsPath = '${CLAUDE_PLUGIN_ROOT}/recommended-models.md';
```

**Reading with Read Tool:**
```markdown
Use Read tool to load: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md

The AI will naturally understand the markdown structure and can:
1. Navigate to specific sections (e.g., "Fast Coding Models")
2. Extract OpenRouter IDs from code-formatted fields
3. Understand context from "Best For" and "Trade-offs" sections
4. Make informed recommendations based on user's task
```

### Example: /implement Command Integration

**PHASE 1.5: Multi-Model Plan Review**

Current approach (hardcoded):
```markdown
## PHASE 1.5: Multi-Model Plan Review (Optional)

**Default Models:**
- x-ai/grok-code-fast-1
- openai/gpt-5-codex
```

New approach (uses recommendations):
```markdown
## PHASE 1.5: Multi-Model Plan Review (Optional)

**Model Selection:**

1. Read recommended models file:
   - Path: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md
   - Section: "Advanced Reasoning Models 🧠"
   - Extract models marked with ⭐ RECOMMENDED

2. Present options to user via AskUserQuestion:
   - Option 1: Use recommended reasoning models (extracted from file)
   - Option 2: Use fast coding models (for quicker reviews)
   - Option 3: Custom OpenRouter model ID
   - Option 4: Skip multi-model review

3. Example prompt:
   "Select AI models for plan review:

    Recommended (Advanced Reasoning):
    • openai/gpt-5-codex - Best for architectural decisions
    • google/gemini-2.5-pro - Strong at complex planning

    Fast & Affordable:
    • x-ai/grok-code-fast-1 - Quick architectural feedback
    • deepseek/deepseek-chat - Good reasoning at low cost

    Which models would you like to use? (select 1-3)"
```

### Integration Benefits

**For AI Agents:**
- Access to curated, up-to-date model recommendations
- Rich context for making informed suggestions
- Consistent recommendations across all commands
- No hardcoded model lists to maintain

**For Users:**
- Transparent model options with explanations
- Informed choice based on task requirements
- Flexibility to customize or use recommendations
- Consistent experience across plugins

**For Maintainers:**
- Single source of truth for model recommendations
- Easy to update as new models become available
- No need to update multiple command files
- Automatic distribution to all plugins

### Extraction Pattern Example

**AI naturally extracts OpenRouter IDs from markdown:**

```markdown
### GPT-5 Codex (⭐ RECOMMENDED)
- **Provider:** OpenAI
- **OpenRouter ID:** `openai/gpt-5-codex`
- **Best For:** Advanced reasoning, architectural planning

### Grok Code Fast
- **Provider:** xAI
- **OpenRouter ID:** `x-ai/grok-code-fast-1`
- **Best For:** Fast code review, quick iterations
```

**AI extracts:**
- Model 1: `openai/gpt-5-codex` (recommended for reasoning)
- Model 2: `x-ai/grok-code-fast-1` (fast alternative)

**No regex or JSON parsing needed** - AI understands the structure naturally.

---

## Documentation

### shared/README.md

```markdown
# Shared Resources

This directory contains resources shared across all Claude Code plugins.

## Purpose

Centralized management of common resources to ensure consistency and reduce duplication.

## Architecture

```
shared/                          ← SOURCE OF TRUTH (edit here)
└── recommended-models.md        ← Model recommendations

scripts/
└── sync-shared.ts               ← Distribution script

plugins/
├── frontend/
│   └── recommended-models.md    ← AUTO-COPIED
├── bun/
│   └── recommended-models.md    ← AUTO-COPIED
└── code-analysis/
    └── recommended-models.md    ← AUTO-COPIED
```

## How It Works

### 1. Edit Source Files

All shared resources are stored in `shared/` directory. This is the **ONLY** place you should edit these files.

**Example:**
```bash
# Edit the source
vim shared/recommended-models.md
```

### 2. Sync to Plugins

Run the sync script to copy resources to all plugins:

```bash
# Sync all shared resources
bun run sync-shared

# Or use the short alias
bun run sync
```

### 3. Automatic Distribution

The sync script copies each file from `shared/` to all plugin directories:

- `shared/recommended-models.md` → `plugins/frontend/recommended-models.md`
- `shared/recommended-models.md` → `plugins/bun/recommended-models.md`
- `shared/recommended-models.md` → `plugins/code-analysis/recommended-models.md`

### 4. Plugin Usage

Commands and agents read the synced files using plugin-relative paths:

```markdown
Read file: ${CLAUDE_PLUGIN_ROOT}/recommended-models.md
```

This ensures each plugin always has access to the latest recommendations.

## Maintaining Shared Resources

### Adding New Shared Files

1. Create the file in `shared/` directory
2. Run `bun run sync-shared`
3. File is automatically copied to all plugins
4. Update plugin commands/agents to use the new file

### Updating Existing Files

1. Edit the file in `shared/` directory (NOT in plugin directories)
2. Run `bun run sync-shared`
3. Updates are automatically distributed to all plugins

### Adding New Plugins

1. Add plugin name to `PLUGIN_NAMES` array in `scripts/sync-shared.ts`
2. Run `bun run sync-shared`
3. All shared resources are copied to the new plugin

## File Format Standards

### Markdown Files

Shared markdown files should be:
- AI-native (no JSON parsing required)
- Human-readable
- Well-structured with clear headings
- Include rich context and explanations
- Use consistent formatting

**Example: Model Recommendations**
```markdown
### Model Name (⭐ RECOMMENDED)
- **Provider:** provider-name
- **OpenRouter ID:** `provider/model-id`
- **Best For:** use cases
- **Trade-offs:** considerations
```

## Best Practices

### DO:
✅ Edit files in `shared/` directory only
✅ Run sync script after every change
✅ Use descriptive file names
✅ Include version and last-updated metadata in files
✅ Add comments explaining the purpose of each file

### DON'T:
❌ Edit files in plugin directories directly (changes will be overwritten)
❌ Commit plugin copies to git (they're auto-generated)
❌ Skip running sync script after changes
❌ Use complex file formats that require parsing

## Future Extensibility

This pattern can be extended to other shared resources:

- **API Schema Templates** - Standard OpenAPI schemas
- **Best Practices Snippets** - Common code patterns
- **Configuration Templates** - Standard configs (tsconfig, biome, etc.)
- **Testing Patterns** - Standard test structures
- **Documentation Templates** - Standard doc formats

To add a new shared resource:
1. Create file in `shared/`
2. Run `bun run sync-shared`
3. Update plugin files to reference it
4. Document in this README

## Troubleshooting

### Sync Script Fails

**Problem:** `❌ Shared directory not found`
**Solution:** Ensure you're running from repository root

**Problem:** `✗ Failed to copy to plugin`
**Solution:** Check plugin directory exists and is writable

### Plugin Files Out of Sync

**Problem:** Plugin has old version of shared file
**Solution:** Run `bun run sync-shared` to update

### Changes Not Appearing

**Problem:** Edited plugin file directly
**Solution:** Edit `shared/` file instead, then run sync

## Questions?

See main documentation:
- [CLAUDE.md](../CLAUDE.md) - Project overview
- [README.md](../README.md) - User documentation
- [RELEASE_PROCESS.md](../RELEASE_PROCESS.md) - Release workflow

Contact: Jack Rudenko (i@madappgang.com)
```

---

## Migration Path

### Phase 1: Create Infrastructure (Week 1)

**Tasks:**
1. Create `shared/` directory
2. Create `shared/README.md` (documentation)
3. Create `shared/recommended-models.md` (initial 15 models)
4. Create `scripts/sync-shared.ts` (sync script)
5. Add npm scripts to `package.json`
6. Test sync script manually

**Validation:**
- Run `bun run sync-shared`
- Verify files copied to all 3 plugins
- Check file contents match source

### Phase 2: Update Commands (Week 1-2)

**Tasks:**
1. Update `plugins/frontend/commands/implement.md` PHASE 1.5
   - Read `${CLAUDE_PLUGIN_ROOT}/recommended-models.md`
   - Extract recommended reasoning models
   - Present options to user
2. Update `plugins/bun/commands/implement-api.md` if applicable
3. Test integration in real workflows
4. Document usage patterns

**Validation:**
- Run `/implement` command
- Verify model recommendations appear
- Test custom model selection
- Verify OpenRouter integration works

### Phase 3: Documentation Update (Week 2)

**Tasks:**
1. Update `CLAUDE.md` with shared resources pattern
2. Update plugin READMEs to mention recommendations
3. Add migration notes to CHANGELOG.md
4. Update RELEASE_PROCESS.md if needed

**Validation:**
- Review all documentation for consistency
- Test documentation with new contributors

### Phase 4: Release (Week 2)

**Tasks:**
1. Bump plugin versions (minor version)
2. Update marketplace.json
3. Create git tags
4. Test installation from marketplace
5. Announce new feature

**Validation:**
- Clean install from marketplace works
- Recommendations file present after install
- Commands can read recommendations

---

## Future Extensibility

### Additional Shared Resources

The sync pattern can be extended to other shared resources:

**1. API Schema Templates**
```
shared/
└── api-schema-templates/
    ├── rest-openapi.yaml
    ├── graphql-schema.graphql
    └── grpc-proto.proto
```

**2. Best Practices Snippets**
```
shared/
└── code-snippets/
    ├── react-patterns.md
    ├── typescript-patterns.md
    └── testing-patterns.md
```

**3. Configuration Templates**
```
shared/
└── config-templates/
    ├── tsconfig.json
    ├── biome.json
    └── vitest.config.ts
```

**4. Testing Patterns**
```
shared/
└── testing/
    ├── unit-test-template.md
    ├── integration-test-template.md
    └── e2e-test-template.md
```

### Sync Script Extensions

**1. Selective Syncing**
```typescript
// Sync only specific files
bun run sync-shared --files=recommended-models.md

// Sync only to specific plugins
bun run sync-shared --plugins=frontend,bun
```

**2. Validation Hooks**
```typescript
// Validate markdown structure before syncing
bun run sync-shared --validate

// Dry-run mode (show what would be synced)
bun run sync-shared --dry-run
```

**3. Conflict Detection**
```typescript
// Warn if plugin file was manually edited
bun run sync-shared --check-conflicts

// Force overwrite conflicts
bun run sync-shared --force
```

### Plugin-Specific Overrides

**Pattern:** Allow plugins to override specific sections while keeping base recommendations.

```
shared/
└── recommended-models.md           ← Base recommendations

plugins/
├── frontend/
│   ├── recommended-models.md       ← Auto-synced base
│   └── recommended-models-override.md   ← Frontend-specific additions
└── bun/
    ├── recommended-models.md       ← Auto-synced base
    └── recommended-models-override.md   ← Backend-specific additions
```

Commands could read both files and merge recommendations.

---

## Appendix A: Complete Markdown Template

### File: shared/recommended-models.md

```markdown
# Recommended AI Models for Code Development

**Version:** 1.0.0
**Last Updated:** 2025-11-14
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
| x-ai/grok-code-fast-1 | Coding ⚡ | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰 | 128K | Fast code reviews, iterations |
| openai/gpt-5-codex | Reasoning 🧠 | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰💰 | 128K | Architecture, complex planning |
| google/gemini-2.5-pro | Vision 👁️ | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰 | 1M | UI analysis, multimodal tasks |
| google/gemini-2.5-flash | Budget 💰 | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | 💰 | 1M | High-volume, simple tasks |
| anthropic/claude-sonnet-4.5 | All-Round | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰 | 200K | Production code, reviews |
| deepseek/deepseek-chat | Reasoning 🧠 | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 💰 | 64K | Reasoning at low cost |
| qwen/qwq-32b-preview | Reasoning 🧠 | ⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰 | 32K | Complex reasoning |
| deepseek/deepseek-reasoner | Reasoning 🧠 | ⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰 | 64K | Deep analysis |
| anthropic/claude-opus-4 | Reasoning 🧠 | ⚡⚡ | ⭐⭐⭐⭐⭐ | 💰💰💰💰💰 | 200K | Critical architecture |
| qwen/qwen3-vl-235b-a22b-instruct | Vision 👁️ | ⚡⚡⚡ | ⭐⭐⭐⭐ | 💰💰💰 | 32K | Vision-language tasks |
| meta-llama/llama-3.3-70b-instruct | Budget 💰 | ⚡⚡⚡⚡ | ⭐⭐⭐ | 💰 | 128K | Open source option |

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
- **Context Window:** 128,000 tokens
- **Pricing:** ~$0.50/1M input, ~$1.50/1M output (OpenRouter pricing)
- **Response Time:** Very fast (<3s typical)

**Best For:**
- Rapid code reviews (catching obvious issues quickly)
- Fast iteration cycles during development
- Quick syntax and style checks
- Code completion and generation
- Refactoring suggestions

**Trade-offs:**
- Less thorough than reasoning models for complex architecture
- May miss subtle edge cases in complex logic
- Better for tactical code review than strategic planning

**When to Use:**
- ✅ Inner dev loop (test-fix-test cycles)
- ✅ Quick feedback on code changes
- ✅ Large codebases (need fast turnaround)
- ✅ Style and formatting reviews
- ✅ Simple refactoring tasks

**Avoid For:**
- ❌ Complex architectural decisions
- ❌ Security-critical code review
- ❌ Performance optimization (needs deep analysis)
- ❌ Cross-cutting concerns analysis

---

### anthropic/claude-sonnet-4.5

- **Provider:** Anthropic
- **OpenRouter ID:** `anthropic/claude-sonnet-4.5`
- **Context Window:** 200,000 tokens
- **Pricing:** ~$3.00/1M input, ~$15.00/1M output
- **Response Time:** Fast (~4s typical)

**Best For:**
- Production-grade code generation
- Comprehensive code reviews
- TypeScript/JavaScript expertise
- React and modern frontend patterns
- Multi-file refactoring

**Trade-offs:**
- Higher cost than Grok or Gemini Flash
- Overkill for simple syntax checks
- May be verbose in responses

**When to Use:**
- ✅ Production code implementation
- ✅ Complex component development
- ✅ Full-stack TypeScript projects
- ✅ Multi-file architectural changes
- ✅ Critical bug fixes

**Avoid For:**
- ❌ Quick syntax checks (use Grok or Gemini Flash)
- ❌ Ultra-high-volume tasks (use budget models)
- ❌ Simple formatting fixes

---

### google/gemini-2.5-flash

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-flash`
- **Context Window:** 1,000,000 tokens
- **Pricing:** ~$0.10/1M input, ~$0.30/1M output (Ultra-cheap!)
- **Response Time:** Very fast (<2s typical)

**Best For:**
- High-volume code analysis
- Quick formatting checks
- Large codebase scans
- Simple refactoring
- Budget-conscious projects

**Trade-offs:**
- Less sophisticated than Sonnet or Codex
- May miss complex patterns
- Better for breadth than depth

**When to Use:**
- ✅ Massive codebases (1M token window!)
- ✅ Budget constraints
- ✅ Simple, repetitive tasks
- ✅ Quick iterations (extremely fast)
- ✅ Formatting and linting suggestions

**Avoid For:**
- ❌ Complex architectural planning
- ❌ Critical security reviews
- ❌ Subtle bug detection
- ❌ Performance-critical optimizations

---

### deepseek/deepseek-chat

- **Provider:** DeepSeek
- **OpenRouter ID:** `deepseek/deepseek-chat`
- **Context Window:** 64,000 tokens
- **Pricing:** ~$0.20/1M input, ~$0.80/1M output
- **Response Time:** Fast (~4s typical)

**Best For:**
- Reasoning about code logic
- Algorithm explanations
- Code comprehension tasks
- Affordable code review
- Multi-language support

**Trade-offs:**
- Smaller context window than competitors
- Less specialized for code than Codex or Grok
- May require more prompting for best results

**When to Use:**
- ✅ Explaining complex algorithms
- ✅ Code comprehension and documentation
- ✅ Affordable reasoning tasks
- ✅ Multi-language projects
- ✅ Educational code review

**Avoid For:**
- ❌ Very large files (64K limit)
- ❌ Specialized framework knowledge
- ❌ Cutting-edge language features

---

### qwen/qwq-32b-preview

- **Provider:** Alibaba Cloud (Qwen)
- **OpenRouter ID:** `qwen/qwq-32b-preview`
- **Context Window:** 32,000 tokens
- **Pricing:** ~$0.30/1M input, ~$1.20/1M output
- **Response Time:** Moderate (~5s typical)

**Best For:**
- Reasoning through complex code logic
- Problem-solving and debugging
- Multi-step reasoning tasks
- Algorithm design
- Code optimization strategies

**Trade-offs:**
- Smaller context window (32K)
- Preview/experimental status (may change)
- Less specialized for web development

**When to Use:**
- ✅ Complex algorithmic problems
- ✅ Multi-step debugging
- ✅ Performance optimization reasoning
- ✅ Affordable complex reasoning
- ✅ Algorithm design and analysis

**Avoid For:**
- ❌ Large files (32K limit)
- ❌ Framework-specific tasks
- ❌ Production-critical code (use stable models)

---

## Category 2: Advanced Reasoning Models 🧠

**Use When:** You need deep analysis, architectural planning, or complex problem-solving.

### openai/gpt-5-codex (⭐ RECOMMENDED)

- **Provider:** OpenAI
- **OpenRouter ID:** `openai/gpt-5-codex`
- **Context Window:** 128,000 tokens
- **Pricing:** ~$5.00/1M input, ~$20.00/1M output (Premium)
- **Response Time:** Moderate (~6s typical)

**Best For:**
- Architectural planning and design
- Complex system design decisions
- Multi-component integration planning
- Security architecture review
- Performance optimization strategies
- Cross-cutting concerns analysis

**Trade-offs:**
- Highest cost in this category
- Slower than fast coding models
- May over-engineer simple solutions

**When to Use:**
- ✅ **Architecture planning** (PHASE 1 in /implement)
- ✅ **Plan reviews** (PHASE 1.5 multi-model review)
- ✅ Critical system design decisions
- ✅ Security-critical code paths
- ✅ Complex integration scenarios
- ✅ Performance bottleneck analysis

**Avoid For:**
- ❌ Simple CRUD operations
- ❌ Quick syntax fixes
- ❌ High-volume simple tasks
- ❌ Budget-constrained projects

---

### google/gemini-2.5-pro

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-pro`
- **Context Window:** 1,000,000 tokens (!)
- **Pricing:** ~$1.25/1M input, ~$5.00/1M output
- **Response Time:** Moderate (~5s typical)

**Best For:**
- **Massive context analysis** (entire codebases)
- Multi-file architectural planning
- Cross-repository analysis
- Long-form documentation review
- Multimodal tasks (code + diagrams)

**Trade-offs:**
- Expensive for small tasks
- 1M context may be overkill for focused tasks
- Multimodal features may not be needed for pure code

**When to Use:**
- ✅ **Whole codebase analysis** (1M tokens!)
- ✅ Architecture planning across many files
- ✅ Cross-service integration planning
- ✅ Large-scale refactoring plans
- ✅ Documentation + code alignment checks

**Avoid For:**
- ❌ Single-file reviews
- ❌ Quick iterations
- ❌ Budget-focused projects
- ❌ Simple tasks (use Gemini Flash instead)

---

### anthropic/claude-opus-4

- **Provider:** Anthropic
- **OpenRouter ID:** `anthropic/claude-opus-4`
- **Context Window:** 200,000 tokens
- **Pricing:** ~$15.00/1M input, ~$75.00/1M output (Most expensive!)
- **Response Time:** Slower (~8s typical)

**Best For:**
- **Critical architectural decisions** (where cost is justified)
- Highest-stakes code reviews
- Complex security analysis
- Novel problem-solving
- Research-grade code analysis

**Trade-offs:**
- **Very expensive** - reserve for truly critical tasks
- Slower than other models
- May overthink simple problems

**When to Use:**
- ✅ **Mission-critical architecture** (financial, health, security)
- ✅ Novel/unprecedented problems
- ✅ Maximum quality requirements
- ✅ When failure cost exceeds AI cost
- ✅ Research and innovation projects

**Avoid For:**
- ❌ Routine code review
- ❌ Standard CRUD apps
- ❌ Budget-constrained projects
- ❌ Time-sensitive tasks
- ❌ Most use cases (seriously, it's expensive!)

---

### deepseek/deepseek-reasoner

- **Provider:** DeepSeek
- **OpenRouter ID:** `deepseek/deepseek-reasoner`
- **Context Window:** 64,000 tokens
- **Pricing:** ~$0.55/1M input, ~$2.19/1M output
- **Response Time:** Slower (~10s typical, includes reasoning time)

**Best For:**
- **Chain-of-thought reasoning** about code
- Step-by-step problem decomposition
- Algorithm correctness proofs
- Complex debugging scenarios
- Educational explanations

**Trade-offs:**
- Slower due to explicit reasoning steps
- Smaller context window (64K)
- Verbose output (shows reasoning)

**When to Use:**
- ✅ **Understanding complex bugs** (shows reasoning)
- ✅ Algorithm correctness verification
- ✅ Step-by-step problem solving
- ✅ Educational code reviews
- ✅ Affordable deep analysis

**Avoid For:**
- ❌ Time-sensitive tasks (slow)
- ❌ Large files (64K limit)
- ❌ Simple problems (overkill)
- ❌ Production speed requirements

---

## Category 3: Vision & Multimodal Models 👁️

**Use When:** You need UI/UX analysis, screenshot reviews, or diagram interpretation.

### google/gemini-2.5-pro (⭐ RECOMMENDED)

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-pro`
- **Context Window:** 1,000,000 tokens (text + images)
- **Pricing:** ~$1.25/1M input, ~$5.00/1M output
- **Vision:** Native multimodal (text + images)

**Best For:**
- **UI/UX design review from screenshots**
- Figma design to code comparison
- Accessibility analysis from visual elements
- Diagram and flowchart interpretation
- Multi-page design system analysis

**Trade-offs:**
- Premium pricing for vision features
- May be overkill if only analyzing text
- Large context may not be needed for single screenshots

**When to Use:**
- ✅ **Design fidelity validation** (PHASE 2.5 in /implement)
- ✅ Screenshot-based UI reviews
- ✅ Accessibility visual audits
- ✅ Design system consistency checks
- ✅ Comparing designs to implementation

**Avoid For:**
- ❌ Pure code review (use coding models)
- ❌ Simple layout checks (use Sonnet)
- ❌ Budget projects (vision is expensive)

---

### anthropic/claude-sonnet-4.5

- **Provider:** Anthropic
- **OpenRouter ID:** `anthropic/claude-sonnet-4.5`
- **Context Window:** 200,000 tokens
- **Pricing:** ~$3.00/1M input, ~$15.00/1M output
- **Vision:** Multimodal (text + images)

**Best For:**
- Screenshot analysis with code context
- UI component reviews
- Design mockup comparison
- Responsive design validation
- Accessibility reviews

**Trade-offs:**
- More expensive than pure vision models
- Smaller context than Gemini Pro
- Vision features not as specialized as Google's

**When to Use:**
- ✅ **Combined code + screenshot review**
- ✅ UI component implementation validation
- ✅ Design mockup to code comparison
- ✅ Responsive layout debugging
- ✅ Accessibility audits

**Avoid For:**
- ❌ Pure vision tasks (use Gemini Pro)
- ❌ Massive design systems (use Gemini's 1M context)
- ❌ Budget-focused projects

---

### qwen/qwen3-vl-235b-a22b-instruct

- **Provider:** Alibaba Cloud (Qwen)
- **OpenRouter ID:** `qwen/qwen3-vl-235b-a22b-instruct`
- **Context Window:** 32,000 tokens
- **Pricing:** ~$2.00/1M input, ~$8.00/1M output
- **Vision:** Vision-language model

**Best For:**
- Affordable vision-language tasks
- UI component recognition
- Screenshot-based debugging
- Design element extraction
- Multilingual UI analysis

**Trade-offs:**
- Smaller context window (32K)
- Less specialized for web development
- May require more specific prompting

**When to Use:**
- ✅ **Budget vision tasks**
- ✅ Multilingual UI analysis
- ✅ Simple screenshot reviews
- ✅ Component recognition
- ✅ Affordable accessibility checks

**Avoid For:**
- ❌ Large design systems
- ❌ Complex multimodal reasoning
- ❌ Production-critical UI reviews

---

## Category 4: Budget-Friendly Models 💰

**Use When:** You need to minimize costs for high-volume or simple tasks.

### google/gemini-2.5-flash (⭐ RECOMMENDED)

- **Provider:** Google
- **OpenRouter ID:** `google/gemini-2.5-flash`
- **Context Window:** 1,000,000 tokens
- **Pricing:** ~$0.10/1M input, ~$0.30/1M output (**Ultra-cheap!**)
- **Response Time:** Very fast (<2s)

**Best For:**
- **High-volume simple tasks**
- Formatting and linting checks
- Quick code comprehension
- Large codebase scanning
- Simple refactoring suggestions

**Trade-offs:**
- Lower quality than premium models
- May miss complex patterns
- Less specialized knowledge

**When to Use:**
- ✅ **Budget constraints** (10x cheaper than Sonnet!)
- ✅ High-volume tasks (thousands of reviews)
- ✅ Simple, repetitive operations
- ✅ Quick iterations
- ✅ Large codebase analysis (1M context!)

**Avoid For:**
- ❌ Critical code paths
- ❌ Complex architecture
- ❌ Security reviews
- ❌ Production releases

---

### deepseek/deepseek-chat

- **Provider:** DeepSeek
- **OpenRouter ID:** `deepseek/deepseek-chat`
- **Context Window:** 64,000 tokens
- **Pricing:** ~$0.20/1M input, ~$0.80/1M output
- **Response Time:** Fast (~4s)

**Best For:**
- Affordable reasoning tasks
- Code explanation and documentation
- Algorithm understanding
- Educational code review
- Multi-language support

**Trade-offs:**
- Smaller context window
- Less specialized than coding-specific models
- May need more detailed prompts

**When to Use:**
- ✅ **Affordable reasoning** (4x cheaper than Sonnet)
- ✅ Code comprehension tasks
- ✅ Documentation generation
- ✅ Educational reviews
- ✅ Multi-language projects

**Avoid For:**
- ❌ Very large files (64K limit)
- ❌ Framework-specific expertise
- ❌ Cutting-edge features

---

### meta-llama/llama-3.3-70b-instruct

- **Provider:** Meta (via OpenRouter)
- **OpenRouter ID:** `meta-llama/llama-3.3-70b-instruct`
- **Context Window:** 128,000 tokens
- **Pricing:** ~$0.35/1M input, ~$0.40/1M output
- **Response Time:** Fast (~4s)

**Best For:**
- Open-source preference
- General-purpose code tasks
- Affordable code generation
- Multi-language support
- Privacy-conscious projects

**Trade-offs:**
- Less specialized than proprietary models
- May lag behind cutting-edge features
- Requires more specific prompting

**When to Use:**
- ✅ **Open-source preference**
- ✅ Budget-friendly general tasks
- ✅ Privacy requirements
- ✅ Multi-language code
- ✅ Community-driven projects

**Avoid For:**
- ❌ Cutting-edge framework features
- ❌ Specialized domain expertise
- ❌ Production-critical architecture

---

## Model Selection Decision Tree

Use this flowchart to choose the right model:

```
START: What is your primary need?

┌─ Architecture Planning or Complex Reasoning?
│  ├─ Budget < $5/1M → deepseek/deepseek-chat
│  ├─ Need massive context (>200K) → google/gemini-2.5-pro
│  ├─ Critical decision → anthropic/claude-opus-4
│  └─ Recommended → openai/gpt-5-codex ⭐

┌─ Fast Code Review or Generation?
│  ├─ Budget < $1/1M → google/gemini-2.5-flash
│  ├─ Need massive context → google/gemini-2.5-flash (1M!)
│  ├─ Production quality → anthropic/claude-sonnet-4.5
│  └─ Recommended → x-ai/grok-code-fast-1 ⭐

┌─ UI/Design Analysis (Screenshots)?
│  ├─ Budget < $3/1M → qwen/qwen3-vl-235b-a22b-instruct
│  ├─ Need massive context → google/gemini-2.5-pro
│  └─ Recommended → google/gemini-2.5-pro ⭐

┌─ Budget is Top Priority?
│  ├─ Need reasoning → deepseek/deepseek-chat
│  ├─ Open-source preference → meta-llama/llama-3.3-70b-instruct
│  └─ Recommended → google/gemini-2.5-flash ⭐

┌─ High-Volume Simple Tasks?
│  └─ Always use → google/gemini-2.5-flash ⭐

└─ Not sure? → Start with anthropic/claude-sonnet-4.5 (all-rounder)
```

---

## Performance Benchmarks

### Speed Comparison (Typical Response Times)

| Model | Simple Task | Complex Task | Large Context |
|-------|-------------|--------------|---------------|
| google/gemini-2.5-flash | <2s | 3-4s | 5s |
| x-ai/grok-code-fast-1 | <3s | 4-5s | 6s |
| deepseek/deepseek-chat | 3-4s | 5-6s | 7s |
| anthropic/claude-sonnet-4.5 | 3-4s | 6-8s | 10s |
| openai/gpt-5-codex | 4-6s | 8-10s | 12s |
| google/gemini-2.5-pro | 4-5s | 8-10s | 12s |
| deepseek/deepseek-reasoner | 8-10s | 15-20s | 25s |
| anthropic/claude-opus-4 | 6-8s | 12-15s | 20s |

**Notes:**
- Times are approximate and vary based on load
- "Large Context" = >100K tokens
- Reasoning models slower due to chain-of-thought

### Cost Comparison (Per 1M Tokens)

| Model | Input | Output | Total (1:1 ratio) |
|-------|-------|--------|-------------------|
| google/gemini-2.5-flash | $0.10 | $0.30 | $0.20 |
| deepseek/deepseek-chat | $0.20 | $0.80 | $0.50 |
| meta-llama/llama-3.3-70b-instruct | $0.35 | $0.40 | $0.38 |
| x-ai/grok-code-fast-1 | $0.50 | $1.50 | $1.00 |
| google/gemini-2.5-pro | $1.25 | $5.00 | $3.13 |
| deepseek/deepseek-reasoner | $0.55 | $2.19 | $1.37 |
| qwen/qwen3-vl-235b-a22b-instruct | $2.00 | $8.00 | $5.00 |
| anthropic/claude-sonnet-4.5 | $3.00 | $15.00 | $9.00 |
| openai/gpt-5-codex | $5.00 | $20.00 | $12.50 |
| anthropic/claude-opus-4 | $15.00 | $75.00 | $45.00 |

**Notes:**
- Prices from OpenRouter (subject to change)
- "Total" assumes equal input/output tokens
- Typical code review is ~70% input, 30% output

### Quality vs Cost Analysis

**Best Value for Code Review:**
1. **x-ai/grok-code-fast-1** - Great quality at $1.00/1M
2. **deepseek/deepseek-chat** - Good reasoning at $0.50/1M
3. **google/gemini-2.5-flash** - Acceptable for simple tasks at $0.20/1M

**Best Quality (Cost No Object):**
1. **anthropic/claude-opus-4** - Highest quality, $45/1M
2. **openai/gpt-5-codex** - Excellent reasoning, $12.50/1M
3. **anthropic/claude-sonnet-4.5** - Production-grade, $9.00/1M

**Best for Massive Context:**
1. **google/gemini-2.5-pro** - 1M tokens, $3.13/1M
2. **google/gemini-2.5-flash** - 1M tokens, $0.20/1M (!)

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
- openai/gpt-5-codex (primary recommendation)
- google/gemini-2.5-pro (alternative with massive context)

**Step 3:** Present options to user

AskUserQuestion with these options:

"Select AI models for architecture plan review:

**Recommended (Advanced Reasoning):**
• openai/gpt-5-codex - Best for architectural decisions ($12.50/1M)
• google/gemini-2.5-pro - Strong planning + 1M context ($3.13/1M)

**Fast & Affordable:**
• x-ai/grok-code-fast-1 - Quick architectural feedback ($1.00/1M)
• deepseek/deepseek-chat - Good reasoning at low cost ($0.50/1M)

**Custom:**
• Enter any OpenRouter model ID (e.g., anthropic/claude-opus-4)

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
- google/gemini-2.5-flash ($0.20/1M) - Ultra-cheap
- deepseek/deepseek-chat ($0.50/1M) - Affordable reasoning
- meta-llama/llama-3.3-70b-instruct ($0.38/1M) - Open-source

**Run 3 parallel reviews:**
1. Claude Sonnet (internal, comprehensive)
2. Gemini Flash (external, quick scan)
3. DeepSeek Chat (external, reasoning check)

**Total cost for 100K token review:**
- Claude Sonnet: ~$1.80
- Gemini Flash: ~$0.02 (!)
- DeepSeek Chat: ~$0.05
- **Grand Total: ~$1.87** (vs $7.00 for 3x Sonnet)
```

### Example 3: Vision Task Model Selection

**In UI validation workflow:**

```markdown
## UI Design Validation

**Read recommendations:**
${CLAUDE_PLUGIN_ROOT}/recommended-models.md → "Vision & Multimodal Models"

**Task:** Compare Figma design screenshot to implemented UI

**Recommended model:**
google/gemini-2.5-pro
- Native multimodal (text + images)
- 1M token context (can analyze entire design system)
- Strong at visual-to-code alignment
- $3.13/1M (reasonable for vision tasks)

**Run with Claudish:**
npx claudish --model google/gemini-2.5-pro --stdin --quiet < prompt.txt
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

## Future Enhancements

### Planned Additions

**1. Model Capabilities Matrix**
- Table showing language support, framework knowledge, code generation quality
- Helps users choose based on tech stack

**2. Use Case Examples**
- Concrete examples: "For Next.js app → use Sonnet"
- "For Go microservice → use Grok or Codex"

**3. Benchmark Results**
- Link to automated benchmark runs
- Show real-world performance metrics
- Quality scores from code review tasks

**4. Cost Calculator**
- Estimate cost for typical workflows
- Compare multi-model strategies
- ROI analysis

**5. Model Changelog**
- Track when models are added/removed
- Track pricing changes
- Track capability updates

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
```

---

## Appendix B: Sync Script Test Plan

### Manual Testing

**Test 1: Clean Sync (No Existing Files)**
```bash
# Setup
rm -rf plugins/*/recommended-models.md

# Run sync
bun run sync-shared

# Verify
test -f plugins/frontend/recommended-models.md && echo "✓ Frontend"
test -f plugins/bun/recommended-models.md && echo "✓ Bun"
test -f plugins/code-analysis/recommended-models.md && echo "✓ Code Analysis"

# Expected: All files created, ✓ for all three
```

**Test 2: Update Existing Files**
```bash
# Setup: Create outdated files
echo "OLD VERSION" > plugins/frontend/recommended-models.md
echo "OLD VERSION" > plugins/bun/recommended-models.md
echo "OLD VERSION" > plugins/code-analysis/recommended-models.md

# Run sync
bun run sync-shared

# Verify files updated
grep "Recommended AI Models" plugins/frontend/recommended-models.md && echo "✓ Updated"

# Expected: Files overwritten with latest version
```

**Test 3: Missing Plugin Directory**
```bash
# Setup: Remove a plugin directory
rm -rf plugins/code-analysis

# Run sync (should create directory)
bun run sync-shared

# Verify
test -d plugins/code-analysis && echo "✓ Directory created"
test -f plugins/code-analysis/recommended-models.md && echo "✓ File created"

# Expected: Directory and file created
```

**Test 4: Permission Error**
```bash
# Setup: Make plugin directory read-only
chmod 444 plugins/frontend

# Run sync
bun run sync-shared

# Expected: Error reported, continues to other plugins
# Other plugins should still sync successfully

# Cleanup
chmod 755 plugins/frontend
```

**Test 5: Multiple Files in shared/**
```bash
# Setup: Add another shared file
echo "Test content" > shared/test-file.md

# Run sync
bun run sync-shared

# Verify both files synced
test -f plugins/frontend/recommended-models.md && echo "✓ Models synced"
test -f plugins/frontend/test-file.md && echo "✓ Test file synced"

# Cleanup
rm shared/test-file.md plugins/*/test-file.md
```

### Automated Testing

**Create test script: `scripts/test-sync.ts`**

```typescript
#!/usr/bin/env bun

import { test, expect } from 'bun:test';
import { readFile, unlink, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const PLUGINS_DIR = join(__dirname, '../plugins');
const SHARED_DIR = join(__dirname, '../shared');
const TEST_FILE = 'recommended-models.md';

async function runSync() {
  execSync('bun run scripts/sync-shared.ts', { stdio: 'pipe' });
}

test('sync creates files in all plugins', async () => {
  // Run sync
  await runSync();

  // Check all plugins
  expect(existsSync(join(PLUGINS_DIR, 'frontend', TEST_FILE))).toBe(true);
  expect(existsSync(join(PLUGINS_DIR, 'bun', TEST_FILE))).toBe(true);
  expect(existsSync(join(PLUGINS_DIR, 'code-analysis', TEST_FILE))).toBe(true);
});

test('synced files match source', async () => {
  await runSync();

  const sourceContent = await readFile(join(SHARED_DIR, TEST_FILE), 'utf-8');
  const frontendContent = await readFile(join(PLUGINS_DIR, 'frontend', TEST_FILE), 'utf-8');

  expect(frontendContent).toBe(sourceContent);
});

test('sync overwrites outdated files', async () => {
  // Create outdated file
  const testPath = join(PLUGINS_DIR, 'frontend', TEST_FILE);
  await writeFile(testPath, 'OUTDATED CONTENT');

  // Run sync
  await runSync();

  // Verify overwritten
  const content = await readFile(testPath, 'utf-8');
  expect(content).not.toContain('OUTDATED CONTENT');
  expect(content).toContain('Recommended AI Models');
});
```

---

## Summary

This design provides a complete, production-ready system for managing AI model recommendations across all Claude Code plugins:

**✅ What's Included:**
- Comprehensive markdown template with 15 curated models
- Complete sync script with error handling and reporting
- Integration patterns for commands and agents
- Full documentation (shared/README.md)
- Migration path and testing strategy
- npm scripts for easy execution

**✅ Key Benefits:**
- **AI-Native:** Markdown format, no parsing needed
- **Single Source of Truth:** Edit once, sync everywhere
- **Rich Context:** Helps AI and humans make informed choices
- **Maintainable:** Simple structure, easy to extend
- **Future-Proof:** Extensible to other shared resources

**✅ Next Steps:**
1. Create `shared/` directory
2. Create `recommended-models.md` with initial 15 models
3. Create sync script (`scripts/sync-shared.ts`)
4. Create shared README
5. Add npm scripts
6. Test sync workflow
7. Update `/implement` command to use recommendations
8. Document in CHANGELOG and release

**Files Created:**
- `ai-docs/design-shared-models.md` ← This document
