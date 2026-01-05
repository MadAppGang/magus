# Development Workflow

This document defines the standard procedures for all development work.

## Guiding Principles

1. **The Plan is the Source of Truth:** All work must be tracked in `plan.md`
2. **The Tech Stack is Deliberate:** Changes to the tech stack must be documented in `tech-stack.md` *before* implementation
3. **Test-Driven Development:** Write tests before implementing functionality
4. **High Code Coverage:** Aim for >80% code coverage for all modules
5. **User Experience First:** Every decision should prioritize user experience
6. **Non-Interactive & CI-Aware:** Prefer non-interactive commands. Use `CI=true` for watch-mode tools

---

## Task Lifecycle

### Standard Task Workflow

1. **Select Task:** Choose next pending task from plan.md in sequential order

2. **Mark In Progress:** Edit plan.md and change the task from `[ ]` to `[~]`

3. **Write Failing Tests (Red Phase):**
   - Create a new test file for the feature or bug fix
   - Write one or more unit tests that define expected behavior
   - **CRITICAL:** Run tests and confirm they FAIL. Do not proceed until you have failing tests

4. **Implement to Pass Tests (Green Phase):**
   - Write the minimum code necessary to make failing tests pass
   - Run test suite and confirm all tests now pass

5. **Refactor (Optional but Recommended):**
   - With safety of passing tests, refactor for clarity and performance
   - Remove duplication, improve naming
   - Rerun tests to ensure they still pass

6. **Verify Coverage:**
   ```bash
   # Example commands (adapt to your stack)
   CI=true npm test -- --coverage
   CI=true pytest --cov=app --cov-report=html
   CI=true go test -coverprofile=coverage.out ./...
   ```
   Target: >80% coverage for new code

7. **Document Deviations:**
   If implementation differs from tech stack:
   - **STOP** implementation
   - Update `tech-stack.md` with new design
   - Add dated note explaining the change
   - Resume implementation

8. **Commit Code Changes:**
   - Stage all code changes related to the task
   - Create commit with proper message format (see Git Conventions)

9. **Attach Task Summary with Git Notes:**
   ```bash
   # Step 9.1: Get commit hash
   COMMIT_SHA=$(git log -1 --format="%H")

   # Step 9.2: Create note content
   NOTE_CONTENT="Task: {phase}.{task} - {task_title}

   Summary: {what was accomplished}

   Files Changed:
   - {file1}: {description}
   - {file2}: {description}

   Why: {business reason for this change}"

   # Step 9.3: Attach note
   git notes add -m "$NOTE_CONTENT" $COMMIT_SHA
   ```

10. **Update Plan with Commit SHA:**
    - Read plan.md, find the completed task
    - Update status from `[~]` to `[x]`
    - Append first 7 characters of commit hash

11. **Commit Plan Update:**
    ```bash
    git add plan.md
    git commit -m "conductor(plan): Mark task '{task_title}' as complete"
    ```

---

## Phase Completion Verification Protocol

**Trigger:** Execute immediately after completing the final task of a phase.

### Step 1: Announce Protocol Start
Inform the user that phase is complete and verification has begun.

### Step 2: Ensure Test Coverage for Phase Changes
```bash
# Find starting point (previous checkpoint SHA)
PREV_SHA=$(grep -o '\[checkpoint: [a-f0-9]*\]' plan.md | tail -1 | grep -o '[a-f0-9]*')

# List all files changed in this phase
git diff --name-only $PREV_SHA HEAD

# For each code file, verify corresponding test exists
# If test is missing, CREATE it before proceeding
```

### Step 3: Execute Automated Tests with Proactive Debugging
```bash
# Announce the exact command before running
echo "Running: CI=true npm test"
CI=true npm test

# If tests fail:
# 1. Inform user
# 2. Attempt fix (maximum 2 attempts)
# 3. If still failing, STOP and ask user for guidance
```

### Step 4: Propose Manual Verification Plan

**For Frontend Changes:**
```
Manual Verification Steps:
1. Start the development server: `npm run dev`
2. Open browser to: http://localhost:3000
3. Confirm you see: {expected UI state}
4. Test interaction: {specific user action}
5. Verify result: {expected outcome}
```

**For Backend Changes:**
```
Manual Verification Steps:
1. Ensure server is running
2. Execute: curl -X POST http://localhost:8080/api/endpoint -d '{data}'
3. Confirm response: {expected response}
```

### Step 5: Await Explicit User Feedback
Ask: "**Does this meet your expectations? Please confirm with 'yes' or provide feedback.**"
**PAUSE** and wait for explicit confirmation.

### Step 6: Create Checkpoint Commit
```bash
git add -A
git commit -m "conductor(checkpoint): End of Phase {N} - {Phase Name}"
```

### Step 7: Attach Verification Report via Git Notes
```bash
CHECKPOINT_SHA=$(git log -1 --format="%H")

git notes add -m "Phase Verification Report
========================
Phase: {N} - {Phase Name}
Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Automated Tests: PASSED
Command: CI=true npm test

Manual Verification:
- Steps provided to user
- User confirmation: YES

Coverage: {X}%
" $CHECKPOINT_SHA
```

### Step 8: Record Phase Checkpoint SHA
Update plan.md phase heading with checkpoint marker:
```markdown
## Phase 1: Setup [checkpoint: abc1234]
```

### Step 9: Commit Plan Update
```bash
git add plan.md
git commit -m "conductor(plan): Mark phase '{Phase Name}' as complete"
```

### Step 10: Announce Completion
Inform user that phase is complete with checkpoint created and verification report attached.

---

## Quality Gates

Before marking any task complete, verify:

- [ ] All tests pass
- [ ] Code coverage meets requirements (>80%)
- [ ] Code follows project style guidelines (see `code_styleguides/`)
- [ ] All public functions/methods are documented (JSDoc, docstrings)
- [ ] Type safety is enforced (TypeScript strict, type hints)
- [ ] No linting or static analysis errors
- [ ] Works correctly on mobile (if applicable)
- [ ] Documentation updated if needed
- [ ] No security vulnerabilities introduced

---

## Development Commands

### Setup
```bash
# Install dependencies
npm install          # Node.js
pip install -r requirements.txt  # Python
go mod tidy          # Go

# Configure environment
cp .env.example .env
# Edit .env with your values
```

### Daily Development
```bash
# Start development server
npm run dev

# Run tests in watch mode
npm test -- --watch

# Run linter
npm run lint

# Type check
npm run typecheck
```

### Before Committing
```bash
# Run all checks
npm run lint && npm run typecheck && CI=true npm test

# Or if you have a combined script
npm run check
```

---

## Testing Requirements

### Unit Testing
- Every module must have corresponding tests
- Use appropriate test setup/teardown (fixtures, beforeEach/afterEach)
- Mock external dependencies
- Test both success and failure cases
- Aim for >80% coverage

### Integration Testing
- Test complete user flows
- Verify database transactions
- Test authentication and authorization
- Check form submissions and API responses

### Mobile Testing
- Test on actual devices when possible
- Use browser developer tools for responsive testing
- Test touch interactions
- Verify responsive layouts at breakpoints
- Check performance on 3G/4G networks

---

## Code Review Self-Checklist

Before requesting review, verify:

### 1. Functionality
- [ ] Feature works as specified
- [ ] Edge cases handled
- [ ] Error messages are user-friendly

### 2. Code Quality
- [ ] Follows style guide
- [ ] DRY principle applied
- [ ] Clear variable/function names
- [ ] Appropriate comments (why, not what)

### 3. Testing
- [ ] Unit tests comprehensive
- [ ] Integration tests pass
- [ ] Coverage adequate (>80%)

### 4. Security
- [ ] No hardcoded secrets
- [ ] Input validation present
- [ ] SQL injection prevented
- [ ] XSS protection in place

### 5. Performance
- [ ] Database queries optimized
- [ ] Images optimized
- [ ] Caching implemented where needed
- [ ] No N+1 queries

### 6. Mobile Experience
- [ ] Touch targets adequate (44x44px minimum)
- [ ] Text readable without zooming
- [ ] Performance acceptable on mobile
- [ ] Interactions feel native

---

## Git Conventions

### Commit Message Format
```
<type>(<scope>): <description>

[optional body]

[optional footer]

Task: {phase}.{task}
```

### Commit Types
| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code change that neither fixes nor adds feature |
| `test` | Adding missing tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |

### Examples
```bash
git commit -m "feat(auth): Add remember me functionality

- Added checkbox to login form
- Implemented token refresh logic
- Added tests for token expiration

Task: 2.3"

git commit -m "fix(api): Correct user validation on registration

Task: 1.5"
```

---

## Definition of Done

A task is complete when:

1. [ ] All code implemented to specification
2. [ ] Unit tests written and passing
3. [ ] Code coverage meets requirements (>80%)
4. [ ] Code passes all linting and static analysis
5. [ ] Documentation complete (if applicable)
6. [ ] Works correctly on mobile (if applicable)
7. [ ] Implementation notes added to plan.md
8. [ ] Changes committed with proper message format
9. [ ] Git note with task summary attached to commit

---

## Blockers

When blocked:
1. Mark task as `[!]` blocked in plan.md
2. Add note describing the blocker:
   ```markdown
   - [!] 2.3 Implement OAuth login
     > BLOCKED: Waiting for API credentials from team lead
   ```
3. Notify appropriate team member
4. Either resolve or work on different task

---

## Emergency Procedures

### Critical Bug in Production
1. Create hotfix branch from main: `git checkout -b hotfix/critical-bug main`
2. Write failing test that reproduces the bug
3. Implement minimal fix to make test pass
4. Test thoroughly including mobile
5. Deploy immediately following deployment checklist
6. Document incident in plan.md or separate incident log
7. Schedule post-mortem

### Data Loss
1. **STOP** all write operations immediately
2. Restore from latest backup
3. Verify data integrity
4. Identify what was lost (if any)
5. Document incident with timeline
6. Update backup procedures if needed

### Security Breach
1. Rotate all secrets and API keys immediately
2. Review access logs for scope of breach
3. Patch the vulnerability
4. Notify affected users (if required by policy/law)
5. Document incident and update security procedures
6. Schedule security audit

---

## Deployment Workflow

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Code coverage >80%
- [ ] No linting errors
- [ ] Mobile testing complete
- [ ] Environment variables configured for production
- [ ] Database migrations ready and tested
- [ ] Backup created
- [ ] Rollback plan documented

### Deployment Steps
1. Merge feature branch to main
2. Tag release with semantic version: `git tag -a v1.2.3 -m "Release v1.2.3"`
3. Push to deployment service: `git push origin main --tags`
4. Run database migrations
5. Verify deployment health checks
6. Test critical user paths
7. Monitor for errors (first 15 minutes critical)

### Post-Deployment
1. Monitor analytics for anomalies
2. Check error logs and alerting
3. Gather user feedback
4. Document any issues encountered
5. Plan next iteration

---

## Continuous Improvement

- Review this workflow weekly
- Update based on pain points discovered
- Document lessons learned from incidents
- Optimize for developer happiness
- Keep processes simple and maintainable
- Remove steps that don't add value
