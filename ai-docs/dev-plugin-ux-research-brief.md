# Dev Plugin UX Improvements: Research Brief

**Date:** March 20, 2026
**Plugin Version:** v2.1.0
**Author:** Claude (Research Assistant)
**Status:** Analysis Complete, Recommendations Ready for Review

---

## Executive Summary

The Magus dev plugin provides significant value through structured development workflows, but faces 5 key UX challenges that create confusion for users:

1. **Command name conflicts** with native Claude Code capabilities (`/review` vs `/dev:review`)
2. **Recursive namespace naming** (`/dev:dev`)
3. **Overlap ambiguity** — users can't distinguish plugin value from native Claude abilities
4. **Discoverability friction** — 12 commands with progressive disclosure adds cognitive load
5. **Namespace verbosity** — `/dev:` prefix on every command

This research brief provides **concrete, evidence-based recommendations** for all 7 research questions, ranked by impact and including risk assessments.

---

## Research Question 1: Command Naming

### Current Problem

| Command | Conflict Level | Issue |
|---------|---------------|-------|
| `/dev:review` | **HIGH** | Claude Code has built-in `/review` for PR review |
| `/dev:debug` | Medium | Claude can naturally debug when asked |
| `/dev:investigate` | Medium | Claude naturally reads code when asked |

The `/dev:review` conflict is the most severe — users typing `/review` get native PR review, but may want the dev plugin's multi-scope review (code quality, UI/design, documentation, security, plugin quality).

### Suggestion 1A: Rename `/dev:review` → `/dev:audit` (RECOMMENDED - HIGH IMPACT)

**Rationale:**
- "Audit" implies comprehensive, structured assessment — matching the plugin's scope
- Avoids conflict with native `/review` entirely
- Differentiates: `/review` = PR review (native), `/dev:audit` = quality audit (structured)

**Implementation:**
```yaml
# New command name
name: audit
description: "Audit code quality, UI/design, docs, security, or plugin quality — comprehensive review with specialized reviewers"

# Keep /dev:review as hidden alias for backward compatibility (deprecated)
aliases: ["review"]  # If plugin system supports aliases
```

**Migration path:**
1. Add `/dev:audit` as primary command
2. Keep `/dev:review` working but show deprecation notice
3. After 2-3 releases, remove `/dev:review` or make it a silent redirect

**Risks:**
| Risk | Mitigation |
|------|------------|
| Breaking muscle memory | Deprecation warning with clear message: "Use /dev:audit instead" |
| Documentation updates | Update all docs, but keep old references for searchability |
| User confusion during transition | Show clear redirect: "/dev:review is now /dev:audit" |

---

### Suggestion 1B: Rename `/dev:review` → `/dev:assess` (ALTERNATIVE - MEDIUM IMPACT)

**Rationale:**
- "Assess" is shorter, active verb
- Less formal than "audit"
- Still distinct from "review"

**Downside vs 1A:**
- "Audit" better conveys comprehensiveness and formality
- "Assess" is more generic

---

### Suggestion 1C: Keep `/dev:review` but Add Disambiguation Prompt (LOW IMPACT)

When user types ambiguous input, prompt:
```yaml
AskUserQuestion:
  question: "Which review do you want?"
  options:
    - label: "PR Review (built-in)"
      description: "Review a pull request with Claude's native capabilities"
    - label: "Quality Audit (dev plugin)"
      description: "Comprehensive audit: code quality, security, docs, UI/design, or plugin quality"
```

**Why this is low impact:**
- Adds friction (extra question)
- Doesn't solve the confusion, just reacts to it
- User may not know which they need

---

## Research Question 2: Progressive Disclosure & Command Count

### Current Problem

The plugin has **12 commands** with progressive disclosure adding complexity. Research shows:
- Miller's Law: humans can hold ~7 items in working memory
- Hick's Law: decision time increases with number of options
- Progressive disclosure adds cognitive overhead ("what's under this menu?")

### Analysis: Which Commands Are Essential?

| Command | Usage Frequency | Value Add | Merge Candidate |
|---------|-----------------|-----------|-----------------|
| `/dev:help` | High | Medium | Keep |
| `/dev:debug` | High | **High** (structured workflows) | Keep |
| `/dev:dev` | High | **High** (8-phase lifecycle) | Keep |
| `/dev:architect` | Medium | **High** (plan mode + multi-model) | Keep |
| `/dev:research` | Medium | **High** (convergence-based) | Keep |
| `/dev:interview` | Low | High (LLMREI) | **Merge with `/dev:dev`** |
| `/dev:investigate` | Medium | Medium (routes to code-analysis) | **Merge with `/dev:debug`** |
| `/dev:review` → `/dev:audit` | Medium | High | Keep (renamed) |
| `/dev:doc` | Medium | High | Keep |
| `/dev:learn` | Low | Medium | **Move to hook** |
| `/dev:setup` | Low (one-time) | High | **Make automatic** |
| `/dev:worktree` | Low | High | Keep (specialized) |

### Suggestion 2A: Consolidate to 8 Commands (RECOMMENDED - HIGH IMPACT)

**Merge `/dev:interview` into `/dev:dev`:**
```yaml
# /dev:dev becomes the single entry point for "build something"
# It already has Phase 1 (Requirements) — that's the interview

User says: "/dev:dev Add user authentication"
→ Phase 1 runs requirements gathering (interview)
→ Continue through lifecycle

User says: "/dev:dev --quick Add user authentication"
→ Skip interview, use auto-inference
```

**Merge `/dev:investigate` into `/dev:debug`:**
```yaml
# Add "investigate" scope to /dev:debug

AskUserQuestion:
  question: "What do you want to do?"
  options:
    - label: "Fix a bug"
      description: "Apply a patch to fix an issue"
    - label: "Investigate only"
      description: "Trace code, understand architecture, find root cause (read-only)"
```

**Make `/dev:setup` automatic:**
```yaml
# Detect when CLAUDE.md is missing
# On first /dev:dev or /dev:debug, auto-run setup
# Ask: "No CLAUDE.md found. Create one with task routing?"
```

**Move `/dev:learn` to PostToolUse hook:**
```yaml
# Add to hooks/hooks.json:
{
  "hooks": [{
    "name": "learn-on-commit",
    "event": "PostToolUse",
    "when": "git commit completed",
    "action": "Propose CLAUDE.md update based on session patterns"
  }]
}
```

**Final 8 Commands:**
1. `/dev:help` — Show plugin help
2. `/dev:dev` — Build features (includes interview)
3. `/dev:debug` — Debug and investigate (includes read-only investigation)
4. `/dev:architect` — Design systems
5. `/dev:research` — Multi-source research
6. `/dev:audit` — Quality review (renamed from review)
7. `/dev:doc` — Documentation
8. `/dev:worktree` — Git worktree management

---

### Suggestion 2B: Keep 12 Commands but Improve Organization (MEDIUM IMPACT)

Group commands in `/dev:help` output:
```
### Build & Debug
/dev:dev      — Build features (includes requirements interview)
/dev:debug    — Fix bugs with structured workflows
/dev:architect — Design systems and plan

### Analyze & Improve
/dev:investigate — Read-only code investigation
/dev:audit    — Quality audit (code, security, docs, UI, plugins)
/dev:research — Multi-source research

### Documentation & Setup
/dev:doc      — Generate and validate documentation
/dev:learn    — Propose CLAUDE.md improvements
/dev:setup    — Initialize project CLAUDE.md
/dev:worktree — Git worktree management

### Help
/dev:help     — Show this help
```

**Why this is less ideal:**
- Doesn't reduce decision complexity
- Still 12 commands to parse

---

### Suggestion 2C: Merge Everything into `/dev` with Subcommands (RISKY - LOW IMPACT)

```bash
/dev build    # was /dev:dev
/dev debug    # was /dev:debug
/dev audit    # was /dev:review
/dev research # was /dev:research
```

**Why this is risky:**
- Claude Code plugin system may not support subcommands
- Changes user mental model significantly
- Adds parsing complexity

---

## Research Question 3: Value Differentiation

### Current Problem

Users can't distinguish:
- "Ask Claude to debug this" (native) vs `/dev:debug` (structured workflow)
- "Review this code" (native) vs `/dev:review` (multi-scope audit)

### Root Cause

The plugin provides **invisible structure** — users don't see the value until after using it.

### Suggestion 3A: Add "What This Adds" Banner (RECOMMENDED - HIGH IMPACT)

At the start of every command, show:
```
╔══════════════════════════════════════════════════════════════════╗
║  /dev:debug — Structured Debugging Workflow                      ║
║                                                                  ║
║  This command provides:                                          ║
║  • 3-strategy fault localization (stack trace, keyword, AST)     ║
║  • TDD-first patch application (RED → VERIFY → GREEN)            ║
║  • Multi-model consensus review for critical fixes               ║
║  • Automatic regression detection                                ║
║                                                                  ║
║  For quick debugging, just ask Claude. This is for systematic    ║
║  fixes with validation guarantees.                               ║
╚══════════════════════════════════════════════════════════════════╝
```

**Implementation:**
- Store banner text in each command file
- Show once per session (track in session state)
- Can be disabled in plugin settings

---

### Suggestion 3B: Rename Commands to Emphasize Structure (MEDIUM IMPACT)

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `/dev:debug` | `/dev:fix` | "Fix" implies solution; "debug" is ambiguous |
| `/dev:review` | `/dev:audit` | "Audit" implies formality and comprehensiveness |
| `/dev:dev` | `/dev:build` | "Build" is clearer than "dev" |

Note: `/dev:dev` already has `/dev:build` alias — make it primary.

---

### Suggestion 3C: Create "Simple vs Structured" Prompt (MEDIUM IMPACT)

When user types something ambiguous:
```yaml
AskUserQuestion:
  question: "How would you like to approach this?"
  options:
    - label: "Quick assistance"
      description: "Claude will help directly using built-in capabilities"
    - label: "Structured workflow"
      description: "Use the dev plugin's phased approach with validation gates"
```

**Why this is secondary:**
- Adds friction
- Better to make value clear in command naming/description

---

## Research Question 4: Namespace Design

### Current Problem

All commands require `/dev:` prefix — 5 characters of typing overhead.

Compare:
- `/review` (built-in) — 7 chars
- `/dev:audit` (plugin) — 11 chars
- `/dev:dev` — 8 chars, awkward repetition

### Suggestion 4A: Keep `/dev:` but Optimize (RECOMMENDED - HIGH IMPACT)

**Accept `/d:` as shorthand:**
```yaml
# In command routing, accept both:
/dev:dev
/d:dev

# Or even shorter:
/d:build
/d:fix
/d:audit
```

**Implementation:**
- Add command aliases in plugin.json
- Claude Code plugin system supports multiple command names

**Benefits:**
- Backward compatible
- Power users can type less
- No breaking changes

---

### Suggestion 4B: Request Shorter Namespace from Claude Code (FUTURE)

Request from Anthropic:
- Allow plugins to register at top-level when no conflict
- Or allow 2-char namespaces (like `/dv:`)

**Why this is future:**
- Requires platform change
- Not actionable by plugin author

---

### Suggestion 4C: Auto-alias Common Commands (MEDIUM IMPACT)

If user types `/build`, show:
```
Did you mean:
1. /dev:build — Build features with structured workflow
2. [ask Claude directly]
```

**Why this is secondary:**
- Requires hook into command-not-found
- May conflict with future Claude Code commands

---

## Research Question 5: Onboarding

### Current Problem

New users see 12 commands and don't know where to start.

### Suggestion 5A: Create Interactive Onboarding Command (RECOMMENDED - HIGH IMPACT)

Add `/dev:start` or enhance `/dev:help`:
```yaml
/dev:start
→ "What do you want to do?"
  1. Build a new feature → launches /dev:dev with guidance
  2. Fix a bug → launches /dev:debug with guidance
  3. Understand this codebase → launches /dev:investigate
  4. Review code quality → launches /dev:audit
  5. Set up this project → launches /dev:setup

→ After selection, explain what will happen before executing
```

---

### Suggestion 5B: Add "First Time" Detection (MEDIUM IMPACT)

Track in plugin settings:
```json
{
  "pluginSettings": {
    "dev": {
      "firstUse": false,
      "showTips": true
    }
  }
}
```

On first use, show:
```
👋 Welcome to the dev plugin!

This plugin adds structured development workflows to Claude Code.

Quick start:
• /dev:dev    — Build features (try this first!)
• /dev:debug  — Fix bugs systematically
• /dev:help   — See all commands

Run /dev:tour for an interactive walkthrough.
```

---

### Suggestion 5C: Create Video/GIF Demo (LOW IMPACT)

Embed demo in README showing:
- Before: "Claude, fix this bug" (simple response)
- After: `/dev:debug` (structured phases, validation)

---

## Research Question 6: Further Command Consolidation

### Current State

Already consolidated from 17 → 12 commands in v2.0.0.

### Suggestion 6A: Consolidate to 6 Core Commands (RECOMMENDED FOR v3.0)

| New Command | Combines | Description |
|-------------|----------|-------------|
| `/dev:build` | `/dev:dev` + interview | Build features with requirements gathering |
| `/dev:fix` | `/dev:debug` + investigate | Fix bugs and investigate issues |
| `/dev:design` | `/dev:architect` | Design systems and architecture |
| `/dev:research` | (keep) | Multi-source research |
| `/dev:audit` | `/dev:review` + doc | Audit code, security, docs, UI |
| `/dev:tools` | `/dev:worktree` + setup + learn | Project tools and setup |

**Migration:**
```
v2.1 (current):  /dev:dev, /dev:debug, /dev:investigate, etc.
v3.0 (future):   /dev:build, /dev:fix, /dev:design, /dev:research, /dev:audit, /dev:tools
```

**Benefits:**
- 6 commands = within Miller's Law (7±2)
- Clear verb-based naming
- Each command has clear scope

---

### Suggestion 6B: Keep Current 12, Improve Documentation (CONSERVATIVE)

If consolidation is too disruptive:
- Better `/dev:help` organization
- Clearer command descriptions
- Usage examples in every command

---

## Research Question 7: Conflict Resolution Strategy

### General Strategy for Plugin Authors

When a plugin command overlaps with native capabilities:

#### Tier 1: Avoid the Conflict (BEST)
- Choose different names before release
- Use more specific verbs ("audit" vs "review")
- Use compound names ("code-audit" vs "audit")

#### Tier 2: Embrace the Differentiation
- Make value proposition explicit in command description
- Add "what this adds" messaging
- Position as "structured" vs "quick"

#### Tier 3: Provide Disambiguation
- Detect ambiguous input
- Prompt user to clarify intent
- Route to appropriate capability

### Recommended Strategy for Dev Plugin

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFLICT RESOLUTION MATRIX                    │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Conflict Type   │ Strategy        │ Example                     │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ Same name,      │ Rename plugin   │ /dev:review → /dev:audit    │
│ different scope │ command         │                             │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ Similar         │ Emphasize       │ /dev:debug adds "TDD state  │
│ capability      │ structure       │ machine" vs native debug    │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ User unsure     │ Disambiguation  │ "Do you want quick help or  │
│ which to use    │ prompt          │ structured workflow?"       │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ Future          │ Namespace       │ Use /dev: prefix; request   │
│ expansion       │ reservation     │ shorter namespaces          │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Immediate (v2.2.0) — Low Risk, High Impact

1. **Add `/dev:audit`** as alias for `/dev:review` with deprecation notice
2. **Add `/d:` shorthand** for all commands
3. **Improve `/dev:help`** output with better grouping
4. **Add value banners** to top 3 commands (dev, debug, audit)

### Phase 2: Short Term (v2.3.0) — Medium Risk

1. **Merge `/dev:interview`** into `/dev:dev` (it's already there as Phase 1)
2. **Add `/dev:investigate` scope** to `/dev:debug`
3. **Auto-detect first use** and show welcome message
4. **Make `/dev:setup` automatic** when CLAUDE.md missing

### Phase 3: Long Term (v3.0.0) — Higher Risk, Clean Slate

1. **Rename commands:**
   - `/dev:dev` → `/dev:build` (make alias primary)
   - `/dev:debug` → `/dev:fix`
   - `/dev:review` → `/dev:audit`
2. **Consolidate to 6 commands** as outlined in RQ6
3. **Remove deprecated aliases** after 2-release deprecation period

---

## Success Metrics

Track these to validate improvements:

| Metric | Baseline | Target |
|--------|----------|--------|
| Command usage confusion (support tickets) | Unknown | -50% |
| Time to first successful command | Unknown | -30% |
| `/dev:help` usage (indicator of confusion) | Unknown | -20% |
| User retention (returning users) | Unknown | +25% |

---

## Appendix: Other CLI Tool Patterns

### GitHub CLI (`gh`)
- Extensions use `gh-<name>` prefix
- Native commands are flat, extensions are namespaced
- No conflicts because namespace is enforced

### VS Code
- Commands use category prefix: `Git: Pull`, `Docker: Build`
- Users can search by category or command name
- Extension commands show source extension

### npm/yarn
- Scripts are user-defined, no conflicts
- Built-ins are reserved (`install`, `publish`)
- Plugins extend via subcommands (`npm <cmd>`)

### kubectl
- All commands are resource-centric: `kubectl get pods`
- Plugin pattern: `kubectl-<name>` binary in PATH
- Clean separation via hyphenated naming

### Lessons Applied to Dev Plugin
1. **Namespace all plugin commands** — already done with `/dev:`
2. **Use clear, action-oriented names** — `/dev:build` > `/dev:dev`
3. **Differentiate by scope** — `/dev:audit` ≠ `/review`
4. **Provide discovery** — good help output with categories

---

## Conclusion

The dev plugin provides substantial value through structured workflows, but naming and organization create unnecessary confusion. The highest-impact changes are:

1. **Rename `/dev:review` → `/dev:audit`** (avoid native conflict)
2. **Add `/d:` shorthand** (reduce typing friction)
3. **Consolidate to 8 commands** (reduce decision complexity)
4. **Add value banners** (make invisible structure visible)
5. **Plan v3.0 consolidation** to 6 clean, verb-based commands

These changes maintain backward compatibility during transition while progressively improving the user experience.

---

*Document version: 1.0*
*Last updated: 2026-03-20*
*Next review: After v2.2.0 release*
