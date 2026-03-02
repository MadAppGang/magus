---
name: deep-analysis
description: "⚡ PRIMARY SKILL for: 'how does X work', 'investigate', 'analyze architecture', 'trace flow', 'find implementations'. PREREQUISITE: code-search-selector must validate tool choice. Launches codebase-detective with claudemem INDEXED MEMORY."
allowed-tools: Task
prerequisites:
  - code-search-selector  # Must run before this skill
dependencies:
  - claudemem must be indexed (claudemem status)
---

# Deep Code Analysis

This Skill provides comprehensive codebase investigation capabilities using the codebase-detective agent with semantic search and pattern matching.

## Prerequisites (MANDATORY)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                        BEFORE INVOKING THIS SKILL                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  1. INVOKE code-search-selector skill FIRST                                  ║
║     → Validates tool selection (claudemem vs grep)                           ║
║     → Checks if claudemem is indexed                                         ║
║     → Prevents tool familiarity bias                                         ║
║                                                                              ║
║  2. VERIFY claudemem status                                                  ║
║     → Run: claudemem status                                                  ║
║     → If not indexed: claudemem index -y                                     ║
║                                                                              ║
║  3. DO NOT start with Read/Glob                                              ║
║     → Even if file paths are mentioned in the prompt                         ║
║     → Semantic search first, Read specific lines after                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## When to use this Skill

Claude should invoke this Skill when:

- User asks "how does [feature] work?"
- User wants to understand code architecture or patterns
- User is debugging and needs to trace code flow
- User asks "where is [functionality] implemented?"
- User needs to find all usages of a component/service
- User wants to understand dependencies between files
- User mentions: "investigate", "analyze", "find", "trace", "understand"
- User is exploring an unfamiliar codebase
- User needs to understand complex multi-file functionality

## Instructions

### Phase 1: Determine Investigation Scope

Understand what the user wants to investigate:

1. **Specific Feature**: "How does user authentication work?"
2. **Find Implementation**: "Where is the payment processing logic?"
3. **Trace Flow**: "What happens when I click the submit button?"
4. **Debug Issue**: "Why is the profile page showing undefined?"
5. **Find Patterns**: "Where are all the API calls made?"
6. **Analyze Architecture**: "What's the structure of the data layer?"

### Phase 2: Invoke codebase-detective Agent

Use the Task tool to launch the codebase-detective agent with comprehensive instructions:

```
Use Task tool with:
- subagent_type: "code-analysis:detective"
- description: "Investigate [brief summary]"
- prompt: [Detailed investigation instructions]
```

**Prompt structure for codebase-detective**:

```markdown
# Code Investigation Task

## Investigation Target
[What needs to be investigated - be specific]

## Context
- Working Directory: [current working directory]
- Purpose: [debugging/learning/refactoring/etc]
- User's Question: [original user question]

## Investigation Steps

1. **Initial Search** (CLAUDEMEM REQUIRED):
   - FIRST: Check `claudemem status` - is index available?
   - ALWAYS: Use `claudemem search "semantic query"` for investigation
   - NEVER: Use grep/glob for semantic understanding tasks
   - Search for: [concepts, functionality, patterns by meaning]

2. **Code Location**:
   - Find exact file paths and line numbers
   - Identify entry points and main implementations
   - Note related files and dependencies

3. **Code Flow Analysis**:
   - Trace how data/control flows through the code
   - Identify key functions and their roles
   - Map out component/service relationships

4. **Pattern Recognition**:
   - Identify architectural patterns used
   - Note code conventions and styles
   - Find similar implementations for reference

## Deliverables

Provide a comprehensive report including:

1. **📍 Primary Locations**:
   - Main implementation files with line numbers
   - Entry points and key functions
   - Configuration and setup files

2. **🔍 Code Flow**:
   - Step-by-step flow explanation
   - How components interact
   - Data transformation points

3. **🗺️ Architecture Map**:
   - High-level structure diagram
   - Component relationships
   - Dependency graph

4. **📝 Code Snippets**:
   - Key implementations (show important code)
   - Patterns and conventions used
   - Notable details or gotchas

5. **🚀 Navigation Guide**:
   - How to explore the code further
   - Related files to examine
   - Commands to run for testing

6. **💡 Insights**:
   - Why the code is structured this way
   - Potential issues or improvements
   - Best practices observed

## Search Strategy

### ⚠️ CRITICAL: Tool Selection

**BEFORE ANY SEARCH, CHECK CLAUDEMEM STATUS:**
```bash
claudemem status
```

### MCP Tools (Preferred in Claude Code)

When using Claude Code with code-analysis plugin, call claudemem tools directly:

| MCP Tool | Equivalent CLI | When to Use |
|----------|---------------|-------------|
| `map` | `claudemem --agent map` | Architecture overview, start here |
| `symbol` | `claudemem --agent symbol` | Find exact definition |
| `callers` | `claudemem --agent callers` | Impact analysis |
| `callees` | `claudemem --agent callees` | Dependency analysis |
| `context` | `claudemem --agent context` | Full call chain |
| `search` | `claudemem --agent search` | Semantic search |
| `dependency-graph` | `claudemem --agent dependency-graph` | Transitive dependencies |

### ✅ PRIMARY METHOD: claudemem (Indexed Memory)

```bash
# Index if needed
claudemem index -y

# Semantic search (ALWAYS use this for investigation)
claudemem search "authentication login session" -n 15
claudemem search "API endpoint handler route" -n 20
claudemem search "data transformation pipeline" -n 10
```

**Why claudemem is REQUIRED for investigation:**
- Understands code MEANING, not just text patterns
- Finds related code even with different terminology
- Returns ranked, relevant results
- AST-aware (understands code structure)

### ❌ WHEN NOT TO USE GREP

| User Request | ❌ DON'T | ✅ DO |
|-------------|----------|-------|
| "How does auth work?" | `grep -r "auth" src/` | `claudemem search "authentication flow"` |
| "Find API endpoints" | `grep -r "router" src/` | `claudemem search "API endpoint handler"` |
| "Trace data flow" | `grep -r "transform" src/` | `claudemem search "data transformation"` |
| "Audit architecture" | `ls -la src/` | `claudemem search "architecture layers"` |

### ⚠️ DEGRADED FALLBACK (Only if claudemem unavailable)

**Only use grep/find if:**
1. claudemem is NOT installed, AND
2. User explicitly accepts degraded mode

```bash
# DEGRADED MODE - inferior results expected
grep -r "pattern" src/  # Text match only, no semantic understanding
find . -name "*.ts"     # File discovery only
```

**Always warn user**: "Using grep fallback - results will be less accurate than semantic search."

## Output Format

Structure your findings clearly with:
- File paths using backticks: `src/auth/login.ts:45`
- Code blocks for snippets
- Clear headings and sections
- Actionable next steps
```

### Phase 3: Present Analysis Results

After the agent completes, present results to the user:

1. **Executive Summary** (2-3 sentences):
   - What was found
   - Where it's located
   - Key insight

2. **Detailed Findings**:
   - Primary file locations with line numbers
   - Code flow explanation
   - Architecture overview

3. **Visual Structure** (if complex):
   ```
   EntryPoint (file:line)
     ├── Validator (file:line)
     ├── BusinessLogic (file:line)
     │   └── DataAccess (file:line)
     └── ResponseHandler (file:line)
   ```

4. **Code Examples**:
   - Show key code snippets inline
   - Highlight important patterns

5. **Next Steps**:
   - Suggest follow-up investigations
   - Offer to dive deeper into specific parts
   - Provide commands to test/run the code

### Phase 4: Offer Follow-up

Ask the user:
- "Would you like me to investigate any specific part in more detail?"
- "Do you want to see how [related feature] works?"
- "Should I trace [specific function] further?"

## Example Scenarios

### Example 1: Understanding Authentication

```
User: "How does login work in this app?"

Skill invokes codebase-detective agent with:
"Investigate user authentication and login flow:
1. Find login API endpoint or form handler
2. Trace authentication logic
3. Identify token generation/storage
4. Find session management
5. Locate authentication middleware"

Agent provides:
- src/api/auth/login.ts:34-78 (login endpoint)
- src/services/authService.ts:12-45 (JWT generation)
- src/middleware/authMiddleware.ts:23 (token validation)
- Flow: Form → API → Service → Middleware → Protected Routes
```

### Example 2: Debugging Undefined Error

```
User: "The dashboard shows 'undefined' for user name"

Skill invokes codebase-detective agent with:
"Debug undefined user name in dashboard:
1. Find Dashboard component
2. Locate where user name is rendered
3. Trace user data fetching
4. Check data transformation/mapping
5. Identify where undefined is introduced"

Agent provides:
- src/components/Dashboard.tsx:156 renders user.name
- src/hooks/useUser.ts:45 fetches user data
- Issue: API returns 'full_name' but code expects 'name'
- Fix: Map 'full_name' to 'name' in useUser hook
```

### Example 3: Finding All API Calls

```
User: "Where are all the API calls made?"

Skill invokes codebase-detective agent with:
"Find all API call locations:
1. Search for fetch, axios, http client usage
2. Identify API client/service files
3. List all endpoints used
4. Note patterns (REST, GraphQL, etc)
5. Find error handling approach"

Agent provides:
- 23 API calls across 8 files
- Centralized in src/services/*
- Using axios with interceptors
- Base URL in src/config/api.ts
- Error handling in src/utils/errorHandler.ts
```

## Success Criteria

The Skill is successful when:

1. ✅ User's question is comprehensively answered
2. ✅ Exact code locations provided with line numbers
3. ✅ Code relationships and flow clearly explained
4. ✅ User can navigate to code and understand it
5. ✅ Architecture patterns identified and explained
6. ✅ Follow-up questions anticipated

## Tips for Optimal Results

1. **Be Comprehensive**: Don't just find one file, map the entire flow
2. **Provide Context**: Explain why code is structured this way
3. **Show Examples**: Include actual code snippets
4. **Think Holistically**: Connect related pieces across files
5. **Anticipate Questions**: Answer follow-up questions proactively

## Integration with Other Tools

This Skill works well with:

- **claudemem CLI**: For local semantic code search with Tree-sitter parsing
- **MCP gopls**: For Go-specific analysis
- **Standard CLI tools**: grep, ripgrep, find, git
- **Project-specific tools**: Use project's search/navigation tools

## Notes

- The codebase-detective agent uses extended thinking for complex analysis
- **claudemem is REQUIRED** - grep/find produce inferior results
- Fallback to grep ONLY if claudemem unavailable AND user accepts degraded mode
- claudemem uses OpenRouter API for embedding (https://openrouter.ai). In MCP mode, the API key is read from environment.
- Default model: `voyage/voyage-code-3` (best code understanding)
- Run `claudemem --models` to see all options and pricing
- Results are actionable and navigable
- Great for onboarding to new codebases
- Helps prevent incorrect assumptions about code

## Tool Selection Quick Reference

```
┌─────────────────────────────────────────────────────────────────────┐
│ BEFORE ANY CODE INVESTIGATION:                                       │
│                                                                      │
│ 1. INVOKE code-search-selector skill                                │
│ 2. Run: claudemem status                                            │
│ 3. If indexed → USE claudemem search                                │
│ 4. If not indexed → Index first OR ask user                         │
│ 5. NEVER default to grep when claudemem available                   │
│ 6. NEVER start with Read/Glob for semantic questions                │
│                                                                      │
│ grep is for EXACT STRING MATCHES only, NOT semantic understanding   │
└─────────────────────────────────────────────────────────────────────┘
```

---

**Maintained by:** MadAppGang
**Plugin:** code-analysis v4.0.0
**Last Updated:** March 2026 (v4.0.0 - Added MCP tools section)
