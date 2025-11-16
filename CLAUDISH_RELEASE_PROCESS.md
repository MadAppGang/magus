# Claudish Release Process

**Last Updated:** 2025-11-16
**Maintained By:** Jack Rudenko @ MadAppGang

---

## Overview

This document outlines the complete release process for Claudish to avoid common pitfalls like hardcoded versions, stale model lists, and version mismatches.

---

## Pre-Release Checklist

### 1. Update Recommended Models (if needed)

If releasing with new model recommendations:

```bash
# Run the update-models command
/update-models

# This will:
# - Scrape latest models from OpenRouter
# - Filter and present for approval
# - Update shared/recommended-models.md
# - Generate mcp/claudish/recommended-models.json
# - Sync to all plugins
```

**Verify:**
- ✅ `shared/recommended-models.md` has new version number
- ✅ `mcp/claudish/recommended-models.json` exists and is valid JSON
- ✅ All plugin copies synced (frontend, bun, code-analysis)

---

### 2. Rebuild Claudish (CRITICAL)

**This step is MANDATORY before version bumps!**

```bash
cd mcp/claudish
bun run build
```

**What this does:**
1. Runs `extract-models.ts` to regenerate `src/config.ts` and `src/types.ts` from `shared/recommended-models.md`
2. Bundles the application with updated model list
3. Ensures `dist/index.js` has latest models baked in

**⚠️ CRITICAL:** If you skip this step, users will see old model lists even after updating to the new version!

---

### 3. Verify Build Output

```bash
# Check that config.ts has the correct models
cat src/config.ts | grep -A 20 "MODEL_INFO"

# Verify types.ts has correct model IDs
cat src/types.ts | grep "OpenRouterModel"

# Test locally before publishing
node dist/index.js --list-models
```

**Expected output:** Should show the NEW model list (7 models as of v1.1.5)

---

## Release Steps

### Step 1: Version Bump Strategy

**Version Number Guidelines:**

| Change Type | Bump | Example | When to Use |
|-------------|------|---------|-------------|
| **Major** | X.0.0 | 1.7.1 → 2.0.0 | Breaking changes, API changes |
| **Minor** | 0.X.0 | 1.7.1 → 1.8.0 | New features, new models, feature additions |
| **Patch** | 0.0.X | 1.7.1 → 1.7.2 | Bug fixes, typos, small corrections |

**For Model Updates:**
- New models added: **Minor** (e.g., 1.7.0 → 1.8.0)
- Model metadata fixes: **Patch** (e.g., 1.7.0 → 1.7.1)
- Breaking model changes: **Major** (e.g., 1.7.0 → 2.0.0)

---

### Step 2: Bump Claudish Version

```bash
cd mcp/claudish

# Edit package.json manually or use npm version
# Option A: Manual
vim package.json  # Change "version": "1.7.1" → "1.8.0"

# Option B: Using npm (auto-commits and tags)
npm version minor  # or patch, or major
```

**⚠️ Important:** If you use `npm version`, it auto-creates a git tag. You may want to delete it and create proper tags later:

```bash
# If npm auto-tagged, remove it
git tag -d v1.8.0
```

---

### Step 3: Rebuild with New Version

**CRITICAL:** Rebuild AGAIN after version bump to ensure the version is baked into the bundle:

```bash
cd mcp/claudish
bun run build
```

**Why?** The CLI reads version from `package.json` at runtime, but the build process needs to bundle the latest code.

---

### Step 4: Test Locally

```bash
# Test version command
node dist/index.js --version
# Expected: claudish version 1.8.0 (NEW VERSION)

# Test model list
node dist/index.js --list-models
# Expected: 7 models (NEW MODEL LIST)

# Test interactive mode (Ctrl+C to exit)
node dist/index.js
# Expected: Shows new model selector with 7 models
```

**⚠️ CRITICAL:** If version shows old number or models show old list, you MUST rebuild again!

---

### Step 5: Commit Claudish Changes

```bash
cd /Users/jack/mag/claude-code

# Stage Claudish files only
git add mcp/claudish/package.json \
        mcp/claudish/src/config.ts \
        mcp/claudish/src/types.ts

# Commit with clear message
git commit -m "chore(claudish): bump to v1.8.0

- Update to recommended models v1.1.5
- Add new OpenRouter models (GPT-5, Codex, Qwen3 VL, Polaris)
- Regenerate config.ts and types.ts from shared models

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Step 6: Bump Plugin Versions (if needed)

If plugins need version bumps (e.g., when recommended models change):

```bash
cd /Users/jack/mag/claude-code

# Edit plugin.json files
vim plugins/frontend/plugin.json     # 3.7.0 → 3.8.0
vim plugins/bun/plugin.json           # 1.4.0 → 1.5.0
vim plugins/code-analysis/plugin.json # 1.3.0 → 1.4.0

# Edit marketplace.json
vim .claude-plugin/marketplace.json
# Update:
# - metadata.version: 3.7.0 → 3.8.0
# - plugins[].version for each plugin

# Commit plugin version bumps
git add plugins/*/plugin.json .claude-plugin/marketplace.json

git commit -m "chore: bump plugin versions for recommended models v1.1.5

- Frontend: 3.7.0 → 3.8.0
- Bun: 1.4.0 → 1.5.0
- Code Analysis: 1.3.0 → 1.4.0
- Marketplace: 3.7.0 → 3.8.0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Step 7: Push to GitHub

```bash
git push origin main
```

---

### Step 8: Publish to npm

```bash
cd mcp/claudish

# Publish to npm (this is the FINAL step - no going back!)
npm publish
```

**Expected output:**
```
+ claudish@1.8.0

npm notice 📦  claudish@1.8.0
npm notice Tarball Details
npm notice name: claudish
npm notice version: 1.8.0
...
npm notice Publishing to https://registry.npmjs.org/
```

**⚠️ WARNING:** You CANNOT republish the same version! If you make a mistake:
1. Bump to next patch version (e.g., 1.8.0 → 1.8.1)
2. Rebuild: `bun run build`
3. Commit: `git add . && git commit -m "fix: ..."`
4. Publish: `npm publish`

---

### Step 9: Create Git Tags

```bash
cd /Users/jack/mag/claude-code

# Tag Claudish
git tag mcp/claudish/v1.8.0 -m "Release Claudish v1.8.0

- Add runtime model loading from recommended-models.json
- Update to 7 curated OpenRouter models
- Add GPT-5, GPT-5.1 Codex, Qwen3 VL, Polaris Alpha
- Fix version display to read from package.json"

# Tag plugins (if versions changed)
git tag plugins/frontend/v3.8.0 -m "Release Frontend v3.8.0 - Updated models"
git tag plugins/bun/v1.5.0 -m "Release Bun v1.5.0 - Updated models"
git tag plugins/code-analysis/v1.4.0 -m "Release Code Analysis v1.4.0 - Updated models"

# Push all tags
git push --tags
```

---

### Step 10: Verify Release

```bash
# Verify npm package is live
npm view claudish version
# Expected: 1.8.0

npm view claudish dist.tarball
# Should show latest tarball URL

# Install globally and test
npm install -g claudish@latest

# Verify version
claudish --version
# Expected: claudish version 1.8.0

# Verify model list
claudish --list-models
# Expected: Shows 7 new models

# Test interactive mode
claudish
# Expected: Shows model selector with new models
```

---

## Common Issues & Fixes

### Issue 1: Version Shows Old Number

**Symptom:** `claudish --version` shows 1.7.1 but package.json says 1.8.0

**Cause:** Forgot to rebuild after version bump

**Fix:**
```bash
cd mcp/claudish
bun run build
npm publish  # Bump to 1.8.1 if already published 1.8.0
```

---

### Issue 2: Model List Shows Old Models

**Symptom:** `claudish --list-models` shows old models (e.g., GLM 4.6 instead of GPT-5)

**Cause:** Forgot to run `bun run build` before version bump

**Fix:**
```bash
cd mcp/claudish
bun run build  # Regenerates config.ts from shared/recommended-models.md
npm version patch  # Bump to next patch (e.g., 1.8.0 → 1.8.1)
npm publish
```

---

### Issue 3: Cannot Publish - Version Already Exists

**Symptom:** `npm error You cannot publish over the previously published versions: 1.8.0.`

**Cause:** Already published 1.8.0, cannot republish same version

**Fix:**
```bash
cd mcp/claudish

# Bump to next patch
npm version patch  # 1.8.0 → 1.8.1

# Rebuild
bun run build

# Commit
git add package.json
git commit -m "chore(claudish): bump to v1.8.1 - fix release issue"
git push origin main

# Publish
npm publish
```

---

### Issue 4: Plugins Show Old Models

**Symptom:** Plugins still show old model recommendations after /update-models

**Cause:** Forgot to run sync script

**Fix:**
```bash
cd /Users/jack/mag/claude-code
bun run scripts/sync-shared.ts

# Verify sync
md5 shared/recommended-models.md \
    plugins/frontend/recommended-models.md \
    plugins/bun/recommended-models.md \
    plugins/code-analysis/recommended-models.md

# All MD5 hashes should match
```

---

## Release Checklist (Copy/Paste for Each Release)

Use this checklist for each Claudish release:

```markdown
## Claudish Release vX.Y.Z Checklist

### Pre-Release
- [ ] Update models with /update-models (if needed)
- [ ] Verify shared/recommended-models.md updated
- [ ] Verify mcp/claudish/recommended-models.json generated
- [ ] Run `cd mcp/claudish && bun run build`
- [ ] Verify config.ts and types.ts regenerated

### Version Bump
- [ ] Bump version in mcp/claudish/package.json
- [ ] Run `bun run build` AGAIN (critical!)
- [ ] Test locally: `node dist/index.js --version`
- [ ] Test locally: `node dist/index.js --list-models`
- [ ] Verify version shows correct number
- [ ] Verify model list shows new models

### Plugin Versions (if needed)
- [ ] Bump plugins/frontend/plugin.json
- [ ] Bump plugins/bun/plugin.json
- [ ] Bump plugins/code-analysis/plugin.json
- [ ] Update .claude-plugin/marketplace.json

### Git
- [ ] Commit Claudish changes
- [ ] Commit plugin version bumps (if any)
- [ ] Commit auto-generated files (config.ts, types.ts)
- [ ] Push to GitHub: `git push origin main`

### Publish
- [ ] Run `cd mcp/claudish && npm publish`
- [ ] Verify npm package live: `npm view claudish version`
- [ ] Create git tags (claudish + plugins)
- [ ] Push tags: `git push --tags`

### Verification
- [ ] Install globally: `npm install -g claudish@latest`
- [ ] Test version: `claudish --version`
- [ ] Test model list: `claudish --list-models`
- [ ] Test interactive mode: `claudish`
- [ ] Test with Claude Code: `claudish echo test`

### Documentation
- [ ] Update CHANGELOG.md
- [ ] Update README.md (if needed)
- [ ] Update version in documentation
```

---

## Emergency Rollback

If a release has critical bugs:

### Option 1: Deprecate and Release Fix

```bash
# Deprecate broken version
npm deprecate claudish@1.8.0 "Critical bug - use 1.8.1 instead"

# Fix bug, bump version, publish
npm version patch
bun run build
npm publish
```

### Option 2: Unpublish (within 72 hours only)

```bash
# WARNING: Only works within 72 hours of publish
npm unpublish claudish@1.8.0

# Fix and republish
npm publish
```

**⚠️ AVOID UNPUBLISHING:** Use deprecation instead. Unpublishing breaks existing users.

---

## Key Principles

1. **Always rebuild before version bump** - Ensures models are updated
2. **Always rebuild after version bump** - Ensures version is correct
3. **Test locally before publishing** - No takesie-backsies with npm
4. **Use semantic versioning** - Major.Minor.Patch
5. **Create git tags** - Track releases in git history
6. **Verify after publish** - Install globally and test
7. **Document changes** - Update CHANGELOG.md

---

## Related Documentation

- **RELEASE_PROCESS.md** - General plugin release process
- **skills/release/SKILL.md** - Quick reference release skill
- **CLAUDE.md** - Project overview and architecture
- **shared/README.md** - Shared resources sync pattern

---

**Maintained By:** Jack Rudenko @ MadAppGang
**Last Updated:** 2025-11-16
**Version:** 1.0.0
