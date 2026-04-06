# Dev Plugin UX Research Report

**Research Date:** March 20, 2026
**Plugin Version:** v2.1.0
**Prepared for:** Magus Plugin Team

---

## Executive Summary

This report addresses UX improvement opportunities for the Dev Plugin (v2.1.0), focusing on conflicts with native Claude Code commands, discoverability, and maintaining plugin value without user confusion. Analysis reveals the primary challenge is **communicating structured workflow value** rather than mere command naming conflicts.

---

## 1. Command Naming: Resolving Native Conflicts

### Analysis of Current Problems

The research brief identifies three medium-to-high conflict commands:

| Command | Conflict Level | Native Equivalent | User Confusion Risk |
|---------|----------------|-------------------|---------------------|
| `/dev:review` | HIGH | `/review` (PR review) | High — users don't know which to use |
| `/dev:debug` | MEDIUM | Claude's natural debugging | Medium — "why not just ask?" |
| `/dev:investigate` | MEDIUM | Claude's natural code reading | Medium — overlap perception |
| `/dev:dev` | MEDIUM | Self-referential naming | Medium — `/dev:dev` is confusing |

### Improvement Suggestions

#### Rank 1: Rename `/dev:review` to `/dev:assess` (HIGH IMPACT)

**Rationale:** The word "review" directly conflicts with Claude's built-in `/review` command for PR reviews. The dev plugin's review is broader (code quality, UI, docs, security, plugin) but shares the same word.

**Proposed names:**
- `/dev:assess` — "assess code quality, UI implementation, docs, security"
- `/dev:audit` — sounds more formal/enterprise
- `/dev:analyze` — emphasizes investigation over feedback

**Recommendation:** `/dev:assess` (shorter, action-oriented, no conflict)

**Risk:** Low. `assess` is uncommon as a CLI command, creates clear differentiation.

#### Rank 2: Add Disambiguation Banner for `/dev:review` (HIGH IMPACT)

If renaming is not desired, add clear differentiation in the help output:

```
/dev:review → Code quality review (NOT for PRs - use /review for PRs)
/review    → PR/MR review (built-in Claude Code command)
```

**Implementation:** Update `help.md` output_format to show this distinction prominently.

#### Rank 3: Rename `/dev:dev` to `/dev:build` (MEDIUM IMPACT)

The alias `/dev:build` already exists. The recommendation is to:
1. Make `/dev:build` the canonical name
2. Deprecate `/dev:dev` with a migration message
3. Update all documentation to reference `/dev:build` first

**Why:** "Build" is unambiguous — it means "construct something." "Dev" is the plugin namespace itself, causing confusion.

**Risk:** Low. The alias already exists; this is a documentation rename.

#### Rank 4: Keep `/dev:debug` and `/dev:investigate` but Add ValueProposition Messaging

Unlike `/review`, these commands don't conflict with exact native equivalents. They overlap with Claude's natural capabilities, which is acceptable for a plugin that provides **structured workflows**.

Add brief value propositions in help output:
- `/dev:debug` → "Systematic debugging with root-cause analysis workflow"
- `/dev:investigate` → "Architecture tracing with evidence-based investigation"

---

## 2. Progressive Disclosure: Optimal Command Set Size

### Analysis

The plugin currently has **12 commands** but the help command displays only **5** (based on help.md line 53: "List all 5 available commands"). This is a **documentation inconsistency** that needs fixing.

Current commands: help, debug, dev, architect, research, interview, investigate, review, doc, learn, setup, worktree

### Improvement Suggestions

#### Rank 1: Fix the Help Command Documentation (HIGH IMPACT - QUICK WIN)

The help.md file claims to show 5 commands but the plugin has 12. This confusion contributes to discoverability issues.

**Action:** Update `help.md` output_format to display all 12 commands with clear categorization.

#### Rank 2: Group Commands into Tiers (HIGH IMPACT)

Implement a true progressive disclosure model:

**Tier 1 — Core (3-4 commands, shown by default):**
- `/dev:help` — entry point
- `/dev:build` — the main development command
- `/dev:debug` — common need

**Tier 2 — Extended (4-5 commands, shown with "more" or on demand):**
- `/dev:architect` — planning
- `/dev:research` — investigation
- `/dev:assess` — review (renamed)
- `/dev:worktree` — advanced

**Tier 3 — Specialized (remaining, hidden by default):**
- `/dev:interview` — requirements
- `/dev:investigate` — deep code analysis
- `/dev:doc` — documentation
- `/dev:learn` — session learning
- `/dev:setup` — project initialization

**Implementation:** Update help command to accept flags like `/dev:help --all` or categorize output.

#### Rank 3: Consider Merging 1-2 Commands (MEDIUM IMPACT)

Potential merges:
- `/dev:interview` + `/dev:setup` → `/dev:init` (project initialization workflow)
- `/dev:investigate` → Merge into `/dev:research` with a flag

**Risk:** Medium. Merging reduces flexibility; ensure flags maintain functionality.

---

## 3. Value Differentiation: Communicating Structured Workflows

### Analysis

The core UX challenge: **structured workflows are invisible**. When a user types `/dev:debug`, they expect debug help. They don't immediately understand that:
- Phase 0: Error analysis
- Phase 1: Root cause identification
- Phase 2: Fix proposal with evidence
- Phase 3: Validation

This is a **value communication problem**, not a naming problem.

### Improvement Suggestions

#### Rank 1: Add Workflow Preview in Command Descriptions (HIGH IMPACT)

Change from:
```
/dev:debug → "Universal debugging — quick patch, systematic debug, or production-grade TDD fix"
```

To:
```
/dev:debug → "Systematic debugging workflow. Analyzes error → identifies root cause → proposes fix → validates. Use for: hard bugs, production issues, TDD-style fixes."
```

**Key insight:** Show the workflow stages, not just the capability.

#### Rank 2: Add "Why Not Just Ask?" Section to Help (HIGH IMPACT)

In the help output, explicitly address the overlap question:

```
### Why Use /dev: Commands Instead of Asking Directly?

/dev:build provides STRUCTURED workflows:
- Phase-gated development (requirements → plan → implement → test → validate)
- Multi-model consensus for architecture and code review
- Black-box testing (tests written WITHOUT seeing implementation)
- Real browser validation (not just unit tests)

Direct asking is fine for quick tasks. /dev:build is for features that need
repeatable, quality-assured development.
```

**Risk:** None. This is documentation.

#### Rank 3: Show Progress Indicators During Execution (MEDIUM IMPACT)

The `/dev:dev` command already shows phases, but many commands don't. Add consistent progress indicators:

```
/dev:debug Analyzing error...
  → Phase 1/4: Error classification
  → Phase 2/4: Root cause investigation
  → Phase 3/4: Fix proposal
  → Phase 4/4: Validation
```

**Implementation:** Update command templates to include phase progress.

---

## 4. Namespace Design: Is `/dev:` Right?

### Analysis

Arguments for keeping `/dev:`:
- Short (4 characters)
- Recognizable ("dev" = development)
- Matches plugin name
- Unlikely to conflict with other plugins

Arguments for changing:
- All commands require `/dev:` prefix (verbosity)
- Native commands are shorter (`/review`, `/test`)
- Users may want commands without prefix when plugin is primary

### Improvement Suggestions

#### Rank 1: Keep `/dev:` Namespace (HIGH CONFIDENCE)

The namespace is appropriate. Changing it would break existing workflows and documentation.

**Recommendation:** Keep `/dev:` but improve discoverability so users know commands exist.

#### Rank 2: Add Alias System for Common Commands (MEDIUM IMPACT)

Allow plugin-level aliases in `settings.json`:

```json
{
  "pluginSettings": {
    "dev": {
      "aliases": {
        "build": "/dev:build",
        "review": "/dev:assess"
      }
    }
  }
}
```

Then users can type `/build` instead of `/dev:build`.

**Risk:** Low. Optional feature, users opt-in.

#### Rank 3: Provide "Quick Start" Command Suggestions (LOW IMPACT)

In help output, show shortcuts for common workflows:

```
Quick Start:
  /dev:build Add login page     → Full feature development
  /dev:debug TypeError in X     → Systematic debugging
  /dev:architect Design API     → Architecture planning
```

---

## 5. Onboarding: New User Discovery

### Analysis

Current onboarding is `/dev:help`, which:
- Shows 5 commands (out of 12 — documentation bug)
- Requires user to run it proactively
- Doesn't explain *when* to use each command

### Improvement Suggestions

#### Rank 1: Add First-Run Welcome Message (HIGH IMPACT)

On first `/dev:` command usage, show:

```
👋 Welcome to Dev Plugin v2.1.0

Your detected stack: {stack}
Recommended: /dev:build for features, /dev:debug for issues

Quick commands:
  /dev:help          → Full command list
  /dev:build         → Build a feature
  /dev:debug         → Debug an error
  /dev:architect     → Plan architecture

Run /dev:help --all for advanced commands
```

**Implementation:** Add hook or state file to detect first run.

#### Rank 2: Add Context-Sensitive Suggestions (HIGH IMPACT)

When user expresses intent, suggest the right command:

- User says "fix this bug" → "Try /dev:debug for systematic debugging"
- User says "build something" → "Try /dev:build for structured development"
- User says "design this" → "Try /dev:architect for architecture planning"

**Implementation:** Add to plugin's message handler or as a skill.

#### Rank 3: Create Visual Command Decision Tree (MEDIUM IMPACT)

Add to README and help output:

```
What do you want to do?

┌─ Build something new
│  └─ /dev:build [feature description]
│
├─ Fix a bug/error
│  └─ /dev:debug [error message]
│
├─ Plan architecture
│  └─ /dev:architect [requirements]
│
├─ Research/understand code
│  └─ /dev:research [topic]
│  └─ /dev:investigate [file/component]
│
└─ Review/analyze
   └─ /dev:assess [target] --type [code|ui|docs|security]
```

**Risk:** None. Documentation improvement.

---

## 6. Command Consolidation: Go Further from 12?

### Analysis

The plugin already consolidated from 17 to 12 commands in v2.0.0. Further consolidation must balance:
- Reducing cognitive load
- Maintaining specialized functionality
- Avoiding feature loss

### Improvement Suggestions

#### Rank 1: Do NOT Consolidate Further (HIGH CONFIDENCE)

The current 12-command structure is appropriate because:
- Each command maps to a distinct workflow (debug ≠ architect ≠ research)
- Consolidation would create command-line flags that reduce discoverability
- The progressive disclosure tier system (Tier 1/2/3 above) addresses overload

**Recommendation:** Implement progressive disclosure first. Only consolidate if tiered approach doesn't solve discoverability.

#### Rank 2: Merge `/dev:interview` into `/dev:setup` (LOW IMPACT, IF NEEDED)

Both relate to project initialization:
- `/dev:interview` — requirements gathering
- `/dev:setup` — CLAUDE.md setup

Proposal: `/dev:init` as unified project initialization command with flags:
- `/dev:init --requirements "feature description"` → interview flow
- `/dev:init --setup` → CLAUDE.md setup

**Risk:** Medium. Changes existing workflows; requires migration support.

#### Rank 3: Convert `/dev:investigate` to Flag (LOW IMPACT, IF NEEDED)

Current: `/dev:investigate [target]` — code analysis
Alternative: `/dev:research --analyze [target]`

**Risk:** Low. Adds flag, doesn't remove functionality.

---

## 7. Conflict Resolution Strategy for Plugins

### General Principles

When plugins create commands that overlap with native Claude Code capabilities:

#### Rule 1: Differentiation by Default

If command names overlap, add clear differentiation in ALL help outputs:

```
/review      → PR/MR review (native)
/dev:assess  → Code quality, UI, docs, security review (plugin)
```

#### Rule 2: Value Proposition Messaging

For any command that overlaps with "natural Claude behavior," explicitly state what the structured workflow adds:

- **Not:** "Debug your code"
- **But:** "Systematic debugging: error classification → root cause → fix proposal → validation. Use for: hard-to-find bugs, production issues, TDD workflow."

#### Rule 3: Progressive Disclosure by Default

New plugins should start with 3-5 core commands and expand via:
- Context detection (show relevant commands for detected stack)
- User request (on-demand expansion)
- Alias system for power users

#### Rule 4: Namespace Strategy

- Use distinct namespace (avoid generic like `/code`, `/build`)
- Keep namespace short (2-4 characters optimal)
- Allow aliases for frequently-used commands

#### Rule 5: Migration Support

When renaming/deprecating commands:
1. Support old name for 2+ minor versions
2. Show migration message: "Command renamed. Use X instead. Old name works but deprecated."
3. Document breaking changes in plugin changelog

---

## Recommendations Summary

### Immediate Actions (This Release)

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| 1 | Fix help.md to show all 12 commands | High | Low |
| 2 | Add value proposition messaging to command descriptions | High | Low |
| 3 | Add "Why not just ask?" section to help | High | Low |
| 4 | Rename `/dev:review` → `/dev:assess` (or add disambiguation banner) | High | Medium |

### Short-Term (Next 1-2 Releases)

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| 5 | Implement tiered progressive disclosure (Tier 1/2/3) | High | Medium |
| 6 | Add first-run welcome message | Medium | Low |
| 7 | Add context-sensitive command suggestions | Medium | Medium |
| 8 | Make `/dev:build` canonical, deprecate `/dev:dev` | Medium | Low |

### Long-Term (Future Planning)

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| 9 | Consider alias system for power users | Low | Medium |
| 10 | Visual command decision tree in docs | Low | Low |

---

## Appendix: Comparison with Other CLI Tool Approaches

### VS Code Command Palette
- Shows commands in alphabetical order with fuzzy search
- Groups by category (File, Edit, View, etc.)
- Shows keybinding hints
- Lesson: Category grouping aids discovery more than alphabetical

### GitHub CLI (`gh`)
- Main commands: `gh pr`, `gh issue`, `gh repo` (3 top-level)
- Subcommands: `gh pr view`, `gh pr create` (nested)
- Lesson: Hierarchical structure reduces top-level count

### Docker CLI
- Top-level: `docker run`, `docker build`, `docker ps` (~40 commands)
- Discovery via `docker --help` and tab completion
- Lesson: Large command sets work with good help + completion

### Claude Code (native)
- Minimal commands: `/help`, `/review`, `/test` (~5)
- Natural language is primary interface
- Lesson: Plugins should NOT compete with natural language; should offer STRUCTURE instead

---

*Report prepared for Magus plugin team. For questions, contact the research team.*
