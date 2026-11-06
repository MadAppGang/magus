#!/usr/bin/env bun
/**
 * Build the answers block of a shared /multimodel:team round 2.
 *
 *   bun round-answers.ts --dir <rounds/1> --slots 01,03 --models internal,gpt-x
 *
 * Prints each listed slot's `response-<slot>.md` under `### Participant <slot>`, in ascending
 * slot order whatever the order of `--slots`, byte for byte, except that a panel model ID the speaker uses to name itself becomes `[participant]`.
 * These are the only forms that count, case-insensitive:
 *
 *   anywhere        "I am <id>", "I'm <id>", "my model is <id>", "my model ID is <id>",
 *                   "speaking as <id>", "this answer|response|reply was|is written|answered by <id>"
 *   sentence start  "this is <id>" (line start, after a list marker, or after . ! ?)
 *   line start      "<id> here", "written by <id>", "answered by <id>"
 *
 * An optional "the" may come before the ID, and Markdown emphasis or a backtick may wrap it.
 * Any other mention of an ID is left alone ("Configured model: gpt-x.", "the same model ID
 * as gpt-x"), so paths, citations and ordinary prose stay exactly as the model wrote them.
 * IDs that are ordinary English words (`internal`, `opus`, ...) count only after "I am"/"I'm".
 *
 * Never touched: fenced code, blockquote lines, Markdown links, double-quoted text, and
 * inline code other than a span holding exactly one ID.
 *
 * `selfIdentifyingLines` exports the same grammar for readers that must agree with it
 * (the team-type bench grader): a line is self-identifying exactly when `scrub` changes it.
 * `renderAnswers` exports the printed block itself, for the same readers.
 *
 * This is a script because a model retyping long answers can alter the evidence in them.
 * Exit codes: 0 printed · 2 bad usage or a missing response file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** IDs that are ordinary English words: they count only after "I am" / "I'm". */
export const ONE_WORD_IDS = new Set(["internal", "default", "opus", "sonnet", "haiku"]);
const W = "[*_`]*";
/** The ID ends here: not continued as a word, path, version or citation. */
const END = "(?![A-Za-z0-9/_-])(?![.:][A-Za-z0-9])";
/** A line's start, after any indent and one list marker. */
const LINE_START = String.raw`^\s*(?:[-*+]\s+|\d+[.)]\s+)?`;
/** Between a label and the ID: a wrapper, the space, an optional "the", a wrapper. */
const GAP = String.raw`${W}\s+${W}(?:the\s+)?${W}`;

const ME = String.raw`I\s+am|I['’]m`;
const ANYWHERE = [
  ME,
  String.raw`my\s+model\s+(?:ID\s+)?is`,
  String.raw`speaking\s+as`,
  String.raw`(?:this|my)\s+(?:answer|response|reply)\s+(?:was|is)\s+(?:written|answered)\s+by`,
].join("|");

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scrubbers(ids: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    const tail = `${esc(id)}(?=${W}${END})`;
    if (ONE_WORD_IDS.has(id.toLowerCase())) {
      out.push(new RegExp(`(?<![A-Za-z0-9])(${W}(?:${ME})${GAP})${tail}`, "gi"));
      continue;
    }
    out.push(new RegExp(`(?<![A-Za-z0-9])(${W}(?:${ANYWHERE})${GAP})${tail}`, "gi"));
    out.push(new RegExp(`((?:${LINE_START}|(?<=[.!?]["')\\]]?\\s+))${W}this\\s+is${GAP})${tail}`, "gi"));
    out.push(new RegExp(`(${LINE_START}${W}(?:written|answered)\\s+by${GAP})${tail}`, "gi"));
    out.push(new RegExp(`(${LINE_START}${W})${esc(id)}(?=${W}\\s+here\\b)`, "gi"));
  }
  return out;
}

/** Scrub one line, leaving links, quotes and inline code (other than a bare ID) untouched. */
function scrubLine(line: string, ids: string[], rxs: RegExp[]): string {
  const kept: string[] = [];
  const idSet = new Set(ids.map((i) => i.toLowerCase()));
  const hold = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  let masked = line
    // A code span opens and closes with the same run of backticks, so `` a`b `` is one span.
    .replace(/(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, (m, _ticks: string, body: string) => (idSet.has(body.trim().toLowerCase()) ? m : hold(m)))
    .replace(/\[[^\]]*\]\([^)]*\)/g, hold)
    .replace(/"[^"]*"|“[^”]*”/g, hold);
  for (const rx of rxs) masked = masked.replace(rx, (_m, pre: string) => `${pre}[participant]`);
  // A held span can itself contain earlier holds (a code span inside a quote), so each
  // restored span is restored in turn. A span only ever holds lower indices, so this ends.
  const restore = (s: string): string => s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => restore(kept[Number(i)]!));
  return restore(masked);
}

/**
 * Each line of `text` with whether the scrub reads it (outside fences and blockquotes).
 *
 * A fence opens on a run of three or more backticks or tildes (a backtick fence's info
 * string holds no backtick) and closes only on a line holding nothing but a run of the same
 * character at least as long. So a three-backtick example inside a four-backtick block, or
 * a tilde line inside a backtick block, stays inside the block.
 */
function scannedLines(text: string): { line: string; read: boolean }[] {
  let fence: { char: string; run: number } | null = null;
  return text.split("\n").map((line) => {
    if (fence) {
      const close = /^\s*(`+|~+)\s*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.run) fence = null;
      return { line, read: false };
    }
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { char: open[1]![0]!, run: open[1]!.length };
      return { line, read: false };
    }
    return { line, read: !/^\s*>/.test(line) };
  });
}

export function scrub(text: string, ids: string[]): string {
  const rxs = scrubbers(ids);
  return scannedLines(text)
    .map(({ line, read }) => (read ? scrubLine(line, ids, rxs) : line))
    .join("\n");
}

/** The lines of `text` that name a panel ID in a self-identifying form: exactly the lines `scrub` changes. */
export function selfIdentifyingLines(text: string, ids: string[]): string[] {
  const rxs = scrubbers(ids);
  const hits = scannedLines(text)
    .filter(({ line, read }) => read && scrubLine(line, ids, rxs) !== line)
    .map(({ line }) => line);
  return [...new Set(hits)];
}

/**
 * The answers block exactly as this script prints it: each answer, in ascending slot order,
 * scrubbed, under `### Participant <slot>` and a blank line, ending in a newline, the blocks
 * separated by one blank line. Readers that must agree with the printed block call this.
 */
export function renderAnswers(answers: { slot: string; text: string }[], ids: string[]): string {
  return [...answers]
    .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
    .map(({ slot, text }) => {
      const body = scrub(text, ids);
      return `### Participant ${slot}\n\n${body}${body.endsWith("\n") ? "" : "\n"}`;
    })
    .join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (import.meta.main) {
  const dir = arg("dir");
  const slots = list(arg("slots"));
  const ids = list(arg("models"));
  if (!dir || !slots.length || !ids.length) {
    console.error("usage: round-answers.ts --dir <rounds/1> --slots <slot,...> --models <model id,...>");
    process.exit(2);
  }
  const answers: { slot: string; text: string }[] = [];
  for (const slot of slots) {
    const f = join(dir, `response-${slot}.md`);
    if (!existsSync(f)) {
      console.error(`round-answers: ${f} does not exist`);
      process.exit(2);
    }
    answers.push({ slot, text: readFileSync(f, "utf8") });
  }
  process.stdout.write(renderAnswers(answers, ids));
}
