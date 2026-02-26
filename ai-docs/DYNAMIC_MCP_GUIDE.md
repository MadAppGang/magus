# Dynamic MCP Server Configuration Guide

This guide explains how to pass dynamic, project-specific values (like project IDs) to MCP servers in Claude Code plugins.

## The Challenge

You want to create a plugin with MCP servers (like Apidog) that need project-specific configuration, but:
- Plugin is distributed to multiple users/projects
- Each project has different IDs, tokens, etc.
- Configuration must be dynamic per-project

## Solution: Environment Variables + Setup Command

### Architecture

```
Plugin (Distributed)
├── MCP Config Template (uses ${ENV_VARS})
└── Setup Command (helps users configure)

User's Project (Specific)
└── .claude/settings.json (contains actual values)
```

### How It Works

**1. Plugin provides MCP config template with placeholders:**

```json
// .claude-plugin/plugins/your-plugin/mcp-servers/mcp-config.json
{
  "apidog": {
    "command": "npx",
    "args": [
      "-y",
      "@apidog/mcp-server",
      "--project-id",
      "${APIDOG_PROJECT_ID}",    // ← Placeholder
      "--token",
      "${APIDOG_API_TOKEN}"       // ← Placeholder
    ]
  }
}
```

**2. User runs setup command in their project:**

```bash
/setup-apidog
```

**3. Setup command writes to project's `.claude/settings.json`:**

```json
{
  "env": {
    "APIDOG_PROJECT_ID": "abc123",        // ← Actual value
    "APIDOG_API_TOKEN": "secret-token"    // ← Actual value
  }
}
```

**4. Claude Code resolves environment variables at runtime:**

```
${APIDOG_PROJECT_ID}  →  abc123
${APIDOG_API_TOKEN}   →  secret-token
```

**5. MCP server starts with correct project-specific values!**

## Implementation Patterns

### Pattern 1: Simple Environment Variables (Recommended)

**Use when:** Simple config with 1-3 values

**Plugin's mcp-config.json:**
```json
{
  "apidog": {
    "command": "npx",
    "args": ["-y", "@apidog/mcp-server"],
    "env": {
      "APIDOG_PROJECT_ID": "${APIDOG_PROJECT_ID}",
      "APIDOG_API_TOKEN": "${APIDOG_API_TOKEN}"
    }
  }
}
```

**User's .claude/settings.json:**
```json
{
  "env": {
    "APIDOG_PROJECT_ID": "my-project-123",
    "APIDOG_API_TOKEN": "my-secret-token"
  }
}
```

### Pattern 2: Config File Reference

**Use when:** Complex config with many values

**Plugin's mcp-config.json:**
```json
{
  "apidog": {
    "command": "npx",
    "args": [
      "-y",
      "@apidog/mcp-server",
      "--config",
      "${PROJECT_ROOT}/.apidog/config.json"
    ]
  }
}
```

**User creates .apidog/config.json in their project:**
```json
{
  "projectId": "abc123",
  "apiToken": "secret",
  "teamId": "team-456",
  "endpoints": ["api1", "api2"]
}
```

### Pattern 3: Default Values with Fallback

**Use when:** Want to provide sensible defaults

```json
{
  "apidog": {
    "command": "npx",
    "args": ["-y", "@apidog/mcp-server"],
    "env": {
      "APIDOG_BASE_URL": "${APIDOG_BASE_URL:-https://api.apidog.com}",
      "APIDOG_TIMEOUT": "${APIDOG_TIMEOUT:-30000}"
    }
  }
}
```

**Syntax:** `${VAR:-default_value}`
- If `VAR` is set, use its value
- If `VAR` is not set, use `default_value`

### Pattern 4: Interactive Setup Command

**Use when:** Want great UX for non-technical users

Create `/setup-apidog` command that:
1. Asks user for credentials (using `AskUserQuestion`)
2. Validates the credentials
3. Writes to `.claude/settings.json`
4. Tests MCP server connection
5. Provides usage instructions

**See:** `commands/setup-apidog.md` for full implementation

## Available Environment Variables

### Claude Code Built-in Variables

```bash
${CLAUDE_PLUGIN_ROOT}        # Path to plugin installation directory
${PROJECT_ROOT}              # Path to current project root
${HOME}                      # User's home directory
${USER}                      # Current username
```

### Custom Variables (Set by User)

```json
{
  "env": {
    "APIDOG_PROJECT_ID": "your-value",
    "CUSTOM_VAR": "any-value",
    "API_KEY": "secret-key"
  }
}
```

## Best Practices

### ✅ DO

1. **Use environment variables for secrets**
   ```json
   "env": {
     "API_TOKEN": "${API_TOKEN}"
   }
   ```

2. **Provide setup commands**
   ```bash
   /setup-apidog  # Guides user through setup
   ```

3. **Document required variables**
   ```markdown
   ## Required Environment Variables
   - `APIDOG_PROJECT_ID`: Your project ID from Apidog
   - `APIDOG_API_TOKEN`: API token from Apidog settings
   ```

4. **Validate before saving**
   ```bash
   # Test connection before writing config
   npx @apidog/mcp-server --project-id ${ID} --token ${TOKEN} --test
   ```

5. **Mask sensitive data in output**
   ```
   ✅ Configured!
   Project ID: abc***123
   Token: sec*******ken
   ```

### ❌ DON'T

1. **Hard-code secrets in plugin**
   ```json
   // ❌ BAD
   {
     "apidog": {
       "env": {
         "APIDOG_PROJECT_ID": "hardcoded-id"  // Don't do this!
       }
     }
   }
   ```

2. **Commit secrets to git**
   ```bash
   # Add to .gitignore
   .claude/settings.local.json
   .apidog/config.json
   ```

3. **Use global settings for project-specific config**
   ```bash
   # ❌ BAD: Global config affects all projects
   ~/.config/claude/settings.json

   # ✅ GOOD: Project-specific config
   /my-project/.claude/settings.json
   ```

4. **Skip validation**
   ```bash
   # Always validate credentials before saving
   ```

## Real-World Example: Apidog MCP

### Plugin Structure

```
frontend/
├── mcp-servers/
│   ├── mcp-config.example.json        # Template with ${VARS}
│   └── README.md                      # Setup instructions
├── commands/
│   └── setup-apidog.md                # Interactive setup
└── plugin.json
```

### User Workflow

**Step 1: Install plugin**
```bash
/plugin install frontend@magus
```

**Step 2: Run setup**
```bash
/setup-apidog
```

Claude prompts:
```
🔧 Apidog Setup

Enter your Apidog Project ID:
(Found in your project URL: app.apidog.com/project/{ID})
> abc123

Enter your API Token:
(Generate at: Apidog Settings → API Tokens)
> secret-token-here

✅ Testing connection...
✅ Connection successful!
✅ Configuration saved to .claude/settings.json

Available tools:
- apidog_get_project
- apidog_list_apis
- apidog_import_endpoint

Try: "Fetch API documentation from Apidog for the User API"
```

**Step 3: Use MCP tools**
```
User: "Get all endpoints from my Apidog project"
Claude: [Uses apidog_list_apis with correct project ID]
```

## Multi-Project Support

### Approach 1: Per-Project Settings

Each project has its own `.claude/settings.json`:

```
project-a/
└── .claude/settings.json  (APIDOG_PROJECT_ID=project-a-id)

project-b/
└── .claude/settings.json  (APIDOG_PROJECT_ID=project-b-id)
```

### Approach 2: Shell Environment Override

```bash
# Terminal 1: Project A
cd project-a
export APIDOG_PROJECT_ID="project-a-id"
claude-code

# Terminal 2: Project B
cd project-b
export APIDOG_PROJECT_ID="project-b-id"
claude-code
```

### Approach 3: Interactive Project Selector

Enhance setup command to:
1. Fetch list of user's Apidog projects (using API token)
2. Present selection UI
3. Save selected project ID

```bash
/setup-apidog

🔍 Fetching your Apidog projects...

Select a project:
1. Project Alpha (ID: abc123)
2. Project Beta (ID: def456)
3. Project Gamma (ID: ghi789)

Which project? [1-3]: 2

✅ Configured for: Project Beta
```

## Security Considerations

### Storing Secrets

**Recommended hierarchy:**

1. **Project-specific (most secure):**
   ```
   /my-project/.claude/settings.json
   + Add to .gitignore
   + Never commit
   ```

2. **User global (for personal projects):**
   ```
   ~/.config/claude/settings.json
   ```

3. **Environment variables (for CI/CD):**
   ```bash
   export APIDOG_PROJECT_ID="..."
   export APIDOG_API_TOKEN="..."
   ```

### Protecting Tokens

```json
// .gitignore
.claude/settings.local.json
.claude/settings.json
.apidog/
*.env
```

```bash
# Check before committing
git status
git diff .claude/
```

## Troubleshooting

### Issue: Variables not resolving

**Check 1:** Variable is set in `.claude/settings.json`
```bash
cat .claude/settings.json | grep APIDOG_PROJECT_ID
```

**Check 2:** Syntax is correct
```json
{
  "env": {
    "VAR": "${VAR}"  // ✅ Correct
    "VAR": "$VAR"    // ❌ Wrong
  }
}
```

### Issue: MCP server not starting

**Check 1:** Run MCP command directly
```bash
npx -y @apidog/mcp-server --project-id abc123 --token secret
```

**Check 2:** Check Claude Code logs
```bash
# Look for MCP server errors
```

### Issue: Wrong project selected

**Solution:** Reconfigure
```bash
/setup-apidog  # Run setup again
```

## Additional Resources

- [Plugin Example: frontend-development](./plugins/frontend)
- [Setup Command Example](./commands/setup-apidog.md)
- [MCP Config Examples](./mcp-servers/mcp-config.example.json)
- [Claude Code Docs](https://docs.claude.com/en/docs/claude-code/plugins)
- [MCP Protocol](https://modelcontextprotocol.io)

---

**Author:** Jack Rudenko (i@madappgang.com)
**Company:** MadAppGang
**Plugin:** magus
