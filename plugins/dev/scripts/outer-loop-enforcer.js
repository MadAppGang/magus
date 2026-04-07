#!/usr/bin/env node
/**
 * Outer Loop Enforcer
 *
 * Enforces the outer validation loop (Phases 3-7 repeat until pass).
 * Tracks iteration state in session-meta.json and prevents:
 * - Skipping to Phase 8 without Phase 7 PASS
 * - Exceeding max iterations without user escalation
 * - Regression detection (score getting worse)
 *
 * Usage:
 *   node outer-loop-enforcer.js <action> <session_path> [options]
 *
 * Actions:
 *   start-iteration    - Start a new outer loop iteration
 *   record-result      - Record Phase 7 validation result
 *   check-can-complete - Check if Phase 8 can proceed
 *   get-status         - Get current loop status
 *
 * Exit codes:
 *   0 - Success
 *   1 - Blocked (cannot proceed)
 *   2 - Escalation required (max iterations reached)
 */

const fs = require('fs');
const path = require('path');

/**
 * Initialize or load session metadata
 */
function loadSessionMeta(sessionPath) {
  const metaPath = path.join(sessionPath, 'session-meta.json');

  if (!fs.existsSync(metaPath)) {
    // Initialize new session meta
    return {
      sessionId: path.basename(sessionPath),
      createdAt: new Date().toISOString(),
      status: 'in_progress',
      outerLoop: {
        currentIteration: 0,
        maxIterations: 3,
        notifyEvery: 5,
        phase7Results: [],
        mode: 'limited' // 'limited' or 'infinite'
      },
      checkpoint: {
        lastCompletedPhase: null,
        nextPhase: 'phase0',
        resumable: true
      }
    };
  }

  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * Save session metadata
 */
function saveSessionMeta(sessionPath, meta) {
  const metaPath = path.join(sessionPath, 'session-meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/**
 * Start a new outer loop iteration
 */
function startIteration(sessionPath, options = {}) {
  const meta = loadSessionMeta(sessionPath);

  // Initialize outer loop if not exists
  if (!meta.outerLoop) {
    meta.outerLoop = {
      currentIteration: 0,
      maxIterations: options.maxIterations || 3,
      notifyEvery: 5,
      phase7Results: [],
      mode: 'limited'
    };
  }

  // Read iteration config if exists
  const configPath = path.join(sessionPath, 'iteration-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.outerLoop) {
      meta.outerLoop.maxIterations = config.outerLoop.maxIterations;
      meta.outerLoop.notifyEvery = config.outerLoop.notifyEvery || 5;
      meta.outerLoop.mode = config.outerLoop.maxIterations === 'infinite' ? 'infinite' : 'limited';
    }
  }

  // Increment iteration
  meta.outerLoop.currentIteration++;

  // Check if we should notify user (infinite mode)
  const shouldNotify = meta.outerLoop.mode === 'infinite' &&
                       meta.outerLoop.currentIteration % meta.outerLoop.notifyEvery === 0;

  // Check if max iterations reached (limited mode)
  const maxReached = meta.outerLoop.mode === 'limited' &&
                     meta.outerLoop.currentIteration > meta.outerLoop.maxIterations;

  // Update checkpoint
  meta.checkpoint.lastCompletedPhase = 'phase2';
  meta.checkpoint.nextPhase = 'phase3';

  saveSessionMeta(sessionPath, meta);

  // Build response
  const current = meta.outerLoop.currentIteration;
  const max = meta.outerLoop.mode === 'infinite' ? '∞' : meta.outerLoop.maxIterations;

  console.log(`\n🔄 OUTER LOOP: Iteration ${current}/${max}`);

  if (maxReached) {
    console.log('\n⚠️  Maximum iterations reached!');
    console.log('Escalation required: Ask user how to proceed.');
    process.exit(2);
  }

  if (shouldNotify) {
    console.log(`\n📢 Notification: ${current} iterations completed in infinite mode`);

    // Show convergence trend if we have results
    if (meta.outerLoop.phase7Results.length > 0) {
      console.log('\nConvergence trend:');
      meta.outerLoop.phase7Results.slice(-5).forEach((r, i) => {
        const score = r.score ? `${r.score}%` : 'N/A';
        console.log(`  #${r.iteration}: ${score} - ${r.reason || r.status}`);
      });
    }
  }

  // Check for regression
  const results = meta.outerLoop.phase7Results;
  if (results.length >= 2) {
    const last = results[results.length - 1];
    const prev = results[results.length - 2];
    if (last.score && prev.score && last.score < prev.score) {
      console.log('\n⚠️  REGRESSION DETECTED: Score getting worse!');
      console.log(`  Previous: ${prev.score}%`);
      console.log(`  Current: ${last.score}%`);
      console.log('  Consider stopping and reviewing manually.');
    }
  }

  process.exit(0);
}

/**
 * Record Phase 7 validation result
 */
function recordResult(sessionPath, status, options = {}) {
  const meta = loadSessionMeta(sessionPath);

  if (!meta.outerLoop) {
    meta.outerLoop = {
      currentIteration: 1,
      maxIterations: 3,
      phase7Results: [],
      mode: 'limited'
    };
  }

  const result = {
    iteration: meta.outerLoop.currentIteration,
    status: status.toUpperCase(),
    timestamp: new Date().toISOString(),
    reason: options.reason || null,
    score: options.score || null
  };

  meta.outerLoop.phase7Results.push(result);

  // Update checkpoint based on result
  if (result.status === 'PASS') {
    meta.checkpoint.lastCompletedPhase = 'phase7';
    meta.checkpoint.nextPhase = 'phase8';
  } else {
    meta.checkpoint.lastCompletedPhase = 'phase7-failed';
    meta.checkpoint.nextPhase = 'phase3'; // Loop back
  }

  saveSessionMeta(sessionPath, meta);

  console.log(`\n📋 Phase 7 Result Recorded`);
  console.log(`  Iteration: ${result.iteration}`);
  console.log(`  Status: ${result.status}`);
  if (result.score) console.log(`  Score: ${result.score}%`);
  if (result.reason) console.log(`  Reason: ${result.reason}`);

  if (result.status === 'PASS') {
    console.log('\n✅ Validation PASSED - Proceed to Phase 8');
  } else {
    console.log('\n❌ Validation FAILED - Will loop back to Phase 3');
  }

  process.exit(0);
}

/**
 * Check if Phase 8 can proceed
 */
function checkCanComplete(sessionPath) {
  const meta = loadSessionMeta(sessionPath);

  if (!meta.outerLoop || !meta.outerLoop.phase7Results) {
    console.error('\n❌ BLOCKED: No Phase 7 results found');
    console.error('Phase 8 requires Phase 7 validation to PASS first.');
    process.exit(1);
  }

  const results = meta.outerLoop.phase7Results;
  const lastResult = results[results.length - 1];

  if (!lastResult) {
    console.error('\n❌ BLOCKED: No Phase 7 results found');
    console.error('Phase 8 requires Phase 7 validation to PASS first.');
    process.exit(1);
  }

  if (lastResult.status !== 'PASS') {
    console.error('\n❌ BLOCKED: Phase 7 did not PASS');
    console.error(`  Last result: ${lastResult.status}`);
    if (lastResult.reason) {
      console.error(`  Reason: ${lastResult.reason}`);
    }
    console.error('\nPhase 8 cannot proceed until Phase 7 validation PASSES.');
    console.error('Options:');
    console.error('  1. Fix issues and retry validation');
    console.error('  2. User accepts partial completion');
    process.exit(1);
  }

  console.log('\n✅ Phase 8 can proceed');
  console.log(`  Phase 7 PASSED on iteration ${lastResult.iteration}`);
  console.log(`  Total iterations used: ${meta.outerLoop.currentIteration}`);
  process.exit(0);
}

/**
 * Get current loop status
 */
function getStatus(sessionPath) {
  const meta = loadSessionMeta(sessionPath);

  console.log('\n📊 Outer Loop Status');
  console.log('─'.repeat(40));

  if (!meta.outerLoop) {
    console.log('  Status: Not started');
    process.exit(0);
  }

  const ol = meta.outerLoop;
  const max = ol.mode === 'infinite' ? '∞' : ol.maxIterations;

  console.log(`  Current Iteration: ${ol.currentIteration}/${max}`);
  console.log(`  Mode: ${ol.mode}`);
  console.log(`  Checkpoint: ${meta.checkpoint.nextPhase}`);

  if (ol.phase7Results && ol.phase7Results.length > 0) {
    console.log('\n  Phase 7 Results:');
    ol.phase7Results.forEach(r => {
      const score = r.score ? ` (${r.score}%)` : '';
      console.log(`    #${r.iteration}: ${r.status}${score}`);
      if (r.reason) console.log(`         ${r.reason}`);
    });

    const lastResult = ol.phase7Results[ol.phase7Results.length - 1];
    console.log(`\n  Latest: ${lastResult.status}`);
  } else {
    console.log('\n  Phase 7 Results: None yet');
  }

  process.exit(0);
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  const sessionPath = args[1];

  if (!action) {
    console.log('Usage: outer-loop-enforcer.js <action> <session_path> [options]');
    console.log('');
    console.log('Actions:');
    console.log('  start-iteration    - Start a new outer loop iteration');
    console.log('  record-result      - Record Phase 7 result (pass|fail|partial)');
    console.log('  check-can-complete - Check if Phase 8 can proceed');
    console.log('  get-status         - Get current loop status');
    process.exit(0);
  }

  if (!sessionPath) {
    console.error('Error: session_path required');
    process.exit(1);
  }

  if (!fs.existsSync(sessionPath)) {
    console.error(`Error: Session path does not exist: ${sessionPath}`);
    process.exit(1);
  }

  switch (action) {
    case 'start-iteration':
      startIteration(sessionPath, {
        maxIterations: args[2] ? parseInt(args[2]) : undefined
      });
      break;

    case 'record-result':
      if (!args[2]) {
        console.error('Error: status required (pass|fail|partial)');
        process.exit(1);
      }
      recordResult(sessionPath, args[2], {
        reason: args[3],
        score: args[4] ? parseInt(args[4]) : undefined
      });
      break;

    case 'check-can-complete':
      checkCanComplete(sessionPath);
      break;

    case 'get-status':
      getStatus(sessionPath);
      break;

    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

main();
