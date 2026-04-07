#!/bin/bash
#
# Checkpoint Verifier
#
# Automated checks at phase boundaries to verify work was actually done.
# Run before allowing phase transition.
#
# Usage:
#   ./checkpoint-verifier.sh <phase> <session_path>
#
# Exit codes:
#   0 - All checks passed
#   1 - Checks failed (blocked)
#

set -e

PHASE="$1"
SESSION_PATH="$2"

if [ -z "$PHASE" ] || [ -z "$SESSION_PATH" ]; then
    echo "Usage: checkpoint-verifier.sh <phase> <session_path>"
    echo ""
    echo "Phases: phase1, phase3, phase4, phase5, phase6, phase7, phase8"
    exit 1
fi

if [ ! -d "$SESSION_PATH" ]; then
    echo "Error: Session path does not exist: $SESSION_PATH"
    exit 1
fi

echo ""
echo "📋 Checkpoint Verification: $PHASE"
echo "─────────────────────────────────────"
echo "Session: $SESSION_PATH"
echo ""

ERRORS=0
WARNINGS=0

# Helper functions
check_file_exists() {
    local file="$1"
    local label="$2"
    if [ -f "$SESSION_PATH/$file" ]; then
        echo "✅ $label: $file"
    else
        echo "❌ $label: Missing $file"
        ERRORS=$((ERRORS + 1))
    fi
}

check_file_has_content() {
    local file="$1"
    local label="$2"
    local min_size="${3:-10}"
    if [ -f "$SESSION_PATH/$file" ]; then
        local size=$(wc -c < "$SESSION_PATH/$file")
        if [ "$size" -ge "$min_size" ]; then
            echo "✅ $label: $file (${size} bytes)"
        else
            echo "⚠️  $label: $file exists but is nearly empty (${size} bytes)"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo "❌ $label: Missing $file"
        ERRORS=$((ERRORS + 1))
    fi
}

check_dir_has_files() {
    local dir="$1"
    local label="$2"
    local pattern="${3:-*}"
    if [ -d "$SESSION_PATH/$dir" ]; then
        local count=$(find "$SESSION_PATH/$dir" -name "$pattern" -type f 2>/dev/null | wc -l)
        if [ "$count" -gt 0 ]; then
            echo "✅ $label: $count files in $dir"
        else
            echo "❌ $label: No files in $dir"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo "❌ $label: Directory missing $dir"
        ERRORS=$((ERRORS + 1))
    fi
}

check_git_changes() {
    local label="$1"
    # Check for any git changes (staged, unstaged, or untracked)
    if git status --porcelain 2>/dev/null | grep -q .; then
        local changed=$(git status --porcelain 2>/dev/null | wc -l)
        echo "✅ $label: $changed files with changes"
    else
        echo "⚠️  $label: No git changes detected"
        WARNINGS=$((WARNINGS + 1))
    fi
}

check_file_contains() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if [ -f "$SESSION_PATH/$file" ]; then
        if grep -qi "$pattern" "$SESSION_PATH/$file" 2>/dev/null; then
            echo "✅ $label: Pattern found in $file"
        else
            echo "❌ $label: Pattern '$pattern' not found in $file"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo "❌ $label: File not found $file"
        ERRORS=$((ERRORS + 1))
    fi
}

# Phase-specific checks
case "$PHASE" in
    phase1)
        echo "Phase 1: Requirements + Validation Setup"
        echo ""
        check_file_has_content "requirements.md" "Requirements"
        check_file_has_content "validation-criteria.md" "Validation Criteria"
        check_file_exists "iteration-config.json" "Iteration Config"

        # Verify iteration-config.json has required fields
        if [ -f "$SESSION_PATH/iteration-config.json" ]; then
            if grep -q "outerLoop" "$SESSION_PATH/iteration-config.json" && \
               grep -q "maxIterations" "$SESSION_PATH/iteration-config.json"; then
                echo "✅ Iteration Config: Has required fields"
            else
                echo "❌ Iteration Config: Missing outerLoop or maxIterations"
                ERRORS=$((ERRORS + 1))
            fi
        fi
        ;;

    phase3)
        echo "Phase 3: Multi-Model Planning"
        echo ""
        check_file_has_content "architecture.md" "Architecture" 100
        check_dir_has_files "reviews/plan-review" "Plan Reviews" "*.md"

        # Check for API contracts in architecture
        if [ -f "$SESSION_PATH/architecture.md" ]; then
            if grep -qi "api\|interface\|contract\|endpoint" "$SESSION_PATH/architecture.md"; then
                echo "✅ Architecture: Contains API/interface definitions"
            else
                echo "⚠️  Architecture: No API contracts found (expected for complex features)"
                WARNINGS=$((WARNINGS + 1))
            fi
        fi
        ;;

    phase4)
        echo "Phase 4: Implementation"
        echo ""
        check_file_has_content "implementation-log.md" "Implementation Log" 50
        check_git_changes "Code Changes"

        # Check implementation log has timestamps or phases
        if [ -f "$SESSION_PATH/implementation-log.md" ]; then
            if grep -qE "Phase|Step|Started|Completed|Created|Modified" "$SESSION_PATH/implementation-log.md"; then
                echo "✅ Implementation Log: Has structured progress"
            else
                echo "⚠️  Implementation Log: Missing structured progress markers"
                WARNINGS=$((WARNINGS + 1))
            fi
        fi
        ;;

    phase5)
        echo "Phase 5: Code Review"
        echo ""
        check_file_has_content "reviews/code-review/consolidated.md" "Consolidated Review" 100

        # Check for verdict in consolidated review
        if [ -f "$SESSION_PATH/reviews/code-review/consolidated.md" ]; then
            if grep -qiE "verdict|PASS|FAIL|CONDITIONAL" "$SESSION_PATH/reviews/code-review/consolidated.md"; then
                echo "✅ Code Review: Has verdict"
            else
                echo "❌ Code Review: Missing verdict (PASS/FAIL/CONDITIONAL)"
                ERRORS=$((ERRORS + 1))
            fi
        fi

        # Check code diff exists
        check_file_exists "code-changes.diff" "Code Diff"
        ;;

    phase6)
        echo "Phase 6: Unit Testing"
        echo ""
        check_file_has_content "tests/test-plan.md" "Test Plan" 50

        # Check for test files in codebase
        TEST_COUNT=$(find . -name "*_test.*" -o -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l)
        if [ "$TEST_COUNT" -gt 0 ]; then
            echo "✅ Test Files: $TEST_COUNT found in codebase"
        else
            echo "⚠️  Test Files: No test files found in codebase"
            WARNINGS=$((WARNINGS + 1))
        fi

        # Check for test results or skip reason
        if [ -f "$SESSION_PATH/tests/test-results.md" ]; then
            echo "✅ Test Results: Present"
            # Check for pass/fail counts
            if grep -qE "passed|failed|skipped" "$SESSION_PATH/tests/test-results.md"; then
                echo "✅ Test Results: Has pass/fail counts"
            else
                echo "⚠️  Test Results: Missing pass/fail counts"
                WARNINGS=$((WARNINGS + 1))
            fi
        elif [ -f "$SESSION_PATH/tests/skip-reason.md" ]; then
            echo "⚠️  Tests Skipped: Justification provided"
            WARNINGS=$((WARNINGS + 1))
        else
            echo "❌ Test Results: Missing test-results.md or skip-reason.md"
            ERRORS=$((ERRORS + 1))
        fi
        ;;

    phase7)
        echo "Phase 7: Real Validation"
        echo ""

        # Check for result file (with iteration number or simple)
        RESULT_COUNT=$(find "$SESSION_PATH/validation" -name "result*.md" 2>/dev/null | wc -l)
        if [ "$RESULT_COUNT" -gt 0 ]; then
            echo "✅ Validation Result: $RESULT_COUNT result file(s)"
        else
            echo "❌ Validation Result: No result*.md found in validation/"
            ERRORS=$((ERRORS + 1))
        fi

        # Check for PASS/FAIL status
        if [ -d "$SESSION_PATH/validation" ]; then
            LATEST_RESULT=$(find "$SESSION_PATH/validation" -name "result*.md" 2>/dev/null | sort | tail -1)
            if [ -n "$LATEST_RESULT" ]; then
                if grep -qiE "status.*:.*PASS|status.*:.*FAIL|##.*PASS|##.*FAIL" "$LATEST_RESULT"; then
                    echo "✅ Validation Status: Has PASS/FAIL determination"
                else
                    echo "❌ Validation Status: Missing PASS/FAIL status"
                    ERRORS=$((ERRORS + 1))
                fi
            fi
        fi

        # Check for evidence
        EVIDENCE_COUNT=$(find "$SESSION_PATH/validation" \( -name "*.png" -o -name "*.jpg" -o -name "action-log.md" \) 2>/dev/null | wc -l)
        if [ "$EVIDENCE_COUNT" -gt 0 ]; then
            echo "✅ Evidence: $EVIDENCE_COUNT files (screenshots, logs)"
        else
            echo "⚠️  Evidence: No screenshots or action logs found"
            WARNINGS=$((WARNINGS + 1))
        fi
        ;;

    phase8)
        echo "Phase 8: Completion"
        echo ""
        check_file_has_content "report.md" "Final Report" 200

        # Check that phase 7 passed
        LATEST_RESULT=$(find "$SESSION_PATH/validation" -name "result*.md" 2>/dev/null | sort | tail -1)
        if [ -n "$LATEST_RESULT" ]; then
            if grep -qi "status.*:.*PASS" "$LATEST_RESULT"; then
                echo "✅ Phase 7: PASSED"
            else
                echo "❌ Phase 7: Did not PASS - cannot complete Phase 8"
                ERRORS=$((ERRORS + 1))
            fi
        else
            echo "❌ Phase 7: No validation result found"
            ERRORS=$((ERRORS + 1))
        fi

        # Check session-meta.json updated
        if [ -f "$SESSION_PATH/session-meta.json" ]; then
            echo "✅ Session Meta: Present"
        else
            echo "⚠️  Session Meta: Missing session-meta.json"
            WARNINGS=$((WARNINGS + 1))
        fi
        ;;

    *)
        echo "Unknown phase: $PHASE"
        echo "Valid phases: phase1, phase3, phase4, phase5, phase6, phase7, phase8"
        exit 1
        ;;
esac

# Summary
echo ""
echo "─────────────────────────────────────"
if [ "$ERRORS" -eq 0 ]; then
    if [ "$WARNINGS" -gt 0 ]; then
        echo "⚠️  Checkpoint passed with $WARNINGS warning(s)"
    else
        echo "✅ Checkpoint passed"
    fi
    exit 0
else
    echo "❌ Checkpoint FAILED: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
fi
