import React, { useEffect, useCallback, useState, useRef } from "react";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { cliTools } from "../../data/cli-tools.js";
import {
	renderCliToolRow,
	renderCliToolDetail,
	type CliToolStatus,
} from "../renderers/cliToolRenderers.js";

const execAsync = promisify(exec);

// ─── Version helpers ───────────────────────────────────────────────────────────

// Session-level cache
let cachedToolStatuses: CliToolStatus[] | null = null;
let cacheInitialized = false;

function clearCliToolsCache(): void {
	cachedToolStatuses = null;
	cacheInitialized = false;
}

function parseVersion(versionOutput: string): string | undefined {
	const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
	return match ? match[1] : undefined;
}

async function isInstalledViaHomebrew(toolName: string): Promise<boolean> {
	try {
		const { stdout } = await execAsync("brew list --formula 2>/dev/null", {
			timeout: 2000,
			shell: "/bin/bash",
		});
		const formulas = stdout.trim().split("\n");
		return formulas.some((f) => f.trim() === toolName);
	} catch {
		return false;
	}
}

async function getInstalledVersion(
	tool: import("../../data/cli-tools.js").CliTool,
): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync(tool.checkCommand, { timeout: 5000 });
		return parseVersion(stdout.trim());
	} catch {
		return undefined;
	}
}

async function getLatestNpmVersion(packageName: string): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync(
			`npm view ${packageName} version 2>/dev/null`,
			{ timeout: 10000 },
		);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function getLatestPipVersion(packageName: string): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync(
			`pip index versions ${packageName} 2>/dev/null | head -1`,
			{ timeout: 10000, shell: "/bin/bash" },
		);
		const match = stdout.trim().match(/\(([^)]+)\)/);
		return match ? match[1] : undefined;
	} catch {
		return undefined;
	}
}

async function getLatestVersion(
	tool: import("../../data/cli-tools.js").CliTool,
): Promise<string | undefined> {
	return tool.packageManager === "npm"
		? getLatestNpmVersion(tool.packageName)
		: getLatestPipVersion(tool.packageName);
}

function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.split(/[-.]/).map((p) => parseInt(p, 10) || 0);
	const parts2 = v2.split(/[-.]/).map((p) => parseInt(p, 10) || 0);
	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const p1 = parts1[i] || 0;
		const p2 = parts2[i] || 0;
		if (p1 < p2) return -1;
		if (p1 > p2) return 1;
	}
	return 0;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CliToolsScreen() {
	const { state, dispatch } = useApp();
	const { cliTools: cliToolsState } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	const [toolStatuses, setToolStatuses] = useState<CliToolStatus[]>(() => {
		return (
			cachedToolStatuses ||
			cliTools.map((tool) => ({
				tool,
				installed: false,
				installedVersion: undefined,
				checking: true,
			}))
		);
	});

	const statusesRef = useRef(toolStatuses);
	statusesRef.current = toolStatuses;

	const updateToolStatus = useCallback(
		(index: number, updates: Partial<CliToolStatus>) => {
			setToolStatuses((prev) => {
				const newStatuses = [...prev];
				newStatuses[index] = { ...newStatuses[index]!, ...updates };
				cachedToolStatuses = newStatuses;
				return newStatuses;
			});
		},
		[],
	);

	const fetchVersionInfo = useCallback(async () => {
		for (let i = 0; i < cliTools.length; i++) {
			const tool = cliTools[i]!;

			// Run both checks in parallel, then compute hasUpdate with both results
			Promise.all([getInstalledVersion(tool), getLatestVersion(tool)]).then(
				([version, latest]) => {
					updateToolStatus(i, {
						installedVersion: version,
						installed: version !== undefined,
						latestVersion: latest,
						checking: false,
						hasUpdate:
							version && latest
								? compareVersions(version, latest) < 0
								: false,
					});
				},
			);
		}
	}, [updateToolStatus]);

	useEffect(() => {
		if (!cacheInitialized) {
			cacheInitialized = true;
			cachedToolStatuses = toolStatuses;
			fetchVersionInfo();
		}
	}, [fetchVersionInfo, toolStatuses]);

	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			const newIndex = Math.max(0, cliToolsState.selectedIndex - 1);
			dispatch({ type: "CLITOOLS_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			const newIndex = Math.min(
				toolStatuses.length - 1,
				cliToolsState.selectedIndex + 1,
			);
			dispatch({ type: "CLITOOLS_SELECT", index: newIndex });
		} else if (event.name === "r") {
			handleRefresh();
		} else if (event.name === "a") {
			handleUpdateAll();
		} else if (event.name === "enter" || event.name === "return") {
			handleInstall();
		}
	});

	const handleRefresh = () => {
		clearCliToolsCache();
		setToolStatuses(
			cliTools.map((tool) => ({
				tool,
				installed: false,
				installedVersion: undefined,
				checking: true,
			})),
		);
		cacheInitialized = false;
		fetchVersionInfo();
	};

	const handleInstall = async () => {
		const status = toolStatuses[cliToolsState.selectedIndex];
		if (!status) return;

		const { tool, installed, hasUpdate } = status;
		const action = !installed ? "Installing" : hasUpdate ? "Updating" : "Reinstalling";

		const viaHomebrew = installed
			? await isInstalledViaHomebrew(tool.name)
			: false;

		const command = !installed
			? tool.installCommand
			: viaHomebrew
				? `brew upgrade ${tool.name}`
				: tool.installCommand;

		modal.loading(`${action} ${tool.displayName}...`);
		try {
			execSync(command, {
				encoding: "utf-8",
				stdio: "pipe",
				shell: "/bin/bash",
			});
			modal.hideModal();
			handleRefresh();
		} catch (error) {
			modal.hideModal();
			await modal.message(
				"Error",
				`Failed to ${action.toLowerCase()} ${tool.displayName}.\n\nTry running manually:\n${command}`,
				"error",
			);
		}
	};

	const handleUpdateAll = async () => {
		const updatable = toolStatuses.filter((s) => s.hasUpdate);
		if (updatable.length === 0) {
			await modal.message("Up to Date", "All tools are already up to date.", "info");
			return;
		}

		modal.loading(`Updating ${updatable.length} tool(s)...`);

		for (const status of updatable) {
			const viaHomebrew = await isInstalledViaHomebrew(status.tool.name);
			const command = viaHomebrew
				? `brew upgrade ${status.tool.name}`
				: status.tool.installCommand;
			try {
				execSync(command, {
					encoding: "utf-8",
					stdio: "pipe",
					shell: "/bin/bash",
				});
			} catch {
				// Continue with other updates
			}
		}

		modal.hideModal();
		handleRefresh();
	};

	const selectedStatus = toolStatuses[cliToolsState.selectedIndex];

	const installedCount = toolStatuses.filter((s) => s.installed).length;
	const updateCount = toolStatuses.filter((s) => s.hasUpdate).length;
	const statusContent = (
		<text>
			<span fg="gray">Installed: </span>
			<span fg="cyan">
				{installedCount}/{toolStatuses.length}
			</span>
			{updateCount > 0 && (
				<>
					<span fg="gray"> │ Updates: </span>
					<span fg="yellow">{updateCount}</span>
				</>
			)}
		</text>
	);

	return (
		<ScreenLayout
			title="claudeup CLI Tools"
			currentScreen="cli-tools"
			statusLine={statusContent}
			footerHints="↑↓:nav │ Enter:install │ a:update all │ r:refresh"
			listPanel={
				<ScrollableList
					items={toolStatuses}
					selectedIndex={cliToolsState.selectedIndex}
					renderItem={renderCliToolRow}
					maxHeight={dimensions.listPanelHeight}
				/>
			}
			detailPanel={renderCliToolDetail(selectedStatus)}
		/>
	);
}

export default CliToolsScreen;
