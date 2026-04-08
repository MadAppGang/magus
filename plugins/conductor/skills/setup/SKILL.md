---
name: setup
description: "Initializes the Conductor project orchestration system by guiding the user through interactive Q&A to create product.md, tech-stack.md, workflow.md, and code style guides. Use when the user asks to set up Conductor, initialize a new project workspace, bootstrap project configuration, or start a new development environment."
version: 1.1.0
tags: [conductor, setup, initialization, context, project]
user-invocable: false
---

## Critical Constraints

- **Task tracking**: Use Tasks to track setup progress through all phases
- **Sequential questions**: Ask one question at a time; wait for the answer before continuing
- **Maximum 5 questions per section**; always include a "Type your own answer" option
- **Save state after each answer** to `conductor/setup_state.json` for resume capability

### Resume Capability

Check for `conductor/setup_state.json` **before starting**. If it exists with `status != "complete"`:

1. Load saved answers
2. Resume from last incomplete section
3. Show user what was already collected

### Pre-flight Validation

1. Check if `conductor/` directory already exists
2. If a complete setup exists, ask: "Re-initialize or abort?"
3. Respect `.gitignore` patterns

## Workflow

### Phase 1: Validation

1. Check if `conductor/` directory exists
2. If exists, check `setup_state.json` for resume
3. If complete setup exists, confirm re-initialization
4. Initialize Tasks with setup phases

### Phase 2: Project Type Detection

1. Check for existing code files (`src/`, `package.json`, etc.)
2. Ask user: new project or existing codebase?
3. For existing projects: scan existing code for context

### Phase 3: Product Context

1. Ask: What is this project about? (1-2 sentences)
2. Ask: Who is the target audience?
3. Ask: What are the 3 main goals?
4. Ask: Any constraints or requirements?
5. Generate `conductor/product.md` from answers

### Phase 4: Technical Context

1. Ask: Primary programming language(s)?
2. Ask: Key frameworks/libraries?
3. Ask: Database/storage preferences?
4. Ask: Deployment target?
5. Generate `conductor/tech-stack.md` from answers

### Phase 5: Guidelines

1. Ask: Any specific coding conventions?
2. Ask: Testing requirements?
3. Generate `conductor/product-guidelines.md`
4. Generate `conductor/code_styleguides/general.md` (always)
5. Generate language-specific styleguides based on tech stack:
   - TypeScript/JavaScript: `typescript.md`, `javascript.md`
   - Web projects: `html-css.md`
   - Python: `python.md`
   - Go: `go.md`

### Phase 6: Finalization

1. Copy `workflow.md` template
2. Create empty `tracks.md`
3. Mark `setup_state.json` as complete
4. Present summary to user

## Artifact Validation

After generating each artifact, verify it contains the required sections:

- **product.md**: Must include `## Overview`, `## Target Audience`, `## Goals`, `## Constraints`
- **tech-stack.md**: Must include `## Languages`, `## Frameworks`, `## Storage`, `## Deployment`
- **product-guidelines.md**: Must include `## Coding Conventions`, `## Testing Requirements`

If any section is missing, re-prompt the user for the missing information before writing the file.

## Artifact Templates

### product.md

```markdown
# {Project Name}

## Overview
{1-2 sentence description from user}

## Target Audience
{audience answer}

## Goals
1. {goal 1}
2. {goal 2}
3. {goal 3}

## Constraints
{constraints or "None specified"}
```

### tech-stack.md

```markdown
# Tech Stack

## Languages
- {primary language}

## Frameworks
- {framework list}

## Storage
- {database/storage choice or "TBD"}

## Deployment
- {deployment target or "TBD"}
```

## State File Schema

```json
{
  "status": "in_progress | complete",
  "startedAt": "ISO-8601",
  "lastUpdated": "ISO-8601",
  "projectType": "greenfield | brownfield",
  "currentSection": "product | tech | guidelines",
  "answers": {
    "product": {
      "description": "...",
      "audience": "...",
      "goals": ["...", "...", "..."]
    },
    "tech": {
      "languages": ["TypeScript"],
      "frameworks": ["React", "Node.js"]
    }
  }
}
```

## Examples

**New Project Setup**: User says "I want to set up Conductor for my new project"

1. Check for existing `conductor/` — not found
2. Ask: "Is this a new project or an existing codebase?"
3. User: "New project"
4. Begin product context questions (one at a time)
5. Save each answer to `setup_state.json`
6. After all sections, generate artifacts and validate required sections
7. Present summary with next steps

**Resume Interrupted Setup**: User says "Continue setting up Conductor"

1. Check `conductor/setup_state.json` — found, status: `in_progress`
2. Load previous answers from state
3. Show: "Resuming setup. You've completed: Product Context"
4. Continue from Technical Context section
5. Complete remaining sections

## Completion Template

```
## Conductor Setup Complete

**Project:** {project_name}
**Type:** {Greenfield/Brownfield}

**Created Artifacts:**
- conductor/product.md - Project vision and goals
- conductor/product-guidelines.md - Standards and conventions
- conductor/tech-stack.md - Technical preferences
- conductor/workflow.md - Development workflow
- conductor/tracks.md - Track index (empty)
- conductor/code_styleguides/general.md - General coding principles
- conductor/code_styleguides/{language}.md - Language-specific guides

**Next Steps:**
1. Review generated artifacts and adjust as needed
2. Use `conductor:new-track` to plan your first feature
3. Use `conductor:implement` to execute the plan
```
