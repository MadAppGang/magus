# Project Context for Claude Code

## CRITICAL RULES

**NEVER use `pkill` or broad process-killing commands** (like `pkill -f "claudeup"` or `pkill -f "claude"`). This kills all Claude CLI sessions running on the machine. Instead, ask the user to restart applications manually or close specific windows.

## Project Overview

**Repository:** Magus
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## Plugins

| Plugin | Version | Purpose |
|--------|---------|---------|
| **Frontend** | v3.15.2 | React/TypeScript dev with 11 agents, multi-model review |
| **Code Analysis** | v3.2.3 | Codebase investigation with claudemem, enrichment mode (non-blocking) |
| **Bun Backend** | v1.6.2 | TypeScript backend with Bun, Apidog integration |
| **Multimodel** | v2.4.2 | Multi-model collaboration and orchestration |
| **Agent Development** | v1.5.3 | Create Claude Code agents and plugins |
| **SEO** | v1.6.3 | SEO analysis and optimization with AUTO GATEs |
| **Video Editing** | v1.1.1 | FFmpeg, Whisper, Final Cut Pro integration |
| **Nanobanana** | v2.3.1 | AI image generation with Gemini 3 Pro Image |
| **Conductor** | v2.1.1 | Context-Driven Development with TDD and Git Notes |
| **Terminal** | v1.0.0 | Interactive terminal via ht-mcp + tmux-mcp |
| **Statusline** | v1.4.1 | Colorful statusline with worktree awareness |
| **Autopilot** | v0.2.1 | Autonomous task execution with Linear integration |
| **Instantly** | v1.0.3 | Cold email outreach with Instantly.ai MCP |
| **Dev** | v1.33.0 | Universal dev assistant with coaching system, 47 skills |

**Claudish CLI**: `npm install -g claudish` - Run Claude with OpenRouter models (separate repo)

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
├── RELEASE_PROCESS.md        # Plugin release process guide
├── docs/                    # User documentation
│   ├── frontend-development.md
│   └── local-development.md
├── ai-docs/                 # Technical documentation
│   ├── TEAM_CONFIG_ARCHITECTURE.md
│   ├── DYNAMIC_MCP_GUIDE.md
│   ├── IMPROVEMENTS_SUMMARY.md
│   ├── COMPLETE_PLUGIN_SUMMARY.md
│   └── FINAL_SUMMARY.md
├── skills/                  # Project-level skills
│   └── release/             # Plugin release process skill
│       └── SKILL.md
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    ├── multimodel/                   # Multi-model collaboration and orchestration
    │   ├── plugin.json
    │   ├── commands/                (team command)
    │   └── skills/                  (14 skills)
    ├── frontend/                     # Full-featured frontend plugin
    │   ├── plugin.json
    │   ├── DEPENDENCIES.md
    │   ├── README.md
    │   ├── agents/                   (11 agents)
    │   ├── commands/                 (7 commands)
    │   ├── skills/                   (11 skills)
    │   └── mcp-servers/
    ├── code-analysis/                # Code analysis plugin
    │   ├── plugin.json
    │   ├── agents/                   (1 agent)
    │   ├── commands/                 (1 command)
    │   └── skills/                   (2 skills)
    └── bun/                          # Backend plugin
        ├── plugin.json
        ├── README.md
        ├── agents/                   (3 agents)
        ├── commands/                 (3 commands)
        ├── skills/                   (1 skill)
        └── mcp-servers/
```

## Important Files

### For Users
- `README.md` - Start here for installation and usage
- `.env.example` - Template for required environment variables
- `ai-docs/TEAM_CONFIG_ARCHITECTURE.md` - Setup guide
- `skills/release/SKILL.md` - Plugin release process (for maintainers)

### For Maintainers
- `.claude-plugin/marketplace.json` - Marketplace configuration ⚠️ **Update when releasing!**
- `plugins/frontend/plugin.json` - Plugin manifest
- `RELEASE_PROCESS.md` - Complete release process documentation
- `skills/release/SKILL.md` - Quick reference release skill
- `ai-docs/DYNAMIC_MCP_GUIDE.md` - MCP configuration patterns

### For Contributors
- `ai-docs/COMPLETE_PLUGIN_SUMMARY.md` - Complete reference
- `plugins/frontend/DEPENDENCIES.md` - Dependencies

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

---

## Quick Reference

**Setup:** `/plugin marketplace add MadAppGang/magus`

**Enable in `.claude/settings.json`:**
```json
{
  "enabledPlugins": {
    "frontend@magus": true,
    "code-analysis@magus": true
  }
}
```

**Local dev:** `/plugin marketplace add /path/to/claude-code`

## Task Routing - Agent Delegation

IMPORTANT: For complex tasks, prefer delegating to specialized agents via the Task tool rather than handling inline. Delegated agents run in dedicated context windows with sustained focus, producing higher quality results.

| Task Pattern | Delegate To | Trigger |
|---|---|---|
| Research: web search, tech comparison, multi-source reports | `dev:researcher` | 3+ sources or comparison needed |
| Implementation: creating code, new modules, features, building with tests | `dev:developer` | Writing new code, adding features, creating modules - even if they relate to existing codebase |
| Investigation: READ-ONLY codebase analysis, tracing, understanding | `code-analysis:detective` | Only when task is to UNDERSTAND code, not to WRITE new code |
| Debugging: error analysis, root cause investigation | `dev:debugger` | Non-obvious bugs or multi-file root cause |
| Architecture: system design, trade-off analysis | `dev:architect` | New systems or major refactors |
| Agent/plugin quality review | `agentdev:reviewer` | Agent description or plugin assessment |

Key distinction: If the task asks to IMPLEMENT/CREATE/BUILD → `dev:developer`. If the task asks to UNDERSTAND/ANALYZE/TRACE → `code-analysis:detective`.

### Skill Routing (Skill tool, NOT Task tool)

NOTE: Skills use the `Skill` tool, NOT the `Task` tool. The `namespace:name` format is shared by both agents and skills — check which tool to use before invoking.

| Need | Invoke Skill | When |
|---|---|---|
| Semantic code search, claudemem CLI usage, AST analysis | `code-analysis:claudemem-search` | Before using `claudemem` commands |
| Multi-agent claudemem orchestration | `code-analysis:claudemem-orchestration` | Parallel claudemem across agents |
| Architecture investigation with PageRank | `code-analysis:architect-detective` | Architecture-focused claudemem usage |
| Deep multi-perspective analysis | `code-analysis:deep-analysis` | Comprehensive codebase investigation |
| Database branching with git worktrees (Neon, Turso, Supabase) | `dev:db-branching` | Worktree creation with schema changes needing DB isolation |

## Design Principles

1. **Shareable Config, Private Secrets** - Configuration in git, credentials in environment
2. **Validation First** - Check before ask, validate before save
3. **Team Ready** - Auto-install, consistent setup, no drift
4. **Security First** - No secrets in git, personal tokens, clear docs
5. **Developer Experience** - Smart defaults, clear errors, fast for returning users

## Release Documentation

**Version History:** See [CHANGELOG.md](./CHANGELOG.md) for all versions

**Detailed Release Notes:** See [RELEASES.md](./RELEASES.md) for comprehensive release documentation

**Current Versions:**
- Multimodel Plugin: **v2.4.2** (2026-02-27)
- Frontend Plugin: **v3.15.2** (2026-02-27)
- Code Analysis Plugin: **v3.2.3** (2026-02-27)
- Bun Backend Plugin: **v1.6.2** (2026-02-27)
- Agent Development Plugin: **v1.5.3** (2026-02-27)
- SEO Plugin: **v1.6.3** (2026-02-27)
- Video Editing Plugin: **v1.1.1** (2026-02-27)
- Nanobanana Plugin: **v2.3.1** (2026-02-27)
- Conductor Plugin: **v2.1.1** (2026-02-27)
- Terminal Plugin: **v1.0.0** (2026-02-27)
- Statusline Plugin: **v1.4.1** (2026-02-27)
- Autopilot Plugin: **v0.2.1** (2026-02-27)
- Instantly Plugin: **v1.0.3** (2026-02-27)
- Dev Plugin: **v1.33.0** (2026-02-27)
- Claudish CLI: See https://github.com/MadAppGang/claudish (separate repository)

**Latest Changes (Marketplace v7.0.0 — 2026-02-27):**
- ✅ **Marketplace Rename**: mag-claude-plugins → magus across all 15 plugins
- ✅ **Workflow Coaching** (Dev v1.33.0): Stop/SessionStart hooks, 8 rule-based detections, cross-session persistence
- ✅ **Terminal Plugin** (v1.0.0): ht-mcp + tmux-mcp integration, 9 E2E tests, 100% pass across 3 models
- ✅ **Statusline Fix** (v1.4.1): UTC timezone for countdown, days/hours duration formatting
- ✅ **Landing Page**: React + Vite + Tailwind marketplace landing page

**Git Tags:**
- Multimodel: `plugins/multimodel/v2.4.2`
- Frontend: `plugins/frontend/v3.15.2`
- Bun: `plugins/bun/v1.6.2`
- Code Analysis: `plugins/code-analysis/v3.2.3`
- Agent Development: `plugins/agentdev/v1.5.3`
- SEO: `plugins/seo/v1.6.3`
- Video Editing: `plugins/video-editing/v1.1.1`
- Nanobanana: `plugins/nanobanana/v2.3.1`
- Conductor: `plugins/conductor/v2.1.1`
- Terminal: `plugins/terminal/v1.0.0`
- Statusline: `plugins/statusline/v1.4.1`
- Autopilot: `plugins/autopilot/v0.2.1`
- Instantly: `plugins/instantly/v1.0.3`
- Dev: `plugins/dev/v1.33.0`
- Use correct tag format when releasing: `plugins/{plugin-name}/vX.Y.Z`

**⚠️ RELEASE CHECKLIST (ALL 3 REQUIRED):**
When releasing a plugin, you MUST update ALL THREE of these:
1. **Plugin version** - `plugins/{name}/plugin.json` → `"version": "X.Y.Z"`
2. **Marketplace version** - `.claude-plugin/marketplace.json` → plugin entry `"version": "X.Y.Z"`
3. **Git tag** - `git tag -a plugins/{name}/vX.Y.Z -m "Release message"` → push with `--tags`

Missing any of these will cause claudeup to not see the update!

**⚠️ CLAUDEUP RELEASE PROCESS:**
Claudeup (the TUI tool) has its own release process:
1. **Update version** - `tools/claudeup/package.json` → `"version": "X.Y.Z"`
2. **Commit changes** - `git commit -m "feat(claudeup): vX.Y.Z - Description"`
3. **Create tag** - `git tag -a tools/claudeup/vX.Y.Z -m "Release message"`
4. **Push** - `git push origin main --tags`

The workflow `.github/workflows/claudeup-release.yml` triggers on `tools/claudeup/v*` tags and:
- Builds with pnpm
- Publishes to npm via OIDC (no tokens needed - Trusted Publisher configured)
- Creates GitHub release

**Current claudeup version:** v1.3.0
**Install:** `bun install -g claudeup@latest`

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** February 27, 2026
**Version:** 15 plugins (Multimodel v2.4.2, Frontend v3.15.2, Code Analysis v3.2.3, Bun v1.6.2, Agent Dev v1.5.3, SEO v1.6.3, Video Editing v1.1.1, Nanobanana v2.3.1, Conductor v2.1.1, Terminal v1.0.0, Statusline v1.4.1, Autopilot v0.2.1, Instantly v1.0.3, Dev v1.33.0)
- do not use hardcoded path in code, docs, comments or any other files