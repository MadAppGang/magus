#!/usr/bin/env node
/**
 * Failure Report Generator
 *
 * When a phase cannot produce expected artifacts, generates a detailed report with:
 * - What was expected
 * - What approaches were tried
 * - Why they failed
 * - Manual testing steps
 * - Suggestions for resolution
 *
 * Usage:
 *   node failure-report-generator.js <session_path> <phase> [--attempts <json>]
 *
 * Arguments:
 *   session_path  - Path to session directory
 *   phase         - Phase that failed (phase1, phase3, phase4, phase5, phase6, phase7)
 *   --attempts    - JSON array of attempted approaches
 *
 * Example:
 *   node failure-report-generator.js ai-docs/sessions/dev-feature-login-20260204 phase7 \
 *     --attempts '[{"approach":"browser_test","error":"Chrome MCP not available"}]'
 *
 * Output:
 *   Creates ${SESSION_PATH}/failures/phase{N}-failure-report.md
 */

const fs = require('fs');
const path = require('path');

// Phase-specific expected artifacts and manual test steps
const PHASE_EXPECTATIONS = {
  phase1: {
    name: 'Requirements + Validation Setup',
    expectedArtifacts: [
      'requirements.md',
      'validation-criteria.md',
      'iteration-config.json'
    ],
    manualSteps: [
      'Create requirements.md with feature description and acceptance criteria',
      'Create validation-criteria.md with testable checkboxes',
      'Create iteration-config.json with {"outerLoop": {"maxIterations": 3}}'
    ],
    commonFailures: {
      'user_unavailable': 'User not available for clarification questions',
      'unclear_scope': 'Feature scope too vague to define criteria',
      'tool_issue': 'AskUserQuestion tool not responding'
    }
  },

  phase3: {
    name: 'Multi-Model Planning',
    expectedArtifacts: [
      'architecture.md',
      'reviews/plan-review/consolidated.md'
    ],
    manualSteps: [
      'Create architecture.md with component structure, data flow, API contracts',
      'Run code review manually or use single model',
      'Create consolidated.md with merged feedback'
    ],
    commonFailures: {
      'external_model_timeout': 'External AI models timed out or unavailable',
      'context_too_large': 'Requirements too complex for single-pass architecture',
      'missing_context': 'Not enough project context to design architecture'
    }
  },

  phase4: {
    name: 'Implementation',
    expectedArtifacts: [
      'implementation-log.md'
    ],
    manualSteps: [
      'Implement feature according to architecture.md',
      'Log progress in implementation-log.md with timestamps',
      'Verify changes compile: npm run build or go build',
      'Check git diff shows changes'
    ],
    commonFailures: {
      'compile_error': 'Code does not compile due to type errors',
      'dependency_missing': 'Required dependency not installed',
      'architecture_unclear': 'Architecture document incomplete or ambiguous'
    }
  },

  phase5: {
    name: 'Code Review',
    expectedArtifacts: [
      'reviews/code-review/consolidated.md',
      'code-changes.diff'
    ],
    manualSteps: [
      'Run git diff > code-changes.diff',
      'Review changes manually or with single model',
      'Create consolidated.md with verdict (PASS/FAIL/CONDITIONAL)',
      'List issues by severity (CRITICAL, HIGH, MEDIUM, LOW)'
    ],
    commonFailures: {
      'no_changes': 'No code changes to review (git diff empty)',
      'model_timeout': 'Review models timed out',
      'diff_too_large': 'Changes too large for single review pass'
    }
  },

  phase6: {
    name: 'Unit Testing',
    expectedArtifacts: [
      'tests/test-plan.md',
      'tests/test-results.md'
    ],
    manualSteps: [
      'Create test-plan.md from requirements (black box approach)',
      'Implement tests according to plan',
      'Run tests: npm test or go test ./...',
      'Capture output to test-results.md'
    ],
    commonFailures: {
      'no_test_framework': 'Project has no test framework configured',
      'tests_fail': 'Tests fail due to implementation bugs',
      'environment_issue': 'Test environment not set up correctly'
    }
  },

  phase7: {
    name: 'Real Validation',
    expectedArtifacts: [
      'validation/result.md',
      'validation/screenshot-before.png',
      'validation/screenshot-after.png'
    ],
    manualSteps: [
      '1. Start dev server: npm run dev (or bun run dev)',
      '2. Open browser to test URL (e.g., http://localhost:3000)',
      '3. Take screenshot of initial state',
      '4. Perform test actions (fill forms, click buttons)',
      '5. Take screenshot of result state',
      '6. Verify expected behavior occurred',
      '7. Document results in validation/result.md'
    ],
    commonFailures: {
      'chrome_mcp_unavailable': 'Chrome MCP tools not available or not responding',
      'server_not_starting': 'Dev server fails to start',
      'page_not_loading': 'Test URL not accessible',
      'elements_not_found': 'Expected UI elements not present',
      'behavior_incorrect': 'Feature does not behave as expected'
    }
  }
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    sessionPath: null,
    phase: null,
    attempts: []
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--attempts' && args[i + 1]) {
      try {
        result.attempts = JSON.parse(args[i + 1]);
      } catch (e) {
        console.error('Invalid --attempts JSON:', e.message);
      }
      i++;
    } else if (!result.sessionPath) {
      result.sessionPath = args[i];
    } else if (!result.phase) {
      result.phase = args[i];
    }
  }

  return result;
}

/**
 * Generate failure report
 */
function generateFailureReport(sessionPath, phase, attempts) {
  const config = PHASE_EXPECTATIONS[phase];

  if (!config) {
    console.error(`Unknown phase: ${phase}`);
    process.exit(1);
  }

  let report = `# ${config.name} - Failure Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Session:** ${sessionPath}\n`;
  report += `**Phase:** ${phase}\n\n`;

  // Expected artifacts section
  report += `## Expected Artifacts\n\n`;
  report += `The following artifacts were expected but could not be produced:\n\n`;
  for (const artifact of config.expectedArtifacts) {
    const artifactPath = path.join(sessionPath, artifact);
    const exists = fs.existsSync(artifactPath);
    const status = exists ? '✅' : '❌';
    report += `- ${status} \`${artifact}\`\n`;
  }
  report += '\n';

  // Attempted approaches section
  report += `## Attempted Approaches\n\n`;
  if (attempts.length === 0) {
    report += `No specific approaches recorded. Consider documenting what was tried.\n\n`;
  } else {
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      report += `### Attempt ${i + 1}: ${attempt.approach || 'Unknown'}\n\n`;

      if (attempt.description) {
        report += `**What was tried:** ${attempt.description}\n\n`;
      }

      if (attempt.error) {
        report += `**Error:** ${attempt.error}\n\n`;
      }

      if (attempt.output) {
        report += `**Output:**\n\`\`\`\n${attempt.output}\n\`\`\`\n\n`;
      }

      if (attempt.timestamp) {
        report += `**Timestamp:** ${attempt.timestamp}\n\n`;
      }
    }
  }

  // Failure analysis section
  report += `## Failure Analysis\n\n`;
  report += `### Common Failure Reasons\n\n`;
  for (const [key, description] of Object.entries(config.commonFailures)) {
    report += `- **${key}**: ${description}\n`;
  }
  report += '\n';

  // Suggestions section
  report += `## Suggestions for Resolution\n\n`;

  // Generate contextual suggestions based on attempts
  const suggestions = generateSuggestions(phase, attempts);
  for (let i = 0; i < suggestions.length; i++) {
    report += `${i + 1}. ${suggestions[i]}\n`;
  }
  report += '\n';

  // Manual testing steps section
  report += `## Manual Testing Steps\n\n`;
  report += `If automated validation is not possible, follow these manual steps:\n\n`;
  for (let i = 0; i < config.manualSteps.length; i++) {
    report += `${i + 1}. ${config.manualSteps[i]}\n`;
  }
  report += '\n';

  // Workaround section
  report += `## Workarounds\n\n`;
  report += generateWorkarounds(phase);

  // Next steps section
  report += `## Next Steps\n\n`;
  report += `Choose one of the following:\n\n`;
  report += `1. **Fix and Retry**: Address the issues above and re-run the phase\n`;
  report += `2. **Manual Completion**: Follow manual steps and create artifacts manually\n`;
  report += `3. **Skip with Justification**: Create \`${phase}-skip-reason.md\` explaining why\n`;
  report += `4. **Escalate to User**: Ask user for guidance via AskUserQuestion\n`;

  return report;
}

/**
 * Generate contextual suggestions based on failure type
 */
function generateSuggestions(phase, attempts) {
  const suggestions = [];

  // Phase-specific suggestions
  switch (phase) {
    case 'phase7':
      suggestions.push('Verify Chrome MCP is properly configured in .claude/settings.json');
      suggestions.push('Check if dev server is running: curl http://localhost:3000');
      suggestions.push('Try using different browser automation: mcp__claude-in-chrome instead');
      suggestions.push('Consider unit tests + manual verification as fallback');
      break;

    case 'phase6':
      suggestions.push('Check if test framework is installed: npm ls jest vitest mocha');
      suggestions.push('Verify test command in package.json scripts');
      suggestions.push('Try running tests directly: npx jest or npx vitest');
      suggestions.push('Create minimal test file to verify framework works');
      break;

    case 'phase5':
      suggestions.push('Generate diff manually: git diff > code-changes.diff');
      suggestions.push('Use single model for review if multi-model fails');
      suggestions.push('Break large changes into smaller review chunks');
      break;

    case 'phase4':
      suggestions.push('Run build command to see specific errors: npm run build');
      suggestions.push('Check TypeScript errors: npx tsc --noEmit');
      suggestions.push('Verify all imports are valid');
      break;

    case 'phase3':
      suggestions.push('Simplify architecture to single component first');
      suggestions.push('Use internal Claude only if external models timeout');
      suggestions.push('Review similar features in codebase for patterns');
      break;

    case 'phase1':
      suggestions.push('Define minimal viable requirements');
      suggestions.push('Use example validation criteria from similar features');
      suggestions.push('Create default iteration config with 3 iterations');
      break;
  }

  // Attempt-specific suggestions
  for (const attempt of attempts) {
    if (attempt.error?.includes('timeout')) {
      suggestions.push('Increase timeout or retry after brief wait');
    }
    if (attempt.error?.includes('not found')) {
      suggestions.push('Verify tool/file path is correct');
    }
    if (attempt.error?.includes('permission')) {
      suggestions.push('Check file/tool permissions');
    }
  }

  return suggestions;
}

/**
 * Generate workarounds for each phase
 */
function generateWorkarounds(phase) {
  let workarounds = '';

  switch (phase) {
    case 'phase7':
      workarounds += `### If Browser Automation Unavailable\n\n`;
      workarounds += `1. Run validation manually in browser\n`;
      workarounds += `2. Take screenshots with system screenshot tool\n`;
      workarounds += `3. Save screenshots to \`validation/\` directory\n`;
      workarounds += `4. Create \`validation/result.md\` with manual observations\n\n`;

      workarounds += `### Minimal result.md Template\n\n`;
      workarounds += `\`\`\`markdown\n`;
      workarounds += `# Validation Result - Manual\n\n`;
      workarounds += `## Summary\n`;
      workarounds += `- **Status**: PASS / FAIL / PARTIAL\n`;
      workarounds += `- **Method**: Manual browser testing\n`;
      workarounds += `- **Timestamp**: ${new Date().toISOString()}\n\n`;
      workarounds += `## Checks Performed\n`;
      workarounds += `- [ ] Navigate to test URL\n`;
      workarounds += `- [ ] Verify initial state\n`;
      workarounds += `- [ ] Perform test actions\n`;
      workarounds += `- [ ] Verify expected result\n\n`;
      workarounds += `## Evidence\n`;
      workarounds += `- screenshot-before.png\n`;
      workarounds += `- screenshot-after.png\n`;
      workarounds += `\`\`\`\n\n`;
      break;

    case 'phase6':
      workarounds += `### If Test Framework Not Available\n\n`;
      workarounds += `1. Create test-plan.md documenting what should be tested\n`;
      workarounds += `2. Add comment in code where tests would go\n`;
      workarounds += `3. Create \`tests/skip-reason.md\` with justification\n\n`;

      workarounds += `### Minimal skip-reason.md Template\n\n`;
      workarounds += `\`\`\`markdown\n`;
      workarounds += `# Test Skip Justification\n\n`;
      workarounds += `## Reason\n`;
      workarounds += `[Explain why tests couldn't be created]\n\n`;
      workarounds += `## Plan\n`;
      workarounds += `- [ ] Add test framework in follow-up PR\n`;
      workarounds += `- [ ] Write tests after deployment verification\n`;
      workarounds += `\`\`\`\n\n`;
      break;

    default:
      workarounds += `See phase-specific documentation for workarounds.\n\n`;
  }

  return workarounds;
}

/**
 * Main function
 */
function main() {
  const { sessionPath, phase, attempts } = parseArgs();

  if (!sessionPath || !phase) {
    console.log('Usage: failure-report-generator.js <session_path> <phase> [--attempts <json>]');
    console.log('\nPhases: phase1, phase3, phase4, phase5, phase6, phase7');
    console.log('\nExample:');
    console.log('  node failure-report-generator.js ./session phase7 \\');
    console.log('    --attempts \'[{"approach":"browser_test","error":"Chrome MCP unavailable"}]\'');
    process.exit(0);
  }

  if (!fs.existsSync(sessionPath)) {
    console.error(`Error: Session path does not exist: ${sessionPath}`);
    process.exit(1);
  }

  // Create failures directory
  const failuresDir = path.join(sessionPath, 'failures');
  if (!fs.existsSync(failuresDir)) {
    fs.mkdirSync(failuresDir, { recursive: true });
  }

  // Generate report
  const report = generateFailureReport(sessionPath, phase, attempts);

  // Save report
  const reportPath = path.join(failuresDir, `${phase}-failure-report.md`);
  fs.writeFileSync(reportPath, report);

  console.log(`\n📋 Failure Report Generated`);
  console.log(`   Path: ${reportPath}`);
  console.log(`   Phase: ${PHASE_EXPECTATIONS[phase]?.name || phase}`);
  console.log(`   Attempts: ${attempts.length}`);
  console.log(`\n💡 See report for manual testing steps and workarounds.`);

  // Also output to stdout for orchestrator
  console.log('\n' + '─'.repeat(50));
  console.log(report);
}

main();
