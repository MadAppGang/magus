/**
 * SessionStart: warns when the official gopls-lsp or typescript-lsp plugin is
 * enabled beside this one.
 *
 * Claude Code gives each file extension to the first loaded plugin that
 * declares it and logs the others only to the debug log, so with both
 * installed this plugin may silently not run for Go or TypeScript files.
 * Reads enabledPlugins at user, project and local scope (later wins), names
 * each conflicting plugin with the command that removes it, and prints nothing
 * when there is none. Writes no file and always exits 0.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFLICTING = new Set(["gopls-lsp", "typescript-lsp"]);

type Scope = "user" | "project" | "local";

function enabledPlugins(file: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		const value = (parsed as { enabledPlugins?: unknown } | null)?.enabledPlugins;
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function projectDir(): Promise<string> {
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
		const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { cwd?: unknown };
		if (typeof input.cwd === "string" && input.cwd !== "") return input.cwd;
	} catch {
		// No input, or not JSON: the current directory is the project.
	}
	return process.cwd();
}

/** Each conflicting plugin id that ends up enabled, with the scope that decided it. */
export function conflicts(home: string, project: string): Array<{ id: string; scope: Scope }> {
	const files: Array<[Scope, string]> = [
		["user", join(home, ".claude", "settings.json")],
		["project", join(project, ".claude", "settings.json")],
		["local", join(project, ".claude", "settings.local.json")],
	];
	const decided = new Map<string, { value: boolean; scope: Scope }>();
	for (const [scope, file] of files) {
		for (const [id, value] of Object.entries(enabledPlugins(file))) {
			const name = id.split("@")[0] ?? "";
			if (!CONFLICTING.has(name) || typeof value !== "boolean") continue;
			decided.set(id, { value, scope });
		}
	}
	return [...decided].filter(([, d]) => d.value).map(([id, d]) => ({ id, scope: d.scope }));
}

async function main(): Promise<void> {
	const found = conflicts(process.env.HOME ?? "", await projectDir());
	if (found.length === 0) return;
	const lines = found.map((c) => `  claude plugin uninstall ${c.id} --scope ${c.scope}`);
	const names = found.map((c) => c.id).join(" and ");
	const message =
		`lsp: ${names} ${found.length === 1 ? "is" : "are"} also installed. Claude Code gives each file type to one ` +
		"language server plugin, so lsp may not run for Go or TypeScript files (no idle stop, no shared gopls). " +
		`Uninstall ${found.length === 1 ? "it" : "them"}, then restart Claude Code:\n${lines.join("\n")}`;
	process.stdout.write(
		`${JSON.stringify({
			systemMessage: message,
			hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
		})}\n`,
	);
}

if (import.meta.main) {
	main().catch(() => {}).finally(() => process.exit(0));
}
