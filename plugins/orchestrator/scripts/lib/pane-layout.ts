/**
 * Pure layout planning for herdr tabs: tmux-style presets turned into a list of
 * pane moves. This file imports nothing, so it can be reused on its own.
 *
 * herdr cannot rearrange panes inside one tab (`pane move` within a tab is a
 * no-op), so a plan parks every pane but one in a tab of its own and replays
 * them back with `pane move --split`. A replayed split keeps the target pane
 * first, and `--ratio` is the target's share. Every preset is built so that
 * reading the finished split tree gives the panes in `plan.order`, so switching
 * layouts never reorders them.
 *
 * Pane ids are opaque. They are compared for equality and never parsed or sorted.
 */

export const LAYOUTS = [
  "even-horizontal",
  "even-vertical",
  "main-horizontal",
  "main-vertical",
  "tiled",
  "main-horizontal-mirrored",
  "main-vertical-mirrored",
  "main-columns",
] as const;
export type LayoutName = (typeof LAYOUTS)[number];
export type Direction = "right" | "down";

/** One `pane move <pane> --tab T --target-pane <target> --split <direction> --ratio <ratio>`.
 *  `ratio` is the TARGET's share, rounded to 4 decimals. `focus` → `--focus`, else `--no-focus`. */
export interface Move {
  pane: string;
  target: string;
  direction: Direction;
  ratio: number;
  focus: boolean;
}

export interface LayoutPlan {
  layout: LayoutName;
  /** The one pane that is never parked. */
  anchor: string;
  /** The panes moved to a new tab first, in input tree order: every pane but the anchor. */
  park: string[];
  /** Replayed in this order after every park. */
  moves: Move[];
  /** The split-tree order the tab has once the plan has run. */
  order: string[];
  /** main-columns only: the main pane's planned width share; null for other presets. */
  mainShare: number | null;
  /** main-columns only: the non-main panes grouped by column, top first; [] for other presets. */
  columns: string[][];
}

export interface LayoutRequest {
  /** Validated against LAYOUTS. */
  layout: string;
  /** The tab's panes in split-tree order. */
  panes: readonly string[];
  /** Default: the first pane; for *-mirrored: the last pane. */
  main?: string;
  /** The tab's focused pane; its replay Move gets focus:true. */
  focused?: string | null;
  /** main-columns floor for the main pane's share, default 0.3, in (0,1). */
  mainMin?: number;
  /** main-horizontal/-vertical(-mirrored) share, default 0.6, in (0,1). */
  mainShare?: number;
  /** main-columns panes per column, default 2, integer ≥ 1. */
  columnSize?: number;
}

export type PlanResult = { ok: true; plan: LayoutPlan } | { ok: false; error: string };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayoutView {
  tabId: string;
  area: Rect | null;
  focused: string | null;
  zoomed: boolean;
  panes: { id: string; rect: Rect | null }[];
}

/** herdr's whole pane list: pane id → terminal id. */
export type LivePanes = ReadonlyMap<string, string>;

const DEFAULT_MAIN_MIN = 0.3;
const DEFAULT_MAIN_SHARE = 0.6;
const DEFAULT_COLUMN_SIZE = 2;

/** Math.round(x * 10_000) / 10_000. */
export function roundRatio(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** main-columns main share for `children` other panes: max(mainMin, 1/(ceil(children/columnSize)+1)),
 *  rounded to 4 decimals. children = 0 → 1. */
export function mainColumnsShare(
  children: number,
  mainMin: number = DEFAULT_MAIN_MIN,
  columnSize: number = DEFAULT_COLUMN_SIZE,
): number {
  if (children === 0) return 1;
  return roundRatio(Math.max(mainMin, 1 / (Math.ceil(children / columnSize) + 1)));
}

type Unfocused = Omit<Move, "focus">;

/** Lays `list` out evenly along `direction`, its first pane staying in place. */
function chain(list: readonly string[], direction: Direction): Unfocused[] {
  const moves: Unfocused[] = [];
  for (let i = 1; i < list.length; i++) {
    moves.push({
      pane: list[i] as string,
      target: list[i - 1] as string,
      direction,
      ratio: roundRatio(1 / (list.length - i + 1)),
    });
  }
  return moves;
}

function chunks(list: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Built {
  anchor: string;
  moves: Unfocused[];
  mainShare: number | null;
  columns: string[][];
}

function buildMainColumns(main: string, others: readonly string[], mainMin: number, columnSize: number): Built {
  const share = mainColumnsShare(others.length, mainMin, columnSize);
  const columns = chunks(others, columnSize);
  const first = columns[0]?.[0];
  if (first === undefined) return { anchor: main, moves: [], mainShare: share, columns };
  const moves: Unfocused[] = [{ pane: first, target: main, direction: "right", ratio: share }];
  moves.push(...chain(columns.map((column) => column[0] as string), "right"));
  for (const column of columns) moves.push(...chain(column, "down"));
  return { anchor: main, moves, mainShare: share, columns };
}

function buildMainStack(
  main: string,
  others: readonly string[],
  side: Direction,
  mirrored: boolean,
  mainShare: number,
): Built {
  const first = others[0];
  if (first === undefined) return { anchor: main, moves: [], mainShare: null, columns: [] };
  const stack: Direction = side === "right" ? "down" : "right";
  const lead: Unfocused = mirrored
    ? { pane: main, target: first, direction: side, ratio: roundRatio(1 - mainShare) }
    : { pane: first, target: main, direction: side, ratio: roundRatio(mainShare) };
  return { anchor: mirrored ? first : main, moves: [lead, ...chain(others, stack)], mainShare: null, columns: [] };
}

function buildTiled(everyone: readonly string[]): Unfocused[] {
  const rows = chunks(everyone, Math.ceil(Math.sqrt(everyone.length)));
  const moves = chain(rows.map((row) => row[0] as string), "down");
  for (const row of rows) moves.push(...chain(row, "right"));
  return moves;
}

function build(
  layout: LayoutName,
  main: string,
  others: readonly string[],
  params: { mainMin: number; mainShare: number; columnSize: number },
): Built {
  const everyone = [main, ...others];
  const plain = (moves: Unfocused[]): Built => ({ anchor: main, moves, mainShare: null, columns: [] });
  switch (layout) {
    case "even-horizontal":
      return plain(chain(everyone, "right"));
    case "even-vertical":
      return plain(chain(everyone, "down"));
    case "tiled":
      return plain(buildTiled(everyone));
    case "main-columns":
      return buildMainColumns(main, others, params.mainMin, params.columnSize);
    case "main-vertical":
      return buildMainStack(main, others, "right", false, params.mainShare);
    case "main-horizontal":
      return buildMainStack(main, others, "down", false, params.mainShare);
    case "main-vertical-mirrored":
      return buildMainStack(main, others, "right", true, params.mainShare);
    case "main-horizontal-mirrored":
      return buildMainStack(main, others, "down", true, params.mainShare);
    default: {
      const unreachable: never = layout;
      return unreachable;
    }
  }
}

function isLayoutName(value: unknown): value is LayoutName {
  return typeof value === "string" && (LAYOUTS as readonly string[]).includes(value);
}

function isOpenShare(value: number): boolean {
  return typeof value === "number" && value > 0 && value < 1;
}

/** Turns a preset and a tab's panes into a move plan. Never throws. */
export function planLayout(req: LayoutRequest): PlanResult {
  const layout = req?.layout;
  if (!isLayoutName(layout)) {
    return { ok: false, error: `unknown layout "${String(layout)}"; one of: ${LAYOUTS.join(" ")}` };
  }
  const panes = req.panes;
  if (!Array.isArray(panes) || panes.length === 0) return { ok: false, error: "no panes" };

  const seen = new Set<string>();
  for (const id of panes as readonly string[]) {
    if (typeof id !== "string" || id === "" || /\s/.test(id)) {
      return { ok: false, error: `invalid pane id "${String(id)}"` };
    }
    if (seen.has(id)) return { ok: false, error: `pane listed twice: "${id}"` };
    seen.add(id);
  }

  if (req.main !== undefined && !seen.has(req.main)) {
    return { ok: false, error: `main pane "${req.main}" is not in the tab` };
  }

  const mainMin = req.mainMin ?? DEFAULT_MAIN_MIN;
  const mainShare = req.mainShare ?? DEFAULT_MAIN_SHARE;
  const columnSize = req.columnSize ?? DEFAULT_COLUMN_SIZE;
  if (!isOpenShare(mainMin)) return { ok: false, error: `invalid mainMin: ${String(req.mainMin)}` };
  if (!isOpenShare(mainShare)) return { ok: false, error: `invalid mainShare: ${String(req.mainShare)}` };
  if (!Number.isInteger(columnSize) || columnSize < 1) {
    return { ok: false, error: `invalid columnSize: ${String(req.columnSize)}` };
  }

  const list = panes as readonly string[];
  const mirrored = layout.endsWith("-mirrored");
  const main = req.main ?? ((mirrored ? list[list.length - 1] : list[0]) as string);
  const others = list.filter((id) => id !== main);

  const built = build(layout, main, others, { mainMin, mainShare, columnSize });
  return {
    ok: true,
    plan: {
      layout,
      anchor: built.anchor,
      park: list.filter((id) => id !== built.anchor),
      moves: built.moves.map((move) => ({ ...move, focus: move.pane === req.focused })),
      order: mirrored ? [...others, main] : [main, ...others],
      mainShare: built.mainShare,
      columns: built.columns,
    },
  };
}

/** herdr args (without the binary name) for a plan, in run order. Throws when `tab` is "". */
export function planArgs(plan: LayoutPlan, tab: string): string[][] {
  if (tab === "") throw new Error("planArgs: tab is empty");
  const parks = plan.park.map((pane) => ["pane", "move", pane, "--new-tab", "--no-focus"]);
  const moves = plan.moves.map((move) => [
    "pane",
    "move",
    move.pane,
    "--tab",
    tab,
    "--target-pane",
    move.target,
    "--split",
    move.direction,
    "--ratio",
    move.ratio.toFixed(4),
    move.focus ? "--focus" : "--no-focus",
  ]);
  return [...parks, ...moves];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed text; null when it does not parse. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  return { x, y, width, height };
}

/** Parses `herdr pane layout --pane P` stdout (`.result.layout`). null when not JSON or missing
 *  tab_id / panes[].pane_id. Pane order = array order, which is herdr's split-tree order.
 *  Never throws. */
export function parsePaneLayout(stdout: string): PaneLayoutView | null {
  const root = parseJson(stdout);
  if (!isRecord(root) || !isRecord(root.result)) return null;
  const layout = root.result.layout;
  if (!isRecord(layout) || !isNonEmptyString(layout.tab_id) || !Array.isArray(layout.panes)) return null;

  const panes: PaneLayoutView["panes"] = [];
  for (const pane of layout.panes as unknown[]) {
    if (!isRecord(pane) || !isNonEmptyString(pane.pane_id)) return null;
    panes.push({ id: pane.pane_id, rect: parseRect(pane.rect) });
  }
  return {
    tabId: layout.tab_id,
    area: parseRect(layout.area),
    focused: isNonEmptyString(layout.focused_pane_id) ? layout.focused_pane_id : null,
    zoomed: layout.zoomed === true,
    panes,
  };
}

/** Parses `herdr pane list` stdout. null when not JSON, when `.result.panes` is not an array,
 *  or when any pane lacks a non-empty `pane_id` or `terminal_id`: a partial list is no list.
 *  Never throws. */
export function parsePaneList(stdout: string): LivePanes | null {
  const root = parseJson(stdout);
  if (!isRecord(root) || !isRecord(root.result) || !Array.isArray(root.result.panes)) return null;
  const live = new Map<string, string>();
  for (const pane of root.result.panes as unknown[]) {
    if (!isRecord(pane) || !isNonEmptyString(pane.pane_id) || !isNonEmptyString(pane.terminal_id)) return null;
    live.set(pane.pane_id, pane.terminal_id);
  }
  return live;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function checkMainColumnsGeometry(view: PaneLayoutView, plan: LayoutPlan): string | null {
  const rects = new Map(view.panes.map((pane) => [pane.id, pane.rect]));
  const area = view.area;
  const mainRect = rects.get(plan.anchor) ?? null;
  const columnRects = plan.columns.map((column) => column.map((id) => rects.get(id) ?? null));
  if (area === null || mainRect === null || view.panes.some((pane) => pane.rect === null)) return "layout has no rects";
  if (columnRects.some((column) => column.some((rect) => rect === null))) return "layout has no rects";
  const columns = columnRects as Rect[][];

  const share = plan.mainShare ?? 0;
  if (
    mainRect.x !== area.x ||
    mainRect.height !== area.height ||
    Math.abs(mainRect.width - share * area.width) > 1
  ) {
    return `main pane is ${mainRect.width}/${area.width} wide, planned ${share}`;
  }

  const columnXs = columns.map((column) => (column[0] as Rect).x);
  const allWidths = columns.flat().map((rect) => rect.width);
  const unevenColumns =
    columns.some((column) => column.some((rect) => rect.x !== (column[0] as Rect).x)) ||
    columnXs.some((x, i) => i > 0 && x <= (columnXs[i - 1] as number)) ||
    spread(allWidths) > 1;
  if (unevenColumns) {
    const widths = columns.map((column) => [...new Set(column.map((rect) => rect.width))].join("/"));
    return `columns are uneven: ${widths.join(" ")}`;
  }

  for (const [i, column] of columns.entries()) {
    const heights = column.map((rect) => rect.height);
    const total = heights.reduce((sum, height) => sum + height, 0);
    if (Math.abs(total - area.height) > column.length - 1 || spread(heights) > 1) {
      return `column ${i} rows are uneven: ${heights.join(" ")}`;
    }
  }
  return null;
}

/** The postconditions of an applied plan, checked on the layout read after it ran.
 *  Returns null when all hold, else the first broken one as a sentence. Never throws. */
export function checkApplied(
  view: PaneLayoutView,
  plan: LayoutPlan,
  focusedBefore: string | null,
): string | null {
  const ids = view.panes.map((pane) => pane.id);
  if (ids.length !== plan.order.length || ids.some((id, i) => id !== plan.order[i])) {
    return `order after layout differs: ${ids.join(" ")}`;
  }
  if (focusedBefore !== null && view.focused !== focusedBefore) {
    return `focus moved from ${focusedBefore} to ${String(view.focused)}`;
  }
  if (plan.layout === "main-columns" && plan.columns.length > 0) return checkMainColumnsGeometry(view, plan);
  return null;
}

/** Where `pane` goes back when a plan fails partway: its nearest predecessor in `order` that is
 *  in `inTab`, else `order[0]`, which in every preset is the anchor and never leaves the tab.
 *  Never throws. */
export function recoveryTarget(order: readonly string[], pane: string, inTab: ReadonlySet<string>): string {
  for (let i = order.indexOf(pane) - 1; i >= 0; i--) {
    const candidate = order[i] as string;
    if (inTab.has(candidate)) return candidate;
  }
  return order[0] ?? pane;
}
