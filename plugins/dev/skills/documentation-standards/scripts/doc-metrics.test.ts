/**
 * Tests for doc-metrics.ts.
 *
 * Every rule is tested both ways: a document that must pass it and one that must fail
 * it. A metric that never reports a violation would score every document full marks,
 * which is the failure this script replaced.
 *
 * Run: bun test plugins/dev/skills/documentation-standards/scripts/
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, BANNED, HEDGES, splitSentences } from "./doc-metrics";

const SCRIPT = join(import.meta.dir, "doc-metrics.ts");
const SKILL = join(import.meta.dir, "..", "SKILL.md");
const tmp = mkdtempSync(join(tmpdir(), "doc-metrics-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const point = (md: string, prefix: string, file?: string) =>
  analyze(md, file).points.find((p) => p.item.startsWith(prefix))!;

/** n sentences of exactly `len` words each. */
const sentences = (n: number, len: number) =>
  Array.from({ length: n }, (_, i) => `Word${i} ` + "word ".repeat(len - 2) + "end.").join(" ");

describe("sentence metrics (Rule S2)", () => {
  test("splits on sentence ends but not on e.g. or i.e.", () => {
    expect(splitSentences("Use a flag, e.g. the verbose one. Then run it.")).toHaveLength(2);
  });

  test("a sentence over 40 words fails the length point and is located", () => {
    const md = `# Title\n\nShort one here now.\n\n${sentences(1, 45)}\n`;
    const r = analyze(md);
    expect(r.metrics.sentencesOver40).toEqual([{ line: 5, words: 45 }]);
    expect(point(md, "Anti-Slop: average sentence length").pass).toBe(false);
  });

  test("four sentences within ±5 words is a monotony run; three is allowed", () => {
    expect(analyze(`${sentences(4, 16)}\n`).metrics.monotonyRuns).toEqual([{ line: 1, length: 4 }]);
    const three = `${sentences(3, 16)} Tiny one. ${sentences(1, 30)}\n`;
    expect(analyze(three).metrics.monotonyRuns).toEqual([]);
  });

  test("two long sentences in one paragraph fail; one per paragraph passes", () => {
    expect(point(`${sentences(2, 30)}\n`, "Writing Style: at most one").pass).toBe(false);
    expect(point(`${sentences(1, 30)}\n\n${sentences(1, 30)}\n`, "Writing Style: at most one").pass).toBe(true);
  });

  test("a paragraph of six sentences fails the paragraph point", () => {
    expect(point(`${sentences(6, 8)}\n`, "Writing Style: short paragraphs").pass).toBe(false);
    expect(point(`${sentences(5, 8)}\n`, "Writing Style: short paragraphs").pass).toBe(true);
  });
});

describe("banned words and hedges (Rule S1)", () => {
  test("each tier is detected with its line", () => {
    const m = analyze("# T\n\nCertainly! This is amazing.\n\nWe leverage it.\n\nIn this section we explain.\n").metrics;
    expect(m.banned.critical.map((x) => x.line)).toEqual([3]);
    expect(m.banned.high.map((x) => x.text)).toContain("amazing");
    expect(m.banned.medium.map((x) => x.line)).toEqual([5]);
    expect(m.banned.structural.map((x) => x.line)).toEqual([7]);
  });

  test("YAML frontmatter is metadata, not prose", () => {
    const md = '---\ntitle: T\ndescription: "Leverage this in order to utilize things. It might work."\n---\n\n# T\n\nWe leverage it.\n';
    const m = analyze(md).metrics;
    expect(m.banned.medium).toEqual([{ line: 8, text: "leverage" }]);
    expect(m.hedges).toEqual([]);
  });

  test("a banned word inside fenced or inline code is not prose", () => {
    const md = "# T\n\nRun `leverage --fast` now.\n\n```\nleverage everything, certainly!\n```\n";
    const m = analyze(md).metrics;
    expect(m.banned.medium).toEqual([]);
    expect(m.banned.critical).toEqual([]);
  });

  test("hedges over 2 per 1000 words fail; none passes", () => {
    const hedged = `${"It might work. ".repeat(3)}${sentences(10, 12)}\n`;
    expect(point(hedged, "Anti-Slop: at most 2 hedge").pass).toBe(false);
    expect(point(`${sentences(10, 12)}\n`, "Anti-Slop: at most 2 hedge").pass).toBe(true);
  });

  test("every term the script counts is written in Rule S1 of the skill", () => {
    const skill = readFileSync(SKILL, "utf8");
    const s1 = skill.slice(skill.indexOf("### Rule S1"), skill.indexOf("### Rule S2")).toLowerCase();
    const missing = [...Object.values(BANNED).flat(), ...HEDGES].filter((t) => !s1.includes(t.toLowerCase()));
    expect(missing).toEqual([]);
  });
});

describe("structure", () => {
  test("code ratio counts fenced lines against content lines", () => {
    const md = "# T\n\nOne line.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n";
    const m = analyze(md).metrics;
    expect(m.codeLines).toBe(2);
    expect(m.contentLines).toBe(2);
    expect(point(md, "Anti-Slop: code-to-prose").pass).toBe(true);
    expect(point("# T\n\nOnly prose here.\n", "Anti-Slop: code-to-prose").pass).toBe(false);
  });

  test("an H4 or a Title Case heading fails heading discipline", () => {
    expect(point("# T\n\n#### Deep heading\n", "Anti-Slop: heading discipline").pass).toBe(false);
    expect(point("# T\n\n## Getting Started With Plugins\n", "Anti-Slop: heading discipline").pass).toBe(false);
    expect(point("# T\n\n## Getting started with the API\n", "Anti-Slop: heading discipline").pass).toBe(true);
  });

  test("a heading inside a fence is not a heading", () => {
    expect(analyze("# T\n\n```md\n#### Not a heading\n```\n").metrics.headingsDeeperThanH3).toEqual([]);
  });

  test("a broken relative link is reported; a present one and a URL are not", () => {
    writeFileSync(join(tmp, "present.md"), "x");
    const doc = join(tmp, "doc.md");
    const md = "# T\n\nSee [a](present.md), [b](missing.md#part) and [c](https://example.com).\n";
    const m = analyze(md, doc).metrics;
    expect(m.brokenLocalLinks).toEqual([{ line: 3, text: "missing.md#part" }]);
    expect(point(md, "Maintenance: local links", doc).pass).toBe(false);
  });

  test("a link inside a fence or inline code is an example, not a link", () => {
    const doc = join(tmp, "doc.md");
    const md = "# T\n\nWrite `[x](./nope.md)` like this.\n\n```\n[y](./missing.md)\n```\n\nSee [z](./gone.md).\n";
    expect(analyze(md, doc).metrics.brokenLocalLinks).toEqual([{ line: 9, text: "./gone.md" }]);
  });

  test("a malformed percent-escape is checked as written instead of throwing", () => {
    const doc = join(tmp, "doc.md");
    const md = "# T\n\nSee [a](./100%25-%zz.md).\n";
    expect(analyze(md, doc).metrics.brokenLocalLinks).toEqual([{ line: 3, text: "./100%25-%zz.md" }]);
  });
});

describe("tables", () => {
  test("cells count as body words but not as sentences; the separator row counts for nothing", () => {
    const m = analyze("# T\n\n| Name | What it does |\n|---|---|\n| alpha | parses the input file |\n").metrics;
    expect(m.bodyWords).toBe(9); // "Name What it does" + "alpha parses the input file"
    expect(m.sentences).toBe(0);
  });
});

describe("CLI", () => {
  test("prints JSON with countable points for a file", () => {
    const f = join(tmp, "cli.md");
    writeFileSync(f, "# Title\n\nCertainly! It works.\n");
    const r = Bun.spawnSync(["bun", SCRIPT, f], { env: { ...process.env, NO_COLOR: "1" } });
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout.toString());
    expect(out.countablePoints.max).toBe(12);
    expect(out.countablePoints.earned).toBeLessThan(12);
  });

  test("exits 2 with no file", () => {
    expect(Bun.spawnSync(["bun", SCRIPT]).exitCode).toBe(2);
  });
});
