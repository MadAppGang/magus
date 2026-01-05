# Enhanced /dev:feature Command - Requirements

**Version**: 2.0.0
**Session**: agentdev-dev-feature-v2-20260105-234119-90dd

## User Requirements (15 Points)

### Phase 1: Requirements Gathering
1. **Iterative Questions** - Collect user information by asking questions until we have a full picture of what needs to be implemented.

### Phase 2: Research (Optional)
2. **Internet Research** - If needed, search internet for resources, combine findings, and present as feature requirements.

### Phase 3: Multi-Model Planning
3. **Parallel Planning** - Run multiple architect agents with different models via Claudish, then do blinded voting.
4. **Present Results** - Show final composed plan with voting results for user validation.

### Phase 4: Implementation
5. **Stack-Specific Agents** - Use specific agents for backend/frontend based on detected stacks (e.g., golang agent for Go, react agent for React).
6. **Parallel Development** - If tasks can run in parallel, split into smaller tasks and run multiple development agents simultaneously.

### Phase 5: Code Review Loop
7. **Multi-Model Review** - Run code reviewers with different language models via Claudish.
8. **Feedback Consolidation** - Combine feedback from all reviewers.
9. **Fix Loop** - If critical/high/medium issues found, push back to developer. Loop until reviewers happy.

### Phase 6: Testing
10. **Test Architecture** - Test architect determines what tests needed (unit, integration, e2e) - not too much, not too little.
11. **Black Box Testing** - Test implementer uses initial requirements/plan, NOT implementation details.
12. **Test Validation** - If tests fail, determine if implementation is wrong OR test is wrong. Never change tests just to pass.
13. **Implementation Fix** - If tests are valid but implementation wrong, send back to developer.
14. **Review Re-run** - After implementation fix, re-run reviewers.

### Phase 7: Completion
15. **Final Report** - When reviewer AND tester are happy, create description of what was implemented and present to user.

## Reference Architecture

The user provided the "Dingo Development Orchestrator" as a reference implementation showing:

- **File-based communication** between agents
- **Session directories** with structured subdirs (01-planning, 02-implementation, 03-reviews, 04-testing)
- **Parallel execution** patterns for implementation and review phases
- **PROXY_MODE** for external model delegation
- **Safety limits** on iteration loops (max 5 for reviews, max 3 for tests)
- **Brief agent returns** (max 3 lines) with full details in files

## Key Design Principles

1. **Orchestrator Never Reads Agent Files** - Only reads summaries, full content stays in files
2. **Parallel by Default** - Maximize parallelism for 3-4x speedup
3. **Model Selection at Start** - User selects review models during planning
4. **Blinded Voting** - Multiple architects produce plans, then vote/consolidate
5. **Test Independence** - Tester has NO access to implementation, only requirements
6. **Validation Over Passing** - Tests are authoritative, implementation changes if needed

## Existing Command Location

Current feature command: `plugins/dev/commands/feature.md`
