---
name: deep-analysis
description: Proactively investigates codebases to understand complex patterns, trace multi-file flows, analyze architecture decisions, and provide comprehensive code insights. Use when users ask about code structure, implementation details, or need to understand how features work.
allowed-tools: Task
---

# Deep Code Analysis

This Skill provides comprehensive codebase investigation capabilities using the codebase-detective agent with semantic search and pattern matching.

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

1. **Initial Search**:
   - Use semantic search (claudemem CLI) if available
   - Otherwise use grep/ripgrep/find for patterns
   - Search for: [specific terms, patterns, file names]

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

**With claudemem CLI Available**:
- Index the codebase if not already indexed: `claudemem index`
- Use semantic queries for concepts: `claudemem search "authentication logic"`
- Use natural language to find functionality by meaning

**Fallback (No claudemem)**:
- Use ripgrep (rg) or grep for pattern matching
- Search file names with find
- Trace imports manually
- Use git grep for repository-wide search

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
- Semantic search (claudemem) is preferred but not required
- Agent automatically falls back to grep/find if needed
- claudemem requires OpenRouter API key (https://openrouter.ai)
- Default model: `voyage/voyage-code-3` (best code understanding)
- Run `claudemem --models` to see all options and pricing
- Results are actionable and navigable
- Great for onboarding to new codebases
- Helps prevent incorrect assumptions about code
