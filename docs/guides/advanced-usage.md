# Advanced Usage Guide

Advanced installation methods, configuration options, and workflows for Magus.

---

## Table of Contents

- [Global Plugin Installation](#global-plugin-installation)
- [Local Development](#local-development)
- [Project-Specific Marketplace](#project-specific-marketplace)
- [Version Management](#version-management)
- [Plugin Updates](#plugin-updates)
- [Custom Configuration](#custom-configuration)

---

## Global Plugin Installation

### Overview

Global installation makes plugins available in **all projects** without per-project configuration.

### When to Use

✅ **Use global installation when:**
- Individual developer working alone
- Testing a plugin before adding to team projects
- Personal projects without team coordination
- Quick experimentation

❌ **Avoid global installation for:**
- Team projects (causes environment drift)
- Production projects (not tracked in version control)
- Projects requiring specific plugin versions

### Installation Steps

```bash
# Step 1: Add marketplace globally (one-time)
/plugin marketplace add MadAppGang/magus

# Step 2: Install plugin globally
/plugin install dev@magus

# Step 3: Verify installation
/plugin list
```

### Trade-offs

**Advantages:**
- ✅ Available in all projects immediately
- ✅ No per-project configuration needed
- ✅ Quick to test and experiment

**Disadvantages:**
- ❌ Not tracked in version control
- ❌ Team members must install manually
- ❌ Can cause environment drift across team
- ❌ Harder to manage plugin versions
- ❌ No project-specific plugin selection

### Uninstalling Global Plugins

```bash
# Uninstall a plugin
/plugin uninstall dev@magus

# Verify removal
/plugin list
```

---

## Local Development

### Overview

Test plugins from your local filesystem without publishing to a marketplace.

### Use Cases

- 🔧 Developing new plugins
- 🐛 Debugging plugin issues
- 🧪 Testing plugin changes before committing
- 📦 Contributing to existing plugins

### Setup

#### 1. Add Local Marketplace

Point to your local clone of the repository:

```bash
/plugin marketplace add /Users/you/path/to/claude-code
```

#### 2. Install Plugin from Local Source

```bash
/plugin install dev@magus
```

#### 3. Make Changes to Plugin Files

Edit agents, commands, skills, or configurations in your local directory.

#### 4. Reload Plugin

```bash
/plugin reload dev@magus
```

**Note:** Some changes may require a full Claude Code restart.

### Development Workflow

```bash
# 1. Clone repository
git clone https://github.com/MadAppGang/magus.git
cd claude-code

# 2. Create feature branch
git checkout -b feature/my-new-agent

# 3. Make changes
# Edit plugins/dev/agents/my-new-agent.md

# 4. Add to plugin.json
# Update plugins/dev/plugin.json

# 5. Test locally
/plugin marketplace add /path/to/claude-code
/plugin install dev@magus

# 6. Verify changes work
# Test your new agent

# 7. Reload after changes
/plugin reload dev@magus

# 8. Commit and push
git add .
git commit -m "Add my-new-agent"
git push origin feature/my-new-agent
```

### Debugging Tips

**Plugin not loading:**
```bash
# Check marketplace is added
/plugin marketplace list

# Reinstall plugin
/plugin remove dev@magus
/plugin install dev@magus

# Verify plugin files exist
ls -la /path/to/claude-code/plugins/dev
```

**Changes not appearing:**
```bash
# Reload plugin
/plugin reload dev@magus

# Or restart Claude Code completely
```

**Agent/Command not found:**
```bash
# Verify in plugin.json
cat /path/to/claude-code/plugins/dev/plugin.json

# Check file exists
cat /path/to/claude-code/plugins/dev/agents/your-agent.md
```

---

## Project-Specific Marketplace

### Overview

Include marketplace configuration directly in project settings instead of adding it globally.

### When to Use

- 🔐 Projects with restricted marketplace access
- 🏢 Enterprise environments with custom marketplaces
- 🎯 Projects requiring specific marketplace versions

### Configuration

Add marketplace to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "magus": {
      "source": {
        "source": "github",
        "repo": "MadAppGang/magus"
      }
    }
  },
  "enabledPlugins": {
    "dev@magus": true,
    "code-analysis@magus": true
  }
}
```

### Trust Requirements

**Important:** This approach requires each developer to trust the project folder.

**Why this is not recommended:**
- ❌ Requires manual trust action per developer
- ❌ More complex than global marketplace approach
- ❌ Can cause confusion for team members
- ❌ Trust dialogs can be overlooked

**Recommended approach instead:**
- ✅ Add marketplace globally (one-time per developer)
- ✅ Enable plugins in project settings
- ✅ Simpler, clearer, fewer steps

---

## Version Management

### Specifying Versions in Marketplace

Control plugin versions in `marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "dev",
      "version": "2.3.0",
      "source": "./plugins/dev"
    }
  ]
}
```

### Installing Specific Versions

```bash
# Install latest version
/plugin install dev@magus

# Install specific version
/plugin install dev@magus@2.2.0

# Verify installed version
/plugin list
```

### Version Pinning

**In project settings:**

Currently, Claude Code enables the latest available version from the marketplace. Version pinning in project settings is not yet supported.

**Workaround:**
- Pin versions in `marketplace.json`
- Teams pull the same marketplace version from git

### Checking Versions

```bash
# List installed plugins with versions
/plugin list

# Check marketplace version
cat .claude-plugin/marketplace.json | grep version
```

### Upgrading Versions

```bash
# Update marketplace metadata
/plugin marketplace update magus

# Reinstall plugin to get latest version
/plugin remove dev@magus
/plugin install dev@magus
```

---

## Plugin Updates

### Updating Marketplace

Get the latest marketplace metadata:

```bash
/plugin marketplace update magus
```

This updates:
- ✅ Plugin versions
- ✅ New plugins added to marketplace
- ✅ Plugin descriptions and metadata
- ✅ Marketplace version

**Does not update:**
- ❌ Already installed plugin files (must reinstall)

### Updating Individual Plugins

**Method 1: Marketplace Update**

```bash
# Update marketplace
/plugin marketplace update magus

# Plugins will update automatically on next use
```

**Method 2: Reinstall Plugin**

```bash
# Remove and reinstall
/plugin remove dev@magus
/plugin install dev@magus
```

**Method 3: Reload Plugin**

For local development changes:

```bash
/plugin reload dev@magus
```

### Update Workflow for Teams

**For team projects:**

```bash
# 1. One team member updates marketplace
/plugin marketplace update magus

# 2. Check what changed
/plugin list

# 3. Test updated plugins

# 4. If all good, other team members run:
/plugin marketplace update magus
```

**No action needed by team members if:**
- Plugins are enabled in `.claude/settings.json`
- Marketplace is already added globally
- Updates are compatible

---

## Custom Configuration

### Environment Variables

Plugins may require environment variables. Configure them in your shell profile or `.env` file:

**In ~/.zshrc or ~/.bashrc:**

```bash
# Dev Plugin
export FIGMA_ACCESS_TOKEN="your-token"
export APIDOG_API_TOKEN="your-token"

# Optional
export CHROME_EXECUTABLE_PATH="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
export CODEX_API_KEY="your-key"
```

Leave `CHROME_EXECUTABLE_PATH` unset unless you need a specific browser build: the
`browser-use` plugin otherwise finds the newest Chromium in Playwright's own cache.
When it is set, that exact binary is what launches — so pointing it at
`/Applications/Google Chrome.app` drives your real Chrome, which on macOS takes over
the `com.google.Chrome` single-instance slot and makes your own Chrome icon reopen the
automation window.

**In project .env file:**

```bash
FIGMA_ACCESS_TOKEN=your-token
APIDOG_API_TOKEN=your-token
```

**Check required variables:**
- See plugin's README.md
- See plugin's DEPENDENCIES.md
- Run `/configure-mcp` command (if available)

### MCP Server Configuration

Some plugins include MCP servers that need configuration:

**Auto-configuration (Recommended):**

```bash
/configure-mcp
```

This command (available in dev plugin):
1. Checks existing configuration
2. Asks for missing environment variables
3. Validates credentials
4. Updates MCP server configuration

**Manual configuration:**

Edit Claude Code's MCP configuration:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-figma"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```

### Plugin-Specific Settings

Some plugins support additional configuration in `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "dev@magus": true
  },
  "pluginConfig": {
    "dev": {
      "defaultModel": "sonnet",
      "autoReview": true,
      "testingEnabled": true
    }
  }
}
```

**Note:** Plugin-specific config support varies by plugin. Check plugin documentation.

---

## Best Practices

### For Individual Developers

1. **Add marketplace globally** (one-time setup)
2. **Enable plugins per-project** (in `.claude/settings.json`)
3. **Keep environment variables** in shell profile
4. **Update marketplace regularly** for latest features

### For Teams

1. **Add marketplace globally** (each developer, one-time)
2. **Commit `.claude/settings.json`** (team gets plugins automatically)
3. **Document required env vars** in project README
4. **Use consistent plugin versions** across team

### For Plugin Developers

1. **Test with local marketplace** during development
2. **Use semantic versioning** for releases
3. **Document breaking changes** in CHANGELOG
4. **Test updates** before publishing

---

## Troubleshooting

### Marketplace Issues

**Marketplace not found:**
```bash
# List marketplaces
/plugin marketplace list

# Add marketplace
/plugin marketplace add MadAppGang/magus

# Update marketplace
/plugin marketplace update magus
```

**Cannot access marketplace:**
```bash
# Check internet connection
ping github.com

# Verify marketplace URL
/plugin marketplace list

# Try re-adding
/plugin marketplace remove magus
/plugin marketplace add MadAppGang/magus
```

### Plugin Issues

**Plugin not appearing:**
```bash
# Verify marketplace has plugin
/plugin marketplace list

# Check settings format
cat .claude/settings.json

# Reload Claude Code
# Restart the application
```

**Plugin not working:**
```bash
# Check plugin status
/plugin list

# Verify environment variables
echo $FIGMA_ACCESS_TOKEN

# Check plugin logs
# (if available in plugin documentation)

# Reinstall plugin
/plugin remove dev@magus
/plugin install dev@magus
```

### Version Issues

**Wrong version installed:**
```bash
# Check current version
/plugin list

# Update marketplace
/plugin marketplace update magus

# Reinstall specific version
/plugin remove dev@magus
/plugin install dev@magus@2.3.0
```

---

## Related Documentation

- **[Quick Start](../../README.md#quick-start)** - Basic installation
- **[Plugin catalog](../plugins/index.md)** - What each plugin provides
- **[Troubleshooting](./troubleshooting.md)** - Common issues

---

## Need Help?

- **GitHub Issues**: [Report a problem](https://github.com/MadAppGang/magus/issues)
- **Email**: [i@madappgang.com](mailto:i@madappgang.com)
- **Documentation**: Check plugin-specific README files
