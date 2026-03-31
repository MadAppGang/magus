# Project Context for Claude Code

## CRITICAL RULES

- **NEVER use `pkill` or broad process-killing commands** (like `pkill -f "claudeup"` or `pkill -f "claude"`). This kills all Claude CLI sessions running on the machine. Instead, ask the user to restart applications manually or close specific windows.
- **Do not use hardcoded paths** in code, docs, comments, or any other files.
- **Model Selection — Authoritative Source:** When selecting external AI models (for /team, /delegate, claudish, or any multi-model task), read `shared/model-aliases.json` FIRST. Only use model IDs from `knownModels` or resolved via `shortAliases`. NEVER guess model IDs from training knowledge — your training data has stale model names. If the user says a model name, fuzzy-match against `shortAliases` keys. If no match, list available aliases — don't invent an ID. If `shared/model-aliases.json` doesn't exist, tell user to run `/update-models`. Claudish handles all provider routing — just pass the resolved model ID, never add prefixes.

## Project Overview

**Repository:** Magus
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## Plugins (12 published)

| Plugin | Version | Purpose |
|--------|---------|---------|
| **Code Analysis** | v5.1.0 | Codebase investigation with mnemex MCP, 4 skills |
| **Multimodel** | v3.1.0 | Multi-model collaboration and orchestration |
| **Agent Development** | v1.6.0 | Create Claude Code agents and plugins |
| **SEO** | v1.7.0 | SEO analysis and optimization with AUTO GATEs |
| **Video Editing** | v1.1.1 | FFmpeg, Whisper, Final Cut Pro integration |
| **Nanobanana** | v2.4.0 | AI image generation with Gemini 3 Pro Image |
| **Conductor** | v2.1.1 | Context-Driven Development with TDD and Git Notes |
| **Dev** | v2.7.0 | Universal dev assistant, 12 commands via progressive disclosure, 46 skills |
| **Designer** | v0.3.0 | UI design validation with pixel-diff comparison, 6 skills |
| **Browser Use** | v1.0.0 | Full-platform browser automation, 18 MCP tools, 5 skills |
| **Statusline** | v1.4.1 | Colorful statusline with worktree awareness |
| **Terminal** | v3.0.0 | Intent-level terminal: 5 skills, 9 commands, TDD workflow, dashboard archetypes + ht-mcp/tmux-mcp |
| **GTD** | v1.0.0 | Getting Things Done workflow with real-time task sync via hooks |

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
├── plugins/                   # All plugins (13 published, 3 unlisted)
│   ├── code-analysis/         # v4.0.2 — 13 skills, 1 agent, mnemex MCP
│   ├── multimodel/            # v2.6.2 — 15 skills
│   ├── agentdev/              # v1.5.5 — 5 skills
│   ├── seo/                   # v1.6.5 — 12 skills
│   ├── video-editing/         # v1.1.1 — 3 skills
│   ├── nanobanana/            # v2.3.1 — 2 skills
│   ├── conductor/             # v2.1.1 — 6 skills
│   ├── dev/                   # v1.39.0 — 47 skills, workflow enforcement
│   ├── designer/              # v0.2.0 — 6 skills, pixel-diff design validation
│   ├── browser-use/           # v1.0.0 — 5 skills, 18 MCP tools
│   ├── statusline/            # v1.4.1 — 1 skill
│   ├── terminal/              # v3.0.0 — 5 skills, 9 commands, ht-mcp + tmux-mcp
│   ├── gtd/                   # v1.0.0 — 7 commands, 2 skills, real-time task sync
│   └── (go, instantly, autopilot — unlisted)
├── autotest/                  # E2E test framework
│   ├── framework/             # Shared runner, parsers (Bun/TS)
│   ├── coaching/              # Coaching hook tests
│   ├── designer/              # Designer plugin tests (12 cases)
│   ├── subagents/             # Agent delegation tests
│   ├── team/                  # Multi-model /team tests
│   ├── skills/                # Skill routing tests
│   ├── terminal/              # Terminal plugin tests (24 cases)
│   ├── gtd/                   # GTD plugin tests (12 cases)
│   └── worktree/              # Worktree tests
├── tools/                     # Standalone tools
│   ├── claudeup/              # TUI installer (npm package, v3.5.0)
│   ├── claudeup-core/         # Core library
│   └── claudeup-gui/          # GUI version
├── shared/                    # Shared resources
│   └── model-aliases.json     # Centralized model aliases (synced from Firebase via /update-models)
├── skills/                    # Project-level skills
│   ├── release/SKILL.md
│   └── update-models/SKILL.md # Sync model aliases from curated database
├── ai-docs/                   # Technical documentation
└── docs/                      # User documentation
```

## Important Files

- `.claude-plugin/marketplace.json` — Marketplace listing (**update when releasing!**)
- `plugins/{name}/plugin.json` — Plugin manifest (version, components, MCP servers)
- `plugins/{name}/.mcp.json` — MCP server config (if plugin has MCP servers)
- `shared/model-aliases.json` — Centralized model aliases, roles, teams, knownModels (**synced from Firebase**)
- `RELEASE_PROCESS.md` / `skills/release/SKILL.md` — Release process docs
- `autotest/framework/runner-base.sh` — E2E test runner entry point

## E2E Testing

```bash
# Run a test suite (all use autotest/framework/ shared runner)
./autotest/terminal/run.sh --model claude-sonnet-4-6 --parallel 3
./autotest/coaching/run.sh --model claude-sonnet-4-6
./autotest/designer/run.sh --model claude-sonnet-4-6
./autotest/subagents/run.sh --model grok
./autotest/model-aliases/run.sh --model internal  # Model alias resolution tests
./autotest/gtd/run.sh --model internal  # GTD tests require internal model for hooks

# Run specific test cases
./autotest/terminal/run.sh --model claude-sonnet-4-6 --cases environment-inspection-08
./autotest/gtd/run.sh --model internal --cases gtd-capture-01

# Analyze existing results
bun autotest/terminal/analyze-results.ts autotest/terminal/results/<run-dir>
bun autotest/gtd/analyze-results.ts autotest/gtd/results/<run-dir>
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
| Semantic code search, mnemex CLI usage, AST analysis | `code-analysis:mnemex-search` | Before using `mnemex` commands |
| Multi-agent mnemex orchestration | `code-analysis:mnemex-orchestration` | Parallel mnemex across agents |
| Code investigation — architecture, implementation, tests, bugs | `code-analysis:investigate` | Mode-based routing (architecture/implementation/testing/debugging) |
| Deep multi-perspective comprehensive analysis | `code-analysis:deep-analysis` | Comprehensive codebase audit, all dimensions |
| Database branching with git worktrees (Neon, Turso, Supabase) | `dev:db-branching` | Worktree creation with schema changes needing DB isolation |
| Interactive terminal: run commands, dev servers, test watchers, REPLs | `terminal:terminal-interaction` | Task needs TTY, interactive output, long-running process, or database shell |
| TUI navigation: vim, nano, htop, lazygit, k9s, less | `terminal:tui-navigation-patterns` | Navigating TUI apps, sending key sequences, reading screen state |
| Poll terminal for test/build/deploy completion signals | `terminal:framework-signals` | Waiting for CI, test runners, or build tools to report pass/fail |
| TDD red-green-refactor loop with test watchers | `terminal:tdd-workflow` | Running TDD cycles with continuous test feedback |
| Create tmux workspaces, dashboards, or ambient monitors | `terminal:workspace-setup` | Setting up multi-pane layouts, dashboard archetypes, or background monitors |
| Claudish CLI usage, model routing, provider backends | `multimodel:claudish-usage` | Before ANY `claudish` command — bare model names, no prefixes |

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

## Learned Preferences

### Model Selection & Routing
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- Model routing/resolution is claudish's responsibility. Magus only does alias lookup (ALIAS_TABLE[name] → full ID). Never implement provider detection, API key checking, or fallback chains in plugin code.
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- Model selection is a 3-step chain: (1) Claude Code interprets user intent to an alias key, (2) Magus looks up ALIAS_TABLE[key] for the full model ID, (3) claudish routes the ID to the correct provider. Never skip steps or merge responsibilities.
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- User customAliases (from .claude/multimodel-team.json) override global shortAliases (from shared/model-aliases.json) on key conflict. Always merge both when building ALIAS_TABLE.

### Tools & Commands
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- In agent/command workflows, use claudish MCP tools (team, create_session, run_prompt) — never Bash+claudish CLI. CLI references are only acceptable in claudish-usage skill documentation.

### Conventions
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- Shared procedures (like alias resolution) belong in ONE skill file referenced by all commands — not duplicated inline. Currently: `multimodel:claudish-usage` → "Model Alias Resolution" section.
<!-- learned: 2026-03-31 session: model-sel source: explicit_rule -->
- ai-docs/ files are consumed by agents as context. Delete completed design docs once the feature ships — stale model IDs, old architecture patterns, and outdated recommendations will actively mislead agents.

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** March 31, 2026
