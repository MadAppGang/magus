#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { App } from "./ui/App.js";
import { prerunClaude } from "./prerunner/index.js";
import { checkForUpdates } from "./services/version-check.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
export const VERSION = pkg.version;

// Note: OpenTUI renderer handles alternate screen buffer automatically
// No need for manual ANSI escape codes

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	// Handle "claudeup claude [args]" - prerunner mode
	if (args[0] === "claude") {
		const claudeArgs = args.slice(1);

		// Parse prerunner-specific flags
		const forceUpdate =
			claudeArgs.includes("--force") || claudeArgs.includes("-f");

		// Remove prerunner flags before passing to claude
		const filteredArgs = claudeArgs.filter(
			(arg) => arg !== "--force" && arg !== "-f",
		);

		const exitCode = await prerunClaude(filteredArgs, { force: forceUpdate });
		process.exit(exitCode);
		return;
	}

	// Handle "claudeup update" - self-update command
	if (args[0] === "update") {
		const { execSync } = await import("node:child_process");

		// Detect all installations of claudeup across package managers
		const installations: Array<{
			manager: "bun" | "npm";
			path: string;
		}> = [];

		// Check bun global
		try {
			const bunGlobalBin = execSync("bun pm -g bin", {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			const bunPath = `${bunGlobalBin}/claudeup`;
			const stat = await import("node:fs").then((fs) =>
				fs.existsSync(bunPath),
			);
			if (stat) installations.push({ manager: "bun", path: bunPath });
		} catch {
			// bun not installed or no global claudeup
		}

		// Check npm global
		try {
			const npmPrefix = execSync("npm prefix -g", {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			const npmPath = `${npmPrefix}/bin/claudeup`;
			const stat = await import("node:fs").then((fs) =>
				fs.existsSync(npmPath),
			);
			if (stat) installations.push({ manager: "npm", path: npmPath });
		} catch {
			// npm not installed or no global claudeup
		}

		// Warn about duplicate installations
		if (installations.length > 1) {
			const activePath = execSync("which claudeup", {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			const active = installations.find((i) => i.path === activePath);
			const shadowed = installations.filter((i) => i.path !== activePath);

			console.log(
				`⚠ claudeup is installed via multiple package managers:\n`,
			);
			for (const inst of installations) {
				const tag =
					inst.path === activePath ? " (active)" : " (shadowed)";
				console.log(`  ${inst.manager}: ${inst.path}${tag}`);
			}
			console.log(`\nTo fix, keep one and remove the other:`);
			for (const inst of installations) {
				console.log(`  ${inst.manager} uninstall -g claudeup`);
			}
			console.log();
		}

		// Determine which package manager to use for the update
		let usesBun = false;
		try {
			const claudeupPath = execSync("which claudeup", {
				encoding: "utf-8",
			}).trim();
			usesBun =
				claudeupPath.includes(".bun") || claudeupPath.includes("bun/bin");
		} catch {
			// If which fails, default to npm
		}

		const pkgManager = usesBun ? "bun" : "npm";
		console.log(`Updating claudeup using ${pkgManager}...`);

		const installArgs = ["install", "-g", "claudeup@latest"];

		const proc = spawn(pkgManager, installArgs, {
			stdio: "inherit",
			shell: false, // Avoid shell for security (fixes DEP0190 warning)
		});
		proc.on("exit", (code) => process.exit(code || 0));
		return;
	}

	// Handle "claudeup doctor" - convention audit command
	if (args[0] === "doctor") {
		const fix = args.includes("--fix");
		const json = args.includes("--json");
		const { runDoctor, fixDoctorIssues } = await import("claudeup-core");

		const result = await runDoctor((level, msg) => {
			if (!json) console.log(`[${level}] ${msg}`);
		});

		if (fix) {
			const fixResult = await fixDoctorIssues(result, (level, msg) => {
				if (!json) console.log(`[${level}] ${msg}`);
			});
			if (json) {
				console.log(JSON.stringify({ ...result, fixes: fixResult }));
			} else {
				console.log(
					`\nFixed ${fixResult.fixed} issue(s), ${fixResult.failed} failed.`,
				);
			}
		} else {
			if (json) {
				console.log(JSON.stringify(result));
			} else {
				// Pretty-print results
				for (const project of result.projects) {
					console.log(`\n${project.projectPath}`);
					for (const check of project.checks) {
						const icon =
							check.status === "pass"
								? "PASS"
								: check.status === "warn"
									? "WARN"
									: "FAIL";
						console.log(`  ${icon}  ${check.message}`);
					}
				}

				const s = result.summary;
				console.log(
					`\nSummary: ${s.totalProjects} project(s), ${s.totalChecks} check(s)`,
				);
				console.log(
					`  ${s.passed} passed, ${s.warnings} warning(s), ${s.failures} failure(s)`,
				);
				if (s.fixable > 0) {
					console.log(`  ${s.fixable} fixable with --fix`);
				}
			}
		}
		process.exit(result.summary.failures > 0 ? 1 : 0);
		return;
	}

	// Handle --version flag - show version and check for updates
	if (args.includes("--version") || args.includes("-v")) {
		console.log(`claudeup v${VERSION}`);
		const result = await checkForUpdates();
		if (result.updateAvailable) {
			console.log(`\nUpdate available: v${result.latestVersion}`);
			console.log("Run: claudeup update");
		}
		process.exit(0);
	}

	// Handle --help flag
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`claudeup v${VERSION}

TUI tool for managing Claude Code plugins, MCPs, and configuration.

Usage: claudeup [options]
       claudeup claude [args...]  Run claude with auto-update prerunner
       claudeup update            Update claudeup to latest version
       claudeup doctor [--fix]    Audit plugin conventions across projects

Options:
  -v, --version  Show version and check for updates
  -h, --help     Show this help message
  --no-refresh   Skip auto-refresh of marketplaces on startup

Commands:
  claude [args...]   Check for plugin updates (1h cache), then run claude
    -f, --force      Force update check (bypass 1h cache)
  update             Update claudeup itself to latest version
  doctor [--fix]     Audit plugin conventions (gitignore, CLAUDE.md)
    --fix            Auto-repair fixable issues
    --json           Machine-readable JSON output

Navigation:
  [1] Plugins    Manage plugin marketplaces and installed plugins
  [2] MCP        Setup and manage MCP servers
  [3] Status     Configure status line display
  [4] Env        Environment variables for MCP servers
  [5] Tools      Install and update AI coding CLI tools

Keys:
  ↑/↓ or j/k     Navigate
  Enter          Select / Toggle
  g              Toggle global/project scope (in Plugins)
  r              Refresh current screen
  ?              Show help
  q / Escape     Back / Quit
`);
		process.exit(0);
	}

	// Create OpenTUI renderer (handles alternate screen buffer automatically)
	const renderer = await createCliRenderer();
	const root = createRoot(renderer);

	// Cleanup function to restore terminal
	const cleanup = () => {
		root.unmount();
		renderer.destroy(); // CRITICAL: Never use process.exit() directly
	};

	// Handle cleanup on exit signals
	const handleExit = () => {
		cleanup();
		// Exit after cleanup completes
		process.exit(0);
	};

	process.on("SIGINT", handleExit);
	process.on("SIGTERM", handleExit);

	// Render the OpenTUI app with exit handler
	root.render(<App onExit={handleExit} />);

	// Wait indefinitely (app runs until user exits)
	await new Promise(() => {});
}

main().catch((error) => {
	console.error("Error starting claudeup:", error);
	process.exit(1);
});
