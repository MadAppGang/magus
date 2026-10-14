/**
 * block.ts — the labelled block appended after grep's own output, and its frame. (P5)
 *
 *   --- code-search: <K> related <location|locations> from the code index; none of these lines contains "<pattern>" ---
 *   <path>:<line>: <text>
 *   --- end code-search ---
 *
 * Files mode lists one `<path>` per line, and its header says `<file|files>` and "none
 * of these files". Both routes use these bytes: the Bash wrapper prints them after
 * grep's output, the Grep-tool hook passes them as `additionalContext`.
 *
 * The block is never in grep's own format, so nothing downstream can mistake an extra for
 * a match, and the header's claim is true by construction (`planExtras` keeps only
 * lines, or files, that do not contain the pattern).
 *
 * WHY EXTRAS ARE DROPPED, NEVER ESCAPED. The wrapper validates a frame by its first and
 * last lines, so no extra may produce a line that reads as a marker. A content line
 * starts with `<path>:<line>: `, so its `<text>` cannot; only a path can, and a path
 * holding a control character or starting `---` is dropped whole. An escaped path would
 * be one the agent cannot open.
 */

import type { SearchCall } from "./call";
import type { Plan } from "./merge";

/** The whole block, header and end line included. */
export const BLOCK_MAX = 16_384;
/** `<text>` is cut after this many UTF-16 units, then `...`. */
export const TEXT_MAX = 200;
export const END_MARKER = "--- end code-search ---";
export const HEADER_PREFIX = "--- code-search: ";

const encoder = new TextEncoder();
// Controls except tab (U+0009), and DEL.
const TEXT_CONTROLS = /[\u0000-\u0008\u000a-\u001f\u007f]/gu;
// Every control, tab included: a path is a single token the agent opens.
const PATH_CONTROLS = /[\u0000-\u001f\u007f]/u;

/**
 * A file line as one block line: its terminator removed (`\n`, and the `\r` of a CRLF
 * file, which is part of that terminator), leading whitespace removed, every control
 * character but tab replaced by `?`, and the result cut after `TEXT_MAX` UTF-16 units
 * with `...`. The cut never splits a surrogate pair: a lone surrogate would reach the
 * reader as U+FFFD.
 */
export function displayText(line: string): string {
  let text = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (text.endsWith("\r")) text = text.slice(0, -1);
  text = text.replace(/^\s+/u, "").replace(TEXT_CONTROLS, "?");
  if (text.length <= TEXT_MAX) return text;
  let cut = TEXT_MAX;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}...`;
}

function header(mode: Plan["mode"], k: number, pattern: string): string {
  const noun = mode === "content" ? (k === 1 ? "location" : "locations") : k === 1 ? "file" : "files";
  const what = mode === "content" ? "lines" : "files";
  return `${HEADER_PREFIX}${k} related ${noun} from the code index; none of these ${what} contains "${pattern}" ---\n`;
}

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** The block's bytes, or an empty array when no extra survives (the answer is then
 *  `CSM1 0`). Extras keep the plan's order; trailing ones are removed until the whole
 *  block fits `BLOCK_MAX`. */
export function formatBlock(plan: Plan, call: Pick<SearchCall, "pattern">): Uint8Array {
  const lines: string[] = [];
  if (plan.mode === "content") {
    for (const file of plan.files) {
      if (PATH_CONTROLS.test(file.path)) continue;
      for (const hit of file.lines) {
        const line = `${file.path}:${hit.n}: ${displayText(hit.text)}`;
        if (!line.startsWith("---")) lines.push(`${line}\n`);
      }
    }
  } else {
    for (const path of plan.paths) {
      if (path === "" || PATH_CONTROLS.test(path) || path.startsWith("---")) continue;
      lines.push(`${path}\n`);
    }
  }

  const end = `${END_MARKER}\n`;
  const sizes = lines.map(byteLength);
  let body = sizes.reduce((sum, n) => sum + n, 0);
  let k = lines.length;
  // K's digit count changes the header's length, so the header is recomputed per K.
  while (k > 0 && byteLength(header(plan.mode, k, call.pattern)) + body + end.length > BLOCK_MAX) {
    k -= 1;
    body -= sizes[k] ?? 0;
  }
  if (k === 0) return new Uint8Array(0);
  return encoder.encode(header(plan.mode, k, call.pattern) + lines.slice(0, k).join("") + end);
}

/** `CSM1 <n>\n` then exactly n block bytes. n = 0 means "append nothing". */
export function frame(block: Uint8Array): Uint8Array {
  const head = encoder.encode(`CSM1 ${block.length}\n`);
  const framed = new Uint8Array(head.length + block.length);
  framed.set(head, 0);
  framed.set(block, head.length);
  return framed;
}

/**
 * The client side of `frame`: the block of a valid frame, or `undefined`. `CSM1 <n>\n`
 * then exactly n bytes, n from 1 to `BLOCK_MAX` with no leading zero; the block's first
 * line starts with `HEADER_PREFIX`, its last line is `END_MARKER` on a line of its own,
 * and it holds at least one line between the two (the wrapper's L ≥ 4 rule, frame line
 * included). Used by the Grep-tool hook; the shell wrapper's `__cs_gm_readframe` applies
 * the same rules with builtins.
 */
export function blockOf(framed: Uint8Array): string | undefined {
  const nl = framed.indexOf(0x0a);
  if (nl < 0) return undefined;
  // latin1 maps each byte to one character, so a head with any non-ASCII byte cannot match
  // the ASCII-only pattern; the block itself is decoded as UTF-8 below.
  const head =/^CSM1 ([1-9][0-9]{0,4})$/u.exec(Buffer.from(framed.subarray(0, nl)).toString("latin1"));
  if (head === null) return undefined;
  const n = Number(head[1]);
  if (n > BLOCK_MAX || framed.length - (nl + 1) !== n) return undefined;
  let block: string;
  try {
    block = new TextDecoder("utf-8", { fatal: true }).decode(framed.subarray(nl + 1));
  } catch {
    return undefined;
  }
  if (!block.startsWith(HEADER_PREFIX)) return undefined;
  if (!block.endsWith(`\n${END_MARKER}\n`)) return undefined;
  if (block.split("\n").length - 1 < 3) return undefined;
  return block;
}
