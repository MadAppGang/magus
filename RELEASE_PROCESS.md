# Plugin Release Process

This document describes the correct process for releasing a new version of a plugin in the Magus marketplace.

## Critical Understanding

Claude Code plugin discovery works through **TWO** configuration files:

1. **`plugins/{plugin-name}/plugin.json`** - The plugin's own version metadata
2. **`.claude-plugin/marketplace.json`** - The marketplace catalog (what users see when browsing)

**BOTH must be updated** for a version bump to be visible to users!

---

## Release Checklist

### 1. Update Plugin Files

**Files to update:**
- [ ] `plugins/{plugin-name}/plugin.json` - Update `version` field
- [ ] `plugins/{plugin-name}/agents/*.md` - Add new agents (if any)
- [ ] `plugins/{plugin-name}/commands/*.md` - Update commands (if any)
- [ ] Any other plugin-specific files

### 2. Update Documentation

**Files to update:**
- [ ] `CHANGELOG.md` - Add new version entry
- [ ] `RELEASES.md` - Add detailed release notes
- [ ] `CLAUDE.md` - Update version references
  - Current version number
  - Latest changes section
  - Git tag reference
  - Last updated date
  - Any new agents/commands in the list

### 3. **CRITICAL: Update Marketplace Catalog**

**File to update:**
- [ ] `.claude-plugin/marketplace.json`
  - Update `plugins[].version` for the specific plugin (e.g., `"version": "3.3.0"`)
  - Update `metadata.version` for the marketplace itself (optional, but recommended)
  - Update `plugins[].description` if the description changed

**This is the most commonly forgotten step!**

Without this update:
- `/plugin marketplace update` won't see the new version
- Users will still see the old version when browsing
- The actual plugin.json will be correct, but discovery will fail

### 4. Commit Changes

```bash
# Commit feature changes
git add -A
git commit -m "feat({plugin-name}): v{X.Y.Z} - {Feature summary}

{Detailed description of changes}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# If you forgot marketplace.json, commit it separately
git add .claude-plugin/marketplace.json
git commit -m "fix(marketplace): Update {plugin-name} version to v{X.Y.Z}

The marketplace.json file needs to be updated alongside plugin.json
for Claude Code to discover the correct version.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 5. Create Git Tag

```bash
# Tag format: plugins/{plugin-name}/v{X.Y.Z}
git tag -a plugins/{plugin-name}/v{X.Y.Z} -m "{Plugin Name} v{X.Y.Z} - {Feature Summary}

{Detailed tag message with:
- Key features
- Benefits
- New agents/commands
- Updated files
- Repository link
- License}"
```

**Examples:**
- `plugins/frontend/v3.3.0`
- `plugins/code-analysis/v1.1.0`
- `plugins/bun/v1.2.0`

### 6. Push to GitHub

```bash
# Push commits
git push origin main

# Push tag
git push origin plugins/{plugin-name}/v{X.Y.Z}
```

### 7. Verify Release

**Test that the update works:**

```bash
# As a user, run:
/plugin marketplace update magus

# Should show the new version
# If it still shows old version, you forgot to update marketplace.json!
```

**Restart Claude Code:**
- The new version should be visible
- Installing/updating the plugin should use the new version

---

## Common Mistakes

### ❌ Mistake #1: Forgot to update marketplace.json

**Symptom:**
- `plugin.json` shows v3.3.0
- Users still see v3.2.0 after `/plugin marketplace update`

**Fix:**
```bash
# Update .claude-plugin/marketplace.json
# Find the plugin entry and update "version" field
git add .claude-plugin/marketplace.json
git commit -m "fix(marketplace): Update {plugin} version to v{X.Y.Z}"
git push origin main
```

### ❌ Mistake #2: Wrong git tag format

**Wrong:**
- `frontend-v3.3.0` ❌
- `v3.3.0` ❌
- `frontend/v3.3.0` ❌

**Correct:**
- `plugins/frontend/v3.3.0` ✅

### ❌ Mistake #3: Inconsistent versions

**Problem:** plugin.json says v3.3.0 but marketplace.json says v3.2.0

**Fix:** Always update both files in the same commit (or immediately after)

### ❌ Mistake #4: Forgot to push tag

**Symptom:** Commit is on GitHub but no release tag

**Fix:**
```bash
git push origin plugins/{plugin-name}/v{X.Y.Z}
```

---

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes, incompatible API changes
  - Example: v3.0.0 - Removed deprecated agents

- **MINOR** (x.Y.0): New features, backward-compatible
  - Example: v3.3.0 - Added multi-model plan review

- **PATCH** (x.y.Z): Bug fixes, backward-compatible
  - Example: v3.3.1 - Fixed PROXY_MODE error handling

---

## Quick Reference

**Minimal release checklist:**

1. ✅ Update `plugins/{plugin}/plugin.json` version
2. ✅ Update `.claude-plugin/marketplace.json` plugin version ⚠️ **CRITICAL**
3. ✅ Update `CHANGELOG.md`
4. ✅ Update `RELEASES.md`
5. ✅ Update `CLAUDE.md`
6. ✅ Commit changes
7. ✅ Create git tag: `plugins/{plugin}/v{X.Y.Z}`
8. ✅ Push commit and tag
9. ✅ Verify with `/plugin marketplace update`

---

## Example: Releasing Frontend v3.3.0

```bash
# 1. Update files
# - plugins/frontend/plugin.json → "version": "3.3.0"
# - .claude-plugin/marketplace.json → plugins[0].version: "3.3.0"
# - CHANGELOG.md, RELEASES.md, CLAUDE.md

# 2. Commit
git add -A
git commit -m "feat(frontend): v3.3.0 - Multi-Model Plan Review (PHASE 1.5)"

# 3. Tag
git tag -a plugins/frontend/v3.3.0 -m "Frontend Plugin v3.3.0 - Multi-Model Plan Review"

# 4. Push
git push origin main
git push origin plugins/frontend/v3.3.0

# 5. Verify
# Run: /plugin marketplace update magus
# Should show: frontend v3.3.0 ✅
```

---

## Troubleshooting

**Q: Users still see old version after release**

A: Check `.claude-plugin/marketplace.json` - the version there must match `plugin.json`

**Q: Tag already exists error**

A: Delete the old tag and recreate:
```bash
git tag -d plugins/{plugin}/v{X.Y.Z}
git push origin :refs/tags/plugins/{plugin}/v{X.Y.Z}
git tag -a plugins/{plugin}/v{X.Y.Z} -m "..."
git push origin plugins/{plugin}/v{X.Y.Z}
```

**Q: How to test locally before release?**

A: Use local marketplace:
```bash
/plugin marketplace add /path/to/claude-code
/plugin install {plugin}@magus
```

---

## Automation Ideas (Future)

- [ ] Pre-commit hook to verify marketplace.json matches plugin.json
- [ ] Release script that updates both files atomically
- [ ] GitHub Action to validate version consistency
- [ ] Automated CHANGELOG generation from commits

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** November 13, 2025
