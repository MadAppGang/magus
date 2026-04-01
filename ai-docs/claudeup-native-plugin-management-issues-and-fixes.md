# Claudeup & Claude Code Native Plugin Management — Issues and Fixes

**Date**: 2026-04-01 (updated with official docs review)
**Status**: Active investigation — hook path regression still open
**Sessions**: 7b6f8cc7, 7741a354, 766fbad5, e72ebf18 (Mar 30-31, 2026)
**Official docs reference**: https://code.claude.com/docs — "Create and distribute a plugin marketplace"

---

## 1. Core Philosophy (User Decisions)

These are explicit decisions made by the user across multiple sessions:

1. **"We should not reimplement what Claude Code does itself"** — claudeup must delegate plugin lifecycle operations to `claude plugin` CLI commands. Any logic that duplicates what the CLI already does will drift as Claude Code evolves.

2. **"Claudeup should automatically fix it"** — when claudeup detects broken state (missing directories, stale versions, corrupted registry), it should repair automatically. No manual `/plugin reinstall` steps.

3. **"Use Claude Code approaches as possible"** — prefer native CLI commands over direct file manipulation. If the CLI provides a command for it, use it.

4. **"Make claudeup and magus as stable as possible with zero human interaction"** — the goal is fully autonomous plugin management. Users should never need to manually run repair commands, reinstall plugins, or debug path issues. Claudeup must detect and fix all recoverable problems silently.

---

## 2. What Claude Code Owns (Do Not Touch)

### Marketplace Installation (Official Way)

The **official** way to add a third-party marketplace is:
```
claude plugin marketplace add MadAppGang/magus
```
This writes to `known_marketplaces.json` and clones the repo to `~/.claude/plugins/marketplaces/magus/`.

**`extraKnownMarketplaces` is NOT the primary install method.** Per official docs: it's a team convenience feature — "so team members are automatically prompted to install your marketplace when they trust the project folder." It belongs in project `.claude/settings.json` to suggest marketplaces to teammates, NOT in user-level settings as the installation mechanism.

The `extraKnownMarketplaces` entry in `~/.claude/settings.json` is redundant when the marketplace is properly registered in `known_marketplaces.json`. It may have been left over from an earlier setup.

### State Files (CLI is sole writer)

| File | Purpose | CLI Commands |
|---|---|---|
| `~/.claude/plugins/installed_plugins.json` | Installation registry (v2 schema, includes `gitCommitSha`) | `plugin install`, `plugin update`, `plugin uninstall` |
| `~/.claude/plugins/known_marketplaces.json` | **Primary marketplace registry** with `autoUpdate` flag | `plugin marketplace add/remove/update` |
| `settings.json` → `enabledPlugins` | Plugin on/off state | `plugin enable/disable` |
| `settings.json` → `installedPluginVersions` | Version index for update detection | `plugin install/update` |
| `settings.json` → `extraKnownMarketplaces` | **Team suggestion only** — prompts teammates to install. NOT the primary marketplace mechanism. | Set in project settings for team use |

### Physical Directories (CLI manages lifecycle)

| Path | Purpose |
|---|---|
| `~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/` | **Canonical install location.** Plugin files are COPIED here on install. **`CLAUDE_PLUGIN_ROOT` should point here at runtime** (per official docs: "reference files within the plugin's installation directory"). |
| `~/.claude/plugins/marketplaces/{name}/` | Git clones for **fetching/discovery only**. Mutated by `git pull` on session start. NOT the install location — plugins run from cache. |
| `~/.claude/plugins/data/{plugin}-{marketplace}/` | Plugin persistent runtime data. Survives updates. Use `${CLAUDE_PLUGIN_DATA}` to reference. |

### Key Insight from Official Docs

> "When users install a plugin, Claude Code **copies** the plugin directory to a **cache location**. This means plugins can't reference files outside their directory."

The marketplace clone is the **source**, the cache is the **installation**. `CLAUDE_PLUGIN_ROOT` should resolve to cache, not marketplace.

### CLI Command Surface (v2.1.87+)

```
claude plugin install <plugin> --scope user|project|local [--sparse]
claude plugin uninstall <plugin> --scope user|project|local [--keep-data]
claude plugin enable <plugin> --scope user|project|local|auto-detect
claude plugin disable [plugin] --scope user|project|local|auto-detect [--all]
claude plugin update <plugin> --scope user|project|local|managed
claude plugin list [--json] [--available]
claude plugin validate <path>
claude plugin marketplace add <source> --scope user|project|local [--sparse]
claude plugin marketplace remove <name>
claude plugin marketplace update [name]
claude plugin marketplace list [--json]
```

---

## 2b. extraKnownMarketplaces Cleanup (Implemented)

**Problem:** Claudeup used `extraKnownMarketplaces` in `settings.json` as its primary marketplace discovery mechanism. This is wrong — per official docs, `extraKnownMarketplaces` is a team convenience feature ("so team members are automatically prompted to install your marketplace"), NOT the primary install path. The official registry is `known_marketplaces.json`.

**What was changed (claudeup):**

1. **Prerunner cleanup step** (`prerunner/index.ts`, Step 0.55): On every run, checks if any `extraKnownMarketplaces` entries in user or project settings are already in `known_marketplaces.json`. If so, removes the redundant `extraKnownMarketplaces` entry. Deletes the field entirely if empty.

2. **Marketplace discovery** (`claude-settings.ts`): `discoverMarketplacesFromSettings()` now reads `known_marketplaces.json` as the **primary** source (priority #1), with `extraKnownMarketplaces` as a **legacy fallback** (priority #2, only adds entries not already in `known_marketplaces.json`).

3. **`getConfiguredMarketplaces()` / `getGlobalConfiguredMarketplaces()`**: Same pattern — `known_marketplaces.json` first, `extraKnownMarketplaces` as fallback.

4. **Migration code preserved**: The old marketplace rename migration (`migrateMarketplaceRename`) still handles `extraKnownMarketplaces` key renames for users upgrading from very old versions.

5. **Team config help text preserved**: `PluginsScreen.tsx` correctly describes `extraKnownMarketplaces` as a team feature.

**Result:** After running the prerunner, the redundant `magus` entry in user-level `~/.claude/settings.json` `extraKnownMarketplaces` will be removed. Project-level entries for marketplaces already in `known_marketplaces.json` will also be removed.

---

## 3. What Claudeup Legitimately Owns

These capabilities have NO equivalent in the native CLI:

1. **Update-check TTL caching** (`claudeup-cache.json`) — 1-hour TTL prevents re-fetching manifests on every prerunner invocation
2. **Environment variable collection** — interactive `collectPluginEnvVars()` for API tokens
3. **System dependency installation** (`installPluginSystemDeps`) — npm globals, Python packages
4. **TUI plugin browser** — navigable terminal UI for browsing/updating plugins
5. **`hasUpdate` computation** — cross-referencing installed vs marketplace versions
6. **Prerunner auto-update orchestration** — decides which plugins to update, delegates to CLI
7. **`repairPluginJson`** — compatibility shim for older plugin manifests
8. **Profile management** — save/restore plugin sets
9. **Marketplace sync scheduling** (`autoSyncIfStale`) — decides when to call `marketplace update`

---

## 4. Dual-Write Problem (Fixed in v4.5.0-v4.5.2)

### What Was Wrong

Claudeup had 7 sites that wrote to Claude Code-owned state files after CLI calls:

| Location | What It Wrote | Problem |
|---|---|---|
| `PluginsScreen.tsx` x4 | `settings.json` + `installed_plugins.json` + cache | Redundant post-CLI write; lost `gitCommitSha` |
| `prerunner/index.ts` line 284 | `settings.json` + `installed_plugins.json` + cache | Ran even when CLI unavailable (phantom version) |
| `saveGlobalInstalledPluginVersion` | `settings.json` + `installed_plugins.json` | Chained write; `gitCommitSha: undefined` |
| `copyPluginToCache` | cache directory | Deleted and recreated CLI's cache copy |

### What Was Fixed

- **v4.5.0** (commit `c57f3e6`): Removed all 7 dual-write sites. CLI is sole writer.
- **v4.5.1** (commit `967232c`): Discovered CLI's `plugin install` does NOT write `installedPluginVersions`. Restored version tracking after CLI calls. Added marketplace recovery using `marketplace update` (re-clones missing dirs).
- **v4.5.2** (commit `16956fd`): Added detection of conflicting package managers (npm + bun installed simultaneously) during `claudeup update`.
- **v4.5.2 hotfix** (commit `786275f`): Removed doctor command (claudeup-core not in npm deps).

### Key Learning

The CLI's `plugin install` writes `enabledPlugins` and `installed_plugins.json` but does NOT always update `installedPluginVersions` in `settings.json`. Claudeup must write this field after successful CLI operations — this is NOT a dual-write, it's a legitimate gap fill.

---

## 5. The Hook Path Regression (STILL OPEN)

### Symptom

```
Stop hook error: Failed to run: Plugin directory does not exist:
/Users/jack/.claude/plugins/marketplaces/magus/plugins/dev (dev@magus — run /plugin to reinstall)
```

This error appears intermittently in Claude Code sessions. Affects the `stop-coaching.sh` hook from `dev@magus`.

### Root Cause Analysis (from session 7b6f8cc7)

**Claude Code's hook executor resolves `CLAUDE_PLUGIN_ROOT` to the marketplace path, not the cache path.**

Evidence:
- `installed_plugins.json` says `installPath: /Users/jack/.claude/plugins/cache/magus/dev/2.7.0`
- Error message says path is `/Users/jack/.claude/plugins/marketplaces/magus/plugins/dev`
- The hook executor constructs the marketplace path independently rather than reading `installPath` from the registry

### Why It Happens Intermittently

1. Session A starts, `git pull` runs on `~/.claude/plugins/marketplaces/magus/`. Hooks work.
2. User pushes new commits from working directory to GitHub.
3. Session B starts (or claudeup runs update). `git pull` runs on the SAME marketplace clone. During pull, git momentarily replaces files — the directory may briefly not exist.
4. Session A's hook executor tries to `fs.stat()` the marketplace path during the transient state → fails.

Additionally: if the marketplace clone was deleted or never created (as observed on Mar 30 when `marketplaces/magus/` was missing entirely), ALL hooks fail permanently for that session.

### What Session 7b6f8cc7 Found (Decompiled Code)

The Claude Code hook executor function `pi_`:
```javascript
async function pi_(H, _, q, $, K, O, T, z, A, f, w, Y) {
  if (z) {
    if (!await W$(z))  // W$ = fs.exists check
      throw Error(`Plugin directory does not exist: ${z}` + 
        (A ? ` (${A} — run /plugin to reinstall)` : ""));
    X = X.replace(/\${CLAUDE_PLUGIN_ROOT}/g, () => KH);
  }
```

Parameter `z` (pluginDir) is the marketplace path, NOT the cache path from `installPath`.

### Current State (2026-04-01)

- `~/.claude/plugins/marketplaces/magus/` EXISTS and is up-to-date
- `~/.claude/plugins/marketplaces/magus/plugins/dev/hooks/stop-coaching.sh` EXISTS
- `installed_plugins.json` → `installPath` points to cache (correct)
- Error still occurs sporadically when marketplace clone is in transient `git pull` state

### This Is a Claude Code Bug (Confirmed by Official Docs)

The official docs state: `${CLAUDE_PLUGIN_ROOT}` is for "reference files within the plugin's **installation directory**" — which is the cache, not the marketplace clone. The fix belongs in Claude Code: the hook executor should use `installPath` from `installed_plugins.json` (the cache path) instead of constructing a marketplace path. The cache is immutable once written; the marketplace clone is a mutable git repo that can be deleted by Claude Code upgrades.

### Marketplace Disappearance Timeline (2026-04-01)

The marketplace directory disappeared between two sessions. What we know:
- **00:35 UTC**: Marketplace existed (debug log: "Successfully refreshed marketplace: magus")
- **01:07 UTC**: Session c8cc0012 ended normally
- **~01:08 UTC**: Claude Code auto-upgraded from v2.1.87 → v2.1.89 (symlink timestamp)
- **01:07–02:52 UTC**: No debug logs exist for this period. Something deleted `~/.claude/plugins/marketplaces/magus/`.
- **02:52 UTC**: Next session started — marketplace gone, all hooks fail
- **03:03 UTC**: Marketplace re-cloned by claudeup prerunner in another session

**Possible causes (unproven — no logs in the gap):**
1. Claude Code upgrade process deleted/reset third-party marketplace clones
2. A failed `git pull` during an unlogged session start corrupted the directory
3. claudeup's `recoverMarketplaceSettings()` removed the registry entry because the dir was temporarily missing (which would then prevent re-cloning)

**What IS proven:** the marketplace clone is fragile — it can disappear, and when it does, all hooks break because the hook executor uses the marketplace path instead of the cache path. The cache survived whatever happened.

### What Claudeup Can Do (Workaround)

Claudeup's prerunner already calls `marketplace update` to recover missing marketplace directories. But it can't fix the race condition where `git pull` transiently removes the directory mid-session. Possible claudeup-level mitigations:

1. **Ensure marketplace clone exists on every prerunner run** — already implemented in v4.5.1
2. **Report the bug upstream** — this is a Claude Code path resolution bug
3. **Consider disabling hooks that reference `CLAUDE_PLUGIN_ROOT`** when running inside the magus development repo (where the local checkout could be used instead)

---

## 6. All Plugins With Hooks (Full Surface Area)

Every hook using `${CLAUDE_PLUGIN_ROOT}` is affected by the path resolution bug. 7 plugins have hooks:

| Plugin | Hook Types | Scripts |
|---|---|---|
| **dev** | Stop, SessionStart | `stop-coaching.sh`, `session-start-coaching.sh` |
| **terminal** | PreToolUse:Bash | `block-tmux-kill.sh` |
| **code-analysis** | PreToolUse:Bash | `block-git-add-private.sh` |
| **multimodel** | PreToolUse:Task, PreToolUse:Bash | `enforce-team-rules.sh` |
| **gtd** | SessionStart, PreToolUse:TaskCreate, PostToolUse:TaskCreate/TaskUpdate, Stop | `session-start-gtd.sh`, `pre-task-create.sh`, `post-task-create.sh`, `post-task-update.sh`, `stop-gtd.sh` |
| **seo** | SessionStart | `session-start.sh` |
| **stats** | PreToolUse, PostToolUse, Stop, SessionStart | `pre-tool.ts`, `post-tool.ts`, `stop-stats.sh`, `session-start-stats.sh` |

When the marketplace path is missing, **all** these hooks fail — not just the dev Stop hook. The PreToolUse:Bash errors the user sees come from terminal and/or code-analysis hooks.

---

## 7. Troubleshooting Runbook

When investigating plugin or hook failures, follow these steps in order.

### Symptom: "Plugin directory does not exist" errors on hooks

```bash
# 1. Check marketplace clone exists
ls ~/.claude/plugins/marketplaces/magus/plugins/
# Expected: list of plugin directories (dev, terminal, code-analysis, etc.)
# If missing: run `claude plugin marketplace update magus`

# 2. Check installed_plugins.json has correct installPath
cat ~/.claude/plugins/installed_plugins.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
for k,v in d.get('plugins',{}).items():
    if 'magus' in k: print(f'{k}: {v[0][\"installPath\"]} (v{v[0][\"version\"]})')
"
# Expected: paths like ~/.claude/plugins/cache/magus/{plugin}/{version}

# 3. Check cache directories exist
ls ~/.claude/plugins/cache/magus/
# Expected: one directory per installed plugin

# 4. Check settings match across scopes
python3 -c "
import json
for path, label in [
    ('$HOME/.claude/settings.json', 'USER'),
    ('.claude/settings.json', 'PROJECT'),
]:
    try:
        d = json.load(open(path.replace('\$HOME','$HOME')))
        eps = {k:v for k,v in d.get('enabledPlugins',{}).items() if 'magus' in k}
        ipv = {k:v for k,v in d.get('installedPluginVersions',{}).items() if 'magus' in k}
        print(f'{label}: enabled={list(eps.keys())}, versions={ipv}')
    except: pass
"
```

### Symptom: Plugins not loading (no skills/commands available)

```bash
# 1. Check enabledPlugins in the correct scope
cat .claude/settings.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('Enabled:', [k for k,v in d.get('enabledPlugins',{}).items() if v])
"

# 2. Check plugin is installed at the right project scope
cat ~/.claude/plugins/installed_plugins.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
import os; cwd=os.getcwd()
for k,v in d.get('plugins',{}).items():
    if 'magus' in k:
        for e in v:
            if e.get('projectPath') == cwd:
                print(f'{k}: scope={e[\"scope\"]}, version={e[\"version\"]}')
"
# If plugin not found for this project: run `claude plugin install {name}@magus --scope project`

# 3. Reinstall if needed
claude plugin marketplace update magus
claude plugin install dev@magus --scope project
```

### Symptom: Stale plugin version (update badge won't clear)

```bash
# Check installedPluginVersions vs marketplace
cat .claude/settings.json | python3 -c "
import sys,json; print(json.dumps(json.load(sys.stdin).get('installedPluginVersions',{}), indent=2))
"
# Compare with marketplace.json versions
cat .claude-plugin/marketplace.json | python3 -c "
import sys,json
for p in json.load(sys.stdin).get('plugins',[]):
    print(f'{p[\"name\"]}: {p[\"version\"]}')
"
# If mismatch: CLI may not have updated installedPluginVersions.
# Fix: run `claude plugin update {name}@magus --scope project`
```

### Symptom: Marketplace clone missing or corrupted

```bash
# Check known_marketplaces.json
cat ~/.claude/plugins/known_marketplaces.json | python3 -m json.tool

# Re-clone marketplace
claude plugin marketplace update magus

# Verify
ls ~/.claude/plugins/marketplaces/magus/plugins/
```

---

## 8. Investigation Plan for New Regressions

See `ai-docs/claudeup-hook-regression-plan.md` for the current open investigation (hook path resolution bug).

When a NEW regression appears:
1. Read this document first — check if the symptom matches a known issue above
2. Collect: error message, which hooks/plugins affected, marketplace directory state, installed_plugins.json entries
3. Check if marketplace clone exists and has correct content
4. Check if the issue is in Claude Code's path resolution (pre-script failure) or in the hook script itself
5. If unfamiliar: add findings to this document under a new section

---

## 9. Relevant Artifacts

| Artifact | Location |
|---|---|
| Original research report | `ai-docs/sessions/dev-research-claude-code-native-plugin-mgmt-20260330-100923-a02b20a8/report.md` |
| Research findings | `ai-docs/sessions/dev-research-claude-code-native-plugin-mgmt-20260330-100923-a02b20a8/findings/` |
| Hook regression investigation plan | `ai-docs/claudeup-hook-regression-plan.md` |
| Session handoff (older) | `ai-docs/claudeup-session-handoff.md` |
| Dual-write fix commits | `c57f3e6`, `9b9ee7f`, `967232c`, `16956fd`, `786275f` |
