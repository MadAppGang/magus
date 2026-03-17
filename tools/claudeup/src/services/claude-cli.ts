/**
 * Claude CLI wrapper service
 *
 * Delegates plugin and marketplace management to the `claude` CLI
 * instead of manipulating settings JSON files directly.
 *
 * CLI commands used:
 * - claude plugin install/uninstall/enable/disable/update
 * - claude marketplace add
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { which } from "../utils/command-utils.js";
import {
	removeGlobalInstalledPluginVersion,
	removeLocalInstalledPluginVersion,
} from "./claude-settings.js";
import {
	removeInstalledPluginVersion,
} from "./plugin-manager.js";

const execFileAsync = promisify(execFile);

export type PluginScope = "user" | "project" | "local";

/**
 * Get the path to the claude CLI binary
 * @throws Error if claude CLI is not found in PATH
 */
async function getClaudePath(): Promise<string> {
	const claudePath = await which("claude");
	if (!claudePath) {
		throw new Error(
			"claude CLI not found in PATH. Install with: npm install -g @anthropic-ai/claude-code",
		);
	}
	return claudePath;
}

/**
 * Execute a claude CLI command and return stdout
 * @param args - Arguments to pass to claude
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns stdout from the command
 */
async function execClaude(
	args: string[],
	timeoutMs = 30000,
): Promise<string> {
	const claudePath = await getClaudePath();
	try {
		const { stdout } = await execFileAsync(claudePath, args, {
			timeout: timeoutMs,
		});
		return stdout.trim();
	} catch (error: unknown) {
		const execError = error as {
			stderr?: string;
			stdout?: string;
			message?: string;
			code?: number;
		};
		const msg =
			execError.stderr?.trim() ||
			execError.stdout?.trim() ||
			execError.message ||
			"claude command failed";
		throw new Error(msg);
	}
}

/**
 * Install a plugin using claude CLI
 * Handles enabling + version tracking + cache copy in one shot
 */
export async function installPlugin(
	pluginId: string,
	scope: PluginScope = "user",
): Promise<void> {
	await execClaude(["plugin", "install", pluginId, "--scope", scope]);
}

/**
 * Uninstall a plugin using claude CLI.
 * Falls back to direct settings removal if CLI uninstall fails
 * (e.g., for plugins installed via old JSON method).
 * @param projectPath - Required for project/local scope fallback
 */
export async function uninstallPlugin(
	pluginId: string,
	scope: PluginScope = "user",
	projectPath?: string,
): Promise<void> {
	try {
		await execClaude(["plugin", "uninstall", pluginId, "--scope", scope]);
	} catch {
		// Fallback: directly remove from settings JSON
		if (scope === "user") {
			await removeGlobalInstalledPluginVersion(pluginId);
		} else if (scope === "local" && projectPath) {
			await removeLocalInstalledPluginVersion(pluginId, projectPath);
		} else if (projectPath) {
			await removeInstalledPluginVersion(pluginId, projectPath);
		}
	}
}

/**
 * Enable a previously disabled plugin
 */
export async function enablePlugin(
	pluginId: string,
	scope: PluginScope = "user",
): Promise<void> {
	await execClaude(["plugin", "enable", pluginId, "--scope", scope]);
}

/**
 * Disable a plugin without uninstalling it
 */
export async function disablePlugin(
	pluginId: string,
	scope: PluginScope = "user",
): Promise<void> {
	await execClaude(["plugin", "disable", pluginId, "--scope", scope]);
}

/**
 * Update a plugin to the latest version.
 * Uses `install` as primary method since `update` only works for plugins
 * originally installed via the CLI. `install` handles both fresh installs
 * and re-installs (upgrades) of existing plugins regardless of how they
 * were originally added.
 */
export async function updatePlugin(
	pluginId: string,
	scope: PluginScope = "user",
): Promise<void> {
	await execClaude(["plugin", "install", pluginId, "--scope", scope], 60000);
}

/**
 * Add a marketplace by GitHub repo (e.g., "MadAppGang/magus")
 * Uses longer timeout since this involves cloning a git repo
 */
export async function addMarketplace(repo: string): Promise<void> {
	await execClaude(["plugin", "marketplace", "add", repo], 60000);
}

/**
 * Check if the claude CLI is available
 * @returns true if claude CLI is found in PATH
 */
export async function isClaudeAvailable(): Promise<boolean> {
	return (await which("claude")) !== null;
}
