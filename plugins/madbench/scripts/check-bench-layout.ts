#!/usr/bin/env bun
/**
 * check-bench-layout — the bench layout standard, enforced by a script rather than a
 * paragraph.
 *
 * A layout rule written in English gets followed until the first bench that finds it
 * inconvenient; this repo carried TWO bench roots for a month with both documented in
 * CLAUDE.md, and one bench sitting outside `scripts/bench.ts`'s discovery path where
 * nobody ran it. Everything here is derived from the filesystem — there is no registry
 * to keep in step, because a committed mapping goes stale and a filesystem rule cannot.
 *
 * The five rules:
 *
 *   1  exactly one bench root — one top-level directory holding bench directories
 *   2  every directory under the root has a bench or Eval file (`madbench.yaml`,
 *      `<name>.madbench.yaml`, `<name>.eval.yaml`). Exempt BY NAME, never by guess:
 *      `lib/`, `results/`, `MADBENCH.md`, `README.md`, `.gitignore`
 *   3  every bench has a `README.md` whose frontmatter carries `id`, `question`,
 *      `status`, `last_run` (YYYY-MM-DD or `never`) and `binary`
 *   4  no loose TypeScript at a bench root. A `.ts` directly under `<root>/<bench>/` is
 *      allowed only when a check in that bench's own YAML names it as a `file://`
 *      target. Anything under `module/` or `lib/` is not at the root and is untouched.
 *      This is the mechanically decidable form of "arithmetic lives in `module/`".
 *   5  no alias key in any bench file — `runner:`, `cases:`, `assert:`, `fixture:`,
 *      `tests:`, `defaultCase:`, `matrix:` — at ANY depth. YAML keys only, never
 *      hand-written text: a sentence describing another tool's parameter sweep names
 *      that tool's feature, and a key scanner is the only thing that can tell the two
 *      apart. Hand-written text is check-dictionary.ts's job, not this one's.
 *
 * Two named escape hatches, both printed by --list, both narrower than an exemption:
 *
 *   CONVENTIONS  two filenames rule 4 accepts everywhere because they are staging or
 *                post-hoc work, not grading: `stage-setups.ts` and `archive-report.ts`.
 *                A `<stem>.test.ts` is accepted exactly when `<stem>.ts` is — it is the
 *                bun:test control over a grader, and a grader without one is the defect.
 *   DEBT         per-bench entries, each carrying its reason and what closes it. Every
 *                entry is a bench that predates the standard. The self-test proves an
 *                entry suppresses the file it names and nothing beside it.
 *
 *   bun plugins/madbench/scripts/check-bench-layout.ts               check the tree at cwd
 *   bun plugins/madbench/scripts/check-bench-layout.ts --repo <dir>  check another tree
 *   bun plugins/madbench/scripts/check-bench-layout.ts --self-test   prove every rule can fire
 *   bun plugins/madbench/scripts/check-bench-layout.ts --list        print rules, conventions, debt
 *
 * The tree is the CURRENT DIRECTORY by default, not the script's own location: the
 * madbench plugin ships this file, and `/madbench:doctor` runs it inside whichever
 * project the user is in. `--repo` exists for negative controls over a copied tree.
 *
 * Exit codes are three-valued, as in check-plugin-registration.ts:
 *
 *   0  every rule holds
 *   1  at least one finding
 *   2  could not measure — no bench root at all, or a bench file that does not parse as
 *      YAML. Reported RED. A run that measured nothing is not a pass; treating it as one
 *      rebuilds the blind spot the gate exists to close.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", off: "\x1b[0m" };

/** Bun's built-in YAML parser. Kept behind a narrow type so the plugin needs no dependency. */
const YAML = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML;

// ---------------------------------------------------------------------------
// the standard, as data
// ---------------------------------------------------------------------------

export const BENCH_FILE_RX = /^(madbench\.ya?ml|.+\.madbench\.ya?ml|.+\.eval\.ya?ml)$/;
const YAML_RX = /\.ya?ml$/;

/** Rule 2's exemptions. Names, not patterns — a guess is how `lib/` got flagged on day one. */
export const ROOT_EXEMPT_DIRS: ReadonlySet<string> = new Set(["lib", "results"]);
// `.gitignore` is NOT listed: `checkTree` already skips every dot entry before consulting
// this set (see the dot-entry `continue`), so a dot name here is unreachable and reads as
// load-bearing when it is not.
export const ROOT_EXEMPT_FILES: ReadonlySet<string> = new Set(["MADBENCH.md", "README.md"]);

export const REQUIRED_FRONTMATTER = ["id", "question", "status", "last_run", "binary"] as const;
const LAST_RUN_RX = /^(\d{4}-\d{2}-\d{2}|never)$/;

/** Rule 5. Every one of these still loads — that is exactly why a script has to catch them. */
export const ALIAS_KEYS: ReadonlySet<string> = new Set([
	"runner",
	"cases",
	"assert",
	"fixture",
	"tests",
	"defaultCase",
	"matrix",
]);

/** Top-level directories that are never a bench root, whatever they contain. */
const NEVER_A_ROOT: ReadonlySet<string> = new Set(["node_modules"]);

/**
 * Rule 4's conventions: filenames accepted at any bench root because the work they do is
 * not grading. One reason each, and the list is closed — a third name needs a reason
 * that is not "it was convenient".
 */
export const CONVENTIONS: ReadonlyMap<string, string> = new Map([
	[
		"stage-setups.ts",
		"staging program — builds the plugin trees and workspaces the Eval's `plugins:` names; " +
			"`scripts/bench.ts` discovers it by this exact name. Staging is not arithmetic.",
	],
	[
		"archive-report.ts",
		"post-hoc over `--report-json` into `results/` — the native-first table's own answer for a " +
			"cross-run statistic, since madbench's aggregation stops at the run by design.",
	],
]);

export type DebtEntry = {
	/** Bench directory name. */
	bench: string;
	/**
	 * A file directly under the bench. Omit to cover the bench as a whole: rule 2 (no bench
	 * file) and, for rule 4, every loose `.ts` in it — the shape a pre-port bench needs.
	 */
	file?: string;
	/** Which rules the entry suppresses for that target. */
	rules: readonly number[];
	/** One line: why this is correct today, and what closes the entry. */
	reason: string;
};

/**
 * Benches that predate the standard. Each entry is debt and says what retires it. Keep
 * this list as close to empty as the tree allows: the self-test proves an entry suppresses
 * only the file it names, but it cannot prove the reason is still true.
 */
export const DEBT: readonly DebtEntry[] = [
	{
		bench: "multimodel-model-staleness",
		file: "build-testdata.ts",
		rules: [4],
		reason:
			"MB-MMS renders testdata/ and madbench.yaml from scenarios.json — a `setup:`-shaped " +
			"program written before that key existed. Closed by declaring it under `setup:` and " +
			"committing the rendered bench, then deleting this entry.",
	},
	{
		bench: "multimodel-model-staleness",
		file: "build-instructions.ts",
		rules: [4],
		reason:
			"MB-MMS extracts the two instruction variants from the real skill files. Same closure " +
			"as build-testdata.ts.",
	},
	{
		bench: "review-contract",
		file: "verify-contract.ts",
		rules: [4],
		reason:
			"RVC-1's grader. The file:// target is grader/verify-contract.ts, a one-line shim that " +
			"re-exports this file, because madbench walks UP from a `ts` evaluator looking for " +
			"package.json and stops at the bench directory — an evaluator at the root would hash the " +
			"whole checkout. Closed by moving the grader body into grader/ and pointing the test at it.",
	},

	// The six entries below were all authored in a parallel worktree while this standard
	// was being written in this one, and landed via the merge that reconciled the two —
	// none is a regression introduced here. Each predates the standard by construction,
	// not by neglect.
	{
		bench: "advisor-reasoning",
		rules: [3, 4],
		reason:
			"ADV-2 was built and closed (found the bench cannot exist) in the same window this " +
			"standard's rule 3 and rule 4 were authored, on a sibling branch. Closed by adding " +
			"README frontmatter and moving grader.test.ts's logic into module/ or lib/.",
	},
	{
		bench: "advisor-value",
		rules: [3, 4],
		reason: "ADV-1, same window and same sibling branch as advisor-reasoning above. Same closure.",
	},
	{
		bench: "agent-model-routing",
		rules: [3],
		reason:
			"AMR-2 predates rule 3 by the same margin. Closed by adding the README frontmatter " +
			"block (id, question, status, last_run, binary).",
	},
	{
		bench: "code-search",
		rules: [3, 4],
		reason:
			"CS-1's native port on the sibling branch reached a materially different, more advanced " +
			"shape (default.madbench.yaml + facade.madbench.yaml, four Evals, runs/ overlays, a " +
			"standalone/ extraction kit) than the port built in this one, which is why the merge " +
			"took theirs wholesale rather than reconciling the two structures by hand. Its loose " +
			"`.ts` files are almost entirely `file://` graders and generators the layout standard " +
			"did not exist to route into module/ or lib/ when they were written. Closed by an " +
			"audit pass once CS-1's own active-development window settles.",
	},
	{
		bench: "subagent-handoff",
		rules: [3, 4],
		reason:
			"SH-1, same sibling-branch window as the entries above. Closed by adding README " +
			"frontmatter and moving verify-handoff.ts's logic into module/ or lib/.",
	},
	{
		bench: "subagent-skill-discovery",
		rules: [3, 4],
		reason:
			"SUB-1, same sibling-branch window. Three staging scripts (setup-decoys.ts, " +
			"stage-0.ts, stage-400.ts, stage-900.ts) are `setup:`-shaped programs, the same " +
			"pre-existing shape multimodel-model-staleness's entries above cover. Closed by " +
			"adding README frontmatter and declaring the staging scripts under `setup:`.",
	},
];

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

export type Finding = { rule: 1 | 2 | 3 | 4 | 5; path: string; message: string };
export type Unmeasurable = { path: string; message: string };
export type Report = {
	roots: string[];
	benches: string[];
	findings: Finding[];
	/** Non-empty means exit 2: something the check needed could not be read or parsed. */
	unmeasurable: Unmeasurable[];
};
export type Options = {
	debt?: readonly DebtEntry[];
	conventions?: ReadonlyMap<string, string>;
};

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

function entries(dir: string) {
	return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function hasBenchFile(dir: string): boolean {
	return entries(dir).some((e) => e.isFile() && BENCH_FILE_RX.test(e.name));
}

/**
 * A bench root is a top-level directory with at least one child directory that directly
 * holds a bench file. Depth is part of the definition: the madbench plugin's own skill
 * evals keep `madbench.yaml` files three levels down under plugins/, and those are
 * testdata for the skill, not benches of this repo.
 */
export function findRoots(repo: string): string[] {
	if (!isDir(repo)) return [];
	return entries(repo)
		.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !NEVER_A_ROOT.has(e.name))
		.filter((e) =>
			entries(join(repo, e.name)).some(
				(c) => c.isDirectory() && !c.name.startsWith(".") && hasBenchFile(join(repo, e.name, c.name)),
			),
		)
		.map((e) => e.name);
}

export type Frontmatter =
	| { kind: "none" }
	| { kind: "invalid"; error: string }
	| { kind: "ok"; data: Record<string, unknown> };

/**
 * The `---` block at the top of a markdown file, parsed as YAML.
 *
 * The closing delimiter is anchored to a WHOLE LINE. `indexOf("\n---")` matched any line
 * merely STARTING with three dashes, so a README whose frontmatter documented a horizontal
 * rule or a sub-document delimiter got its body truncated mid-value — surfacing as a YAML
 * parse error and rule 3 exiting 2 (unmeasurable) over a file that was fine.
 */
const FRONTMATTER_RX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function readFrontmatter(text: string): Frontmatter {
	const m = FRONTMATTER_RX.exec(text);
	if (m === null) return { kind: "none" };
	const body = m[1] ?? "";
	try {
		const data = YAML.parse(body);
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			return { kind: "invalid", error: "frontmatter is not a mapping" };
		}
		return { kind: "ok", data: data as Record<string, unknown> };
	} catch (e) {
		return { kind: "invalid", error: (e as Error).message.split("\n")[0] ?? "parse error" };
	}
}

/** Every mapping key at any depth whose name is an alias, as a dotted path. */
function aliasKeyPaths(node: unknown, path: string, out: string[]): void {
	if (Array.isArray(node)) {
		node.forEach((v, i) => aliasKeyPaths(v, `${path}[${i}]`, out));
		return;
	}
	if (node && typeof node === "object") {
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			const p = path ? `${path}.${k}` : k;
			if (ALIAS_KEYS.has(k)) out.push(p);
			aliasKeyPaths(v, p, out);
		}
	}
}

/** Every string value at any depth. */
function strings(node: unknown, out: string[]): void {
	if (typeof node === "string") out.push(node);
	else if (Array.isArray(node)) for (const v of node) strings(v, out);
	else if (node && typeof node === "object") for (const v of Object.values(node)) strings(v, out);
}

/**
 * Every string under a `checks:` key, at any depth — composites nest, so a `file://` target
 * can sit several levels down inside one.
 *
 * Rule 4 is documented as "allowed only when **a check** in that bench's own YAML names it
 * as a `file://` target", and it must collect only that. Collecting every string in every
 * sibling YAML meant an arbitrary key in an arbitrary file — `notes: ["file://./sneaky.ts"]`
 * in a scratch YAML — exempted a loose grader that nothing grades with. That is the escape
 * the rule exists to close, and it needed no reason, no DEBT entry and no review.
 */
function checkFileTargets(node: unknown, out: string[], insideChecks: boolean): void {
	if (Array.isArray(node)) {
		for (const v of node) checkFileTargets(v, out, insideChecks);
		return;
	}
	if (!node || typeof node !== "object") {
		if (insideChecks && typeof node === "string") out.push(node);
		return;
	}
	for (const [k, v] of Object.entries(node)) {
		if (k === "checks" || k === "assert") {
			// `assert:` is madbench's accepted alias for `checks:`. Rule 5 reports it as an
			// alias key; rule 4 still has to understand it, or narrowing rule 4 would make a
			// bench using the alias fail both rules for one mistake.
			const collected: string[] = [];
			strings(v, collected);
			out.push(...collected);
			continue;
		}
		checkFileTargets(v, out, insideChecks);
	}
}

export function checkTree(repo: string, opts: Options = {}): Report {
	const debt = opts.debt ?? DEBT;
	const conventions = opts.conventions ?? CONVENTIONS;
	const covered = (bench: string, file: string | undefined, rule: number) =>
		debt.some(
			(d) => d.bench === bench && (d.file === undefined || d.file === file) && d.rules.includes(rule),
		);

	const report: Report = { roots: findRoots(repo), benches: [], findings: [], unmeasurable: [] };
	const { roots, findings, unmeasurable } = report;

	if (roots.length === 0) {
		unmeasurable.push({
			path: repo,
			message:
				"no bench root: no top-level directory holds a directory with a bench file " +
				"(madbench.yaml, <name>.madbench.yaml or <name>.eval.yaml)",
		});
		return report;
	}
	if (roots.length > 1) {
		findings.push({
			rule: 1,
			path: roots.join(", "),
			message: `${roots.length} bench roots; the standard allows exactly one`,
		});
	}

	for (const root of roots) {
		const rootDir = join(repo, root);
		for (const e of entries(rootDir)) {
			// Dot entries are local state — `.madbench/` report dirs, `.gitignore` — and never a bench.
			if (e.name.startsWith(".")) continue;
			const rel = `${root}/${e.name}`;

			if (e.isFile()) {
				if (!ROOT_EXEMPT_FILES.has(e.name)) {
					findings.push({
						rule: 2,
						path: rel,
						message: "a loose file at the bench root; only MADBENCH.md, README.md and .gitignore live here",
					});
				}
				continue;
			}
			if (!e.isDirectory() || ROOT_EXEMPT_DIRS.has(e.name)) continue;

			const bench = e.name;
			const dir = join(rootDir, bench);
			report.benches.push(rel);

			// rule 2
			if (!hasBenchFile(dir) && !covered(bench, undefined, 2)) {
				findings.push({
					rule: 2,
					path: rel,
					message: "no bench file (madbench.yaml, <name>.madbench.yaml or <name>.eval.yaml)",
				});
			}

			// rule 3
			const readme = join(dir, "README.md");
			if (!existsSync(readme)) {
				findings.push({ rule: 3, path: `${rel}/README.md`, message: "missing" });
			} else {
				const fm = readFrontmatter(readFileSync(readme, "utf8"));
				if (fm.kind === "none") {
					findings.push({ rule: 3, path: `${rel}/README.md`, message: "no frontmatter" });
				} else if (fm.kind === "invalid") {
					findings.push({ rule: 3, path: `${rel}/README.md`, message: `frontmatter does not parse: ${fm.error}` });
				} else {
					const missing = REQUIRED_FRONTMATTER.filter((k) => {
						const v = fm.data[k];
						return v === undefined || v === null || String(v).trim() === "";
					});
					if (missing.length) {
						findings.push({
							rule: 3,
							path: `${rel}/README.md`,
							message: `frontmatter missing: ${missing.join(", ")}`,
						});
					}
					const lastRun = fm.data.last_run;
					if (lastRun !== undefined && !LAST_RUN_RX.test(String(lastRun instanceof Date ? lastRun.toISOString().slice(0, 10) : lastRun))) {
						findings.push({
							rule: 3,
							path: `${rel}/README.md`,
							message: `last_run must be YYYY-MM-DD or never (got ${JSON.stringify(lastRun)})`,
						});
					}
				}
			}

			// Rule 5 reads every YAML directly in the bench — probes and Evals included.
			// Rule 4's file:// targets come only from BENCH files (BENCH_FILE_RX) and only
			// from their `checks:` subtree: a check is what makes a .ts file load-bearing,
			// and a sibling scratch YAML is not a check.
			const fileTargets = new Set<string>();
			const files = entries(dir).filter((f) => f.isFile());
			for (const f of files) {
				if (!YAML_RX.test(f.name)) continue;
				const yamlPath = join(dir, f.name);
				let doc: unknown;
				try {
					doc = YAML.parse(readFileSync(yamlPath, "utf8"));
				} catch (err) {
					unmeasurable.push({
						path: `${rel}/${f.name}`,
						message: `does not parse as YAML: ${(err as Error).message.split("\n")[0]}`,
					});
					continue;
				}
				const aliases: string[] = [];
				aliasKeyPaths(doc, "", aliases);
				for (const p of aliases) {
					findings.push({ rule: 5, path: `${rel}/${f.name}`, message: `alias key at ${p}` });
				}
				if (!BENCH_FILE_RX.test(f.name)) continue;
				const values: string[] = [];
				checkFileTargets(doc, values, false);
				for (const v of values) {
					if (v.startsWith("file://")) fileTargets.add(resolve(dir, v.slice("file://".length)));
				}
			}

			// rule 4
			const allowed = (name: string) =>
				fileTargets.has(join(dir, name)) || conventions.has(name) || covered(bench, name, 4);
			for (const f of files) {
				if (!f.name.endsWith(".ts")) continue;
				if (allowed(f.name)) continue;
				if (f.name.endsWith(".test.ts") && allowed(`${f.name.slice(0, -".test.ts".length)}.ts`)) continue;
				findings.push({
					rule: 4,
					path: `${rel}/${f.name}`,
					message:
						"loose TypeScript at the bench root: not a file:// target of any check in this bench's " +
						"YAML, and not under module/ or lib/",
				});
			}
		}
	}

	return report;
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

/** rel path -> content. A path ending in `/` is an empty directory. */
type Tree = Record<string, string>;

const GOOD_README = [
	"---",
	"id: T-1",
	'question: "does it?"',
	"status: answered",
	"last_run: 2026-09-10",
	"binary: 0.33.0",
	"---",
	"# T-1",
	"",
].join("\n");

const GOOD_BENCH = [
	"description: t",
	"harness: mock",
	"scenarios:",
	"  - name: s",
	"    prompt: hi",
	"    checks:",
	"      - type: contains",
	"        value: hi",
	"",
].join("\n");

const BASE: Tree = { "benches/t/madbench.yaml": GOOD_BENCH, "benches/t/README.md": GOOD_README };

function materialise(tree: Tree): string {
	const dir = mkdtempSync(join(tmpdir(), "bench-layout-"));
	for (const [rel, content] of Object.entries(tree)) {
		const p = join(dir, rel);
		if (rel.endsWith("/")) {
			mkdirSync(p, { recursive: true });
		} else {
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, content);
		}
	}
	return dir;
}

type SelfTest = {
	id: string;
	title: string;
	why: string;
	/** Each must produce a finding for `rule` — or, when `unmeasurable`, an exit-2 entry. */
	positives: Tree[];
	rule?: number;
	unmeasurable?: boolean;
	/** Must be clean: no finding, nothing unmeasurable. Proves the exemption is real. */
	negative?: Tree;
	opts?: Options;
};

const NO_DEBT: Options = { debt: [], conventions: CONVENTIONS };

const SELF_TESTS: readonly SelfTest[] = [
	{
		id: "BL-01",
		title: "rule 1 — exactly one bench root",
		why: "benchmarks/ and benches/ coexisted for a month, both documented; the bench outside scripts/bench.ts's discovery path was never run.",
		rule: 1,
		positives: [{ ...BASE, "benchmarks/u/madbench.yaml": GOOD_BENCH, "benchmarks/u/README.md": GOOD_README }],
		negative: BASE,
		opts: NO_DEBT,
	},
	{
		id: "BL-02",
		title: "rule 2 — every root entry is a bench, or exempt by name",
		why: "benches/lib/ is shared TypeScript with no bench file. An unexempted rule 2 failed on day one against a directory that was correct, which is how gates get switched off.",
		rule: 2,
		positives: [
			{ ...BASE, "benches/orphan/notes.md": "# no bench file\n" },
			{ ...BASE, "benches/stray.md": "loose\n" },
		],
		negative: {
			...BASE,
			"benches/lib/pinned-tree.ts": "export const x = 1;\n",
			"benches/results/report.json": "{}\n",
			"benches/MADBENCH.md": "# generated\n",
			"benches/README.md": "# rules\n",
			"benches/.gitignore": "*.report.json\n",
		},
		opts: NO_DEBT,
	},
	{
		id: "BL-03",
		title: "rule 3 — README.md with id, question, status, last_run, binary",
		why: "MADBENCH.md is generated from this frontmatter; a bench without it has no row, and a last_run that is not a date cannot be sorted or compared.",
		rule: 3,
		positives: [
			{ "benches/t/madbench.yaml": GOOD_BENCH },
			{ ...BASE, "benches/t/README.md": "# T-1\n" },
			{ ...BASE, "benches/t/README.md": GOOD_README.replace("id: T-1\n", "") },
			{ ...BASE, "benches/t/README.md": GOOD_README.replace("2026-09-10", "yesterday") },
		],
		// CRLF line endings, and a body that carries a markdown horizontal rule. The closing
		// delimiter is anchored to a WHOLE line with either ending, so neither `\r\n` nor a
		// later `---` in the body can be mistaken for it. `indexOf("\n---")` matched any line
		// merely STARTING with three dashes, which is the shape that truncates a body mid-value
		// and reports a correct bench as rule-3 unmeasurable (exit 2).
		negative: {
			...BASE,
			"benches/t/README.md": `${GOOD_README.replace(/\n/g, "\r\n")}\r\nintro\r\n\r\n---\r\n\r\nmore\r\n`,
		},
		opts: NO_DEBT,
	},
	{
		id: "BL-04",
		title: "rule 4 — no loose TypeScript at a bench root",
		why: "The decidable form of 'arithmetic lives in module/'. A grader the YAML names by file:// passes; its .test.ts passes with it; module/ and lib/ are not the root; the two conventions are staging and post-hoc, not grading.",
		rule: 4,
		positives: [{ ...BASE, "benches/t/grade.ts": "export default () => 1;\n" }],
		negative: {
			...BASE,
			"benches/t/madbench.yaml": GOOD_BENCH.replace("type: contains\n        value: hi", "type: ts\n        value: file://./verify.ts"),
			"benches/t/verify.ts": "export default () => 1;\n",
			"benches/t/verify.test.ts": "import v from './verify.ts';\n",
			"benches/t/module/index.ts": "export const mean = (xs: number[]) => 0;\n",
			"benches/t/lib/helper.ts": "export const h = 1;\n",
			"benches/t/stage-setups.ts": "// staging\n",
			"benches/t/archive-report.ts": "// post-hoc\n",
		},
		opts: NO_DEBT,
	},
	{
		id: "BL-04b",
		title: "rule 4 — a file:// mention outside a check does NOT exempt a loose grader",
		why: "The rule is documented as 'a CHECK names it as a file:// target'. Collecting every string in every sibling YAML meant `notes: [file://./sneaky.ts]` in a scratch file exempted a grader nothing grades with — an escape needing no reason, no DEBT entry and no review. The negative proves the legitimate case still passes when the mention is nested inside a composite, where real targets live.",
		rule: 4,
		positives: [
			{
				...BASE,
				"benches/t/scratch.yaml": 'notes:\n  - "file://./sneaky.ts"\n',
				"benches/t/sneaky.ts": "export default () => 1;\n",
			},
			{
				// Same file, named by a NON-check key inside the bench file itself.
				...BASE,
				"benches/t/madbench.yaml": `${GOOD_BENCH}notes:\n  - "file://./sneaky.ts"\n`,
				"benches/t/sneaky.ts": "export default () => 1;\n",
			},
		],
		negative: {
			...BASE,
			"benches/t/madbench.yaml": GOOD_BENCH.replace(
				"      - type: contains\n        value: hi",
				"      - type: any-of\n        checks:\n          - type: ts\n            value: file://./verify.ts",
			),
			"benches/t/verify.ts": "export default () => 1;\n",
		},
		opts: NO_DEBT,
	},
	{
		id: "BL-05",
		title: "rule 5 — no alias key in any bench file, at any depth",
		why: "`madbench init` scaffolds runner:/cases:/assert:, all of which still load, so nothing but a key scan catches them. Nested `assert:` under a composite is the form that survived review three times.",
		rule: 5,
		positives: [
			{ ...BASE, "benches/t/madbench.yaml": GOOD_BENCH.replace("scenarios:", "cases:") },
			{ ...BASE, "benches/t/probe.yaml": GOOD_BENCH.replace("    checks:", "    checks:\n      - type: any-of\n        assert:\n          - type: contains\n            value: hi") },
		],
		negative: BASE,
		opts: NO_DEBT,
	},
	{
		id: "BL-06",
		title: "exit 2 — could not measure",
		why: "No root, or a bench file that does not parse, means the rules were never evaluated. Reporting that as a pass is the blind spot this gate exists to close.",
		unmeasurable: true,
		positives: [
			{ "benches/README.md": "# no benches yet\n" },
			{ ...BASE, "benches/t/madbench.yaml": "description: [unclosed\n" },
		],
		opts: NO_DEBT,
	},
	{
		id: "BL-07",
		title: "debt entries suppress the named file and nothing beside it",
		why: "An allowlist that suppresses more than it names is an exemption wearing a reason. The positive is the same bench with a second loose file the entry does not cover.",
		rule: 4,
		positives: [{ ...BASE, "benches/t/grade.ts": "//\n", "benches/t/other.ts": "//\n" }],
		negative: { ...BASE, "benches/t/grade.ts": "//\n" },
		opts: { debt: [{ bench: "t", file: "grade.ts", rules: [4], reason: "self-test" }], conventions: CONVENTIONS },
	},
	{
		id: "BL-08",
		title: "a bench-wide debt entry covers that bench and no other",
		why: "A pre-port bench carries a dozen loose files and no bench file; one entry names the bench. It must not leak to a sibling bench's loose file, or one entry silently exempts the root.",
		rule: 4,
		positives: [
			{
				...BASE,
				"benches/t/grade.ts": "//\n",
				"benches/u/madbench.yaml": GOOD_BENCH,
				"benches/u/README.md": GOOD_README,
				"benches/u/grade.ts": "//\n",
			},
		],
		// `t` has no bench file at all, so a sibling bench is what makes benches/ a root.
		negative: {
			"benches/t/README.md": GOOD_README,
			"benches/t/grade.ts": "//\n",
			"benches/t/score.ts": "//\n",
			"benches/t/probe.yaml": GOOD_BENCH,
			"benches/w/madbench.yaml": GOOD_BENCH,
			"benches/w/README.md": GOOD_README,
		},
		opts: { debt: [{ bench: "t", rules: [2, 4], reason: "self-test" }], conventions: CONVENTIONS },
	},
];

function selfTest(): never {
	let bad = 0;
	for (const t of SELF_TESTS) {
		const opts = t.opts ?? {};
		let fired = 0;
		let missed = 0;
		for (const tree of t.positives) {
			const dir = materialise(tree);
			const r = checkTree(dir, opts);
			rmSync(dir, { recursive: true, force: true });
			const hit = t.unmeasurable ? r.unmeasurable.length > 0 : r.findings.some((f) => f.rule === t.rule);
			if (hit) fired++;
			else missed++;
		}
		let leak = 0;
		if (t.negative) {
			const dir = materialise(t.negative);
			const r = checkTree(dir, opts);
			rmSync(dir, { recursive: true, force: true });
			leak = r.findings.length + r.unmeasurable.length;
			if (leak) {
				for (const f of r.findings) console.log(`      ${C.dim}leak: rule ${f.rule} ${f.path} — ${f.message}${C.off}`);
				for (const u of r.unmeasurable) console.log(`      ${C.dim}leak: unmeasurable ${u.path} — ${u.message}${C.off}`);
			}
		}
		if (missed) {
			bad++;
			console.log(`${C.red}FAIL${C.off}  ${t.id} did not fire on ${missed} of ${t.positives.length} positive tree(s) — ${t.title}`);
		} else if (leak) {
			bad++;
			console.log(`${C.red}FAIL${C.off}  ${t.id} fired ${leak}x on its exempt tree — ${t.title}`);
		} else {
			const exempt = t.negative ? ", exempt tree clean" : "";
			console.log(`${C.green}ok  ${C.off}  ${t.id} fired (${fired}/${t.positives.length})${exempt} — ${t.title}`);
		}
	}
	console.log(
		bad === 0
			? `\n${C.green}self-test OK${C.off} — all ${SELF_TESTS.length} rules can fail`
			: `\n${C.red}${bad} rule(s) cannot fail${C.off}`,
	);
	process.exit(bad === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

function wrap(s: string, indent = "      "): string {
	return s.replace(/\s+/g, " ").replace(/(.{92}) /g, `$1\n${indent}`);
}

function listRules(): never {
	console.log(`\n${SELF_TESTS.length} rules\n`);
	for (const t of SELF_TESTS) {
		console.log(`${t.id}  ${t.title}`);
		console.log(`      ${wrap(t.why)}\n`);
	}
	console.log(`conventions (rule 4)\n`);
	for (const [name, why] of CONVENTIONS) console.log(`  ${name}\n      ${wrap(why)}\n`);
	console.log(`debt (${DEBT.length})\n`);
	for (const d of DEBT) {
		console.log(`  ${d.bench}${d.file ? `/${d.file}` : ""}  rule ${d.rules.join(", ")}`);
		console.log(`      ${wrap(d.reason)}\n`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function run(): never {
	const i = argv.indexOf("--repo");
	const repo = resolve(i >= 0 ? (argv[i + 1] ?? ".") : ".");
	const r = checkTree(repo);

	if (r.findings.length === 0 && r.unmeasurable.length === 0) {
		const debtNote = DEBT.length ? ` ${C.dim}(${DEBT.length} debt entries — --list)${C.off}` : "";
		console.log(
			`${C.green}check-bench-layout: OK${C.off} — root ${r.roots[0]}/, ${r.benches.length} benches, 5 rules hold${debtNote}`,
		);
		process.exit(0);
	}

	if (r.findings.length) {
		console.error(`\n${C.red}BENCH LAYOUT${C.off} (${r.findings.length} finding(s))\n`);
		for (const f of r.findings) {
			console.error(`  rule ${f.rule}  ${f.path}`);
			console.error(`          ${C.dim}${f.message}${C.off}`);
		}
	}
	if (r.unmeasurable.length) {
		console.error(`\n${C.red}COULD NOT MEASURE${C.off} (${r.unmeasurable.length})\n`);
		for (const u of r.unmeasurable) {
			console.error(`  ${u.path}`);
			console.error(`          ${C.dim}${u.message}${C.off}`);
		}
		console.error(
			`\n  ${C.red}exit 2${C.off} — the rules were not evaluated over everything they should have been. ` +
				`${C.dim}Fix the input; a run that measured nothing is not a pass.${C.off}\n`,
		);
		process.exit(2);
	}
	console.error(
		`\n  ${r.findings.length} finding(s) over ${r.benches.length} bench(es) in ${r.roots.length} root(s). ` +
			`${C.dim}--list for the rules, conventions and debt.${C.off}\n`,
	);
	process.exit(1);
}

function main(): never {
	if (flag("--list")) return listRules();
	if (flag("--self-test")) return selfTest();
	return run();
}

// Last line on purpose: the module-level constants main() reaches through are not hoisted.
if (import.meta.main) main();
