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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  /** Behaviour-selecting variables this fixture opts into; nothing else is inherited. */
  env?: Record<string, string>;
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

/**
 * Unit-test resolve_appearance the same way: extract the marker block and run it under
 * a CLEAN environment — a fresh temp HOME, a PATH whose first entry is a shim dir so
 * "tmux" is whatever the case says, and only the variables the case names. The real
 * process environment is not inherited, because this developer's shell may itself
 * export TERM_THEME or COLORFGBG and would silently decide every case.
 *
 * The block must depend only on $APPEARANCE, $STATUSLINE_APPEARANCE, $TERM_THEME,
 * $TMUX, $COLORFGBG, $HOME and the tmux binary on PATH; anything else it reaches for
 * shows up here as a wrong word or non-empty stderr.
 */
const appearanceFn = src.match(
  /# >>> resolve_appearance[^\n]*\n([\s\S]*?)# <<< resolve_appearance/,
)?.[1];

if (!appearanceFn) {
  console.log("FAIL  resolve_appearance markers missing from statusline.sh");
  failed++;
} else {
  type AppearanceCase = {
    id: string;
    what: string;
    /** Value of the `appearance` config key (the script's own flag); "auto" unless set. */
    appearance?: string;
    env?: Record<string, string>;
    /** What the tmux shim prints on stdout; undefined means no shim on PATH. */
    tmuxPrints?: string;
    /** Content pre-written to the cache file before the run. */
    cachePrewrite?: string;
    /** Age in seconds to give the pre-written cache file (mtime in the past). */
    cacheAgeSeconds?: number;
    /** Files to create under HOME before the run, relative path -> content. */
    homeFiles?: Record<string, string>;
    want: "light" | "dark";
    /** After the run, the cache file must contain exactly this word. */
    wantCache?: string;
    /**
     * When set, `parse_colorfgbg "$COLORFGBG"` is also run on its own and its stdout must
     * be exactly this. "" pins that the parser itself said nothing, so a dark `want` came
     * from the default and not from a wrong parse.
     */
    parserPrints?: string;
  };

  const cases: AppearanceCase[] = [
    { id: "S-1", what: "config key beats STATUSLINE_APPEARANCE", appearance: "light", env: { STATUSLINE_APPEARANCE: "dark" }, want: "light" },
    { id: "S-1b", what: "config key beats everything below it", appearance: "dark", env: { STATUSLINE_APPEARANCE: "light", TERM_THEME: "light", COLORFGBG: "0;15" }, want: "dark" },
    { id: "S-1c", what: "config key 'Light' is not the exact word and falls through", appearance: "Light", env: { STATUSLINE_APPEARANCE: "dark" }, want: "dark" },
    { id: "S-2", what: "STATUSLINE_APPEARANCE beats TERM_THEME", env: { STATUSLINE_APPEARANCE: "light", TERM_THEME: "dark" }, want: "light" },
    { id: "S-2b", what: "STATUSLINE_APPEARANCE=dark beats TERM_THEME=light", env: { STATUSLINE_APPEARANCE: "dark", TERM_THEME: "light" }, want: "dark" },
    { id: "S-2c", what: "STATUSLINE_APPEARANCE=auto is no opinion; TERM_THEME answers", env: { STATUSLINE_APPEARANCE: "auto", TERM_THEME: "light" }, want: "light" },
    { id: "S-2d", what: "STATUSLINE_APPEARANCE=Dark is not the exact word; TERM_THEME answers", env: { STATUSLINE_APPEARANCE: "Dark", TERM_THEME: "light" }, want: "light" },
    { id: "S-2e", what: "STATUSLINE_APPEARANCE empty is no opinion; falls to COLORFGBG", env: { STATUSLINE_APPEARANCE: "", COLORFGBG: "0;15" }, want: "light" },
    { id: "S-3", what: "TERM_THEME beats COLORFGBG", env: { TERM_THEME: "light", COLORFGBG: "15;0" }, want: "light" },
    { id: "S-3b", what: "TERM_THEME=auto falls through to COLORFGBG (dark)", env: { TERM_THEME: "auto", COLORFGBG: "15;0" }, want: "dark" },
    { id: "S-3b-light", what: "TERM_THEME=auto falls through to COLORFGBG (light)", env: { TERM_THEME: "auto", COLORFGBG: "0;15" }, want: "light" },
    { id: "S-3c", what: "TERM_THEME=Light is no opinion (exact match only)", env: { TERM_THEME: "Light" }, want: "dark" },
    { id: "S-3d", what: "TERM_THEME=light alone selects light", env: { TERM_THEME: "light" }, want: "light" },
    { id: "S-3e", what: "TERM_THEME=dark alone selects dark even when COLORFGBG says light", env: { TERM_THEME: "dark", COLORFGBG: "0;15" }, want: "dark" },
    { id: "S-3f", what: "TERM_THEME empty is no opinion; falls to COLORFGBG", env: { TERM_THEME: "", COLORFGBG: "0;15" }, want: "light" },
    { id: "S-4a", what: "COLORFGBG=0;15 outside tmux", env: { COLORFGBG: "0;15" }, want: "light" },
    { id: "S-4b", what: "COLORFGBG=0;7 outside tmux", env: { COLORFGBG: "0;7" }, want: "light" },
    { id: "S-4c", what: "COLORFGBG=12;3;7 — last field is the background", env: { COLORFGBG: "12;3;7" }, want: "light" },
    { id: "S-5a", what: "COLORFGBG=15;0 outside tmux", env: { COLORFGBG: "15;0" }, want: "dark" },
    { id: "S-5b", what: "COLORFGBG=garbage is no opinion", env: { COLORFGBG: "garbage" }, want: "dark" },
    { id: "S-5c", what: "COLORFGBG=7 (no ';') is no opinion", env: { COLORFGBG: "7" }, want: "dark" },
    { id: "S-5d", what: "COLORFGBG=0;default is no opinion", env: { COLORFGBG: "0;default" }, want: "dark" },
    { id: "S-5e", what: "COLORFGBG=0;07 (zero-padded) is no opinion: the literal set is the contract", env: { COLORFGBG: "0;07" }, want: "dark", parserPrints: "" },
    { id: "S-5f", what: "COLORFGBG=0;015 (zero-padded) is no opinion", env: { COLORFGBG: "0;015" }, want: "dark", parserPrints: "" },
    { id: "S-6", what: "nothing set defaults to dark", want: "dark" },
    { id: "S-tmux-1", what: "inside tmux the env COLORFGBG is ignored", env: { TMUX: "1", COLORFGBG: "0;15" }, tmuxPrints: "COLORFGBG=15;0", want: "dark", wantCache: "dark" },
    { id: "S-tmux-2", what: "inside tmux with no session COLORFGBG", env: { TMUX: "1" }, tmuxPrints: "", want: "dark", wantCache: "none" },
    { id: "S-tmux-4", what: "inside tmux, session COLORFGBG=0;15", env: { TMUX: "1" }, tmuxPrints: "COLORFGBG=0;15", want: "light", wantCache: "light" },
    { id: "S-tmux-5", what: "inside tmux, TERM_THEME=light beats the session COLORFGBG", env: { TMUX: "1", TERM_THEME: "light" }, tmuxPrints: "COLORFGBG=15;0", want: "light" },
    { id: "S-tmux-6", what: "inside tmux with no tmux binary on PATH: dark, silently", env: { TMUX: "1", COLORFGBG: "0;15" }, want: "dark" },
    { id: "S-tmux-7", what: "inside tmux a cache older than 30s is refreshed from tmux", env: { TMUX: "1" }, tmuxPrints: "COLORFGBG=0;15", cachePrewrite: "dark", cacheAgeSeconds: 120, want: "light", wantCache: "light" },
    { id: "S-tmux-8", what: "inside tmux a fresh cache is trusted over tmux", env: { TMUX: "1" }, tmuxPrints: "COLORFGBG=0;15", cachePrewrite: "dark", want: "dark", wantCache: "dark" },
    { id: "S-cache-noenv", what: "env is never cached: cache says dark, TERM_THEME says light", env: { TERM_THEME: "light" }, cachePrewrite: "dark", want: "light" },
    { id: "S-cache-env-outside", what: "outside tmux the cache is not consulted", env: { COLORFGBG: "0;15" }, cachePrewrite: "dark", want: "light" },
    { id: "S-removed", what: "the old tmux theme-file pin is gone", homeFiles: { [join(".config", "tmux", "theme")]: "light\n" }, want: "dark" },
  ];

  const runAppearance = (
    home: string,
    shimDir: string,
    c: Pick<AppearanceCase, "appearance" | "env">,
  ) => {
    const probe = `APPEARANCE=${JSON.stringify(c.appearance ?? "auto")}\n${appearanceFn}\nresolve_appearance\n`;
    return Bun.spawnSync(["bash", "-c", probe], {
      env: { HOME: home, PATH: `${shimDir}:/usr/bin:/bin`, ...(c.env ?? {}) },
    });
  };

  const setupHome = (c: AppearanceCase) => {
    const home = mkdtempSync(join(tmpdir(), "statusline-resolve-"));
    const shimDir = join(home, "shim");
    mkdirSync(shimDir);
    mkdirSync(join(home, ".claude"));
    if (c.tmuxPrints !== undefined) {
      writeFileSync(join(shimDir, "tmux"), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(c.tmuxPrints)}\n`, { mode: 0o755 });
    }
    if (c.cachePrewrite !== undefined) {
      const file = join(home, ".claude", ".statusline-tmux-colorfgbg");
      writeFileSync(file, `${c.cachePrewrite}\n`);
      if (c.cacheAgeSeconds !== undefined) {
        const then = new Date(Date.now() - c.cacheAgeSeconds * 1000);
        utimesSync(file, then, then);
      }
    }
    for (const [rel, content] of Object.entries(c.homeFiles ?? {})) {
      mkdirSync(join(home, rel, ".."), { recursive: true });
      writeFileSync(join(home, rel), content);
    }
    return { home, shimDir };
  };

  const cacheFile = (home: string) => join(home, ".claude", ".statusline-tmux-colorfgbg");
  const failedBefore = failed;

  for (const c of cases) {
    checks++;
    const { home, shimDir } = setupHome(c);
    const proc = runAppearance(home, shimDir, c);
    const got = proc.stdout.toString();
    const stderr = proc.stderr.toString().trim();
    const problems: string[] = [];
    if (proc.exitCode !== 0) problems.push(`exit ${proc.exitCode}`);
    if (stderr) problems.push(`stderr: ${stderr.split("\n")[0]}`);
    if (got !== c.want) problems.push(`got ${JSON.stringify(got)}, want ${JSON.stringify(c.want)}`);
    if (c.wantCache !== undefined) {
      const cached = existsSync(cacheFile(home)) ? readFileSync(cacheFile(home), "utf8").trim() : "<missing>";
      if (cached !== c.wantCache) problems.push(`cache ${JSON.stringify(cached)}, want ${JSON.stringify(c.wantCache)}`);
    }
    if (c.parserPrints !== undefined) {
      const parser = Bun.spawnSync(["bash", "-c", `${appearanceFn}\nparse_colorfgbg "$COLORFGBG"\n`], {
        env: { HOME: home, PATH: `${shimDir}:/usr/bin:/bin`, ...(c.env ?? {}) },
      });
      const printed = parser.stdout.toString();
      if (printed !== c.parserPrints) problems.push(`parse_colorfgbg printed ${JSON.stringify(printed)}, want ${JSON.stringify(c.parserPrints)}`);
    }
    if (problems.length) {
      failed++;
      console.log(`FAIL  resolve_appearance ${c.id}: ${c.what}`);
      for (const p of problems) console.log(`        ${p}`);
    }
  }

  // S-tmux-3: the tmux verdict is cached for 30s, so a shim that changes its answer
  // inside that window is not consulted again. Two runs in one HOME.
  {
    checks++;
    const c: AppearanceCase = { id: "S-tmux-3", what: "tmux verdict is cached for 30s", env: { TMUX: "1" }, tmuxPrints: "COLORFGBG=0;15", want: "light" };
    const { home, shimDir } = setupHome(c);
    const first = runAppearance(home, shimDir, c).stdout.toString();
    writeFileSync(join(shimDir, "tmux"), `#!/bin/sh\nprintf 'COLORFGBG=15;0\\n'\n`, { mode: 0o755 });
    const second = runAppearance(home, shimDir, c).stdout.toString();
    const cached = existsSync(cacheFile(home)) ? readFileSync(cacheFile(home), "utf8").trim() : "<missing>";
    if (first !== "light" || second !== "light" || cached !== "light") {
      failed++;
      console.log(`FAIL  resolve_appearance ${c.id}: ${c.what}`);
      console.log(`        first ${JSON.stringify(first)}, second ${JSON.stringify(second)}, cache ${JSON.stringify(cached)} (want light/light/light)`);
    }
  }

  // S-grep: the two steps that are not in the user's order are gone from the source,
  // not merely unreachable. S-removed proves the file pin has no effect; this proves
  // nobody can quietly wire either back in.
  {
    checks++;
    const gone = ["AppleInterfaceStyle", ".config/tmux/theme"];
    const present = gone.filter((needle) => src.includes(needle));
    if (present.length) {
      failed++;
      console.log("FAIL  resolve_appearance S-grep: removed steps still referenced in statusline.sh");
      for (const p of present) console.log(`        ${p}`);
    }
  }

  if (failed === failedBefore) console.log(`ok    resolve_appearance (${cases.length + 2} cases)`);
}

/**
 * The fixture sweep does NOT inherit the developer's environment. The statusline
 * changes what it renders on several variables — a claudish-routed session exports
 * CLAUDISH_ACTIVE_MODEL_NAME and CLAUDISH_TOKEN_FILE, which correctly suppress the
 * Anthropic plan sections the fixtures expect, so 6 of 10 fixtures failed for a
 * reviewer running from such a session. Only the plumbing the script needs to run
 * comes through: PATH, HOME, TERM, the locale, and COLUMNS as this harness sets it.
 * Everything behaviour-selecting (CLAUDISH_*, TERM_THEME, COLORFGBG, STATUSLINE_*,
 * TMUX) is absent unless a fixture declares it in its own `env`.
 */
const INHERITED = ["PATH", "HOME", "TERM", "LANG", "LC_ALL", "LC_CTYPE"] as const;
const baseEnv: Record<string, string> = {};
for (const key of INHERITED) {
  const value = process.env[key];
  if (value !== undefined) baseEnv[key] = value;
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
          ...baseEnv,
          ...(fx.env ?? {}),
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
