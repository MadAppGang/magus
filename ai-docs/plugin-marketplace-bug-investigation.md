# Plugin marketplace directory deletion bug -- investigation and fix

**Last Updated**: 2026-04-06
**Claude Code Version**: 1.0.33+ (source at `claude-code/src/utils/plugins/`)
**Status**: Partially mitigated via git-subdir migration. Upstream fix still needed.

---

## 1. Problem statement

Magus marketplace plugins intermittently break with two distinct errors:

**Error A** -- hook execution failure:
```
Stop hook error: Failed to run: Plugin directory does not exist:
/Users/jack/.claude/plugins/marketplaces/magus/plugins/dev
(dev@magus — run /plugin to reinstall)
```

**Error B** -- plugin discovery failure (shown in `/doctor`):
```
Plugin dev not found in marketplace magus
```

Both errors persist across restarts. Running `/reload-plugins` does not recover them. The only fix is `claude plugin marketplace update magus` to re-clone the entire marketplace.

---

## 2. Root cause: non-atomic marketplace refresh

The bug lives in `cacheMarketplaceFromGit()` at `src/utils/plugins/marketplaceManager.ts` lines 1084-1178.

The function performs a three-step refresh with no atomicity guarantee:

1. Pull the existing clone (line 1109)
2. If pull fails, delete the entire directory (line 1131)
3. Attempt a fresh clone (line 1158)
4. If clone also fails, clean up and throw (lines 1166-1175)
5. The thrown error gets caught and swallowed at `pluginAutoupdate.ts` line 250

Here is the full function:

```typescript
// src/utils/plugins/marketplaceManager.ts:1084-1178

async function cacheMarketplaceFromGit(
  gitUrl: string,
  cachePath: string,
  ref?: string,
  sparsePaths?: string[],
  onProgress?: MarketplaceProgressCallback,
  options?: { disableCredentialHelper?: boolean },
): Promise<void> {
  const fs = getFsImplementation()

  const timeoutSec = Math.round(getPluginGitTimeoutMs() / 1000)
  safeCallProgress(
    onProgress,
    `Refreshing marketplace cache (timeout: ${timeoutSec}s)…`,
  )

  const reconcileResult = await reconcileSparseCheckout(cachePath, sparsePaths)
  if (reconcileResult.code === 0) {
    const pullStarted = performance.now()
    const pullResult = await gitPull(cachePath, ref, {           // <-- step 1: pull
      disableCredentialHelper: options?.disableCredentialHelper,
      sparsePaths,
    })
    // ...logging...
    if (pullResult.code === 0) return
    logForDebugging(`git pull failed, will re-clone: ${pullResult.stderr}`, {
      level: 'warn',
    })
  }

  try {
    await fs.rm(cachePath, { recursive: true })                  // <-- step 2: DELETE
    logForDebugging(
      `Found stale marketplace directory at ${cachePath}, cleaning up...`,
      { level: 'warn' },
    )
  } catch (rmError) {
    if (!isENOENT(rmError)) {
      throw new Error(
        `Failed to clean up existing marketplace directory...`,
      )
    }
    // ENOENT — cachePath didn't exist, fresh install
  }

  const cloneStarted = performance.now()
  const result = await gitClone(gitUrl, cachePath, ref, sparsePaths)  // <-- step 3: clone
  // ...logging...
  if (result.code !== 0) {
    try {
      await fs.rm(cachePath, { recursive: true, force: true })   // <-- cleanup partial
    } catch {
      // ignore
    }
    throw new Error(`Failed to clone marketplace repository: ${result.stderr}`)
  }
}
```

The critical gap: between step 2 (delete) and step 3 (clone), the marketplace directory does not exist. If the clone fails (network timeout, authentication error, GitHub rate limit), the directory stays deleted permanently.

The autoupdate caller swallows this error:

```typescript
// src/utils/plugins/pluginAutoupdate.ts:244-256

const refreshResults = await Promise.allSettled(
  Array.from(autoUpdateEnabledMarketplaces).map(async name => {
    try {
      await refreshMarketplace(name, undefined, {
        disableCredentialHelper: true,
      })
    } catch (error) {
      logForDebugging(                                 // <-- swallowed
        `Plugin autoupdate: failed to refresh marketplace ${name}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }),
)
```

After this sequence, `known_marketplaces.json` still references the marketplace, but the directory is gone.

---

## 3. Why only magus is affected

Three marketplaces exist in a typical installation:

| Marketplace | Source | Refresh path | File count | Risk |
|---|---|---|---|---|
| `claude-plugins-official` | GCS (Google Cloud Storage) | `fetchOfficialMarketplaceFromGcs()` at line 2432 | N/A | None |
| `claude-code-plugins` | Git clone of `anthropics/claude-code` | `cacheMarketplaceFromGit()` | ~184 | Low |
| `magus` | Git clone of `MadAppGang/magus` | `cacheMarketplaceFromGit()` | ~1900+ | High |

The official marketplace gets a special code path:

```typescript
// src/utils/plugins/marketplaceManager.ts:2432
if (name === OFFICIAL_MARKETPLACE_NAME) {
  const sha = await fetchOfficialMarketplaceFromGcs(
    installLocation,
    getMarketplacesCacheDir(),
  )
  if (sha !== null) {
    config[name] = { ...entry, lastUpdated: new Date().toISOString() }
    await saveKnownMarketplacesConfig(config)
    return
  }
  // ...fallback to git only if kill-switch allows...
}
```

GCS fetch never uses delete-then-clone. It downloads a tarball atomically. The official marketplace is immune to this bug.

Magus is the most affected because: large repo (slower clones, higher timeout risk), active development (frequent pull conflicts), and `autoUpdate: true` (triggers the refresh path on every session).

---

## 4. Two separate problems

### Problem A: hook execution failure

When the marketplace directory is gone, the hook executor checks for it before running:

```typescript
// src/utils/hooks.ts:831
if (!(await pathExists(pluginRoot))) {
  throw new Error(
    `Plugin directory does not exist: ${pluginRoot}` +
      (pluginId ? ` (${pluginId} — run /plugin to reinstall)` : ''),
  )
}
```

For string-source plugins, `pluginRoot` resolves to the marketplace clone directory (e.g., `~/.claude/plugins/marketplaces/magus/plugins/dev`). When that directory is missing, every hook for every magus plugin throws.

The error says "run /plugin to reinstall" but `/plugin` cannot fix a missing marketplace directory. Only `claude plugin marketplace update magus` recovers it.

### Problem B: plugin discovery failure

Plugin discovery reads `marketplace.json` from the clone directory. The call chain:

```
loadAllMarketplacePlugins() (line 1962)
  -> marketplaceCatalogs.get(marketplaceName)
     -> getMarketplaceCacheOnly(name)  (line 2081)
        -> readCachedMarketplace(entry.installLocation)  (line 2096)
           -> reads .claude-plugin/marketplace.json from clone dir  (line 2065)
```

Fallback path:
```
  -> getPluginByIdCacheOnly(pluginId)  (line 2035 -> 2188)
     -> getMarketplaceCacheOnly(marketplaceName)  (line 2210)
        -> same readCachedMarketplace() call
```

Both paths read from `entry.installLocation`, which points to the marketplace clone. No fallback to `installed_plugins.json` exists. When the clone directory is missing, all plugins show as "not found in marketplace".

---

## 5. The fix: git-subdir source migration

### What changed

All 16 plugin entries in `.claude-plugin/marketplace.json` were converted from string sources to `git-subdir` source objects.

Before:
```json
{
  "name": "dev",
  "source": "./plugins/dev",
  "version": "2.7.0"
}
```

After:
```json
{
  "name": "dev",
  "source": {
    "source": "git-subdir",
    "url": "MadAppGang/magus",
    "path": "plugins/dev",
    "ref": "main",
    "sha": "ede50b5f81e93f3b7474f942b74d41cdd9b7259d"
  },
  "version": "2.7.0"
}
```

### Why this fixes Problem A

The plugin loader branches on `typeof entry.source`:

```typescript
// src/utils/plugins/pluginLoader.ts:2108-2140

async function loadPluginFromMarketplaceEntryCacheOnly(
  entry: PluginMarketplaceEntry,
  marketplaceInstallLocation: string,
  pluginId: string,
  enabled: boolean,
  errorsOut: PluginError[],
  installPath: string | undefined,
): Promise<LoadedPlugin | null> {
  let pluginPath: string

  if (typeof entry.source === 'string') {
    // String source → resolves relative to marketplace clone (VULNERABLE)
    let marketplaceDir: string
    try {
      marketplaceDir = (await stat(marketplaceInstallLocation)).isDirectory()
        ? marketplaceInstallLocation
        : join(marketplaceInstallLocation, '..')
    } catch {
      errorsOut.push({ type: 'plugin-cache-miss', ... })
      return null
    }
    pluginPath = join(marketplaceDir, entry.source)
  } else {
    // Dict source → uses recorded installPath from cache (SAFE)
    if (!installPath || !(await pathExists(installPath))) {
      errorsOut.push({ type: 'plugin-cache-miss', ... })
      return null
    }
    pluginPath = installPath
  }
  // ...
}
```

With `git-subdir` sources, `entry.source` is an object (dict), so the loader reads from `installPath` -- the versioned cache directory at `~/.claude/plugins/cache/magus/dev/2.7.0/`. This cache directory survives marketplace deletion because Claude Code creates it during `claude plugin install` and never deletes it during marketplace refresh.

### Why this does NOT fix Problem B

Plugin discovery still requires reading `marketplace.json` from the clone directory. The `readCachedMarketplace()` function at line 2058 reads from `entry.installLocation`:

```typescript
// src/utils/plugins/marketplaceManager.ts:2058-2074
async function readCachedMarketplace(
  installLocation: string,
): Promise<PluginMarketplace> {
  const nestedPath = join(installLocation, '.claude-plugin', 'marketplace.json')
  try {
    return await parseFileWithSchema(nestedPath, PluginMarketplaceSchema())
  } catch (e) {
    if (e instanceof ConfigParseError) throw e
    const code = getErrnoCode(e)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e
  }
  return await parseFileWithSchema(installLocation, PluginMarketplaceSchema())
}
```

When `installLocation` (the marketplace clone directory) is missing, both reads fail, and the plugin shows as "not found in marketplace". This is an upstream bug -- discovery should fall back to `installed_plugins.json`.

After the git-subdir migration, installed plugins still **work** (hooks run, skills load) because they read from cache. But `/doctor` diagnostics and `claude plugin list` report them as missing because discovery depends on the clone.

---

## 6. Shared dependency handling

Four plugins reference files outside their own directory:

| Plugin | External dependency | Purpose |
|---|---|---|
| `dev` | `shared/model-aliases.json` | Model alias lookup |
| `nanobanana` | `shared/model-aliases.json` | Model alias lookup |
| `kanban` | `tools/table/index.ts` | Table rendering |
| `gtd` | `tools/table/index.ts` | Table rendering |

`git-subdir` clones only the plugin's subdirectory. External references break because the parent directory structure is not present in the cache.

The fix copies each shared file into the consuming plugin's `lib/` directory:

```bash
# scripts/sync-shared-deps.sh (excerpt)

# shared/model-aliases.json -> plugins that use it
sync_file \
  "$REPO_ROOT/shared/model-aliases.json" \
  "$REPO_ROOT/plugins/dev/lib/model-aliases.json"

sync_file \
  "$REPO_ROOT/shared/model-aliases.json" \
  "$REPO_ROOT/plugins/nanobanana/lib/model-aliases.json"

# tools/table/index.ts -> plugins that use it
sync_file \
  "$REPO_ROOT/tools/table/index.ts" \
  "$REPO_ROOT/plugins/kanban/lib/table.ts"

sync_file \
  "$REPO_ROOT/tools/table/index.ts" \
  "$REPO_ROOT/plugins/gtd/lib/table.ts"
```

Import paths in each plugin were updated to reference `./lib/model-aliases.json` or `./lib/table.ts` instead of the external path.

---

## 7. Release workflow

Three scripts handle the release process:

| Script | Purpose |
|---|---|
| `scripts/sync-shared-deps.sh` | Copies shared files into plugin `lib/` dirs |
| `scripts/release-marketplace.sh` | Converts marketplace.json sources to git-subdir with current HEAD SHA |
| `scripts/release.sh` | Runs both in sequence, prints commit instructions |

`release-marketplace.sh` is idempotent -- it updates only the SHA field if sources are already git-subdir objects. It uses `git rev-parse HEAD` to pin each plugin to the current commit:

```bash
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
```

```python
# For string sources: convert to git-subdir
plugin["source"] = {
    "source": "git-subdir",
    "url": "MadAppGang/magus",
    "path": f"plugins/{name}",
    "ref": "main",
    "sha": sha,
}

# For existing git-subdir sources: update SHA only
source["sha"] = sha
```

Release flow:
1. Make plugin changes, commit
2. Run `scripts/release.sh`
3. Commit the marketplace.json SHA update
4. Push

---

## 8. Related GitHub issues

| Issue | Title | Status |
|---|---|---|
| #24529 | Hook executor doesn't set CLAUDE_PLUGIN_ROOT | OPEN |
| #35507 | Wrong extraction path for third-party marketplace plugins | OPEN |
| #36099 | Marketplace directory name mismatch | OPEN |
| #38670 | Third-party marketplace skills/commands/agents silently not registered | OPEN |
| #39328 | Stale CLAUDE_PLUGIN_ROOT after cache hash changes | OPEN |
| #40153 | Marketplace directory deleted during failed auto-update | OPEN |
| #27521 | Hooks fire for non-installed marketplace plugins | OPEN |

Issue #40153 is the direct upstream report for this bug.

---

## 9. What remains

**Upstream fix: atomic marketplace refresh.** `cacheMarketplaceFromGit()` should clone to a temporary directory, then atomically rename it over the old one. The delete-then-clone pattern guarantees a window where the directory is absent.

**Upstream fix: discovery fallback.** `getMarketplaceCacheOnly()` and `getPluginByIdCacheOnly()` should fall back to `installed_plugins.json` when the marketplace clone is missing. The installed plugins registry already records each plugin's entry data -- discovery does not need the clone.

**Claudeup prerunner.** The claudeup prerunner already detects and recovers missing marketplace directories by running `claude plugin marketplace update magus`. But Claude Code's own session init runs the autoupdate path *after* claudeup, so it can re-delete the directory that claudeup recovered.

---

## 10. Verification

After deploying the git-subdir migration:

```bash
# Plugins install from git-subdir source
claude plugin install dev@magus --scope project

# Cache directory contains shared deps
ls ~/.claude/plugins/cache/magus/dev/2.7.0/lib/
# model-aliases.json

# installed_plugins.json records correct SHA
jq '.["dev@magus"].sha' ~/.claude/plugins/installed_plugins.json
# "ede50b5f81e93f3b7474f942b74d41cdd9b7259d"

# Hook execution uses cache path
# (debug logs show CLAUDE_PLUGIN_ROOT resolving to cache dir)
```

To simulate the bug and verify the mitigation:

```bash
# 1. Delete marketplace directory (simulates failed auto-update)
rm -rf ~/.claude/plugins/marketplaces/magus

# 2. Verify plugins still load from cache
claude --print "test"
# Hooks run successfully — no "Plugin directory does not exist" error

# 3. Verify discovery is broken (upstream bug, not fixed)
claude /doctor
# "Plugin dev not found in marketplace magus" — expected until upstream fix

# 4. Recover marketplace directory
claude plugin marketplace update magus
```
