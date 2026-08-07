# Version Validation System

This repository includes automated validation to ensure plugin versions in `marketplace.json` match their corresponding `plugin.json` files.

## Why Version Validation?

Claude Code reads plugin versions from the **marketplace catalog** (`.claude-plugin/marketplace.json`), not from individual `plugin.json` files. This means:

- ❌ **Problem**: If you update `plugins/dev/plugin.json` to v3.1.1 but forget to update `.claude-plugin/marketplace.json`, users will see the old version
- ✅ **Solution**: Automated validation ensures both files stay in sync before releases

## Quick Start

### Run Validation Manually

```bash
# From repository root
node scripts/validate-versions.js
```

### Install Git Hooks (Recommended)

Automatically validate on every commit:

```bash
# From repository root
./scripts/install-hooks.sh
```

This installs a `pre-commit` hook that blocks commits if versions don't match.

## Validation Script Features

The validation script checks:

### Critical Checks (Errors)
- ✅ Plugin versions match between marketplace.json and plugin.json
- ✅ Plugin names match
- ✅ plugin.json files exist for all marketplace entries

### Quality Checks (Warnings)
- ⚠️ Description length (recommends < 200 chars for UX)
- ⚠️ Author email consistency

### Example Output

**All passing:**
```
🔍 Validating plugin versions...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Marketplace: magus v2.9.0
   Plugin root: ./plugins

🔧 Checking plugin: dev
   ✅ Version matches: v3.1.1

🔧 Checking plugin: code-analysis
   ✅ Version matches: v1.1.0

🔧 Checking plugin: bun
   ✅ Version matches: v1.2.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Validation Summary:
   ✅ Passed: 3
   ⚠️  Warnings: 0
   ❌ Errors: 0

✅ All version checks passed!
   Safe to release.
```

**Version mismatch found:**
```
🔧 Checking plugin: dev
   ❌ Version mismatch:
      marketplace.json: 2.7.0
      plugin.json:      3.1.1

❌ ERRORS FOUND:

1. [dev] Version mismatch: marketplace="2.7.0", plugin.json="3.1.1"
   Fix: Update marketplace.json line for "dev" version to "3.1.1"

❌ Validation failed! Please fix the errors above.
```

## Release Workflow

### Manual Workflow

When releasing a new plugin version:

1. **Update plugin version:**
   ```bash
   # Edit the plugin's version
   vim plugins/dev/plugin.json  # Update "version": "3.1.1"
   ```

2. **Update marketplace catalog:**
   ```bash
   # Update the marketplace version
   vim .claude-plugin/marketplace.json  # Update version in plugins array
   ```

3. **Validate:**
   ```bash
   node scripts/validate-versions.js
   ```

4. **Commit if passing:**
   ```bash
   git add .
   git commit -m "chore: Release dev v3.1.1"
   ```

### Automated Workflow (with Git Hook)

When Git hooks are installed:

1. **Update both versions:**
   ```bash
   vim plugins/dev/plugin.json        # v3.1.1
   vim .claude-plugin/marketplace.json     # v3.1.1
   ```

2. **Commit (validation runs automatically):**
   ```bash
   git add .
   git commit -m "chore: Release dev v3.1.1"
   # Hook runs automatically and blocks if versions don't match
   ```

## Git Hooks

### Installing Hooks

```bash
./scripts/install-hooks.sh
```

This copies hooks from `scripts/hooks/` to `.git/hooks/` and makes them executable.

### Available Hooks

- **pre-commit**: Validates plugin versions before allowing commit
  - Runs `scripts/validate-versions.js`
  - Blocks commit if validation fails
  - Exit code 0 (pass) or 1 (fail)

### Bypassing Hooks

**Not recommended**, but if needed:

```bash
git commit --no-verify
```

⚠️ Only use this if you understand the implications and will validate manually later.

### Uninstalling Hooks

```bash
rm .git/hooks/pre-commit
```

## Continuous Integration

Add to your CI pipeline:

### GitHub Actions Example

```yaml
name: Validate Plugin Versions

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Validate plugin versions
        run: node scripts/validate-versions.js
```

### GitLab CI Example

```yaml
validate-versions:
  stage: test
  image: node:18
  script:
    - node scripts/validate-versions.js
```

## Files

- `scripts/validate-versions.js` - Main validation script
- `scripts/hooks/pre-commit` - Pre-commit hook template
- `scripts/install-hooks.sh` - Hook installation script
- `docs/VALIDATION.md` - This documentation

## Troubleshooting

### "plugin.json not found"

**Problem**: marketplace.json references a plugin that doesn't exist

**Fix**: Check the `source` path in marketplace.json:
```json
{
  "name": "dev",
  "source": "./plugins/dev",  // Must contain plugin.json
  "version": "3.1.1"
}
```

### "Version mismatch"

**Problem**: Versions don't match between files

**Fix**: Update both files to the same version:
1. `plugins/dev/plugin.json` → `"version": "3.1.1"`
2. `.claude-plugin/marketplace.json` → `"version": "3.1.1"` (in plugins array)

### Hook doesn't run

**Problem**: Commits succeed even with version mismatches

**Fix**: Reinstall hooks:
```bash
./scripts/install-hooks.sh
# Verify hook exists and is executable
ls -la .git/hooks/pre-commit
```

## Best Practices

1. ✅ **Always run validation before pushing**
2. ✅ **Install Git hooks for automatic validation**
3. ✅ **Update both files in the same commit**
4. ✅ **Use semantic versioning (MAJOR.MINOR.PATCH)**
5. ❌ **Never commit version mismatches**
6. ❌ **Never bypass hooks without good reason**

## Version Management Strategy

### Plugin Version (`plugin.json`)
- **Source of truth** for the plugin's actual version
- Follows semantic versioning
- Updated when plugin changes

### Marketplace Version (`marketplace.json`)
- **Catalog entry** that users see in plugin list
- Must match plugin.json version
- Updated together with plugin.json

### Marketplace Metadata Version (`marketplace.json` > `metadata.version`)
- Version of the **marketplace catalog itself**
- Independent of individual plugin versions
- Update when marketplace structure changes or major plugin updates

## Example: Releasing v3.2.0

```bash
# 1. Update plugin version
vim plugins/dev/plugin.json
# Change: "version": "3.1.1" → "3.2.0"

# 2. Update marketplace catalog
vim .claude-plugin/marketplace.json
# Change in plugins array: "version": "3.1.1" → "3.2.0"
# Optional: Update metadata.version if desired

# 3. Validate
node scripts/validate-versions.js
# Should show: ✅ Version matches: v3.2.0

# 4. Commit
git add .
git commit -m "chore(dev): Release v3.2.0"
# Pre-commit hook validates automatically

# 5. Tag
git tag plugins/dev/v3.2.0
git push origin main --tags
```

---

**Maintained by**: Jack Rudenko @ MadAppGang
**Last Updated**: November 12, 2025
