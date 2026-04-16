#!/usr/bin/env bun
/**
 * kanban-display.ts — Terminal display tool for the kanban plugin.
 *
 * Usage:
 *   bun run <plugin>/tools/kanban-display.ts <command> [options]
 *
 * Commands:
 *   board                    Render the full kanban board
 *   show <id>                Detailed task view in a box
 *   moved <id> <status> [title]   Confirmation: moved to column
 *   blocked <id> <blocker>   Confirmation: dependency added
 *   unblocked <id>           Confirmation: dependency removed
 *   added <id> <title...>    Confirmation: task created
 *
 * Options:
 *   --file <path>            Path to tasks.json
 *   --filter <@context>      Filter board by context tag
 *   --project <id>           Filter board by project ID
 *   --compact                Compact board display
 *   --mode simple|regular|modern   Board rendering mode (default: regular)
 */

import { execSync } from "child_process";
import {
  S,
  fg,
  renderBox,
  renderInlineBox,
  pill,
  badge,
  visLen,
  truncate,
  termW,
  print,
  progressBar,
  cardBox,
  columnsLayout,
  unifiedTable,
} from "../lib/table.ts";

// ── Types ────────────────────────────────────────────────────────────────────

interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

interface Dependencies {
  blockedBy: string[];
  blocks: string[];
}

interface Task {
  id: string;
  subject: string;
  list: string;
  context: string[];
  parentId: string | null;
  energy: string | null;
  timeEstimate: number | null;
  waitingOn: string | null;
  dueDate: string | null;
  created: string;
  modified: string;
  completed: string | null;
  notes: string;
  // Kanban v3.0 fields (all optional)
  kanbanStatus?: string | null;
  priority?: string | null;
  dependencies?: Dependencies | null;
  subtasks?: Subtask[] | null;
}

interface KanbanConfig {
  columns: string[];
  wipLimit: number;
}

interface TaskStore {
  version: string;
  nextId: number;
  lastReview: string | null;
  activeTaskId: string | null;
  kanban?: KanbanConfig;
  tasks: Task[];
}

/** Normalized task representation used by all board renderers. */
interface BoardTask {
  id: string;
  title: string;
  priority: string | null;
  subtasks: { done: number; total: number; items: Array<{ title: string; done: boolean }> } | null;
  blockedBy: string[];
  blocks: string[];
}

// ── Column config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  titleBg: string;
  titleFg: string;
  /** Accent foreground color for dot/highlights in modern mode */
  accentFg: string;
}

const COLUMN_DEFS: ColumnDef[] = [
  { key: "backlog",     label: "BACKLOG",     titleBg: S.bgGray,          titleFg: S.white, accentFg: S.gray    },
  { key: "todo",        label: "TODO",        titleBg: S.bgBlue,          titleFg: S.white, accentFg: S.blue    },
  { key: "in-progress", label: "IN PROGRESS", titleBg: S.bgBrightCyan,    titleFg: S.black, accentFg: S.cyan    },
  { key: "review",      label: "REVIEW",      titleBg: S.bgBrightMagenta, titleFg: S.black, accentFg: S.magenta },
  { key: "done",        label: "DONE",        titleBg: S.bgBrightGreen,   titleFg: S.black, accentFg: S.green   },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

const MIN_COL_WIDTH = 22;

/** Word-wrap plain text to fit within maxWidth, returning an array of lines. */
function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Resolve effective terminal width. */
function getTermWidth(): number {
  return termW();
}

/** Convert a Task to the normalized BoardTask. */
function toBoardTask(t: Task): BoardTask {
  const st = t.subtasks ?? [];
  return {
    id: t.id,
    title: t.subject,
    priority: t.priority ?? null,
    subtasks: st.length > 0 ? {
      done: st.filter(s => s.done).length,
      total: st.length,
      items: st.map(s => ({ title: s.title, done: s.done })),
    } : null,
    blockedBy: t.dependencies?.blockedBy ?? [],
    blocks: t.dependencies?.blocks ?? [],
  };
}

/**
 * Split an array of column defs into groups such that each group has
 * at least MIN_COL_WIDTH chars per column.
 * Returns groups where each group is a subset of COLUMN_DEFS indices.
 *
 * Regular/modern card mode formula: colWidth = floor((w - (n-1)) / n)
 * We need colWidth >= MIN_COL_WIDTH
 * => floor((w - n + 1) / n) >= MIN_COL_WIDTH
 * => w - n + 1 >= n * MIN_COL_WIDTH
 * => w >= n * (MIN_COL_WIDTH + 1) - 1
 */
function makeColumnGroups(
  terminalWidth: number,
  colDefs: ColumnDef[]
): ColumnDef[][] {
  const n = colDefs.length;
  // Max columns that fit: largest k where (k*(MIN_COL_WIDTH+1) - 1) <= terminalWidth
  const maxFit = Math.max(1, Math.floor((terminalWidth + 1) / (MIN_COL_WIDTH + 1)));

  if (maxFit >= n) return [colDefs];

  // Split into balanced groups rather than greedy (e.g. 5→[3,2] not [4,1])
  const groupCount = Math.ceil(n / maxFit);
  const baseSize = Math.floor(n / groupCount);
  const remainder = n % groupCount;
  const groups: ColumnDef[][] = [];
  let idx = 0;
  for (let g = 0; g < groupCount; g++) {
    const size = baseSize + (g < remainder ? 1 : 0);
    groups.push(colDefs.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

// ── Priority helpers ──────────────────────────────────────────────────────────

function priorityIndicator(priority: string | null | undefined): string {
  switch (priority) {
    case "urgent": return fg(S.red, "!! URGENT");
    case "high":   return fg(S.yellow, "^ HIGH");
    case "medium": return fg(S.cyan, "* MEDIUM");
    case "low":    return fg(S.gray, "v LOW");
    default:       return "";
  }
}

function priorityBadgeBg(priority: string | null | undefined): string {
  switch (priority) {
    case "urgent": return S.bgRed;
    case "high":   return S.bgBrightYellow;
    case "medium": return S.bgCyan;
    case "low":    return S.bgGray;
    default:       return S.bgGray;
  }
}

function priorityBadgeFg(priority: string | null | undefined): string {
  switch (priority) {
    case "urgent": return S.white;
    case "high":   return S.black;
    case "medium": return S.black;
    case "low":    return S.white;
    default:       return S.white;
  }
}

// ── SIMPLE mode ───────────────────────────────────────────────────────────────
//
// Single unified Unicode table with all columns side-by-side.
// Column headers bold. Each task: #id  title  P:priority  [done/total]  BLK
// Metadata row in gray below.

function renderSimple(
  colDefs: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  terminalWidth: number
): string {
  const groups = makeColumnGroups(terminalWidth, colDefs);
  const parts: string[] = [];

  for (const group of groups) {
    parts.push(renderSimpleGroup(group, colTaskMap, terminalWidth));
  }

  return parts.join("\n" + fg(S.gray, "─".repeat(terminalWidth)) + "\n");
}

function renderSimpleGroup(
  group: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  terminalWidth: number
): string {
  const n = group.length;
  const colInner = Math.floor((terminalWidth - 3 * n - 1) / n);

  const columns = group.map(col => {
    const tasks = colTaskMap.get(col.key) ?? [];
    const header = `${S.bold}${S.white}${col.label}${S.reset} ${fg(S.gray, `(${tasks.length})`)}`;
    const lines: string[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      // Line 1: #id
      const idStr = fg(S.cyan, `#${t.id}`);
      lines.push(idStr);
      // Title: word-wrapped to fill column width
      for (const wl of wordWrap(t.title, colInner)) {
        lines.push(wl);
      }
      // Line 2: metadata in gray
      const meta: string[] = [];
      if (t.priority) meta.push(`P:${t.priority}`);
      if (t.subtasks) meta.push(`[${t.subtasks.done}/${t.subtasks.total}]`);
      if (t.blockedBy.length > 0) meta.push("BLK");
      if (meta.length > 0) {
        lines.push(fg(S.gray, `  ${meta.join("  ")}`));
      } else {
        lines.push("");
      }
      // Separator between tasks (not after last)
      if (i < tasks.length - 1) {
        lines.push(fg(S.gray, "·".repeat(Math.min(colInner, 14))));
      }
    }
    return { header, lines };
  });

  return unifiedTable({ columns, termWidth: terminalWidth, borderColor: S.gray });
}

// ── REGULAR mode ──────────────────────────────────────────────────────────────
//
// Full-width background-colored column header pills.
// Individual card boxes per task with gray borders.
// Cards float side-by-side under their column headers.

function renderRegular(
  colDefs: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  terminalWidth: number
): string {
  const groups = makeColumnGroups(terminalWidth, colDefs);
  const parts: string[] = [];

  for (const group of groups) {
    parts.push(renderRegularGroup(group, colTaskMap, terminalWidth));
  }

  return parts.join("\n" + fg(S.gray, "═".repeat(terminalWidth)) + "\n");
}

function renderRegularGroup(
  group: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  terminalWidth: number
): string {
  const n = group.length;
  // Distribute terminal width evenly, giving remainder pixels to the last column
  const totalCardWidth = terminalWidth - (n - 1); // space for n-1 gaps between columns
  const baseW = Math.floor(totalCardWidth / n);
  const extra = totalCardWidth - baseW * n;
  // Distribute remainder pixels across the first `extra` columns (+1 each)
  const colWidths = group.map((_, i) => baseW + (i < extra ? 1 : 0));
  const out: string[] = [];

  // ── Column headers (full-width pills) ──
  const headerRow = group.map((col, i) => {
    const cw = colWidths[i];
    const tasks = colTaskMap.get(col.key) ?? [];
    const label = ` ${col.label} (${tasks.length}) `;
    const pad = Math.max(0, cw - visLen(label));
    return `${col.titleBg}${S.bold}${col.titleFg}${label}${" ".repeat(pad)}${S.reset}`;
  });
  out.push(headerRow.join(" "));
  out.push("");

  // ── Cards: build per column, then stitch card-rows with columnsLayout ──
  const colCards: string[][][] = group.map((col, i) => {
    const tasks = colTaskMap.get(col.key) ?? [];
    return tasks.map(t => buildRegularCard(t, colWidths[i]));
  });

  const maxCards = Math.max(...colCards.map(cards => cards.length), 0);

  for (let ci = 0; ci < maxCards; ci++) {
    // For each column at card index ci, determine the card lines.
    // If this column has no card at ci, create a blank filler of the same
    // height as the tallest card in this row so all columns align.
    const cardsAtRow = colCards.map(cards => cards[ci]);
    const rowHeight = Math.max(...cardsAtRow.map(c => c?.length ?? 0));
    const cardSlots = cardsAtRow.map((card, i) => ({
      lines: card ?? Array(rowHeight).fill(" ".repeat(colWidths[i])),
      width: colWidths[i],
    }));
    const rows = columnsLayout(cardSlots, 1);
    for (const row of rows) out.push(row);
    out.push("");
  }

  return out.join("\n");
}

function buildRegularCard(t: BoardTask, colWidth: number): string[] {
  const contentLines: string[] = [];

  // Line 1: #id
  const idStr = fg(S.gray, `#${t.id}`);
  contentLines.push(idStr);
  // Title: word-wrapped to fill card width (multiple lines if needed)
  const inner = colWidth - 4;
  for (const line of wordWrap(t.title, inner)) {
    contentLines.push(`${S.bold}${line}${S.reset}`);
  }

  // Priority indicator
  if (t.priority) {
    contentLines.push(`  ${priorityIndicator(t.priority)}`);
  }

  // Subtask progress bar
  if (t.subtasks) {
    const { done, total } = t.subtasks;
    const inner = colWidth - 4;
    const barW = Math.max(4, Math.floor(inner * 0.5));
    const bar = progressBar(done, total, barW);
    contentLines.push(`  ${bar} ${fg(S.gray, `[${done}/${total}]`)}`);
  }

  // Blocked indicator (use [BLK] to avoid double-width ⛔)
  if (t.blockedBy.length > 0) {
    const ids = t.blockedBy.slice(0, 3).map(b => fg(S.yellow, `#${b}`)).join(fg(S.gray, "→"));
    contentLines.push(`  ${fg(S.red, "[BLK]:")} ${ids}`);
  }

  return cardBox(contentLines, colWidth, S.gray);
}

// ── MODERN mode ───────────────────────────────────────────────────────────────
//
// Navy banner header with spaced "K  A  N  B  A  N   B  O  A  R  D" title.
// Summary stats line. Overall progress bar with gradient colors.
// Themed column header capsules (mini box ╭─╮│╰─╯) with 256-color backgrounds.
// Individual floating cards with colored dot, priority pill background,
// subtask checklist, blocked badge. Navy footer with timestamp.

// ANSI 256-color codes used by Modern mode (matching printVariant3 exactly)
const MODERN = {
  navy:       "\x1b[48;5;17m",   // banner / footer background
  headerCyan: "\x1b[38;5;75m",   // banner title text (bright cyan-ish)
  // Column header background + foreground pairs
  colTheme: {
    "backlog":     { hdrBg: "\x1b[100m",        hdrFg: "\x1b[97m", dot: "\x1b[90m",  accent: "\x1b[37m"       },
    "todo":        { hdrBg: "\x1b[48;5;25m",    hdrFg: "\x1b[97m", dot: "\x1b[94m",  accent: "\x1b[38;5;75m"  },
    "in-progress": { hdrBg: "\x1b[48;5;214m",   hdrFg: "\x1b[30m", dot: "\x1b[93m",  accent: "\x1b[38;5;214m" },
    "review":      { hdrBg: "\x1b[48;5;93m",    hdrFg: "\x1b[97m", dot: "\x1b[95m",  accent: "\x1b[38;5;141m" },
    "done":        { hdrBg: "\x1b[48;5;28m",    hdrFg: "\x1b[97m", dot: "\x1b[92m",  accent: "\x1b[38;5;84m"  },
  } as Record<string, { hdrBg: string; hdrFg: string; dot: string; accent: string }>,
  // Priority pill colors (background + foreground)
  priorityPill: {
    urgent: { bg: "\x1b[41m",          fg: "\x1b[97m", label: " URGENT " },
    high:   { bg: "\x1b[48;5;208m",    fg: "\x1b[30m", label: "  HIGH  " },
    medium: { bg: "\x1b[48;5;220m",    fg: "\x1b[30m", label: " MEDIUM " },
    low:    { bg: "\x1b[100m",         fg: "\x1b[37m", label: "  LOW   " },
  } as Record<string, { bg: string; fg: string; label: string }>,
  // Column icon labels (! instead of ⚡ to avoid double-width)
  colLabel: {
    "backlog":     "◈  BACKLOG",
    "todo":        "○  TODO",
    "in-progress": "!  IN PROGRESS",
    "review":      "◆  REVIEW",
    "done":        "✓  DONE",
  } as Record<string, string>,
} as const;

/** Center text (which may contain ANSI codes) in a field of `width` visible chars. */
function centerInField(str: string, width: number): string {
  const len = visLen(str);
  const pad = Math.max(0, width - len);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + str + " ".repeat(pad - left);
}

/** Progress bar with gradient: red < 50%, yellow >= 50%, green = 100%. */
function blockBar(done: number, total: number, width: number): string {
  if (total === 0) return fg(S.gray, "─".repeat(width));
  const pct    = done / total;
  const filled = Math.round(pct * width);
  const color  = pct >= 1 ? S.green : pct >= 0.5 ? S.yellow : S.red;
  return `${color}${"█".repeat(filled)}${S.reset}${S.gray}${"░".repeat(width - filled)}${S.reset}`;
}

function renderModern(
  colDefs: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  allTasks: BoardTask[],
  terminalWidth: number
): string {
  const groups = makeColumnGroups(terminalWidth, colDefs);
  const out: string[] = [];
  const navy = MODERN.navy;
  const R = S.reset;

  // ── Navy banner ──
  const bannerWidth = terminalWidth - 4;
  const bannerTitle = `${MODERN.headerCyan}${S.bold}${centerInField("K  A  N  B  A  N   B  O  A  R  D", bannerWidth)}${R}`;
  out.push("");
  out.push("  " + navy + " ".repeat(bannerWidth) + R);
  out.push("  " + navy + bannerTitle + R);
  out.push("  " + navy + " ".repeat(bannerWidth) + R);
  out.push("");

  // ── Summary stats ──
  const totalCount     = allTasks.length;
  const blockedCount   = allTasks.filter(t => t.blockedBy.length > 0).length;
  const inProgressCount = (colTaskMap.get("in-progress") ?? []).length;
  const doneCount      = (colTaskMap.get("done") ?? []).length;

  const stats = [
    `${S.gray}tasks ${R}${S.bold}${S.white}${totalCount}${R}`,
    `${S.gray}blocked ${R}${S.bold}${S.red}${blockedCount}${R}`,
    `${S.gray}in-progress ${R}${S.bold}${S.yellow}${inProgressCount}${R}`,
    `${S.gray}done ${R}${S.bold}${S.green}${doneCount}${R}`,
  ].join(`${S.gray}  ·  ${R}`);
  out.push("  " + stats);
  out.push("");

  // ── Overall progress bar ──
  const pbWidth = terminalWidth - 26;
  const overallPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  out.push(`  ${S.gray}Progress${R}  ${blockBar(doneCount, totalCount, pbWidth)}  ${S.bold}${S.white}${overallPct}%${R}`);
  out.push("");

  // ── Groups ──
  for (let gi = 0; gi < groups.length; gi++) {
    if (gi > 0) {
      out.push(fg(S.gray, "━".repeat(terminalWidth)));
      out.push("");
    }
    out.push(renderModernGroup(groups[gi], colTaskMap, terminalWidth));
  }

  // ── Navy footer with timestamp ──
  const ts = new Date().toLocaleTimeString();
  const footerContent = `${S.gray}rendered at ${S.white}${ts}${R}${S.gray}  ·  ${totalCount} tasks  ·  ${colDefs.length} columns${R}`;
  out.push("");
  out.push("  " + navy + centerInField(footerContent, bannerWidth) + R);
  out.push("  " + navy + " ".repeat(bannerWidth) + R);
  out.push("");

  return out.join("\n");
}

function renderModernGroup(
  group: ColumnDef[],
  colTaskMap: Map<string, BoardTask[]>,
  terminalWidth: number
): string {
  const n = group.length;
  // Distribute terminal width evenly; remainder pixels go to the first columns (+1 each)
  const totalCardWidth = terminalWidth - 2 - (n - 1); // 2 for left margin, n-1 gaps
  const baseW = Math.floor(totalCardWidth / n);
  const extra = totalCardWidth - baseW * n;
  const colWidths = group.map((_, i) => baseW + (i < extra ? 1 : 0));
  const R = S.reset;
  const out: string[] = [];

  // ── Column header capsules via cardBox() ──
  // Build 2 content lines per column with themed background, then wrap in cardBox().
  const capsuleCols = group.map((col, ci) => {
    const cw = colWidths[ci];
    const theme = MODERN.colTheme[col.key] ?? MODERN.colTheme["backlog"];
    const tasks = colTaskMap.get(col.key) ?? [];
    const cnt = tasks.length;
    const inner = cw - 4; // cardBox inner width

    const label = MODERN.colLabel[col.key] ?? col.label;
    // Line 1: bold label + count, centered
    // NO S.reset inside — fillBg in cardBox provides the background wall-to-wall.
    // The bold/fg are set at the start; cardBox's fillBg re-apply covers any gaps.
    const hdrVisText = `${label}  (${cnt})`;
    const hdrCentered = centerInField(hdrVisText, inner);
    // Apply foreground styling to the entire centered string (including padding spaces)
    const hdrLine = `${S.bold}${theme.hdrFg}${hdrCentered}`;

    // Line 2: hint subtext — NO S.reset inside, fillBg covers it
    const hintLine =
      col.key === "in-progress" ? `${S.italic}${S.gray} red-hot zone` :
      col.key === "done"        ? `${S.green}✓ complete` :
      col.key === "review"      ? `${S.italic}${S.magenta} awaiting...` :
      "";

    const capsuleLines = cardBox([hdrLine, hintLine], cw, theme.hdrBg, theme.hdrBg);
    return { lines: capsuleLines, width: cw };
  });

  const capsuleRows = columnsLayout(capsuleCols, 1);
  for (const row of capsuleRows) out.push("  " + row);
  out.push("");

  // ── Task cards side-by-side via columnsLayout() ──
  const colCardLines: string[][] = group.map((col, ci) => {
    const tasks = colTaskMap.get(col.key) ?? [];
    if (tasks.length === 0) return modernEmptyCard(colWidths[ci]);
    return tasks.flatMap(t => buildModernCard(t, col, colWidths[ci]));
  });

  const maxLines = Math.max(...colCardLines.map(c => c.length));
  const cardCols = group.map((_, ci) => {
    const lines = colCardLines[ci];
    // Pad shorter columns with blank lines to maxLines
    const padded = [...lines];
    while (padded.length < maxLines) padded.push("");
    return { lines: padded, width: colWidths[ci] };
  });

  const cardRows = columnsLayout(cardCols, 1);
  for (const row of cardRows) out.push("  " + row);

  return out.join("\n");
}

function modernEmptyCard(colWidth: number): string[] {
  const R = S.reset;
  const emptyLine = fg(S.gray, `${S.italic}  (empty)${R}`);
  return [...cardBox([emptyLine], colWidth, S.gray), ""];
}

function buildModernCard(t: BoardTask, col: ColumnDef, colWidth: number): string[] {
  const theme = MODERN.colTheme[col.key] ?? MODERN.colTheme["backlog"];
  const inner = colWidth - 4; // cardBox inner width
  const R = S.reset;
  const content: string[] = [];

  // Line 1: colored dot + #id
  const idStr    = `${S.gray}#${String(t.id).padStart(2, "0")}${R}`;
  content.push(` ${theme.dot}●${R} ${idStr}`);
  // Title: word-wrapped across multiple lines for full readability
  for (const line of wordWrap(t.title, inner - 1)) {
    content.push(` ${S.bold}${S.white}${line}${R}`);
  }

  // Line 2: priority pill + progress bar on same line (compact)
  const p = t.priority ? MODERN.priorityPill[t.priority] : null;
  const prioPill = p ? `${p.bg}${S.bold}${p.fg}${p.label}${R}` : "";
  // Priority pill — always on its own line
  if (prioPill) {
    content.push(`  ${prioPill}`);
  }

  // Subtask progress bar + checklist — separate line
  if (t.subtasks) {
    const { done, total, items } = t.subtasks;
    const pct  = Math.round((done / total) * 100);
    const barW = Math.max(4, inner - 16);
    const bar  = blockBar(done, total, barW);
    content.push(`  ${S.gray}[${done}/${total}]${R} ${bar} ${S.bold}${pct}%${R}`);

    for (let i = 0; i < Math.min(items.length, 3); i++) {
      const sub   = items[i];
      const icon  = sub.done ? `${S.green}✓${R}` : `${S.gray}○${R}`;
      const lbl   = `${S.italic}${S.gray}${truncate(sub.title, inner - 6)}${R}`;
      content.push(`   ${icon} ${lbl}`);
    }
    if (items.length > 3) {
      content.push(`   ${S.gray}+ ${items.length - 3} more...${R}`);
    }
  }

  // Blocked: [BLK] blocked → #id  (use text, not ⛔ — double-width)
  if (t.blockedBy.length > 0) {
    content.push(`  ${S.red}${S.bold}[BLK]${R}${S.red} blocked -> #${t.blockedBy.join(" #")}${R}`);
  }

  // Wrap in cardBox (guaranteed exact width) + blank gap between cards
  return [...cardBox(content, colWidth, S.gray), ""];
}

// ── Load data ────────────────────────────────────────────────────────────────

function loadStore(filePath: string): TaskStore {
  try {
    const raw = require("fs").readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      version: "3.0",
      nextId: 1,
      lastReview: null,
      activeTaskId: null,
      kanban: { columns: ["backlog", "todo", "in-progress", "review", "done"], wipLimit: 3 },
      tasks: [],
    };
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdBoard(
  store: TaskStore,
  filter?: string,
  projectId?: string,
  _compact?: boolean,
  mode: "simple" | "regular" | "modern" = "regular"
): void {
  const wipLimit = store.kanban?.wipLimit ?? 3;

  // Select tasks on the board (kanbanStatus set, not completed)
  let boardTasks = store.tasks.filter(
    t => t.completed === null && t.kanbanStatus != null
  );

  // Apply filters
  if (filter) {
    boardTasks = boardTasks.filter(t => t.context.includes(filter));
  }
  if (projectId) {
    boardTasks = boardTasks.filter(
      t => t.parentId === projectId || t.id === projectId
    );
  }

  const terminalWidth = getTermWidth();

  // Build normalized BoardTask list and column map
  const allBoardTasks: BoardTask[] = boardTasks.map(toBoardTask);
  const colTaskMap = new Map<string, BoardTask[]>();
  for (const def of COLUMN_DEFS) {
    colTaskMap.set(
      def.key,
      allBoardTasks.filter(t => {
        const raw = boardTasks.find(r => r.id === t.id);
        return raw?.kanbanStatus === def.key;
      })
    );
  }

  // Annotate in-progress label with WIP count
  const activeDefs = COLUMN_DEFS.map(def => {
    if (def.key === "in-progress") {
      const count = colTaskMap.get("in-progress")?.length ?? 0;
      const warn = count > wipLimit ? " !!" : "";
      return { ...def, label: `IN PROGRESS ${count}/${wipLimit}${warn}` };
    }
    return def;
  });

  let board: string;
  switch (mode) {
    case "simple":
      board = renderSimple(activeDefs, colTaskMap, terminalWidth);
      break;
    case "modern":
      board = renderModern(activeDefs, colTaskMap, allBoardTasks, terminalWidth);
      break;
    default:
      board = renderRegular(activeDefs, colTaskMap, terminalWidth);
      break;
  }

  // Header summary (all modes)
  const total = allBoardTasks.length;
  const done = colTaskMap.get("done")?.length ?? 0;
  const blocked = allBoardTasks.filter(t => t.blockedBy.length > 0).length;

  const header = [
    pill("BOARD", total, S.bgBlue),
    pill("DONE", done, S.bgBrightGreen, S.black),
    blocked > 0 ? pill("BLOCKED", blocked, S.bgRed) : "",
    filter ? badge(`filter: ${filter}`, `${S.bgGray}${S.white}`) : "",
    fg(S.gray, `mode:${mode}`),
  ].filter(Boolean).join("  ");

  print(header);
  print(board);
}

function cmdShow(store: TaskStore, taskId: string): void {
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) {
    print(fg(S.red, `Task #${taskId} not found.`));
    process.exit(1);
  }

  const terminalWidth = getTermWidth();
  const boxWidth = Math.min(terminalWidth, 120);
  const inner = boxWidth - 4; // "│ " + content + " │"

  const lines: string[] = [];

  // Title — word-wrapped for full readability
  for (const tl of wordWrap(task.subject, inner)) {
    lines.push(fg(S.bold + S.white, tl));
  }
  // Priority on its own line
  if (task.priority) {
    lines.push(`  ${priorityIndicator(task.priority)}`);
  }
  lines.push("");

  // Status
  const statusStr = task.kanbanStatus
    ? `${fg(S.cyan, task.kanbanStatus)}`
    : fg(S.gray, "(not on board)");
  lines.push(`${fg(S.gray, "Status:")} ${statusStr}   ${fg(S.gray, "List:")} ${task.list}`);

  // Context
  if (task.context && task.context.length > 0) {
    lines.push(`${fg(S.gray, "Context:")} ${fg(S.cyan, task.context.join("  "))}`);
  }

  // Due date
  if (task.dueDate) {
    lines.push(`${fg(S.gray, "Due:")} ${task.dueDate.slice(0, 10)}`);
  }

  // Subtasks
  if (task.subtasks && task.subtasks.length > 0) {
    lines.push("");
    const done = task.subtasks.filter(s => s.done).length;
    lines.push(`${fg(S.bold + S.white, "Subtasks")} ${fg(S.gray, `${done}/${task.subtasks.length}`)}`);
    for (let i = 0; i < task.subtasks.length; i++) {
      const st = task.subtasks[i];
      const isLast = i === task.subtasks.length - 1;
      const tree = fg(S.gray, isLast ? "└─ " : "├─ ");
      const check = st.done ? fg(S.green, "✓") : fg(S.gray, "○");
      const title = st.done ? fg(S.gray, st.title) : st.title;
      lines.push(`${tree}${check} ${title}`);
    }
  }

  // Dependencies
  const blockedBy = task.dependencies?.blockedBy ?? [];
  const blocks = task.dependencies?.blocks ?? [];

  if (blockedBy.length > 0 || blocks.length > 0) {
    lines.push("");
    lines.push(fg(S.bold + S.white, "Dependencies"));

    if (blockedBy.length > 0) {
      lines.push(fg(S.gray, "Blocked by:"));
      for (let i = 0; i < blockedBy.length; i++) {
        const bid = blockedBy[i];
        const bt = store.tasks.find(t => t.id === bid);
        const isLast = i === blockedBy.length - 1;
        const tree = fg(S.gray, isLast ? "└─ " : "├─ ");
        const status = bt?.completed ? fg(S.green, "✓ done") : fg(S.red, "[open]");
        const title = bt ? bt.subject : "(not found)";
        lines.push(`${tree}${fg(S.yellow, `#${bid}`)} ${title}  ${status}`);
      }
    }

    if (blocks.length > 0) {
      lines.push(fg(S.gray, "Blocks:"));
      for (let i = 0; i < blocks.length; i++) {
        const bid = blocks[i];
        const bt = store.tasks.find(t => t.id === bid);
        const isLast = i === blocks.length - 1;
        const tree = fg(S.gray, isLast ? "└─ " : "├─ ");
        const title = bt ? bt.subject : "(not found)";
        lines.push(`${tree}${fg(S.cyan, `#${bid}`)} ${title}`);
      }
    }
  }

  // Notes — word-wrapped
  if (task.notes && task.notes.trim()) {
    lines.push("");
    lines.push(fg(S.bold + S.white, "Notes"));
    for (const nl of wordWrap(task.notes.trim(), inner)) {
      lines.push(fg(S.gray, nl));
    }
  }

  // Timestamps
  lines.push("");
  lines.push(fg(S.gray, `Created: ${task.created.slice(0, 10)}  Modified: ${task.modified.slice(0, 10)}`));

  const colDef = COLUMN_DEFS.find(c => c.key === task.kanbanStatus) ?? COLUMN_DEFS[1];
  print(renderBox({
    title: `#${task.id}`,
    titleBg: colDef.titleBg,
    titleFg: colDef.titleFg,
    lines,
    maxWidth: boxWidth,
  }));
}

function cmdMoved(taskId: string, status: string, title: string): void {
  const colDef = COLUMN_DEFS.find(c => c.key === status);
  const bg = colDef?.titleBg ?? S.bgGray;
  const fgColor = colDef?.titleFg ?? S.white;
  const label = status.toUpperCase();
  // Use renderBox with word-wrapped title for long task names
  const terminalWidth = getTermWidth();
  const boxWidth = Math.min(terminalWidth, 120);
  const inner = boxWidth - 4;
  const titleLines = wordWrap(title, inner - 4); // leave room for quotes + indent
  const lines: string[] = [];
  lines.push(`${pill(`→ ${label}`, "", bg, fgColor)}  ${fg(S.gray, `#${taskId}`)}`);
  for (const tl of titleLines) {
    lines.push(fg(S.white, `  "${tl}"`));
  }
  print(renderBox({ title: "MOVED", titleBg: S.bgCyan, titleFg: S.black, lines, maxWidth: boxWidth }));
}

function cmdBlocked(taskId: string, blockerId: string): void {
  const content = `${fg(S.red, "[BLK]")} ${fg(S.bold + S.white, `#${taskId}`)} ${fg(S.gray, "blocked by")} ${fg(S.yellow, `#${blockerId}`)}`;
  print(renderInlineBox(content, S.yellow));
}

function cmdUnblocked(taskId: string): void {
  const content = `${fg(S.green, "✓")} ${fg(S.bold + S.white, `#${taskId}`)} ${fg(S.gray, "unblocked")}`;
  print(renderInlineBox(content, S.green));
}

function cmdAdded(taskId: string, title: string): void {
  const terminalWidth = getTermWidth();
  const boxWidth = Math.min(terminalWidth, 120);
  const inner = boxWidth - 4;
  const titleLines = wordWrap(title, inner - 4);
  const lines: string[] = [];
  lines.push(`${pill("+ ADDED", "", S.bgBlue)}  ${fg(S.gray, `#${taskId}`)}`);
  for (const tl of titleLines) {
    lines.push(fg(S.bold + S.white, `  "${tl}"`));
  }
  print(renderBox({ title: "ADDED", titleBg: S.bgBlue, titleFg: S.white, lines, maxWidth: boxWidth }));
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

/**
 * When running the "board" command without a TTY (e.g. from Claude Code's Bash tool)
 * and tmux is available, re-exec ourselves inside a tmux split pane so we get a real
 * TTY with proper terminal width. The pane waits for a keypress then closes.
 */

// Recognised interactive shells (via `pane_current_command`) for idle-pane reuse.
// Exact-equality match against this set; tmux truncates `pane_current_command`
// to ~17 chars on macOS, which is fine — no realistic binary collides on equality.
const SHELL_NAMES: ReadonlySet<string> = new Set([
  "zsh", "-zsh", "bash", "-bash", "fish", "sh", "-sh",
  "dash", "ksh", "-ksh", "csh", "-csh", "tcsh", "-tcsh",
]);

/**
 * Find an existing pane previously titled 'kanban-board' (see line that sets
 * pane title after split-window). Returns its id or null. Board re-invocations
 * prefer this over splitting again — killing any stale foreground and re-running
 * keeps the board in its existing slot instead of accumulating panes.
 */
function findExistingBoardPane(selfPaneId: string): string | null {
  try {
    const raw = execSync(
      `tmux list-panes -s -F '#{pane_id}|#{pane_title}|#{pane_dead}'`,
      { stdio: ["pipe", "pipe", "pipe"] },
    ).toString();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [paneId, title, dead] = line.split("|");
      if (!paneId || paneId === selfPaneId) continue;
      if (dead !== "0") continue;
      if (title === "kanban-board") return paneId;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Apply the 6-point idle-pane predicate and return the first pane id matching.
 * Returns null if none found. Only called when KANBAN_REUSE_IDLE=1.
 */
function findIdleReusePane(selfPaneId: string): string | null {
  try {
    const listFmt =
      "#{pane_id}|#{pane_active}|#{pane_dead}|#{pane_in_mode}|" +
      "#{pane_input_off}|#{pane_current_command}";
    const raw = execSync(
      `tmux list-panes -t '${selfPaneId}' -F '${listFmt}'`,
      { stdio: ["pipe", "pipe", "pipe"] },
    ).toString();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [paneId, active, dead, inMode, inputOff, cmd] = line.split("|");
      if (!paneId || paneId === selfPaneId) continue;
      if (active !== "0") continue;        // don't hijack active pane
      if (dead !== "0") continue;          // dead pane
      if (inMode !== "0") continue;        // copy/choose mode etc
      if (inputOff !== "0") continue;      // input disabled
      if (!SHELL_NAMES.has(cmd || "")) continue;
      return paneId;
    }
  } catch { /* ignore — fall through to split */ }
  return null;
}

function maybeReopenInTmux(args: string[]): boolean {
  if (args[0] !== "board") return false;
  if (process.stdout.isTTY) return false;
  if (!process.env.TMUX) return false;
  // Internal test hook; not user-facing. Forces inline render even when TMUX is set.
  // NOT documented in board.md. See autotest/kanban-tmux/ for usage.
  if (process.env.KANBAN_NO_TMUX === "1") return false;

  // Fix B — capture origin pane ID up-front; every tmux call below uses `-t '${selfPaneId}'`
  // so split lands in the correct pane even if the user switches windows mid-execution.
  const selfPaneId = process.env.TMUX_PANE;
  if (!selfPaneId) return false;

  // Re-invoke ourselves with the same args inside a tmux split/reused pane.
  // Wrap in `exec bash` so that when the board finishes and the read returns,
  // the pane drops to an interactive shell instead of exiting — keeps the pane
  // alive for Fix E (refresh-existing) on subsequent invocations.
  const script = process.argv[1];
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const cmd = `bun run '${script}' ${escapedArgs}; read -n1 -s -r; exec bash`;

  try {
    // Fix E — if a previous kanban-board pane is still around, reuse it.
    // Kill its foreground process (reader waiting for keypress, or a still-running
    // render), clear the screen, and send the board command fresh. Prevents a new
    // split-window pane from accumulating on every re-invocation.
    {
      const existing = findExistingBoardPane(selfPaneId);
      if (existing) {
        try {
          execSync(`tmux send-keys -t '${existing}' C-c`, { stdio: "ignore" });
          execSync(`tmux send-keys -t '${existing}' q`, { stdio: "ignore" });
          execSync(`tmux send-keys -t '${existing}' " clear" Enter`, { stdio: "ignore" });
        } catch { /* best-effort; fall through to re-render regardless */ }
        const sendCmd = cmd.replace(/'/g, "'\\''");
        execSync(`tmux send-keys -t '${existing}' '${sendCmd}' Enter`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        console.log(`Kanban board opened in tmux pane (${existing}) [refreshed]. Press any key in pane to close.`);
        return true;
      }
    }

    // Fix D — optional idle-pane reuse, gated by env var (OFF by default in v1.4.0).
    if (process.env.KANBAN_REUSE_IDLE === "1") {
      const target = findIdleReusePane(selfPaneId);
      if (target) {
        const sendCmd = cmd.replace(/'/g, "'\\''");
        execSync(`tmux send-keys -t '${target}' '${sendCmd}' Enter`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        // Fix A — confirmation to stdout (Bash tool sees this).
        console.log(`Kanban board opened in tmux pane (${target}) [reused]. Press any key in pane to close.`);
        return true;
      }
    }

    // Fix C — split direction chosen by whether origin fills its window.
    //   pane_width == window_width  → -h (side-by-side). Origin is the only column,
    //                                      so split horizontally: kanban gets its own column.
    //   pane_width  < window_width  → -v (stack). Origin already shares the window with
    //                                      a neighbour; stacking preserves each column's
    //                                      width and yields |neighbour|origin/kanban|.
    const geomOut = execSync(
      `tmux display-message -p -t '${selfPaneId}' '#{pane_width} #{window_width}'`,
      { stdio: ["pipe", "pipe", "pipe"] },
    ).toString().trim();
    const parts = geomOut.split(/\s+/).map(n => parseInt(n, 10));
    const paneW = Number.isFinite(parts[0]) ? parts[0] : 1;
    const winW = Number.isFinite(parts[1]) ? parts[1] : 1;
    const splitDir = paneW >= winW ? "-h" : "-v";

    // Fix B — -t always targets the origin pane captured at function entry.
    // Use single-quote escape (matches send-keys path above) so outer /bin/sh -c
    // does NOT evaluate $VAR or backticks in `cmd` before tmux consumes it.
    const sqCmd = cmd.replace(/'/g, "'\\''");
    const newPane = execSync(
      `tmux split-window -t '${selfPaneId}' ${splitDir} -l '40%' ` +
      `-P -F '#{pane_id}' -- '${sqCmd}'`,
      { stdio: ["pipe", "pipe", "pipe"] },
    ).toString().trim();
    execSync(`tmux select-pane -t '${newPane}' -T 'kanban-board'`, { stdio: "ignore" });

    // Fix A — confirmation to stdout so Claude Code's Bash tool sees non-empty output.
    console.log(`Kanban board opened in tmux split pane (${newPane}). Press any key in pane to close.`);
    return true;
  } catch (err) {
    console.error(`kanban-display: tmux split failed (${(err as Error).message}); rendering inline.`);
    return false;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  // If board command in non-TTY tmux context, reopen in a split pane and exit
  if (maybeReopenInTmux(args)) return;

  let filePath = `${process.cwd()}/.claude/gtd/tasks.json`;
  let filterContext: string | undefined;
  let filterProject: string | undefined;
  let compact = false;
  let boardMode: "simple" | "regular" | "modern" = "regular";

  // Parse global options (non-positional)
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--file":    filePath = args[++i]; break;
      case "--filter":  filterContext = args[++i]; break;
      case "--project": filterProject = args[++i]; break;
      case "--compact": compact = true; break;
      case "--mode": {
        const m = args[++i];
        if (m === "simple" || m === "regular" || m === "modern") boardMode = m;
        break;
      }
      default: positional.push(args[i]); break;
    }
  }

  const store = loadStore(filePath);

  switch (command) {
    case "board":
      cmdBoard(store, filterContext, filterProject, compact, boardMode);
      break;

    case "show": {
      const id = positional[0];
      if (!id) {
        print(fg(S.red, "Usage: kanban-display show <id>"));
        process.exit(1);
      }
      cmdShow(store, id);
      break;
    }

    case "moved": {
      // moved <id> <status> [title words...]
      const id = positional[0] ?? "?";
      const status = positional[1] ?? "?";
      const title = positional.slice(2).join(" ") || "task";
      cmdMoved(id, status, title);
      break;
    }

    case "blocked": {
      const id = positional[0] ?? "?";
      const blocker = positional[1] ?? "?";
      cmdBlocked(id, blocker);
      break;
    }

    case "unblocked": {
      const id = positional[0] ?? "?";
      cmdUnblocked(id);
      break;
    }

    case "added": {
      const id = positional[0] ?? "?";
      const title = positional.slice(1).join(" ") || "new task";
      cmdAdded(id, title);
      break;
    }

    default:
      print(`Kanban Display Tool

Usage: bun run kanban-display.ts <command> [options]

Commands:
  board                     Kanban board (all columns)
  show <id>                 Detailed task view
  moved <id> <status> [title]  Move confirmation
  blocked <id> <blocker>    Block confirmation
  unblocked <id>            Unblock confirmation
  added <id> <title>        Add confirmation

Options:
  --file <path>             Path to tasks.json
  --filter <@context>       Filter board by context
  --project <id>            Filter board by project ID
  --compact                 Compact board display
  --mode simple|regular|modern  Board rendering mode (default: regular)`);
      break;
  }
}

main();
