/**
 * Plugin system dependency installer
 *
 * Auto-detects available package managers and installs plugin dependencies
 * declared in plugin.json's "setup" section.
 *
 * Supported managers:
 * - pip: Python packages (auto-detects uv > pip3 > pip)
 * - brew: Homebrew formulae (macOS/Linux)
 * - npm: Global npm packages
 * - cargo: Rust crates
 *
 * Example plugin.json:
 * {
 *   "setup": {
 *     "pip": ["browser-use", "mcp"],
 *     "brew": ["memextech/tap/ht-mcp"]
 *   }
 * }
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { which } from "../utils/command-utils.js";

const execFileAsync = promisify(execFile);

export interface SetupConfig {
	pip?: string[];
	brew?: string[];
	npm?: string[];
	cargo?: string[];
}

export interface SetupResult {
	installed: string[];
	skipped: string[];
	failed: Array<{ pkg: string; error: string }>;
}

/**
 * Run a command and return success/failure
 */
async function run(
	cmd: string,
	args: string[],
	timeoutMs = 120000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync(cmd, args, {
			timeout: timeoutMs,
		});
		return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
	} catch (error: unknown) {
		const e = error as { stdout?: string; stderr?: string; message?: string };
		return {
			ok: false,
			stdout: e.stdout?.trim() || "",
			stderr: e.stderr?.trim() || e.message || "unknown error",
		};
	}
}

/**
 * Detect the best available Python package installer
 * Prefers: uv > pip3 > pip
 */
async function detectPipCommand(): Promise<{
	cmd: string;
	args: string[];
} | null> {
	// Prefer uv (fast, modern)
	if (await which("uv")) {
		return {
			cmd: "uv",
			args: ["pip", "install", "--system", "--break-system-packages"],
		};
	}
	// Fall back to pip3
	if (await which("pip3")) {
		return {
			cmd: "pip3",
			args: ["install", "--break-system-packages"],
		};
	}
	// Fall back to pip
	if (await which("pip")) {
		return {
			cmd: "pip",
			args: ["install", "--break-system-packages"],
		};
	}
	return null;
}

/**
 * Check if a Python package is already installed
 */
async function isPythonPackageInstalled(pkg: string): Promise<boolean> {
	// Convert package name to importable module name (e.g., browser-use → browser_use)
	const moduleName = pkg.replace(/-/g, "_");
	const result = await run("python3", ["-c", `import ${moduleName}`]);
	return result.ok;
}

/**
 * Check if a binary is available in PATH
 */
async function isBinaryAvailable(name: string): Promise<boolean> {
	return (await which(name)) !== null;
}

/**
 * Extract binary name from a brew formula or npm package
 * e.g., "memextech/tap/ht-mcp" → "ht-mcp"
 */
function extractBinaryName(pkg: string): string {
	return pkg.split("/").pop() || pkg;
}

/**
 * Install pip packages
 */
async function installPipPackages(
	packages: string[],
	result: SetupResult,
): Promise<void> {
	const pip = await detectPipCommand();
	if (!pip) {
		for (const pkg of packages) {
			result.failed.push({ pkg: `pip:${pkg}`, error: "No pip/uv found" });
		}
		return;
	}

	// Filter out already installed
	const toInstall: string[] = [];
	for (const pkg of packages) {
		if (await isPythonPackageInstalled(pkg)) {
			result.skipped.push(`pip:${pkg}`);
		} else {
			toInstall.push(pkg);
		}
	}

	if (toInstall.length === 0) return;

	// Install all at once
	const { ok, stderr } = await run(pip.cmd, [...pip.args, ...toInstall]);
	if (ok) {
		for (const pkg of toInstall) {
			result.installed.push(`pip:${pkg}`);
		}
	} else {
		for (const pkg of toInstall) {
			result.failed.push({ pkg: `pip:${pkg}`, error: stderr });
		}
	}
}

/**
 * Install brew packages
 */
async function installBrewPackages(
	packages: string[],
	result: SetupResult,
): Promise<void> {
	const brewPath = await which("brew");
	if (!brewPath) {
		for (const pkg of packages) {
			result.failed.push({
				pkg: `brew:${pkg}`,
				error: "Homebrew not installed",
			});
		}
		return;
	}

	for (const pkg of packages) {
		const binaryName = extractBinaryName(pkg);
		if (await isBinaryAvailable(binaryName)) {
			result.skipped.push(`brew:${pkg}`);
			continue;
		}

		const { ok, stderr } = await run(brewPath, ["install", pkg]);
		if (ok) {
			result.installed.push(`brew:${pkg}`);
		} else {
			result.failed.push({ pkg: `brew:${pkg}`, error: stderr });
		}
	}
}

/**
 * Install npm global packages
 */
async function installNpmPackages(
	packages: string[],
	result: SetupResult,
): Promise<void> {
	const npmPath = await which("npm");
	if (!npmPath) {
		for (const pkg of packages) {
			result.failed.push({ pkg: `npm:${pkg}`, error: "npm not found" });
		}
		return;
	}

	for (const pkg of packages) {
		if (await isBinaryAvailable(pkg)) {
			result.skipped.push(`npm:${pkg}`);
			continue;
		}

		const { ok, stderr } = await run(npmPath, ["install", "-g", pkg]);
		if (ok) {
			result.installed.push(`npm:${pkg}`);
		} else {
			result.failed.push({ pkg: `npm:${pkg}`, error: stderr });
		}
	}
}

/**
 * Install cargo packages
 */
async function installCargoPackages(
	packages: string[],
	result: SetupResult,
): Promise<void> {
	const cargoPath = await which("cargo");
	if (!cargoPath) {
		for (const pkg of packages) {
			result.failed.push({ pkg: `cargo:${pkg}`, error: "cargo not found" });
		}
		return;
	}

	for (const pkg of packages) {
		if (await isBinaryAvailable(pkg)) {
			result.skipped.push(`cargo:${pkg}`);
			continue;
		}

		const { ok, stderr } = await run(cargoPath, ["install", pkg], 300000);
		if (ok) {
			result.installed.push(`cargo:${pkg}`);
		} else {
			result.failed.push({ pkg: `cargo:${pkg}`, error: stderr });
		}
	}
}

/**
 * Read the setup config from a plugin's cached manifest
 */
export async function getPluginSetupConfig(
	marketplace: string,
	pluginName: string,
): Promise<SetupConfig | null> {
	const cacheDir = path.join(
		os.homedir(),
		".claude",
		"plugins",
		"cache",
		marketplace,
	);

	// Find the plugin directory (versioned)
	if (!(await fs.pathExists(cacheDir))) return null;

	const entries = await fs.readdir(cacheDir);
	// Look for the plugin name directory
	const pluginDir = entries.find((e) => e === pluginName);
	if (!pluginDir) return null;

	const pluginPath = path.join(cacheDir, pluginDir);
	const stat = await fs.stat(pluginPath);
	if (!stat.isDirectory()) return null;

	// Find the version directory
	const versions = await fs.readdir(pluginPath);
	if (versions.length === 0) return null;

	// Use the latest version directory
	const latestVersion = versions.sort().pop()!;
	const manifestPath = path.join(pluginPath, latestVersion, "plugin.json");

	if (!(await fs.pathExists(manifestPath))) return null;

	try {
		const manifest = await fs.readJson(manifestPath);
		return manifest.setup || null;
	} catch {
		return null;
	}
}

/**
 * Read setup config from a local plugin directory (marketplace source)
 */
export async function getPluginSetupFromSource(
	marketplace: string,
	pluginName: string,
): Promise<SetupConfig | null> {
	const marketplaceDir = path.join(
		os.homedir(),
		".claude",
		"plugins",
		"marketplaces",
		marketplace,
	);

	if (!(await fs.pathExists(marketplaceDir))) return null;

	// Try common plugin locations
	for (const subdir of ["plugins", ""]) {
		const pluginJson = subdir
			? path.join(marketplaceDir, subdir, pluginName, "plugin.json")
			: path.join(marketplaceDir, pluginName, "plugin.json");

		if (await fs.pathExists(pluginJson)) {
			try {
				const manifest = await fs.readJson(pluginJson);
				return manifest.setup || null;
			} catch {
				continue;
			}
		}
	}

	return null;
}

/**
 * Install all dependencies declared in a plugin's setup config.
 * Auto-detects available package managers.
 */
export async function installPluginDeps(
	setup: SetupConfig,
): Promise<SetupResult> {
	const result: SetupResult = {
		installed: [],
		skipped: [],
		failed: [],
	};

	if (setup.pip?.length) {
		await installPipPackages(setup.pip, result);
	}
	if (setup.brew?.length) {
		await installBrewPackages(setup.brew, result);
	}
	if (setup.npm?.length) {
		await installNpmPackages(setup.npm, result);
	}
	if (setup.cargo?.length) {
		await installCargoPackages(setup.cargo, result);
	}

	return result;
}

/**
 * Check which dependencies from a setup config are missing.
 * Returns a filtered SetupConfig with only missing deps.
 */
export async function checkMissingDeps(
	setup: SetupConfig,
): Promise<SetupConfig> {
	const missing: SetupConfig = {};

	if (setup.pip?.length) {
		const missingPip: string[] = [];
		for (const pkg of setup.pip) {
			if (!(await isPythonPackageInstalled(pkg))) {
				missingPip.push(pkg);
			}
		}
		if (missingPip.length > 0) missing.pip = missingPip;
	}

	if (setup.brew?.length) {
		const missingBrew: string[] = [];
		for (const pkg of setup.brew) {
			const bin = extractBinaryName(pkg);
			if (!(await isBinaryAvailable(bin))) {
				missingBrew.push(pkg);
			}
		}
		if (missingBrew.length > 0) missing.brew = missingBrew;
	}

	if (setup.npm?.length) {
		const missingNpm: string[] = [];
		for (const pkg of setup.npm) {
			if (!(await isBinaryAvailable(pkg))) {
				missingNpm.push(pkg);
			}
		}
		if (missingNpm.length > 0) missing.npm = missingNpm;
	}

	if (setup.cargo?.length) {
		const missingCargo: string[] = [];
		for (const pkg of setup.cargo) {
			if (!(await isBinaryAvailable(pkg))) {
				missingCargo.push(pkg);
			}
		}
		if (missingCargo.length > 0) missing.cargo = missingCargo;
	}

	return missing;
}
