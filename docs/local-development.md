# Local Development Guide

> **Testing and debugging Magus plugins locally**

This guide covers how to develop, test, and debug plugins locally before publishing to GitHub.

---

## When to Use Local Development

**Use local development when:**
- Creating new plugins
- Modifying existing plugins
- Testing changes before publishing
- Debugging plugin issues
- Contributing to the repository

**Use GitHub installation when:**
- Using plugins in production
- Installing on team projects
- Setting up plugins for the first time

---

## Prerequisites

- Claude Code installed and configured
- Git installed
- Node.js v18+ (for testing MCP servers)
- Text editor or IDE

---

## Setup for Local Development

### 1. Clone the Repository

```bash
# Clone from GitHub
git clone https://github.com/MadAppGang/magus.git

# Navigate to the directory
cd claude-code
```

### 2. Understand the Directory Structure

```
claude-code/
├── .claude-plugin/
│   ├── marketplace.json          # Marketplace configuration
│   └── plugins/
│       └── frontend/  # Plugin directory
│           ├── plugin.json       # Plugin manifest
│           ├── agents/           # Agent markdown files
│           ├── commands/         # Command markdown files
│           ├── skills/           # Skill directories
│           └── mcp-servers/      # MCP configurations
├── docs/                         # User documentation
├── ai-docs/                      # Technical documentation
└── README.md                     # Main documentation
```

---

## Adding Local Marketplace to Claude Code

### Option A: Global Local Installation

Add the local marketplace globally to test across all projects:

```bash
# Add local marketplace (use absolute path to your local clone)
/plugin marketplace add /path/to/claude-code

# Install plugin from local marketplace
/plugin install frontend@magus
```

**Result:** Plugin available in all Claude Code projects from your local copy.

**Use when:**
- Testing plugin changes across multiple projects
- Developing new features
- Quick iteration cycles

---

### Option B: Project-Specific Local Installation

Add local marketplace to a specific test project:

**Step 1: Create test project `.claude/settings.json`**

```json
{
  "extraKnownMarketplaces": {
    "magus": {
      "source": {
        "source": "local",
        "path": "/path/to/claude-code"
      }
    }
  },
  "enabledPlugins": {
    "frontend@magus": true
  }
}
```

**Step 2: Trust the folder**

When Claude Code prompts to trust the folder, accept.

**Result:** Plugin only available in this test project.

**Use when:**
- Testing plugin in isolated environment
- Comparing local changes to published version
- Preventing accidental use of development version

---

## Development Workflow

### 1. Make Changes to Plugin

Edit any plugin files:

```bash
# Example: Edit an agent
vim plugins/frontend/agents/typescript-frontend-dev.md

# Example: Edit a command
vim plugins/frontend/commands/implement.md

# Example: Update plugin manifest
vim plugins/frontend/plugin.json
```

### 2. Reload Plugin in Claude Code

After making changes, reload the plugin:

**Method 1: Reinstall plugin**
```bash
/plugin remove frontend@magus
/plugin install frontend@magus
```

**Method 2: Restart Claude Code session**
- Exit and restart Claude Code CLI
- Changes will be picked up automatically

### 3. Test Changes

Test your changes in a real project:

```bash
# Test a command
/implement Create a test component

# Test an agent directly
# Ask Claude to invoke the agent
"Use the typescript-frontend-dev agent to create a button component"

# Test a skill
# Skills are invoked automatically when relevant
```

### 4. Verify Configuration

Check that plugin is loaded correctly:

```bash
# List installed plugins
/plugin list

# Should show:
# frontend@magus (global) - from /path/to/claude-code
```

---

## Testing Specific Components

### Testing Agents

**1. Create a test agent:**

```bash
# Create new agent file
touch plugins/frontend/agents/test-agent.md
```

**2. Add agent frontmatter:**

```markdown
---
description: Test agent for debugging purposes
tools:
  - Read
  - Write
  - Bash
model: haiku
---

# Test Agent

This agent is for testing purposes only.

## Task

When invoked, this agent should:
1. Read the current directory
2. List files
3. Report back to the user

## Output Format

Provide a concise summary of findings.
```

**3. Register agent in plugin.json:**

```json
{
  "agents": [
    "./agents/test-agent.md",
    "./agents/typescript-frontend-dev.md"
    // ... other agents
  ]
}
```

**4. Reload and test:**

```bash
/plugin remove frontend@magus
/plugin install frontend@magus

# Ask Claude to invoke test-agent
```

---

### Testing Commands

**1. Create a test command:**

```bash
touch plugins/frontend/commands/test-command.md
```

**2. Add command content:**

```markdown
---
description: Test command for debugging
allowedTools:
  - Read
  - Bash
---

# Test Command

This command is for testing command execution.

## Task

Execute the following steps:

1. List files in current directory using Bash
2. Read package.json if it exists
3. Report findings to user

## Output

Provide a summary of the current project structure.
```

**3. Register command in plugin.json:**

```json
{
  "commands": [
    "./commands/test-command.md",
    "./commands/implement.md"
    // ... other commands
  ]
}
```

**4. Reload and test:**

```bash
/plugin remove frontend@magus
/plugin install frontend@magus

# Test the command
/test-command
```

---

### Testing MCP Servers

**1. Configure test MCP server:**

```json
{
  "test-server": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/test/mock-mcp-server.js"],
    "env": {
      "TEST_VAR": "test-value"
    }
  }
}
```

**2. Create mock server (optional):**

```bash
mkdir -p plugins/frontend/test
```

```javascript
// test/mock-mcp-server.js
console.log('Mock MCP Server started');
console.log('TEST_VAR:', process.env.TEST_VAR);
console.log('CLAUDE_PLUGIN_ROOT:', process.env.CLAUDE_PLUGIN_ROOT);
```

**3. Register in plugin.json:**

```json
{
  "mcpServers": {
    "test-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/test/mock-mcp-server.js"]
    }
  }
}
```

**4. Test MCP server:**

```bash
# Reload plugin
/plugin remove frontend@magus
/plugin install frontend@magus

# Check if MCP server is loaded
# Claude will have access to test-server tools
```

---

## Debugging Tips

### Check Plugin Loading

```bash
# Verify plugin is installed
/plugin list

# Should show local path:
# frontend@magus (global)
#   from /path/to/claude-code
```

### Validate JSON Files

```bash
# Validate marketplace.json
cat .claude-plugin/marketplace.json | python -m json.tool

# Validate plugin.json
cat plugins/frontend/plugin.json | python -m json.tool
```

### Check File Paths

Ensure all paths in `plugin.json` are relative and correct:

```json
{
  "agents": [
    "./agents/agent-name.md"     // ✅ Correct (relative path)
  ],
  "commands": [
    "./commands/command-name.md" // ✅ Correct (relative path)
  ],
  "skills": [
    "./skills/skill-name"        // ✅ Correct (relative path, directory)
  ]
}
```

**Common mistakes:**
```json
{
  "agents": [
    "agents/agent-name.md",                                    // ❌ Missing ./
    "/full/path/agents/agent-name.md",                        // ❌ Absolute path
    "../plugins/frontend/agents/agent-name.md"    // ❌ Parent relative
  ]
}
```

### Test Agent Invocation

```bash
# Check if agents are available
# Ask Claude: "What agents are available from the frontend plugin?"

# Test agent invocation
# Ask Claude: "Use the typescript-frontend-dev agent to create a test file"
```

### Check MCP Server Environment Variables

```bash
# Verify CLAUDE_PLUGIN_ROOT expansion
# In your MCP server code, log the variable:
console.log('CLAUDE_PLUGIN_ROOT:', process.env.CLAUDE_PLUGIN_ROOT);

# Should output: /path/to/claude-code/plugins/frontend
```

---

## Testing Changes Before Publishing

### 1. Test in Real Project

Create a test project and use your local plugin:

```bash
# Create test project
mkdir -p ~/test-claude-plugin
cd ~/test-claude-plugin
npm init -y

# Create .claude/settings.json pointing to local marketplace
mkdir -p .claude
cat > .claude/settings.json << 'EOF'
{
  "extraKnownMarketplaces": {
    "magus": {
      "source": {
        "source": "local",
        "path": "/path/to/claude-code"
      }
    }
  },
  "enabledPlugins": {
    "frontend@magus": true
  }
}
EOF

# Start Claude Code and test
claude
```

### 2. Test All Features

Create a testing checklist:

- [ ] All agents invoke correctly
- [ ] All commands execute without errors
- [ ] Skills trigger when appropriate
- [ ] MCP servers connect successfully
- [ ] Environment variables expand correctly
- [ ] File paths resolve correctly
- [ ] Documentation is accurate

### 3. Compare with Production

Keep two terminals open:

**Terminal 1: Test project with local plugin**
```bash
cd ~/test-claude-plugin
claude
```

**Terminal 2: Test project with GitHub plugin**
```bash
cd ~/test-claude-plugin-prod
claude
```

Compare behavior to ensure changes work as expected.

---

## Common Development Issues

### Issue: Plugin Not Loading

**Symptoms:**
- Plugin doesn't appear in `/plugin list`
- Commands not available
- Agents not invoking

**Solutions:**

1. **Check marketplace path:**
   ```bash
   # Ensure absolute path is correct
   /plugin marketplace list
   ```

2. **Validate JSON syntax:**
   ```bash
   cat .claude-plugin/marketplace.json | python -m json.tool
   cat plugins/frontend/plugin.json | python -m json.tool
   ```

3. **Check file permissions:**
   ```bash
   ls -la .claude-plugin/marketplace.json
   ls -la plugins/frontend/plugin.json
   ```

4. **Reinstall plugin:**
   ```bash
   /plugin remove frontend@magus
   /plugin marketplace remove magus
   /plugin marketplace add /path/to/claude-code
   /plugin install frontend@magus
   ```

---

### Issue: Changes Not Reflected

**Symptoms:**
- Made changes to agent/command but behavior unchanged
- Old version still running

**Solutions:**

1. **Reinstall plugin:**
   ```bash
   /plugin remove frontend@magus
   /plugin install frontend@magus
   ```

2. **Restart Claude Code:**
   - Exit Claude Code completely
   - Restart CLI
   - Check plugin version

3. **Clear Claude cache (if available):**
   ```bash
   # Check Claude Code docs for cache clearing command
   ```

---

### Issue: MCP Server Not Starting

**Symptoms:**
- MCP tools not available
- Connection errors

**Solutions:**

1. **Check MCP configuration:**
   ```bash
   cat plugins/frontend/plugin.json | grep -A 10 "mcpServers"
   ```

2. **Verify command exists:**
   ```bash
   # If using npx
   which npx

   # If using custom command
   ls -la ${CLAUDE_PLUGIN_ROOT}/bin/custom-mcp
   ```

3. **Test command manually:**
   ```bash
   # Navigate to plugin directory
   cd plugins/frontend

   # Test command
   npx -y @modelcontextprotocol/server-postgres
   ```

4. **Check environment variables:**
   ```bash
   # Ensure required env vars are set
   echo $APIDOG_API_TOKEN
   echo $FIGMA_ACCESS_TOKEN
   ```

---

## Publishing Changes

Once you've tested changes locally, publish to GitHub:

### 1. Commit Changes

```bash
cd /path/to/claude-code

# Stage changes
git add .

# Commit with descriptive message
git commit -m "Add new feature to typescript-frontend-dev agent"
```

### 2. Push to GitHub

```bash
# Push to main branch
git push origin main

# Or push to feature branch
git checkout -b feature/new-feature
git push origin feature/new-feature
```

### 3. Test from GitHub

After pushing, test the GitHub version:

```bash
# Remove local version
/plugin remove frontend@magus
/plugin marketplace remove magus

# Add GitHub version
/plugin marketplace add MadAppGang/magus

# Install from GitHub
/plugin install frontend@magus

# Test to ensure changes work
```

### 4. Update Version (if needed)

If making significant changes, update version numbers:

**In `.claude-plugin/marketplace.json`:**
```json
{
  "plugins": [
    {
      "name": "frontend",
      "version": "1.1.0",  // ← Update version
      "source": "./plugins/frontend"
    }
  ]
}
```

**In `plugins/frontend/plugin.json`:**
```json
{
  "name": "frontend",
  "version": "1.1.0",  // ← Update version
  "description": "..."
}
```

---

## Development Best Practices

### 1. Use Feature Branches

```bash
# Create feature branch
git checkout -b feature/new-agent

# Make changes
# Test thoroughly

# Push feature branch
git push origin feature/new-agent

# Create PR on GitHub
```

### 2. Test in Isolation

Always test new features in isolated test projects before using in production projects.

### 3. Document Changes

Update relevant documentation:
- `README.md` - If adding new features
- `docs/frontend.md` - If changing workflows
- `DEPENDENCIES.md` - If adding new dependencies
- `ai-docs/` - If changing architecture

### 4. Validate Before Publishing

Pre-publish checklist:
- [ ] All JSON files valid
- [ ] File paths correct (relative, not absolute)
- [ ] Environment variables documented
- [ ] README updated
- [ ] Version numbers updated
- [ ] Tested in fresh project
- [ ] No secrets in git

### 5. Keep Local and GitHub in Sync

```bash
# Regularly pull latest changes
git pull origin main

# Push your changes
git push origin main

# Update version after publishing
git tag v1.1.0
git push --tags
```

---

## Quick Reference

### Useful Commands

```bash
# Marketplace management
/plugin marketplace add /path/to/claude-code
/plugin marketplace remove magus
/plugin marketplace list

# Plugin management
/plugin install frontend@magus
/plugin remove frontend@magus
/plugin list

# Validation
cat .claude-plugin/marketplace.json | python -m json.tool
cat plugins/frontend/plugin.json | python -m json.tool

# Git
git status
git add .
git commit -m "message"
git push origin main
```

### Important Paths

```bash
# Marketplace root (replace with your local path)
/path/to/claude-code

# Marketplace config
/path/to/claude-code/.claude-plugin/marketplace.json

# Plugin root
/path/to/claude-code/plugins/frontend

# Plugin manifest
/path/to/claude-code/plugins/frontend/plugin.json
```

---

## Getting Help

**Issues with local development:**
1. Check this guide first
2. Verify JSON syntax
3. Check file permissions
4. Review Claude Code docs: https://docs.claude.com/en/docs/claude-code/plugins
5. Open issue: https://github.com/MadAppGang/magus/issues

**Contact:**
- Email: i@madappgang.com
- GitHub: https://github.com/MadAppGang/magus

---

**Last Updated:** November 2024
**Maintained by:** Jack Rudenko @ MadAppGang
