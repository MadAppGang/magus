---
name: tui-progress
description: Create terminal progress displays for long-running scripts — multi-phase progress bars, real-time stats, ETA, speed tracking, background colors for status. Use when building import scripts, migration scripts, sync workers, batch processors, or any CLI tool that needs live progress visualization. Trigger keywords - "progress bar", "TUI progress", "import script", "migration progress", "batch progress", "show progress", "live stats", "sync progress display".
version: 0.1.0
tags: [dev, tui, progress, terminal, cli]
keywords: [progress, tui, terminal, import, migration, batch, sync, display, stats]
plugin: dev
updated: 2026-03-31
user-invocable: false
---

# TUI Progress Display

Build terminal progress views for long-running scripts. Provides a reusable TypeScript module and design patterns for consistent, clean progress displays.

## Quick Start

Copy `scripts/tui.ts` into the project and import it:

```typescript
import { TUI } from './path/to/tui.ts';

const tui = new TUI('My Import');
const phase = tui.addPhase('Jobs');
tui.begin();

phase.start();
for (let page = 1; page <= totalPages; page++) {
  const items = await fetchPage(page);
  // ... process items ...
  phase.tick({ page, totalPages, fetched: items.length, created: 5, updated: 95 });
}
phase.done();

tui.finish();
```

## Module Location

`scripts/tui.ts` — self-contained, zero dependencies, works with Bun and Node.

## API Reference

### `new TUI(title, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | `number` | `60` | Box width in characters |
| `statLabels` | `object` | `{created,updated,linked,skipped}` | Custom labels for stat columns |
| `hideStats` | `string[]` | `[]` | Hide stat columns: `'created'`, `'updated'`, `'linked'`, `'skipped'` |

### `tui.addPhase(label)` -> `Phase`

Add a tracked phase. Call before `tui.begin()`.

### `tui.begin()` / `tui.finish()`

- `begin()` — enter alternate screen buffer, hide cursor, start rendering
- `finish()` — exit alternate screen, show cursor, print summary to normal terminal

### `phase.start()` / `phase.done()` / `phase.fail(error)`

Lifecycle methods. `fail()` marks the phase red with error message.

### `phase.tick(stats)` — accumulate

Add to running totals. Call after each page/batch.

```typescript
phase.tick({ page: 5, totalPages: 100, fetched: 100, created: 10, updated: 90 });
```

### `phase.set(stats)` — replace

Set stats absolutely (not accumulating). Use when tracking totals externally.

### `PhaseStats` fields

| Field | Type | Description |
|-------|------|-------------|
| `page` | `number` | Current page/step number |
| `totalPages` | `number` | Total pages (0 = unknown) |
| `fetched` | `number` | Items processed this tick |
| `created` | `number` | New items created |
| `updated` | `number` | Existing items updated |
| `linked` | `number` | Items matched/linked |
| `skipped` | `number` | Items skipped |
| `errors` | `number` | Error count |
| `custom` | `Record<string,number>` | Custom named counters |

## Design Principles

Follow these when building progress displays:

1. **Single-line borders** — use `+`, `-`, `|`. No Unicode box drawing chars (width varies across terminals).
2. **Alternate screen buffer** — `\x1b[?1049h` on start, `\x1b[?1049l` on exit. No scroll history pollution.
3. **Cursor home redraw** — `\x1b[H\x1b[J` before each frame. More reliable than cursor-up counting.
4. **Hidden cursor** — `\x1b[?25l` during render, `\x1b[?25h` on exit. Eliminates flicker.
5. **Background colors for status** — cyan bg for running, green bg for done, red bg for error. Visible at a glance.
6. **No emojis** — ASCII-only for reliable column width. Use `[/]` spinner, `[ok]`, `[!!]`, `[ ]`.
7. **All processed items** — show every stat (fetched, created, updated, linked, skipped, errors), not just "new rows".
8. **Speed + ETA** — calculate from `page / elapsed`, show `pg/s` and remaining time estimate.
9. **Progress bar** — `####.....` style, 32 chars wide, with percentage.
10. **Suppress external logging** — set `LOG_LEVEL=silent` via env var AND `logger.level = 'silent'` after import. Redirect stderr for pg warnings.
11. **Summary on exit** — after leaving alternate screen, print final stats to normal terminal.
12. **Totals row** — running totals across all phases at the bottom.

## Suppressing Log Noise

Long-running scripts import modules that log to stdout/stderr. Suppress them:

```typescript
// Set env BEFORE running (in the shell command):
// LOG_LEVEL=silent bun run scripts/my-import.ts

// Also silence pino after import:
import { logger } from '../src/core/logger';
logger.level = 'silent';

// Suppress console during module init:
const _log = console.log;
console.log = () => {};
// ... imports ...
console.log = _log;

// For pg SSL warnings, redirect stderr:
// bun run scripts/my-import.ts 2>/dev/null
```

## Running in Split Pane

Launch import scripts in a tmux vertical split for monitoring:

```bash
tmux split-window -h -l '50%' "LOG_LEVEL=silent bun run scripts/my-import.ts 2>/dev/null"
```

## Examples

See `assets/examples/` for complete working scripts:

- `api-import.ts` — multi-phase API import with paginated data
- `simple-batch.ts` — single phase with custom stat labels
- `error-handling.ts` — graceful error handling, failed phases show red
