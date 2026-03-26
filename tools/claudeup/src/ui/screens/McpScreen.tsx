import React, { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal, useNavigation } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	getMcpServersByCategory,
	getCategoryDisplayName,
	categoryOrder,
} from "../../data/mcp-servers.js";
import {
	addMcpServer,
	removeMcpServer,
	getInstalledMcpServers,
	getEnabledMcpServers,
} from "../../services/claude-settings.js";
import type { McpServer, McpServerConfig } from "../../types/index.js";
import {
	renderMcpRow,
	renderMcpDetail,
	type McpListItem,
} from "../renderers/mcpRenderers.js";

export function McpScreen() {
	const { state, dispatch } = useApp();
	const { mcp } = state;
	const modal = useModal();
	const { navigateToScreen } = useNavigation();
	const dimensions = useDimensions();

	const fetchData = useCallback(async () => {
		dispatch({ type: "MCP_DATA_LOADING" });
		try {
			const serversByCategory = getMcpServersByCategory();
			const installedServers = await getInstalledMcpServers(state.projectPath);
			const enabledServers = await getEnabledMcpServers(state.projectPath);

			const servers: McpServer[] = [];
			for (const category of categoryOrder) {
				const categoryServers = serversByCategory[category];
				if (categoryServers) {
					servers.push(...categoryServers);
				}
			}

			const installedAsBooleans: Record<string, boolean> = {};
			for (const name of Object.keys(installedServers)) {
				installedAsBooleans[name] = true;
			}

			dispatch({
				type: "MCP_DATA_SUCCESS",
				servers,
				installedServers: { ...installedAsBooleans, ...enabledServers },
			});
		} catch (error) {
			dispatch({
				type: "MCP_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const allListItems = useMemo((): McpListItem[] => {
		if (mcp.servers.status !== "success") return [];

		const serversByCategory = getMcpServersByCategory();
		const items: McpListItem[] = [];

		for (const category of categoryOrder) {
			const servers = serversByCategory[category];
			if (!servers || servers.length === 0) continue;

			items.push({ kind: "category", label: getCategoryDisplayName(category) });

			for (const server of servers) {
				const isInstalled = mcp.installedServers[server.name] !== undefined;
				items.push({ kind: "server", server, isInstalled });
			}
		}

		return items;
	}, [mcp.servers.status, mcp.installedServers]);

	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "/") {
			dispatch({ type: "SET_SEARCHING", isSearching: true });
			navigateToScreen("mcp-registry");
			return;
		}

		if (event.name === "up" || event.name === "k") {
			const newIndex = Math.max(0, mcp.selectedIndex - 1);
			dispatch({ type: "MCP_SELECT", index: newIndex });
		} else if (event.name === "down" || event.name === "j") {
			const newIndex = Math.min(allListItems.length - 1, mcp.selectedIndex + 1);
			dispatch({ type: "MCP_SELECT", index: newIndex });
		} else if (event.name === "r") {
			navigateToScreen("mcp-registry");
		} else if (event.name === "enter") {
			handleSelect();
		}
	});

	const handleSelect = async () => {
		const item = allListItems[mcp.selectedIndex];
		if (!item || item.kind === "category") return;

		const { server, isInstalled } = item;

		if (isInstalled) {
			const confirmed = await modal.confirm(
				`Remove ${server.name}?`,
				"This will remove the MCP server configuration.",
			);
			if (confirmed) {
				modal.loading(`Removing ${server.name}...`);
				try {
					await removeMcpServer(server.name, state.projectPath);
					modal.hideModal();
					await modal.message("Removed", `${server.name} has been removed.`, "success");
					fetchData();
				} catch (error) {
					modal.hideModal();
					await modal.message("Error", `Failed to remove: ${error}`, "error");
				}
			}
		} else {
			await installMcpServer(server);
		}
	};

	const installMcpServer = async (server: McpServer) => {
		let config: McpServerConfig;

		if (server.type === "http") {
			config = { type: "http", url: server.url! };
		} else {
			config = {
				command: server.command!,
				args: server.args ? [...server.args] : undefined,
				env: server.env ? { ...server.env } : undefined,
			};
		}

		if (server.requiresConfig && server.configFields) {
			for (const field of server.configFields) {
				const envVarName = field.envVar || field.name;
				const existingValue = process.env[envVarName];

				if (existingValue) {
					const useExisting = await modal.confirm(
						`Use ${envVarName}?`,
						`${envVarName} is set in your environment. Use the existing value?`,
					);
					if (useExisting) {
						config.env = config.env || {};
						config.env[envVarName] = `\${${envVarName}}`;
						continue;
					}
				}

				const value = await modal.input(
					`Configure ${server.name}`,
					`${field.label}${field.required ? " (required)" : ""}:`,
					field.default,
				);
				if (value === null) return;

				if (field.required && !value) {
					await modal.message("Required Field", `${field.label} is required.`, "error");
					return;
				}

				if (value) {
					config.env = config.env || {};
					config.env[envVarName] = value;
				}
			}
		}

		modal.loading(`Installing ${server.name}...`);
		try {
			await addMcpServer(server.name, config, state.projectPath);
			modal.hideModal();
			await modal.message(
				"Installed",
				`${server.name} has been configured.\n\nRestart Claude Code to activate.`,
				"success",
			);
			fetchData();
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to install: ${error}`, "error");
		}
	};

	const selectedItem = allListItems[mcp.selectedIndex];
	const isLoading = mcp.servers.status === "loading";

	const installedCount = Object.keys(mcp.installedServers).length;
	const enabledCount = Object.values(mcp.installedServers).filter(
		(v) => v === true,
	).length;
	const subtitle = `${enabledCount} enabled │ ${installedCount} configured │ / to search`;

	return (
		<ScreenLayout
			title="claudeup MCP Servers"
			subtitle={subtitle}
			currentScreen="mcp"
			footerHints="↑↓:nav │ Enter:toggle │ /:search │ r:registry"
			listPanel={
				<ScrollableList
					items={allListItems}
					selectedIndex={mcp.selectedIndex}
					renderItem={renderMcpRow}
					maxHeight={dimensions.listPanelHeight}
				/>
			}
			detailPanel={renderMcpDetail(selectedItem, isLoading)}
		/>
	);
}

export default McpScreen;
