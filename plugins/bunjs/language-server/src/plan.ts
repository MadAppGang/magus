/**
 * What the wrapper will run, decided without side effects so the launcher's
 * check and the real run reach the same answer.
 */

import { adapterFor, type Env, type SharedPlan } from "./adapters.ts";

export type { Env, SharedPlan } from "./adapters.ts";

export const DEFAULT_IDLE_MINUTES = 10;
export const IDLE_ENV = "MAGUS_LSP_IDLE_MINUTES";
export const MIN_BUN_VERSION = "1.4.0";
/** The longest delay a timer holds (2^31 - 1 ms, about 24.8 days). */
export const MAX_IDLE_MS = 2_147_483_647;

export interface Plan {
	/** The command to start: shared when `shared` is set, else plain. */
	argv: string[];
	/** The plain command, used when a shared start falls back. */
	plainArgv: string[];
	shared: SharedPlan | null;
	/** 0 disables idle stop. */
	idleMs: number;
	notes: string[];
}

function versionParts(version: string): [number, number, number] | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `version` is at least MIN_BUN_VERSION. A prerelease of it counts. */
export function bunVersionSupported(version: string): boolean {
	const have = versionParts(version);
	const need = versionParts(MIN_BUN_VERSION) as [number, number, number];
	if (!have) return false;
	for (let i = 0; i < 3; i++) {
		const a = have[i] as number;
		const b = need[i] as number;
		if (a !== b) return a > b;
	}
	return true;
}

/** Minutes from the environment as milliseconds, or the default with a note. */
export function idleMsFrom(raw: string | undefined): { idleMs: number; note: string | null } {
	const fallback = DEFAULT_IDLE_MINUTES * 60_000;
	if (raw === undefined) return { idleMs: fallback, note: null };
	if (!/^(\d+(\.\d*)?|\.\d+)$/.test(raw)) {
		return {
			idleMs: fallback,
			note: `${IDLE_ENV}="${raw}" is not a decimal number of minutes ≥ 0; using ${DEFAULT_IDLE_MINUTES}`,
		};
	}
	// Only a written zero disables; a positive value too small for a double is invalid.
	if (/^0*\.?0*$/.test(raw)) return { idleMs: 0, note: null };
	const exactMs = Number(raw) * 60_000;
	if (!Number.isFinite(exactMs) || exactMs < 1 || exactMs > MAX_IDLE_MS) {
		return {
			idleMs: fallback,
			note: `${IDLE_ENV}="${raw}" is outside 1 ms to ${MAX_IDLE_MS} ms; using ${DEFAULT_IDLE_MINUTES}`,
		};
	}
	return { idleMs: Math.round(exactMs), note: null };
}

export function plan(argv: string[], env: Env, cwd: string, platform: string): Plan {
	const [command, ...configuredArgs] = argv;
	if (command === undefined || command === "") throw new Error("no server command given");
	const resolved = Bun.which(command, { PATH: env.PATH ?? "" });
	if (!resolved) throw new Error(`${command} not found on PATH`);

	const notes: string[] = [];
	const idle = idleMsFrom(env[IDLE_ENV]);
	if (idle.note) notes.push(idle.note);

	const plainArgv = [resolved, ...configuredArgs];
	const adapter = adapterFor(command);
	if (!adapter) return { argv: plainArgv, plainArgv, shared: null, idleMs: idle.idleMs, notes };

	const shared = adapter.share({ resolved, configuredArgs, env, cwd, platform });
	notes.push(...shared.notes);
	return { argv: shared.argv, plainArgv, shared: shared.shared, idleMs: idle.idleMs, notes };
}
