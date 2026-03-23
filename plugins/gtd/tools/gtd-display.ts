#!/usr/bin/env bun
/**
 * gtd-display.ts — Bold terminal formatter for GTD tasks.
 *
 * Usage:
 *   bun run <plugin>/tools/gtd-display.ts <command> [options]
 *
 * Commands:
 *   status              Dashboard with color-coded counts
 *   next [filters]      Next actions list, grouped by project
 *   capture <id> <text> Capture confirmation line
 *   work <id>           Active task confirmation
 *   tree                Full task hierarchy
 *
 * Options:
 *   --file <path>       Path to tasks.json (default: $CWD/.claude/gtd/tasks.json)
 *   --context <tag>     Filter by context (e.g. @code)
 *   --energy <level>    Filter by energy (high|medium|low)
 *   --time <minutes>    Filter by time estimate
 *   --waiting           Show waiting-for list instead of next
 *   --json              Output JSON instead of formatted text
 *   --list <name>       Target list for capture confirmation (inbox|someday)
 */

// ── ANSI helpers ────────────────────────────────────────────────────────────

const S = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  // Foreground
  black: "\x1b[30m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  blue: "\x1b[94m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
  white: "\x1b[97m",
  gray: "\x1b[90m",
  // Background
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  bgGray: "\x1b[100m",
  bgBrightGreen: "\x1b[102m",
  bgBrightYellow: "\x1b[103m",
  bgBrightMagenta: "\x1b[105m",
  bgBrightCyan: "\x1b[106m",
} as const;

function fg(style: string, text: string): string {
  return `${style}${text}${S.reset}`;
}

// ── Types ───────────────────────────────────────────────────────────────────

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
}

interface GTDStore {
  version: string;
  lastReview: string | null;
  activeTaskId: string | null;
  tasks: Task[];
}

// ── Utilities ───────────────────────────────────────────────────────────────

function termW(): number {
  return process.stdout.columns || 80;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function visLen(text: string): number {
  return stripAnsi(text).length;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function formatTime(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── Box renderer ────────────────────────────────────────────────────────────

/**
 * Wraps lines in a unicode box with a colored title bar.
 * The title bar fills the full box width with a background color.
 */
function renderBox(opts: {
  title: string;
  titleBg: string;
  titleFg?: string;
  lines: string[];
  borderColor?: string;
}): void {
  const { title, titleBg, titleFg = S.white, lines, borderColor = S.gray } = opts;
  const w = Math.min(termW(), 80);
  const inner = w - 4; // "│ " + content + " │"
  const bc = borderColor;

  // Top border
  console.log(fg(bc, `╭${"─".repeat(w - 2)}╮`));

  // Title bar — full width background fill
  const titleText = ` ${title} `;
  const titlePad = Math.max(0, w - 4 - titleText.length);
  console.log(
    `${fg(bc, "│")} ${titleBg}${S.bold}${titleFg}${titleText}${" ".repeat(titlePad)}${S.reset} ${fg(bc, "│")}`
  );

  // Separator after title
  console.log(fg(bc, `├${"─".repeat(w - 2)}┤`));

  // Content lines — clamp to inner width
  for (const line of lines) {
    const vl = visLen(line);
    if (vl <= inner) {
      const pad = inner - vl;
      console.log(`${fg(bc, "│")} ${line}${" ".repeat(pad)} ${fg(bc, "│")}`);
    } else {
      // Truncate: walk through chars, tracking visible length
      let out = "";
      let vis = 0;
      let inEsc = false;
      for (let i = 0; i < line.length && vis < inner - 1; i++) {
        const ch = line[i];
        if (ch === "\x1b") { inEsc = true; out += ch; continue; }
        if (inEsc) { out += ch; if (ch >= "A" && ch <= "z") inEsc = false; continue; }
        out += ch;
        vis++;
      }
      out += S.reset + "…";
      const finalVis = vis + 1; // +1 for ellipsis
      const pad = Math.max(0, inner - finalVis);
      console.log(`${fg(bc, "│")} ${out}${" ".repeat(pad)} ${fg(bc, "│")}`);
    }
  }

  // Bottom border
  console.log(fg(bc, `╰${"─".repeat(w - 2)}╯`));
}

/**
 * Small inline box for single-line confirmations (capture, moved, completed).
 */
function renderInlineBox(content: string, borderColor: string = S.gray): void {
  const w = Math.min(termW(), 80);
  const inner = w - 4;
  const bc = borderColor;
  const vl = visLen(content);

  console.log(fg(bc, `╭${"─".repeat(w - 2)}╮`));
  if (vl <= inner) {
    const pad = inner - vl;
    console.log(`${fg(bc, "│")} ${content}${" ".repeat(pad)} ${fg(bc, "│")}`);
  } else {
    // Truncate safely
    let out = "";
    let vis = 0;
    let inEsc = false;
    for (let i = 0; i < content.length && vis < inner - 1; i++) {
      const ch = content[i];
      if (ch === "\x1b") { inEsc = true; out += ch; continue; }
      if (inEsc) { out += ch; if (ch >= "A" && ch <= "z") inEsc = false; continue; }
      out += ch;
      vis++;
    }
    out += S.reset + "…";
    const pad = Math.max(0, inner - vis - 1);
    console.log(`${fg(bc, "│")} ${out}${" ".repeat(pad)} ${fg(bc, "│")}`);
  }
  console.log(fg(bc, `╰${"─".repeat(w - 2)}╯`));
}

// ── Visual building blocks ──────────────────────────────────────────────────

function pill(label: string, value: number | string, bg: string, fgColor: string = S.white): string {
  return `${bg}${S.bold}${fgColor} ${label} ${value} ${S.reset}`;
}

function badge(text: string, style: string = `${S.bgGray}${S.white}`): string {
  return `${style} ${text} ${S.reset}`;
}

function energyDisplay(energy: string | null): { icon: string; color: string; label: string } {
  switch (energy) {
    case "high":   return { icon: "▲", color: S.green,  label: "high" };
    case "medium": return { icon: "◆", color: S.yellow, label: "med" };
    case "low":    return { icon: "▽", color: S.gray,   label: "low" };
    default:       return { icon: "·", color: S.gray,   label: "" };
  }
}

function listBg(list: string): string {
  switch (list) {
    case "inbox":     return S.bgBrightMagenta;
    case "next":      return S.bgGreen;
    case "waiting":   return S.bgYellow;
    case "someday":   return S.bgCyan;
    case "project":   return S.bgBlue;
    case "reference": return S.bgWhite;
    default:          return S.bgGray;
  }
}

// ── Load data ───────────────────────────────────────────────────────────────

function loadStore(filePath: string): GTDStore {
  try {
    const raw = require("fs").readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: "1.0", lastReview: null, activeTaskId: null, tasks: [] };
  }
}

// ── Render task line ────────────────────────────────────────────────────────

function renderTask(t: Task, opts: {
  prefix?: string;
  showEnergy?: boolean;
  showMeta?: boolean;
  showId?: boolean;
  dimSubject?: boolean;
} = {}): string {
  const {
    prefix = "",
    showEnergy = true,
    showMeta = true,
    showId = true,
    dimSubject = false,
  } = opts;

  const e = energyDisplay(t.energy);
  const icon = showEnergy ? `${e.color}${e.icon}${S.reset} ` : "";
  const subject = dimSubject
    ? fg(S.gray, t.subject)
    : fg(`${S.bold}${e.color}`, t.subject);

  let line = `${prefix}${icon}${subject}`;

  if (showMeta) {
    const meta: string[] = [];
    if (t.context.length > 0) {
      meta.push(fg(S.cyan, t.context.join(" ")));
    }
    if (t.timeEstimate) {
      meta.push(fg(S.white, formatTime(t.timeEstimate)));
    }
    if (t.energy && showEnergy) {
      meta.push(fg(e.color, e.label));
    }
    if (t.waitingOn) {
      meta.push(fg(S.yellow, `⏳${t.waitingOn}`));
    }
    if (t.dueDate) {
      const d = daysSince(t.dueDate);
      if (d > 0) meta.push(badge(`${d}d overdue`, `${S.bgRed}${S.white}`));
      else meta.push(fg(S.gray, `due ${t.dueDate.slice(0, 10)}`));
    }
    if (meta.length > 0) line += "  " + meta.join(fg(S.gray, " · "));
  }

  if (showId) {
    line += fg(S.gray, `  #${t.id}`);
  }

  return line;
}

// ── Commands ────────────────────────────────────────────────────────────────

function cmdStatus(store: GTDStore, jsonOutput: boolean): void {
  const active = store.tasks.filter(t => t.completed === null);
  const counts = {
    inbox: active.filter(t => t.list === "inbox").length,
    next: active.filter(t => t.list === "next").length,
    waiting: active.filter(t => t.list === "waiting").length,
    someday: active.filter(t => t.list === "someday").length,
    reference: active.filter(t => t.list === "reference").length,
    projects: active.filter(t => t.list === "project").length,
    overdue: active.filter(t =>
      t.list === "next" && t.dueDate !== null && new Date(t.dueDate) < new Date()
    ).length,
  };

  if (jsonOutput) {
    const activeTask = store.activeTaskId
      ? store.tasks.find(t => t.id === store.activeTaskId) || null
      : null;
    console.log(JSON.stringify({
      counts,
      activeTaskId: store.activeTaskId,
      lastReview: store.lastReview,
      nextAction: active.find(t => t.list === "next") || null,
      activeTask,
    }, null, 2));
    return;
  }

  const lines: string[] = [];

  // Count pills
  const pills = [
    pill("INBOX", counts.inbox, S.bgBrightMagenta, S.black),
    pill("NEXT", counts.next, S.bgGreen, S.black),
    pill("WAIT", counts.waiting, S.bgYellow, S.black),
    pill("SOMEDAY", counts.someday, S.bgCyan, S.black),
    pill("PROJ", counts.projects, S.bgBlue),
  ];
  if (counts.reference > 0) {
    pills.push(pill("REF", counts.reference, S.bgWhite, S.black));
  }
  if (counts.overdue > 0) {
    pills.push(pill("OVERDUE", counts.overdue, S.bgRed));
  }
  lines.push(pills.join(" "));

  // Active task
  if (store.activeTaskId) {
    const activeTask = store.tasks.find(t => t.id === store.activeTaskId);
    if (activeTask) {
      lines.push("");
      lines.push(`${fg(S.bold + S.white, "▶ Active:")} ${fg(S.bold + S.green, activeTask.subject)}`);
    }
  }

  // Next action preview
  const nextAction = active.find(t => t.list === "next");
  if (nextAction) {
    const parts = [nextAction.subject];
    if (nextAction.context.length > 0) parts.push(fg(S.gray, nextAction.context.join(" ")));
    if (nextAction.timeEstimate) parts.push(fg(S.gray, formatTime(nextAction.timeEstimate)));
    lines.push(`${fg(S.gray, "↳ Next:")} ${parts.join("  ")}`);
  }

  // Review status
  const reviewDays = daysSince(store.lastReview);
  let reviewStr: string;
  if (reviewDays >= 999) {
    reviewStr = badge("NEVER REVIEWED", `${S.bgRed}${S.white}`);
  } else if (reviewDays >= 14) {
    reviewStr = badge(`${reviewDays}d ago — OVERDUE`, `${S.bgRed}${S.white}`);
  } else if (reviewDays >= 7) {
    reviewStr = badge(`${reviewDays}d ago — due now`, `${S.bgYellow}${S.black}`);
  } else {
    const daysUntil = 7 - reviewDays;
    reviewStr = fg(S.green, `${reviewDays}d ago — due in ${daysUntil}d`);
  }
  lines.push("");
  lines.push(`${fg(S.gray, "Review:")} ${reviewStr}`);

  renderBox({ title: "GTD STATUS", titleBg: S.bgBlue, lines });
}

function cmdNext(
  store: GTDStore,
  filters: { context?: string; energy?: string; time?: number; waiting?: boolean },
  jsonOutput: boolean
): void {
  const targetList = filters.waiting ? "waiting" : "next";
  let tasks = store.tasks.filter(t =>
    t.list === targetList && t.completed === null
  );

  if (filters.context) tasks = tasks.filter(t => t.context.includes(filters.context!));
  if (filters.energy) tasks = tasks.filter(t => t.energy === filters.energy);
  if (filters.time) tasks = tasks.filter(t => t.timeEstimate !== null && t.timeEstimate <= filters.time!);

  if (jsonOutput) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  const listLabel = filters.waiting ? "WAITING FOR" : "NEXT ACTIONS";
  const bg = filters.waiting ? S.bgYellow : S.bgGreen;
  const fgc = S.black;

  if (tasks.length === 0) {
    renderBox({
      title: `${listLabel}  ·  0 tasks`,
      titleBg: bg,
      titleFg: fgc,
      lines: [fg(S.gray, "No tasks match. Try /gtd:clarify to process inbox items.")],
    });
    return;
  }

  // Build name lookup
  const taskNameMap = new Map<string, string>();
  const taskIdSet = new Set(tasks.map(t => t.id));
  for (const t of store.tasks) {
    taskNameMap.set(t.id, t.subject);
  }

  function rootParent(t: Task): string {
    let parentId = t.parentId;
    while (parentId) {
      const parent = store.tasks.find(p => p.id === parentId);
      if (!parent || !parent.parentId) break;
      parentId = parent.parentId;
    }
    return parentId || "(standalone)";
  }

  const topLevelTasks = tasks.filter(t => !t.parentId || !taskIdSet.has(t.parentId));

  const groups = new Map<string, Task[]>();
  for (const t of topLevelTasks) {
    const key = rootParent(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === "(standalone)") return 1;
    if (b === "(standalone)") return -1;
    return (taskNameMap.get(a) || a).localeCompare(taskNameMap.get(b) || b);
  });

  const lines: string[] = [];

  for (const [groupKey, groupTasks] of sortedGroups) {
    if (lines.length > 0) lines.push("");

    // Project header
    if (groupKey !== "(standalone)") {
      const projectName = taskNameMap.get(groupKey) || groupKey;
      lines.push(`${fg(S.bold + S.blue, "■")} ${fg(S.bold + S.white, projectName)}`);
    }

    for (let i = 0; i < groupTasks.length; i++) {
      const t = groupTasks[i];
      const isLast = i === groupTasks.length - 1;
      const treeChar = groupKey !== "(standalone)"
        ? fg(S.gray, isLast ? "└─ " : "├─ ")
        : "";

      lines.push(renderTask(t, { prefix: treeChar }));

      // Subtasks
      const subtasks = store.tasks.filter(
        st => st.parentId === t.id && st.completed === null
      );
      for (let j = 0; j < subtasks.length; j++) {
        const st = subtasks[j];
        const stIsLast = j === subtasks.length - 1;
        const indent = groupKey !== "(standalone)"
          ? fg(S.gray, isLast ? "   " : "│  ")
          : "  ";
        const stTree = fg(S.gray, stIsLast ? "└─ " : "├─ ");

        lines.push(renderTask(st, {
          prefix: indent + stTree,
          dimSubject: true,
          showEnergy: true,
          showMeta: true,
        }));
      }
    }
  }

  renderBox({
    title: `${listLabel}  ·  ${tasks.length} tasks`,
    titleBg: bg,
    titleFg: fgc,
    lines,
  });
}

function cmdCapture(_store: GTDStore, taskId: string, text: string, list: string): void {
  const bg = list === "someday" ? S.bgCyan : S.bgBrightMagenta;
  const label = list === "someday" ? "SOMEDAY" : "INBOX";
  const content = `${pill(label + " +", "", bg, S.black)} ${fg(S.bold + S.white, `"${text}"`)}  ${fg(S.gray, taskId)}`;
  const borderColor = list === "someday" ? S.cyan : S.magenta;
  renderInlineBox(content, borderColor);
}

function cmdWork(store: GTDStore, taskId: string): void {
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) {
    console.log(fg(S.red, `Task not found: ${taskId}`));
    return;
  }

  const lines: string[] = [];
  lines.push(`${fg(S.bold + S.green, "▶")} ${fg(S.bold + S.white, task.subject)}  ${fg(S.gray, taskId)}`);

  const subtasks = store.tasks.filter(
    t => t.parentId === taskId && t.completed === null
  );

  if (subtasks.length > 0) {
    lines.push("");
    lines.push(fg(S.gray, `${subtasks.length} subtask${subtasks.length > 1 ? "s" : ""} pending:`));
    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i];
      const isLast = i === subtasks.length - 1;
      const tree = fg(S.gray, isLast ? "└─ " : "├─ ");
      lines.push(renderTask(st, { prefix: tree }));
    }
  }

  renderBox({ title: "ACTIVE TASK", titleBg: S.bgGreen, titleFg: S.black, lines });
}

function cmdTree(store: GTDStore, jsonOutput: boolean): void {
  const active = store.tasks.filter(t => t.completed === null);

  if (jsonOutput) {
    console.log(JSON.stringify(active, null, 2));
    return;
  }

  const topLevel = active.filter(t => t.parentId === null);
  const children = new Map<string, Task[]>();
  for (const t of active) {
    if (t.parentId) {
      if (!children.has(t.parentId)) children.set(t.parentId, []);
      children.get(t.parentId)!.push(t);
    }
  }

  const lines: string[] = [];
  const lists = ["project", "next", "waiting", "inbox", "someday", "reference"];

  for (const list of lists) {
    const listTasks = topLevel.filter(t => t.list === list);
    if (listTasks.length === 0) continue;

    if (lines.length > 0) lines.push("");

    const label = list.charAt(0).toUpperCase() + list.slice(1);
    lines.push(pill(label.toUpperCase(), listTasks.length, listBg(list), S.black));

    for (let i = 0; i < listTasks.length; i++) {
      const t = listTasks[i];
      const isLast = i === listTasks.length - 1;
      const tree = fg(S.gray, isLast ? "└─ " : "├─ ");

      lines.push(renderTask(t, { prefix: tree }));

      const kids = children.get(t.id) || [];
      for (let j = 0; j < kids.length; j++) {
        const kid = kids[j];
        const kidIsLast = j === kids.length - 1;
        const indent = fg(S.gray, isLast ? "   " : "│  ");
        const kidTree = fg(S.gray, kidIsLast ? "└─ " : "├─ ");

        lines.push(renderTask(kid, { prefix: indent + kidTree, dimSubject: true }));

        const grandkids = children.get(kid.id) || [];
        const kidCont = fg(S.gray, kidIsLast ? "   " : "│  ");
        for (let k = 0; k < grandkids.length; k++) {
          const gk = grandkids[k];
          const gkIsLast = k === grandkids.length - 1;
          const gkTree = fg(S.gray, gkIsLast ? "└─ " : "├─ ");

          lines.push(renderTask(gk, { prefix: indent + kidCont + gkTree, dimSubject: true }));
        }
      }
    }
  }

  renderBox({ title: "TASK TREE", titleBg: S.bgBlue, lines });
}

function cmdClarifyDone(count: number): void {
  const content = `${pill("✓ INBOX CLARIFIED", "", S.bgGreen, S.black)} ${count} item(s) clarified. Run /gtd:next for next actions.`;
  renderInlineBox(content, S.green);
}

function cmdMoved(task: { subject: string; list: string; id: string }): void {
  const bg = listBg(task.list);
  const label = task.list.toUpperCase();
  const content = `${pill("→ " + label, "", bg, S.black)} ${fg(S.white, `"${task.subject}"`)}  ${fg(S.gray, task.id)}`;
  renderInlineBox(content, S.green);
}

function cmdCompleted(task: { subject: string; id: string }): void {
  const content = `${pill("✓ DONE", "", S.bgGreen, S.black)} ${fg(S.dim + S.white, task.subject)}  ${fg(S.gray, task.id)}`;
  renderInlineBox(content, S.green);
}

// ── CLI Entry Point ─────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  let filePath = `${process.cwd()}/.claude/gtd/tasks.json`;
  let jsonOutput = false;
  let context: string | undefined;
  let energy: string | undefined;
  let time: number | undefined;
  let waiting = false;
  let targetList = "inbox";

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--file": filePath = args[++i]; break;
      case "--json": jsonOutput = true; break;
      case "--context": context = args[++i]; break;
      case "--energy": energy = args[++i]; break;
      case "--time": time = parseInt(args[++i]); break;
      case "--waiting": waiting = true; break;
      case "--list": targetList = args[++i]; break;
    }
  }

  const store = loadStore(filePath);

  switch (command) {
    case "status":
      cmdStatus(store, jsonOutput);
      break;

    case "next":
      cmdNext(store, { context, energy, time, waiting }, jsonOutput);
      break;

    case "capture": {
      const id = args[1];
      const textParts: string[] = [];
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith("--")) {
          if (i + 1 < args.length && !args[i + 1].startsWith("--")) i++;
          continue;
        }
        textParts.push(args[i]);
      }
      cmdCapture(store, id || "unknown", textParts.join(" ") || "untitled", targetList);
      break;
    }

    case "engage": {
      const taskId = args[1];
      if (!taskId) {
        console.log(fg(S.red, "Usage: gtd-display engage <task-id>"));
        process.exit(1);
      }
      cmdWork(store, taskId);
      break;
    }

    case "tree":
      cmdTree(store, jsonOutput);
      break;

    case "clarify-done": {
      const count = parseInt(args[1] || "0");
      cmdClarifyDone(count);
      break;
    }

    case "moved": {
      const id = args[1];
      const list = args[2];
      const subject = args.slice(3).filter(a => !a.startsWith("--")).join(" ");
      cmdMoved({ id, list, subject });
      break;
    }

    case "completed": {
      const id = args[1];
      const subject = args.slice(2).filter(a => !a.startsWith("--")).join(" ");
      cmdCompleted({ id, subject });
      break;
    }

    default:
      console.log(`GTD Display Tool

Usage: bun run gtd-display.ts <command> [options]

Commands:
  status              Dashboard with task counts
  next                Next actions (grouped by project)
  capture <id> <text> Capture confirmation
  engage <id>         Set active task confirmation
  tree                Full task hierarchy
  clarify-done <n>    Clarify completion message
  moved <id> <list> <subject>   Move confirmation
  completed <id> <subject>      Completion confirmation

Options:
  --file <path>       Path to tasks.json
  --context <tag>     Filter by context
  --energy <level>    Filter by energy
  --time <minutes>    Filter by max time
  --waiting           Show waiting-for list
  --list <name>       Target list (inbox|someday)
  --json              JSON output`);
      break;
  }
}

main();
