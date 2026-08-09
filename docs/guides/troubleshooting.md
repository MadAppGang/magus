# Troubleshooting Guide

Common issues and solutions for Magus.

---

## Common Issues

### Plugin Not Loading

#### Symptom
Plugin doesn't appear in `/plugin list` or isn't available in Claude Code.

#### Solutions

**1. Check Settings Format**

Your `.claude/settings.json` must use **object format**, not array format:

```json
// ✅ CORRECT - Object format (required)
{
  "enabledPlugins": {
    "dev@magus": true,
    "code-analysis@magus": true
  }
}
```

```json
// ❌ INCORRECT - Array format (will cause validation error)
{
  "enabledPlugins": [
    "dev@magus",
    "code-analysis@magus"
  ]
}
```

**2. Verify Marketplace is Added**

```bash
# List installed marketplaces
/plugin marketplace list

# If marketplace not listed, add it
/plugin marketplace add MadAppGang/magus
```

**3. Check Settings File Location**

```bash
# Settings must be in project root
ls -la .claude/settings.json

# If missing, create it
mkdir -p .claude
cat > .claude/settings.json <<EOF
{
  "enabledPlugins": {
    "dev@magus": true
  }
}
EOF
```

**4. Reload Plugin**

```bash
/plugin reload dev@magus
```

**5. Restart Claude Code**

Complete restart may be needed for some changes.

---

### Marketplace Not Found

#### Symptom
Error: "Marketplace 'magus' not found"

#### Solutions

**1. Add Marketplace**

```bash
/plugin marketplace add MadAppGang/magus
```

**2. Verify Marketplace Added**

```bash
/plugin marketplace list
```

**3. Update Marketplace Metadata**

```bash
/plugin marketplace update magus
```

**4. Re-add if Needed**

```bash
# Remove and re-add
/plugin marketplace remove magus
/plugin marketplace add MadAppGang/magus
```

**5. Check Internet Connection**

```bash
# Test GitHub access
ping github.com
curl -I https://github.com/MadAppGang/magus
```

---

### Environment Variables Missing

#### Symptom
Plugin loads but features don't work (e.g., Figma import fails, API calls fail)

#### Solutions

**1. Check Required Variables**

See plugin documentation for required variables:
- [Terminal Plugin Dependencies](../../plugins/terminal/DEPENDENCIES.md)
- Check plugin's README.md

**2. Set Environment Variables**

**In shell profile (~/.zshrc or ~/.bashrc):**

```bash
export FIGMA_ACCESS_TOKEN="your-token-here"
export APIDOG_API_TOKEN="your-token-here"
```

**In project .env file:**

```bash
# Create .env in project root
cat > .env <<EOF
FIGMA_ACCESS_TOKEN=your-token-here
APIDOG_API_TOKEN=your-token-here
EOF
```

**3. Reload Shell**

```bash
source ~/.zshrc
# or
source ~/.bashrc
```

**4. Verify Variables Are Set**

```bash
echo $FIGMA_ACCESS_TOKEN
echo $APIDOG_API_TOKEN
```

**5. Use Configuration Command**

Some plugins have setup commands:

```bash
/configure-mcp
```

This will guide you through setting up required variables.

---

### Wrong Plugin Version

#### Symptom
Features missing or plugin behaves differently than expected

#### Solutions

**1. Check Installed Version**

```bash
/plugin list
```

Look for version number next to plugin name.

**2. Check Latest Version**

```bash
/plugin marketplace update magus
/plugin list
```

**3. Update Plugin**

```bash
# Method 1: Marketplace update (automatic)
/plugin marketplace update magus

# Method 2: Reinstall plugin
/plugin remove dev@magus
/plugin install dev@magus
```

**4. Install Specific Version**

```bash
/plugin install dev@magus@2.3.0
```

---

### Settings Validation Error

#### Symptom
Error about invalid settings format or validation failure

#### Common Causes & Fixes

**1. Wrong enabledPlugins Format**

```json
// ❌ WRONG - Array
"enabledPlugins": ["dev@magus"]

// ✅ CORRECT - Object
"enabledPlugins": {
  "dev@magus": true
}
```

**2. Invalid JSON Syntax**

```json
// ❌ WRONG - Trailing comma
{
  "enabledPlugins": {
    "dev@magus": true,
  }
}

// ✅ CORRECT - No trailing comma
{
  "enabledPlugins": {
    "dev@magus": true
  }
}
```

**3. Missing Quotes**

```json
// ❌ WRONG - Unquoted value
{
  "enabledPlugins": {
    "dev@magus": yes
  }
}

// ✅ CORRECT - Quoted boolean
{
  "enabledPlugins": {
    "dev@magus": true
  }
}
```

**Validate JSON:**

```bash
# Check if JSON is valid
cat .claude/settings.json | python3 -m json.tool
```

---

### MCP Server Not Working

#### Symptom
Features that require MCP servers don't work (Figma import, browser testing, etc.)

#### Solutions

**1. Check MCP Configuration**

Verify MCP servers are configured in Claude Code settings.

**2. Verify Environment Variables**

```bash
# Check required variables
echo $FIGMA_ACCESS_TOKEN
echo $CHROME_EXECUTABLE_PATH
```

**3. Use Configuration Command**

```bash
/configure-mcp
```

This checks existing configuration and helps set up missing pieces.

**4. Test MCP Server Manually**

```bash
# Test Figma MCP server
npx @modelcontextprotocol/server-figma --help

# Test Chrome DevTools server
npx @automatalabs/mcp-server-chrome --help
```

**5. Check Node.js Version**

```bash
node --version
# Should be 18.x or higher
```

**6. Reinstall MCP Servers**

```bash
# Clear npm cache
npm cache clean --force

# Reinstall (MCP servers are installed on-demand)
# Just run the feature that uses the server
```

---

### Agent/Command Not Found

#### Symptom
Trying to use an agent or command results in "not found" error

#### Solutions

**1. Verify Plugin is Enabled**

```bash
/plugin list
```

Enabled plugins show with a checkmark or indicator.

**2. Check Plugin Manifest**

```bash
# View plugin configuration
cat .claude-plugin/marketplace.json

# Or for installed plugin
cat ~/.config/claude-code/plugins/dev@magus/plugin.json
```

Verify the agent/command is listed in `agents` or `commands` arrays.

**3. Reload Plugin**

```bash
/plugin reload dev@magus
```

**4. Reinstall Plugin**

```bash
/plugin remove dev@magus
/plugin install dev@magus
```

**5. Check Spelling**

Agent and command names are case-sensitive and must match exactly.

---

### Performance Issues

#### Symptom
Claude Code is slow or plugins are taking too long to respond

#### Solutions

**1. Check System Resources**

```bash
# Check CPU and memory usage
top
# or
htop
```

**2. Reduce Concurrent Operations**

- Don't run multiple agents simultaneously
- Wait for one operation to complete before starting another

**3. Clear Plugin Cache**

```bash
# Remove and reinstall plugins
/plugin remove dev@magus
/plugin install dev@magus
```

**4. Check Network Speed**

Some plugins make API calls:
```bash
# Test network speed
speedtest-cli
# or visit https://fast.com
```

**5. Update to Latest Version**

```bash
/plugin marketplace update magus
```

---

### Permission Errors

#### Symptom
Errors about file permissions or access denied

#### Solutions

**1. Check File Permissions**

```bash
# Check settings file
ls -la .claude/settings.json

# Should be readable/writable by your user
# If not, fix permissions:
chmod 644 .claude/settings.json
```

**2. Check Directory Permissions**

```bash
# Check plugin directory
ls -la ~/.config/claude-code/plugins/

# Fix if needed
chmod -R 755 ~/.config/claude-code/
```

**3. Run Without Sudo**

Never run Claude Code with sudo. This can cause permission issues.

---

### "X skill descriptions dropped" warning

#### Symptom

Claude Code shows a banner like:

```
Skill listing will be truncated. 99 descriptions dropped (full descriptions kept
for most-used skills) (4%/1% of context). Run /skills to disable some, or raise
skillListingBudgetFraction (currently 1%) in settings.json.
```

#### What this means

Claude Code 2.1.105+ enforces a budget on the skill listing it injects into the system prompt at the start of each turn. The budget is `min(skillListingBudgetFraction × context_tokens × 4, 8000)` characters with an **8,000-char hard cap that binds for any model with ≥200k context**. When the corpus exceeds the budget, lower-priority skill descriptions get dropped from the listing.

Magus ships ~125 skills. With aggressive disable-model-invocation flags + tight descriptions, the listing-eligible portion is ~98 skills × ~155 chars = ~15,200 chars. **Roughly half fit per turn at default settings.**

The dropped skills are still installed and still invocable via `/skill-name`. They just don't auto-trigger from natural language until you've used them — Claude Code prioritizes "most-used" skills via a 7-day-half-life formula.

#### Solutions, in order of preference

**1. Use `/skill-name` for the skills you care about.**

Claude Code "warms" used skills via priority cache (formula: `usageCount × max(0.5^(daysSinceLastUse/7), 0.1)`). Invoking a skill once keeps it in the listing for weeks. The drop only affects fresh sessions where no priority history exists.

**2. Disable plugins you don't use.**

```bash
/plugin disable {name}@magus
```

Each disabled plugin's skills leave the corpus entirely.

**3. Raise the budget (power-user opt-in).**

```json
// ~/.claude/settings.json
{ "skillListingBudgetFraction": 0.05 }
```

This raises the budget from 1% to 5% (~8k extra tokens per turn). On models with **<200k context**, this gives more room. On 1M-context models, the 8,000-char hard cap binds — raising the fraction past ~0.2% buys nothing.

**Trade-off:** every turn pays ~8k more tokens for skill metadata. Over a 90-turn session that's ~720k tokens spent on skill listings. Use rate limits faster.

**4. Per-session escape hatch.**

```bash
SLASH_COMMAND_TOOL_CHAR_BUDGET=40000 claude
```

This env var overrides everything with an absolute char count. Useful for one-off sessions when you need every skill visible.

#### What Magus does to mitigate

- **Library/internal skills** (~28 of them) are flagged `disable-model-invocation: true` — they leave the listing budget but stay invocable via `/skill-name`.
- **All descriptions** follow Anthropic's official 200-char third-person + "Use when…" pattern.
- **CI guardrail** (`scripts/skill-budget-check.ts`) blocks regressions on every release.

Run `scripts/skill-budget-check.ts` for current totals and the per-skill offenders.

---

## Debugging Steps

### Systematic Debugging

When encountering an issue, follow these steps in order:

**1. Check Plugin Status**
```bash
/plugin list
```

**2. Verify Settings**
```bash
cat .claude/settings.json
```

**3. Check Marketplace**
```bash
/plugin marketplace list
```

**4. Verify Environment**
```bash
echo $FIGMA_ACCESS_TOKEN
echo $APIDOG_API_TOKEN
node --version
```

**5. Review Logs**
Check Claude Code logs for error messages (location varies by OS)

**6. Test in Isolation**
- Disable other plugins
- Test with minimal configuration
- Try in a fresh project

**7. Reinstall**
```bash
/plugin remove plugin-name@marketplace-name
/plugin install plugin-name@marketplace-name
```

---

## Getting Help

### Before Asking for Help

Gather this information:

1. **Plugin version**
   ```bash
   /plugin list
   ```

2. **Claude Code version**
   Check in Claude Code settings/about

3. **OS and version**
   ```bash
   uname -a
   ```

4. **Settings file**
   ```bash
   cat .claude/settings.json
   ```

5. **Error message**
   Copy the exact error message

6. **Steps to reproduce**
   List steps that cause the issue

### Where to Get Help

**GitHub Issues (Recommended)**
- [Report a bug](https://github.com/MadAppGang/magus/issues/new)
- [Ask a question](https://github.com/MadAppGang/magus/issues/new)
- Search existing issues first

**Email Support**
- [i@madappgang.com](mailto:i@madappgang.com)
- Include all information listed above

**Documentation**
- [Development Guide](../authoring/development-guide.md)
- [Development Guide](../authoring/development-guide.md)
- [Advanced Usage](./advanced-usage.md)

---

## Prevention Tips

### Avoid Common Mistakes

1. ✅ **Always use object format** for `enabledPlugins`
2. ✅ **Keep plugins updated** regularly
3. ✅ **Set environment variables** before using features
4. ✅ **Test changes** in a safe environment first
5. ✅ **Read plugin documentation** before using new features

### Best Practices

1. **Commit `.claude/settings.json`** to version control
2. **Document required env vars** in project README
3. **Keep marketplace updated** monthly
4. **Test plugins** after Claude Code updates
5. **Backup settings** before major changes

---

## Emergency Recovery

### Plugin Completely Broken

```bash
# 1. Remove all plugins
/plugin list
# Note which plugins are installed

# 2. Remove broken plugin
/plugin remove dev@magus

# 3. Remove marketplace
/plugin marketplace remove magus

# 4. Re-add marketplace
/plugin marketplace add MadAppGang/magus

# 5. Reinstall plugins
/plugin install dev@magus

# 6. Verify
/plugin list
```

### Settings File Corrupted

```bash
# 1. Backup current settings
cp .claude/settings.json .claude/settings.json.backup

# 2. Create fresh settings
cat > .claude/settings.json <<EOF
{
  "enabledPlugins": {
    "dev@magus": true
  }
}
EOF

# 3. Restart Claude Code

# 4. Verify
cat .claude/settings.json
```

### Complete Reset

**Warning:** This removes all plugin configuration.

```bash
# 1. Remove all marketplaces
/plugin marketplace list
# Remove each one

# 2. Remove settings
rm -rf .claude/settings.json

# 3. Start fresh
# Follow Quick Start guide in README
```

---

## Related Documentation

- **[Quick Start](../../README.md#quick-start)** - Installation guide
- **[Advanced Usage](./advanced-usage.md)** - Advanced configuration
- **[Development Guide](../authoring/development-guide.md)** - Plugin development
- **[Development Guide](../authoring/development-guide.md)** - Complete user guide

---

**Still stuck?** [Open an issue](https://github.com/MadAppGang/magus/issues/new) or email [i@madappgang.com](mailto:i@madappgang.com)
