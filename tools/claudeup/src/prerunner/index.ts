import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { UpdateCache } from "../services/update-cache.js";
import {
	getAvailablePlugins,
	clearMarketplaceCache,
} from "../services/plugin-manager.js";
import { runClaude } from "../services/claude-runner.js";
import {
	recoverMarketplaceSettings,
	migrateMarketplaceRename,
	getGlobalEnabledPlugins,
	getEnabledPlugins,
	getLocalEnabledPlugins,
	saveGlobalInstalledPluginVersion,
} from "../services/claude-settings.js";
import { parsePluginId } from "../utils/string-utils.js";
import { defaultMarketplaces } from "../data/marketplaces.js";
import {
	updatePlugin,
	addMarketplace,
	isClaudeAvailable,
} from "../services/claude-cli.js";

const MARKETPLACES_DIR = path.join(
	os.homedir(),
	".claude",
	"plugins",
	"marketplaces",
);

export interface PrerunOptions {
	force?: boolean; // Bypass cache and force update check
}

/**
 * Collect all unique marketplace names from enabled plugins across all settings scopes.
 * Returns a Set of marketplace names (e.g., "magus", "claude-plugins-official").
 */
async function getReferencedMarketplaces(
	projectPath?: string,
): Promise<Set<string>> {
	const marketplaceNames = new Set<string>();

	// Collect plugin IDs from all scopes
	const allPluginIds = new Set<string>();

	try {
		const global = await getGlobalEnabledPlugins();
		for (const id of Object.keys(global)) allPluginIds.add(id);
	} catch { /* skip if unreadable */ }

	if (projectPath) {
		try {
			const project = await getEnabledPlugins(projectPath);
			for (const id of Object.keys(project)) allPluginIds.add(id);
		} catch { /* skip if unreadable */ }

		try {
			const local = await getLocalEnabledPlugins(projectPath);
			for (const id of Object.keys(local)) allPluginIds.add(id);
		} catch { /* skip if unreadable */ }
	}

	// Parse marketplace names from plugin IDs
	for (const pluginId of allPluginIds) {
		const parsed = parsePluginId(pluginId);
		if (parsed) {
			marketplaceNames.add(parsed.marketplace);
		}
	}

	return marketplaceNames;
}

/**
 * Check which referenced marketplaces are missing locally and auto-add them.
 * Only adds marketplaces with known repos (from defaultMarketplaces).
 */
async function autoAddMissingMarketplaces(
	projectPath?: string,
): Promise<string[]> {
	const referenced = await getReferencedMarketplaces(projectPath);
	const added: string[] = [];

	for (const mpName of referenced) {
		// Check if marketplace directory exists locally
		const mpDir = path.join(MARKETPLACES_DIR, mpName);
		if (await fs.pathExists(mpDir)) continue;

		// Look up the repo URL from default marketplaces
		const defaultMp = defaultMarketplaces.find((m) => m.name === mpName);
		if (!defaultMp?.source.repo) continue;

		try {
			await addMarketplace(defaultMp.source.repo);
			added.push(mpName);
		} catch (error) {
			// Non-fatal: log and continue
			console.warn(
				`⚠ Failed to auto-add marketplace ${mpName}:`,
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	}

	return added;
}

/**
 * Prerun orchestration: Check for updates, apply them, then run claude
 * @param claudeArgs - Arguments to pass to claude CLI
 * @param options - Prerun options (force, etc.)
 * @returns Exit code from claude process
 */
export async function prerunClaude(
	claudeArgs: string[],
	options: PrerunOptions = {},
): Promise<number> {
	const cache = new UpdateCache();

	try {
		// STEP 0: Migrate old marketplace names → magus (idempotent, no-ops if already migrated)
		const migration = await migrateMarketplaceRename();
		const migTotal = migration.projectMigrated + migration.globalMigrated
			+ migration.localMigrated + migration.registryMigrated
			+ (migration.knownMarketplacesMigrated ? 1 : 0);
		if (migTotal > 0) {
			console.log(`✓ Migrated ${migTotal} plugin reference(s) → magus`);
		}

		// STEP 0.5: Auto-add missing marketplaces
		// When plugins reference a marketplace that's not installed locally
		// (e.g., settings synced from another machine), add it automatically.
		if (await isClaudeAvailable()) {
			const addedMarketplaces = await autoAddMissingMarketplaces();
			if (addedMarketplaces.length > 0) {
				console.log(
					`✓ Auto-added marketplace(s): ${addedMarketplaces.join(", ")}`,
				);
			}
		}

		// STEP 1: Check if we should update (time-based cache, or forced)
		const shouldUpdate = options.force || (await cache.shouldCheckForUpdates());

		if (options.force) {
			console.log("⟳ Forcing plugin update check...");
		}

		if (shouldUpdate) {
			// STEP 1.5: Recover marketplace settings (enable autoUpdate, remove stale entries)
			const recovery = await recoverMarketplaceSettings();
			if (recovery.enabledAutoUpdate.length > 0) {
				console.log(
					`✓ Enabled auto-update for: ${recovery.enabledAutoUpdate.join(", ")}`,
				);
			}
			if (recovery.removed.length > 0) {
				console.log(
					`✓ Removed stale marketplaces: ${recovery.removed.join(", ")}`,
				);
			}

			// STEP 2: Clear cache to force fresh plugin info
			clearMarketplaceCache();

			// STEP 3: Get updated plugin info (to detect versions)
			const plugins = await getAvailablePlugins();

			// STEP 4: Auto-update enabled plugins via claude CLI
			const autoUpdatedPlugins: Array<{
				pluginId: string;
				oldVersion: string;
				newVersion: string;
			}> = [];

			const cliAvailable = await isClaudeAvailable();

			for (const plugin of plugins) {
				// Only update if:
				// 1. Plugin is enabled
				// 2. Plugin has an update available
				// 3. Plugin has both installedVersion and version (newVersion)
				if (
					plugin.enabled &&
					plugin.hasUpdate &&
					plugin.installedVersion &&
					plugin.version
				) {
					try {
						if (cliAvailable) {
							await updatePlugin(plugin.id, "user");
						}
						await saveGlobalInstalledPluginVersion(plugin.id, plugin.version);

						autoUpdatedPlugins.push({
							pluginId: plugin.id,
							oldVersion: plugin.installedVersion,
							newVersion: plugin.version,
						});
					} catch (error) {
						// Non-fatal: Log warning and continue
						console.warn(
							`⚠ Failed to auto-update ${plugin.id}:`,
							error instanceof Error ? error.message : "Unknown error",
						);
					}
				}
			}

			// STEP 5: Save cache
			await cache.saveCheck({
				lastUpdateCheck: new Date().toISOString(),
				lastUpdateResult: {
					updated: [],
					failed: [],
					autoUpdated: autoUpdatedPlugins,
				},
			});

			// STEP 6: Display auto-update summary
			if (autoUpdatedPlugins.length > 0) {
				console.log(`✓ Auto-updated ${autoUpdatedPlugins.length} plugin(s):`);
				for (const { pluginId, oldVersion, newVersion } of autoUpdatedPlugins) {
					console.log(`  - ${pluginId}: ${oldVersion} → ${newVersion}`);
				}
			}
		}
		// If !shouldUpdate → silent (no output)
	} catch (error) {
		// Non-fatal errors - warn and continue
		console.warn(
			"Warning: Plugin update check failed:",
			error instanceof Error ? error.message : "Unknown error",
		);
	}

	// STEP 8: Always run claude (even if update failed)
	return runClaude(claudeArgs);
}
