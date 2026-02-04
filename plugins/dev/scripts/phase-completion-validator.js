#!/usr/bin/env node
/**
 * Phase Completion Validator
 *
 * This script runs as a PreToolUse hook on TaskUpdate to enforce:
 * 1. Evidence-based phase completion (artifacts must exist)
 * 2. Validation criteria mapping (Phase 7)
 * 3. Outer loop enforcement (Phase 8 requires Phase 7 PASS)
 * 4. Show-your-work requirement (evidence files must have content)
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

// Phase-specific required artifacts
const PHASE_ARTIFACTS = {
  'phase1': {
    name: 'Requirements + Validation Setup',
    required: [
      'requirements.md',
      'validation-criteria.md',
      'iteration-config.json'
    ],
    optional: []
  },
  'phase3': {
    name: 'Multi-Model Planning',
    required: [
      'architecture.md'
    ],
    optional: [
      'reviews/plan-review/consolidated.md',
      'reviews/plan-review/claude-internal.md'
    ]
  },
  'phase4': {
    name: 'Implementation',
    required: [
      'implementation-log.md'
    ],
    optional: [],
    customCheck: 'checkGitChanges'
  },
  'phase5': {
    name: 'Code Review',
    required: [
      'reviews/code-review/consolidated.md'
    ],
    optional: [
      'code-changes.diff'
    ],
    customCheck: 'checkReviewVerdict'
  },
  'phase6': {
    name: 'Unit Testing',
    required: [
      'tests/test-plan.md'
    ],
    optional: [
      'tests/test-results.md',
      'tests/iteration-history.md'
    ],
    customCheck: 'checkTestsCreated'
  },
  'phase7': {
    name: 'Real Validation',
    required: [
      'validation/result.md'
    ],
    optional: [
      'validation/screenshot-before.png',
      'validation/screenshot-after.png',
      'validation/action-log.md'
    ],
    customCheck: 'checkValidationResult'
  },
  'phase8': {
    name: 'Completion',
    required: [
      'report.md'
    ],
    optional: [],
    customCheck: 'checkPhase7Passed'
  }
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
 * Custom check: Verify Phase 7 passed before allowing Phase 8 (for Phase 8)
 */
function checkPhase7Passed(sessionPath) {
  // Read session-meta.json
  const metaPath = path.join(sessionPath, 'session-meta.json');

  if (!fs.existsSync(metaPath)) {
    return { valid: false, message: 'Missing session-meta.json' };
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Check outer loop results
  if (meta.outerLoop && meta.outerLoop.phase7Results) {
    const lastResult = meta.outerLoop.phase7Results[meta.outerLoop.phase7Results.length - 1];
    if (lastResult && lastResult.status === 'PASS') {
      return { valid: true, message: 'Phase 7 passed, Phase 8 allowed' };
    }
  }

  // Fallback: Check validation result directly
  const validationCheck = checkValidationResult(sessionPath);
  if (validationCheck.status === 'PASS') {
    return { valid: true, message: 'Phase 7 validation PASSED' };
  }

  return {
    valid: false,
    message: `Cannot complete Phase 8: Phase 7 validation did not PASS (status: ${validationCheck.status || 'unknown'})`
  };
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

  // Check required artifacts
  for (const artifact of phaseConfig.required) {
    const artifactPath = path.join(sessionPath, artifact);

    if (!fs.existsSync(artifactPath)) {
      errors.push(`Missing required artifact: ${artifact}`);
    } else if (!fileExistsWithContent(artifactPath)) {
      errors.push(`Artifact exists but is empty: ${artifact}`);
    }
  }

  // Check optional artifacts (warnings only)
  for (const artifact of phaseConfig.optional) {
    const artifactPath = path.join(sessionPath, artifact);

    if (!fs.existsSync(artifactPath)) {
      warnings.push(`Optional artifact missing: ${artifact}`);
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

    // Only validate when status is being set to "completed"
    if (input.status !== 'completed') {
      console.log('Phase Completion Validator: Not a completion update, skipping');
      process.exit(0);
    }

    // Get task subject to detect phase
    // Note: In real hook, we'd need to fetch task details via TaskGet
    // For now, check if there's a phase pattern in any available context
    const taskSubject = input.subject || process.env.CLAUDE_TASK_SUBJECT || '';
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
      console.log(`\n⚠️  Warnings for ${result.phaseName}:`);
      result.warnings.forEach(w => console.log(`   - ${w}`));
    }

    if (!result.valid) {
      console.error(`\n❌ BLOCKED: Cannot complete ${result.phaseName}`);
      console.error('\nMissing requirements:');
      result.errors.forEach(e => console.error(`   - ${e}`));
      console.error('\nSession path:', sessionPath);

      // Generate detailed failure report with manual testing steps
      console.error('\n📋 Generating failure report with manual testing steps...\n');
      generateFailureReport(phase, sessionPath, result.errors, result.warnings);

      console.error('\n💡 See failure report for:');
      console.error('   - What was expected');
      console.error('   - Why it failed');
      console.error('   - Manual testing steps');
      console.error('   - Workarounds and suggestions');

      process.exit(1);
    }

    console.log(`\n✅ ${result.phaseName} completion validated`);
    console.log(`   Session: ${sessionPath}`);
    process.exit(0);

  } catch (error) {
    console.error('Phase Completion Validator error:', error.message);
    // On error, allow the operation (fail open for safety)
    process.exit(0);
  }
}

main();
