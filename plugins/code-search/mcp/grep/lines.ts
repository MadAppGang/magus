/**
 * lines.ts — the line table every Grep merge decision is made against.
 *
 * It has to number lines exactly as rg does, or a hit lands on the wrong line and dedup
 * against rg's own output breaks. rg (no `--crlf`, no multiline) splits on `\n` only:
 *
 *   - a terminal `\n` ends the last line; it does not open an empty one after it;
 *   - an empty file has no lines;
 *   - `\r` is an ordinary byte inside the line;
 *   - a final line with no terminator is still a line.
 *
 * A leading UTF-8 byte-order mark is dropped first, because rg strips it before
 * searching and printing (measured, rg 14.1.1: `--json` on a BOM file prints line 1
 * without it). Callers normally strip it already; doing it here as well is idempotent
 * and keeps a BOM out of an emitted line whichever caller forgot.
 */

const BOM = "﻿";

/** Each element keeps its `\n`; a final unterminated line has none. */
export function splitLines(text: string): string[] {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines: string[] = [];
  let start = 0;
  for (let end = body.indexOf("\n"); end !== -1; end = body.indexOf("\n", start)) {
    lines.push(body.slice(start, end + 1));
    start = end + 1;
  }
  if (start < body.length) lines.push(body.slice(start));
  return lines;
}
