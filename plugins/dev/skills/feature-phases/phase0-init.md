# Phase 0: Session Initialization

**Objective:** Create unique session for artifact isolation

## Steps

### Step 0.1: Announce the phase
Say, in one line: **Phase 0 — starting.**

### Step 0.2: Generate session ID
Extract feature name from user request.
Generate session ID: dev-feature-{slug}-YYYYMMDD-HHMMSS-XXXX
Example: dev-feature-user-auth-20260105-143022-a3f2

### Step 0.3: Create directory structure
```bash
FEATURE_SLUG=$(echo "${FEATURE_NAME:-feature}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c20)
SESSION_ID="dev-feature-${FEATURE_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
SESSION_PATH="ai-docs/sessions/${SESSION_ID}"
mkdir -p "${SESSION_PATH}/reviews/plan-review" "${SESSION_PATH}/reviews/code-review" "${SESSION_PATH}/tests" "${SESSION_PATH}/validation"
```

### Step 0.4: Write initial session-meta.json

`repoPath` and `baselineCommit` are what Phase 5 reviews against. `repoPath` is
**absolute** so later phases can use `git -C` instead of `cd` — a `cd` would
relocate the relative `SESSION_PATH` with it, sending both the read and the write
to a path that does not exist.

```bash
REPO_PATH=$(git rev-parse --show-toplevel)
BASELINE_COMMIT=$(git rev-parse HEAD)
```

```json
{
  "sessionId": "{SESSION_ID}",
  "createdAt": "{timestamp}",
  "feature": "{feature_name}",
  "repoPath": "{REPO_PATH}",
  "baselineCommit": "{BASELINE_COMMIT}",
  "status": "in_progress",
  "checkpoint": {
    "lastCompletedPhase": "phase0",
    "nextPhase": "phase1",
    "resumable": true
  }
}
```

If the tree is already dirty at this point, say so in one line. The baseline cannot
tell pre-session changes from session changes, so Phase 5 will review both.

### Step 0.5: Check Claudish availability
```bash
which claudish
```

### Step 0.6: Worktree option

**PRESET CHECK:** If preset `workspace` is set (e.g. `"current"` or `"new-directory"`), use that value and SKIP this widget.

Ask about workspace isolation:

Use AskUserQuestion:
  question: "Create an isolated worktree for this feature?"
  header: "Workspace"
  options:
    - label: "No, work in current directory (Recommended)"
      description: "Faster setup, suitable for most features"
    - label: "Yes, create isolated worktree"
      description: "Separate branch + workspace for safe experimentation"

Keyword auto-suggestion: If user's feature description contains
"experiment", "prototype", "risky", "breaking", "parallel", "isolate",
suggest worktree by making it the first option.

If user selects worktree:
  1. Set BRANCH_NAME = "feature/${FEATURE_SLUG}"
  2. Set WORKTREE_DIR = ".worktrees"
  3. Follow the dev:worktree-lifecycle skill phases 1-5:
     - Pre-flight checks
     - Directory selection (use .worktrees/ default)
     - Creation with .gitignore safety
     - Setup (dependency install, baseline tests)
     - Handoff (store metadata)
  4. Store worktree metadata in ${SESSION_PATH}/worktree-metadata.json
  4b. **UPDATE `repoPath` and `baselineCommit` in session-meta.json** to the new
      worktree. Step 0.4 wrote them before this worktree existed, so leaving them
      makes Phase 5 review the wrong checkout:
      ```bash
      jq --arg r "${WORKTREE_PATH}" --arg b "$(git -C "${WORKTREE_PATH}" rev-parse HEAD)" \
         '.repoPath = $r | .baselineCommit = $b' \
         "${SESSION_PATH}/session-meta.json" > "${SESSION_PATH}/session-meta.tmp" \
        && mv "${SESSION_PATH}/session-meta.tmp" "${SESSION_PATH}/session-meta.json"
      ```
      `SESSION_PATH` stays in the main worktree; only `repoPath` moves.
  5. Set WORKTREE_PATH for all subsequent agent delegations
  6. All dev:developer Task prompts include:
     "WORKTREE_PATH: ${WORKTREE_PATH}
      IMPORTANT: cd to WORKTREE_PATH before writing any code.
      Session artifacts stay in ${SESSION_PATH} (main worktree)."

If user selects current directory:
  Continue as normal (no changes to existing behavior)

### Step 0.7: Announce the phase complete
Say, in one line: **Phase 0 — complete**, naming the artifacts you wrote.
Do this only once those files exist; the Stop hook verifies them and will block
the turn if they do not.

## Quality Gate
Session created, SESSION_PATH set, validation directory created
