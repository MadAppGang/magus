import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import type { Profile, ProfilesFile, ProfileEntry } from "../types/index.js";

const PROFILES_FILE = "profiles.json";

// ─── Path helpers ──────────────────────────────────────────────────────────────

export function getUserProfilesPath(): string {
	return path.join(os.homedir(), ".claude", PROFILES_FILE);
}

export function getProjectProfilesPath(projectPath?: string): string {
	const base = projectPath ?? process.cwd();
	return path.join(base, ".claude", PROFILES_FILE);
}

// ─── Low-level read/write ──────────────────────────────────────────────────────

export async function readProfiles(
	scope: "user" | "project",
	projectPath?: string,
): Promise<ProfilesFile> {
	const filePath =
		scope === "user"
			? getUserProfilesPath()
			: getProjectProfilesPath(projectPath);
	try {
		if (await fs.pathExists(filePath)) {
			const data = await fs.readJson(filePath);
			if (data.version && data.profiles) return data as ProfilesFile;
		}
	} catch {
		// fall through to default
	}
	return { version: 1, profiles: {} };
}

async function writeProfiles(
	scope: "user" | "project",
	data: ProfilesFile,
	projectPath?: string,
): Promise<void> {
	const filePath =
		scope === "user"
			? getUserProfilesPath()
			: getProjectProfilesPath(projectPath);
	await fs.ensureDir(path.dirname(filePath));
	await fs.writeJson(filePath, data, { spaces: 2 });
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

/** Return all profiles from both scopes, merged into a flat list */
export async function listProfiles(
	projectPath?: string,
): Promise<ProfileEntry[]> {
	const [user, project] = await Promise.all([
		readProfiles("user"),
		readProfiles("project", projectPath),
	]);
	const entries: ProfileEntry[] = [];
	for (const [id, p] of Object.entries(user.profiles)) {
		entries.push({ id, scope: "user", ...p });
	}
	for (const [id, p] of Object.entries(project.profiles)) {
		entries.push({ id, scope: "project", ...p });
	}
	// Sort: user profiles first, then project, each by updatedAt desc
	entries.sort((a, b) => {
		if (a.scope !== b.scope) return a.scope === "user" ? -1 : 1;
		return b.updatedAt.localeCompare(a.updatedAt);
	});
	return entries;
}

/**
 * Save (create or overwrite) a profile.
 * Returns the generated profile ID.
 */
export async function saveProfile(
	name: string,
	plugins: Record<string, boolean>,
	scope: "user" | "project",
	projectPath?: string,
): Promise<string> {
	const data = await readProfiles(scope, projectPath);
	const id = generateUniqueId(name, data.profiles);
	const now = new Date().toISOString();
	data.profiles[id] = {
		name,
		plugins,
		createdAt: now,
		updatedAt: now,
	};
	await writeProfiles(scope, data, projectPath);
	return id;
}

/**
 * Apply a profile: replaces enabledPlugins in the target settings scope.
 * targetScope is where the settings will be written, independent of where
 * the profile is stored.
 */
export async function applyProfile(
	profileId: string,
	profileScope: "user" | "project",
	targetScope: "user" | "project" | "local",
	projectPath?: string,
): Promise<void> {
	const data = await readProfiles(profileScope, projectPath);
	const profile = data.profiles[profileId];
	if (!profile) throw new Error(`Profile "${profileId}" not found`);

	// Import settings functions dynamically to avoid circular deps
	const {
		readSettings,
		writeSettings,
		readGlobalSettings,
		writeGlobalSettings,
	} = await import("./claude-settings.js");

	if (targetScope === "user") {
		const settings = await readGlobalSettings();
		settings.enabledPlugins = { ...profile.plugins };
		await writeGlobalSettings(settings);
	} else {
		// project or local both write to project settings.json
		const settings = await readSettings(projectPath);
		settings.enabledPlugins = { ...profile.plugins };
		await writeSettings(settings, projectPath);
	}
}

/** Rename a profile in-place (preserves id, createdAt) */
export async function renameProfile(
	profileId: string,
	newName: string,
	scope: "user" | "project",
	projectPath?: string,
): Promise<void> {
	const data = await readProfiles(scope, projectPath);
	if (!data.profiles[profileId]) {
		throw new Error(`Profile "${profileId}" not found in ${scope} scope`);
	}
	data.profiles[profileId].name = newName;
	data.profiles[profileId].updatedAt = new Date().toISOString();
	await writeProfiles(scope, data, projectPath);
}

export async function deleteProfile(
	profileId: string,
	scope: "user" | "project",
	projectPath?: string,
): Promise<void> {
	const data = await readProfiles(scope, projectPath);
	if (!data.profiles[profileId]) {
		throw new Error(`Profile "${profileId}" not found in ${scope} scope`);
	}
	delete data.profiles[profileId];
	await writeProfiles(scope, data, projectPath);
}

// ─── Import / Export ───────────────────────────────────────────────────────────

/** Serialize a profile to a compact JSON string for clipboard sharing */
export async function exportProfileToJson(
	profileId: string,
	scope: "user" | "project",
	projectPath?: string,
): Promise<string> {
	const data = await readProfiles(scope, projectPath);
	const profile = data.profiles[profileId];
	if (!profile) throw new Error(`Profile "${profileId}" not found`);
	const entry: ProfileEntry = { id: profileId, scope, ...profile };
	return JSON.stringify(entry, null, 2);
}

/**
 * Parse a clipboard JSON string and save into the specified scope.
 * Returns the saved profile id.
 */
export async function importProfileFromJson(
	json: string,
	targetScope: "user" | "project",
	projectPath?: string,
): Promise<string> {
	let entry: Partial<ProfileEntry>;
	try {
		entry = JSON.parse(json) as Partial<ProfileEntry>;
	} catch {
		throw new Error("Invalid JSON — could not parse clipboard content");
	}
	if (!entry.name || typeof entry.plugins !== "object") {
		throw new Error("Invalid profile format — expected { name, plugins }");
	}
	return saveProfile(
		entry.name,
		entry.plugins as Record<string, boolean>,
		targetScope,
		projectPath,
	);
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function generateUniqueId(
	name: string,
	existing: Record<string, unknown>,
): string {
	const base = slugify(name) || "profile";
	if (!existing[base]) return base;
	let n = 2;
	while (existing[`${base}-${n}`]) n++;
	return `${base}-${n}`;
}
