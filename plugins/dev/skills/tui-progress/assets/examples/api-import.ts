#!/usr/bin/env bun
/**
 * Example: API Import with TUI Progress
 *
 * Shows how to use the TUI module for a multi-phase API import
 * that fetches paginated data and tracks per-item stats.
 */
import TUI from '../../scripts/tui.ts';

// Suppress logging from imported modules
process.env.LOG_LEVEL = 'silent';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const tui = new TUI('API Data Import', { width: 60 });

  const jobs = tui.addPhase('Jobs');
  const contacts = tui.addPhase('Contacts');
  const workOrders = tui.addPhase('Work Orders');

  tui.begin();

  // Phase 1: Jobs
  jobs.start();
  const totalJobPages = 50;
  for (let page = 1; page <= totalJobPages; page++) {
    // Simulate API call + DB upserts
    await sleep(100);
    const itemsOnPage = 100;
    const created = Math.floor(Math.random() * 20);
    const updated = itemsOnPage - created;
    const linked = Math.floor(Math.random() * 15);

    jobs.tick({
      page,
      totalPages: totalJobPages,
      fetched: itemsOnPage,
      created,
      updated,
      linked,
      skipped: itemsOnPage - linked,
    });
  }
  jobs.done();

  // Phase 2: Contacts
  contacts.start();
  const totalContactPages = 20;
  for (let page = 1; page <= totalContactPages; page++) {
    await sleep(100);
    contacts.tick({
      page,
      totalPages: totalContactPages,
      fetched: 100,
      created: 5,
      updated: 95,
      linked: 30,
      skipped: 70,
    });
  }
  contacts.done();

  // Phase 3: Work Orders
  workOrders.start();
  const totalWOPages = 30;
  for (let page = 1; page <= totalWOPages; page++) {
    await sleep(100);
    workOrders.tick({
      page,
      totalPages: totalWOPages,
      fetched: 100,
      created: 10,
      updated: 90,
      linked: 40,
      skipped: 60,
    });
  }
  workOrders.done();

  tui.finish();
}

main();
