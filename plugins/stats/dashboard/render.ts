#!/usr/bin/env bun
/**
 * Stats plugin dashboard renderer.
 * Queries SQLite and renders a complete ASCII dashboard to stdout.
 *
 * Usage:
 *   bun render.ts [--days N] [--project PATH] [--compact]
 */

import { join } from "path";
import { homedir } from "os";
import { openDb, getSessionSummary, getTopTools, getDurationTrend, getLastNSessions, getAllProjects } from "../lib/db.ts";
import { getSuggestions } from "../lib/suggestions.ts";
import { classifyTool } from "../lib/classifier.ts";
import type { DailyTrendRow, TopToolRow, SessionRow } from "../lib/types.ts";

// ─── ANSI colors ─────────────────────────────────────────────────────────────

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
};

function cyan(s: string)    { return `${C.cyan}${s}${C.reset}`; }
function green(s: string)   { return `${C.green}${s}${C.reset}`; }
function yellow(s: string)  { return `${C.yellow}${s}${C.reset}`; }
function red(s: string)     { return `${C.red}${s}${C.reset}`; }
function bold(s: string)    { return `${C.bold}${s}${C.reset}`; }
function dim(s: string)     { return `${C.dim}${s}${C.reset}`; }
function gray(s: string)    { return `${C.gray}${s}${C.reset}`; }

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): { days: number; project?: string; compact: boolean; json: boolean } {
  const args = process.argv.slice(2);
  let days = 14;
  let project: string | undefined;
  let compact = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) days = n;
      i++;
    } else if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1];
      i++;
    } else if (args[i] === "--compact") {
      compact = true;
    } else if (args[i] === "--json") {
      json = true;
    }
  }

  return { days, project, compact, json };
}

// ─── Layout helpers ──────────────────────────────────────────────────────────

const WIDTH = 72;

/** Strip ANSI escape codes to get the visible character count. */
function visibleLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function box(title: string, lines: string[]): string {
  const titleStr = ` ${title} `;
  const titleLen = visibleLen(titleStr);
  const leftDashes = Math.floor((WIDTH - 2 - titleLen) / 2);
  const rightDashes = WIDTH - 2 - titleLen - leftDashes;

  const top = `${C.cyan}┌${"─".repeat(leftDashes)}${C.reset}${bold(titleStr)}${C.cyan}${"─".repeat(rightDashes)}┐${C.reset}`;
  const bottom = `${C.cyan}└${"─".repeat(WIDTH - 2)}┘${C.reset}`;

  const body = lines.map((line) => {
    const pad = WIDTH - 2 - visibleLen(line);
    return `${C.cyan}│${C.reset} ${line}${" ".repeat(Math.max(0, pad - 1))}${C.cyan}│${C.reset}`;
  });

  return [top, ...body, bottom].join("\n");
}

function divider(): string {
  return `${C.cyan}${"─".repeat(WIDTH)}${C.reset}`;
}

function padEnd(s: string, n: number): string {
  const visible = visibleLen(s);
  return s + " ".repeat(Math.max(0, n - visible));
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// ─── Bar chart ───────────────────────────────────────────────────────────────

const FULL_BLOCK = "█";
const LIGHT_BLOCK = "░";
const BAR_WIDTH = 28;

function bar(ratio: number, color: (s: string) => string): string {
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return color(FULL_BLOCK.repeat(filled)) + dim(LIGHT_BLOCK.repeat(empty));
}

function activityBar(label: string, count: number, total: number, color: (s: string) => string): string {
  const ratio = total > 0 ? count / total : 0;
  const labelPad = padEnd(label, 10);
  const barStr = bar(ratio, color);
  const pctStr = padEnd(pct(ratio), 5);
  const countStr = gray(`(${count})`);
  return `  ${labelPad} ${barStr} ${pctStr} ${countStr}`;
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function sparkline(values: number[]): string {
  if (values.length === 0) return gray("(no data)");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => {
      const idx = Math.min(
        SPARK_CHARS.length - 1,
        Math.floor(((v - min) / range) * (SPARK_CHARS.length - 1))
      );
      return SPARK_CHARS[idx];
    })
    .join("");
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderHeader(days: number, project?: string): string {
  const projectLabel = project ? ` — ${project}` : " — all projects";
  const title = bold(cyan(`Claude Code Stats`)) + gray(` — Last ${days} days`) + dim(projectLabel);
  const date = gray(new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
  const rightPad = WIDTH - visibleLen(`Claude Code Stats — Last ${days} days${projectLabel}`) - visibleLen(date.replace(/\x1b\[[0-9;]*m/g, ""));
  return [
    divider(),
    `  ${title}  ${" ".repeat(Math.max(0, rightPad - 4))}${date}`,
    divider(),
  ].join("\n");
}

function renderOverview(summary: ReturnType<typeof getSessionSummary>): string {
  const sessions  = bold(String(summary.session_count));
  const tools     = bold(String(summary.total_tool_calls));
  const avgDur    = bold(formatDuration(summary.avg_duration_sec));
  const totalDur  = bold(formatDuration(summary.avg_duration_sec * summary.session_count));

  const col = 16;
  const lines = [
    `  ${padEnd(cyan("Sessions:"), col + 9)} ${padEnd(sessions, 8)}  ${padEnd(cyan("Total tools:"), col + 9)} ${tools}`,
    `  ${padEnd(cyan("Avg duration:"), col + 9)} ${padEnd(avgDur, 8)}  ${padEnd(cyan("Total time:"), col + 9)} ${totalDur}`,
  ];
  return box("Overview", lines);
}

function renderActivity(summary: ReturnType<typeof getSessionSummary>): string {
  const { avg_research_ratio, avg_coding_ratio, avg_testing_ratio, avg_delegation_ratio } = summary;
  const otherRatio = Math.max(0, 1 - avg_research_ratio - avg_coding_ratio - avg_testing_ratio - avg_delegation_ratio);

  // Approximate raw counts from ratios (for display purposes)
  const total = summary.total_tool_calls;
  const research   = Math.round(avg_research_ratio   * total);
  const coding     = Math.round(avg_coding_ratio     * total);
  const testing    = Math.round(avg_testing_ratio    * total);
  const delegation = Math.round(avg_delegation_ratio * total);
  const other      = total - research - coding - testing - delegation;

  const lines = [
    activityBar("research",   research,   total, cyan),
    activityBar("coding",     coding,     total, green),
    activityBar("testing",    testing,    total, yellow),
    activityBar("delegation", delegation, total, magenta),
    activityBar("other",      other,      total, gray),
  ];

  return box("Activity Breakdown", lines);
}

function magenta(s: string): string { return `${C.magenta}${s}${C.reset}`; }

function renderTopTools(tools: TopToolRow[], compact: boolean): string {
  if (tools.length === 0) {
    return box("Top Tools", [dim("  No tool call data available.")]);
  }

  const maxCount = tools[0].call_count;
  const limit = compact ? 5 : 10;
  const shown = tools.slice(0, limit);

  const lines = shown.map((t) => {
    const ratio = maxCount > 0 ? t.call_count / maxCount : 0;
    const miniBar = bar(ratio, cyan).slice(0, BAR_WIDTH / 2 * 2); // half-width bar
    const name    = padEnd(t.tool_name, 18);
    const count   = padEnd(bold(String(t.call_count)), 8);
    const avg     = padEnd(dim(formatMs(t.avg_duration_ms)), 10);
    const cat     = dim(t.activity_category);
    return `  ${name} ${count} ${avg} ${cat}`;
  });

  // header
  const hdr = `  ${padEnd(dim("tool"), 18)} ${padEnd(dim("calls"), 8)} ${padEnd(dim("avg"), 10)} ${dim("category")}`;
  return box("Top Tools", [hdr, ...lines]);
}

function renderDailyTrend(trend: DailyTrendRow[], days: number, compact: boolean): string {
  if (trend.length === 0) {
    return box(`Daily Activity — last ${days} days`, [dim("  No trend data available.")]);
  }

  // Fill in missing dates so the sparkline is continuous
  const today = new Date();
  const dateMap = new Map(trend.map((r) => [r.date, r]));
  const filled: DailyTrendRow[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
    filled.push(dateMap.get(key) ?? { date: key, total_duration_sec: 0, session_count: 0 });
  }

  const durationValues = filled.map((r) => r.total_duration_sec);
  const sessionValues  = filled.map((r) => r.session_count);

  const spark = cyan(sparkline(durationValues));
  const sparkSessions = green(sparkline(sessionValues));

  // Axis labels: first and last date
  const firstDate = gray(filled[0].date.slice(5));  // MM-DD
  const lastDate  = gray(filled[filled.length - 1].date.slice(5));
  const sparkLen = days; // one char per day

  // Total stats for period
  const totalSessions = filled.reduce((s, r) => s + r.session_count, 0);
  const totalDurSec   = filled.reduce((s, r) => s + r.total_duration_sec, 0);
  const activeDays    = filled.filter((r) => r.session_count > 0).length;

  const labelLine = `  ${firstDate}${" ".repeat(Math.max(0, sparkLen - visibleLen(firstDate.replace(/\x1b\[[0-9;]*m/g,"")) - visibleLen(lastDate.replace(/\x1b\[[0-9;]*m/g,""))))}${lastDate}`;

  const lines = [
    `  ${dim("duration ")} ${spark}`,
    `  ${dim("sessions ")} ${sparkSessions}`,
    labelLine,
    "",
    `  ${cyan("Active days:")} ${bold(String(activeDays))}/${days}    ${cyan("Total sessions:")} ${bold(String(totalSessions))}    ${cyan("Total time:")} ${bold(formatDuration(totalDurSec))}`,
  ];

  if (compact) lines.splice(2, 1); // remove label line in compact mode

  return box(`Daily Activity — last ${days} days`, lines);
}

function renderSuggestions(sessions: SessionRow[], compact: boolean): string | null {
  const suggestions = getSuggestions(sessions);
  if (suggestions.length === 0) return null;

  const limit = compact ? 1 : suggestions.length;
  const lines: string[] = [];

  for (const s of suggestions.slice(0, limit)) {
    // Word-wrap suggestion to fit in box
    const maxLineLen = WIDTH - 6; // 2 for border, 2 for padding, 2 margin
    const words = s.split(" ");
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > maxLineLen) {
        lines.push(`  ${yellow("›")} ${current}`);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(`  ${yellow("›")} ${current}`);
    if (!compact) lines.push("");
  }

  // Remove trailing empty line
  while (lines[lines.length - 1] === "") lines.pop();

  return box("Suggestions", lines);
}

// ─── JSON output ─────────────────────────────────────────────────────────────

function renderJson(
  days: number,
  project: string | undefined,
  summary: ReturnType<typeof getSessionSummary>,
  tools: TopToolRow[],
  trend: DailyTrendRow[],
  sessions: SessionRow[]
): void {
  const total = summary.total_tool_calls;
  const research   = Math.round(summary.avg_research_ratio   * total);
  const coding     = Math.round(summary.avg_coding_ratio     * total);
  const testing    = Math.round(summary.avg_testing_ratio    * total);
  const delegation = Math.round(summary.avg_delegation_ratio * total);
  const other      = total - research - coding - testing - delegation;

  const output = {
    period_days: days,
    project: project ?? null,
    summary: {
      session_count: summary.session_count,
      avg_duration_min: summary.avg_duration_sec > 0
        ? Math.round((summary.avg_duration_sec / 60) * 10) / 10
        : 0,
      total_tool_calls: summary.total_tool_calls,
    },
    activity: { research, coding, testing, delegation, other },
    top_tools: tools.map((t) => ({
      tool_name: t.tool_name,
      call_count: t.call_count,
      avg_duration_sec: Math.round((t.avg_duration_ms / 1000) * 100) / 100,
      activity_category: t.activity_category,
    })),
    daily_trend: trend.map((r) => ({
      date: r.date,
      session_count: r.session_count,
      total_duration_sec: r.total_duration_sec,
    })),
    suggestions: getSuggestions(sessions),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const { days, project, compact, json } = parseArgs();

  // Resolve DB path
  const dbPath = join(homedir(), ".claude", "stats", "stats.db");

  let db;
  try {
    db = openDb(dbPath);
  } catch (err) {
    console.error(red(`Error opening stats database: ${err}`));
    process.exit(2);
  }

  // Query data
  const summary  = getSessionSummary(db, days, project);
  const tools    = getTopTools(db, days, project, 10);
  const trend    = getDurationTrend(db, days, project);
  const sessions = getLastNSessions(db, 20, project);

  db.close();

  // JSON output mode
  if (json) {
    if (summary.session_count === 0) {
      process.stdout.write(JSON.stringify({ no_data: true, period_days: days, project: project ?? null }) + "\n");
      process.exit(1);
    }
    renderJson(days, project, summary, tools, trend, sessions);
    return;
  }

  // Check for no data
  if (summary.session_count === 0) {
    console.log(divider());
    console.log(`  ${bold(cyan("Claude Code Stats"))} ${gray("— No data found")}`);
    console.log(divider());
    console.log(`  ${yellow("›")} No sessions recorded in the last ${days} days.`);
    if (project) {
      console.log(`  ${dim(`Project filter: ${project}`)}`);
    }
    console.log(`  ${dim("Run Claude Code to start collecting stats.")}`);
    console.log(divider());
    process.exit(1);
  }

  // Render sections
  const sections: string[] = [
    renderHeader(days, project),
    renderOverview(summary),
    renderActivity(summary),
    renderTopTools(tools, compact),
    renderDailyTrend(trend, days, compact),
  ];

  const suggestions = renderSuggestions(sessions, compact);
  if (suggestions) sections.push(suggestions);

  // Add bottom border
  sections.push(divider());

  console.log(sections.join("\n"));
}

main();
