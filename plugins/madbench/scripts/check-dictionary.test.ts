/**
 * The carve-out surface of the dictionary checker.
 *
 * A carve-out is an EXEMPTION, and an exemption bug fails OPEN: it makes the check pass.
 * So every case here comes in two halves — the carve-out honoured, and the same shape
 * WITHOUT the thing that earns it, still caught. A carve-out only ever proved on its
 * positive is indistinguishable from a scanner that gave up.
 *
 * Every sample document is written as a template literal on purpose: this test file is
 * itself in scope for the check it tests, and code written as code is carve-out 4.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEBT, DICTIONARY, checkTree, kindOf, scanDocument } from "./check-dictionary.ts";

const words = (text: string, kind: "md" | "code" = "md") => scanDocument(text, kind).map((h) => h.word);

// ---------------------------------------------------------------------------
// the six words
// ---------------------------------------------------------------------------

describe("the dictionary catches its own words", () => {
	for (const d of DICTIONARY) {
		test(`${d.word} — both forms, in prose, are caught`, () => {
			expect(words(`Every ${d.forms[0]} in this bench is ours.`)).toEqual([d.forms[0]!]);
			expect(words(`Both ${d.forms[1]} in this bench are ours.`)).toEqual([d.forms[1]!]);
		});
	}

	test("an unbanned word next to a banned one is not swept up", () => {
		expect(words(`This bench measures one run against another.`)).toEqual([]);
	});

	test("the match is case-insensitive and whole-word", () => {
		expect(words(`The Arm was slower.`)).toEqual(["arm"]);
		expect(words(`The alarm was slower.`)).toEqual([]);
		expect(words(`Disarmed and rounded.`)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// carve-out 1 — a fenced block quoting madbench output
// ---------------------------------------------------------------------------

/**
 * The fence delimiters, as constants: a sample document holding a literal fence cannot be
 * written as a template literal, and a double-quoted one would put the banned word into this
 * file's own prose — which the check would then catch, correctly.
 */
const TICKS = "`".repeat(3);
const TILDES = "~".repeat(3);

describe("carve-out 1 — a fenced block", () => {
	test("verbatim madbench output inside a fence is not flagged", () => {
		expect(words(`${TICKS}\n6 wrongly passed cells\n${TICKS}`)).toEqual([]);
		expect(words(`${TILDES}\n6 wrongly passed cells\n${TILDES}`)).toEqual([]);
	});

	test("an indented fence still opens and closes", () => {
		expect(words(`  ${TICKS}\n  one more arm\n  ${TICKS}`)).toEqual([]);
	});

	test("the SAME sentence outside the fence is caught", () => {
		expect(words(`6 wrongly passed cells`)).toEqual(["cells"]);
	});

	test("prose AFTER a closed fence is back in scope", () => {
		expect(words(`${TICKS}\ncells\n${TICKS}\n\nThe second arm was slower.`)).toEqual(["arm"]);
	});
});

// ---------------------------------------------------------------------------
// carve-out 2 — the alias literal
// ---------------------------------------------------------------------------

describe("carve-out 2 — the YAML alias a script names in order to reject it", () => {
	test("the quoted alias token in TypeScript is not flagged", () => {
		expect(words(`const ALIAS = ["fixture:", "matrix", 'cases'];`, "code")).toEqual([]);
	});

	test("the alias written as a YAML key is not flagged", () => {
		expect(words(`fixture: ./testdata/repo`, "code")).toEqual([]);
	});

	test("the same word as a noun in the same file IS flagged", () => {
		expect(words(`// the fixture directory is staged first`, "code")).toEqual(["fixture"]);
	});

	test("the alias carve-out does not reach markdown prose", () => {
		expect(words(`We keep the fixture directory beside the bench.`)).toEqual(["fixture"]);
	});
});

// ---------------------------------------------------------------------------
// carve-out 3 — the rows that define the ban
// ---------------------------------------------------------------------------

describe("carve-out 3 — the text that defines the ban", () => {
	test("a section under a heading naming the dictionary is skipped whole", () => {
		expect(words(`## The dictionary\n\nNever arm, never cell.`)).toEqual([]);
		expect(words(`### Banned words\n\n| arm | run |\n| cell | Check |`)).toEqual([]);
	});

	test("the skip ENDS at the next heading of the same or higher level", () => {
		expect(words(`## The dictionary\n\nNever arm.\n\n## Results\n\nThe second arm was slower.`)).toEqual(["arm"]);
	});

	test("a deeper heading inside the section does not end it", () => {
		expect(words(`## The dictionary\n\n### Why\n\nNobody says arm here.`)).toEqual([]);
	});

	test("a table row whose first column holds the bolded word is skipped", () => {
		expect(words(`| **arm** | run, strategy or variant |`)).toEqual([]);
	});

	test("a table row that merely MENTIONS the word is not skipped", () => {
		expect(words(`| **depth** | the second arm was slower |`)).toEqual(["arm"]);
	});

	test("the sentence form — quoted or bolded on a line that forbids it", () => {
		expect(words(`Say **testdata**, never "fixture".`)).toEqual([]);
		expect(words(`Say testdata instead of 'fixture'.`)).toEqual([]);
	});

	test("the sentence form does NOT swallow an unquoted use on the same line", () => {
		expect(words(`We never ran the second arm.`)).toEqual(["arm"]);
	});
});

// ---------------------------------------------------------------------------
// carve-out 4 — madbench's own identifiers
// ---------------------------------------------------------------------------

describe("carve-out 4 — identifiers", () => {
	test("a word joined into an identifier is not a standalone word", () => {
		expect(words(`export const cellOutcome = (controlCell: unknown) => controlCell;`, "code")).toEqual([]);
	});

	test("an inline code span is a literal, not vocabulary", () => {
		expect(words("The verdict comes from `controlCell.Outcome()`.")).toEqual([]);
		expect(words("The `cell` madbench prints is its own word.")).toEqual([]);
	});

	test("a member access and a call are identifiers", () => {
		expect(words(`export const pct = (x: number) => Math.round(x * 100);`, "code")).toEqual([]);
		expect(words(`return round(score);`, "code")).toEqual([]);
	});

	test("a namespaced check type is one identifier", () => {
		expect(words(`  - type: trajectory:step-count`, "code")).toEqual([]);
	});

	test("the same word as a bare noun in the same file IS flagged", () => {
		expect(words(`// the cell is graded before the run ends`, "code")).toEqual(["cell"]);
	});

	test("a markdown link target is not prose", () => {
		expect(words(`See [the report](./results/round-two.md) for the numbers.`)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// scope
// ---------------------------------------------------------------------------

describe("scope", () => {
	test("a markdown file reads as markdown, everything else as code", () => {
		expect(kindOf("benches/x/README.md")).toBe("md");
		expect(kindOf("benches/x/madbench.yaml")).toBe("code");
		expect(kindOf("benches/x/module/grade.ts")).toBe("code");
	});

	test("markdown structure is not applied to a YAML comment that looks like a heading", () => {
		// `# The dictionary` is a YAML comment, not a section that swallows the rest of the file.
		expect(words(`# The dictionary\nnote: the second arm was slower`, "code")).toEqual(["arm"]);
	});
});

// ---------------------------------------------------------------------------
// the tree walk, the ledger, and the three exit states
// ---------------------------------------------------------------------------

type Tree = Record<string, string>;

function materialise(tree: Tree): string {
	const dir = mkdtempSync(join(tmpdir(), "mb-dict-test-"));
	for (const [rel, body] of Object.entries(tree)) {
		const p = join(dir, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, body);
	}
	return dir;
}

function check(tree: Tree, opts: Parameters<typeof checkTree>[1] = {}) {
	const dir = materialise(tree);
	try {
		return checkTree(dir, opts);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("checkTree", () => {
	test("a hit names the file, the line and the word", () => {
		const r = check({ "benches/x/README.md": `intro\nEvery arm in this bench is ours.\n` });
		expect(r.hits).toHaveLength(1);
		expect(r.hits[0]).toMatchObject({ path: "benches/x/README.md", line: 2, word: "arm" });
	});

	test("staged and archived trees are never read", () => {
		const r = check({
			"benches/x/README.md": `This bench measures one run against another.\n`,
			"benches/x/results/2026-01-01.md": `cell\n`.repeat(21),
			"benches/x/testdata/repo/notes.md": `arm arm arm\n`,
			"benches/x/setups/new/tree/doc.md": `matrix of rounds\n`,
			"benches/x/generated/x.yaml": `fixture: yes\n`,
			"benches/x/node_modules/p/readme.md": `one more arm\n`,
			"benches/x/.reports/r.md": `one more arm\n`,
		});
		expect(r.hits).toEqual([]);
		expect(r.unmeasurable).toEqual([]);
	});

	test("a file outside the two scope roots is not read", () => {
		const r = check({ "benches/x/README.md": `clean\n`, "docs/plans/p.md": `one more arm\n` });
		expect(r.hits).toEqual([]);
	});

	test("an extension outside the scanned set is not read", () => {
		const r = check({ "benches/x/README.md": `clean\n`, "benches/x/notes.txt": `one more arm\n` });
		expect(r.hits).toEqual([]);
	});

	test("no scope directory at all is exit 2, never a pass", () => {
		const r = check({ "docs/readme.md": `# not a bench tree\n` });
		expect(r.hits).toEqual([]);
		expect(r.unmeasurable).toHaveLength(1);
	});

	test("a ledger entry suppresses its file up to the recorded count", () => {
		const tree = { "benches/x/README.md": `The first arm.\n` };
		const debt = [{ path: "benches/x/README.md", count: 1, reason: "test" }];
		const r = check(tree, { debt });
		expect(r.hits).toEqual([]);
		expect(r.ledgered).toHaveLength(1);
	});

	test("one hit MORE than the ledger records fires, and reports them all", () => {
		const r = check({ "benches/x/README.md": `The first arm.\nThe second arm.\n` }, {
			debt: [{ path: "benches/x/README.md", count: 1, reason: "test" }],
		});
		expect(r.hits).toHaveLength(2);
		expect(r.hits[0]!.text).toContain("ledgered at 1, now 2");
	});

	test("a ledger entry covers the file it names and no other", () => {
		const r = check(
			{ "benches/x/README.md": `The first arm.\n`, "benches/y/README.md": `The first arm.\n` },
			{ debt: [{ path: "benches/x/README.md", count: 1, reason: "test" }] },
		);
		expect(r.hits.map((h) => h.path)).toEqual(["benches/y/README.md"]);
	});
});

describe("the shipped ledger", () => {
	test("every entry names a distinct path and a positive count", () => {
		const paths = DEBT.map((d) => d.path);
		expect(new Set(paths).size).toBe(paths.length);
		for (const d of DEBT) expect(d.count).toBeGreaterThan(0);
	});

	test("every entry says what closes it", () => {
		for (const d of DEBT) expect(d.reason).toContain("Closed by");
	});
});
