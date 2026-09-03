---
name: multi-model-validation
description: Runs the same task across multiple AI models in parallel and aggregates verdicts. Use when the user wants a second opinion, multi-expert validation, or consensus from Grok, Gemini, GPT-5, or Kimi.
user-invocable: false
---

# Multi-Model Validation

**Version:** 3.3.0
**Purpose:** Patterns for running multiple AI models in parallel via Claudish proxy with **context-aware preferences**, dynamic model discovery, session-based workspaces, and performance statistics
**Status:** Production Ready

## Overview

Multi-model validation is the practice of running multiple AI models (Grok, Gemini, GPT-5, DeepSeek, etc.) in parallel to validate code, designs, or implementations from different perspectives. This achieves:

- **3-5x speedup** via parallel execution (15 minutes → 5 minutes)
- **Consensus-based prioritization** (issues flagged by all models are CRITICAL)
- **Diverse perspectives** (different models catch different issues)
- **Cost transparency** (know before you spend)
- **Free model discovery** (NEW v3.0) - find high-quality free models from trusted providers
- **Performance tracking** - identify slow/failing models for future exclusion
- **Data-driven recommendations** - optimize model shortlist based on historical performance

**Key Innovations:**

1. **Context-Aware Preferences** (NEW v3.3.0) - Automatically use saved model preferences per task type (debug/research/coding/review) from `.claude/multimodel-team.json`
2. **Dynamic Model Discovery** (v3.0) - Read the live catalog (`list_models`) for current available models (live, 24h cache)
3. **Session-Based Workspaces** (v3.0) - Each validation session gets a unique directory to prevent conflicts
4. **4-Message Pattern** - Ensures true parallel execution by using only Agent tool calls in a single message
5. **Pattern 7-8** - Statistics collection and data-driven model recommendations

This skill is extracted from the `/review` command and generalized for use in any multi-model workflow.

---

## ⚠️ MANDATORY: Learn and Reuse User Preferences

> **Model preferences are learned per context and reused automatically.**
>
> - First time a context is used → ASK user → SAVE to that context
> - Next time same context → VALIDATE the saved IDs against `list_models`, then use
>   the survivors automatically (no asking). "No asking" applies to the *selection*,
>   never to the catalog check — saved IDs go stale and must be re-checked every run.
> - User explicitly says "change models" or "different models" → ASK and UPDATE

```bash
# FIRST STEP - Read preferences file
cat .claude/multimodel-team.json 2>/dev/null
```

**Flow:**

```
1. Detect context from task keywords
   - "debug", "error", "bug", "fix" → debug
   - "research", "analyze", "investigate" → research
   - "implement", "build", "create", "code" → coding
   - "review", "audit", "check" → review

2. Check if contextPreferences[context] exists and is non-empty

   IF EXISTS (has models saved):
   → Call: list_models (claudish MCP) and KEEP ONLY the saved IDs it still lists
     Saved preferences are user policy, not a catalog snapshot — they go stale
     silently. This applies to defaultModels and contextPreferences alike; see
     claudish:claudish-usage → "Every field of the preferences file is untrusted"
   → Name every dropped ID in your reply
   → DO NOT ask the user to re-pick while at least one saved ID survives
   → If NOTHING survives, say so and offer live alternatives

   IF EMPTY/MISSING (first time for this context):
   → Call: list_models (claudish MCP — current models, pricing, capabilities)
   → Ask user to select models (AskUserQuestion)
   → Save to contextPreferences[context]
   → Proceed with validation

3. User override triggers (explicit request to change):
   - "use different models"
   - "change models"
   - "update model preferences"
   → Ask user to select new models
   → Update contextPreferences[context]
```

**Example - Learning Flow:**

```
# First debug task ever:
Task: "Debug this authentication error"
→ Context: debug
→ contextPreferences.debug is empty
→ ASK: "Which models for debug tasks?"
→ User selects: grok, glm, minimax
→ SAVE to contextPreferences.debug
→ Run with those models

# Second debug task:
Task: "Debug the API timeout"
→ Context: debug
→ contextPreferences.debug = ["grok", "glm", "minimax"]
→ USE directly (no asking)
→ Run with saved models

# User wants to change:
Task: "Debug this error, use different models"
→ Detected: "different models" override trigger
→ ASK: "Which models for debug tasks?"
→ User selects: gemini, LATEST_GPT_MODEL
→ UPDATE contextPreferences.debug
→ Run with new models
```

---

## Related Skills

> **CRITICAL: Tracking Protocol Required**
>
> Before using any patterns in this skill, ensure you have completed the
> pre-launch setup from `multimodel:model-tracking-protocol`.
>
> Launching models without tracking setup = INCOMPLETE validation.

**Cross-References:**

- **multimodel:model-tracking-protocol** - MANDATORY tracking templates and protocols (NEW in v0.6.0)
  - Pre-launch checklist (8 required items)
  - Tracking table templates
  - Failure documentation format
  - Results presentation template
- **multimodel:quality-gates** - Approval gates and severity classification
- **multimodel:task-orchestration** - Progress tracking during execution
- **multimodel:error-recovery** - Handling failures and retries

**Skill Integration:**

This skill (`multi-model-validation`) defines **execution patterns** (how to run models in parallel).
The `model-tracking-protocol` skill defines **tracking infrastructure** (how to collect and present results).

**Use both together:**
```yaml
skills: multimodel:multi-model-validation, multimodel:model-tracking-protocol
```

---

## Core Patterns

### Pattern 0: Session Setup and Model Discovery (NEW v3.0)

**Purpose:** Create isolated session workspace and discover available models dynamically.

**Why Session-Based Workspaces:**

Using a fixed directory like `ai-docs/reviews/` causes problems:
- ❌ Multiple sessions overwrite each other's files
- ❌ Stale data from previous sessions pollutes results
- ❌ Hard to track which files belong to which session

Instead, create a **unique session directory** for each validation:

```bash
# Generate unique session ID
TARGET_SLUG=$(echo "${TASK_NAME:-review}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
SESSION_ID="review-${TARGET_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
SESSION_DIR="ai-docs/sessions/${SESSION_ID}"

# Create session workspace
mkdir -p "$SESSION_DIR"

echo "Session: $SESSION_ID"
echo "Directory: $SESSION_DIR"

# Example output:
# Session: review-auth-impl-20251212-143052-a3f2
# Directory: ai-docs/sessions/review-auth-impl-20251212-143052-a3f2
```

**Benefits:**
- ✅ Each session is isolated (no cross-contamination)
- ✅ Traceable - can associate files with a specific session
- ✅ Session ID can be used for tracking in statistics
- ✅ Parallel sessions don't conflict
- ✅ Aligned with the `dev:dev` session pattern
- ✅ Committed to git for audit trail (unlike `/tmp/`)

> **⚠️ Do NOT use `/tmp/` for session directories.** Files in `/tmp/` are not
> traceable, not committable, and parallel runs will overwrite each other.

---

**Dynamic Model Discovery:**

**NEVER hardcode model lists.** Models change frequently — new ones appear, old ones deprecate, pricing updates. Instead, read the live catalog (`list_models`) for current available models:

Call the `list_models` MCP tool (claudish). It returns the current recommended
set — model IDs, pricing, context window, capabilities, and the `provider@model`
access prefixes — served from claudish’s catalog with a 24-hour cache.

For every live variant in one family, call `search_models` with the family name.

**Recommended Free Models for Code Review:**

| Model | Provider | Context | Capabilities | Why Good |
|-------|----------|---------|--------------|----------|
| `qwen/LATEST_FREE_CODING_MODEL` | Qwen | 262K | Tools ✓ | Coding-specialized, large context |
| `mistralai/LATEST_FREE_CODING_MODEL` | Mistral | 262K | Tools ✓ | Dev-focused, excellent for code |
| `qwen/LATEST_FREE_REASONING_MODEL` | Qwen | 131K | Tools ✓ Reasoning ✓ | Massive 235B model, reasoning |

**Model Selection Flow (Learn and Reuse):**

```
1. Read Preferences File
   → cat .claude/multimodel-team.json
   → If file NOT exists → create empty one

2. Detect Task Context
   → Parse task for keywords (case-insensitive):
     - "debug", "error", "bug", "fix", "trace", "issue" → debug
     - "research", "investigate", "analyze", "explore", "find" → research
     - "implement", "build", "create", "code", "develop", "feature" → coding
     - "review", "audit", "check", "validate", "verify" → review
   → If no keywords match → context = "default"

3. Check for Override Triggers in User Message
   → "use different models", "change models", "update preferences"
   → If found → force_ask = true

4. Load or Learn Models
   → models = contextPreferences[context]

   IF models exist AND NOT force_ask:
     → USE models directly (no asking)
     → Go to step 6

   IF models empty OR force_ask:
     → Read: the live catalog (list_models)
     → AskUserQuestion with multiSelect
     → Save user selection to contextPreferences[context]
     → Go to step 6

5. Save Updated Preferences
   → Write .claude/multimodel-team.json
   → Update lastUpdated timestamp

6. Execute with Models
   → Launch parallel validation
   → No further confirmation needed
```

**Context Keywords:**

| Context | Keywords |
|---------|----------|
| debug | debug, error, bug, fix, trace, issue |
| research | research, investigate, analyze, explore, find |
| coding | implement, build, create, code, develop, feature |
| review | review, audit, check, validate, verify |

**Override Triggers (force re-selection):**
- "use different models"
- "change models"
- "update model preferences"
- "select new models"

### Routing is Claudish's

**Send the `id` from `list_models`. Never build an address.** Claudish owns backend
selection, credentials and fallback; this repo implements none of it.

A prefix/backend/key table used to sit here. It is deleted — it had drifted to the wrong
separator (`/` where claudish uses `@`), listed alias env vars as if canonical, covered a
third of the providers, and marked models "collision-free" that had since gained a direct
provider. A second copy in `claudish-usage` had drifted differently, which is the point:
restating claudish's routing anywhere in this repo guarantees two versions of the truth and
no way to tell which is stale.

If a model will not route, that is a claudish bug — report it with `report_error`. Do not
work around it by choosing a different prefix here.

**Interactive Model Selection (AskUserQuestion with multiSelect):**

**CRITICAL:** Use AskUserQuestion tool with `multiSelect: true` to let users choose models interactively. This provides a better UX than just showing recommendations.

```typescript
// Use AskUserQuestion to let user select models
AskUserQuestion({
  questions: [{
    question: "Which external models should validate your code? (Internal Claude reviewer always included)",
    header: "Models",
    multiSelect: true,
    options: [
      // Top paid (from the live catalog (list_models) + historical data)
      {
        label: "grok ⚡",
        description: "$0.85/1M | Quality: 87% | Avg: 42s | Fast + accurate"
      },
      {
        label: "gemini",
        description: "$7.00/1M | Quality: 91% | Avg: 55s | High accuracy"
      },
      // Free models — filter the list_models result by pricing
      {
        label: "qwen/LATEST_FREE_CODING_MODEL 🆓",
        description: "FREE | Quality: 82% | 262K context | Coding-specialized"
      },
      {
        label: "mistralai/LATEST_FREE_CODING_MODEL 🆓",
        description: "FREE | 262K context | Dev-focused, new model"
      }
    ]
  }]
})
```

**Remember Selection for Session:**

Store the user's model selection in the session directory so it persists throughout the validation:

```bash
# After user selects models, save to session
save_session_models() {
  local session_dir="$1"
  shift
  local models=("$@")

  # Always include internal reviewer
  echo "claude-embedded" > "$session_dir/selected-models.txt"

  # Add user-selected models
  for model in "${models[@]}"; do
    echo "$model" >> "$session_dir/selected-models.txt"
  done

  echo "Session models saved to $session_dir/selected-models.txt"
}

# Load session models for subsequent operations
load_session_models() {
  local session_dir="$1"
  cat "$session_dir/selected-models.txt"
}

# Usage:
# After AskUserQuestion returns selected models
save_session_models "$SESSION_DIR" "grok" "qwen/LATEST_FREE_CODING_MODEL"

# Later in the session, retrieve the selection
MODELS=$(load_session_models "$SESSION_DIR")
```

**Session Model Memory Structure:**

```
$SESSION_DIR/
├── selected-models.txt    # User's model selection (persists for session)
├── claude-review.md       # Internal review
├── grok-review.md         # External review (if selected)
├── qwen-coder-review.md   # External review (if selected)
└── consolidated-review.md # Final consolidated review
```

**Why Remember the Selection:**

1. **Re-runs**: If validation needs to be re-run, use same models
2. **Consistency**: All phases of validation use identical model set
3. **Audit trail**: Know which models produced which results
4. **Cost tracking**: Accurate cost attribution per session

**Always Include Internal Reviewer:**

```
BEST PRACTICE: Always run internal Claude reviewer alongside external models.

Why?
✓ FREE (embedded Claude, no API costs)
✓ Fast baseline (usually fastest)
✓ Provides comparison point
✓ Works even if ALL external models fail
✓ Consistent behavior (same model every time)

The internal reviewer should NEVER be optional - it's your safety net.

In the code-review panels `dev` dispatches — where claudish is optional — it is not a
claudish slot. Launch it as its own
`Agent(subagent_type: "dev:reviewer", run_in_background: false, …)` in the SAME message
as the `team` call, carrying the contract lines — `TARGET: BRANCH`, `FOCUS:`, its own
`OUTPUT:` path, and `MODELS:` naming the externals. Never seat it in that team's `models`
list. Its return is in your hands: list its OUTPUT file on REVIEWS: whether or not it
carries a `**Verdict**:` line — the synthesizer counts a file with no verdict as
no-verdict, never as one more approval. (`/team` itself, where claudish is a hard
dependency, seats it as the `internal` slot instead — Pattern 3 states the rule.)
```

---

### Pattern 1: The 4-Message Pattern (MANDATORY)

This pattern is **CRITICAL** for achieving true parallel execution with multiple AI models.

**Why This Pattern Exists:**

Claude Code executes tools **sequentially by default** when different tool types are mixed in the same message. To achieve true parallelism, you MUST:
1. Use ONLY one tool type per message
2. Ensure all Agent calls are in a single message
3. Separate preparation (Bash) from execution (Task) from presentation

**The Pattern:**

```
Message 1: Preparation (Bash Only)
  - Create workspace directories
  - Validate inputs (check if claudish installed)
  - Write the brief (input.md) — never a pre-computed diff: every reviewer is
    handed `TARGET: BRANCH` and captures its own surfaces through dev's
    `capture-review-surfaces.ts`
  - NO Agent calls
  - NO Tasks calls

Message 2: Parallel Execution (the internal Agent call and ONE team call, same message)
  - `Agent(subagent_type: "dev:reviewer", run_in_background: false, …)` — the
    internal reviewer, always present, carrying the contract lines
  - Every external model in a single `team` MCP call; the tool parallelises them
    internally. In a dev-dispatched panel the internal reviewer is never a
    `models` entry (Pattern 3 — `/team` itself seats it as the `internal` slot)
  - Pass require_pattern whenever the prompt mandates an output shape
  - (A pure-Agent fan-out with no external models still obeys the
     one-tool-type-per-message rule above)

Message 3: Auto-Consolidation (Task Only)
  - Automatically triggered when the panel settles — at N = 1 too, where the
    synthesizer passes the single review through with a `VERDICT:` line (Pattern 5)
  - Launch `dev:synthesizer` — the only consolidator; it reads reviews, never code
  - Pass every review file path on REVIEWS:, the three lines under 'Apply verdict
    thresholds' in `dev:reviewer`'s agent file on THRESHOLDS: — read at dispatch
    time, never recalled — and the consolidated file on OUTPUT: (Pattern 5)
  - Consensus analysis is the synthesizer's; never send the reviews to dev:reviewer

Message 4: Present Results
  - Show user prioritized issues
  - Include consensus levels (unanimous, strong, majority)
  - Link to detailed reports
  - Cost summary (if applicable)
```

**Example: 5-Model Parallel Code Review**

```
Message 1: Preparation (Session Setup + Model Discovery)
  # Create unique session workspace
  Bash: SESSION_ID="review-$(date +%Y%m%d-%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
  Bash: SESSION_DIR="ai-docs/sessions/${SESSION_ID}" && mkdir -p "$SESSION_DIR"
  # No code capture here. Every reviewer is handed TARGET: BRANCH and runs dev's
  # capture-review-surfaces.ts itself, in BRANCH mode. A range computed here would
  # be one more hand-rolled diff, which is the one thing no dispatcher may do.

  # Discover available models
  MCP:  list_models   # current models, pricing, capabilities

  # User selects models via AskUserQuestion (see Pattern 0)

Message 2: Start the panel (the internal Agent call and ONE team call, same message)
  Bash: write the brief to "$SESSION_DIR/input.md" — the contract lines every
        external gets: TARGET: BRANCH / FOCUS: code / MODELS: none

  Agent(
    subagent_type: "dev:reviewer",
    run_in_background: false,
    description: "Internal code review",
    prompt: "TARGET: BRANCH
             FOCUS: code
             OUTPUT: $SESSION_DIR/claude-review.md
             MODELS: grok,LATEST_FREE_CODING_MODEL,gpt,LATEST_FREE_REASONING_MODEL"
  )
  ---
  claudish team(mode="run", path=$SESSION_DIR,
    models=["grok", "LATEST_FREE_CODING_MODEL", "gpt", "LATEST_FREE_REASONING_MODEL"],
    input_file="$SESSION_DIR/input.md",
    require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)", agent="dev:reviewer")

  All 5 reviewers run at once: the Agent is the always-present internal reviewer,
  and the team tool parallelises the four externals internally. The internal
  reviewer is never a `models` entry — its return is in your hands, and its OUTPUT
  file goes on REVIEWS: whether or not it carries a `**Verdict**:` line; the
  synthesizer counts a file with no verdict as no-verdict, never as approval.

  The team call RETURNS IMMEDIATELY with a slots map. It does not carry the reviews.

Message 2b: Poll to completion
  claudish team(mode="status", path=$SESSION_DIR)
  # repeat until no slot in `models` has state === "RUNNING"
  # bound the loop; read idle_seconds_by_slot with activity_by_slot before
  # concluding a quiet slot is stuck

Message 3: Auto-Consolidation
  (Automatically triggered - don't wait for user to request)

  # The internal reviewer wrote $SESSION_DIR/claude-review.md. The team run wrote
  # one file per external slot, $SESSION_DIR/response-NN.md, named by
  # ANONYMOUS slot id rather than by model, because the vote is blind. Do not try
  # to attribute a file to a model before the verdict is in. The synthesizer is
  # the only consolidator: it is given the reviews and never the code, and no
  # reviewer ever sees another reviewer's output.

  Agent(
    subagent_type: "dev:synthesizer",
    run_in_background: false,
    description: "Consolidate code reviews",
    prompt: "REVIEWS: $SESSION_DIR/claude-review.md
             $SESSION_DIR/response-01.md
             $SESSION_DIR/response-02.md
             $SESSION_DIR/response-03.md
             $SESSION_DIR/response-04.md
             THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                          dev:reviewer's agent file, read at dispatch time, never
                          recalled>
             OUTPUT: $SESSION_DIR/consolidated-review.md
             Consolidate with consensus levels (unanimous / strong / majority / divergent).
             Compute the verdict line from your counts against THRESHOLDS.
             You are given reviews, never code. Do not review."
  )

Message 4: Present Results + Update Statistics
  # Track performance for each model (see Pattern 7)
  track_model_performance "claude-embedded" "success" 32 8 95
  track_model_performance "grok" "success" 45 6 87
  track_model_performance "qwen/LATEST_FREE_CODING_MODEL" "success" 52 5 82
  track_model_performance "gpt" "success" 68 7 89
  track_model_performance "mistralai/LATEST_FREE_CODING_MODEL" "success" 48 5 84

  # Record session summary
  record_session_stats 5 5 0 68 245 3.6

  "Multi-model code review complete! 5 AI models analyzed your code.
   Session: $SESSION_ID

   Top 5 Issues (Prioritized by Consensus):
   1. [UNANIMOUS] Missing input validation on POST /api/users
   2. [UNANIMOUS] SQL injection risk in search endpoint
   3. [STRONG] Weak password hashing (bcrypt rounds too low)
   4. [MAJORITY] Missing rate limiting on authentication endpoints
   5. [MAJORITY] Insufficient error handling in payment flow

   Model Performance (this session):
   | Model                          | Time | Issues | Quality | Cost   |
   |--------------------------------|------|--------|---------|--------|
   | claude-embedded                | 32s  | 8      | 95%     | FREE   |
   | grok          | 45s  | 6      | 87%     | $0.002 |
   | qwen/LATEST_FREE_CODING_MODEL          | 52s  | 5      | 82%     | FREE   |
   | gpt        | 68s  | 7      | 89%     | $0.015 |
   | mistralai/LATEST_FREE_CODING_MODEL   | 48s  | 5      | 84%     | FREE   |

   Parallel Speedup: 3.6x (245s sequential → 68s parallel)

   See $SESSION_DIR/consolidated-review.md for complete analysis.
   Performance logged to ai-docs/llm-performance.json"
```

**Performance Impact:**

- Sequential execution: 5 models × 3 min = 15 minutes
- Parallel execution: max(model times) ≈ 5 minutes
- **Speedup: 3x with perfect parallelism**

---

### Pattern 2: Parallel Execution Architecture

**Single Message, Multiple Tasks:**

The key to parallel execution is putting ALL Agent calls in a **single message** with the `---` delimiter:

```
✅ CORRECT - Parallel Execution:

Agent: <agent-1>
  Prompt: "Task 1 instructions"
---
Agent: <agent-2>
  Prompt: "Task 2 instructions"
---
Agent: <agent-3>
  Prompt: "Task 3 instructions"

All 3 execute simultaneously.
```

**Anti-Pattern: Sequential Execution**

```
❌ WRONG - Sequential Execution:

Message 1:
  Agent: <agent-1>
Message 2:
  Agent: <agent-2>
Message 3:
  Agent: <agent-3>
Each task waits for previous to complete (3x slower).
```

**Independent Tasks Requirement:**

Each Task must be **independent** (no dependencies):

```
✅ CORRECT - Independent:
  Task: review code for security
  Task: review code for performance
  Task: review code for style

  All can run simultaneously (same input, different perspectives).

❌ WRONG - Dependent:
  Task: implement feature
  Task: write tests for feature (depends on implementation)
  Task: review implementation (depends on tests)

  Must run sequentially (each needs previous output).
```

**Unique Output Files:**

Each Task MUST write to a **unique output file** within the session directory:

```
✅ CORRECT - Unique Files in Session Directory:
  Task: reviewer1 → $SESSION_DIR/claude-review.md
  Task: reviewer2 → $SESSION_DIR/grok-review.md
  Task: reviewer3 → $SESSION_DIR/qwen-coder-review.md

❌ WRONG - Shared File:
  Task: reviewer1 → $SESSION_DIR/review.md
  Task: reviewer2 → $SESSION_DIR/review.md (overwrites reviewer1!)
  Task: reviewer3 → $SESSION_DIR/review.md (overwrites reviewer2!)

❌ WRONG - Fixed Directory (not session-based):
  Task: reviewer1 → ai-docs/reviews/claude-review.md  # May conflict with other sessions!
```

**Wait for All Before Consolidation:**

Do NOT consolidate until ALL tasks complete:

```
✅ CORRECT - Wait for All:
  Launch: Task1, Task2, Task3, Task4 (parallel)
  Wait: All 4 complete
  Check: results.filter(r => r.status === 'fulfilled').length
  If >= 1: Dispatch dev:synthesizer (a passthrough with a verdict at N = 1);
           if any failed, also offer to retry them
  If 0:    Offer retry or abort

❌ WRONG - Premature Consolidation:
  Launch: Task1, Task2, Task3, Task4
  After 30s: Task1, Task2 done
  Consolidate: Only Task1 + Task2 (Task3, Task4 still running!)
```

---

### Pattern 3: Model Invocation via claudish MCP

**How models are invoked:**

External models are invoked via claudish MCP tools. The orchestrator calls the MCP tools
directly; no Bash invocation is needed. This is 100% reliable.

**Where the native reviewer sits — one rule.** It is a claudish `internal` slot when
claudish is a hard dependency of the dispatcher, and a separate `Agent(…)` call when
claudish is optional.

- **`/team` itself** — the `multimodel` plugin declares claudish as a dependency, so
  `internal` goes in the `models` list of the ONE `team` call and gets the same
  `require_pattern` shape check as every external. That procedure lives in this
  plugin's own `commands/team.md` (Step 2 onward) and is not restated here.
- **The code-review panels `dev` dispatches** (`/dev:dev` Phase 5, `/dev:audit`,
  `/dev:fix` Phase B) — claudish is optional there and the panel may be empty, so the
  internal reviewer is an always-present
  `Agent(subagent_type: "dev:reviewer", run_in_background: false, …)` issued in the
  same message as the `team` call, carrying the contract lines. Every code-review
  example in this skill is this case.

**For a dev-dispatched code-review panel:** write the brief to `input.md`, start the
internal Agent and the panel in one message, poll the panel to completion, then read
the externals' reviews off disk.
````
Agent(subagent_type: "dev:reviewer", run_in_background: false,
  description: "Internal code review",
  prompt: "TARGET: BRANCH\nFOCUS: code\nOUTPUT: ${SESSION_DIR}/claude-review.md\nMODELS: grok,gemini")
---
team(mode="run", path=SESSION_DIR, models=["grok", "gemini"],
  input_file=`${SESSION_DIR}/input.md`,
  require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)", agent="dev:reviewer")
  // → { started: true, slots: { "grok": "01", "gemini": "02" }, ... }

team(mode="status", path=SESSION_DIR)   // until no slot has state === "RUNNING"
  // → read `${SESSION_DIR}/response-<slot>.md` for each slot
````

The `team` tool runs all models in parallel internally. **`run` does not wait and does not
return the answers** — it starts the slots and hands back the slot map. Per-model status
(`state`, `exitCode`, `outputSize`, `error.reason`) comes from a settled `status` response.
There is no `timeout` parameter any more, and passing one is silently ignored. Full procedure: `claudish:claudish-usage` → "The three-step lifecycle". Requires claudish >= 8.0.0.

**In a dev-dispatched panel the internal reviewer is never a `models` entry.** It runs as
the Agent above — on the host session, with the dev plugin loaded, so `TARGET: BRANCH`
resolves through dev's own capture script — and its return is in the dispatcher's hands.
Its file goes on REVIEWS: whether or not it carries a verdict line; the synthesizer counts
a file with no verdict as no-verdict, never as one more approval.

**`require_pattern` is what turns exit 0 into a real success check.** A slot that finished
without producing the required shape is reported FAILED (state EMPTY, reason
`shape_mismatch`) instead of counted as a success. Exit code 0 also occurs on API errors and
on a child that simply ignored the format, so without this the panel can report a verdict it
never actually received.

**For single-model delegation:**
```
create_session(model="grok", prompt=TASK_PROMPT, timeout_seconds=300)
→ channel events: session_started → tool_executing → completed/failed
→ get_output(session_id) to retrieve result
```

**Verification:**
- `team` tool: check `status.models[<slot>].state` on a SETTLED `status` response — never
  the `run` response, which returns before any model has answered
- `create_session`: The `completed` channel event confirms success; `failed` provides error details

### Correct Pattern Example

````
// ✅ CORRECT (dev-dispatched panel): the internal reviewer as its own Agent, every external in ONE team call — same message
Agent({ subagent_type: "dev:reviewer", run_in_background: false,
        description: "Internal code review",
        prompt: "TARGET: BRANCH\nFOCUS: code\nOUTPUT: ${SESSION_DIR}/claude-review.md\nMODELS: grok,gemini" })
team(mode="run", path=SESSION_DIR,
  models=["grok", "gemini"],
  input_file=`${SESSION_DIR}/input.md`,
  require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)", agent="dev:reviewer")

// …then poll, then read the externals' reviews from response-<slot>.md
team(mode="status", path=SESSION_DIR)
````

```
// ❌ WRONG: the native reviewer fired into the background, its file read by nobody
Agent({ subagent_type: "dev:reviewer", run_in_background: true,
        prompt: "Review the change...\n\nWrite to: session/internal-result.md" })
```

The internal reviewer runs `run_in_background: false` so that its return — and whether its
OUTPUT file carries a `**Verdict**:` line — is in hand before the synthesizer is dispatched.
It goes on REVIEWS: either way; the synthesizer counts a file with no verdict as no-verdict,
never as approval. A background Agent's file is read by nobody until it is too late. (For
`/team` itself the correct form is the `internal` slot — `commands/team.md`, per the rule
above.)

---

### Pattern 4: Cost Estimation and Transparency

**Input/Output Token Separation:**

Provide separate estimates for input and output tokens:

```
Cost Estimation for Multi-Model Review:

Input Tokens (per model):
  - Code context: 500 lines × 1.5 = 750 tokens
  - Review instructions: 200 tokens
  - Total input per model: ~1000 tokens
  - Total input (5 models): 5,000 tokens

Output Tokens (per model):
  - Expected output: 2,000 - 4,000 tokens
  - Total output (5 models): 10,000 - 20,000 tokens

Cost Calculation (example rates):
  - Input: 5,000 tokens × $0.0001/1k = $0.0005
  - Output: 15,000 tokens × $0.0005/1k = $0.0075 (3-5x more expensive)
  - Total: $0.0080 (range: $0.0055 - $0.0105)

User Approval Gate:
  "Multi-model review will cost approximately $0.008 ($0.005 - $0.010).
   Proceed? (Yes/No)"
```

**Input Token Estimation Formula:**

```
Input Tokens = (Code Lines × 1.5) + Instruction Tokens

Why 1.5x multiplier?
  - Code lines: ~1 token per line (average)
  - Context overhead: +50% (imports, comments, whitespace)

Example:
  500 lines of code → 500 × 1.5 = 750 tokens
  + 200 instruction tokens = 950 tokens total input
```

**Output Token Estimation Formula:**

```
Output Tokens = Base Estimate + Complexity Factor

Base Estimates by Task Type:
  - Code review: 2,000 - 4,000 tokens
  - Design validation: 1,000 - 2,000 tokens
  - Architecture planning: 3,000 - 6,000 tokens
  - Bug investigation: 2,000 - 5,000 tokens

Complexity Factors:
  - Simple (< 100 lines code): Use low end of range
  - Medium (100-500 lines): Use mid-range
  - Complex (> 500 lines): Use high end of range

Example:
  400 lines of complex code → 4,000 tokens (high complexity)
  50 lines of simple code → 2,000 tokens (low complexity)
```

**Range-Based Estimates:**

Always provide a **range** (min-max), not a single number:

```
✅ CORRECT - Range:
  "Estimated cost: $0.005 - $0.010 (depends on review depth)"

❌ WRONG - Single Number:
  "Estimated cost: $0.0075"
  (User surprised when actual is $0.0095)
```

**Why Output Costs More:**

Output tokens are typically **3-5x more expensive** than input tokens:

```
Example Pricing (OpenRouter):
  - Grok: $0.50 / 1M input, $1.50 / 1M output (3x difference)
  - Gemini Flash: $0.10 / 1M input, $0.40 / 1M output (4x difference)
  - GPT-5 Codex: $1.00 / 1M input, $5.00 / 1M output (5x difference)

Impact:
  If input = 5,000 tokens, output = 15,000 tokens:
    Input cost: $0.0005
    Output cost: $0.0075 (15x higher despite only 3x more tokens)
    Total: $0.0080 (94% is output!)
```

**User Approval Before Execution:**

ALWAYS ask for user approval before expensive operations:

```
Present to user:
  "You selected 5 AI models for code review:
   - Claude Sonnet (embedded, free)
   - Grok Code Fast (external, $0.002)
   - Gemini 2.5 Flash (external, $0.001)
   - GPT-5 Codex (external, $0.004)
   - DeepSeek Coder (external, $0.001)

   Estimated total cost: $0.008 ($0.005 - $0.010)

   Proceed with multi-model review? (Yes/No)"

If user says NO:
  Offer alternatives:
    1. Use only free embedded Claude
    2. Select fewer models
    3. Cancel review

If user says YES:
  Proceed with Message 2 (parallel execution)
```

---

### Pattern 5: Auto-Consolidation Logic

**Automatic Trigger:**

Consolidation happens **automatically** as soon as the panel settles — at N = 1 as well
as N ≥ 2. `dev:synthesizer` is the only writer of the consolidated report; at N = 1 it
passes the single review through unchanged and appends the `VERDICT:` line, so the
output has one shape whatever N is:

```
✅ CORRECT - Auto-Trigger:

const results = await Promise.allSettled([task1, task2, task3, task4, task5]);
const successful = results.filter(r => r.status === 'fulfilled');
const failed = results.length - successful.length;

if (successful.length >= 1) {
  // Auto-trigger consolidation (DON'T wait for user to ask). N = 1 is a passthrough with a verdict.
  const reviewPaths = successful.map((r) => r.value.reviewFile); // one review file per slot
  const consolidated = await Agent({
    subagent_type: "dev:synthesizer",
    run_in_background: false,     // formatResults() consumes the return value
    description: "Consolidate code reviews",
    prompt: `REVIEWS: ${reviewPaths.join("\n")}
THRESHOLDS: <the three lines under 'Apply verdict thresholds' in dev:reviewer's agent file, read at dispatch time, never recalled>
OUTPUT: ${SESSION_DIR}/consolidated-review.md
Consolidate with consensus levels (unanimous / strong / majority / divergent).
Compute the verdict line from your counts against THRESHOLDS.
You are given reviews, never code. Do not review.`
  });

  if (failed > 0) {
    // An addition to the dispatch above, never a substitute for it
    notifyUser(`${failed} of ${results.length} models failed. Retry them and re-consolidate?`);
  }
  return formatResults(consolidated);
} else {
  // All failed — there is nothing to pass through
  notifyUser("All models failed. Check logs and retry?");
}

❌ WRONG - Wait for User:

const results = await Promise.allSettled([...]);
const successful = results.filter(r => r.status === 'fulfilled');

// Present results to user
notifyUser("3 reviews complete. Would you like me to consolidate them?");
// Waits for user to request consolidation...

❌ WRONG - Skip the synthesizer at N = 1:

if (successful.length >= 2) {
  await consolidate();
} else {
  notifyUser("Only 1 model succeeded. See single review or retry?");
  // The raw review carries no VERDICT: line and not the shape every other dispatcher reads
}
```

**Why Auto-Trigger:**

- Better UX (no extra user prompt needed)
- Faster workflow (no wait for user response)
- Expected behavior (user assumes consolidation is part of workflow)

**N = 1 is a passthrough, not a skip:**

Consensus levels need at least two reviews; the consolidated report does not. At N = 1
the synthesizer emits the single review unchanged — no `[CONSENSUS: …]` tags, nothing
reworded — followed by the `VERDICT:` line computed from that review's own counts against
THRESHOLDS, so the dispatcher still gets the one file its gate reads. The only dispatcher
that skips the synthesizer at N = 1 is `/dev:fix` Phase B, whose output is a vote tally,
and a single vote is its own tally:

```
if (successful.length >= 1) {
  // Dispatch dev:synthesizer: consolidation at N ≥ 2, passthrough with a verdict at N = 1
  if (successful.length < results.length) {
    // In addition, not instead
    notifyUser("Some models failed. Retry the failures and re-consolidate?");
  }
} else {
  // All failed
  notifyUser("All models failed. Check logs and retry?");
}
```

**Pass All Review File Paths:**

`dev:synthesizer` needs the path of EVERY review file, one per `REVIEWS:` line. It
reads the reviews and never the code, so the paths are all it gets:

```
Agent(
  subagent_type: "dev:synthesizer",
  run_in_background: false,
  description: "Consolidate code reviews",
  prompt: "REVIEWS: $SESSION_DIR/claude-review.md
           $SESSION_DIR/grok-review.md
           $SESSION_DIR/qwen-coder-review.md
           THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                        dev:reviewer's agent file, read at dispatch time, never
                        recalled>
           OUTPUT: $SESSION_DIR/consolidated-review.md
           Consolidate with consensus levels (unanimous / strong / majority / divergent).
           Compute the verdict line from your counts against THRESHOLDS.
           You are given reviews, never code. Do not review."
)
```

**Don't Inline Full Reviews:**

```
❌ WRONG - Inline Reviews (context pollution):
  Prompt: "Consolidate these reviews:

           Claude Review:
           [500 lines of review content]

           Grok Review:
           [500 lines of review content]

           Qwen Review:
           [500 lines of review content]"

✅ CORRECT - File Paths in Session Directory:
  prompt: "REVIEWS: $SESSION_DIR/claude-review.md
           $SESSION_DIR/grok-review.md
           $SESSION_DIR/qwen-coder-review.md
           THRESHOLDS: ...
           OUTPUT: $SESSION_DIR/consolidated-review.md
           ..."
```

---

### Pattern 6: Consensus Analysis

**Consensus Levels:**

Classify issues by how many models flagged them:

```
Consensus Levels (for N models):

UNANIMOUS (100% agreement):
  - All N models flagged this issue
  - VERY HIGH confidence
  - MUST FIX priority

STRONG CONSENSUS (67-99% agreement):
  - Most models flagged this issue (⌈2N/3⌉ to N-1)
  - HIGH confidence
  - RECOMMENDED priority

MAJORITY (50-66% agreement):
  - Half or more models flagged this issue (⌈N/2⌉ to ⌈2N/3⌉-1)
  - MEDIUM confidence
  - CONSIDER priority

DIVERGENT (< 50% agreement):
  - Only 1-2 models flagged this issue
  - LOW confidence
  - OPTIONAL priority (may be model-specific perspective)
```

**Example: 5 Models**

```
Issue Flagged By:              Consensus Level:    Priority:
─────────────────────────────────────────────────────────────
All 5 models                   UNANIMOUS (100%)    MUST FIX
4 models                       STRONG (80%)        RECOMMENDED
3 models                       MAJORITY (60%)      CONSIDER
2 models                       DIVERGENT (40%)     OPTIONAL
1 model                        DIVERGENT (20%)     OPTIONAL
```

**Keyword-Based Matching (v1.0):**

Simple consensus analysis using keyword matching:

```
Algorithm:

1. Extract issues from each review
2. For each unique issue:
   a. Identify keywords (e.g., "SQL injection", "input validation")
   b. Check which other reviews mention same keywords
   c. Count models that flagged this issue
   d. Assign consensus level

Example:

Claude Review: "Missing input validation on POST /api/users"
Grok Review: "Input validation absent in user creation endpoint"
Gemini Review: "No validation for user POST endpoint"

Keywords: ["input validation", "POST", "/api/users", "user"]
Match: All 3 reviews mention these keywords
Consensus: UNANIMOUS (3/3 = 100%)
```

**Model Agreement Matrix:**

Show which models agree on which issues:

```
Issue Matrix:

Issue                             Claude  Grok  Gemini  GPT-5  DeepSeek  Consensus
──────────────────────────────────────────────────────────────────────────────────
SQL injection in search              ✓      ✓     ✓       ✓       ✓      UNANIMOUS
Missing input validation             ✓      ✓     ✓       ✓       ✗      STRONG
Weak password hashing                ✓      ✓     ✓       ✗       ✗      MAJORITY
Missing rate limiting                ✓      ✓     ✗       ✗       ✗      DIVERGENT
Insufficient error handling          ✓      ✗     ✗       ✗       ✗      DIVERGENT
```

**Prioritized Issue List:**

Sort issues by consensus level, then by severity:

```
Top 10 Issues (Prioritized):

1. [UNANIMOUS - CRITICAL] SQL injection in search endpoint
   Flagged by: Claude, Grok, Gemini, GPT-5, DeepSeek (5/5)

2. [UNANIMOUS - HIGH] Missing input validation on POST /api/users
   Flagged by: Claude, Grok, Gemini, GPT-5, DeepSeek (5/5)

3. [STRONG - HIGH] Weak password hashing (bcrypt rounds too low)
   Flagged by: Claude, Grok, Gemini, GPT-5 (4/5)

4. [STRONG - MEDIUM] Missing rate limiting on auth endpoints
   Flagged by: Claude, Grok, Gemini, GPT-5 (4/5)

5. [MAJORITY - MEDIUM] Insufficient error handling in payment flow
   Flagged by: Claude, Grok, Gemini (3/5)

... (remaining issues)
```

**Future Enhancement (v1.1+): Semantic Similarity**

```
Instead of keyword matching, use semantic similarity:
  - Embed issue descriptions with sentence-transformers
  - Calculate cosine similarity between embeddings
  - Issues with >0.8 similarity are "same issue"
  - More accurate consensus detection
```

---

### Pattern 7: Statistics Collection and Analysis

**Purpose**: Track model performance to help users identify slow or poorly-performing models for future exclusion.

**Storage Location**: `ai-docs/llm-performance.json` (persistent across all sessions)

**When to Collect Statistics:**
- After each model completes (success, failure, or timeout)
- During consolidation phase (quality scores)
- At session end (session summary)

**File Structure (ai-docs/llm-performance.json):**

```json
{
  "schemaVersion": "2.0.0",
  "lastUpdated": "2025-12-12T10:45:00Z",
  "models": {
    "claude-embedded": {
      "modelId": "claude-embedded",
      "provider": "Anthropic",
      "isFree": true,
      "pricing": "FREE (embedded)",
      "totalRuns": 12,
      "successfulRuns": 12,
      "failedRuns": 0,
      "totalExecutionTime": 420,
      "avgExecutionTime": 35,
      "minExecutionTime": 28,
      "maxExecutionTime": 52,
      "totalIssuesFound": 96,
      "avgQualityScore": 92,
      "totalCost": 0,
      "qualityScores": [95, 90, 88, 94, 91],
      "lastUsed": "2025-12-12T10:35:22Z",
      "trend": "stable",
      "history": [
        {
          "timestamp": "2025-12-12T10:35:22Z",
          "session": "review-20251212-103522-a3f2",
          "status": "success",
          "executionTime": 32,
          "issuesFound": 8,
          "qualityScore": 95,
          "cost": 0
        }
      ]
    },
    "x-ai-grok": {
      "modelId": "grok",
      "provider": "X-ai",
      "isFree": false,
      "pricing": "$0.85/1M",
      "totalRuns": 10,
      "successfulRuns": 9,
      "failedRuns": 1,
      "totalCost": 0.12,
      "trend": "improving"
    },
    "LATEST_FREE_CODING_MODEL": {
      "modelId": "LATEST_FREE_CODING_MODEL",
      "provider": "Qwen",
      "isFree": true,
      "pricing": "FREE",
      "totalRuns": 5,
      "successfulRuns": 5,
      "failedRuns": 0,
      "totalCost": 0,
      "trend": "stable"
    }
  },
  "sessions": [
    {
      "sessionId": "review-20251212-103522-a3f2",
      "timestamp": "2025-12-12T10:35:22Z",
      "totalModels": 4,
      "successfulModels": 3,
      "failedModels": 1,
      "parallelTime": 120,
      "sequentialTime": 335,
      "speedup": 2.8,
      "totalCost": 0.018,
      "freeModelsUsed": 2
    }
  ],
  "recommendations": {
    "topPaid": ["grok", "gemini"],
    "topFree": ["qwen/LATEST_FREE_CODING_MODEL", "mistralai/LATEST_FREE_CODING_MODEL"],
    "bestValue": ["grok"],
    "avoid": [],
    "lastGenerated": "2025-12-12T10:45:00Z"
  }
}
```

**Key Benefits of Persistent Storage:**
- Track model reliability over time (not just one session)
- Identify consistently slow models
- Calculate historical success rates
- Generate data-driven shortlist recommendations

**How to Calculate Quality Score:**

Quality = % of model's issues that appear in unanimous or strong consensus

```
quality_score = (issues_in_unanimous + issues_in_strong) / total_issues * 100

Example:
- Model found 10 issues
- 4 appear in unanimous consensus
- 3 appear in strong consensus
- Quality = (4 + 3) / 10 * 100 = 70%
```

Higher quality means the model finds issues other models agree with.

**How to Calculate Parallel Speedup:**

```
speedup = sum(all_execution_times) / max(execution_time)

Example:
- Claude: 32s
- Grok: 45s
- Gemini: 38s
- GPT-5: 120s

Sequential would take: 32 + 45 + 38 + 120 = 235s
Parallel took: max(32, 45, 38, 120) = 120s
Speedup: 235 / 120 = 1.96x
```

**Performance Statistics Display Format:**

```markdown
## Model Performance Statistics

| Model                     | Time   | Issues | Quality | Status    |
|---------------------------|--------|--------|---------|-----------|
| claude-embedded           | 32s    | 8      | 95%     | ✓         |
| grok     | 45s    | 6      | 85%     | ✓         |
| gemini   | 38s    | 5      | 90%     | ✓         |
| gpt   | 120s   | 9      | 88%     | ✓ (slow)  |
| deepseek/deepseek-chat    | TIMEOUT| 0      | -       | ✗         |

**Session Summary:**
- Parallel Speedup: 1.96x (235s sequential → 120s parallel)
- Average Time: 59s
- Slowest: gpt (2.0x avg)

**Recommendations:**
⚠️ gpt runs 2x slower than average - consider removing
⚠️ deepseek-chat timed out - check API status or remove from shortlist
✓ Top performers: claude-embedded, gemini (fast + high quality)
```

**Recommendation Logic:**

```
1. Flag SLOW models:
   if (model.executionTime > 2 * avgExecutionTime) {
     flag: "⚠️ Runs 2x+ slower than average"
     suggestion: "Consider removing from shortlist"
   }

2. Flag FAILED/TIMEOUT models:
   if (model.status !== "success") {
     flag: "⚠️ Failed or timed out"
     suggestion: "Check API status or increase timeout"
   }

3. Identify TOP PERFORMERS:
   if (model.qualityScore > 85 && model.executionTime < avgExecutionTime) {
     highlight: "✓ Top performer (fast + high quality)"
   }

4. Suggest SHORTLIST:
   sortedModels = models.sort((a, b) => {
     // Quality/speed ratio: higher quality + lower time = better
     scoreA = a.qualityScore / (a.executionTime / avgExecutionTime)
     scoreB = b.qualityScore / (b.executionTime / avgExecutionTime)
     return scoreB - scoreA
   })
   shortlist = sortedModels.slice(0, 3)
```

**Implementation (writes to ai-docs/llm-performance.json):**

```bash
# Track model performance after each model completes
# Updates historical aggregates and adds to run history
# Parameters: model_id, status, duration, issues, quality_score, cost, is_free
track_model_performance() {
  local model_id="$1"
  local status="$2"
  local duration="$3"
  local issues="${4:-0}"
  local quality_score="${5:-}"
  local cost="${6:-0}"
  local is_free="${7:-false}"

  local perf_file="ai-docs/llm-performance.json"
  local model_key=$(echo "$model_id" | tr '/:' '-')  # Handle colons in free model names

  # Initialize file if doesn't exist
  [[ -f "$perf_file" ]] || echo '{"schemaVersion":"2.0.0","models":{},"sessions":[],"recommendations":{}}' > "$perf_file"

  jq --arg model "$model_key" \
     --arg model_full "$model_id" \
     --arg status "$status" \
     --argjson duration "$duration" \
     --argjson issues "$issues" \
     --arg quality "${quality_score:-null}" \
     --argjson cost "$cost" \
     --argjson is_free "$is_free" \
     --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     --arg session "${SESSION_ID:-unknown}" \
     '
     # Initialize model if not exists
     .models[$model] //= {"modelId":$model_full,"provider":"unknown","isFree":$is_free,
       "totalRuns":0,"successfulRuns":0,"failedRuns":0,
       "totalExecutionTime":0,"avgExecutionTime":0,"minExecutionTime":null,"maxExecutionTime":null,
       "totalIssuesFound":0,"avgQualityScore":null,"qualityScores":[],"totalCost":0,
       "lastUsed":null,"trend":"new","history":[]} |

     # Update aggregates
     .models[$model].totalRuns += 1 |
     .models[$model].successfulRuns += (if $status == "success" then 1 else 0 end) |
     .models[$model].failedRuns += (if $status != "success" then 1 else 0 end) |
     .models[$model].totalExecutionTime += $duration |
     .models[$model].avgExecutionTime = ((.models[$model].totalExecutionTime / .models[$model].totalRuns) | floor) |
     .models[$model].totalIssuesFound += $issues |
     .models[$model].totalCost += $cost |
     .models[$model].isFree = $is_free |
     .models[$model].lastUsed = $now |

     # Update min/max
     .models[$model].minExecutionTime = ([.models[$model].minExecutionTime, $duration] | map(select(. != null)) | min) |
     .models[$model].maxExecutionTime = ([.models[$model].maxExecutionTime, $duration] | max) |

     # Update quality scores and trend (if provided)
     (if $quality != "null" then
       .models[$model].qualityScores += [($quality|tonumber)] |
       .models[$model].avgQualityScore = ((.models[$model].qualityScores|add) / (.models[$model].qualityScores|length) | floor) |
       # Calculate trend (last 3 vs previous 3)
       (if (.models[$model].qualityScores | length) >= 6 then
         ((.models[$model].qualityScores[-3:] | add) / 3) as $recent |
         ((.models[$model].qualityScores[-6:-3] | add) / 3) as $previous |
         .models[$model].trend = (if ($recent - $previous) > 5 then "improving"
           elif ($recent - $previous) < -5 then "degrading"
           else "stable" end)
       else . end)
     else . end) |

     # Add to history (keep last 20)
     .models[$model].history = ([{"timestamp":$now,"session":$session,"status":$status,
       "executionTime":$duration,"issuesFound":$issues,"cost":$cost,
       "qualityScore":(if $quality != "null" then ($quality|tonumber) else null end)}] + .models[$model].history)[:20] |

     .lastUpdated = $now
     ' "$perf_file" > "${perf_file}.tmp" && mv "${perf_file}.tmp" "$perf_file"
}

# Usage examples:
# Paid models
track_model_performance "grok" "success" 45 6 87 0.002 false
track_model_performance "gpt" "success" 68 7 89 0.015 false

# Free models (cost=0, is_free=true)
track_model_performance "qwen/LATEST_FREE_CODING_MODEL" "success" 52 5 82 0 true
track_model_performance "mistralai/LATEST_FREE_CODING_MODEL" "success" 48 5 84 0 true

# Embedded Claude (always free)
track_model_performance "claude-embedded" "success" 32 8 95 0 true

# Failed/timeout models
track_model_performance "some-model" "timeout" 120 0 "" 0 false
```

**Record Session Summary:**

```bash
record_session_stats() {
  local total="$1" success="$2" failed="$3"
  local parallel_time="$4" sequential_time="$5" speedup="$6"
  local total_cost="${7:-0}" free_models_used="${8:-0}"

  local perf_file="ai-docs/llm-performance.json"
  [[ -f "$perf_file" ]] || echo '{"schemaVersion":"2.0.0","models":{},"sessions":[],"recommendations":{}}' > "$perf_file"

  jq --arg session "${SESSION_ID:-unknown}" \
     --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     --argjson total "$total" --argjson success "$success" --argjson failed "$failed" \
     --argjson parallel "$parallel_time" --argjson sequential "$sequential_time" --argjson speedup "$speedup" \
     --argjson cost "$total_cost" --argjson free_count "$free_models_used" \
     '.sessions = ([{"sessionId":$session,"timestamp":$now,"totalModels":$total,
       "successfulModels":$success,"failedModels":$failed,"parallelTime":$parallel,
       "sequentialTime":$sequential,"speedup":$speedup,"totalCost":$cost,
       "freeModelsUsed":$free_count}] + .sessions)[:50] | .lastUpdated = $now' \
     "$perf_file" > "${perf_file}.tmp" && mv "${perf_file}.tmp" "$perf_file"
}

# Usage:
# record_session_stats total success failed parallel_time sequential_time speedup total_cost free_count
record_session_stats 5 5 0 68 245 3.6 0.017 2
```

**Get Recommendations from Historical Data:**

```bash
get_model_recommendations() {
  local perf_file="ai-docs/llm-performance.json"
  [[ -f "$perf_file" ]] || { echo "No performance data yet."; return; }

  jq -r '
    (.models | to_entries | map(select(.value.successfulRuns > 0) | .value.avgExecutionTime) | add / length) as $avg |
    {
      "overallAvgTime": ($avg | floor),
      "slowModels": [.models | to_entries[] | select(.value.avgExecutionTime > ($avg * 2)) | .key],
      "unreliableModels": [.models | to_entries[] | select(.value.totalRuns >= 3 and (.value.failedRuns / .value.totalRuns) > 0.3) | .key],
      "topPaidPerformers": [.models | to_entries | map(select(.value.avgQualityScore != null and .value.avgQualityScore > 80 and .value.isFree == false and .value.avgExecutionTime <= $avg)) | sort_by(-.value.avgQualityScore)[:3] | .[].key],
      "topFreePerformers": [.models | to_entries | map(select(.value.avgQualityScore != null and .value.avgQualityScore > 75 and .value.isFree == true)) | sort_by(-.value.avgQualityScore)[:3] | .[].key],
      "bestValue": [.models | to_entries | map(select(.value.avgQualityScore != null and .value.totalCost > 0)) | sort_by(-(.value.avgQualityScore / (.value.totalCost / .value.totalRuns)))[:2] | .[].key],
      "degradingModels": [.models | to_entries[] | select(.value.trend == "degrading") | .key]
    }
  ' "$perf_file"
}

# Display formatted recommendations
display_recommendations() {
  local perf_file="ai-docs/llm-performance.json"
  [[ -f "$perf_file" ]] || { echo "No performance data yet. Run some validations first!"; return; }

  echo "## Model Recommendations (based on historical data)"
  echo ""

  # Top paid performers
  echo "### 💰 Top Paid Models"
  jq -r '.models | to_entries | map(select(.value.isFree == false and .value.avgQualityScore != null)) | sort_by(-.value.avgQualityScore)[:3] | .[] | "- \(.value.modelId): Quality \(.value.avgQualityScore)%, Avg \(.value.avgExecutionTime)s, Cost $\(.value.totalCost | . * 100 | floor / 100)"' "$perf_file"
  echo ""

  # Top free performers
  echo "### 🆓 Top Free Models"
  jq -r '.models | to_entries | map(select(.value.isFree == true and .value.avgQualityScore != null and .key != "claude-embedded")) | sort_by(-.value.avgQualityScore)[:3] | .[] | "- \(.value.modelId): Quality \(.value.avgQualityScore)%, Avg \(.value.avgExecutionTime)s"' "$perf_file"
  echo ""

  # Models to avoid
  echo "### ⚠️ Consider Avoiding"
  jq -r '
    (.models | to_entries | map(select(.value.successfulRuns > 0) | .value.avgExecutionTime) | add / length) as $avg |
    .models | to_entries[] |
    select(
      (.value.avgExecutionTime > ($avg * 2)) or
      (.value.totalRuns >= 3 and (.value.failedRuns / .value.totalRuns) > 0.3) or
      (.value.trend == "degrading")
    ) |
    "- \(.key): " +
    (if .value.avgExecutionTime > ($avg * 2) then "⏱️ Slow (2x+ avg)" else "" end) +
    (if .value.totalRuns >= 3 and (.value.failedRuns / .value.totalRuns) > 0.3 then " ❌ Unreliable (>\(.value.failedRuns)/\(.value.totalRuns) failures)" else "" end) +
    (if .value.trend == "degrading" then " 📉 Quality degrading" else "" end)
  ' "$perf_file"
}
```

---

### Pattern 8: Data-Driven Model Selection (NEW v3.0)

**Purpose:** Use historical performance data to make intelligent model selection recommendations.

**The Problem:**

Users often select models arbitrarily or based on outdated information:
- "I'll use GPT-5 because it's famous"
- "Let me try this new model I heard about"
- "I'll use the same 5 models every time"

**The Solution:**

Use accumulated performance data to recommend:
1. **Top performers** (highest quality scores)
2. **Best value** (quality/cost ratio)
3. **Top free models** (high quality, zero cost)
4. **Models to avoid** (slow, unreliable, or degrading)

**Model Selection Algorithm:**

```
1. Load historical data from ai-docs/llm-performance.json

2. Calculate metrics for each model:
   - Success Rate = successfulRuns / totalRuns × 100
   - Quality Score = avgQualityScore (from consensus analysis)
   - Speed Score = avgExecutionTime relative to overall average
   - Value Score = avgQualityScore / (totalCost / totalRuns)

3. Categorize models:
   TOP PAID: Quality > 80%, Success > 90%, Speed <= avg
   TOP FREE: Quality > 75%, Success > 90%, isFree = true
   BEST VALUE: Highest Quality/Cost ratio among paid models
   AVOID: Speed > 2x avg OR Success < 70% OR trend = "degrading"

4. Present recommendations with context:
   - Show historical metrics
   - Highlight trends (improving/stable/degrading)
   - Flag new models with insufficient data
```

**Interactive Model Selection with Recommendations:**

Instead of just displaying recommendations, use AskUserQuestion with multiSelect to let users interactively choose:

```typescript
// Build options from the live catalog (claudish list_models MCP tool) + history
const catalog    = await listModels();   // [{ id, pricing, context, capabilities }, ...]
const paidModels = catalog.filter((m) => m.pricing?.average > 0);
const freeModels = catalog.filter((m) => !m.pricing?.average);
const history = loadPerformanceHistory();        // ai-docs/llm-performance.json

// Merge and build AskUserQuestion options
AskUserQuestion({
  questions: [{
    question: "Select models for validation (Claude internal always included). Based on 25 sessions across 8 models.",
    header: "Models",
    multiSelect: true,
    options: [
      // Top paid with historical data
      {
        label: "grok ⚡ (Recommended)",
        description: "$0.85/1M | Quality: 87% | Avg: 42s | Fast + accurate"
      },
      {
        label: "gemini 🎯",
        description: "$7.00/1M | Quality: 91% | Avg: 55s | High accuracy"
      },
      // Top free models
      {
        label: "qwen/LATEST_FREE_CODING_MODEL 🆓",
        description: "FREE | Quality: 82% | 262K | Coding-specialized"
      },
      {
        label: "mistralai/LATEST_FREE_CODING_MODEL 🆓",
        description: "FREE | Quality: 84% | 262K | Dev-focused"
      }
      // Note: Models to AVOID are simply not shown in options
      // Note: New models show "(new)" instead of quality score
    ]
  }]
})
```

**Key Principles for Model Selection UI:**

1. **Put recommended models first** with "(Recommended)" suffix
2. **Include historical metrics** in description (Quality %, Avg time)
3. **Mark free models** with 🆓 emoji
4. **Don't show models to avoid** - just exclude them from options
5. **Mark new models** with "(new)" when no historical data
6. **Remember selection** - save to `$SESSION_DIR/selected-models.txt`

**After Selection - Save to Session:**

```bash
# User selected: grok, LATEST_FREE_CODING_MODEL
# Save for session persistence
save_session_models "$SESSION_DIR" "${USER_SELECTED_MODELS[@]}"

# Now $SESSION_DIR/selected-models.txt contains:
# claude-embedded
# grok
# qwen/LATEST_FREE_CODING_MODEL
```

**Warning Display (separate from selection):**

If there are models to avoid, show a brief warning before the selection:

```
⚠️ Models excluded from selection (poor historical performance):
- gpt: Slow (2.1x avg)
- some-model: 60% success rate
```

**Automatic Shortlist Generation:**

```bash
# Generate optimal shortlist based on criteria
generate_shortlist() {
  local criteria="${1:-balanced}"  # balanced, quality, budget, free-only
  local perf_file="ai-docs/llm-performance.json"

  case "$criteria" in
    "balanced")
      # 1 internal + 1 fast paid + 1 free
      echo "claude-embedded"
      jq -r '.models | to_entries | map(select(.value.isFree == false and .value.avgQualityScore > 80)) | sort_by(.value.avgExecutionTime)[0].key' "$perf_file"
      jq -r '.models | to_entries | map(select(.value.isFree == true and .key != "claude-embedded" and .value.avgQualityScore > 75)) | sort_by(-.value.avgQualityScore)[0].key' "$perf_file"
      ;;
    "quality")
      # Top 3 by quality regardless of cost
      echo "claude-embedded"
      jq -r '.models | to_entries | map(select(.value.avgQualityScore != null and .key != "claude-embedded")) | sort_by(-.value.avgQualityScore)[:2] | .[].key' "$perf_file"
      ;;
    "budget")
      # Internal + 2 cheapest performers
      echo "claude-embedded"
      jq -r '.models | to_entries | map(select(.value.avgQualityScore > 75 and .value.isFree == true)) | sort_by(-.value.avgQualityScore)[:2] | .[].key' "$perf_file"
      ;;
    "free-only")
      # Only free models
      echo "claude-embedded"
      jq -r '.models | to_entries | map(select(.value.isFree == true and .key != "claude-embedded" and .value.avgQualityScore != null)) | sort_by(-.value.avgQualityScore)[:2] | .[].key' "$perf_file"
      ;;
  esac
}

# Usage:
generate_shortlist "balanced"   # For most use cases
generate_shortlist "quality"    # When accuracy is critical
generate_shortlist "budget"     # When cost matters
generate_shortlist "free-only"  # Zero-cost validation
```

**Integration with Model Discovery:**

```
Workflow:
1. Call `list_models` (claudish MCP) → current models, pricing, capabilities
2. Load ai-docs/llm-performance.json → Get historical performance
3. Merge data:
   - New models (no history): Mark as "🆕 New"
   - Known models: Show performance metrics
   - Deprecated models: Filter out (absent from the live catalog)
4. Generate recommendations
5. Present to user with AskUserQuestion
```

**Why This Matters:**

| Selection Method | Outcome |
|------------------|---------|
| Random/arbitrary | Hit-or-miss, may waste money on slow models |
| Always same models | Miss new better options, stuck with degrading ones |
| Data-driven | Optimal quality/cost/speed balance, continuous improvement |

Over time, the system learns which models work best for YOUR codebase and validation patterns.

---

## Integrating Statistics in Your Plugin

**To add LLM performance tracking to your plugin's commands:**

### Step 1: Reference This Skill
Add to your command's frontmatter:
```yaml
skills: multimodel:multi-model-validation
```

### Step 2: Track Each Model Execution
After each external model completes:
```bash
# Parameters: model_id, status, duration_seconds, issues_found, quality_score
track_model_performance "grok" "success" 45 6 85
```

### Step 3: Record Session Summary
At the end of multi-model execution:
```bash
# Parameters: total, successful, failed, parallel_time, sequential_time, speedup
record_session_stats 4 3 1 120 335 2.8
```

### Step 4: Display Statistics
In your finalization phase, show:
1. This session's model performance table
2. Historical performance (if ai-docs/llm-performance.json exists)
3. Recommendations for slow/unreliable models

### Example Integration (in command.md)

```xml
<phase name="External Review">
  <steps>
    <step>Record start time: PHASE_START=$(date +%s)</step>
    <step>Run external models in parallel (single message, multiple Agent calls)</step>
    <step>
      After completion, track each model:
      track_model_performance "{model}" "{status}" "{duration}" "{issues}" "{quality}"
    </step>
    <step>
      Record session:
      record_session_stats $TOTAL $SUCCESS $FAILED $PARALLEL $SEQUENTIAL $SPEEDUP
    </step>
  </steps>
</phase>

<phase name="Finalization">
  <steps>
    <step>
      Display Model Performance Statistics (read from ai-docs/llm-performance.json)
    </step>
    <step>Show recommendations for slow/failing models</step>
  </steps>
</phase>
```

### Plugins Using This Pattern

| Plugin | Command | Usage |
|--------|---------|-------|
| **frontend** | `/review` | Full implementation with historical tracking |

---

## Integration with Other Skills

**multi-model-validation + quality-gates:**

```
Use Case: Cost approval before expensive multi-model review

Step 1: Cost Estimation (multi-model-validation)
  Calculate input/output tokens
  Estimate cost range

Step 2: User Approval Gate (quality-gates)
  Present cost estimate
  Ask user for approval
  If NO: Offer alternatives or abort
  If YES: Proceed with execution

Step 3: Parallel Execution (multi-model-validation)
  Follow 4-Message Pattern
  Launch all models simultaneously
```

**multi-model-validation + error-recovery:**

```
Use Case: Handling external model failures gracefully

Step 1: Parallel Execution (multi-model-validation)
  Launch 5 external models

Step 2: Error Handling (error-recovery)
  Model 1: Success
  Model 2: Timeout after 30s → Skip, continue with others
  Model 3: API 500 error → Retry once, then skip
  Model 4: Success
  Model 5: Success

Step 3: Partial Success Strategy (error-recovery)
  3/5 models succeeded (the synthesizer runs at N ≥ 1; at exactly 1 it passes through)
  Proceed with consolidation using 3 reviews
  Notify user: "2 models failed, proceeding with 3 reviews"

Step 4: Consolidation (multi-model-validation)
  Consolidate 3 successful reviews
  Apply consensus analysis
```

**multi-model-validation + task-orchestration:**

```
Use Case: Real-time progress tracking during parallel execution

Step 1: Initialize Tasks (task-orchestration)
  Tasks:
    1. Prepare workspace
    2. Launch Claude review
    3. Launch Grok review
    4. Launch Gemini review
    5. Launch GPT-5 review
    6. Consolidate reviews
    7. Present results

Step 2: Update Progress (task-orchestration)
  Mark tasks complete as models finish:
    - Claude completes → Mark task 2 complete
    - Grok completes → Mark task 3 complete
    - Gemini completes → Mark task 4 complete
    - GPT-5 completes → Mark task 5 complete

Step 3: User Sees Real-Time Progress
  "3/4 external models completed, 1 in progress..."
```

---

## Best Practices

**Do:**
- ✅ Use 4-Message Pattern for true parallel execution
- ✅ Provide cost estimates BEFORE execution
- ✅ Ask user approval for costs >$0.01
- ✅ Auto-trigger `dev:synthesizer` when the panel settles — at N = 1 it is a passthrough with a verdict
- ✅ Use blocking (synchronous) claudish execution
- ✅ Write full output to files, return brief summaries
- ✅ Prioritize by consensus level (unanimous → strong → majority → divergent)
- ✅ Show model agreement matrix
- ✅ Handle partial success gracefully (some models fail)
- ✅ **Track execution time per model** (NEW v2.0)
- ✅ **Calculate and display quality scores** (NEW v2.0)
- ✅ **Show performance statistics table at end of session** (NEW v2.0)
- ✅ **Generate recommendations for slow/failing models** (NEW v2.0)

**Don't:**
- ❌ Mix tool types in Message 2 (breaks parallelism)
- ❌ Use background claudish execution (returns before completion)
- ❌ Wait for user to request consolidation (auto-trigger instead)
- ❌ Consolidate with < 2 successful reviews (no meaningful consensus)
- ❌ Inline full reviews in consolidation prompt (use file paths)
- ❌ Return full 500-line reviews to orchestrator (use brief summaries)
- ❌ Skip cost approval gate for expensive operations
- ❌ **Skip statistics display** (users need data to optimize model selection)
- ❌ **Keep slow models in shortlist** (flag models 2x+ slower than average)

**Performance:**
- Parallel execution: 3-5x faster than sequential
- Message 2 speedup: 15 min → 5 min with 5 models
- Context efficiency: Brief summaries save 50-80% context
- **Statistics overhead: <1 second** (jq operations are fast)

---

## Examples

### Example 1: Dynamic Model Discovery + Review

**Scenario:** User requests "Let's run external models to validate our solution"

**Execution:**

```
Message 1: Session Setup + Model Discovery
  # Create unique session
  Bash: SESSION_ID="review-$(date +%Y%m%d-%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
  Bash: SESSION_DIR="ai-docs/sessions/${SESSION_ID}" && mkdir -p "$SESSION_DIR"
  Output: Session: review-20251212-143052-a3f2

  # Discover available models
  MCP:  list_models   # claudish — live catalog, 24h cache
  Output:
    current model IDs with pricing, context, capabilities, access prefixes

  # Load historical performance
  Bash: cat ai-docs/llm-performance.json | jq '.models | keys'
  Output: ["claude-embedded", "x-ai-grok", "LATEST_FREE_CODING_MODEL"]

  # No code capture here: every reviewer is handed TARGET: BRANCH and runs dev's
  # capture-review-surfaces.ts itself, in BRANCH mode.

Message 2: Model Selection (AskUserQuestion with multiSelect)
  # Use AskUserQuestion tool with multiSelect: true
  AskUserQuestion({
    questions: [{
      question: "Which external models should validate your code? (Internal Claude always included)",
      header: "Models",
      multiSelect: true,
      options: [
        { label: "grok ⚡", description: "$0.85/1M | Quality: 87% | Avg: 42s" },
        { label: "gemini", description: "$7.00/1M | New model, no history" },
        { label: "qwen/LATEST_FREE_CODING_MODEL 🆓", description: "FREE | Quality: 82% | Coding-specialized" },
        { label: "mistralai/LATEST_FREE_CODING_MODEL 🆓", description: "FREE | Dev-focused, new model" }
      ]
    }]
  })

  # User selects via interactive UI:
  # ☑ grok
  # ☐ gemini
  # ☑ qwen/LATEST_FREE_CODING_MODEL
  # ☑ mistralai/LATEST_FREE_CODING_MODEL

  # Save selection to session for later use
  save_session_models "$SESSION_DIR" "grok" "qwen/LATEST_FREE_CODING_MODEL" "mistralai/LATEST_FREE_CODING_MODEL"

  # Session now has:
  # $SESSION_DIR/selected-models.txt containing:
  # claude-embedded (always)
  # grok
  # qwen/LATEST_FREE_CODING_MODEL
  # mistralai/LATEST_FREE_CODING_MODEL

Message 3: Start the panel (the internal Agent call and ONE team call, same message)
  Bash: write the brief to "$SESSION_DIR/input.md"   # TARGET: BRANCH / FOCUS: code / MODELS: none

  Agent(
    subagent_type: "dev:reviewer",
    run_in_background: false,
    description: "Internal code review",
    prompt: "TARGET: BRANCH
             FOCUS: code
             OUTPUT: $SESSION_DIR/claude-review.md
             MODELS: grok,LATEST_FREE_CODING_MODEL,LATEST_FREE_REASONING_MODEL"
  )
  ---
  claudish team(mode="run", path=$SESSION_DIR,
    models=["grok", "LATEST_FREE_CODING_MODEL", "LATEST_FREE_REASONING_MODEL"],
    input_file="$SESSION_DIR/input.md",
    require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)", agent="dev:reviewer")

  All 4 reviewers run at once — the Agent is the internal reviewer, and the team
  call parallelises the three externals internally. The team call returns a slots
  map immediately; poll before consolidating:

  claudish team(mode="status", path=$SESSION_DIR)  # until no slot is RUNNING

Message 4: Auto-Consolidation + Statistics Update
  # Consolidate — claude-review.md plus one response-NN.md per external slot; the
  # synthesizer never sees the code
  Agent(
    subagent_type: "dev:synthesizer",
    run_in_background: false,
    description: "Consolidate code reviews",
    prompt: "REVIEWS: $SESSION_DIR/claude-review.md
             $SESSION_DIR/response-01.md
             $SESSION_DIR/response-02.md
             $SESSION_DIR/response-03.md
             THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                          dev:reviewer's agent file, read at dispatch time, never
                          recalled>
             OUTPUT: $SESSION_DIR/consolidated-review.md
             Consolidate with consensus levels (unanimous / strong / majority / divergent).
             Compute the verdict line from your counts against THRESHOLDS.
             You are given reviews, never code. Do not review."
  )

  # Track performance
  track_model_performance "claude-embedded" "success" 32 8 95 0 true
  track_model_performance "grok" "success" 45 6 87 0.002 false
  track_model_performance "qwen/LATEST_FREE_CODING_MODEL" "success" 52 5 82 0 true
  track_model_performance "mistralai/LATEST_FREE_CODING_MODEL" "success" 48 5 84 0 true

  record_session_stats 4 4 0 52 177 3.4 0.002 3

Message 5: Present Results
  "Multi-model review complete! Session: review-20251212-143052-a3f2

   Top Issues (Consensus):
   1. [UNANIMOUS] SQL injection in search endpoint
   2. [STRONG] Missing input validation (3/4 models)
   3. [MAJORITY] Weak password hashing (2/4 models)

   Model Performance (this session):
   | Model                        | Time | Issues | Quality | Cost   |
   |------------------------------|------|--------|---------|--------|
   | claude-embedded              | 32s  | 8      | 95%     | FREE   |
   | grok        | 45s  | 6      | 87%     | $0.002 |
   | qwen/LATEST_FREE_CODING_MODEL        | 52s  | 5      | 82%     | FREE   |
   | mistralai/LATEST_FREE_CODING_MODEL | 48s  | 5      | 84%     | FREE   |

   Session Stats:
   - Parallel Speedup: 3.4x (177s → 52s)
   - Total Cost: $0.002 (3 free models used!)

   Performance logged to ai-docs/llm-performance.json
   See $SESSION_DIR/consolidated-review.md for details."
```

**Result:** Dynamic model discovery, user selection, 3 free models, data-driven optimization

---

### Example 2: Partial Success with Error Recovery

**Scenario:** 4 models selected, 2 fail

**Execution:**

```
Message 1: Preparation
  (same as Example 1)

Message 2: Start the panel (the internal Agent call and ONE team call, same message)
  Bash: write the brief to "$SESSION_DIR/input.md"   # TARGET: BRANCH / FOCUS: code / MODELS: none

  Agent(
    subagent_type: "dev:reviewer",
    run_in_background: false,
    description: "Internal code review",
    prompt: "TARGET: BRANCH
             FOCUS: code
             OUTPUT: $SESSION_DIR/claude-review.md
             MODELS: grok,gemini,LATEST_GPT_CODING_MODEL"
  )
  ---
  claudish team(mode="run", path=$SESSION_DIR,
    models=["grok", "gemini", "LATEST_GPT_CODING_MODEL"],
    input_file="$SESSION_DIR/input.md",
    require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)", agent="dev:reviewer")

Message 3: Poll, then Error Recovery (error-recovery skill)
  claudish team(mode="status", path=$SESSION_DIR)  # until no slot is RUNNING

  Internal reviewer: returned; $SESSION_DIR/claude-review.md carries a Verdict line ✓
  Settled status.models:
    - slot 01 (Grok):   FAILED, error.reason = nonzero_exit ✗
    - slot 02 (Gemini): FAILED, error.reason = nonzero_exit (API 500) ✗
    - slot 03 (GPT-5):  COMPLETED ✓

  Note there is no "timeout" reason any more — nothing kills a slot on a timer. A
  slot that is still RUNNING when you hit your poll ceiling is reported as still
  running, and cancelling it is YOUR decision (error.reason = "cancelled").

  successful.length = 2 (Claude + GPT-5)
  2 ≥ 1 ✓ (the synthesizer runs; had only one survived it would pass that review through)

  Notify user:
    "2/4 models succeeded (Grok timeout, Gemini error).
     Proceeding with consolidation using 2 reviews."

Message 4: Auto-Consolidation
  # The internal review plus the one COMPLETED slot have a review file; list exactly those.
  Agent(
    subagent_type: "dev:synthesizer",
    run_in_background: false,
    description: "Consolidate code reviews",
    prompt: "REVIEWS: $SESSION_DIR/claude-review.md
             $SESSION_DIR/response-03.md
             THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                          dev:reviewer's agent file, read at dispatch time, never
                          recalled>
             OUTPUT: $SESSION_DIR/consolidated-review.md
             Consolidate with consensus levels (unanimous / strong / majority / divergent).
             Compute the verdict line from your counts against THRESHOLDS.
             You are given reviews, never code. Do not review."
  )

Message 5: Present Results
  "Multi-model review complete (2/4 models succeeded).

   Top Issues (2-model consensus):
   1. [UNANIMOUS] SQL injection (both flagged)
   2. [DIVERGENT] Input validation (Claude only)
   3. [DIVERGENT] Rate limiting (GPT-5 only)

   Note: Grok and Gemini failed. Limited consensus data.
   See $SESSION_DIR/consolidated-review.md for details."
```

**Result:** Graceful degradation, useful results despite failures

---

## Troubleshooting

**Problem: Models executing sequentially instead of parallel**

Cause: Mixed tool types in Message 2

Solution: Use ONLY Agent calls in Message 2

```
❌ Wrong:
  Message 2:
    TaskCreate({...})
    Agent({...})
    Agent({...})

✅ Correct:
  Message 1: TaskCreate({...}) (separate message)
  Message 2: Agent({...}); Agent({...}) (only Task)
```

---

**Problem: Agent returns before external model completes**

Cause: Not waiting for MCP session completion.

Solution: The orchestrating command waits for `completed` channel events from MCP sessions.
External model execution is handled by MCP tools (team/create_session), not by sub-agents.

```
❌ Wrong:
  Running claudish CLI directly in sub-agent context

✅ Correct:
  Orchestrator uses team MCP tool → waits for structured results
  Or uses create_session → waits for completed channel event
```

---

**Problem: Consolidation never triggers**

Cause: Waiting for user to request it

Solution: Auto-trigger when the panel settles — at N = 1 too (Pattern 5)

```
❌ Wrong:
  if (results.length >= 2) {
    notifyUser("Ready to consolidate. Proceed?");
    // Waits for user...
  }

✅ Correct:
  if (results.length >= 1) {
    // Auto-trigger, don't wait; N = 1 is a passthrough with a verdict
    await consolidate();
  }
```

---

**Problem: Costs higher than estimated**

Cause: Underestimated output tokens

Solution: Use range-based estimates, bias toward high end

```
✅ Better Estimation:
  Output: 3,000 - 5,000 tokens (range, not single number)
  Cost: $0.005 - $0.010 (gives user realistic expectation)
```

---

## ⚠️ MANDATORY: Statistics Collection Checklist

**Statistics are NOT optional.** The multi-model validation is INCOMPLETE without performance tracking.

### Why This Matters

Real-world feedback showed that agents often:
- ❌ Forget to instrument timing
- ❌ Skip statistics because Agent tool doesn't return timing
- ❌ Get caught up in execution and forget the statistics phase
- ❌ Present results without performance data

**This checklist prevents those failures.**

### Complete Tracking Protocol

For the complete tracking protocol including:
- Pre-launch checklist (8 required items)
- Tracking table templates (simple, detailed, session-based)
- Failure documentation format
- Consensus analysis requirements
- Results presentation template

**See:** `multimodel:model-tracking-protocol`

The tracking protocol skill provides copy-paste templates that make compliance easy and unforgettable.

### Pre-Flight Checklist (Before Launching Models)

```bash
# 1. Record session start time (REQUIRED)
SESSION_START=$(date +%s)
echo "Session started at: $SESSION_START"

# 2. Create timing tracker file in session directory
echo "{}" > "$SESSION_DIR/timing.json"

# 3. Initialize per-model start times array
declare -A MODEL_START_TIMES
```

### Per-Model Timing (During Execution)

**CRITICAL:** Record start time BEFORE launching each model:

```bash
# Before launching each Task
MODEL_START_TIMES["claude-embedded"]=$(date +%s)
MODEL_START_TIMES["grok"]=$(date +%s)
MODEL_START_TIMES["qwen/LATEST_FREE_CODING_MODEL"]=$(date +%s)

# After each TaskOutput returns, calculate duration
model_completed() {
  local model="$1"
  local status="$2"
  local issues="${3:-0}"
  local quality="${4:-}"

  local end_time=$(date +%s)
  local start_time="${MODEL_START_TIMES[$model]}"
  local duration=$((end_time - start_time))

  echo "Model $model completed in ${duration}s"

  # Track immediately (don't wait until end)
  track_model_performance "$model" "$status" "$duration" "$issues" "$quality"
}

# Call when each model completes
model_completed "claude-embedded" "success" 8 95
model_completed "grok" "success" 6 87
```

### Post-Consolidation Checklist (MANDATORY)

Before presenting results to user, you **MUST** complete ALL of these:

```
□ 1. Calculate duration for EACH model
      DURATION=$((END_TIME - START_TIME))

□ 2. Call track_model_performance() for EACH model
      track_model_performance "model-id" "status" duration issues quality cost is_free

□ 3. Calculate parallel vs sequential times
      PARALLEL_TIME=$(max of all durations)
      SEQUENTIAL_TIME=$(sum of all durations)
      SPEEDUP=$(echo "scale=1; $SEQUENTIAL_TIME / $PARALLEL_TIME" | bc)

□ 4. Call record_session_stats()
      record_session_stats $TOTAL $SUCCESS $FAILED $PARALLEL_TIME $SEQUENTIAL_TIME $SPEEDUP $COST $FREE_COUNT

□ 5. Verify ai-docs/llm-performance.json was updated
      [ -f "ai-docs/llm-performance.json" ] && echo "✓ Stats saved"

□ 6. Display performance table (see template below)
```

**FAILURE TO COMPLETE ALL 6 STEPS = INCOMPLETE REVIEW**

### Complete Timing Example

```bash
#!/bin/bash
# Full timing instrumentation example

# === PRE-FLIGHT ===
SESSION_START=$(date +%s)
declare -A MODEL_START_TIMES
declare -A MODEL_END_TIMES
declare -A MODEL_DURATIONS

# === LAUNCH PHASE ===
# Record start times BEFORE launching Tasks
MODEL_START_TIMES["claude-embedded"]=$SESSION_START
MODEL_START_TIMES["grok"]=$SESSION_START
MODEL_START_TIMES["qwen/LATEST_FREE_CODING_MODEL"]=$SESSION_START

# Launch all Tasks in parallel (Message 2)
# ... Agent calls here ...

# === COMPLETION PHASE ===
# After TaskOutput returns for each model
record_completion() {
  local model="$1"
  MODEL_END_TIMES["$model"]=$(date +%s)
  MODEL_DURATIONS["$model"]=$((MODEL_END_TIMES["$model"] - MODEL_START_TIMES["$model"]))
}

# Call as each completes
record_completion "claude-embedded"
record_completion "grok"
record_completion "qwen/LATEST_FREE_CODING_MODEL"

# === STATISTICS PHASE ===
# Calculate totals
PARALLEL_TIME=0
SEQUENTIAL_TIME=0
for model in "${!MODEL_DURATIONS[@]}"; do
  duration="${MODEL_DURATIONS[$model]}"
  SEQUENTIAL_TIME=$((SEQUENTIAL_TIME + duration))
  if [ "$duration" -gt "$PARALLEL_TIME" ]; then
    PARALLEL_TIME=$duration
  fi
done
SPEEDUP=$(echo "scale=1; $SEQUENTIAL_TIME / $PARALLEL_TIME" | bc)

# Track each model
track_model_performance "claude-embedded" "success" "${MODEL_DURATIONS[claude-embedded]}" 8 95 0 true
track_model_performance "grok" "success" "${MODEL_DURATIONS[grok]}" 6 87 0.002 false
track_model_performance "qwen/LATEST_FREE_CODING_MODEL" "success" "${MODEL_DURATIONS[qwen/LATEST_FREE_CODING_MODEL]}" 5 82 0 true

# Record session
record_session_stats 3 3 0 $PARALLEL_TIME $SEQUENTIAL_TIME $SPEEDUP 0.002 2

echo "Statistics collection complete!"
```

### Required Output Template

Your final message to the user **MUST** include this table:

```markdown
## Model Performance (This Session)

| Model                     | Time  | Issues | Quality | Cost   | Status |
|---------------------------|-------|--------|---------|--------|--------|
| claude-embedded           | 32s   | 8      | 95%     | FREE   | ✅     |
| grok     | 45s   | 6      | 87%     | $0.002 | ✅     |
| qwen/LATEST_FREE_CODING_MODEL     | 52s   | 5      | 82%     | FREE   | ✅     |

## Session Statistics

- **Parallel Time:** 52s (slowest model)
- **Sequential Time:** 129s (sum of all)
- **Speedup:** 2.5x
- **Total Cost:** $0.002
- **Free Models Used:** 2/3

✓ Performance logged to `ai-docs/llm-performance.json`
```

### Verification Before Presenting

Run this check before your final message:

```bash
verify_statistics_complete() {
  local errors=0

  # Check file exists
  if [ ! -f "ai-docs/llm-performance.json" ]; then
    echo "ERROR: ai-docs/llm-performance.json not found"
    errors=$((errors + 1))
  fi

  # Check session was recorded
  if ! jq -e '.sessions[0]' ai-docs/llm-performance.json >/dev/null 2>&1; then
    echo "ERROR: No session recorded"
    errors=$((errors + 1))
  fi

  # Check models were tracked
  local model_count=$(jq '.models | length' ai-docs/llm-performance.json)
  if [ "$model_count" -eq 0 ]; then
    echo "ERROR: No models tracked"
    errors=$((errors + 1))
  fi

  if [ "$errors" -gt 0 ]; then
    echo "STATISTICS INCOMPLETE - $errors errors found"
    return 1
  fi

  echo "✓ Statistics verification passed"
  return 0
}
```

### Common Mistakes and Fixes

| Mistake | Fix |
|---------|-----|
| "I'll track timing later" | Record start time BEFORE launching |
| "Agent tool doesn't return timing" | Use bash timestamps around Agent calls |
| "Too complex with parallel agents" | Use associative arrays for per-model times |
| "Forgot to call track_model_performance" | Add to checklist, verify file updated |
| "Presented results without table" | Use required output template |

---

## Summary

Multi-model validation achieves 3-5x speedup and consensus-based prioritization through:

- **Pattern 0: Session Setup** (NEW v3.0) - Unique session directories, dynamic model discovery
- **Pattern 1: 4-Message Pattern** - True parallel execution
- **Pattern 2: Parallel Architecture** - Single message, multiple Agent calls
- **Pattern 3: Proxy Mode** - Blocking execution via Claudish
- **Pattern 4: Cost Transparency** - Estimate before, report after
- **Pattern 5: Auto-Consolidation** - Triggered when the panel settles; N = 1 is a passthrough with a verdict
- **Pattern 6: Consensus Analysis** - unanimous → strong → majority → divergent
- **Pattern 7: Statistics Collection** - Track speed, cost, quality per model
- **Pattern 8: Data-Driven Selection** (NEW v3.0) - Intelligent model recommendations

Master this skill and you can validate any implementation with multiple AI perspectives in minutes, while continuously improving your model shortlist based on actual performance data.

**Version 3.1.0 Additions:**
- **MANDATORY Statistics Collection Checklist** - Prevents incomplete reviews
- **SubagentStop Hook** - Automatically reminds when statistics weren't collected
- **Pre-Flight Checklist** - Record SESSION_START, initialize timing arrays
- **Per-Model Timing Examples** - Bash associative arrays for tracking durations
- **Required Output Template** - Standardized performance table format
- **Verification Script** - `verify_statistics_complete()` function
- **Common Mistakes Table** - Quick reference for debugging

**Version 3.0 Additions:**
- **Pattern 0: Session Setup and Model Discovery**
  - Unique session directories (`ai-docs/sessions/review-{slug}-{timestamp}-{hash}`)
  - Dynamic model discovery via `list_models` (live, 24h cache)
  - Always include internal reviewer (safety net)
  - Recommended free models: LATEST_QWEN_CODING_MODEL, LATEST_FREE_CODING_MODEL, LATEST_QWEN_MODEL
- **Pattern 8: Data-Driven Model Selection**
  - Historical performance tracking in `ai-docs/llm-performance.json`
  - Per-model metrics: speed, cost, quality, success rate, trend
  - Automatic shortlist generation (balanced, quality, budget, free-only)
  - Model recommendations with context
- **Enhanced Statistics**
  - Cost tracking per model and per session
  - Free vs paid model tracking
  - Trend detection (improving/stable/degrading)
  - Top free performers category

**Version 2.0 Additions:**
- Pattern 7: Statistics Collection and Analysis
- Per-model execution time tracking
- Quality score calculation (issues in consensus %)
- Session summary statistics (speedup, avg time, success rate)
- Recommendations for slow/failing models

---

**Extracted From:**
- `/review` command (complete multi-model review orchestration)
- `CLAUDE.md` Parallel Multi-Model Execution Protocol
- Claudish CLI (https://github.com/MadAppGang/claudish) proxy mode patterns
