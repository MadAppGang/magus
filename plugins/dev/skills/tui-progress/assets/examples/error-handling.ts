#!/usr/bin/env bun
/**
 * Example: Error Handling with TUI Progress
 *
 * Shows how phases handle errors gracefully —
 * failed phases show red, remaining phases still run.
 */
import TUI from '../../scripts/tui.ts';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const tui = new TUI('Data Sync Pipeline');

  const phase1 = tui.addPhase('Fetch Orders');
  const phase2 = tui.addPhase('Sync Inventory');
  const phase3 = tui.addPhase('Update Prices');

  tui.begin();

  // Phase 1: succeeds
  phase1.start();
  for (let i = 1; i <= 10; i++) {
    await sleep(100);
    phase1.tick({ page: i, totalPages: 10, fetched: 50, created: 20, updated: 30 });
  }
  phase1.done();

  // Phase 2: fails mid-way
  phase2.start();
  for (let i = 1; i <= 5; i++) {
    await sleep(100);
    phase2.tick({ page: i, totalPages: 15, fetched: 50, created: 10, updated: 40 });
  }
  phase2.fail('Connection timeout after 30s — inventory API unreachable');

  // Phase 3: still runs after Phase 2 failure
  phase3.start();
  for (let i = 1; i <= 8; i++) {
    await sleep(100);
    phase3.tick({ page: i, totalPages: 8, fetched: 100, created: 5, updated: 95, linked: 80, skipped: 20 });
  }
  phase3.done();

  tui.finish();
}

main();
