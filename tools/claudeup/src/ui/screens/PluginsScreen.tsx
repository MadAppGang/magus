import React, { useEffect, useCallback, useMemo } from "react";
import { useApp, useModal, useProgress } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { EmptyFilterState } from "../components/EmptyFilterState.js";
import { fuzzyFilter } from "../../utils/fuzzy-search.js";
import { getAllMarketplaces } from "../../data/marketplaces.js";
import {
	getAvailablePlugins,
	refreshAllMarketplaces,
	clearMarketplaceCache,
	getLocalMarketplacesInfo,
	type PluginInfo,
} from "../../services/plugin-manager.js";
import {
	setMcpEnvVar,
	getMcpEnvVars,
	readSettings,
	saveGlobalInstalledPluginVersion,
	saveLocalInstalledPluginVersion,
} from "../../services/claude-settings.js";
import { saveProfile } from "../../services/profiles.js";
import { saveInstalledPluginVersion } from "../../services/plugin-manager.js";
import {
	installPlugin as cliInstallPlugin,
	uninstallPlugin as cliUninstallPlugin,
	updatePlugin as cliUpdatePlugin,
	type PluginScope,
} from "../../services/claude-cli.js";
import {
	getPluginEnvRequirements,
	getPluginSourcePath,
} from "../../services/plugin-mcp-config.js";
import {
	getPluginSetupFromSource,
	checkMissingDeps,
	installPluginDeps,
} from "../../services/plugin-setup.js";
import {
	buildPluginBrowserItems,
	type PluginBrowserItem,
} from "../adapters/pluginsAdapter.js";
import { renderPluginRow, renderPluginDetail } from "../renderers/pluginRenderers.js";

export function PluginsScreen() {
	const { state, dispatch } = useApp();
	const { plugins: pluginsState } = state;
	const modal = useModal();
	const progress = useProgress();
	const dimensions = useDimensions();

	const isSearchActive =
		state.isSearching &&
		state.currentRoute.screen === "plugins" &&
		!state.modal;

	// Fetch data (always fetches all scopes)
	const fetchData = useCallback(async () => {
		dispatch({ type: "PLUGINS_DATA_LOADING" });
		try {
			const localMarketplaces = await getLocalMarketplacesInfo();
			const allMarketplaces = getAllMarketplaces(localMarketplaces);
			const pluginData = await getAvailablePlugins(state.projectPath);
			dispatch({
				type: "PLUGINS_DATA_SUCCESS",
				marketplaces: allMarketplaces,
				plugins: pluginData,
			});
		} catch (error) {
			dispatch({
				type: "PLUGINS_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	// Load data on mount or when dataRefreshVersion changes
	useEffect(() => {
		fetchData();
	}, [fetchData, state.dataRefreshVersion]);

	// Build list items (categories + plugins)
	const allItems = useMemo((): PluginBrowserItem[] => {
		if (
			pluginsState.marketplaces.status !== "success" ||
			pluginsState.plugins.status !== "success"
		) {
			return [];
		}
		return buildPluginBrowserItems({
			marketplaces: pluginsState.marketplaces.data,
			plugins: pluginsState.plugins.data,
			collapsedMarketplaces: pluginsState.collapsedMarketplaces,
		});
	}, [
		pluginsState.marketplaces,
		pluginsState.plugins,
		pluginsState.collapsedMarketplaces,
	]);

	// Filter items by search query
	const filteredItems = useMemo(() => {
		const query = pluginsState.searchQuery.trim();
		if (!query) return allItems;

		// Only search plugins, not categories
		const pluginItems = allItems.filter((item) => item.kind === "plugin");
		const fuzzyResults = fuzzyFilter(pluginItems, query, (item) => item.label);

		const matchedPluginIds = new Set<string>();
		for (const result of fuzzyResults) {
			matchedPluginIds.add(result.item.id);
		}

		// Walk allItems sequentially: include a category only if any plugin below matched
		const categoryHasMatch = new Map<string, boolean>();
		let currentCategoryId: string | null = null;
		for (const item of allItems) {
			if (item.kind === "category") {
				currentCategoryId = item.id;
				if (!categoryHasMatch.has(item.id)) {
					categoryHasMatch.set(item.id, false);
				}
			} else if (item.kind === "plugin" && currentCategoryId) {
				if (matchedPluginIds.has(item.id)) {
					categoryHasMatch.set(currentCategoryId, true);
				}
			}
		}

		const result: PluginBrowserItem[] = [];
		let currentCatIncluded = false;
		currentCategoryId = null;

		for (const item of allItems) {
			if (item.kind === "category") {
				currentCategoryId = item.id;
				currentCatIncluded = categoryHasMatch.get(item.id) === true;
				if (currentCatIncluded) result.push(item);
			} else if (item.kind === "plugin" && currentCatIncluded) {
				if (matchedPluginIds.has(item.id)) {
					const matched = fuzzyResults.find((r) => r.item.id === item.id);
					result.push({ ...item, matches: matched?.matches });
				}
			}
		}

		return result;
	}, [allItems, pluginsState.searchQuery]);

	const selectableItems = useMemo(() => filteredItems, [filteredItems]);

	// Keyboard handling
	useKeyboard((event) => {
		if (state.modal) return;

		const hasQuery = pluginsState.searchQuery.length > 0;

		if (event.name === "escape") {
			if (hasQuery || isSearchActive) {
				dispatch({ type: "PLUGINS_SET_SEARCH", query: "" });
				dispatch({ type: "SET_SEARCHING", isSearching: false });
				dispatch({ type: "PLUGINS_SELECT", index: 0 });
			}
			return;
		}

		if (event.name === "backspace" || event.name === "delete") {
			if (hasQuery) {
				const newQuery = pluginsState.searchQuery.slice(0, -1);
				dispatch({ type: "PLUGINS_SET_SEARCH", query: newQuery });
				dispatch({ type: "PLUGINS_SELECT", index: 0 });
				if (newQuery.length === 0) {
					dispatch({ type: "SET_SEARCHING", isSearching: false });
				}
			}
			return;
		}

		if (event.name === "up" || event.name === "k") {
			if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
			dispatch({ type: "PLUGINS_SELECT", index: Math.max(0, pluginsState.selectedIndex - 1) });
			return;
		}
		if (event.name === "down" || event.name === "j") {
			if (isSearchActive) dispatch({ type: "SET_SEARCHING", isSearching: false });
			dispatch({
				type: "PLUGINS_SELECT",
				index: Math.min(selectableItems.length - 1, pluginsState.selectedIndex + 1),
			});
			return;
		}

		if (event.name === "enter" || event.name === "return") {
			if (isSearchActive) {
				dispatch({ type: "SET_SEARCHING", isSearching: false });
				return;
			}
			handleSelect();
			return;
		}

		if (
			(event.name === "left" ||
				event.name === "right" ||
				event.name === "<" ||
				event.name === ">") &&
			selectableItems[pluginsState.selectedIndex]?.kind === "category"
		) {
			const item = selectableItems[pluginsState.selectedIndex];
			if (item?.kind === "category") {
				dispatch({ type: "PLUGINS_TOGGLE_MARKETPLACE", name: item.marketplace.name });
			}
			return;
		}

		if (isSearchActive) {
			if (event.name.length === 1 && !event.ctrl && !event.meta && !/[0-9]/.test(event.name)) {
				dispatch({
					type: "PLUGINS_SET_SEARCH",
					query: pluginsState.searchQuery + event.name,
				});
				dispatch({ type: "PLUGINS_SELECT", index: 0 });
			}
			return;
		}

		if (event.name === "/") {
			dispatch({ type: "SET_SEARCHING", isSearching: true });
			return;
		}

		if (event.name === "r") handleRefresh();
		else if (event.name === "n") handleShowAddMarketplaceInstructions();
		else if (event.name === "t") handleShowTeamConfigHelp();
		else if (event.name === "u") handleScopeToggle("user");
		else if (event.name === "p") handleScopeToggle("project");
		else if (event.name === "l") handleScopeToggle("local");
		else if (event.name === "U") handleUpdate();
		else if (event.name === "a") handleUpdateAll();
		else if (event.name === "s") handleSaveAsProfile();
	});

	// ── Action handlers ────────────────────────────────────────────────────────

	const handleRefresh = async () => {
		progress.show("Refreshing cache...");
		try {
			const result = await refreshAllMarketplaces((p) => {
				progress.show(`${p.name}`, p.current, p.total);
			});
			clearMarketplaceCache();
			progress.hide();

			let message =
				"Cache refreshed.\n\n" +
				"To update marketplaces from GitHub, run in Claude Code:\n" +
				"  /plugin marketplace update\n\n" +
				"Then refresh claudeup again with 'r'.";

			if (result.repair.length > 0) {
				const totalRepaired = result.repair.reduce(
					(sum, r) => sum + r.repaired.length,
					0,
				);
				message += `\n\nAuto-repaired ${totalRepaired} plugin(s) with missing agents/commands.`;
			}

			await modal.message("Refreshed", message, "success");
			fetchData();
		} catch (error) {
			progress.hide();
			await modal.message("Error", `Refresh failed: ${error}`, "error");
		}
	};

	const handleShowAddMarketplaceInstructions = async () => {
		await modal.message(
			"Add Marketplace",
			"To add a marketplace, run this command in your terminal:\n\n" +
				"  claude plugin marketplace add owner/repo\n\n" +
				"Examples:\n" +
				"  claude plugin marketplace add MadAppGang/magus\n" +
				"  claude plugin marketplace add anthropics/claude-plugins-official\n\n" +
				"Auto-update is enabled by default for new marketplaces.\n\n" +
				"After adding, refresh claudeup with 'r' to see the new marketplace.",
			"info",
		);
	};

	const handleShowTeamConfigHelp = async () => {
		const helpText =
			"TEAM CONFIGURATION FOR MARKETPLACES\n\n" +
			"To configure marketplaces for your entire team:\n\n" +
			"1. Add to .claude/settings.json (committed to git):\n\n" +
			"   {\n" +
			'     "extraKnownMarketplaces": {\n' +
			'       "company-tools": {\n' +
			'         "source": {\n' +
			'           "source": "github",\n' +
			'           "repo": "your-org/claude-plugins"\n' +
			"         }\n" +
			"       }\n" +
			"     },\n" +
			'     "enabledPlugins": {\n' +
			'       "code-formatter@company-tools": true\n' +
			"     }\n" +
			"   }\n\n" +
			"2. Team members get prompted to install when they trust the folder\n\n" +
			"3. Marketplaces are GLOBAL ONLY (managed by Claude Code)\n" +
			"   - Not project-specific\n" +
			"   - All team members share the same marketplace cache\n\n" +
			"NOTE: Individual plugin enablement is still project-specific.\n" +
			'Use "Project" scope in claudeup to enable for the team.';

		await modal.message("Team Configuration", helpText, "info");
	};

	/**
	 * Collect environment variables required by a plugin's MCP servers.
	 */
	const collectPluginEnvVars = async (
		pluginName: string,
		marketplace: string,
	): Promise<boolean> => {
		try {
			const pluginSource = await getPluginSourcePath(marketplace, pluginName);
			if (!pluginSource) return true;

			const requirements = await getPluginEnvRequirements(marketplace, pluginSource);
			if (requirements.length === 0) return true;

			const existingEnvVars = await getMcpEnvVars(state.projectPath);
			const missingVars = requirements.filter(
				(req) => !existingEnvVars[req.name] && !process.env[req.name],
			);

			if (missingVars.length === 0) return true;

			const serverNames = [...new Set(missingVars.map((v) => v.serverName))];
			const wantToConfigure = await modal.confirm(
				"Configure MCP Servers?",
				`This plugin includes MCP servers (${serverNames.join(", ")}) that need ${missingVars.length} environment variable(s).\n\nConfigure now?`,
			);

			if (!wantToConfigure) {
				await modal.message(
					"Skipped Configuration",
					"You can configure these variables later in the Environment Variables screen (press 4).",
					"info",
				);
				return true;
			}

			for (const req of missingVars) {
				const existingProcessEnv = process.env[req.name];
				if (existingProcessEnv) {
					const useExisting = await modal.confirm(
						`Use ${req.name}?`,
						`${req.name} is already set in your environment.\n\nUse the existing value?`,
					);
					if (useExisting) {
						await setMcpEnvVar(req.name, `\${${req.name}}`, state.projectPath);
						continue;
					}
				}

				const value = await modal.input(
					`Configure ${req.serverName}`,
					`${req.label} (required):`,
					"",
				);

				if (value === null) {
					await modal.message(
						"Configuration Incomplete",
						`Skipped remaining configuration.\nYou can configure these later in Environment Variables (press 4).`,
						"info",
					);
					return true;
				}

				if (value) {
					await setMcpEnvVar(req.name, value, state.projectPath);
				}
			}

			return true;
		} catch (error) {
			console.error("Error collecting plugin env vars:", error);
			return true;
		}
	};

	/**
	 * Install system dependencies required by a plugin's MCP servers.
	 */
	const installPluginSystemDeps = async (
		pluginName: string,
		marketplace: string,
	): Promise<void> => {
		try {
			const setup = await getPluginSetupFromSource(marketplace, pluginName);
			if (!setup) return;

			const missing = await checkMissingDeps(setup);
			const hasMissing =
				(missing.pip?.length || 0) +
					(missing.brew?.length || 0) +
					(missing.npm?.length || 0) +
					(missing.cargo?.length || 0) >
				0;

			if (!hasMissing) return;

			const parts: string[] = [];
			if (missing.pip?.length) parts.push(`pip: ${missing.pip.join(", ")}`);
			if (missing.brew?.length) parts.push(`brew: ${missing.brew.join(", ")}`);
			if (missing.npm?.length) parts.push(`npm: ${missing.npm.join(", ")}`);
			if (missing.cargo?.length) parts.push(`cargo: ${missing.cargo.join(", ")}`);

			const wantInstall = await modal.confirm(
				"Install Dependencies?",
				`This plugin needs system dependencies:\n\n${parts.join("\n")}\n\nInstall now?`,
			);

			if (!wantInstall) return;

			modal.loading("Installing dependencies...");
			const result = await installPluginDeps(missing);
			modal.hideModal();

			if (result.failed.length > 0) {
				const failMsg = result.failed.map((f) => `${f.pkg}: ${f.error}`).join("\n");
				await modal.message(
					"Partial Install",
					`Installed: ${result.installed.length}\nFailed:\n${failMsg}`,
					"error",
				);
			} else if (result.installed.length > 0) {
				await modal.message(
					"Dependencies Installed",
					`Installed ${result.installed.length} package(s):\n${result.installed.join(", ")}`,
					"success",
				);
			}
		} catch (error) {
			console.error("Error installing plugin deps:", error);
		}
	};

	/**
	 * Save installed plugin version to settings after CLI install/update.
	 */
	const saveVersionAfterInstall = async (
		pluginId: string,
		version: string,
		scope: PluginScope,
	): Promise<void> => {
		try {
			if (scope === "user") {
				await saveGlobalInstalledPluginVersion(pluginId, version);
			} else if (scope === "local") {
				await saveLocalInstalledPluginVersion(pluginId, version, state.projectPath);
			} else {
				await saveInstalledPluginVersion(pluginId, version, state.projectPath);
			}
		} catch {
			// Non-fatal: version display may be stale but plugin still works
		}
	};

	const handleSelect = async () => {
		const item = selectableItems[pluginsState.selectedIndex];
		if (!item) return;

		if (item.kind === "category") {
			const mp = item.marketplace;

			if (item.marketplaceEnabled) {
				const isCollapsed = pluginsState.collapsedMarketplaces.has(mp.name);
				if (isCollapsed) {
					dispatch({ type: "PLUGINS_TOGGLE_MARKETPLACE", name: mp.name });
				} else if (item.pluginCount > 0) {
					dispatch({ type: "PLUGINS_TOGGLE_MARKETPLACE", name: mp.name });
				} else {
					await modal.message(
						`Remove ${mp.displayName}?`,
						`To remove this marketplace, run in Claude Code:\n\n` +
							`  /plugin marketplace remove ${mp.name}\n\n` +
							`After removing, refresh claudeup with 'r' to update the display.`,
						"info",
					);
				}
			} else {
				await modal.message(
					`Add ${mp.displayName}?`,
					`To add this marketplace, run in your terminal:\n\n` +
						`  claude plugin marketplace add ${mp.source.repo || mp.name}\n\n` +
						`Auto-update is enabled by default.\n\n` +
						`After adding, refresh claudeup with 'r' to see it.`,
					"info",
				);
			}
		} else if (item.kind === "plugin") {
			const plugin = item.plugin;
			const latestVersion = plugin.version || "0.0.0";

			const buildScopeLabel = (
				name: string,
				scope: { enabled?: boolean; version?: string } | undefined,
				desc: string,
			) => {
				const installed = scope?.enabled;
				const ver = scope?.version;
				const hasUpdate = ver && latestVersion && ver !== latestVersion && latestVersion !== "0.0.0";
				let label = installed ? `● ${name}` : `○ ${name}`;
				label += ` (${desc})`;
				if (ver) label += ` v${ver}`;
				if (hasUpdate) label += ` → v${latestVersion}`;
				return label;
			};

			const scopeOptions = [
				{ label: buildScopeLabel("User", plugin.userScope, "global"), value: "user" },
				{ label: buildScopeLabel("Project", plugin.projectScope, "team"), value: "project" },
				{ label: buildScopeLabel("Local", plugin.localScope, "private"), value: "local" },
			];

			const scopeValue = await modal.select(plugin.name, `Select scope to toggle:`, scopeOptions);
			if (scopeValue === null) return;

			const selectedScope =
				scopeValue === "user"
					? plugin.userScope
					: scopeValue === "project"
						? plugin.projectScope
						: plugin.localScope;
			const isInstalledInScope = selectedScope?.enabled;
			const installedVersion = selectedScope?.version;
			const scopeLabel =
				scopeValue === "user" ? "User" : scopeValue === "project" ? "Project" : "Local";

			const hasUpdateInScope =
				isInstalledInScope &&
				installedVersion &&
				latestVersion !== "0.0.0" &&
				installedVersion !== latestVersion;

			let action: "update" | "install" | "uninstall";
			if (isInstalledInScope && hasUpdateInScope) {
				action = "update";
			} else if (isInstalledInScope) {
				action = "uninstall";
			} else {
				action = "install";
			}

			const actionLabel =
				action === "update"
					? `Updating ${scopeLabel}`
					: action === "install"
						? `Installing to ${scopeLabel}`
						: `Uninstalling from ${scopeLabel}`;
			modal.loading(`${actionLabel}...`);

			try {
				const scope = scopeValue as PluginScope;
				if (action === "uninstall") {
					await cliUninstallPlugin(plugin.id, scope, state.projectPath);
				} else if (action === "update") {
					await cliUpdatePlugin(plugin.id, scope);
					await saveVersionAfterInstall(plugin.id, latestVersion, scope);
				} else {
					await cliInstallPlugin(plugin.id, scope);
					await saveVersionAfterInstall(plugin.id, latestVersion, scope);
					modal.hideModal();
					await collectPluginEnvVars(plugin.name, plugin.marketplace);
					await installPluginSystemDeps(plugin.name, plugin.marketplace);
				}
				if (action !== "install") {
					modal.hideModal();
				}
				fetchData();
			} catch (error) {
				modal.hideModal();
				await modal.message("Error", `Failed: ${error}`, "error");
			}
		}
	};

	const handleUpdate = async () => {
		const item = selectableItems[pluginsState.selectedIndex];
		if (!item || item.kind !== "plugin" || !item.plugin.hasUpdate) return;

		const plugin = item.plugin;
		const scope: PluginScope = pluginsState.scope === "global" ? "user" : "project";

		modal.loading(`Updating ${plugin.name}...`);
		try {
			await cliUpdatePlugin(plugin.id, scope);
			await saveVersionAfterInstall(plugin.id, plugin.version || "0.0.0", scope);
			modal.hideModal();
			fetchData();
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to update: ${error}`, "error");
		}
	};

	const handleUpdateAll = async () => {
		if (pluginsState.plugins.status !== "success") return;

		const updatable = pluginsState.plugins.data.filter((p) => p.hasUpdate);
		if (updatable.length === 0) return;

		const scope: PluginScope = pluginsState.scope === "global" ? "user" : "project";
		modal.loading(`Updating ${updatable.length} plugin(s)...`);

		try {
			for (const plugin of updatable) {
				await cliUpdatePlugin(plugin.id, scope);
				await saveVersionAfterInstall(plugin.id, plugin.version || "0.0.0", scope);
			}
			modal.hideModal();
			fetchData();
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to update: ${error}`, "error");
		}
	};

	const handleScopeToggle = async (scope: "user" | "project" | "local") => {
		const item = selectableItems[pluginsState.selectedIndex];
		if (!item || item.kind !== "plugin") return;

		const plugin = item.plugin;
		const latestVersion = plugin.version || "0.0.0";
		const scopeLabel =
			scope === "user" ? "User" : scope === "project" ? "Project" : "Local";

		const scopeData =
			scope === "user"
				? plugin.userScope
				: scope === "project"
					? plugin.projectScope
					: plugin.localScope;
		const isInstalledInScope = scopeData?.enabled;
		const installedVersion = scopeData?.version;

		const hasUpdateInScope =
			isInstalledInScope &&
			installedVersion &&
			latestVersion !== "0.0.0" &&
			installedVersion !== latestVersion;

		let action: "update" | "install" | "uninstall";
		if (isInstalledInScope && hasUpdateInScope) {
			action = "update";
		} else if (isInstalledInScope) {
			action = "uninstall";
		} else {
			action = "install";
		}

		const actionLabel =
			action === "update"
				? `Updating ${scopeLabel}`
				: action === "install"
					? `Installing to ${scopeLabel}`
					: `Uninstalling from ${scopeLabel}`;
		modal.loading(`${actionLabel}...`);

		try {
			if (action === "uninstall") {
				await cliUninstallPlugin(plugin.id, scope, state.projectPath);
			} else if (action === "update") {
				await cliUpdatePlugin(plugin.id, scope);
				await saveVersionAfterInstall(plugin.id, latestVersion, scope);
			} else {
				await cliInstallPlugin(plugin.id, scope);
				await saveVersionAfterInstall(plugin.id, latestVersion, scope);
				modal.hideModal();
				await collectPluginEnvVars(plugin.name, plugin.marketplace);
				await installPluginSystemDeps(plugin.name, plugin.marketplace);
			}
			if (action !== "install") {
				modal.hideModal();
			}
			fetchData();
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed: ${error}`, "error");
		}
	};

	const handleSaveAsProfile = async () => {
		const settings = await readSettings(state.projectPath);
		const enabledPlugins = settings.enabledPlugins ?? {};

		const name = await modal.input("Save Profile", "Profile name:");
		if (name === null || !name.trim()) return;

		const scopeChoice = await modal.select(
			"Save to scope",
			"Where should this profile be saved?",
			[
				{ label: "User — ~/.claude/profiles.json (available everywhere)", value: "user" },
				{ label: "Project — .claude/profiles.json (shared with team via git)", value: "project" },
			],
		);
		if (scopeChoice === null) return;

		const scope = scopeChoice as "user" | "project";

		modal.loading("Saving profile...");
		try {
			await saveProfile(name.trim(), enabledPlugins, scope, state.projectPath);
			modal.hideModal();
			await modal.message(
				"Saved",
				`Profile "${name.trim()}" saved.\nPress 6 to manage profiles.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to save profile: ${error}`, "error");
		}
	};

	// ── Render ─────────────────────────────────────────────────────────────────

	if (
		pluginsState.marketplaces.status === "loading" ||
		pluginsState.plugins.status === "loading"
	) {
		return (
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				<text fg="#7e57c2">
					<strong>claudeup Plugins</strong>
				</text>
				<text fg="gray">Loading...</text>
			</box>
		);
	}

	if (
		pluginsState.marketplaces.status === "error" ||
		pluginsState.plugins.status === "error"
	) {
		return (
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				<text fg="#7e57c2">
					<strong>claudeup Plugins</strong>
				</text>
				<text fg="red">Error loading data</text>
			</box>
		);
	}

	const selectedItem = selectableItems[pluginsState.selectedIndex];

	const footerHints = isSearchActive
		? "type to filter │ Enter:done │ Esc:clear"
		: "u/p/l:toggle │ U:update │ a:all │ s:profile │ /:search";

	const scopeLabel = pluginsState.scope === "global" ? "Global" : "Project";
	const plugins: PluginInfo[] =
		pluginsState.plugins.status === "success" ? pluginsState.plugins.data : [];
	const installedCount = plugins.filter((p) => p.enabled).length;
	const updateCount = plugins.filter((p) => p.hasUpdate).length;
	const subtitle = `${scopeLabel} │ ${installedCount} installed${updateCount > 0 ? ` │ ${updateCount} updates` : ""}`;
	const searchPlaceholder = `${scopeLabel} │ ${installedCount} installed${updateCount > 0 ? ` │ ${updateCount} ⬆` : ""} │ / to search`;

	return (
		<ScreenLayout
			title="claudeup Plugins"
			subtitle={subtitle}
			currentScreen="plugins"
			search={{
				isActive: isSearchActive,
				query: pluginsState.searchQuery,
				placeholder: searchPlaceholder,
			}}
			footerHints={footerHints}
			listPanel={
				<box flexDirection="column">
					<ScrollableList
						items={selectableItems}
						selectedIndex={pluginsState.selectedIndex}
						renderItem={renderPluginRow}
						maxHeight={dimensions.listPanelHeight}
					/>
					{pluginsState.searchQuery && selectableItems.length === 0 && (
						<EmptyFilterState query={pluginsState.searchQuery} entityName="plugins" />
					)}
				</box>
			}
			detailPanel={renderPluginDetail(selectedItem, pluginsState.collapsedMarketplaces)}
		/>
	);
}

export default PluginsScreen;
