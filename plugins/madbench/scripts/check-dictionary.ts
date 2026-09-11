#!/usr/bin/env bun
/**
 * check-dictionary — R-8's dictionary, enforced by a script rather than by intent.
 *
 * The madbench dictionary bans six words as OUR OWN nouns. Each is either another tool's
 * word, or madbench's own word for something narrower than the general sense we reach for.
 * The ban is written down in the skill; a written ban lasts until the first author who
 * finds it inconvenient, which is why this file exists.
 *
 * The six, with what to write instead — one line each, and the list below is the data the
 * scanner is built from, so the two cannot drift:
 *
 *   `arm`         say run, strategy, or variant — clinical-trial jargon, never ours
 *   `cell`        say Check or graded pair — `madbench check`'s own word, never general vocabulary
 *   `fixture`     say testdata — matches madbench's own key
 *   `trajectory`  say transcript or session
 *   `matrix`      say parameter sweep, or name `params:` directly
 *   `round`       say pass or run
 *
 * Scope: `.md`, `.yaml`, `.yml` and `.ts` under `plugins/madbench/` and `benches/`.
 * Skipped wholesale: `node_modules/`, `testdata/`, `setups/`, `results/`, `generated/`,
 * `.reports/` and every dot directory — staged inputs and archived output carry madbench's
 * own words verbatim and must never be rewritten to satisfy a style rule.
 *
 * EXACTLY FOUR CARVE-OUTS (R-8 lists four; a fifth would green-light text R-8 bans):
 *
 *   carve-out 1  a fenced block (``` or ~~~). Verbatim madbench output travels there.
 *   carve-out 2  the alias literal — a quoted token naming a YAML key madbench still
 *                accepts, e.g. the `fixture:` alias a script has to recognise in order
 *                to reject it.
 *   carve-out 3  the rows that DEFINE the ban: a section under a heading naming the
 *                dictionary, a table row whose first column holds the bolded word, and
 *                the sentence form of the same row — a line that says "never X" or
 *                "say Y instead of X" names the word in order to forbid it.
 *   carve-out 4  madbench's own identifiers. A word joined into an identifier
 *                (`controlCell`, `cellOutcome`) is not a standalone word and never
 *                matches; anything written as code — an inline span, a template
 *                literal — is a literal, not our vocabulary.
 *
 *   bun plugins/madbench/scripts/check-dictionary.ts               check the tree at cwd
 *   bun plugins/madbench/scripts/check-dictionary.ts --repo <dir>  check another tree
 *   bun plugins/madbench/scripts/check-dictionary.ts --self-test   prove every rule can fire
 *   bun plugins/madbench/scripts/check-dictionary.ts --list        print the words, the
 *                                                                  carve-outs and the debt
 *
 * The tree is the CURRENT DIRECTORY by default, not the script's own location: the plugin
 * ships this file and it runs inside whichever project the user is in. `--repo` exists for
 * negative controls over a copied tree.
 *
 * Exit codes are three-valued, as in check-bench-layout.ts:
 *
 *   0  no hit outside a carve-out, and no ledgered file has grown
 *   1  at least one hit
 *   2  could not measure — neither scope directory exists, or a file could not be read.
 *      Reported RED. A run that measured nothing is not a pass.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const C = { red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m", off: "\x1b[0m" };

// ---------------------------------------------------------------------------
// the dictionary, as data
// ---------------------------------------------------------------------------

export type Word = {
	/** The banned singular. */
	word: string;
	/** Every surface form the scanner matches, singular and plural. */
	forms: readonly string[];
	/** What to write instead. */
	say: string;
};

/**
 * One line per word: each line names the word and what to say instead, so each is itself an
 * instance of carve-out 3's sentence form and this file passes its own check.
 */
export const DICTIONARY: readonly Word[] = [
	{ word: "arm", forms: ["arm", "arms"], say: "never this; say run, strategy or variant" },
	{ word: "cell", forms: ["cell", "cells"], say: "never this; say Check or graded pair" },
	{ word: "fixture", forms: ["fixture", "fixtures"], say: "never this; say testdata" },
	{ word: "trajectory", forms: ["trajectory", "trajectories"], say: "never this; say transcript or session" },
	{ word: "matrix", forms: ["matrix", "matrices"], say: "never this; say parameter sweep" },
	{ word: "round", forms: ["round", "rounds"], say: "never this; say pass or run" },
];

/**
 * Built from DICTIONARY, never written as a literal: a hand-written alternation is a second
 * copy of the list, and the copy is what goes stale.
 */
export const bannedRe = (): RegExp =>
	new RegExp(`\\b(${DICTIONARY.flatMap((d) => d.forms).join("|")})\\b`, "gi");

/** Extensions in scope. Everything else is data or binary and is not our writing. */
export const SCANNED_EXTENSIONS: readonly string[] = [".md", ".yaml", ".yml", ".ts"];

/**
 * Directories skipped wholesale. `testdata/`, `setups/`, `results/`, `generated/` and
 * `.reports/` hold staged inputs and archived output — madbench's words, verbatim, and
 * rewriting them would corrupt the measurement they record.
 */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
	"node_modules",
	"testdata",
	"setups",
	"results",
	"generated",
]);

/** The two scope roots, relative to the tree under check. */
export const SCOPE_ROOTS: readonly string[] = ["plugins/madbench", "benches"];

export type DebtEntry = {
	/** Tree-relative path of one file. */
	path: string;
	/** How many hits that file carried when the ledger was written. */
	count: number;
	/** Why it is correct today, and what closes the entry. */
	reason: string;
};

/**
 * Files that predate the dictionary, none of them authored by the madbench toolkit work.
 * A ledger entry freezes a file's hit COUNT: the file is suppressed at that number and any
 * NEW hit in it is reported. An entry that suppressed a file outright would let a bench
 * accumulate the vocabulary the check exists to stop.
 */
export const DEBT: readonly DebtEntry[] = [
	{
		path: "benches/agent-capability/README.md",
		count: 11,
		reason:
			"pre-dictionary text: cell, cells, matrix. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/agent-capability/agent-capability.eval.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell, matrix. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/agent-capability/agent-probe.madbench.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/agent-capability/lib/png.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/agent-capability/madbench.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/agent-capability/stage-setups.ts",
		count: 6,
		reason:
			"pre-dictionary text: cells, round. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/claudish-agent-routing/README.md",
		count: 5,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/claudish-agent-routing/claudish-agent-routing.eval.yaml",
		count: 1,
		reason:
			"pre-dictionary text: matrix. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/claudish-agent-routing/madbench.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/README.md",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/UPSTREAM-madbench-behavioural-metrics.md",
		count: 1,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/madbench.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/stage-setups.ts",
		count: 1,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/verify-transition.test.ts",
		count: 2,
		reason:
			"pre-dictionary text: cell, fixtures. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-plan-mode/verify-transition.ts",
		count: 5,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-resume-after-clear/README.md",
		count: 8,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-resume-after-clear/archive-report.ts",
		count: 4,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-resume-after-clear/verify-resume.ts",
		count: 1,
		reason:
			"pre-dictionary text: fixtures. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/README.md",
		count: 9,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/archive-report.ts",
		count: 5,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/dev-status.eval.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/grade-status.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/madbench.yaml",
		count: 5,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/plumbing-probe.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/dev-status/stage-setups.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/README.md",
		count: 29,
		reason:
			"pre-dictionary text: cell, cells, matrix, trajectory. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/check-probe.madbench.yaml",
		count: 4,
		reason:
			"pre-dictionary text: cell, cells, trajectory. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/consequence-probe.madbench.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/depth-probe.madbench.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/fenced-probe.madbench.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/icomp3-phase1.eval.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/icomp4.eval.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells, matrix. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/icomp4.madbench.yaml",
		count: 9,
		reason:
			"pre-dictionary text: cell, cells, matrix. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/inventory-probe.madbench.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/madbench.yaml",
		count: 6,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/r3-screen.madbench.yaml",
		count: 4,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/slash-depth-probe.madbench.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/slash-probe.madbench.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/index-composition/stage-setups.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/lib/audit-leak.ts",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/lib/check-no-leak.ts",
		count: 2,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/model-selection/README.md",
		count: 6,
		reason:
			"pre-dictionary text: cell, cells, matrix, rounds. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/model-selection/madbench.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/model-selection/model-selection.eval.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/model-selection/stage-setups.ts",
		count: 3,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/multimodel-model-staleness/README.md",
		count: 1,
		reason:
			"pre-dictionary text: trajectory. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/multimodel-model-staleness/build-testdata.ts",
		count: 1,
		reason:
			"pre-dictionary text: trajectory. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/plugin-manifest/stage-setups.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/review-contract/README.md",
		count: 4,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/review-contract/agent-probe.yaml",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/review-contract/grader/verify-contract.ts",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/review-contract/madbench.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/review-contract/verify-contract.ts",
		count: 2,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-index/README.md",
		count: 9,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-index/instrument-probe.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-index/madbench.yaml",
		count: 10,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-router/README.md",
		count: 2,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-router/instrument-probe.yaml",
		count: 1,
		reason:
			"pre-dictionary text: cell. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-router/madbench.yaml",
		count: 3,
		reason:
			"pre-dictionary text: cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-vs-agent/README.md",
		count: 15,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	{
		path: "benches/skill-vs-agent/madbench.yaml",
		count: 17,
		reason:
			"pre-dictionary text: cell, cells. Closed by rewriting this file's wording — say Check or " +
			"graded pair, testdata, transcript, parameter sweep, pass, strategy — and deleting this entry.",
	},
	// The twenty entries below all landed in the same merge, none authored by the
	// madbench toolkit work: a parallel worktree kept developing several benches while this
	// gate did not exist there yet.
	{
		path: "benches/advisor-value/archive-report.ts",
		count: 5,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/advisor-reasoning/archive-report.ts",
		count: 5,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/README.md",
		count: 4,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/shape.test.ts",
		count: 4,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/agent-model-routing/archive-report.ts",
		count: 4,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/subagent-skill-discovery/archive-report.ts",
		count: 3,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/composite.test.ts",
		count: 3,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/advisor-value/README.md",
		count: 3,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/advisor-value/madbench.yaml",
		count: 3,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/subagent-skill-discovery/madbench.yaml",
		count: 2,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/subagent-skill-discovery/README.md",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/subagent-handoff/subagent-handoff.eval.yaml",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/subagent-handoff/grader/verify-handoff.ts",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/standalone/EXTRACT.md",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/README.md",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/generate.test.ts",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/engines.ts",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/code-search/engines.test.ts",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/agent-model-routing/agent-model-routing.eval.yaml",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
	{
		path: "benches/advisor-value/advisor-value.eval.yaml",
		count: 1,
		reason:
			"authored on a sibling branch while this dictionary gate was being built in this one, and landed via the merge that reconciled the two. Closed by rewriting the file's wording (Check/graded pair, testdata, parameter sweep, pass, run, strategy or variant) and deleting this entry.",
	},
];

// ---------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------

export type Hit = { path: string; line: number; word: string; text: string };
export type Unmeasurable = { path: string; message: string };
export type Report = {
	files: number;
	hits: Hit[];
	/** Hits inside a ledgered file, up to its recorded count. Reported, never fatal. */
	ledgered: Hit[];
	unmeasurable: Unmeasurable[];
};

/** How a document is read: markdown structure, or source with backticks and quoted tokens. */
export type Kind = "md" | "code";

export function kindOf(path: string): Kind {
	return path.endsWith(".md") ? "md" : "code";
}

/** carve-out 3, sentence form: a line that names the word in order to forbid it. */
const DEFINES_THE_BAN = /\b(never|banned|instead of|say)\b/i;

/** carve-out 3, table form: a row whose first column holds the bolded word. */
const bannedTableRowRe = (): RegExp =>
	new RegExp(`^\\s*\\|\\s*\\*\\*(${DICTIONARY.flatMap((d) => d.forms).join("|")})\\*\\*\\s*\\|`, "i");

/** carve-out 2: a quoted token that is exactly a banned word, optionally a YAML key. */
const aliasLiteralRe = (): RegExp =>
	new RegExp(`(["'])(${DICTIONARY.flatMap((d) => d.forms).join("|")}):?\\1`, "gi");

/**
 * carve-outs 2 and 4 in their native form inside a `.yaml` or `.ts` file, where madbench's
 * own names are not written as code spans because the file IS code:
 *
 *   `trajectory:step-count`  a check type — one namespaced identifier, not our noun
 *   `fixture: ./testdata`    the accepted YAML alias, named as a key (carve-out 2)
 *   `Math.round(x)`          a member access — an identifier, not our noun
 *   `round(x)`               a call
 *
 * All three shapes are decided by the character next to the word, never by what the line
 * appears to be about: a rule that guessed at intent would be the fifth carve-out.
 */
const identifierContextRe = (): RegExp => {
	const forms = DICTIONARY.flatMap((d) => d.forms).join("|");
	return new RegExp(`\\.\\s*(${forms})\\b|\\b(${forms})\\s*[:(]`, "gi");
};

/**
 * Scan one document and report what survives all four carve-outs.
 *
 * The masking order matters: fences first (they swallow whole regions), then the
 * structural carve-outs, then the in-line ones. A word is only ever reported from prose
 * that no carve-out claimed.
 */
export function scanDocument(text: string, kind: Kind): { line: number; word: string; text: string }[] {
	const lines = text.split("\n");
	const re = bannedRe();
	const tableRow = bannedTableRowRe();
	const alias = aliasLiteralRe();
	const identifier = identifierContextRe();
	const out: { line: number; word: string; text: string }[] = [];

	let inFence = false;
	let skipSectionDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";

		if (/^\s*(```|~~~)/.test(raw)) {
			inFence = !inFence; // carve-out 1
			continue;
		}
		if (inFence) continue;

		if (kind === "md") {
			const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
			if (heading) {
				const depth = (heading[1] ?? "").length;
				if (/\b(dictionar|vocabular|banned|forbidden word|word list)/i.test(heading[2] ?? "")) {
					skipSectionDepth = depth; // carve-out 3, section form
					continue;
				}
				if (skipSectionDepth && depth <= skipSectionDepth) skipSectionDepth = 0;
			}
			if (skipSectionDepth) continue;
			if (tableRow.test(raw)) continue; // carve-out 3, table form
		}

		// carve-out 4: anything written as code is a literal, not our vocabulary. An inline
		// span in markdown and a template literal in TypeScript are the same thing here.
		let prose = (raw as string).replace(/`[^`]*`/g, " ").replace(/\]\([^)]*\)/g, "] ");
		// carve-out 2: the alias literal a script names in order to reject it.
		alias.lastIndex = 0;
		prose = prose.replace(alias, " ");
		// carve-outs 2 and 4 as a source file writes them: a key, a namespaced check type,
		// a member access, a call.
		if (kind === "code") {
			identifier.lastIndex = 0;
			prose = prose.replace(identifier, " ");
		}
		// carve-out 3, sentence form: the quoted or bolded word on a line that forbids it.
		if (DEFINES_THE_BAN.test(raw)) prose = prose.replace(/"[^"]*"|\*\*[^*]*\*\*|'[^']*'/g, " ");

		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(prose)) !== null) {
			out.push({ line: i + 1, word: (m[0] ?? "").toLowerCase(), text: raw.trim() });
		}
	}
	return out;
}

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Every in-scope file under one directory, tree-relative, sorted. */
export function collectFiles(repo: string, root: string, out: string[]): void {
	const abs = join(repo, root);
	if (!isDir(abs)) return;
	for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (e.name.startsWith(".")) continue;
		const rel = `${root}/${e.name}`;
		if (e.isDirectory()) {
			if (SKIPPED_DIRS.has(e.name)) continue;
			collectFiles(repo, rel, out);
			continue;
		}
		if (!e.isFile()) continue;
		if (!SCANNED_EXTENSIONS.some((x) => e.name.endsWith(x))) continue;
		out.push(rel);
	}
}

export type Options = { debt?: readonly DebtEntry[] };

export function checkTree(repo: string, opts: Options = {}): Report {
	const debt = opts.debt ?? DEBT;
	const report: Report = { files: 0, hits: [], ledgered: [], unmeasurable: [] };

	const present = SCOPE_ROOTS.filter((r) => isDir(join(repo, r)));
	if (present.length === 0) {
		report.unmeasurable.push({
			path: repo,
			message: `no scope directory: none of ${SCOPE_ROOTS.join(", ")} exists, so nothing was read`,
		});
		return report;
	}

	const files: string[] = [];
	for (const root of present) collectFiles(repo, root, files);

	for (const rel of files) {
		let text: string;
		try {
			text = readFileSync(join(repo, rel), "utf8");
		} catch (e) {
			report.unmeasurable.push({ path: rel, message: `could not read: ${(e as Error).message}` });
			continue;
		}
		report.files++;
		const found = scanDocument(text, kindOf(rel)).map((f) => ({ path: rel, ...f }));
		if (found.length === 0) continue;
		const entry = debt.find((d) => d.path === rel);
		if (entry && found.length <= entry.count) {
			report.ledgered.push(...found);
			continue;
		}
		if (entry) {
			report.hits.push(
				...found.map((f) => ({
					...f,
					text: `${f.text}   ${C.dim}[ledgered at ${entry.count}, now ${found.length}]${C.off}`,
				})),
			);
			continue;
		}
		report.hits.push(...found);
	}

	return report;
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

/** rel path -> content. */
type Tree = Record<string, string>;

function materialise(tree: Tree): string {
	const dir = mkdtempSync(join(tmpdir(), "mb-dictionary-"));
	for (const [rel, content] of Object.entries(tree)) {
		const p = join(dir, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
	}
	return dir;
}

type SelfTest = {
	id: string;
	title: string;
	why: string;
	/** Each must produce at least one hit — or, when `unmeasurable`, an exit-2 entry. */
	positives: Tree[];
	unmeasurable?: boolean;
	/** Must be clean. Proves the carve-out is real and not a blanket. */
	negative?: Tree;
	opts?: Options;
};

const SELF_TESTS: readonly SelfTest[] = [
	...DICTIONARY.map((d) => ({
		id: `DW-${d.word}`,
		title: `${d.word} is caught as our own noun`,
		why: `${d.word}: ${d.say}. A word nobody has seen the check catch is a word the check does not catch.`,
		positives: [
			{ "benches/x/README.md": `Every ${d.forms[0]} in this bench is ours.\n` },
			{ "benches/x/README.md": `Both ${d.forms[1]} in this bench are ours.\n` },
		],
		negative: { "benches/x/README.md": `This bench measures one run against another.\n` },
	})),
	{
		id: "DX-1",
		title: "carve-out 1 — a fenced block quoting madbench output verbatim",
		why: "`madbench check` prints its own word for a graded pair. Rewriting captured output to satisfy a style rule corrupts the record it is.",
		positives: [{ "benches/x/README.md": `Six were wrongly passed cells.\nEvery run has one.\n` }],
		negative: { "benches/x/README.md": "```\n6 wrongly passed cells\n```\n" },
	},
	{
		id: "DX-2",
		title: "carve-out 2 — the alias literal a script names in order to reject it",
		why: "check-bench-layout has to hold the accepted YAML alias as a string in order to report it. A checker that cannot name what it bans cannot ban it.",
		positives: [{ "benches/x/stage-setups.ts": `// the fixture directory is staged first\n` }],
		negative: {
			"benches/x/stage-setups.ts": `const ALIAS = ["fixture:", "matrix"];\n`,
			"benches/x/probe.yaml": `fixture: ./testdata/repo\nchecks:\n  - type: trajectory:step-count\n`,
			"benches/x/module/score.ts": `export const pct = (x: number) => Math.round(x * 100);\n`,
		},
	},
	{
		id: "DX-3",
		title: "carve-out 3 — the rows that define the ban",
		why: "A checker that flags the document defining its own rule is one authors switch off. Three forms: a section under a heading naming the dictionary, a table row whose first column holds the bolded word, and the sentence that forbids it.",
		positives: [{ "benches/x/README.md": `## Results\n\nThe second arm was slower.\n` }],
		negative: {
			"benches/x/README.md":
				`## The dictionary\n\n| word | say instead |\n|---|---|\n| arm | run |\n| cell | Check |\n\n` +
				`## Elsewhere\n\n| **arm** | never this; say run |\n\n` +
				`Say **testdata**, never "fixture".\n`,
		},
	},
	{
		id: "DX-4",
		title: "carve-out 4 — madbench's own identifiers",
		why: "A word joined into an identifier is not a standalone word, and code written as code is a literal. `controlCell.Outcome()` is madbench's API, not our vocabulary.",
		positives: [{ "benches/x/README.md": `The verdict comes from the cell outcome.\n` }],
		negative: {
			"benches/x/README.md": "The verdict comes from `controlCell.Outcome()`.\n",
			"benches/x/module/grade.ts": `export const cellOutcome = (controlCell: unknown) => controlCell;\n`,
		},
	},
	{
		id: "DX-5",
		title: "scope — staged and archived trees are never rewritten",
		why: "testdata/, setups/, results/, generated/ and .reports/ carry madbench's own output and other projects' text verbatim. A style rule reaching into them changes what was measured.",
		positives: [{ "benches/x/README.md": `One more arm.\n` }],
		negative: {
			"benches/x/results/2026-01-01.md": `cell\n`.repeat(21),
			"benches/x/testdata/repo/notes.md": `arm arm arm\n`,
			"benches/x/setups/new/tree/doc.md": `matrix of rounds\n`,
			"benches/x/generated/x.yaml": `fixture: yes\n`,
			"benches/x/README.md": `This bench measures one run against another.\n`,
		},
	},
	{
		id: "DX-6",
		title: "a ledger entry freezes a count and fires on the next hit",
		why: "An entry that suppressed a file outright would let a bench accumulate the vocabulary the check exists to stop. The positive is the same file with one hit more than the ledger records.",
		positives: [{ "benches/x/README.md": `The first arm.\nThe second arm.\n` }],
		negative: { "benches/x/README.md": `The first arm.\n` },
		opts: { debt: [{ path: "benches/x/README.md", count: 1, reason: "self-test" }] },
	},
	{
		id: "DX-7",
		title: "exit 2 — could not measure",
		why: "Neither scope directory present means nothing was read. Reporting that as a pass is the blind spot the gate exists to close.",
		unmeasurable: true,
		positives: [{ "docs/readme.md": "# not a bench tree\n" }],
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
			const hit = t.unmeasurable ? r.unmeasurable.length > 0 : r.hits.length > 0;
			if (hit) fired++;
			else missed++;
		}
		let leak = 0;
		if (t.negative) {
			const dir = materialise(t.negative);
			const r = checkTree(dir, opts);
			rmSync(dir, { recursive: true, force: true });
			leak = r.hits.length + r.unmeasurable.length;
			for (const h of r.hits) console.log(`      ${C.dim}leak: ${h.path}:${h.line} ${h.word} — ${h.text}${C.off}`);
			for (const u of r.unmeasurable) console.log(`      ${C.dim}leak: unmeasurable ${u.path} — ${u.message}${C.off}`);
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
			? `\n${C.green}self-test OK${C.off} — ${DICTIONARY.length} words and 4 carve-outs, all demonstrated`
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
	console.log(`\n${DICTIONARY.length} words\n`);
	for (const d of DICTIONARY) console.log(`  ${d.word.padEnd(12)}${d.say}`);
	console.log(`\n${SELF_TESTS.length} self-test rules\n`);
	for (const t of SELF_TESTS) {
		console.log(`${t.id}  ${t.title}`);
		console.log(`      ${wrap(t.why)}\n`);
	}
	console.log(`debt (${DEBT.length})\n`);
	for (const d of DEBT) {
		console.log(`  ${d.path}  ${d.count} hit(s)`);
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

	if (r.unmeasurable.length) {
		console.error(`\n${C.red}COULD NOT MEASURE${C.off} (${r.unmeasurable.length})\n`);
		for (const u of r.unmeasurable) console.error(`  ${u.path}\n          ${C.dim}${u.message}${C.off}`);
		console.error(
			`\n  ${C.red}exit 2${C.off} — the dictionary was not applied to everything it should have been. ` +
				`${C.dim}Fix the input; a run that measured nothing is not a pass.${C.off}\n`,
		);
		process.exit(2);
	}

	if (r.hits.length === 0) {
		const note = r.ledgered.length ? ` ${C.dim}(${r.ledgered.length} ledgered — --list)${C.off}` : "";
		console.log(
			`${C.green}check-dictionary: OK${C.off} — ${r.files} files, ${DICTIONARY.length} words, 4 carve-outs${note}`,
		);
		process.exit(0);
	}

	console.error(`\n${C.red}DICTIONARY${C.off} (${r.hits.length} hit(s))\n`);
	for (const h of r.hits) {
		console.error(`  ${h.path}:${h.line}  ${h.word}`);
		console.error(`          ${C.dim}${h.text}${C.off}`);
	}
	// Grouped by the DICTIONARY entry, not by the surface form: a reader who saw both
	// "cell" and "cells" listed would read one word as two.
	const seen = new Set(
		r.hits.map((h) => DICTIONARY.find((d) => d.forms.includes(h.word))?.word ?? h.word),
	);
	console.error("");
	for (const d of DICTIONARY) {
		if (seen.has(d.word)) console.error(`  ${d.word.padEnd(12)}${d.say}`);
	}
	console.error(
		`\n  ${r.hits.length} hit(s) in ${new Set(r.hits.map((h) => h.path)).size} file(s). ` +
			`${C.dim}--list for the words, the carve-outs and the debt.${C.off}\n`,
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
