/**
 * MadAppGang/magus#676 — statusline bars must be valid UTF-8 on Linux.
 *
 * GNU `tr` is byte-oriented, so a multibyte bar glyph pushed through it came out as a
 * lone lead byte and the terminal drew U+FFFD. The requirement: whatever `tr` is first on
 * PATH, the rendered status line decodes as strict UTF-8 and carries whole █ glyphs.
 *
 * GNU tr is simulated on macOS with a shim that runs the system tr under the C locale —
 * BSD tr is byte-oriented there, which reproduces the bug byte for byte.
 *
 * STATUSLINE_SCRIPT overrides the script under test (used for the negative control
 * against an older copy of statusline.sh). Written blind from the spec.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
const SCRIPT = process.env.STATUSLINE_SCRIPT ?? join(HERE, "statusline.sh");
const FIXTURES = join(HERE, "..", "test-fixtures.json");

type Fixture = {
	description?: string;
	expected_sections?: string[];
	env?: Record<string, string>;
	input: unknown;
};

const { fixtures } = (await Bun.file(FIXTURES).json()) as { fixtures: Fixture[] };

// The fixture whose expected sections include a rendered context bar.
const barFixture = fixtures.find((f) =>
	(f.expected_sections ?? []).some((s) => s.includes("█")),
);

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

let shimDir = "";
let home = "";

beforeAll(() => {
	shimDir = mkdtempSync(join(tmpdir(), "statusline-tr-shim-"));
	home = mkdtempSync(join(tmpdir(), "statusline-home-"));
	const tr = join(shimDir, "tr");
	writeFileSync(tr, '#!/bin/sh\nLC_ALL=C exec /usr/bin/tr "$@"\n');
	chmodSync(tr, 0o755);
});

afterAll(() => {
	rmSync(shimDir, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

function render(appearance: "light" | "dark", columns: number) {
	if (!barFixture) throw new Error("no fixture renders a context bar");
	const proc = Bun.spawnSync(["bash", SCRIPT], {
		stdin: Buffer.from(JSON.stringify(barFixture.input)),
		env: {
			PATH: `${shimDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
			HOME: home,
			TERM: process.env.TERM ?? "xterm-256color",
			LANG: "en_US.UTF-8",
			LC_CTYPE: "en_US.UTF-8",
			...(barFixture.env ?? {}),
			COLUMNS: String(columns),
			STATUSLINE_APPEARANCE: appearance,
		},
	});
	return proc;
}

describe("statusline.sh with a byte-oriented tr first on PATH (#676)", () => {
	test("precondition: the shim tr really is byte-oriented (splits █)", () => {
		const proc = Bun.spawnSync(
			[join(shimDir, "tr"), "x", "█"],
			{ stdin: Buffer.from("xxxx") },
		);
		const out = proc.stdout;
		let valid = true;
		try {
			new TextDecoder("utf-8", { fatal: true }).decode(out);
		} catch {
			valid = false;
		}
		// If the shim were multibyte-aware it could not reproduce the bug, and the
		// tests below would prove nothing.
		expect(valid && out.toString().includes("█")).toBe(false);
	});

	test("a fixture with a context bar exists", () => {
		expect(barFixture).toBeDefined();
	});

	for (const appearance of ["light", "dark"] as const) {
		for (const columns of [234, 100]) {
			const where = `${appearance}/${columns}`;

			test(`[${where}] exits 0 and renders something`, () => {
				const proc = render(appearance, columns);
				expect(proc.exitCode).toBe(0);
				expect(proc.stdout.length).toBeGreaterThan(0);
			});

			test(`[${where}] output decodes as strict UTF-8`, () => {
				const proc = render(appearance, columns);
				expect(() =>
					new TextDecoder("utf-8", { fatal: true }).decode(proc.stdout),
				).not.toThrow();
			});

			test(`[${where}] output contains whole █ glyphs and no U+FFFD`, () => {
				const proc = render(appearance, columns);
				const text = stripAnsi(new TextDecoder("utf-8").decode(proc.stdout));
				expect(text).toContain("█");
				expect(text).not.toContain("�");
			});
		}
	}
});
