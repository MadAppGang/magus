# Parallel Multi-Model Review Example

**Scenario:** User requests "Review my changes with Grok and Gemini"

**Skills Used:**
- `multi-model-validation` (4-Message Pattern, parallel execution, consensus)
- `quality-gates` (cost approval, consensus prioritization)
- `todowrite-orchestration` (10-task workflow tracking)
- `error-recovery` (timeout handling, partial success)

**Outcome:** 3 AI models review code in parallel (5 minutes instead of 15), consensus-based issue prioritization

---

## User Request

```
User: "Review my authentication code with multiple AI models"
```

## Orchestrator Execution

### Message 1: Preparation (Bash Only)

```bash
# Create workspace
mkdir -p ai-docs/reviews

# Gather code context
git diff > ai-docs/code-review-context.md

# Count lines for cost estimation
wc -l ai-docs/code-review-context.md
# Output: 450 lines
```

**Cost Calculation:**

```
Input Tokens (per model):
  - Code context: 450 lines × 1.5 = 675 tokens
  - Review instructions: 200 tokens
  - Total input per model: ~875 tokens

Output Tokens (per model):
  - Expected output: 2,000 - 4,000 tokens
  - Average: 3,000 tokens

Total Cost (3 models):
  - Input: 3 × 875 = 2,625 tokens (~$0.0003)
  - Output: 3 × 3,000 = 9,000 tokens (~$0.0045)
  - Total: ~$0.0048 (range: $0.003 - $0.007)
```

---

### Message 2: User Approval Gate (Quality-Gates)

**Present to user:**

```
Multi-model code review will analyze 450 lines of code with 3 AI models:

1. Claude Sonnet (embedded, free)
2. Grok Code Fast (external, $0.001)
3. Gemini 2.5 Flash (external, $0.0008)

Estimated total cost: $0.005 ($0.003 - $0.007)
Expected duration: ~5 minutes

Proceed with multi-model review? (Yes/No)
```

**User Response:** "Yes"

---

### Message 3: Parallel Execution (Task Only - Multi-Model-Validation)

**Initialize TodoWrite (TodoWrite-Orchestration):**

```
TodoWrite: Create task list
  [ ] PHASE 1: Prepare review context
  [ ] PHASE 2: Launch Claude review
  [ ] PHASE 2: Launch Grok review
  [ ] PHASE 2: Launch Gemini review
  [ ] PHASE 3: Consolidate reviews
  [ ] PHASE 4: Present results
```

**Launch 3 Reviews in Parallel:**

```
Task: senior-code-reviewer
  Prompt: "Review ai-docs/code-review-context.md for security issues.
           Focus on:
           - Input validation
           - SQL injection risks
           - Authentication/authorization
           - Error handling
           - Security best practices

           Write detailed review to ai-docs/reviews/claude-review.md
           Return only brief summary (2-3 sentences)."

---

Task: codex-code-reviewer PROXY_MODE: x-ai/grok-code-fast-1
  Prompt: "Review ai-docs/code-review-context.md for security issues.
           Focus on:
           - Input validation
           - SQL injection risks
           - Authentication/authorization
           - Error handling
           - Security best practices

           Write detailed review to ai-docs/reviews/grok-review.md
           Return only brief summary (2-3 sentences)."

---

Task: codex-code-reviewer PROXY_MODE: google/gemini-2.5-flash
  Prompt: "Review ai-docs/code-review-context.md for security issues.
           Focus on:
           - Input validation
           - SQL injection risks
           - Authentication/authorization
           - Error handling
           - Security best practices

           Write detailed review to ai-docs/reviews/gemini-review.md
           Return only brief summary (2-3 sentences)."
```

**All 3 tasks execute simultaneously** (true parallel execution via 4-Message Pattern)

**TodoWrite Updates:**

```
T=0s:
  [✓] PHASE 1: Prepare review context
  [→] PHASE 2: Launch Claude review (in_progress)
  [→] PHASE 2: Launch Grok review (in_progress)
  [→] PHASE 2: Launch Gemini review (in_progress)
  [ ] PHASE 3: Consolidate reviews
  [ ] PHASE 4: Present results

T=60s: Claude completes first
  [✓] PHASE 2: Launch Claude review (completed)
  [→] PHASE 2: Launch Grok review (in_progress)
  [→] PHASE 2: Launch Gemini review (in_progress)
  User sees: "1/3 reviews complete..."

T=90s: Gemini completes
  [✓] PHASE 2: Launch Gemini review (completed)
  [→] PHASE 2: Launch Grok review (in_progress)
  User sees: "2/3 reviews complete..."

T=120s: Grok completes
  [✓] PHASE 2: Launch Grok review (completed)
  User sees: "All 3 reviews complete! Consolidating..."
```

**Returned Summaries:**

```
Claude: "Review complete. Found 3 CRITICAL, 5 HIGH, 8 MEDIUM issues. See ai-docs/reviews/claude-review.md"

Grok: "Security review done. Identified 2 CRITICAL, 4 HIGH, 10 MEDIUM concerns. Details in ai-docs/reviews/grok-review.md"

Gemini: "Analysis finished. Detected 3 CRITICAL, 6 HIGH, 7 MEDIUM problems. Full report: ai-docs/reviews/gemini-review.md"
```

---

### Message 4: Auto-Consolidation (Multi-Model-Validation)

**Check Results:**

```
results.length = 3 (all succeeded)
3 ≥ 2 ✓ (threshold met, proceed with consolidation)
```

**Launch Consolidation Agent:**

```
Task: senior-code-reviewer
  Prompt: "Consolidate 3 code reviews from:
           - ai-docs/reviews/claude-review.md
           - ai-docs/reviews/grok-review.md
           - ai-docs/reviews/gemini-review.md

           Apply consensus analysis:
           - Issues flagged by ALL 3 models → UNANIMOUS (VERY HIGH confidence)
           - Issues flagged by 2 models → STRONG (HIGH confidence)
           - Issues flagged by 1 model → DIVERGENT (LOW confidence)

           Prioritize by:
           1. Consensus level (unanimous first)
           2. Severity (CRITICAL first)

           Create issue matrix showing which models agree on which issues.
           Write consolidated report to ai-docs/consolidated-review.md"
```

**Consolidation Output:**

```markdown
# Consolidated Code Review - 3 AI Models

**Models:** Claude Sonnet, Grok Code Fast, Gemini 2.5 Flash
**Lines Analyzed:** 450
**Total Issues Found:** 23 unique issues
**Duration:** 5 minutes

## Top 5 Issues (Prioritized by Consensus + Severity)

### 1. [UNANIMOUS - CRITICAL] SQL Injection in User Search

**Severity:** CRITICAL
**Consensus:** UNANIMOUS (3/3 models)
**Models:** Claude ✓, Grok ✓, Gemini ✓

**Description:**
The search endpoint constructs SQL queries using string concatenation with user input, creating a SQL injection vulnerability.

**Location:** `src/routes/users.ts` line 45

**Current Code:**
```typescript
const query = `SELECT * FROM users WHERE name LIKE '%${searchTerm}%'`;
```

**Recommended Fix:**
Use parameterized queries:
```typescript
const query = `SELECT * FROM users WHERE name LIKE $1`;
db.query(query, [`%${searchTerm}%`]);
```

---

### 2. [UNANIMOUS - CRITICAL] Missing Input Validation on User Creation

**Severity:** CRITICAL
**Consensus:** UNANIMOUS (3/3 models)
**Models:** Claude ✓, Grok ✓, Gemini ✓

**Description:**
POST /api/users endpoint accepts user input without validation, allowing malformed data to reach the database.

**Location:** `src/routes/users.ts` line 23

**Recommended Fix:**
Add validation schema using Zod or similar.

---

### 3. [STRONG - HIGH] Weak Password Hashing

**Severity:** HIGH
**Consensus:** STRONG (2/3 models)
**Models:** Claude ✓, Grok ✓, Gemini ✗

**Description:**
bcrypt rounds set to 8, which is too low for modern security standards. Recommended: 12+ rounds.

**Location:** `src/services/auth.ts` line 34

---

### 4. [MAJORITY - MEDIUM] Missing Rate Limiting

**Severity:** MEDIUM
**Consensus:** MAJORITY (2/3 models)
**Models:** Claude ✓, Grok ✗, Gemini ✓

**Description:**
Authentication endpoints lack rate limiting, vulnerable to brute force attacks.

**Location:** `src/routes/auth.ts`

---

### 5. [DIVERGENT - LOW] Code Style Inconsistency

**Severity:** LOW
**Consensus:** DIVERGENT (1/3 models)
**Models:** Claude ✓, Grok ✗, Gemini ✗

**Description:**
Mix of async/await and .then() promise handling.

**Note:** Only one model flagged this. Consider optional refactoring.

---

## Issue Matrix

| Issue | Claude | Grok | Gemini | Consensus |
|-------|--------|------|--------|-----------|
| SQL injection in search | ✓ | ✓ | ✓ | UNANIMOUS |
| Missing input validation | ✓ | ✓ | ✓ | UNANIMOUS |
| Weak password hashing | ✓ | ✓ | ✗ | STRONG |
| Missing rate limiting | ✓ | ✗ | ✓ | MAJORITY |
| Insufficient error handling | ✓ | ✓ | ✗ | STRONG |
| Code style inconsistency | ✓ | ✗ | ✗ | DIVERGENT |

## Summary

**UNANIMOUS Issues (3/3 models):** 2 issues → MUST FIX
**STRONG Consensus (2/3 models):** 4 issues → RECOMMENDED
**DIVERGENT (1/3 models):** 3 issues → OPTIONAL

**Action Plan:**
1. Fix 2 unanimous CRITICAL issues immediately
2. Address 4 strong consensus issues before merging
3. Consider divergent issues as polish opportunities
```

---

### Message 5: Present Results (Quality-Gates)

**Present to User:**

```
Multi-model code review complete! 3 AI models analyzed 450 lines in 5 minutes.

Top 5 Issues (Consensus-Based Priority):

1. [UNANIMOUS - CRITICAL] SQL Injection in User Search
   ALL 3 models agree: Fix immediately

2. [UNANIMOUS - CRITICAL] Missing Input Validation on User Creation
   ALL 3 models agree: Fix immediately

3. [STRONG - HIGH] Weak Password Hashing (bcrypt rounds too low)
   2/3 models agree: Recommended fix

4. [MAJORITY - MEDIUM] Missing Rate Limiting on Auth Endpoints
   2/3 models agree: Consider fixing

5. [DIVERGENT - LOW] Code Style Inconsistency
   1/3 model flagged: Optional refactoring

See ai-docs/consolidated-review.md for complete analysis.

Actual cost: $0.0052 (within estimate of $0.003 - $0.007)

Would you like me to fix the CRITICAL issues now? (Yes/No)
```

---

## Key Takeaways

**Skills in Action:**

1. **Multi-Model-Validation:**
   - 4-Message Pattern achieved true parallelism (5 min vs 15 min sequential)
   - Consensus analysis prioritized issues (unanimous → strong → divergent)
   - Cost transparency gave user control

2. **Quality-Gates:**
   - User approval before expensive operation ($0.005 cost)
   - Severity classification (CRITICAL → HIGH → MEDIUM → LOW)
   - Consensus-based prioritization (unanimous issues are MUST FIX)

3. **TodoWrite-Orchestration:**
   - Real-time progress visibility (1/3, 2/3, 3/3 reviews complete)
   - User knew what was happening at all times

4. **Error-Recovery:**
   - All 3 models succeeded (no timeouts or failures in this example)
   - But pattern is ready to handle partial success (e.g., if Grok timed out)

**Results:**

- **3x speedup** (5 minutes vs 15+ sequential)
- **Consensus-based prioritization** (unanimous issues are MUST FIX)
- **Cost transparency** ($0.0052 actual vs $0.005 estimate)
- **Actionable results** (clear fix recommendations)

**User Experience:**

- Knew cost before execution (approval gate)
- Saw real-time progress (1/3, 2/3, 3/3 complete)
- Got prioritized issues (unanimous first)
- Clear next steps (fix CRITICAL, consider others)
