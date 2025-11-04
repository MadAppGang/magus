# Project Context for Claude Code

## Project Overview

**Repository:** MAG Claude Plugins
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## What This Repository Contains

A complete Claude Code plugin marketplace with enterprise-level architecture:

- **Plugin Marketplace** (`mag-claude-plugins`)
- **Frontend Development Plugin** (v2.0.1)
  - 8 Specialized Agents
  - 5 Slash Commands
  - 2 Skills
  - 4 MCP Server Configurations

## Key Architecture Decisions

### 1. Team-First Configuration

**Shareable** (committed to git):
- Project IDs, URLs, configuration
- `.claude/settings.json` with project config
- No secrets

**Private** (environment variables):
- API tokens, credentials
- Each developer's `.env` file
- Never committed

### 2. Smart Validation

Configuration commands check existing setup before asking questions, validate credentials before saving.

### 3. Project-Specific Installation

Plugins can be installed:
- Globally (all projects)
- Per-project (`.claude/settings.json`)
- Teams use project-specific for consistency

## Directory Structure

```
claude-code/
├── README.md                  # Main documentation
├── CLAUDE.md                  # This file
├── .env.example              # Environment template
├── LICENSE                   # MIT
├── .gitignore               # Excludes secrets
├── docs/                    # User documentation
│   ├── frontend-development.md
│   └── local-development.md
├── ai-docs/                 # Technical documentation
│   ├── TEAM_CONFIG_ARCHITECTURE.md
│   ├── DYNAMIC_MCP_GUIDE.md
│   ├── IMPROVEMENTS_SUMMARY.md
│   ├── COMPLETE_PLUGIN_SUMMARY.md
│   └── FINAL_SUMMARY.md
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── frontend-development/
        ├── plugin.json
        ├── DEPENDENCIES.md
        ├── README.md
        ├── agents/          (8 agents)
        ├── commands/        (5 commands)
        ├── skills/          (2 skills)
        └── mcp-servers/
```

## Important Files

### For Users
- `README.md` - Start here for installation and usage
- `.env.example` - Template for required environment variables
- `ai-docs/TEAM_CONFIG_ARCHITECTURE.md` - Setup guide

### For Maintainers
- `.claude-plugin/marketplace.json` - Marketplace configuration
- `plugins/frontend/plugin.json` - Plugin manifest
- `ai-docs/DYNAMIC_MCP_GUIDE.md` - MCP configuration patterns

### For Contributors
- `ai-docs/COMPLETE_PLUGIN_SUMMARY.md` - Complete reference
- `plugins/frontend/DEPENDENCIES.md` - Dependencies

## Commands Available

### From Frontend Plugin

**Agents:**
- `developer` - TypeScript/React implementation
- `architect` - Architecture planning
- `tester` - Browser UI testing
- `test-architect` - Testing strategy
- `api-analyst` - API docs analysis
- `cleaner` - Cleanup utilities
- `reviewer` - Code review
- `codex-reviewer` - AI code review

**Commands:**
- `/implement` - Full-cycle implementation
- `/import-figma` - Import Figma components
- `/configure-mcp` - Configure MCP servers
- `/api-docs` - API documentation workflows
- `/cleanup-artifacts` - Clean temporary files

**Skills:**
- `browser-debugger` - UI testing & debugging
- `api-spec-analyzer` - OpenAPI/Swagger analysis

## Environment Variables

### Required (Per Developer)
```bash
APIDOG_API_TOKEN=your-personal-token
FIGMA_ACCESS_TOKEN=your-personal-token
```

### Optional
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=your-token
CHROME_EXECUTABLE_PATH=/path/to/chrome
CODEX_API_KEY=your-codex-key
```

## Claude Code Plugin Requirements

**Plugin System Format:**
- Plugin manifest: `.claude-plugin/plugin.json` (must be in this location)
- Settings format: `enabledPlugins` must be object with boolean values
- Component directories: `agents/`, `commands/`, `skills/`, `mcp-servers/` at plugin root
- Environment variables: Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths

**Example Settings:**
```json
{
  "enabledPlugins": {
    "plugin-name@marketplace-name": true
  }
}
```

## Dependencies

**System:**
- Node.js v18+ (with npm/npx)
- Chrome browser
- Git

**Optional:**
- Codex CLI (for codex-powered code review)

## Quick Reference

### Recommended Setup (Global Marketplace + Per-Project Plugins)

**Step 1: Add marketplace globally (one-time):**
```bash
/plugin marketplace add MadAppGang/claude-code
```

**Step 2: Enable plugins in project settings:**

Add to `.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "frontend@mag-claude-plugins": true
  }
}
```

Commit this file and team members get automatic setup!

### Alternative: Global Plugin Installation

Install plugin globally (not recommended for teams):
```bash
/plugin marketplace add MadAppGang/claude-code
/plugin install frontend@mag-claude-plugins
```

### Local Development

Test local changes:
```bash
/plugin marketplace add /Users/jack/mag/claude-code
/plugin install frontend@mag-claude-plugins
```

### Advanced: Project-Specific Marketplace

Include marketplace in project settings (requires folder trust):
```json
{
  "extraKnownMarketplaces": {
    "mag-claude-plugins": {
      "source": {"source": "github", "repo": "MadAppGang/claude-code"}
    }
  },
  "enabledPlugins": {
    "frontend@mag-claude-plugins": true
  }
}
```

## Design Principles

1. **Shareable Config, Private Secrets** - Configuration in git, credentials in environment
2. **Validation First** - Check before ask, validate before save
3. **Team Ready** - Auto-install, consistent setup, no drift
4. **Security First** - No secrets in git, personal tokens, clear docs
5. **Developer Experience** - Smart defaults, clear errors, fast for returning users

## Status

✅ **Production Ready**
- Complete plugin (8 agents, 5 commands, 2 skills)
- 3000+ lines of documentation
- Team architecture implemented
- Smart validation system
- Security best practices
- Ready for distribution

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** November 4, 2024
**Version:** 2.0.1
