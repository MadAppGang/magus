---
name: test-skill
description: A test skill for validation testing. Use when testing skill parsing and validation logic.
allowed-tools: Task
prerequisites:
  - basic-skill
dependencies:
  - external-tool must be installed
---

# Test Skill

This skill provides test functionality for validation testing.

## Prerequisites

Before using this skill:
1. Ensure `basic-skill` has been invoked
2. Verify `external-tool` is installed

## When to Use

Use this skill when:
- Testing skill parsing logic
- Validating frontmatter extraction
- Integration testing plugin loading

## Instructions

### Phase 1: Setup

Prepare the test environment:
1. Create necessary test files
2. Configure test parameters

### Phase 2: Execute

Run the test operation:
1. Invoke the required tools
2. Validate results

### Phase 3: Cleanup

Clean up after testing:
1. Remove temporary files
2. Reset state

## Example

```markdown
User: "Run the test skill"

Skill invokes Task tool with:
- subagent_type: "test-agent"
- description: "Execute test operation"
- prompt: "Perform test validation"
```

## Success Criteria

The skill succeeds when:
- All test operations complete
- No validation errors occur
- Results match expected output

---

**Test Skill v1.0.0**
