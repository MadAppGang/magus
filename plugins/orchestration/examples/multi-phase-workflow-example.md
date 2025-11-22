# Multi-Phase Implementation Workflow Example

**Scenario:** User requests "Implement payment integration feature"

**Skills Used:**
- `multi-agent-coordination` (sequential delegation, agent selection)
- `quality-gates` (test-driven loop, user approval)
- `todowrite-orchestration` (8-phase workflow tracking)
- `error-recovery` (test failure recovery)
- `multi-model-validation` (optional code review phase)

**Outcome:** Complete feature from architecture to acceptance with test-driven quality assurance

---

## User Request

```
User: "Implement Stripe payment integration with webhook support"
```

## Orchestrator Execution

### Step 0: Initialize TodoWrite (TodoWrite-Orchestration)

```
TodoWrite: Create task list
  [ ] PHASE 1: Gather requirements
  [ ] PHASE 2: Architecture planning
  [ ] PHASE 3: Implement core logic
  [ ] PHASE 3: Add error handling
  [ ] PHASE 3: Write tests
  [ ] PHASE 4: Run test suite (test-driven loop)
  [ ] PHASE 5: Code review
  [ ] PHASE 6: Fix review issues
  [ ] PHASE 7: User acceptance
  [ ] PHASE 8: Generate final report

User sees: "10 tasks total, 0 complete, Phase 1 starting..."
```

---

## PHASE 1: Gather Requirements

**Mark in TodoWrite:**

```
[→] PHASE 1: Gather requirements (in_progress)
[ ] PHASE 2: Architecture planning
...
```

**Write Requirements File:**

```bash
# Create requirements document
cat > ai-docs/payment-requirements.md <<EOF
# Payment Integration Requirements

## Objective
Integrate Stripe payment processing with webhook support for subscription billing.

## Features Required
1. Payment processing (credit cards, ACH)
2. Subscription management (create, update, cancel)
3. Webhook handling (payment_succeeded, subscription_updated, etc.)
4. Customer management (create, retrieve, update)
5. Error handling and retry logic
6. Logging and monitoring

## Technical Constraints
- Use Stripe Node.js SDK
- TypeScript with strict mode
- Database: PostgreSQL with Prisma ORM
- Framework: Express.js
- Testing: Vitest
EOF
```

**Mark Complete:**

```
[✓] PHASE 1: Gather requirements (completed)
[→] PHASE 2: Architecture planning (in_progress)

User sees: "1/10 tasks complete (10%)"
```

---

## PHASE 2: Architecture Planning (Multi-Agent-Coordination)

**Delegate to Architect:**

```
Task: api-architect
  Prompt: "Read requirements from ai-docs/payment-requirements.md

           Design architecture for Stripe payment integration:
           - Component breakdown
           - API endpoints design
           - Database schema
           - Error handling strategy
           - Security considerations

           Write architecture plan to ai-docs/payment-architecture.md
           Return only brief summary (2-3 sentences)."
```

**Architect Output (ai-docs/payment-architecture.md):**

```markdown
# Payment Integration Architecture

## Components

### 1. PaymentController
- POST /api/payments/create-session
- POST /api/payments/confirm
- POST /api/webhooks/stripe (webhook handler)

### 2. PaymentService
- createPaymentSession(amount, customerId)
- confirmPayment(sessionId)
- handleWebhook(event)

### 3. CustomerService
- createCustomer(email, name)
- getCustomer(customerId)
- updateCustomer(customerId, data)

### 4. SubscriptionService
- createSubscription(customerId, priceId)
- updateSubscription(subscriptionId, data)
- cancelSubscription(subscriptionId)

## Database Schema (Prisma)

model Customer {
  id            String   @id @default(cuid())
  stripeId      String   @unique
  email         String   @unique
  name          String
  subscriptions Subscription[]
  payments      Payment[]
}

model Subscription {
  id           String   @id @default(cuid())
  stripeId     String   @unique
  customerId   String
  customer     Customer @relation(fields: [customerId], references: [id])
  status       String
  priceId      String
  currentPeriodEnd DateTime
}

model Payment {
  id         String   @id @default(cuid())
  stripeId   String   @unique
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  amount     Int
  status     String
  createdAt  DateTime @default(now())
}

## Error Handling

- Stripe API errors → Retry with exponential backoff (3 attempts)
- Webhook verification failures → Log and return 400
- Database errors → Rollback transaction, return 500

## Security

- Webhook signature verification (STRIPE_WEBHOOK_SECRET)
- Input validation (Zod schemas)
- Rate limiting (5 requests/min per customer)
```

**Architect Returns:**

```
"Architecture plan complete. Designed 3-layer payment system with webhook handling.
 See ai-docs/payment-architecture.md for component breakdown."
```

**Mark Complete:**

```
[✓] PHASE 1: Gather requirements
[✓] PHASE 2: Architecture planning (completed)
[→] PHASE 3: Implement core logic (in_progress)

User sees: "2/10 tasks complete (20%)"
```

---

## PHASE 3: Implementation (Multi-Agent-Coordination)

**Delegate to Developer:**

```
Task: backend-developer
  Prompt: "Read architecture from ai-docs/payment-architecture.md

           Implement Stripe payment integration:
           - Create all 4 services (Payment, Customer, Subscription, Webhook)
           - Create controllers
           - Create routes
           - Add Zod validation schemas
           - Follow architecture exactly

           Return brief summary of files created."
```

**Developer Creates:**

```
src/services/payment.service.ts
src/services/customer.service.ts
src/services/subscription.service.ts
src/controllers/payment.controller.ts
src/routes/payment.routes.ts
src/schemas/payment.schema.ts
prisma/schema.prisma (updated)
```

**Developer Returns:**

```
"Payment integration implemented. 7 files created, 800 lines of code.
 Services, controllers, routes, and validation schemas complete."
```

**Mark Complete:**

```
[✓] PHASE 3: Implement core logic (completed)
[→] PHASE 3: Add error handling (in_progress)

User sees: "3/10 tasks complete (30%)"
```

**Add Error Handling:**

```
Task: backend-developer
  Prompt: "Add comprehensive error handling to payment integration:
           - Stripe API error handling with retry logic
           - Database transaction rollbacks
           - Input validation errors
           - Webhook verification errors

           Return summary of error handling added."
```

**Mark Complete:**

```
[✓] PHASE 3: Add error handling (completed)
[→] PHASE 3: Write tests (in_progress)

User sees: "4/10 tasks complete (40%)"
```

---

## PHASE 4: Test-Driven Development Loop (Quality-Gates)

**Step 1: Write Tests:**

```
Task: test-architect
  Prompt: "Write comprehensive tests for payment integration:
           - Unit tests for all services
           - Integration tests for API endpoints
           - Webhook handling tests
           - Error scenario tests

           Use Vitest, mock Stripe SDK calls.
           Write to tests/payment.test.ts"
```

**Tests Created:**

```typescript
// tests/payment.test.ts
describe('PaymentService', () => {
  test('creates payment session successfully', async () => {
    // Test implementation
  });

  test('handles Stripe API errors', async () => {
    // Test implementation
  });

  // ... 18 more tests
});

// Total: 20 tests
```

**Step 2: Run Tests:**

```bash
bun test tests/payment.test.ts

# Output:
# ❌ FAIL  tests/payment.test.ts
#   ✓ creates payment session successfully
#   ✗ handles Stripe API errors (expected error not thrown)
#   ✗ processes webhook events (webhook verification fails)
#   ✓ creates customer successfully
#   ✗ validates input correctly (validation not implemented)
#   ... 15 more tests
#
# Tests: 5 failed, 15 passed, 20 total
```

**Step 3: Analyze Failures (Quality-Gates TDD Loop):**

```
Task: test-architect
  Prompt: "Analyze test failures:

           Failures:
           1. 'handles Stripe API errors' - expected error not thrown
           2. 'processes webhook events' - webhook verification fails
           3. 'validates input correctly' - validation not implemented
           4. 'retries on network failure' - retry logic missing
           5. 'rolls back on database error' - transaction not rolled back

           Determine for each:
           - TEST_ISSUE: Test has bug (bad assertion, missing mock)
           - IMPLEMENTATION_ISSUE: Code has bug (logic error, missing feature)

           Provide detailed analysis."
```

**Test-Architect Analysis:**

```
Failure 1: IMPLEMENTATION_ISSUE
  - Error handling exists but doesn't throw expected error type
  - Fix: Update error handling to throw StripeError

Failure 2: IMPLEMENTATION_ISSUE
  - Webhook verification not implemented
  - Fix: Add Stripe signature verification

Failure 3: IMPLEMENTATION_ISSUE
  - Input validation missing in controller
  - Fix: Add Zod schema validation

Failure 4: IMPLEMENTATION_ISSUE
  - Retry logic not implemented
  - Fix: Add retry with exponential backoff

Failure 5: TEST_ISSUE
  - Test expects rollback but mock database doesn't support transactions
  - Fix: Update test mock to support transactions
```

**Step 4: Fix Implementation Issues:**

**Iteration 1:**

```
Task: backend-developer
  Prompt: "Fix 4 implementation issues based on test failures:

           1. Update error handling to throw StripeError
           2. Add Stripe webhook signature verification
           3. Add Zod schema validation in controllers
           4. Implement retry logic with exponential backoff

           Test failures: [attach full test output]"
```

**Developer fixes code, re-run tests:**

```bash
bun test tests/payment.test.ts

# Output:
# ❌ FAIL  tests/payment.test.ts
#   ✓ handles Stripe API errors (fixed!)
#   ✓ processes webhook events (fixed!)
#   ✓ validates input correctly (fixed!)
#   ✓ retries on network failure (fixed!)
#   ✗ rolls back on database error (test issue)
#
# Tests: 1 failed, 19 passed, 20 total
```

**Iteration 2:**

```
Task: test-architect
  Prompt: "Fix test issue:
           - Update mock database to support transactions
           - Re-run failing test"
```

**Test-architect fixes test, re-run:**

```bash
bun test tests/payment.test.ts

# Output:
# ✓ PASS  tests/payment.test.ts
#   All 20 tests passed!
#
# Tests: 0 failed, 20 passed, 20 total
```

**Mark Complete:**

```
[✓] PHASE 3: Write tests (completed)
[✓] PHASE 4: Run test suite (completed)
[→] PHASE 5: Code review (in_progress)

User sees: "6/10 tasks complete (60%)"
```

**TDD Loop Summary:**

```
Iterations: 2
Duration: ~8 minutes
Bugs Caught: 4 implementation bugs, 1 test bug
Result: All 20 tests passing ✅
```

---

## PHASE 5: Code Review (Multi-Model-Validation - Optional)

**User Choice:**

```
Ask user: "Would you like multi-model code review (Grok + Gemini + Claude)
          or single embedded review (Claude only)?

          Multi-model: More thorough, costs ~$0.01, takes 5 min
          Single: Fast, free, takes 2 min

          Choose: (multi-model/single/skip)"
```

**User selects:** "single"

**Run Single Review:**

```
Task: senior-code-reviewer
  Prompt: "Review payment integration implementation:

           Files:
           - src/services/payment.service.ts
           - src/controllers/payment.controller.ts
           - src/routes/payment.routes.ts

           Focus on:
           - Security (Stripe keys, webhook verification)
           - Error handling (retries, rollbacks)
           - Code quality (patterns, structure)
           - Test coverage (20 tests, all passing)

           Write review to ai-docs/payment-review.md"
```

**Review Findings:**

```
2 MEDIUM issues found:
1. Stripe API key hardcoded (should use env variable)
2. Missing JSDoc comments on public methods

All tests passing ✅
Security: Good (webhook verification, input validation)
Error handling: Comprehensive (retries, rollbacks)
```

**Mark Complete:**

```
[✓] PHASE 5: Code review (completed)
[→] PHASE 6: Fix review issues (in_progress)

User sees: "7/10 tasks complete (70%)"
```

---

## PHASE 6: Fix Review Issues

```
Task: backend-developer
  Prompt: "Fix 2 MEDIUM issues from code review:

           1. Move Stripe API key to environment variable
           2. Add JSDoc comments to all public methods

           Review: ai-docs/payment-review.md"
```

**Developer fixes issues**

**Mark Complete:**

```
[✓] PHASE 6: Fix review issues (completed)
[→] PHASE 7: User acceptance (in_progress)

User sees: "8/10 tasks complete (80%)"
```

---

## PHASE 7: User Acceptance (Quality-Gates)

**Present to User:**

```
Payment integration implementation complete. Please review:

Files Created:
  - 7 TypeScript files (800 lines)
  - 1 test file (20 tests, all passing)
  - Database schema updates

Features Implemented:
  ✓ Payment processing (credit cards)
  ✓ Subscription management
  ✓ Webhook handling with signature verification
  ✓ Customer management
  ✓ Error handling with retry logic
  ✓ Input validation (Zod schemas)

Code Review:
  ✓ Security: Good
  ✓ Error handling: Comprehensive
  ✓ Test coverage: 100% (20/20 tests passing)
  ✓ All review issues fixed

Next Steps:
  1. Test manually in development environment
  2. Deploy to staging
  3. Verify webhook integration with Stripe

Accept implementation? (Yes/No/Feedback)
```

**User Response:** "Yes, looks great!"

**Mark Complete:**

```
[✓] PHASE 7: User acceptance (completed)
[→] PHASE 8: Generate final report (in_progress)

User sees: "9/10 tasks complete (90%)"
```

---

## PHASE 8: Generate Final Report

**Create Summary:**

```markdown
# Payment Integration Implementation - Final Report

**Status:** ✅ COMPLETE
**Duration:** 45 minutes
**Tests:** 20/20 passing
**Code Review:** 2 MEDIUM issues fixed

## Implementation Summary

### Files Created
- src/services/payment.service.ts (200 lines)
- src/services/customer.service.ts (150 lines)
- src/services/subscription.service.ts (180 lines)
- src/controllers/payment.controller.ts (120 lines)
- src/routes/payment.routes.ts (50 lines)
- src/schemas/payment.schema.ts (100 lines)
- tests/payment.test.ts (300 lines)
- prisma/schema.prisma (updated)

### Features Delivered
✓ Stripe payment processing
✓ Subscription management
✓ Webhook handling (verified signatures)
✓ Customer management
✓ Error handling with retries
✓ Input validation
✓ 100% test coverage

### Quality Assurance
- Test-driven development: 2 iterations, all tests passing
- Code review: 2 MEDIUM issues found and fixed
- User acceptance: Approved ✅

### Architecture
- 3-layer architecture (routes → controllers → services)
- Clean separation of concerns
- TypeScript strict mode
- Prisma ORM for database

### Next Steps
1. Deploy to staging environment
2. Configure Stripe webhook endpoint
3. Test webhook integration
4. Monitor for errors
5. Deploy to production
```

**Mark Complete:**

```
[✓] All 10 tasks completed

User sees: "10/10 tasks complete (100%). Implementation finished!"
```

---

## Key Takeaways

**Skills in Action:**

1. **Multi-Agent-Coordination:**
   - Sequential delegation (architect → developer → test-architect → reviewer)
   - File-based instructions (ai-docs/payment-requirements.md)
   - Agent selection by task type (architecture vs implementation vs testing)

2. **Quality-Gates:**
   - Test-driven development loop (2 iterations until all tests pass)
   - Issue severity classification (2 MEDIUM issues)
   - User acceptance gate (mandatory approval before completion)

3. **TodoWrite-Orchestration:**
   - 10-task workflow with real-time updates
   - User always knew current phase (PHASE 3: 2/3 complete)
   - Progress percentage (60% complete)

4. **Error-Recovery:**
   - Test failures handled gracefully (2 iterations to fix)
   - Test vs implementation issues identified (4 impl, 1 test)

5. **Multi-Model-Validation:**
   - User given choice (multi-model vs single)
   - Cost transparency ($0.01 vs free)

**Results:**

- **Complete feature** in 45 minutes (architecture → acceptance)
- **100% test coverage** (20/20 tests passing)
- **Code review** passed with 2 minor issues fixed
- **User approved** implementation

**User Experience:**

- Real-time progress (10% → 20% → ... → 100%)
- Clear phase visibility (knew what was happening)
- Quality assurance (tests, review, acceptance)
- Professional deliverable (complete documentation)
