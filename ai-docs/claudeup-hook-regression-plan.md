# Investigation Plan: Hook Path Regression

**Date**: 2026-04-01
**Bug**: `Stop hook error: Plugin directory does not exist: .../marketplaces/magus/plugins/dev`
**Also**: `PreToolUse:Bash hook error` (same root cause suspected)
**Consolidated context**: `ai-docs/claudeup-plugin-management-consolidated.md`

---

## Hypothesis

Claude Code's hook executor resolves `${CLAUDE_PLUGIN_ROOT}` to the **marketplace path** (`~/.claude/plugins/marketplaces/magus/plugins/dev`) instead of the **cache path** (`~/.claude/plugins/cache/magus/dev/2.7.0`). When the marketplace clone is missing, stale, or mid-`git pull`, hooks fail.

## Investigation Steps

### Step 1: Confirm which path Claude Code actually passes to hooks

**Method**: Add debug logging to the hook script itself.

Edit `plugins/dev/hooks/stop-coaching.sh` to log `CLAUDE_PLUGIN_ROOT`:
```bash
echo "CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT}" >> /tmp/hook-debug.log
echo "PWD=$(pwd)" >> /tmp/hook-debug.log
echo "---" >> /tmp/hook-debug.log
```

Then trigger the hook (end a Claude session) and read `/tmp/hook-debug.log`.

**Expected result**: Either marketplace path or cache path. This tells us definitively what Claude Code passes.

**Key insight**: If the error fires BEFORE the script runs (as session 7b6f8cc7 found), the debug logging won't execute. In that case, the `fs.exists` check in the hook executor is failing on the directory itself, not on the script path.

### Step 2: Check if error is pre-script or in-script

**Method**: Read the debug log from this session.

```bash
cat ~/.claude/debug/07f7f90e-a2e2-462d-b1c8-0ef34255626d.txt | grep -i "hook\|plugin.*dir\|CLAUDE_PLUGIN"
```

If the log shows "Plugin directory does not exist" BEFORE any script execution attempt, the issue is in Claude Code's hook pre-check. If it shows the script starting but failing, the issue is in the script.

### Step 3: Check for scope mismatch

**Method**: Compare project-scope vs user-scope installation.

The `installed_plugins.json` shows `dev@magus` installed at project scope (projectPath: `/Users/jack/mag/magus`). But `settings.json` at both user and project level have different `enabledPlugins` entries. 

Check if Claude Code uses different path resolution for project-scope vs user-scope plugins:
- Project-scope might resolve through the marketplace clone
- User-scope might resolve through the cache

```bash
# Check if any magus plugin is installed at user scope
cat ~/.claude/plugins/installed_plugins.json | python3 -c "
import sys,json
d = json.load(sys.stdin)
for name, entries in d.get('plugins',{}).items():
    if 'magus' in name:
        for e in entries:
            if e.get('scope') == 'user':
                print(f'USER SCOPE: {name} -> {e[\"installPath\"]}')" 
```

### Step 4: Reproduce the error deterministically

**Method**: Temporarily rename the marketplace directory and start a session.

```bash
# CAUTION: This will break hooks temporarily
mv ~/.claude/plugins/marketplaces/magus ~/.claude/plugins/marketplaces/magus.bak
# Start a new claude session in the magus project
# Observe: does the Stop hook error appear?
# Then restore:
mv ~/.claude/plugins/marketplaces/magus.bak ~/.claude/plugins/marketplaces/magus
```

This confirms whether the marketplace path is the one being checked.

### Step 5: Test the cache path theory

**Method**: Check if explicitly setting `installPath` in `installed_plugins.json` to the cache path fixes it.

The current `installPath` already points to cache. If Claude Code ignores this for hooks, the fix must come from Claude Code. Verify by:

1. Read the Claude Code debug log for which path it checks
2. Search the decompiled Claude Code source for the hook path resolution

### Step 6: Determine claudeup-level workaround

Based on findings from steps 1-5:

**If marketplace path is always used for hooks:**
- Claudeup prerunner must ensure marketplace clone is always present and valid
- Already partially implemented in v4.5.1 (`marketplace update` recovery)
- Enhancement: add a health check that verifies the marketplace directory exists and has the expected plugin subdirectories

**If race condition during `git pull`:**
- Consider locking: claudeup could use a lockfile during marketplace sync
- Or: claudeup could clone to a temp directory and atomic-rename
- But: Claude Code itself runs `git pull` on session start — claudeup can't control that

**If this is purely a Claude Code bug:**
- File issue on Claude Code repo
- Document workaround: `claude plugin marketplace update magus` to re-clone
- Add to claudeup's `doctor` command (once it ships)

## Decision Point

After Step 2-3, we'll know whether this is:
- **A**: Claude Code always uses marketplace path for hooks (Claude Code bug → file upstream)
- **B**: Marketplace clone missing/stale (claudeup recovery needs improvement)
- **C**: Race condition during git pull (hard to fix from claudeup side)
- **D**: Scope mismatch causing wrong path resolution (fixable by changing install scope)

## Priority

This bug causes noisy error messages on every session stop/start but doesn't break functionality (the hooks are coaching/learning features, not critical). Medium priority — fix when convenient, workaround is to run `claude plugin marketplace update magus`.
