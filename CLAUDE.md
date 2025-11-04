# Project Context for Claude Code

## Project Overview

**Repository:** MAG Claude Plugins
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## What This Repository Contains

A complete Claude Code plugin marketplace with enterprise-level architecture:

- **Plugin Marketplace** (`mag-claude-plugins`)
- **Frontend Development Plugin** (v1.0.0)
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
├── ai-docs/                 # Detailed documentation
│   ├── TEAM_CONFIG_ARCHITECTURE.md
│   ├── DYNAMIC_MCP_GUIDE.md
│   ├── IMPROVEMENTS_SUMMARY.md
│   ├── COMPLETE_PLUGIN_SUMMARY.md
│   └── FINAL_SUMMARY.md
└── .claude-plugin/
    ├── marketplace.json
    └── plugins/
        └── frontend-development/
            ├── plugin.json
            ├── DEPENDENCIES.md
            ├── agents/      (8 agents)
            ├── commands/    (5 commands)
            ├── skills/      (2 skills)
            └── mcp-servers/
```

## Important Files

### For Users
- `README.md` - Start here for installation and usage
- `.env.example` - Template for required environment variables
- `ai-docs/TEAM_CONFIG_ARCHITECTURE.md` - Setup guide

### For Maintainers
- `.claude-plugin/marketplace.json` - Marketplace configuration
- `.claude-plugin/plugins/frontend-development/plugin.json` - Plugin manifest
- `ai-docs/DYNAMIC_MCP_GUIDE.md` - MCP configuration patterns

### For Contributors
- `ai-docs/COMPLETE_PLUGIN_SUMMARY.md` - Complete reference
- `.claude-plugin/plugins/frontend-development/DEPENDENCIES.md` - Dependencies

## Commands Available

### From Frontend Development Plugin

**Agents:**
- `typescript-frontend-dev` - TypeScript/React implementation
- `frontend-architect-planner` - Architecture planning
- `ui-manual-tester` - Browser UI testing
- `vitest-test-architect` - Testing strategy
- `api-documentation-analyzer` - API docs analysis
- `project-cleaner` - Cleanup utilities
- `senior-code-reviewer` - Code review
- `senior-code-reviewer-codex` - AI code review

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
POSTGRES_CONNECTION_STRING=postgresql://localhost/db
CHROME_EXECUTABLE_PATH=/path/to/chrome
CODEX_API_KEY=your-codex-key
```

## Dependencies

**System:**
- Node.js v18+ (with npm/npx)
- Chrome browser
- Git

**Optional:**
- Codex CLI (for codex-powered code review)

## Quick Reference

### Test Locally
```bash
/plugin marketplace add /Users/jack/mag/claude-code
/plugin install frontend-development@mag-claude-plugins
```

### Publish to GitHub
```bash
git remote add origin https://github.com/MadAppGang/claude-code.git
git push -u origin main
```

### Team Installation
```bash
/plugin marketplace add MadAppGang/claude-code
/plugin install frontend-development@mag-claude-plugins
```

### Project-Specific Installation
Add to project's `.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": {
    "mag-claude-plugins": {
      "source": {"source": "github", "repo": "MadAppGang/claude-code"}
    }
  },
  "enabledPlugins": {
    "frontend-development@mag-claude-plugins": true
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
