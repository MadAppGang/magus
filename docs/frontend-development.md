# Frontend Development Plugin

> **Comprehensive toolkit for professional TypeScript/React development**

Version: 1.0.0
Category: Development
Author: Jack Rudenko @ MadAppGang

---

## Overview

The Frontend Development plugin is a complete solution for building modern web applications with TypeScript, React, Vite, TanStack Router, and TanStack Query. It provides an orchestrated workflow that combines specialized AI agents, powerful commands, and intelligent skills to deliver production-ready code with minimal manual intervention.

**Perfect for:**
- React/TypeScript projects
- TanStack ecosystem (Router, Query)
- Frontend teams requiring consistent code quality
- Projects with Figma designs
- API-driven applications

---

## The `/implement` Command: Full-Cycle Orchestration

The `/implement` command is the cornerstone of this plugin. It orchestrates a complete feature development workflow from planning to delivery, ensuring quality at every step.

### What Makes `/implement` Special

`/implement` is not just a code generator—it's a complete development workflow that:

1. **Plans before coding** - Architecture-first approach with user approval gates
2. **Implements with quality** - Following project patterns and best practices
3. **Reviews thoroughly** - Triple review process (human + AI + browser testing)
4. **Tests comprehensively** - Automated test generation with Vitest
5. **Cleans automatically** - Removes temporary artifacts

### The Complete `/implement` Workflow

```bash
/implement Create a user profile page with avatar upload, bio editing, and settings panel
```

This single command triggers a 7-stage orchestration:

#### Stage 1: Architecture Planning

**Agent:** `frontend-architect-planner`

**What happens:**
1. **Gap Analysis**
   - Scans existing codebase patterns
   - Identifies reusable components
   - Finds similar implementations
   - Reviews project architecture

2. **Clarification Questions**
   - Asks about specific requirements
   - Confirms technical decisions
   - Validates assumptions
   - Gathers constraints

3. **Architecture Design**
   - Designs component hierarchy
   - Plans state management approach
   - Defines API integration strategy
   - Considers accessibility and performance

4. **Documentation**
   - Creates detailed plan in `AI-DOCS/`
   - Documents component structure
   - Lists implementation steps
   - Includes code examples

5. **User Approval Gate** ⛔
   - Presents plan for review
   - Explains architectural decisions
   - Waits for explicit approval
   - **No code written until approved**

**Example Output:**
```
Architecture Plan: User Profile Feature
────────────────────────────────────────
Components:
  - ProfilePage (container)
  - ProfileHeader (avatar + basic info)
  - AvatarUpload (drag-drop + preview)
  - BioEditor (rich text editing)
  - SettingsPanel (preferences form)

State Management:
  - TanStack Query for user data
  - Local state for form inputs
  - Optimistic updates for bio changes

API Integration:
  - GET /users/:id
  - PATCH /users/:id/profile
  - POST /users/:id/avatar

Plan saved to: AI-DOCS/user-profile-feature.md

👤 Review the plan and type 'approved' to proceed
```

---

#### Stage 2: Implementation

**Agent:** `typescript-frontend-dev`

**What happens:**
1. **Todo List Creation**
   - Breaks plan into specific tasks
   - Creates visible progress tracker
   - User can see exactly what's being built

2. **Code Generation**
   - Follows project patterns (file structure, naming conventions)
   - Uses existing components and utilities
   - Implements TypeScript types correctly
   - Follows React best practices
   - Integrates with TanStack Router and Query

3. **Quality Checks (Automated)**
   - Runs Biome linter/formatter
   - Validates TypeScript compilation
   - Checks for common mistakes
   - Ensures code style consistency

4. **Progress Updates**
   - Marks todos as completed in real-time
   - Shows what's being worked on
   - Reports any issues immediately

**Example Output:**
```
Implementation Progress
────────────────────────────────────────
✅ Create ProfilePage container component
✅ Implement AvatarUpload with preview
✅ Add BioEditor with form validation
✅ Build SettingsPanel with preferences
✅ Integrate TanStack Query hooks
✅ Add route configuration
⏳ Running quality checks...
✅ Biome: No issues found
✅ TypeScript: Compilation successful
✅ All checks passed!

Implementation complete. Ready for review.
```

---

#### Stage 3: Triple Review Process

The `/implement` workflow includes three distinct review stages to catch different types of issues:

##### Review 3.1: Senior Code Review

**Agent:** `senior-code-reviewer`

**What happens:**
- **Code Quality Analysis**
  - Architectural patterns
  - TypeScript best practices
  - React patterns and hooks usage
  - Performance considerations
  - Error handling
  - Accessibility compliance

- **Security Review**
  - XSS vulnerabilities
  - Data validation
  - Authorization checks
  - Secure API calls

- **Maintainability**
  - Code clarity and documentation
  - Component reusability
  - Test coverage gaps
  - Technical debt

**Output:**
```
Code Review Report
────────────────────────────────────────
✅ Architecture: Follows project patterns
✅ TypeScript: Proper typing, no any usage
⚠️  Performance: Consider memoizing UserList
✅ Accessibility: ARIA labels present
⚠️  Testing: Missing edge case tests
✅ Security: Input validation correct

Suggestions:
1. Add React.memo to UserListItem (line 45)
2. Add error boundary around AvatarUpload
3. Test file upload size limits

Overall: 8/10 - Ready with minor improvements
```

##### Review 3.2: Automated AI Review (Codex)

**Agent:** `senior-code-reviewer-codex`

**What happens:**
- Runs Codex AI analyzer
- Detects code smells
- Finds potential bugs
- Suggests optimizations
- Checks against best practices database

**Output:**
```
Codex Analysis Report
────────────────────────────────────────
Files Analyzed: 8
Issues Found: 3 low, 0 critical

Low Priority:
- ProfileHeader.tsx:23 - Consider extracting magic number to constant
- AvatarUpload.tsx:67 - Add loading state for upload
- useUserProfile.ts:12 - Consider adding retry logic

Auto-fixable: 1
Manual review: 2
```

##### Review 3.3: Browser UI Testing

**Agent:** `ui-manual-tester`

**What happens:**
1. **Launches Chrome DevTools Protocol**
   - Opens your application in Chrome
   - Navigates to the new feature
   - Monitors console and network

2. **Interactive Testing**
   - Tests all user interactions
   - Validates form submissions
   - Checks error states
   - Verifies loading states
   - Tests responsive behavior

3. **Console Monitoring**
   - Catches JavaScript errors
   - Identifies warnings
   - Monitors network requests
   - Checks performance metrics

4. **Visual Verification**
   - Takes screenshots
   - Compares with Figma designs (if available)
   - Checks layout and spacing
   - Validates responsive breakpoints

**Output:**
```
Browser Testing Report
────────────────────────────────────────
Test URL: http://localhost:5173/profile
Browser: Chrome 120.0

✅ Page loads successfully (1.2s)
✅ Avatar upload works correctly
✅ Bio editor saves changes
⚠️  Console warning: "Deprecated prop in SettingsPanel"
✅ Network requests successful
✅ No JavaScript errors
✅ Responsive layout works (tested 3 breakpoints)

Screenshots saved to: AI-DOCS/screenshots/

Issues to address:
1. Deprecation warning in SettingsPanel (line 34)
2. Avatar upload could show progress indicator

Overall: Feature works correctly with minor polish needed
```

---

#### Stage 4: Test Generation

**Agent:** `vitest-test-architect`

**What happens:**
1. **Test Strategy Design**
   - Analyzes implemented code
   - Identifies testable scenarios
   - Plans unit, integration, and E2E tests
   - Prioritizes critical paths

2. **Test Implementation**
   - Generates Vitest unit tests
   - Creates React Testing Library tests
   - Adds integration tests for API calls
   - Includes edge cases and error scenarios

3. **Test Execution**
   - Runs all tests
   - Verifies coverage
   - Reports failures
   - Suggests improvements

**Example Output:**
```
Test Generation Report
────────────────────────────────────────
Tests Created:
  - ProfilePage.test.tsx (8 tests)
  - AvatarUpload.test.tsx (12 tests)
  - BioEditor.test.tsx (6 tests)
  - SettingsPanel.test.tsx (10 tests)
  - useUserProfile.test.ts (5 tests)

Test Execution:
✅ 41/41 tests passed
✅ Coverage: 94% (target: 80%)
✅ All edge cases covered
✅ Error scenarios tested

Test run completed successfully
```

---

#### Stage 5: User Final Approval

**What happens:**
- Summary of all work completed
- Review reports presented
- Test results shared
- User given final approval gate

**Output:**
```
Implementation Summary
────────────────────────────────────────
✅ Architecture planned and approved
✅ Feature implemented (8 components)
✅ Code reviewed (3 review stages)
✅ Tests created (41 tests, 94% coverage)
✅ Browser testing passed

Files changed: 12
Lines added: 847
Quality score: 8.5/10

Review all changes? Type 'approved' to proceed with cleanup
```

---

#### Stage 6: Project Cleanup

**Agent:** `project-cleaner`

**What happens:**
- Removes temporary files
- Cleans up debug artifacts
- Organizes AI-DOCS folder
- Removes unused imports
- Cleans up console.log statements

**Output:**
```
Cleanup Report
────────────────────────────────────────
Removed:
  - 3 temporary screenshot files
  - 2 debug log files
  - 1 unused component stub

Organized:
  - AI-DOCS/user-profile-feature.md
  - AI-DOCS/screenshots/ (archived)

Project cleaned successfully
```

---

#### Stage 7: Final Delivery

**Output:**
```
🎉 Feature Implementation Complete!
────────────────────────────────────────

Created:
  📁 src/features/profile/
    ├── ProfilePage.tsx
    ├── ProfileHeader.tsx
    ├── AvatarUpload.tsx
    ├── BioEditor.tsx
    ├── SettingsPanel.tsx
    └── useUserProfile.ts
  📁 src/features/profile/__tests__/
    └── (41 test files)

Documentation:
  📄 AI-DOCS/user-profile-feature.md

Quality Metrics:
  - Code Review: 8/10
  - Test Coverage: 94%
  - Browser Tests: Passed
  - Zero TypeScript errors
  - Zero console errors

Ready to commit:
  git add src/features/profile
  git commit -m "Add user profile feature"
```

---

## Why This Workflow Works

### 1. Architecture-First Approach
- Plan before coding prevents costly rewrites
- User approval ensures alignment with expectations
- Documentation captures decisions for future reference

### 2. Quality at Every Step
- Automated checks catch common mistakes immediately
- Triple review catches different issue types
- Browser testing validates real-world functionality

### 3. Comprehensive Testing
- Tests generated automatically, not as afterthought
- High coverage ensures confidence
- Edge cases and errors handled

### 4. Clean Delivery
- No temporary files left behind
- Documentation organized
- Project ready for team review

---

## Other Components

### Agents (8 Total)

#### `typescript-frontend-dev`
Expert TypeScript/React developer for implementation tasks.

**When to use:**
- Implementing new features
- Refactoring existing code
- Fixing bugs
- Adding new components

**Tools:** All development tools
**Model:** Sonnet (complex reasoning)

---

#### `frontend-architect-planner`
System design and architecture planning specialist.

**When to use:**
- Starting new features
- Planning large refactors
- Designing system architecture
- Technical decision making

**Tools:** Read, Grep, Glob, Task
**Model:** Sonnet (strategic thinking)

---

#### `ui-manual-tester`
Browser-based testing with Chrome DevTools Protocol.

**When to use:**
- Testing UI interactions
- Debugging console errors
- Validating network requests
- Visual regression testing

**Tools:** Bash, Read, Write, BashOutput
**Model:** Haiku (fast testing)

---

#### `vitest-test-architect`
Comprehensive testing strategy and implementation.

**When to use:**
- Creating test suites
- Improving test coverage
- Planning testing strategy
- Debugging failing tests

**Tools:** All testing tools
**Model:** Sonnet (test design)

---

#### `api-documentation-analyzer`
API documentation analysis and client generation.

**When to use:**
- Integrating new APIs
- Analyzing OpenAPI specs
- Generating API clients
- Understanding API contracts

**Tools:** WebFetch, Read, Context7
**Model:** Haiku (document analysis)

---

#### `project-cleaner`
Cleanup utilities for development artifacts.

**When to use:**
- After feature implementation
- Cleaning temporary files
- Organizing documentation
- Preparing for commits

**Tools:** Bash, Glob, Edit
**Model:** Haiku (simple operations)

---

#### `senior-code-reviewer`
Comprehensive manual code review.

**When to use:**
- Before merging features
- Reviewing pull requests
- Architecture validation
- Quality assessment

**Tools:** Read, Grep, Glob
**Model:** Sonnet (deep analysis)

---

#### `senior-code-reviewer-codex`
Automated AI-powered code review.

**When to use:**
- Quick automated analysis
- Finding code smells
- Security scanning
- Best practices validation

**Tools:** Bash, Read, Grep
**Model:** Haiku (fast analysis)

---

### Slash Commands (5 Total)

#### `/implement [description]`
Full-cycle feature implementation orchestrator (documented above).

**Example:**
```bash
/implement Add user authentication with email/password and social login
```

---

#### `/import-figma [component-name]`
Import Figma components into your React project.

**What it does:**
1. Fetches component from Figma via MCP
2. Adapts code to your project structure
3. Installs dependencies
4. Creates test route
5. Opens in browser for validation
6. Generates CLAUDE.md documentation

**Example:**
```bash
/import-figma NavigationBar
```

**Output:**
```
Figma Import Complete
────────────────────────────────────────
✅ Component imported from Figma
✅ Code adapted to project structure
✅ Dependencies installed
✅ Test route created: /test/navigation-bar
✅ Browser opened for validation
✅ Documentation created

Files:
  - src/components/NavigationBar.tsx
  - src/components/CLAUDE.md
```

---

#### `/configure-mcp [server-name]`
Smart interactive MCP server configuration.

**Supported servers:**
- `apidog` - API documentation and testing
- `figma` - Figma design integration
- `github` - GitHub API integration

**What it does:**
1. Checks if already configured
2. Validates existing credentials
3. Collects required information
4. Writes to `.claude/settings.json`
5. Tests connection
6. Offers reconfiguration if invalid

**Example:**
```bash
/configure-mcp apidog
```

**Smart behavior:**
```
Already configured ✅
  Project ID: 123456
  Last tested: Success (2 minutes ago)

  [1] Keep current config
  [2] Reconfigure
  [3] Test connection again
```

---

#### `/api-docs [url]`
Analyze and work with API documentation.

**What it does:**
1. Fetches API documentation
2. Analyzes endpoints and schemas
3. Generates TypeScript types
4. Creates API client code
5. Adds to your project

**Example:**
```bash
/api-docs https://api.example.com/docs/openapi.json
```

---

#### `/cleanup-artifacts`
Clean temporary development artifacts.

**What it does:**
- Removes temporary screenshots
- Cleans debug files
- Organizes AI-DOCS
- Removes console.log statements
- Cleans unused imports

**Example:**
```bash
/cleanup-artifacts
```

---

### Skills (2 Total)

#### `browser-debugger`
Systematic UI testing and debugging using Chrome DevTools.

**Automatically invoked when:**
- Implementing UI features
- User reports console errors
- Testing form interactions
- Validating user flows

**What it does:**
1. Launches Chrome with DevTools Protocol
2. Navigates to your app
3. Tests interactions
4. Monitors console and network
5. Reports issues with reproduction steps

---

#### `api-spec-analyzer`
Analyze OpenAPI/Swagger specifications.

**Automatically invoked when:**
- Working with API specifications
- User mentions OpenAPI/Swagger
- Generating API clients
- Analyzing API contracts

**What it does:**
1. Parses OpenAPI/Swagger specs
2. Analyzes endpoints and schemas
3. Generates TypeScript types
4. Creates API client code
5. Validates contracts

---

### MCP Servers (4 Total)

#### Apidog Integration
Connect to Apidog for API documentation and testing.

**Required:**
- `APIDOG_PROJECT_ID` - In `.claude/settings.json`
- `APIDOG_API_TOKEN` - In `.env` (private)

**Setup:**
```bash
/configure-mcp apidog
```

---

#### Figma Integration
Import designs and components from Figma.

**Required:**
- `FIGMA_ACCESS_TOKEN` - In `.env` (private)

**Setup:**
```bash
/configure-mcp figma
```

---

#### GitHub Integration
Access GitHub repositories and issues.

**Required:**
- `GITHUB_PERSONAL_ACCESS_TOKEN` - In `.env` (private)

**Setup:**
```bash
/configure-mcp github
```

---

## Installation

### Prerequisites
- Node.js v18+ (with npm/npx)
- Chrome browser
- Git

### Global Installation
```bash
/plugin marketplace add madappgang/claude-plugins
/plugin install frontend-development@mag-claude-plugins
```

### Project-Specific Installation
Add to `.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": {
    "mag-claude-plugins": {
      "source": {
        "source": "github",
        "repo": "MadAppGang/claude-code"
      }
    }
  },
  "enabledPlugins": {
    "frontend-development@mag-claude-plugins": true
  }
}
```

---

## Environment Setup

Create `.env` file:
```bash
# Required for Apidog
APIDOG_API_TOKEN=your-personal-token

# Required for Figma
FIGMA_ACCESS_TOKEN=your-personal-token

# Optional
GITHUB_PERSONAL_ACCESS_TOKEN=your-token
CHROME_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
CODEX_API_KEY=your-codex-key
```

---

## Best Practices

### When to Use `/implement`
✅ **Good for:**
- New features with clear requirements
- Features requiring multiple components
- Projects with established patterns
- When you want comprehensive quality checks

❌ **Not ideal for:**
- Quick bug fixes (use agents directly)
- Experimental prototypes
- Simple one-file changes

### Maximizing Quality
1. **Provide clear descriptions** - Detailed requirements = better architecture
2. **Review the plan** - Catch issues before implementation
3. **Check review reports** - Learn from suggestions
4. **Run tests** - Ensure nothing breaks

### Team Workflow
1. **Use project-specific installation** - Consistent setup
2. **Commit `.claude/settings.json`** - Share configuration
3. **Keep `.env` private** - Never commit secrets
4. **Share AI-DOCS** - Team knowledge base

---

## Troubleshooting

### MCP Servers Not Working
```bash
# Check if configured
/configure-mcp apidog

# Validate connection
/configure-mcp apidog
# Choose option [3] Test again
```

### Browser Testing Fails
```bash
# Set Chrome path in .env
CHROME_EXECUTABLE_PATH=/path/to/chrome
```

### Tests Not Generating
Ensure Vitest is installed:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
```

---

## Support

- **Documentation:** [Main README](../README.md)
- **Issues:** [GitHub Issues](https://github.com/madappgang/claude-plugins/issues)
- **Email:** i@madappgang.com
- **Dependencies:** [DEPENDENCIES.md](../.claude-plugin/plugins/frontend-development/DEPENDENCIES.md)

---

**Plugin Version:** 1.0.0
**Last Updated:** November 2024
**Maintained by:** Jack Rudenko @ MadAppGang
