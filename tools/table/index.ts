/**
 * tools/table/index.ts — Shared terminal display library.
 *
 * All functions return strings. The caller decides when to print.
 * Use print() or console.log() to output.
 *
 * Exports:
 *   ANSI:       S, fg
 *   Text:       termW, stripAnsi, visLen, truncate, truncateAnsi, padRight, formatTime
 *   Box:        renderBox, renderInlineBox, boxLines
 *   Components: pill, badge
 *   Board:      progressBar, cardBox, columnsLayout, unifiedTable
 *   Tree:       treeLine, treeIndent
 *   Output:     print
 */

import { execSync } from "child_process";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

export const S = {
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

/** Apply a style and reset afterward. */
export function fg(style: string, text: string): string {
  return `${style}${text}${S.reset}`;
}

// ── Text utilities ────────────────────────────────────────────────────────────

/**
 * Terminal width detection chain.
 *
 * Tries, in order:
 *   1. process.stdout.columns (works when stdout is a TTY)
 *   2. $COLUMNS env var (set by some shells / wrappers)
 *   3. tmux pane_width (most accurate when inside a tmux pane)
 *   4. Parent process TTY via stty (works when our own stdout is piped)
 *   5. Fallback to 120 (reasonable default for modern terminals)
 *
 * Every shell-out is wrapped in try/catch so failures fall through silently.
 */
export function termW(): number {
  // 1. Direct stdout columns
  if (process.stdout.columns && process.stdout.columns > 0) {
    return process.stdout.columns;
  }

  // 2. $COLUMNS env var
  const envCols = process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0;
  if (envCols > 0) return envCols;

  // 3. tmux pane width (only when TMUX env is set)
  if (process.env.TMUX) {
    try {
      const w = parseInt(
        execSync("tmux display-message -p '#{pane_width}'", { stdio: ["pipe", "pipe", "pipe"] })
          .toString()
          .trim(),
        10,
      );
      if (w > 0) return w;
    } catch { /* not in tmux or tmux unavailable */ }
  }

  // 4. Parent process TTY via stty
  try {
    const ppid = process.ppid ?? process.env.PPID;
    if (ppid) {
      const ttyName = execSync(`ps -o tty= -p ${ppid}`, { stdio: ["pipe", "pipe", "pipe"] })
        .toString()
        .trim();
      if (ttyName && ttyName !== "?" && ttyName !== "??") {
        const devPath = ttyName.startsWith("/dev/") ? ttyName : `/dev/${ttyName}`;
        const sttyOut = execSync(`stty size < ${devPath}`, {
          stdio: ["pipe", "pipe", "pipe"],
          shell: "/bin/sh",
        })
          .toString()
          .trim();
        const cols = parseInt(sttyOut.split(/\s+/)[1], 10);
        if (cols > 0) return cols;
      }
    }
  } catch { /* no parent TTY or stty failed */ }

  // 5. Fallback
  return 120;
}

/** Remove all ANSI escape codes from text. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Visible (printable) length of text, ignoring ANSI escape codes.
 * Accounts for double-width Unicode characters (emoji, CJK, fullwidth forms)
 * that occupy 2 terminal columns but count as 1 code point in JS strings.
 *
 * Uses the Unicode East Asian Width (EAW) property categories W (Wide) and F (Fullwidth).
 * "Ambiguous" width chars (category A) like ⚡ are counted as 1 here because we avoid
 * using them in rendered content — replace with ASCII alternatives if layout precision needed.
 */
export function visLen(text: string): number {
  const plain = stripAnsi(text);
  let len = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0)!;
    // Wide (W) and Fullwidth (F) ranges per Unicode EAW data:
    if (
      (code >= 0x1100 && code <= 0x115F) ||  // Hangul Jamo
      (code >= 0x2E80 && code <= 0x2EFF) ||  // CJK Radicals Supplement
      (code >= 0x2F00 && code <= 0x2FDF) ||  // Kangxi Radicals
      (code >= 0x2FF0 && code <= 0x2FFF) ||  // Ideographic Description
      (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols & Punctuation
      (code >= 0x3040 && code <= 0x309F) ||  // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) ||  // Katakana
      (code >= 0x3100 && code <= 0x312F) ||  // Bopomofo
      (code >= 0x3130 && code <= 0x318F) ||  // Hangul Compatibility Jamo
      (code >= 0x3190 && code <= 0x319F) ||  // Kanbun
      (code >= 0x31A0 && code <= 0x31BF) ||  // Bopomofo Extended
      (code >= 0x31F0 && code <= 0x31FF) ||  // Katakana Phonetic
      (code >= 0x3200 && code <= 0x32FF) ||  // Enclosed CJK Letters
      (code >= 0x3300 && code <= 0x33FF) ||  // CJK Compatibility
      (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
      (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
      (code >= 0xA000 && code <= 0xA4CF) ||  // Yi
      (code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables
      (code >= 0xF900 && code <= 0xFAFF) ||  // CJK Compatibility Ideographs
      (code >= 0xFE10 && code <= 0xFE1F) ||  // Vertical Forms
      (code >= 0xFE30 && code <= 0xFE4F) ||  // CJK Compatibility Forms
      (code >= 0xFE50 && code <= 0xFE6F) ||  // Small Form Variants
      (code >= 0xFF01 && code <= 0xFF60) ||  // Fullwidth forms
      (code >= 0xFFE0 && code <= 0xFFE6) ||  // Fullwidth signs
      (code >= 0x1B000 && code <= 0x1B0FF) || // Kana Supplement
      (code >= 0x1F004 && code <= 0x1F004) || // Mahjong tile (🀄)
      (code >= 0x1F0CF && code <= 0x1F0CF) || // Joker
      (code >= 0x1F200 && code <= 0x1F2FF) || // Enclosed ideographic supplement
      (code >= 0x1F300 && code <= 0x1F64F) || // Misc symbols & pictographs, emoticons
      (code >= 0x1F680 && code <= 0x1F6FF) || // Transport & map symbols
      (code >= 0x1F900 && code <= 0x1F9FF) || // Supplemental symbols
      (code >= 0x20000 && code <= 0x2FFFD) || // CJK Extension B-F
      (code >= 0x30000 && code <= 0x3FFFD)    // CJK Extension G+
    ) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}

/** Truncate plain text to maxLen characters, appending ellipsis if needed. */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/**
 * Truncate ANSI-colored text safely.
 * Walks character by character, tracking visible length and preserving
 * escape sequences. Appends reset + ellipsis when the limit is reached.
 *
 * ANSI CSI sequences: ESC [ <params> <letter>
 * We stay in escape mode until we see an alphabetic terminator (a-zA-Z),
 * skipping the CSI introducer '[' and all parameter characters.
 */
export function truncateAnsi(text: string, maxVisibleLen: number): string {
  let out = "";
  let vis = 0;
  let inEsc = false;
  let sawBracket = false;
  // Iterate over code points (not code units) to handle multi-byte chars
  const codePoints = [...text];
  for (let i = 0; i < codePoints.length; i++) {
    const ch = codePoints[i];
    if (ch === "\x1b") { inEsc = true; sawBracket = false; out += ch; continue; }
    if (inEsc) {
      out += ch;
      if (!sawBracket) {
        sawBracket = true;
      } else {
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
          inEsc = false;
          sawBracket = false;
        }
      }
      continue;
    }
    // Measure visual width of this code point (same logic as visLen)
    const code = ch.codePointAt(0)!;
    const chWidth = (
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0x2EFF) ||
      (code >= 0x2F00 && code <= 0x2FDF) ||
      (code >= 0x2FF0 && code <= 0x2FFF) ||
      (code >= 0x3000 && code <= 0x303F) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0x3100 && code <= 0x312F) ||
      (code >= 0x3130 && code <= 0x318F) ||
      (code >= 0x3190 && code <= 0x319F) ||
      (code >= 0x31A0 && code <= 0x31BF) ||
      (code >= 0x31F0 && code <= 0x31FF) ||
      (code >= 0x3200 && code <= 0x32FF) ||
      (code >= 0x3300 && code <= 0x33FF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0xA000 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE1F) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFE50 && code <= 0xFE6F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1B000 && code <= 0x1B0FF) ||
      (code >= 0x1F004 && code <= 0x1F004) ||
      (code >= 0x1F0CF && code <= 0x1F0CF) ||
      (code >= 0x1F200 && code <= 0x1F2FF) ||
      (code >= 0x1F300 && code <= 0x1F64F) ||
      (code >= 0x1F680 && code <= 0x1F6FF) ||
      (code >= 0x1F900 && code <= 0x1F9FF) ||
      (code >= 0x20000 && code <= 0x2FFFD) ||
      (code >= 0x30000 && code <= 0x3FFFD)
    ) ? 2 : 1;
    if (vis + chWidth > maxVisibleLen - 1) break;
    out += ch;
    vis += chWidth;
  }
  if (vis >= maxVisibleLen - 1 && visLen(text) > maxVisibleLen) {
    out += S.reset + "…";
  }
  return out;
}

/** Pad text on the right to reach width, accounting for ANSI escape codes. */
export function padRight(text: string, width: number): string {
  const pad = Math.max(0, width - visLen(text));
  return text + " ".repeat(pad);
}

/** Format a time estimate in minutes to a human-readable string. */
export function formatTime(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// ── Box renderer ──────────────────────────────────────────────────────────────

/**
 * Render a unicode box with a colored title bar.
 * Returns the full box as a string (lines joined by newlines).
 * The title bar fills the full box width with a background color.
 */
export function renderBox(opts: {
  title: string;
  titleBg: string;
  titleFg?: string;
  lines: string[];
  borderColor?: string;
  maxWidth?: number;
}): string {
  const { title, titleBg, titleFg = S.white, lines, borderColor = S.gray, maxWidth = 80 } = opts;
  const w = Math.min(termW(), maxWidth);
  const inner = w - 4; // "│ " + content + " │"
  const bc = borderColor;
  const out: string[] = [];

  // Top border
  out.push(fg(bc, `╭${"─".repeat(w - 2)}╮`));

  // Title bar — full width background fill
  const titleText = ` ${title} `;
  const titlePad = Math.max(0, w - 4 - titleText.length);
  out.push(
    `${fg(bc, "│")} ${titleBg}${S.bold}${titleFg}${titleText}${" ".repeat(titlePad)}${S.reset} ${fg(bc, "│")}`
  );

  // Separator after title
  out.push(fg(bc, `├${"─".repeat(w - 2)}┤`));

  // Content lines — clamp to inner width
  for (const line of lines) {
    const vl = visLen(line);
    if (vl <= inner) {
      const pad = inner - vl;
      out.push(`${fg(bc, "│")} ${line}${" ".repeat(pad)} ${fg(bc, "│")}`);
    } else {
      const truncated = truncateAnsi(line, inner);
      const finalVis = visLen(truncated);
      const pad = Math.max(0, inner - finalVis);
      out.push(`${fg(bc, "│")} ${truncated}${" ".repeat(pad)} ${fg(bc, "│")}`);
    }
  }

  // Bottom border
  out.push(fg(bc, `╰${"─".repeat(w - 2)}╯`));

  return out.join("\n");
}

/**
 * Render a single-line confirmation box.
 * Returns the box as a string.
 */
export function renderInlineBox(content: string, borderColor: string = S.gray): string {
  const w = Math.min(termW(), 80);
  const inner = w - 4;
  const bc = borderColor;
  const vl = visLen(content);
  const out: string[] = [];

  out.push(fg(bc, `╭${"─".repeat(w - 2)}╮`));
  if (vl <= inner) {
    const pad = inner - vl;
    out.push(`${fg(bc, "│")} ${content}${" ".repeat(pad)} ${fg(bc, "│")}`);
  } else {
    const truncated = truncateAnsi(content, inner);
    const pad = Math.max(0, inner - visLen(truncated));
    out.push(`${fg(bc, "│")} ${truncated}${" ".repeat(pad)} ${fg(bc, "│")}`);
  }
  out.push(fg(bc, `╰${"─".repeat(w - 2)}╯`));

  return out.join("\n");
}

/**
 * Render content lines inside a box, without a title bar.
 * Returns the box as a string.
 */
export function boxLines(lines: string[], borderColor: string = S.gray, maxWidth: number = 80): string {
  const w = Math.min(termW(), maxWidth);
  const inner = w - 4;
  const bc = borderColor;
  const out: string[] = [];

  out.push(fg(bc, `╭${"─".repeat(w - 2)}╮`));

  for (const line of lines) {
    const vl = visLen(line);
    if (vl <= inner) {
      const pad = inner - vl;
      out.push(`${fg(bc, "│")} ${line}${" ".repeat(pad)} ${fg(bc, "│")}`);
    } else {
      const truncated = truncateAnsi(line, inner);
      const pad = Math.max(0, inner - visLen(truncated));
      out.push(`${fg(bc, "│")} ${truncated}${" ".repeat(pad)} ${fg(bc, "│")}`);
    }
  }

  out.push(fg(bc, `╰${"─".repeat(w - 2)}╯`));

  return out.join("\n");
}

// ── Visual components ─────────────────────────────────────────────────────────

/** Background-colored metric pill: " LABEL value ". */
export function pill(label: string, value: number | string, bg: string, fgColor: string = S.white): string {
  return `${bg}${S.bold}${fgColor} ${label} ${value} ${S.reset}`;
}

/** Inline badge with a background style. */
export function badge(text: string, style: string = `${S.bgGray}${S.white}`): string {
  return `${style} ${text} ${S.reset}`;
}

// ── Board primitives ──────────────────────────────────────────────────────────

/**
 * Render a progress bar of given width using block characters.
 * Returns empty string when total is 0.
 */
export function progressBar(done: number, total: number, barWidth: number): string {
  if (total === 0) return "";
  const filled = Math.round((done / total) * barWidth);
  const empty = barWidth - filled;
  return fg(S.green, "█".repeat(filled)) + fg(S.gray, "░".repeat(empty));
}

/**
 * Render a card box with ╭─╮│╰─╯ borders.
 * Every returned line is EXACTLY colWidth visible characters wide.
 *   inner = colWidth - 4  (│ + space + content + space + │)
 *   border line = colWidth - 2 dashes between ╭ and ╮
 *
 * Options:
 *   fillBg — if set, applies this ANSI background to the padding spaces
 *            and the 1-char margins inside │. Use for capsule headers where
 *            the background must fill wall-to-wall.
 */
export function cardBox(
  contentLines: string[],
  colWidth: number,
  bc: string = S.gray,
  fillBg?: string
): string[] {
  const inner = colWidth - 4;
  const out: string[] = [];
  out.push(fg(bc, "╭" + "─".repeat(colWidth - 2) + "╮"));
  for (const line of contentLines) {
    const vl = visLen(line);
    let padStr: string;
    if (vl <= inner) {
      padStr = " ".repeat(inner - vl);
    } else {
      const truncated = truncateAnsi(line, inner);
      const tvl = visLen(truncated);
      // Use truncated line, re-pad
      const repacked = truncated + " ".repeat(Math.max(0, inner - tvl));
      if (fillBg) {
        out.push(fg(bc, "│") + fillBg + " " + repacked + fillBg + " " + S.reset + fg(bc, "│"));
      } else {
        out.push(fg(bc, "│") + " " + repacked + " " + fg(bc, "│"));
      }
      continue;
    }
    if (fillBg) {
      // Re-apply fillBg after content (content may contain S.reset that kills it)
      out.push(fg(bc, "│") + fillBg + " " + line + fillBg + padStr + " " + S.reset + fg(bc, "│"));
    } else {
      out.push(fg(bc, "│") + " " + line + padStr + " " + fg(bc, "│"));
    }
  }
  out.push(fg(bc, "╰" + "─".repeat(colWidth - 2) + "╯"));
  return out;
}

/**
 * Stitch pre-rendered column line arrays side-by-side.
 * Each column's line array must already have lines padded to exactly `width`
 * visible characters. Shorter columns are padded with spaces to the tallest.
 */
export function columnsLayout(
  columns: Array<{ lines: string[]; width: number }>,
  gap: number = 1
): string[] {
  const maxH = Math.max(...columns.map(c => c.lines.length));
  const rows: string[] = [];
  const gapStr = " ".repeat(gap);
  for (let r = 0; r < maxH; r++) {
    const parts = columns.map(col => {
      const line = r < col.lines.length ? col.lines[r] : "";
      const vl = visLen(line);
      if (vl < col.width) return line + " ".repeat(col.width - vl);
      return line;
    });
    rows.push(parts.join(gapStr));
  }
  return rows;
}

/**
 * Render a simple unified table with all columns side-by-side.
 * Borders use ╭┬╮├┼┤╰┴╯ for correct junctions.
 *
 * Column inner width math:
 *   n columns, each cell: │ + space + <colInner> + space = colInner + 2 chars
 *   Full row width: │ + (colInner+2)*n + (n-1)*│ + │ = (colInner+3)*n + 1
 *   So: colInner = floor((termWidth - 3*n - 1) / n)
 */
export function unifiedTable(opts: {
  columns: Array<{ header: string; lines: string[] }>;
  termWidth: number;
  borderColor?: string;
}): string {
  const { columns, termWidth, borderColor = S.gray } = opts;
  const n = columns.length;
  const bc = borderColor;
  const colInner = Math.floor((termWidth - 3 * n - 1) / n);
  const out: string[] = [];

  function hRule(left: string, mid: string, right: string): string {
    const seg = "─".repeat(colInner + 2);
    return fg(bc, left + Array(n).fill(seg).join(mid) + right);
  }

  function cellPad(text: string): string {
    const vl = visLen(text);
    if (vl <= colInner) return text + " ".repeat(colInner - vl);
    return truncateAnsi(text, colInner);
  }

  // Top border
  out.push(hRule("╭", "┬", "╮"));

  // Header row
  const headerCells = columns.map(col => cellPad(col.header));
  out.push(fg(bc, "│") + " " + headerCells.join(" " + fg(bc, "│") + " ") + " " + fg(bc, "│"));

  // Header separator
  out.push(hRule("├", "┼", "┤"));

  // Content rows — pad each column to the same height
  const maxRows = Math.max(...columns.map(col => col.lines.length), 1);
  for (let r = 0; r < maxRows; r++) {
    const cells = columns.map(col => {
      const text = r < col.lines.length ? col.lines[r] : "";
      return cellPad(text);
    });
    out.push(fg(bc, "│") + " " + cells.join(" " + fg(bc, "│") + " ") + " " + fg(bc, "│"));
  }

  // Bottom border
  out.push(hRule("╰", "┴", "╯"));

  return out.join("\n");
}

// ── Tree renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single tree line with ├─ or └─ connector.
 * Returns the formatted string.
 */
export function treeLine(prefix: string, isLast: boolean, content: string): string {
  const connector = fg(S.gray, isLast ? "└─ " : "├─ ");
  return `${prefix}${connector}${content}`;
}

/**
 * Continuation indent for tree rendering: │ (if not last) or spaces.
 * Returns the indent string (no newline).
 */
export function treeIndent(isLast: boolean): string {
  return fg(S.gray, isLast ? "   " : "│  ");
}

// ── Output ────────────────────────────────────────────────────────────────────

/** Print text to stdout. The canonical way to output from this library. */
export function print(text: string): void {
  console.log(text);
}
