---
name: debug-localization
description: 3-strategy fault localization with context budget enforcement — stack trace grep, keyword search, AST expansion. Used by /dev:debug standard path and /dev:fix.
keywords: [fault-localization, stack-trace, grep, BM25, keyword-search, AST, context-budget, mnemex, debug, localization-report]
created: 2026-03-24
updated: 2026-03-24
plugin: dev
type: discipline
difficulty: intermediate
user-invocable: false
---

# Fault Localization — 3-Strategy Methodology

**Purpose:** Identify the exact files and functions containing a bug before any fix is
attempted. This skill defines the localization methodology used by `/dev:debug` (standard
and production-grade paths). The calling command invokes strategies sequentially and
assembles results into `${SESSION_PATH}/localization.md`.

---

## Strategy Execution Order

Run all three strategies in order. Do not skip a strategy unless explicitly blocked (e.g.,
no stack trace for Strategy A). Append each strategy's results to the candidate list before
moving to the next.

```
Strategy A  →  Strategy B  →  Strategy C  →  Context Budget Check  →  Large Codebase Path (if needed)
```

---

## Strategy A — Stack Trace Grep

**Signal quality:** HIGH — attempt first, always.

**Objective:** Extract precise file and line references directly from the error's stack trace.

**Steps:**

1. Parse the stack trace for file:line patterns. Common formats:
   ```
   # Node.js / TypeScript
   at functionName (src/path/to/file.ts:42:8)

   # Go
   goroutine 1 [running]:
   main.functionName(...) /path/to/file.go:88

   # Python
   File "/path/to/file.py", line 42, in function_name

   # Rust
   src/path/to/file.rs:42:8

   # Java / JVM
   at com.example.ClassName.methodName(ClassName.java:42)
   ```

2. For each extracted file:line reference:
   - Use `Read(file_path, offset: line-20, limit: 40)` to read that line plus ±20 lines
   - Never load the full file — use `offset` and `limit` always
   - Record the candidate

3. Candidate record format:
   ```
   { file: "src/handlers/users.go", line_range: "122-162", confidence: HIGH, reason: "direct stack frame" }
   ```

**If no stack trace is present:**
- Note: "No stack trace found — skipping Strategy A, falling back to Strategy B"
- Proceed directly to Strategy B; do not block

---

## Strategy B — BM25 Keyword Search

**Signal quality:** MEDIUM — broader coverage, higher noise.

**Objective:** Surface candidates via symbol and string matching across the codebase.

**Steps:**

1. Extract search symbols from the error message and available stack trace:
   - Function names (e.g., `getUserById`, `parseConfig`)
   - Error strings (e.g., `"user not found"`, `"nil pointer dereference"`)
   - Class or type names (e.g., `UserRepository`, `ConnectionPool`)
   - Identifiers (e.g., `db.QueryRow`, `req.user`, `self.cache`)
   - Exception types (e.g., `NullPointerException`, `KeyError`, `TypeError`)

2. For each extracted symbol, run a Grep search:
   ```
   Grep(pattern: "<symbol>", path: ".", output_mode: "content", context: 2)
   ```

3. Rank results by proximity to Strategy A hits:
   - Same file as a Strategy A candidate → rank HIGH (elevated from MEDIUM)
   - Different file → rank MEDIUM
   - Test files only → rank LOW (usually symptoms, not root cause)

4. Candidate record format:
   ```
   { file: "src/repository/user.go", line_range: "85-92", confidence: MEDIUM, reason: "symbol match: db.QueryRow" }
   ```

**Symbol extraction examples:**

```
Error: "TypeError: Cannot read properties of undefined (reading 'email')"
Symbols to search: ["email", "undefined", and the function name from stack if present]

Error: "panic: runtime error: invalid memory address or nil pointer dereference"
Symbols to search: ["nil pointer", function names from goroutine stack frames]

Error: "KeyError: 'user_id'"
Symbols to search: ["user_id", function names from traceback]
```

---

## Strategy C — AST Context Expansion

**Signal quality:** DEPTH — expands known candidates to full function/class context.

**Objective:** For each file identified by Strategy A or B, expand the candidate line to its
full enclosing function or class body. This gives the downstream root-cause agent full
context for the relevant code unit without loading the entire file.

**Steps:**

1. For each unique file in the Strategy A+B candidate list:

   a. Identify the candidate line number within that file.

   b. Use `Read(file_path, offset, limit)` with function boundary detection:
      - Scan backward from the candidate line to find the function/method definition
        (look for `func `, `def `, `function `, `async function`, `class `, `fn `, etc.)
      - Scan forward from the candidate line to find the closing brace or dedent
      - Read that full range: `Read(file, offset: func_start, limit: func_end - func_start + 5)`

   c. If the candidate is inside a class method, include the class declaration line and
      the specific method — not the entire class.

2. Never read more than 150 lines per function expansion. If a function exceeds 150 lines,
   read: the function signature (5 lines), the 30 lines around the candidate, and a note
   that the function is large.

3. Record expanded context:
   ```
   { file: "src/handlers/users.go", line_range: "130-175", confidence: HIGH,
     reason: "AST expansion of GetUser handler — contains nil dereference at line 142" }
   ```

**Function boundary detection patterns by language:**

```
Go:       func\s+\w+     /  closing } at same indent
Python:   def\s+\w+      /  next def at same indent or end of file
TypeScript/JS: function\s+\w+ | async\s+\w+ | \w+\s*=\s*(async\s+)?\( / closing }
Rust:     fn\s+\w+       /  closing } at same indent
Java:     (public|private|protected|static).*\w+\s*\( / closing }
```

---

## Context Budget Enforcement

**Apply after all three strategies complete, before writing the report.**

**Budget limit:** 10,000 tokens (estimate: 1 token ≈ 4 characters)

**Steps:**

1. Estimate assembled token count:
   ```
   total_chars = sum(len(candidate.context_text) for all candidates)
   estimated_tokens = total_chars / 4
   ```

2. If `estimated_tokens > 10,000`:
   - Sort candidates by confidence: HIGH > MEDIUM > LOW
   - Discard lowest-confidence candidates one at a time until budget is met
   - For remaining candidates, replace full context with summary:
     `"[truncated — {N} lines — function: {name}, key lines: {line_range}]"`
   - Log discarded candidates in the "Alternative Locations" section

3. Target: assembled context stays under 20% of the context window.

4. Never pass entire files to downstream agents — always use line ranges with
   `Read(offset, limit)`.

**Budget priority order (keep these, discard in reverse order):**
1. Strategy A hits (stack frame — highest value)
2. Strategy B hits in same file as A (corroborating)
3. Strategy C expansions of A+B hits
4. Pure Strategy B hits in other files
5. Strategy B hits in test files only (lowest value)

---

## Large Codebase Path

**Trigger:** Grep returns >50 hits across >10 distinct files for any single symbol search.

**Action:**

1. Invoke `code-analysis:mnemex-search` skill via the Skill tool:
   ```
   Skill("code-analysis:mnemex-search", args: "<error_signature>")
   ```
   Pass the error message + primary failing symbol as the semantic search query.

2. Append high-confidence mnemex results to the candidate list with confidence MEDIUM.

3. Continue with Strategy C expansion on the mnemex-returned files.

4. Do not abandon Strategy A or B results — mnemex results supplement, not replace.

---

## Localization Report — Output Schema

Write the completed report to `${SESSION_PATH}/localization.md`:

```markdown
# Localization Report

## Top Candidates
1. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}
2. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}
3. {file}: lines {start}-{end} — {HIGH|MEDIUM|LOW} — {reason}

## Alternative Locations
{lower-ranked or budget-discarded candidates, one line each}
{empty section if none}

## Context Budget
Assembled: ~{N} tokens (target: <10,000)
Candidates retained: {N}
Candidates discarded (budget): {N}

## Strategy Coverage
A (stack trace grep): {found N candidates | skipped — no stack trace}
B (keyword search): {found N candidates | symbols searched: [list]}
C (AST expansion): {expanded N functions across N files}
Large codebase path: {invoked | not needed}
```

**Field guidance:**
- `file` — relative path from repo root (never absolute)
- `lines` — actual line numbers from `Read` output (not estimates)
- `confidence` — strictly HIGH / MEDIUM / LOW (no other values)
- `reason` — one sentence: what was found at this location and why it is suspicious
- `Context Budget` — always present, even if under limit (shows work)
- `Strategy Coverage` — always fill all four rows; "not needed" is a valid value

---

## Tools Reference

| Operation | Tool | Key Parameters |
|---|---|---|
| Read file at line range | `Read` | `offset: N`, `limit: M` |
| Search symbol in codebase | `Grep` | `pattern`, `path`, `output_mode: "content"`, `context: 2` |
| List files matching pattern | `Glob` | `pattern` |
| Semantic search (large codebase) | `Skill("code-analysis:mnemex-search")` | error signature as args |

---

## Common Pitfalls

- **Reading entire files** — always use `offset` + `limit` with `Read`; never omit them on large files
- **Over-searching** — stop Strategy B after 8 symbols; more searches rarely add signal
- **Skipping Strategy C** — the 20-line context from Strategy A is rarely enough for root cause; always expand
- **Including test files as top candidates** — test files show the symptom, not the cause; rank them LOW
- **Forgetting to enforce the budget** — always check token estimate before writing the report
