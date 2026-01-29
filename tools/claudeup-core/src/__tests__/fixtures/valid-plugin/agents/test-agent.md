---
name: test-agent
description: A test agent for validation testing. Use this agent when you need to validate agent parsing and frontmatter extraction. Example scenarios include (1) Unit testing agent validation logic, (2) Integration testing plugin loading.
color: blue
tools: TodoWrite, Write, Edit, Read, Bash, Glob, Grep
model: sonnet
---

## Test Agent

This is a test agent fixture used for validating agent parsing and frontmatter extraction.

### Capabilities

- Task management with TodoWrite
- File operations with Write, Edit, Read
- Search operations with Glob, Grep
- Command execution with Bash

### Usage

This agent should only be used in test environments.

## CRITICAL: Proxy Mode (Optional)

**FIRST STEP: Check for Proxy Mode Directive**

Before executing any work, check if the incoming prompt starts with:
```
PROXY_MODE: {model_name}
```

If you see this directive:
1. Extract the model name
2. Delegate to external AI

**If NO PROXY_MODE directive is found:**
- Proceed with normal operation

---

**Test Agent v1.0.0**
