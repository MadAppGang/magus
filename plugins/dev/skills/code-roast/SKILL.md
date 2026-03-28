---
name: code-roast
description: code-roast — Roast code with severity-graded sins, cite file:line, offer redemption. Use when user says "roast", "find sins", "code quality roast", "shame my code", "roast this", "code sins", "what's wrong with this code" (humorous tone). This is a SKILL (use Skill tool), NOT an agent.
version: 1.0.0
tags: [dev, quality, roast, humor, code-review, sins, anti-patterns]
keywords: [roast, sins, shame, code-quality, anti-patterns, code-review, humor, savage]
plugin: dev
updated: 2026-03-03
user-invocable: false
---

# Code Roast Skill

## Overview

The Code Roast skill performs a **humorous but technically rigorous code quality analysis** using a registry of 192 anti-patterns across 8 languages plus universal categories.

**Core Rules**:
1. **Cite `file:line`** — every sin gets a precise location
2. **Punch the code, not the coder** — humor targets the artifact, never the author
3. **Every roast has a fix** — no ridicule without redemption
4. **Severity-sorted** — CAPITAL offenses first, parking tickets last
5. **Three-tier detection** — built-in grep always works; CLI tools and cloud APIs are optional bonuses

**What it covers**: Go, Java, C#, TypeScript/JavaScript, Python, React, HTML/CSS, SQL, universal patterns (SOLID, microservices, testing, CI/CD, dependencies, concurrency), and AI-generated code ("slop") detection.

---

## Phase 0: Load References

Before starting, read the companion files for this skill:

1. **Read `sin-registry.md`** — but ONLY the sections relevant to the detected languages in the target code. Do NOT read all 192 patterns if the project is Go-only.
2. **Read `detection-patterns.md`** — focus on Tier 1 patterns for detected languages, then check Tier 2 tool availability.

**Language detection**: Look at file extensions in the target scope to determine which language sections to load.

---

## Phase 1: Acquire Target

Determine what code to roast. In priority order:

1. **User specified files/dirs** — if the user said "roast src/auth/", use that
2. **Git diff** — if the user said "roast my changes" or "roast this PR", use `git diff` or `git diff main...HEAD`
3. **Recent changes** — `git diff HEAD~5` for recent work
4. **Full project scan** — if the user said "roast everything" or "roast the codebase"

For large scopes (>50 files), ask the user to narrow down:

```
Use AskUserQuestion:
  "This codebase has {N} files. Want me to roast everything or focus on a specific area?"
  Options: "Full scan", "Changed files only (git diff)", "Specific directory"
```

**Output**: List of target files with language breakdown.

---

## Phase 2: Opening Salvo

Before the detailed analysis, deliver 2-3 **personalized devastating observations** based on a quick scan. These set the tone and show you've actually looked at the code.

**How to generate**:
1. Run a quick scan: file count, line count, language mix, dependency count
2. Look for the most egregious pattern visible at a glance
3. Check for obvious structural issues (god files >500 lines, deeply nested dirs, etc.)

**Format**:

```
## Opening Salvo

I've looked at your code. I have... opinions.

- [Observation 1 about the worst thing you noticed immediately]
- [Observation 2 about a structural issue]
- [Optional observation 3 if something truly egregious stands out]

Let's see what the sin registry has to say.
```

**Tone calibration**: Match the tone level (see Tone Calibration section below). Default is MEDIUM.

---

## Phase 3: Sin Inventory

This is the main detection phase. Execute the three-tier detection pipeline from `detection-patterns.md`.

### Detection Execution Order

**Step 1: Tier 1 — Built-in Grep Detection (ALWAYS)**

Run Grep patterns from `detection-patterns.md` Tier 1 section for the detected languages. Start with CAPITAL patterns, then FELONY, then CRIME.

For each match:
- Record file:line
- Look up the pattern ID in `sin-registry.md`
- Get the roast line and fix hint

**Step 2: Tier 2 — CLI Tool Detection (IF AVAILABLE)**

Check which Tier 2 tools are installed using Bash:
```bash
which golangci-lint eslint ruff semgrep stylelint 2>/dev/null
```

For each available tool, run it with JSON output. Parse results and map tool rule IDs to sin-registry entries.

**DO NOT**:
- Ask the user to install tools
- Fail if tools are missing
- Spend more than 30 seconds on any single tool

**Step 3: Tier 3 — Cloud API Detection (IF KEYS PRESENT)**

Check for cloud service env vars. Only mention these if they would add significant value:
```bash
echo "${SONAR_TOKEN:+sonar}" "${SNYK_TOKEN:+snyk}" "${GITHUB_TOKEN:+gh-scanning}"
```

If available, query the relevant API. If not, skip silently.

### Sin Inventory Output Format

Group findings by severity, then by file:

```
## Sin Inventory

### CAPITAL OFFENSES (fix NOW)

**{ID}: {Name}** — `{file}:{line}`
> {Roast line from sin-registry}
> **Fix**: {Fix hint}

**{ID}: {Name}** — `{file}:{line}`
> {Roast line}
> **Fix**: {Fix hint}

### FELONIES (fix today)

...

### CRIMES (fix this sprint)

...

### MISDEMEANORS (fix when touched)

...

### PARKING TICKETS (noted)

...

### AI SLOP DETECTED (review and rewrite)

...
```

**Summary line** at the end:
```
**Sin Count**: {N} total — {capital} CAPITAL, {felony} FELONY, {crime} CRIME, {misdemeanor} MISDEMEANOR, {ticket} PARKING TICKET, {slop} SLOP
```

If no sins found, see Recovery Table below.

---

## Phase 4: Autopsy of Worst Offender

Pick the single worst sin (highest severity, most impactful) and do a surgical breakdown:

```
## Autopsy: {Sin Name}

**Location**: `{file}:{line_start}-{line_end}`
**Severity**: {SEVERITY}
**Detected by**: {detection method}

### The Code

{Show the actual offending code snippet, 5-15 lines}

### Why This Is Bad

{2-3 sentences explaining the actual technical impact. Be specific:
memory leak rate, deadlock conditions, security exposure, performance cost.}

### The Roast

{Extended roast — 2-3 sentences, more creative than the one-liner from the registry.
Build on the registry's roast but make it specific to THIS code.}

### The Fix

{Show the corrected code. Same snippet but fixed.}
```

---

## Phase 5: Redemption Menu — STOP AND WAIT

**CRITICAL**: After presenting the sin inventory and autopsy, you MUST stop and ask the user what they want to fix.

Do NOT automatically start fixing code. The user chooses.

```
Use AskUserQuestion:
  question: "Which sins do you want me to fix?"
  options:
    - "Fix all CAPITAL + FELONY sins (Recommended)"
      description: "Fix the {N} most critical issues that could cause crashes, data loss, or security breaches"
    - "Fix everything"
      description: "Fix all {total} sins across all severity levels"
    - "Let me pick specific ones"
      description: "I'll tell you which specific sins to address"
    - "Just the report, thanks"
      description: "Keep the analysis but don't change any code"
```

If the user picks "Let me pick specific ones", ask them to specify sin IDs or severity levels.

---

## Phase 6: Resurrection

Execute the fixes the user selected. For each fix:

1. Read the current code at the sin's file:line
2. Apply the fix from sin-registry's fix hint
3. Show before/after diff

**Format**:

```
## Resurrection

### Fixed: {ID} {Sin Name} — `{file}:{line}`

**Before**:
{old code}

**After**:
{new code}

---
```

After all fixes:

```
## Resurrection Complete

**Fixed**: {N} sins across {M} files
**Remaining**: {R} sins (user chose not to fix)
**New sin count**: {total - N}
```

If the project went from many sins to few, add a redemption message matching the tone level.

---

## Tone Calibration

Default tone is **MEDIUM**. The user can request a different tone by saying things like "be gentle", "go savage", "nuclear mode", or "be nice about it".

### Tone Levels

| Level | When | Opening Style | Roast Intensity | Fix Presentation |
|-------|------|---------------|-----------------|------------------|
| **GENTLE** | User says "be nice", "gentle", beginner code | Encouraging with observations | Mild observations, no burns | "Here's a more idiomatic approach..." |
| **MEDIUM** | Default; peer review tone | Direct, witty, professional | Registry roast lines as-is | "Fix: {hint}" |
| **SAVAGE** | User says "savage", "don't hold back", "roast hard" | Devastating opening | Extended roasts, callbacks to previous sins | "You have 48 hours to fix this before I tell your DBA" |
| **NUCLEAR** | User explicitly says "nuclear" | Scorched earth | Full creative mode, absurdist escalation | "The only fix is `git rm -rf` and starting over. I'm kidding. Mostly." |

### Tone Examples

**GENTLE** (same sin):
> "I notice this function might benefit from error handling — here's a more robust approach."

**MEDIUM**:
> "Congratulations, you've invented Schrodinger's File — it's both open and corrupted until production explodes."

**SAVAGE**:
> "Congratulations, you've invented Schrodinger's File — it's both open and corrupted until production explodes. I counted 14 of these in your codebase. Your error handling strategy is 'hope.'"

**NUCLEAR**:
> "I found 14 ignored errors in your codebase. Your error handling strategy makes YOLO look conservative. Your production server is running on prayers and the structural integrity of whatever intern wrote the happy path. I've seen better error handling in bash scripts that start with `set -e` — which, by the way, yours doesn't."

---

## Output Templates

### Summary Header (always shown)

```
# Code Roast Report

**Target**: {scope description}
**Files scanned**: {N}
**Languages**: {list}
**Tone**: {GENTLE|MEDIUM|SAVAGE|NUCLEAR}
**Detection**: Tier 1 (grep){+ Tier 2 (CLI tools)}{+ Tier 3 (cloud)}
```

### No Sins Found (rare but possible)

```
# Code Roast Report

I've scanned {N} files across {languages} and...

I have nothing. Your code is clean. This is either genuinely excellent engineering
or you've hidden the bodies very well.

**Recommendation**: Run the full tool suite (Tier 2) for deeper analysis.
The grep patterns catch the obvious sins, but some need AST analysis to detect.
```

### Tool Availability Note (when Tier 2 tools are missing)

```
**Note**: Some patterns are best detected by specialized tools.
Consider installing for deeper analysis:
- `golangci-lint` (Go) — catches {N} additional patterns
- `ruff` (Python) — catches {N} additional patterns
- `eslint` (TS/JS) — catches {N} additional patterns
These are optional and free. The roast is complete without them.
```

---

## Recovery Table

| Situation | Action |
|-----------|--------|
| No sins found | Congratulate genuinely; suggest Tier 2 tools for deeper scan |
| All tools missing (Tier 2) | Tier 1 grep patterns still work; note tool recommendations |
| Target too large (>200 files) | Ask user to narrow scope |
| Language not in registry | Use universal patterns (UNI-*) + SLOP patterns; note coverage gap |
| User says "stop" mid-roast | Stop immediately; show what you have so far |
| Sin is a false positive | Acknowledge and skip; explain why the pattern matched but isn't a real issue |
| User disagrees with severity | Respect their judgment; they know their codebase constraints |
| Mixed-language project | Load relevant sections for each detected language |

---

## Cultural Guidelines

**DO**:
- Direct humor at code artifacts, never the author
- Explain WHY each sin is bad (educational value is mandatory)
- Always provide the fix or better pattern
- Cite specific file:line for every finding
- Respect the user's tone preference

**DON'T**:
- Say "who wrote this?" or "what were they thinking?"
- Use gendered language
- Use ableist comparisons
- Make personal attacks on intelligence or worth
- Roast without offering the fix — pure ridicule creates chilling effects
- Assume malice — most sins come from time pressure or unfamiliarity
