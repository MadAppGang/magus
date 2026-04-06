# Article materials: the Claude Code marketplace deletion bug

**Prepared**: 2026-04-06
**Source investigation**: `/Users/jack/mag/magus/ai-docs/plugin-marketplace-bug-investigation.md`
**Claude Code version**: 2.1.92 (source at `claude-code/src/utils/plugins/`)

---

## 1. HOOK -- Opening angles (3 options)

### Angle A -- The mystery

Open with the error message:

```
Stop hook error: Failed to run: Plugin directory does not exist:
/Users/jack/.claude/plugins/marketplaces/magus/plugins/dev
(dev@magus -- run /plugin to reinstall)
```

The message tells you to run `/plugin` to reinstall. You do. Nothing changes. You restart Claude Code. Same error. You uninstall the plugin and reinstall it. Same error. You clear the plugin cache. Same error. You try five more things across multiple sessions over multiple days.

The error says the problem is a missing plugin directory. The actual problem is 400 lines away in a different file -- a function that deletes an entire marketplace directory before attempting to re-clone it, then swallows the error when the clone fails.

This angle works for: developers who have hit this bug and want to understand *why*. The payoff is the moment the investigation shifts from "what's broken" to "what caused the breakage."

### Angle B -- The asymmetry

Anthropic ships Claude Code with its own plugin marketplace: `claude-plugins-official`. Those plugins never break. Not once. You can kill your network, corrupt your git config, restart a hundred times -- the official plugins keep working.

Third-party marketplaces break constantly. Eight open GitHub issues. Users on macOS and Linux. Workarounds that get overwritten every time Claude Code starts a new session. One user reports patching hooks.json by hand, only to have Claude Code rewrite it seconds later.

The asymmetry is architectural. The official marketplace downloads from Google Cloud Storage as an atomic tarball. Third-party marketplaces go through a git code path that deletes the directory before cloning. The official marketplace is structurally immune to the bug that afflicts every third-party marketplace.

This angle works for: readers interested in platform dynamics, the relationship between first-party and third-party developers, and architectural decisions that create unequal outcomes.

### Angle C -- The source code detective story

Open at the moment we read `marketplaceManager.ts` line 1131:

```typescript
await fs.rm(cachePath, { recursive: true })
```

One line. Deletes the entire marketplace directory -- every plugin, every hook, every skill file. The function tries to `git pull` first, and if the pull fails for any reason (network timeout, auth error, merge conflict), it deletes everything and attempts a fresh clone. If the clone also fails, the error gets caught, logged at `warn` level, and swallowed. The directory stays gone.

This angle works for: technical readers who want to see the actual code. The narrative follows the investigation through source files: `marketplaceManager.ts` -> `pluginAutoupdate.ts` -> `hooks.ts` -> `pluginLoader.ts`. Each file reveals another piece of the puzzle.

---

## 2. KEY CHARACTERS (for narrative)

**Jack** -- Plugin marketplace developer. Maintains Magus, a third-party Claude Code marketplace with 16 plugins and 4,008 files. Has been fighting this bug across 5-6 sessions. Built the workaround.

**Claude Code** -- Anthropic's CLI tool for AI-assisted development. Version 2.1.92. Ships with a plugin ecosystem that supports third-party marketplaces installed via git clone.

**Magus marketplace** -- Third-party marketplace. 16 plugins, 4,008 files, active development. Has `autoUpdate: true` in its marketplace configuration, meaning Claude Code refreshes it on every session start.

**claude-plugins-official** -- Anthropic's own marketplace. NOT a git repository -- no `.git` directory exists. Fetched from Google Cloud Storage as a tarball. Structurally immune to the delete-then-clone bug.

**The hook executor** -- `hooks.ts`, line 831. The gatekeeper. Before running any plugin hook, it checks `fs.exists(pluginRoot)`. When the marketplace directory is gone, every hook for every plugin in that marketplace throws.

**cacheMarketplaceFromGit()** -- `marketplaceManager.ts`, line 1084. The function with the bug. Pulls, deletes, clones -- in that order, with no atomicity.

**pluginAutoupdate.ts** -- The caller that swallows the error. Line 250. Catches the thrown error, logs it at `warn` level, and continues. No recovery. No retry. No notification to the user.

**installed_plugins.json** -- The registry that knows where every plugin's cache copy lives. Has the correct `installPath` for every installed plugin. The hook executor does not consult it.

**The typeof branch** -- `pluginLoader.ts`, line 2108. The pivot point. `typeof entry.source === 'string'` sends plugins down the vulnerable path (reads from marketplace clone). `typeof entry.source === 'object'` sends them down the safe path (reads from versioned cache).

---

## 3. CODE SNIPPETS (ready to paste)

### Snippet 1 -- The bug (delete before clone)

**File**: `claude-code/src/utils/plugins/marketplaceManager.ts`, lines 1084-1178

```typescript
async function cacheMarketplaceFromGit(
  gitUrl: string,
  cachePath: string,
  ref?: string,
  sparsePaths?: string[],
  onProgress?: MarketplaceProgressCallback,
  options?: { disableCredentialHelper?: boolean },
): Promise<void> {
  const fs = getFsImplementation()

  // ...setup...

  const reconcileResult = await reconcileSparseCheckout(cachePath, sparsePaths)
  if (reconcileResult.code === 0) {
    const pullResult = await gitPull(cachePath, ref, {       // Step 1: try pull
      disableCredentialHelper: options?.disableCredentialHelper,
      sparsePaths,
    })
    if (pullResult.code === 0) return                        // Pull worked → done
    logForDebugging(
      `git pull failed, will re-clone: ${pullResult.stderr}`,
      { level: 'warn' },
    )
  }

  try {
    await fs.rm(cachePath, { recursive: true })              // Step 2: DELETE EVERYTHING
    logForDebugging(
      `Found stale marketplace directory at ${cachePath}, cleaning up...`,
      { level: 'warn' },
    )
  } catch (rmError) {
    if (!isENOENT(rmError)) {
      throw new Error(`Failed to clean up existing marketplace directory...`)
    }
  }

  const result = await gitClone(                             // Step 3: clone fresh
    gitUrl, cachePath, ref, sparsePaths
  )
  if (result.code !== 0) {
    try {
      await fs.rm(cachePath, { recursive: true, force: true })  // Cleanup partial
    } catch { /* ignore */ }
    throw new Error(                                         // Step 4: throw (gets swallowed)
      `Failed to clone marketplace repository: ${result.stderr}`
    )
  }
}
```

**Key observation**: Between step 2 and step 3, the marketplace directory does not exist. If the clone fails (network timeout, auth error, GitHub rate limit), the directory stays deleted permanently.

---

### Snippet 2 -- The error gets swallowed

**File**: `claude-code/src/utils/plugins/pluginAutoupdate.ts`, lines 244-256

```typescript
const refreshResults = await Promise.allSettled(
  Array.from(autoUpdateEnabledMarketplaces).map(async name => {
    try {
      await refreshMarketplace(name, undefined, {
        disableCredentialHelper: true,
      })
    } catch (error) {
      logForDebugging(
        `Plugin autoupdate: failed to refresh marketplace ${name}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
      // Error swallowed. No recovery. No retry. Directory stays deleted.
    }
  }),
)
```

**Key observation**: The user sees no error. Debug logs record the failure at `warn` level, but no toast, no banner, no suggestion to run `claude plugin marketplace update`. The marketplace is gone and the user has no idea why plugins stopped working.

---

### Snippet 3 -- The hook executor pre-check

**File**: `claude-code/src/utils/hooks.ts`, lines 824-836

```typescript
if (pluginRoot) {
  // Plugin directory gone (orphan GC race, concurrent session deleted it):
  // throw so callers yield a non-blocking error.
  if (!(await pathExists(pluginRoot))) {
    throw new Error(
      `Plugin directory does not exist: ${pluginRoot}` +
        (pluginId ? ` (${pluginId} -- run /plugin to reinstall)` : ''),
    )
  }
  const rootPath = toHookPath(pluginRoot)
  command = command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () => rootPath)
}
```

**Key observation**: The error message says "run /plugin to reinstall" -- but `/plugin` cannot fix a missing marketplace directory. Only `claude plugin marketplace update <name>` recovers it. The error message sends users down a dead end.

---

### Snippet 4 -- The critical typeof branch

**File**: `claude-code/src/utils/plugins/pluginLoader.ts`, lines 2108-2140

```typescript
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
    // STRING SOURCE: resolves relative to marketplace clone directory.
    // If the marketplace clone is gone, this path doesn't exist.
    let marketplaceDir: string
    try {
      marketplaceDir = (await stat(marketplaceInstallLocation)).isDirectory()
        ? marketplaceInstallLocation
        : join(marketplaceInstallLocation, '..')
    } catch {
      errorsOut.push({
        type: 'plugin-cache-miss',
        source: pluginId,
        plugin: entry.name,
        installPath: marketplaceInstallLocation,
      })
      return null
    }
    pluginPath = join(marketplaceDir, entry.source)
  } else {
    // DICT SOURCE: uses recorded installPath from versioned cache.
    // Cache survives marketplace deletion.
    if (!installPath || !(await pathExists(installPath))) {
      errorsOut.push({
        type: 'plugin-cache-miss',
        source: pluginId,
        plugin: entry.name,
        installPath: installPath ?? '(not recorded)',
      })
      return null
    }
    pluginPath = installPath  // <-- THIS IS THE SAFE PATH
  }
  // ...
}
```

**Key observation**: This is the crux of the fix. Changing `entry.source` from a string (`"./plugins/dev"`) to an object (`{ "source": "git-subdir", ... }`) routes the plugin through the `else` branch, where `pluginPath` is set from the versioned cache directory instead of the marketplace clone.

---

### Snippet 5 -- The GCS special case for official marketplace

**File**: `claude-code/src/utils/plugins/marketplaceManager.ts`, line 2432

```typescript
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
  // GCS failed -- fall through to git ONLY if kill-switch allows
}
```

**Key observation**: The official marketplace never goes through `cacheMarketplaceFromGit()`. It downloads from GCS -- a single HTTP request, no intermediate deletion. This is why official plugins never experience the bug.

---

### Snippet 6 -- Where pluginRoot gets set for hooks

**File**: `claude-code/src/utils/plugins/loadPluginHooks.ts`, lines 74-79

```typescript
pluginMatchers[hookEvent].push({
  matcher: matcher.matcher,
  hooks: matcher.hooks,
  pluginRoot: plugin.path,  // <-- This determines what the hook executor checks
  pluginName: plugin.name,
  pluginId: plugin.source,
})
```

**Key observation**: `plugin.path` is set during plugin loading. For string-source plugins, it points into the marketplace clone. For dict-source plugins (git-subdir), it points into the versioned cache. The hook executor's `pathExists(pluginRoot)` check at line 831 of `hooks.ts` then succeeds or fails based on which path was set here.

---

## 4. DATA POINTS AND FACTS

### Marketplace inventory

| Marketplace | Source mechanism | File count | Has `.git` | autoUpdate |
|---|---|---|---|---|
| `claude-plugins-official` | GCS tarball | N/A | No | N/A |
| `claude-code-plugins` | Git clone (`anthropics/claude-code`) | 216 | Yes | Not set |
| `magus` | Git clone (`MadAppGang/magus`) | 4,008 | Yes | `true` |

### Plugin counts

- 16 plugins in `marketplace.json`
- 19 plugin directories on disk (3 not in manifest: `dingo`, `go`, `stats`)
- 8 plugins have hooks using `${CLAUDE_PLUGIN_ROOT}`
- 4 plugins had cross-directory shared dependencies that required migration work

### GitHub issues

8 open issues on `anthropics/claude-code` related to plugin hooks and marketplace behavior:

| Issue | Description |
|---|---|
| #24529 | Hook executor does not set `CLAUDE_PLUGIN_ROOT` -- 8 comments from 4 users |
| #27521 | Hooks fire for non-installed marketplace plugins |
| #35507 | Wrong extraction path for third-party marketplace plugins |
| #36099 | Marketplace directory name mismatch |
| #38670 | Third-party marketplace skills/commands/agents silently not registered |
| #39328 | Stale `CLAUDE_PLUGIN_ROOT` after cache hash changes |
| #39777 | (Related plugin issue) |
| #40153 | Marketplace directory deleted during failed auto-update -- exact bug described here |

### Debug log evidence

- Hooks work at 02:16, fail at 02:17:24, work again at 02:24 -- marketplace directory was transiently deleted during auto-update window
- `git pull: cwd=...marketplaces/magus ref=default` appears in debug logs on session start -- confirms auto-update triggers on every new session
- During one investigation session, the marketplace directory was confirmed completely absent from disk

### Workaround lifecycle

Community workarounds (manually patching `hooks.json`, fixing paths with sed) get reverted by Claude Code on every session start. Claude Code rewrites plugin configuration files during its initialization sequence. Any manual fix survives only until the next session.

---

## 5. THE FIX -- Before and after

### marketplace.json entry

**Before (string source -- vulnerable):**
```json
{
  "name": "dev",
  "source": "./plugins/dev",
  "version": "2.7.0"
}
```

**After (git-subdir source -- reads from cache):**
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

### What changes in the execution flow

1. `typeof entry.source` evaluates to `'object'` instead of `'string'`
2. Plugin loader takes the `else` branch at `pluginLoader.ts:2129` instead of the `if` branch at line 2108
3. `pluginPath` is set to `installPath` (versioned cache at `~/.claude/plugins/cache/magus/dev/2.7.0/`) instead of `join(marketplaceDir, entry.source)` (inside the marketplace clone)
4. `pluginRoot` in the hook executor resolves to the cache directory, which is never deleted during marketplace refresh
5. Hooks continue to work even when the marketplace clone is missing

### Verification

```bash
# Delete the marketplace directory (simulates the bug)
rm -rf ~/.claude/plugins/marketplaces/magus

# Plugins still load from cache -- hooks run without errors
claude --print "test"

# Discovery is still broken (upstream bug, not fixed by this workaround)
claude /doctor
# Reports "Plugin dev not found in marketplace magus"

# Recover marketplace directory when ready
claude plugin marketplace update magus
```

---

## 6. THE SHARED DEPENDENCY PROBLEM

Four plugins had imports that reached outside their own directory tree:

| Plugin | Import target | Relative path in source |
|---|---|---|
| `dev` | `shared/model-aliases.json` | `../../../../../shared/model-aliases.json` |
| `nanobanana` | `shared/model-aliases.json` | `../../shared/model-aliases.json` |
| `kanban` | `tools/table/index.ts` | `../../../tools/table/index.ts` |
| `gtd` | `tools/table/index.ts` | `../../../tools/table/index.ts` |

`git-subdir` clones only the plugin's subdirectory. The shared files do not exist in the cache copy because they live outside the plugin directory boundary.

**Fix**: `scripts/sync-shared-deps.sh` copies each shared file into the consuming plugin's `lib/` directory. Import paths updated to reference `./lib/model-aliases.json` and `./lib/table.ts`. CI validates the copies match their sources.

---

## 7. WHAT IS NOT FIXED (honest assessment)

Plugin **discovery** still requires the marketplace clone directory. Two functions read `marketplace.json` from the clone:

- `getMarketplaceCacheOnly()` at `marketplaceManager.ts:2096`
- `getPluginByIdCacheOnly()` at `marketplaceManager.ts:2210`

Neither falls back to `installed_plugins.json`. When the marketplace clone is gone:

- `/doctor` reports plugins as "not found in marketplace"
- `claude plugin list` cannot display marketplace plugin metadata
- New installations from the marketplace fail

Installed plugins **work** (hooks run, skills load, commands execute) because the git-subdir migration routes them through the versioned cache. But the marketplace catalog is unavailable until `claude plugin marketplace update` re-clones it.

### Upstream fixes needed

**Atomic marketplace refresh**: `cacheMarketplaceFromGit()` should clone to a temporary directory, then atomically rename it over the old one. The delete-then-clone pattern guarantees a window where the directory is absent.

**Discovery fallback**: `getMarketplaceCacheOnly()` and `getPluginByIdCacheOnly()` should fall back to `installed_plugins.json` when the marketplace clone is missing. The installed plugins registry already records each plugin's entry data.

---

## 8. TIMELINE OF THE INVESTIGATION

1. Started with a `/debug` command investigating hook errors -- plugins intermittently failing
2. Initial hypothesis: race condition during `git pull` when two Claude Code sessions run concurrently -- **wrong**
3. Read the actual Claude Code source code. Found `fs.rm(cachePath, { recursive: true })` at `marketplaceManager.ts:1131`
4. Traced the call chain: `pluginAutoupdate.ts` -> `refreshMarketplace()` -> `cacheMarketplaceFromGit()` -> delete -> clone -> fail -> swallow error
5. Discovered the GCS asymmetry: official marketplace fetches from Google Cloud Storage, never hits the git code path
6. Searched GitHub issues. Found 8 open issues confirming this affects all third-party marketplaces, not just Magus
7. Analyzed debug logs: hooks worked at 02:16, broke at 02:17:24, recovered at 02:24 -- marketplace directory was transiently deleted during auto-update
8. Confirmed the marketplace directory was completely absent from disk during one investigation session
9. Identified the fix: change `marketplace.json` entries from string sources to git-subdir sources, routing plugin loading through the versioned cache
10. Discovered shared dependency blocker: 4 plugins had cross-directory imports that would break with git-subdir isolation
11. Built `sync-shared-deps.sh` to copy shared files into each plugin's `lib/` directory, plus CI validation
12. Deployed and verified: plugins install from cache with correct SHA, hooks survive marketplace deletion

---

## 9. QUOTES FROM GITHUB ISSUES (for attribution)

**From #24529 -- AKhozya:**
> "Plugin context (which plugin a hook belongs to) is lost during the merge, so `$` is never set. The command runs with the literal `${CLAUDE_PLUGIN_ROOT}` string."

**From #24529 -- alessandropcostabr:**
> "Claude Code overwrites plugin `hooks.json` files on every new session, not just on `claude plugins update`."

> "Every workaround shared in this thread assumes patches survive between sessions... This means users must re-run their workaround scripts before every single Claude Code session."

**From #40153 (the delete-then-clone issue):**
> "Marketplace auto-update should be atomic -- either the update succeeds completely, or the old directory is preserved."

---

## 10. SUGGESTED ARTICLE TITLES

1. "Why your Claude Code plugins keep breaking: a source code investigation"
2. "Inside Claude Code's plugin system: the delete-before-clone bug"
3. "How we fixed Claude Code's third-party plugin problem (without fixing Claude Code)"
4. "The asymmetry bug: why official Claude Code plugins never break but yours do"
5. "From error message to source code: debugging Claude Code's plugin marketplace"

---

## 11. SUGGESTED ARTICLE STRUCTURE (narrative arc)

### Act 1 -- The error (500 words)

What users see. The misleading error message. The dead-end recovery instructions. Multiple failed fix attempts across multiple sessions. Establish the frustration and the fact that the obvious fixes do not work.

### Act 2 -- The wrong hypothesis (300 words)

Race condition during `git pull`. Two concurrent sessions. Sounds plausible. Investigation into locking mechanisms. Realization that the bug happens in single-session scenarios too. The hypothesis collapses.

### Act 3 -- The source code (800 words)

Reading `marketplaceManager.ts`. The three-step sequence: pull, delete, clone. The gap between delete and clone. The error swallowed at `pluginAutoupdate.ts`. The hook executor that checks a path that no longer exists. Code snippets with line numbers.

### Act 4 -- The asymmetry (400 words)

Why official plugins are immune. GCS vs git. The architectural decision that creates two classes of marketplace. Data: no `.git` directory in `claude-plugins-official`. The asymmetry is not malicious -- GCS is faster and more reliable -- but the consequence is that third-party developers hit bugs that Anthropic never encounters internally.

### Act 5 -- The community (400 words)

Eight open GitHub issues. Quotes from frustrated users. Workarounds that get overwritten. The pattern: user patches a file, Claude Code rewrites it on next session start, user has to patch again. The loop.

### Act 6 -- The fix (600 words)

The `typeof` branch. String source vs dict source. The git-subdir migration. Shared dependency handling. The release workflow. Verification: delete the marketplace directory, confirm plugins still work.

### Act 7 -- What remains (300 words)

Discovery still breaks. The upstream fixes needed: atomic rename, discovery fallback. Honest about what the workaround does not solve. Filed the issue.

**Total estimate**: ~3,300 words

---

## 12. VISUAL/DIAGRAM SUGGESTIONS

### Diagram 1 -- The delete-then-clone sequence

```
Session start
    |
    v
pluginAutoupdate.ts
    |
    v
cacheMarketplaceFromGit()
    |
    v
git pull -----> SUCCESS -----> return (directory intact)
    |
    FAIL
    |
    v
fs.rm(cachePath)  <--- DIRECTORY DELETED HERE
    |
    v
git clone -----> SUCCESS -----> return (directory restored)
    |
    FAIL
    |
    v
throw Error -----> CAUGHT by pluginAutoupdate.ts
                        |
                        v
                   logForDebugging()  <--- ERROR SWALLOWED
                        |
                        v
                   directory permanently gone
                   user sees hook errors
```

### Diagram 2 -- The two marketplace refresh paths

```
refreshMarketplace(name)
    |
    +--> name === "claude-plugins-official"?
    |       |
    |       YES --> fetchOfficialMarketplaceFromGcs()
    |               (atomic tarball download, no deletion)
    |
    |       NO --> cacheMarketplaceFromGit()
    |              (pull -> delete -> clone, non-atomic)
    |
    v
```

### Diagram 3 -- The typeof branch in plugin loading

```
pluginLoader.ts:2108

typeof entry.source
    |
    +--> 'string'
    |       |
    |       v
    |    pluginPath = join(marketplaceDir, entry.source)
    |    (reads from marketplace clone -- VULNERABLE)
    |
    +--> 'object'
            |
            v
         pluginPath = installPath
         (reads from versioned cache -- SAFE)
```

---

## 13. SIDEBAR/CALLOUT IDEAS

**Callout: "What is a marketplace in Claude Code?"**
A marketplace is a collection of plugins distributed as a git repository (or GCS tarball for the official one). Claude Code clones the repository to `~/.claude/plugins/marketplaces/<name>/` and reads `marketplace.json` from it to discover available plugins.

**Callout: "What is autoUpdate?"**
When `autoUpdate: true` is set in `known_marketplaces.json`, Claude Code runs `git pull` on the marketplace clone at the start of every session. This is the trigger that kicks off the delete-then-clone sequence when the pull fails.

**Callout: "What is git-subdir?"**
A source type in Claude Code's plugin system. Instead of resolving a plugin's path relative to the marketplace clone, git-subdir clones just the plugin's subdirectory into a versioned cache at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. This cache is created during `claude plugin install` and is never touched during marketplace refresh.

**Callout: "The numbers"**
- 3 marketplaces, 1 immune (official), 2 vulnerable (git-based)
- 16 plugins in Magus, 8 with hooks that break when the directory is deleted
- 4,008 files in the Magus marketplace clone
- 8 open GitHub issues across macOS and Linux users
- 0 seconds of warning before the marketplace directory gets deleted

---

## 14. FACT-CHECK NOTES

All code snippets are from the Claude Code source tree, verified by reading the actual files. Line numbers reference the version analyzed during the investigation (Claude Code 2.1.92). Line numbers may shift in future versions.

The `installed_plugins.json` behavior (having correct cache paths but not being consulted by the hook executor) was verified by reading the hook loading code path: `loadPluginHooks.ts` -> `hooks.ts`. The hook executor receives `pluginRoot` from `plugin.path`, which is set during plugin loading in `pluginLoader.ts`, not from `installed_plugins.json`.

The official marketplace's GCS behavior was confirmed by: (a) the absence of a `.git` directory in `~/.claude/plugins/marketplaces/claude-plugins-official/`, and (b) the explicit `OFFICIAL_MARKETPLACE_NAME` check at `marketplaceManager.ts:2432`.

GitHub issue counts and quotes were gathered from `anthropics/claude-code` issues. Issue numbers and attributions should be verified against current state before publication -- issues may have been closed or comments edited.

The file count of 4,008 for the Magus marketplace was measured with `find -type f | wc -l` on the current clone. The marketplace.json manifest lists 16 plugins. 19 directories exist on disk (3 are not in the manifest).
