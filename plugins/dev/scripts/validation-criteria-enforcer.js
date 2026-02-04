#!/usr/bin/env node
/**
 * Validation Criteria Enforcer
 *
 * Ensures Phase 7 validation actually tests the criteria defined in Phase 1.
 * Parses validation-criteria.md and verifies result.md addresses each criterion.
 *
 * Usage:
 *   node validation-criteria-enforcer.js <session_path>
 *
 * Exit codes:
 *   0 - All criteria addressed
 *   1 - Missing criteria mappings (blocked)
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse validation criteria from validation-criteria.md
 */
function parseCriteria(sessionPath) {
  const criteriaPath = path.join(sessionPath, 'validation-criteria.md');

  if (!fs.existsSync(criteriaPath)) {
    return { error: 'validation-criteria.md not found' };
  }

  const content = fs.readFileSync(criteriaPath, 'utf-8');
  const criteria = [];

  // Parse checkboxes: - [ ] criterion or - [x] criterion
  const checkboxPattern = /^-\s*\[[ x]\]\s*(.+)$/gm;
  let match;
  let lineNum = 0;

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const checkMatch = line.match(/^-\s*\[[ x]\]\s*(.+)$/);
    if (checkMatch) {
      criteria.push({
        line: idx + 1,
        text: checkMatch[1].trim(),
        checked: line.includes('[x]')
      });
    }
  });

  // Parse numbered items: 1. criterion
  const numberedPattern = /^\d+\.\s+(.+)$/gm;
  lines.forEach((line, idx) => {
    const numMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numMatch && !line.includes('[')) {
      // Avoid duplicating checkbox items
      const text = numMatch[1].trim();
      if (!criteria.some(c => c.text === text)) {
        criteria.push({
          line: idx + 1,
          text: text,
          checked: false
        });
      }
    }
  });

  // Extract test actions section
  const actionsMatch = content.match(/##\s*Test Actions[\s\S]*?(?=##|$)/i);
  if (actionsMatch) {
    const actionsContent = actionsMatch[0];
    const actionLines = actionsContent.split('\n');
    actionLines.forEach((line, idx) => {
      const actionMatch = line.match(/^\d+\.\s+(.+)$/);
      if (actionMatch) {
        const text = actionMatch[1].trim();
        if (!criteria.some(c => c.text.toLowerCase() === text.toLowerCase())) {
          criteria.push({
            line: idx + 1,
            text: text,
            type: 'action'
          });
        }
      }
    });
  }

  return { criteria };
}

/**
 * Parse validation results
 */
function parseResults(sessionPath) {
  const validationDir = path.join(sessionPath, 'validation');

  if (!fs.existsSync(validationDir)) {
    return { error: 'validation directory not found' };
  }

  // Find result files
  const resultFiles = fs.readdirSync(validationDir)
    .filter(f => f.startsWith('result') && f.endsWith('.md'))
    .sort();

  if (resultFiles.length === 0) {
    return { error: 'No result files found' };
  }

  const latestResult = resultFiles[resultFiles.length - 1];
  const resultPath = path.join(validationDir, latestResult);
  const content = fs.readFileSync(resultPath, 'utf-8');

  const results = [];

  // Parse table rows: | Check | Result | Details |
  const tablePattern = /\|\s*([^|]+)\s*\|\s*(PASS|FAIL|N\/A)\s*\|\s*([^|]*)\s*\|/gi;
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    results.push({
      criterion: match[1].trim(),
      result: match[2].toUpperCase(),
      details: match[3].trim()
    });
  }

  // Parse checkbox results: - [x] criterion or ✓ criterion
  const checkPattern = /^[-*]\s*\[([x ])\]\s*(.+)$/gm;
  while ((match = checkPattern.exec(content)) !== null) {
    results.push({
      criterion: match[2].trim(),
      result: match[1] === 'x' ? 'PASS' : 'FAIL',
      details: ''
    });
  }

  // Parse emoji results: ✓ or ❌
  const emojiPattern = /^([✓✅❌⚠️])\s*(.+)$/gm;
  while ((match = emojiPattern.exec(content)) !== null) {
    const emoji = match[1];
    const isPass = emoji === '✓' || emoji === '✅';
    results.push({
      criterion: match[2].trim(),
      result: isPass ? 'PASS' : 'FAIL',
      details: ''
    });
  }

  return { results, file: latestResult };
}

/**
 * Match criteria to results using fuzzy matching
 */
function matchCriteriaToResults(criteria, results) {
  const matched = [];
  const unmatched = [];

  for (const criterion of criteria) {
    const criterionWords = criterion.text.toLowerCase().split(/\s+/);

    // Find best matching result
    let bestMatch = null;
    let bestScore = 0;

    for (const result of results) {
      const resultWords = result.criterion.toLowerCase().split(/\s+/);

      // Calculate word overlap score
      let score = 0;
      for (const word of criterionWords) {
        if (resultWords.some(rw => rw.includes(word) || word.includes(rw))) {
          score++;
        }
      }

      // Bonus for exact substring match
      if (result.criterion.toLowerCase().includes(criterion.text.toLowerCase()) ||
          criterion.text.toLowerCase().includes(result.criterion.toLowerCase())) {
        score += criterionWords.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // Threshold: need at least 50% word match
    const threshold = Math.max(1, criterionWords.length * 0.5);

    if (bestMatch && bestScore >= threshold) {
      matched.push({
        criterion: criterion,
        result: bestMatch,
        score: bestScore
      });
    } else {
      unmatched.push(criterion);
    }
  }

  return { matched, unmatched };
}

/**
 * Generate validation criteria mapping report
 */
function generateReport(criteria, results, matched, unmatched) {
  let report = '# Validation Criteria Mapping Report\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;

  report += '## Summary\n\n';
  report += `- Total Criteria: ${criteria.length}\n`;
  report += `- Matched: ${matched.length}\n`;
  report += `- Unmatched: ${unmatched.length}\n`;
  report += `- Coverage: ${Math.round(matched.length / criteria.length * 100)}%\n\n`;

  report += '## Criteria Mapping\n\n';
  report += '| Line | Criterion | Result | Evidence |\n';
  report += '|------|-----------|--------|----------|\n';

  for (const m of matched) {
    report += `| ${m.criterion.line} | "${m.criterion.text}" | ${m.result.result} | ${m.result.details || 'N/A'} |\n`;
  }

  if (unmatched.length > 0) {
    report += '\n## ⚠️ Unaddressed Criteria\n\n';
    report += 'The following criteria from validation-criteria.md were NOT addressed in the results:\n\n';
    for (const u of unmatched) {
      report += `- Line ${u.line}: "${u.text}"\n`;
    }
  }

  report += '\n## Results Not Mapped to Criteria\n\n';
  const unmappedResults = results.filter(r =>
    !matched.some(m => m.result.criterion === r.criterion)
  );
  if (unmappedResults.length > 0) {
    for (const r of unmappedResults) {
      report += `- ${r.criterion}: ${r.result}\n`;
    }
  } else {
    report += 'All results mapped to criteria.\n';
  }

  return report;
}

/**
 * Main function
 */
function main() {
  const sessionPath = process.argv[2];

  if (!sessionPath) {
    console.log('Usage: validation-criteria-enforcer.js <session_path>');
    console.log('\nThis script validates that Phase 7 results map to Phase 1 criteria.');
    process.exit(0);
  }

  if (!fs.existsSync(sessionPath)) {
    console.error(`Error: Session path does not exist: ${sessionPath}`);
    process.exit(1);
  }

  // Parse criteria and results
  const criteriaResult = parseCriteria(sessionPath);
  if (criteriaResult.error) {
    console.error(`\n❌ Error: ${criteriaResult.error}`);
    console.error('Phase 1 must create validation-criteria.md');
    process.exit(1);
  }

  const resultsResult = parseResults(sessionPath);
  if (resultsResult.error) {
    console.error(`\n❌ Error: ${resultsResult.error}`);
    console.error('Phase 7 must create validation/result.md');
    process.exit(1);
  }

  const { criteria } = criteriaResult;
  const { results, file } = resultsResult;

  console.log(`\n📋 Validation Criteria Enforcement`);
  console.log('─'.repeat(40));
  console.log(`Criteria file: validation-criteria.md (${criteria.length} criteria)`);
  console.log(`Results file: ${file} (${results.length} results)`);

  // Match criteria to results
  const { matched, unmatched } = matchCriteriaToResults(criteria, results);

  console.log(`\n📊 Coverage: ${matched.length}/${criteria.length} (${Math.round(matched.length / criteria.length * 100)}%)`);

  // Show matched criteria
  if (matched.length > 0) {
    console.log('\n✅ Matched Criteria:');
    for (const m of matched.slice(0, 10)) {
      console.log(`  Line ${m.criterion.line}: "${m.criterion.text.substring(0, 40)}..." → ${m.result.result}`);
    }
    if (matched.length > 10) {
      console.log(`  ... and ${matched.length - 10} more`);
    }
  }

  // Show unmatched criteria
  if (unmatched.length > 0) {
    console.log('\n❌ Unaddressed Criteria:');
    for (const u of unmatched) {
      console.log(`  Line ${u.line}: "${u.text}"`);
    }
  }

  // Generate report
  const report = generateReport(criteria, results, matched, unmatched);
  const reportPath = path.join(sessionPath, 'validation', 'criteria-mapping.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n📝 Report saved to: ${reportPath}`);

  // Determine exit code
  if (unmatched.length === 0) {
    console.log('\n✅ All criteria addressed!');
    process.exit(0);
  } else if (unmatched.length <= criteria.length * 0.2) {
    // Allow up to 20% unmatched with warning
    console.log(`\n⚠️  Warning: ${unmatched.length} criteria not explicitly addressed`);
    console.log('   Proceeding with minor gaps documented.');
    process.exit(0);
  } else {
    console.error(`\n❌ BLOCKED: ${unmatched.length} criteria not addressed`);
    console.error('   More than 20% of criteria missing from results.');
    console.error('   Update validation/result.md to address all criteria.');
    process.exit(1);
  }
}

main();
