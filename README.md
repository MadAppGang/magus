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

# Optional: marketing & content plugins (SEO, image generation, video, cold email)
/plugin marketplace add MadAppGang/magus-marketing
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

**Version:** 5.3.0 | **Category:** Development | **Marketplace:** `magus`

Read-only code investigation for understanding complex codebases, behind one stable tool
surface that does not change when the search engine does.

**Highlights:**
- **`code-analysis:detective` agent** - Investigates code patterns, relationships, and architecture
- **3 Skills** - `code-search`, `investigate`, `deep-analysis`
- **MCP Integration** - `code_search` is always present; call-graph and blast-radius tools
  appear only when the configured search engine genuinely supports them
- **Swappable engine** - named in project settings, one at a time
- **Pattern discovery** - Identifies usage patterns and architectural decisions
- **Bug investigation** - Tracks down issues across the codebase

**Perfect for:** Code exploration, bug investigation, understanding legacy code, architectural analysis, large codebase navigation

---

#### 🎯 Multimodel - Orchestration & Multi-Model Voting

**Version:** 3.2.0 | **Category:** Development | **Marketplace:** `magus`

Multi-agent coordination and multi-model orchestration. Run the same task across several AI
models in parallel, collect independent verdicts, and route work by complexity. Requires the
`claudish` runtime plugin (declared as a dependency).

**Commands:**
- `/multimodel:team` - Blind voting across models in parallel; aggregates APPROVE/REJECT verdicts
- `/multimodel:delegate` - Hand a task to one external model running a full Claude Code session

**Key skills** (16 total under `plugins/multimodel/skills/`):
- **multi-agent-coordination** - Parallel vs sequential execution, agent selection, delegation
- **multi-model-validation** - Run multiple models in parallel and compare findings
- **task-complexity-router** - Match task complexity to the right model tier
- **task-orchestration** - Phase tracking for complex multi-step workflows
- **quality-gates** - Approval gates, iteration loops, severity classification
- **error-recovery** - Timeouts, API failures, partial success, graceful degradation

Model routing and provider backends are covered by `claudish:claudish-usage`, which ships
with the `claudish` runtime plugin. Read it before ANY `claudish` command.

**Usage:**
```yaml
# In your agent or command frontmatter
skills: multimodel:multi-model-validation, multimodel:quality-gates
```

**Perfect for:** complex multi-phase workflows, multi-model validation, parallel execution
patterns, production-grade error handling

> Model IDs come from claudish's live catalog (`list_models` / `search_models`) — pass the
> bare model ID and let claudish route it. Never add provider prefixes, and never resolve
> an ID from memory or a committed file.

---

#### 🤖 Claudish - Multi-Model CLI

**Repository:** [github.com/MadAppGang/claudish](https://github.com/MadAppGang/claudish) | **Category:** Development Tools | **Type:** Standalone CLI

Run Claude Code with any OpenRouter model via local Anthropic API proxy. **100% VERIFIED** - Routes to real OpenRouter models, NOT Anthropic.

**Model selection** resolves against claudish's live catalog via the `list_models` and `search_models` MCP tools — a curated database fed by 18+ provider collectors and cached for 24 hours, so it never needs a manual sync. Name a family like `grok`, `gemini` or `gpt` and claudish resolves the current model and provider automatically.

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
claudish --model grok-4.5 "your task"

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

Magus ships on three channels. Core development plugins live in `magus`; add the others only
if you need them:

| Marketplace | Contains |
|---|---|
| `MadAppGang/magus` | Core development plugins — dev, code-analysis, terminal, designer, browser-use, and more |
| `MadAppGang/magus-marketing` | SEO, AI image generation, video editing, cold email outreach |
| `MadAppGang/magus-alpha` | Experimental plugins with evolving interfaces |

Plugin IDs carry the marketplace, so enable them as `seo@magus-marketing`, not `seo@magus`.

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
    "setup@magus": true
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

Start at the **[documentation home](./docs/index.md)**.

### Using the plugins

- **[Plugin Catalog](./docs/plugins/index.md)** - Every plugin, with its commands, subagents and skills
- **[Advanced Usage](./docs/guides/advanced-usage.md)** - Installation methods, configuration, and workflows
- **[Troubleshooting](./docs/guides/troubleshooting.md)** - Common issues and solutions

Writing a plugin is a separate tutorial; those guides live in `docs/authoring/` and are not
part of the user documentation.

---

## 💡 Plugin Requests

Have a plugin idea? [Open an issue](https://github.com/MadAppGang/magus/issues) with the `plugin-request` label.

Planned work and candidate plugins live in [ROADMAP.md](./ROADMAP.md). This README describes what ships today.

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
