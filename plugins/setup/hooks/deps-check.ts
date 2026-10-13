#!/usr/bin/env bun
/**
 * SessionStart (matcher `startup`) — say loudly what this plugin needs and does
 * not have. `argv[2]` is the plugin's label; the registration passes it.
 *
 * Reads the plugin's own `.claude-plugin/plugin.json` through
 * lib/requires-probe.ts, probes each requirement at presence depth (a PATH
 * lookup for a check that runs the requirement's own binary, the declared check
 * for every other), and prints a `systemMessage` carrying the `magus-deps` marker when something is
 * missing or off PATH. Prints nothing when healthy. Its "Fix all" line runs
 * doctor with `--project <cwd>`, the session's directory from the hook input:
 * doctor reads the plugins enabled in the project it checks, and the banner is
 * read in a terminal that may be anywhere.
 *
 * THE LEDGER. Every copy writes `$TMPDIR/magus-deps-<session_id>/seen/<label>`
 * (`ts` here, `sh` from bun-missing.sh), then claims each dep it reports with an
 * atomic `mkdir claimed/<dedupeKey>`. A failed mkdir means another plugin's copy
 * reports that dep this session, so one dep is one banner line however many
 * plugins need it. An unreadable session id means no ledger and no claims:
 * more banners, never fewer. The ledger is 0700. Ledgers older than a day are
 * pruned on write, each on its own, so one this user cannot remove skips only
 * itself.
 *
 * Exit 0 always. A watchdog keeps the hook inside its registration timeout.
 */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Presence,
	applicable,
	currentPlatform,
	dedupeKey,
	onPath,
	parseRequires,
	probe,
	renderFix,
} from "./lib/requires-probe.js";

const WATCHDOG_MS = 8_000;
const CHECK_CAP_MS = 3_000;
const STDIN_MS = 1_000;
const LEDGER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_RE = /^[A-Za-z0-9_-]+$/;

const hasControlChar = (s: string): boolean =>
	[...s].some((c) => {
		const code = c.charCodeAt(0);
		return code < 0x20 || code === 0x7f;
	});

const quiet = (): never => process.exit(0);
setTimeout(quiet, WATCHDOG_MS).unref();
process.on("uncaughtException", quiet);
process.on("unhandledRejection", quiet);

interface HookInput {
	/** Null when unreadable: no ledger, so more banners, never fewer. */
	session: string | null;
	/** The directory the session runs in; null leaves `--project` off the fix. */
	cwd: string | null;
}

async function readHookInput(): Promise<HookInput> {
	const chunks: Buffer[] = [];
	const read = (async () => {
		for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	})();
	await Promise.race([read, new Promise((r) => setTimeout(r, STDIN_MS))]);
	try {
		const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			session_id?: unknown;
			cwd?: unknown;
		};
		const id = input.session_id;
		const cwd = input.cwd;
		return {
			session: typeof id === "string" && SESSION_RE.test(id) ? id : null,
			// A control character would break the banner line it is printed in.
			cwd:
				typeof cwd === "string" && isAbsolute(cwd) && !hasControlChar(cwd)
					? cwd
					: null,
		};
	} catch {
		return { session: null, cwd: null };
	}
}

/**
 * Remove ledgers older than a day. Each is tried on its own: a shared `/tmp`
 * holds other users' ledgers, which this user cannot remove, and one of those
 * must not stop this user's own from being pruned.
 */
function pruneOldLedgers(base: string): void {
	let entries: string[];
	try {
		entries = readdirSync(base);
	} catch {
		return; // Pruning is housekeeping; a failure costs nothing now.
	}
	for (const entry of entries) {
		if (!entry.startsWith("magus-deps-")) continue;
		const dir = join(base, entry);
		try {
			if (Date.now() - statSync(dir).mtimeMs > LEDGER_MAX_AGE_MS) {
				rmSync(dir, { recursive: true, force: true });
			}
		} catch {
			// Another user's, or already gone: the next entry is still pruned.
		}
	}
}

/**
 * The ledger directory, with `seen/<label>` written, or null without a session.
 * Created 0700: in a shared `/tmp`, no other user reads which plugins ran.
 */
function openLedger(hookSession: string | null, label: string): string | null {
	if (!hookSession) return null;
	const base = process.env.TMPDIR || tmpdir();
	const dir = join(base, `magus-deps-${hookSession}`);
	try {
		mkdirSync(join(dir, "seen"), { recursive: true, mode: 0o700 });
		mkdirSync(join(dir, "claimed"), { recursive: true, mode: 0o700 });
		writeFileSync(join(dir, "seen", label), "ts");
	} catch {
		return null;
	}
	pruneOldLedgers(base);
	return dir;
}

/** True when this copy is the one to report `key` this session. */
function claim(ledger: string | null, key: string): boolean {
	if (!ledger) return true;
	try {
		mkdirSync(join(ledger, "claimed", key));
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "EEXIST";
	}
}

function emit(systemMessage: string, additionalContext: string): void {
	process.stdout.write(
		`${JSON.stringify({
			systemMessage,
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext,
			},
		})}\n`,
	);
}

async function main(): Promise<void> {
	const label = process.argv[2] ?? "";
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(label)) return;
	const pluginRoot =
		process.env.CLAUDE_PLUGIN_ROOT ||
		dirname(dirname(fileURLToPath(import.meta.url)));
	const input = await readHookInput();
	const ledger = openLedger(input.session, label);

	const manifest = JSON.parse(
		readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
	) as unknown;
	const parsed = parseRequires(manifest);
	if (!parsed.ok) {
		if (claim(ledger, `invalid-${label}`)) {
			emit(
				`magus-deps · ${label}: requires is invalid (${parsed.errors.join("; ")}) — please report`,
				`${label}'s dependency declaration is invalid`,
			);
		}
		return;
	}
	const platform = currentPlatform();
	if (!platform) return;
	const reqs = applicable(parsed.requirements, platform.os);
	if (reqs.length === 0) return;

	const env = {
		pluginRoot,
		...platform,
		home: process.env.HOME || homedir(),
		path: process.env.PATH ?? "",
		capMs: CHECK_CAP_MS,
		depth: "presence" as const,
		userShell: process.env.SHELL ?? "",
	};
	const presences = await probe(reqs, env);
	const reportable = (p: Presence) =>
		p.status === "missing" || p.status === "off-path";
	if (!presences.some(reportable)) return;

	const byName = new Map(reqs.map((r) => [r.name, r]));
	const claimed = (p: Presence) => {
		const r = byName.get(p.name);
		return r !== undefined && claim(ledger, dedupeKey(r));
	};
	const findings = presences.filter((p) => reportable(p) && claimed(p));
	if (findings.length === 0) return;
	const slow = presences.filter((p) => p.status === "unknown" && claimed(p));
	const mine = [...findings, ...slow];
	const message = renderFix(
		label,
		mine,
		reqs,
		env,
		onPath("magus", env.path) !== null,
		input.cwd,
	);
	if (message === null) return;
	const failing = findings
		.map((p) => p.name)
		.sort()
		.join(", ");
	emit(
		message,
		`${label}'s MCP servers and hooks will fail until these are installed: ${failing}`,
	);
}

try {
	await main();
} catch {
	// A hook that cannot tell has nothing useful to print.
}
process.exit(0);
