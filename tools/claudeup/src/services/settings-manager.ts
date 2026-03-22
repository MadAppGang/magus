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

	if (setting.storage.type === "env") {
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

	if (setting.storage.type === "env") {
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
