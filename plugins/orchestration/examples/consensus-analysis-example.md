# Consensus Analysis Example

**Scenario:** 3 AI models reviewed the same code, how to interpret consensus results

**Skills Used:**
- `multi-model-validation` (consensus analysis patterns)
- `quality-gates` (severity classification, prioritization)

**Outcome:** Understand how to interpret multi-model consensus and prioritize issues

---

## The Consensus Review

**3 Models Reviewed 450 Lines of Authentication Code:**

1. **Claude Sonnet** (embedded)
2. **Grok Code Fast** (external)
3. **Gemini 2.5 Flash** (external)

**Each model found different issues. How do we prioritize them?**

---

## Raw Review Outputs

### Claude Sonnet Review

```
CRITICAL Issues:
1. SQL injection in user search endpoint (line 45)
2. Missing input validation on POST /api/users (line 23)
3. Passwords stored with weak bcrypt rounds (line 34)

HIGH Issues:
4. Missing rate limiting on auth endpoints
5. Insufficient error handling in payment flow
6. Memory leak in WebSocket connection

MEDIUM Issues:
7. Code duplication in auth controllers
8. Inconsistent error messages
9. Missing JSDoc comments
```

### Grok Code Fast Review

```
CRITICAL Issues:
1. SQL injection vulnerability in search (line 45)
2. No input validation on user creation (line 23)

HIGH Issues:
3. Missing rate limiting on login endpoint
4. Memory leak in WebSocket handler

MEDIUM Issues:
5. Weak password hashing (only 8 rounds)
6. Code duplication across controllers
7. Error messages not i18n-ready
```

### Gemini 2.5 Flash Review

```
CRITICAL Issues:
1. SQL injection risk in user search (line 45)
2. Unvalidated user input in POST endpoint (line 23)
3. Weak bcrypt configuration (8 rounds)

HIGH Issues:
4. No rate limiting on authentication
5. WebSocket memory leak issue

MEDIUM Issues:
6. DRY violation in auth controllers
7. Missing error handling in edge cases
```

---

## Consensus Analysis (Multi-Model-Validation Pattern)

### Step 1: Extract Unique Issues

```
Issue List (deduplicated):

1. SQL injection in user search (line 45)
2. Missing input validation on POST /api/users (line 23)
3. Weak password hashing (bcrypt rounds = 8)
4. Missing rate limiting on auth endpoints
5. Memory leak in WebSocket connection
6. Insufficient error handling in payment flow
7. Code duplication in auth controllers
8. Inconsistent error messages
9. Missing JSDoc comments
```

### Step 2: Count Model Agreement

```
Issue                               Claude  Grok  Gemini  Count
──────────────────────────────────────────────────────────────
SQL injection in search                ✓     ✓      ✓      3/3
Missing input validation               ✓     ✓      ✓      3/3
Weak password hashing                  ✓     ✓      ✓      3/3
Missing rate limiting                  ✓     ✓      ✓      3/3
Memory leak in WebSocket               ✓     ✓      ✓      3/3
Insufficient error handling (payment)  ✓     ✗      ✗      1/3
Code duplication                       ✓     ✓      ✓      3/3
Inconsistent error messages            ✓     ✓      ✗      2/3
Missing JSDoc comments                 ✓     ✗      ✗      1/3
```

### Step 3: Assign Consensus Levels

```
Consensus Levels (for 3 models):

UNANIMOUS (3/3 = 100%):
  - SQL injection in search
  - Missing input validation
  - Weak password hashing
  - Missing rate limiting
  - Memory leak in WebSocket
  - Code duplication

STRONG (2/3 = 67%):
  - Inconsistent error messages

DIVERGENT (1/3 = 33%):
  - Insufficient error handling (payment)
  - Missing JSDoc comments
```

### Step 4: Combine Consensus + Severity

```
Prioritized Issue List:

Priority = Consensus Level × Severity Weight

Weights:
  - CRITICAL severity: ×10
  - HIGH severity: ×5
  - MEDIUM severity: ×2

Consensus multipliers:
  - UNANIMOUS (3/3): ×3
  - STRONG (2/3): ×2
  - DIVERGENT (1/3): ×1

Formula: Priority = Severity Weight × Consensus Multiplier
```

**Calculated Priorities:**

```
Issue                           Severity  Consensus  Weight  Priority
─────────────────────────────────────────────────────────────────────
SQL injection                   CRITICAL  UNANIMOUS  10×3    30 ← #1
Missing input validation        CRITICAL  UNANIMOUS  10×3    30 ← #2
Weak password hashing           CRITICAL  UNANIMOUS  10×3    30 ← #3
Memory leak WebSocket           HIGH      UNANIMOUS  5×3     15 ← #4
Missing rate limiting           HIGH      UNANIMOUS  5×3     15 ← #5
Code duplication                MEDIUM    UNANIMOUS  2×3     6  ← #6
Inconsistent error messages     MEDIUM    STRONG     2×2     4  ← #7
Insufficient error handling     HIGH      DIVERGENT  5×1     5  ← #8
Missing JSDoc comments          MEDIUM    DIVERGENT  2×1     2  ← #9
```

---

## Interpreting Consensus Levels

### UNANIMOUS (100% Agreement)

**What it means:**
- ALL 3 models independently flagged this issue
- VERY HIGH confidence this is a real problem
- Not a model-specific quirk or false positive

**How to interpret:**

```
Issue: SQL injection in user search
Consensus: UNANIMOUS (3/3 models)

Interpretation:
  ✓ Real issue (all 3 models agree)
  ✓ High confidence (not a false positive)
  ✓ Must fix (all models independently discovered it)
  ✓ Likely visible to users/attackers (obvious enough for all models)

Action: FIX IMMEDIATELY
```

**Example:**

```typescript
// Current code (all 3 models flagged):
const query = `SELECT * FROM users WHERE name LIKE '%${searchTerm}%'`;

// Why all 3 models agree:
// - Classic SQL injection pattern (textbook example)
// - All models trained on security best practices
// - Obvious vulnerability (string concatenation)

// Fix:
const query = `SELECT * FROM users WHERE name LIKE $1`;
db.query(query, [`%${searchTerm}%`]);
```

---

### STRONG Consensus (67-99% Agreement)

**What it means:**
- MOST models flagged this issue (2 out of 3)
- HIGH confidence this is a problem
- One model may have different priorities or perspective

**How to interpret:**

```
Issue: Inconsistent error messages
Consensus: STRONG (2/3 models - Claude, Grok)
Dissent: Gemini didn't flag it

Interpretation:
  ✓ Likely a real issue (2 models agree)
  ✓ Moderate to high confidence
  ✓ Worth fixing (recommended)
  ? One model (Gemini) may prioritize differently
  ? May be context-dependent (less critical in some scenarios)

Action: RECOMMENDED FIX
```

**Example:**

```typescript
// Current code (2/3 models flagged):
// File 1:
throw new Error("User not found");

// File 2:
throw new Error("Unable to locate user");

// File 3:
throw new Error("User does not exist");

// Why 2 models agree, 1 disagrees:
// - Claude & Grok: Prioritize consistency (UX, i18n)
// - Gemini: May prioritize functional issues over style

// Fix:
enum ErrorMessages {
  USER_NOT_FOUND = "User not found"
}
throw new Error(ErrorMessages.USER_NOT_FOUND);
```

---

### MAJORITY (50-66% Agreement)

**What it means:**
- HALF or slightly more models flagged this issue
- MEDIUM confidence
- Worth investigating, but may be subjective

**How to interpret:**

```
Issue: [Example not in our data, but pattern applies]
Consensus: MAJORITY (2/3 models)

Interpretation:
  ? Possibly a real issue
  ? Medium confidence
  ? Investigate and decide
  ? May be style preference vs real bug

Action: CONSIDER FIXING (case-by-case)
```

---

### DIVERGENT (< 50% Agreement)

**What it means:**
- Only 1-2 models flagged this issue
- LOW confidence
- May be model-specific perspective or false positive

**How to interpret:**

```
Issue: Missing JSDoc comments
Consensus: DIVERGENT (1/3 models - Claude only)
Dissent: Grok and Gemini didn't flag it

Interpretation:
  ? Possibly not critical (only 1 model cares)
  ? Low confidence (may be false positive)
  ? Model-specific priority (Claude prefers docs?)
  ? Optional improvement (not a bug)

Action: OPTIONAL (polish, not priority)
```

**Example:**

```typescript
// Current code (1/3 models flagged):
export async function createUser(data: CreateUserDto) {
  // ... implementation
}

// Why only Claude flagged:
// - Claude may prioritize documentation more
// - Grok & Gemini may prioritize functional issues
// - TypeScript types already provide some documentation

// Decision:
// - Not a bug (code works fine)
// - Nice to have (improves maintainability)
// - Optional refactoring (low priority)

// If you have time:
/**
 * Creates a new user in the database
 * @param data - User creation data (email, name, password)
 * @returns Promise<User> - Created user object
 */
export async function createUser(data: CreateUserDto) {
  // ... implementation
}
```

---

## Prioritization Matrix

### Action Plan by Consensus + Severity

```
┌─────────────┬───────────┬──────────┬──────────┬───────────┐
│ Consensus   │ CRITICAL  │ HIGH     │ MEDIUM   │ LOW       │
├─────────────┼───────────┼──────────┼──────────┼───────────┤
│ UNANIMOUS   │ FIX NOW   │ FIX NOW  │ FIX SOON │ CONSIDER  │
│ (100%)      │ Priority 1│ Priority 2│Priority 3│Priority 4 │
├─────────────┼───────────┼──────────┼──────────┼───────────┤
│ STRONG      │ FIX NOW   │ FIX SOON │ CONSIDER │ OPTIONAL  │
│ (67-99%)    │ Priority 2│ Priority 3│Priority 4│Priority 5 │
├─────────────┼───────────┼──────────┼──────────┼───────────┤
│ MAJORITY    │ FIX SOON  │ CONSIDER │ OPTIONAL │ SKIP      │
│ (50-66%)    │ Priority 3│ Priority 4│Priority 5│Priority 6 │
├─────────────┼───────────┼──────────┼──────────┼───────────┤
│ DIVERGENT   │ CONSIDER  │ OPTIONAL │ SKIP     │ SKIP      │
│ (< 50%)     │ Priority 4│ Priority 5│Priority 6│Priority 6 │
└─────────────┴───────────┴──────────┴──────────┴───────────┘
```

### Our Example Applied

```
Top 5 Issues (Prioritized):

1. [UNANIMOUS - CRITICAL] SQL injection → FIX NOW (Priority 1)
2. [UNANIMOUS - CRITICAL] Missing input validation → FIX NOW (Priority 1)
3. [UNANIMOUS - CRITICAL] Weak password hashing → FIX NOW (Priority 1)
4. [UNANIMOUS - HIGH] Memory leak WebSocket → FIX NOW (Priority 2)
5. [UNANIMOUS - HIGH] Missing rate limiting → FIX NOW (Priority 2)

Action Plan:
  - Fix issues 1-3 immediately (CRITICAL unanimous)
  - Fix issues 4-5 before merge (HIGH unanimous)
  - Fix issue 6 if time permits (MEDIUM unanimous)
  - Consider issue 7 (MEDIUM strong consensus)
  - Defer issues 8-9 (DIVERGENT, low priority)
```

---

## Common Patterns

### When ALL Models Agree (UNANIMOUS)

**Trust the consensus - fix it:**

```
✓ SQL injection → All 3 models = Real vulnerability
✓ Missing validation → All 3 models = Real bug
✓ Weak crypto → All 3 models = Real security issue

These are "textbook" issues that any security-aware model would catch.
```

### When MOST Models Agree (STRONG)

**Probably worth fixing:**

```
✓ 2/3 models = Likely a real issue
? 1 model disagrees = May have different priorities

Investigate: Why did one model not flag it?
  - Different training data?
  - Different security focus?
  - Different interpretation of best practices?
```

### When ONLY ONE Model Flags (DIVERGENT)

**Investigate before fixing:**

```
? 1/3 models = May be false positive
? 2 models didn't flag = May not be critical

Questions to ask:
  - Is this a real bug or style preference?
  - Is this model overly cautious?
  - Is this actually a problem in our context?

Decision:
  - If CRITICAL severity: Investigate (better safe than sorry)
  - If MEDIUM/LOW severity: Defer (likely optional)
```

---

## Example: Resolving Disagreement

**Issue:** "Insufficient error handling in payment flow"

**Models:**
- Claude: ✓ Flagged as HIGH
- Grok: ✗ Didn't flag
- Gemini: ✗ Didn't flag

**Consensus:** DIVERGENT (1/3)

**How to resolve:**

```
Step 1: Review the code
  // payment.service.ts
  async processPayment(amount: number) {
    const session = await stripe.createSession({ amount });
    return session;
  }

Step 2: Check what Claude flagged
  "Missing error handling for Stripe API failures"

Step 3: Investigate
  - Does Stripe SDK throw errors?
    → Yes (StripeError, StripeAPIError, etc.)

  - Are errors currently caught?
    → No (no try/catch)

  - Could this cause issues?
    → Yes (uncaught errors crash the app)

Step 4: Decision
  Claude is RIGHT, but why didn't Grok/Gemini flag it?

  Possible reasons:
  - Grok/Gemini assumed try/catch exists elsewhere
  - Grok/Gemini prioritized other issues
  - Grok/Gemini have different error handling standards

Step 5: Action
  FIX IT (Claude is correct, error handling is missing)

  async processPayment(amount: number) {
    try {
      const session = await stripe.createSession({ amount });
      return session;
    } catch (error) {
      if (error instanceof StripeError) {
        // Handle Stripe-specific errors
        throw new PaymentError(error.message);
      }
      throw error;
    }
  }
```

**Lesson:** Even DIVERGENT issues can be real bugs. Investigate before dismissing.

---

## Key Takeaways

**Consensus Interpretation:**

1. **UNANIMOUS (100%)** → Very high confidence, fix immediately
2. **STRONG (67-99%)** → High confidence, recommended fix
3. **MAJORITY (50-66%)** → Medium confidence, investigate
4. **DIVERGENT (< 50%)** → Low confidence, optional

**Prioritization Strategy:**

1. **Consensus + Severity** → Combined score for prioritization
2. **UNANIMOUS CRITICAL** → Always fix (top priority)
3. **DIVERGENT LOW** → Usually skip (low priority)
4. **Investigate disagreements** → Understand why models differ

**Trust the Consensus:**

- When all models agree → Very likely a real issue
- When most agree → Probably worth fixing
- When only one flags → Investigate before acting

**Use Consensus to Filter Noise:**

- Multi-model review generates lots of issues
- Consensus helps filter signal from noise
- Focus on unanimous and strong consensus first
- Divergent issues are often style preferences

With consensus analysis, you get the wisdom of multiple AI perspectives while filtering out false positives and model-specific quirks.
