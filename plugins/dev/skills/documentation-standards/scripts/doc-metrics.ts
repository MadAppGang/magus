#!/usr/bin/env bun
/**
 * doc-metrics.ts — the countable half of the dev:docs quality score.
 *
 * The 52-point checklist mixes judgement ("progressive disclosure") with arithmetic
 * ("max 2 hedge phrases per 1000 words", "no sentence over 40 words"). A model asked to
 * do the arithmetic estimates it, so the score moved between runs on an unchanged file.
 * This script does the arithmetic; the agent judges the rest.
 *
 * Usage:
 *   bun doc-metrics.ts <file.md> [more.md ...]
 *
 * Prints JSON: one object for one file, an array for several. Each object carries
 * `metrics` (raw counts, with line numbers for every violation) and `points` (the
 * checklist items this script can decide, each pass/fail with its evidence).
 * Exit code: 0 on success, 2 on a usage or read error. A low score is not an error.
 *
 * Prose metrics skip fenced code, inline code, tables, headings and HTML comments.
 * The term lists below are Rule S1 of ../SKILL.md; doc-metrics.test.ts fails when a
 * term here is missing there.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BANNED = {
  critical: [
    "As an AI", "As a language model", "I'd be happy to", "Certainly!", "Absolutely!",
    "Great question!", "I hope this helps", "Feel free to ask", "Let me explain",
    "Allow me to clarify", "In today's", "In an increasingly", "In the realm of",
    "At the heart of", "The weight of",
  ],
  high: [
    "amazing", "revolutionary", "powerful", "robust", "seamlessly", "effortlessly",
    "incredible", "world-class", "cutting-edge", "state-of-the-art", "next-generation",
    "innovative", "game-changing", "industry-leading", "best-in-class",
    "simply", "easy", "just", "obviously", "of course", "clearly", "trivially",
    "straightforward", "quick",
  ],
  medium: [
    "leverage", "utilize", "streamline", "facilitate", "empower", "unlock", "accelerate",
    "transform", "deliver value", "synergy", "synergize", "actioning", "comprehensive",
    "it is worth noting that", "it is important to note", "please note that",
    "as mentioned above", "as stated earlier", "due to the fact that", "in the event that",
    "in order to", "might potentially", "could potentially", "may or may not",
  ],
  structural: [
    "In this section", "This document covers", "Now that we have", "As you can see",
    "This section explains", "Let's explore", "Let's take a look at", "Let's dive into",
  ],
} as const;

export const HEDGES = [
  "may vary", "might", "could potentially", "may or may not", "generally", "typically",
  "tends to", "in most cases", "depending on your", "it is important to note",
  "it's important to note", "arguably", "somewhat", "relatively",
];

export const TRANSITIONS = [
  "however", "therefore", "for example", "for instance", "in addition", "moreover",
  "furthermore", "consequently", "as a result", "similarly", "instead", "meanwhile",
  "finally", "first", "next", "then", "also",
];

/** Words a sentence-case heading may still capitalise after the first word. */
const HEADING_EXEMPT = /^(I|API|CLI|URL|HTTP|HTTPS|JSON|YAML|SQL|UI|SDK|OS|ID|MCP|README|TODO)$/;

export interface Located { line: number; text: string }
export interface Point { item: string; max: number; points: number; pass: boolean; evidence: string }

export interface Metrics {
  bodyWords: number;
  sentences: number;
  avgSentenceWords: number;
  longestSentenceWords: number;
  sentencesOver40: Array<{ line: number; words: number }>;
  /** Runs of 4+ consecutive sentences within ±5 words of their run's first sentence (Rule S2 allows 3). */
  monotonyRuns: Array<{ line: number; length: number }>;
  /** Paragraphs holding more than one 26-40 word sentence (Rule S2 allows one). */
  paragraphsWithSeveralLong: number[];
  paragraphs: number;
  paragraphsOver5Sentences: Array<{ line: number; sentences: number }>;
  transitionOpenerShare: number;
  banned: Record<keyof typeof BANNED, Located[]>;
  hedges: Located[];
  hedgesPer1000: number;
  codeLines: number;
  contentLines: number;
  codeRatio: number;
  headingLevels: number[];
  headingsDeeperThanH3: Located[];
  titleCaseHeadings: Located[];
  h2Count: number;
  h2ExpectedRange: [number, number] | null;
  listSizes: number[];
  brokenLocalLinks: Located[];
  passiveCandidates: Located[];
}

interface Block { kind: "para" | "list" | "heading"; line: number; text: string; level?: number }

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Strip what is not prose from one line: inline code, link targets, emphasis marks, HTML. */
function prose(line: string): string {
  return line
    .replace(/`[^`]*`/g, "code")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");
}

export function splitSentences(text: string): string[] {
  const guarded = text.replace(/\b(e\.g|i\.e|etc|vs|approx|Dr|Mr|Ms)\./gi, "$1\u0000");
  return guarded
    .split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter((s) => words(s) > 0);
}

function findTerms(terms: readonly string[], lines: Located[]): Located[] {
  const out: Located[] = [];
  for (const term of terms) {
    const edgeL = /^\w/.test(term) ? "\\b" : "";
    const edgeR = /\w$/.test(term) ? "\\b" : "";
    const re = new RegExp(`${edgeL}${esc(term).replace(/'/g, "['’]")}${edgeR}`, "gi");
    for (const l of lines) for (const _ of l.text.matchAll(re)) out.push({ line: l.line, text: term });
  }
  return out.sort((a, b) => a.line - b.line);
}

export function analyze(markdown: string, filePath?: string): { metrics: Metrics; points: Point[] } {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  // A leading YAML frontmatter block is metadata; blanking keeps every line number.
  const raw = markdown.replace(/^---\n[\s\S]*?\n---(?=\n|$)/, blank).replace(/<!--[\s\S]*?-->/g, blank).split("\n");
  const fencedLines = new Set<number>();
  const blocks: Block[] = [];
  const proseLines: Located[] = [];
  const listSizes: number[] = [];
  let codeLines = 0;
  let tableWords = 0;
  let contentLines = 0;
  let fence: string | null = null;
  let para: { line: number; parts: string[] } | null = null;
  let list: { line: number; items: number } | null = null;

  const endPara = () => { if (para) blocks.push({ kind: "para", line: para.line, text: para.parts.join(" ") }); para = null; };
  const endList = () => { if (list) listSizes.push(list.items); list = null; };

  raw.forEach((text, i) => {
    const line = i + 1;
    const fenceMark = text.match(/^\s*(```|~~~)/);
    if (fence) {
      fencedLines.add(i);
      if (fenceMark && fenceMark[1] === fence) fence = null;
      else if (text.trim()) codeLines++;
      return;
    }
    if (fenceMark) { fencedLines.add(i); endPara(); endList(); fence = fenceMark[1]; return; }
    if (!text.trim()) { endPara(); endList(); return; }
    contentLines++;
    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      endPara(); endList();
      blocks.push({ kind: "heading", line, text: heading[2].trim(), level: heading[1].length });
      proseLines.push({ line, text: prose(heading[2]) });
      return;
    }
    if (/^\s*\|/.test(text)) {
      endPara(); endList();
      // Table text is body text for heading density, but cells are not sentences.
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(text)) tableWords += words(prose(text.replace(/\|/g, " ")));
      return;
    }
    const item = text.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      endPara();
      if (!list) list = { line, items: 0 };
      if (!/^\s{2,}/.test(text)) list.items++;
      blocks.push({ kind: "list", line, text: prose(item[1]) });
      proseLines.push({ line, text: prose(item[1]) });
      return;
    }
    if (list && /^\s{2,}/.test(text)) { proseLines.push({ line, text: prose(text) }); return; }
    endList();
    const t = prose(text.replace(/^>\s?/, ""));
    proseLines.push({ line, text: t });
    if (!para) para = { line, parts: [] };
    para.parts.push(t);
  });
  endPara(); endList();

  const paras = blocks.filter((b) => b.kind === "para");
  const headings = blocks.filter((b) => b.kind === "heading");
  const bodyWords = tableWords + paras.reduce((n, p) => n + words(p.text), 0) +
    blocks.filter((b) => b.kind === "list").reduce((n, b) => n + words(b.text), 0);

  const sentenceRows: Array<{ line: number; words: number; para: number }> = [];
  const paragraphsOver5Sentences: Metrics["paragraphsOver5Sentences"] = [];
  const paragraphsWithSeveralLong: number[] = [];
  let transitionOpeners = 0;
  paras.forEach((p, pi) => {
    const ss = splitSentences(p.text);
    if (ss.length > 5) paragraphsOver5Sentences.push({ line: p.line, sentences: ss.length });
    if (ss.filter((s) => words(s) >= 26 && words(s) <= 40).length > 1) paragraphsWithSeveralLong.push(p.line);
    const first = p.text.trim().toLowerCase();
    if (TRANSITIONS.some((t) => first.startsWith(t + ",") || first.startsWith(t + " "))) transitionOpeners++;
    for (const s of ss) sentenceRows.push({ line: p.line, words: words(s), para: pi });
  });

  const monotonyRuns: Metrics["monotonyRuns"] = [];
  let start = 0;
  for (let i = 1; i <= sentenceRows.length; i++) {
    const inRun = i < sentenceRows.length && Math.abs(sentenceRows[i].words - sentenceRows[start].words) <= 5;
    if (!inRun) {
      if (i - start >= 4) monotonyRuns.push({ line: sentenceRows[start].line, length: i - start });
      start = i;
    }
  }

  const levels = [...new Set(headings.map((h) => h.level!))].sort();
  const titleCaseHeadings = headings.filter((h) => {
    const ws = prose(h.text).replace(/[^A-Za-z\s'-]/g, " ").split(/\s+/).filter(Boolean).slice(1);
    return ws.filter((w) => w.length > 3 && /^[A-Z][a-z]/.test(w) && !HEADING_EXEMPT.test(w)).length >= 2;
  }).map((h) => ({ line: h.line, text: h.text }));
  const h2Count = headings.filter((h) => h.level === 2).length;
  const h2ExpectedRange: [number, number] | null =
    bodyWords >= 200 ? [Math.max(1, Math.floor(bodyWords / 400)), Math.ceil(bodyWords / 200)] : null;

  const brokenLocalLinks: Located[] = [];
  if (filePath) {
    raw.forEach((text, i) => {
      // Link syntax inside a fence or an inline code span is an example, not a link.
      if (fencedLines.has(i)) return;
      for (const m of text.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
        const bare = target.split("#")[0];
        let path = bare;
        try { path = decodeURIComponent(bare); } catch { /* malformed escape: check it as written */ }
        if (path && !existsSync(resolve(dirname(filePath), path))) brokenLocalLinks.push({ line: i + 1, text: target });
      }
    });
  }

  const passiveCandidates = proseLines.flatMap((l) =>
    [...l.text.matchAll(/\b(?:is|are|was|were|be|been|being)\s+(\w+ed|\w+en)\b/gi)].map((m) => ({ line: l.line, text: m[0] })),
  );

  const sentenceWords = sentenceRows.map((s) => s.words);
  const hedges = findTerms(HEDGES, proseLines);
  const metrics: Metrics = {
    bodyWords,
    sentences: sentenceRows.length,
    avgSentenceWords: sentenceWords.length ? round(sentenceWords.reduce((a, b) => a + b, 0) / sentenceWords.length, 1) : 0,
    longestSentenceWords: Math.max(0, ...sentenceWords),
    sentencesOver40: sentenceRows.filter((s) => s.words > 40).map(({ line, words }) => ({ line, words })),
    monotonyRuns,
    paragraphsWithSeveralLong,
    paragraphs: paras.length,
    paragraphsOver5Sentences,
    transitionOpenerShare: paras.length ? round(transitionOpeners / paras.length) : 0,
    banned: {
      critical: findTerms(BANNED.critical, proseLines),
      high: findTerms(BANNED.high, proseLines),
      medium: findTerms(BANNED.medium, proseLines),
      structural: findTerms(BANNED.structural, proseLines),
    },
    hedges,
    hedgesPer1000: bodyWords ? round((hedges.length * 1000) / bodyWords, 1) : 0,
    codeLines,
    contentLines,
    codeRatio: codeLines + contentLines ? round(codeLines / (codeLines + contentLines)) : 0,
    headingLevels: levels,
    headingsDeeperThanH3: headings.filter((h) => h.level! > 3).map((h) => ({ line: h.line, text: h.text })),
    titleCaseHeadings,
    h2Count,
    h2ExpectedRange,
    listSizes,
    brokenLocalLinks,
    passiveCandidates,
  };
  return { metrics, points: score(metrics, Boolean(filePath)) };
}

function lines(ls: Array<{ line: number }>): string {
  return ls.length ? `lines ${ls.slice(0, 8).map((l) => l.line).join(", ")}${ls.length > 8 ? ", …" : ""}` : "none";
}

/** The checklist items in agents/docs.md that arithmetic decides. Everything else is the agent's. */
export function score(m: Metrics, linksChecked: boolean): Point[] {
  const p = (item: string, max: number, pass: boolean, evidence: string): Point =>
    ({ item, max, points: pass ? max : 0, pass, evidence });
  const h2InRange = !m.h2ExpectedRange || (m.h2Count >= m.h2ExpectedRange[0] && m.h2Count <= m.h2ExpectedRange[1]);
  const out = [
    p("Writing Style: at most one 26-40 word sentence per paragraph (Rule S2)", 1,
      m.paragraphsWithSeveralLong.length === 0, lines(m.paragraphsWithSeveralLong.map((line) => ({ line })))),
    p("Writing Style: short paragraphs, none over 5 sentences", 1,
      m.paragraphsOver5Sentences.length === 0, lines(m.paragraphsOver5Sentences)),
    p("Anti-Slop: no CRITICAL banned words", 2, m.banned.critical.length === 0, lines(m.banned.critical)),
    p("Anti-Slop: no MEDIUM banned words", 1, m.banned.medium.length === 0, lines(m.banned.medium)),
    p("Anti-Slop: no throat-clearing openers", 1, m.banned.structural.length === 0, lines(m.banned.structural)),
    p("Anti-Slop: sentence rhythm varies (no run of 4+ within ±5 words)", 1,
      m.monotonyRuns.length === 0, lines(m.monotonyRuns)),
    p("Anti-Slop: average sentence length 15-20 words, none over 40", 1,
      (m.sentences === 0 || (m.avgSentenceWords >= 15 && m.avgSentenceWords <= 20)) && m.sentencesOver40.length === 0,
      `average ${m.avgSentenceWords}; over 40: ${lines(m.sentencesOver40)}`),
    p("Anti-Slop: code-to-prose ratio at least 40%", 1, m.codeRatio >= 0.4, `ratio ${m.codeRatio}`),
    p("Anti-Slop: heading discipline (max 3 levels, sentence case, one H2 per 200-400 words)", 1,
      m.headingsDeeperThanH3.length === 0 && m.titleCaseHeadings.length === 0 && h2InRange,
      `H4+: ${lines(m.headingsDeeperThanH3)}; title case: ${lines(m.titleCaseHeadings)}; ` +
        `H2 ${m.h2Count}${m.h2ExpectedRange ? `, expected ${m.h2ExpectedRange[0]}-${m.h2ExpectedRange[1]}` : ""}`),
    p("Anti-Slop: at most 2 hedge phrases per 1000 words", 1, m.hedgesPer1000 <= 2,
      `${m.hedges.length} hedges, ${m.hedgesPer1000} per 1000 words`),
  ];
  if (linksChecked) {
    out.push(p("Maintenance: local links valid (external links are the agent's to check)", 1,
      m.brokenLocalLinks.length === 0, lines(m.brokenLocalLinks)));
  }
  return out;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: bun doc-metrics.ts <file.md> [more.md ...]");
    process.exit(2);
  }
  const results = [];
  for (const f of files) {
    let text: string;
    try { text = readFileSync(f, "utf8"); } catch (e) {
      console.error(`doc-metrics: cannot read ${f}: ${(e as Error).message}`);
      process.exit(2);
    }
    const { metrics, points } = analyze(text, resolve(f));
    const earned = points.reduce((n, pt) => n + pt.points, 0);
    const max = points.reduce((n, pt) => n + pt.max, 0);
    results.push({ file: f, countablePoints: { earned, max }, points, metrics });
  }
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}
