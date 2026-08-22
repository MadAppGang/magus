#!/usr/bin/env bun
/**
 * Runs every fixture in test-fixtures.json through statusline.sh and asserts that
 * each fixture's `expected_sections` all appear in the rendered output.
 *
 * The fixtures existed before this runner did, and nothing executed them — the file's
 * `usage` field was a one-liner you were expected to paste by hand. That is how three
 * parsing breakages shipped together: Claude Code changed `used_percentage` to a float,
 * `current_usage` to an object, and `resets_at` to a Unix epoch, and the script kept
 * exiting 0 while silently dropping the entire plan-limits section.
 *
 * So this checks two things a smoke test would miss:
 *   1. stderr must be empty — the failures above printed "integer expression expected"
 *      to stderr and still exited 0.
 *   2. every expected section must be present — a section can vanish without any error
 *      at all when a guard condition simply evaluates false.
 *
 * Each fixture runs in both appearances and at three widths, because the palette and
 * the wrapper are both appearance- and width-dependent.
 */

import { $ } from "bun";
import { join } from "node:path";

const HERE = import.meta.dir;
const SCRIPT = join(HERE, "statusline.sh");
const FIXTURES = join(HERE, "..", "test-fixtures.json");

const WIDTHS = [234, 100, 60];
const APPEARANCES = ["light", "dark"] as const;

// Strip SGR sequences so assertions match on visible text.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

type Fixture = {
  description?: string;
  expected_sections?: string[];
  input: unknown;
};

const { fixtures } = (await Bun.file(FIXTURES).json()) as { fixtures: Fixture[] };

let failed = 0;
let checks = 0;

/**
 * Unit-test display_width by extracting it from the script and evaluating it alone.
 *
 * This needs its own test rather than riding on a rendered-output assertion, because
 * over-measuring does not break anything visibly — it just wraps terminals that had
 * room, and every fixture still renders fine, one line, no error. The bracket-set bug
 * inflated bars by a third and passed a full render sweep at 234 columns untouched.
 */
const src = await Bun.file(SCRIPT).text();
const fn = src.match(/# >>> display_width[^\n]*\n([\s\S]*?)# <<< display_width/)?.[1];

if (!fn) {
  console.log("FAIL  display_width markers missing from statusline.sh");
  failed++;
} else {
  // [input, expected columns, what it is]
  const cases: [string, number, string][] = [
    ["abc", 3, "plain ascii"],
    ["\\033[38;5;22mabc\\033[0m", 3, "escapes are not columns"],
    ["█░░░░░", 6, "block glyphs are one column each"],
    ["█▀▀▀▀-----", 10, "bar glyphs are one column each"],
    ["🤖", 2, "robot is double-width"],
    ["⚡", 2, "bolt is double-width"],
    ["\\033[38;5;22m█\\033[38;5;241m░░░░░\\033[0m \\033[38;5;22m25%\\033[0m", 10, "real bar section"],
    ["🤖 +12/-3", 9, "diff chip: 8 chars, robot counts twice"],
  ];

  for (const [input, want, what] of cases) {
    checks++;
    const probe = `shopt -s extglob\n${fn}\ndisplay_width "$1"\n`;
    const proc = Bun.spawnSync(["bash", "-c", probe, "_", input]);
    const got = Number(proc.stdout.toString().trim());
    if (got !== want) {
      console.log(`FAIL  display_width: ${what}`);
      console.log(`        input ${JSON.stringify(input)} -> got ${got}, want ${want}`);
      failed++;
    }
  }
  if (!failed) console.log(`ok    display_width (${cases.length} cases)`);
}

for (const [i, fx] of fixtures.entries()) {
  const name = fx.description ?? `fixture-${i}`;
  const stdin = JSON.stringify(fx.input);
  const problems: string[] = [];

  for (const appearance of APPEARANCES) {
    for (const columns of WIDTHS) {
      checks++;
      const proc = Bun.spawnSync(["bash", SCRIPT], {
        stdin: Buffer.from(stdin),
        env: {
          ...process.env,
          COLUMNS: String(columns),
          STATUSLINE_APPEARANCE: appearance,
        },
      });

      const where = `${appearance}/${columns}`;
      const stdout = proc.stdout.toString();
      const stderr = proc.stderr.toString().trim();

      if (proc.exitCode !== 0) {
        problems.push(`[${where}] exit ${proc.exitCode}`);
        continue;
      }
      // Exit 0 with stderr output is the exact shape of the bugs this guards against.
      if (stderr) {
        problems.push(`[${where}] stderr: ${stderr.split("\n")[0]}`);
      }
      if (!stdout.trim()) {
        problems.push(`[${where}] empty output`);
        continue;
      }
      if (stdout.includes("\\033")) {
        problems.push(`[${where}] unexpanded escape leaked into output`);
      }

      const visible = stripAnsi(stdout);
      // Only the widest render is asserted for content: narrower ones wrap, and a
      // section can legitimately shorten as the adaptive bar widths kick in.
      if (columns === 234) {
        for (const expected of fx.expected_sections ?? []) {
          if (!visible.includes(expected)) {
            problems.push(`[${where}] missing section: ${expected}`);
          }
        }
        // Every fixture fits comfortably inside 234 columns, so anything but a single
        // line means the width measurement has drifted upward and the script is
        // wrapping terminals that had room. That is not hypothetical: the wide-glyph
        // count used a bracket expression, which matches BYTES — it ate the shared
        // 0xE2 lead byte of █ ░ ▀ and inflated every bar by a third, splitting lines
        // on 180-column terminals. Premature wrapping is invisible in a smoke test,
        // so it needs an explicit assertion.
        const lines = stdout.trimEnd().split("\n").length;
        if (lines !== 1) {
          problems.push(`[${where}] wrapped into ${lines} lines at 234 columns`);
        }
      }
    }
  }

  if (problems.length) {
    failed++;
    console.log(`FAIL  ${name}`);
    for (const p of problems.slice(0, 6)) console.log(`        ${p}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

console.log("---");
if (failed) {
  console.log(`${failed}/${fixtures.length} fixtures FAILED (${checks} renders)`);
  process.exit(1);
}
console.log(`All ${fixtures.length} fixtures pass (${checks} renders)`);
