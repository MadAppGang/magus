/**
 * SessionStart: warns when this plugin's language server cannot run as it should.
 *
 *   bun conflict-check.ts <label> <name>…
 *
 * Two findings, each printed only when it holds:
 *
 * - Another plugin serving the same file types is enabled. Each `name` is a
 *   plugin name (the part of an id before `@`, in any marketplace) that
 *   declares the same file extensions. Claude Code gives each file extension to
 *   the first loaded plugin that declares it and logs the others only to the
 *   debug log, so with both installed this plugin's language server may
 *   silently not run. enabledPlugins is read at user, project and local scope
 *   (later wins), and each conflicting plugin is named with the command that
 *   removes it.
 * - A language server binary this plugin launches is not on the PATH Claude
 *   Code started with. In each of the plugin's own `lspServers` entries the
 *   server is the first argument after the launcher when the command is `sh`,
 *   and the command itself otherwise; the plugin itself works, only code
 *   intelligence for those file types does not.
 *
 * `label` is the plugin running the check. With no label and name it prints
 * nothing. Writes no file and always exits 0.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Scope = "user" | "project" | "local";

/** How each language server a plugin here launches is installed. */
const INSTALL: Record<string, string> = {
	gopls: "go install golang.org/x/tools/gopls@latest",
	"typescript-language-server": "npm install -g typescript-language-server typescript",
};

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

/** Each plugin id named in `conflicting` that ends up enabled, with the scope that decided it. */
export function conflicts(
	home: string,
	project: string,
	conflicting: ReadonlySet<string>,
): Array<{ id: string; scope: Scope }> {
	const files: Array<[Scope, string]> = [
		["user", join(home, ".claude", "settings.json")],
		["project", join(project, ".claude", "settings.json")],
		["local", join(project, ".claude", "settings.local.json")],
	];
	const decided = new Map<string, { value: boolean; scope: Scope }>();
	for (const [scope, file] of files) {
		for (const [id, value] of Object.entries(enabledPlugins(file))) {
			const name = id.split("@")[0] ?? "";
			if (!conflicting.has(name) || typeof value !== "boolean") continue;
			decided.set(id, { value, scope });
		}
	}
	return [...decided].filter(([, d]) => d.value).map(([id, d]) => ({ id, scope: d.scope }));
}

/** The language servers a plugin's manifest launches: binary and the file extensions it serves. */
export function servers(pluginRoot: string): Array<{ binary: string; extensions: string[] }> {
	try {
		const manifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")) as {
			lspServers?: unknown;
		};
		const entries = manifest.lspServers;
		if (!entries || typeof entries !== "object" || Array.isArray(entries)) return [];
		const out: Array<{ binary: string; extensions: string[] }> = [];
		for (const entry of Object.values(entries as Record<string, unknown>)) {
			const { command, args, extensionToLanguage } = (entry ?? {}) as {
				command?: unknown;
				args?: unknown;
				extensionToLanguage?: unknown;
			};
			// The launcher form runs `sh <launch.sh> <server> …`; any other entry runs the server itself.
			const binary = command === "sh" ? (Array.isArray(args) ? args[1] : undefined) : command;
			if (typeof binary !== "string" || binary === "") continue;
			const extensions =
				extensionToLanguage && typeof extensionToLanguage === "object" ? Object.keys(extensionToLanguage) : [];
			out.push({ binary, extensions });
		}
		return out;
	} catch {
		return [];
	}
}

/** The servers whose binary is not on `path`. */
export function missingServers(
	found: Array<{ binary: string; extensions: string[] }>,
	path: string,
): Array<{ binary: string; extensions: string[] }> {
	return found.filter((s) => Bun.which(s.binary, { PATH: path }) === null);
}

/** The warning about conflicting plugins, or null when nothing conflicts. */
export function conflictMessage(label: string, found: Array<{ id: string; scope: Scope }>): string | null {
	if (found.length === 0) return null;
	const lines = found.map((c) => `  claude plugin uninstall ${c.id} --scope ${c.scope}`);
	const names = found.map((c) => c.id).join(" and ");
	const one = found.length === 1;
	return (
		`${label}: ${names} ${one ? "is" : "are"} also installed. Claude Code gives each file type to one ` +
		`language server plugin, so ${label}'s language server may not be the one that runs, and its idle stop ` +
		`with it. Uninstall ${one ? "it" : "them"}, then restart Claude Code:\n${lines.join("\n")}`
	);
}

/** The warning about language servers missing from PATH, or null when every one is there. */
export function missingMessage(label: string, missing: Array<{ binary: string; extensions: string[] }>): string | null {
	if (missing.length === 0) return null;
	return missing
		.map((s) => {
			const types = s.extensions.length > 0 ? ` for ${s.extensions.join(" ")} files` : "";
			const install = INSTALL[s.binary];
			return (
				`${label}: the ${s.binary} language server is not on the PATH Claude Code started with, so code ` +
				`intelligence${types} is off; the rest of ${label} works. ` +
				(install ? `Install it, then restart Claude Code:\n  ${install}` : "Put it on the PATH, then restart Claude Code.")
			);
		})
		.join("\n");
}

async function main(): Promise<void> {
	const [label, ...names] = process.argv.slice(2);
	if (!label || names.length === 0) return;
	const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || dirname(import.meta.dir);
	const parts = [
		conflictMessage(label, conflicts(process.env.HOME ?? "", await projectDir(), new Set(names))),
		missingMessage(label, missingServers(servers(pluginRoot), process.env.PATH ?? "")),
	].filter((part): part is string => part !== null);
	if (parts.length === 0) return;
	const text = parts.join("\n");
	process.stdout.write(
		`${JSON.stringify({
			systemMessage: text,
			hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
		})}\n`,
	);
}

if (import.meta.main) {
	main().catch(() => {}).finally(() => process.exit(0));
}
