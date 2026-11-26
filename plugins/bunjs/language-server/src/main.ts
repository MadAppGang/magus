#!/usr/bin/env bun
/**
 * The wrapper's entry point, started by bin/launch.sh.
 *
 *   main.ts --check <server> [args…]   decide whether the wrapper can run: exit 0 or 1
 *   main.ts <server> [args…]           relay between Claude Code and the server
 *
 * Every module is imported statically, so the check fails on a module that
 * does not load rather than the real run. The real run writes to stdout only
 * bytes read from the server; every note goes to stderr.
 */

import { adapterFor } from "./adapters.ts";
import { IdleTracker } from "./idle.ts";
import { bunVersionSupported, MIN_BUN_VERSION, type Plan, plan } from "./plan.ts";
import { Relay, systemDeps } from "./relay.ts";
import { worktreeRoot } from "./worktree.ts";

const CHECK_BUDGET_MS = 2_500;

function note(line: string): void {
	process.stderr.write(`lsp: ${line}\n`);
}

function describe(p: Plan): string {
	const idle = p.idleMs > 0 ? `idle stop after ${p.idleMs / 60_000} min` : "idle stop off";
	const mode = p.shared ? `shared (socket ${p.shared.socketPath})` : "plain";
	return `${p.plainArgv.join(" ")}: ${mode}, ${idle}`;
}

function currentPlan(argv: string[]): Plan {
	return plan(argv, process.env, process.cwd(), process.platform);
}

function check(argv: string[]): never {
	setTimeout(() => process.exit(1), CHECK_BUDGET_MS);
	// The modules the real run needs, touched so a broken one fails here.
	void [adapterFor, IdleTracker, Relay, worktreeRoot];
	if (!bunVersionSupported(Bun.version)) {
		note(`Bun ${Bun.version} is older than ${MIN_BUN_VERSION}`);
		process.exit(1);
	}
	try {
		const p = currentPlan(argv);
		for (const line of p.notes) note(line);
		note(describe(p));
	} catch (error) {
		note(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	process.exit(0);
}

function run(argv: string[]): void {
	let p: Plan;
	try {
		p = currentPlan(argv);
	} catch (error) {
		note(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	const relay = new Relay(p, systemDeps());
	process.on("SIGTERM", () => relay.signal(143));
	process.on("SIGINT", () => relay.signal(130));
	process.on("SIGHUP", () => relay.signal(129));
	process.on("uncaughtException", (error) => relay.internal(error));
	process.on("unhandledRejection", (error) => relay.internal(error));
	relay.run().then(
		(code) => process.exit(code),
		(error) => {
			note(`internal error: ${String(error)}`);
			process.exit(1);
		},
	);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args[0] === "--check") check(args.slice(1));
	else run(args);
}
