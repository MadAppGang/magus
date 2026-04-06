import * as fs from "fs";
import * as path from "path";
import {
	readSettings,
	writeSettings,
	readGlobalSettings,
	writeGlobalSettings,
} from "./claude-settings.js";
import type { SettingDefinition } from "../data/settings-catalog.js";

export type SettingScope = "user" | "project";

/** Read the current value of a setting from the given scope */
export async function readSettingValue(
	setting: SettingDefinition,
	scope: SettingScope,
	projectPath?: string,
): Promise<string | undefined> {
	const settings =
		scope === "user"
			? await readGlobalSettings()
			: await readSettings(projectPath);

	if (setting.storage.type === "attribution") {
		// Attribution is an object: { commit: "", pr: "" } means disabled
		const attr = (settings as any).attribution;
		if (attr && attr.commit === "" && attr.pr === "") {
			return "false";
		}
		return undefined; // default (enabled)
	} else if (setting.storage.type === "attribution-text") {
		// Custom attribution text: read from attribution.commit, strip the Co-Authored-By trailer prefix
		const attr = (settings as any).attribution;
		if (!attr || (attr.commit === "" && attr.pr === "")) {
			// Attribution is disabled or not set — no custom text stored
			return undefined;
		}
		const commit: string | undefined = attr.commit;
		if (!commit) {
			return undefined;
		}
		// The commit value is "Co-Authored-By: Magus <magus@madappgang.com>\n\n{customText}"
		// Strip the trailer prefix if present
		const trailerPrefix = "Co-Authored-By: Magus <magus@madappgang.com>\n\n";
		if (commit.startsWith(trailerPrefix)) {
			const text = commit.slice(trailerPrefix.length);
			return text.length > 0 ? text : undefined;
		}
		// If no trailer prefix, the value is the raw text (or Claude default — return undefined)
		return undefined;
	} else if (setting.storage.type === "env") {
		const env = (settings as any).env as Record<string, string> | undefined;
		return env?.[setting.storage.key];
	} else {
		// Direct settings key (supports dot notation like "permissions.defaultMode")
		const keys = setting.storage.key.split(".");
		let value: any = settings;
		for (const k of keys) {
			value = value?.[k];
		}
		return value !== undefined && value !== null ? String(value) : undefined;
	}
}

/** Write a setting value to the given scope */
export async function writeSettingValue(
	setting: SettingDefinition,
	value: string | undefined,
	scope: SettingScope,
	projectPath?: string,
): Promise<void> {
	const settings =
		scope === "user"
			? await readGlobalSettings()
			: await readSettings(projectPath);

	if (setting.storage.type === "attribution") {
		// Boolean toggle: "false" -> write { commit: "", pr: "" }, "true"/undefined -> delete key
		if (value === "false") {
			(settings as any).attribution = { commit: "", pr: "" };
		} else {
			delete (settings as any).attribution;
		}
	} else if (setting.storage.type === "attribution-text") {
		if (value && value.trim().length > 0) {
			// Write custom text: commit gets a Co-Authored-By trailer + the text; pr gets the text
			(settings as any).attribution = {
				commit: `Co-Authored-By: Magus <magus@madappgang.com>\n\n${value}`,
				pr: value,
			};
		} else {
			// Empty value: remove attribution key entirely (revert to Claude defaults)
			delete (settings as any).attribution;
		}
	} else if (setting.storage.type === "env") {
		// Write to the "env" block in settings.json
		(settings as any).env = (settings as any).env || {};
		if (value === undefined || value === "" || value === setting.defaultValue) {
			delete (settings as any).env[setting.storage.key];
			// Clean up empty env block
			if (Object.keys((settings as any).env).length === 0) {
				delete (settings as any).env;
			}
		} else {
			(settings as any).env[setting.storage.key] = value;
		}
	} else {
		// Direct settings key (supports dot notation)
		const keys = setting.storage.key.split(".");
		if (keys.length === 1) {
			if (value === undefined || value === "") {
				delete (settings as any)[keys[0]];
			} else {
				// Try to preserve type: boolean, number, or string
				(settings as any)[keys[0]] = parseSettingValue(value, setting.type);
			}
		} else {
			// Nested key like "permissions.defaultMode"
			let obj: any = settings;
			for (let i = 0; i < keys.length - 1; i++) {
				obj[keys[i]] = obj[keys[i]] || {};
				obj = obj[keys[i]];
			}
			const lastKey = keys[keys.length - 1];
			if (value === undefined || value === "") {
				delete obj[lastKey];
			} else {
				obj[lastKey] = parseSettingValue(value, setting.type);
			}
		}
	}

	if (scope === "user") {
		await writeGlobalSettings(settings);
	} else {
		await writeSettings(settings, projectPath);
	}
}

function parseSettingValue(value: string, type: string): any {
	if (type === "boolean") {
		return value === "true" || value === "1";
	}
	// Try number
	const num = Number(value);
	if (!Number.isNaN(num) && value.trim() !== "") {
		return value; // Keep as string for env vars
	}
	return value;
}

/** Read all setting values for the catalog */
export async function readAllSettings(
	catalog: SettingDefinition[],
	scope: SettingScope,
	projectPath?: string,
): Promise<Map<string, string | undefined>> {
	const values = new Map<string, string | undefined>();
	for (const setting of catalog) {
		values.set(setting.id, await readSettingValue(setting, scope, projectPath));
	}
	return values;
}

export interface ScopedSettingValues {
	user: string | undefined;
	project: string | undefined;
}

/** Read all setting values from both scopes simultaneously */
export async function readAllSettingsBothScopes(
	catalog: SettingDefinition[],
	projectPath?: string,
): Promise<Map<string, ScopedSettingValues>> {
	const result = new Map<string, ScopedSettingValues>();
	const [userValues, projectValues] = await Promise.all([
		readAllSettings(catalog, "user", projectPath),
		readAllSettings(catalog, "project", projectPath),
	]);
	for (const setting of catalog) {
		result.set(setting.id, {
			user: userValues.get(setting.id),
			project: projectValues.get(setting.id),
		});
	}
	return result;
}

/**
 * Discover available output styles from installed plugins.
 * Scans enabled plugins for outputStyles entries and *-output-style plugin names.
 * Returns options suitable for a select setting.
 */
export async function discoverOutputStyles(
	projectPath?: string,
): Promise<Array<{ label: string; value: string }>> {
	const styles: Array<{ label: string; value: string }> = [
		{ label: "Default", value: "" },
	];

	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	const cacheDir = path.join(homeDir, ".claude", "plugins", "cache");

	// Collect enabled plugins from both scopes
	const enabledPlugins = new Set<string>();
	try {
		const userSettings = await readGlobalSettings();
		for (const [k, v] of Object.entries((userSettings as any).enabledPlugins || {})) {
			if (v) enabledPlugins.add(k);
		}
	} catch {}
	try {
		const projSettings = await readSettings(projectPath);
		for (const [k, v] of Object.entries((projSettings as any).enabledPlugins || {})) {
			if (v) enabledPlugins.add(k);
		}
	} catch {}

	const seen = new Set<string>();

	for (const pluginId of enabledPlugins) {
		const [pluginName, marketplace] = pluginId.split("@");

		// Check if this is a dedicated output-style plugin (e.g. "explanatory-output-style")
		if (pluginName.endsWith("-output-style")) {
			const styleName = pluginName
				.replace(/-output-style$/, "")
				.split("-")
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ");
			if (!seen.has(styleName)) {
				seen.add(styleName);
				styles.push({ label: styleName, value: styleName });
			}
			continue;
		}

		// Check plugin.json for outputStyles entries
		if (!marketplace) continue;
		const pluginDir = path.join(cacheDir, marketplace, pluginName);
		try {
			const versions = fs.readdirSync(pluginDir).sort();
			const latest = versions[versions.length - 1];
			if (!latest) continue;
			const manifestPath = path.join(pluginDir, latest, "plugin.json");
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			const outputStyles = manifest.outputStyles as string[] | undefined;
			if (!outputStyles?.length) continue;

			for (const stylePath of outputStyles) {
				const fullPath = path.join(pluginDir, latest, stylePath);
				try {
					const content = fs.readFileSync(fullPath, "utf-8");
					const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
					if (fmMatch) {
						const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
						if (nameMatch) {
							const name = nameMatch[1].trim();
							if (!seen.has(name)) {
								seen.add(name);
								styles.push({ label: name, value: name });
							}
						}
					}
				} catch {}
			}
		} catch {}
	}

	return styles;
}
