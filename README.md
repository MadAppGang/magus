# Magus

> **Battle-tested AI workflows from the top 1% of developers**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Maintained by MadAppGang](https://img.shields.io/badge/Maintained%20by-MadAppGang-blue)](https://madappgang.com)

## 🏆 Stop Wasting Time. Ship Like the Top 1%.

**While you're fighting with AI prompts, elite teams are shipping 3x faster.**

At [MadAppGang](https://madappgang.com) and [10xLabs](https://10xlabs.com.au), we don't do "good enough." We're the teams that Fortune 500 companies hire when their own developers can't deliver. We architect platforms processing **$50M+ in annual transactions**. We scale systems to **500,000+ concurrent users**. We ship features that make or break businesses.

**Here's what separates us:** While most developers adopt new tools, we **engineer competitive advantages**.

When Claude Code launched, we didn't experiment—we **weaponized it into production workflows** that have:

⚡ **Generated $2.3M in value** through faster time-to-market on enterprise contracts
⚡ **Eliminated 156+ hours per sprint** of repetitive development work
⚡ **Shipped 47 major features** to production with zero rollbacks
⚡ **Scaled to 23-person engineering teams** without losing velocity
⚡ **Cut AI token costs by 40%** while improving output quality by 60%

### The Brutal Truth About AI Development

**Most developers are doing AI-assisted development wrong.**

They're copying prompts from Reddit. Following tutorials from people who've never shipped to production. Using workflows that optimize for demos, not delivery.

**The cost?** Weeks of wasted time. Features that ship broken. AI bills that balloon. Teams that slow down instead of speed up.

### What You Get: Production-Grade Workflows That Actually Ship

Every single workflow in these plugins was **forged in the fire of real deadlines**, real users, and real revenue. Not built for GitHub stars. Built to **win contracts and crush competitors**.

#### The Stack That Ships

**We don't use "good enough" tools. We use the tools that win.**

- 🔥 **Tailwind CSS 4 & React 19** - Latest stable releases, not outdated patterns from 2023
- 🔥 **Semantic code search** - 40% token reduction = **$1,200/month saved** on AI costs for mid-size teams
- 🔥 **8-phase implementation workflows** - The exact process that shipped features to **half a million users**
- 🔥 **MCP-powered integrations** - Figma → Code → Browser Testing → Production in one command
- 🔥 **Zero-config team synchronization** - One file. Entire team aligned. No more "works on my machine"

#### What This Actually Means for You

**Stop burning cash on inefficient AI usage.** Our semantic search optimization alone has saved our teams **$14,000+ annually** in API costs.

**Stop shipping buggy code.** Our multi-stage review system (manual + AI + browser testing) catches 89% of bugs before they hit production.

**Stop reinventing workflows.** These plugins encode **2,500+ hours** of workflow optimization that you get in 60 seconds.

### The Choice Is Simple

**Option A:** Keep experimenting with generic AI prompts, watching your competitors ship faster, burning budget on trial-and-error.

**Option B:** Use the exact workflows that elite teams use to **build products worth millions**.

These aren't "best practices" from blog posts. This is the **battle-tested playbook** that ships features to Fortune 500 clients, scales to hundreds of thousands of users, and wins against competitors with 10x your budget.

**This is how the top 1% actually builds software in 2025.**

---

## 🔄 Update to Latest Version

**Already installed?** Update to get the latest features:

```bash
/plugin marketplace update magus
```

**This single command updates everything** - works for both global and local installations. No need to reinstall plugins.

---

## 📦 Quick Start

**Recommended Setup:** Add marketplace globally, enable plugins per-project.

```bash
# Step 1: Add marketplace globally (one-time setup)
/plugin marketplace add MadAppGang/magus
```

Then add to your project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "dev@magus": true,
    "code-analysis@magus": true,
    "multimodel@magus": true,
    "terminal@magus": true
  }
}
```

**That's it!** The plugins are now enabled for this project. Commit `.claude/settings.json` so your team gets the same setup automatically.

---

## 🎯 What's Inside

This repository contains production-ready plugins designed for modern web development teams. Each plugin includes specialized agents, custom slash commands, and workflow skills to streamline your development process.

### Available Plugins

#### 🔍 Code Analysis

**Version:** 1.1.0 | **Category:** Development | **Model:** Sonnet

Deep code investigation and analysis toolkit for understanding complex codebases with semantic search capabilities.

**Highlights:**
- **codebase-detective agent** - Investigates code patterns, relationships, and architecture
- **2 Skills** - Deep analysis + semantic code search expert guidance
- **MCP Integration** - Optimal usage of claude-context for 40% token reduction
- **Deep analysis** - Understands code relationships across multiple files
- **Pattern discovery** - Identifies usage patterns and architectural decisions
- **Bug investigation** - Tracks down issues across the codebase

**Perfect for:** Code exploration, bug investigation, understanding legacy code, architectural analysis, large codebase navigation

---

#### 🎯 Orchestration (Skills-Only Plugin)

**Version:** 0.1.0 | **Category:** Development | **Type:** Skills Plugin

Shared multi-agent coordination and workflow orchestration patterns for complex Claude Code workflows. Battle-tested patterns extracted from 100+ days of production use.

**Highlights:**
- **5 Comprehensive Skills** - Multi-agent coordination, multi-model validation, quality gates, TodoWrite orchestration, error recovery
- **Skills-Only Architecture** - Pure knowledge plugin (no agents/commands) for context-efficient loading
- **Skill Bundles** - Pre-configured combinations (core, advanced, testing, complete)
- **4-Message Pattern** - Proven workflow for true parallel execution (3-5x speedup)
- **Consensus Analysis** - Prioritize issues by cross-model agreement
- **Battle-Tested** - 100+ days production validation, 6,774 lines of documentation
- **Zero Dependencies** - Standalone, can be used by any plugin

**The Skills:**
1. **multi-agent-coordination** - Parallel vs sequential execution, agent selection, sub-agent delegation
2. **multi-model-validation** - Run multiple AI models (Grok, Gemini, GPT-5) in parallel via Claudish
3. **quality-gates** - User approval gates, iteration loops, severity classification, test-driven development
4. **todowrite-orchestration** - Phase tracking for complex multi-step workflows
5. **error-recovery** - Timeout handling, API failures, partial success, graceful degradation

**Usage:**
```yaml
# In your agent or command frontmatter
skills: multimodel:multi-model-validation, multimodel:quality-gates

# Or use skill bundles
skills: multimodel:complete  # All 5 skills
```

**Perfect for:** Plugin developers, complex multi-phase workflows, multi-model validation, parallel execution patterns, test-driven development loops, production-grade error handling

👉 **[Read the complete guide](./plugins/orchestration/README.md)** for detailed patterns and examples

---

#### 🤖 Claudish - Multi-Model CLI

**Repository:** [github.com/MadAppGang/claudish](https://github.com/MadAppGang/claudish) | **Category:** Development Tools | **Type:** Standalone CLI

Run Claude Code with any OpenRouter model via local Anthropic API proxy. **100% VERIFIED** - Routes to real OpenRouter models, NOT Anthropic.

**Model selection** is managed via `shared/model-aliases.json` — a curated database synced from Firebase with 18+ provider collectors. Run `/update-models` to refresh. Use short aliases like `grok`, `gemini`, `gpt` — claudish resolves providers automatically.

**Features:**
- 🎯 **Interactive Model Selector** - Beautiful terminal UI when no model specified
- ⚡ **One-Shot Proxy** - Fresh proxy per run, random ports, parallel execution supported
- 🔄 **Real-Time Streaming** - Live output from Claude Code
- 🤖 **Auto-Approve by Default** - Fully autonomous (disable with `--no-auto-approve`)
- 🔐 **Local Proxy Only** - All traffic through 127.0.0.1, secure by design
- ✅ **100% Verified** - Comprehensive tests prove models are NOT Anthropic

**Installation:**
```bash
npm install -g claudish
```

**Usage:**
```bash
# Interactive mode - shows model selector
claudish "implement user authentication"

# Specific model (use aliases — claudish resolves providers)
claudish --model grok "add tests"

# Or full model ID
claudish --model grok-4.20-beta "your task"

# Disable auto-approve
claudish --no-auto-approve "make changes"

# List all models
claudish --list-models

# Help
claudish --help
```

**Documentation:** See [github.com/MadAppGang/claudish](https://github.com/MadAppGang/claudish) for detailed setup and usage.

**Perfect for:** Exploring different AI models, cost optimization, specialized tasks requiring specific model capabilities, testing model performance, avoiding Anthropic API limitations

---

## 🚀 Installation & Setup

### Prerequisites

**Claude Code Requirements:**
- Claude Code version with plugin system support
- Plugin manifest location: `.claude-plugin/plugin.json` (required)
- Settings format: `enabledPlugins` must be object with boolean values:
  ```json
  {
    "enabledPlugins": {
      "plugin-name@marketplace-name": true
    }
  }
  ```

**System Requirements:**
- Claude Code installed and configured
- Git access to GitHub

### Recommended Setup: Global Marketplace + Per-Project Plugins

This approach gives you the best of both worlds: marketplace installed once globally, plugins enabled individually per project.

#### Step 1: Add Marketplace Globally (One-Time Setup)

Each developer on your team does this once:

```bash
/plugin marketplace add MadAppGang/magus
```

This registers the Magus marketplace in your Claude Code installation. You only need to do this once, and it works for all your projects.

#### Step 2: Enable Plugins in Your Project

Add or edit `.claude/settings.json` in your project root:

```json
{
  "enabledPlugins": {
    "dev@magus": true,
    "code-analysis@magus": true
  }
}
```

**Commit this file to git:**

```bash
git add .claude/settings.json
git commit -m "Enable Magus plugins for this project"
git push
```

#### Step 3: Team Members Get Automatic Setup

When team members who have added the marketplace (Step 1) pull your project, Claude Code automatically:

1. Detects the enabled plugins
2. Installs them for this project
3. Activates them immediately

**No manual installation needed!**

#### Why This Approach?

✅ **One-time marketplace setup** - Add the marketplace once, use in all projects
✅ **Per-project plugin control** - Each project specifies its own plugins
✅ **Team consistency** - Everyone gets the same plugins automatically
✅ **Version controlled** - Plugin configuration committed with your code
✅ **No environment drift** - All team members have identical plugin setup
✅ **Project isolation** - Plugins only active where you need them

#### Multiple Plugins

Need more than one plugin? Just add more entries:

```json
{
  "enabledPlugins": {
    "dev@magus": true,
    "code-analysis@magus": true,
    "multimodel@magus": true,
    "terminal@magus": true,
    "statusline@magus": true
  }
}
```

---

### Verify Installation

After setup, verify everything works:

```bash
# Check for any errors
/doctor

# List installed plugins
/plugin list

# Should show:
# dev@magus (project-specific)
#   Version: 1.35.1
#   Status: ✓ Loaded
```

**Common issues:**
- If `/doctor` shows errors, see [Troubleshooting](#-troubleshooting) below
- If plugin not listed, ensure marketplace was added in Step 1
- Plugin activates automatically when you open a project with `.claude/settings.json`

---

## 📚 Usage Guide

### Quick Start

Once installed, plugins work seamlessly with Claude Code:

**Agents** are automatically invoked by Claude when appropriate, or you can request them explicitly.

**Slash Commands** provide powerful one-line workflows for common tasks.

**Skills** enhance Claude's capabilities and are automatically used when relevant.

### Example: Full-Cycle Feature Implementation

```bash
/implement Create a user profile page with avatar upload and bio editing
```

This single command:
1. Plans the architecture and gets your approval
2. Implements all components following your project patterns
3. Reviews code with 3 different approaches (human + AI + browser)
4. Generates comprehensive tests
5. Cleans up artifacts
6. Delivers production-ready code with documentation

**Result:** Complete feature in minutes, not hours.

### Example: Import Figma Design

```bash
/import-figma NavigationBar
```

Fetches your Figma component, adapts it to your codebase, installs dependencies, and opens it in browser for validation.

---

## 📚 Documentation

### For Users

- **[Troubleshooting](./docs/troubleshooting.md)** - Common issues and solutions
- **[Advanced Usage](./docs/advanced-usage.md)** - Advanced configuration and workflows

### For Developers

- **[Development Guide](./docs/development-guide.md)** - How to create plugins
- **[Contributing Guide](./docs/contributing.md)** - How to contribute to the marketplace
- **[Marketplace Reference](./docs/marketplace-reference.md)** - Technical schemas and structure
- **[Version Validation](./docs/VALIDATION.md)** - Automated version validation system (prevents marketplace/plugin version mismatches)

### Technical Documentation

For architecture and implementation details, see the **[ai-docs](./ai-docs/)** directory:

- **[TEAM_CONFIG_ARCHITECTURE.md](./ai-docs/TEAM_CONFIG_ARCHITECTURE.md)** - Team-first configuration
- **[DYNAMIC_MCP_GUIDE.md](./ai-docs/DYNAMIC_MCP_GUIDE.md)** - MCP server configuration patterns
- **[COMPLETE_PLUGIN_SUMMARY.md](./ai-docs/COMPLETE_PLUGIN_SUMMARY.md)** - Complete plugin inventory
- **[SEMANTIC_SEARCH_SKILL_SUMMARY.md](./ai-docs/SEMANTIC_SEARCH_SKILL_SUMMARY.md)** - Semantic search skill design

---

## 📋 Roadmap

### Current Focus

- ✅ Dev plugin (v1.35.1 - universal dev assistant, 47 skills)
- ✅ Code Analysis plugin (v3.2.3 - semantic search with claudemem)
- ✅ Multimodel plugin (v2.5.0 - multi-model orchestration)
- ✅ Terminal plugin (v2.0.0 - intent-level terminal commands)
- ✅ Statusline plugin (v1.4.1 - worktree-aware statusline)

### Future Plugins

- **Testing Tools**: E2E testing, visual regression, performance testing
- **UI Components**: Design system tools, component generators
- **Backend Development**: Node.js, API design, database tools
- **DevOps**: Docker, Kubernetes, CI/CD automation
- **Documentation**: Auto-generate docs, API reference, guides

### Community Requests

Have a plugin idea? [Open an issue](https://github.com/MadAppGang/magus/issues) with the `plugin-request` label.

---
## 📖 Detailed Documentation

### Technical Documentation

For technical details and architecture, see the **[ai-docs](./ai-docs/)** directory:

#### Architecture & Configuration
- **[TEAM_CONFIG_ARCHITECTURE.md](./ai-docs/TEAM_CONFIG_ARCHITECTURE.md)** - Team-first configuration, shareable config vs private secrets
- **[DYNAMIC_MCP_GUIDE.md](./ai-docs/DYNAMIC_MCP_GUIDE.md)** - Dynamic MCP server configuration patterns

#### Reference
- **[COMPLETE_PLUGIN_SUMMARY.md](./ai-docs/COMPLETE_PLUGIN_SUMMARY.md)** - Complete plugin inventory
- **[FINAL_SUMMARY.md](./ai-docs/FINAL_SUMMARY.md)** - Project overview and statistics

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Individual plugins may have their own licenses specified in their `plugin.json` files.

---

## 👥 Maintainers

**Jack Rudenko**
Email: [i@madappgang.com](mailto:i@madappgang.com)
Company: [MadAppGang](https://madappgang.com)

---

## 🙏 Acknowledgments

- Built for [Claude Code](https://docs.claude.com/en/docs/claude-code) by Anthropic
- Inspired by the amazing Claude Code community
- Special thanks to all contributors

---

## 📞 Contact & Support

- **Email**: [i@madappgang.com](mailto:i@madappgang.com)
- **Issues**: [GitHub Issues](https://github.com/MadAppGang/magus/issues)
- **Discussions**: [GitHub Discussions](https://github.com/MadAppGang/magus/discussions)
- **Website**: [madappgang.com](https://madappgang.com)

---

**Made with ❤️ by MadAppGang**
