# Project Context for Claude Code

## CRITICAL RULES

- **NEVER use `pkill` or broad process-killing commands** (like `pkill -f "claudeup"` or `pkill -f "claude"`). This kills all Claude CLI sessions running on the machine. Instead, ask the user to restart applications manually or close specific windows.
- **Do not use hardcoded paths** in code, docs, comments, or any other files.

## Project Overview

**Repository:** Magus
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## Plugins (10 published)

| Plugin | Version | Purpose |
|--------|---------|---------|
| **Code Analysis** | v3.2.3 | Codebase investigation with claudemem, enrichment mode (non-blocking) |
| **Multimodel** | v2.4.5 | Multi-model collaboration and orchestration |
| **Agent Development** | v1.5.3 | Create Claude Code agents and plugins |
| **SEO** | v1.6.3 | SEO analysis and optimization with AUTO GATEs |
| **Video Editing** | v1.1.1 | FFmpeg, Whisper, Final Cut Pro integration |
| **Nanobanana** | v2.3.1 | AI image generation with Gemini 3 Pro Image |
| **Conductor** | v2.1.1 | Context-Driven Development with TDD and Git Notes |
| **Dev** | v1.35.0 | Universal dev assistant with workflow enforcement, 47 skills |
| **Statusline** | v1.4.1 | Colorful statusline with worktree awareness |
| **Terminal** | v2.0.0 | Intent-level terminal: run, watch, observe, repl, tui + ht-mcp/tmux-mcp |

**Claudish CLI**: `npm install -g claudish` - Run Claude with OpenRouter models ([separate repo](https://github.com/MadAppGang/claudish))

## Directory Structure

```
claude-code/
├── CLAUDE.md                  # This file
├── README.md                  # Main documentation
├── RELEASE_PROCESS.md         # Plugin release process guide
├── .env.example               # Environment template
├── .claude-plugin/
│   └── marketplace.json       # Marketplace plugin listing
├── plugins/                   # All plugins (10 published, 5 unlisted)
│   ├── code-analysis/         # v3.2.3 — 13 skills, 1 agent
│   ├── multimodel/            # v2.4.5 — 15 skills
│   ├── agentdev/              # v1.5.3 — 5 skills
│   ├── seo/                   # v1.6.3 — 12 skills
│   ├── video-editing/         # v1.1.1 — 3 skills
│   ├── nanobanana/            # v2.3.1 — 2 skills
│   ├── conductor/             # v2.1.1 — 6 skills
│   ├── dev/                   # v1.35.0 — 47 skills, workflow enforcement
│   ├── statusline/            # v1.4.1 — 1 skill
│   ├── terminal/              # v1.0.0 — 2 skills, ht-mcp + tmux-mcp
│   └── (bun, frontend, go, instantly, autopilot — unlisted)
├── autotest/                  # E2E test framework
│   ├── framework/             # Shared runner, parsers (Bun/TS)
│   ├── coaching/              # Coaching hook tests
│   ├── subagents/             # Agent delegation tests
│   ├── team/                  # Multi-model /team tests
│   ├── skills/                # Skill routing tests
│   ├── terminal/              # Terminal plugin tests (9 cases)
│   └── worktree/              # Worktree tests
├── tools/                     # Standalone tools
│   ├── claudeup/              # TUI installer (npm package, v3.5.0)
│   ├── claudeup-core/         # Core library
│   └── claudeup-gui/          # GUI version
├── skills/                    # Project-level skills
│   └── release/SKILL.md
├── ai-docs/                   # Technical documentation
└── docs/                      # User documentation
```

## Important Files

- `.claude-plugin/marketplace.json` — Marketplace listing (**update when releasing!**)
- `plugins/{name}/plugin.json` — Plugin manifest (version, components, MCP servers)
- `plugins/{name}/.mcp.json` — MCP server config (if plugin has MCP servers)
- `RELEASE_PROCESS.md` / `skills/release/SKILL.md` — Release process docs
- `autotest/framework/runner-base.sh` — E2E test runner entry point

## E2E Testing

```bash
# Run a test suite (all use autotest/framework/ shared runner)
./autotest/terminal/run.sh --model claude-sonnet-4-6 --parallel 3
./autotest/coaching/run.sh --model claude-sonnet-4-6
./autotest/subagents/run.sh --model or@x-ai/grok-code-fast-1

# Run specific test cases
./autotest/terminal/run.sh --model claude-sonnet-4-6 --cases environment-inspection-08

# Analyze existing results
bun autotest/terminal/analyze-results.ts autotest/terminal/results/<run-dir>
```

## Environment Variables

**Required:**
```bash
APIDOG_API_TOKEN=your-personal-token
FIGMA_ACCESS_TOKEN=your-personal-token
```

**Optional:**
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=your-token
CHROME_EXECUTABLE_PATH=/path/to/chrome
CODEX_API_KEY=your-codex-key
```

## Claude Code Plugin Requirements

**Plugin System Format:**
- Plugin manifest: `.claude-plugin/plugin.json` (must be in this location)
- Settings format: `enabledPlugins` must be object with boolean values
- Component directories: `agents/`, `commands/`, `skills/` at plugin root
- MCP servers: `.mcp.json` at plugin root (referenced as `"mcpServers": "./.mcp.json"` in plugin.json)
- Environment variables: Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths

**Quick Reference:**
```bash
# Install marketplace
/plugin marketplace add MadAppGang/magus

# Local development
/plugin marketplace add /path/to/claude-code
```

**Enable in `.claude/settings.json`:**
```json
{
  "enabledPlugins": {
    "code-analysis@magus": true,
    "dev@magus": true,
    "terminal@magus": true
  }
}
```

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

Key distinction: If the task asks to IMPLEMENT/CREATE/BUILD -> `dev:developer`. If the task asks to UNDERSTAND/ANALYZE/TRACE -> `code-analysis:detective`.

### Skill Routing (Skill tool, NOT Task tool)

NOTE: Skills use the `Skill` tool, NOT the `Task` tool. The `namespace:name` format is shared by both agents and skills -- check which tool to use before invoking.

| Need | Invoke Skill | When |
|---|---|---|
| Semantic code search, claudemem CLI usage, AST analysis | `code-analysis:claudemem-search` | Before using `claudemem` commands |
| Multi-agent claudemem orchestration | `code-analysis:claudemem-orchestration` | Parallel claudemem across agents |
| Architecture investigation with PageRank | `code-analysis:architect-detective` | Architecture-focused claudemem usage |
| Deep multi-perspective analysis | `code-analysis:deep-analysis` | Comprehensive codebase investigation |
| Database branching with git worktrees (Neon, Turso, Supabase) | `dev:db-branching` | Worktree creation with schema changes needing DB isolation |
| Interactive terminal: run commands, dev servers, test watchers, REPLs | `terminal:terminal-interaction` | Task needs TTY, interactive output, long-running process, or database shell |
| TUI navigation: vim, nano, htop, lazygit, k9s, less | `terminal:tui-navigation-patterns` | Navigating TUI apps, sending key sequences, reading screen state |

## Release Process

**Version History:** See [CHANGELOG.md](./CHANGELOG.md) | **Detailed Notes:** See [RELEASES.md](./RELEASES.md)

**Git tag format:** `plugins/{plugin-name}/vX.Y.Z`

**Plugin Release Checklist (ALL 3 REQUIRED):**
1. **Plugin version** - `plugins/{name}/plugin.json` -> `"version": "X.Y.Z"`
2. **Marketplace version** - `.claude-plugin/marketplace.json` -> plugin entry `"version": "X.Y.Z"`
3. **Git tag** - `git tag -a plugins/{name}/vX.Y.Z -m "Release message"` -> push with `--tags`

Missing any of these will cause claudeup to not see the update!

**Claudeup Release Process:**
1. Update `tools/claudeup/package.json` -> `"version": "X.Y.Z"`
2. Commit: `git commit -m "feat(claudeup): vX.Y.Z - Description"`
3. Tag: `git tag -a tools/claudeup/vX.Y.Z -m "Release message"`
4. Push: `git push origin main --tags`

The workflow `.github/workflows/claudeup-release.yml` triggers on `tools/claudeup/v*` tags (builds with pnpm, publishes to npm via OIDC).

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** February 28, 2026
