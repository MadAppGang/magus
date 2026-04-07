/**
 * TUI Progress Display Module
 *
 * Reusable in-place terminal progress display for long-running scripts.
 * Uses alternate screen buffer for clean rendering with no scroll pollution.
 *
 * Import and use in any Bun/Node TypeScript script:
 *
 *   import { TUI } from '<skill-path>/scripts/tui.ts';
 *   const tui = new TUI('My Import');
 *   const phase = tui.addPhase('Jobs');
 *   tui.begin();
 *   phase.start();
 *   phase.tick({ page: 1, totalPages: 100, created: 10 });
 *   phase.done();
 *   tui.finish();
 */

// ─────────────────────────────────────────────────────────────
// ANSI escape codes — ASCII-safe, no Unicode box chars or emojis
// ─────────────────────────────────────────────────────────────
const R = '\x1b[0m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
const FW = '\x1b[37m';
const FG = '\x1b[32m';
const FY = '\x1b[33m';
const FR = '\x1b[31m';
const FC = '\x1b[36m';
const FM = '\x1b[35m';
const FD = '\x1b[90m';
const BGC = '\x1b[46m';
const BGG = '\x1b[42m';
const BGR = '\x1b[41m';

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI strip
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - stripAnsi(s).length));
}

function bar(ratio: number, width: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const f = Math.round(r * width);
  return `${FG}${'#'.repeat(f)}${R}${FD}${'.'.repeat(width - f)}${R}`;
}

function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function num(n: number): string {
  return n.toLocaleString();
}

// ─────────────────────────────────────────────────────────────
// Phase — tracks one step/entity in a multi-step process
// ─────────────────────────────────────────────────────────────

export interface PhaseStats {
  page?: number;
  totalPages?: number;
  fetched?: number;
  created?: number;
  updated?: number;
  linked?: number;
  skipped?: number;
  errors?: number;
  custom?: Record<string, number>;
}

export type PhaseStatus = 'pending' | 'running' | 'done' | 'error';

export class Phase {
  label: string;
  status: PhaseStatus = 'pending';
  startTime = 0;
  page = 0;
  totalPages = 0;
  fetched = 0;
  created = 0;
  updated = 0;
  linked = 0;
  skipped = 0;
  errors = 0;
  durationMs = 0;
  errorMsg?: string;
  custom: Record<string, number> = {};
  private tui: TUI;

  constructor(label: string, tui: TUI) {
    this.label = label;
    this.tui = tui;
  }

  start(): void {
    this.status = 'running';
    this.startTime = Date.now();
    this.tui.draw();
  }

  /** Accumulate stats (add to running totals). Call after each page/batch. */
  tick(s: PhaseStats): void {
    if (s.page !== undefined) this.page = s.page;
    if (s.totalPages !== undefined) this.totalPages = s.totalPages;
    if (s.fetched !== undefined) this.fetched += s.fetched;
    if (s.created !== undefined) this.created += s.created;
    if (s.updated !== undefined) this.updated += s.updated;
    if (s.linked !== undefined) this.linked += s.linked;
    if (s.skipped !== undefined) this.skipped += s.skipped;
    if (s.errors !== undefined) this.errors += s.errors;
    if (s.custom) for (const [k, v] of Object.entries(s.custom)) this.custom[k] = (this.custom[k] ?? 0) + v;
    this.tui.draw();
  }

  /** Set stats absolutely (replace, not accumulate). */
  set(s: PhaseStats): void {
    if (s.page !== undefined) this.page = s.page;
    if (s.totalPages !== undefined) this.totalPages = s.totalPages;
    if (s.fetched !== undefined) this.fetched = s.fetched;
    if (s.created !== undefined) this.created = s.created;
    if (s.updated !== undefined) this.updated = s.updated;
    if (s.linked !== undefined) this.linked = s.linked;
    if (s.skipped !== undefined) this.skipped = s.skipped;
    if (s.errors !== undefined) this.errors = s.errors;
    if (s.custom) for (const [k, v] of Object.entries(s.custom)) this.custom[k] = v;
    this.tui.draw();
  }

  done(): void {
    this.durationMs = Date.now() - this.startTime;
    this.status = 'done';
    this.tui.draw();
  }

  fail(error: string): void {
    this.durationMs = Date.now() - this.startTime;
    this.status = 'error';
    this.errorMsg = error;
    this.tui.draw();
  }
}

// ─────────────────────────────────────────────────────────────
// TUI — the main display controller
// ─────────────────────────────────────────────────────────────

export interface TUIOptions {
  /** Box width in characters (default: 60) */
  width?: number;
  /** Custom labels for stat columns */
  statLabels?: { created?: string; updated?: string; linked?: string; skipped?: string };
  /** Hide specific stat columns */
  hideStats?: ('created' | 'updated' | 'linked' | 'skipped')[];
}

const SPIN = ['/', '-', '\\', '|'];

export class TUI {
  private title: string;
  private phases: Phase[] = [];
  private t0 = Date.now();
  private si = 0;
  private W: number;
  private IW: number;
  private labels: { created: string; updated: string; linked: string; skipped: string };
  private hidden: Set<string>;
  private active = false;

  constructor(title: string, opts?: TUIOptions) {
    this.title = title;
    this.W = opts?.width ?? 60;
    this.IW = this.W - 4;
    this.labels = {
      created: opts?.statLabels?.created ?? 'Created',
      updated: opts?.statLabels?.updated ?? 'Updated',
      linked: opts?.statLabels?.linked ?? 'Linked',
      skipped: opts?.statLabels?.skipped ?? 'Skipped',
    };
    this.hidden = new Set(opts?.hideStats ?? []);
  }

  addPhase(label: string): Phase {
    const p = new Phase(label, this);
    this.phases.push(p);
    return p;
  }

  /** Enter alternate screen buffer, hide cursor, start rendering */
  begin(): void {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    this.active = true;
    this.t0 = Date.now();
    this.draw();
  }

  /** Exit alternate screen, show cursor, print summary to normal terminal */
  finish(): void {
    this.draw();
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    this.active = false;

    const elapsed = dur(Date.now() - this.t0);
    const errs = this.phases.filter(p => p.status === 'error');

    if (errs.length > 0) {
      console.log(`${FR}Completed with ${errs.length} error(s) in ${elapsed}${R}`);
      for (const e of errs) console.log(`  ${e.label}: ${e.errorMsg}`);
    } else {
      console.log(`${FG}${B}All phases completed in ${elapsed}${R}`);
      for (const ph of this.phases) {
        const parts: string[] = [`${num(ph.fetched)} fetched`];
        if (!this.hidden.has('created')) parts.push(`+${num(ph.created)} ${this.labels.created.toLowerCase()}`);
        if (!this.hidden.has('updated')) parts.push(`~${num(ph.updated)} ${this.labels.updated.toLowerCase()}`);
        if (!this.hidden.has('linked')) parts.push(`${num(ph.linked)} ${this.labels.linked.toLowerCase()}`);
        console.log(`  ${ph.label}: ${parts.join(', ')} (${dur(ph.durationMs)})`);
      }
    }
  }

  /** Redraw the full TUI. Called automatically by Phase methods. */
  draw(): void {
    if (!this.active) return;

    const spin = SPIN[this.si++ % SPIN.length]!;
    const elapsed = dur(Date.now() - this.t0);
    const L: string[] = [];

    const ln = (s: string) => `${B}|${R} ${pad(s, this.IW)} ${B}|${R}`;
    const hr = () => `${B}+${'-'.repeat(this.W - 2)}+${R}`;

    L.push(hr());
    L.push(ln(`${B}${FC} ${this.title}${R}`));
    L.push(ln(`${DIM} Elapsed: ${elapsed}${R}`));

    for (const ph of this.phases) {
      L.push(hr());

      if (ph.status === 'pending') {
        L.push(ln(`${FD}  [ ] ${ph.label}${R}`));
      }

      if (ph.status === 'running') {
        const dt = Date.now() - ph.startTime;
        const spd = dt > 0 ? ph.page / (dt / 1000) : 0;
        const eta = ph.totalPages > 0 && ph.page > 0
          ? dur(((ph.totalPages - ph.page) / ph.page) * dt)
          : '--';
        const ratio = ph.totalPages > 0 ? ph.page / ph.totalPages : 0;
        const pctV = ph.totalPages > 0 ? Math.round(ratio * 100) : 0;

        L.push(ln(`${B}${BGC}${FW} [${spin}] ${ph.label} ${R}`));
        L.push(ln(''));
        L.push(ln(`  ${bar(ratio, 32)} ${B}${pctV}%${R}`));
        L.push(ln(`  ${DIM}pg ${num(ph.page)}/${ph.totalPages > 0 ? num(ph.totalPages) : '?'}  ${spd.toFixed(1)} pg/s  ETA ${eta}${R}`));
        L.push(ln(''));
        L.push(ln(`  ${FW}Fetched${R}   ${B}${num(ph.fetched)}${R}`));

        const s1: string[] = [];
        const s2: string[] = [];
        if (!this.hidden.has('created')) s1.push(`${FG}${this.labels.created}${R}   ${num(ph.created)}`);
        if (!this.hidden.has('updated')) s1.push(`${FC}${this.labels.updated}${R}  ${num(ph.updated)}`);
        if (!this.hidden.has('linked')) s2.push(`${FM}${this.labels.linked}${R}    ${num(ph.linked)}`);
        if (!this.hidden.has('skipped')) s2.push(`${FD}${this.labels.skipped}${R}  ${num(ph.skipped)}`);
        if (s1.length) L.push(ln(`  ${s1.join('     ')}`));
        if (s2.length) L.push(ln(`  ${s2.join('     ')}`));
        if (ph.errors > 0) L.push(ln(`  ${FR}Errors${R}    ${num(ph.errors)}`));
        for (const [k, v] of Object.entries(ph.custom)) L.push(ln(`  ${FY}${k}${R}  ${num(v)}`));
      }

      if (ph.status === 'done') {
        L.push(ln(`${B}${BGG}${FW} [ok] ${ph.label} ${R}  ${DIM}${dur(ph.durationMs)}${R}`));
        const parts: string[] = [`Fetched ${num(ph.fetched)}`];
        if (!this.hidden.has('created')) parts.push(`${FG}+${num(ph.created)}${R} new`);
        if (!this.hidden.has('updated')) parts.push(`${FC}~${num(ph.updated)}${R} upd`);
        if (!this.hidden.has('linked')) parts.push(`${FM}${num(ph.linked)}${R} linked`);
        L.push(ln(`  ${parts.join('  ')}`));
        if (ph.skipped > 0 || ph.errors > 0) {
          const extra: string[] = [];
          if (ph.skipped > 0) extra.push(`${FD}${num(ph.skipped)} skipped${R}`);
          if (ph.errors > 0) extra.push(`${FR}${num(ph.errors)} errors${R}`);
          L.push(ln(`  ${extra.join('  ')}`));
        }
        for (const [k, v] of Object.entries(ph.custom)) L.push(ln(`  ${FY}${k}${R} ${num(v)}`));
      }

      if (ph.status === 'error') {
        L.push(ln(`${B}${BGR}${FW} [!!] ${ph.label} ${R}`));
        L.push(ln(`  ${FR}${(ph.errorMsg ?? '').slice(0, this.IW - 4)}${R}`));
      }
    }

    // Totals
    const active = this.phases.filter(x => x.status === 'done' || x.status === 'running');
    if (active.length > 0) {
      L.push(hr());
      const tf = active.reduce((s, x) => s + x.fetched, 0);
      const parts: string[] = [`${num(tf)} fetched`];
      if (!this.hidden.has('created')) parts.push(`${FG}+${num(active.reduce((s, x) => s + x.created, 0))}${R} new`);
      if (!this.hidden.has('updated')) parts.push(`${FC}~${num(active.reduce((s, x) => s + x.updated, 0))}${R} upd`);
      if (!this.hidden.has('linked')) parts.push(`${FM}${num(active.reduce((s, x) => s + x.linked, 0))}${R} linked`);
      L.push(ln(`${B}Total${R} ${parts.join('  ')}`));
    }

    L.push(hr());
    process.stdout.write('\x1b[H\x1b[J' + L.join('\n') + '\n');
  }
}

export default TUI;
