#!/usr/bin/env node
/**
 * Phase Completion Validator
 *
 * This script runs as a PreToolUse hook on TaskUpdate to enforce:
 * 1. Evidence-based phase completion (artifacts must exist)
 * 2. Validation criteria mapping (Phase 7)
 * 3. Outer loop enforcement (Phase 8 requires Phase 7 PASS)
 * 4. Show-your-work requirement (evidence files must have content)
 * 5. Phase ordering enforcement (predecessors must complete before phase starts)
 *
 * Usage: Automatically called by PreToolUse hook when TaskUpdate is invoked
 *
 * Environment variables:
 *   CLAUDE_TOOL_INPUT - JSON string with TaskUpdate parameters
 *   CLAUDE_SESSION_PATH - Path to current feature session (if set)
 *
 * Exit codes:
 *   0 - Validation passed, allow TaskUpdate
 *   1 - Validation failed, block TaskUpdate with error message
 */

const fs = require('fs');
const path = require('path');

// Phase-specific required artifacts (P2a: object format with minSize and patterns)
const PHASE_ARTIFACTS = {
  'phase1': {
    name: 'Requirements + Validation Setup',
    required: [
      { file: 'requirements.md',        minSize: 100 },
      { file: 'validation-criteria.md', minSize: 50  },
      { file: 'iteration-config.json',  minSize: 50  },
    ],
    optional: []
  },
  'phase3': {
    name: 'Multi-Model Planning',
    required: [
      { file: 'architecture.md',                        minSize: 500  },  // P2a: substantial content
      { file: 'reviews/plan-review/consolidated.md',    minSize: 200,
        patterns: [/model|review|analysis|issue|concern|verdict/i] },     // P0+P2a: moved to required
      { file: 'reviews/plan-review/claude-internal.md', minSize: 100,
        patterns: [/review|analysis|issue|concern|recommendation/i] },    // P0+P2a: moved to required
    ],
    optional: []
  },
  'phase4': {
    name: 'Implementation',
    required: [
      { file: 'implementation-log.md', minSize: 100,
        patterns: [/Phase|Step|Started|Completed|Created|Modified/] },    // P2a: structured log
    ],
    optional: [],
    customCheck: 'checkGitChanges'
  },
  'phase5': {
    name: 'Code Review',
    required: [
      { file: 'reviews/code-review/consolidated.md', minSize: 200 },
    ],
    optional: [
      { file: 'code-changes.diff', minSize: 0 },
    ],
    customCheck: 'checkReviewVerdict'
  },
  'phase6': {
    name: 'Unit Testing',
    required: [
      { file: 'tests/test-plan.md', minSize: 50 },
    ],
    optional: [
      { file: 'tests/test-results.md',      minSize: 0 },
      { file: 'tests/iteration-history.md', minSize: 0 },
    ],
    customCheck: 'checkTestsCreated'
  },
  'phase7': {
    name: 'Real Validation',
    required: [
      { file: 'validation/result.md', minSize: 100,
        patterns: [/status.*:.*PASS|status.*:.*FAIL/i] },                 // P2a: must have status
    ],
    optional: [
      { file: 'validation/screenshot-before.png', minSize: 0 },
      { file: 'validation/screenshot-after.png',  minSize: 0 },
      { file: 'validation/action-log.md',         minSize: 0 },
    ],
    customCheck: 'checkValidationResult'
  },
  'phase8': {
    name: 'Completion',
    required: [
      { file: 'report.md', minSize: 500 },                               // P2a: substantial report
    ],
    optional: [],
    customCheck: 'checkPhase7Passed'
  }
};

// Phase dependency map: phase cannot start until all predecessors are completed
// Keys are phase IDs, values are arrays of predecessor phases that must have
// their artifacts verified before this phase can become in_progress.
const PHASE_DEPENDENCIES = {
  'phase4': ['phase3'],  // Implementation blocked until Planning complete
  'phase5': ['phase4'],  // Code Review blocked until Implementation complete
  'phase6': ['phase4'],  // Unit Testing blocked until Implementation complete
  'phase7': ['phase6'],  // Validation blocked until Testing complete
};

// Pattern to detect phase-related task subjects
const PHASE_PATTERNS = [
  { pattern: /phase\s*0/i, phase: 'phase0' },
  { pattern: /phase\s*1|requirements|validation setup/i, phase: 'phase1' },
  { pattern: /phase\s*2|research/i, phase: 'phase2' },
  { pattern: /phase\s*3|planning|architecture/i, phase: 'phase3' },
  { pattern: /phase\s*4|implementation/i, phase: 'phase4' },
  { pattern: /phase\s*5|code review/i, phase: 'phase5' },
  { pattern: /phase\s*6|testing|unit test/i, phase: 'phase6' },
  { pattern: /phase\s*7|validation|real validation/i, phase: 'phase7' },
  { pattern: /phase\s*8|completion|report/i, phase: 'phase8' }
];

/**
 * Find session path from environment or current directory
 */
function findSessionPath() {
  // Check environment variable first
  if (process.env.CLAUDE_SESSION_PATH) {
    return process.env.CLAUDE_SESSION_PATH;
  }

  // Look for most recent session in ai-docs/sessions
  const sessionsDir = 'ai-docs/sessions';
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const sessions = fs.readdirSync(sessionsDir)
    .filter(d => d.startsWith('dev-feature-'))
    .map(d => ({
      name: d,
      path: path.join(sessionsDir, d),
      mtime: fs.statSync(path.join(sessionsDir, d)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return sessions.length > 0 ? sessions[0].path : null;
}

/**
 * Detect which phase a task belongs to based on subject
 */
function detectPhase(taskSubject) {
  if (!taskSubject) return null;

  for (const { pattern, phase } of PHASE_PATTERNS) {
    if (pattern.test(taskSubject)) {
      return phase;
    }
  }
  return null;
}

/**
 * Check if a file exists and has content
 */
function fileExistsWithContent(filePath, minSize = 10) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size >= minSize;
  } catch {
    return false;
  }
}

/**
 * Custom check: Verify git has changes (for Phase 4)
 */
function checkGitChanges(sessionPath) {
  try {
    const { execSync } = require('child_process');
    const diff = execSync('git diff --stat', { encoding: 'utf-8' });
    const staged = execSync('git diff --staged --stat', { encoding: 'utf-8' });

    if (diff.trim() || staged.trim()) {
      return { valid: true, message: 'Git changes detected' };
    }

    // Also check for new untracked files
    const untracked = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (untracked.includes('??')) {
      return { valid: true, message: 'New files detected' };
    }

    return {
      valid: false,
      message: 'No code changes detected. Phase 4 requires implementation to produce git changes.'
    };
  } catch (error) {
    // Not a git repo or git not available, skip this check
    return { valid: true, message: 'Git check skipped (not a git repo)' };
  }
}

/**
 * Custom check: Verify code review has verdict (for Phase 5)
 */
function checkReviewVerdict(sessionPath) {
  const consolidatedPath = path.join(sessionPath, 'reviews/code-review/consolidated.md');

  if (!fs.existsSync(consolidatedPath)) {
    return { valid: false, message: 'Missing consolidated code review' };
  }

  const content = fs.readFileSync(consolidatedPath, 'utf-8');

  // Check for verdict
  const hasVerdict = /verdict:\s*(PASS|FAIL|CONDITIONAL)/i.test(content) ||
                     /##.*verdict/i.test(content) ||
                     /\*\*verdict\*\*/i.test(content);

  if (!hasVerdict) {
    return {
      valid: false,
      message: 'Code review consolidated.md missing verdict (PASS/FAIL/CONDITIONAL)'
    };
  }

  return { valid: true, message: 'Review verdict present' };
}

/**
 * Custom check: Verify tests were created (for Phase 6)
 */
function checkTestsCreated(sessionPath) {
  const testPlanPath = path.join(sessionPath, 'tests/test-plan.md');

  if (!fs.existsSync(testPlanPath)) {
    return { valid: false, message: 'Missing test-plan.md' };
  }

  // Check if test files exist in codebase (not session)
  try {
    const { execSync } = require('child_process');
    // Look for test files created recently (within last hour)
    const testFiles = execSync(
      'find . -name "*_test.*" -o -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | head -20',
      { encoding: 'utf-8' }
    ).trim();

    if (!testFiles) {
      return {
        valid: false,
        message: 'No test files found in codebase. Phase 6 requires creating test files.'
      };
    }

    return { valid: true, message: `Test files found: ${testFiles.split('\n').length}` };
  } catch {
    // find command failed, check test-results instead
    const testResultsPath = path.join(sessionPath, 'tests/test-results.md');
    if (fs.existsSync(testResultsPath)) {
      return { valid: true, message: 'Test results file exists' };
    }
    return { valid: false, message: 'Unable to verify test creation' };
  }
}

/**
 * Custom check: Verify validation result and status (for Phase 7)
 */
function checkValidationResult(sessionPath) {
  // Find the latest validation result file
  const validationDir = path.join(sessionPath, 'validation');

  if (!fs.existsSync(validationDir)) {
    return { valid: false, message: 'Missing validation directory' };
  }

  const resultFiles = fs.readdirSync(validationDir)
    .filter(f => f.startsWith('result') && f.endsWith('.md'));

  if (resultFiles.length === 0) {
    // Check for simple result.md
    const simpleResult = path.join(validationDir, 'result.md');
    if (!fs.existsSync(simpleResult)) {
      return { valid: false, message: 'Missing validation result file' };
    }
    resultFiles.push('result.md');
  }

  // Read the latest result
  const latestResult = resultFiles.sort().pop();
  const resultPath = path.join(validationDir, latestResult);
  const content = fs.readFileSync(resultPath, 'utf-8');

  // Check for status
  const statusMatch = content.match(/status:\s*(PASS|FAIL|PARTIAL)/i) ||
                      content.match(/##.*status.*:\s*(PASS|FAIL|PARTIAL)/i) ||
                      content.match(/\*\*status\*\*:\s*(PASS|FAIL|PARTIAL)/i);

  if (!statusMatch) {
    return {
      valid: false,
      message: 'Validation result missing status (PASS/FAIL/PARTIAL)'
    };
  }

  const status = statusMatch[1].toUpperCase();

  // Check for evidence
  const hasEvidence = content.includes('screenshot') ||
                      content.includes('evidence') ||
                      content.includes('.png') ||
                      content.includes('action-log');

  if (!hasEvidence) {
    return {
      valid: false,
      message: 'Validation result missing evidence references (screenshots, action log)'
    };
  }

  return {
    valid: true,
    message: `Validation status: ${status}`,
    status: status
  };
}

/**
 * Custom check: Verify all preceding phases completed before allowing Phase 8 (P1c)
 *
 * Checks:
 * 1. Phase 7 validation PASSED (existing check)
 * 2. Phase 3 plan review was conducted (consolidated.md exists with content)
 * 3. Phase 5 code review was conducted (consolidated.md has verdict)
 * 4. session-meta.json has checkpoint records for all phases
 */
function checkPhase7Passed(sessionPath) {
  const errors = [];

  // --- Existing check: Phase 7 validation PASS ---
  const metaPath = path.join(sessionPath, 'session-meta.json');
  if (!fs.existsSync(metaPath)) {
    return { valid: false, message: 'Missing session-meta.json' };
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  let phase7Passed = false;
  if (meta.outerLoop && meta.outerLoop.phase7Results) {
    const lastResult = meta.outerLoop.phase7Results[meta.outerLoop.phase7Results.length - 1];
    if (lastResult && lastResult.status === 'PASS') {
      phase7Passed = true;
    }
  }

  if (!phase7Passed) {
    // Fallback: check validation result file directly
    const validationCheck = checkValidationResult(sessionPath);
    phase7Passed = validationCheck.status === 'PASS';
  }

  if (!phase7Passed) {
    errors.push('Phase 7 validation did not PASS');
  }

  // --- P1c: Phase 3 plan review verification ---
  const planConsolidated = path.join(sessionPath, 'reviews/plan-review/consolidated.md');
  if (!fs.existsSync(planConsolidated)) {
    errors.push('Phase 3 plan review missing: reviews/plan-review/consolidated.md not found');
  } else {
    const content = fs.readFileSync(planConsolidated, 'utf-8');
    if (content.trim().length < 100) {
      errors.push('Phase 3 plan review is too short (< 100 bytes) — may not be a real review');
    }
  }

  // --- P1c: Phase 5 code review verification ---
  const codeConsolidated = path.join(sessionPath, 'reviews/code-review/consolidated.md');
  if (!fs.existsSync(codeConsolidated)) {
    errors.push('Phase 5 code review missing: reviews/code-review/consolidated.md not found');
  } else {
    const content = fs.readFileSync(codeConsolidated, 'utf-8');
    const hasVerdict = /verdict:\s*(PASS|FAIL|CONDITIONAL)/i.test(content) ||
                       /##.*verdict/i.test(content) ||
                       /\*\*verdict\*\*/i.test(content);
    if (!hasVerdict) {
      errors.push('Phase 5 code review missing verdict (PASS/FAIL/CONDITIONAL)');
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: `Phase 8 blocked — ${errors.length} prerequisite(s) not met:\n${errors.map(e => '  - ' + e).join('\n')}`
    };
  }

  return { valid: true, message: 'All Phase 8 prerequisites verified' };
}

/**
 * Check that all predecessor phases have their required artifacts before
 * allowing a phase to become in_progress.
 */
function checkPredecessors(phase, sessionPath) {
  try {
    const predecessors = PHASE_DEPENDENCIES[phase];
    if (!predecessors || predecessors.length === 0) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    for (const pred of predecessors) {
      const result = validatePhaseCompletion(pred, sessionPath);
      if (!result.valid) {
        errors.push(
          `Cannot start ${phase}: prerequisite ${pred} (${result.phaseName}) ` +
          `is not complete. Missing: ${result.errors.join(', ')}`
        );
      }
    }
    return { valid: errors.length === 0, errors };
  } catch (error) {
    // Fail open — predecessor check error should not block work
    return { valid: true, errors: [] };
  }
}

/**
 * Validate phase completion requirements
 */
function validatePhaseCompletion(phase, sessionPath) {
  const phaseConfig = PHASE_ARTIFACTS[phase];

  if (!phaseConfig) {
    // Unknown phase or phase without artifacts (phase0, phase2)
    return { valid: true, errors: [], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  // Helper: normalize artifact entry (string or object) for backward compat
  const normalize = (a) => typeof a === 'string'
    ? { file: a, minSize: 10, patterns: [] }
    : { minSize: 10, patterns: [], ...a };

  // Check required artifacts
  for (const entry of phaseConfig.required) {
    const { file, minSize, patterns } = normalize(entry);
    const artifactPath = path.join(sessionPath, file);

    if (!fs.existsSync(artifactPath)) {
      errors.push(`Missing required artifact: ${file}`);
      continue;
    }

    const stats = fs.statSync(artifactPath);
    if (stats.size < minSize) {
      errors.push(
        `Artifact too small: ${file} (${stats.size} bytes < required ${minSize} bytes)`
      );
      continue;
    }

    // Content pattern validation (P2a)
    if (patterns && patterns.length > 0) {
      const content = fs.readFileSync(artifactPath, 'utf-8');
      const allMatch = patterns.every(p => p.test(content));
      if (!allMatch) {
        errors.push(
          `Artifact content validation failed: ${file} missing expected patterns`
        );
      }
    }
  }

  // Check optional artifacts (warnings only)
  for (const entry of phaseConfig.optional) {
    const { file } = normalize(entry);
    const artifactPath = path.join(sessionPath, file);
    if (!fs.existsSync(artifactPath)) {
      warnings.push(`Optional artifact missing: ${file}`);
    }
  }

  // Run custom check if defined
  if (phaseConfig.customCheck) {
    const customChecks = {
      checkGitChanges,
      checkReviewVerdict,
      checkTestsCreated,
      checkValidationResult,
      checkPhase7Passed
    };

    const checkFn = customChecks[phaseConfig.customCheck];
    if (checkFn) {
      const result = checkFn(sessionPath);
      if (!result.valid) {
        errors.push(result.message);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phaseName: phaseConfig.name
  };
}

/**
 * Generate failure report when phase cannot complete
 */
function generateFailureReport(phase, sessionPath, errors, warnings) {
  const { execSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'failure-report-generator.js');

  // Build attempts array from errors
  const attempts = errors.map(e => ({
    approach: 'automated_check',
    error: e,
    timestamp: new Date().toISOString()
  }));

  try {
    // Call failure report generator
    const attemptsJson = JSON.stringify(attempts).replace(/'/g, "'\\''");
    execSync(`node "${scriptPath}" "${sessionPath}" "${phase}" --attempts '${attemptsJson}'`, {
      stdio: 'inherit'
    });
  } catch (e) {
    // If report generation fails, just show basic error
    console.error('Failed to generate detailed failure report:', e.message);
  }
}

/**
 * Main validation function
 */
function main() {
  try {
    // Parse tool input from environment
    const toolInput = process.env.CLAUDE_TOOL_INPUT;

    if (!toolInput) {
      // No input, this might be a test run
      console.log('Phase Completion Validator: No tool input provided');
      process.exit(0);
    }

    const input = JSON.parse(toolInput);

    // Get task subject to detect phase
    const taskSubject = input.subject || process.env.CLAUDE_TASK_SUBJECT || '';

    // Validate on both in_progress (predecessor check) and completed (artifact check)
    if (input.status === 'in_progress') {
      // P1a: Check that predecessor phases are complete before allowing start
      const phase = detectPhase(taskSubject);
      if (phase && PHASE_DEPENDENCIES[phase]) {
        const sessionPath = findSessionPath();
        if (sessionPath) {
          const predResult = checkPredecessors(phase, sessionPath);
          if (!predResult.valid) {
            predResult.errors.forEach(e => console.error(`   - ${e}`));
            console.error('\nPhase ordering violation: Complete prerequisites first.');
            process.exit(1);
          }
        }
      }
      console.log('Phase Completion Validator: in_progress allowed');
      process.exit(0);
    }

    if (input.status !== 'completed') {
      console.log('Phase Completion Validator: Not a phase transition, skipping');
      process.exit(0);
    }

    const phase = detectPhase(taskSubject);

    if (!phase) {
      // Not a phase-related task, allow completion
      console.log('Phase Completion Validator: Not a phase task, allowing');
      process.exit(0);
    }

    // Find session path
    const sessionPath = findSessionPath();

    if (!sessionPath) {
      console.log('Phase Completion Validator: No session found, allowing');
      console.log('(Feature sessions should be in ai-docs/sessions/dev-feature-*)');
      process.exit(0);
    }

    // Validate phase completion
    const result = validatePhaseCompletion(phase, sessionPath);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings for ${result.phaseName}:`);
      result.warnings.forEach(w => console.log(`   - ${w}`));
    }

    if (!result.valid) {
      console.error(`\nBLOCKED: Cannot complete ${result.phaseName}`);
      console.error('\nMissing requirements:');
      result.errors.forEach(e => console.error(`   - ${e}`));
      console.error('\nSession path:', sessionPath);

      // Generate detailed failure report with manual testing steps
      console.error('\nGenerating failure report with manual testing steps...\n');
      generateFailureReport(phase, sessionPath, result.errors, result.warnings);

      console.error('\nSee failure report for:');
      console.error('   - What was expected');
      console.error('   - Why it failed');
      console.error('   - Manual testing steps');
      console.error('   - Workarounds and suggestions');

      process.exit(1);
    }

    console.log(`\n${result.phaseName} completion validated`);
    console.log(`   Session: ${sessionPath}`);
    process.exit(0);

  } catch (error) {
    console.error('Phase Completion Validator error:', error.message);
    // On error, allow the operation (fail open for safety)
    process.exit(0);
  }
}

main();
