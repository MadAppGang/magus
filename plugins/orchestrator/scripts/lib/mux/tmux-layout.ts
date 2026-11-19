// Pure: the main-columns layout as tmux geometry. The manager pane full height on
// the left, the other panes in columns of `columnSize`, the same shares as the
// herdr plan in pane-layout.ts. No IO.
//
// tmux puts a one-cell border between neighbouring panes, so every split below
// spends one column or row on it. `select-layout` with a custom string fills the
// cells in pane-index order and ignores the ids written in them, so the caller
// orders the panes first and the cells here are written in that order.

import { mainColumnsShare } from "../pane-layout.ts";

export interface CellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowSize {
  columns: number;
  rows: number;
}

const DEFAULT_MAIN_MIN = 0.3;
const DEFAULT_COLUMN_SIZE = 2;

/** `total` cells split into `parts` runs with a one-cell border between each: the run lengths, the last taking the rest. */
function evenRuns(total: number, parts: number): number[] {
  const usable = total - (parts - 1);
  const base = Math.floor(usable / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? usable - base * (parts - 1) : base));
}

/**
 * The rectangles of a main-columns layout of `count` panes in a window of
 * `size`, index 0 being the main pane. The main pane's width share is
 * `mainColumnsShare(count - 1, mainMin, columnSize)`; the rest of the width
 * goes to the columns evenly, and each column's height to its panes evenly.
 * `mainMin` is a fraction in (0,1), default 0.3; `columnSize` an integer of at
 * least 1, default 2. Throws when the window is too small to hold the cells.
 */
export function mainColumnsRects(count: number, size: WindowSize, opts: { mainMin?: number; columnSize?: number } = {}): CellRect[] {
  const mainMin = opts.mainMin ?? DEFAULT_MAIN_MIN;
  const columnSize = opts.columnSize ?? DEFAULT_COLUMN_SIZE;
  if (!Number.isInteger(count) || count < 1) throw new Error(`invalid pane count ${count}`);
  if (!(mainMin > 0 && mainMin < 1)) throw new Error(`invalid mainMin ${mainMin}`);
  if (!Number.isInteger(columnSize) || columnSize < 1) throw new Error(`invalid columnSize ${columnSize}`);
  const { columns: width, rows: height } = size;
  const main: CellRect = { left: 0, top: 0, width, height };
  const others = count - 1;
  if (others === 0) return [main];

  const columnCount = Math.ceil(others / columnSize);
  const mainWidth = Math.round(mainColumnsShare(others, mainMin, columnSize) * width);
  const rest = width - mainWidth - 1;
  if (mainWidth < 1 || rest < columnCount * 2 - 1) throw new Error(`a ${width}x${height} window cannot hold ${count} panes in main-columns`);
  main.width = mainWidth;

  const rects: CellRect[] = [main];
  let left = mainWidth + 1;
  const widths = evenRuns(rest, columnCount);
  for (let column = 0; column < columnCount; column++) {
    const inColumn = Math.min(columnSize, others - column * columnSize);
    if (height < inColumn * 2 - 1) throw new Error(`a ${width}x${height} window cannot hold ${inColumn} panes in one column`);
    let top = 0;
    for (const rowHeight of evenRuns(height, inColumn)) {
      rects.push({ left, top, width: widths[column] as number, height: rowHeight });
      top += rowHeight + 1;
    }
    left += (widths[column] as number) + 1;
  }
  return rects;
}

/** tmux's 16-bit layout checksum of `body`: per byte, rotate right by one bit, then add the byte; four lowercase hex digits. */
export function tmuxLayoutChecksum(body: string): string {
  let csum = 0;
  for (const byte of new TextEncoder().encode(body)) {
    csum = ((csum >> 1) | ((csum & 1) << 15)) & 0xffff;
    csum = (csum + byte) & 0xffff;
  }
  return csum.toString(16).padStart(4, "0");
}

function cell(rect: CellRect): string {
  return `${rect.width}x${rect.height},${rect.left},${rect.top}`;
}

/**
 * The tmux layout string for `rects` as `mainColumnsRects` gives them: a
 * horizontal split of the main pane and the columns, each column a vertical
 * split of its panes, cells in index order. A column of one pane is a bare
 * leaf, never a one-child split, which tmux rejects; a lone main pane is the
 * whole window as one leaf.
 */
export function tmuxLayoutString(rects: readonly CellRect[], size: WindowSize): string {
  const leaf = (index: number): string => `${cell(rects[index] as CellRect)},${index}`;
  const whole: CellRect = { left: 0, top: 0, width: size.columns, height: size.rows };
  if (rects.length <= 1) {
    const body = `${cell(whole)},0`;
    return `${tmuxLayoutChecksum(body)},${body}`;
  }
  const columns: number[][] = [];
  for (let i = 1; i < rects.length; i++) {
    const last = columns[columns.length - 1];
    if (last !== undefined && rects[last[0] as number]?.left === rects[i]?.left) last.push(i);
    else columns.push([i]);
  }
  const parts = [leaf(0)];
  for (const column of columns) {
    if (column.length === 1) {
      parts.push(leaf(column[0] as number));
      continue;
    }
    const first = rects[column[0] as number] as CellRect;
    const span: CellRect = { left: first.left, top: 0, width: first.width, height: size.rows };
    parts.push(`${cell(span)}[${column.map(leaf).join(",")}]`);
  }
  const body = `${cell(whole)}{${parts.join(",")}}`;
  return `${tmuxLayoutChecksum(body)},${body}`;
}
