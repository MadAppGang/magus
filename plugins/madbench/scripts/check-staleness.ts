#!/usr/bin/env bun
/**
 * Is the madbench skill still describing the madbench that is installed?
 *
 * The skill mirrors a release that ships roughly every 1.2 days. It was corrected once,
 * was accurate for about a day, and drifted ten releases before anyone noticed — because
 * nothing measured it. This script measures it, in two layers with different authority:
 *
 *   GATE      `madbench list` — and, where the harness allows it, `madbench preflight` —
 *             over every bench under skills/madbench-evals/examples/. Each example is one
 *             version-sensitive surface the skill teaches, spelled the way the skill
 *             teaches it. A bench the installed madbench refuses to load is the finding,
 *             and it is one nobody can silence with a string edit.
 *
 *   ADVISORY  mirrors.json `madbenchVersion` against `madbench version`. Printed above
 *             the result so a reader knows HOW stale, and named as a delta when they
 *             differ. A matching version is never a pass on its own: the examples still
 *             have to load. `derivedMetrics:` produced `field … not found` at EVERY value
 *             of madbenchVersion, which is why a version compare cannot be the gate.
 *
 *             ADVISORY MEANS EXIT 0. Measured during review: the binary self-updated
 *             0.33.0 → 0.33.1 mid-session, every example still loaded, and a version-only
 *             exit 1 turned `check:all` — the gate for EVERY plugin's release here — red
 *             over a madbench patch bump that changed nothing this skill documents. That
 *             is a gate people learn to skip, and it is silenced by a one-string edit,
 *             which is precisely the thing the content probe exists to be immune to.
 *             `--strict` promotes the delta to exit 1; the weekly workflow uses it.
 *
 * WHY BOTH `list` AND `preflight`. Measured on 0.33.0: `madbench list` parses the
 * BenchSpec and compiles `metrics:` expressions, but does NOT construct checks — a bench
 * declaring `type: environment:nonsense` lists cleanly. `madbench preflight` constructs
 * every check and refuses that bench with madbench's own `unknown check type`. So the
 * check-catalogue surface is only probed by preflight. Preflight is skipped for a bench
 * that declares `image:`, because the mock harness cannot deliver an image and preflight
 * says so by design — a refusal that names upstream's contract, not a regression here.
 *
 * WHAT IT NEVER DOES. It never edits, never blocks a bench run, and never consults a
 * madbench source checkout — a checkout builds `dev`, which is a different program from
 * the release on PATH. The binary on PATH is the only source.
 *
 * EXIT CODES ARE THREE-VALUED, and every caller depends on it:
 *   0  every example loads — including when the versions differ, which prints STALE and
 *      stays advisory unless --strict
 *   1  an example refused to load; or, under --strict, the versions differ
 *   2  could not measure — no parseable version, no examples, unreadable mirrors.json,
 *      or a madbench process that never started (`CommandResult.code === null`)
 * 2 is reported RED. A run that measured nothing is not a pass, and treating it as one
 * rebuilds the exact blind spot this script exists to close. An unstartable process is
 * exit 2 and never exit 1: infrastructure failure is not a claim about the skill.
 *
 * A machine without madbench on PATH gets ONE line and exit 0 — advisory mode is wired
 * into `check:all`, and a missing optional binary must not fail every developer's gate.
 * `--strict` (the weekly workflow, which installs madbench first) turns that into exit 2.
 *
 *   bun plugins/madbench/scripts/check-staleness.ts               advisory
 *   bun plugins/madbench/scripts/check-staleness.ts --strict      absent binary = exit 2
 *   bun plugins/madbench/scripts/check-staleness.ts --self-test   prove every rule can fire
 *   bun plugins/madbench/scripts/check-staleness.ts --mirrors <file> --examples <dir>
 *                                                                 probe forged inputs
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

/**
 * Bun's built-in YAML parser. Kept behind a narrow type so the plugin needs no dependency
 * — the same shim `check-bench-layout.ts` uses, and for the same reason. An `import … from
 * "yaml"` resolves only inside this repo's node_modules; run from the plugin's install
 * directory (`~/.claude/plugins/cache/magus/madbench/<version>/`, which is where
 * `/madbench:doctor` runs it) module resolution walks up and finds nothing, so the script
 * either dies with `Cannot find package 'yaml'` or silently fetches it from the network.
 */
const YAML = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_MIRRORS = join(PLUGIN_ROOT, "mirrors.json");
const DEFAULT_EXAMPLES = join(PLUGIN_ROOT, "skills", "madbench-evals", "examples");

const C = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", off: "\x1b[0m" };

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export interface Mirrors {
  madbenchVersion: string;
  verifiedAt: string;
  versionSensitive: string[];
  stable: string[];
}

export interface CommandResult {
  /** null when the process could not be started at all */
  code: number | null;
  /** stdout and stderr, in that order — madbench writes its load errors to stderr */
  out: string;
}

/**
 * Everything the verdict needs from the binary, behind one interface so the self-test can
 * forge each answer without a second madbench on the machine.
 */
export interface Runner {
  /** absolute path of the binary, or null when it is not on PATH */
  binary: string | null;
  version(): CommandResult;
  list(file: string): CommandResult;
  preflight(file: string): CommandResult;
}

/**
 * `madbench version` is the ONLY version source. There is no `--version` flag, and a
 * source checkout answers `madbench dev`, which this parser refuses on purpose: dev is not
 * a release, and comparing the skill against it would be comparing it against a program
 * nobody else has.
 *
 * Fails closed. The whole output must be exactly `madbench <major>.<minor>.<patch>` — one
 * line, no banner, no prerelease tag. Anything else is "could not measure", never
 * "current". A released build appends an update advisory to any command once a day, so
 * the real runner sets MADBENCH_NO_UPDATE_CHECK=1; if that ever stops working the check
 * goes red rather than quietly reading the wrong line.
 */
export function parseVersion(out: string): string | null {
  const m = /^madbench (\d+\.\d+\.\d+)$/.exec(out.trim());
  return m ? m[1]! : null;
}

/** -1 when a < b, 0 when equal, 1 when a > b. Both must already be `x.y.z`. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function readMirrors(file: string): Mirrors {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Mirrors>;
  if (typeof raw.madbenchVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.madbenchVersion)) {
    throw new Error(`${file}: madbenchVersion must be "x.y.z", got ${JSON.stringify(raw.madbenchVersion)}`);
  }
  if (typeof raw.verifiedAt !== "string") throw new Error(`${file}: verifiedAt missing`);
  return {
    madbenchVersion: raw.madbenchVersion,
    verifiedAt: raw.verifiedAt,
    versionSensitive: Array.isArray(raw.versionSensitive) ? raw.versionSensitive : [],
    stable: Array.isArray(raw.stable) ? raw.stable : [],
  };
}

/** Directories that hold a bench's supporting files, never a bench of their own. */
const SKIP_DIRS = new Set(["module", "testdata", "node_modules", "results"]);

/**
 * Every bench file under `dir`, recursively: `madbench.yaml` or `*.madbench.yaml`. Derived
 * from the tree rather than declared in mirrors.json — a listed registry of examples is
 * exactly the kind of file that goes stale.
 *
 * Per file, never per directory: `madbench list <dir>` over a directory whose benches sit
 * one level down prints nothing and exits 0 (measured), which would read as "everything
 * loads" about a set of files it never opened.
 */
export function findBenches(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "madbench.yaml" || entry.endsWith(".madbench.yaml")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Does any Scenario declare `image:`? Decided from the bench's own content, because the
 * mock harness cannot deliver an image and `madbench preflight` refuses such a bench by
 * design. An unparseable file answers false and is left for `list` to report properly.
 */
export function declaresImage(yamlText: string): boolean {
  try {
    const doc = YAML.parse(yamlText) as { scenarios?: unknown } | null;
    const scenarios = doc?.scenarios;
    if (!Array.isArray(scenarios)) return false;
    return scenarios.some((s) => s !== null && typeof s === "object" && "image" in (s as object));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// probing
// ---------------------------------------------------------------------------

export interface Probe {
  /** repo-relative for display */
  file: string;
  list: CommandResult;
  /** null when preflight was skipped because the bench declares `image:` */
  preflight: CommandResult | null;
}

export function probeBenches(runner: Runner, files: string[], displayRoot: string): Probe[] {
  return files.map((file) => {
    const list = runner.list(file);
    const skipPreflight = list.code !== 0 || declaresImage(readFileSync(file, "utf8"));
    return {
      file: relative(displayRoot, file),
      list,
      preflight: skipPreflight ? null : runner.preflight(file),
    };
  });
}

// ---------------------------------------------------------------------------
// verdict — pure, so every rule is provable without a binary
// ---------------------------------------------------------------------------

export type Exit = 0 | 1 | 2;

export interface Report {
  exit: Exit;
  lines: string[];
}

export interface VerdictInput {
  mirrors: Mirrors;
  /** raw `madbench version` output */
  versionOut: string;
  probes: Probe[];
  /**
   * `--strict`, the weekly workflow's mode. It promotes the ADVISORY version delta to a
   * failure. The default path reports the delta and exits 0, because `check:all` gates
   * every plugin's release in this marketplace and upstream ships roughly every 1.2 days
   * — a `terminal` release blocked by a madbench patch bump that changed nothing the skill
   * documents is a gate people learn to skip. The content probe is the gate in BOTH modes.
   */
  strict?: boolean;
}

/**
 * madbench's own error text, verbatim, so the finding quotes upstream rather than
 * paraphrasing it. Up to four lines: a YAML load error puts `yaml: unmarshal errors:` on
 * line 1 and the field it refused on the lines after — the self-test caught the first
 * draft quoting line 1 alone and losing the finding.
 */
function errorText(out: string, indent: string): string {
  const lines = out.trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return "(no output)";
  const shown = lines.slice(0, 4).map((l) => l.trim());
  if (lines.length > 4) shown.push(`${C.dim}… ${lines.length - 4} more line(s)${C.off}`);
  return shown.join(`\n${indent}`);
}

export function verdict(input: VerdictInput): Report {
  const { mirrors, probes } = input;
  const lines: string[] = [];

  // --- advisory: version ---------------------------------------------------------------
  const installed = parseVersion(input.versionOut);
  if (installed === null) {
    lines.push(`${C.red}COULD NOT MEASURE${C.off} — \`madbench version\` did not answer \`madbench <x.y.z>\`.`);
    lines.push(`  got: ${JSON.stringify(input.versionOut.trim())}`);
    lines.push(`  A source build answers \`madbench dev\`; that is a different program from any release,`);
    lines.push(`  so nothing is compared against it. Install a release: brew install madappgang/tap/madbench`);
    return { exit: 2, lines };
  }

  const cmp = compareSemver(mirrors.madbenchVersion, installed);
  const header = `madbench staleness — mirrors ${mirrors.madbenchVersion} (verified ${mirrors.verifiedAt}) · installed ${installed}`;
  let stale = false;
  if (cmp === 0) {
    lines.push(`${header}  ${C.green}current${C.off}`);
  } else {
    stale = true;
    const direction = cmp < 0 ? "the skill is BEHIND the installed release" : "the installed binary is OLDER than the release the skill mirrors";
    lines.push(`${header}  ${C.yellow}STALE — ${direction}${C.off}`);
    if (cmp < 0) {
      lines.push(`  Re-verify the version-sensitive files against ${installed}, then bump mirrors.json:`);
      for (const f of mirrors.versionSensitive) lines.push(`    ${f}`);
      lines.push(`  ${C.dim}stable (did not move across recent releases, re-read only if a probe fails):${C.off}`);
      for (const f of mirrors.stable) lines.push(`    ${C.dim}${f}${C.off}`);
    } else {
      lines.push(`  Run \`madbench update\` — the skill documents features this binary does not have.`);
    }
  }

  // --- gate: content -------------------------------------------------------------------
  if (probes.length === 0) {
    lines.push(`${C.red}COULD NOT MEASURE${C.off} — no example bench found. The gate is the examples; without them only a string was compared.`);
    return { exit: 2, lines };
  }

  lines.push(`examples (${probes.length}):`);
  let refused = 0;
  let unstartable = 0;
  for (const p of probes) {
    // A process that could not START measured nothing, and that is NOT the same result as
    // a bench madbench refused. `CommandResult.code` is documented null for exactly this,
    // and grouping it with `code !== 0` would file an infrastructure failure as a staleness
    // finding — the one confusion this script's three-valued exit exists to prevent.
    if (p.list.code === null || (p.preflight !== null && p.preflight.code === null)) {
      unstartable++;
      lines.push(`  ${C.red}????${C.off}  ${p.file}`);
      lines.push(`        ${C.dim}madbench did not start against this bench — nothing was measured about it${C.off}`);
      continue;
    }
    if (p.list.code !== 0) {
      refused++;
      lines.push(`  ${C.red}FAIL${C.off}  ${p.file}`);
      lines.push(`        list: ${errorText(p.list.out, "              ")}`);
      continue;
    }
    if (p.preflight !== null && p.preflight.code !== 0) {
      refused++;
      lines.push(`  ${C.red}FAIL${C.off}  ${p.file}`);
      lines.push(`        preflight: ${errorText(p.preflight.out, "                   ")}`);
      continue;
    }
    const pf = p.preflight === null ? `preflight skipped ${C.dim}(declares image: — the mock harness cannot deliver one)${C.off}` : "preflight ok";
    lines.push(`  ${C.green}ok${C.off}    ${p.file}  ${C.dim}list ok · ${C.off}${pf}`);
  }

  // Unmeasurable outranks a finding, as it does in check-bench-layout: a probe set that
  // did not complete cannot support "N of N load", and a run that measured nothing is not
  // a pass. The refusals above are still printed — they are real — but the exit says so.
  if (unstartable > 0) {
    lines.push(
      `${C.red}COULD NOT MEASURE${C.off} — madbench failed to start against ${unstartable} of ${probes.length} example bench(es). ` +
        `That is an infrastructure failure, not staleness; the gate did not run over the whole set.`,
    );
    return { exit: 2, lines };
  }
  if (refused > 0) {
    lines.push(`${C.red}FAIL${C.off} — ${refused} of ${probes.length} example bench(es) refused by madbench ${installed}. The skill teaches a shape this release does not load.`);
    return { exit: 1, lines };
  }
  if (stale) {
    // ADVISORY. Every example loads, so the gate — the content probe — is green, and only
    // the string compare differs. `--strict` (the weekly workflow) is what turns the delta
    // into a failure; see VerdictInput.strict for why the default path must not.
    lines.push(`${C.yellow}STALE${C.off} — every example loads, but mirrors.json names ${mirrors.madbenchVersion} and ${installed} is installed. Re-verify and bump.`);
    if (input.strict) return { exit: 1, lines };
    lines.push(`${C.dim}  advisory only — the content gate is green, so this exits 0. --strict makes the version delta exit 1.${C.off}`);
    return { exit: 0, lines };
  }
  lines.push(`${C.green}PASS${C.off} — mirrors current, ${probes.length}/${probes.length} example benches load on madbench ${installed}`);
  return { exit: 0, lines };
}

/** The no-binary branch, kept pure for the same reason as `verdict`. */
export function absentReport(strict: boolean): Report {
  if (strict) {
    return {
      exit: 2,
      lines: [`${C.red}COULD NOT MEASURE${C.off} — madbench is not on PATH and --strict was given. Install it: brew install madappgang/tap/madbench`],
    };
  }
  return { exit: 0, lines: [`${C.dim}madbench staleness: madbench is not on PATH — nothing measured (advisory mode; --strict makes this exit 2)${C.off}`] };
}

// ---------------------------------------------------------------------------
// the real runner
// ---------------------------------------------------------------------------

function realRunner(): Runner {
  const binary = Bun.which("madbench");
  const run = (...args: string[]): CommandResult => {
    if (!binary) return { code: null, out: "" };
    const p = Bun.spawnSync([binary, ...args], {
      // No update banner appended to any output, no colour codes in what we parse.
      env: { ...process.env, MADBENCH_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };
  return {
    binary,
    version: () => run("version"),
    list: (file) => run("list", file),
    preflight: (file) => run("preflight", file),
  };
}

// ---------------------------------------------------------------------------
// --self-test: every rule must fire on forged input, and stay quiet on clean input
// ---------------------------------------------------------------------------

const CLEAN: Mirrors = { madbenchVersion: "0.33.0", verifiedAt: "2026-09-10", versionSensitive: ["skills/x/schema.md"], stable: ["skills/x/debugging.md"] };
const OK: CommandResult = { code: 0, out: "Bench: x (harness: mock)\n  - s\n" };
const okProbe = (file: string): Probe => ({ file, list: OK, preflight: OK });

interface SelfTest {
  id: string;
  title: string;
  run: () => { exit: Exit; text: string };
  /** the exit the rule must produce when it fires */
  fires: Exit;
  /** a substring the report must carry, so the rule is proven to NAME its finding */
  names?: string;
}

const SELF_TESTS: readonly SelfTest[] = [
  {
    id: "ST-01",
    title: "version drift alone under --strict exits 1 and names the version-sensitive files",
    fires: 1,
    names: "skills/x/schema.md",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.35.0\n", probes: [okProbe("a/madbench.yaml")], strict: true })),
  },
  {
    id: "ST-01b",
    title: "version drift alone WITHOUT --strict exits 0 and still prints the STALE line — advisory, not a gate",
    fires: 0,
    names: "advisory only",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.35.0\n", probes: [okProbe("a/madbench.yaml")] })),
  },
  {
    id: "ST-02",
    title: "installed binary older than the mirrored release says to update — exit 1 under --strict",
    fires: 1,
    names: "madbench update",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.30.0\n", probes: [okProbe("a/madbench.yaml")], strict: true })),
  },
  {
    id: "ST-03",
    title: "a bench refused by `madbench list` exits 1 and quotes madbench's own error",
    fires: 1,
    names: "field derivedMetrics not found",
    run: () =>
      flat(
        verdict({
          mirrors: CLEAN,
          versionOut: "madbench 0.33.0",
          probes: [okProbe("a/madbench.yaml"), { file: "b/madbench.yaml", list: { code: 1, out: "Error: loading b: line 9: field derivedMetrics not found in type madbench.BenchSpec\n" }, preflight: null }],
        }),
      ),
  },
  {
    id: "ST-04",
    title: "a bench refused by `madbench preflight` exits 1 — list alone does not construct checks",
    fires: 1,
    names: 'unknown check type "environment:nonsense"',
    run: () =>
      flat(
        verdict({
          mirrors: CLEAN,
          versionOut: "madbench 0.33.0",
          probes: [{ file: "c/madbench.yaml", list: OK, preflight: { code: 1, out: 'Error: Scenario s › Check environment:nonsense: unknown check type "environment:nonsense"\n' } }],
        }),
      ),
  },
  {
    id: "ST-05",
    title: "a matching version is not a pass on its own — the content probe still decides",
    fires: 1,
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0", probes: [{ file: "d/madbench.yaml", list: { code: 1, out: "Error: nope" }, preflight: null }] })),
  },
  {
    id: "ST-06",
    title: "`madbench dev` (a source build) is refused as a version — exit 2, red",
    fires: 2,
    names: "COULD NOT MEASURE",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench dev\n", probes: [okProbe("a/madbench.yaml")] })),
  },
  {
    id: "ST-07",
    title: "an update banner after the version line fails closed — exit 2, never a guess",
    fires: 2,
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0\n↑ madbench v0.34.0 is available — run: madbench update\n", probes: [okProbe("a/madbench.yaml")] })),
  },
  {
    id: "ST-08",
    title: "no example benches at all is exit 2 — a version compare alone measured nothing",
    fires: 2,
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0", probes: [] })),
  },
  {
    id: "ST-09",
    title: "binary absent: advisory exit 0 with one line, --strict exit 2",
    fires: 2,
    run: () => {
      const advisory = absentReport(false);
      if (advisory.exit !== 0 || advisory.lines.length !== 1) return { exit: 0, text: "advisory branch did not exit 0 with one line" };
      return flat(absentReport(true));
    },
  },
  {
    id: "ST-09b",
    title: "a probe whose process never started is exit 2, not exit 1 — an infrastructure failure is not staleness",
    fires: 2,
    names: "COULD NOT MEASURE",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0", probes: [okProbe("a/madbench.yaml"), { file: "b/madbench.yaml", list: { code: null, out: "" }, preflight: null }] })),
  },
  {
    id: "ST-09c",
    title: "an unstartable preflight is exit 2 even when its list succeeded — the set was not fully probed",
    fires: 2,
    names: "COULD NOT MEASURE",
    run: () => flat(verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0", probes: [{ file: "c/madbench.yaml", list: OK, preflight: { code: null, out: "" } }] })),
  },
  {
    id: "ST-09d",
    title: "unmeasurable outranks a refusal — a partly-probed set cannot report `N of N load`",
    fires: 2,
    run: () =>
      flat(
        verdict({
          mirrors: CLEAN,
          versionOut: "madbench 0.33.0",
          probes: [
            { file: "b/madbench.yaml", list: { code: 1, out: "Error: nope" }, preflight: null },
            { file: "c/madbench.yaml", list: { code: null, out: "" }, preflight: null },
          ],
        }),
      ),
  },
  {
    id: "ST-10",
    title: "declaresImage: a Scenario with `image:` skips preflight; one without does not",
    fires: 1,
    run: () => {
      const withImage = declaresImage("scenarios:\n  - name: s\n    image: generated:x.png\n");
      const without = declaresImage("scenarios:\n  - name: s\n    prompt: hi\n");
      return { exit: withImage && !without ? 1 : 0, text: `with=${withImage} without=${without}` };
    },
  },
];

/** The positive control: clean input must NOT fire any rule. */
function cleanInputPasses(): boolean {
  return verdict({ mirrors: CLEAN, versionOut: "madbench 0.33.0\n", probes: [okProbe("a/madbench.yaml"), { file: "img/madbench.yaml", list: OK, preflight: null }] }).exit === 0;
}

function flat(r: Report): { exit: Exit; text: string } {
  return { exit: r.exit, text: r.lines.join("\n") };
}

/**
 * The one self-test that needs the real binary: a forged `derivedMetrics:` bench in a
 * temp directory must be refused by the installed madbench through the real runner. This
 * is the rot that started the whole exercise, reproduced end to end. Skipped, loudly, when
 * madbench is absent — the pure rules above still prove the verdict logic.
 */
function realBinaryRefusesForgedBench(runner: Runner): "ok" | "skip" | string {
  if (!runner.binary) return "skip";
  const dir = mkdtempSync(join(tmpdir(), "madbench-staleness-selftest-"));
  try {
    const forged = join(dir, "madbench.yaml");
    writeFileSync(forged, "name: forged\nharness: mock\nscenarios:\n  - name: s\n    prompt: hi\n    checks:\n      - type: contains\n        value: hi\nderivedMetrics:\n  - name: x\n", "utf8");
    const probes = probeBenches(runner, [forged], dir);
    const r = verdict({ mirrors: CLEAN, versionOut: runner.version().out, probes });
    if (r.exit !== 1) return `expected exit 1, got ${r.exit}:\n${r.lines.join("\n")}`;
    if (!r.lines.some((l) => l.includes("derivedMetrics"))) return `did not quote madbench's error:\n${r.lines.join("\n")}`;
    return "ok";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function selfTest(runner: Runner): never {
  let bad = 0;
  for (const t of SELF_TESTS) {
    const r = t.run();
    if (r.exit !== t.fires) {
      bad++;
      console.log(`${C.red}FAIL${C.off}  ${t.id} did not fire (exit ${r.exit}, wanted ${t.fires}) — ${t.title}`);
    } else if (t.names && !r.text.includes(t.names)) {
      bad++;
      console.log(`${C.red}FAIL${C.off}  ${t.id} fired but did not name ${JSON.stringify(t.names)} — ${t.title}`);
    } else {
      console.log(`${C.green}ok  ${C.off}  ${t.id} fired (exit ${r.exit}) — ${t.title}`);
    }
  }
  if (cleanInputPasses()) console.log(`${C.green}ok  ${C.off}  clean input exits 0 (positive control)`);
  else {
    bad++;
    console.log(`${C.red}FAIL${C.off}  clean input did not exit 0 — a rule fires on nothing`);
  }
  const real = realBinaryRefusesForgedBench(runner);
  if (real === "ok") console.log(`${C.green}ok  ${C.off}  ST-11 the installed madbench refuses a forged derivedMetrics: bench through the real runner`);
  else if (real === "skip") console.log(`${C.yellow}skip${C.off}  ST-11 madbench not on PATH — real-binary refusal not exercised here`);
  else {
    bad++;
    console.log(`${C.red}FAIL${C.off}  ST-11 ${real}`);
  }
  console.log(bad === 0 ? `\n${C.green}self-test OK${C.off} — every rule can fire` : `\n${C.red}${bad} rule(s) cannot fire${C.off}`);
  process.exit(bad === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

/**
 * A flag's value, or a thrown error naming what was wrong. Never `argv[i + 1]` unchecked:
 * `--mirrors --strict` would silently treat `--strict` as the path, and a trailing
 * `--mirrors` would silently fall back to the default — a flag that appears to take effect
 * and does not is the failure mode this whole script exists to make impossible.
 */
export function optValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`${name} needs a value; none followed it`);
  if (v.startsWith("--")) throw new Error(`${name} needs a value, got the flag ${v}`);
  return v;
}

function main(): never {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const runner = realRunner();

  if (argv.includes("--self-test")) selfTest(runner);

  if (!runner.binary) {
    const r = absentReport(strict);
    for (const l of r.lines) console.log(l);
    process.exit(r.exit);
  }

  // One boundary around every step that touches the filesystem or spawns a process. An
  // unreadable examples directory, an unreadable bench or a spawn that throws is "could
  // not measure" — exit 2, red, named — never an uncaught stack that a caller reads as a
  // crash of unknown class.
  try {
    const mirrorsFile = resolve(optValue(argv, "--mirrors") ?? DEFAULT_MIRRORS);
    const examplesDir = resolve(optValue(argv, "--examples") ?? DEFAULT_EXAMPLES);
    const mirrors = readMirrors(mirrorsFile);
    const probes = probeBenches(runner, findBenches(examplesDir), examplesDir);
    const r = verdict({ mirrors, versionOut: runner.version().out, probes, strict });
    for (const l of r.lines) console.log(l);
    process.exit(r.exit);
  } catch (e) {
    console.error(`${C.red}COULD NOT MEASURE${C.off} — ${String((e as Error).message)}`);
    process.exit(2);
  }
}

// Last on purpose: the test file imports the pure functions above, and a module-level run
// would exit the test process before bun:test collected a single case.
if (import.meta.main) main();
