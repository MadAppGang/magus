#!/usr/bin/env bun
/**
 * Example: Simple Batch Processing with TUI Progress
 *
 * Shows the minimal setup — single phase, custom stat labels.
 */
import TUI from '../../scripts/tui.ts';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const tui = new TUI('Database Migration', {
    width: 55,
    statLabels: { created: 'Migrated', updated: 'Skipped', linked: 'Verified' },
    hideStats: ['skipped'],
  });

  const migration = tui.addPhase('Migrate Users');
  tui.begin();

  migration.start();
  const totalBatches = 40;
  for (let batch = 1; batch <= totalBatches; batch++) {
    await sleep(80);
    migration.tick({
      page: batch,
      totalPages: totalBatches,
      fetched: 50,
      created: 45,
      updated: 5,
      linked: 50,
    });
  }
  migration.done();

  tui.finish();
}

main();
