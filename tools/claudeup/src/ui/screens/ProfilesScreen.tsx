import React, { useEffect, useCallback } from "react";
import { useApp, useModal } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import {
	listProfiles,
	applyProfile,
	renameProfile,
	deleteProfile,
	exportProfileToJson,
	importProfileFromJson,
} from "../../services/profiles.js";
import {
	readSettings,
	writeSettings,
} from "../../services/claude-settings.js";
import {
	writeClipboard,
	readClipboard,
	ClipboardUnavailableError,
} from "../../utils/clipboard.js";
import type { ProfileEntry } from "../../types/index.js";
import {
	PREDEFINED_PROFILES,
	type PredefinedProfile,
} from "../../data/predefined-profiles.js";

// ─── List item discriminated union ───────────────────────────────────────────

type ListItem =
	| { kind: "header"; label: string; color: string; count: number }
	| { kind: "predefined"; profile: PredefinedProfile }
	| { kind: "saved"; entry: ProfileEntry };

function buildListItems(profileList: ProfileEntry[]): ListItem[] {
	const items: ListItem[] = [];

	// Presets section
	items.push({
		kind: "header",
		label: "Presets",
		color: "#4527a0",
		count: PREDEFINED_PROFILES.length,
	});
	for (const p of PREDEFINED_PROFILES) {
		items.push({ kind: "predefined", profile: p });
	}

	// Saved profiles section
	items.push({
		kind: "header",
		label: "Your Profiles",
		color: "#00695c",
		count: profileList.length,
	});
	for (const e of profileList) {
		items.push({ kind: "saved", entry: e });
	}

	return items;
}

/** Truncate a string to maxLen, appending ellipsis if needed */
function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	return s.slice(0, maxLen - 1) + "…";
}

/** Humanize setting values for display */
function humanizeValue(_key: string, value: unknown): string {
	if (typeof value === "boolean") return value ? "on" : "off";
	if (typeof value !== "string") return String(value);
	// Model names
	if (value === "claude-sonnet-4-6") return "Sonnet";
	if (value === "claude-opus-4-6") return "Opus";
	if (value === "claude-haiku-4-6") return "Haiku";
	if (value.startsWith("claude-sonnet")) return "Sonnet";
	if (value.startsWith("claude-opus")) return "Opus";
	if (value.startsWith("claude-haiku")) return "Haiku";
	return value;
}

/** Human-readable label for a setting key */
function humanizeKey(key: string): string {
	const labels: Record<string, string> = {
		effortLevel: "Effort",
		model: "Model",
		outputStyle: "Output",
		alwaysThinkingEnabled: "Thinking",
	};
	return labels[key] ?? key;
}

/** Strip @magus or @claude-plugins-official suffixes from a plugin name */
function stripSuffix(pluginName: string): string {
	return pluginName
		.replace(/@magus$/, "")
		.replace(/@claude-plugins-official$/, "");
}

/** Join an array of names into comma-separated lines, max ~40 chars each */
function wrapNames(names: string[], lineMax = 40): string[] {
	const lines: string[] = [];
	let current = "";
	for (const name of names) {
		const add = current ? `, ${name}` : name;
		if (current && current.length + add.length > lineMax) {
			lines.push(current);
			current = name;
		} else {
			current += current ? `, ${name}` : name;
		}
	}
	if (current) lines.push(current);
	return lines;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfilesScreen() {
	const { state, dispatch } = useApp();
	const { profiles: profilesState } = state;
	const modal = useModal();
	const dimensions = useDimensions();

	// Fetch data
	const fetchData = useCallback(async () => {
		dispatch({ type: "PROFILES_DATA_LOADING" });
		try {
			const entries = await listProfiles(state.projectPath);
			dispatch({ type: "PROFILES_DATA_SUCCESS", profiles: entries });
		} catch (error) {
			dispatch({
				type: "PROFILES_DATA_ERROR",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}, [dispatch, state.projectPath]);

	useEffect(() => {
		fetchData();
	}, [fetchData, state.dataRefreshVersion]);

	const profileList =
		profilesState.profiles.status === "success"
			? profilesState.profiles.data
			: [];

	const allItems = buildListItems(profileList);
	const selectedItem: ListItem | undefined = allItems[profilesState.selectedIndex];

	// Skip header items when navigating
	const isNavigable = (item: ListItem) => item.kind !== "header";

	// Keyboard handling
	useKeyboard((event) => {
		if (state.isSearching || state.modal) return;

		if (event.name === "up" || event.name === "k") {
			let newIndex = profilesState.selectedIndex - 1;
			while (newIndex > 0 && !isNavigable(allItems[newIndex]!)) {
				newIndex--;
			}
			if (newIndex >= 0 && isNavigable(allItems[newIndex]!)) {
				dispatch({ type: "PROFILES_SELECT", index: newIndex });
			}
		} else if (event.name === "down" || event.name === "j") {
			let newIndex = profilesState.selectedIndex + 1;
			while (newIndex < allItems.length - 1 && !isNavigable(allItems[newIndex]!)) {
				newIndex++;
			}
			if (newIndex < allItems.length && isNavigable(allItems[newIndex]!)) {
				dispatch({ type: "PROFILES_SELECT", index: newIndex });
			}
		} else if (event.name === "enter" || event.name === "a") {
			if (selectedItem?.kind === "predefined") {
				void handleApplyPredefined(selectedItem.profile);
			} else if (selectedItem?.kind === "saved") {
				void handleApply();
			}
		} else if (event.name === "r") {
			if (selectedItem?.kind === "saved") void handleRename();
		} else if (event.name === "d") {
			if (selectedItem?.kind === "saved") void handleDelete();
		} else if (event.name === "c") {
			if (selectedItem?.kind === "saved") void handleCopy();
		} else if (event.name === "i") {
			void handleImport();
		}
	});

	// ─── Predefined profile apply ─────────────────────────────────────────────

	const handleApplyPredefined = async (profile: PredefinedProfile) => {
		const allPlugins = [
			...profile.magusPlugins.map((p) => `${p}@magus`),
			...profile.anthropicPlugins.map(
				(p) => `${p}@claude-plugins-official`,
			),
		];
		const settingsCount = Object.keys(profile.settings).length;

		const confirmed = await modal.confirm(
			`Apply ${profile.name}?`,
			`This will add ${allPlugins.length} plugins, ${profile.skills.length} skills, and update ${settingsCount} settings.\n\nSettings are merged additively — existing values are kept.`,
		);
		if (!confirmed) return;

		modal.loading(`Applying "${profile.name}"...`);
		try {
			const settings = await readSettings(state.projectPath);

			// Merge plugins (additive only)
			settings.enabledPlugins = settings.enabledPlugins ?? {};
			for (const plugin of allPlugins) {
				if (!settings.enabledPlugins[plugin]) {
					settings.enabledPlugins[plugin] = true;
				}
			}

			// Merge top-level settings (additive — only set if not already set)
			for (const [key, value] of Object.entries(profile.settings)) {
				if (key === "env") {
					const envMap = value as Record<string, string>;
					const existing = settings as Record<string, unknown>;
					const existingEnv =
						(existing["env"] as Record<string, string> | undefined) ?? {};
					for (const [envKey, envVal] of Object.entries(envMap)) {
						if (!existingEnv[envKey]) {
							existingEnv[envKey] = envVal;
						}
					}
					(settings as Record<string, unknown>)["env"] = existingEnv;
				} else {
					const settingsMap = settings as Record<string, unknown>;
					if (settingsMap[key] === undefined) {
						settingsMap[key] = value;
					}
				}
			}

			await writeSettings(settings, state.projectPath);
			modal.hideModal();
			dispatch({ type: "DATA_REFRESH_COMPLETE" });
			await modal.message(
				"Applied",
				`Profile "${profile.name}" merged into project settings.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message(
				"Error",
				`Failed to apply profile: ${error}`,
				"error",
			);
		}
	};

	// ─── Saved profile actions ────────────────────────────────────────────────

	const handleApply = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const scopeChoice = await modal.select(
			"Apply Profile",
			`Apply "${selectedProfile.name}" to which scope?`,
			[
				{ label: "User — ~/.claude/settings.json (global)", value: "user" },
				{
					label: "Project — .claude/settings.json (this project)",
					value: "project",
				},
			],
		);
		if (scopeChoice === null) return;

		const targetScope = scopeChoice as "user" | "project";
		const scopeLabel =
			targetScope === "user"
				? "~/.claude/settings.json"
				: ".claude/settings.json";

		const pluginCount = Object.keys(selectedProfile.plugins).length;
		const emptyWarning =
			pluginCount === 0
				? "\n\nWARNING: This profile has no plugins — applying will disable all plugins."
				: "";

		const confirmed = await modal.confirm(
			"Confirm Apply",
			`This will REPLACE all enabledPlugins in ${scopeLabel}.${emptyWarning}\n\nContinue?`,
		);
		if (!confirmed) return;

		modal.loading(`Applying "${selectedProfile.name}"...`);
		try {
			await applyProfile(
				selectedProfile.id,
				selectedProfile.scope,
				targetScope,
				state.projectPath,
			);
			modal.hideModal();
			// Trigger PluginsScreen to refetch
			dispatch({ type: "DATA_REFRESH_COMPLETE" });
			await modal.message(
				"Applied",
				`Profile "${selectedProfile.name}" applied to ${scopeLabel}.`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message(
				"Error",
				`Failed to apply profile: ${error}`,
				"error",
			);
		}
	};

	const handleRename = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const newName = await modal.input(
			"Rename Profile",
			"New name:",
			selectedProfile.name,
		);
		if (newName === null || !newName.trim()) return;

		modal.loading("Renaming...");
		try {
			await renameProfile(
				selectedProfile.id,
				newName.trim(),
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			await fetchData();
			await modal.message(
				"Renamed",
				`Profile renamed to "${newName.trim()}".`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to rename: ${error}`, "error");
		}
	};

	const handleDelete = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		const confirmed = await modal.confirm(
			`Delete "${selectedProfile.name}"?`,
			"This will permanently remove the profile.",
		);
		if (!confirmed) return;

		modal.loading("Deleting...");
		try {
			await deleteProfile(
				selectedProfile.id,
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			// Adjust selection if we deleted the last item
			const newIndex = Math.max(
				0,
				Math.min(profilesState.selectedIndex, allItems.length - 2),
			);
			dispatch({ type: "PROFILES_SELECT", index: newIndex });
			await fetchData();
			await modal.message("Deleted", "Profile deleted.", "success");
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to delete: ${error}`, "error");
		}
	};

	const handleCopy = async () => {
		if (selectedItem?.kind !== "saved") return;
		const selectedProfile = selectedItem.entry;

		modal.loading("Exporting...");
		try {
			const json = await exportProfileToJson(
				selectedProfile.id,
				selectedProfile.scope,
				state.projectPath,
			);
			modal.hideModal();
			try {
				await writeClipboard(json);
				await modal.message(
					"Copied",
					`Profile JSON copied to clipboard.\nShare it with teammates to import.`,
					"success",
				);
			} catch (err) {
				if (err instanceof ClipboardUnavailableError) {
					// Fallback: show JSON in modal for manual copy
					await modal.message("Profile JSON (copy manually)", json, "info");
				} else {
					throw err;
				}
			}
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to export: ${error}`, "error");
		}
	};

	const handleImport = async () => {
		let json: string | null = null;

		// Try to read from clipboard first
		try {
			json = await readClipboard();
		} catch (err) {
			if (err instanceof ClipboardUnavailableError) {
				// Fallback: ask user to paste JSON manually
				json = await modal.input("Import Profile", "Paste profile JSON:");
			} else {
				await modal.message("Error", `Clipboard error: ${err}`, "error");
				return;
			}
		}

		if (json === null || !json.trim()) return;

		const scopeChoice = await modal.select(
			"Import Profile",
			"Save imported profile to which scope?",
			[
				{ label: "User — ~/.claude/profiles.json (global)", value: "user" },
				{
					label: "Project — .claude/profiles.json (this project)",
					value: "project",
				},
			],
		);
		if (scopeChoice === null) return;

		const targetScope = scopeChoice as "user" | "project";

		modal.loading("Importing...");
		try {
			const id = await importProfileFromJson(
				json,
				targetScope,
				state.projectPath,
			);
			modal.hideModal();
			await fetchData();
			await modal.message(
				"Imported",
				`Profile imported successfully (id: ${id}).`,
				"success",
			);
		} catch (error) {
			modal.hideModal();
			await modal.message("Error", `Failed to import: ${error}`, "error");
		}
	};

	// ─── Rendering helpers ────────────────────────────────────────────────────

	const formatDate = (iso: string): string => {
		try {
			const d = new Date(iso);
			return d.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		} catch {
			return iso;
		}
	};

	const renderListItem = (item: ListItem, _idx: number, isSelected: boolean) => {
		// Category header
		if (item.kind === "header") {
			return (
				<text bg={item.color} fg="white">
					<strong> {item.label} ({item.count}) </strong>
				</text>
			);
		}

		if (item.kind === "predefined") {
			const { profile } = item;
			const pluginCount =
				profile.magusPlugins.length + profile.anthropicPlugins.length;
			const skillCount = profile.skills.length;
			const label = truncate(
				`${profile.name} — ${pluginCount} plugins · ${skillCount} skill${skillCount !== 1 ? "s" : ""}`,
				45,
			);

			if (isSelected) {
				return (
					<text bg="blue" fg="white"> {label} </text>
				);
			}

			return (
				<text>
					<span fg="gray">- </span>
					<span fg="white">{label}</span>
				</text>
			);
		}

		// Saved profile
		const { entry } = item;
		const pluginCount = Object.keys(entry.plugins).length;
		const dateStr = formatDate(entry.updatedAt);
		const scopeColor = entry.scope === "user" ? "cyan" : "green";
		const scopeLabel = entry.scope === "user" ? "[user]" : "[proj]";
		const label = truncate(
			`${entry.name} — ${pluginCount} plugin${pluginCount !== 1 ? "s" : ""} · ${dateStr}`,
			45,
		);

		if (isSelected) {
			return (
				<text bg="magenta" fg="white"> {label} </text>
			);
		}

		return (
			<text>
				<span fg={scopeColor}>{scopeLabel} </span>
				<span fg="white">{label}</span>
			</text>
		);
	};

	const renderDetail = () => {
		if (profilesState.profiles.status === "loading") {
			return <text fg="gray">Loading profiles...</text>;
		}

		if (profilesState.profiles.status === "error") {
			return (
				<text fg="red">Error: {profilesState.profiles.error.message}</text>
			);
		}

		if (!selectedItem || selectedItem.kind === "header") {
			return <text fg="gray">Select a profile to see details</text>;
		}

		if (selectedItem.kind === "predefined") {
			return renderPredefinedDetail(selectedItem.profile);
		}

		return renderSavedDetail(selectedItem.entry);
	};

	const renderPredefinedDetail = (profile: PredefinedProfile) => {
		const magusNames = profile.magusPlugins;
		const anthropicNames = profile.anthropicPlugins;
		const magusLines = wrapNames(magusNames);
		const anthropicLines = wrapNames(anthropicNames);
		const skillLines = wrapNames(profile.skills);
		const divider = "────────────────────────";

		// Settings to display (excluding env)
		const settingEntries = Object.entries(profile.settings).filter(
			([k]) => k !== "env",
		);

		// Env flags as readable settings
		const envMap =
			(profile.settings["env"] as Record<string, string> | undefined) ?? {};
		const tasksOn = envMap["CLAUDE_CODE_ENABLE_TASKS"] === "true";
		const teamsOn =
			envMap["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "true";

		return (
			<box flexDirection="column">
				<text fg="white">
					<strong>{profile.name}</strong>
				</text>
				<box marginTop={1}>
					<text fg="gray">{profile.description}</text>
				</box>
				<box marginTop={1}>
					<text fg="#666666">{divider}</text>
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">Magus plugins ({magusNames.length}):</text>
					{magusLines.map((line, i) => (
						<text key={i} fg="cyan">  {line}</text>
					))}
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">Anthropic plugins ({anthropicNames.length}):</text>
					{anthropicLines.map((line, i) => (
						<text key={i} fg="yellow">  {line}</text>
					))}
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">Skills ({profile.skills.length}):</text>
					{skillLines.map((line, i) => (
						<text key={i} fg="white">  {line}</text>
					))}
				</box>
				<box marginTop={1}>
					<text fg="#666666">{divider}</text>
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">Settings:</text>
					{settingEntries.map(([k, v]) => (
						<text key={k}>
							<span fg="gray">  {humanizeKey(k).padEnd(14)}</span>
							<span fg="white">{humanizeValue(k, v)}</span>
						</text>
					))}
					{tasksOn && (
						<text>
							<span fg="gray">  {"Tasks".padEnd(14)}</span>
							<span fg="white">on</span>
						</text>
					)}
					{teamsOn && (
						<text>
							<span fg="gray">  {"Agent Teams".padEnd(14)}</span>
							<span fg="white">on</span>
						</text>
					)}
				</box>
				<box marginTop={1}>
					<text fg="#666666">{divider}</text>
				</box>
				<box marginTop={1}>
					<text bg="blue" fg="white"> Enter/a </text>
					<text fg="gray"> Apply to project</text>
				</box>
			</box>
		);
	};

	const renderSavedDetail = (selectedProfile: ProfileEntry) => {
		const plugins = Object.keys(selectedProfile.plugins);
		const cleanPlugins = plugins.map(stripSuffix);
		const scopeColor = selectedProfile.scope === "user" ? "cyan" : "green";
		const scopeLabel =
			selectedProfile.scope === "user"
				? "User (~/.claude/profiles.json)"
				: "Project (.claude/profiles.json — committed to git)";

		return (
			<box flexDirection="column">
				<text fg="cyan">
					<strong>{selectedProfile.name}</strong>
				</text>
				<box marginTop={1}>
					<text fg="gray">Scope: </text>
					<text fg={scopeColor}>{scopeLabel}</text>
				</box>
				<box marginTop={1}>
					<text fg="gray">
						Created: {formatDate(selectedProfile.createdAt)} · Updated:{" "}
						{formatDate(selectedProfile.updatedAt)}
					</text>
				</box>
				<box marginTop={1} flexDirection="column">
					<text fg="gray">
						Plugins ({plugins.length}
						{plugins.length === 0 ? " — applying will disable all plugins" : ""}
						):
					</text>
					{cleanPlugins.length === 0 ? (
						<text fg="yellow"> (none)</text>
					) : (
						wrapNames(cleanPlugins).map((line, i) => (
							<text key={i} fg="white">  {line}</text>
						))
					)}
				</box>
				<box marginTop={2} flexDirection="column">
					<box>
						<text bg="magenta" fg="white"> Enter/a </text>
						<text fg="gray"> Apply profile</text>
					</box>
					<box marginTop={1}>
						<text bg="#333333" fg="white"> r </text>
						<text fg="gray"> Rename</text>
					</box>
					<box marginTop={1}>
						<text bg="red" fg="white"> d </text>
						<text fg="gray"> Delete</text>
					</box>
					<box marginTop={1}>
						<text bg="blue" fg="white"> c </text>
						<text fg="gray"> Copy JSON to clipboard</text>
					</box>
					<box marginTop={1}>
						<text bg="green" fg="white"> i </text>
						<text fg="gray"> Import from clipboard</text>
					</box>
				</box>
			</box>
		);
	};

	const profileCount = profileList.length;
	const userCount = profileList.filter((p) => p.scope === "user").length;
	const projCount = profileList.filter((p) => p.scope === "project").length;

	const statusContent = (
		<text>
			<span fg="blue">{PREDEFINED_PROFILES.length} presets</span>
			<span fg="gray"> + </span>
			<span fg="cyan">{userCount} user</span>
			<span fg="gray"> + </span>
			<span fg="green">{projCount} project</span>
			<span fg="gray"> = </span>
			<span fg="white">{PREDEFINED_PROFILES.length + profileCount} total</span>
		</text>
	);

	// Find first navigable index for initial selection
	const firstNavigableIndex = allItems.findIndex(isNavigable);
	const effectiveIndex =
		profilesState.selectedIndex === 0 && selectedItem?.kind === "header"
			? firstNavigableIndex
			: profilesState.selectedIndex;

	return (
		<ScreenLayout
			title="claudeup Plugin Profiles"
			currentScreen="profiles"
			statusLine={statusContent}
			footerHints="↑↓:nav │ Enter/a:apply │ r:rename │ d:delete │ c:copy │ i:import"
			listPanel={
				<ScrollableList
					items={allItems}
					selectedIndex={effectiveIndex}
					renderItem={renderListItem}
					maxHeight={dimensions.listPanelHeight}
				/>
			}
			detailPanel={renderDetail()}
		/>
	);
}

export default ProfilesScreen;
