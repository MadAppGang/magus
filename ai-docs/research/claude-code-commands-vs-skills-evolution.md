# Research Findings: Claude Code Plugin System Evolution — Commands vs Skills

**Date**: 2026-03-29
**Sources consulted**: Official Anthropic docs, GitHub CHANGELOG.md, GitHub Issues (anthropics/claude-code), local Magus codebase
**Queries executed**: 12 (web fetches + local searches + GitHub API)

---

## Executive Summary

The commands-vs-skills distinction has been **officially resolved by Anthropic**: custom slash commands have been merged into the Skills system. Commands (`.claude/commands/*.md`) still work for backward compatibility but are now a legacy format. Skills (`SKILL.md` in a directory) are the canonical format going forward, with skills being a strict superset of what commands could do.

The key architectural insight is that this is **not a deprecation** — commands still fully work — but Skills have replaced them as the primary concept with additional capabilities. The term "slash command" survives in Claude Code UI (the `/` menu) but refers to skill invocation, not a distinct mechanism.

---

## Key Findings

### Finding 1: Official Merge Announcement — "Custom commands have been merged into skills"

**Summary**: Anthropic's official Skills documentation explicitly states that custom commands have been merged into the skills system.

**Evidence**: The current official docs at `https://docs.anthropic.com/en/docs/claude-code/skills` contain this exact statement at the top of the page:

> "Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working. Skills add optional features: a directory for supporting files, frontmatter to control whether you or Claude invokes them, and the ability for Claude to load them automatically when relevant."

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High (official Anthropic docs), Date: 2026-03-28

**Confidence**: High
**Multi-source**: Confirmed by multiple additional sources below

---

### Finding 2: Skills Were Introduced in Version 2.0.20

**Summary**: Skills as a concept were added to Claude Code in version 2.0.20 (late 2025). Before that, only custom slash commands existed.

**Evidence**: The official CHANGELOG.md in the `anthropics/claude-code` GitHub repository contains:

```
## 2.0.20
- Added support for Claude Skills
```

Version 2.0.12 (a few releases earlier) introduced the Plugin System:

```
## 2.0.12
- Plugin System Released: Extend Claude Code with custom commands, agents, hooks, and MCP servers from marketplaces
```

The Plugin System shipped first (with `commands/` directories in plugins), then Skills were added as a higher-level concept shortly after.

**Sources**:
- [raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md) - Quality: High (official source), Date: 2026-03-28

**Confidence**: High
**Multi-source**: Yes

---

### Finding 3: How the Two Systems Originally Differed

**Summary**: Slash commands were originally simple Markdown files (invoked explicitly with `/name`), while Skills were designed with two layers — a frontmatter descriptor that loads into Claude's context automatically, and full skill content that loads on invocation.

**Evidence**: From the official Skills docs, the key functional differences were:

| Aspect | Old Commands (.claude/commands/*.md) | Skills (skills/*/SKILL.md) |
|--------|--------------------------------------|---------------------------|
| File format | Flat `.md` file | Directory with `SKILL.md` |
| Invocation | User types `/name` only | User OR Claude can invoke automatically |
| Context loading | Full content loaded on invocation | Description always in context; full content on invocation |
| Auto-loading | No | Yes, when `description` matches task context |
| Supporting files | No | Yes (arbitrary files alongside SKILL.md) |
| Frontmatter | Limited (added `argument-hint`, `allowed-tools` later) | Full: `disable-model-invocation`, `user-invocable`, `context`, `model`, `effort`, `paths`, etc. |
| Tool restrictions | No | `allowed-tools` field |
| Subagent isolation | No | `context: fork` with optional `agent:` override |

The defining conceptual difference: Commands were **user-invoked only** (you typed `/deploy`). Skills can be **auto-loaded by Claude** when it detects relevance from the description, AND can be user-invoked.

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High, Date: 2026-03-28
- Local codebase investigation of `plugins/dev/commands/dev.md` and `plugins/dev/skills/context-detection/SKILL.md` - Quality: High, Date: 2026-03-28

**Confidence**: High
**Multi-source**: Yes

---

### Finding 4: Slash Commands Are Still Relevant — But Now Refer to Skills

**Summary**: The term "slash command" persists in Claude Code UI, but it now refers to skill invocation (the `/` menu shows both old-style commands and skills uniformly). Neither has been removed.

**Evidence**:

1. The docs note: "Files in `.claude/commands/` still work and support the same frontmatter. Skills are recommended since they support additional features like supporting files."

2. The `commands/` directory format is still mentioned in the Plugins Reference:
> "Location: `skills/` or `commands/` directory in plugin root"

3. Multiple GitHub issues from 2026 reference both concepts being active:
   - Issue #35478 (2026-03-17): "[FEATURE] Expose OTEL logs/metrics for slash command (skills) usage" — the parenthetical clarifies they're the same
   - Issue #35383 (2026-03-17): "[Bug] Skills with same name from different sources not properly namespaced in slash commands"
   - Issue #38413 (2026-03-24): "Skill tool cannot invoke custom slash commands from .claude/commands/ or .claude/skills/"

4. The `commands/` directory in plugin.json manifests (like Magus's plugins) still works — the plugin system supports both `commands/` and `skills/` directories in `plugin.json`.

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/plugins-reference](https://docs.anthropic.com/en/docs/claude-code/plugins-reference) - Quality: High, Date: 2026-03-28
- GitHub anthropics/claude-code issues #35478, #35383, #38413 - Quality: High, Date: 2026-03-17 to 2026-03-24
- Local `plugins/dev/plugin.json` listing both `commands` and `skills` arrays - Quality: High

**Confidence**: High
**Multi-source**: Yes

---

### Finding 5: The Critical Behavioral Distinction That Remains

**Summary**: Even after the merge, one functionally meaningful distinction remains: `disable-model-invocation: true` vs. the default. Commands were always user-invoked; skills can be auto-loaded by Claude unless you opt out.

**Evidence**: From the Skills docs:

> "`disable-model-invocation: true`: Only you can invoke the skill. Use this for workflows with side effects or that you want to control timing, like `/commit`, `/deploy`, or `/send-slack-message`. You don't want Claude deciding to deploy because your code looks ready."

The three invocation modes:
1. **Default skill** (no flags): Description always in context; Claude auto-loads when relevant; user can also type `/name`
2. **`disable-model-invocation: true`**: Behaves like the old-style command — user must invoke explicitly
3. **`user-invocable: false`**: Only Claude can invoke (background knowledge, not a slash command)

Old commands (`.claude/commands/`) map to behavior #2 — explicitly invoked, not auto-loaded.

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High

**Confidence**: High
**Multi-source**: No (single official source but authoritative)

---

### Finding 6: The "Agent Skills Open Standard" Connection

**Summary**: Claude Code's Skills system is built on an open standard called "Agent Skills" designed to work across multiple AI tools. This is a strategic move beyond just renaming commands.

**Evidence**: From the official docs:

> "Claude Code skills follow the Agent Skills open standard, which works across multiple AI tools. Claude Code extends the standard with additional features like invocation control, subagent execution, and dynamic context injection."

The CHANGELOG entry for v2.0.43 also shows this evolution:
```
## 2.0.43
- Added skills frontmatter field to declare skills to auto-load for subagents
```

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High

**Confidence**: High
**Multi-source**: No

---

### Finding 7: Plugin System Uses Both Commands and Skills Directories

**Summary**: The official Claude Code Plugin system supports both `commands/` and `skills/` directories, and both appear in the Plugins Reference as valid locations for skills/commands in a plugin.

**Evidence**:

From the Plugins Reference:
> "Skills — Location: `skills/` or `commands/` directory in plugin root"
> "File format: Skills are directories with SKILL.md; commands are simple markdown files"

The local Magus codebase confirms this: `plugins/dev/plugin.json` lists both a `commands` array (14 entries like `./commands/dev.md`) and a `skills` array (48+ entries like `./skills/context-detection`). This is the intended plugin architecture where commands provide explicit invocation points and skills provide contextual knowledge.

The `plugin.json` manifest has separate top-level keys:
```json
{
  "commands": ["./commands/dev.md", ...],
  "skills": ["./skills/context-detection", ...]
}
```

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/plugins-reference](https://docs.anthropic.com/en/docs/claude-code/plugins-reference) - Quality: High
- `/Users/jack/mag/magus/plugins/dev/plugin.json` - Quality: High (primary source)

**Confidence**: High
**Multi-source**: Yes

---

### Finding 8: Confusion and Bugs at the Interface Between Commands and Skills

**Summary**: The merge of commands into skills has caused real user confusion and bugs, evidenced by dozens of GitHub issues. The most common issues are silent failures when files are in the wrong format, and inconsistent behavior between the two locations.

**Evidence** (selected GitHub issues):

- **Issue #34538** (2026-03-15): "Flat `.md-files` in `/.claude/skills/` silently ignored — no error, confusing given 'merged' messaging" — Users put flat `.md` files in `skills/` (expecting `commands/`-style behavior) and got silent failures
- **Issue #27888** (2026-02-23): "User-level custom commands in `~/.claude/commands/` not loaded into skill registry" — Commands stopped being loaded into skill registry in v2.1.47, regression
- **Issue #17271** (2026-01-10): "Project skill display in slash command but plugin skill doesn't" — Plugin skills vs. project skills treated differently
- **Issue #38398** (2026-03-24): "Skill slash command names should use frontmatter 'name' field verbatim — no prefix stripping" — Naming conflicts between commands and skills

The key insight from issue #34538:
> "The docs say: 'Custom commands have been merged into skills.' We read 'merged' and expected both formats to work in both directories. A flat file in `commands/` works, so a flat file in `skills/` should too. Instead, it silently fails."

**Sources**:
- GitHub anthropics/claude-code issues #34538, #27888, #17271, #38398 - Quality: High, Dates: 2026-01-10 to 2026-03-24

**Confidence**: High
**Multi-source**: Yes

---

### Finding 9: Current State — What Works Where

**Summary**: As of Claude Code v2.1.86 (March 27, 2026), the complete picture of where skills/commands live:

**Evidence**: Synthesized from official docs and Plugins Reference:

| Location | Format | Creates | Invocation |
|----------|--------|---------|------------|
| `~/.claude/skills/<name>/SKILL.md` | Directory + SKILL.md | `/name` | User or Claude (auto) |
| `~/.claude/commands/<name>.md` | Flat .md file | `/name` | User only (legacy) |
| `.claude/skills/<name>/SKILL.md` | Directory + SKILL.md | `/name` | User or Claude (auto) |
| `.claude/commands/<name>.md` | Flat .md file | `/name` | User only (legacy) |
| `<plugin>/skills/<name>/SKILL.md` | Directory + SKILL.md | `/<plugin>:<name>` | User or Claude (auto) |
| `<plugin>/commands/<name>.md` | Flat .md file | `/<plugin>:<name>` | User or Claude (auto in plugin context) |

**Priority rule** (from docs): "If you have files in `.claude/commands/`, those work the same way, but if a skill and a command share the same name, the skill takes precedence."

**Sources**:
- [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High
- [docs.anthropic.com/en/docs/claude-code/plugins-reference](https://docs.anthropic.com/en/docs/claude-code/plugins-reference) - Quality: High

**Confidence**: High
**Multi-source**: Yes

---

## Source Summary

**Total Sources**: 14
- High Quality: 12
- Medium Quality: 2
- Low Quality: 0

**Source List**:
1. [docs.anthropic.com/en/docs/claude-code/skills](https://docs.anthropic.com/en/docs/claude-code/skills) - Quality: High, Date: 2026-03-28, Type: Official docs
2. [docs.anthropic.com/en/docs/claude-code/plugins-reference](https://docs.anthropic.com/en/docs/claude-code/plugins-reference) - Quality: High, Date: 2026-03-28, Type: Official docs
3. [docs.anthropic.com/en/docs/claude-code/plugins](https://docs.anthropic.com/en/docs/claude-code/plugins) - Quality: High, Date: 2026-03-28, Type: Official docs
4. [raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md) - Quality: High, Date: 2026-03-28, Type: Official changelog
5. GitHub Issue #34538 - Quality: High, Date: 2026-03-15, Type: Bug report
6. GitHub Issue #27888 - Quality: High, Date: 2026-02-23, Type: Bug report
7. GitHub Issue #18949 - Quality: High, Date: 2026-01-18, Type: Bug report
8. GitHub Issue #35478 - Quality: High, Date: 2026-03-17, Type: Feature request
9. GitHub Issue #35383 - Quality: High, Date: 2026-03-17, Type: Bug report
10. GitHub Issue #38413 - Quality: High, Date: 2026-03-24, Type: Bug report
11. GitHub Issue #38398 - Quality: High, Date: 2026-03-24, Type: Feature request
12. GitHub Issue #17271 - Quality: High, Date: 2026-01-10, Type: Bug report
13. `/Users/jack/mag/magus/plugins/dev/plugin.json` - Quality: High, Date: current, Type: Local source
14. `/Users/jack/mag/magus/ai-docs/PLUGIN_SYSTEM_ARCHITECTURE.md` - Quality: Medium, Date: 2026-02-09, Type: Internal investigation

---

## Direct Answers to Research Questions

### Q1: How did Claude Code originally distinguish between slash commands and skills?

**Answer**: Originally (pre-v2.0.20), Claude Code only had slash commands — Markdown files in `.claude/commands/` that users explicitly invoked with `/name`. There was no concept of "skills." Skills were introduced in v2.0.20 as a new concept with two key innovations:
1. **Auto-invocation**: Claude can load a skill's instructions automatically without the user typing `/name`, based on the `description` frontmatter matching the task context
2. **Richer structure**: Skills live in a directory (not a flat file), allowing supporting files alongside `SKILL.md`

The distinction was: **commands = user-triggered prompts; skills = contextual knowledge that could be either auto-loaded or user-triggered**.

### Q2: Has Anthropic merged these concepts? Are slash commands still relevant?

**Answer**: Yes, Anthropic has explicitly merged them. The official documentation states: "Custom commands have been merged into skills." The `commands/` format still works for backward compatibility but is now legacy. Skills are the canonical format.

Slash commands as a UI concept (typing `/` in Claude Code) are still very much alive — they're just how you invoke skills explicitly. The `/` menu in the UI still shows all available skills and commands. What changed is that the underlying system is unified around skills, not commands.

### Q3: Search findings on Anthropic announcements and documentation

**Key findings**:
- **Skills introduced**: v2.0.20 (exact date not in changelog, but near November 2025 based on surrounding releases)
- **Plugin system**: Introduced v2.0.12 with `commands/` directories in plugins
- **Skill frontmatter field for subagents**: Added v2.0.43
- **Current terminology**: Official docs now call both "skills" in the UI
- **No deprecation**: `commands/` still fully supported, not scheduled for removal per available docs

### Q4: Claude Code docs at docs.anthropic.com

**Answer**: The Skills page is at `https://docs.anthropic.com/en/docs/claude-code/skills`. Key quote about the merge is at the very top of the page. The Plugins Reference at `https://docs.anthropic.com/en/docs/claude-code/plugins-reference` lists both `skills/` and `commands/` as valid plugin directory locations.

### Q5: GitHub discussions about this topic

**Answer**: Many GitHub issues exist on `anthropics/claude-code` about this topic. Most are bugs caused by user confusion about the two formats coexisting. The issues consistently show users expecting symmetry between `commands/` and `skills/` that doesn't fully exist (flat `.md` files don't work in `skills/`; skills' directory structure doesn't work in `commands/`). No GitHub discussion announces deprecation of either format.

---

## Implications for the Magus Plugin System

Based on these findings, the Magus plugin architecture (having both `commands/` and `skills/` arrays in `plugin.json`) is **correct and intentional**:

- `commands/*.md` — explicit, user-invokable workflow entry points (e.g., `/dev:dev`, `/dev:debug`)
- `skills/*/SKILL.md` — contextual knowledge that Claude can auto-load (e.g., react-typescript patterns, golang patterns)

This dual-array approach aligns with how Anthropic designed the plugin system. The separation is meaningful:
- Commands in Magus plugins use `disable-model-invocation` behavior (they're workflow triggers)
- Skills in Magus plugins use auto-loading behavior (they're contextual knowledge)

The frontmatter in Magus command files confirms this: commands like `dev.md` have their own `skills:` frontmatter field that declares which skills to auto-load when that command runs, showing the two systems are composable.

---

## Knowledge Gaps

1. **Exact date of v2.0.20 release**: The changelog doesn't include dates for most entries. Could not determine precisely when Skills were introduced. The sequence (2.0.12 plugins, 2.0.17 Haiku 4.5, 2.0.20 skills) suggests late 2025.

2. **"Agent Skills" open standard details**: The docs reference an "Agent Skills open standard" but no separate documentation or specification URL was found. Whether this is an Anthropic-created standard or an external standard they adopted is unclear.

3. **Future of commands/ format**: No official announcement about whether `commands/` will eventually be deprecated entirely. The docs say it "still works" but don't give a timeline.

4. **Skill invocation in non-interactive mode**: How skills are invoked in headless (`-p`) mode vs. interactive mode was not fully researched.

---

## Search Limitations

- Web search: Available (curl to docs.anthropic.com and GitHub raw content)
- GitHub API: Available via gh CLI
- Local search: Performed on Magus codebase
- Date range: All current as of 2026-03-28/29
- No access to Anthropic's internal Slack or private announcements
