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
