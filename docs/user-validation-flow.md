# Ultra-Efficient Frontend Development Architecture

## Core Architecture Principles

### 1. Context Separation
- **Main Thread**: Orchestration ONLY - coordinates agents, manages quality gates
- **Agents**: ALL implementation work - isolated contexts, specialized expertise
- **Result**: Minimal main context usage, parallel execution, reusable agent work

### 2. User Validation Loop
- Implementation completes with multi-agent quality gates
- **MANDATORY user validation phase** before considering task complete
- User tests implementation, reports any issues
- Issues trigger specialized debug/fix flows
- Loop continues until user satisfaction

### 3. Issue-Specific Debug Flows
Different issue types trigger different agent workflows

## Debug & Fix Flows

### UI Issue Flow

**When to Use**: User reports visual, layout, design, or UX problems

**Workflow**:
```
User Reports UI Issue
         ↓
Main Thread: Parse feedback, classify severity
         ↓
┌────────────────────────────────────────────────┐
│ Agent 1: Designer                              │
│ - Analyze design fidelity                     │
│ - Identify visual/layout problems             │
│ - Provide design guidance                     │
│ - Use browser-debugger skill if needed        │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 2: UI Developer                          │
│ - Implement fixes based on designer feedback  │
│ - Apply design recommendations                │
│ - Run CSS/layout tests                        │
│ - Ensure responsive behavior                  │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 3: UI Developer Codex (Optional)         │
│ - Expert review of implementation             │
│ - Check design fidelity                       │
│ - Suggest improvements                        │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 4: UI Manual Tester                      │
│ - Real browser testing                        │
│ - Visual regression check                     │
│ - Responsive testing                          │
│ - Report remaining issues                     │
└────────────────────────────────────────────────┘
         ↓
Main Thread: Present results to user
         ↓
User Validates → Still has issues? → REPEAT LOOP
```

**Example**:
```
User: "The login button is misaligned on mobile and the text color is too light"

Main → Designer: "Analyze button alignment and text color issues"
Designer → "Button has incorrect margin-left value, text color fails WCAG contrast"

Main → UI Developer: "Fix button margin and text color per designer feedback"
UI Developer → Fixed

Main → UI Tester: "Verify button on mobile breakpoints"
UI Tester → "Confirmed fixed"

Main → User: "I've fixed the alignment and contrast issues. Please verify."
User → "Perfect! Approved."
```

### Functional/Logic Issue Flow

**When to Use**: User reports bugs, incorrect behavior, missing functionality, errors

**Workflow**:
```
User Reports Functional Problem
         ↓
Main Thread: Classify architectural vs implementation issue
         ↓
  ┌─────────────────────────────┐
  │ If Architectural Problem:   │
  └─────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 1: Architect (Conditional)                │
│ - Analyze root cause                           │
│ - Design architectural fix                     │
│ - Plan implementation approach                 │
│ - Identify affected components                 │
└────────────────────────────────────────────────┘
         ↓
  ┌─────────────────────────────┐
  │ Always Run:                 │
  └─────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 2: Developer                              │
│ - Implement fix (following architect plan)    │
│ - Add/update tests                            │
│ - Verify edge cases                           │
│ - Run quality checks                          │
└────────────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────────────┐
│ Agent 3: Test Architect                         │
│ - Write comprehensive tests                   │
│ - Run test suite                              │
│ - Verify coverage                             │
│ - Validate fix approach                       │
└────────────────────────────────────────────────┘
         ↓
    If Tests FAIL → Back to Developer
    If Tests PASS → Continue
         ↓
┌────────────────────────────────────────────────┐
│ Agent 4: Code Reviewer (Parallel)               │
│ - Review implementation                        │
│ - Check for regressions                       │
│ - Verify best practices                       │
│ - Security review                             │
└────────────────────────────────────────────────┘
    │
    │   (Parallel)
    ↓
┌────────────────────────────────────────────────┐
│ Agent 5: Codex Reviewer (Optional, Parallel)    │
│ - Independent external AI review              │
│ - Pattern analysis                            │
│ - Additional perspectives                     │
└────────────────────────────────────────────────┘
         ↓
    If Issues Found → Back to Developer
    If Approved → Continue
         ↓
┌────────────────────────────────────────────────┐
│ Agent 6: Developer (Apply Feedback)             │
│ - Address review comments                     │
│ - Run final tests                             │
│ - Confirm all checks pass                     │
└────────────────────────────────────────────────┘
         ↓
Main Thread: Present results to user
         ↓
User Validates → Still has issues? → REPEAT LOOP
```

For more details, see `docs/USER_VALIDATION_FLOW.md`.
